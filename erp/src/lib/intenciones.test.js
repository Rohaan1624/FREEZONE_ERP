import { test } from "node:test"
import assert from "node:assert/strict"

import {
  INTENCIONES,
  SOCIALES,
  NOMBRES,
  NO_ENTENDIDO,
  valida,
  construyePrompt,
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
  const r = valida('{"intencion":"existencia_sku","parametros":{"sku":"ABC-100"}}')
  assert.deepEqual(r, { ok: true, intencion: "existencia_sku", parametros: { sku: "ABC-100" } })
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
  for (const n of ["existencia", "existencia_skus", "EXISTENCIA_SKU", "saldo"]) {
    assert.equal(valida({ intencion: n, parametros: { sku: "A" } }).ok, false, n)
  }
})

test("no_entendido se distingue de un error de formato", () => {
  const r = valida('{"intencion":"no_entendido","parametros":{}}')
  assert.equal(r.ok, false)
  assert.equal(r.intencion, NO_ENTENDIDO)
})

/* ------------------------------------------------------------- parámetros */

test("un parámetro requerido que falta se reporta por su nombre", () => {
  const r = valida('{"intencion":"existencia_sku","parametros":{}}')
  assert.equal(r.ok, false)
  assert.match(r.motivo, /sku/)
})

test("los parámetros NO declarados se tiran", () => {
  // Lo que el modelo invente nunca debe llegar a una consulta.
  const r = valida({
    intencion: "existencia_sku",
    parametros: { sku: "ABC-100", limite: 9999, tabla: "auth.users", user_id: "otro" },
  })
  assert.deepEqual(r.parametros, { sku: "ABC-100" })
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
      assert.ok(["texto", "periodo"].includes(d.tipo), `${nombre}.${p}: tipo`)
      // Un opcional sin valor por defecto deja la consulta a medias.
      if (!d.requerido) assert.notEqual(d.porDefecto, undefined, `${nombre}.${p}: porDefecto`)
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

test("el prompt le prohíbe contestar y le exige JSON", () => {
  const p = construyePrompt()
  assert.match(p, /NO CONTESTAS/)
  assert.match(p, /SOLO un objeto JSON/)
  assert.match(p, /anio, mes, semana/)
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

test("cada intención del catálogo tiene su ejecutor", async () => {
  // consultas.js importa el cliente de Supabase, que no arranca fuera del
  // navegador, así que la cobertura se comprueba sobre el TEXTO del archivo.
  // Sigue atrapando el olvido real: agregar una intención y no implementarla.
  const fs = await import("node:fs")
  const fuente = fs.readFileSync(new URL("./consultas.js", import.meta.url), "utf8")
  for (const n of NOMBRES) {
    assert.match(fuente, new RegExp(`\\n  async ${n}\\(`), `falta el ejecutor de ${n}`)
  }
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
  const r = valida({ intencion: "movimientos_sku", parametros: {} }, { sku: "ABC-100" })
  assert.equal(r.ok, true)
  assert.equal(r.parametros.sku, "ABC-100")
})

test("lo que el modelo SÍ dice gana sobre el contexto", () => {
  const r = valida(
    { intencion: "movimientos_sku", parametros: { sku: "DEF-200" } },
    { sku: "ABC-100" }
  )
  assert.equal(r.parametros.sku, "DEF-200")
})

test("sin contexto, un requerido omitido sigue fallando", () => {
  assert.equal(valida({ intencion: "movimientos_sku", parametros: {} }, {}).ok, false)
  assert.equal(valida({ intencion: "movimientos_sku", parametros: {} }).ok, false)
})

test("el contexto no puede colar parámetros que la intención no declara", () => {
  // Heredar de un turno anterior no debe ampliar lo que llega a la consulta.
  const r = valida(
    { intencion: "movimientos_sku", parametros: {} },
    { sku: "ABC-100", cliente: "John Doe", tabla: "auth.users" }
  )
  assert.deepEqual(r.parametros, { sku: "ABC-100" })
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
