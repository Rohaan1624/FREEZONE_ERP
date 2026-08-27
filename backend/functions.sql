-- =============================================================================
-- ERP_ZL — functions & triggers
-- Run after schema.sql and policy.sql
-- =============================================================================
--
-- Tier 2 tables (invoice, transaction, purchase, entry, payments) have a SELECT
-- policy and no write policy, so these SECURITY DEFINER functions are the only
-- way to write them.
--
-- Two rules every function follows:
--   * `set search_path = ''` + fully-qualified names. Without it a user can
--     shadow `public` and hijack a definer function.
--   * An explicit `user_id = v_uid` check. RLS is bypassed inside a definer
--     function, so those filters ARE the security.
--
-- -----------------------------------------------------------------------------
-- THE STOCK MODEL
-- -----------------------------------------------------------------------------
-- An invoice has a STOCK FOOTPRINT: its product-line quantities when the status
-- is 'active' or 'closed', and NOTHING when it is 'draft'.
--
--     draft   -> footprint {}            (nothing reserved)
--     active  -> footprint {sku: qty}    (deducted from product.stock)
--     closed  -> footprint {sku: qty}    (stays deducted, frozen)
--
-- Every operation is then the same thing — move the footprint from OLD to NEW
-- and apply the difference:
--
--     create as draft      {} -> {}          no stock change
--     create as active     {} -> {A:3}       deduct 3
--     edit 3 -> 5          {A:3} -> {A:5}    deduct 2 more (checked)
--     edit 5 -> 1          {A:5} -> {A:1}    credit 4 back
--     issue (draft->active){} -> {A:3}       deduct 3
--     revert(active->draft){A:3} -> {}       credit 3 back
--     delete an active     {A:3} -> {}       credit 3 back
--     delete a draft       {} -> {}          nothing to credit
--
-- That is why apply_stock_delta() below is the ONLY place stock moves. Writing
-- the arithmetic separately in create/edit/delete/status is how you end up with
-- four different bugs.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Superseded signatures
-- -----------------------------------------------------------------------------
-- `create or replace function` only replaces a function with the SAME argument
-- types. Adding p_notes changed four signatures, so without these drops the old
-- versions would survive as OVERLOADS and PostgREST would see two functions of
-- the same name and refuse to pick one. `if exists` keeps the file re-runnable.
drop function if exists public.create_invoice(uuid, text, jsonb, text);
drop function if exists public.update_invoice(uuid, jsonb);
drop function if exists public.update_invoice(uuid, jsonb, text);
drop function if exists public.create_payment(uuid, numeric, text, uuid);
drop function if exists public.update_payment(uuid, numeric, text, uuid);

-- due_date added -> signatures changed again
drop function if exists public.create_invoice(uuid, text, jsonb, text, text);
drop function if exists public.update_invoice(uuid, jsonb, text, uuid, text);

-- migration-003: los datos de embarque llegan en un solo jsonb (p_doc) en vez
-- de seis parámetros sueltos. Son metadatos del documento sin lógica asociada,
-- así que agruparlos evita volver a cambiar la firma la próxima vez que la
-- papelería pida un campo más.
drop function if exists public.create_invoice(uuid, text, jsonb, text, text, date);
drop function if exists public.update_invoice(uuid, jsonb, text, uuid, text, date);

-- invoice.total and purchase.total used to be maintained by FOR EACH ROW
-- triggers. They are plain functions now, called directly by the RPCs that
-- write the lines. Drop the old machinery so re-applying this file is clean.
drop trigger  if exists transaction_recalc_total on public.transaction;
drop trigger  if exists entry_recalc_total       on public.entry;
drop function if exists public.trg_recalc_invoice_total();
drop function if exists public.trg_recalc_purchase_total();

-- client.balance was maintained by triggers on invoice and payments. It is now
-- recalculated explicitly by each RPC that can change it, so every write path
-- is visible in the function that performs it.
drop trigger  if exists invoice_recalc_balance  on public.invoice;
drop trigger  if exists payments_recalc_balance on public.payments;
drop function if exists public.trg_recalc_client_balance();


-- -----------------------------------------------------------------------------
-- invoice_footprint (internal)
-- -----------------------------------------------------------------------------
-- The invoice's committed product quantities as {"<product_id>": qty}.
-- Returns {} when the invoice is a draft — a draft reserves nothing.
-- 'charge' and 'miscellaneous' lines are excluded: they are money, not goods.
create or replace function public.invoice_footprint(p_invoice_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.product_id::text, s.qty), '{}'::jsonb)
    from (
      select t.product_id, sum(t.qty)::numeric as qty
        from public.transaction t
        join public.invoice i on i.id = t.invoice_id
       where t.invoice_id = p_invoice_id
         and t.type = 'product'
         and i.status in ('active', 'closed')
       group by t.product_id
    ) s;
$$;


