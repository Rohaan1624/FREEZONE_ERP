import { test } from "node:test"
import assert from "node:assert/strict"
import {
  aNumero,
  margenBruto,
  utilidadUnitaria,
  margenTexto,
  multiplicador,
  markupTexto,
  usd,
} from "./format.js"

test("THE BUG: a missing cost is unknown, not 100% margin", () => {
  assert.equal(margenBruto(null, 12), null)
  assert.equal(margenBruto(undefined, 12), null)
  assert.equal(margenBruto("", 12), null)
  assert.equal(margenTexto(null, 12), "—")
})

test("a cost of exactly zero IS 100% margin — that is different from missing", () => {
  assert.equal(margenBruto(0, 12), 100)
  assert.equal(margenBruto("0", 12), 100)
})

test("no sale price, or a sale price of zero, cannot yield a margin", () => {
  assert.equal(margenBruto(5, null), null)
  assert.equal(margenBruto(5, ""), null)
  assert.equal(margenBruto(5, 0), null)
})

test("margin is on the SALE price, not markup over cost", () => {
  // 5.50 cost, 12.00 price -> (12-5.5)/12 = 54.17%   (markup would be 118%)
  assert.equal(margenBruto(5.5, 12).toFixed(2), "54.17")
  assert.equal(margenTexto(5.5, 12), "54.2%")
})

test("selling below cost reports a negative margin instead of hiding it", () => {
  assert.equal(margenBruto(12, 10), -20)
  assert.equal(margenTexto(12, 10), "-20.0%")
})

test("a decimal margin is not rounded away to a whole number", () => {
  assert.equal(margenTexto(6.99, 9.99), "30.0%")
  assert.notEqual(margenTexto(5.5, 12), "54%")
})

test("strings from form inputs are handled, including currency noise", () => {
  assert.equal(margenBruto("5.50", "12.00").toFixed(2), "54.17")
  assert.equal(aNumero("$5.50"), 5.5)
  assert.equal(aNumero("abc"), null)
})

test("utilidadUnitaria needs both figures and can be negative", () => {
  // Returns a Big — it is money, so it stays exact until formatted.
  assert.equal(utilidadUnitaria(5.5, 12).toFixed(2), "6.50")
  assert.equal(utilidadUnitaria(null, 12), null)
  assert.equal(utilidadUnitaria(12, 10).toFixed(2), "-2.00")
})

test("utilidadUnitaria is exact where a float would drift", () => {
  // 1.15 - 0.7 is 0.44999999999999996 in raw JS
  assert.equal(utilidadUnitaria(0.7, 1.15).toFixed(2), "0.45")
  assert.equal(usd(utilidadUnitaria(0.7, 1.15)), "$0.45")
})

/* ------------------------------------------------------------------ markup */

test("markup is measured against cost, margin against price", () => {
  // 0.50 -> 12.00
  assert.equal(margenTexto(0.5, 12), "95.8%") // share of the sale
  assert.equal(markupTexto(0.5, 12), "24.0×") // price is 24x the cost
  assert.equal(multiplicador(0.5, 12), 24)
})

test("a zero cost has a real margin but NO markup", () => {
  assert.equal(margenBruto(0, 12), 100, "100% of the sale is profit")
  assert.equal(multiplicador(0, 12), null, "cannot multiply zero into a price")
  assert.equal(markupTexto(0, 12), "—")
})

test("markup is unknown when either figure is missing", () => {
  assert.equal(multiplicador(null, 12), null)
  assert.equal(multiplicador(5, null), null)
  assert.equal(markupTexto("", 12), "—")
})

test("selling below cost gives a multiplier under 1", () => {
  assert.equal(multiplicador(12, 10).toFixed(2), "0.83")
  assert.equal(markupTexto(12, 10), "0.8×")
})

test("an ordinary retail pair reads sensibly in both conventions", () => {
  assert.equal(margenTexto(8, 12), "33.3%")
  assert.equal(markupTexto(8, 12), "1.5×")
})
