import * as React from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  Download,
  Upload,
  Check,
  CircleAlert,
  CircleCheck,
  MinusCircle,
  Play,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase, rpc } from "@/lib/supabase"
import { parseCSV, generaCSV } from "@/lib/csv"
import {
  PLANTILLAS,
  planProductos,
  planClientes,
  planFacturas,
  resumen,
  faltantes,
} from "@/lib/importar"
import { usd } from "@/lib/format"

/**
 * Importación desde el sistema anterior.
 *
 * El flujo es leer → PLANEAR → enseñar → aplicar. Nunca se escribe nada hasta
 * que la persona ve el plan completo, porque en una migración el archivo viene
 * mal las primeras veces y descubrirlo a media escritura deja medio catálogo
 * cargado sin que nadie sepa qué quedó dentro.
 *
 * El orden entre pestañas no es preferencia: productos y clientes tienen que
 * existir antes que las facturas o ninguna cruza contra su cliente. La pantalla
 * lo impone en vez de confiar en que se acuerden.
 */

const PASOS = ["productos", "clientes", "facturas"]

const OBLIGATORIAS = {
  productos: ["sku"],
  clientes: ["nombre"],
  facturas: ["folio", "fecha", "importe"],
}

const ICONO = {
  crear: CircleCheck,
  omitir: MinusCircle,
  error: CircleAlert,
}
const TONO = {
  crear: "text-ink",
  omitir: "text-neutral-500",
  error: "text-destructive",
}

function descargaPlantilla(clave) {
  const p = PLANTILLAS[clave]
  const csv = generaCSV(
    p.columnas.map(([c]) => c),
    [p.ejemplo]
  )
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = p.archivo
  a.click()
  URL.revokeObjectURL(url)
}

/** Corre `tarea` sobre cada elemento con concurrencia limitada. */
async function enTandas(items, tarea, concurrencia, alAvanzar) {
  const errores = []
  let hechos = 0
  for (let i = 0; i < items.length; i += concurrencia) {
    const tanda = items.slice(i, i + concurrencia)
    await Promise.all(
      tanda.map(async (it) => {
        try {
          await tarea(it)
        } catch (e) {
          errores.push({ n: it.n, mensaje: e.message })
        } finally {
          alAvanzar(++hechos)
        }
      })
    )
  }
  return errores
}

