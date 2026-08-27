-- =============================================================================
-- ERP_ZL — Row Level Security policies
-- Run after schema.sql, before functions.sql
-- =============================================================================
--
-- Per-table permissions, as specified:
--
--   company      read, edit.  NO create (happens once at signup), NO delete
--                (happens only when the account is deleted, via cascade).
--   client       full CRUD, except: balance is untouchable and starts at 0;
--                delete only when balance = 0.
--   product      full CRUD, except: stock is untouchable; delete only when
--                stock = 0.
--   payments     read only  -> writes via RPC, so client.balance stays correct
--   invoice      read only  -> writes via RPC (stock must be checked/locked)
--   transaction  read only  -> writes via RPC
--   purchase     read only  -> writes via RPC. Add and edit only, NEVER delete.
--   entry        read only  -> writes via RPC
--   adjustment   read only  -> insert via RPC. APPEND ONLY: no update, no
--                delete, ever. Correct a mistake with an opposite adjustment.
--
-- RLS denies by default, so for the read-only tables the ABSENCE of an
-- insert/update/delete policy is the lock. SECURITY DEFINER functions bypass
-- RLS entirely, which is how the RPCs still get in.
--
-- Notes:
--   * Every policy is scoped `to authenticated`, so the anon key gets nothing.
--   * auth.uid() is wrapped as (select auth.uid()) deliberately: Postgres then
--     evaluates it ONCE as an InitPlan instead of once per row.
--   * UPDATE policies carry both USING and WITH CHECK. USING picks which rows
--     you may target; WITH CHECK validates the row AFTER the change. Without
--     the WITH CHECK a user could hand a row to someone else by updating
--     user_id — it would pass USING on the way in and be gone forever.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- company — read + edit only
-- -----------------------------------------------------------------------------
create policy company_select on public.company
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy company_update on public.company
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No insert policy: the row is created by the on_auth_user_created trigger at
-- signup. No delete policy: it dies with the account, via ON DELETE CASCADE.


-- -----------------------------------------------------------------------------
-- client — full CRUD, delete gated on balance
-- -----------------------------------------------------------------------------
create policy client_select on public.client
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy client_insert on public.client
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy client_update on public.client
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A client who still owes (or is owed) money cannot be removed. Note this is
-- belt AND braces: invoice.client_id and payments.client_id are ON DELETE
-- RESTRICT, so a client with any history is blocked regardless of balance.
-- In practice this policy is what lets you delete a client created by mistake.
create policy client_delete on public.client
  for delete to authenticated
  using (user_id = (select auth.uid()) and balance = 0);


-- -----------------------------------------------------------------------------
-- product — full CRUD, delete gated on stock
-- -----------------------------------------------------------------------------
create policy product_select on public.product
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy product_insert on public.product
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy product_update on public.product
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Same shape as client: stock must be zero, and transaction/entry FKs are
-- ON DELETE RESTRICT so anything with history is blocked anyway.
create policy product_delete on public.product
  for delete to authenticated
  using (user_id = (select auth.uid()) and stock = 0);


-- -----------------------------------------------------------------------------
-- Read-only tables — every write goes through an RPC
-- -----------------------------------------------------------------------------
create policy payments_select on public.payments
  for select to authenticated
  using (user_id = (select auth.uid()));


create policy invoice_select on public.invoice
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy transaction_select on public.transaction
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy purchase_select on public.purchase
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy entry_select on public.entry
  for select to authenticated
  using (user_id = (select auth.uid()));

-- adjustment is APPEND ONLY. Select here, insert via create_adjustment(), and
-- deliberately NO update or delete policy — that absence is what makes the
-- stock history immutable. Correct a mistake by posting an opposite adjustment.
create policy adjustment_select on public.adjustment
  for select to authenticated
  using (user_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- Column-level locks
-- -----------------------------------------------------------------------------
-- client.balance and product.stock are DERIVED. The tables above allow UPDATE
-- so users can fix a name or a SKU — but RLS is row-level, it cannot say
-- "every column except this one". Column privileges can.
--
-- IMPORTANT: `revoke update (balance)` on its own does NOTHING here. Supabase
-- grants table-wide UPDATE to authenticated by default, and a column-level
-- revoke cannot punch a hole in a table-level grant. You must drop the whole
-- table grant, then re-grant the columns you want, one by one.

-- company.next_invoice_num is a COUNTER, owned by create_invoice(). If a user
-- could set it backwards they would start colliding with numbers already used
-- (the unique index would reject them, but with a baffling error). The prefix
-- IS editable — that is a legitimate company setting.
revoke update on public.company from authenticated;
grant  update (name, contact, website, email, logo_url, invoice_prefix)
   on public.company to authenticated;

revoke insert, update on public.client from authenticated;
grant  insert (name, email, contact, identifier, client_type, payment_terms, user_id)
   on public.client to authenticated;
grant  update (name, email, contact, identifier, client_type, payment_terms)
   on public.client to authenticated;

revoke insert, update on public.product from authenticated;
grant  insert (sku, description, unit, qty_unit, weight_kg, cbm,
               cost_price, sale_price, user_id)
   on public.product to authenticated;
grant  update (sku, description, unit, qty_unit, weight_kg, cbm,
               cost_price, sale_price)
   on public.product to authenticated;

-- balance and stock are NOT NULL DEFAULT 0, so inserts still succeed — the
-- columns just take their default, which is exactly "start at 0".
--
-- user_id is grantable on INSERT because RLS still guards it: the WITH CHECK
-- rejects any value other than your own uid. It is deliberately NOT grantable
-- on UPDATE, so a row can never be handed to another user.
