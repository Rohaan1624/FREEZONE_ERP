import * as React from "react"
import { Link } from "react-router-dom"
import { Plus, ArrowRight, Search, CircleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { usd, n0, fecha } from "@/lib/format"
import { mul, div, sumar } from "@/lib/dinero"
import { SubNavInventario } from "@/components/sub-nav-inventario"

const FILTROS = ["Todas", "Pendientes", "Recibidas"]

export default function Entradas() {
  const [filas, setFilas] = React.useState([])
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState("")
  const [filtro, setFiltro] = React.useState("Todas")
  const [busca, setBusca] = React.useState("")

  React.useEffect(() => {
    let vivo = true
    supabase
      .from("purchase")
      .select("*, entry(qty_unit, cost_unit, type)")
      .order("date_created", { ascending: false })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setError(error.message)
        else setFilas(data ?? [])
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  // Freight/handling is prorated per unit received — computed for display only.
  // The database stores mercancía and gastos separately; nothing is written back.
  const conCosteo = filas.map((p) => {
    const lineas = p.entry ?? []
    const productos = lineas.filter((l) => l.type === "product")
    const unidades = productos.reduce((t, l) => t + Number(l.qty_unit ?? 0), 0)
    const mercancia = sumar(productos, (l) => mul(l.qty_unit, l.cost_unit))
    const gastos = sumar(
      lineas.filter((l) => l.type === "charge"),
      (l) => mul(l.qty_unit, l.cost_unit)
    )
    return {
      ...p,
      unidades,
      mercancia,
      gastos,
      skus: productos.length,
      incremento: (() => {
        const r = div(gastos, mercancia)
        return r === null ? 0 : Number(r.times(100).toString())
      })(),
    }
  })

  const q = busca.trim().toLowerCase()
  const visibles = conCosteo.filter(
    (p) =>
      (filtro === "Todas" ||
        (filtro === "Pendientes" ? p.status === "active" : p.status === "closed")) &&
      (!q ||
        p.entry_no.toLowerCase().includes(q) ||
        (p.provider ?? "").toLowerCase().includes(q) ||
        (p.origin ?? "").toLowerCase().includes(q))
  )
  const pendientes = conCosteo.filter((p) => p.status === "active").length


  const COLS =
    "grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_86px_118px_118px_128px_104px_30px]"

  return (
    <div className="flex flex-col gap-4">
      <SubNavInventario />

      <div className="flex flex-wrap items-start gap-4">
        <div>
          <h3 className="m-0 text-[21px] font-semibold">Entradas</h3>
          <div className="max-w-[64ch] text-[13px] text-neutral-700">
            Compras de mercancía con sus fletes y gastos. La existencia sube al cerrar la entrada,
            no al capturarla — así puedes corregirla mientras esté pendiente.
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-500" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar entrada, proveedor u origen"
              className="entrada-texto w-[270px] pr-3 pl-9"
            />
          </div>
          <Link
            to="/entradas/nueva"
            className="boton boton-ink"
          >
            <Plus className="size-4" />
            Nueva entrada
          </Link>
        </div>
      </div>

      {error && (
        <div className="registro flex items-center gap-2.5 px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-6 border-b border-neutral-300">
        {FILTROS.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 pb-2.5 text-[13px] transition-colors",
              filtro === f
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-neutral-600 hover:text-ink"
            )}
          >
            {f}
            {f === "Pendientes" && pendientes > 0 ? (
              <span className="text-[11px] text-neutral-500 tabular-nums">{pendientes}</span>
            ) : null}
          </button>
        ))}
      </div>

      {cargando && <div className="p-6 text-center text-sm text-neutral-700">Cargando…</div>}

      {!cargando && visibles.length === 0 && (
        <div className="registro p-10 text-center">
          <div className="text-base font-semibold">
            {filas.length === 0 ? "Todavía no hay entradas" : "Ninguna entrada coincide"}
          </div>
          <div className="mt-1 text-[13px] text-neutral-700">
            {filas.length === 0
              ? "Registra la primera para que entre mercancía al inventario."
              : "Prueba con otro filtro o búsqueda."}
          </div>
        </div>
      )}

      {visibles.length > 0 && (
        <div className="registro overflow-hidden">
          <div
            className={cn(
              "registro-cab rotulo grid items-center gap-3",
              COLS
            )}
          >
            <div>Entrada</div>
            <div>Proveedor</div>
            <div className="text-right">Unidades</div>
            <div className="text-right">Mercancía</div>
            <div className="text-right">Gastos</div>
            <div className="text-right">Costo total</div>
            <div>Estado</div>
            <div />
          </div>

          {visibles.map((p) => (
            <Link
              key={p.id}
              to={`/entradas/${p.id}`}
              className={cn(
                "registro-fila group grid items-center gap-3 px-4 py-2.5 transition-colors hover:bg-neutral-100",
                COLS
              )}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold tabular-nums">{p.entry_no}</div>
                <div className="text-[11px] text-neutral-600 tabular-nums">
                  {fecha(p.date_created)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm">{p.provider ?? "—"}</div>
                <div className="truncate text-[11px] text-neutral-600">
                  {[p.origin, `${p.skus} SKU`].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="text-right text-sm tabular-nums">{n0(p.unidades)}</div>
              <div className="text-right text-[13px] text-neutral-600 tabular-nums">
                {usd(p.mercancia)}
              </div>
              <div className="text-right text-[13px] text-neutral-600 tabular-nums">
                {p.gastos.eq(0) ? <span className="text-neutral-400">—</span> : usd(p.gastos)}
              </div>
              <div className="text-right text-sm font-semibold tabular-nums">{usd(p.total)}</div>
              {/* Pendiente es lo que pide acción — cerrar la entrada para que
                  suba la existencia — así que es lo que lleva peso. */}
              <div
                className={cn(
                  "text-[13px]",
                  p.status === "closed" ? "text-neutral-600" : "font-semibold text-ink"
                )}
              >
                {p.status === "closed" ? "Recibida" : "Pendiente"}
              </div>
              <ArrowRight className="size-[17px] justify-self-end text-neutral-400 transition-colors group-hover:text-ink" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
