/**
 * El catálogo CERRADO de preguntas que el asistente sabe contestar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE SOSTIENE TODO: EL MODELO NUNCA DICE UN NÚMERO
 * ─────────────────────────────────────────────────────────────────────────────
 * El modelo solo traduce español a `{intencion, parametros}`. La consulta la
 * corre la app contra Postgres y la app pinta el resultado.
 *
 * Los modelos suman mal y alucinan con seguridad absoluta. Un asistente que
 * dice «te deben $18,450» cuando son $12,620 queda muerto la primera vez que
 * alguien lo verifica — y en un ERP eso se verifica siempre. Con este reparto
 * el modelo NO PUEDE equivocarse en una cifra porque no toca ninguna.
 *
 * De paso resuelve el contexto (no hay que meterle 3,000 SKU a una ventana de
 * 8k) y la latencia (40 tokens de salida en vez de un párrafo).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE VUELVE DEL MODELO ES TEXTO HOSTIL
 * ─────────────────────────────────────────────────────────────────────────────
 * Puede traer una intención inventada, parámetros de más, tipos equivocados o
 * la respuesta envuelta en ```json. `valida()` es la aduana: solo pasa lo que
 * está en el catálogo, con los parámetros declarados y nada más.
 *
 * Este archivo es puro y no importa Supabase: se prueba entero sin modelo y sin
 * base. Los ejecutores viven en consultas.js.
 */

/* --------------------------------------------------------------- catálogo -- */

const PERIODOS = ["anio", "mes", "semana"]

/**
 * Cada intención declara:
 *   descripcion  lo que el modelo lee para decidir si aplica
 *   ejemplos     preguntas reales; suben mucho el acierto de un modelo chico
 *   params       {nombre: {tipo, requerido}}
 *
 * SOLO LECTURA. Crear productos o facturas viene después y por otra puerta,
 * con vista previa y confirmación.
 */
export const INTENCIONES = {
  existencia_sku: {
    descripcion: "Cuántas unidades hay de un producto, con su costo y precio.",
    ejemplos: ["¿cuántos ABC-100 tengo?", "existencia de la esponja doble", "¿hay stock de DEF-200?"],
    params: { sku: { tipo: "texto", requerido: true } },
  },
  sin_existencia: {
    descripcion: "Qué productos están agotados (existencia en cero).",
    ejemplos: ["¿qué se me acabó?", "productos agotados", "¿qué está en cero?"],
    params: {},
  },
  movimientos_sku: {
    descripcion: "El historial de entradas y salidas de un producto.",
    ejemplos: ["movimientos de ABC-100", "¿por qué bajó el stock de DEF-200?"],
    params: { sku: { tipo: "texto", requerido: true } },
  },
  valor_inventario: {
    descripcion: "Cuánto vale todo el inventario valuado a costo.",
    ejemplos: ["¿cuánto vale mi inventario?", "valor del almacén"],
    params: {},
  },

  saldo_cliente: {
    descripcion: "Cuánto debe un cliente y qué facturas tiene abiertas.",
    ejemplos: ["¿cuánto me debe John Doe?", "saldo de Distribuidora Ejemplo"],
    params: { cliente: { tipo: "texto", requerido: true } },
  },
  facturas_vencidas: {
    descripcion: "Las facturas que ya pasaron su fecha de vencimiento y siguen sin cobrarse.",
    ejemplos: ["¿qué facturas están vencidas?", "¿a quién le tengo que cobrar?", "cartera vencida"],
    params: {},
  },
  factura: {
    descripcion: "El detalle de una factura por su número de folio.",
    ejemplos: ["muéstrame la INV-00042", "detalle de la factura 891"],
    params: { folio: { tipo: "texto", requerido: true } },
  },
  por_cobrar: {
    descripcion: "El total por cobrar y cómo se reparte por antigüedad.",
    ejemplos: ["¿cuánto me deben en total?", "antigüedad de saldos", "cuentas por cobrar"],
    params: {},
  },

  ventas_periodo: {
    descripcion: "Cuánto se facturó en un periodo (año, mes o semana).",
    ejemplos: ["¿cuánto vendí este mes?", "ventas del año", "facturación de la semana"],
    params: { periodo: { tipo: "periodo", requerido: false, porDefecto: "mes" } },
  },
  top_skus: {
    descripcion: "Los productos más vendidos de un periodo.",
    ejemplos: ["¿qué es lo que más vendo?", "top productos del año", "mis mejores SKU"],
    params: { periodo: { tipo: "periodo", requerido: false, porDefecto: "mes" } },
  },

  entradas_pendientes: {
    descripcion: "Las compras registradas que todavía no se reciben (mercancía en camino).",
    ejemplos: ["¿qué está por llegar?", "entradas pendientes", "compras sin recibir"],
    params: {},
  },

  // ── Lo social ──────────────────────────────────────────────────────────────
  // «Hola» no es una pregunta inválida: es el principio de una conversación, y
  // contestarle «no entendí» es un mal recibimiento. Van en el catálogo como
  // cualquier otra intención, y la app responde sin tocar la base.
  //
  // Están al FINAL a propósito. Un modelo chico tiende a agarrarse de la
  // primera opción que le encaja más o menos, y una intención de saludo cerca
  // del inicio se traga preguntas de datos mal escritas.
  saludo: {
    descripcion:
      "Un saludo, un agradecimiento o una despedida. Nada que consultar, solo cortesía.",
    ejemplos: ["hola", "buenos días", "gracias", "hasta luego", "qué tal"],
    params: {},
  },
  ayuda: {
    descripcion: "Qué puede hacer el asistente, o quién es.",
    ejemplos: ["¿qué puedes hacer?", "ayuda", "¿quién eres?", "¿qué me puedes decir?"],
    params: {},
  },
}

