-- =============================================================================
-- Migration 006 — congelar la dirección del cliente en la factura
-- =============================================================================
-- Ejecutar después de migration-005. Se puede repetir sin problema.
--
-- QUÉ RESUELVE
--
--   La factura impresa leía la dirección y el país EN VIVO de la ficha del
--   cliente. O sea que si un cliente se muda y alguien actualiza su ficha,
--   TODAS sus facturas históricas se reimprimen con la dirección nueva.
--
--   El papel deja de coincidir con lo que se entregó. Para un documento que
--   ampara una venta eso es sencillamente incorrecto: la factura de marzo dice
--   a dónde se mandó la mercancía en marzo, no dónde está el cliente hoy.
--
--   `client_name` ya se congelaba desde el principio. Esto es la otra mitad que
--   faltaba.
--
-- POR QUÉ SON COLUMNAS NUEVAS Y NO LAS bill_to_*
--
--   Parecen lo mismo y no lo son, y mezclarlas rompería las dos:
--
--     bill_to_*     LO QUE ALGUIEN ESCRIBIÓ para este documento, porque difiere
--                   del cliente. Vacío significa «no hay nada especial».
--     client_*      LO QUE DECÍA LA FICHA al emitir. Nunca se escribe a mano.
--
--   Si se reusaran, el formulario —que manda las claves vacías cuando el campo
--   está en blanco— borraría el congelado en cada guardado, y la factura
--   volvería a seguir al cliente vivo sin que nadie lo pidiera.
--
--   La cascada al imprimir queda:  bill_to_* -> client_* -> client.* (vivo)
--
-- EL RELLENO
--
--   Las facturas que ya existen se rellenan con la dirección ACTUAL del
--   cliente. No es la dirección histórica —esa se perdió, no la guardábamos—
--   pero es exactamente lo que esas facturas imprimen hoy, así que el relleno
--   no cambia ni un papel. Lo que hace es congelarlas de aquí en adelante.
--
--   Sin grants: invoice es de solo lectura para la aplicación y se escribe
--   únicamente desde create_invoice / update_invoice. VUELVE A APLICAR
--   functions.sql DESPUÉS DE ESTA MIGRACIÓN.
-- =============================================================================

alter table public.invoice
  add column if not exists client_address text,
  add column if not exists client_country text;

comment on column public.invoice.client_address is
  'Dirección de la ficha del cliente al emitir, congelada. La mudanza de un cliente no debe reescribir sus facturas viejas.';
comment on column public.invoice.client_country is
  'País de la ficha del cliente al emitir, congelado.';

-- Relleno idempotente: solo toca las que están en NULL, así que re-ejecutar
-- esta migración no pisa una dirección ya congelada con la de hoy.
update public.invoice i
   set client_address = c.address,
       client_country = c.country
  from public.client c
 where c.id = i.client_id
   and i.client_address is null
   and i.client_country is null;