export default function Importar() {
  const [paso, setPaso] = React.useState("productos")
  const [archivo, setArchivo] = React.useState(null)
  const [plan, setPlan] = React.useState(null)
  const [faltan, setFaltan] = React.useState([])
  const [error, setError] = React.useState("")
  const [aplicando, setAplicando] = React.useState(false)
  const [avance, setAvance] = React.useState({ hechos: 0, total: 0 })
  const [hecho, setHecho] = React.useState(null)

  // Lo que ya existe: sirve para omitir duplicados y para cruzar las facturas
  // contra su cliente. Se recarga al cambiar de pestaña y después de aplicar.
  const [base, setBase] = React.useState({ productos: [], clientes: [], folios: [] })
  const [recarga, setRecarga] = React.useState(0)
  const [cargando, setCargando] = React.useState(true)

  React.useEffect(() => {
    let vivo = true
    Promise.all([
      supabase.from("product").select("id,sku"),
      supabase.from("client").select("id,name,identifier"),
      supabase.from("invoice").select("invoice_num"),
    ]).then(([p, c, i]) => {
      if (!vivo) return
      setBase({
        productos: p.data ?? [],
        clientes: c.data ?? [],
        folios: (i.data ?? []).map((x) => x.invoice_num),
      })
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [recarga])

  function limpiar() {
    setArchivo(null)
    setPlan(null)
    setFaltan([])
    setError("")
    setHecho(null)
  }

  function cambiarPaso(p) {
    setPaso(p)
    limpiar()
  }

  async function leer(f) {
    limpiar()
    if (!f) return
    setArchivo(f.name)
    try {
      const { encabezados, filas } = parseCSV(await f.text())

      const falta = faltantes(encabezados, OBLIGATORIAS[paso])
      if (falta.length) {
        setFaltan(falta)
        return
      }
      if (filas.length === 0) {
        setError("El archivo no tiene renglones de datos.")
        return
      }

      setPlan(
        paso === "productos"
          ? planProductos(filas, { existentes: base.productos })
          : paso === "clientes"
            ? planClientes(filas, { existentes: base.clientes })
            : planFacturas(filas, { clientes: base.clientes, folios: base.folios })
      )
    } catch (e) {
      setError(`No se pudo leer el archivo: ${e.message}`)
    }
  }

  async function aplicar() {
    const crear = plan.filter((r) => r.estado === "crear")
    if (!crear.length) return
    setAplicando(true)
    setError("")
    setAvance({ hechos: 0, total: crear.length })
    const avanzar = (hechos) => setAvance((a) => ({ ...a, hechos }))

    try {
      let errores = []

      if (paso === "clientes") {
        // Inserción directa: client es de nivel 1, tiene política de insert.
        errores = await enTandas(
          crear,
          async (r) => {
            const { error } = await supabase.from("client").insert(r.datos.cliente)
            if (error) throw new Error(error.message)
          },
          8,
          avanzar
        )
      } else if (paso === "productos") {
        errores = await enTandas(
          crear,
          async (r) => {
            const { data, error } = await supabase
              .from("product")
              .insert(r.datos.producto)
              .select("id")
              .maybeSingle()
            if (error) throw new Error(error.message)
            // La existencia NO se escribe: entra como ajuste, para que quede
            // el rastro de que ese número vino del sistema anterior.
            if (r.datos.existencia_inicial > 0) {
              await rpc("create_adjustment", {
                p_product_id: data.id,
                p_type: "add",
                p_qty: r.datos.existencia_inicial,
                p_description: "Saldo inicial — sistema anterior",
              })
            }
          },
          6,
          avanzar
        )
      } else {
        // Facturas: en serie y no en tandas. create_invoice bloquea la fila de
        // company para repartir folios, así que en paralelo se serializarían
        // igual pero con más conexiones abiertas y peores mensajes de error.
        errores = await enTandas(
          crear,
          async (r) => {
            const { factura, pago } = r.datos
            const id = await rpc("create_invoice", {
              p_client_id: factura.client_id,
              p_invoice_num: factura.invoice_num,
              p_lines: [
                {
                  type: "miscellaneous",
                  description: "Saldo según sistema anterior",
                  qty: 1,
                  unit_price: factura.importe,
                },
              ],
              p_status: "active",
              p_notes: "Importada del sistema anterior",
              p_due_date: factura.vence,
              p_date: factura.fecha,
            })
            if (pago) {
              await rpc("create_payment", {
                p_client_id: factura.client_id,
                p_amount: pago.amount,
                p_payment_method: "Importado",
                p_invoice_id: id,
                p_notes: "Abono según sistema anterior",
                p_date: pago.fecha,
              })
            }
          },
          1,
          avanzar
        )
      }

      setHecho({ creados: crear.length - errores.length, errores })
      setPlan(null)
      setRecarga((x) => x + 1)
    } catch (e) {
      setError(e.message)
    } finally {
      setAplicando(false)
    }
  }

  const p = PLANTILLAS[paso]
  const r = plan ? resumen(plan) : null
  const sinClientes = paso === "facturas" && base.clientes.length === 0

  return (
    <div className="flex flex-col gap-4">
      <Link to="/empresa" className="flex items-center gap-2 self-start text-[13px]">
        <ArrowLeft className="size-4" />
        Volver a la empresa
      </Link>

      <div>
        <h3 className="m-0 text-[21px] font-semibold">Importar del sistema anterior</h3>
        <p className="m-0 max-w-[76ch] text-[13px] text-neutral-700">
          Tres archivos, en este orden. Nada se escribe hasta que revises el plan: primero se lee
          el archivo completo y se te muestra qué se va a crear, qué se omite por existir ya y qué
          renglones tienen un problema, con su número de línea.
        </p>
      </div>

      <div className="flex flex-wrap gap-6 border-b border-neutral-300">
        {PASOS.map((k, i) => (
          <button
            key={k}
            onClick={() => cambiarPaso(k)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 pb-2.5 text-[13px] transition-colors",
              paso === k
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-neutral-600 hover:text-ink"
            )}
          >
            <span className="text-[11px] text-neutral-500 tabular-nums">{i + 1}</span>
            {PLANTILLAS[k].titulo}
          </button>
        ))}
      </div>

      <section className="panel">
        <p className="m-0 mb-4 max-w-[80ch] text-[13px] text-neutral-700">{p.descripcion}</p>

        <div className="registro overflow-hidden">
          <div className="registro-cab rotulo grid grid-cols-[220px_minmax(0,1fr)] gap-3">
            <div>Columna</div>
            <div>Nota</div>
          </div>
          {p.columnas.map(([col, nota]) => (
            <div
              key={col}
              className="registro-fila grid grid-cols-[220px_minmax(0,1fr)] gap-3 px-4 py-1.5"
            >
              <div className="text-[13px] tabular-nums">{col}</div>
              <div className="text-[12px] text-neutral-600">{nota}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={() => descargaPlantilla(paso)} className="boton boton-claro">
            <Download className="size-4" />
            Descargar plantilla
          </button>

          <label className="boton boton-ink cursor-pointer">
            <Upload className="size-4" />
            {archivo ? "Elegir otro archivo" : "Elegir archivo CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => leer(e.target.files?.[0])}
            />
          </label>

          {archivo && <span className="text-[13px] text-neutral-600">{archivo}</span>}
        </div>

        {sinClientes && !cargando && (
          <div className="mt-3 flex items-center gap-2.5 rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-[13px]">
            <CircleAlert className="size-[18px] shrink-0" />
            <span>
              Todavía no hay clientes. Impórtalos primero o ninguna factura va a encontrar a quién
              pertenece.
            </span>
          </div>
        )}
      </section>

      {error && (
        <div className="registro flex items-center gap-2.5 px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {faltan.length > 0 && (
        <div className="registro flex items-start gap-2.5 px-4 py-3 text-[13px]">
          <CircleAlert className="mt-px size-[19px] shrink-0" />
          <span>
            Al archivo le faltan columnas obligatorias: <b>{faltan.join(", ")}</b>. Descarga la
            plantilla y usa esos mismos encabezados — no importan mayúsculas ni acentos.
          </span>
        </div>
      )}

      {hecho && (
        <div className="registro flex flex-col gap-2 px-4 py-3 text-[13px]">
          <div className="flex items-center gap-2.5">
            <Check className="size-[19px] shrink-0" />
            <span>
              Se crearon <b>{hecho.creados}</b> registros.
              {hecho.errores.length > 0 && ` ${hecho.errores.length} fallaron al escribir.`}
            </span>
          </div>
          {hecho.errores.map((e) => (
            <div key={e.n} className="pl-7 text-neutral-600">
              línea {e.n}: {e.mensaje}
            </div>
          ))}
          {paso === "facturas" && hecho.creados > 0 && (
            <div className="pl-7 text-neutral-600">
              Los folios importados <b>no mueven el contador</b>. Ve a Empresa y pon la serie de
              folios donde quedó tu sistema anterior, o la próxima factura nueva puede repetir un
              número.
            </div>
          )}
        </div>
      )}

      {plan && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap gap-5 text-[13px]">
              <span>
                <b className="tabular-nums">{r.crear}</b> por crear
              </span>
              <span className="text-neutral-600">
                <b className="tabular-nums">{r.omitir}</b> se omiten
              </span>
              <span className={cn(r.error > 0 && "text-destructive")}>
                <b className="tabular-nums">{r.error}</b> con error
              </span>
            </div>
            <button
              onClick={aplicar}
              disabled={aplicando || r.crear === 0}
              className="boton boton-ink ml-auto"
            >
              <Play className="size-4" />
              {aplicando
                ? `Importando ${avance.hechos} de ${avance.total}…`
                : `Importar ${r.crear} ${r.crear === 1 ? "registro" : "registros"}`}
            </button>
          </div>

          {r.error > 0 && (
            <p className="m-0 text-[13px] text-neutral-700">
              Los renglones con error <b>no se importan</b>; el resto sí. Puedes corregirlos en el
              archivo y volver a cargarlo — lo ya creado se omitirá.
            </p>
          )}

          <div className="registro overflow-hidden">
            <div className="registro-cab rotulo grid grid-cols-[64px_96px_minmax(0,1.1fr)_minmax(0,1.4fr)] gap-3">
              <div className="text-right">Línea</div>
              <div>Estado</div>
              <div>Registro</div>
              <div>Nota</div>
            </div>
            {plan.map((f) => {
              const Icono = ICONO[f.estado]
              return (
                <div
                  key={f.n}
                  className="registro-fila grid grid-cols-[64px_96px_minmax(0,1.1fr)_minmax(0,1.4fr)] items-center gap-3 px-4 py-2"
                >
                  <div className="text-right text-[13px] text-neutral-500 tabular-nums">{f.n}</div>
                  <div className={cn("flex items-center gap-1.5 text-[13px]", TONO[f.estado])}>
                    <Icono className="size-[15px] shrink-0" />
                    {f.estado === "crear" ? "crear" : f.estado === "omitir" ? "omitir" : "error"}
                  </div>
                  <div className="truncate text-[13px]">{etiqueta(paso, f)}</div>
                  <div
                    className={cn(
                      "truncate text-[12px]",
                      f.estado === "error" ? "text-destructive" : "text-neutral-600"
                    )}
                  >
                    {f.motivo}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

/** Cómo se identifica el renglón en la vista previa, según el archivo. */
function etiqueta(paso, f) {
  const d = f.datos
  if (!d) return "—"
  if (paso === "productos") return `${d.producto.sku} · ${d.producto.description ?? "sin descripción"}`
  if (paso === "clientes") return d.cliente.name
  return `${d.factura.invoice_num} · ${usd(d.factura.importe)}`
}
