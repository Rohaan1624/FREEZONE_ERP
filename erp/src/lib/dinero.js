import Big from "big.js"

/**
 * Exact decimal money for the display layer.
 *
 * Postgres stores every money column as numeric(12,2) and recomputes every
 * derived total server-side, so nothing JavaScript calculates is ever
 * persisted. But the previews the user reads while typing were still IEEE-754
 * doubles: 7 x 1.15 came out 8.049999999999999, and Math.round(1.005*100)/100
 * rounded DOWN to 1.00 because 1.005 has no exact binary representation.
 *
 * big.js gives arbitrary-precision decimal, so the on-screen figure matches
 * what the database will store.
 *
 * Note: the package called `money.js` is a currency CONVERTER (FX rates), not
 * a decimal arithmetic library — a common mix-up.
 *
 * Rounding is HALF UP, which is what invoicing expects: 1.005 -> 1.01.
 * (Postgres numeric rounds half up too, so the two agree.)
 */
Big.RM = Big.roundHalfUp
Big.DP = 20 // guard digits for division; only ever displayed rounded

const CERO = new Big(0)

/**
 * Coerce anything to a Big. Blank / null / unparseable become 0 — use
 * aNumero() from format.js first when you need "missing" to stay distinct
 * from "zero" (margins care about that; a running total does not).
 */
export function M(v) {
  if (v instanceof Big) return v
  if (v === null || v === undefined) return CERO
  const limpio = String(v).replace(/[^0-9.-]/g, "").trim()
  if (limpio === "" || limpio === "-" || limpio === "." || limpio === "-.") return CERO
  try {
    return new Big(limpio)
  } catch {
    return CERO
  }
}

export const mul = (a, b) => M(a).times(M(b))
export const add = (a, b) => M(a).plus(M(b))
export const sub = (a, b) => M(a).minus(M(b))

/** Divide, or null when the divisor is zero — never Infinity or NaN. */
export function div(a, b) {
  const d = M(b)
  return d.eq(0) ? null : M(a).div(d)
}

/** Sum a list, optionally through a selector. Always exact. */
export function sumar(lista, fn = (x) => x) {
  let t = CERO
  for (const x of lista) t = t.plus(M(fn(x)))
  return t
}

/** Round to cents, half up. Returns a Big. */
export const centavos = (v) => M(v).round(2, Big.roundHalfUp)

export const esCero = (v) => M(v).eq(0)
export const esNegativo = (v) => M(v).lt(0)
export const mayorQue = (a, b) => M(a).gt(M(b))

/** Plain JS number — for chart geometry and widths only, never for storage. */
export const aNumeroJS = (v) => Number(M(v).toString())

/** '1,234.50' — exact, grouped, always two decimals. */
export function n2(v) {
  const b = centavos(v)
  const negativo = b.lt(0)
  const [ent, dec] = b.abs().toFixed(2).split(".")
  const agrupado = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${negativo ? "-" : ""}${agrupado}.${dec}`
}

/** '1,235' — exact, grouped, no decimals. */
export function n0(v) {
  const b = M(v).round(0, Big.roundHalfUp)
  const negativo = b.lt(0)
  return (
    (negativo ? "-" : "") + b.abs().toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  )
}

export const usd = (v) => "$" + n2(v)
export const usd0 = (v) => "$" + n0(v)

export { Big }
