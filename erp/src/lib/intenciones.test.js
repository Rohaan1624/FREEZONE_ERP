import { test } from "node:test"
import assert from "node:assert/strict"

import {
  INTENCIONES,
  SOCIALES,
  ESCRIBEN,
  NOMBRES,
  NO_ENTENDIDO,
  valida,
  construyePrompt,
  construyeMensajes,
  pareceCifra,
  TURNOS_DE_CONTEXTO,
  ejemplosSugeridos,
} from "./intenciones.js"

/* ================================================================== *
 * EL VALIDADOR ES LA ADUANA
 * ================================================================== *
 * Lo que devuelve el modelo es texto hostil: puede traer una intención
 * inventada, parámetros de más, tipos equivocados o basura envuelta en
 * markdown. Nada de eso debe llegar a una consulta.
 */

test("acepta una respuesta bien formada", () => {
  const r = valida('{"intencion":"existencia","parametros":{"producto":"ABC-100"}}')
  assert.deepEqual(r, { ok: true, intencion: "existencia", parametros: { producto: "ABC-100" } })
})

test("acepta un objeto ya parseado, no solo texto", () => {
  const r = valida({ intencion: "facturas_vencidas", parametros: {} })
  assert.equal(r.ok, true)
  assert.equal(r.intencion, "facturas_vencidas")
})

/* ------------------------------------------------- basura alrededor del JSON */

test("rescata el JSON envuelto en un bloque de código", () => {
  const r = valida('```json\n{"intencion":"valor_inventario","parametros":{}}\n```')
  assert.equal(r.ok, true)
  assert.equal(r.intencion, "valor_inventario")
})

test("rescata el JSON aunque el modelo salude antes y comente después", () => {
  const r = valida(
    'Claro, aquí tienes:\n{"intencion":"por_cobrar","parametros":{}}\n¿Te ayudo con algo más?'
  )
  assert.equal(r.ok, true)
  assert.equal(r.intencion, "por_cobrar")
})

test("texto sin JSON se rechaza, no se adivina", () => {
  for (const s of ["", "   ", "no sé", "lo siento, no puedo ayudarte con eso"]) {
    assert.equal(valida(s).ok, false, JSON.stringify(s))
  }
})

test("un objeto envuelto en un arreglo también se rescata", () => {
  // Mismo caso que el bloque de código: es un desliz de formato, no un riesgo.
  // La seguridad no está en rechazar envoltorios sino en el catálogo cerrado
  // y en tirar los parámetros no declarados.
  const r = valida('[{"intencion":"por_cobrar","parametros":{}}]')
  assert.equal(r.ok, true)
  assert.equal(r.intencion, "por_cobrar")
})

test("un arreglo sin ninguna intención adentro sí falla", () => {
  assert.equal(valida("[1, 2, 3]").ok, false)
  assert.equal(valida('["por_cobrar"]').ok, false)
})

/* ------------------------------------------------------ intenciones falsas */

test("una intención fuera del catálogo se RECHAZA, no se aproxima", () => {
  // Adivinar cuál quiso decir es como se termina corriendo la consulta
  // equivocada y enseñando datos que nadie pidió.
  const r = valida('{"intencion":"borrar_todo","parametros":{}}')
  assert.equal(r.ok, false)
  assert.match(r.motivo, /desconocida/)
})

test("no acepta nombres parecidos a los del catálogo", () => {
  // `existencia_sku` y `movimientos_sku` eran los nombres VIEJOS: quedan aquí
  // para que un renombre a medias no pase inadvertido.
  for (const n of ["existencias", "existencia_sku", "movimientos_sku", "EXISTENCIA", "saldo"]) {
    assert.equal(valida({ intencion: n, parametros: { producto: "A" } }).ok, false, n)
  }
})

test("no_entendido se distingue de un error de formato", () => {
  const r = valida('{"intencion":"no_entendido","parametros":{}}')
  assert.equal(r.ok, false)
  assert.equal(r.intencion, NO_ENTENDIDO)
})

/* ------------------------------------------------------------- parámetros */

