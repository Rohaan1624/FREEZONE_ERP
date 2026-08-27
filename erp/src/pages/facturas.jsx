import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus, ArrowRight, Pencil } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { usd, fecha, estadoFactura, TONO_CLASE } from "@/lib/format"

const FILTROS = ["Todas", "Borrador", "Pendiente", "Parcial", "Vencida", "Pagada"]

export default function Facturas() {
  const navigate = useNavigate()
  const [filas, setFilas] = React.useState([])
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState("")
  const [filtro, setFiltro] = React.useState("Todas")
  const [busca, setBusca] = React.useState("")

  React.useEffect(() => {
    // The embedded payments(amount) works because payments.invoice_id has a
    // foreign key to invoice.id — PostgREST derives the relationship from it.
    // RLS applies to BOTH the parent and the embedded rows.
    supabase
      .from("invoice")
      .select("*, payments(amount)")
      .order("date_created", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setFilas(data ?? [])
        setCargando(false)
      })
  }, [])

  const conEstado = filas.map((f) => ({ ...f, est: estadoFactura(f) }))
  const q = busca.trim().toLowerCase()
  const visibles = conEstado.filter(
    (f) =>
      (filtro === "Todas" || f.est.etiqueta === filtro) &&
      (!q ||
        f.invoice_num.toLowerCase().includes(q) ||
        (f.client_name ?? "").toLowerCase().includes(q))
  )
  const porCobrar = conEstado
    .filter((f) => f.status !== "draft")
    .reduce((t, f) => t + f.est.saldo, 0)

  return (
    <section className="rounded-[22px] bg-newsprint p-6">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div>
          <h3 className="m-0 text-[21px] font-semibold">Facturas</h3>
          <div className="text-[13px] text-neutral-700">
            {filas.length} documentos · saldo pendiente {usd(porCobrar)}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar folio o cliente"
            className="h-9 w-[236px] rounded-full bg-paper px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink"
          />
          <Link
            to="/facturas/nueva"
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper"
          >
            <Plus className="size-4" />
            Nueva factura
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={cn(
              "rounded-full px-4 py-1.5 text-[13px]",
              filtro === f ? "bg-ink text-paper" : "bg-paper text-ink"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-2xl bg-paper p-4 text-sm">
          No se pudieron cargar las facturas: {error}
        </div>
      )}
      {cargando && <div className="p-6 text-center text-sm text-neutral-700">Cargando…</div>}

      {!cargando && !error && visibles.length === 0 && (
        <div className="rounded-2xl bg-paper p-10 text-center">
          <div className="text-base font-semibold">
            {filas.length === 0 ? "Todavía no hay facturas" : "Ningún documento coincide"}
          </div>
          <div className="mt-1 text-[13px] text-neutral-700">
            {filas.length === 0
              ? "Crea la primera con el botón Nueva factura."
              : "Prueba con otro filtro o búsqueda."}
          </div>
        </div>
      )}

      {visibles.length > 0 && (
        <>
          <div className="grid grid-cols-[minmax(90px,0.9fr)_minmax(0,1.6fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.95fr)_72px] gap-3 px-3 pb-2 text-[10px] tracking-[0.1em] text-ink/50 uppercase">
            <div>Folio</div>
            <div>Cliente</div>
            <div>Emitida</div>
            <div>Vence</div>
            <div className="text-right">Total</div>
            <div className="text-right">Saldo</div>
            <div>Estado</div>
            <div />
          </div>
          <div className="flex flex-col gap-2">
            {visibles.map((f) => (
              <Link
                key={f.id}
                to={`/facturas/${f.id}`}
                className="grid grid-cols-[minmax(90px,0.9fr)_minmax(0,1.6fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.95fr)_72px] items-center gap-3 rounded-[14px] bg-paper p-3 transition-shadow hover:shadow-sm"
              >
                <div className="text-sm font-semibold">{f.invoice_num}</div>
                <div className="truncate text-sm">{f.client_name ?? "—"}</div>
                <div className="text-[13px] text-neutral-700 tabular-nums">
                  {fecha(f.date_created)}
                </div>
                <div className="text-[13px] text-neutral-700 tabular-nums">
                  {f.due_date ? fecha(f.due_date) : "—"}
                </div>
                <div className="text-right text-sm tabular-nums">{usd(f.total)}</div>
                <div className="text-right text-sm font-semibold tabular-nums">
                  {f.est.saldo < 0.01 ? "—" : usd(f.est.saldo)}
                </div>
                <div>
                  <span
                    className={cn(
                      "inline-block rounded-full px-3 py-1 text-xs",
                      TONO_CLASE[f.est.tono]
                    )}
                  >
                    {f.est.etiqueta}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-1">
                  {f.status !== "closed" && (
                    <button
                      onClick={(e) => {
                        // The whole row is a <Link>; without this the click
                        // navigates to the detail page instead of the editor.
                        e.preventDefault()
                        e.stopPropagation()
                        navigate(`/facturas/${f.id}/editar`)
                      }}
                      title="Editar"
                      className="grid size-7 place-items-center rounded-full bg-newsprint"
                    >
                      <Pencil className="size-[15px]" />
                    </button>
                  )}
                  <ArrowRight className="size-[17px] text-neutral-700" />
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
