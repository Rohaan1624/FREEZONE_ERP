import { test } from "node:test"
import assert from "node:assert/strict"
import {
  aNumero,
  margenBruto,
  utilidadUnitaria,
  margenTexto,
  multiplicador,
  multiplicadorTexto,
  markup,
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
  assert.equal(multiplicadorTexto(0.5, 12), "24.0×") // price is 24x the cost
  assert.equal(multiplicador(0.5, 12), 24)
})

test("a zero cost has a real margin but NO markup", () => {
  assert.equal(margenBruto(0, 12), 100, "100% of the sale is profit")
  assert.equal(multiplicador(0, 12), null, "cannot multiply zero into a price")
  assert.equal(multiplicadorTexto(0, 12), "—")
})

test("markup is unknown when either figure is missing", () => {
  assert.equal(multiplicador(null, 12), null)
  assert.equal(multiplicador(5, null), null)
  assert.equal(multiplicadorTexto("", 12), "—")
})

test("selling below cost gives a multiplier under 1", () => {
  assert.equal(multiplicador(12, 10).toFixed(2), "0.83")
  assert.equal(multiplicadorTexto(12, 10), "0.8×")
})

test("an ordinary retail pair reads sensibly in both conventions", () => {
  assert.equal(margenTexto(8, 12), "33.3%")
  assert.equal(multiplicadorTexto(8, 12), "1.5×")
})

/* ================================================================== *
 * MULTIPLICADOR ≠ MARKUP ≠ MARGEN
 * ================================================================== *
 * Las tres se calculan de los mismos dos números y dan resultados
 * distintos. Confundirlas fue un error real: la pantalla decía
 * «1.4× sobre costo» cuando «sobre costo» significa markup, que con
 * esos números es 40%. Leído así, 1.4× parecía 140% de utilidad —
 * un precio de $12 en vez de $7.
 */

test("las tres medidas de costo $5 a precio $7", () => {
  const costo = 5
  const precio = 7

  // multiplicador: cuántas veces el costo es el precio
  assert.equal(multiplicador(costo, precio), 1.4)
  assert.equal(multiplicadorTexto(costo, precio), "1.4×")

  // margen: qué parte de la VENTA es utilidad
  assert.equal(margenTexto(costo, precio), "28.6%")

  // markup: qué parte del COSTO es utilidad — es 40%, NO 1.4
  const markup = ((precio - costo) / costo) * 100
  assert.equal(markup.toFixed(1), "40.0")
  assert.notEqual(markup.toFixed(1), "1.4")
})

test("multiplicador y markup siempre difieren en exactamente 1", () => {
  // multiplicador = 1 + markup. Por eso etiquetar uno con el nombre del otro
  // desplaza la cifra cien puntos porcentuales.
  for (const [c, p] of [[8, 14.5], [5, 7], [4, 9.9], [22.5, 39], [0.42, 1.1]]) {
    const mult = multiplicador(c, p)
    const markup = (p - c) / c
    assert.ok(Math.abs(mult - (1 + markup)) < 1e-9, `costo ${c} precio ${p}`)
  }
})

test("vender al costo: multiplicador 1, markup 0, margen 0", () => {
  assert.equal(multiplicadorTexto(10, 10), "1.0×")
  assert.equal(margenTexto(10, 10), "0.0%")
})

test("vender por debajo del costo se ve como pérdida en las dos", () => {
  assert.equal(multiplicadorTexto(12, 10), "0.8×") // menos de 1× es pérdida
  assert.equal(margenTexto(12, 10), "-20.0%")
})

/* -------------------------------------------------------- markup en pantalla -- */

test("el caso que se reportó: costo 5.74, precio 7.75", () => {
  // El catálogo mostraba 25.9% (margen) donde se esperaba 35% (markup).
  assert.equal(markupTexto(5.74, 7.75), "35.0%")
  assert.equal(margenTexto(5.74, 7.75), "25.9%")
  // Y el multiplicador redondeaba 1.3502 a «1.4x», escondiendo justo ese 35%.
  assert.equal(multiplicador(5.74, 7.75).toFixed(4), "1.3502")
  assert.equal(multiplicadorTexto(5.74, 7.75), "1.4×")
})

test("markup = multiplicador - 1, siempre", () => {
  for (const [c, p] of [[5.74, 7.75], [8, 14.5], [4, 9.9], [0.42, 1.1]]) {
    assert.ok(Math.abs(markup(c, p) / 100 - (multiplicador(c, p) - 1)) < 1e-9, `${c} -> ${p}`)
  }
})

test("el markup no tiene techo; el margen sí", () => {
  // Vender al triple del costo son 200% de markup pero solo 66.7% de margen.
  assert.equal(markupTexto(10, 30), "200.0%")
  assert.equal(margenTexto(10, 30), "66.7%")
})

test("vender al costo y vender con pérdida", () => {
  assert.equal(markupTexto(10, 10), "0.0%")
  assert.equal(markupTexto(12, 10), "-16.7%")
})

test("sin costo no hay markup, aunque el margen sí exista", () => {
  assert.equal(markupTexto(0, 12), "—")
  assert.equal(markupTexto(null, 12), "—")
  assert.equal(markupTexto("", 12), "—")
  // Mercancía gratis: no hay porcentaje que suba desde cero, pero el margen
  // es un 100% perfectamente real.
  assert.equal(margenTexto(0, 12), "100.0%")
})