test("un parámetro requerido que falta se reporta por su nombre", () => {
  const r = valida('{"intencion":"existencia","parametros":{}}')
  assert.equal(r.ok, false)
  assert.match(r.motivo, /producto/)
})

test("los parámetros NO declarados se tiran", () => {
  // Lo que el modelo invente nunca debe llegar a una consulta.
  const r = valida({
    intencion: "existencia",
    parametros: { producto: "ABC-100", limite: 9999, tabla: "auth.users", user_id: "otro" },
  })
  assert.deepEqual(r.parametros, { producto: "ABC-100" })
})

test("parametros ausente o de otro tipo no truena", () => {
  assert.equal(valida('{"intencion":"por_cobrar"}').ok, true)
  assert.equal(valida('{"intencion":"por_cobrar","parametros":"nada"}').ok, true)
  assert.equal(valida('{"intencion":"por_cobrar","parametros":null}').ok, true)
})

test("los valores se recortan y los no-texto se convierten", () => {
  const r = valida({ intencion: "factura", parametros: { folio: "  INV-00042  " } })
  assert.equal(r.parametros.folio, "INV-00042")
  const n = valida({ intencion: "factura", parametros: { folio: 891 } })
  assert.equal(n.parametros.folio, "891")
})

test("un requerido en blanco cuenta como ausente", () => {
  for (const v of ["", "   ", null, undefined]) {
    assert.equal(valida({ intencion: "factura", parametros: { folio: v } }).ok, false)
  }
})

/* ----------------------------------------------------------------- periodo */

test("periodo omitido toma su valor por defecto", () => {
  const r = valida('{"intencion":"ventas_periodo","parametros":{}}')
  assert.deepEqual(r.parametros, { periodo: "mes" })
})

test("periodo válido en cualquier caja", () => {
  assert.equal(valida({ intencion: "ventas_periodo", parametros: { periodo: "AÑO" } }).parametros.periodo, "mes")
  assert.equal(valida({ intencion: "ventas_periodo", parametros: { periodo: "Anio" } }).parametros.periodo, "anio")
  assert.equal(valida({ intencion: "top_skus", parametros: { periodo: "semana" } }).parametros.periodo, "semana")
})

test("un periodo inventado cae al de por defecto en vez de reventar", () => {
  // Preguntar «del trimestre» y recibir el mes es mejor que un error seco.
  const r = valida({ intencion: "ventas_periodo", parametros: { periodo: "trimestre" } })
  assert.equal(r.ok, true)
  assert.equal(r.parametros.periodo, "mes")
})

/* -------------------------------------------------------------- el catálogo */

test("cada intención está completa", () => {
  for (const [nombre, i] of Object.entries(INTENCIONES)) {
    assert.ok(i.descripcion?.length > 10, `${nombre}: descripción`)
    assert.ok(i.ejemplos?.length >= 1, `${nombre}: ejemplos`)
    assert.equal(typeof i.params, "object", `${nombre}: params`)
    for (const [p, d] of Object.entries(i.params)) {
      assert.ok(["texto", "periodo", "numero", "lineas"].includes(d.tipo), `${nombre}.${p}: tipo`)
      // Un opcional sin valor por defecto deja la consulta a medias. `null` sí
      // vale: en un precio significa «no me lo dijeron», que no es lo mismo
      // que cero.
      if (!d.requerido && d.tipo !== "lineas")
        assert.notEqual(d.porDefecto, undefined, `${nombre}.${p}: porDefecto`)
    }
  }
})

test("ninguna intención se llama como el centinela", () => {
  assert.ok(!NOMBRES.includes(NO_ENTENDIDO))
})

test("el prompt incluye TODAS las intenciones del catálogo", () => {
  // El olvido clásico: agregar una intención al validador y que el modelo
  // nunca se entere de que existe. Por eso el prompt se genera del catálogo.
  const p = construyePrompt()
  for (const n of NOMBRES) assert.ok(p.includes(n), `falta ${n} en el prompt`)
  assert.ok(p.includes(NO_ENTENDIDO))
})

