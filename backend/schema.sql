-- =============================================================================
-- ERP_ZL — Freezone ERP schema (Supabase / PostgreSQL)
-- 1. schema.sql  <- here   2. policies.sql   3. functions.sql
-- =============================================================================
-- Your diagram, kept as-is. Only three things had to change for Supabase:
--   * `user` is gone — auth.users IS the user table. No profile mirror:
--     `company` is the profile here, one row per auth user.
--   * BIGSERIAL -> uuid, as you chose.
--   * transaction gets invoice_id, entry gets product_id (your draft pointed
--     `sku` at product.id, which mixed the two keys).
-- =============================================================================


-- company (the user's profile) ------------------------------------------------
create table public.company (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  contact   text,
  website   text,
  email     text,
  logo_url  text,

  -- Cabecera de los documentos impresos. Todos opcionales: una cuenta puede
  -- operar sin ellos y las facturas simplemente salen con ese renglón en blanco.
  tax_id    text,           -- RUC / identificación fiscal
  address   text,           -- domicilio; los saltos de línea se imprimen tal cual

  -- Invoice numbering lives here rather than in a Postgres SEQUENCE so each
  -- account gets its own clean run of numbers with no gaps. create_invoice()
  -- bumps the counter with UPDATE ... RETURNING, which takes a row lock held
  -- until commit — so two people clicking "New Invoice" at the same moment
  -- cannot be handed the same number.
  invoice_prefix   text    not null default 'INV-',
  next_invoice_num integer not null default 1 check (next_invoice_num > 0),

  user_id   uuid not null default auth.uid()
              references auth.users (id) on delete cascade
);

-- unique: company is the profile, so one per auth user
create unique index company_user_id_key on public.company (user_id);


-- client ----------------------------------------------------------------------
create table public.client (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text,
  contact      text,
  identifier   text,
  client_type  text,
  -- Default credit days for this client (0 = cash). Copied onto an invoice as
  -- its due_date when one is raised; the invoice keeps its own copy so
  -- changing a client's terms never moves an existing invoice's due date.
  payment_terms integer not null default 0 check (payment_terms >= 0),
  -- Para la cabecera de la factura impresa. Opcionales.
  address      text,
  country      text,
  balance      numeric(12,2) not null default 0,
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade
);

create index client_user_id_idx on public.client (user_id);


-- product ---------------------------------------------------------------------
create table public.product (
  id           uuid primary key default gen_random_uuid(),
  sku          text not null,
  description  text,
  unit         text,
  qty_unit     integer,
  stock        integer not null default 0,
  -- POR BULTO, no por pieza: así se pesa y se cubica la mercancía en la
  -- práctica, y así los suma el packing list (bultos x peso, no piezas x peso).
  weight_kg    numeric(12,3),   -- numeric, not float: money/weights must not drift
  cbm          numeric(12,4),   -- was INT; volume is fractional
  -- Reference prices. Nullable: a product can exist before it is priced.
  -- These only PREFILL the forms — the price actually charged is stored per
  -- line in transaction.unit_price, so changing a list price never rewrites
  -- the history of what a customer was already billed.
  cost_price   numeric(12,2) check (cost_price >= 0),
  sale_price   numeric(12,2) check (sale_price >= 0),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade
);

create index product_user_id_idx on public.product (user_id);
create unique index product_user_sku_key on public.product (user_id, sku);


-- invoice ---------------------------------------------------------------------
create table public.invoice (
  id            uuid primary key default gen_random_uuid(),
  invoice_num   text not null,
  date_created  timestamptz not null default now(),
  total         numeric(12,2) not null default 0,
  -- 'draft'  editable, no stock effect
  -- 'active' issued: deducts stock, still editable
  -- 'closed' settled and frozen: no further edits (enforced in policies.sql)
  status        text not null default 'draft'
                  check (status in ('draft', 'active', 'closed')),
  client_id     uuid not null references public.client (id) on delete restrict,
  client_name   text,
  -- When payment is due. Null = cash / due on receipt. Set from the client's
  -- payment_terms at creation, but stored per invoice so it stays put.
  due_date      date,
  notes         text,

  -- Datos de embarque que aparecen en la factura y el packing list. Son
  -- metadatos del documento: NO afectan existencia, saldo ni totales, así que
  -- todos son opcionales y salen en blanco si no se capturan.
  purchase_order text,      -- Orden de Compra / PEDIDO
  salesperson    text,      -- Vendedor
  consigned_to   text,      -- Consignado a
  marks          text,      -- Marcas
  dispatched     text,      -- Despachado
  shipped_via    text,      -- Embarcado vía
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade
);

create index invoice_user_id_idx   on public.invoice (user_id);
create index invoice_client_id_idx on public.invoice (client_id);
create unique index invoice_user_num_key on public.invoice (user_id, invoice_num);


-- transaction (invoice lines / stock movement) --------------------------------
create table public.transaction (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid references public.invoice (id) on delete cascade,
  product_id   uuid references public.product (id) on delete restrict,
  description  text,
  type         text not null default 'product'
                 check (type in ('product', 'miscellaneous', 'charge')),
  unit_price   numeric(12,2),
  -- qty is ALWAYS the raw sellable quantity and is the only thing stock moves
  -- on. bultos is how many packages/parcels that represents, captured because
  -- freight and handling are counted in bultos, not units. For a catalogue
  -- product bultos = qty / product.qty_unit, but it is stored rather than
  -- derived so a repack (a changed qty_unit) never rewrites old invoices.
  qty          integer,
  bultos       numeric(12,2) check (bultos >= 0),
  unit         text,           -- DOC, BOX, PZA... as billed on this line
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,

  -- 'product'       lines point at a product and move stock.
  -- 'miscellaneous' one-off items you don't stock.
  -- 'charge'        freight / handling / fees billed to the client.
  -- The last two carry a description instead of a product.
  constraint transaction_type_shape check (
    (type = 'product' and product_id is not null)
    or
    (type in ('miscellaneous', 'charge')
     and product_id is null and description is not null)
  ),

  -- A charge is money (freight, handling, fees) — it has no packages and no
  -- unit of measure, so both must be blank on those lines.
  constraint transaction_charge_blank check (
    type <> 'charge' or (bultos is null and unit is null)
  )
);

create index transaction_invoice_id_idx on public.transaction (invoice_id);
create index transaction_product_id_idx on public.transaction (product_id);
create index transaction_user_id_idx    on public.transaction (user_id);


-- payments --------------------------------------------------------------------
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  amount          numeric(12,2) not null,
  payment_method  text,
  date_created    timestamptz not null default now(),
  client_id       uuid not null references public.client (id) on delete restrict,
  invoice_id      uuid references public.invoice (id) on delete set null,
  notes           text,
  user_id         uuid not null default auth.uid()
                    references auth.users (id) on delete cascade
);

