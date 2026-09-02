/**
 * Dashboard aggregation. Pure functions over rows already fetched, so the
 * bucketing and the margin arithmetic are testable without a database.
 */
import { aNumero, diasVencido } from "./format.js"
import { M, mul, add, sub, div, sumar, centavos, aNumeroJS } from "./dinero.js"

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]

const dia = (iso) => new Date(iso.slice(0, 10) + "T00:00:00")

/** Inclusive-start, exclusive-end window for a period, plus the same window a year back. */
export function ventana(periodo, hoy = new Date()) {
  const y = hoy.getFullYear()
  if (periodo === "anio") {
    return { desde: new Date(y, 0, 1), hasta: new Date(y + 1, 0, 1), previo: -1 }
  }
  if (periodo === "mes") {
    const m = hoy.getMonth()
    return { desde: new Date(y, m, 1), hasta: new Date(y, m + 1, 1), previo: -1 }
  }
  const lunes = new Date(hoy)
  lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7))
  lunes.setHours(0, 0, 0, 0)
  const fin = new Date(lunes)
  fin.setDate(lunes.getDate() + 7)
  return { desde: lunes, hasta: fin, previo: -1 }
}

const desplaza = (d, años) => new Date(d.getFullYear() + años, d.getMonth(), d.getDate())

/** Which bar a date falls in, and how many bars the period has. */
function cubo(periodo, fecha, desde) {
  if (periodo === "anio") return { i: fecha.getMonth(), etiqueta: MESES[fecha.getMonth()] }
  if (periodo === "mes") {
    const i = Math.floor((fecha.getDate() - 1) / 7)
    return { i, etiqueta: `S ${i + 1}` }
  }
  const i = Math.round((fecha - desde) / 86400000)
  return { i, etiqueta: DIAS[fecha.getDay()] }
}

const NUM_CUBOS = { anio: 12, mes: 5, semana: 7 }

/** Las etiquetas de las barras de un periodo: meses, semanas o días. */
export function etiquetasDe(periodo, desde) {
  const n = NUM_CUBOS[periodo]
  return Array.from({ length: n }, (_, i) => {
    if (periodo === "anio") return MESES[i]
    if (periodo === "mes") return `S ${i + 1}`
    const d = new Date(desde)
    d.setDate(desde.getDate() + i)
    return DIAS[d.getDay()]
  })
}

/**
 * Revenue bars: this period against the same window one year earlier.
 * Only issued invoices count — a draft has not been billed.
 */
export function barrasIngresos(facturas, periodo, hoy = new Date()) {
  const { desde, hasta } = ventana(periodo, hoy)
  const desdePrev = desplaza(desde, -1)
  const hastaPrev = desplaza(hasta, -1)
  const n = NUM_CUBOS[periodo]

  const etiquetas = etiquetasDe(periodo, desde)

  // Accumulate in exact decimal; convert to plain numbers only at the end,
  // where they are used for bar HEIGHTS. Money that is displayed stays Big.
  const actualB = Array.from({ length: n }, () => M(0))
  const previoB = Array.from({ length: n }, () => M(0))

  for (const f of facturas) {
    if (f.status === "draft" || !f.date_created) continue
    const d = dia(f.date_created)
    if (d >= desde && d < hasta) {
      const { i } = cubo(periodo, d, desde)
      if (i >= 0 && i < n) actualB[i] = add(actualB[i], f.total)
    } else if (d >= desdePrev && d < hastaPrev) {
      const { i } = cubo(periodo, d, desdePrev)
      if (i >= 0 && i < n) previoB[i] = add(previoB[i], f.total)
    }
  }

  return {
    etiquetas,
    actual: actualB.map(centavos),
    previo: previoB.map(centavos),
    // geometry only — bar heights are percentages, not money
    actualNum: actualB.map(aNumeroJS),
    previoNum: previoB.map(aNumeroJS),
    totalActual: centavos(sumar(actualB)),
    totalPrevio: centavos(sumar(previoB)),
    anioActual: desde.getFullYear(),
    anioPrevio: desdePrev.getFullYear(),
  }
}

