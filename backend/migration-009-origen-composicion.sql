-- =============================================================================
-- Migration 009 — origen y composición por renglón de factura
-- =============================================================================
-- Ejecutar después de migration-008, y luego volver a aplicar functions.sql
-- (create_invoice y update_invoice ya guardan los dos campos). Se puede
-- repetir sin problema.
--
-- QUÉ ES
--
--   Dos datos opcionales por renglón de producto o misceláneo, solo para lo
--   impreso: de dónde viene la mercancía (origen) y de qué está hecha
--   (composición: «100% algodón», «acero inoxidable»…). Los piden aduanas y
--   algunos clientes. La factura impresa solo abre la columna si ALGÚN
--   renglón la trae; si nadie la usa, el papel queda igual que antes.
--
-- POR QUÉ EN EL RENGLÓN Y NO EN EL PRODUCTO
--
--   El mismo SKU puede venir de dos orígenes en dos contenedores distintos.
--   Lo que se declara es lo de ESTA venta, y una factura ya emitida no debe
--   cambiar porque alguien edite la ficha del producto.
--
-- NADA CAMBIA PARA LO QUE YA EXISTE
--
--   Columnas nuevas, nulas, sin valor por defecto: los renglones viejos quedan
--   en null y sus facturas se imprimen exactamente igual.
--
--   Sin grants: transaction es de solo lectura para la aplicación y se escribe
--   únicamente por create_invoice / update_invoice.

alter table public.transaction
  add column if not exists origin      text,
  add column if not exists composition text;

-- Un cargo es dinero (flete, maniobras): no tiene bultos ni unidad, y
-- tampoco origen ni composición. Se amplía la misma regla que ya lo exigía.
alter table public.transaction drop constraint if exists transaction_charge_blank;
alter table public.transaction add constraint transaction_charge_blank check (
  type <> 'charge'
  or (bultos is null and unit is null and origin is null and composition is null)
);
