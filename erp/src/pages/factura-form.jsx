import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  Check,
  Trash2,
  Plus,
  PlusCircle,
  Package,
  Tag,
  Truck,
  Cuboid,
  CornerDownLeft,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase, rpc } from "@/lib/supabase"
import { usd, n0, fecha, hoyISO, masDias } from "@/lib/format"
import {
  lineaSuelta,
  agrega,
  agregaProducto,
  actualiza,
  elimina,
  porTipo,
  importe,
  total as totalDe,
  subtotalTipo,
  incompletas,
  sinExistencia,
  disponible,
  aPayload,
  desdeFilas,
  llevaBultos,
  convierteBultos,
} from "@/lib/lineas"

const TABS = [
  { id: "product", label: "Productos", icon: Package },
  { id: "charge", label: "Cargos", icon: Truck },
  { id: "miscellaneous", label: "Misceláneos", icon: Tag },
]

const UNIDADES = ["PZA", "BOX", "DOC", "CTN", "KG", "PAL"]

// One grid per line shape, shared by the header row and its rows so the
// columns line up. Products get a "capturar por" switch because bultos and
// cantidad convert; misceláneos get both fields loose because they do not;
// cargos get neither because they are money.
const GRID = {
  product: "grid-cols-[minmax(0,1.5fr)_124px_78px_78px_70px_92px_minmax(0,0.8fr)_34px]",
  miscellaneous: "grid-cols-[minmax(0,1.7fr)_86px_86px_70px_92px_minmax(0,0.8fr)_34px]",
  charge: "grid-cols-[minmax(0,2fr)_86px_92px_minmax(0,0.8fr)_34px]",
}
const TH = "text-[10px] tracking-[0.1em] text-ink/50 uppercase"
const SUB = "block text-[9px] normal-case tracking-normal"

/**
 * One form for creating AND editing an invoice — update_invoice takes the same
 * whole-document shape create_invoice does, so a single component covers both.
 * A closed invoice cannot be edited (the backend refuses), so the caller never
 * routes here for one.
 */
