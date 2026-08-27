import * as React from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  Check,
  Trash2,
  Plus,
  PlusCircle,
  Package,
  Truck,
  CircleAlert,
  Lock,
  CornerDownLeft,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase, rpc } from "@/lib/supabase"
import { usd, n0, fecha, hoyISO } from "@/lib/format"

/**
 * One page for the three states a purchase can be in:
 *   /entradas/nueva          create      -> create_purchase
 *   /entradas/:id  active    edit        -> update_purchase, close_purchase
 *   /entradas/:id  closed    read only   (stock already moved; frozen)
 *
 * Purchase lines live in `entry`, which has NO bultos/unit columns — those are
 * an invoice-side concept. Note `entry.qty_unit` is the QUANTITY on this line,
 * not to be confused with `product.qty_unit` (pieces per package).
 */

let n = 0
const nuevoId = () => `e${++n}`
const numero = (v) => {
  const x = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""))
  return Number.isFinite(x) ? x : 0
}

const lineaProducto = (p) => ({
  id: nuevoId(),
  type: "product",
  product_id: p.id,
  sku: p.sku,
  nombre: p.description || p.sku,
  description: "",
  qty_unit: 1,
  cost_unit: p.cost_price ?? "",
})
const lineaCargo = () => ({
  id: nuevoId(),
  type: "charge",
  product_id: null,
  sku: "",
  nombre: "",
  description: "",
  qty_unit: 1,
  cost_unit: "",
})

