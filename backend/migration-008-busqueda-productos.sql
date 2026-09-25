-- ═════════════════════════════════════════════════════════════════════════════
-- migration-008 — índice de búsqueda de productos
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Factura, entrada y ajustes ya no cargan el catálogo entero para filtrarlo en
-- el navegador: buscan en el servidor mientras se escribe
-- (lib/buscar-productos.js), con `sku ilike '%texto%' or description ilike
-- '%texto%'`.
--
-- Mismo motivo que migration-007 con los clientes: un B-tree no sirve para un
-- ilike con comodín al principio; un GIN trigrama sí, y la búsqueda cuesta lo
-- mismo con cien SKU que con cien mil.
--
-- No cambia datos ni permisos. Idempotente: se puede aplicar dos veces.

create extension if not exists pg_trgm with schema extensions;

create index if not exists product_sku_trgm_idx
  on public.product using gin (sku extensions.gin_trgm_ops);

create index if not exists product_description_trgm_idx
  on public.product using gin (description extensions.gin_trgm_ops);
