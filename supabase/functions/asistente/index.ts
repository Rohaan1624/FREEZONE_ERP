import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * El intermediario del asistente.
 *
 * NO CORRE NINGÚN MODELO. Un runtime de Deno con unos cientos de megas no
 * puede; el modelo corre en Groq. Esta función hace tres cosas y nada más:
 *
 *   1. Comprueba que quien llama tiene sesión válida en el proyecto.
 *   2. Descuenta su cupo (asistente_consumir, en Postgres).
 *   3. Guarda la llave de Groq y reenvía la pregunta.
 *
 * La llave vive aquí porque una app de navegador NO PUEDE guardarla: cualquier
 * cosa que entre al bundle es legible con las herramientas de desarrollador.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL PROMPT LO MANDA EL NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Se ve raro, así que vale explicarlo. El catálogo de intenciones vive en
 * intenciones.js, con pruebas que verifican que el prompt lo incluya completo.
 * Duplicarlo aquí en Deno crearía una segunda copia que se desincroniza en
 * cuanto alguien agregue una intención y toque solo un lado.
 *
 * Y no abre nada: el catálogo no es secreto, y un prompt manipulado no llega a
 * los datos. La respuesta la valida el navegador contra SU catálogo antes de
 * ejecutar nada, y los ejecutores solo corren consultas cerradas bajo RLS. Lo
 * peor que consigue alguien que manipule el prompt es gastar su propio cupo.
 *
 * Lo que sí hay que acotar es el TAMAÑO, o esto se vuelve un proxy gratis de
 * LLM para quien tenga una sesión: de ahí los topes de abajo.
 */

// Un prompt del catálogo son ~600 tokens; el doble deja margen para crecer sin
// permitir que alguien mande un libro.
const MAX_PROMPT = 8000
const MAX_PREGUNTA = 500

// El modelo se configura por variable de entorno para poder cambiarlo sin
// tocar código.
//
// OJO: no basta con que el identificador EXISTA. `llama-3.3-70b-versatile` es
// un modelo de producción real de Groq y aun así fallaba, porque no está en el
// plan gratuito — la llave no tiene acceso y la respuesta es un error, no un
// «modelo no encontrado» obvio. El plan gratuito da qwen3.8-27b, qwen3.6-27b,
// gpt-oss-20b y gpt-oss-120b para texto.
//
// Qwen por defecto: la familia es la más sólida de esa lista en español y en
// salida estructurada, que es justo lo único que le pedimos.
const MODELO = Deno.env.get("GROQ_MODEL") ?? "qwen/qwen3.8-27b"
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

// Sin esto, un Groq colgado deja la petición abierta hasta que el runtime la
// corta: la persona ve la rueda girando sin mensaje y su cupo ya se gastó.
const TIMEOUT_MS = 15000

const ORIGEN = Deno.env.get("ORIGEN_PERMITIDO") ?? "*"

// LAS CUATRO CABECERAS SON NECESARIAS, no solo las dos obvias.
//
// supabase-js manda `x-client-info` (su versión) y `apikey` en TODA petición,
// además de las que uno espera. Si no están en esta lista el navegador corta
// en el preflight y la función nunca llega a ejecutarse: el error que se ve es
// «Request header field x-client-info is not allowed», no un fallo del código.
const cors = {
  "Access-Control-Allow-Origin": ORIGEN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // El preflight se cachea un día: sin esto cada pregunta cuesta dos viajes.
  "Access-Control-Max-Age": "86400",
}

