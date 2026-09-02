import * as React from "react"

import { n0 } from "./dinero.js"

/**
 * Mecánica compartida de las listas paginadas.
 *
 * Con paginación, buscar y filtrar TIENEN que pasar al servidor. Filtrar el
 * arreglo ya cargado solo encuentra lo que estaba en la página visible, que es
 * peor que no buscar: parece que buscó y no encontró nada.
 */

/** Cuántos renglones por página. Un mayor contable se lee de corrido. */
export const POR_PAGINA = 50

/**
 * Retrasa el valor para no lanzar una consulta por cada tecla.
 *
 * 300 ms es el punto donde deja de sentirse lento sin llegar a mandar una
 * consulta por letra: escribir «distribuidora» dispara una, no trece.
 */
export function useDebounce(valor, ms = 300) {
  const [tardio, setTardio] = React.useState(valor)
  React.useEffect(() => {
    const t = setTimeout(() => setTardio(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return tardio
}

/** El rango [desde, hasta] que espera .range() de PostgREST, 0-indexado. */
export const rango = (pagina, porPagina = POR_PAGINA) => [
  pagina * porPagina,
  pagina * porPagina + porPagina - 1,
]

/**
 * Escapa lo que el usuario escribió para meterlo en un .or() de PostgREST.
 *
 * La coma separa condiciones y el paréntesis las agrupa, así que buscar
 * «Doe, John» partiría el filtro en dos y produciría un error de sintaxis en
 * vez de un resultado vacío. El % y el _ son comodines de LIKE: sin escaparlos,
 * buscar «100%» traería cualquier cosa que empiece con 100.
 */
export function filtroTexto(q, columnas) {
  const limpio = String(q ?? "")
    .trim()
    .replace(/[,()]/g, " ")
    .replace(/[%_\\]/g, "\\$&")
  if (!limpio) return null
  return columnas.map((c) => `${c}.ilike.%${limpio}%`).join(",")
}

/** Texto del pie: «51 – 100 de 3,214». */
export function etiquetaRango(pagina, cuantos, total, porPagina = POR_PAGINA) {
  if (!total) return "sin resultados"
  // n0() y no toLocaleString: agrupa igual que el resto de las cifras de la
  // app y no depende del ICU que traiga el entorno.
  const a = pagina * porPagina + 1
  const b = pagina * porPagina + cuantos
  return `${n0(a)} – ${n0(b)} de ${n0(total)}`
}
