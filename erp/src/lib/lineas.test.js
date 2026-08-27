import { test } from "node:test"
import assert from "node:assert/strict"

import {
  lineaDeProducto,
  lineaSuelta,
  agrega,
  agregaProducto,
  actualiza,
  elimina,
  porTipo,
  sincroniza,
  importe,
  total,
  incompletas,
  sinExistencia,
  aPayload,
  desdeFilas,
  convierteBultos,
  disponible,
} from "./lineas.js"

const CAJA = { id: "p1", sku: "W-01", description: "Widget", qty_unit: 12, unit: "BOX", stock: 500, sale_price: 10 }
const SUELTO = { id: "p2", sku: "S-01", description: "Suelto", qty_unit: 1, unit: "PZA", stock: 40, sale_price: 3 }

/* ---------------------------------------------------------------- the bug -- */

test("switching tabs never loses lines", () => {
  let ls = []
  ls = agregaProducto(ls, CAJA)
  ls = agrega(ls, lineaSuelta("charge"))
  ls = actualiza(ls, ls[1].id, { description: "Flete", unit_price: 300 })
  ls = agrega(ls, lineaSuelta("miscellaneous"))
  ls = actualiza(ls, ls[2].id, { description: "Muestras", qty: 24, unit_price: 5 })

  // Walk every tab twice, as a user would.
  for (const t of ["product", "charge", "miscellaneous", "product", "charge"]) {
    const vistos = porTipo(ls, t)
    assert.equal(vistos.length, 1, `tab ${t} should show exactly its own line`)
  }
  assert.equal(ls.length, 3, "all three lines survive tab switching")
  assert.equal(ls.find((l) => l.type === "charge").description, "Flete")
  assert.equal(ls.find((l) => l.type === "miscellaneous").description, "Muestras")
})

test("porTipo returns the same objects, it does not copy or mutate", () => {
  const ls = agrega([], lineaSuelta("charge"))
  assert.equal(porTipo(ls, "charge")[0], ls[0])
  porTipo(ls, "charge")
  assert.equal(ls.length, 1)
})

test("editing while a filter is active hits the right line, not the same index", () => {
  let ls = agrega(agrega([], lineaSuelta("charge")), lineaSuelta("miscellaneous"))
  const misc = porTipo(ls, "miscellaneous")[0] // index 0 of the VISIBLE list, 1 of the real one
  ls = actualiza(ls, misc.id, { description: "Correcto" })
  assert.equal(ls[0].description, "", "the charge must be untouched")
  assert.equal(ls[1].description, "Correcto")
})

test("removing while a filter is active removes the right line", () => {
  let ls = agrega(agrega([], lineaSuelta("charge")), lineaSuelta("miscellaneous"))
  ls = elimina(ls, porTipo(ls, "miscellaneous")[0].id)
  assert.equal(ls.length, 1)
  assert.equal(ls[0].type, "charge")
})

/* ------------------------------------------------------------ qty <-> bultos */

test("bultos mode: 10 packages of 12 = 120 units", () => {
  let l = lineaDeProducto(CAJA)
  l = sincroniza(l, { modo: "bultos", bultos: 10 })
  assert.equal(l.qty, 120)
  assert.equal(l.bultos, 10)
})

test("qty mode: 120 units of 12-per-box = 10 packages", () => {
  let l = lineaDeProducto(CAJA)
  l = sincroniza(l, { modo: "qty", qty: 120 })
  assert.equal(l.bultos, 10)
  assert.equal(l.qty, 120)
})

test("a partial box is reported as a fraction, not rounded away", () => {
  let l = sincroniza(lineaDeProducto(CAJA), { modo: "qty", qty: 18 })
  assert.equal(l.bultos, 1.5)
})

test("qty stays an integer when driven from bultos (the column is integer)", () => {
  const l = sincroniza(lineaDeProducto({ ...CAJA, qty_unit: 7 }), { modo: "bultos", bultos: 2.5 })
  assert.equal(Number.isInteger(l.qty), true)
  assert.equal(l.qty, 18) // round(17.5)
})

test("qty_unit of 1 makes bultos equal qty", () => {
  const l = sincroniza(lineaDeProducto(SUELTO), { modo: "qty", qty: 9 })
  assert.equal(l.bultos, 9)
})

test("a missing or zero qty_unit falls back to 1 instead of dividing by zero", () => {
  const l = sincroniza(lineaDeProducto({ ...CAJA, qty_unit: 0 }), { modo: "qty", qty: 5 })
  assert.equal(l.bultos, 5)
  assert.ok(Number.isFinite(l.bultos))
})

