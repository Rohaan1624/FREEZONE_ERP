import { prueba, assert, ID, BETO, linea, cargo } from "./ayuda.mjs"

/**
 * VISTAS Y AGREGADOS
 *
 * De aquí salen el estado que se ve en la lista, las cifras de la cabecera y
 * el tablero. Todo esto vivía antes en el navegador, sumando el arreglo que ya
 * tenía cargado — y con paginación eso dejó de ser cierto: PostgREST recorta a
 * mil filas sin devolver error, así que las cifras salían más chicas de lo real
 * y nada lo indicaba.
 *
 * Bajarlo a Postgres arregló eso. Estas pruebas fijan que la derivación diga lo
 * mismo que decía el frontend, empezando por el orden de los casos.
 */

/* ------------------------------------------- el estado de invoice_listado */

const estadoDe = (db, id) =>
  db.uno("select estado, saldo::text, dias_vencida from public.invoice_listado where id = $1", [id])

prueba("un borrador es Borrador, aunque esté vencido", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "draft",
    p_due_date: "2020-01-01",
  })
  assert.equal((await estadoDe(db, id)).estado, "Borrador")
})

prueba("emitida y sin abonos es Pendiente", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
    p_due_date: "2099-01-01",
  })
  const f = await estadoDe(db, id)
  assert.equal(f.estado, "Pendiente")
  assert.equal(Number(f.saldo), 100)
})

prueba("con un abono parcial es Parcial", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
    p_due_date: "2099-01-01",
  })
  await db.rpc("create_payment", {
    p_client_id: ID.clienteUno,
    p_amount: "40.00",
    p_invoice_id: id,
  })
  const f = await estadoDe(db, id)
  assert.equal(f.estado, "Parcial")
  assert.equal(Number(f.saldo), 60)
})

prueba("pasada la fecha y sin cubrir es Vencida, con los días de atraso", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
    p_date: "2026-01-01",
    p_due_date: "2026-01-31",
  })
  const f = await estadoDe(db, id)
  assert.equal(f.estado, "Vencida")
  assert.ok(f.dias_vencida > 0, "no contó los días de atraso")
})

prueba("VENCIDA Y PAGADA es Pagada: el orden de los casos importa", async (db) => {
  // Si «Vencida» se evaluara antes que «Pagada», una factura cobrada tarde
  // seguiría saliendo en la cartera vencida y se le reclamaría a un cliente que
  // ya pagó.
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
    p_date: "2026-01-01",
    p_due_date: "2026-01-31",
  })
  await db.rpc("create_payment", {
    p_client_id: ID.clienteUno,
    p_amount: "100.00",
    p_invoice_id: id,
  })
  assert.equal((await estadoDe(db, id)).estado, "Pagada")
})

prueba("una factura sin vencimiento nunca es Vencida", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteDos, // de contado: payment_terms 0
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
    p_due_date: null,
  })
  const f = await estadoDe(db, id)
  assert.notEqual(f.estado, "Vencida")
  assert.equal(f.dias_vencida, 0)
})

prueba("la vista respeta RLS: no enseña las facturas de otra cuenta", async (db) => {
  // security_invoker = true. Sin eso la vista correría como su dueño, que está
  // exento de RLS, y enseñaría las facturas de todos a todos.
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
  })
  await db.comoAutenticado()
  const mias = await db.valor("select count(*)::int from public.invoice_listado")
  assert.ok(mias > 0)

  await db.uid(BETO)
  assert.equal(
    await db.valor("select count(*)::int from public.invoice_listado"),
    0,
    "Beto ve facturas de Ana en la vista"
  )
  await db.comoDueno()
})

/* ------------------------------------------------ totales de cabecera --- */

prueba("totales_facturas cuenta por estado sobre TODO el libro", async (db) => {
  const antes = await db.rpc("totales_facturas")
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "draft",
  })
  const despues = await db.rpc("totales_facturas")

  assert.equal(despues.documentos, antes.documentos + 1)
  assert.equal(despues.por_estado.Borrador, antes.por_estado.Borrador + 1)
})

