import * as React from "react"
import { Link } from "react-router-dom"
import {
  TrendingUp,
  TrendingDown,
  HandCoins,
  Percent,
  Boxes,
  Receipt,
  ArrowRight,
  Table2,
  BarChart3,
  CircleAlert,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { usd, n0 } from "@/lib/format"
import { div, sumar } from "@/lib/dinero"
import {
  barrasIngresos,
  variacion,
  antiguedad,
  margenPeriodo,
  topSkus,
  cobrado,
  valorInventario,
  ventana,
} from "@/lib/resumen"

const PERIODOS = [
  ["anio", "Año"],
  ["mes", "Mes"],
  ["semana", "Semana"],
]

/**
 * Chart colours. This design system is monochrome, so these are a SEQUENTIAL
 * ramp (emphasis vs reference; ordered severity), not categorical hues — the
 * right check is lightness monotonicity, which these satisfy.
 *
 * The aging ramp is stepped 300/500/700/ink rather than 400/600/800/ink: the
 * tighter steps put the last two buckets at ΔE 14.1, below the readable floor.
 * These sit at ΔE 19.0.
 *
 * The pale steps fall under 3:1 against the surface, which obligates relief —
 * hence a value label on every bar AND a table view.
 */
const SERIE_ACTUAL = "var(--color-ink)"
const SERIE_PREVIA = "var(--color-neutral-400)"
const RAMPA_EDAD = [
  "var(--color-neutral-300)",
  "var(--color-neutral-500)",
  "var(--color-neutral-700)",
  "var(--color-ink)",
]

export default function Resumen() {
  const [periodo, setPeriodo] = React.useState("anio")
  const [facturas, setFacturas] = React.useState([])
  const [lineas, setLineas] = React.useState([])
  const [productos, setProductos] = React.useState([])
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState("")
  const [tabla, setTabla] = React.useState(false)
  const [activa, setActiva] = React.useState(null)

  React.useEffect(() => {
    let vivo = true
    Promise.all([
      supabase.from("invoice").select("id,total,status,date_created,due_date,payments(amount,date_created)"),
      supabase
        .from("transaction")
        .select("qty,unit_price,type,product(sku,description,cost_price),invoice!inner(status,date_created)"),
      supabase.from("product").select("stock,cost_price"),
    ]).then(([a, b, c]) => {
      if (!vivo) return
      const e = a.error || b.error || c.error
      if (e) setError(e.message)
      setFacturas(a.data ?? [])
      setLineas(b.data ?? [])
      setProductos(c.data ?? [])
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [])

  const barras = barrasIngresos(facturas, periodo)
  const varia = variacion(barras.totalActual, barras.totalPrevio)
  const edades = antiguedad(facturas)
  const margen = margenPeriodo(lineas, periodo)
  const top = topSkus(lineas, periodo)
  const pagado = cobrado(facturas, periodo)
  const inv = valorInventario(productos)
  const { desde, hasta } = ventana(periodo)

  const numFacturas = facturas.filter((f) => {
    if (f.status === "draft" || !f.date_created) return false
    const d = new Date(f.date_created.slice(0, 10) + "T00:00:00")
    return d >= desde && d < hasta
  }).length

  // Geometry uses the plain-number twins (…Num). The Big values are money and
  // are only ever formatted, never divided into a percentage.
  const maxBarra = Math.max(1, ...barras.actualNum, ...barras.previoNum)
  const maxEdad = Math.max(1, ...edades.map((e) => e.num))
  const porCobrar = sumar(edades, (e) => e.v)

  const rango = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" })
  const etiquetaRango = `${rango.format(desde)} – ${rango.format(new Date(hasta - 86400000))} ${desde.getFullYear()}`

  if (cargando) return <div className="p-6 text-sm text-neutral-700">Cargando…</div>

  const rotulo = "text-[10px] tracking-[0.12em] text-ink/55 uppercase"

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-newsprint px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.78fr)]">
        <section className="rounded-[22px] bg-newsprint p-6">
          {/* Filters in one row above the chart */}
          <div className="mb-4 flex flex-wrap items-start gap-4">
            <div>
              <div className={rotulo}>Ingresos facturados</div>
              <div className="mt-1 text-[13px] text-neutral-700">{etiquetaRango}</div>
            </div>
            <div className="ml-auto inline-flex gap-1 rounded-full bg-paper p-1">
              {PERIODOS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setPeriodo(id)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-[13px]",
                    periodo === id ? "bg-ink text-paper" : "text-ink"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Hero number — a stat, not a chart. Shown to the CENT: this is the
              money that was actually billed, and a summary that quietly drops
              the cents is a summary you cannot reconcile against the invoices
              it came from. */}
          <div className="text-[64px] leading-[0.95] font-semibold tracking-[-0.035em] tabular-nums">
            {usd(barras.totalActual)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm">
            {varia === null ? (
              <span className="text-neutral-700">Sin periodo anterior con que comparar</span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1 font-semibold tabular-nums">
                  {varia >= 0 ? (
                    <TrendingUp className="size-4" />
                  ) : (
                    <TrendingDown className="size-4" />
                  )}
                  {varia >= 0 ? "+" : ""}
                  {varia.toFixed(1)}%
                </span>
                <span className="text-neutral-700">
                  contra {usd(barras.totalPrevio)} en {barras.anioPrevio}
                </span>
              </>
            )}
          </div>

          <div className="mt-6">
            <div className="mb-3 flex flex-wrap items-center gap-4">
              <div className={rotulo}>
                {periodo === "anio"
                  ? "Ingresos por mes"
                  : periodo === "mes"
                    ? "Ingresos por semana"
                    : "Ingresos por día"}
              </div>
              {/* Legend: always present for 2 series */}
              <div className="ml-auto flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-[3px]"
                    style={{ background: SERIE_ACTUAL }}
                  />
                  {barras.anioActual}
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-[3px]"
                    style={{ background: SERIE_PREVIA }}
                  />
                  {barras.anioPrevio}
                </span>
                <button
                  onClick={() => setTabla((v) => !v)}
                  title={tabla ? "Ver gráfica" : "Ver tabla"}
                  className="grid size-7 place-items-center rounded-full bg-paper"
                >
                  {tabla ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
                </button>
              </div>
            </div>

            {tabla ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className={rotulo}>
                      <th className="py-2 text-left font-normal">Periodo</th>
                      <th className="py-2 text-right font-normal">{barras.anioActual}</th>
                      <th className="py-2 text-right font-normal">{barras.anioPrevio}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {barras.etiquetas.map((e, i) => (
                      <tr key={i} className="border-t border-ink/8">
                        <td className="py-1.5">{e}</td>
                        <td className="py-1.5 text-right">{usd(barras.actual[i])}</td>
                        <td className="py-1.5 text-right text-neutral-700">
                          {usd(barras.previo[i])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex h-[190px] items-end gap-2">
                {barras.etiquetas.map((e, i) => {
                  const viva = activa === i
                  return (
                    <div
                      key={i}
                      onMouseEnter={() => setActiva(i)}
                      onMouseLeave={() => setActiva(null)}
                      className="relative flex h-full flex-1 flex-col justify-end gap-2"
                    >
                      {viva && (
                        <div className="pointer-events-none absolute -top-1 left-1/2 z-10 w-max -translate-x-1/2 -translate-y-full rounded-xl bg-ink px-3 py-2 text-[11px] text-paper shadow-md">
                          <div className="font-semibold">{e}</div>
                          <div className="tabular-nums">
                            {barras.anioActual}: {usd(barras.actual[i])}
                          </div>
                          <div className="tabular-nums opacity-75">
                            {barras.anioPrevio}: {usd(barras.previo[i])}
                          </div>
                        </div>
                      )}
                      {/* 2px gap between adjacent bars; 4px rounded data-end on the baseline */}
                      <div className="flex flex-1 items-end gap-[2px]">
                        <div
                          className="flex-1 rounded-t-[4px] transition-opacity"
                          style={{
                            background: SERIE_ACTUAL,
                            height: `${Math.max(1, (barras.actualNum[i] / maxBarra) * 100)}%`,
                            opacity: activa === null || viva ? 1 : 0.55,
                          }}
                        />
                        <div
                          className="flex-1 rounded-t-[4px] transition-opacity"
                          style={{
                            background: SERIE_PREVIA,
                            height: `${Math.max(1, (barras.previoNum[i] / maxBarra) * 100)}%`,
                            opacity: activa === null || viva ? 1 : 0.55,
                          }}
                        />
                      </div>
                      <div className="text-center text-[10px] tracking-[0.06em] text-ink/55 uppercase">
                        {e}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* Stat tiles — no plots, so no hover layer needed */}
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              icon: HandCoins,
              k: "Cobrado",
              v: usd(pagado),
              sub: (() => {
                const r = div(pagado, barras.totalActual)
                return r === null
                  ? "sin facturación en el periodo"
                  : `${Number(r.times(100).toString()).toFixed(0)}% de lo facturado`
              })(),
            },
            {
              icon: Percent,
              k: "Margen bruto",
              v: margen.porcentaje === null ? "—" : `${margen.porcentaje.toFixed(1)}%`,
              sub:
                margen.porcentaje === null
                  ? "faltan costos o ventas"
                  : `${usd(margen.utilidad)} de utilidad`,
              aviso: margen.sinCosto > 0 ? `${margen.sinCosto} renglones sin costo` : null,
            },
            {
              icon: Boxes,
              k: "Inventario",
              v: usd(inv.valor),
              sub: `${inv.skus} SKU en piso`,
              aviso: inv.sinCosto > 0 ? `${inv.sinCosto} sin costo` : null,
            },
            {
              icon: Receipt,
              k: "Facturas",
              v: n0(numFacturas),
              sub: (() => {
                const r = div(barras.totalActual, numFacturas)
                return r === null ? "ninguna emitida" : `ticket ${usd(r)}`
              })(),
            },
          ].map(({ icon: Icon, k, v, sub, aviso }) => (
            <div key={k} className="flex flex-col gap-0.5 rounded-[18px] bg-newsprint p-4">
              <Icon className="mb-1.5 size-[22px] text-neutral-700" />
              <div className={rotulo}>{k}</div>
              <div className="text-[28px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
                {v}
              </div>
              <div className="text-xs text-neutral-700">{sub}</div>
              {aviso && <div className="mt-0.5 text-[11px] text-ink/55">{aviso}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="rounded-[22px] bg-newsprint p-6">
          <div className="mb-4 flex items-center gap-3">
            <h4 className="m-0 font-semibold">Cuentas por cobrar</h4>
            <span className="text-[17px] font-semibold tabular-nums">{usd(porCobrar)}</span>
            <Link
              to="/clientes"
              className="ml-auto flex items-center gap-1.5 text-[13px]"
            >
              Por cliente
              <ArrowRight className="size-4" />
            </Link>
          </div>
          {porCobrar.eq(0) ? (
            <div className="rounded-xl bg-paper p-6 text-center text-[13px] text-neutral-700">
              Nada pendiente de cobro.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {edades.map((a, i) => (
                <div
                  key={a.k}
                  className="grid grid-cols-[110px_minmax(0,1fr)_104px] items-center gap-3 rounded-xl bg-paper px-3 py-2.5"
                >
                  <div className="text-xs text-ink/62">{a.k}</div>
                  <div className="h-3 overflow-hidden rounded-full bg-ink/8">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (a.num / maxEdad) * 100)}%`,
                        background: RAMPA_EDAD[i],
                      }}
                    />
                  </div>
                  {/* Direct label on every bar — the pale ramp steps require it */}
                  <div className="text-right text-[15px] font-semibold tabular-nums">
                    {usd(a.v)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[22px] bg-newsprint p-6">
          <div className="mb-4 flex items-center gap-3">
            <h4 className="m-0 font-semibold">SKU más vendidos</h4>
            <Link to="/productos" className="ml-auto flex items-center gap-1.5 text-[13px]">
              Catálogo
              <ArrowRight className="size-4" />
            </Link>
          </div>
          {top.length === 0 ? (
            <div className="rounded-xl bg-paper p-6 text-center text-[13px] text-neutral-700">
              Sin ventas de productos en el periodo.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {top.map((t, i) => (
                <div
                  key={t.sku}
                  className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-paper px-3 py-2.5"
                >
                  <div className="grid size-[26px] place-items-center rounded-full bg-newsprint text-[13px] font-semibold tabular-nums">
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm">{t.nombre}</div>
                    <div className="text-[11px] text-neutral-700 tabular-nums">
                      {t.sku} · {n0(t.unidades)} unidades
                    </div>
                  </div>
                  <div className="text-[16px] font-semibold tabular-nums">{usd(t.importe)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