test("el prompt le exige JSON y le prohíbe las cifras de memoria", () => {
  // Ya NO le prohíbe contestar: ahora puede conversar. Lo que no puede es
  // decir un número — esa es la garantía que quedó, y es la que sostiene que
  // se le pueda creer al asistente.
  const p = construyePrompt()
  assert.match(p, /SOLO un objeto JSON/)
  assert.match(p, /NUNCA escribas cifras/)
  assert.match(p, /anio, mes, semana/)
})

test("el prompt describe los dos caminos", () => {
  const p = construyePrompt()
  assert.match(p, /CONSULTAR EL SISTEMA/)
  assert.match(p, /CONVERSAR/)
  assert.match(p, /"respuesta"/)
  // Ante la duda, el dato: contestar de memoria algo que estaba en la base es
  // el modo de fallar que más caro sale.
  assert.match(p, /ANTE LA DUDA, CONSULTA/)
})

test("todos los ejemplos del catálogo son frases en español, no código", () => {
  for (const [nombre, i] of Object.entries(INTENCIONES)) {
    // El mínimo de largo era un proxy de «no es un esbozo». Para las sociales
    // no aplica: «hola» son cuatro letras y es exactamente el ejemplo correcto.
    const minimo = SOCIALES.has(nombre) ? 3 : 6
    for (const e of i.ejemplos) {
      assert.ok(e.length >= minimo, `${nombre}: «${e}» muy corto`)
      assert.ok(!/[{}[\]]/.test(e), `${nombre}: «${e}» parece código`)
    }
  }
})

test("ejemplosSugeridos devuelve lo pedido", () => {
  assert.equal(ejemplosSugeridos(4).length, 4)
  assert.equal(ejemplosSugeridos(2).length, 2)
})

/* ------------------------------------------------------------- ejecutores -- */

const lee = async (archivo) => {
  const fs = await import("node:fs")
  return fs.readFileSync(new URL(archivo, import.meta.url), "utf8")
}

test("cada intención del catálogo tiene su implementación, en el archivo que le toca", async () => {
  // Estos archivos importan el cliente de Supabase, que no arranca fuera del
  // navegador, así que la cobertura se comprueba sobre el TEXTO. Sigue
  // atrapando el olvido real: agregar una intención y no implementarla.
  const consultas = await lee("./consultas.js")
  const acciones = await lee("./acciones.js")

  for (const n of NOMBRES) {
    const donde = ESCRIBEN.has(n) ? acciones : consultas
    const otro = ESCRIBEN.has(n) ? consultas : acciones
    const re = new RegExp(`\\n  async ${n}\\(`)
    assert.match(donde, re, `falta la implementación de ${n}`)
    // Y NO en el otro archivo: una intención que escribe implementada en
    // consultas.js se saltaría la confirmación entera.
    assert.ok(!re.test(otro), `${n} está implementada en el archivo equivocado`)
  }
})

test("las que escriben salen del catálogo, no de una lista aparte", async () => {
  // Una segunda lista a mano es como una intención que escribe acaba tratada
  // como lectura y guarda sin que nadie lo apruebe.
  assert.deepEqual(
    [...ESCRIBEN].sort(),
    Object.entries(INTENCIONES)
      .filter(([, i]) => i.escribe)
      .map(([n]) => n)
      .sort()
  )
  // Y son exactamente las tres que se pidieron: crear, sin editar ni borrar.
  assert.deepEqual([...ESCRIBEN].sort(), ["crear_cliente", "crear_factura", "crear_producto"])
})

test("no hay ninguna intención de editar ni de borrar", async () => {
  for (const n of NOMBRES) {
    assert.ok(
      !/^(editar|actualizar|modificar|borrar|eliminar|anular)/.test(n),
      `${n}: solo se puede crear`
    )
  }
  const acciones = await lee("./acciones.js")
  for (const prohibido of [".update(", ".delete(", ".upsert("]) {
    assert.ok(!acciones.includes(prohibido), `acciones.js no debe contener ${prohibido}`)
  }
})

test("consultas.js sigue sin escribir nada", async () => {
  // La garantía de solo lectura se mantiene separando los archivos, no
  // confiando en que nadie meta un insert donde no toca.
  const consultas = await lee("./consultas.js")
  for (const escritura of [".insert(", ".update(", ".delete(", ".upsert("]) {
    assert.ok(!consultas.includes(escritura), `consultas.js no debe contener ${escritura}`)
  }
})