create index payments_user_id_idx    on public.payments (user_id);
create index payments_client_id_idx  on public.payments (client_id);
create index payments_invoice_id_idx on public.payments (invoice_id);


-- purchase --------------------------------------------------------------------
create table public.purchase (
  id                uuid primary key default gen_random_uuid(),
  entry_no          text not null,
  provider          text,
  origin            text,
  net_weight_kgs    numeric(12,3),
  gross_weight_kgs  numeric(12,3),
  cbm               numeric(12,4),
  total             numeric(12,2) not null default 0,
  -- 'active' goods not yet received: NO stock effect, freely editable
  -- 'closed' received: stock is added ONCE, at closing, then frozen
  --
  -- Stock lands at close rather than on creation so that an active purchase can
  -- be edited freely. If stock arrived on creation, editing a line after
  -- invoices had already been raised against that stock would fight with them.
  -- A purchase is never deleted; correct a mistake while it is still active.
  status            text not null default 'active'
                      check (status in ('active', 'closed')),
  date_created      timestamptz not null default now(),
  user_id           uuid not null default auth.uid()
                      references auth.users (id) on delete cascade
);

create index purchase_user_id_idx on public.purchase (user_id, date_created desc);

-- A customs entry number identifies one specific shipment, so it must not
-- repeat within an account — same rule invoice_num already has.
create unique index purchase_user_entry_no_key
  on public.purchase (user_id, entry_no);


-- entry (purchase lines) ------------------------------------------------------
create table public.entry (
  id           uuid primary key default gen_random_uuid(),
  type         text not null default 'product'
                 check (type in ('product', 'charge')),
  product_id   uuid references public.product (id) on delete restrict,
  description  text,
  qty_unit     integer,
  cost_unit    numeric(12,2),
  purchase_id  uuid not null references public.purchase (id) on delete cascade,
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,

  -- 'product' lines point at a product and move stock.
  -- 'charge'  lines are freight / duty / handling: no product, just a label
  --           and a cost that lands in purchase.total.
  constraint entry_type_shape check (
    (type = 'product' and product_id is not null)
    or
    (type = 'charge' and product_id is null and description is not null)
  )
);

create index entry_purchase_id_idx on public.entry (purchase_id);
create index entry_product_id_idx  on public.entry (product_id);
create index entry_user_id_idx     on public.entry (user_id);


-- adjustment (manual stock correction) ----------------------------------------
-- APPEND ONLY. Never edited, never deleted — a wrong adjustment is corrected by
-- posting an opposite one, so the history of how stock reached its current
-- number is always complete and auditable.
--
-- Immutability is enforced by absence: policy.sql grants only a SELECT policy,
-- and functions.sql provides only create_adjustment(). There is no update path
-- and no delete path anywhere in the system.
create table public.adjustment (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.product (id) on delete restrict,
  type         text not null check (type in ('add', 'remove')),
  qty          integer not null check (qty > 0),
  description  text,
  date_created timestamptz not null default now(),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade
);

-- qty is always POSITIVE; `type` carries the direction. A 'remove' that would
-- take stock below zero is refused by apply_stock_delta in functions.sql.
create index adjustment_product_id_idx on public.adjustment (product_id, date_created desc);
create index adjustment_user_id_idx    on public.adjustment (user_id);


-- RLS -------------------------------------------------------------------------
-- Enabled now, policies go in policies.sql. A table in `public` without RLS is
-- open to anyone holding the anon key; with RLS and no policies it is closed to
-- everyone except the service_role key.

alter table public.adjustment  enable row level security;
alter table public.company     enable row level security;
alter table public.client      enable row level security;
alter table public.product     enable row level security;
alter table public.invoice     enable row level security;
alter table public.transaction enable row level security;
alter table public.payments    enable row level security;
alter table public.purchase    enable row level security;
alter table public.entry       enable row level security;
