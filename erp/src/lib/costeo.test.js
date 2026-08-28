import { test } from "node:test"
import assert from "node:assert/strict"

import { costeo } from "./costeo.js"

const producto = (qty, cost_unit) => ({ type: "product", qty, cost_unit })
const gasto = (monto) => ({ type: "charge", qty: 1, cost_unit: monto })

// El caso del que salió el método: 1,000 a $8 y 500 a $4, con $2,000 de gastos.
const MIXTA = [producto(1000, 8), producto(500, 4), gasto(2000)]

test("los totales salen de los renglones", () => {
  const c = costeo(MIXTA)
  assert.equal(c.mercancia.toFixed(2), "10000.00")
  assert.equal(c.gastos.toFixed(2), "2000.00")
  assert.equal(c.total.toFixed(2), "12000.00")
  assert.equal(c.unidades.toFixed(0), "1500")
})

test("el factor es (mercancía + gastos) / mercancía", () => {
  assert.equal(costeo(MIXTA).factor.toFixed(4), "1.2000")
})

test("por valor, todo sube el mismo porcentaje", () => {
  const c = costeo(MIXTA)
  assert.equal(c.aterrizado(MIXTA[0]).toFixed(2), "9.60") // 8.00 +20%
  assert.equal(c.aterrizado(MIXTA[1]).toFixed(2), "4.80") // 4.00 +20%
})

test("el reparto plano habría castigado al SKU barato", () => {
  // Contraste explícito con el método que se reemplazó: gastos/unidades sumaba
  // 1.3333 a cada unidad, +16.7% al de $8 y +33.3% al de $4.
  const plano = 2000 / 1500
  assert.ok(Math.abs(8 + plano - 9.33) < 0.01)
  assert.ok(Math.abs(4 + plano - 5.33) < 0.01)
  const c = costeo(MIXTA)
  assert.notEqual(c.aterrizado(MIXTA[1]).toFixed(2), (4 + plano).toFixed(2))
})

test("cada renglón absorbe su proporción exacta de los gastos", () => {
  const c = costeo(MIXTA)
  assert.equal(c.absorbido(MIXTA[0]).toFixed(2), "1600.00") // 80% de 2,000
  assert.equal(c.absorbido(MIXTA[1]).toFixed(2), "400.00") //  20% de 2,000
})

test("lo repartido suma exactamente los gastos", () => {
  const c = costeo(MIXTA)
  const repartido = c.absorbido(MIXTA[0]).plus(c.absorbido(MIXTA[1]))
  assert.equal(repartido.toFixed(2), c.gastos.toFixed(2))
})

test("reconcilia: sum(qty x aterrizado) = mercancía + gastos", () => {
  // La propiedad que hace confiable el método — se cumple con cantidades y
  // costos que en punto flotante no cerrarían.
  const lineas = [producto(7, "1.15"), producto(3, "0.07"), producto(11, "19.99"), gasto("333.33")]
  const c = costeo(lineas)
  let t = c.aterrizado(lineas[0]).times(7)
  t = t.plus(c.aterrizado(lineas[1]).times(3))
  t = t.plus(c.aterrizado(lineas[2]).times(11))
  assert.equal(t.toFixed(2), c.total.toFixed(2))
})

test("sin gastos el factor es 1 y el costo no se mueve", () => {
  const lineas = [producto(10, "5.50")]
  const c = costeo(lineas)
  assert.equal(c.factor.toFixed(4), "1.0000")
  assert.equal(c.aterrizado(lineas[0]).toFixed(2), "5.50")
  assert.equal(c.absorbido(lineas[0]).toFixed(2), "0.00")
})

test("sin mercancía no hay base: no se prorratea, no se divide entre cero", () => {
  const c = costeo([gasto(500)])
  assert.equal(c.factor, null)
  assert.equal(c.prorrateable, false)
  assert.equal(c.total.toFixed(2), "500.00")
})

test("mercancía de puro costo 0 tampoco da base", () => {
  const lineas = [producto(100, 0), gasto(500)]
  const c = costeo(lineas)
  assert.equal(c.prorrateable, false)
  assert.equal(c.aterrizado(lineas[0]).toFixed(2), "0.00")
})

test("campos en blanco o basura cuentan como 0, no como NaN", () => {
  const c = costeo([producto("", ""), producto("10", "2.00"), gasto("abc")])
  assert.equal(c.mercancia.toFixed(2), "20.00")
  assert.equal(c.gastos.toFixed(2), "0.00")
  assert.equal(c.factor.toFixed(4), "1.0000")
})

test("acepta lo que teclea el usuario: strings con símbolos", () => {
  const lineas = [producto("1,000", "$8.00"), gasto("$2,000")]
  const c = costeo(lineas)
  assert.equal(c.mercancia.toFixed(2), "8000.00")
  assert.equal(c.aterrizado(lineas[0]).toFixed(2), "10.00") // 8 x 1.25
})

test("un renglón gratis no absorbe gastos", () => {
  // Consecuencia del método: por valor, una muestra a costo 0 aporta 0 y
  // absorbe 0. Queda documentado porque sorprende.
  const lineas = [producto(100, 10), producto(50, 0), gasto(200)]
  const c = costeo(lineas)
  assert.equal(c.absorbido(lineas[1]).toFixed(2), "0.00")
  assert.equal(c.absorbido(lineas[0]).toFixed(2), "200.00")
})

test("sin renglones no truena", () => {
  const c = costeo([])
  assert.equal(c.total.toFixed(2), "0.00")
  assert.equal(c.prorrateable, false)
})
