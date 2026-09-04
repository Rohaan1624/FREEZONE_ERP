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
  // OJO con el orden de estas dos. `buscar_productos` va ANTES que `existencia`
  // a propósito: un modelo chico se agarra de la primera que le encaja, y
  // «¿qué peines tengo?» encaja en las dos. Si `existencia` va primero se lleva
  // las preguntas en plural, resuelve a varios productos y muere en «sé más
  // específico» — que es exactamente el callejón sin salida que había.
  buscar_productos: {
    descripcion:
      "Lista los productos cuyo nombre o SKU contiene un texto. Para preguntas en PLURAL o de catálogo: varios productos a la vez.",
    ejemplos: [
      "lista todo los cuchillos",
      "¿qué gorras tengo?",
      "productos que digan esponja",
      "enséñame los cables",
    ],
    params: { producto: { tipo: "texto", requerido: true } },
  },
  existencia: {
    descripcion:
      "Cuántas unidades hay de UN producto concreto, con su costo y precio. El producto se nombra por SKU o por su nombre.",
    ejemplos: [
      "¿cuántos ABC-100 tengo?",
      "existencia de la esponja doble",
      "¿hay stock del peine de madera?",
    ],
    params: { producto: { tipo: "texto", requerido: true } },
  },
  sin_existencia: {
    descripcion: "Qué productos están agotados (existencia en cero).",
    ejemplos: ["¿qué se me acabó?", "productos agotados", "¿qué está en cero?"],
    params: {},
  },
  movimientos: {
    descripcion: "El historial de entradas y salidas de un producto.",
    ejemplos: ["movimientos de ABC-100", "¿por qué bajó el stock de la esponja?"],
    params: { producto: { tipo: "texto", requerido: true } },
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
  ultimas_facturas: {
    descripcion:
      "Las facturas más recientes, de todos los clientes, de la más nueva a la más vieja. Para «las últimas», «las recientes», «qué he facturado».",
    ejemplos: [
      "muéstrame las últimas facturas",
      "las facturas más recientes",
      "¿qué facturé últimamente?",
      "dame las últimas 10 facturas",
    ],
    params: {},
  },
  factura: {
    descripcion: "El detalle de UNA factura por su número de folio.",
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

  // ── Las que ESCRIBEN ───────────────────────────────────────────────────────
  // Van marcadas con `escribe` y ninguna guarda nada por su cuenta: producen
  // una propuesta que la persona ve y confirma. El modelo no tiene una puerta
  // a la base de datos, tiene una puerta a un formulario ya lleno.
  //
  // No hay editar ni borrar a propósito. Crear de más se arregla; sobrescribir
  // una factura que ya salió, no.
  crear_cliente: {
    descripcion: "Da de alta un cliente NUEVO. No sirve para modificar uno que ya existe.",
    ejemplos: [
      "agrega un cliente que se llama John Doe",
      "crea el cliente Distribuidora Ejemplo con RUC 8-123-456",
      "nuevo cliente Jane Roe a 30 días de crédito",
    ],
    escribe: true,
    params: {
      nombre: { tipo: "texto", requerido: true },
      identificador: { tipo: "texto", requerido: false, porDefecto: "" },
      contacto: { tipo: "texto", requerido: false, porDefecto: "" },
      email: { tipo: "texto", requerido: false, porDefecto: "" },
      dias_credito: { tipo: "numero", requerido: false, porDefecto: 0 },
      direccion: { tipo: "texto", requerido: false, porDefecto: "" },
      pais: { tipo: "texto", requerido: false, porDefecto: "" },
    },
  },
  crear_producto: {
    descripcion:
      "Da de alta un producto NUEVO en el catálogo. La existencia no se fija aquí: entra por una compra o un ajuste.",
    ejemplos: [
      "agrega el producto PG-500 peine grande",
      "crea un SKU nuevo: G-99 gorra negra a 4.50",
      "nuevo producto CA-10 cinta aislante, costo 1.20 y precio 2.50",
    ],
    escribe: true,
    params: {
      sku: { tipo: "texto", requerido: true },
      descripcion: { tipo: "texto", requerido: false, porDefecto: "" },
      unidad: { tipo: "texto", requerido: false, porDefecto: "" },
      por_bulto: { tipo: "numero", requerido: false, porDefecto: 1 },
      costo: { tipo: "numero", requerido: false, porDefecto: null },
      precio: { tipo: "numero", requerido: false, porDefecto: null },
    },
  },
  crear_factura: {
    descripcion:
      "Prepara una factura NUEVA para un cliente con sus líneas. Se guarda como BORRADOR para que la persona la revise y la emita.",
    ejemplos: [
      "hazle una factura a John Doe de 10 peines a 3.50",
      "factura a Distribuidora Ejemplo: 20 gorras y 5 cables",
      "emite una factura a Jane Roe con 100 PG-123 a 2.80",
    ],
    escribe: true,
    params: {
      cliente: { tipo: "texto", requerido: true },
      lineas: { tipo: "lineas", requerido: true },
      notas: { tipo: "texto", requerido: false, porDefecto: "" },
    },
  },
  editar_factura: {
    descripcion:
      "Cambia una factura que YA existe, por su folio: le agrega líneas, se las reemplaza, o le cambia las notas.",
    ejemplos: [
      "agrégale 5 gorras a la INV-00042",
      "a la factura INV-00108 súmale 2 cables HDMI a 6.50",
      "cambia las líneas de la INV-00033 por 50 PG-100",
      "ponle una nota a la INV-00077",
    ],
    escribe: true,
    params: {
      folio: { tipo: "texto", requerido: true },
      lineas: { tipo: "lineas", requerido: false },
      // «agregar» por defecto, y es una decisión de seguridad: si el modelo
      // se equivoca de modo, agregar de más se ve en la vista previa y se
      // cancela; reemplazar por error borra renglones que nadie quería tocar.
      modo: { tipo: "texto", requerido: false, porDefecto: "agregar" },
      notas: { tipo: "texto", requerido: false, porDefecto: "" },
    },
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

/**
 * Las que escriben. Se derivan del catálogo, no se listan a mano.
 *
 * Una segunda lista escrita a mano es como una intención que escribe termina
 * tratada como lectura: se salta la confirmación y guarda sin que nadie lo
 * haya aprobado. Aquí no puede desincronizarse.
 */
export const ESCRIBEN = new Set(
  Object.entries(INTENCIONES)
    .filter(([, i]) => i.escribe)
    .map(([n]) => n)
)

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

  return `Eres el asistente del ERP de una empresa que importa y reexporta mercancía en la Zona Libre de Colón, Panamá. Hablas español, en tono cercano y directo, de tú.

Tienes DOS maneras de responder, y siempre devuelves UN objeto JSON:

1. CONSULTAR EL SISTEMA — cuando hace falta un dato real: inventario, productos, clientes, saldos, facturas o compras.
   {"intencion":"<del catálogo>","parametros":{...}}
   La aplicación corre la consulta y enseña el resultado. TÚ NO VES ESOS DATOS y no tienes que redactarlos.

2. CONVERSAR — para todo lo demás: preguntas sobre ti, sobre cómo funciona el ERP o el negocio, dudas de vocabulario, o charla normal.
   {"respuesta":"lo que le contestas, en español, breve y natural"}

ANTE LA DUDA, CONSULTA. Es mejor enseñar un dato de más que contestar de memoria algo que estaba en la base.

CREAR Y EDITAR
Las intenciones crear_ y editar_ cambian datos. NO guardan nada por sí solas: la aplicación arma una vista previa y la persona la confirma con un botón. Así que propón sin miedo, pero no digas que ya quedó guardado — todavía no lo está.
- Solo se puede crear cliente, producto y factura, y editar FACTURAS. No hay forma de borrar nada ni de editar un cliente o un producto; si te lo piden, dilo en "respuesta".
- Pon únicamente los datos que la persona dio. No rellenes precios, RUC ni direcciones por tu cuenta: un dato inventado que alguien confirma sin mirar queda en el sistema para siempre.
- Las líneas de factura son una lista de objetos:
  {"producto":"<SKU o nombre>","cantidad":<número>,"precio":<número opcional>}
  o, para algo que no es del catálogo, {"descripcion":"<texto>","cantidad":<n>,"precio":<n>}
  Omite "precio" si la persona no lo dijo: la aplicación toma el del catálogo.
- En editar_factura, "modo" es "agregar" (suma esas líneas a las que ya tiene) o "reemplazar" (las deja como únicas). Si la persona dice «agrégale», «súmale» o «añádele», es agregar. Ante la duda, agregar.

CATÁLOGO DE CONSULTAS
${lista}

REGLAS
- Devuelve SOLO un objeto JSON, sin explicación y sin bloques de código.
- NUNCA escribas cifras del negocio en "respuesta": ni montos, ni existencias, ni saldos, ni conteos de facturas. No los conoces y no puedes adivinarlos. Si te los piden, usa una intención.
- Si te preguntan por datos que el catálogo no cubre, dilo en "respuesta" en vez de inventarlos.
- No inventes parámetros que no estén declarados.
- El parámetro "periodo" solo acepta: ${PERIODOS.join(", ")}.
- Copia los SKU, folios y nombres TAL CUAL los escribió el usuario; no los corrijas ni los completes.

SOBRE LOS PRODUCTOS
- Un NOMBRE vale igual que un SKU. «el peine de madera» y «PG-123» van los dos en "producto", tal cual. Nunca respondas ${NO_ENTENDIDO} solo porque el usuario no dio un código.
- PLURAL o catálogo («todos los peines», «qué gorras tengo», «lista de cables») → buscar_productos.
- UN producto concreto («¿cuántos peines de madera hay?», «existencia de PG-123») → existencia.

LA CONVERSACIÓN
- Vienes leyendo el hilo: tus turnos anteriores son el JSON que la aplicación ya ejecutó. Úsalos para saber de qué se está hablando.
- Si el turno actual es un SEGUIMIENTO y no repite el producto, el cliente o el folio («¿y sus movimientos?», «¿cuánto me debe?», «¿y de ese?»), OMITE ese parámetro: la aplicación hereda el del turno anterior.
- Si el usuario cambia de tema, no arrastres el parámetro viejo: nómbralo de nuevo.`
}

/* ------------------------------------------------------------- el hilo -- */

/**
 * Cuántos turnos previos se le mandan al modelo.
 *
 * Seis alcanza para cualquier hilo de seguimientos real («¿y sus
 * movimientos?» → «¿y el costo?» → «¿y de la gorra?») y mantiene el prompt
 * en un tamaño que el plan gratuito contesta rápido. Más historia no mejora
 * la clasificación: la empeora, porque el modelo empieza a agarrarse de
 * referentes viejos que ya nadie mencionó.
 */
export const TURNOS_DE_CONTEXTO = 6

/**
 * Cuántos caracteres puede pesar el hilo entero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ RECORTA EL NAVEGADOR Y NO EL SERVIDOR
 * ─────────────────────────────────────────────────────────────────────────────
 * La función tiene su propio tope (MAX_HILO) y devuelve 413 al pasarlo. Ese
 * tope es una DEFENSA, no un mecanismo: existe para que nadie use la función
 * como proxy de LLM, y su respuesta correcta a un abuso es un error seco.
 *
 * Pero seis turnos de una factura de cuarenta renglones pasan de 30.000
 * caracteres sin que nadie esté abusando de nada. Si el recorte no ocurriera
 * aquí, esa conversación perfectamente normal moriría con «la consulta es
 * demasiado larga» y sin manera de seguir: la persona no puede acortar un
 * historial que no ve.
 *
 * Así que aquí se tira historia vieja hasta que quepa, y el tope del servidor
 * queda de red de seguridad para lo que sí es abuso. El número va por debajo
 * del suyo a propósito: los dos viven en repos distintos —uno en el bundle,
 * otro en Deno— y no pueden compartir la constante, así que el margen es lo
 * que evita que un desajuste de unos bytes se convierta en un 413.
 */
export const PRESUPUESTO_HILO = 15000

/**
 * Arma los mensajes para el modelo: sistema + hilo + la pregunta nueva.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL TURNO DEL ASISTENTE ES EL JSON QUE SE EJECUTÓ, NO LO QUE SE PINTÓ
 * ─────────────────────────────────────────────────────────────────────────────
 * Esto es lo que hace que la conversación funcione sin romper la regla de que
 * el modelo nunca toca una cifra. En el hilo no van los resultados —ni las
 * tablas ni las frases con dinero—, va exactamente `{"intencion":…}`.
 *
 * Tiene dos ventajas sobre mandarle el texto de las respuestas:
 *   · No hay un solo número en su ventana, así que no hay número que pueda
 *     repetir mal en un turno siguiente.
 *   · Cada turno previo es un ejemplo más del formato exacto que se le pide,
 *     que es justo lo que más le cuesta a un modelo chico.
 *
 * @param historial [{pregunta, intencion, parametros}] en orden cronológico
 * @param pregunta  el turno nuevo
 */
export function construyeMensajes(historial = [], pregunta, presupuesto = PRESUPUESTO_HILO) {
  const sistema = { role: "system", content: construyePrompt() }
  const actual = { role: "user", content: String(pregunta ?? "") }

  // Solo los turnos que salieron bien: una consulta que se ejecutó o una
  // charla que se pintó. Uno que falló no enseña nada, y lo que enseñaría es
  // justo lo que no hay que repetir.
  const utiles = (Array.isArray(historial) ? historial : []).filter(
    (t) => t && t.pregunta && (t.intencion || t.respuesta)
  )

  const pares = utiles.slice(-TURNOS_DE_CONTEXTO).map((t) => [
    { role: "user", content: String(t.pregunta) },
    {
      role: "assistant",
      // Cada turno se devuelve en el MISMO formato en que se pidió, así que el
      // hilo va enseñando los dos caminos con ejemplos propios: cuándo se
      // consultó y cuándo se conversó.
      content: t.intencion
        ? JSON.stringify({ intencion: t.intencion, parametros: t.parametros ?? {} })
        : JSON.stringify({ respuesta: String(t.respuesta) }),
    },
  ])

  const pesa = (m) => m.reduce((t, x) => t + x.content.length, 0)

  // Se tira historia VIEJA hasta que quepa. La pregunta actual y el sistema no
  // se tocan nunca: sin sistema el modelo no sabe qué formato devolver, y sin
  // la pregunta no hay nada que contestar. Si aun así no cabe, el problema es
  // el prompt, y eso lo cubre una prueba.
  while (pares.length && pesa([sistema, ...pares.flat(), actual]) > presupuesto) {
    pares.shift()
  }

  return [sistema, ...pares.flat(), actual]
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
 * Un número del modelo, o null si no lo es.
 *
 * Puede llegar como número JSON o como texto («3.50», «$3.50», «1,200»). Lo
 * que NO se hace es convertir la basura en cero: en un precio, cero es un
 * valor válido y callado, y confundir «no entendí» con «vale cero» es como se
 * emite una factura regalada.
 */
function aNumero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const s = String(v ?? "")
    .replace(/[$€\s]/g, "")
    .replace(/,/g, "")
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Cuántas líneas se aceptan en una propuesta de factura. */
const MAX_LINEAS = 40

/**
 * Las líneas de una factura propuesta, filtradas campo por campo.
 *
 * Mismo criterio que con los parámetros sueltos: solo pasan las cuatro claves
 * declaradas y en el tipo que toca. Lo que el modelo invente —un product_id,
 * un total ya calculado, un descuento— se queda fuera, porque el precio y el
 * producto los resuelve la app contra la base al armar la propuesta.
 *
 * La cantidad NO tiene valor por defecto: una línea sin cantidad legible se
 * descarta entera. Asumir 1 es exactamente el error que nadie revisa.
 */
function normalizaLineas(v) {
  if (!Array.isArray(v)) return []
  const salida = []
  for (const cruda of v.slice(0, MAX_LINEAS)) {
    if (!cruda || typeof cruda !== "object") continue
    const producto = texto(cruda.producto ?? cruda.sku)
    const descripcion = texto(cruda.descripcion)
    const cantidad = aNumero(cruda.cantidad ?? cruda.qty)
    const precio = aNumero(cruda.precio ?? cruda.unit_price)

    if (!producto && !descripcion) continue
    if (cantidad === null || cantidad <= 0) continue

    const l = { cantidad }
    if (producto) l.producto = producto
    if (descripcion) l.descripcion = descripcion
    if (precio !== null) l.precio = precio
    salida.push(l)
  }
  return salida
}

/**
 * ¿Este texto está afirmando una cifra del negocio?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA RED DE SEGURIDAD DE LA VÍA CONVERSACIONAL
 * ─────────────────────────────────────────────────────────────────────────────
 * Toda la confianza en este asistente se apoya en que las cifras salen de
 * Postgres y no del modelo. Dejarlo conversar abre la única rendija por donde
 * eso se puede romper: que conteste «me parece que John Doe te debe unos
 * $18,000» de memoria. Suena bien, es mentira, y en un ERP se verifica siempre
 * — la primera vez que pasa, nadie vuelve a creerle al asistente.
 *
 * El prompt ya se lo prohíbe. Esto es lo que pasa cuando no obedece, que es la
 * mitad de las veces con un modelo de plan gratuito.
 *
 * Se buscan las formas en que se escribe DINERO o una cantidad contable, no
 * cualquier dígito: «tengo 11 tipos de consulta» tiene que poder decirlo.
 */
// Las palabras que convierten un número cualquiera en un dato del negocio.
// «11 cosas» es charla; «11 facturas» es un dato que solo puede salir de la
// base. La diferencia no está en el número, está en el sustantivo.
const SUSTANTIVOS =
  "unidades?|piezas?|pzas?|bultos?|existencias?|facturas?|clientes?|productos?|skus?|saldos?|totales?|deuda|utilidad|margen|inventario"

export function pareceCifra(s) {
  const t = String(s ?? "")
  return (
    /[$€]\s*\d/.test(t) || // $1,200
    /\d\s*(dólares|dolares|balboas|usd)\b/i.test(t) ||
    /\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b/.test(t) || // 18,450.75 · 1.200
    /\b\d+[.,]\d{2}\b/.test(t) || // 450.75
    // Un número pegado a un sustantivo del negocio, en cualquier orden:
    // «1450 unidades», «facturas: 3».
    new RegExp(`\\b\\d+\\s*(${SUSTANTIVOS})\\b`, "i").test(t) ||
    new RegExp(`\\b(${SUSTANTIVOS})\\b[^.]{0,12}?\\d`, "i").test(t) ||
    // Un entero grande y suelto. Cinco dígitos y no cuatro, porque «el año
    // 2026» es conversación perfectamente normal y no una cifra inventada.
    /\b\d{5,}\b/.test(t)
  )
}

/**
 * La aduana. Convierte lo que devolvió el modelo en algo ejecutable, o explica
 * por qué no.
 *
 * `contexto` son las entidades de las que se venía hablando ({producto,
 * cliente, folio, periodo}). Sirve para los seguimientos: «¿y sus
 * movimientos?» llega como `movimientos` sin producto, y en vez de fallar se
 * rellena con el último.
 *
 * EL CONTEXTO LO LLEVA LA APP, no el modelo. El modelo omite el dato; quién es
 * «sus» lo decide el historial real de la pantalla. Así un seguimiento no puede
 * terminar consultando un producto que el modelo se inventó de una respuesta
 * previa.
 *
 * Esto CONVIVE con el hilo de construyeMensajes() y no se pisan: el hilo le
 * dice al modelo de qué se habla para que sepa qué omitir; el contexto es
 * quien pone el valor. El modelo nunca escribe el referente de un seguimiento.
 *
 * @returns {{ok: true, intencion, parametros}} | {{ok: false, motivo, intencion?}}
 */
export function valida(crudo, contexto = {}) {
  const o = typeof crudo === "object" && crudo !== null ? crudo : extraeJSON(crudo)
  if (!o) return { ok: false, motivo: "El modelo no devolvió JSON." }

  const nombre = texto(o.intencion)

  // ── La vía conversacional ──────────────────────────────────────────────────
  // Sin intención pero con "respuesta", el modelo eligió charlar. Se acepta,
  // PERO pasa por el detector de cifras: es el único punto de todo el sistema
  // donde texto escrito por el modelo llega a la pantalla, así que es el único
  // donde podría colarse un número inventado.
  if (!nombre) {
    const charla = texto(o.respuesta)
    if (charla) {
      if (pareceCifra(charla))
        return {
          ok: false,
          motivo: "El modelo intentó dar cifras de memoria.",
          intencion: NO_ENTENDIDO,
        }
      return { ok: true, charla }
    }
    return { ok: false, motivo: "La respuesta no trae intención." }
  }

  if (nombre === NO_ENTENDIDO)
    return { ok: false, motivo: "No entendí la pregunta.", intencion: NO_ENTENDIDO }

  const def = INTENCIONES[nombre]
  // Una intención fuera del catálogo se rechaza, no se aproxima: adivinar cuál
  // quiso decir es justo como se termina corriendo la consulta equivocada.
  if (!def) return { ok: false, motivo: `Intención desconocida: ${nombre}.` }

  const crudos = o.parametros && typeof o.parametros === "object" ? o.parametros : {}
  const parametros = {}

  for (const [p, d] of Object.entries(def.params)) {
    // Las líneas no son un escalar: se procesan en su propio paso, más abajo.
    if (d.tipo === "lineas") continue

    const v = texto(crudos[p])

    if (v === "") {
      // ───────────────────────────────────────────────────────────────────────
      // UN OPCIONAL DE UNA INTENCIÓN QUE ESCRIBE NO SE HEREDA
      // ───────────────────────────────────────────────────────────────────────
      // El contexto se acumula durante toda la sesión, así que heredar aquí
      // arrastra valores viejos. En una consulta eso es cómodo —seguir en el
      // mismo periodo— y como mucho enseña un dato de más.
      //
      // En una escritura es destructivo, y en silencio. `modo` vale "agregar"
      // por defecto justamente para que equivocarse no borre nada; si se hereda
      // un "reemplazar" que la persona dijo tres turnos atrás sobre OTRA
      // factura, el defecto de seguridad deja de existir y la propuesta llega
      // pidiendo borrar renglones que nadie mencionó. Lo mismo con `notas`:
      // heredarlas le pega a una factura nueva la nota de otra.
      //
      // Los REQUERIDOS sí se heredan aunque escriban: es lo que hace que
      // «y agrégale 5 gorras» sepa de qué factura habla, y el folio heredado
      // se ve en la vista previa antes de confirmar.
      const heredable = d.requerido || !def.escribe
      const heredado = heredable ? texto(contexto?.[p]) : ""
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

    if (d.tipo === "numero") {
      const n = aNumero(crudos[p])
      // Un número ilegible NO se aproxima a cero: en un precio, cero es un
      // valor perfectamente válido y silencioso. Se deja sin poner y quien
      // resuelva la propuesta decide qué hacer con la ausencia.
      parametros[p] = n === null ? d.porDefecto : n
      continue
    }

    parametros[p] = v
  }

  // Las líneas se validan aparte del bucle: no son un escalar y su contenido
  // hay que filtrarlo campo por campo igual que los parámetros de arriba.
  for (const [p, d] of Object.entries(def.params)) {
    if (d.tipo !== "lineas") continue
    const filas = normalizaLineas(crudos[p])
    if (!filas.length) {
      if (d.requerido) return { ok: false, motivo: `Falta el dato: ${p}.` }
      continue
    }
    parametros[p] = filas
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