-- -----------------------------------------------------------------------------
-- apply_stock_delta (internal) — the ONLY place product.stock moves
-- -----------------------------------------------------------------------------
-- p_old / p_new are footprints. Positive difference = deduct, negative = credit.
--
-- Race safety: each product row is locked FOR UPDATE before it is read, so a
-- concurrent call cannot read the same stock and sell it twice — the second
-- caller blocks until the first commits, then re-reads the true value.
-- Rows are locked in sorted order so two invoices sharing products cannot
-- deadlock against each other.
create or replace function public.apply_stock_delta(
  p_uid uuid,
  p_old jsonb,
  p_new jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_stock numeric;
  v_sku   text;
begin
  for r in
    select k.key                                   as product_id,
           coalesce((p_old ->> k.key)::numeric, 0) as viejo,
           coalesce((p_new ->> k.key)::numeric, 0) as nuevo,
           coalesce((p_new ->> k.key)::numeric, 0)
         - coalesce((p_old ->> k.key)::numeric, 0) as delta
      from jsonb_object_keys(p_old || p_new) as k(key)
     order by k.key                     -- deterministic lock order
  loop
    continue when r.delta = 0;

    select p.stock, p.sku into v_stock, v_sku
      from public.product p
     where p.id = r.product_id::uuid
       and p.user_id = p_uid            -- you cannot move someone else's stock
       for update;

    if not found then
      raise exception 'product % not found', r.product_id using errcode = '42501';
    end if;

    -- Only a deduction can fail; crediting stock back always succeeds.
    --
    -- The message is phrased in the numbers the USER is looking at, not the
    -- internal delta. Editing a line from 50 to 250 asks for a delta of 200,
    -- but the user typed 250 and sees 100 in stock — reporting "need 200,
    -- have 100" matches neither figure on their screen. So: what they asked
    -- for (nuevo), against what is actually available to this document
    -- (free stock PLUS whatever this same document already holds).
    if r.delta > 0 and v_stock < r.delta then
      if r.viejo > 0 then
        raise exception
          'existencia insuficiente de %: pides %, disponible % (% en piso + % ya reservados por este documento)',
          v_sku, r.nuevo, v_stock + r.viejo, v_stock, r.viejo
          using errcode = '23514';
      else
        raise exception 'existencia insuficiente de %: pides %, hay % en piso',
          v_sku, r.nuevo, v_stock
          using errcode = '23514';
      end if;
    end if;

    update public.product
       set stock = stock - r.delta
     where id = r.product_id::uuid;
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- create_invoice
-- -----------------------------------------------------------------------------
-- Creates an invoice and its lines in one transaction.
--   p_status 'draft'  -> no stock is touched
--   p_status 'active' -> stock is checked and deducted before returning
--   p_status 'closed' -> same as active, but frozen immediately
--
--   select create_invoice(
--     '<client-uuid>', 'INV-001',
--     '[{"type":"product","product_id":"<uuid>","qty":3,"unit_price":100},
--       {"type":"charge","description":"Delivery","qty":1,"unit_price":120}]',
--     'active'
--   );
create or replace function public.create_invoice(
  p_client_id   uuid,
  p_invoice_num text  default null,
  p_lines       jsonb default '[]'::jsonb,
  p_status      text  default 'draft',
  p_notes       text  default null,
  p_due_date    date  default null,
  -- Datos de embarque, todos opcionales:
  --   {"purchase_order":"00-154","salesperson":"…","consigned_to":"…",
  --    "marks":"…","dispatched":"…","shipped_via":"…"}
  -- Una clave ausente se guarda como NULL y se imprime en blanco.
  p_doc         jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_invoice_id uuid;
  v_num        text;
  v_line       jsonb;
  v_type       text;
  v_product_id uuid;
  v_due        date;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'active', 'closed') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array' using errcode = '22023';
  end if;

  -- Allocate the invoice number if the caller did not supply one.
  --
  -- UPDATE ... RETURNING is what makes this concurrency-safe: it takes a row
  -- lock on the company row that is held until commit, so a second session
  -- asking at the same instant BLOCKS, then reads the already-incremented
  -- value. Two clients can never be handed the same number.
  --
  -- Unlike a Postgres SEQUENCE this is transactional: a rolled-back invoice
  -- releases its number instead of burning it, so the run has no gaps. The
  -- cost is that invoice creation serialises per account, which at ERP volumes
  -- is irrelevant.
  if p_invoice_num is null or trim(p_invoice_num) = '' then
    update public.company
       set next_invoice_num = next_invoice_num + 1
     where user_id = v_uid
    returning invoice_prefix || lpad((next_invoice_num - 1)::text, 5, '0')
      into v_num;

    if v_num is null then
      raise exception 'no company row for this account' using errcode = '42501';
    end if;
  else
    v_num := p_invoice_num;
  end if;

  -- The client must be yours. This filter is doing RLS's job by hand.
  -- client_name is snapshotted off the client row at creation time.
  -- Due date: use what the caller passed, else fall back to the client's
  -- default credit days. Stored on the invoice so later changes to the
  -- client's terms never move an already-issued invoice's due date.
  select coalesce(p_due_date, current_date + c.payment_terms)
    into v_due
    from public.client c
   where c.id = p_client_id and c.user_id = v_uid;

  insert into public.invoice
    (invoice_num, client_id, client_name, user_id, status, notes, due_date,
     purchase_order, salesperson, consigned_to, marks, dispatched, shipped_via)
  select v_num, c.id, c.name, v_uid, p_status, p_notes, v_due,
         nullif(p_doc ->> 'purchase_order', ''),
         nullif(p_doc ->> 'salesperson', ''),
         nullif(p_doc ->> 'consigned_to', ''),
         nullif(p_doc ->> 'marks', ''),
         nullif(p_doc ->> 'dispatched', ''),
         nullif(p_doc ->> 'shipped_via', '')
    from public.client c
   where c.id = p_client_id
     and c.user_id = v_uid
  returning id into v_invoice_id;

  if v_invoice_id is null then
    raise exception 'client % not found', p_client_id using errcode = '42501';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_type       := coalesce(v_line ->> 'type', 'product');
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;

    if v_type = 'product' and not exists (
         select 1 from public.product
          where id = v_product_id and user_id = v_uid) then
      raise exception 'product % not found', v_product_id using errcode = '42501';
    end if;

    insert into public.transaction
      (invoice_id, product_id, description, type, qty, bultos, unit,
       unit_price, user_id)
    values
      (v_invoice_id,
       v_product_id,
       v_line ->> 'description',
       v_type,
       (v_line ->> 'qty')::integer,
       -- bultos/unit are optional and meaningless on a charge line
       case when v_type = 'charge' then null
            else nullif(v_line ->> 'bultos', '')::numeric end,
       case when v_type = 'charge' then null
            else nullif(v_line ->> 'unit', '') end,
       (v_line ->> 'unit_price')::numeric,
       v_uid);
  end loop;

  perform public.recalc_invoice_total(v_invoice_id);
  perform public.recalc_client_balance(p_client_id);

  -- Footprint goes from nothing to whatever this invoice now commits.
  -- For a draft that is {} -> {}, so nothing moves and nothing can fail.
  perform public.apply_stock_delta(
    v_uid,
    '{}'::jsonb,
    public.invoice_footprint(v_invoice_id)
  );

  return v_invoice_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- update_invoice
