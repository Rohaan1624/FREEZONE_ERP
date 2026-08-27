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
  PackagePlus,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase, rpc } from "@/lib/supabase"
import { CrearProducto } from "@/components/crear-rapido"
import { usd, n0, fecha, hoyISO } from "@/lib/format"
// The qty <-> bultos conversion is the same rule as on an invoice, so it comes
// from the same tested module. Only `product` lines convert; charges carry
// neither packages nor a unit of measure.
import { sincroniza, convierteBultos } from "@/lib/lineas"

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

// NOTE the naming trap: `qty` here is the QUANTITY on the line (it maps to the
// column entry.qty_unit), while `piezasPorBulto` is product.qty_unit — pieces
// per package. Same name in the database, two different meanings.
const lineaProducto = (p) => {
  const piezasPorBulto = Number(p.qty_unit) > 0 ? Number(p.qty_unit) : 1
  return {
    id: nuevoId(),
    type: "product",
    product_id: p.id,
    sku: p.sku,
    nombre: p.description || p.sku,
    description: "",
    piezasPorBulto,
    modo: "qty",
    qty: 1,
    bultos: Math.round((1 / piezasPorBulto) * 100) / 100,
    unit: p.unit || "PZA",
    cost_unit: p.cost_price ?? "",
  }
}
const lineaCargo = () => ({
  id: nuevoId(),
  type: "charge",
  product_id: null,
  sku: "",
  nombre: "",
  description: "",
  piezasPorBulto: 1,
  modo: "qty",
  qty: 1,
  bultos: null,
  unit: "",
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
  const [nuevoSku, setNuevoSku] = React.useState(false)

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
      .select("*, entry(*, product(sku,description,unit,qty_unit))")
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
      (compra.entry ?? []).map((e) => {
        const por = Number(e.product?.qty_unit) > 0 ? Number(e.product.qty_unit) : 1
        return {
          id: nuevoId(),
          type: e.type,
          product_id: e.product_id,
          sku: e.product?.sku ?? "",
          nombre: e.product?.description || e.product?.sku || "",
          description: e.description ?? "",
          piezasPorBulto: por,
          modo: "qty",
          qty: e.qty_unit ?? 0,
          // Always derived — entry stores neither. product.qty_unit is the
          // conversion factor, so this stays correct as long as the packaging
          // has not changed; if it has, the line reflects the CURRENT packaging.
          bultos: convierteBultos(e.type)
            ? Math.round(((e.qty_unit ?? 0) / por) * 100) / 100
            : null,
          unit: e.product?.unit ?? "",
          cost_unit: e.cost_unit ?? "",
        }
      })
    )
  }

  const cerrada = compra?.status === "closed"
  const editable = creando || (compra && !cerrada)

  // sincroniza re-derives the partner field: typing units recomputes packages
  // and vice versa, using piezasPorBulto. Charges are left alone (nulled).
  const set = (lid, patch) =>
    setLineas((ls) => ls.map((l) => (l.id === lid ? sincroniza(l, patch) : l)))
  const quitar = (lid) => setLineas((ls) => ls.filter((l) => l.id !== lid))

  const importe = (l) => numero(l.qty) * numero(l.cost_unit)
  const productosL = lineas.filter((l) => l.type === "product")
  const cargosL = lineas.filter((l) => l.type === "charge")
  const unidades = productosL.reduce((t, l) => t + numero(l.qty), 0)
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
      numero(l.qty) <= 0 ||
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
      // internal `qty` maps to the column entry.qty_unit.
      // bultos and unit are NOT sent: entry has no such columns. They are a
      // capture aid only, re-derived from product.qty_unit whenever the line is
      // loaded again. (The invoice side DOES store them — see migration-002.)
      qty_unit: Math.round(numero(l.qty)),
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
  // One grid per line shape, shared by header and rows so columns line up.
  const GRID = {
    product:
      "grid-cols-[minmax(0,1.4fr)_112px_74px_74px_64px_88px_minmax(0,0.8fr)_minmax(0,0.8fr)_34px]",
    charge: "grid-cols-[minmax(0,2fr)_74px_88px_minmax(0,0.8fr)_34px]",
  }
  const UNIDADES = ["PZA", "BOX", "DOC", "CTN", "KG", "PAL"]

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
            ["entry_no", "No. de entrada *", "ENT-0001", true],
            ["provider", "Proveedor", "Proveedor Ejemplo"],
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
                  onClick={() => setNuevoSku(true)}
                  title="Crear un SKU sin salir de la entrada"
                  className="flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-[13px]"
                >
                  <PackagePlus className="size-4" />
                  Nuevo SKU
                </button>
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

          {editable && busca.trim() && sugerencias.length === 0 && (
            <button
              onClick={() => setNuevoSku(true)}
              className="mb-3 flex w-full items-center gap-2 rounded-2xl bg-paper p-3 text-left text-[13px] hover:shadow-sm"
            >
              <PackagePlus className="size-4 shrink-0" />
              <span>
                Ningún SKU coincide con «<b>{busca.trim()}</b>». Crearlo ahora.
              </span>
            </button>
          )}

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

          {/* Cantidad and Bultos sit side by side, and only products offer the
              switch — a charge has no packaging to convert through. */}
          {productosL.length > 0 && (
            <div className={cn("grid items-end gap-2 px-3 pb-2", GRID.product, rotulo)}>
              <div>Producto</div>
              <div>Capturar por</div>
              <div className="text-right">
                Cantidad<span className="block text-[9px] tracking-normal normal-case">unidades</span>
              </div>
              <div className="text-right">
                Bultos<span className="block text-[9px] tracking-normal normal-case">paquetes</span>
              </div>
              <div>Unidad</div>
              <div className="text-right">Costo u.</div>
              <div className="text-right">Importe</div>
              <div className="text-right">Costo final u.</div>
              <div />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {lineas
              .filter((l) => l.type === "product")
              .map((l) => (
                <div
                  key={l.id}
                  className={cn("grid items-center gap-2 rounded-[14px] bg-paper p-3", GRID.product)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm">{l.nombre}</div>
                    <div className="text-[11px] text-neutral-700 tabular-nums">
                      {l.sku} · {l.piezasPorBulto} por bulto
                    </div>
                  </div>

                  <div className="inline-flex gap-0.5 rounded-full bg-newsprint p-0.5">
                    {[["qty", "Cant."], ["bultos", "Bultos"]].map(([m, etiqueta]) => (
                      <button
                        key={m}
                        onClick={() => editable && set(l.id, { modo: m })}
                        disabled={!editable}
                        className={cn(
                          "rounded-full px-2 py-1 text-[11px]",
                          l.modo === m ? "bg-ink text-paper" : "text-ink"
                        )}
                      >
                        {etiqueta}
                      </button>
                    ))}
                  </div>

                  <input
                    value={l.qty}
                    onChange={(e) => set(l.id, { qty: e.target.value, modo: "qty" })}
                    readOnly={!editable || l.modo === "bultos"}
                    inputMode="numeric"
                    className={cn(campo, "text-right tabular-nums", l.modo === "bultos" && "opacity-60")}
                  />
                  <input
                    value={l.bultos ?? ""}
                    onChange={(e) => set(l.id, { bultos: e.target.value, modo: "bultos" })}
                    readOnly={!editable || l.modo === "qty"}
                    inputMode="decimal"
                    className={cn(campo, "text-right tabular-nums", l.modo === "qty" && "opacity-60")}
                  />
                  <input
                    value={l.unit ?? ""}
                    onChange={(e) => set(l.id, { unit: e.target.value.toUpperCase() })}
                    readOnly={!editable}
                    list="unidades-entrada"
                    placeholder="PZA"
                    className={cn(campo, "px-2 text-center")}
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
                    {usd(numero(l.cost_unit) + porUnidad)}
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

          {cargosL.length > 0 && (
            <div className={cn("mt-3 grid items-end gap-2 px-3 pb-2", GRID.charge, rotulo)}>
              <div>Gasto</div>
              <div className="text-right">
                Cantidad<span className="block text-[9px] tracking-normal normal-case">sin bultos</span>
              </div>
              <div className="text-right">Monto u.</div>
              <div className="text-right">Importe</div>
              <div />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {lineas
              .filter((l) => l.type === "charge")
              .map((l) => (
                <div
                  key={l.id}
                  className={cn("grid items-center gap-2 rounded-[14px] bg-paper p-3", GRID.charge)}
                >
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
                  <input
                    value={l.qty}
                    onChange={(e) => set(l.id, { qty: e.target.value })}
                    readOnly={!editable}
                    inputMode="numeric"
                    className={cn(campo, "text-right tabular-nums")}
                  />
                  <input
                    value={l.cost_unit}
                    onChange={(e) => set(l.id, { cost_unit: e.target.value })}
                    readOnly={!editable}
                    inputMode="decimal"
                    placeholder="Monto"
                    className={cn(campo, "text-right tabular-nums")}
                  />
                  <div className="text-right text-[15px] font-semibold tabular-nums">
                    {usd(importe(l))}
                  </div>
                  {editable ? (
                    <button
                      onClick={() => quitar(l.id)}
                      title="Quitar gasto"
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

          {productosL.length > 0 && (
            <p className="mt-2 px-3 text-[11px] text-neutral-700">
              Los bultos se calculan al vuelo desde las piezas por bulto del SKU; no se guardan en
              la entrada.
            </p>
          )}

          <datalist id="unidades-entrada">
            {UNIDADES.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>

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

      <CrearProducto
        abierto={nuevoSku}
        skuInicial={busca.trim()}
        onCancelar={() => setNuevoSku(false)}
        onCreado={(p) => {
          setProductos((ps) => [...ps, p].sort((a, b) => a.sku.localeCompare(b.sku)))
          agregarProd(p)
          setNuevoSku(false)
        }}
      />
    </div>
  )
}
