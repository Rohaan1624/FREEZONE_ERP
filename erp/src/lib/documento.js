/**
 * Qué se imprime en la cabecera de la factura: nombre, dirección y país.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA CASCADA, Y POR QUÉ ESE ORDEN
 * ─────────────────────────────────────────────────────────────────────────────
 *   bill_to_*    lo que se escribió PARA ESTE documento (migration-005)
 *   client_name  el nombre del cliente, congelado al emitir
 *   client.*     la ficha viva, que es lo que había antes de todo esto
 *
 * La dirección y el país salían en vivo de la ficha del cliente, así que mudar
 * a un cliente reescribía la dirección de TODAS sus facturas históricas: el
 * papel dejaba de coincidir con lo que se entregó. Con bill_to_address puesto,
 * esa factura ya no se mueve nunca más.
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
export const direccionDoc = (inv, cli = {}) => inv.bill_to_address ?? cli.address
export const paisDoc = (inv, cli = {}) => inv.bill_to_country ?? cli.country
