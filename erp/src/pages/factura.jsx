import * as React from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  Check,
  Trash2,
  CircleAlert,
  HandCoins,
  Lock,
  LockOpen,
  Undo2,
  X,
  Pencil,
  Printer,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase, rpc } from "@/lib/supabase"
import { usd, n0, fecha, estadoFactura, TONO_TEXTO } from "@/lib/format"
import { M, mul, sub, sumar } from "@/lib/dinero"

const METODOS = [
  ["bank_transfer", "Transferencia"],
  ["cash", "Efectivo"],
  ["cheque", "Cheque"],
  ["card", "Tarjeta"],
  ["other", "Otro"],
]
const ETIQUETA_METODO = Object.fromEntries(METODOS)

const TIPO_LINEA = { product: "Producto", miscellaneous: "Misceláneo", charge: "Cargo" }

export default function Factura() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inv, setInv] = React.useState(null)
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState("")
  const [ocupado, setOcupado] = React.useState(false)
  const [recarga, setRecarga] = React.useState(0)
  const [pago, setPago] = React.useState(null)

  React.useEffect(() => {
    let vivo = true
    supabase
      .from("invoice")
      .select(
        "*, transaction(*, product(sku,description,unit)), payments(*), client(id,name,identifier,contact,email)"
      )
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setError(error.message)
        else setInv(data)
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [id, recarga])

  const refrescar = () => setRecarga((n) => n + 1)

  /** Every mutation is an RPC — invoice and payments have no write policy. */
  async function accion(fn, args, alBorrar) {
    setError("")
    setOcupado(true)
    try {
      await rpc(fn, args)
      if (alBorrar) navigate("/facturas")
      else refrescar()
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) return <div className="p-6 text-sm text-neutral-700">Cargando…</div>
  if (!inv) {
    return (
      <div className="registro p-10 text-center">
        <div className="text-base font-semibold">Esa factura no existe</div>
        <div className="mt-1 text-[13px] text-neutral-700">
          Puede haberse eliminado, o pertenecer a otra cuenta.
        </div>
        <Link to="/facturas" className="mt-4 inline-block underline underline-offset-2 text-[13px]">
          Volver a facturas
        </Link>
      </div>
    )
  }

  const est = estadoFactura(inv)
  const lineas = inv.transaction ?? []
  const pagos = (inv.payments ?? []).slice().sort((a, b) => (a.date_created < b.date_created ? 1 : -1))
  const bultos = lineas.reduce((t, l) => t + Number(l.bultos ?? 0), 0)
  const esBorrador = inv.status === "draft"
  const esActiva = inv.status === "active"
  const esCerrada = inv.status === "closed"

  const btn = "boton"
  const rotulo = "rotulo"

  return (
    <div className="flex flex-col gap-3">
      <Link to="/facturas" className="flex items-center gap-2 self-start text-[13px]">
        <ArrowLeft className="size-4" />
        Todas las facturas
      </Link>

      {error && (
        <div className="flex items-center gap-2.5 registro px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="registro p-6">
        <div className="mb-4 flex flex-wrap items-start gap-4">
          <div>
            <div className={rotulo}>Factura de venta</div>
            <div className="mt-0.5 flex items-center gap-3">
              <h2 className="m-0 text-[25px] font-semibold">{inv.invoice_num}</h2>
              <span
                className={cn("text-[13px]", TONO_TEXTO[est.etiqueta])}
              >
                {est.etiqueta}
              </span>
            </div>
            <div className="text-[15px]">{inv.client_name ?? inv.client?.name ?? "—"}</div>
          </div>

          <div className="ml-auto flex flex-wrap gap-2">
            <Link to={`/facturas/${id}/imprimir`} className={cn(btn, "boton-claro")}>
              <Printer className="size-4" />
              Imprimir
            </Link>
            {/* No edit on a closed invoice — update_invoice refuses it. */}
            {!esCerrada && (
              <Link to={`/facturas/${id}/editar`} className={cn(btn, "boton-claro")}>
                <Pencil className="size-4" />
                Editar
              </Link>
            )}
            {esBorrador && (
              <button
                onClick={() => accion("set_invoice_status", { p_invoice_id: id, p_status: "active" })}
                disabled={ocupado}
                className={cn(btn, "boton-ink")}
                title="Descuenta el inventario"
              >
                <Check className="size-4" />
                Emitir
              </button>
            )}
            {esActiva && (
              <>
                <button
                  onClick={() =>
                    setPago({
                      amount: est.saldo.eq(0) ? "" : est.saldo.toFixed(2),
                      method: "bank_transfer",
                      notes: "",
                    })
                  }
                  disabled={ocupado}
                  className={cn(btn, "boton-ink")}
                >
                  <HandCoins className="size-4" />
                  Registrar pago
                </button>
                <button
                  onClick={() => accion("set_invoice_status", { p_invoice_id: id, p_status: "draft" })}
                  disabled={ocupado}
                  className={cn(btn, "boton-claro")}
                  title="Devuelve el inventario y vuelve a borrador"
                >
                  <Undo2 className="size-4" />
                  Volver a borrador
                </button>
                <button
                  onClick={() => accion("set_invoice_status", { p_invoice_id: id, p_status: "closed" })}
                  disabled={ocupado}
                  className={cn(btn, "boton-claro")}
                  title="La congela: no se podrá editar ni eliminar"
                >
                  <Lock className="size-4" />
                  Cerrar
                </button>
              </>
            )}
            {esCerrada && (
              <>
                <button
                  onClick={() =>
                    setPago({
                      amount: est.saldo.eq(0) ? "" : est.saldo.toFixed(2),
                      method: "bank_transfer",
                      notes: "",
                    })
                  }
                  disabled={ocupado}
                  className={cn(btn, "boton-ink")}
                >
                  <HandCoins className="size-4" />
                  Registrar pago
                </button>
                <button
                  onClick={() => accion("reopen_invoice", { p_invoice_id: id })}
                  disabled={ocupado}
                  className={cn(btn, "boton-claro")}
                  title="Vuelve a activa. El inventario no se mueve."
                >
                  <LockOpen className="size-4" />
                  Reabrir
                </button>
              </>
            )}
            {!esCerrada && (
              <button
                onClick={() => {
                  if (confirm(`¿Eliminar ${inv.invoice_num}? No se puede deshacer.`))
                    accion("delete_invoice", { p_invoice_id: id }, true)
                }}
                disabled={ocupado}
                className={cn(btn, "boton-claro")}
                title={esActiva ? "Devuelve el inventario y la elimina" : "La elimina"}
              >
                <Trash2 className="size-4" />
                Eliminar
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
          {[
            ["Emitida", fecha(inv.date_created)],
            ["Vence", inv.due_date ? fecha(inv.due_date) : "Contado"],
            ["RUC", inv.client?.identifier ?? "—"],
            ["Contacto", inv.client?.contact ?? inv.client?.email ?? "—"],
            ["Bultos", bultos ? n0(bultos) : "—"],
          ].map(([k, v]) => (
            <div key={k} className="casilla px-3 py-3">
              <div className={rotulo}>{k}</div>
              <div className="truncate text-[15px] tabular-nums">{v}</div>
            </div>
          ))}
        </div>

        {esBorrador && (
          <p className="mt-3 text-xs text-neutral-700">
            Es un borrador: todavía no descuenta inventario ni cuenta para el saldo del cliente.
            Se cobra y se descuenta al emitirla.
          </p>
        )}
        {esCerrada && (
          <p className="mt-3 text-xs text-neutral-700">
            Está cerrada: no se puede editar ni eliminar. Reábrela si necesitas corregirla.
          </p>
        )}
      </section>

      {pago && (
        <section className="registro p-6">
          <div className="mb-4 flex items-center gap-3">
            <h4 className="m-0 font-semibold">Registrar pago</h4>
            <span className="text-[13px] text-neutral-700">saldo {usd(est.saldo)}</span>
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
                    p_client_id: inv.client_id,
                    p_amount: monto,
                    p_payment_method: pago.method,
                    p_invoice_id: id,
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
            Puedes pagar de más: el excedente queda como saldo a favor del cliente. El saldo se
            recalcula solo.
          </p>
        </section>
      )}

      <section className="registro p-6">
        <h4 className="m-0 mb-3 font-semibold">Renglones</h4>
        <div className="grid grid-cols-[92px_minmax(0,1.8fr)_78px_78px_64px_92px_minmax(0,0.9fr)] gap-2 border-b border-neutral-300 px-1 pb-2 rotulo">
          <div>Tipo</div>
          <div>Descripción</div>
          <div className="text-right">Cantidad</div>
          <div className="text-right">Bultos</div>
          <div>Unidad</div>
          <div className="text-right">Precio</div>
          <div className="text-right">Importe</div>
        </div>
        <div>
          {lineas.map((l) => (
            <div
              key={l.id}
              className="registro-fila grid grid-cols-[92px_minmax(0,1.8fr)_78px_78px_64px_92px_minmax(0,0.9fr)] items-center gap-2 px-1 py-2.5"
            >
              <span className="text-[12px] text-neutral-600">
                {TIPO_LINEA[l.type] ?? l.type}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm">
                  {l.product?.description || l.product?.sku || l.description || "—"}
                </div>
                {l.product?.sku && (
                  <div className="text-[11px] text-neutral-700 tabular-nums">{l.product.sku}</div>
                )}
              </div>
              <div className="text-right text-sm tabular-nums">{n0(l.qty)}</div>
              <div className="text-right text-sm tabular-nums">
                {l.bultos == null ? "—" : l.bultos}
              </div>
              <div className="text-sm">{l.unit || "—"}</div>
              <div className="text-right text-sm tabular-nums">{usd(l.unit_price)}</div>
              <div className="text-right text-[15px] font-semibold tabular-nums">
                {usd(mul(l.qty, l.unit_price))}
              </div>
            </div>
          ))}
          {lineas.length === 0 && (
            <div className="casilla p-6 text-center text-[13px] text-neutral-700">
              Esta factura no tiene renglones.
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
        <section className="registro p-6">
          <h4 className="m-0 mb-3 font-semibold">Pagos aplicados</h4>
          {pagos.length === 0 && (
            <div className="text-[13px] text-neutral-700">Sin pagos registrados.</div>
          )}
          <div>
            {pagos.map((p) => (
              <div
                key={p.id}
                className="registro-fila grid grid-cols-[104px_minmax(0,1fr)_minmax(0,1fr)_104px_34px] items-center gap-3 px-1 py-2.5 text-sm"
              >
                <div className="text-[13px] text-neutral-700 tabular-nums">
                  {fecha(p.date_created)}
                </div>
                <div>{ETIQUETA_METODO[p.payment_method] ?? p.payment_method ?? "—"}</div>
                <div className="truncate text-[13px] text-neutral-700">{p.notes ?? ""}</div>
                <div className="text-right font-semibold tabular-nums">{usd(p.amount)}</div>
                <button
                  onClick={() => {
                    if (confirm(`¿Eliminar el pago de ${usd(p.amount)}?`))
                      accion("delete_payment", { p_payment_id: p.id })
                  }}
                  disabled={ocupado}
                  title="Eliminar pago"
                  className="accion justify-self-end"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <aside className="flex flex-col gap-2.5 registro p-6 text-sm">
          {["product", "miscellaneous", "charge"].map((t) => {
            const subtotal = sumar(
              lineas.filter((l) => l.type === t),
              (l) => mul(l.qty, l.unit_price)
            )
            return (
              <div key={t} className="flex justify-between">
                <span className="text-neutral-700">{TIPO_LINEA[t]}</span>
                <span className="tabular-nums">{subtotal.eq(0) ? "—" : usd(subtotal)}</span>
              </div>
            )
          })}
          <div className="mt-1 flex items-baseline justify-between casilla px-3 py-2.5">
            <span className="text-[15px] font-semibold">Total</span>
            <span className="text-[27px] font-semibold tracking-[-0.02em] tabular-nums">
              {usd(inv.total)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-700">Pagado</span>
            <span className="tabular-nums">{est.pagado.eq(0) ? "—" : usd(est.pagado)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Saldo</span>
            <span className="tabular-nums">{usd(est.saldo)}</span>
          </div>
          {est.pagado.gt(M(inv.total)) && (
            <div className="casilla p-3 text-xs">
              Pagado de más por {usd(sub(est.pagado, inv.total))}. Queda como saldo a favor del
              cliente.
            </div>
          )}
          {inv.notes && (
            <div className="mt-2 casilla p-3">
              <div className={rotulo}>Notas</div>
              <p className="m-0 mt-1 text-[13px] whitespace-pre-wrap">{inv.notes}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