prueba("el saldo pendiente NO cuenta los borradores", async (db) => {
  const antes = await db.rpc("totales_facturas")
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "999.00")],
    p_status: "draft",
  })
  const despues = await db.rpc("totales_facturas")
  assert.equal(
    Number(despues.saldo_pendiente),
    Number(antes.saldo_pendiente),
    "un borrador entró al saldo pendiente"
  )
})

prueba("totales_productos no valúa en cero los SKU sin costo: los cuenta aparte", async (db) => {
  // Valuarlos en cero subestimaría el inventario en silencio, que es el mismo
  // error que hacía que un producto sin costo reportara 100% de margen.
  //
  // Corre COMO AUTENTICADO a propósito. La función es `security invoker`, así
  // que su alcance lo pone RLS; llamándola como dueño de las tablas —que está
  // exento— sumaría también el inventario de Beto y la prueba compararía dos
  // cosas distintas. Eso mismo pasó al escribirla: 3200 contra 3150, que son
  // exactamente las 50 unidades del producto de la otra cuenta.
  await db.comoAutenticado()
  const t = await db.rpc("totales_productos")
  assert.ok(t.sin_costo >= 1, "no está contando los SKU sin costo")

  const aMano = await db.valor(
    "select coalesce(sum(stock * cost_price) filter (where cost_price is not null), 0)::text from public.product"
  )
  assert.equal(Number(t.valor_inventario), Number(aMano))
  await db.comoDueno()
})

prueba("y los agregados SÍ están acotados por cuenta", async (db) => {
  // El contrapunto de arriba: si `security invoker` se cambiara por definer,
  // cada empresa vería el inventario y la cartera de todas las demás.
  await db.comoAutenticado()
  const deAna = await db.rpc("totales_productos")
  await db.uid(BETO)
  const deBeto = await db.rpc("totales_productos")
  await db.comoDueno()

  assert.notEqual(deAna.skus, deBeto.skus, "las dos cuentas ven el mismo catálogo")
  assert.ok(deBeto.skus >= 1 && deBeto.skus < deAna.skus)
})

prueba("totales_clientes suma la cartera", async (db) => {
  const antes = await db.rpc("totales_clientes")
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "250.00")],
    p_status: "active",
  })
  const despues = await db.rpc("totales_clientes")
  assert.equal(Number(despues.por_cobrar), Number(antes.por_cobrar) + 250)
})

prueba("totales_entradas separa lo recibido de lo que viene en camino", async (db) => {
  const antes = await db.rpc("totales_entradas")
  const id = await db.rpc("create_purchase", {
    p_entry_no: "ENT-VISTA-1",
    p_lines: [{ type: "product", product_id: ID.caja12, qty_unit: 10, cost_unit: "2.00" }],
  })
  let t = await db.rpc("totales_entradas")
  assert.equal(t.pendientes, antes.pendientes + 1)
  assert.equal(Number(t.costo_recibido), Number(antes.costo_recibido), "una entrada abierta contó como recibida")

  await db.rpc("close_purchase", { p_purchase_id: id })
  t = await db.rpc("totales_entradas")
  assert.equal(t.pendientes, antes.pendientes)
  assert.equal(Number(t.costo_recibido), Number(antes.costo_recibido) + 20)
})

/* ------------------------------------------------------ el tablero ------ */

const VENTANA = {
  p_desde: "2026-01-01",
  p_hasta: "2027-01-01",
  p_desde_prev: "2025-01-01",
  p_hasta_prev: "2026-01-01",
  p_periodo: "anio",
}

prueba("el tablero rechaza un periodo que no conoce", async (db) => {
  await db.falla(
    () => db.rpc("resumen_dashboard", { ...VENTANA, p_periodo: "trimestre" }),
    /periodo inválido/
  )
})