export default function FacturaForm() {
  const navigate = useNavigate()
  const { id } = useParams()
  const editando = Boolean(id)
  const [clientes, setClientes] = React.useState([])
  const [productos, setProductos] = React.useState([])
  const [clienteId, setClienteId] = React.useState("")
  const [tab, setTab] = React.useState("product")
  const [lineas, setLineas] = React.useState([])
  const [notas, setNotas] = React.useState("")
  const [dias, setDias] = React.useState("0")
  const [descontar, setDescontar] = React.useState(true)
  const [busca, setBusca] = React.useState("")
  const [error, setError] = React.useState("")
  const [guardando, setGuardando] = React.useState(false)
  const [cargando, setCargando] = React.useState(editando)
  const [original, setOriginal] = React.useState(null)
  const [vence, setVence] = React.useState("")

  React.useEffect(() => {
    supabase
      .from("client")
      .select("id,name,payment_terms,balance")
      .order("name")
      .then(({ data }) => {
        setClientes(data ?? [])
        if (data?.length) {
          setClienteId(data[0].id)
          setDias(String(data[0].payment_terms ?? 0))
        }
      })
    supabase
      .from("product")
      .select("id,sku,description,unit,qty_unit,stock,sale_price")
      .order("sku")
      .then(({ data }) => setProductos(data ?? []))
  }, [])

  // Editing: pull the saved document back into editable lines. desdeFilas
  // re-derives bultos for product rows saved before that column existed, and
  // leaves miscelláneos blank because there is nothing to infer from.
  React.useEffect(() => {
    if (!editando) return
    let vivo = true
    supabase
      .from("invoice")
      .select("*, transaction(*, product(id,sku,description,unit,qty_unit,stock,sale_price))")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setError(error.message)
        else if (data) {
          setOriginal(data)
          setClienteId(data.client_id)
          setNotas(data.notes ?? "")
          setVence(data.due_date ?? "")
          setDescontar(data.status !== "draft")
          setLineas(
            desdeFilas(
              data.transaction ?? [],
              (data.transaction ?? []).map((t) => t.product).filter(Boolean)
            )
          )
        }
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [id, editando])

  const cliente = clientes.find((c) => c.id === clienteId)

  function elegirCliente(id) {
    setClienteId(id)
    const c = clientes.find((x) => x.id === id)
    if (c) setDias(String(c.payment_terms ?? 0))
  }

  // Every mutation goes through lineas.js and addresses lines by their stable
  // id, so the filtered tab view can never edit or delete the wrong row.
  const set = (id, patch) => setLineas((ls) => actualiza(ls, id, patch))
  const quitar = (id) => setLineas((ls) => elimina(ls, id))

  const agregar = (p) => {
    setLineas((ls) => agregaProducto(ls, p))
    setBusca("")
  }

  const visibles = porTipo(lineas, tab)
  const cuenta = (t) => porTipo(lineas, t).length || ""
  const total = totalDe(lineas)
  const bultosTotales = lineas.reduce((t, l) => t + (llevaBultos(l.type) ? Number(l.bultos || 0) : 0), 0)

  const q = busca.trim().toLowerCase()
  const sugerencias = q
    ? productos.filter((p) => `${p.sku} ${p.description ?? ""}`.toLowerCase().includes(q)).slice(0, 4)
    : []

  // In create mode the terms dropdown drives the date. In edit mode the stored
  // due_date is loaded as-is — recomputing it from today would silently move
  // the due date of an invoice issued weeks ago every time someone saved it.
  const aplicarTerminos = (d) => {
    setDias(d)
    setVence(Number(d) > 0 ? masDias(hoyISO(), d) : "")
  }
  const faltantes = incompletas(lineas)

  // Units this invoice ALREADY holds. Only an issued invoice has taken any —
  // a draft reserves nothing, so editing one competes with the full free stock.
  const yaReservado = React.useMemo(() => {
    if (!editando || !original || original.status === "draft") return {}
    const m = {}
    for (const t of original.transaction ?? []) {
      if (t.type === "product" && t.product_id)
        m[t.product_id] = (m[t.product_id] ?? 0) + Number(t.qty ?? 0)
    }
    return m
  }, [editando, original])

  const cortos = descontar ? sinExistencia(lineas, yaReservado) : []
  const puedeGuardar = lineas.length > 0 && faltantes.length === 0 && clienteId && !guardando

  async function guardar() {
    setError("")
    setGuardando(true)
    try {
      const comun = {
        p_lines: aPayload(lineas),
        p_status: descontar ? "active" : "draft",
        // '' clears the note; null would mean "leave it alone" server-side.
        p_notes: notas.trim(),
        p_due_date: vence || null,
      }
      if (editando) {
        await rpc("update_invoice", { p_invoice_id: id, p_client_id: clienteId, ...comun })
        navigate(`/facturas/${id}`)
      } else {
        const nuevo = await rpc("create_invoice", { p_client_id: clienteId, ...comun })
        navigate(`/facturas/${nuevo}`)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <div className="p-6 text-sm text-neutral-700">Cargando…</div>
  if (editando && !original) {
    return (
      <div className="rounded-[22px] bg-newsprint p-10 text-center">
        <div className="text-base font-semibold">Esa factura no existe</div>
        <Link to="/facturas" className="mt-4 inline-block text-[13px] underline underline-offset-2">
          Volver a facturas
        </Link>
      </div>
    )
  }

  const campo =
    "h-8 rounded-full bg-newsprint px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink"

  return (
    <div className="flex flex-col gap-3">
      <Link
        to={editando ? `/facturas/${id}` : "/facturas"}
        className="flex items-center gap-2 self-start text-[13px]"
      >
        <ArrowLeft className="size-4" />
        {editando ? "Descartar cambios" : "Cancelar y volver"}
      </Link>

      <section className="rounded-[22px] bg-newsprint p-6">
        <div className="mb-4 flex flex-wrap items-start gap-4">
          <div>
            <div className="text-[11px] tracking-[0.12em] text-neutral-700 uppercase">
              {editando ? "Edición" : "Captura"}
            </div>
            <h2 className="m-0 text-[25px] font-semibold">
              {editando ? original.invoice_num : "Nueva factura"}
            </h2>
            <div className="text-[13px] text-neutral-700">
              {editando
                ? `Emitida ${fecha(original.date_created)} · se reemplazan todos los renglones`
                : `El folio se asigna al guardar · ${fecha(hoyISO())}`}
            </div>
          </div>
          <button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="ml-auto flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40"
          >
            <Check className="size-4" />
            {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Emitir factura"}
          </button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2.5">
          <label className="block rounded-2xl bg-paper px-4 py-2.5">
            <span className="text-[10px] tracking-[0.1em] text-ink/50 uppercase">Cliente</span>
            <select
              value={clienteId}
              onChange={(e) => elegirCliente(e.target.value)}
              className="mt-0.5 w-full bg-transparent text-base outline-none"
            >
              {clientes.length === 0 && <option value="">Sin clientes — crea uno primero</option>}
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block rounded-2xl bg-paper px-4 py-2.5">
            <span className="text-[10px] tracking-[0.1em] text-ink/50 uppercase">
              Condiciones de pago
            </span>
            <select
              value={dias}
              onChange={(e) => aplicarTerminos(e.target.value)}
              className="mt-0.5 w-full bg-transparent text-base outline-none"
            >
              <option value="0">Contado</option>
              <option value="15">Neto 15</option>
              <option value="30">Neto 30</option>
              <option value="45">Neto 45</option>
              <option value="60">Neto 60</option>
            </select>
          </label>

          <label className="block rounded-2xl bg-paper px-4 py-2.5">
            <span className="text-[10px] tracking-[0.1em] text-ink/50 uppercase">Vence</span>
            <input
              type="date"
              value={vence}
              onChange={(e) => setVence(e.target.value)}
              className="mt-0.5 w-full bg-transparent text-base tabular-nums outline-none"
            />
            <span className="text-[11px] text-neutral-700">
              {vence ? fecha(vence) : "Contado · pago inmediato"}
            </span>
          </label>

          <div className="rounded-2xl bg-paper px-4 py-2.5">
            <div className="text-[10px] tracking-[0.1em] text-ink/50 uppercase">
              Saldo del cliente
            </div>
            <div className="mt-1 text-base tabular-nums">{usd(cliente?.balance ?? 0)}</div>
          </div>
        </div>

        <button
          onClick={() => setDescontar((v) => !v)}
          className={cn(
            "mt-2.5 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left",
            descontar ? "bg-ink text-paper" : "bg-paper text-ink"
          )}
        >
          <span
            className={cn(
              "flex h-[26px] w-[46px] shrink-0 items-center rounded-full p-[3px]",
              descontar ? "justify-end bg-paper/40" : "justify-start bg-ink/15"
            )}
          >
            <span className={cn("block size-5 rounded-full", descontar ? "bg-paper" : "bg-newsprint")} />
          </span>
          <span>
            <span className="block text-[15px] font-semibold">Descontar del inventario</span>
            <span className="block text-xs opacity-75">
              {editando
                ? descontar
                  ? original.status === "draft"
                    ? "Al guardar pasa a activa y descuenta la existencia."
                    : "Sigue activa: solo se ajusta la diferencia de existencia."
                  : original.status === "draft"
                    ? "Sigue como borrador: el inventario no se mueve."
                    : "Al guardar vuelve a borrador y devuelve la existencia."
                : descontar
                  ? "Se emite como activa: la existencia baja al guardar."
                  : "Se guarda como borrador: el inventario no se mueve."}
            </span>
          </span>
          <Cuboid className="ml-auto size-6" />
        </button>
      </section>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.56fr)]">
        <div className="flex flex-col gap-3">
          <section className="rounded-[22px] bg-newsprint p-6">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="inline-flex gap-1 rounded-full bg-paper p-1">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px]",
                      tab === id ? "bg-ink text-paper" : "text-ink"
                    )}
                  >
                    <Icon className="size-4" />
                    {label} {cuenta(id)}
                  </button>
                ))}
              </div>
              {tab === "product" ? (
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter adds the top hit, so a fast typist never leaves the
                    // keyboard: type three letters, Enter, next SKU.
                    if (e.key === "Enter" && sugerencias[0]) {
                      e.preventDefault()
                      agregar(sugerencias[0])
                    }
                  }}
                  placeholder="Buscar SKU para agregar"
                  className="ml-auto h-9 w-[250px] rounded-full bg-paper px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink"
                />
              ) : (
                <button
                  onClick={() => setLineas((ls) => agrega(ls, lineaSuelta(tab)))}
                  className="ml-auto flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-[13px]"
                >
                  <Plus className="size-4" />
                  Agregar renglón
                </button>
              )}
            </div>

            {/* A search result is not obviously an action, so say so outright:
                a standing instruction, a per-row "Agregar" pill with a plus,
                and a pointer cursor. Enter adds the first hit. */}
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
                      onClick={() => agregar(p)}
                      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-xl bg-paper p-2.5 text-left ring-ink transition hover:shadow-md hover:ring-1 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm">{p.description || p.sku}</div>
                        <div className="text-[11px] text-neutral-700 tabular-nums">
                          {p.sku} · {p.qty_unit > 1 ? `${p.qty_unit} por bulto` : "suelto"} ·{" "}
                          {p.unit ?? "PZA"}
                        </div>
                      </div>
                      <div className="text-xs text-neutral-700 tabular-nums">
                        existencia {n0(p.stock)}
                      </div>
                      <div className="text-sm tabular-nums">
                        {p.sale_price == null ? "sin precio" : usd(p.sale_price)}
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

            {visibles.length === 0 && (
              <div className="rounded-2xl bg-paper p-10 text-center">
                <div className="text-base font-semibold">
                  {tab === "product" ? "Busca un SKU arriba para agregarlo" : "Sin renglones"}
                </div>
                <div className="text-[13px] text-neutral-700">
                  {tab === "product"
                    ? "Los productos mueven inventario."
                    : tab === "charge"
                      ? "Fletes y servicios: sin bultos ni unidad."
                      : "Artículos fuera del catálogo. Llevan bultos, pero no tocan inventario."}
                </div>
              </div>
            )}

            {/* Column headers. Cantidad and Bultos always sit side by side so
                it is visible which number is raw units (what moves stock) and
                which is packages. */}
            {visibles.length > 0 && (
              <div className={cn("grid items-end gap-2 px-3 pb-2", GRID[tab], TH)}>
                <div>{tab === "product" ? "Producto" : "Concepto"}</div>
                {convierteBultos(tab) && <div>Capturar por</div>}
                <div className="text-right">
                  Cantidad<span className={SUB}>unidades</span>
                </div>
                {llevaBultos(tab) && (
                  <div className="text-right">
                    Bultos<span className={SUB}>paquetes</span>
                  </div>
                )}
                {llevaBultos(tab) && <div>Unidad</div>}
                <div className="text-right">{tab === "charge" ? "Monto" : "Precio"}</div>
                <div className="text-right">Importe</div>
                <div />
              </div>
            )}

            <div className="flex flex-col gap-2">
              {visibles.map((l) => (
                <div key={l.id} className={cn("grid items-center gap-2 rounded-[14px] bg-paper p-3", GRID[l.type])}>
                  {/* concepto */}
                  {l.type === "product" ? (
                    <div className="min-w-0">
                      <div className="truncate text-sm">{l.nombre}</div>
                      <div className="text-[11px] text-neutral-700 tabular-nums">
                        {l.sku} ·{" "}
                        {descontar && Number(l.qty) > disponible(l, yaReservado)
                          ? `excede disponible (${n0(disponible(l, yaReservado))})`
                          : `${l.piezasPorBulto} por bulto · disp. ${n0(disponible(l, yaReservado))}`}
                      </div>
                    </div>
                  ) : (
                    <input
                      value={l.description}
                      onChange={(e) => set(l.id, { description: e.target.value })}
                      placeholder={l.type === "charge" ? "Concepto del cargo" : "Concepto"}
                      className={campo}
                    />
                  )}

                  {/* Only products convert, so only they choose which field drives. */}
                  {convierteBultos(l.type) && (
                    <div className="inline-flex gap-0.5 rounded-full bg-newsprint p-0.5">
                      {[["qty", "Cant."], ["bultos", "Bultos"]].map(([m, etiqueta]) => (
                        <button
                          key={m}
                          onClick={() => set(l.id, { modo: m })}
                          className={cn(
                            "rounded-full px-2 py-1 text-[11px]",
                            l.modo === m ? "bg-ink text-paper" : "text-ink"
                          )}
                        >
                          {etiqueta}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* cantidad — always the raw units that move stock */}
                  <input
                    value={l.qty}
                    onChange={(e) => set(l.id, { qty: e.target.value, modo: "qty" })}
                    readOnly={convierteBultos(l.type) && l.modo === "bultos"}
                    inputMode="numeric"
                    className={cn(
                      campo,
                      "text-right tabular-nums",
                      convierteBultos(l.type) && l.modo === "bultos" && "opacity-60"
                    )}
                  />

                  {/* bultos — derived for products, free for misceláneos, absent for cargos */}
                  {llevaBultos(l.type) && (
                    <input
                      value={l.bultos ?? ""}
                      onChange={(e) => set(l.id, { bultos: e.target.value, modo: "bultos" })}
                      readOnly={convierteBultos(l.type) && l.modo === "qty"}
                      inputMode="decimal"
                      placeholder={convierteBultos(l.type) ? "" : "—"}
                      className={cn(
                        campo,
                        "text-right tabular-nums",
                        convierteBultos(l.type) && l.modo === "qty" && "opacity-60"
                      )}
                    />
                  )}

                  {llevaBultos(l.type) && (
                    <input
                      value={l.unit ?? ""}
                      onChange={(e) => set(l.id, { unit: e.target.value.toUpperCase() })}
                      list="unidades-erp"
                      placeholder="PZA"
                      className={cn(campo, "px-2 text-center")}
                    />
                  )}

                  <input
                    value={l.unit_price}
                    onChange={(e) => set(l.id, { unit_price: e.target.value })}
                    inputMode="decimal"
                    placeholder={l.type === "charge" ? "Monto" : "Precio"}
                    className={cn(campo, "text-right tabular-nums")}
                  />
                  <div className="text-right text-[15px] font-semibold tabular-nums">
                    {usd(importe(l))}
                  </div>
                  <button
                    onClick={() => quitar(l.id)}
                    title="Quitar renglón"
                    className="grid size-[30px] place-items-center justify-self-end rounded-full bg-newsprint"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            <datalist id="unidades-erp">
              {UNIDADES.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </section>

          <section className="rounded-[22px] bg-newsprint p-6">
            <h4 className="m-0 mb-3 font-semibold">Notas al cliente</h4>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Instrucciones de entrega, acuerdos de precio, referencias…"
              className="min-h-[88px] w-full resize-y rounded-2xl bg-paper px-4 py-3 text-sm outline-none"
            />
          </section>
        </div>

        <aside className="sticky top-4 flex flex-col gap-3 rounded-[22px] bg-newsprint p-6 text-sm">
          <h4 className="m-0 mb-1 font-semibold">Resumen</h4>
          {TABS.map(({ id, label }) => {
            const sub = subtotalTipo(lineas, id)
            return (
              <div key={id} className="flex justify-between">
                <span className="text-neutral-700">{label}</span>
                <span className="tabular-nums">{sub ? usd(sub) : "—"}</span>
              </div>
            )
          })}
          <div className="flex justify-between border-t border-ink/10 pt-2">
            <span className="text-neutral-700">Bultos totales</span>
            <span className="tabular-nums">{bultosTotales ? n0(bultosTotales) : "—"}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between rounded-[14px] bg-paper px-3 py-2.5">
            <span className="text-[15px] font-semibold">Total</span>
            <span className="text-[27px] font-semibold tracking-[-0.02em] tabular-nums">
              {usd(total)}
            </span>
          </div>

          {cortos.length > 0 && (
            <div className="rounded-[14px] bg-paper p-3 text-[13px]">
              Sin existencia suficiente para {cortos.map((l) => l.sku).join(", ")}. El servidor
              rechazará la factura al emitirla — bájala a borrador o ajusta la cantidad.
            </div>
          )}
          {error && <div className="rounded-[14px] bg-ink p-3 text-[13px] text-paper">{error}</div>}

          <button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-paper disabled:opacity-40"
          >
            <Check className="size-4" />
            {guardando ? "Guardando…" : "Emitir factura"}
          </button>
          <div className="text-center text-xs text-neutral-700">
            {lineas.length === 0
              ? "Agrega al menos un renglón."
              : faltantes.length > 0
                ? `Faltan datos en ${faltantes.length} renglón${faltantes.length > 1 ? "es" : ""}.`
                : descontar
                  ? "Se emite activa y descuenta inventario."
                  : "Se guarda como borrador, sin mover inventario."}
          </div>
        </aside>
      </div>
    </div>
  )
}