test("propone() y aplica() están separadas: proponer no escribe", async () => {
  const acciones = await lee("./acciones.js")
  // El bloque de propuestas no puede contener una escritura. Si alguien mete
  // un insert en PROPONEN, la vista previa dejaría de ser una vista previa.
  const bloque = acciones.slice(
    acciones.indexOf("const PROPONEN = {"),
    acciones.indexOf("const APLICAN = {")
  )
  assert.ok(bloque.length > 200, "no encontré el bloque de propuestas")
  assert.ok(!bloque.includes(".insert("), "una propuesta está escribiendo")
  assert.ok(!bloque.includes('rpc("create_'), "una propuesta está escribiendo")
})

test("ningún ejecutor escribe: el asistente es de solo lectura", async () => {
  const fs = await import("node:fs")
  const fuente = fs.readFileSync(new URL("./consultas.js", import.meta.url), "utf8")
  for (const escritura of [".insert(", ".update(", ".delete(", ".upsert("]) {
    assert.ok(!fuente.includes(escritura), `consultas.js no debe contener ${escritura}`)
  }
  // Los RPC que sí aparecen tienen que ser de lectura.
  const rpcs = [...fuente.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1])
  for (const r of rpcs) {
    assert.ok(
      r.startsWith("totales_") || r === "resumen_dashboard",
      `rpc de escritura en consultas.js: ${r}`
    )
  }
})

test("las sugerencias se reparten por el catálogo, no son las primeras", () => {
  // El catálogo abre con cuatro intenciones de productos seguidas. Sugerir esas
  // cuatro daría a entender que el asistente solo sabe de inventario.
  const s = ejemplosSugeridos(4)
  const primeras = Object.values(INTENCIONES).slice(0, 4).map((i) => i.ejemplos[0])
  assert.notDeepEqual(s, primeras)
  assert.equal(new Set(s).size, s.length, "no debe repetir")
})

/* --------------------------------------------------- seguimiento y contexto -- */

test("un seguimiento hereda el dato omitido del contexto", () => {
  // «¿y sus movimientos?» llega sin sku; lo pone la app, no el modelo.
  const r = valida({ intencion: "movimientos", parametros: {} }, { producto: "ABC-100" })
  assert.equal(r.ok, true)
  assert.equal(r.parametros.producto, "ABC-100")
})

test("lo que el modelo SÍ dice gana sobre el contexto", () => {
  const r = valida(
    { intencion: "movimientos", parametros: { producto: "DEF-200" } },
    { producto: "ABC-100" }
  )
  assert.equal(r.parametros.producto, "DEF-200")
})

test("sin contexto, un requerido omitido sigue fallando", () => {
  assert.equal(valida({ intencion: "movimientos", parametros: {} }, {}).ok, false)
  assert.equal(valida({ intencion: "movimientos", parametros: {} }).ok, false)
})

test("el contexto no puede colar parámetros que la intención no declara", () => {
  // Heredar de un turno anterior no debe ampliar lo que llega a la consulta.
  const r = valida(
    { intencion: "movimientos", parametros: {} },
    { producto: "ABC-100", cliente: "John Doe", tabla: "auth.users" }
  )
  assert.deepEqual(r.parametros, { producto: "ABC-100" })
})

test("el prompt le explica al modelo que puede omitir en un seguimiento", () => {
  assert.match(construyePrompt(), /SEGUIMIENTO/)
})

/* ------------------------------------------------------------- lo social -- */

test("saludar es una intención válida, no un error", () => {
  // «hola» → «no entendí» era un mal recibimiento: no es una pregunta
  // inválida, es el principio de una conversación.
  const r = valida({ intencion: "saludo", parametros: {} })
  assert.equal(r.ok, true)
  assert.equal(r.intencion, "saludo")
})

test("pedir ayuda también", () => {
  assert.equal(valida({ intencion: "ayuda", parametros: {} }).ok, true)
})

