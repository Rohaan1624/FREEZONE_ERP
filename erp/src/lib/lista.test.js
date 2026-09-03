import { test } from "node:test"
import assert from "node:assert/strict"

import {
  rango,
  filtroTexto,
  filtrosBusqueda,
  variantes,
  etiquetaRango,
  POR_PAGINA,
} from "./lista.js"

/* ------------------------------------------------------------------ rango -- */

test("rango es inclusivo en los dos extremos, como .range() de PostgREST", () => {
  assert.deepEqual(rango(0, 50), [0, 49])
  assert.deepEqual(rango(1, 50), [50, 99])
  assert.deepEqual(rango(7, 50), [350, 399])
})

test("rango usa POR_PAGINA por defecto", () => {
  assert.deepEqual(rango(2), [2 * POR_PAGINA, 3 * POR_PAGINA - 1])
})

/* ----------------------------------------------------------- filtroTexto -- */

test("arma una condición ilike por columna", () => {
  assert.equal(
    filtroTexto("doe", ["invoice_num", "client_name"]),
    "invoice_num.ilike.%doe%,client_name.ilike.%doe%"
  )
})

test("vacío devuelve null para no aplicar filtro", () => {
  for (const v of ["", "   ", null, undefined]) {
    assert.equal(filtroTexto(v, ["name"]), null)
  }
})

test("la coma se neutraliza: separa condiciones en PostgREST", () => {
  // Sin esto «Doe, John» partiría el filtro en dos y daría error de sintaxis
  // en vez de un resultado.
  const f = filtroTexto("Doe, John", ["name"])
  assert.equal(f, "name.ilike.%Doe  John%")
  assert.equal(f.split(",").length, 1, "no debe quedar ninguna coma suelta")
})

test("los paréntesis también se neutralizan: agrupan condiciones", () => {
  const f = filtroTexto("Acme (Panama)", ["name"])
  assert.ok(!f.includes("("))
  assert.ok(!f.includes(")"))
})

test("los comodines de LIKE se escapan", () => {
  // Buscar «100%» debe buscar ese texto, no «cualquier cosa que empiece con 100».
  assert.equal(filtroTexto("100%", ["identifier"]), "identifier.ilike.%100\\%%")
  assert.equal(filtroTexto("a_b", ["sku"]), "sku.ilike.%a\\_b%")
  assert.equal(filtroTexto("c\\d", ["sku"]), "sku.ilike.%c\\\\d%")
})

test("varias columnas y texto con espacios", () => {
  assert.equal(
    filtroTexto("  ABC 100  ", ["sku", "description"]),
    "sku.ilike.%ABC 100%,description.ilike.%ABC 100%"
  )
})

/* --------------------------------------------------------- etiquetaRango -- */

test("dice qué tramo se está viendo y de cuántos", () => {
  assert.equal(etiquetaRango(0, 50, 3214, 50), "1 – 50 de 3,214")
  assert.equal(etiquetaRango(1, 50, 3214, 50), "51 – 100 de 3,214")
  // Última página parcial: el tope es lo que realmente llegó, no la aritmética.
  assert.equal(etiquetaRango(64, 14, 3214, 50), "3,201 – 3,214 de 3,214")
})

test("una sola página también muestra el rango", () => {
  // Es justo el texto que faltaba antes: sin él no había forma de notar que la
  // lista venía recortada en mil filas.
  assert.equal(etiquetaRango(0, 8, 8, 50), "1 – 8 de 8")
})

test("sin resultados no inventa un rango", () => {
  assert.equal(etiquetaRango(0, 0, 0, 50), "sin resultados")
})

/* ================================================================== *
 * BÚSQUEDA TOLERANTE
 * ================================================================== *
 * El fallo que la motivó: «lista todos los peines» contestaba «no encontré
 * ningún producto». `ilike %peines%` exige que el dato contenga literalmente
 * «peines», y el catálogo dice PEINE DE MADERA. La gente escribe en plural
 * y el catálogo está en singular: es el caso normal, no el raro.
 */

/**
 * Simula lo que hace PostgREST con estos filtros: cada filtro es un OR de
 * ilike, y los filtros encadenados se combinan con AND.
 *
 * Traducir el patrón de LIKE a RegExp tiene un orden que importa: primero se
 * deshace el escape de la app (\% -> %), luego se escapa para RegExp, y solo
 * al final se convierten los comodines que quedaron sin escapar.
 */
