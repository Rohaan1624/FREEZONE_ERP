/**
 * Invoice line state. Pure functions, no React — so the qty/bultos arithmetic
 * and the add/edit/remove rules can be tested directly.
 *
 * THE RULE THAT MATTERS: qty is the raw sellable quantity and is the only
 * thing the backend moves stock on.
 *
 * For a PRODUCT, bultos is a second way of SAYING that quantity — converted
 * through piezasPorBulto (product.qty_unit), so editing one recomputes the
 * other and they can never disagree.
 *
 * For a MISCELLANEOUS line there is no product and therefore no conversion
 * factor, so the two are captured independently and neither is inferred.
 *
 * Every line carries a stable `id`. Rows are keyed and edited by that id, never
 * by array index — the visible list is filtered by tab, so an index means a
 * different line depending on which tab you are looking at.
 */

import { M, mul, sumar, centavos } from "./dinero.js"

let contador = 0
const nuevoId = () => `l${++contador}_${Date.now().toString(36)}`

export const TIPOS = ["product", "miscellaneous", "charge"]

/** Does this line type carry packages and a unit of measure? Charges do not. */
export const llevaBultos = (type) => type !== "charge"

/**
 * Can bultos and qty be derived from each other? Only for catalogue products,
 * where product.qty_unit says how many units are in a package.
 *
 * A miscellaneous line has no product behind it, so there is no conversion
 * factor and no way to compute either from the other — 3 crates of an off-book
 * item could be any number of pieces. Both fields are captured independently.
 */
export const convierteBultos = (type) => type === "product"

const numero = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""))
  return Number.isFinite(n) ? n : 0
}
const redondea = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d

export function lineaDeProducto(p) {
  const piezasPorBulto = Number(p.qty_unit) > 0 ? Number(p.qty_unit) : 1
  return {
    id: nuevoId(),
    type: "product",
    product_id: p.id,
    sku: p.sku,
    nombre: p.description || p.sku,
    stock: Number(p.stock ?? 0),
    piezasPorBulto,
    modo: "qty",
    qty: 1,
    bultos: redondea(1 / piezasPorBulto),
    unit: p.unit || "PZA",
    description: "",
    unit_price: p.sale_price ?? "",
  }
}

export function lineaSuelta(type) {
  return {
    id: nuevoId(),
    type,
    product_id: null,
    sku: "",
    nombre: "",
    stock: null,
    piezasPorBulto: 1,
    modo: "qty",
    qty: 1,
    bultos: llevaBultos(type) ? "" : null,
    unit: llevaBultos(type) ? "PZA" : "",
    description: "",
    unit_price: "",
  }
}

/**
 * Apply a patch and re-derive the partner field.
 *   modo 'qty'    -> the user types units,   bultos is computed
 *   modo 'bultos' -> the user types packages, qty is computed (and integral,
 *                    because transaction.qty is an integer column)
 */
export function sincroniza(linea, patch = {}) {
  const l = { ...linea, ...patch }
  if (!llevaBultos(l.type)) return { ...l, bultos: null, unit: "" }
  // Miscellaneous: nothing to convert with, so whatever was typed stands.
  if (!convierteBultos(l.type)) return l

  const por = Number(l.piezasPorBulto) > 0 ? Number(l.piezasPorBulto) : 1

  if ("bultos" in patch || (patch.modo === "bultos" && !("qty" in patch))) {
    l.qty = Math.round(numero(l.bultos) * por)
  } else if ("qty" in patch || "piezasPorBulto" in patch || patch.modo === "qty") {
    l.bultos = redondea(numero(l.qty) / por)
  }
  return l
}

export const agrega = (lineas, linea) => lineas.concat([linea])

/** Adding a product already on the invoice bumps it instead of duplicating. */
export function agregaProducto(lineas, p) {
  const i = lineas.findIndex((l) => l.type === "product" && l.product_id === p.id)
  if (i < 0) return agrega(lineas, lineaDeProducto(p))
  const copia = lineas.slice()
  copia[i] = sincroniza(copia[i], { qty: numero(copia[i].qty) + 1, modo: "qty" })
  return copia
}

