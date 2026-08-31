import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus, ArrowRight, Pencil, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { usd, fecha, estadoFactura, diasVencido, TONO_TEXTO } from "@/lib/format"
import { sumar } from "@/lib/dinero"

/**
 * Libro de facturas.
 *
 * Se lee como un mayor contable, no como un tablero: los renglones son un solo
 * bloque de papel blanco separado por filetes, no tarjetas flotando con hueco
 * entre ellas. Eso es lo que hace que un documento se vea como un registro.
 *
 * Los radios salen de la escala del sistema (index.css: --radius-md es 2px,
 * --radius-2xl es 4px), no de valores arbitrarios como rounded-[22px]. El
 * sistema ya decía «esquinas casi cuadradas»; las páginas no le hacían caso.
 *
 * El estado se comunica con color y peso tipográfico en lugar de una píldora:
 * una columna de pastillas negras compite con las cifras, que es lo que
 * realmente se viene a leer aquí.
 */

const FILTROS = ["Todas", "Borrador", "Pendiente", "Parcial", "Vencida", "Pagada"]

// Fechas e importes van todos alineados a la derecha para que formen un solo
// bloque de cifras contra el margen; el nombre del cliente se queda con la
// holgura. Alineadas a la izquierda, las fechas flotaban en medio del renglón.
const COLS =
  "grid-cols-[104px_minmax(0,1fr)_100px_100px_128px_128px_124px_54px]"

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
  const coincide = (f) =>
    !q || f.invoice_num.toLowerCase().includes(q) || (f.client_name ?? "").toLowerCase().includes(q)
  const visibles = conEstado.filter(
    (f) => (filtro === "Todas" || f.est.etiqueta === filtro) && coincide(f)
  )

  // sumar() y no reduce((t,f) => t + f.est.saldo, 0): saldo es un Big y su
  // valueOf devuelve string, así que el `+` CONCATENABA — "0" + "7480.5" +
  // "5140.25" salía "07480.55140.25", que M() no puede leer y mostraba $0.00.
  const porCobrar = sumar(
    conEstado.filter((f) => f.status !== "draft"),
    (f) => f.est.saldo
  )

  const cuenta = (f) =>
    f === "Todas"
      ? conEstado.filter(coincide).length
      : conEstado.filter((x) => x.est.etiqueta === f && coincide(x)).length

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h3 className="m-0 text-[21px] font-semibold">Facturas</h3>
          <div className="text-[13px] text-neutral-700">
            {filas.length} documentos · saldo pendiente{" "}
            <span className="tabular-nums">{usd(porCobrar)}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-500" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar folio o cliente"
              className="entrada-texto w-[236px] pr-3 pl-9"
            />
          </div>
          <Link
            to="/facturas/nueva"
            className="boton boton-ink"
          >
            <Plus className="size-4" />
            Nueva factura
          </Link>
        </div>
      </div>

      {/* Pestañas subrayadas: la fila de píldoras negras pesaba más que los
          datos y es el gesto que delata una plantilla. */}
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
            <span className="text-[11px] text-neutral-500 tabular-nums">{cuenta(f)}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="registro p-4 text-sm">
          No se pudieron cargar las facturas: {error}
        </div>
      )}
      {cargando && <div className="p-6 text-center text-sm text-neutral-700">Cargando…</div>}

      {!cargando && !error && visibles.length === 0 && (
        <div className="registro p-10 text-center">
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
        // Una sola hoja blanca que se ajusta a su contenido. Antes el contenedor
        // gris se estiraba y dejaba 380px de vacío debajo del último renglón.
        <div className="registro overflow-hidden">
          <div
            className={cn(
              "registro-cab rotulo grid items-center gap-3",
              COLS
            )}
          >
            <div>Folio</div>
            <div>Cliente</div>
            <div className="text-right">Emitida</div>
            <div className="text-right">Vence</div>
            <div className="text-right">Total</div>
            <div className="text-right">Saldo</div>
            <div>Estado</div>
            <div />
          </div>

          {visibles.map((f) => {
            const vencida = f.est.tono === "vencida"
            const dias = vencida ? diasVencido(f.due_date) : 0
            return (
              <Link
                key={f.id}
                to={`/facturas/${f.id}`}
                className={cn(
                  "registro-fila group grid items-center gap-3 px-4 py-2.5 transition-colors hover:bg-neutral-100",
                  COLS
                )}
              >
                <div className="text-sm font-semibold tabular-nums">{f.invoice_num}</div>
                <div className="truncate text-sm">{f.client_name ?? "—"}</div>
                <div className="text-right text-[13px] text-neutral-600 tabular-nums">
                  {fecha(f.date_created)}
                </div>
                <div className="text-right text-[13px] text-neutral-600 tabular-nums">
                  {f.due_date ? fecha(f.due_date) : "—"}
                </div>
                <div className="text-right text-sm tabular-nums">{usd(f.total)}</div>
                <div className="text-right text-sm font-semibold tabular-nums">
                  {f.est.saldo.lt(0.01) ? (
                    <span className="text-neutral-400">—</span>
                  ) : (
                    usd(f.est.saldo)
                  )}
                </div>
                <div className={cn("text-[13px]", TONO_TEXTO[f.est.tono])}>
                  {f.est.etiqueta}
                  {/* Cuánto lleva vencida importa más que la etiqueta sola:
                      6 días y 90 días son dos conversaciones distintas. */}
                  {vencida && dias > 0 && (
                    <span className="ml-1.5 font-normal text-neutral-600 tabular-nums">
                      {dias} d
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-end gap-1.5">
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
                      className="accion"
                    >
                      <Pencil className="size-[15px]" />
                    </button>
                  )}
                  <ArrowRight className="size-[17px] text-neutral-400 transition-colors group-hover:text-ink" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
