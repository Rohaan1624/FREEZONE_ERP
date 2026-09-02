import { test } from "node:test"
import assert from "node:assert/strict"

import { rango, filtroTexto, etiquetaRango, POR_PAGINA } from "./lista.js"

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
