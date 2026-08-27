import * as React from "react"
import { Link } from "react-router-dom"
import { Plus, ArrowRight, Truck, CircleAlert } from "lucide-react"

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

  return (
    <div className="flex flex-col gap-3">
      <SubNavInventario />

      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h3 className="m-0 text-[21px] font-semibold">Entradas</h3>
          <div className="max-w-[56ch] text-[13px] text-neutral-700">
            Compras de mercancía con sus fletes y gastos. La existencia sube al cerrar la entrada,
            no al capturarla — así puedes corregirla mientras esté pendiente.
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar entrada, proveedor u origen"
            className="h-9 w-[250px] rounded-full bg-newsprint px-3.5 text-sm outline-none"
          />
          <Link
            to="/entradas/nueva"
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper"
          >
            <Plus className="size-4" />
            Nueva entrada
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-newsprint px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={cn(
              "rounded-full px-4 py-1.5 text-[13px]",
              filtro === f ? "bg-ink text-paper" : "bg-newsprint text-ink"
            )}
          >
            {f}
            {f === "Pendientes" && pendientes > 0 ? ` ${pendientes}` : ""}
          </button>
        ))}
      </div>

      {cargando && <div className="p-6 text-center text-sm text-neutral-700">Cargando…</div>}

      {!cargando && visibles.length === 0 && (
        <div className="rounded-[22px] bg-newsprint p-10 text-center">
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
        <section className="rounded-[22px] bg-newsprint p-6">
          <div className="grid grid-cols-[38px_minmax(0,1.2fr)_minmax(0,1.4fr)_88px_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1fr)_92px_26px] gap-3 px-3 pb-2 text-[10px] tracking-[0.1em] text-ink/50 uppercase">
            <div />
            <div>Entrada</div>
            <div>Proveedor</div>
            <div className="text-right">Unidades</div>
            <div className="text-right">Mercancía</div>
            <div className="text-right">Gastos</div>
            <div className="text-right">Costo total</div>
            <div>Estado</div>
            <div />
          </div>
          <div className="flex flex-col gap-2">
            {visibles.map((p) => (
              <Link
                key={p.id}
                to={`/entradas/${p.id}`}
                className="grid grid-cols-[38px_minmax(0,1.2fr)_minmax(0,1.4fr)_88px_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1fr)_92px_26px] items-center gap-3 rounded-[14px] bg-paper p-3 transition-shadow hover:shadow-sm"
              >
                <span className="grid size-9 place-items-center rounded-xl bg-newsprint">
                  <Truck className="size-[19px] text-neutral-700" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.entry_no}</div>
                  <div className="text-[11px] text-neutral-700 tabular-nums">
                    {fecha(p.date_created)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm">{p.provider ?? "—"}</div>
                  <div className="truncate text-[11px] text-neutral-700">
                    {[p.origin, `${p.skus} SKU`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="text-right text-sm tabular-nums">{n0(p.unidades)}</div>
                <div className="text-right text-[13px] text-neutral-700 tabular-nums">
                  {usd(p.mercancia)}
                </div>
                <div className="text-right text-[13px] text-neutral-700 tabular-nums">
                  {p.gastos.eq(0) ? "—" : usd(p.gastos)}
                </div>
                <div className="text-right text-[15px] font-semibold tabular-nums">
                  {usd(p.total)}
                </div>
                <div>
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs",
                      p.status === "closed" ? "bg-neutral-200 text-neutral-700" : "bg-ink text-paper"
                    )}
                  >
                    {p.status === "closed" ? "Recibida" : "Pendiente"}
                  </span>
                </div>
                <ArrowRight className="size-[18px] justify-self-end text-neutral-700" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
