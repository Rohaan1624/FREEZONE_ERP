import * as React from "react"
import { Link, useParams } from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  Store,
  Plus,
  HandCoins,
  Check,
  X,
  CircleAlert,
  Trash2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase, rpc } from "@/lib/supabase"
import { usd, fecha, estadoFactura, TONO_TEXTO } from "@/lib/format"
import { antiguedad } from "@/lib/resumen"
import { M, add, sub, sumar, centavos, esNegativo } from "@/lib/dinero"

const METODOS = [
  ["bank_transfer", "Transferencia"],
  ["cash", "Efectivo"],
  ["cheque", "Cheque"],
  ["card", "Tarjeta"],
  ["other", "Otro"],
]
const ETIQUETA_METODO = Object.fromEntries(METODOS)
const ETIQUETA_TIPO = { company: "Empresa", individual: "Persona", government: "Gobierno" }

// Same sequential ramp as the dashboard: stepped 300/500/700/ink so the two
// oldest buckets stay distinguishable (ΔE 19 rather than 14).
const RAMPA_EDAD = [
  "var(--color-neutral-300)",
  "var(--color-neutral-500)",
  "var(--color-neutral-700)",
  "var(--color-ink)",
]

export default function Cliente() {
  const { id } = useParams()
  const [cliente, setCliente] = React.useState(null)
  const [facturas, setFacturas] = React.useState([])
  const [pagos, setPagos] = React.useState([])
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState("")
  const [recarga, setRecarga] = React.useState(0)
  const [ocupado, setOcupado] = React.useState(false)
  const [pago, setPago] = React.useState(null)

  React.useEffect(() => {
    let vivo = true
    Promise.all([
      supabase.from("client").select("*").eq("id", id).maybeSingle(),
      supabase.from("invoice").select("*, payments(amount)").eq("client_id", id),
      // Fetched separately, not embedded under invoice: a payment ON ACCOUNT
      // has invoice_id = null and would never appear under any invoice.
      supabase.from("payments").select("*").eq("client_id", id),
    ]).then(([c, f, p]) => {
      if (!vivo) return
      const e = c.error || f.error || p.error
      if (e) setError(e.message)
      setCliente(c.data)
      setFacturas(f.data ?? [])
      setPagos(p.data ?? [])
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [id, recarga])

  async function accion(fn, args) {
    setError("")
    setOcupado(true)
    try {
      await rpc(fn, args)
      setRecarga((n) => n + 1)
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) return <div className="p-6 text-sm text-neutral-700">Cargando…</div>
  if (!cliente) {
    return (
      <div className="registro p-10 text-center">
        <div className="text-base font-semibold">Ese cliente no existe</div>
        <Link to="/clientes" className="mt-4 inline-block text-[13px] underline underline-offset-2">
          Volver a clientes
        </Link>
      </div>
    )
  }

  /**
   * The ledger. Issued invoices are charges (+, what they owe), payments are
   * credits (−). Built ascending so the running balance accumulates correctly,
   * then shown newest-first — the balance column still reads as the balance
   * AFTER that movement, which is what a statement means.
   *
   * Drafts are excluded: nothing is owed until an invoice is issued.
   */
  const movimientos = []
  for (const f of facturas) {
    if (f.status === "draft") continue
    movimientos.push({
      id: `f-${f.id}`,
      orden: f.date_created,
      tipo: "cargo",
      concepto: `Factura ${f.invoice_num}`,
      ref: f.due_date ? `vence ${fecha(f.due_date)}` : "contado",
      monto: M(f.total),
      enlace: `/facturas/${f.id}`,
    })
  }
  for (const p of pagos) {
    movimientos.push({
      id: `p-${p.id}`,
      pagoId: p.id,
      orden: p.date_created,
      tipo: "abono",
      concepto: `Pago · ${ETIQUETA_METODO[p.payment_method] ?? p.payment_method ?? "—"}`,
      ref: p.notes ?? (p.invoice_id ? "" : "a cuenta"),
      monto: M(p.amount),
    })
  }
  movimientos.sort((a, b) => (a.orden < b.orden ? -1 : a.orden > b.orden ? 1 : 0))
  // Running balance in exact decimal — a statement that drifts by a cent is
  // the one number a client WILL notice.
  let corriente = M(0)
  for (const m of movimientos) {
    corriente = m.tipo === "cargo" ? add(corriente, m.monto) : sub(corriente, m.monto)
    m.saldo = centavos(corriente)
  }
  const enOrden = movimientos.slice().reverse()

  const edades = antiguedad(facturas)
  // .num is the plain-number twin, for bar widths only
  const maxEdad = Math.max(1, ...edades.map((e) => e.num))
  const porCobrar = sumar(edades, (e) => e.v)
  const sinAplicar = sumar(
    pagos.filter((p) => !p.invoice_id),
    (p) => p.amount
  )

  // Invoices a payment can be applied to: issued ones, newest first, each with
  // what it still owes. Drafts are excluded — they are not billed yet, and
  // create_payment would be recording money against a document that owes nothing.
  const aplicables = facturas
    .filter((f) => f.status !== "draft")
    .map((f) => ({ ...f, est: estadoFactura(f) }))
    .sort((a, b) => (a.date_created < b.date_created ? 1 : -1))

  const facturaElegida = aplicables.find((f) => f.id === pago?.invoice_id)

  const btn = "boton"
  const rotulo = "rotulo"

  return (
    <div className="flex flex-col gap-3">
      <Link to="/clientes" className="flex items-center gap-2 self-start text-[13px]">
        <ArrowLeft className="size-4" />
        Todos los clientes
      </Link>

      {error && (
        <div className="flex items-center gap-2.5 registro px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="registro p-6">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center casilla">
            <Store className="size-7 text-neutral-700" />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-[25px] font-semibold">{cliente.name}</h2>
            <div className="text-[13px] text-neutral-700">
              {[
                ETIQUETA_TIPO[cliente.client_type] ?? cliente.client_type,
                cliente.identifier,
                cliente.contact,
                cliente.email,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={() =>
                setPago({ amount: "", method: "bank_transfer", notes: "", invoice_id: "" })
              }
              disabled={ocupado}
              className={cn(btn, "boton-ink")}
            >
              <HandCoins className="size-4" />
              Registrar pago
            </button>
            <Link to="/facturas/nueva" className={cn(btn, "boton-claro")}>
              <Plus className="size-4" />
              Nueva factura
            </Link>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
          <div className="casilla px-4 py-3">
            <div className={rotulo}>Saldo actual</div>
            <div className="text-[30px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
              {usd(cliente.balance)}
            </div>
            {esNegativo(cliente.balance) && (
              <div className="text-[11px] text-neutral-700">a favor del cliente</div>
            )}
          </div>
          <div className="casilla px-4 py-3">
            <div className={rotulo}>Por cobrar</div>
            <div className="text-[30px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
              {usd(porCobrar)}
            </div>
            <div className="text-[11px] text-neutral-700">
              {facturas.filter((f) => f.status !== "draft").length} facturas emitidas
            </div>
          </div>
          <div className="casilla px-4 py-3">
            <div className={rotulo}>Condiciones</div>
            <div className="text-[30px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
              {cliente.payment_terms ? `Neto ${cliente.payment_terms}` : "Contado"}
            </div>
          </div>
          <div className="casilla px-4 py-3">
            <div className={rotulo}>Pagos a cuenta</div>
            <div className="text-[30px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
              {sinAplicar ? usd(sinAplicar) : "—"}
            </div>
            <div className="text-[11px] text-neutral-700">sin aplicar a una factura</div>
          </div>
        </div>
      </section>

      {pago && (
        <section className="registro p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h4 className="m-0 font-semibold">Registrar pago</h4>
            <span className="text-[13px] text-neutral-700">
              {facturaElegida
                ? `se aplica a ${facturaElegida.invoice_num}`
                : "queda a cuenta del cliente"}
            </span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => setPago(null)} className={cn(btn, "boton-claro")}>
                <X className="size-4" />
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const monto = Number(pago.amount)
                  if (!monto || monto <= 0) return setError("El monto debe ser mayor que 0.")
                  await accion("create_payment", {
                    p_client_id: id,
                    p_amount: monto,
                    p_payment_method: pago.method,
                    // Optional: applying it to an invoice or leaving it on
                    // account changes NOTHING for the balance — both are
                    // subtracted by recalc_client_balance. The link only
                    // records which document the money was meant for.
                    p_invoice_id: pago.invoice_id || null,
                    p_notes: pago.notes.trim() || null,
                  })
                  setPago(null)
                }}
                disabled={ocupado}
                className={cn(btn, "boton-ink")}
              >
                <Check className="size-4" />
                Guardar pago
              </button>
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
            <label className="block casilla px-4 py-2.5">
              <span className={rotulo}>Aplicar a</span>
              <select
                value={pago.invoice_id}
                onChange={(e) => {
                  const f = aplicables.find((x) => x.id === e.target.value)
                  // Prefill with what that invoice still owes — the common case.
                  // Editable afterwards, since partial payments are normal.
                  setPago({
                    ...pago,
                    invoice_id: e.target.value,
                    amount: f ? (f.est.saldo.eq(0) ? "" : f.est.saldo.toFixed(2)) : "",
                  })
                }}
                className="mt-0.5 w-full bg-transparent text-base outline-none"
              >
                <option value="">Sin aplicar · a cuenta</option>
                {aplicables.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.invoice_num} · {f.est.saldo.eq(0) ? "pagada" : `debe ${usd(f.est.saldo)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block casilla px-4 py-2.5">
              <span className={rotulo}>Monto</span>
              <input
                value={pago.amount}
                onChange={(e) => setPago({ ...pago, amount: e.target.value })}
                inputMode="decimal"
                autoFocus
                className="mt-0.5 w-full bg-transparent text-base tabular-nums outline-none"
              />
            </label>
            <label className="block casilla px-4 py-2.5">
              <span className={rotulo}>Método</span>
              <select
                value={pago.method}
                onChange={(e) => setPago({ ...pago, method: e.target.value })}
                className="mt-0.5 w-full bg-transparent text-base outline-none"
              >
                {METODOS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block casilla px-4 py-2.5">
              <span className={rotulo}>Referencia</span>
              <input
                value={pago.notes}
                onChange={(e) => setPago({ ...pago, notes: e.target.value })}
                placeholder="Cheque 0001 · Ref. 0001"
                className="mt-0.5 w-full bg-transparent text-base outline-none"
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-neutral-700">
            {facturaElegida
              ? `Se registra contra ${facturaElegida.invoice_num}. Si pagas de más, el excedente queda a favor del cliente.`
              : "Sin factura, el pago baja el saldo global del cliente y queda como «a cuenta». En ambos casos el saldo se recalcula igual."}
          </p>
        </section>
      )}

      {porCobrar.gt(0) && (
        <section className="registro p-6">
          <h4 className="m-0 mb-3 font-semibold">Antigüedad del saldo</h4>
          <div>
            {edades.map((a, i) => (
              <div
                key={a.k}
                className="registro-fila grid grid-cols-[110px_minmax(0,1fr)_104px] items-center gap-3 px-1 py-3"
              >
                <div className="text-xs text-ink/62">{a.k}</div>
                <div className="h-2.5 overflow-hidden rounded-sm bg-neutral-200">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.max(2, (a.num / maxEdad) * 100)}%`,
                      background: RAMPA_EDAD[i],
                    }}
                  />
                </div>
                {/* Direct label on every bar — the pale ramp steps require it */}
                <div className="text-right text-[15px] font-semibold tabular-nums">{usd(a.v)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="registro p-6">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h4 className="m-0 font-semibold">Movimientos</h4>
          <div className="ml-auto flex gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <ArrowUpRight className="size-4 text-neutral-700" />
              Cargo: aumenta lo que debe
            </span>
            <span className="flex items-center gap-1.5">
              <ArrowDownLeft className="size-4 text-neutral-700" />
              Abono: pago recibido
            </span>
          </div>
        </div>

        {enOrden.length === 0 ? (
          <div className="casilla p-8 text-center text-[13px] text-neutral-700">
            Sin movimientos. Las facturas en borrador no aparecen aquí: no se debe nada hasta
            emitirlas.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[40px_96px_minmax(0,1.5fr)_minmax(0,1fr)_100px_100px_110px_34px] gap-3 border-b border-neutral-300 px-1 pb-2 rotulo">
              <div />
              <div>Fecha</div>
              <div>Concepto</div>
              <div>Referencia</div>
              <div className="text-right">Cargo</div>
              <div className="text-right">Abono</div>
              <div className="text-right">Saldo</div>
              <div />
            </div>
            <div>
              {enOrden.map((m) => (
                <div
                  key={m.id}
                  className="registro-fila grid grid-cols-[40px_96px_minmax(0,1.5fr)_minmax(0,1fr)_100px_100px_110px_34px] items-center gap-3 px-1 py-2.5"
                >
                  <span className="grid size-8 place-items-center rounded-xl bg-newsprint">
                    {m.tipo === "cargo" ? (
                      <ArrowUpRight className="size-4 text-neutral-700" />
                    ) : (
                      <ArrowDownLeft className="size-4 text-neutral-700" />
                    )}
                  </span>
                  <div className="text-[13px] text-neutral-700 tabular-nums">{fecha(m.orden)}</div>
                  <div className="truncate text-sm">
                    {m.enlace ? (
                      <Link to={m.enlace} className="underline-offset-2 hover:underline">
                        {m.concepto}
                      </Link>
                    ) : (
                      m.concepto
                    )}
                  </div>
                  <div className="truncate text-[12px] text-neutral-700">{m.ref}</div>
                  <div className="text-right text-sm tabular-nums">
                    {m.tipo === "cargo" ? usd(m.monto) : "—"}
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    {m.tipo === "abono" ? usd(m.monto) : "—"}
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums">
                    {usd(m.saldo)}
                  </div>
                  {m.pagoId ? (
                    <button
                      onClick={() => {
                        if (confirm(`¿Eliminar el pago de ${usd(m.monto)}?`))
                          accion("delete_payment", { p_payment_id: m.pagoId })
                      }}
                      disabled={ocupado}
                      title="Eliminar pago"
                      className="accion justify-self-end"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : (
                    <div />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="registro p-6">
        <h4 className="m-0 mb-3 font-semibold">Facturas del cliente</h4>
        {facturas.length === 0 ? (
          <div className="casilla p-8 text-center text-[13px] text-neutral-700">
            Este cliente todavía no tiene facturas.
          </div>
        ) : (
          <div>
            {facturas
              .slice()
              .sort((a, b) => (a.date_created < b.date_created ? 1 : -1))
              .map((f) => {
                const est = estadoFactura(f)
                return (
                  <Link
                    key={f.id}
                    to={`/facturas/${f.id}`}
                    className="registro-fila grid grid-cols-[minmax(90px,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.95fr)_26px] items-center gap-3 px-1 py-2.5 transition-colors hover:bg-neutral-100"
                  >
                    <div className="text-sm font-semibold">{f.invoice_num}</div>
                    <div className="text-[13px] text-neutral-700 tabular-nums">
                      {fecha(f.date_created)}
                    </div>
                    <div className="text-right text-sm tabular-nums">{usd(f.total)}</div>
                    <div className="text-right text-sm font-semibold tabular-nums">
                      {est.saldo < 0.01 ? "—" : usd(est.saldo)}
                    </div>
                    <div>
                      <span
                        className={cn(
                          "text-[13px]",
                          TONO_TEXTO[est.etiqueta]
                        )}
                      >
                        {est.etiqueta}
                      </span>
                    </div>
                    <ArrowRight className="size-4 justify-self-end text-neutral-700" />
                  </Link>
                )
              })}
          </div>
        )}
      </section>
    </div>
  )
}
