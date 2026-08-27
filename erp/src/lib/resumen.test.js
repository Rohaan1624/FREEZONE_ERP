import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ventana,
  barrasIngresos,
  variacion,
  antiguedad,
  margenPeriodo,
  topSkus,
  cobrado,
  valorInventario,
} from "./resumen.js"

const HOY = new Date(2026, 7, 25) // 25 ago 2026, a Tuesday

const inv = (o) => ({ status: "active", payments: [], ...o })

test("ventana: año = 1 ene to 1 ene", () => {
  const { desde, hasta } = ventana("anio", HOY)
  assert.equal(desde.toISOString().slice(0, 10), "2026-01-01")
  assert.equal(hasta.toISOString().slice(0, 10), "2027-01-01")
})

test("ventana: semana starts on Monday", () => {
  const { desde, hasta } = ventana("semana", HOY)
  assert.equal(desde.getDay(), 1, "Monday")
  assert.equal(Math.round((hasta - desde) / 86400000), 7)
})

test("drafts are never counted as revenue", () => {
  const b = barrasIngresos(
    [
      inv({ date_created: "2026-03-10", total: 100 }),
      inv({ date_created: "2026-03-11", total: 999, status: "draft" }),
    ],
    "anio",
    HOY
  )
  assert.equal(b.totalActual.toFixed(2), "100.00")
})

test("closed invoices DO count — they were billed", () => {
  const b = barrasIngresos([inv({ date_created: "2026-03-10", total: 100, status: "closed" })], "anio", HOY)
  assert.equal(b.totalActual.toFixed(2), "100.00")
})

test("last year's invoices land in the comparison series, not this year's", () => {
  const b = barrasIngresos(
    [
      inv({ date_created: "2026-03-10", total: 100 }),
      inv({ date_created: "2025-03-10", total: 80 }),
    ],
    "anio",
    HOY
  )
  assert.equal(b.actual[2].toFixed(2), "100.00") // March
  assert.equal(b.previo[2].toFixed(2), "80.00")
  assert.equal(b.totalActual.toFixed(2), "100.00")
  assert.equal(b.totalPrevio.toFixed(2), "80.00")
  assert.equal(b.anioActual, 2026)
  assert.equal(b.anioPrevio, 2025)
})

test("a date outside both windows is ignored entirely", () => {
  const b = barrasIngresos([inv({ date_created: "2020-03-10", total: 500 })], "anio", HOY)
  assert.equal(b.totalActual.toFixed(2), "0.00")
  assert.equal(b.totalPrevio.toFixed(2), "0.00")
})

test("variación handles a zero base instead of returning Infinity", () => {
  assert.equal(variacion(100, 0), null)
  assert.equal(variacion(120, 100), 20)
  assert.equal(variacion(80, 100), -20)
})

test("antigüedad buckets by days overdue and skips paid invoices", () => {
  const a = antiguedad([
    inv({ total: 100, due_date: "2026-12-31" }), // por vencer
    inv({ total: 100, due_date: "2026-08-10" }), // 15 días
    inv({ total: 100, due_date: "2026-07-10" }), // 46 días
    inv({ total: 100, due_date: "2026-01-10" }), // +60
    inv({ total: 100, due_date: "2026-01-10", payments: [{ amount: 100 }] }), // pagada
    inv({ total: 999, due_date: "2020-01-01", status: "draft" }), // borrador
  ])
  assert.deepEqual(
    a.map((x) => x.v.toFixed(2)),
    ["100.00", "100.00", "100.00", "100.00"]
  )
})

test("a partial payment ages only the outstanding balance", () => {
  const a = antiguedad([inv({ total: 100, due_date: "2026-08-10", payments: [{ amount: 70 }] })])
  assert.equal(a[1].v.toFixed(2), "30.00")
})

test("MARGIN: lines whose product has no cost are excluded, not treated as free", () => {
  const linea = (cost, qty, price) => ({
    type: "product",
    qty,
    unit_price: price,
    product: { sku: "W", description: "W", cost_price: cost },
    invoice: { status: "active", date_created: "2026-03-01" },
  })
  const m = margenPeriodo([linea(6, 10, 10), linea(null, 10, 10)], "anio", HOY)
  assert.equal(m.ingreso.toFixed(2), "100.00", "only the costed line counts toward revenue")
  assert.equal(m.costo.toFixed(2), "60.00")
  assert.equal(m.porcentaje, 40)
  assert.equal(m.sinCosto, 1, "the uncosted line is reported, not silently included")
})