test("las sociales existen en el catálogo y no piden parámetros", () => {
  for (const n of SOCIALES) {
    assert.ok(INTENCIONES[n], `${n} no está en el catálogo`)
    assert.deepEqual(INTENCIONES[n].params, {}, `${n} no debe pedir parámetros`)
  }
})

test("las sociales van al final del catálogo", () => {
  // Un modelo chico se agarra de la primera opción que le encaja más o menos.
  // Una intención de saludo cerca del inicio se traga preguntas de datos mal
  // escritas, así que el orden del catálogo es parte del diseño.
  const nombres = Object.keys(INTENCIONES)
  const primeraSocial = nombres.findIndex((n) => SOCIALES.has(n))
  const ultimaReal = nombres.reduce((u, n, i) => (SOCIALES.has(n) ? u : i), -1)
  assert.ok(primeraSocial > ultimaReal, "una social quedó antes de una de datos")
})

test("las sociales aparecen en el prompt como cualquier otra", () => {
  const p = construyePrompt()
  for (const n of SOCIALES) assert.ok(p.includes(n), `falta ${n} en el prompt`)
})

/* ================================================================== *
 * LOS TRES FALLOS QUE SE REPORTARON
 * ================================================================== *
 * 1. Con el NOMBRE del producto (no el SKU) no encontraba nada.
 * 2. «lista todos los peines» no funcionaba.
 * 3. «las últimas facturas» no funcionaba.
 *
 * Los tres eran lo mismo: el catálogo no tenía dónde meterlos.
 */

test("el parámetro de producto NO se llama sku", () => {
  // Se llamaba `sku`, y con ese nombre el modelo se negaba a rellenarlo con un
  // nombre: veía «sku», no veía un código en la pregunta y devolvía
  // no_entendido. El nombre del parámetro ES parte del prompt.
  for (const n of ["buscar_productos", "existencia", "movimientos"]) {
    assert.ok(INTENCIONES[n].params.producto, `${n} debe pedir "producto"`)
    assert.ok(!INTENCIONES[n].params.sku, `${n} no debe pedir "sku"`)
  }
})

test("hay una intención para listar varios productos por nombre", () => {
  const r = valida({ intencion: "buscar_productos", parametros: { producto: "peines" } })
  assert.equal(r.ok, true)
  assert.deepEqual(r.parametros, { producto: "peines" })
})

test("hay una intención para las facturas más recientes", () => {
  const r = valida({ intencion: "ultimas_facturas", parametros: {} })
  assert.equal(r.ok, true)
  assert.equal(r.intencion, "ultimas_facturas")
})

test("buscar_productos va ANTES que existencia en el catálogo", () => {
  // Un modelo chico se agarra de la primera opción que le encaja. «¿qué peines
  // tengo?» encaja en las dos; si `existencia` va primero se lleva las
  // preguntas en plural, resuelve a varios productos y muere en «sé más
  // específico». El orden es el arreglo, no un detalle.
  const nombres = Object.keys(INTENCIONES)
  assert.ok(
    nombres.indexOf("buscar_productos") < nombres.indexOf("existencia"),
    "existencia se va a tragar las preguntas en plural"
  )
})

test("el prompt le dice que un nombre vale igual que un SKU", () => {
  const p = construyePrompt()
  assert.match(p, /NOMBRE vale igual que un SKU/)
  // Y que el plural va por otra intención.
  assert.match(p, /PLURAL/)
  assert.ok(p.includes("buscar_productos"))
})

/* ================================================================== *
 * EL HILO
 * ================================================================== */

test("el hilo empieza con el sistema y acaba con la pregunta nueva", () => {
  const m = construyeMensajes([], "¿cuántos peines tengo?")
  assert.equal(m.length, 2)
  assert.equal(m[0].role, "system")
  assert.equal(m[1].role, "user")
  assert.equal(m[1].content, "¿cuántos peines tengo?")
})