-- -----------------------------------------------------------------------------
-- Replaces the invoice's lines wholesale. Last write wins on CONTENT — but the
-- stock arithmetic stays exact, which is the part that must never drift.
--
-- Why the invoice row is locked FIRST, before reading the footprint:
--
--   Without it, two concurrent edits of an active invoice both read the SAME
--   old footprint and both apply a delta against it:
--
--     stock 10, invoice has 3 units
--     S1: reads {A:3} -> sets 5 -> delta +2 -> stock 8
--     S2: reads {A:3} -> sets 4 -> delta +1 -> stock 7     <-- stale read
--     invoice says 4, but 6 units were taken. Stock is wrong by 2.
--
--   Locking product rows does NOT fix this: both sessions locked the product
--   happily, one after the other, and each did arithmetic that was correct
--   against the footprint it had. The stale value is the invoice's own lines.
--
--   With the invoice locked up front, S2 blocks until S1 commits and then reads
--   the FRESH footprint {A:5}, so its delta is 5 -> 4 = -1 and stock lands on 9.
--   The invoice's line rows are only ever written by functions holding this
--   lock, so locking the header is enough to serialise its lines too.
create or replace function public.update_invoice(
  p_invoice_id uuid,
  p_lines      jsonb,
  p_notes      text default null,
  p_client_id  uuid default null,
  p_status     text default null,
  p_due_date   date default null,
  -- Igual que en create_invoice. Pasar NULL deja los datos como estaban;
  -- pasar un objeto reemplaza SOLO las claves presentes.
  p_doc        jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_status     text;
  v_old        jsonb;
  v_new        jsonb;
  v_line       jsonb;
  v_type       text;
  v_product_id uuid;
  v_old_client uuid;
  v_new_client uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('draft', 'active', 'closed') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;

  -- (1) serialise every edit of THIS invoice. Must come before the footprint
  --     read, or the read can be stale. See the note above.
  select i.status into v_status
    from public.invoice i
   where i.id = p_invoice_id
     and i.user_id = v_uid
     for update;

  if not found then
    raise exception 'invoice % not found', p_invoice_id using errcode = '42501';
  end if;
  if v_status = 'closed' then
    raise exception 'invoice is closed and cannot be edited' using errcode = '22023';
  end if;

  -- Remember which client this invoice belonged to. If p_client_id moves it to
  -- a different one, BOTH balances change and both must be recalculated.
  select client_id into v_old_client from public.invoice where id = p_invoice_id;

  -- (2) footprint BEFORE anything changes. This MUST be read before the status
  --     update below: the old footprint has to describe the invoice as it was.
  --     Reading it after a draft -> active switch would report the OLD line
  --     quantities as already-reserved and under-deduct by exactly that amount.
  v_old := public.invoice_footprint(p_invoice_id);

  -- notes: NULL leaves them as they are, '' clears them
  if p_notes is not null then
    update public.invoice set notes = nullif(p_notes, '') where id = p_invoice_id;
  end if;

  if p_due_date is not null then
    update public.invoice set due_date = p_due_date where id = p_invoice_id;
  end if;

  -- coalesce por clave: lo que no venga en p_doc se queda como está, así que
  -- un formulario parcial nunca borra datos que no mostraba.
  if p_doc is not null then
    update public.invoice
       set purchase_order = coalesce(nullif(p_doc ->> 'purchase_order', ''), purchase_order),
           salesperson    = coalesce(nullif(p_doc ->> 'salesperson', ''),    salesperson),
           consigned_to   = coalesce(nullif(p_doc ->> 'consigned_to', ''),   consigned_to),
           marks          = coalesce(nullif(p_doc ->> 'marks', ''),          marks),
           dispatched     = coalesce(nullif(p_doc ->> 'dispatched', ''),     dispatched),
           shipped_via    = coalesce(nullif(p_doc ->> 'shipped_via', ''),    shipped_via)
     where id = p_invoice_id;
  end if;

  -- Re-point at a different client, re-snapshotting client_name with it.
  if p_client_id is not null then
    update public.invoice i
       set client_id = c.id, client_name = c.name
      from public.client c
     where i.id = p_invoice_id
       and c.id = p_client_id
       and c.user_id = v_uid;
    if not found then
      raise exception 'client % not found', p_client_id using errcode = '42501';
    end if;
  end if;

  -- The status change lands here, AFTER v_old was captured, so one single
  -- delta covers the status move and the line edits together: editing 3 -> 10
  -- units while going draft -> active deducts 10 (nothing was reserved before),
  -- not 7.
  if p_status is not null then
    update public.invoice set status = p_status where id = p_invoice_id;
  end if;

  -- (3) replace the lines
  delete from public.transaction where invoice_id = p_invoice_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_type       := coalesce(v_line ->> 'type', 'product');
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;

    if v_type = 'product' and not exists (
         select 1 from public.product
          where id = v_product_id and user_id = v_uid) then
      raise exception 'product % not found', v_product_id using errcode = '42501';
    end if;

    insert into public.transaction
      (invoice_id, product_id, description, type, qty, bultos, unit,
       unit_price, user_id)
    values
      (p_invoice_id,
       v_product_id,
       v_line ->> 'description',
       v_type,
       (v_line ->> 'qty')::integer,
       case when v_type = 'charge' then null
            else nullif(v_line ->> 'bultos', '')::numeric end,
       case when v_type = 'charge' then null
            else nullif(v_line ->> 'unit', '') end,
       (v_line ->> 'unit_price')::numeric,
       v_uid);
  end loop;

  perform public.recalc_invoice_total(p_invoice_id);

  -- Recalculate the balance of whoever owns the invoice now, plus the previous
  -- owner if it was moved between clients.
  select client_id into v_new_client from public.invoice where id = p_invoice_id;
  perform public.recalc_client_balance(v_new_client);
  if v_old_client is distinct from v_new_client then
    perform public.recalc_client_balance(v_old_client);
  end if;

  -- (4) footprint AFTER, and move stock by the difference.
  --     Increases are checked against available stock; decreases are credited
  --     back unconditionally. A draft goes {} -> {}, so nothing moves.
  v_new := public.invoice_footprint(p_invoice_id);
  perform public.apply_stock_delta(v_uid, v_old, v_new);
end;
$$;


-- -----------------------------------------------------------------------------
-- set_invoice_status
-- -----------------------------------------------------------------------------
-- Moves an invoice between statuses and lets the footprint engine work out the
-- stock consequence. Because invoice_footprint() already returns {} for a draft
-- and the real quantities for active/closed, EVERY transition is just
-- "footprint before -> footprint after":
--
--     draft  -> active   {} -> {A:3}     deduct 3   (checked against stock)
--     draft  -> closed   {} -> {A:3}     deduct 3
--     active -> draft    {A:3} -> {}     credit 3 back
--     active -> closed   {A:3} -> {A:3}  delta 0, nothing moves
--     closed -> anything                 refused, a closed invoice is frozen
--
-- No transition arithmetic is written by hand, so none of it can disagree with
-- create_invoice or update_invoice.
create or replace function public.set_invoice_status(
  p_invoice_id uuid,
  p_status     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old_status text;
  v_old jsonb;
  v_new jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'active', 'closed') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;

  -- lock first, so a concurrent status change or edit cannot leave us reading
  -- a stale footprint (same reasoning as update_invoice)
  select i.status into v_old_status
    from public.invoice i
   where i.id = p_invoice_id
     and i.user_id = v_uid
     for update;

  if not found then
    raise exception 'invoice % not found', p_invoice_id using errcode = '42501';
  end if;
  if v_old_status = 'closed' then
    raise exception 'invoice is closed and cannot change status'
      using errcode = '22023';
  end if;

  v_old := public.invoice_footprint(p_invoice_id);
  update public.invoice set status = p_status where id = p_invoice_id;
  v_new := public.invoice_footprint(p_invoice_id);

  -- a draft owes nothing, active/closed do — so any status move shifts balance
  perform public.recalc_client_balance(
    (select client_id from public.invoice where id = p_invoice_id));

  perform public.apply_stock_delta(v_uid, v_old, v_new);
end;
$$;


-- -----------------------------------------------------------------------------
-- delete_invoice
-- -----------------------------------------------------------------------------
-- draft  -> just deleted, nothing to give back (a draft reserved nothing)
-- active -> stock credited back, then deleted
-- closed -> refused
--
-- The transaction lines go with it via ON DELETE CASCADE.
create or replace function public.delete_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_client uuid;
  v_old    jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select i.status into v_status
    from public.invoice i
   where i.id = p_invoice_id
     and i.user_id = v_uid
     for update;

  if not found then
    raise exception 'invoice % not found', p_invoice_id using errcode = '42501';
  end if;
  if v_status = 'closed' then
    raise exception 'invoice is closed and cannot be deleted' using errcode = '22023';
  end if;

  -- read the footprint AND the client BEFORE the row disappears
  v_old := public.invoice_footprint(p_invoice_id);
  select client_id into v_client from public.invoice where id = p_invoice_id;

  delete from public.invoice where id = p_invoice_id;

  perform public.recalc_client_balance(v_client);

  -- footprint -> {} : credits back an active invoice, no-op for a draft
  perform public.apply_stock_delta(v_uid, v_old, '{}'::jsonb);
end;
$$;


-- =============================================================================
-- ACCOUNT BOOTSTRAP — the company row
-- =============================================================================
-- company is the user's profile: exactly one row, created at signup, destroyed
-- with the account. policy.sql grants NO insert and NO delete policy on it, so
-- this trigger is the only thing that can ever create one.
--
-- SECURITY DEFINER is mandatory here on two counts: it writes public.company
-- (which has no insert policy at all), and it runs during signup where there is
-- no request context.
--
-- Note it passes new.id explicitly rather than letting the column default fire:
-- company.user_id defaults to auth.uid(), but inside this trigger auth.uid() is
-- NULL — there is no JWT during a signup — so the default would violate NOT NULL.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company (user_id, name, email)
  values (
    new.id,
    -- company.name is NOT NULL, so always land on something
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'company_name'), ''),
      'My Company'
    ),
    new.email
  )
  on conflict (user_id) do nothing;   -- idempotent, uses company_user_id_key
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before this trigger existed. Idempotent, so it
-- is safe to leave here and re-run whenever this file is applied.
insert into public.company (user_id, name, email)
select u.id,
       coalesce(nullif(trim(u.raw_user_meta_data ->> 'company_name'), ''), 'My Company'),
       u.email
  from auth.users u
 where not exists (select 1 from public.company c where c.user_id = u.id);


