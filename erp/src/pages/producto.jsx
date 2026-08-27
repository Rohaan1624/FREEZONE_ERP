import * as React from "react"
import { Link, useParams } from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  Package,
  Receipt,
  Truck,
  SlidersHorizontal,
  CircleAlert,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { usd, n0, fecha, margenTexto, markupTexto } from "@/lib/format"
import { mul } from "@/lib/dinero"

const FUENTE = {
  invoice: { etiqueta: "Factura", icono: Receipt, ruta: (id) => `/facturas/${id}` },
  purchase: { etiqueta: "Entrada", icono: Truck, ruta: (id) => `/entradas/${id}` },
  adjustment: { etiqueta: "Ajuste", icono: SlidersHorizontal, ruta: () => "/entradas/ajustes" },
}

const FILTROS = [
  ["todas", "Todas"],
  ["invoice", "Facturas"],
  ["purchase", "Entradas"],
  ["adjustment", "Ajustes"],
]

export default function Producto() {
  const { id } = useParams()
  const [prod, setProd] = React.useState(null)
  const [movs, setMovs] = React.useState([])
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState("")
  const [filtro, setFiltro] = React.useState("todas")

  React.useEffect(() => {
    let vivo = true
    Promise.all([
      supabase.from("product").select("*").eq("id", id).maybeSingle(),
      // The unified ledger: invoices out, closed purchases in, adjustments
      // either way. security_invoker on the view scopes it to this account.
      supabase
        .from("stock_movement")
        .select("*")
        .eq("product_id", id)
        .order("occurred_at", { ascending: true }),
    ]).then(([p, m]) => {
      if (!vivo) return
      const e = p.error || m.error
      if (e) setError(e.message)
      setProd(p.data)
      setMovs(m.data ?? [])
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [id])

  if (cargando) return <div className="p-6 text-sm text-neutral-700">Cargando…</div>
  if (!prod) {
    return (
      <div className="rounded-[22px] bg-newsprint p-10 text-center">
        <div className="text-base font-semibold">Ese producto no existe</div>
        <Link to="/productos" className="mt-4 inline-block text-[13px] underline underline-offset-2">
          Volver al catálogo
        </Link>
      </div>
    )
  }

  /**
   * Running stock. The ledger records CHANGES, not levels, so the opening
   * figure is derived backwards: current stock minus everything that happened.
   * Then it accumulates forward, and every row shows the stock AFTER that
   * movement — the last row must land exactly on product.stock, which is the
   * whole point of being able to audit it.
   */
  const neto = movs.reduce((t, m) => t + Number(m.qty_delta ?? 0), 0)
  const apertura = Number(prod.stock ?? 0) - neto
  let corriente = apertura
  const conSaldo = movs.map((m) => {
    corriente += Number(m.qty_delta ?? 0)
    return { ...m, existencia: corriente }
  })

  const visibles = (filtro === "todas" ? conSaldo : conSaldo.filter((m) => m.source === filtro))
    .slice()
    .reverse()

  const entradas = movs.filter((m) => Number(m.qty_delta) > 0).reduce((t, m) => t + Number(m.qty_delta), 0)
  const salidas = movs.filter((m) => Number(m.qty_delta) < 0).reduce((t, m) => t - Number(m.qty_delta), 0)
  const valor = mul(prod.stock ?? 0, prod.cost_price ?? 0)

  const rotulo = "text-[10px] tracking-[0.1em] text-ink/50 uppercase"
  const GRID = "grid-cols-[40px_96px_minmax(0,1.1fr)_minmax(0,1.5fr)_88px_88px_100px_26px]"

  return (
    <div className="flex flex-col gap-3">
      <Link to="/productos" className="flex items-center gap-2 self-start text-[13px]">
        <ArrowLeft className="size-4" />
        Catálogo
      </Link>

      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-newsprint px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="rounded-[22px] bg-newsprint p-6">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-[18px] bg-paper">
            <Package className="size-7 text-neutral-700" />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-[25px] font-semibold">{prod.description || prod.sku}</h2>
            <div className="text-[13px] text-neutral-700 tabular-nums">
              {[
                prod.sku,
                prod.qty_unit > 1 ? `${prod.qty_unit} por bulto` : "suelto",
                prod.unit ?? "PZA",
                prod.weight_kg ? `${prod.weight_kg} kg` : null,
                prod.cbm ? `${prod.cbm} CBM` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
          <div className="rounded-2xl bg-paper px-4 py-3">
            <div className={rotulo}>Existencia</div>
            <div className="text-[30px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
              {n0(prod.stock)}
            </div>
            <div className="text-[11px] text-neutral-700">
              {prod.qty_unit > 1 ? `${n0(Math.floor(prod.stock / prod.qty_unit))} bultos` : " "}
            </div>
          </div>
          <div className="rounded-2xl bg-paper px-4 py-3">
            <div className={rotulo}>Valuado a costo</div>
            <div className="text-[30px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
              {prod.cost_price == null ? "—" : usd(valor)}
            </div>
            <div className="text-[11px] text-neutral-700">
              {prod.cost_price == null ? "sin costo capturado" : `costo ${usd(prod.cost_price)}`}
            </div>
          </div>
          <div className="rounded-2xl bg-paper px-4 py-3">
            <div className={rotulo}>Precio</div>
            <div className="text-[30px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
              {prod.sale_price == null ? "—" : usd(prod.sale_price)}
            </div>
            <div className="text-[11px] text-neutral-700 tabular-nums">
              {margenTexto(prod.cost_price, prod.sale_price)} ·{" "}
              {markupTexto(prod.cost_price, prod.sale_price)} sobre costo
            </div>
          </div>
          <div className="rounded-2xl bg-paper px-4 py-3">
            <div className={rotulo}>Movimientos</div>
            <div className="text-[30px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
              {n0(movs.length)}
            </div>
            <div className="text-[11px] text-neutral-700 tabular-nums">
              +{n0(entradas)} entraron · −{n0(salidas)} salieron
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[22px] bg-newsprint p-6">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h4 className="m-0 font-semibold">Movimientos</h4>
          <span className="text-[12px] text-neutral-700 tabular-nums">
            apertura {n0(apertura)} → existencia actual {n0(prod.stock)}
          </span>
          <div className="ml-auto inline-flex gap-1 rounded-full bg-paper p-1">
            {FILTROS.map(([k, etiqueta]) => (
              <button
                key={k}
                onClick={() => setFiltro(k)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12px]",
                  filtro === k ? "bg-ink text-paper" : "text-ink"
                )}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        </div>

        {visibles.length === 0 ? (
          <div className="rounded-xl bg-paper p-8 text-center text-[13px] text-neutral-700">
            {movs.length === 0
              ? "Este SKU todavía no tiene movimientos. La existencia sube al cerrar una entrada y baja al emitir una factura."
              : "Ningún movimiento de ese tipo."}
          </div>
        ) : (
          <>
            <div className={cn("grid gap-3 px-3 pb-2", GRID, rotulo)}>
              <div />
              <div>Fecha</div>
              <div>Documento</div>
              <div>Origen o destino</div>
              <div className="text-right">Entrada</div>
              <div className="text-right">Salida</div>
              <div className="text-right">Existencia</div>
              <div />
            </div>
            <div className="flex flex-col gap-2">
              {visibles.map((m) => {
                const f = FUENTE[m.source] ?? {}
                const Icono = f.icono ?? Package
                const entra = Number(m.qty_delta) > 0
                return (
                  <Link
                    key={`${m.source}-${m.id}`}
                    to={f.ruta ? f.ruta(m.source_id) : "#"}
                    className={cn(
                      "grid items-center gap-3 rounded-[14px] bg-paper p-3 transition-shadow hover:shadow-sm",
                      GRID
                    )}
                  >
                    <span className="grid size-8 place-items-center rounded-xl bg-newsprint">
                      {entra ? (
                        <ArrowDownLeft className="size-4 text-neutral-700" />
                      ) : (
                        <ArrowUpRight className="size-4 text-neutral-700" />
                      )}
                    </span>
                    <div className="text-[13px] text-neutral-700 tabular-nums">
                      {fecha(m.occurred_at)}
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Icono className="size-3.5 shrink-0 text-neutral-700" />
                      <span className="truncate text-sm font-semibold">
                        {m.reference ?? f.etiqueta ?? m.source}
                      </span>
                    </div>
                    <div className="truncate text-[13px] text-neutral-700">
                      {m.counterparty ?? m.description ?? "—"}
                    </div>
                    <div className="text-right text-sm tabular-nums">
                      {entra ? `+${n0(m.qty_delta)}` : "—"}
                    </div>
                    <div className="text-right text-sm tabular-nums">
                      {entra ? "—" : `−${n0(-m.qty_delta)}`}
                    </div>
                    <div className="text-right text-sm font-semibold tabular-nums">
                      {n0(m.existencia)}
                    </div>
                    <ArrowRight className="size-4 justify-self-end text-neutral-700" />
                  </Link>
                )
              })}
            </div>
          </>
        )}

        <p className="mt-3 text-xs text-neutral-700">
          Solo cuentan las facturas emitidas y las entradas cerradas: un borrador no reserva nada y
          una entrada pendiente todavía no llegó. La última fila cuadra siempre con la existencia
          actual — si no, hay algo que revisar.
        </p>
      </section>
    </div>
  )
}
