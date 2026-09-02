import { M, div, sub, sumar, centavos } from "./dinero.js"

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

// Formatting comes from dinero.js so the printed figure is the exact decimal,
// not a float that happened to survive toLocaleString.
export { n2, n0, usd, usd0 } from "./dinero.js"

/** '2026-08-25' or an ISO timestamp -> '25 ago 2026' */
export function fecha(iso) {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return `${d} ${MESES[m - 1]} ${y}`
}

export function hoyISO() {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
}

export function masDias(iso, dias) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  const t = new Date(y, m - 1, d + Number(dias || 0))
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
}

/** Days an invoice is past due. Negative = not due yet. */
export function diasVencido(dueISO) {
  if (!dueISO) return 0
  const [y, m, d] = dueISO.slice(0, 10).split("-").map(Number)
  return Math.round((new Date() - new Date(y, m - 1, d)) / 86400000)
}

/**
 * The backend stores draft / active / closed. What staff actually want to see
 * is whether it is PAID — which is derived from payments against the total,
 * not stored anywhere. Both are real; this merges them for display.
 */
export function estadoFactura(inv) {
  // Big all the way: a balance is compared against zero to decide "Pagada",
  // and a float residue of 0.0000000001 would keep an invoice open forever.
  const total = centavos(inv.total)
  const pagado = centavos(sumar(inv.payments ?? [], (p) => p.amount))
  const bruto = sub(total, pagado)
  const saldo = bruto.lt(0) ? M(0) : bruto

  if (inv.status === "draft") return { etiqueta: "Borrador", tono: "borrador", saldo, pagado }
  if (saldo.eq(0)) return { etiqueta: "Pagada", tono: "pagada", saldo, pagado }
  if (diasVencido(inv.due_date) > 0) return { etiqueta: "Vencida", tono: "vencida", saldo, pagado }
  if (pagado.gt(0)) return { etiqueta: "Parcial", tono: "parcial", saldo, pagado }
  return { etiqueta: "Pendiente", tono: "pendiente", saldo, pagado }
}

/**
 * El estado se dice con color y peso tipográfico, no con una pastilla: una
 * columna de píldoras negras pesa más que los importes, que es lo que
 * realmente se viene a leer. Vencida es lo único con color en la pantalla,
 * y por eso se ve desde la puerta.
 */
export const TONO_TEXTO = {
  Vencida: "text-destructive font-semibold",
  Parcial: "text-ink",
  Pendiente: "text-ink",
  Pagada: "text-neutral-600",
  Borrador: "text-neutral-600 italic",
}

/* -------------------------------------------------------------- márgenes -- */

/**
 * Coerce to a number, but keep "not given" distinct from zero.
 * Number(null) and Number("") are both 0, which is why a product with no cost
 * recorded used to report a 100% margin. A missing cost is UNKNOWN, not free.
 */
export function aNumero(v) {
  if (v === null || v === undefined) return null
  // Strip currency noise, then check what is LEFT. Number("") is 0, so without
  // this guard "abc" and "$" would both read as a cost of zero — the same
  // missing-means-zero trap, one layer down.
  const limpio = String(v).replace(/[^0-9.-]/g, "").trim()
  if (limpio === "" || limpio === "-" || limpio === "." || limpio === "-.") return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

/**
 * Gross margin as a percentage OF THE SALE PRICE: (precio - costo) / precio.
 * That is the accounting sense of "margen" — not markup over cost, which would
 * be (precio - costo) / costo and gives a much larger number for the same pair.
 *
 * Returns null when it cannot be computed: either figure missing, or a sale
 * price of 0. A cost of exactly 0 IS computable — that is a 100% margin.
 * Negative means you are selling below cost, and is returned as-is.
 */
export function margenBruto(costo, precio) {
  const c = aNumero(costo)
  const v = aNumero(precio)
  if (c === null || v === null || v === 0) return null
  const r = div(sub(v, c), v)
  return r === null ? null : Number(r.times(100).toString())
}

/** Money made per unit. Null unless both figures are known. */
export function utilidadUnitaria(costo, precio) {
  const c = aNumero(costo)
  const v = aNumero(precio)
  if (c === null || v === null) return null
  return sub(v, c) // a Big — usd() formats it exactly
}

/** Margin for display: '54.2%', '-8.5%', or '—' when it cannot be known. */
export function margenTexto(costo, precio) {
  const m = margenBruto(costo, precio)
  return m === null ? "—" : `${m.toFixed(1)}%`
}

/**
 * MARKUP: qué tanto se le sube al costo para llegar al precio.
 *
 *   markup = (precio - costo) / costo    5.74 -> 7.75 da 35.0%
 *
 * Es la cifra con la que se PONE el precio («al costo le meto 35»), y por eso
 * es la que va grande en el catálogo. El margen contesta otra pregunta —qué
 * parte de la venta es utilidad— y con los mismos números da 25.9%.
 *
 * Null cuando no se puede saber, incluyendo costo exactamente 0: no hay
 * porcentaje que suba desde cero hasta un precio.
 */
export function markup(costo, precio) {
  const c = aNumero(costo)
  const v = aNumero(precio)
  if (c === null || v === null || c === 0) return null
  const r = div(sub(v, c), c)
  return r === null ? null : Number(r.times(100).toString())
}

/** El markup para pantalla: '35.0%' o '—'. */
export function markupTexto(costo, precio) {
  const m = markup(costo, precio)
  return m === null ? "—" : `${m.toFixed(1)}%`
}

/**
 * MULTIPLICADOR: cuántas veces el costo es el precio.
 *
 *   multiplicador = precio / costo             5.00 -> 7.00 da 1.4x
 *   markup        = (precio - costo) / costo   los mismos datos dan 40%
 *   margen        = (precio - costo) / precio  los mismos datos dan 28.6%
 *
 * LAS TRES SON DISTINTAS y se confunden con facilidad. Esta función devuelve
 * la PRIMERA, que es la que un comerciante usa al hablar («lo vendo a 1.4»),
 * porque en porcentaje se vuelve ilegible rápido: 0.50 -> 12.00 es un markup
 * de 2300%, pero un llano 24x.
 *
 * YA NO SE PINTA EN EL CATÁLOGO, y la razón vale registrarla: con costo 5.74
 * y precio 7.75 el multiplicador es 1.3502 y a un decimal se redondea a
 * «1.4x». Ese 1.35 ES el markup de 35% (multiplicador = 1 + markup), pero el
 * redondeo lo escondía justo cuando más se parecía a la cifra buscada. En
 * porcentaje no hay dónde esconderlo. Se conserva la función porque la
 * distinción entre las tres medidas es real y las pruebas la documentan.
 *
 * Null cuando no se puede saber, INCLUYENDO costo exactamente 0: la mercancía
 * gratis no tiene multiplicador (no hay número que multiplique a cero hasta el
 * precio), aunque su margen sí sea un 100% perfectamente real.
 */
export function multiplicador(costo, precio) {
  const c = aNumero(costo)
  const v = aNumero(precio)
  if (c === null || v === null || c === 0) return null
  const r = div(v, c)
  return r === null ? null : Number(r.toString())
}

/** El multiplicador para pantalla: '24.0×', '1.5×' o '—'. */
export function multiplicadorTexto(costo, precio) {
  const m = multiplicador(costo, precio)
  return m === null ? "—" : `${m.toFixed(1)}×`
}
