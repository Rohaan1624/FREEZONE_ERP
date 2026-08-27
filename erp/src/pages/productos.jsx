import * as React from "react"
import { Link } from "react-router-dom"
import { Plus, Check, Trash2, X, Pencil, CircleAlert, Package, ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { Confirmar } from "@/components/confirmar"
import {
  usd,
  n0,
  margenTexto,
  markupTexto,
  utilidadUnitaria,
  aNumero,
} from "@/lib/format"

const UNIDADES = ["PZA", "BOX", "DOC", "CTN", "KG", "PAL"]

const VACIO = {
  sku: "",
  description: "",
  unit: "PZA",
  qty_unit: 1,
  cost_price: "",
  sale_price: "",
  weight_kg: "",
  cbm: "",
}

export default function Productos() {
  const [filas, setFilas] = React.useState([])
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState("")
  const [busca, setBusca] = React.useState("")
  const [form, setForm] = React.useState(null)
  const [guardando, setGuardando] = React.useState(false)
  const [aBorrar, setABorrar] = React.useState(null)
  const [borrando, setBorrando] = React.useState(false)

  // Bumping this refetches. The fetch lives inside the effect with a liveness
  // guard so a response that lands after the user navigates away is dropped
  // instead of calling setState on an unmounted component — and two fetches in
  // flight can never apply out of order.
  const [recarga, setRecarga] = React.useState(0)
  const cargar = React.useCallback(() => setRecarga((n) => n + 1), [])

  React.useEffect(() => {
    let vivo = true
    supabase
      .from("product")
      .select("*")
      .order("sku")
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setError(error.message)
        else setFilas(data ?? [])
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [recarga])

  // aNumero keeps "not given" as null instead of collapsing it to 0.
  const num = aNumero

  async function guardar() {
    setError("")
    if (!form.sku.trim()) return setError("El SKU no puede quedar vacío.")
    setGuardando(true)

    // stock is NOT sent: policy.sql revoked that column. It only moves through
    // invoices, closed purchases and adjustments — never by typing.
    const cuerpo = {
      sku: form.sku.trim().toUpperCase(),
      description: form.description?.trim() || null,
      unit: form.unit?.trim() || null,
      qty_unit: Math.max(1, Math.round(Number(form.qty_unit) || 1)),
      cost_price: num(form.cost_price),
      sale_price: num(form.sale_price),
      weight_kg: num(form.weight_kg),
      cbm: num(form.cbm),
    }

    const q = form.id
      ? supabase.from("product").update(cuerpo).eq("id", form.id).select()
      : supabase.from("product").insert(cuerpo).select()

    const { data, error } = await q
    setGuardando(false)
    if (error) {
      return setError(
        /duplicate key/i.test(error.message)
          ? `Ya tienes un producto con el SKU ${cuerpo.sku}.`
          : error.message
      )
    }
    if (!data?.length) return setError("No se guardó: la fila no es tuya o RLS la bloqueó.")
    setForm(null)
    cargar()
  }

  async function borrar() {
    const p = aBorrar
    if (!p) return
    setError("")
    setBorrando(true)
    const { data, error } = await supabase.from("product").delete().eq("id", p.id).select()
    setBorrando(false)
    setABorrar(null)
    if (error) {
      return setError(
        /foreign key/i.test(error.message)
          ? `No se puede eliminar ${p.sku}: aparece en facturas o entradas. Su historial debe conservarse.`
          : error.message
      )
    }
    if (!data?.length) {
      return setError(`No se puede eliminar ${p.sku}: su existencia debe ser 0.`)
    }
    cargar()
  }

  const q = busca.trim().toLowerCase()
  const visibles = filas.filter(
    (p) => !q || p.sku.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q)
  )
  // Only SKUs with a known cost can be valued; the rest are counted and
  // reported separately rather than silently valued at zero.
  const conCosto = filas.filter((p) => aNumero(p.cost_price) !== null)
  const sinCosto = filas.length - conCosto.length
  const valorInventario = conCosto.reduce(
    (t, p) => t + Number(p.stock ?? 0) * aNumero(p.cost_price),
    0
  )

  const campo = "mt-0.5 w-full bg-transparent text-base outline-none"
  const tile = "block rounded-2xl bg-paper px-4 py-2.5"
  const rotulo = "text-[10px] tracking-[0.1em] text-ink/50 uppercase"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h3 className="m-0 text-[21px] font-semibold">Productos</h3>
          <div className="text-[13px] text-neutral-700">
            {filas.length} SKU · inventario valuado {usd(valorInventario)}
            {sinCosto > 0 && ` · ${sinCosto} sin costo`}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar SKU o descripción"
            className="h-9 w-[250px] rounded-full bg-newsprint px-3.5 text-sm outline-none"
          />
          <button
            onClick={() => setForm({ ...VACIO })}
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper"
          >
            <Plus className="size-4" />
            Nuevo SKU
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-newsprint px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {form && (
        <section className="rounded-[22px] bg-newsprint p-6">
          <div className="mb-4 flex items-center gap-3">
            <h4 className="m-0 font-semibold">{form.id ? "Editar SKU" : "Nuevo SKU"}</h4>
            {form.id && (
              <span className="rounded-full bg-paper px-3 py-1 text-xs tabular-nums">
                existencia {n0(form.stock)} · no editable
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => {
                  setForm(null)
                  setError("")
                }}
                className="flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-sm"
              >
                <X className="size-4" />
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando}
                className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40"
              >
                <Check className="size-4" />
                {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
            <label className={tile}>
              <span className={rotulo}>SKU *</span>
              <input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="ABC-100"
                className={cn(campo, "tabular-nums")}
                autoFocus
              />
            </label>
            <label className={cn(tile, "sm:col-span-2")}>
              <span className={rotulo}>Descripción</span>
              <input
                value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Descripción del producto"
                className={campo}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>Unidad</span>
              <input
                value={form.unit ?? ""}
                onChange={(e) => setForm({ ...form, unit: e.target.value.toUpperCase() })}
                list="unidades-prod"
                placeholder="PZA"
                className={campo}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>Unidad por bulto</span>
              <input
                value={form.qty_unit ?? 1}
                onChange={(e) => setForm({ ...form, qty_unit: e.target.value })}
                inputMode="numeric"
                placeholder="12"
                className={cn(campo, "tabular-nums")}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>Costo unitario</span>
              <input
                value={form.cost_price ?? ""}
                onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                inputMode="decimal"
                placeholder="5.50"
                className={cn(campo, "tabular-nums")}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>Precio de lista</span>
              <input
                value={form.sale_price ?? ""}
                onChange={(e) => setForm({ ...form, sale_price: e.target.value })}
                inputMode="decimal"
                placeholder="12.00"
                className={cn(campo, "tabular-nums")}
              />
            </label>
            <div className={tile}>
              <div className={rotulo}>Margen · Markup</div>
              <div className="mt-0.5 flex items-baseline gap-2 text-base font-semibold tabular-nums">
                <span>{margenTexto(form.cost_price, form.sale_price)}</span>
                <span className="text-neutral-700">·</span>
                <span>{markupTexto(form.cost_price, form.sale_price)}</span>
              </div>
              <div className="text-[11px] text-neutral-700 tabular-nums">
                {utilidadUnitaria(form.cost_price, form.sale_price) === null
                  ? "falta costo o precio"
                  : `${usd(utilidadUnitaria(form.cost_price, form.sale_price))} por unidad`}
              </div>
            </div>
            <label className={tile}>
              <span className={rotulo}>Peso por bulto (kg)</span>
              <input
                value={form.weight_kg ?? ""}
                onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
                inputMode="decimal"
                placeholder="9.4"
                className={cn(campo, "tabular-nums")}
              />
              <span className="text-[11px] text-neutral-700">
                lo que pesa UN bulto, no una pieza
              </span>
            </label>
            <label className={tile}>
              <span className={rotulo}>CBM por bulto</span>
              <input
                value={form.cbm ?? ""}
                onChange={(e) => setForm({ ...form, cbm: e.target.value })}
                inputMode="decimal"
                placeholder="0.0450"
                className={cn(campo, "tabular-nums")}
              />
              <span className="text-[11px] text-neutral-700">
                lo que cubica UN bulto, no una pieza
              </span>
            </label>
          </div>
          <p className="mt-3 text-xs text-neutral-700">
            La existencia no se captura aquí: solo se mueve con facturas, entradas cerradas y
            ajustes, para que siempre exista un documento detrás de cada cambio. Piezas por bulto
            es lo que convierte cantidad ⇄ bultos al facturar. El <b>peso</b> y el <b>CBM</b> son
            <b> por bulto</b>: así es como se pesa y se cubica la mercancía, y así es como el
            packing list los suma (bultos × peso, no piezas × peso).
          </p>
          <datalist id="unidades-prod">
            {UNIDADES.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </section>
      )}

      {cargando && <div className="p-6 text-center text-sm text-neutral-700">Cargando…</div>}

      {!cargando && visibles.length === 0 && (
        <div className="rounded-[22px] bg-newsprint p-10 text-center">
          <div className="text-base font-semibold">
            {filas.length === 0 ? "Todavía no hay productos" : "Ningún SKU coincide"}
          </div>
          <div className="mt-1 text-[13px] text-neutral-700">
            {filas.length === 0
              ? "Crea el primero para poder facturar y registrar entradas."
              : "Prueba con otra búsqueda."}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3">
        {visibles.map((p) => (
          /* Stretched link, same as the client cards: a real <a> covering the
             card with the action buttons layered above it, so right-click and
             open-in-new-tab keep working and no <button> ends up inside an <a>. */
          <article
            key={p.id}
            className="group relative flex cursor-pointer flex-col gap-3 rounded-[20px] bg-newsprint p-4 transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ink"
          >
            <Link
              to={`/productos/${p.id}`}
              aria-label={`Ver movimientos de ${p.sku}`}
              className="absolute inset-0 z-0 rounded-[20px]"
            />

            <div className="pointer-events-none relative z-10 flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-paper">
                <Package className="size-[21px] text-neutral-700" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[15px] leading-tight font-semibold">
                  {p.description || p.sku}
                </div>
                <div className="truncate text-xs text-neutral-700 tabular-nums">
                  {p.sku} · {p.qty_unit > 1 ? `${p.qty_unit} por bulto` : "suelto"} ·{" "}
                  {p.unit ?? "PZA"}
                </div>
              </div>
              <span
                className={cn(
                  "ml-auto shrink-0 rounded-full px-3 py-1 text-xs tabular-nums",
                  Number(p.stock) === 0 ? "bg-ink text-paper" : "bg-paper"
                )}
              >
                {n0(p.stock)}
              </span>
            </div>

            <div className="pointer-events-none relative z-10 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-paper px-3 py-2">
                <div className="text-[9px] tracking-[0.1em] text-ink/50 uppercase">Costo</div>
                <div className="text-[15px] font-semibold tabular-nums">
                  {p.cost_price == null ? "—" : usd(p.cost_price)}
                </div>
              </div>
              <div className="rounded-xl bg-paper px-3 py-2">
                <div className="text-[9px] tracking-[0.1em] text-ink/50 uppercase">Precio</div>
                <div className="text-[15px] font-semibold tabular-nums">
                  {p.sale_price == null ? "—" : usd(p.sale_price)}
                </div>
              </div>
              <div className="rounded-xl bg-paper px-3 py-2">
                <div className="text-[9px] tracking-[0.1em] text-ink/50 uppercase">
                  Margen · Markup
                </div>
                <div className="text-[15px] font-semibold tabular-nums">
                  {margenTexto(p.cost_price, p.sale_price)}
                </div>
                <div className="text-[11px] text-neutral-700 tabular-nums">
                  {markupTexto(p.cost_price, p.sale_price)} sobre costo
                </div>
              </div>
            </div>

            <div className="pointer-events-none relative z-10 flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                Ver movimientos
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
              </span>
              <button
                onClick={() => setForm({ ...p })}
                title="Editar SKU"
                className="pointer-events-auto relative z-20 ml-auto grid size-8 place-items-center rounded-full bg-paper transition-shadow hover:shadow-sm"
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => setABorrar(p)}
                disabled={Number(p.stock) !== 0}
                title={
                  Number(p.stock) !== 0
                    ? "Solo se puede eliminar un SKU con existencia 0"
                    : "Eliminar SKU"
                }
                className="pointer-events-auto relative z-20 grid size-8 place-items-center rounded-full bg-paper transition-shadow hover:shadow-sm disabled:opacity-35 disabled:hover:shadow-none"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </article>
        ))}
      </div>

      <Confirmar
        abierto={Boolean(aBorrar)}
        ocupado={borrando}
        titulo={`¿Eliminar ${aBorrar?.sku ?? ""}?`}
        descripcion="Esta acción no se puede deshacer."
        detalles={[
          "Se borra la ficha del producto de forma permanente.",
          "Solo es posible si su existencia es 0 y no aparece en ninguna factura ni entrada; si aparece, el sistema lo impedirá para conservar el historial.",
          "Sus movimientos dejarían de ser consultables — considera editarlo en lugar de eliminarlo.",
        ]}
        textoConfirmar="Eliminar SKU"
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </div>
  )
}
