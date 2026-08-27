-- =============================================================================
-- Migration 001 — reference prices, credit terms, invoice due dates
-- =============================================================================
-- Run this ONLY if you have already applied schema.sql to your Supabase project.
-- On a fresh database schema.sql already contains these columns and this file
-- is unnecessary (running it anyway is harmless — every statement is guarded).
--
-- Adds:
--   product.cost_price   what you pay      -> prefills purchase lines
--   product.sale_price   your list price   -> prefills invoice lines
--   client.payment_terms default credit days
--   invoice.due_date     when payment is due -> aging / overdue reporting
--
-- All nullable (or defaulted), all additive. No existing row changes meaning,
-- no policy is rewritten, no function logic changes except that create_invoice
-- and update_invoice gained a p_due_date argument.
--
-- AFTER running this, re-run functions.sql — it is re-runnable and carries the
-- new signatures plus the drops for the superseded ones.
-- =============================================================================

alter table public.product
  add column if not exists cost_price numeric(12,2),
  add column if not exists sale_price numeric(12,2);

alter table public.client
  add column if not exists payment_terms integer not null default 0;

alter table public.invoice
  add column if not exists due_date date;

-- Constraints are added separately: ADD COLUMN IF NOT EXISTS cannot carry a
-- CHECK idempotently, so guard them by name.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_cost_price_check') then
    alter table public.product add constraint product_cost_price_check check (cost_price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_sale_price_check') then
    alter table public.product add constraint product_sale_price_check check (sale_price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_payment_terms_check') then
    alter table public.client add constraint client_payment_terms_check check (payment_terms >= 0);
  end if;
end;
$$;

-- Column privileges must be re-granted: policy.sql revoked table-wide
-- INSERT/UPDATE and granted specific columns, so brand-new columns are NOT
-- writable until they are named here. Without this the app silently gets
-- "permission denied for table product" when saving a price.
grant insert (cost_price, sale_price), update (cost_price, sale_price)
   on public.product to authenticated;

grant insert (payment_terms), update (payment_terms)
   on public.client to authenticated;

-- invoice.due_date is deliberately NOT granted: invoice is a read-only table
-- for the app, written only by create_invoice / update_invoice.
