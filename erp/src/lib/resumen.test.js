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
  desdeRpc,
  argsRpc,
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

/* ====================================================================== *
 * ADAPTADOR DEL RPC
 * ====================================================================== *
 * La paridad SQL↔JS se verifica contra Postgres (ver backend/prueba-resumen.sql).
 * Aquí se fija la otra mitad: que la respuesta del RPC se expanda a EXACTAMENTE
 * las mismas formas que producían las funciones de referencia, para que el
 * render no note el cambio.
 */

test("desdeRpc expande las cubetas dispersas a arreglos densos", () => {
  const r = desdeRpc(
    { barras: [{ i: 0, actual: "1450.00", previo: "0" }, { i: 6, actual: "11130.00", previo: "4350.00" }] },
    "anio",
    HOY
  )
  assert.equal(r.barras.actual.length, 12)
  assert.equal(r.barras.actual[0].toFixed(2), "1450.00")
  assert.equal(r.barras.actual[6].toFixed(2), "11130.00")
  assert.equal(r.barras.actual[5].toFixed(2), "0.00") // cubeta ausente = cero
  assert.equal(r.barras.previo[6].toFixed(2), "4350.00")
  assert.equal(r.barras.totalActual.toFixed(2), "12580.00")
  assert.equal(r.barras.anioActual, 2026)
  assert.equal(r.barras.anioPrevio, 2025)
})

test("desdeRpc produce las mismas formas que las funciones de referencia", () => {
  // Mismos datos por los dos caminos: filas crudas -> funciones viejas, y la
  // respuesta equivalente del RPC -> adaptador.
  const facturas = [
    { status: "active", total: "1450.00", date_created: "2026-01-15", due_date: "2026-02-14", payments: [] },
    { status: "active", total: "11130.00", date_created: "2026-07-20", due_date: "2026-08-19",
      payments: [{ amount: "1000.00", date_created: "2026-08-05" }] },
  ]
  const ref = barrasIngresos(facturas, "anio", HOY)
  const rpc = desdeRpc(
    { barras: [{ i: 0, actual: "1450.00", previo: "0" }, { i: 6, actual: "11130.00", previo: "0" }] },
    "anio",
    HOY
  )
  assert.deepEqual(rpc.barras.etiquetas, ref.etiquetas)
  assert.equal(rpc.barras.totalActual.toFixed(2), ref.totalActual.toFixed(2))
  assert.deepEqual(rpc.barras.actualNum, ref.actualNum)
})

test("desdeRpc calcula utilidad y porcentaje del margen en JS", () => {
  const r = desdeRpc({ margen: { ingreso: "12130.00", costo: "6400.00", sin_costo: 1 } }, "anio", HOY)
  assert.equal(r.margen.utilidad.toFixed(2), "5730.00")
  assert.equal(r.margen.porcentaje.toFixed(1), "47.2")
  assert.equal(r.margen.sinCosto, 1)
})

test("sin ingreso el porcentaje es null, no NaN ni 100%", () => {
  const r = desdeRpc({ margen: { ingreso: "0", costo: "0", sin_costo: 0 } }, "anio", HOY)
  assert.equal(r.margen.porcentaje, null)
})

test("las cuatro cubetas de antigüedad siempre existen y en orden", () => {
  const r = desdeRpc({ antiguedad: [{ i: 1, v: "10130.00" }] }, "anio", HOY)
  assert.equal(r.edades.length, 4)
  assert.deepEqual(r.edades.map((e) => e.k), ["Por vencer", "1 – 30 días", "31 – 60 días", "+ 60 días"])
  assert.equal(r.edades[1].v.toFixed(2), "10130.00")
  assert.equal(r.edades[0].v.toFixed(2), "0.00")
})

test("una respuesta vacía no truena: todo en cero", () => {
  const r = desdeRpc({}, "anio", HOY)
  assert.equal(r.barras.totalActual.toFixed(2), "0.00")
  assert.equal(r.edades.length, 4)
  assert.deepEqual(r.top, [])
  assert.equal(r.pagado.toFixed(2), "0.00")
  assert.equal(r.inv.skus, 0)
  assert.equal(r.numFacturas, 0)
})

test("el dinero pasa por Big sin tocar Number", () => {
  // Un numeric convertido a double puede volver como 12480.499999999998.
  const r = desdeRpc({ cobrado: "12480.50", inventario: { valor: "0.1", sin_costo: 0, skus: 1 } }, "anio", HOY)
  assert.equal(r.pagado.toFixed(2), "12480.50")
  assert.equal(r.inv.valor.toString(), "0.1")
})

test("argsRpc manda la ventana local, sin correrse por zona horaria", () => {
  const a = argsRpc("anio", HOY)
  assert.deepEqual(a, {
    p_desde: "2026-01-01",
    p_hasta: "2027-01-01",
    p_desde_prev: "2025-01-01",
    p_hasta_prev: "2026-01-01",
    p_periodo: "anio",
  })
})

test("argsRpc para mes y semana", () => {
  assert.deepEqual(
    { ...argsRpc("mes", HOY) },
    { p_desde: "2026-08-01", p_hasta: "2026-09-01", p_desde_prev: "2025-08-01", p_hasta_prev: "2025-09-01", p_periodo: "mes" }
  )
  // El 25 de agosto de 2026 es martes -> la semana arranca el lunes 24.
  assert.equal(argsRpc("semana", HOY).p_desde, "2026-08-24")
  assert.equal(argsRpc("semana", HOY).p_hasta, "2026-08-31")
})