const responde = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return responde({ error: "Usa POST." }, 405)

  const llave = Deno.env.get("GROQ_API_KEY")
  if (!llave) {
    // Falta configuración del servidor, no culpa de quien pregunta.
    console.error("GROQ_API_KEY no está configurada")
    return responde({ error: "El asistente no está configurado." }, 500)
  }

  const auth = req.headers.get("Authorization")
  if (!auth) return responde({ error: "Sin sesión." }, 401)

  // El cliente hereda el JWT de quien llama, así que auth.uid() dentro de
  // Postgres resuelve a esa persona y RLS la acota como en cualquier consulta.
  // Los proyectos nuevos nombran la llave pública PUBLISHABLE_KEY; los de antes,
  // ANON_KEY. Se aceptan las dos para que esto no dependa de cuándo se creó el
  // proyecto — el frontend de este ya usa la nomenclatura nueva.
  const anon =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
  if (!anon) {
    console.error("no hay SUPABASE_ANON_KEY ni SUPABASE_PUBLISHABLE_KEY")
    return responde({ error: "El asistente no está configurado." }, 500)
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, anon, {
    global: { headers: { Authorization: auth } },
  })

  const { data: usuario, error: errAuth } = await supabase.auth.getUser()
  if (errAuth || !usuario?.user) return responde({ error: "Sesión inválida." }, 401)

  let cuerpo: { prompt?: string; pregunta?: string }
  try {
    cuerpo = await req.json()
  } catch {
    return responde({ error: "El cuerpo no es JSON." }, 400)
  }

  const prompt = String(cuerpo.prompt ?? "")
  const pregunta = String(cuerpo.pregunta ?? "").trim()

  if (!prompt || !pregunta) return responde({ error: "Faltan prompt o pregunta." }, 400)
  if (prompt.length > MAX_PROMPT || pregunta.length > MAX_PREGUNTA) {
    // Esto no es una validación de forma: es lo que impide que la función se
    // use como proxy gratuito de LLM con la sesión de cualquier empleado.
    return responde({ error: "La consulta es demasiado larga." }, 413)
  }

  // El cupo se descuenta ANTES de llamar a Groq. Al revés, un fallo del
  // proveedor dejaría el contador sin mover y el bucle seguiría golpeando.
  const { data: cupo, error: errCupo } = await supabase.rpc("asistente_consumir")
  if (errCupo) {
    console.error("asistente_consumir:", errCupo.message)
    return responde({ error: "No se pudo verificar tu cupo." }, 500)
  }
  if (!cupo?.permitido) {
    return responde({ error: cupo?.motivo ?? "Llegaste a tu límite de consultas.", cupo }, 429)
  }

  let r: Response
  const corta = AbortSignal.timeout(TIMEOUT_MS)
  try {
    r = await fetch(GROQ_URL, {
      method: "POST",
      signal: corta,
      headers: { Authorization: `Bearer ${llave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELO,
        // Temperatura 0: clasificar en un catálogo cerrado no quiere variedad,
        // quiere que la misma pregunta dé siempre la misma intención.
        temperature: 0,
        // La respuesta es un JSON de ~40 tokens; el tope solo evita que un
        // modelo confundido escriba un ensayo y se lo cobre a la cuota.
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: pregunta },
        ],
      }),
    })
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError") {
      console.error("groq no respondio en", TIMEOUT_MS, "ms")
      return responde({ error: "El asistente tardó demasiado. Intenta de nuevo.", cupo }, 504)
    }
    console.error("groq inalcanzable:", e)
    return responde({ error: "No se pudo contactar al asistente.", cupo }, 502)
  }

  if (!r.ok) {
    const detalle = await r.text().catch(() => "")
    console.error("groq", r.status, detalle.slice(0, 400))

    // El 429 de Groq es distinto del nuestro: ese es el cupo de TODA la
    // empresa, no el de la persona, y el mensaje tiene que decirlo o alguien
    // va a pensar que consumió sus 30 consultas cuando lleva dos.
    if (r.status === 429)
      return responde(
        { error: "El asistente está saturado ahora mismo. Intenta en un minuto.", cupo },
        429
      )

    // SE DEVUELVE EL MOTIVO DE GROQ, no un genérico.
    //
    // «El asistente no pudo responder» obliga a ir a los registros de la
    // función para saber si el problema es el nombre del modelo, la llave o
    // la cuota — tres arreglos distintos. Groq ya lo dice con claridad
    // («The model X does not exist»), así que se pasa tal cual.
    //
    // Solo se toma error.message del JSON, nunca el cuerpo crudo: así no hay
    // manera de que se cuele una cabecera o un eco de la llave en la respuesta.
    let motivo = ""
    try {
      motivo = String(JSON.parse(detalle)?.error?.message ?? "").slice(0, 200)
    } catch {
      /* Groq no devolvió JSON */
    }

    const pista =
      r.status === 404
        ? ` Revisa GROQ_MODEL: «${MODELO}» no existe en Groq.`
        : r.status === 401
          ? " Revisa GROQ_API_KEY."
          : ""

    return responde(
      { error: `Groq respondió ${r.status}.${motivo ? ` ${motivo}` : ""}${pista}`, cupo },
      502
    )
  }

  const json = await r.json().catch(() => null)
  const texto = json?.choices?.[0]?.message?.content
  if (typeof texto !== "string")
    return responde({ error: "El asistente devolvió una respuesta vacía.", cupo }, 502)

  // Se devuelve el texto TAL CUAL. Validarlo aquí duplicaría valida() en Deno
  // y las dos copias se desincronizarían; el navegador ya tiene la versión
  // probada y nada se ejecuta antes de pasar por ella.
  return responde({ texto, cupo })
})