/** Percentage change vs the prior period. Null when there is no base to compare to. */
export function variacion(actual, previo) {
  if (M(previo).eq(0)) return null
  const r = div(sub(actual, previo), previo)
  return r === null ? null : Number(r.times(100).toString())
}

/**
 * Receivables by age. Drafts are excluded — nothing is owed until issued.
 * Buckets are ordered oldest-worst last so the ramp reads light -> dark.
 */
const ETIQUETAS_EDAD = ["Por vencer", "1 – 30 días", "31 – 60 días", "+ 60 días"]

export function antiguedad(facturas) {
  const cubos = ETIQUETAS_EDAD.map((k) => ({ k, v: M(0) }))
  for (const f of facturas) {
    if (f.status === "draft") continue
    const pagado = sumar(f.payments ?? [], (p) => p.amount)
    const saldo = centavos(sub(f.total, pagado))
    if (saldo.lte(0)) continue
    const d = diasVencido(f.due_date)
    const i = d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : 3
    cubos[i].v = add(cubos[i].v, saldo)
  }
  return cubos.map((c) => ({ ...c, v: centavos(c.v), num: aNumeroJS(c.v) }))
}

/**
 * Gross margin over the period from invoice lines against product cost.
 *
 * Lines whose product has NO recorded cost are EXCLUDED from both sides and
 * counted separately — the same missing-means-zero trap that made products
 * report a 100% margin. Including them would inflate margin toward 100%.
 * Charges and miscellaneous lines have no cost basis, so they are excluded too.
 */
export function margenPeriodo(lineas, periodo, hoy = new Date()) {
  const { desde, hasta } = ventana(periodo, hoy)
  let ingreso = M(0)
  let costo = M(0)
  let sinCosto = 0

  for (const l of lineas) {
    const inv = l.invoice
    if (!inv || inv.status === "draft" || !inv.date_created) continue
    const d = dia(inv.date_created)
    if (d < desde || d >= hasta) continue
    if (l.type !== "product") continue

    const c = aNumero(l.product?.cost_price)
    if (c === null) {
      sinCosto += 1
      continue
    }
    ingreso = add(ingreso, mul(l.qty, l.unit_price))
    costo = add(costo, mul(l.qty, c))
  }

  const pct = div(sub(ingreso, costo), ingreso)
  return {
    ingreso: centavos(ingreso),
    costo: centavos(costo),
    utilidad: centavos(sub(ingreso, costo)),
    porcentaje: pct === null ? null : Number(pct.times(100).toString()),
    sinCosto,
  }
}

/** Best-selling SKUs in the period, by revenue. */
export function topSkus(lineas, periodo, hoy = new Date(), limite = 5) {
  const { desde, hasta } = ventana(periodo, hoy)
  const mapa = new Map()

  for (const l of lineas) {
    const inv = l.invoice
    if (!inv || inv.status === "draft" || !inv.date_created) continue
    const d = dia(inv.date_created)
    if (d < desde || d >= hasta) continue
    if (l.type !== "product" || !l.product) continue

    const clave = l.product.sku ?? l.product_id
    const actual = mapa.get(clave) ?? {
      sku: l.product.sku,
      nombre: l.product.description || l.product.sku,
      unidades: 0,
      importe: M(0),
    }
    actual.unidades += Number(l.qty ?? 0)
    actual.importe = add(actual.importe, mul(l.qty, l.unit_price))
    mapa.set(clave, actual)
  }

  return [...mapa.values()]
    .map((x) => ({ ...x, importe: centavos(x.importe) }))
    .sort((a, b) => b.importe.cmp(a.importe))
    .slice(0, limite)
}

/** Payments received inside the period. */
export function cobrado(facturas, periodo, hoy = new Date()) {
  const { desde, hasta } = ventana(periodo, hoy)
  let t = M(0)
  for (const f of facturas)
    for (const p of f.payments ?? []) {
      if (!p.date_created) continue
      const d = dia(p.date_created)
      if (d >= desde && d < hasta) t = add(t, p.amount)
    }
  return centavos(t)
}