function aRegExp(patron) {
  let out = ""
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i]
    if (c === "\\") {
      // Comodín escapado por la app: es un carácter literal.
      out += (patron[++i] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    } else if (c === "%") out += ".*"
    else if (c === "_") out += "."
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp("^" + out + "$", "i")
}

function encuentra(consulta, datos, columnas = ["description"]) {
  const filtros = filtrosBusqueda(consulta, columnas)
  if (!filtros.length) return datos
  const casa = (filtro, fila) =>
    filtro.split(",").some((cond) => {
      const corte = cond.indexOf(".ilike.")
      const col = cond.slice(0, corte)
      return aRegExp(cond.slice(corte + 7)).test(fila[col] ?? "")
    })
  return datos.filter((f) => filtros.every((filtro) => casa(filtro, f)))
}

const CATALOGO = [
  { description: "PEINE DE MADERA" },
  { description: "PEINE FINO" },
  { description: "GORRA SURTIDA" },
  { description: "CABLE USB" },
  { description: "PAPEL BOND" },
  { description: "CINTURÓN DE CUERO" },
]
const nombres = (r) => r.map((x) => x.description).sort()

test("el plural encuentra el singular — el fallo reportado", () => {
  assert.deepEqual(nombres(encuentra("peines", CATALOGO)), ["PEINE DE MADERA", "PEINE FINO"])
})

test("el plural en -es también, aunque la regla sea ambigua", () => {
  // «peines» es peine+s y «papeles» es papel+es. Ninguna regla sola acierta
  // las dos, así que se prueban las dos formas y gana la que exista.
  assert.deepEqual(nombres(encuentra("papeles", CATALOGO)), ["PAPEL BOND"])
  assert.deepEqual(nombres(encuentra("cables", CATALOGO)), ["CABLE USB"])
  assert.deepEqual(nombres(encuentra("gorras", CATALOGO)), ["GORRA SURTIDA"])
})

test("sin tilde encuentra lo que está con tilde", () => {
  // La tilde está en el DATO, así que quitársela a la consulta no sirve de
  // nada: hace falta el comodín de una sola letra.
  assert.deepEqual(nombres(encuentra("cinturon", CATALOGO)), ["CINTURÓN DE CUERO"])
  assert.deepEqual(nombres(encuentra("cinturones", CATALOGO)), ["CINTURÓN DE CUERO"])
})

test("una frase busca por palabras, no como subcadena literal", () => {
  // «peines de madera» NO está dentro de «PEINE DE MADERA».
  assert.deepEqual(nombres(encuentra("peines de madera", CATALOGO)), ["PEINE DE MADERA"])
  // Y el orden no importa.
  assert.deepEqual(nombres(encuentra("madera peine", CATALOGO)), ["PEINE DE MADERA"])
})

test("el singular sigue funcionando, no se rompió lo que ya servía", () => {
  assert.deepEqual(nombres(encuentra("peine", CATALOGO)), ["PEINE DE MADERA", "PEINE FINO"])
  assert.deepEqual(nombres(encuentra("USB", CATALOGO)), ["CABLE USB"])
})

test("los comodines de LIKE se siguen escapando", () => {
  // Sin escapar, «100%» traería el catálogo entero.
  assert.deepEqual(encuentra("100%", CATALOGO), [])
  assert.deepEqual(encuentra("_", CATALOGO), [])
})

test("una consulta de puras palabras vacías no devuelve todo el catálogo", () => {
  // «de la» casan con medio catálogo; si se descartan todas y no queda ningún
  // filtro, la búsqueda devolvería todo y parecería rota.
  assert.deepEqual(encuentra("de la", CATALOGO), [])
})

test("variantes no le inventa formas a un SKU", () => {
  assert.deepEqual(variantes("PG-123"), ["PG-123"])
})

test("filtroTexto NO expande variantes: las listas filtran al teclear", () => {
  // Expandir mientras se escribe haría parpadear la lista con resultados de
  // más a media palabra.
  assert.equal(filtroTexto("peines", ["sku"]), "sku.ilike.%peines%")
})