test("changing packaging re-derives bultos from the unchanged qty", () => {
  let l = sincroniza(lineaDeProducto(CAJA), { modo: "qty", qty: 120 })
  assert.equal(l.bultos, 10)
  l = sincroniza(l, { piezasPorBulto: 24 })
  assert.equal(l.qty, 120, "qty is what was sold; it must not move")
  assert.equal(l.bultos, 5)
})

/* ------------------------------------------------------------------ charges */

test("charges never carry bultos or unit, whatever is set on them", () => {
  const l = sincroniza(lineaSuelta("charge"), { bultos: 9, unit: "BOX", qty: 1 })
  assert.equal(l.bultos, null)
  assert.equal(l.unit, "")
})

test("misceláneos DO carry bultos and unit", () => {
  const l = sincroniza(lineaSuelta("miscellaneous"), { qty: 24, bultos: 2, unit: "DOC" })
  assert.equal(l.qty, 24)
  assert.equal(l.bultos, 2)
  assert.equal(l.unit, "DOC")
})

test("miscelánea: editing qty does NOT touch bultos — nothing to convert with", () => {
  let l = sincroniza(lineaSuelta("miscellaneous"), { bultos: 3 })
  l = sincroniza(l, { qty: 250 })
  assert.equal(l.bultos, 3, "packages the user typed must stand")
  assert.equal(l.qty, 250)
})

test("miscelánea: editing bultos does NOT touch qty", () => {
  let l = sincroniza(lineaSuelta("miscellaneous"), { qty: 250 })
  l = sincroniza(l, { bultos: 3 })
  assert.equal(l.qty, 250)
  assert.equal(l.bultos, 3)
})

test("miscelánea: bultos left blank is sent as null, not zero", () => {
  const l = sincroniza(lineaSuelta("miscellaneous"), { description: "Muestras", qty: 5, unit_price: 2 })
  assert.equal(l.bultos, "")
  const [p] = aPayload([l])
  assert.equal(p.bultos, null)
  assert.equal(p.qty, 5)
})

test("only products convert; convierteBultos says which", () => {
  assert.equal(convierteBultos("product"), true)
  assert.equal(convierteBultos("miscellaneous"), false)
  assert.equal(convierteBultos("charge"), false)
})

test("old miscellaneous rows without bultos come back blank, not invented", () => {
  const [l] = desdeFilas([{ type: "miscellaneous", description: "Muestras", qty: 24, unit_price: 5 }])
  assert.equal(l.bultos, "")
})

/* ------------------------------------------------------------------ totals */

test("importe and total use raw qty, never bultos", () => {
  const l = sincroniza(lineaDeProducto(CAJA), { modo: "bultos", bultos: 10, unit_price: 10 })
  // Big values now — exact decimal, so compare as fixed strings.
  assert.equal(importe(l).toFixed(2), "1200.00") // 120 units x 10, NOT 10 boxes x 10
  assert.equal(total([l]).toFixed(2), "1200.00")
})

test("EXACTNESS: a hundred lines of 7 x 1.15 total 805.00, not 804.99…", () => {
  const l = sincroniza(lineaDeProducto({ ...CAJA, qty_unit: 1 }), { qty: 7, unit_price: 1.15 })
  assert.equal(importe(l).toFixed(2), "8.05") // float gives 8.049999999999999
  const cien = Array.from({ length: 100 }, () => l)
  assert.equal(total(cien).toFixed(2), "805.00")
})

test("EXACTNESS: 0.1 + 0.2 worth of lines is 0.30, not 0.30000000000000004", () => {
  const a = sincroniza(lineaSuelta("charge"), { qty: 1, unit_price: 0.1 })
  const b = sincroniza(lineaSuelta("charge"), { qty: 1, unit_price: 0.2 })
  assert.equal(total([a, b]).toFixed(2), "0.30")
})

test("EXACTNESS: half a cent rounds UP, the way invoicing expects", () => {
  const l = sincroniza(lineaSuelta("charge"), { qty: 1, unit_price: "1.005" })
  assert.equal(importe(l).toFixed(2), "1.01") // Math.round(1.005*100)/100 gave 1.00
})

test("adding the same product twice bumps the quantity instead of duplicating", () => {
  let ls = agregaProducto([], CAJA)
  ls = agregaProducto(ls, CAJA)
  assert.equal(ls.length, 1)
  assert.equal(ls[0].qty, 2)
})

