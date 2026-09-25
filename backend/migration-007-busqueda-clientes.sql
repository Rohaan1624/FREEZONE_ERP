-- ═════════════════════════════════════════════════════════════════════════════
-- migration-007 — índice de búsqueda de clientes
-- ═════════════════════════════════════════════════════════════════════════════
--
-- La factura ya no carga todos los clientes en un <select>: busca en el
-- servidor mientras se escribe (components/buscar-cliente.jsx), con
-- `name ilike '%texto%' or identifier ilike '%texto%'`.
--
-- Un índice B-tree normal NO sirve para un ilike con comodín al principio:
-- Postgres tendría que leer todos los clientes de la empresa en cada tecla.
-- Un índice GIN trigrama sí lo resuelve, así que la búsqueda cuesta lo mismo
-- con cien clientes que con cien mil.
--
-- No cambia datos ni permisos. Idempotente: se puede aplicar dos veces.

create extension if not exists pg_trgm with schema extensions;

create index if not exists client_name_trgm_idx
  on public.client using gin (name extensions.gin_trgm_ops);

create index if not exists client_identifier_trgm_idx
  on public.client using gin (identifier extensions.gin_trgm_ops);
