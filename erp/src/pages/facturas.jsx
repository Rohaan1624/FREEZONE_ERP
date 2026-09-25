import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus, ArrowRight, Pencil, Search, ListFilter, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { usd, n0, fecha, TONO_TEXTO } from "@/lib/format"
import { useTotales } from "@/lib/totales"
import { Paginacion } from "@/components/paginacion"
import { useDebounce, rango, filtrosBusqueda } from "@/lib/lista"

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

/**
 * El filtro por defecto es ABIERTAS, no «Todas».
 *
 * Este libro se abre para trabajar, y lo que hay que trabajar es lo que aún no
 * está cobrado: un borrador a medio capturar, algo vencido que hay que llamar,
 * un abono parcial. Una factura pagada ya no pide nada de nadie.
 *
 * Con «Todas» de salida, y 102 pagadas de 148, lo accionable entra en minoría
 * en su propia pantalla: hay que filtrar cada vez para ver el trabajo. El
 * defecto debería ser la pregunta que uno viene a hacer.
 */
const ABIERTAS = "Abiertas"
const TODAS = "Todas"
const FILTROS = [ABIERTAS, TODAS, "Borrador", "Pendiente", "Parcial", "Vencida", "Pagada"]

// Fechas e importes van todos alineados a la derecha para que formen un solo
// bloque de cifras contra el margen; el nombre del cliente se queda con la
// holgura. Alineadas a la izquierda, las fechas flotaban en medio del renglón.
// Con prefijo md: porque en el teléfono cada renglón es una tarjeta, no una
// fila de tabla: ocho columnas no caben en 390px.
const COLS =
  "md:grid-cols-[104px_minmax(0,1fr)_100px_100px_128px_128px_124px_54px]"