prueba("un borrador no entra en lo facturado", async (db) => {
  const antes = await db.rpc("resumen_dashboard", VENTANA)
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "500.00")],
    p_status: "draft",
    p_date: "2026-06-01",
  })
  const despues = await db.rpc("resumen_dashboard", VENTANA)
  assert.equal(despues.num_facturas, antes.num_facturas, "contó un borrador")
})

prueba("un cargo suma al total pero NO al margen ni a los más vendidos", async (db) => {
  // El margen se calcula sobre renglones de PRODUCTO, que son los únicos que
  // tienen costo. Meter un cargo ahí inflaría el margen con dinero sin costo.
  const antes = await db.rpc("resumen_dashboard", VENTANA)
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Flete", "400.00")],
    p_status: "active",
    p_date: "2026-06-01",
  })
  const despues = await db.rpc("resumen_dashboard", VENTANA)

  assert.equal(despues.num_facturas, antes.num_facturas + 1)
  assert.equal(
    Number(despues.margen.ingreso),
    Number(antes.margen.ingreso),
    "un cargo entró al margen"
  )
})

prueba("un SKU sin costo se excluye del margen pero sí aparece en lo más vendido", async (db) => {
  const antes = await db.rpc("resumen_dashboard", VENTANA)
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.sinCosto, 5, "9.00")],
    p_status: "active",
    p_date: "2026-06-01",
  })
  const despues = await db.rpc("resumen_dashboard", VENTANA)

  assert.equal(
    Number(despues.margen.ingreso),
    Number(antes.margen.ingreso),
    "un renglón sin costo entró al margen y lo empujaría hacia 100%"
  )
  assert.equal(despues.margen.sin_costo, antes.margen.sin_costo + 1, "no lo contó aparte")
  assert.ok(
    despues.top.some((t) => t.sku === "SINCOSTO"),
    "no aparece en lo más vendido, donde sí debería"
  )
})

prueba("el margen suma ingreso y costo de los renglones con costo", async (db) => {
  const antes = await db.rpc("resumen_dashboard", VENTANA)
  // CAJA-12 cuesta 2.00 y se vende aquí a 5.00; 10 unidades.
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 10, "5.00")],
    p_status: "active",
    p_date: "2026-06-01",
  })
  const despues = await db.rpc("resumen_dashboard", VENTANA)
  assert.equal(Number(despues.margen.ingreso), Number(antes.margen.ingreso) + 50)
  assert.equal(Number(despues.margen.costo), Number(antes.margen.costo) + 20)
})

prueba("el dinero del tablero viaja como TEXTO, no como número", async (db) => {
  // En JSON un numeric se volvería double y 12480.50 puede volver como
  // 12480.499999999998. El frontend lo envuelve en Big y suma exacto.
  const r = await db.rpc("resumen_dashboard", VENTANA)
  assert.equal(typeof r.cobrado, "string", "cobrado viajó como número")
  assert.equal(typeof r.margen.ingreso, "string")
  assert.equal(typeof r.inventario.valor, "string")
  // Los conteos sí son números.
  assert.equal(typeof r.num_facturas, "number")
  assert.equal(typeof r.margen.sin_costo, "number")
})

prueba("la antigüedad reparte por tramos y cuenta TODO lo pendiente, no solo el periodo", async (db) => {
  // Lo que se debe se debe aunque la factura sea de hace ocho meses.
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "700.00")],
    p_status: "active",
    p_date: "2025-03-01", // fuera de la ventana actual
    p_due_date: "2025-03-31",
  })
  const r = await db.rpc("resumen_dashboard", VENTANA)
  const masDe60 = r.antiguedad.find((e) => e.i === 3)
  assert.ok(masDe60, "no hay tramo de +60 días")
  assert.ok(Number(masDe60.v) >= 700, "la factura vieja no entró a la antigüedad")
  assert.ok(id)
})
