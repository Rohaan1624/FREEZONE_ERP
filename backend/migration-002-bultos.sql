-- =============================================================================
-- Migration 002 — bultos (packages) and unit of measure on invoice lines
-- =============================================================================
-- Run after migration-001. Safe to re-run.
--
-- Adds to transaction:
--   bultos  how many packages/parcels this line represents
--   unit    how it is billed on this line (DOC, BOX, PZA...)
--
-- STOCK IS UNAFFECTED. qty stays the raw sellable quantity and remains the only
-- thing invoice_footprint() and apply_stock_delta() ever read. bultos is a
-- second way to SAY the same quantity, not a second quantity — the app converts
-- with product.qty_unit (units per package) and writes both.
--
-- Why bultos is stored rather than derived: if you later repack a SKU and
-- change its qty_unit, deriving would silently rewrite how many packages every
-- historical invoice shipped. Storing it freezes what actually left the door.
--
-- Both nullable. Charges get neither — they are money, not goods.
--
-- No function signatures change: create_invoice and update_invoice take lines
-- as jsonb, so the two new keys are read straight out of the existing argument.
-- Re-run functions.sql after this so they start reading them.
-- =============================================================================

alter table public.transaction
  add column if not exists bultos numeric(12,2),
  add column if not exists unit   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transaction_bultos_check') then
    alter table public.transaction
      add constraint transaction_bultos_check check (bultos >= 0);
  end if;

  -- A charge has no packages and no unit of measure.
  if not exists (select 1 from pg_constraint where conname = 'transaction_charge_blank') then
    alter table public.transaction
      add constraint transaction_charge_blank
      check (type <> 'charge' or (bultos is null and unit is null));
  end if;
end;
$$;

-- transaction is a read-only table for the app (SELECT policy, no write policy)
-- so there are no column grants to add — the RPCs write it as the table owner.