/**
 * Las que NO consultan la base: se responden con texto y nada más.
 *
 * Se marcan aquí para que la pantalla y las pruebas puedan distinguirlas sin
 * mantener una segunda lista que se desincronice del catálogo.
 */
export const SOCIALES = new Set(["saludo", "ayuda"])

/** Lo que se responde cuando la pregunta no cae en el catálogo. */
export const NO_ENTENDIDO = "no_entendido"

/* ---------------------------------------------------------------- prompt -- */

/**
 * El prompt del sistema: el catálogo entero más las reglas.
 *
 * Se genera del catálogo y no se escribe a mano, para que agregar una intención
 * no exija acordarse de editar dos lugares — el olvido clásico es una intención
 * que el validador acepta pero que el modelo nunca supo que existía.
 */
export function construyePrompt() {
  const lista = Object.entries(INTENCIONES)
    .map(([nombre, i]) => {
      const params = Object.entries(i.params)
        .map(([p, d]) => `${p}${d.requerido ? "" : "?"}:${d.tipo}`)
        .join(", ")
      return [
        `- ${nombre}(${params})`,
        `    ${i.descripcion}`,
        `    ej: ${i.ejemplos.join(" / ")}`,
      ].join("\n")
    })
    .join("\n")

  return `Eres el traductor de un ERP. Conviertes la pregunta del usuario en UNA intención del catálogo.

NO CONTESTAS LA PREGUNTA. No inventas cifras, nombres ni fechas: la aplicación consulta la base de datos y muestra el resultado. Tu única salida es JSON.

CATÁLOGO
${lista}

REGLAS
- Devuelve SOLO un objeto JSON, sin explicación y sin bloques de código.
- Formato: {"intencion":"<nombre>","parametros":{...}}
- Si la pregunta no encaja en ninguna, devuelve {"intencion":"${NO_ENTENDIDO}","parametros":{}}
- No inventes parámetros que no estén declarados.
- El parámetro "periodo" solo acepta: ${PERIODOS.join(", ")}.
- Copia los SKU, folios y nombres TAL CUAL los escribió el usuario; no los corrijas ni los completes.
- Si la pregunta es un SEGUIMIENTO y no repite el SKU, el cliente o el folio («¿y sus movimientos?», «¿cuánto le debo?»), omite ese parámetro: la aplicación sabe de qué se venía hablando.`
}

/* -------------------------------------------------------------- validador -- */

/**
 * Saca el primer objeto JSON del texto del modelo.
 *
 * Los modelos chicos envuelven en ```json, saludan antes o comentan después
 * aunque el prompt lo prohíba. Rescatar el objeto es más barato que reintentar.
 */
