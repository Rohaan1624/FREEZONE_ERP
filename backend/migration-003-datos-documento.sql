-- =============================================================================
-- Migration 003 — datos de cabecera para la factura y el packing list impresos
-- =============================================================================
-- Ejecutar después de migration-002. Se puede repetir sin problema.
--
-- POR QUÉ NO ROMPE NADA
--
--   * Todas las columnas son `text` NULL, sin default. Postgres solo toca el
--     catálogo: no reescribe las filas existentes, no bloquea la tabla más que
--     un instante. Las filas que ya existen quedan en NULL.
--   * Ninguna función, política o vista las menciona todavía, así que nada
--     cambia de comportamiento.
--   * Son METADATOS DEL DOCUMENTO: no entran en existencia, saldo ni totales.
--     Una factura sin ellos se imprime igual, solo con ese renglón en blanco —
--     tal como la plantilla en papel deja «Marcas» o «Despachado» vacíos.
--
-- LA TRAMPA (nos pasó en migration-001)
--
--   policy.sql revocó INSERT/UPDATE a nivel de TABLA en company y client, y
--   volvió a otorgarlos columna por columna. Una columna nueva NO es escribible
--   hasta que se nombra en un grant. Sin los grants de abajo, guardar el RUC
--   falla con «permission denied for table company» y parece un bug de la app.
--
--   invoice no lleva grants: es de solo lectura para la app y se escribe
--   únicamente desde create_invoice / update_invoice, que ganan parámetros
--   nuevos en functions.sql. Vuelve a aplicar ese archivo después de esta
--   migración.
-- =============================================================================

alter table public.company
  add column if not exists tax_id  text,
  add column if not exists address text;

alter table public.client
  add column if not exists address text,
  add column if not exists country text;

alter table public.invoice
  add column if not exists purchase_order text,
  add column if not exists salesperson    text,
  add column if not exists consigned_to   text,
  add column if not exists marks          text,
  add column if not exists dispatched     text,
  add column if not exists shipped_via    text;

-- Sin esto las columnas nuevas existen pero son de solo lectura.
grant insert (tax_id, address), update (tax_id, address)
   on public.company to authenticated;

grant insert (address, country), update (address, country)
   on public.client to authenticated;
