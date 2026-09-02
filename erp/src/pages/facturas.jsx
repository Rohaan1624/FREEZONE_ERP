import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus, ArrowRight, Pencil, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { usd, fecha, TONO_TEXTO } from "@/lib/format"
import { useTotales } from "@/lib/totales"
import { Paginacion } from "@/components/paginacion"
import { useDebounce, rango, filtroTexto } from "@/lib/lista"

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
  const [pagina, setPagina] = React.useState(0)
  const [error, setError] = React.useState("")
  const [filtro, setFiltro] = React.useState("Todas")
  const [busca, setBusca] = React.useState("")
  const q = useDebounce(busca)

  // Los datos recuerdan de qué consulta son. Así «está cargando» se DERIVA en
  // render, sin un setState dentro del efecto, y al pasar de página se siguen
  // viendo los renglones anteriores en lugar de parpadear en blanco.
  const clave = `${pagina}|${filtro}|${q}`
  const [datos, setDatos] = React.useState(null)

  React.useEffect(() => {
    let vivo = true

    // invoice_listado, no invoice: la vista ya trae saldo y estado derivados,
    // que es lo que permite filtrar «Vencida» en el servidor. Sobre la tabla
    // cruda habría que traerse todo para saber cuáles lo están.
    let consulta = supabase
      .from("invoice_listado")
      .select("*", { count: "exact" })
      .order("date_created", { ascending: false })
      .range(...rango(pagina))

    if (filtro !== "Todas") consulta = consulta.eq("estado", filtro)
    const f = filtroTexto(q, ["invoice_num", "client_name"])
    if (f) consulta = consulta.or(f)

    consulta.then(({ data, error, count }) => {
      if (!vivo) return
      if (error) setError(error.message)
      else {
        setDatos({ clave, filas: data ?? [], total: count ?? 0 })
        setError("")
      }
    })
    return () => {
      vivo = false
    }
  }, [clave, pagina, filtro, q])

  const cargando = datos?.clave !== clave
  const filas = datos?.filas ?? []
  const total = datos?.total ?? null

  // Los totales y los conteos por estado son del LIBRO ENTERO, no de la página.
  const totales = useTotales("totales_facturas")
  const cuenta = (f) =>
    f === "Todas" ? totales?.documentos : totales?.por_estado?.[f]

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h3 className="m-0 text-[21px] font-semibold">Facturas</h3>
          <div className="text-[13px] text-neutral-700">
            {totales ? totales.documentos : "…"} documentos · saldo pendiente{" "}
            <span className="tabular-nums">{totales ? usd(totales.saldo_pendiente) : "…"}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-500" />
            <input
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                setPagina(0)
              }}
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
            onClick={() => {
              setFiltro(f)
              setPagina(0)
            }}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 pb-2.5 text-[13px] transition-colors",
              filtro === f
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-neutral-600 hover:text-ink"
            )}
          >
            {f}
            <span className="text-[11px] text-neutral-500 tabular-nums">
              {cuenta(f) ?? ""}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="registro p-4 text-sm">
          No se pudieron cargar las facturas: {error}
        </div>
      )}
      {cargando && <div className="p-6 text-center text-sm text-neutral-700">Cargando…</div>}

      {!cargando && !error && filas.length === 0 && (
        <div className="registro p-10 text-center">
          <div className="text-base font-semibold">
            {q || filtro !== "Todas" ? "Ningún documento coincide" : "Todavía no hay facturas"}
          </div>
          <div className="mt-1 text-[13px] text-neutral-700">
            {q || filtro !== "Todas"
              ? "Prueba con otro filtro o búsqueda."
              : "Crea la primera con el botón Nueva factura."}
          </div>
        </div>
      )}

      {filas.length > 0 && (
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

          {filas.map((f) => {
            const vencida = f.estado === "Vencida"
            const dias = f.dias_vencida
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
                  {Number(f.saldo) < 0.01 ? (
                    <span className="text-neutral-400">—</span>
                  ) : (
                    usd(f.saldo)
                  )}
                </div>
                <div className={cn("text-[13px]", TONO_TEXTO[f.estado])}>
                  {f.estado}
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

      {(filas.length > 0 || pagina > 0) && (
        <Paginacion
          pagina={pagina}
          cuantos={filas.length}
          total={total}
          onPagina={setPagina}
          cargando={cargando}
        />
      )}
    </section>
  )
}
