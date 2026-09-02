import * as React from "react"
import { Link } from "react-router-dom"
import { Plus, Check, Trash2, X, Pencil, CircleAlert, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { Confirmar } from "@/components/confirmar"
import { useTotales } from "@/lib/totales"
import { Paginacion } from "@/components/paginacion"
import { useDebounce, rango, filtroTexto } from "@/lib/lista"
import {
  usd,
  n0,
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
  const [pagina, setPagina] = React.useState(0)
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

  const q = useDebounce(busca)
  const clave = `${pagina}|${q}|${recarga}`
  const [datos, setDatos] = React.useState(null)

  React.useEffect(() => {
    let vivo = true
    let consulta = supabase
      .from("product")
      .select("*", { count: "exact" })
      .order("sku")
      .range(...rango(pagina))
    const f = filtroTexto(q, ["sku", "description"])
    if (f) consulta = consulta.or(f)

    consulta.then(({ data, error, count }) => {
      if (!vivo) return
      if (error) setError(error.message)
      else setDatos({ clave, filas: data ?? [], total: count ?? 0 })
    })
    return () => {
      vivo = false
    }
  }, [clave, pagina, q, recarga])

  const cargando = datos?.clave !== clave
  const filas = datos?.filas ?? []
  const total = datos?.total ?? null

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

  // Del servidor. Un SKU sin costo se cuenta aparte, nunca se valúa en 0.
  const totales = useTotales("totales_productos", recarga)

  const campo = "mt-0.5 w-full bg-transparent text-base outline-none"
  const tile = "casilla block"
  const rotulo = "rotulo"
  const COLS =
    "grid-cols-[minmax(0,1fr)_minmax(76px,0.2fr)_minmax(96px,0.24fr)_minmax(100px,0.24fr)_minmax(100px,0.24fr)_150px_70px]"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h3 className="m-0 text-[21px] font-semibold">Productos</h3>
          <div className="text-[13px] text-neutral-700">
            {totales ? totales.skus : "…"} SKU · inventario valuado{" "}
            <span className="tabular-nums">
              {totales ? usd(totales.valor_inventario) : "…"}
            </span>
            {totales?.sin_costo > 0 && ` · ${totales.sin_costo} sin costo`}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-500" />
            <input
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                setPagina(0)
              }}
              placeholder="Buscar SKU o descripción"
              className="entrada-texto w-[260px] pr-3 pl-9"
            />
          </div>
          <button
            onClick={() => setForm({ ...VACIO })}
            className="boton boton-ink"
          >
            <Plus className="size-4" />
            Nuevo SKU
          </button>
        </div>
      </div>

      {error && (
        <div className="registro flex items-center gap-2.5 px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {form && (
        <section className="panel">
          <div className="mb-4 flex items-center gap-3">
            <h4 className="m-0 font-semibold">{form.id ? "Editar SKU" : "Nuevo SKU"}</h4>
            {form.id && (
              <span className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs tabular-nums">
                existencia {n0(form.stock)} · no editable
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => {
                  setForm(null)
                  setError("")
                }}
                className="boton boton-claro"
              >
                <X className="size-4" />
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando}
                className="boton boton-ink"
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
              <div className={rotulo}>Markup</div>
              <div className="mt-0.5 flex items-baseline gap-2 text-base font-semibold tabular-nums">
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

      {!cargando && filas.length === 0 && (
        <div className="registro p-10 text-center">
          <div className="text-base font-semibold">
            {q ? "Ningún SKU coincide" : "Todavía no hay productos"}
          </div>
          <div className="mt-1 text-[13px] text-neutral-700">
            {q
              ? "Prueba con otra búsqueda."
              : "Crea el primero para poder facturar y registrar entradas."}
          </div>
        </div>
      )}

      {filas.length > 0 && (
        <div className="registro overflow-hidden">
          <div
            className={cn(
              "registro-cab rotulo grid items-center gap-3",
              COLS
            )}
          >
            <div>Producto</div>
            <div>Unidad</div>
            <div className="text-right">Existencia</div>
            <div className="text-right">Costo</div>
            <div className="text-right">Precio</div>
            <div className="text-right">Markup</div>
            <div />
          </div>

          {filas.map((p) => (
            /* Stretched link, same as the invoice book: a real <a> covering the
               row with the action buttons layered above it, so right-click and
               open-in-new-tab keep working and no <button> ends up inside an <a>. */
            <div
              key={p.id}
              className={cn(
                "registro-fila group relative grid cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-neutral-100 focus-within:bg-neutral-100",
                COLS
              )}
            >
              <Link
                to={`/productos/${p.id}`}
                aria-label={`Ver movimientos de ${p.sku}`}
                className="absolute inset-0 z-0"
              />

              <div className="pointer-events-none relative z-10 min-w-0">
                <div className="truncate text-sm">{p.description || p.sku}</div>
                <div className="truncate text-[11px] text-neutral-600 tabular-nums">
                  {p.sku} · {p.qty_unit > 1 ? `${p.qty_unit} por bulto` : "suelto"}
                </div>
              </div>
              <div className="pointer-events-none relative z-10 text-[13px] text-neutral-600">
                {p.unit ?? "PZA"}
              </div>
              {/* Agotado en rojo: en una comercializadora un SKU en 0 es venta
                  que se está perdiendo, no un estado neutro. */}
              <div
                className={cn(
                  "pointer-events-none relative z-10 text-right text-sm font-semibold tabular-nums",
                  Number(p.stock) === 0 && "text-destructive"
                )}
              >
                {n0(p.stock)}
              </div>
              <div className="pointer-events-none relative z-10 text-right text-sm tabular-nums">
                {p.cost_price == null ? (
                  <span className="text-neutral-400">—</span>
                ) : (
                  usd(p.cost_price)
                )}
              </div>
              <div className="pointer-events-none relative z-10 text-right text-sm tabular-nums">
                {p.sale_price == null ? (
                  <span className="text-neutral-400">—</span>
                ) : (
                  usd(p.sale_price)
                )}
              </div>
              <div className="pointer-events-none relative z-10 text-right tabular-nums">
                {/* Solo el markup: es la cifra con la que se pone el precio.
                    El margen del periodo vive en el Resumen, calculado en SQL
                    sobre renglones de factura — otra pregunta, otro lugar. */}
                <div className="text-sm font-semibold">
                  {markupTexto(p.cost_price, p.sale_price)}
                </div>
              </div>

              {/* z-20: encima del enlace estirado */}
              <div className="relative z-20 flex items-center justify-end gap-1">
                <button
                  onClick={() => setForm({ ...p })}
                  title="Editar SKU"
                  className="accion"
                >
                  <Pencil className="size-[15px]" />
                </button>
                <button
                  onClick={() => setABorrar(p)}
                  disabled={Number(p.stock) !== 0}
                  title={
                    Number(p.stock) !== 0
                      ? "Solo se puede eliminar un SKU con existencia 0"
                      : "Eliminar SKU"
                  }
                  className="accion"
                >
                  <Trash2 className="size-[15px]" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(filas.length > 0 || pagina > 0) && (
        <Paginacion
          pagina={pagina}
          cuantos={filas.length}
          total={total}
          onPagina={setPagina}
          cargando={cargando}
        />
      )}

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
