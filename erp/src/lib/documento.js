/**
 * Qué se imprime en la cabecera de la factura: nombre, dirección y país.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA CASCADA, Y POR QUÉ ESE ORDEN
 * ─────────────────────────────────────────────────────────────────────────────
 *   bill_to_*    lo que alguien ESCRIBIÓ para este documento (migration-005)
 *   client_*     lo que decía la ficha AL EMITIR, congelado (migration-006)
 *   client.*     la ficha viva — solo para las facturas anteriores a 006
 *
 * Los dos primeros parecen lo mismo y no lo son. `bill_to_*` es una decisión
 * («esta factura va a nombre de la sucursal»); `client_*` es un hecho histórico
 * («esto es lo que decía la ficha ese día»). Por eso son columnas distintas:
 * quitar el alterno debe devolver el dato del día de la emisión, no el de hoy.
 *
 * El respaldo a la ficha viva se queda para las facturas emitidas antes de que
 * existiera el congelado y que la migración no pudo rellenar. Para todo lo
 * nuevo, mudar a un cliente ya no reescribe ni un papel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN MÓDULO PROPIO Y NO pdf.js
 * ─────────────────────────────────────────────────────────────────────────────
 * La vista de impresión y el PDF son dos renderizadores del mismo documento y
 * ya divergieron una vez, así que estos respaldos tienen que estar en un solo
 * sitio. Pero pdf.js arrastra jsPDF, y factura-imprimir.jsx lo carga de forma
 * diferida a propósito para no meterlo en el bundle principal. Ponerlos aquí
 * los comparte sin resucitar esa importación.
 *
 * Ojo: NO tocan `invoice.client_name`, que es lo que leen la lista, el detalle
 * y el BUSCADOR de facturas. Un nombre alterno cambia el papel, no con quién
 * se hizo el negocio.
 */

export const nombreDoc = (inv, cli = {}) => inv.bill_to_name ?? inv.client_name ?? cli.name
export const direccionDoc = (inv, cli = {}) =>
  inv.bill_to_address ?? inv.client_address ?? cli.address
export const paisDoc = (inv, cli = {}) =>
  inv.bill_to_country ?? inv.client_country ?? cli.country