test("cada turno previo entra como pregunta + el JSON que se ejecutó", () => {
  const m = construyeMensajes(
    [{ pregunta: "¿cuántos PG-123 hay?", intencion: "existencia", parametros: { producto: "PG-123" } }],
    "¿y sus movimientos?"
  )
  assert.deepEqual(m.map((x) => x.role), ["system", "user", "assistant", "user"])
  assert.equal(m[1].content, "¿cuántos PG-123 hay?")
  assert.deepEqual(JSON.parse(m[2].content), {
    intencion: "existencia",
    parametros: { producto: "PG-123" },
  })
  assert.equal(m[3].content, "¿y sus movimientos?")
})

test("en el hilo NO va ninguna cifra, solo la intención", () => {
  // Esta es la regla que sostiene todo: si en su ventana no hay números, no
  // hay número que pueda repetir mal en el turno siguiente.
  const m = construyeMensajes(
    [
      {
        pregunta: "¿cuánto me debe John Doe?",
        intencion: "saldo_cliente",
        parametros: { cliente: "John Doe" },
        // Lo que la app pintó de verdad, que NO debe viajar:
        resumen: "John Doe te debe $18,450.75 en 3 facturas abiertas.",
      },
    ],
    "¿y qué facturas son?"
  )
  const todo = m.map((x) => x.content).join("\n")
  assert.ok(!todo.includes("18,450.75"), "una cifra se colo al hilo")
  assert.ok(!todo.includes("$"), "un monto se colo al hilo")
})

test("el hilo se recorta a los últimos turnos", () => {
  const largo = Array.from({ length: 20 }, (_, i) => ({
    pregunta: `p${i}`,
    intencion: "por_cobrar",
    parametros: {},
  }))
  const m = construyeMensajes(largo, "una más")
  // sistema + 2 por turno conservado + la pregunta nueva
  assert.equal(m.length, 1 + TURNOS_DE_CONTEXTO * 2 + 1)
  // Y son los ÚLTIMOS, no los primeros.
  assert.equal(m[1].content, `p${20 - TURNOS_DE_CONTEXTO}`)
})

test("los turnos que no se ejecutaron no entran al hilo", () => {
  const m = construyeMensajes(
    [
      { pregunta: "asdfgh", error: "No entendí la pregunta." },
      { pregunta: "¿cuánto vendí?", intencion: "ventas_periodo", parametros: { periodo: "mes" } },
    ],
    "¿y el año?"
  )
  const todo = m.map((x) => x.content).join("\n")
  assert.ok(!todo.includes("asdfgh"), "un turno fallido se colo al hilo")
  assert.equal(m.length, 4)
})

test("un historial ausente o de otro tipo no truena", () => {
  for (const h of [undefined, null, "nada", 7, {}]) {
    const m = construyeMensajes(h, "hola")
    assert.equal(m.length, 2, JSON.stringify(h))
  }
})

/* ================================================================== *
 * LA VÍA CONVERSACIONAL
 * ================================================================== *
 * El asistente ya puede charlar, no solo clasificar. Esto abre la única
 * rendija por la que una cifra inventada podría llegar a la pantalla, así
 * que la rendija tiene su propio guardia.
 */

test("una respuesta conversacional se acepta", () => {
  const r = valida('{"respuesta":"Un SKU es el código con el que identificas cada producto."}')
  assert.equal(r.ok, true)
  assert.equal(r.charla, "Un SKU es el código con el que identificas cada producto.")
  assert.equal(r.intencion, undefined)
})

test("si trae intención, la intención manda sobre la charla", () => {
  // Un modelo confundido manda las dos. La consulta gana: el dato real es
  // mejor respuesta que una frase.
  const r = valida({
    intencion: "por_cobrar",
    parametros: {},
    respuesta: "Creo que te deben bastante.",
  })
  assert.equal(r.ok, true)
  assert.equal(r.intencion, "por_cobrar")
  assert.equal(r.charla, undefined)
})

test("una charla vacía no cuenta como respuesta", () => {
  for (const v of ["", "   ", null]) {
    assert.equal(valida({ respuesta: v }).ok, false, JSON.stringify(v))
  }
})

/* --------------------------------------------- el detector de cifras -- */