-- =============================================================================
-- DERIVED COLUMNS — triggers, not RPCs
-- =============================================================================
-- invoice.total and client.balance are DERIVATIONS: there is exactly one right
-- answer given the rows underneath. Triggers, because they fire no matter which
-- path wrote the row, so the value cannot drift. RPCs are for DECISIONS (is
-- there enough stock? may this be closed?), which is why stock is not done here.
--
-- All SECURITY DEFINER: policy.sql revoked update(balance) from authenticated,
-- so an invoker trigger would fail with "permission denied for table client".
--
-- The chain is: transaction -> invoice.total -> client.balance
--                              payments ------^

-- invoice.total = sum of its lines (products AND charges AND miscellaneous) ----
-- A plain function, NOT a trigger. transaction has no write policy, so the only
-- way a line can change is through create_invoice/update_invoice — the two
-- places that call this. A FOR EACH ROW trigger would also re-sum the whole
-- invoice once per line, which is quadratic work on a long invoice.
--
-- The UPDATE here fires invoice_recalc_balance, so the chain still reaches
-- client.balance: lines -> invoice.total -> client.balance.
create or replace function public.recalc_invoice_total(p_invoice_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.invoice i
     set total = coalesce((
           select sum(t.qty * t.unit_price)
             from public.transaction t
            where t.invoice_id = i.id), 0)
   where i.id = p_invoice_id;
$$;


-- client.balance = issued invoices - payments ---------------------------------
-- Draft invoices are excluded: nothing is owed until the invoice is issued.
create or replace function public.recalc_client_balance(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lock the client row BEFORE summing.
  --
  -- Without it, two sessions (say one recording a payment and one issuing an
  -- invoice for the same client) can both read the same set of rows, each
  -- compute a balance that ignores the other, and the later write wins — the
  -- same stale-read shape as the invoice footprint bug.
  --
  -- Postgres is READ COMMITTED here, so every statement takes a fresh snapshot:
  -- once this lock is granted the second session's UPDATE below sees the first
  -- session's committed invoice/payment rows and sums them correctly.
  perform 1 from public.client where id = p_client_id for update;

  update public.client c
     set balance =
           coalesce((select sum(i.total) from public.invoice i
                      where i.client_id = c.id
                        and i.status in ('active','closed')), 0)
         - coalesce((select sum(p.amount) from public.payments p
                      where p.client_id = c.id), 0)
   where c.id = p_client_id;
end;
$$;

-- NOTE: because this is called explicitly rather than by a trigger, any NEW
-- code path that changes an invoice's total, its status, its client, or any
-- payment MUST call it. The seven current callers are listed above.


-- =============================================================================
-- reopen_invoice
-- =============================================================================
-- closed -> active. Deliberately a SEPARATE function rather than a transition
-- allowed inside set_invoice_status, so that "closed is frozen" stays true of
-- the normal status call and reopening is an explicit, auditable act.
--
-- Stock does not move: a closed invoice and an active one have the SAME
-- footprint, so the delta is zero. It still goes through apply_stock_delta so
-- there is no second code path that could ever disagree.
create or replace function public.reopen_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_old    jsonb;
  v_new    jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select i.status into v_status
    from public.invoice i
   where i.id = p_invoice_id
     and i.user_id = v_uid
     for update;

  if not found then
    raise exception 'invoice % not found', p_invoice_id using errcode = '42501';
  end if;
  if v_status <> 'closed' then
    raise exception 'invoice is %; only a closed invoice can be reopened', v_status
      using errcode = '22023';
  end if;

  v_old := public.invoice_footprint(p_invoice_id);
  update public.invoice set status = 'active' where id = p_invoice_id;
  v_new := public.invoice_footprint(p_invoice_id);

  -- closed and active both count toward the balance, so this is a no-op today.
  -- Called anyway so every status-changing RPC looks the same.
  perform public.recalc_client_balance(
    (select client_id from public.invoice where id = p_invoice_id));

  perform public.apply_stock_delta(v_uid, v_old, v_new);
end;
$$;


-- =============================================================================
-- PAYMENTS — read-only table, so these RPCs are the only write path
-- =============================================================================
-- client.balance is NOT written here. The payments_recalc_balance trigger
-- handles it, so the balance stays right even if one of these is later changed.

create or replace function public.create_payment(
  p_client_id      uuid,
  p_amount         numeric,
  p_payment_method text default 'bank_transfer',
  p_invoice_id     uuid default null,
  p_notes          text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive' using errcode = '22023';
  end if;
  if not exists (select 1 from public.client
                  where id = p_client_id and user_id = v_uid) then
    raise exception 'client % not found', p_client_id using errcode = '42501';
  end if;
  -- if an invoice is named it must be yours AND belong to this client
  if p_invoice_id is not null and not exists (
       select 1 from public.invoice
        where id = p_invoice_id and user_id = v_uid and client_id = p_client_id) then
    raise exception 'invoice % does not belong to client %', p_invoice_id, p_client_id
      using errcode = '42501';
  end if;

  insert into public.payments
    (amount, payment_method, client_id, invoice_id, notes, user_id)
  values
    (p_amount, p_payment_method, p_client_id, p_invoice_id, p_notes, v_uid)
  returning id into v_id;

  perform public.recalc_client_balance(p_client_id);

  return v_id;
end;
$$;


create or replace function public.update_payment(
  p_payment_id     uuid,
  p_amount         numeric,
  p_payment_method text default null,
  p_invoice_id     uuid default null,
  p_notes          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_client_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive' using errcode = '22023';
  end if;

  select client_id into v_client_id
    from public.payments
   where id = p_payment_id and user_id = v_uid
     for update;

  if not found then
    raise exception 'payment % not found', p_payment_id using errcode = '42501';
  end if;
  if p_invoice_id is not null and not exists (
       select 1 from public.invoice
        where id = p_invoice_id and user_id = v_uid and client_id = v_client_id) then
    raise exception 'invoice % does not belong to this payment''s client', p_invoice_id
      using errcode = '42501';
  end if;

  update public.payments
     set amount         = p_amount,
         payment_method = coalesce(p_payment_method, payment_method),
         invoice_id     = p_invoice_id,
         -- NULL leaves notes as they are, '' clears them
         notes          = case when p_notes is null then notes
                               else nullif(p_notes, '') end
   where id = p_payment_id;

  perform public.recalc_client_balance(v_client_id);
end;
$$;


create or replace function public.delete_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_client uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  delete from public.payments
   where id = p_payment_id and user_id = v_uid
  returning client_id into v_client;

  if v_client is null then
    raise exception 'payment % not found', p_payment_id using errcode = '42501';
  end if;

  perform public.recalc_client_balance(v_client);
end;
$$;


-- =============================================================================
-- PURCHASES — add and edit only, NEVER delete
-- =============================================================================
--
--   'active'  goods not yet received. NO stock footprint, so the lines can be
--             edited freely with no reconciliation at all.
--   'closed'  received. Stock is added ONCE, at closing, then frozen.
--
-- This is why there is no update-time stock arithmetic here and no
-- delete_purchase: an active purchase has nothing committed to undo, and a
-- closed one is immutable. Fix mistakes before closing.

-- purchase.total = sum of its entry lines (products AND charges) --------------
-- Same reasoning as recalc_invoice_total: entry has no write policy, so
-- create_purchase and update_purchase are the only writers, and they call this.
create or replace function public.recalc_purchase_total(p_purchase_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.purchase p
     set total = coalesce((
           select sum(e.qty_unit * e.cost_unit)
             from public.entry e
            where e.purchase_id = p.id), 0)
   where p.id = p_purchase_id;
$$;


-- purchase_footprint (internal) -----------------------------------------------
-- NOTE THE MINUS SIGN. A footprint means "stock consumed", so an invoice's is
-- positive (goods leaving) and a purchase's is NEGATIVE (goods arriving).
-- apply_stock_delta then does `stock = stock - delta`, and subtracting a
-- negative adds — which lets purchases reuse the invoice engine untouched,
-- including its FOR UPDATE locking and deterministic lock ordering.
-- Its "insufficient stock" check only fires on a positive delta, so receiving
-- goods can never fail for lack of stock, which is correct.
--
-- Returns {} while the purchase is 'active' — nothing has arrived yet.
create or replace function public.purchase_footprint(p_purchase_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.product_id::text, s.qty), '{}'::jsonb)
    from (
      select e.product_id, -sum(e.qty_unit)::numeric as qty
        from public.entry e
        join public.purchase p on p.id = e.purchase_id
       where e.purchase_id = p_purchase_id
         and e.type = 'product'
         and p.status = 'closed'
       group by e.product_id
    ) s;
$$;


-- create_purchase -------------------------------------------------------------
-- Always starts 'active'. Touches no stock.
--   p_lines: [{"type":"product","product_id":"<uuid>","qty_unit":100,"cost_unit":5.50},
--             {"type":"charge","description":"Ocean freight","qty_unit":1,"cost_unit":850}]
create or replace function public.create_purchase(
  p_entry_no         text,
  p_provider         text    default null,
  p_origin           text    default null,
  p_net_weight_kgs   numeric default null,
  p_gross_weight_kgs numeric default null,
  p_cbm              numeric default null,
  p_lines            jsonb   default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_purchase_id uuid;
  v_line        jsonb;
  v_type        text;
  v_product_id  uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array' using errcode = '22023';
  end if;

  insert into public.purchase
    (entry_no, provider, origin, net_weight_kgs, gross_weight_kgs, cbm, status, user_id)
  values
    (p_entry_no, p_provider, p_origin, p_net_weight_kgs, p_gross_weight_kgs, p_cbm,
     'active', v_uid)
  returning id into v_purchase_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_type       := coalesce(v_line ->> 'type', 'product');
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;

    if v_type = 'product' and not exists (
         select 1 from public.product
          where id = v_product_id and user_id = v_uid) then
      raise exception 'product % not found', v_product_id using errcode = '42501';
    end if;

    insert into public.entry
      (purchase_id, product_id, description, type, qty_unit, cost_unit, user_id)
    values
      (v_purchase_id,
       v_product_id,
       v_line ->> 'description',
       v_type,
       (v_line ->> 'qty_unit')::integer,
       (v_line ->> 'cost_unit')::numeric,
       v_uid);
  end loop;

  perform public.recalc_purchase_total(v_purchase_id);

  return v_purchase_id;
end;
$$;


-- update_purchase -------------------------------------------------------------
-- Editable only while 'active'. No stock reconciliation is needed or performed,
-- because an active purchase has an empty footprint both before and after.
-- Header args are COALESCEd: pass NULL to leave a field as it is.
-- Pass p_lines = NULL to leave the lines alone; pass an array to replace them.
create or replace function public.update_purchase(
  p_purchase_id      uuid,
  p_entry_no         text    default null,
  p_provider         text    default null,
  p_origin           text    default null,
  p_net_weight_kgs   numeric default null,
  p_gross_weight_kgs numeric default null,
  p_cbm              numeric default null,
  p_lines            jsonb   default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_status     text;
  v_line       jsonb;
  v_type       text;
  v_product_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select p.status into v_status
    from public.purchase p
   where p.id = p_purchase_id
     and p.user_id = v_uid
     for update;

  if not found then
    raise exception 'purchase % not found', p_purchase_id using errcode = '42501';
  end if;
  if v_status = 'closed' then
    raise exception 'purchase is closed and cannot be edited' using errcode = '22023';
  end if;

  update public.purchase
     set entry_no         = coalesce(p_entry_no, entry_no),
         provider         = coalesce(p_provider, provider),
         origin           = coalesce(p_origin, origin),
         net_weight_kgs   = coalesce(p_net_weight_kgs, net_weight_kgs),
         gross_weight_kgs = coalesce(p_gross_weight_kgs, gross_weight_kgs),
         cbm              = coalesce(p_cbm, cbm)
   where id = p_purchase_id;

  if p_lines is null then
    return;                       -- header-only edit
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array' using errcode = '22023';
  end if;

  delete from public.entry where purchase_id = p_purchase_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_type       := coalesce(v_line ->> 'type', 'product');
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;

    if v_type = 'product' and not exists (
         select 1 from public.product
          where id = v_product_id and user_id = v_uid) then
      raise exception 'product % not found', v_product_id using errcode = '42501';
    end if;

    insert into public.entry
      (purchase_id, product_id, description, type, qty_unit, cost_unit, user_id)
    values
      (p_purchase_id,
       v_product_id,
       v_line ->> 'description',
       v_type,
       (v_line ->> 'qty_unit')::integer,
       (v_line ->> 'cost_unit')::numeric,
       v_uid);
  end loop;

  perform public.recalc_purchase_total(p_purchase_id);
end;
$$;


-- close_purchase --------------------------------------------------------------
-- active -> closed. The goods have arrived: stock goes up ONCE, here, and the
-- purchase is frozen afterwards. There is no reopen — a closed purchase has
-- already moved stock that invoices may since have consumed.
create or replace function public.close_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_old    jsonb;
  v_new    jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select p.status into v_status
    from public.purchase p
   where p.id = p_purchase_id
     and p.user_id = v_uid
     for update;

  if not found then
    raise exception 'purchase % not found', p_purchase_id using errcode = '42501';
  end if;
  if v_status = 'closed' then
    raise exception 'purchase is already closed' using errcode = '22023';
  end if;

  v_old := public.purchase_footprint(p_purchase_id);   -- {} while active
  update public.purchase set status = 'closed' where id = p_purchase_id;
  v_new := public.purchase_footprint(p_purchase_id);   -- negative quantities

  perform public.apply_stock_delta(v_uid, v_old, v_new);
end;
$$;


-- =============================================================================
-- ADJUSTMENTS — append-only manual stock correction
-- =============================================================================
-- The only way to move stock without an invoice or a purchase behind it:
-- stock counts, breakage, samples, corrections.
--
-- There is no update_adjustment and no delete_adjustment, and policy.sql grants
-- no update/delete policy — so an adjustment, once posted, is permanent. To
-- correct one, post the opposite. That keeps a complete audit trail of how
-- stock arrived at its current number, which is the whole point of the module.
--
-- "cannot go below 0" needs no code here: a 'remove' becomes a positive delta,
-- and apply_stock_delta already refuses any deduction larger than the stock on
-- hand — with the row locked, so two simultaneous removals cannot both pass.
create or replace function public.create_adjustment(
  p_product_id  uuid,
  p_type        text,
  p_qty         integer,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_delta numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_type not in ('add', 'remove') then
    raise exception 'type must be add or remove, got %', p_type using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty must be a positive number' using errcode = '22023';
  end if;
  if not exists (select 1 from public.product
                  where id = p_product_id and user_id = v_uid) then
    raise exception 'product % not found', p_product_id using errcode = '42501';
  end if;

  -- a footprint is "stock consumed": removing consumes, adding consumes negative
  v_delta := case p_type when 'remove' then p_qty else -p_qty end;

  insert into public.adjustment (product_id, type, qty, description, user_id)
  values (p_product_id, p_type, p_qty, p_description, v_uid)
  returning id into v_id;

  perform public.apply_stock_delta(
    v_uid,
    '{}'::jsonb,
    jsonb_build_object(p_product_id::text, v_delta)
  );

  return v_id;
end;
$$;


-- =============================================================================
-- stock_movement — the unified inventory ledger (a VIEW, not a table)
-- =============================================================================
-- product.stock is moved by three subsystems: invoices (out), closed purchases
-- (in), and adjustments (either). This answers "why is this SKU at 8?" in one
-- query instead of three.
--
-- A VIEW rather than a physical ledger table, deliberately: it is pure
-- derivation, so it cannot drift out of sync with the rows it summarises. A
-- duplicated table would need writing from every RPC and would eventually
-- disagree with reality.
--
-- ---------------------------------------------------------------------------
-- security_invoker = true IS LOAD BEARING. DO NOT REMOVE IT.
-- ---------------------------------------------------------------------------
-- By default a Postgres view runs with its OWNER's privileges — postgres, who
-- owns these tables and is therefore EXEMPT from their RLS. A plain
-- `create view` here would show every tenant's stock movements to every user.
-- With security_invoker the underlying tables' RLS is evaluated as the CALLER,
-- so the existing `user_id = auth.uid()` select policies scope it automatically
-- and it stays correct if those policies ever change.
--
-- qty_delta is signed the way stock moves: positive = in, negative = out.
create or replace view public.stock_movement
with (security_invoker = true)
as
  -- OUT: product lines on issued invoices (drafts reserve nothing)
  select t.id            as id,
         t.user_id       as user_id,
         t.product_id    as product_id,
         'invoice'       as source,
         i.id            as source_id,
         i.invoice_num   as reference,
         i.client_name   as counterparty,
         -t.qty          as qty_delta,
         t.description   as description,
         i.date_created  as occurred_at
    from public.transaction t
    join public.invoice i on i.id = t.invoice_id
   where t.type = 'product'
     and i.status in ('active', 'closed')

  union all

  -- IN: product lines on closed purchases (active ones have not arrived)
  select e.id,
         e.user_id,
         e.product_id,
         'purchase',
         p.id,
         p.entry_no,
         p.provider,
         e.qty_unit,
         e.description,
         p.date_created
    from public.entry e
    join public.purchase p on p.id = e.purchase_id
   where e.type = 'product'
     and p.status = 'closed'

  union all

  -- EITHER: manual corrections
  select a.id,
         a.user_id,
         a.product_id,
         'adjustment',
         a.id,
         null,
         null,
         case a.type when 'add' then a.qty else -a.qty end,
         a.description,
         a.date_created
    from public.adjustment a;

comment on view public.stock_movement is
  'Unified inventory ledger across invoices, closed purchases and adjustments. qty_delta: positive = stock in, negative = stock out. Ordering is not guaranteed — add ORDER BY occurred_at DESC when querying.';

grant select on public.stock_movement to authenticated;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- Supabase grants EXECUTE on public functions to anon by default. The internals
-- are revoked from everyone — they must only ever be reached from another
-- function, never called directly as an RPC.

revoke execute on function public.invoice_footprint(uuid)                from public, anon, authenticated;
revoke execute on function public.apply_stock_delta(uuid, jsonb, jsonb)  from public, anon, authenticated;

revoke execute on function public.create_invoice(uuid, text, jsonb, text, text, date, jsonb) from public, anon;
grant  execute on function public.create_invoice(uuid, text, jsonb, text, text, date, jsonb) to authenticated;

revoke execute on function public.update_invoice(uuid, jsonb, text, uuid, text, date, jsonb) from public, anon;
grant  execute on function public.update_invoice(uuid, jsonb, text, uuid, text, date, jsonb) to authenticated;

revoke execute on function public.set_invoice_status(uuid, text) from public, anon;
grant  execute on function public.set_invoice_status(uuid, text) to authenticated;

revoke execute on function public.delete_invoice(uuid) from public, anon;
grant  execute on function public.delete_invoice(uuid) to authenticated;

revoke execute on function public.reopen_invoice(uuid) from public, anon;
grant  execute on function public.reopen_invoice(uuid) to authenticated;

revoke execute on function public.create_payment(uuid, numeric, text, uuid, text) from public, anon;
grant  execute on function public.create_payment(uuid, numeric, text, uuid, text) to authenticated;

revoke execute on function public.update_payment(uuid, numeric, text, uuid, text) from public, anon;
grant  execute on function public.update_payment(uuid, numeric, text, uuid, text) to authenticated;

revoke execute on function public.delete_payment(uuid) from public, anon;
grant  execute on function public.delete_payment(uuid) to authenticated;

revoke execute on function public.create_purchase(text, text, text, numeric, numeric, numeric, jsonb) from public, anon;
grant  execute on function public.create_purchase(text, text, text, numeric, numeric, numeric, jsonb) to authenticated;

revoke execute on function public.update_purchase(uuid, text, text, text, numeric, numeric, numeric, jsonb) from public, anon;
grant  execute on function public.update_purchase(uuid, text, text, text, numeric, numeric, numeric, jsonb) to authenticated;

revoke execute on function public.close_purchase(uuid) from public, anon;
grant  execute on function public.close_purchase(uuid) to authenticated;

revoke execute on function public.create_adjustment(uuid, text, integer, text) from public, anon;
grant  execute on function public.create_adjustment(uuid, text, integer, text) to authenticated;

-- Trigger functions and internal helpers: never callable as an RPC.
revoke execute on function public.purchase_footprint(uuid)      from public, anon, authenticated;
revoke execute on function public.recalc_invoice_total(uuid)    from public, anon, authenticated;
revoke execute on function public.recalc_purchase_total(uuid)   from public, anon, authenticated;
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.recalc_client_balance(uuid) from public, anon, authenticated;