test("MARGIN: including an uncosted line would have inflated it to 70%", () => {
  // the naive version: revenue 200, cost 60 -> 70%. The correct answer is 40%.
  const linea = (cost) => ({
    type: "product",
    qty: 10,
    unit_price: 10,
    product: { cost_price: cost },
    invoice: { status: "active", date_created: "2026-03-01" },
  })
  const m = margenPeriodo([linea(6), linea(null)], "anio", HOY)
  assert.notEqual(m.porcentaje, 70)
  assert.equal(m.porcentaje, 40)
})

test("MARGIN: charges and misceláneos have no cost basis and are excluded", () => {
  const base = { qty: 1, unit_price: 500, invoice: { status: "active", date_created: "2026-03-01" } }
  const m = margenPeriodo(
    [
      { ...base, type: "charge", product: null },
      { ...base, type: "miscellaneous", product: null },
    ],
    "anio",
    HOY
  )
  assert.equal(m.ingreso.toFixed(2), "0.00")
  assert.equal(m.porcentaje, null)
})

test("topSkus ranks by revenue and merges repeated lines", () => {
  const l = (sku, qty, price) => ({
    type: "product",
    qty,
    unit_price: price,
    product: { sku, description: sku },
    invoice: { status: "active", date_created: "2026-03-01" },
  })
  const t = topSkus([l("A", 1, 100), l("B", 10, 50), l("A", 1, 100)], "anio", HOY)
  assert.equal(t[0].sku, "B")
  assert.equal(t[1].sku, "A")
  assert.equal(t[1].unidades, 2, "the two A lines merge")
  assert.equal(t[1].importe.toFixed(2), "200.00")
})

test("cobrado counts payments by their own date, not the invoice's", () => {
  const c = cobrado(
    [
      inv({
        date_created: "2025-12-01", // last year's invoice
        total: 500,
        payments: [{ amount: 300, date_created: "2026-02-01" }], // paid this year
      }),
    ],
    "anio",
    HOY
  )
  assert.equal(c.toFixed(2), "300.00")
})

test("inventory never values an uncosted SKU at zero", () => {
  const v = valorInventario([
    { stock: 10, cost_price: 5 },
    { stock: 100, cost_price: null },
  ])
  assert.equal(v.valor.toFixed(2), "50.00")
  assert.equal(v.sinCosto, 1)
  assert.equal(v.skus, 2)
})


/* ------------------------------------------------------- exactitud decimal */

test("EXACTNESS: revenue bars sum exactly, no float residue", () => {
  // 3 invoices of 8.05 (the 7 x 1.15 case) -> 24.15, not 24.149999999999995
  const fs = ["2026-03-01", "2026-03-02", "2026-03-03"].map((d) =>
    inv({ date_created: d, total: 8.05 })
  )
  const b = barrasIngresos(fs, "anio", HOY)
  assert.equal(b.totalActual.toFixed(2), "24.15")
  assert.equal(b.actual[2].toFixed(2), "24.15")
})

test("EXACTNESS: an aging bucket of 0.1 + 0.2 is 0.30", () => {
  const a = antiguedad([
    inv({ total: 0.1, due_date: "2026-12-31" }),
    inv({ total: 0.2, due_date: "2026-12-31" }),
  ])
  assert.equal(a[0].v.toFixed(2), "0.30")
})

test("EXACTNESS: an invoice paid to the cent reads as settled, not 1e-15 owing", () => {
  const a = antiguedad([
    inv({
      total: 8.05,
      due_date: "2026-01-01",
      payments: [{ amount: 1.15 }, { amount: 6.9 }],
    }),
  ])
  assert.deepEqual(a.map((x) => x.v.toFixed(2)), ["0.00", "0.00", "0.00", "0.00"])
})

test("variación tolerates a zero base without dividing by it", () => {
  assert.equal(variacion(100, 0), null)
  assert.equal(variacion("120.00", "100.00"), 20)
})
