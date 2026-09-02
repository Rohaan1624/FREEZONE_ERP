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
import { rpc } from "@/lib/supabase"
import { usd, n0 } from "@/lib/format"
import { div, sumar } from "@/lib/dinero"
import { variacion, ventana, desdeRpc, argsRpc } from "@/lib/resumen"

/**
 * Resumen.
 *
 * Mismo criterio que el libro de facturas: superficies de papel blanco con
 * filete, renglones separados por reglas en lugar de tarjetitas flotando, y
 * radios de la escala del sistema (--radius-md 2px, --radius-2xl 4px) en vez
 * de rounded-[22px].
 *
 * Los indicadores se ajustan a su contenido. Antes la rejilla era items-stretch
 * y los estiraba hasta la altura de la gráfica, así que «Cobrado $35,420.80»
 * flotaba sobre 200px de vacío y la pantalla parecía sin terminar.
 */

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

const hoja = "registro"
const rotulo = "rotulo"

export default function Resumen() {
  const [periodo, setPeriodo] = React.useState("anio")
  // Los datos recuerdan de qué periodo son. Así «está cargando» se DERIVA en
  // render en vez de necesitar un setState dentro del efecto, y al cambiar de
  // periodo se siguen viendo las barras anteriores hasta que llegan las nuevas
  // en lugar de vaciarse la pantalla.
  const [datos, setDatos] = React.useState(null)
  const [error, setError] = React.useState("")
  const [tabla, setTabla] = React.useState(false)
  const [activa, setActiva] = React.useState(null)

  // La suma la hace Postgres: vuelven doce cubetas en vez de todos los
  // renglones de todas las facturas. Se vuelve a pedir al cambiar de periodo,
  // porque la ventana es parte de la consulta.
  React.useEffect(() => {
    let vivo = true
    rpc("resumen_dashboard", argsRpc(periodo))
      .then((r) => {
        if (!vivo) return
        setDatos({ periodo, ...desdeRpc(r, periodo) })
        setError("")
      })
      .catch((e) => vivo && setError(e.message))
    return () => {
      vivo = false
    }
  }, [periodo])

  const { desde, hasta } = ventana(periodo)
  if (!datos) return <div className="p-6 text-sm text-neutral-700">Cargando…</div>

  const viejo = datos.periodo !== periodo // ya se pidió el nuevo, aún no llega
  const { barras, edades, margen, top, pagado, inv, numFacturas } = datos
  const varia = variacion(barras.totalActual, barras.totalPrevio)

  // Geometry uses the plain-number twins (…Num). The Big values are money and
  // are only ever formatted, never divided into a percentage.
  const maxBarra = Math.max(1, ...barras.actualNum, ...barras.previoNum)
  const maxEdad = Math.max(1, ...edades.map((e) => e.num))
  const porCobrar = sumar(edades, (e) => e.v)

  const rango = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" })
  const etiquetaRango = `${rango.format(desde)} – ${rango.format(new Date(hasta - 86400000))} ${desde.getFullYear()}`

  const indicadores = [
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
        margen.porcentaje === null ? "faltan costos o ventas" : `${usd(margen.utilidad)} de utilidad`,
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
  ]

  return (
    <div className={cn("flex flex-col gap-4 transition-opacity", viejo && "opacity-60")}>
      {error && (
        <div className={cn("flex items-center gap-2.5 px-4 py-3 text-[13px]", hoja)}>
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* items-start, no items-stretch: cada bloque mide lo que mide. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.78fr)]">
        <section className={cn("p-6", hoja)}>
          <div className="mb-4 flex flex-wrap items-start gap-4">
            <div>
              <div className={rotulo}>Ingresos facturados</div>
              <div className="mt-1 text-[13px] text-neutral-700">{etiquetaRango}</div>
            </div>
            {/* Control segmentado con esquinas del sistema: se lee como un
                control, no como la navegación (que ya es subrayada). */}
            <div className="ml-auto inline-flex overflow-hidden rounded-md border border-neutral-300">
              {PERIODOS.map(([id, label], i) => (
                <button
                  key={id}
                  onClick={() => setPeriodo(id)}
                  className={cn(
                    "px-3.5 py-1.5 text-[13px] transition-colors",
                    i > 0 && "border-l border-neutral-300",
                    periodo === id
                      ? "bg-ink font-semibold text-paper"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-ink"
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
                <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
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

          <div className="mt-6 border-t border-neutral-200 pt-4">
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
                  <span className="size-2.5 rounded-sm" style={{ background: SERIE_ACTUAL }} />
                  {barras.anioActual}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: SERIE_PREVIA }} />
                  {barras.anioPrevio}
                </span>
                <button
                  onClick={() => setTabla((v) => !v)}
                  title={tabla ? "Ver gráfica" : "Ver tabla"}
                  className="grid size-7 place-items-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-ink"
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
                      <tr key={i} className="border-t border-neutral-200">
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
                        <div className="pointer-events-none absolute -top-1 left-1/2 z-10 w-max -translate-x-1/2 -translate-y-full rounded-md bg-ink px-3 py-2 text-[11px] text-paper shadow-md">
                          <div className="font-semibold">{e}</div>
                          <div className="tabular-nums">
                            {barras.anioActual}: {usd(barras.actual[i])}
                          </div>
                          <div className="tabular-nums opacity-75">
                            {barras.anioPrevio}: {usd(barras.previo[i])}
                          </div>
                        </div>
                      )}
                      {/* 2px gap between adjacent bars; square data-end on the baseline */}
                      <div className="flex flex-1 items-end gap-[2px]">
                        <div
                          className="flex-1 rounded-t-sm transition-opacity"
                          style={{
                            background: SERIE_ACTUAL,
                            height: `${Math.max(1, (barras.actualNum[i] / maxBarra) * 100)}%`,
                            opacity: activa === null || viva ? 1 : 0.55,
                          }}
                        />
                        <div
                          className="flex-1 rounded-t-sm transition-opacity"
                          style={{
                            background: SERIE_PREVIA,
                            height: `${Math.max(1, (barras.previoNum[i] / maxBarra) * 100)}%`,
                            opacity: activa === null || viva ? 1 : 0.55,
                          }}
                        />
                      </div>
                      <div className="text-center text-[10px] tracking-[0.06em] text-neutral-600 uppercase">
                        {e}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* La columna derecha lleva los indicadores Y la cobranza. Con solo los
            indicadores quedaba media columna vacía, y de paso emparejar ingresos
            con lo que falta cobrar es la lectura que de verdad importa. */}
        <div className="flex flex-col gap-3">
          {/* Stat tiles — no plots, so no hover layer needed */}
          <div className="grid grid-cols-2 gap-3">
            {indicadores.map(({ icon: Icon, k, v, sub, aviso }) => (
              <div key={k} className={cn("flex flex-col gap-0.5 p-4", hoja)}>
                {/* El icono va junto al rótulo, no como bloque encima: apilado
                    hacía que cada indicador ocupara el doble y pareciera tarjeta
                    de marketing en vez de una cifra de reporte. */}
                <div className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-neutral-500" />
                  <span className={rotulo}>{k}</span>
                </div>
                <div className="text-[28px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
                  {v}
                </div>
                <div className="text-xs text-neutral-700">{sub}</div>
                {aviso && <div className="mt-0.5 text-[11px] text-neutral-500">{aviso}</div>}
              </div>
            ))}
          </div>

          <section className={cn("overflow-hidden", hoja)}>
          <div className="registro-cab flex items-center gap-3 px-5 py-3">
            <h4 className="m-0 text-[15px] font-semibold">Cuentas por cobrar</h4>
            <span className="text-[15px] font-semibold tabular-nums">{usd(porCobrar)}</span>
            <Link
              to="/clientes"
              className="ml-auto flex items-center gap-1.5 text-[13px] text-neutral-600 hover:text-ink"
            >
              Por cliente
              <ArrowRight className="size-4" />
            </Link>
          </div>
          {porCobrar.eq(0) ? (
            <div className="p-6 text-center text-[13px] text-neutral-700">Nada pendiente de cobro.</div>
          ) : (
            edades.map((a, i) => (
              <div
                key={a.k}
                className={cn(
                  "grid grid-cols-[110px_minmax(0,1fr)_112px] items-center gap-3 px-5 py-3",
                  i > 0 && "border-t border-neutral-200"
                )}
              >
                <div className="text-xs text-neutral-600">{a.k}</div>
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
            ))
          )}
          </section>
        </div>
      </div>

      {/* Ancho completo: es una lista con nombre, SKU, unidades e importe, y
          apretada en media columna el nombre se truncaba a la mitad. */}
      <section className={cn("overflow-hidden", hoja)}>
        <div className="registro-cab flex items-center gap-3 px-5 py-3">
          <h4 className="m-0 text-[15px] font-semibold">SKU más vendidos</h4>
          <Link
            to="/productos"
            className="ml-auto flex items-center gap-1.5 text-[13px] text-neutral-600 hover:text-ink"
          >
            Catálogo
            <ArrowRight className="size-4" />
          </Link>
        </div>
        {top.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-neutral-700">
            Sin ventas de productos en el periodo.
          </div>
        ) : (
          top.map((t, i) => (
            <div
              key={t.sku}
              className={cn(
                "grid grid-cols-[22px_minmax(0,1fr)_140px_140px] items-center gap-3 px-5 py-2.5",
                i > 0 && "border-t border-neutral-200"
              )}
            >
              <div className="text-[13px] text-neutral-500 tabular-nums">{i + 1}</div>
              <div className="min-w-0">
                <div className="truncate text-sm">{t.nombre}</div>
                <div className="text-[11px] text-neutral-600 tabular-nums">{t.sku}</div>
              </div>
              <div className="text-right text-[13px] text-neutral-600 tabular-nums">
                {n0(t.unidades)} unidades
              </div>
              <div className="text-right text-[16px] font-semibold tabular-nums">
                {usd(t.importe)}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
