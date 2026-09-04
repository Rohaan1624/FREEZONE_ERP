import { supabase, rpc } from "./supabase"
import { construyePrompt, construyeMensajes, valida, NO_ENTENDIDO, ESCRIBEN } from "./intenciones"
import { ejecuta, sinEntender, charla } from "./consultas"
import { propone } from "./acciones"

/**
 * El hilo completo de una pregunta.
 *
 *   texto → Edge Function → Groq → valida() → ejecuta() → resultado
 *            (guarda la llave      (aduana)   (Postgres)
 *             y el cupo)
 *
 * Las cuatro etapas están en archivos distintos a propósito, y la frontera que
 * importa es `valida()`: todo lo de la izquierda es texto que devolvió un
 * modelo y no se puede creer; todo lo de la derecha son consultas cerradas
 * contra la base. Ninguna cifra que se pinte pasó por el modelo.
 */

/**
 * Mensajes por código.
 *
 * Cada uno nombra la CAUSA, no el síntoma. Un «no está disponible» genérico
 * obliga a abrir las herramientas de desarrollador para saber si falta
 * desplegar la función, falta la llave o expiró la sesión — tres arreglos
 * completamente distintos.
 */
const POR_CODIGO = {
  401: "Tu sesión expiró. Vuelve a entrar.",
  404: "La función «asistente» no está desplegada todavía (supabase functions deploy asistente).",
  405: "La función respondió a un método que no esperaba.",
  413: "La pregunta es demasiado larga.",
  500: "Falta configurar GROQ_API_KEY, o no se pudo verificar tu cupo. Revisa los registros de la función.",
  502: "El asistente no pudo responder — revisa que GROQ_MODEL sea un modelo válido.",
  504: "El asistente tardó demasiado. Intenta de nuevo.",
}

/**
 * Saca el código y el cuerpo de un error de functions.invoke().
 *
 * `context` NO tiene una forma estable entre versiones de supabase-js: a veces
 * es el Response tal cual, a veces un objeto plano, y a veces el cuerpo ya fue
 * consumido y `.json()` truena. Asumir una sola forma es lo que produjo el
 * inútil «error desconocido»: había respuesta, pero yo miraba en el lugar
 * equivocado y me quedaba sin código y sin mensaje.
 *
 * Se prueban todas las formas conocidas y, si ninguna da, al menos se devuelve
 * el mensaje del error para que en pantalla salga ALGO accionable.
 */
async function detalleDelError(error) {
  const ctx = error?.context

  const codigo =
    ctx?.status ?? ctx?.statusCode ?? error?.status ?? error?.statusCode ?? null

  let cuerpo = null
  if (ctx && typeof ctx === "object") {
    // ¿ya viene parseado?
    if (typeof ctx.error === "string" || ctx.cupo) cuerpo = ctx
    else if (typeof ctx.json === "function") {
      try {
        cuerpo = await ctx.json()
      } catch {
        // El cuerpo ya se consumió o no era JSON: se intenta como texto.
        try {
          const t = await ctx.text?.()
          if (t) cuerpo = JSON.parse(t)
        } catch {
          /* nos quedamos sin cuerpo */
        }
      }
    }
  }

  return { codigo, cuerpo }
}

/**
 * Pregunta y devuelve algo pintable.
 *
 * @returns {{resultado, intencion, cupo}}  respondida
 *        | {{error, cupo?, noEntendido?}}  no se pudo
 */