export default function Entrada() {
  const { id } = useParams()
  const navigate = useNavigate()
  const creando = !id

  const [productos, setProductos] = React.useState([])
  const [compra, setCompra] = React.useState(null)
  const [cargando, setCargando] = React.useState(!creando)
  const [error, setError] = React.useState("")
  const [ocupado, setOcupado] = React.useState(false)
  const [recarga, setRecarga] = React.useState(0)
  const [busca, setBusca] = React.useState("")

  const [cab, setCab] = React.useState({
    entry_no: "",
    provider: "",
    origin: "",
    net_weight_kgs: "",
    gross_weight_kgs: "",
    cbm: "",
  })
  const [lineas, setLineas] = React.useState([])
  const [semilla, setSemilla] = React.useState(null)

  React.useEffect(() => {
    let vivo = true
    supabase
      .from("product")
      .select("id,sku,description,unit,stock,cost_price")
      .order("sku")
      .then(({ data }) => vivo && setProductos(data ?? []))
    return () => {
      vivo = false
    }
  }, [])

  React.useEffect(() => {
    if (creando) return
    let vivo = true
    supabase
      .from("purchase")
      .select("*, entry(*, product(sku,description))")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setError(error.message)
        else setCompra(data)
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [id, creando, recarga])

  // Seed the editable form from the loaded row (render-time, id-guarded).
  if (compra && compra.id !== semilla) {
    setSemilla(compra.id)
    setCab({
      entry_no: compra.entry_no ?? "",
      provider: compra.provider ?? "",
      origin: compra.origin ?? "",
      net_weight_kgs: compra.net_weight_kgs ?? "",
      gross_weight_kgs: compra.gross_weight_kgs ?? "",
      cbm: compra.cbm ?? "",
    })
    setLineas(
      (compra.entry ?? []).map((e) => ({
        id: nuevoId(),
        type: e.type,
        product_id: e.product_id,
        sku: e.product?.sku ?? "",
        nombre: e.product?.description || e.product?.sku || "",
        description: e.description ?? "",
        qty_unit: e.qty_unit ?? 0,
        cost_unit: e.cost_unit ?? "",
      }))
    )
  }

  const cerrada = compra?.status === "closed"
  const editable = creando || (compra && !cerrada)

  const set = (lid, patch) =>
    setLineas((ls) => ls.map((l) => (l.id === lid ? { ...l, ...patch } : l)))
  const quitar = (lid) => setLineas((ls) => ls.filter((l) => l.id !== lid))

  const importe = (l) => numero(l.qty_unit) * numero(l.cost_unit)
  const productosL = lineas.filter((l) => l.type === "product")
  const cargosL = lineas.filter((l) => l.type === "charge")
  const unidades = productosL.reduce((t, l) => t + numero(l.qty_unit), 0)
  const mercancia = productosL.reduce((t, l) => t + importe(l), 0)
  const gastos = cargosL.reduce((t, l) => t + importe(l), 0)
  const porUnidad = unidades ? gastos / unidades : 0
  const total = mercancia + gastos

  const q = busca.trim().toLowerCase()
  const sugerencias = q
    ? productos.filter((p) => `${p.sku} ${p.description ?? ""}`.toLowerCase().includes(q)).slice(0, 4)
    : []

  const agregarProd = (p) => {
    setLineas((ls) => (ls.some((l) => l.product_id === p.id) ? ls : ls.concat([lineaProducto(p)])))
    setBusca("")
  }

  const incompletas = lineas.filter(
    (l) =>
      numero(l.qty_unit) <= 0 ||
      String(l.cost_unit ?? "") === "" ||
      (l.type === "product" ? !l.product_id : !l.description.trim())
  )
  const puede = cab.entry_no.trim() && lineas.length > 0 && incompletas.length === 0 && !ocupado

  const payload = () => ({
    p_entry_no: cab.entry_no.trim(),
    p_provider: cab.provider.trim() || null,
    p_origin: cab.origin.trim() || null,
    p_net_weight_kgs: cab.net_weight_kgs === "" ? null : numero(cab.net_weight_kgs),
    p_gross_weight_kgs: cab.gross_weight_kgs === "" ? null : numero(cab.gross_weight_kgs),
    p_cbm: cab.cbm === "" ? null : numero(cab.cbm),
    p_lines: lineas.map((l) => ({
      type: l.type,
      product_id: l.type === "product" ? l.product_id : null,
      description: l.type === "product" ? null : l.description.trim(),
      qty_unit: Math.round(numero(l.qty_unit)),
      cost_unit: numero(l.cost_unit),
    })),
  })

  async function guardar() {
    setError("")
    setOcupado(true)
    try {
      if (creando) {
        const nuevo = await rpc("create_purchase", payload())
        navigate(`/entradas/${nuevo}`)
      } else {
        await rpc("update_purchase", { p_purchase_id: id, ...payload() })
        setRecarga((x) => x + 1)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupado(false)
    }
  }

  async function cerrar() {
    if (!confirm("Cerrar la entrada sube la existencia y ya no se podrá editar. ¿Continuar?"))
      return
    setError("")
    setOcupado(true)
    try {
      await rpc("close_purchase", { p_purchase_id: id })
      setRecarga((x) => x + 1)
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) return <div className="p-6 text-sm text-neutral-700">Cargando…</div>
  if (!creando && !compra) {
    return (
      <div className="rounded-[22px] bg-newsprint p-10 text-center">
        <div className="text-base font-semibold">Esa entrada no existe</div>
        <Link to="/entradas" className="mt-4 inline-block text-[13px] underline underline-offset-2">
          Volver a entradas
        </Link>
      </div>
    )
  }

  const campo = "h-8 rounded-full bg-newsprint px-3 text-sm outline-none"
  const tile = "block rounded-2xl bg-paper px-4 py-2.5"
  const rotulo = "text-[10px] tracking-[0.1em] text-ink/50 uppercase"
  const GRID =
    "grid-cols-[minmax(0,1.7fr)_86px_100px_minmax(0,0.85fr)_minmax(0,0.85fr)_34px]"

  return (
    <div className="flex flex-col gap-3">
      <Link to="/entradas" className="flex items-center gap-2 self-start text-[13px]">
        <ArrowLeft className="size-4" />
        {creando ? "Cancelar y volver" : "Todas las entradas"}
      </Link>

      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-newsprint px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="rounded-[22px] bg-newsprint p-6">
        <div className="mb-4 flex flex-wrap items-start gap-4">
          <div>
            <div className={rotulo}>{creando ? "Compra" : "Costeo de entrada"}</div>
            <div className="mt-0.5 flex items-center gap-3">
              <h2 className="m-0 text-[25px] font-semibold">
                {creando ? "Nueva entrada" : compra.entry_no}
              </h2>
              {!creando && (
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs",
                    cerrada ? "bg-neutral-200 text-neutral-700" : "bg-ink text-paper"
                  )}
                >
                  {cerrada ? "Recibida" : "Pendiente"}
                </span>
              )}
            </div>
            <div className="text-[13px] text-neutral-700">
              {creando ? fecha(hoyISO()) : `${compra.provider ?? "—"} · ${fecha(compra.date_created)}`}
            </div>
          </div>

          <div className="ml-auto flex flex-wrap gap-2">
            {editable && (
              <button
                onClick={guardar}
                disabled={!puede}
                className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40"
              >
                <Check className="size-4" />
                {ocupado ? "Guardando…" : creando ? "Crear entrada" : "Guardar cambios"}
              </button>
            )}
            {!creando && !cerrada && (
              <button
                onClick={cerrar}
                disabled={ocupado || lineas.length === 0}
                className="flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-sm disabled:opacity-40"
                title="Sube la existencia y congela la entrada"
              >
                <Lock className="size-4" />
                Cerrar y aplicar al inventario
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
          {[
            ["entry_no", "No. de entrada *", "ENT-2026-001", true],
            ["provider", "Proveedor", "Shenzhen Trading Co"],
            ["origin", "Origen", "CN"],
            ["net_weight_kgs", "Peso neto (kg)", "900.500"],
            ["gross_weight_kgs", "Peso bruto (kg)", "1020.250"],
            ["cbm", "CBM", "12.4000"],
          ].map(([k, label, ph, req]) => (
            <label key={k} className={tile}>
              <span className={rotulo}>{label}</span>
              <input
                value={cab[k]}
                onChange={(e) => setCab({ ...cab, [k]: e.target.value })}
                placeholder={ph}
                readOnly={!editable}
                autoFocus={req && creando}
                className={cn(
                  "mt-0.5 w-full bg-transparent text-base outline-none tabular-nums",
                  !editable && "opacity-70"
                )}
              />
            </label>
          ))}
        </div>

        <p className="mt-3 text-xs text-neutral-700">
          {cerrada
            ? "Recibida: la existencia ya subió y la entrada quedó congelada. No hay reapertura — una entrada cerrada movió inventario que las facturas pueden haber consumido."
            : "Pendiente: todavía no toca el inventario, así que puedes corregirla libremente. La existencia sube una sola vez, al cerrarla."}
        </p>
      </section>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(290px,0.5fr)]">
        <section className="rounded-[22px] bg-newsprint p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h4 className="m-0 font-semibold">Mercancía y gastos</h4>
            <span className="text-[13px] text-neutral-700">
              {productosL.length} SKU · {n0(unidades)} unidades
            </span>
            {editable && (
              <div className="ml-auto flex items-center gap-2">
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && sugerencias[0]) {
                      e.preventDefault()
                      agregarProd(sugerencias[0])
                    }
                  }}
                  placeholder="Buscar SKU"
                  className="h-9 w-[210px] rounded-full bg-paper px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink"
                />
                <button
                  onClick={() => setLineas((ls) => ls.concat([lineaCargo()]))}
                  className="flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-[13px]"
                >
                  <Plus className="size-4" />
                  Gasto
                </button>
              </div>
            )}
          </div>

          {sugerencias.length > 0 && (
            <div className="mb-3 rounded-2xl bg-paper/60 p-2">
              <div className="flex items-center gap-2 px-1.5 pb-2 text-[11px] text-neutral-700">
                <CornerDownLeft className="size-3.5" />
                Haz clic en un SKU para agregarlo — o pulsa Enter para el primero
              </div>
              <div className="flex flex-col gap-1.5">
                {sugerencias.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => agregarProd(p)}
                    className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-xl bg-paper p-2.5 text-left ring-ink transition hover:shadow-md hover:ring-1 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm">{p.description || p.sku}</div>
                      <div className="text-[11px] text-neutral-700 tabular-nums">{p.sku}</div>
                    </div>
                    <div className="text-xs text-neutral-700 tabular-nums">
                      existencia {n0(p.stock)}
                    </div>
                    <div className="text-sm tabular-nums">
                      {p.cost_price == null ? "sin costo" : usd(p.cost_price)}
                    </div>
                    <span className="flex items-center gap-1.5 rounded-full bg-newsprint px-3 py-1.5 text-[12px] font-semibold transition-colors group-hover:bg-ink group-hover:text-paper">
                      <PlusCircle className="size-4" />
                      Agregar
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

          {lineas.length > 0 && (
            <div className={cn("grid gap-2 px-3 pb-2", GRID, rotulo)}>
              <div>Concepto</div>
              <div className="text-right">Cantidad</div>
              <div className="text-right">Costo u.</div>
              <div className="text-right">Importe</div>
              <div className="text-right">Costo final u.</div>
              <div />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {lineas.map((l) => (
              <div key={l.id} className={cn("grid items-center gap-2 rounded-[14px] bg-paper p-3", GRID)}>
                {l.type === "product" ? (
                  <div className="min-w-0">
                    <div className="truncate text-sm">{l.nombre}</div>
                    <div className="text-[11px] text-neutral-700 tabular-nums">{l.sku}</div>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <Truck className="size-4 shrink-0 text-neutral-700" />
                    <input
                      value={l.description}
                      onChange={(e) => set(l.id, { description: e.target.value })}
                      placeholder="Flete, maniobras, permisos…"
                      readOnly={!editable}
                      className={cn(campo, "min-w-0 flex-1")}
                    />
                  </div>
                )}
                <input
                  value={l.qty_unit}
                  onChange={(e) => set(l.id, { qty_unit: e.target.value })}
                  readOnly={!editable}
                  inputMode="numeric"
                  className={cn(campo, "text-right tabular-nums")}
                />
                <input
                  value={l.cost_unit}
                  onChange={(e) => set(l.id, { cost_unit: e.target.value })}
                  readOnly={!editable}
                  inputMode="decimal"
                  placeholder="Costo"
                  className={cn(campo, "text-right tabular-nums")}
                />
                <div className="text-right text-sm tabular-nums">{usd(importe(l))}</div>
                <div className="text-right text-[15px] font-semibold tabular-nums">
                  {l.type === "product" ? usd(numero(l.cost_unit) + porUnidad) : "—"}
                </div>
                {editable ? (
                  <button
                    onClick={() => quitar(l.id)}
                    title="Quitar renglón"
                    className="grid size-[30px] place-items-center justify-self-end rounded-full bg-newsprint"
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : (
                  <div />
                )}
              </div>
            ))}
          </div>

          {lineas.length === 0 && (
            <div className="rounded-2xl bg-paper p-10 text-center">
              <Package className="mx-auto size-7 text-neutral-700" />
              <div className="mt-2 text-base font-semibold">Agrega los SKU que llegaron</div>
              <div className="text-[13px] text-neutral-700">
                Captura cantidad y costo por unidad; los gastos se prorratean solos.
              </div>
            </div>
          )}
        </section>

        <aside className="sticky top-4 flex flex-col gap-2.5 rounded-[22px] bg-newsprint p-6 text-sm">
          <h4 className="m-0 mb-1 font-semibold">Costeo</h4>
          {[
            ["Unidades", n0(unidades)],
            ["Mercancía", usd(mercancia)],
            ["Gastos", gastos ? usd(gastos) : "—"],
            ["Gasto por unidad", porUnidad ? usd(porUnidad) : "—"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-neutral-700">{k}</span>
              <span className="tabular-nums">{v}</span>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between rounded-[14px] bg-paper px-3 py-2.5">
            <span className="text-[15px] font-semibold">Costo en almacén</span>
            <span className="text-[25px] font-semibold tracking-[-0.02em] tabular-nums">
              {usd(total)}
            </span>
          </div>
          <p className="text-xs text-neutral-700">
            El prorrateo se calcula al vuelo para que veas el costo real por SKU. La base de datos
            guarda mercancía y gastos por separado — no se sobrescribe ningún costo.
          </p>
          {incompletas.length > 0 && editable && (
            <div className="rounded-[14px] bg-paper p-3 text-xs">
              Faltan datos en {incompletas.length} renglón{incompletas.length > 1 ? "es" : ""}.
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
