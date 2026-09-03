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
  const limpio = escapa(q)
  if (!limpio) return null
  return columnas.map((c) => `${c}.ilike.%${limpio}%`).join(",")
}

const escapa = (q) =>
  String(q ?? "")
    .trim()
    .replace(/[,()]/g, " ")
    .replace(/[%_\\]/g, "\\$&")

const sinTildes = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")

/**
 * Los singulares CANDIDATOS de una palabra en español.
 *
 * Devuelve varios a propósito, porque el plural en «-es» es ambiguo y sin un
 * diccionario no se puede resolver: «peines» es peine+s, pero «papeles» es
 * papel+es. Quitar «es» a los dos da «pein» y «papel»; quitar «s», «peine» y
 * «papele». Ninguna regla sola acierta las dos.
 *
 * No hace falta elegir: la búsqueda es por subcadena y con OR, así que se
 * mandan las dos formas y gana la que exista. Pasarse de corto es inofensivo
 * —«pein» encuentra PEINE igual— y quedarse corto es lo que no encuentra nada.
 *
 * No es morfología de verdad ni lo pretende: «lápices» no va a dar «lápiz».
 * El objetivo es que escribir en plural encuentre el catálogo en singular.
 */
function singulares(p) {
  const formas = [p]
  if (p.length > 3 && p.endsWith("s")) formas.push(p.slice(0, -1))
  if (p.length > 4 && p.endsWith("es")) formas.push(p.slice(0, -2))
  return formas
}

/**
 * Las formas con que vale la pena buscar un término.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA: «peines» NO CONTIENE «peine»… AL REVÉS
 * ─────────────────────────────────────────────────────────────────────────────
 * `ilike %peines%` exige que el texto guardado contenga literalmente «peines».
 * El catálogo dice PEINE DE MADERA, así que no coincide nada y el asistente
 * contestaba «no encontré ningún producto» a una pregunta perfectamente clara.
 * La gente escribe en plural («lista todos los peines») y el catálogo está en
 * singular: es el caso NORMAL, no el raro.
 *
 * Lo mismo con las tildes: quien escribe «cinturon» no encuentra CINTURÓN.
 *
 * Se devuelven variantes en vez de tocar la columna porque `unaccent` no está
 * garantizado en el proyecto, y meterle una función a la columna en el WHERE
 * mataría cualquier índice.
 */
/**
 * Las tildes que faltan, con el comodín de una sola letra.
 *
 * Aquí el problema va al revés que el plural: la tilde está en el DATO
 * («CINTURÓN») y no en lo que se escribió («cinturon»), así que quitarle
 * tildes a la consulta no sirve de nada. `_` de LIKE casa exactamente un
 * carácter, así que «cintur_n» sí encuentra CINTURÓN.
 *
 * Como no se sabe QUÉ vocal lleva la tilde, se prueba una por una. Solo para
 * palabras que se escribieron SIN tilde —si ya la traen, no hay nada que
 * adivinar— y con un tope, para no convertir «distribuidora» en doce
 * condiciones.
 *
 * Lo correcto de verdad sería `unaccent` en Postgres o una columna
 * normalizada con su índice; esto es lo que se puede hacer sin migración.
 */
const MAX_COMODINES = 5
function conTildePosible(p) {
  if (p !== sinTildes(p)) return []
  const salida = []
  for (let i = 0; i < p.length && salida.length < MAX_COMODINES; i++) {
    if ("aeiou".includes(p[i])) salida.push(p.slice(0, i) + "_" + p.slice(i + 1))
  }
  return salida
}

/** Las formas con que vale la pena buscar UNA palabra. */
export function variantes(palabra) {
  const base = escapa(palabra)
  if (!base) return []

  const formas = new Set()
  for (const v of [base, sinTildes(base)]) {
    for (const s of singulares(v)) {
      formas.add(s)
      for (const c of conTildePosible(s)) formas.add(c)
    }
  }
  // Si una forma es subcadena de otra, la larga sobra: `%pein%` ya encuentra
  // todo lo que encontraría `%peine%`. Menos condiciones, mismo resultado.
  const todas = [...formas].filter(Boolean)
  return todas.filter((f) => !todas.some((o) => o !== f && f.includes(o)))
}

// «de», «la», «el», «los»… casan con medio catálogo y no aportan nada.
const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "y", "con", "para"])

/**
 * Filtros de búsqueda tolerante: uno por palabra, para encadenar con .or().
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEVUELVE UNA LISTA, Y ESO ES EL DISEÑO
 * ─────────────────────────────────────────────────────────────────────────────
 * Buscar la frase entera como una sola subcadena falla en cuanto el orden o un
 * plural no calzan: «peines de madera» no está dentro de «PEINE DE MADERA».
 * Con un filtro POR PALABRA, y encadenándolos, PostgREST los combina con AND:
 * el resultado tiene que contener «pein» Y «madera», en cualquier orden y con
 * lo que sea en medio. Dentro de cada palabra las variantes van con OR.
 *
 * `filtroTexto` sigue existiendo aparte porque las cajas de búsqueda de las
 * listas filtran mientras se teclea, y ahí expandir variantes haría que la
 * lista parpadee con resultados de más a media palabra.
 */
export function filtrosBusqueda(q, columnas) {
  const palabras = String(q ?? "")
    .trim()
    .split(/\s+/)
    .filter((p) => p && !VACIAS.has(p.toLowerCase()))

  // Todo eran palabras vacías («de la»): mejor buscar la frase tal cual que
  // no filtrar nada y devolver el catálogo entero.
  if (!palabras.length) {
    const f = filtroTexto(q, columnas)
    return f ? [f] : []
  }

  return palabras
    .map((p) => variantes(p).flatMap((f) => columnas.map((c) => `${c}.ilike.%${f}%`)).join(","))
    .filter(Boolean)
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
