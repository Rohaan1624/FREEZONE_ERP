import * as React from "react"
import { Link } from "react-router-dom"
import { Sparkles, CircleAlert, ArrowRight, Loader2, Check } from "lucide-react"

import { cn } from "@/lib/utils"
import { pregunta as preguntar, cupoActual } from "@/lib/asistente"
import { aplica } from "@/lib/acciones"
import { ejemplosSugeridos, NO_ENTENDIDO } from "@/lib/intenciones"

/**
 * El asistente.
 *
 * Pregunta en español, la app contesta con datos reales. El modelo solo decide
 * QUÉ consultar; la frase de respuesta y las cifras las escribe la app desde
 * Postgres. Por eso cada respuesta puede enlazar a la pantalla de verdad: es la
 * misma consulta, no un resumen aparte que pueda discrepar.
 *
 * Orden CRONOLÓGICO, no invertido. Se probó al revés (lo último arriba) y en
 * cuanto hay seguimientos —«¿y sus movimientos?»— deja de leerse: la respuesta
 * aparece encima de la pregunta que la motivó. Una conversación se lee hacia
 * abajo, así que la vista baja sola al llegar cada respuesta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ES UNA PESTAÑA DE CHAT, NO UNA PÁGINA QUE CRECE
 * ─────────────────────────────────────────────────────────────────────────────
 * El hilo se desplaza dentro de su propia caja y la de escribir está pegada
 * abajo. Cuando esto era una página normal, cada respuesta la alargaba y el
 * input se iba quedando fuera de la vista: había que bajar a mano para hacer
 * la siguiente pregunta, lo cual es lo contrario de una conversación.
 */

/* ------------------------------------------------------------ resultados -- */
// Tres formas, las mismas que devuelve consultas.js.

function Cifra({ r }) {
  return (
    <div>
      <div className="rotulo">{r.titulo}</div>
      <div className="mt-1 text-[30px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
        {r.valor}
      </div>
      {r.detalle && <div className="mt-1 text-[13px] text-neutral-700">{r.detalle}</div>}
    </div>
  )
}