function extraeJSON(texto) {
  const s = String(texto ?? "").trim()
  if (!s) return null

  const sinCerca = s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim()

  const intentos = [sinCerca]
  const a = sinCerca.indexOf("{")
  const b = sinCerca.lastIndexOf("}")
  if (a !== -1 && b > a) intentos.push(sinCerca.slice(a, b + 1))

  for (const t of intentos) {
    try {
      const o = JSON.parse(t)
      if (o && typeof o === "object" && !Array.isArray(o)) return o
    } catch {
      /* siguiente intento */
    }
  }
  return null
}

const texto = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim())

/**
 * La aduana. Convierte lo que devolvió el modelo en algo ejecutable, o explica
 * por qué no.
 *
 * `contexto` son las entidades de las que se venía hablando ({sku, cliente,
 * folio, periodo}). Sirve para los seguimientos: «¿y sus movimientos?» llega
 * como movimientos_sku sin sku, y en vez de fallar se rellena con el último.
 *
 * EL CONTEXTO LO LLEVA LA APP, no el modelo. El modelo omite el dato; quién es
 * «sus» lo decide el historial real de la pantalla. Así un seguimiento no puede
 * terminar consultando un SKU que el modelo se inventó de una respuesta previa.
 *
 * @returns {{ok: true, intencion, parametros}} | {{ok: false, motivo, intencion?}}
 */
export function valida(crudo, contexto = {}) {
  const o = typeof crudo === "object" && crudo !== null ? crudo : extraeJSON(crudo)
  if (!o) return { ok: false, motivo: "El modelo no devolvió JSON." }

  const nombre = texto(o.intencion)
  if (!nombre) return { ok: false, motivo: "La respuesta no trae intención." }

  if (nombre === NO_ENTENDIDO)
    return { ok: false, motivo: "No entendí la pregunta.", intencion: NO_ENTENDIDO }

  const def = INTENCIONES[nombre]
  // Una intención fuera del catálogo se rechaza, no se aproxima: adivinar cuál
  // quiso decir es justo como se termina corriendo la consulta equivocada.
  if (!def) return { ok: false, motivo: `Intención desconocida: ${nombre}.` }

  const crudos = o.parametros && typeof o.parametros === "object" ? o.parametros : {}
  const parametros = {}

  for (const [p, d] of Object.entries(def.params)) {
    const v = texto(crudos[p])

    if (v === "") {
      const heredado = texto(contexto?.[p])
      if (heredado !== "") {
        parametros[p] = heredado
        continue
      }
      if (d.requerido) return { ok: false, motivo: `Falta el dato: ${p}.` }
      if (d.porDefecto !== undefined) parametros[p] = d.porDefecto
      continue
    }

    if (d.tipo === "periodo") {
      const n = v.toLowerCase()
      // Un periodo inventado cae al valor por defecto en lugar de reventar:
      // preguntar «del trimestre» y recibir el mes es mejor que un error.
      parametros[p] = PERIODOS.includes(n) ? n : (d.porDefecto ?? "mes")
      continue
    }

    parametros[p] = v
  }

  // Los parámetros no declarados se TIRAN, no se pasan. Lo que el modelo
  // invente nunca llega a una consulta.
  return { ok: true, intencion: nombre, parametros }
}

/** Los nombres del catálogo, para pruebas y para la ayuda en pantalla. */
export const NOMBRES = Object.keys(INTENCIONES)

/**
 * Ejemplos para sembrar la pantalla vacía del asistente.
 *
 * Repartidos por el catálogo, no los primeros: el catálogo arranca con cuatro
 * intenciones de productos seguidas, así que tomar las primeras cuatro sugeriría
 * que el asistente solo sabe de inventario y nadie probaría a preguntar por un
 * saldo o por las ventas del mes.
 */
export function ejemplosSugeridos(cuantos = 4) {
  const todas = Object.values(INTENCIONES)
  const paso = Math.max(1, Math.floor(todas.length / cuantos))
  const salida = []
  for (let i = 0; i < todas.length && salida.length < cuantos; i += paso) {
    salida.push(todas[i].ejemplos[0])
  }
  return salida
}
