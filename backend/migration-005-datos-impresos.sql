-- =============================================================================
-- Migration 005 — nombre, dirección y país alternos para el documento impreso
-- =============================================================================
-- Ejecutar después de migration-004. Se puede repetir sin problema.
--
-- QUÉ RESUELVE
--
--   Hasta ahora la factura impresa leía la dirección y el país EN VIVO de la
--   ficha del cliente. Dos consecuencias molestas:
--
--     * Si el cliente se muda, todas sus facturas históricas se reimprimen con
--       la dirección nueva. El papel deja de coincidir con lo que se entregó.
--     * No hay manera de facturar a una sucursal, a una razón social distinta
--       o a un consignatario sin duplicar el cliente entero.
--
--   Estas tres columnas son un OVERRIDE por documento: si están, mandan; si
--   están en NULL, se imprime lo del cliente, que es el comportamiento de
--   siempre. Por eso ninguna factura existente cambia de aspecto.
--
-- POR QUÉ NO SON invoice.client_name
--
--   Ya existe `invoice.client_name` como snapshot del nombre, y la tentación
--   obvia es reusarlo. No sirve: la vista `invoice_listado` lo expone, y de ahí
--   lo leen la lista de facturas, el detalle, las tablas del asistente y —lo
--   que de verdad importa— el BUSCADOR, que filtra por
--   `invoice_num` y `client_name`.
--
--   Si el nombre alterno pisara esa columna, buscar una factura por el nombre
--   real del cliente dejaría de encontrarla. Son dos cosas distintas: una es
--   con quién se hizo el negocio, la otra es qué se imprime en el papel.
--
-- POR QUÉ NO LLEVA GRANTS
--
--   La trampa de migration-003 (columna nueva = no escribible hasta nombrarla
--   en un grant) aplica a company, client y product, que sí tienen revoke a
--   nivel de tabla y re-grants por columna.
--
--   `invoice` no: su única política es invoice_select (solo SELECT), así que la
--   tabla entera está cerrada a escritura directa desde el navegador. Se
--   escribe únicamente desde create_invoice / update_invoice, que aprenden a
--   leer estas claves en functions.sql. VUELVE A APLICAR ESE ARCHIVO DESPUÉS.
-- =============================================================================

alter table public.invoice
  add column if not exists bill_to_name    text,
  add column if not exists bill_to_address text,
  add column if not exists bill_to_country text;

comment on column public.invoice.bill_to_name is
  'Nombre a imprimir en «Vendido a», si difiere del cliente. NULL = usar client_name / client.name.';
comment on column public.invoice.bill_to_address is
  'Dirección a imprimir, congelada en el documento. NULL = usar client.address (valor vivo).';
comment on column public.invoice.bill_to_country is
  'País a imprimir, congelado en el documento. NULL = usar client.country (valor vivo).';