test("una charla que afirma cifras se RECHAZA", () => {
  // Esto es lo que mata la confianza en un asistente de ERP: suena bien, es
  // mentira, y se verifica siempre.
  const inventos = [
    "John Doe te debe $18,450.75 en tres facturas.",
    "Tienes unos 12,000 en inventario.",
    "El saldo es de 450.75",
    "Son como 3.200 dólares",
    "Te quedan 1450 unidades",
    "Vale 120000 a costo",
  ]
  for (const s of inventos) {
    const r = valida({ respuesta: s })
    assert.equal(r.ok, false, s)
    assert.equal(r.intencion, NO_ENTENDIDO, s)
  }
})

test("pero una charla normal con números chicos SÍ pasa", () => {
  // Si el filtro fuera «cualquier dígito», el asistente no podría ni decir
  // cuántos tipos de consulta sabe hacer.
  const buenas = [
    "Puedo consultarte 11 cosas distintas: inventario, clientes y facturas.",
    "Un SKU es el código de cada producto.",
    "Claro, dime el folio y te lo busco.",
    "El costeo aterrizado reparte los gastos entre la mercancía de la entrada.",
  ]
  for (const s of buenas) {
    assert.equal(valida({ respuesta: s }).ok, true, s)
  }
})

test("pareceCifra distingue un dato del negocio de un número cualquiera", () => {
  // Lo que lo convierte en dato NO es el tamaño del número, es el sustantivo
  // que lleva al lado: «11 cosas» es charla, «11 facturas» solo puede salir
  // de la base.
  for (const s of [
    "$1,200",
    "€50",
    "1.234,56",
    "18,450.75",
    "450.75",
    "2500 dólares",
    "120000",
    "3 facturas",
    "te quedan 1450 unidades",
    "facturas vencidas: 3",
  ]) {
    assert.equal(pareceCifra(s), true, s)
  }
  for (const s of [
    "11 consultas",
    "puedo hacer 11 cosas",
    "el año 2026",
    "sin números",
    "PG-123",
    "dame el folio",
  ]) {
    assert.equal(pareceCifra(s), false, s)
  }
})

test("una charla entra al hilo con su propio formato", () => {
  const m = construyeMensajes(
    [{ pregunta: "¿qué es un SKU?", respuesta: "El código de cada producto." }],
    "¿y cuántos tengo?"
  )
  assert.deepEqual(m.map((x) => x.role), ["system", "user", "assistant", "user"])
  assert.deepEqual(JSON.parse(m[2].content), { respuesta: "El código de cada producto." })
})

/* ================================================================== *
 * CREAR: LA VALIDACIÓN DE LO QUE ESCRIBE
 * ================================================================== *
 * El modelo no tiene una puerta a la base, tiene una puerta a un
 * formulario ya lleno. Pero lo que llega a ese formulario sigue siendo
 * texto de un modelo, así que pasa por la misma aduana que todo lo demás.
 */

test("una propuesta de cliente se valida como cualquier intención", () => {
  const r = valida({
    intencion: "crear_cliente",
    parametros: { nombre: "John Doe", dias_credito: 30 },
  })
  assert.equal(r.ok, true)
  assert.equal(r.parametros.nombre, "John Doe")
  assert.equal(r.parametros.dias_credito, 30)
})

test("los opcionales que no vinieron toman su valor por defecto", () => {
  const r = valida({ intencion: "crear_cliente", parametros: { nombre: "Jane Roe" } })
  assert.equal(r.parametros.dias_credito, 0)
  assert.equal(r.parametros.email, "")
})

test("un número puede venir como texto, con símbolo o con miles", () => {
  const p = (v) => valida({ intencion: "crear_producto", parametros: { sku: "X-1", precio: v } })
  assert.equal(p(3.5).parametros.precio, 3.5)
  assert.equal(p("3.50").parametros.precio, 3.5)
  assert.equal(p("$3.50").parametros.precio, 3.5)
  assert.equal(p("1,200").parametros.precio, 1200)
})

test("un número ilegible NO se convierte en cero", () => {
  // En un precio, cero es un valor válido y callado. Confundir «no entendí»
  // con «vale cero» es como se emite una factura regalada.
  const r = valida({
    intencion: "crear_producto",
    parametros: { sku: "X-1", precio: "como cuatro dólares" },
  })
  assert.equal(r.ok, true)
  assert.equal(r.parametros.precio, null)
})