/* ----------------------------------------------------------------- validation */

test("incompletas catches a missing price, a zero qty and a blank concept", () => {
  const ok = sincroniza(lineaDeProducto(CAJA), { qty: 1, unit_price: 5 })
  const sinPrecio = sincroniza(lineaDeProducto(CAJA), { qty: 1, unit_price: "" })
  const sinCant = sincroniza(lineaDeProducto(CAJA), { qty: 0, unit_price: 5 })
  const sinConcepto = sincroniza(lineaSuelta("charge"), { qty: 1, unit_price: 5 })
  const malas = incompletas([ok, sinPrecio, sinCant, sinConcepto])
  assert.equal(malas.length, 3)
  assert.ok(!malas.includes(ok))
})

test("sinExistencia counts what THIS document already holds as available", () => {
  // Active invoice already holding 50; product.stock reads 100 (net of those).
  // Editing to 120 fits: 100 free + 50 held = 150. The naive check said no.
  const l = sincroniza(lineaDeProducto({ ...CAJA, qty_unit: 1, stock: 100 }), { qty: 120 })
  assert.equal(sinExistencia([l]).length, 1, "without context it looks over stock")
  assert.equal(
    sinExistencia([l], { p1: 50 }).length,
    0,
    "with 50 already held by this invoice it fits"
  )
  assert.equal(disponible(l, { p1: 50 }), 150)
})

test("sinExistencia still flags a line that exceeds even the held units", () => {
  const l = sincroniza(lineaDeProducto({ ...CAJA, qty_unit: 1, stock: 100 }), { qty: 250 })
  assert.equal(sinExistencia([l], { p1: 50 }).length, 1, "250 > 150")
})

test("sinExistencia flags product lines over stock and ignores other types", () => {
  const caro = sincroniza(lineaDeProducto(CAJA), { modo: "bultos", bultos: 100 }) // 1200 > 500
  const misc = sincroniza(lineaSuelta("miscellaneous"), { qty: 9999 })
  const malas = sinExistencia([caro, misc])
  assert.equal(malas.length, 1)
  assert.equal(malas[0].type, "product")
})

/* -------------------------------------------------------------------- payload */

test("payload matches what create_invoice expects", () => {
  let ls = agregaProducto([], CAJA)
  ls = actualiza(ls, ls[0].id, { modo: "bultos", bultos: 10, unit_price: 10 })
  ls = agrega(ls, lineaSuelta("charge"))
  ls = actualiza(ls, ls[1].id, { description: " Flete ", unit_price: 300 })

  const [prod, cargo] = aPayload(ls)
  assert.deepEqual(prod, {
    type: "product",
    product_id: "p1",
    description: null,
    qty: 120,
    bultos: 10,
    unit: "BOX",
    // an exact decimal STRING: PostgREST casts it to numeric(12,2) directly,
    // with no float hop on the way
    unit_price: "10.00",
  })
  assert.deepEqual(cargo, {
    type: "charge",
    product_id: null,
    description: "Flete", // trimmed
    qty: 1,
    bultos: null,
    unit: null,
    unit_price: "300.00",
  })
})

test("text typed into number inputs is coerced, not passed through as NaN", () => {
  const l = sincroniza(lineaSuelta("miscellaneous"), { qty: "12", unit_price: "$5.50" })
  const [p] = aPayload([l])
  assert.equal(p.qty, 12)
  assert.equal(p.unit_price, "5.50")
})

/* --------------------------------------------------------------- rehydration */

test("saved rows come back as editable lines with bultos intact", () => {
  const ls = desdeFilas(
    [
      { type: "product", product_id: "p1", qty: 120, bultos: 10, unit: "BOX", unit_price: 10 },
      { type: "charge", product_id: null, description: "Flete", qty: 1, unit_price: 300 },
    ],
    [CAJA]
  )
  assert.equal(ls[0].sku, "W-01")
  assert.equal(ls[0].bultos, 10)
  assert.equal(ls[0].piezasPorBulto, 12)
  assert.equal(ls[1].description, "Flete")
  assert.notEqual(ls[0].id, ls[1].id)
})

test("old rows saved before bultos existed get it derived on the way in", () => {
  const [l] = desdeFilas([{ type: "product", product_id: "p1", qty: 24, unit_price: 10 }], [CAJA])
  assert.equal(l.bultos, 2)
})