export const actualiza = (lineas, id, patch) =>
  lineas.map((l) => (l.id === id ? sincroniza(l, patch) : l))

export const elimina = (lineas, id) => lineas.filter((l) => l.id !== id)

/** Filter for display. Returns the SAME line objects — never a copy, never a mutation. */
export const porTipo = (lineas, type) => lineas.filter((l) => l.type === type)

/**
 * Line amount and totals in exact decimal (big.js), not floats.
 * 7 x 1.15 is 8.05 here; in IEEE-754 it is 8.049999999999999, and a hundred
 * such lines summed to 804.9999999999989 instead of 805.
 * These return Big — usd() / n2() format them exactly.
 */
export const importe = (l) => centavos(mul(l.qty, l.unit_price))
export const total = (lineas) => centavos(sumar(lineas, importe))
export const subtotalTipo = (lineas, type) => total(porTipo(lineas, type))

/** Lines that still need something before the invoice can be sent. */
export function incompletas(lineas) {
  return lineas.filter(
    (l) =>
      numero(l.qty) <= 0 ||
      String(l.unit_price ?? "") === "" ||
      (l.type === "product" ? !l.product_id : !String(l.description ?? "").trim())
  )
}

/**
 * Product lines asking for more than is available. Only matters when issuing.
 *
 * `yaReservado` maps product_id -> quantity THIS document already holds. When
 * editing an invoice that is already active its units are gone from
 * product.stock, so the naive `qty > stock` test warns about an edit the
 * server accepts: 100 free + 50 already on this invoice = 150 available.
 * Empty for a new invoice or a draft, which reserve nothing.
 */
export const sinExistencia = (lineas, yaReservado = {}) =>
  porTipo(lineas, "product").filter(
    (l) => numero(l.qty) > disponible(l, yaReservado)
  )

/** Units this line can draw on: free stock plus what this document already holds. */
export const disponible = (l, yaReservado = {}) =>
  Number(l.stock ?? 0) + Number(yaReservado[l.product_id] ?? 0)

/** Shape create_invoice / update_invoice expect in p_lines. */
export function aPayload(lineas) {
  return lineas.map((l) => ({
    type: l.type,
    product_id: l.type === "product" ? l.product_id : null,
    description: l.type === "product" ? null : String(l.description ?? "").trim(),
    qty: Math.round(numero(l.qty)),
    // The backend nulls these for charges anyway; sent null here so the
    // request says the same thing the database will store.
    // Blank stays blank: the column is nullable, and a miscellaneous line the
    // user did not count in packages should say "unknown", not "zero".
    bultos:
      llevaBultos(l.type) && String(l.bultos ?? "") !== ""
        ? Number(M(l.bultos).toString())
        : null,
    unit: llevaBultos(l.type) ? String(l.unit ?? "").trim() || null : null,
    // Sent as an exact decimal string; PostgREST casts straight to numeric(12,2)
    // with no float hop in between.
    unit_price: M(l.unit_price).toFixed(2),
  }))
}

/** Rehydrate saved rows (invoice detail / edit) back into editable lines. */
export function desdeFilas(filas, productos = []) {
  return filas.map((r) => {
    const p = productos.find((x) => x.id === r.product_id)
    const por = Number(p?.qty_unit) > 0 ? Number(p.qty_unit) : 1
    return {
      id: nuevoId(),
      type: r.type,
      product_id: r.product_id,
      sku: p?.sku ?? "",
      nombre: p?.description || p?.sku || "",
      stock: Number(p?.stock ?? 0),
      piezasPorBulto: por,
      modo: "qty",
      qty: r.qty ?? 0,
      // Only a product can have bultos back-filled: rows saved before the
      // column existed can be converted with qty_unit. A miscellaneous line
      // with no stored bultos stays blank — there is nothing to infer from.
      bultos:
        r.bultos ?? (convierteBultos(r.type) ? redondea((r.qty ?? 0) / por) : llevaBultos(r.type) ? "" : null),
      unit: r.unit ?? "",
      description: r.description ?? "",
      unit_price: r.unit_price ?? "",
    }
  })
}