function Ficha({ r }) {
  return (
    <div>
      <div className="text-[17px] font-semibold">{r.titulo}</div>
      {r.subtitulo && <div className="text-[12px] text-neutral-600">{r.subtitulo}</div>}
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {r.campos.map(([k, v]) => (
          <div key={k} className="casilla">
            <div className="rotulo">{k}</div>
            <div className="mt-0.5 text-[15px] tabular-nums">{v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Tabla({ r }) {
  // Estilo en línea y no una clase de Tailwind: `grid-cols-[...]` armado con
  // un template literal produce un nombre de clase que Tailwind nunca ve al
  // escanear el código, así que la CSS no existiría y la tabla saldría apilada.
  const cols = {
    gridTemplateColumns: r.columnas.map(() => "minmax(0,1fr)").join(" "),
  }
  return (
    <div>
      <div className="text-[17px] font-semibold">{r.titulo}</div>
      {r.filas.length === 0 ? (
        <div className="mt-2 text-[13px] text-neutral-700">{r.vacio}</div>
      ) : (
        <div className="registro mt-3 overflow-hidden">
          <div className="registro-cab rotulo grid items-center gap-3" style={cols}>
            {r.columnas.map((c) => (
              <div key={c.k} className={c.align === "right" ? "text-right" : undefined}>
                {c.etiqueta}
              </div>
            ))}
          </div>
          {r.filas.map((f, i) => (
            <div
              key={i}
              className="registro-fila grid items-center gap-3 px-4 py-2 text-[13px]"
              style={cols}
            >
              {r.columnas.map((c) => (
                <div
                  key={c.k}
                  className={cn(
                    "truncate",
                    c.align === "right" && "text-right tabular-nums"
                  )}
                >
                  {f[c.k] ?? "—"}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Una respuesta que es solo texto. No lleva marco de `registro` porque no hay
 * dato que enmarcar — encuadrar un saludo lo haría parecer un resultado vacío.
 */
function Mensaje({ r, onSugerencia }) {
  return (
    <div>
      <p className="m-0 text-[15px] leading-snug whitespace-pre-line">{r.resumen}</p>
      {r.sugerencias?.length > 0 && (
        <div className="mt-3 flex flex-col items-start gap-1.5">
          {r.sugerencias.map((s) => (
            <button
              key={s}
              onClick={() => onSugerencia(s)}
              className="text-left text-[14px] underline decoration-neutral-300 underline-offset-4 hover:decoration-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Una propuesta de creación: lo que va a pasar si dices que sí.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL BOTÓN ES LA ÚNICA PUERTA A LA ESCRITURA
 * ─────────────────────────────────────────────────────────────────────────────
 * Lo que se pinta aquí es exactamente el payload que se va a guardar, ya
 * resuelto contra la base: este cliente, este SKU, este precio. Nada se
 * escribe hasta el clic, y la pantalla no vuelve a resolver nada al
 * confirmar — si lo hiciera, estaría enseñando una cosa y guardando otra.
 */
function Propuesta({ r, entrada, onConfirmar, onCancelar }) {
  const { aplicando, hecho, cancelado, errorAccion } = entrada
  const cerrada = Boolean(hecho || cancelado)

  return (
    <div>
      <div className="text-[17px] font-semibold">{r.titulo}</div>

      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {r.campos.map(([k, v]) => (
          <div key={k} className="casilla">
            <div className="rotulo">{k}</div>
            <div className="mt-0.5 text-[15px] tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      {r.lineas?.length > 0 && (
        <div className="registro mt-3 overflow-hidden">
          <div className="registro-cab rotulo grid grid-cols-[110px_1fr_70px_90px_100px] items-center gap-3">
            <div>SKU</div>
            <div>Producto</div>
            <div className="text-right">Cant.</div>
            <div className="text-right">Precio</div>
            <div className="text-right">Importe</div>
          </div>
          {r.lineas.map((l, i) => (
            <div
              key={i}
              className="registro-fila grid grid-cols-[110px_1fr_70px_90px_100px] items-center gap-3 px-4 py-2 text-[13px]"
            >
              <div className="truncate">{l.sku}</div>
              <div className="truncate">{l.descripcion}</div>
              <div className="text-right tabular-nums">{l.cantidad}</div>
              <div className="text-right tabular-nums">{l.precio}</div>
              <div className="text-right tabular-nums">{l.importe}</div>
            </div>
          ))}
          {r.total && (
            <div className="flex items-baseline justify-between border-t border-neutral-300 bg-paper px-4 py-2.5">
              <span className="rotulo">Total</span>
              <span className="text-[17px] font-semibold tabular-nums">{r.total}</span>
            </div>
          )}
        </div>
      )}

      {/* Los avisos NO bloquean: son cosas que mirar antes de decir que sí.
          Bloquear por ellas obligaría a salir del asistente a arreglar algo
          que a lo mejor está bien así. */}
      {r.avisos?.length > 0 && !cerrada && (
        <ul className="mt-3 flex flex-col gap-1">
          {r.avisos.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-neutral-700">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-neutral-600" />
              <span>{a}</span>
            </li>
          ))}
        </ul>
      )}

      {errorAccion && (
        <div className="mt-3 flex items-start gap-2.5 text-[14px]">
          <CircleAlert className="mt-0.5 size-[18px] shrink-0 text-neutral-600" />
          <span>{errorAccion}</span>
        </div>
      )}

      {hecho ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-3">
          <Check className="size-[18px]" />
          <span className="text-[14px]">{hecho.resumen}</span>
          {hecho.enlace && (
            <Link
              to={hecho.enlace}
              className="inline-flex items-center gap-1.5 text-[13px] text-neutral-600 hover:text-ink"
            >
              Abrirla
              <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      ) : cancelado ? (
        <div className="mt-4 border-t border-neutral-200 pt-3 text-[14px] text-neutral-700">
          Cancelado. No guardé nada.
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 border-t border-neutral-200 pt-3">
          <button onClick={onConfirmar} disabled={aplicando} className="boton boton-ink">
            {aplicando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {aplicando ? "Guardando…" : "Crear"}
          </button>
          <button onClick={onCancelar} disabled={aplicando} className="boton boton-claro">
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

const PINTA = { cifra: Cifra, ficha: Ficha, tabla: Tabla }

function Respuesta({ entrada, onSugerencia, onConfirmar, onCancelar }) {
  const { texto, error, resultado, cargando } = entrada
  // El mensaje se pinta aparte: no lleva marco ni enlace, solo texto.
  const esMensaje = resultado?.tipo === "mensaje"
  const esPropuesta = resultado?.tipo === "propuesta"
  const Pinta = resultado && !esMensaje && !esPropuesta ? PINTA[resultado.tipo] : null

  return (
    <div className="flex flex-col gap-2">
      {/* La pregunta, alineada a la derecha: en una conversación uno reconoce
          de un vistazo qué dijo y qué le contestaron, sin leer nada. */}
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl bg-ink px-4 py-2 text-[14px] text-paper">
          {texto}
        </div>
      </div>

      <div className="flex justify-start">
        <div className="max-w-[92%] min-w-0">
          {cargando && (
            <div className="flex items-center gap-2 py-1 text-[13px] text-neutral-600">
              <Loader2 className="size-4 animate-spin" />
              Consultando…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 text-[14px]">
              <CircleAlert className="mt-0.5 size-[18px] shrink-0 text-neutral-600" />
              <span>{error}</span>
            </div>
          )}

          {esMensaje && <Mensaje r={resultado} onSugerencia={onSugerencia} />}

          {esPropuesta && (
            <>
              <p className="m-0 mb-3 text-[15px] leading-snug">{resultado.resumen}</p>
              <div className="registro p-4">
                <Propuesta
                  r={resultado}
                  entrada={entrada}
                  onConfirmar={onConfirmar}
                  onCancelar={onCancelar}
                />
              </div>
            </>
          )}

          {Pinta && (
            <>
              {/* La frase primero: es la respuesta. La tabla o la cifra son el
                  respaldo para quien quiera verificarla. */}
              {resultado.resumen && (
                <p className="m-0 mb-3 text-[15px] leading-snug">{resultado.resumen}</p>
              )}
              <div className="registro p-4">
                <Pinta r={resultado} />
              </div>
              {resultado.enlace && (
                <Link
                  to={resultado.enlace}
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-neutral-600 hover:text-ink"
                >
                  Abrir la pantalla completa
                  <ArrowRight className="size-3.5" />
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- pantalla -- */

let n = 0

export default function Asistente() {
  const [texto, setTexto] = React.useState("")
  const [hilo, setHilo] = React.useState([])
  // De qué se viene hablando, para que «¿y sus movimientos?» sepa de cuál.
  // Lo lleva la app a partir de lo que REALMENTE se consultó.
  const [contexto, setContexto] = React.useState({})
  const [ocupado, setOcupado] = React.useState(false)
  const [cupo, setCupo] = React.useState(null)
  const caja = React.useRef(null)
  const rollo = React.useRef(null)

  React.useEffect(() => {
    let vivo = true
    cupoActual().then((c) => vivo && setCupo(c))
    return () => {
      vivo = false
    }
  }, [])

  async function enviar(pregunta) {
    const q = String(pregunta ?? texto).trim()
    if (!q || ocupado) return

    const id = ++n
    setTexto("")
    setOcupado(true)
    setHilo((h) => [...h, { id, texto: q, cargando: true }])

    // El hilo que ve el modelo: solo los turnos que SÍ se ejecutaron.
    //
    // Un «no entendí» se queda fuera a propósito. Metérselo en la historia es
    // enseñarle con un ejemplo propio que rendirse es una respuesta aceptable,
    // y los modelos chicos imitan el último patrón que ven.
    const historial = hilo
      .filter((e) => (e.intencion && e.intencion !== NO_ENTENDIDO) || e.respuesta)
      .map((e) => ({
        pregunta: e.texto,
        intencion: e.intencion,
        parametros: e.parametros,
        respuesta: e.respuesta,
      }))

    const r = await preguntar(q, contexto, historial)

    setHilo((h) => h.map((e) => (e.id === id ? { ...e, cargando: false, ...r } : e)))
    // Solo lo que se consultó de verdad entra al contexto; un fallo no debe
    // dejar un producto a medio resolver que contamine la siguiente pregunta.
    // Solo los ESCALARES entran al contexto. Heredar unas `lineas` de un
    // turno anterior haría que «hazle otra factura a Jane» arrastrara los
    // renglones de la factura pasada, que es un error caro y silencioso.
    if (r.parametros) {
      const escalares = Object.fromEntries(
        Object.entries(r.parametros).filter(([, v]) => typeof v !== "object")
      )
      setContexto((c) => ({ ...c, ...escalares }))
    }
    // El cupo lo devuelve la propia respuesta, así que no hace falta volver a
    // preguntarlo — y preguntarlo tampoco costaría, pero es un viaje de más.
    if (r.cupo) setCupo(r.cupo)
    setOcupado(false)
    caja.current?.focus()
  }

  /**
   * Confirmar una propuesta: aquí, y solo aquí, se escribe.
   *
   * Se manda la propuesta ENTERA a aplica(), no unos parámetros: lo que se
   * guarda tiene que ser el mismo payload que se pintó.
   */
  async function confirmar(id) {
    const e = hilo.find((x) => x.id === id)
    if (!e || e.resultado?.tipo !== "propuesta" || e.aplicando || e.hecho || e.cancelado) return

    setHilo((h) => h.map((x) => (x.id === id ? { ...x, aplicando: true, errorAccion: null } : x)))
    const r = await aplica(e.resultado)
    setHilo((h) =>
      h.map((x) =>
        x.id === id
          ? r?.error
            ? { ...x, aplicando: false, errorAccion: r.error }
            : { ...x, aplicando: false, hecho: r }
          : x
      )
    )
    caja.current?.focus()
  }

  function cancelar(id) {
    setHilo((h) => h.map((x) => (x.id === id ? { ...x, cancelado: true } : x)))
    caja.current?.focus()
  }

  // Bajar al final cuando llega algo nuevo. Se desplaza LA CAJA, no la ventana:
  // scrollIntoView() en un contenedor con su propio scroll también empuja al
  // padre y deja el encabezado de la app medio fuera de la vista.
  React.useEffect(() => {
    const c = rollo.current
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" })
  }, [hilo])

  const sugerencias = ejemplosSugeridos(4)
  const vacio = hilo.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <Sparkles className="size-[18px] text-neutral-600" />
          <h3 className="m-0 text-[21px] font-semibold">Asistente</h3>
          <span className="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600">
            experimental
          </span>
        </div>
        {cupo && (
          <div className="ml-auto text-[13px] text-neutral-600 tabular-nums">
            {cupo.restantes_hora} consultas esta hora
          </div>
        )}
      </div>

      {/* La caja del chat: hilo que se desplaza arriba, escritura fija abajo. */}
      <div className="registro flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* La conversación vive en una COLUMNA de ancho de lectura, centrada.
            A todo lo ancho del ERP (1460px) un renglón de respuesta se estira
            hasta hacerse ilegible, y la pantalla vacía quedaba como un párrafo
            suelto en medio de un vacío enorme. */}
        <div ref={rollo} className="min-h-0 flex-1 overflow-y-auto">
          {vacio ? (
            /* Centrada en los DOS ejes: si se ancla arriba, el hueco de abajo
               es lo primero que se ve. */
            <div className="grid h-full place-items-center px-5 py-8">
              <div className="w-full max-w-[560px] text-center">
                <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-ink text-paper">
                  <Sparkles className="size-5" />
                </div>
                <h4 className="mt-4 mb-0 text-[20px] font-semibold">
                  Pregúntame por tu operación
                </h4>
                <p className="mx-auto mt-1.5 mb-0 max-w-[46ch] text-[14px] leading-snug text-balance text-neutral-700">
                  Inventario, clientes y facturas, en español. Las cifras salen de la base de
                  datos: no puedo inventar un número.
                </p>

                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {sugerencias.map((s) => (
                    <button
                      key={s}
                      onClick={() => enviar(s)}
                      className="casilla bg-paper text-left text-[13.5px] transition-colors hover:border-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>

                <p className="mx-auto mt-6 mb-0 max-w-[52ch] text-[12px] leading-snug text-balance text-neutral-600">
                  Por ahora solo consulta: no crea ni modifica nada. Si una pregunta no cae en lo
                  que sabe, lo dice en vez de adivinar.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-[860px] flex-col gap-5 px-4 py-5 sm:px-6">
              {hilo.map((e) => (
                <Respuesta
                  key={e.id}
                  entrada={e}
                  onSugerencia={enviar}
                  onConfirmar={() => confirmar(e.id)}
                  onCancelar={() => cancelar(e.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Alineada con la columna de la conversación, no con el ancho del
            ERP: una caja de 1460px debajo de respuestas de 860 se lee como dos
            piezas distintas pegadas. */}
        <div className="border-t border-neutral-300 bg-paper px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[860px] items-center gap-2">
            <input
              ref={caja}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && enviar()}
              placeholder={vacio ? "Pregunta algo — o solo saluda" : "Sigue preguntando…"}
              disabled={ocupado}
              autoFocus
              className="entrada-texto h-10 flex-1 disabled:opacity-60"
            />
            <button
              onClick={() => enviar()}
              disabled={ocupado || !texto.trim()}
              className="boton boton-ink h-10 disabled:opacity-40"
            >
              {ocupado ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Preguntar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