test("los parámetros inventados se tiran también al crear", () => {
  const r = valida({
    intencion: "crear_cliente",
    parametros: { nombre: "John Doe", balance: 999999, user_id: "otro", id: "abc" },
  })
  assert.ok(!("balance" in r.parametros), "balance es columna revocada, no debe pasar")
  assert.ok(!("user_id" in r.parametros))
  assert.ok(!("id" in r.parametros))
})

/* ------------------------------------------------------- las líneas -- */

test("las líneas de una factura se aceptan y se limpian", () => {
  const r = valida({
    intencion: "crear_factura",
    parametros: {
      cliente: "John Doe",
      lineas: [
        { producto: "PG-123", cantidad: 10, precio: 3.5 },
        { producto: "gorras", cantidad: 5 },
      ],
    },
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.parametros.lineas, [
    { cantidad: 10, producto: "PG-123", precio: 3.5 },
    { cantidad: 5, producto: "gorras" },
  ])
})

test("una línea sin cantidad legible se descarta, no se asume 1", () => {
  // Asumir 1 es justo el error que nadie revisa al confirmar.
  const r = valida({
    intencion: "crear_factura",
    parametros: {
      cliente: "John Doe",
      lineas: [
        { producto: "PG-123", cantidad: "varias" },
        { producto: "G-94", cantidad: 5 },
      ],
    },
  })
  assert.equal(r.parametros.lineas.length, 1)
  assert.equal(r.parametros.lineas[0].producto, "G-94")
})

test("una cantidad de cero o negativa tampoco pasa", () => {
  const r = valida({
    intencion: "crear_factura",
    parametros: { cliente: "X", lineas: [{ producto: "A", cantidad: 0 }, { producto: "B", cantidad: -3 }] },
  })
  assert.equal(r.ok, false)
  assert.match(r.motivo, /lineas/)
})

test("las claves inventadas dentro de una línea se tiran", () => {
  // El precio y el producto los resuelve la app contra la base; un
  // product_id o un total que venga del modelo no pinta nada aquí.
  const r = valida({
    intencion: "crear_factura",
    parametros: {
      cliente: "John Doe",
      lineas: [
        { producto: "PG-123", cantidad: 2, product_id: "uuid-falso", total: 999, descuento: 50 },
      ],
    },
  })
  assert.deepEqual(r.parametros.lineas, [{ cantidad: 2, producto: "PG-123" }])
})

test("una factura sin líneas no pasa la aduana", () => {
  for (const v of [undefined, [], "diez peines", {}, [{ cantidad: 3 }]]) {
    const r = valida({ intencion: "crear_factura", parametros: { cliente: "John Doe", lineas: v } })
    assert.equal(r.ok, false, JSON.stringify(v))
  }
})

test("las líneas NO se heredan del contexto", () => {
  // «hazle otra factura a Jane» sin renglones no debe arrastrar los de la
  // factura anterior: caro, silencioso y confirmable de un clic.
  const r = valida(
    { intencion: "crear_factura", parametros: { cliente: "Jane Roe" } },
    { cliente: "John Doe", lineas: [{ producto: "PG-123", cantidad: 99 }] }
  )
  assert.equal(r.ok, false)
  assert.match(r.motivo, /lineas/)
})

test("se acepta una línea libre, sin producto del catálogo", () => {
  const r = valida({
    intencion: "crear_factura",
    parametros: {
      cliente: "John Doe",
      lineas: [{ descripcion: "Flete marítimo", cantidad: 1, precio: 250 }],
    },
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.parametros.lineas, [
    { cantidad: 1, descripcion: "Flete marítimo", precio: 250 },
  ])
})

test("el prompt le explica que crear NO guarda solo", () => {
  const p = construyePrompt()
  assert.match(p, /CREAR COSAS/)
  assert.match(p, /la persona la confirma/)
  // Y que no puede editar ni borrar, para que no lo prometa.
  assert.match(p, /No hay forma de editar ni de borrar/)
  for (const n of ESCRIBEN) assert.ok(p.includes(n), `falta ${n} en el prompt`)
})