export async function pregunta(texto, contexto = {}, historial = []) {
  const limpio = String(texto ?? "").trim()
  if (!limpio) return { error: "Escribe una pregunta." }

  let data, error
  try {
    ;({ data, error } = await supabase.functions.invoke("asistente", {
      body: {
        // `mensajes` es el hilo completo y es lo que usa la función nueva.
        mensajes: construyeMensajes(historial, limpio),
        // `prompt` + `pregunta` es el contrato VIEJO, y se sigue mandando a
        // propósito: si la función desplegada todavía es la anterior, esto
        // sigue funcionando como un solo turno en vez de romperse. La
        // conversación se activa sola al redesplegar, sin tocar el navegador.
        prompt: construyePrompt(),
        pregunta: limpio,
      },
    }))
  } catch (e) {
    return { error: `No se pudo contactar al asistente: ${e.message}` }
  }

  if (error) {
    // Sin `context` no hubo respuesta HTTP: o la función no existe en esa URL,
    // o el navegador bloqueó la llamada por CORS. Son las dos cosas que más
    // pasan al desplegar por primera vez y conviene decirlo con nombre.
    if (!error?.context) {
      console.error("asistente: la llamada no llegó a la función", error)
      return {
        error:
          "No se pudo contactar a la función. Comprueba que esté desplegada y que ORIGEN_PERMITIDO incluya este dominio.",
      }
    }

    const { codigo, cuerpo } = await detalleDelError(error)
    // El objeto CRUDO a la consola, no una versión resumida: cuando la forma
    // del error es justo lo que no se entiende, resumirlo esconde la pista.
    console.error("asistente falló:", { codigo, cuerpo, error })
    return {
      error:
        cuerpo?.error ??
        POR_CODIGO[codigo] ??
        // Sin código ni cuerpo, el mensaje del propio error es lo único que
        // queda — y suele nombrar la causa mejor que un texto genérico mío.
        (codigo
          ? `El asistente devolvió un error ${codigo}.`
          : `El asistente falló: ${error?.message ?? "sin detalle"}. Revisa la consola y los registros de la función.`),
      cupo: cuerpo?.cupo,
    }
  }

  // La aduana. A partir de aquí nada viene del modelo salvo QUÉ preguntar —
  // o, en la vía conversacional, un texto que ya pasó por el detector de
  // cifras y no afirma ningún número.
  const v = valida(data?.texto, contexto)

  if (v.ok && v.charla) {
    // Charla: no hay consulta que correr ni contexto de entidades que
    // actualizar. Se devuelve `respuesta` para que el turno sí entre al hilo:
    // sin eso, preguntar algo general y luego repreguntar sobre lo mismo
    // dejaría al modelo sin la mitad de la conversación.
    return { resultado: charla(v.charla), respuesta: v.charla, cupo: data?.cupo }
  }

  if (!v.ok) {
    // «No entendí» NO es un error: es una respuesta, y tiene que ofrecer una
    // salida. Un callejón sin salida hace que la persona cierre la pantalla y
    // no vuelva; una lista de ejemplos la deja intentando otra cosa.
    if (v.intencion === NO_ENTENDIDO) {
      return { resultado: sinEntender(), intencion: NO_ENTENDIDO, cupo: data?.cupo }
    }
    return { error: v.motivo, cupo: data?.cupo }
  }

  // Las que escriben no se ejecutan aquí: se PROPONEN. propone() resuelve
  // nombres contra la base y arma la vista previa, pero no guarda nada — la
  // escritura la dispara el botón de confirmar, en aplica().
  const r = ESCRIBEN.has(v.intencion)
    ? await propone(v.intencion, v.parametros)
    : await ejecuta(v.intencion, v.parametros)
  if (r?.error) return { error: r.error, cupo: data?.cupo }

  // El contexto para el siguiente turno sale de lo que ESTA consulta usó, no
  // de lo que el modelo dijo: así «¿y sus movimientos?» hereda el SKU que de
  // verdad se consultó.
  return {
    resultado: r,
    intencion: v.intencion,
    parametros: v.parametros,
    cupo: data?.cupo,
  }
}

/** Cuánto cupo queda, sin gastarlo. Null si no se pudo saber. */
export async function cupoActual() {
  try {
    return await rpc("asistente_cupo")
  } catch {
    // Que falle esto no debe impedir preguntar: la cabecera se queda sin
    // contador y ya. El límite real lo aplica el servidor de todas formas.
    return null
  }
}