export default function Facturas() {
  const navigate = useNavigate()
  const [pagina, setPagina] = React.useState(0)
  const [error, setError] = React.useState("")
  const [filtro, setFiltro] = React.useState(ABIERTAS)
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

    // «Abiertas» se expresa por NEGACIÓN y no listando los cuatro estados: si
    // mañana se agrega uno nuevo, entra solo en lo abierto en vez de
    // desaparecer de la vista por defecto sin que nadie lo note.
    if (filtro === ABIERTAS) consulta = consulta.neq("estado", "Pagada")
    else if (filtro !== TODAS) consulta = consulta.eq("estado", filtro)
    // Búsqueda tolerante, una condición por palabra (se combinan con AND):
    // «almacen» encuentra «Almacén», y «rios almacen» encuentra «Almacén Tres
    // Ríos» aunque el orden no calce.
    for (const f of filtrosBusqueda(q, ["invoice_num", "client_name"])) consulta = consulta.or(f)

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
  const cuenta = (f) => {
    if (!totales) return null
    if (f === TODAS) return totales.documentos
    // Lo abierto es el libro menos lo pagado, por lo mismo que la consulta:
    // así no hay que acordarse de sumar un estado nuevo en dos sitios.
    if (f === ABIERTAS) return totales.documentos - (totales.por_estado?.Pagada ?? 0)
    return totales.por_estado?.[f]
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        {/* Sin subtítulo de totales: el conteo ya va en el desplegable, y el
            saldo pendiente vive en el Resumen, que es donde se va a mirar una
            cifra del negocio. Repetirlo aquí solo daba dos sitios que pueden
            discrepar. */}
        <h3 className="m-0 text-[21px] font-semibold">Facturas</h3>
        <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">
          {/* Desplegable y no siete pestañas: eran una fila entera de chrome
              para algo que se toca una vez y se deja quieto, y con el contador
              al lado competían con las cifras del renglón, que es lo que de
              verdad se viene a leer. Cerrado ocupa un control y dice en qué
              filtro estás, que es lo único que hace falta saber de un vistazo. */}
          <label className="relative flex-1 md:flex-none">
            <span className="sr-only">Filtrar por estado</span>
            <ListFilter className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-500" />
            <select
              value={filtro}
              onChange={(e) => {
                setFiltro(e.target.value)
                setPagina(0)
              }}
              className="entrada-texto w-full cursor-pointer py-0 pr-3 pl-9"
            >
              {FILTROS.map((f) => (
                <option key={f} value={f}>
                  {f}
                  {cuenta(f) == null ? "" : ` (${n0(cuenta(f))})`}
                </option>
              ))}
            </select>
          </label>
          {/* En el teléfono la búsqueda va primero y a lo ancho: apretada junto
              al filtro no cabía ni el texto de ayuda. */}
          <div className="relative order-first w-full md:order-none md:w-auto">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-500" />
            <input
              type="search"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                setPagina(0)
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setBusca("")
                  setPagina(0)
                }
              }}
              placeholder="Buscar por folio o cliente"
              className="entrada-texto w-full pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden md:w-[280px]"
            />
            {busca && (
              <button
                type="button"
                onClick={() => {
                  setBusca("")
                  setPagina(0)
                }}
                title="Borrar búsqueda"
                className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-neutral-500 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            )}
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

      {error && (
        <div className="registro p-4 text-sm">
          No se pudieron cargar las facturas: {error}
        </div>
      )}
      {cargando && <div className="p-6 text-center text-sm text-neutral-700">Cargando…</div>}

      {!cargando && !error && filas.length === 0 && (
        <div className="registro p-10 text-center">
          {/* «No hay nada» y «no hay nada QUE COINCIDA» son dos mensajes
              distintos, y con el filtro por defecto ya no se distinguen por
              él: una cuenta recién creada abre en Abiertas y con cero
              facturas. Lo que lo decide es el total del libro entero. */}
          <div className="text-base font-semibold">
            {totales?.documentos === 0 ? "Todavía no hay facturas" : "Ningún documento coincide"}
          </div>
          <div className="mt-1 text-[13px] text-neutral-700">
            {totales?.documentos === 0
              ? "Crea la primera con el botón Nueva factura."
              : "Prueba con otro filtro o búsqueda."}
          </div>
          {/* Lo más común: se busca una factura ya pagada con el filtro por
              defecto (Abiertas) puesto. Un clic y aparece. */}
          {q.trim() && filtro !== TODAS && (
            <button
              type="button"
              onClick={() => {
                setFiltro(TODAS)
                setPagina(0)
              }}
              className="boton boton-claro mx-auto mt-4"
            >
              <Search className="size-4" />
              Buscar «{q.trim()}» en todas las facturas
            </button>
          )}
        </div>
      )}

      {filas.length > 0 && (
        // Una sola hoja blanca que se ajusta a su contenido. Antes el contenedor
        // gris se estiraba y dejaba 380px de vacío debajo del último renglón.
        <div className="registro overflow-hidden">
          <div
            className={cn(
              "registro-cab rotulo hidden items-center gap-3 md:grid",
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
                  "registro-fila group block px-4 py-3 transition-colors hover:bg-neutral-100 md:grid md:items-center md:gap-3 md:py-2.5",
                  COLS
                )}
              >
                {/* Teléfono: tarjeta de dos renglones. Lo que se viene a leer
                    —quién y cuánto debe— va arriba; fechas y estado debajo. */}
                <div className="flex flex-col gap-1 md:hidden">
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {f.client_name ?? "—"}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {Number(f.saldo) < 0.01 ? usd(f.total) : usd(f.saldo)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 text-[12px] text-neutral-600">
                    <span className="tabular-nums">{f.invoice_num}</span>
                    <span>·</span>
                    <span className="tabular-nums">{fecha(f.date_created)}</span>
                    <span className={cn("ml-auto", TONO_TEXTO[f.estado])}>
                      {f.estado}
                      {vencida && dias > 0 && <span className="tabular-nums"> · {dias} d</span>}
                    </span>
                  </div>
                </div>

                <div className="hidden md:contents">
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