/** Inventory at cost. SKUs with no recorded cost are counted, never valued at 0. */
export function valorInventario(productos) {
  let valor = M(0)
  let sinCosto = 0
  for (const p of productos) {
    const c = aNumero(p.cost_price)
    if (c === null) {
      sinCosto += 1
      continue
    }
    valor = add(valor, mul(p.stock, c))
  }
  return { valor: centavos(valor), sinCosto, skus: productos.length }
}


/* ========================================================================== *
 * ADAPTADOR DEL RPC
 * ========================================================================== *
 * Las funciones de arriba siguen exportadas y probadas a propósito: son la
 * IMPLEMENTACIÓN DE REFERENCIA contra la que se verifica resumen_dashboard.
 * Si algún día el SQL y el JS dejan de coincidir, la prueba de paridad lo dice.
 *
 * Lo que cambia es de dónde salen los números. Antes el navegador se traía
 * todos los renglones de transaction y sumaba aquí; PostgREST corta en mil
 * filas sin avisar, así que pasadas mil facturas el tablero salía calculado
 * sobre una fracción de los datos. Ahora suma Postgres y esto solo acomoda la
 * respuesta en las mismas formas que ya espera la pantalla.
 *
 * El dinero llega como texto y se envuelve en Big sin pasar por Number: un
 * numeric convertido a double puede devolver 12480.499999999998.
 */

/** Expande la respuesta dispersa del RPC a las formas que usa el render. */
export function desdeRpc(res, periodo, hoy = new Date()) {
  const { desde } = ventana(periodo, hoy)
  const desdePrev = desplaza(desde, -1)
  const n = NUM_CUBOS[periodo]

  // El RPC solo manda las cubetas con movimiento; las demás son cero.
  const actualB = Array.from({ length: n }, () => M(0))
  const previoB = Array.from({ length: n }, () => M(0))
  for (const b of res.barras ?? []) {
    if (b.i >= 0 && b.i < n) {
      actualB[b.i] = M(b.actual)
      previoB[b.i] = M(b.previo)
    }
  }

  const edadesV = Array.from({ length: 4 }, () => M(0))
  for (const a of res.antiguedad ?? []) if (a.i >= 0 && a.i < 4) edadesV[a.i] = M(a.v)

  const ingreso = M(res.margen?.ingreso)
  const costo = M(res.margen?.costo)
  const pct = div(sub(ingreso, costo), ingreso)

  return {
    barras: {
      etiquetas: etiquetasDe(periodo, desde),
      actual: actualB.map(centavos),
      previo: previoB.map(centavos),
      actualNum: actualB.map(aNumeroJS),
      previoNum: previoB.map(aNumeroJS),
      totalActual: centavos(sumar(actualB)),
      totalPrevio: centavos(sumar(previoB)),
      anioActual: desde.getFullYear(),
      anioPrevio: desdePrev.getFullYear(),
    },
    edades: ETIQUETAS_EDAD.map((k, i) => ({
      k,
      v: centavos(edadesV[i]),
      num: aNumeroJS(edadesV[i]),
    })),
    margen: {
      ingreso: centavos(ingreso),
      costo: centavos(costo),
      utilidad: centavos(sub(ingreso, costo)),
      porcentaje: pct === null ? null : Number(pct.times(100).toString()),
      sinCosto: res.margen?.sin_costo ?? 0,
    },
    top: (res.top ?? []).map((t) => ({
      sku: t.sku,
      nombre: t.nombre,
      unidades: t.unidades,
      importe: centavos(M(t.importe)),
    })),
    pagado: centavos(M(res.cobrado)),
    inv: {
      valor: centavos(M(res.inventario?.valor)),
      sinCosto: res.inventario?.sin_costo ?? 0,
      skus: res.inventario?.skus ?? 0,
    },
    numFacturas: res.num_facturas ?? 0,
  }
}

/** Los cuatro parámetros de ventana que espera resumen_dashboard. */
export function argsRpc(periodo, hoy = new Date()) {
  const { desde, hasta } = ventana(periodo, hoy)
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return {
    p_desde: iso(desde),
    p_hasta: iso(hasta),
    p_desde_prev: iso(desplaza(desde, -1)),
    p_hasta_prev: iso(desplaza(hasta, -1)),
    p_periodo: periodo,
  }
}
