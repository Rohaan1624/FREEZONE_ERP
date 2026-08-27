import * as React from "react"
import {
  Plus,
  Check,
  X,
  CircleAlert,
  ArrowDownLeft,
  ArrowUpRight,
  Undo2,
  Lock,
  PlusCircle,
  CornerDownLeft,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase, rpc } from "@/lib/supabase"
import { n0, fecha } from "@/lib/format"
import { SubNavInventario } from "@/components/sub-nav-inventario"

// Common reasons, so the description is not left blank on a permanent record.
const MOTIVOS = {
  remove: ["Merma / daño", "Conteo físico", "Muestra", "Robo / extravío"],
  add: ["Conteo físico", "Devolución de cliente", "Encontrado en piso", "Corrección"],
}

export default function Ajustes() {
  const [filas, setFilas] = React.useState([])
  const [productos, setProductos] = React.useState([])
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState("")
  const [recarga, setRecarga] = React.useState(0)
  const [guardando, setGuardando] = React.useState(false)
  const [form, setForm] = React.useState(null)
  const [busca, setBusca] = React.useState("")

  React.useEffect(() => {
    let vivo = true
    Promise.all([
      supabase
        .from("adjustment")
        .select("*, product(sku,description,unit,stock)")
        .order("date_created", { ascending: false }),
      supabase.from("product").select("id,sku,description,unit,stock").order("sku"),
    ]).then(([a, p]) => {
      if (!vivo) return
      const e = a.error || p.error
      if (e) setError(e.message)
      setFilas(a.data ?? [])
      setProductos(p.data ?? [])
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [recarga])

  const abrir = (patch = {}) =>
    setForm({ producto: null, type: "remove", qty: "", description: "", ...patch })

  async function guardar() {
    setError("")
    const qty = Math.round(Number(form.qty))
    if (!form.producto) return setError("Elige un SKU.")
    if (!qty || qty <= 0) return setError("La cantidad debe ser mayor que 0.")
    if (!form.description.trim()) return setError("Escribe el motivo: el ajuste queda permanente.")

    setGuardando(true)
    try {
      await rpc("create_adjustment", {
        p_product_id: form.producto.id,
        p_type: form.type,
        p_qty: qty,
        p_description: form.description.trim(),
      })
      setForm(null)
      setRecarga((n) => n + 1)
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  const q = busca.trim().toLowerCase()
  const sugerencias = q
    ? productos.filter((p) => `${p.sku} ${p.description ?? ""}`.toLowerCase().includes(q)).slice(0, 4)
    : []

  const elegir = (p) => {
    setForm((f) => ({ ...f, producto: p }))
    setBusca("")
  }

  const qty = Math.round(Number(form?.qty)) || 0
  const stockActual = Number(form?.producto?.stock ?? 0)
  const resultante = form?.type === "remove" ? stockActual - qty : stockActual + qty
  const excede = form?.type === "remove" && qty > stockActual

  const campo = "mt-0.5 w-full bg-transparent text-base outline-none"
  const tile = "block rounded-2xl bg-paper px-4 py-2.5"
  const rotulo = "text-[10px] tracking-[0.1em] text-ink/50 uppercase"

  return (
    <div className="flex flex-col gap-3">
      <SubNavInventario />

      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h3 className="m-0 text-[21px] font-semibold">Ajustes de inventario</h3>
          <div className="max-w-[62ch] text-[13px] text-neutral-700">
            La única forma de mover existencia sin una factura o una entrada detrás: mermas,
            conteos físicos, muestras. Quedan registrados para siempre.
          </div>
        </div>
        {!form && (
          <button
            onClick={() => abrir()}
            className="ml-auto flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper"
          >
            <Plus className="size-4" />
            Crear ajuste
          </button>
        )}
      </div>

      <div className="flex items-start gap-2.5 rounded-2xl bg-newsprint px-4 py-3 text-[13px]">
        <Lock className="mt-px size-[18px] shrink-0 text-neutral-700" />
        <span className="text-pretty">
          Un ajuste <strong>no se puede editar ni eliminar</strong>. Si te equivocas, crea el ajuste
          contrario — así queda el rastro completo de cómo llegó la existencia a su número actual.
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-newsprint px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {form && (
        <section className="rounded-[22px] bg-newsprint p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h4 className="m-0 font-semibold">Nuevo ajuste</h4>
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
                {guardando ? "Guardando…" : "Registrar ajuste"}
              </button>
            </div>
          </div>

          {/* SKU picker — same obvious-to-click treatment as the invoice form */}
          {!form.producto ? (
            <div>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && sugerencias[0]) {
                    e.preventDefault()
                    elegir(sugerencias[0])
                  }
                }}
                placeholder="Buscar SKU a ajustar"
                autoFocus
                className="h-10 w-full rounded-full bg-paper px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink"
              />
              {sugerencias.length > 0 && (
                <div className="mt-2 rounded-2xl bg-paper/60 p-2">
                  <div className="flex items-center gap-2 px-1.5 pb-2 text-[11px] text-neutral-700">
                    <CornerDownLeft className="size-3.5" />
                    Haz clic en un SKU para elegirlo — o pulsa Enter para el primero
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {sugerencias.map((p, i) => (
                      <button
                        key={p.id}
                        onClick={() => elegir(p)}
                        className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl bg-paper p-2.5 text-left ring-ink transition hover:shadow-md hover:ring-1"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm">{p.description || p.sku}</div>
                          <div className="text-[11px] text-neutral-700 tabular-nums">{p.sku}</div>
                        </div>
                        <div className="text-xs text-neutral-700 tabular-nums">
                          existencia {n0(p.stock)}
                        </div>
                        <span className="flex items-center gap-1.5 rounded-full bg-newsprint px-3 py-1.5 text-[12px] font-semibold transition-colors group-hover:bg-ink group-hover:text-paper">
                          <PlusCircle className="size-4" />
                          Elegir
                          {i === 0 && (
                            <kbd className="ml-0.5 rounded bg-ink/10 px-1 py-px font-sans text-[10px] group-hover:bg-paper/20">
                              ⏎
                            </kbd>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-paper px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold">
                    {form.producto.description || form.producto.sku}
                  </div>
                  <div className="text-[11px] text-neutral-700 tabular-nums">
                    {form.producto.sku} · existencia {n0(form.producto.stock)}{" "}
                    {form.producto.unit ?? "PZA"}
                  </div>
                </div>
                <button
                  onClick={() => setForm({ ...form, producto: null })}
                  className="ml-auto rounded-full bg-newsprint px-3 py-1.5 text-[13px]"
                >
                  Cambiar SKU
                </button>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
                <div className={tile}>
                  <div className={rotulo}>Movimiento</div>
                  <div className="mt-1 inline-flex gap-1 rounded-full bg-newsprint p-1">
                    {[
                      ["remove", "Quitar", ArrowUpRight],
                      ["add", "Agregar", ArrowDownLeft],
                    ].map(([v, etiqueta, Icon]) => (
                      <button
                        key={v}
                        onClick={() => setForm({ ...form, type: v, description: "" })}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px]",
                          form.type === v ? "bg-ink text-paper" : "text-ink"
                        )}
                      >
                        <Icon className="size-3.5" />
                        {etiqueta}
                      </button>
                    ))}
                  </div>
                </div>

                <label className={tile}>
                  <span className={rotulo}>Cantidad</span>
                  <input
                    value={form.qty}
                    onChange={(e) => setForm({ ...form, qty: e.target.value })}
                    inputMode="numeric"
                    placeholder="0"
                    autoFocus
                    className={cn(campo, "tabular-nums")}
                  />
                </label>

                <div className={tile}>
                  <div className={rotulo}>Existencia resultante</div>
                  <div
                    className={cn(
                      "mt-0.5 text-base font-semibold tabular-nums",
                      excede && "text-ink/40"
                    )}
                  >
                    {n0(stockActual)} → {excede ? "—" : n0(resultante)}
                  </div>
                  {excede && (
                    <div className="text-[11px] text-neutral-700">
                      no puedes quitar más de {n0(stockActual)}
                    </div>
                  )}
                </div>
              </div>

              <div className={tile}>
                <span className={rotulo}>Motivo *</span>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Se registra permanentemente junto al ajuste"
                  className={campo}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {MOTIVOS[form.type].map((m) => (
                    <button
                      key={m}
                      onClick={() => setForm({ ...form, description: m })}
                      className="rounded-full bg-newsprint px-3 py-1 text-[12px]"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {cargando && <div className="p-6 text-center text-sm text-neutral-700">Cargando…</div>}

      {!cargando && filas.length === 0 && (
        <div className="rounded-[22px] bg-newsprint p-10 text-center">
          <div className="text-base font-semibold">Todavía no hay ajustes</div>
          <div className="mt-1 text-[13px] text-neutral-700">
            Lo normal es que la existencia se mueva con facturas y entradas. Un ajuste es la
            excepción documentada.
          </div>
        </div>
      )}

      {filas.length > 0 && (
        <section className="rounded-[22px] bg-newsprint p-6">
          <div className="grid grid-cols-[40px_100px_minmax(0,1.5fr)_minmax(0,1.4fr)_90px_100px] gap-3 px-3 pb-2 text-[10px] tracking-[0.1em] text-ink/50 uppercase">
            <div />
            <div>Fecha</div>
            <div>Producto</div>
            <div>Motivo</div>
            <div className="text-right">Cantidad</div>
            <div />
          </div>
          <div className="flex flex-col gap-2">
            {filas.map((a) => (
              <div
                key={a.id}
                className="grid grid-cols-[40px_100px_minmax(0,1.5fr)_minmax(0,1.4fr)_90px_100px] items-center gap-3 rounded-[14px] bg-paper p-3"
              >
                <span className="grid size-8 place-items-center rounded-xl bg-newsprint">
                  {a.type === "add" ? (
                    <ArrowDownLeft className="size-4 text-neutral-700" />
                  ) : (
                    <ArrowUpRight className="size-4 text-neutral-700" />
                  )}
                </span>
                <div className="text-[13px] text-neutral-700 tabular-nums">
                  {fecha(a.date_created)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm">
                    {a.product?.description || a.product?.sku || "—"}
                  </div>
                  <div className="text-[11px] text-neutral-700 tabular-nums">
                    {a.product?.sku}
                  </div>
                </div>
                <div className="truncate text-[13px] text-neutral-700">{a.description ?? "—"}</div>
                <div className="text-right text-[15px] font-semibold tabular-nums">
                  {a.type === "add" ? "+" : "−"}
                  {n0(a.qty)}
                </div>
                {/* Append-only: the only correction is an opposite adjustment,
                    so offer exactly that instead of an edit or delete button. */}
                <button
                  onClick={() =>
                    abrir({
                      producto: productos.find((p) => p.id === a.product_id) ?? a.product,
                      type: a.type === "add" ? "remove" : "add",
                      qty: String(a.qty),
                      description: `Corrección de ${fecha(a.date_created)}: ${a.description ?? ""}`.trim(),
                    })
                  }
                  title="Crear el ajuste contrario"
                  className="flex items-center gap-1.5 justify-self-end rounded-full bg-newsprint px-3 py-1.5 text-[12px]"
                >
                  <Undo2 className="size-3.5" />
                  Corregir
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
