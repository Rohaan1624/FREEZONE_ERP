import * as React from "react"
import { Link } from "react-router-dom"
import { Sparkles, CircleAlert, ArrowRight, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { pregunta as preguntar, cupoActual } from "@/lib/asistente"
import { ejemplosSugeridos } from "@/lib/intenciones"

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

const PINTA = { cifra: Cifra, ficha: Ficha, tabla: Tabla }

function Respuesta({ entrada, onSugerencia }) {
  const { texto, error, resultado, cargando } = entrada
  // El mensaje se pinta aparte: no lleva marco ni enlace, solo texto.
  const esMensaje = resultado?.tipo === "mensaje"
  const Pinta = resultado && !esMensaje ? PINTA[resultado.tipo] : null

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
  const fondo = React.useRef(null)

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

    const r = await preguntar(q, contexto)

    setHilo((h) => h.map((e) => (e.id === id ? { ...e, cargando: false, ...r } : e)))
    // Solo lo que se consultó de verdad entra al contexto; un fallo no debe
    // dejar un SKU a medio resolver que contamine la siguiente pregunta.
    if (r.parametros) setContexto((c) => ({ ...c, ...r.parametros }))
    // El cupo lo devuelve la propia respuesta, así que no hace falta volver a
    // preguntarlo — y preguntarlo tampoco costaría, pero es un viaje de más.
    if (r.cupo) setCupo(r.cupo)
    setOcupado(false)
    caja.current?.focus()
  }

  // Bajar al final cuando llega algo nuevo, que es el precio de leer hacia
  // abajo — sin esto la respuesta aparece fuera de la vista.
  React.useEffect(() => {
    fondo.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [hilo])

  const sugerencias = ejemplosSugeridos(4)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="size-[18px] text-neutral-600" />
            <h3 className="m-0 text-[21px] font-semibold">Asistente</h3>
            <span className="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600">
              experimental
            </span>
          </div>
          <div className="max-w-[70ch] text-[13px] text-neutral-700">
            Pregunta en español sobre tu inventario, tus clientes y tus facturas. Las cifras salen
            de la base de datos, no del modelo: no puede inventar un número.
          </div>
        </div>
        {cupo && (
          <div className="ml-auto text-[13px] text-neutral-600 tabular-nums">
            {cupo.restantes_hora} consultas esta hora
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={caja}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviar()}
          placeholder="Pregunta algo — o solo saluda"
          disabled={ocupado}
          autoFocus
          className="entrada-texto h-10 flex-1 disabled:opacity-60"
        />
        <button
          onClick={() => enviar()}
          disabled={ocupado || !texto.trim()}
          className="boton boton-ink h-10 disabled:opacity-40"
        >
          {ocupado ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Preguntar
        </button>
      </div>

      {hilo.length === 0 && (
        <div className="registro p-6">
          <div className="rotulo">Prueba con</div>
          <div className="mt-2 flex flex-col items-start gap-1.5">
            {sugerencias.map((s) => (
              <button
                key={s}
                onClick={() => enviar(s)}
                className="text-left text-[14px] underline decoration-neutral-300 underline-offset-4 hover:decoration-ink"
              >
                {s}
              </button>
            ))}
          </div>
          <p className="mt-4 mb-0 max-w-[70ch] text-[12px] text-neutral-600">
            Por ahora solo consulta: no crea ni modifica nada. Si una pregunta no cae en lo que
            sabe, lo dice en vez de adivinar.
          </p>
        </div>
      )}

      {hilo.length > 0 && (
        <div className="flex flex-col gap-5">
          {hilo.map((e) => (
            <Respuesta key={e.id} entrada={e} onSugerencia={enviar} />
          ))}
          <div ref={fondo} />
        </div>
      )}
    </div>
  )
}
