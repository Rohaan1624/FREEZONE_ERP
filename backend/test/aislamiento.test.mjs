import { prueba, assert, ID, ANA, BETO, linea, cargo } from "./ayuda.mjs"

/**
 * QUE UNA CUENTA NO PUEDA TOCAR LA DE OTRA
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTO NO ES UNA PRUEBA DE FUNCIONALIDAD, ES LA PRUEBA DE SEGURIDAD
 * ─────────────────────────────────────────────────────────────────────────────
 * Las RPC son SECURITY DEFINER, o sea que RLS NO SE APLICA dentro de ellas.
 * Lo único que separa a un inquilino de otro son los filtros `user_id = v_uid`
 * escritos a mano en cada función. No hay red debajo: si a una consulta se le
 * olvida ese filtro, la función entrega o modifica datos ajenos y nada avisa.
 *
 * Por eso `auth.uid()` lee un GUC en estas pruebas — para poder cambiar de
 * usuario a media transacción y pedirle a Beto que intente tocar lo de Ana.
 *
 * La segunda mitad prueba lo otro: RLS sobre las tablas, que es lo que protege
 * el acceso DIRECTO desde PostgREST, sin pasar por ninguna función.
 */

/* ------------------------------------------- a través de las funciones --- */

prueba("no se factura a un cliente de otra cuenta", async (db) => {
  await db.uid(BETO)
  await db.falla(
    () =>
      db.rpc("create_invoice", {
        p_client_id: ID.clienteUno, // es de Ana
        p_lines: [cargo("Servicio", "100.00")],
        p_status: "draft",
      }),
    /client .* not found/
  )
})

prueba("no se pone el producto de otra cuenta en un renglón", async (db) => {
  await db.uid(BETO)
  await db.falla(
    () =>
      db.rpc("create_invoice", {
        p_client_id: ID.clienteBeto,
        p_lines: [linea(ID.caja12, 1)], // el producto es de Ana
        p_status: "draft",
      }),
    /product .* not found/
  )
})

prueba("no se edita ni se borra la factura de otra cuenta", async (db) => {
  const deAna = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
  })

  await db.uid(BETO)
  await db.falla(
    () => db.rpc("update_invoice", { p_invoice_id: deAna, p_lines: [cargo("Otro", "1.00")] }),
    /invoice .* not found/
  )
  await db.falla(() => db.rpc("delete_invoice", { p_invoice_id: deAna }), /invoice .* not found/)
  await db.falla(
    () => db.rpc("set_invoice_status", { p_invoice_id: deAna, p_status: "draft" }),
    /invoice .* not found/
  )

  // Y sigue intacta.
  await db.uid(ANA)
  assert.equal(await db.total(deAna), 100)
  assert.equal(await db.valor("select status from public.invoice where id = $1", [deAna]), "active")
})

prueba("no se abona a la cuenta de otro", async (db) => {
  await db.uid(BETO)
  await db.falla(
    () => db.rpc("create_payment", { p_client_id: ID.clienteUno, p_amount: "10.00" }),
    /client .* not found/
  )
})

prueba("no se ajusta la existencia de un producto ajeno", async (db) => {
  const antes = await db.stock(ID.caja12)
  await db.uid(BETO)
  await db.falla(
    () => db.rpc("create_adjustment", { p_product_id: ID.caja12, p_type: "remove", p_qty: 5 }),
    /product .* not found/
  )
  await db.uid(ANA)
  assert.equal(await db.stock(ID.caja12), antes)
})

prueba("no se recibe una compra ajena", async (db) => {
  const deAna = await db.rpc("create_purchase", {
    p_entry_no: "ENT-AISLA-1",
    p_lines: [{ type: "product", product_id: ID.caja12, qty_unit: 100, cost_unit: "2.00" }],
  })
  const antes = await db.stock(ID.caja12)

  await db.uid(BETO)
  await db.falla(() => db.rpc("close_purchase", { p_purchase_id: deAna }), /purchase .* not found/)

  await db.uid(ANA)
  assert.equal(await db.stock(ID.caja12), antes, "la compra ajena sumó existencia")
})

prueba("sin sesión no se puede hacer nada", async (db) => {
  await db.uid(null)
  for (const [fn, args] of [
    ["create_invoice", { p_client_id: ID.clienteUno, p_lines: [], p_status: "draft" }],
    ["create_payment", { p_client_id: ID.clienteUno, p_amount: "1.00" }],
    ["create_adjustment", { p_product_id: ID.suelto, p_type: "add", p_qty: 1 }],
    ["create_purchase", { p_entry_no: "X", p_lines: [] }],
  ]) {
    await db.falla(() => db.rpc(fn, args), /not authenticated/)
  }
})

prueba("el folio se asigna del contador de QUIEN factura", async (db) => {
  // El contador vive en `company`, una fila por cuenta. Si la consulta no
  // filtrara por user_id, dos empresas se repartirían la misma numeración.
  const deAna = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("A", "1.00")],
    p_status: "draft",
  })
  await db.uid(BETO)
  const deBeto = await db.rpc("create_invoice", {
    p_client_id: ID.clienteBeto,
    p_lines: [cargo("B", "1.00")],
    p_status: "draft",
  })

  const folios = await db.sql(
    "select id, invoice_num, user_id from public.invoice where id = any($1)",
    [[deAna, deBeto]]
  )
  const ana = folios.find((f) => f.id === deAna)
  const beto = folios.find((f) => f.id === deBeto)
  assert.equal(ana.user_id, ANA)
  assert.equal(beto.user_id, BETO)
  // Cada cuenta arranca su propia numeración, así que los dos son el primero.
  assert.equal(ana.invoice_num, beto.invoice_num, "las dos cuentas deben numerar por separado")
})

/* ------------------------------------------------ RLS sobre las tablas --- */
// Esto protege el acceso DIRECTO desde PostgREST, sin función de por medio.

prueba("con RLS activa, cada cuenta solo ve lo suyo", async (db) => {
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
  })

  await db.comoAutenticado()
  const deAna = await db.valor("select count(*)::int from public.invoice")
  assert.ok(deAna > 0, "Ana no ve sus propias facturas")

  await db.uid(BETO)
  const deBeto = await db.valor("select count(*)::int from public.invoice")
  assert.equal(deBeto, 0, "Beto ve facturas de Ana")

  await db.comoDueno()
})

prueba("invoice no tiene política de escritura: no se puede insertar a mano", async (db) => {
  // La tabla es de solo lectura para la aplicación; se escribe únicamente por
  // create_invoice / update_invoice. Sin esto, el navegador podría saltarse
  // toda la comprobación de existencias insertando renglones directamente.
  await db.comoAutenticado()
  await db.falla(
    () =>
      db.sql(
        `insert into public.invoice (invoice_num, client_id, user_id, status)
         values ('HACK-1', $1, $2, 'active')`,
        [ID.clienteUno, ANA]
      ),
    /row-level security|permission denied/i
  )
  await db.comoDueno()
})

prueba("las columnas derivadas están revocadas aunque la tabla sí se pueda escribir", async (db) => {
  // client y product SÍ tienen políticas de escritura, pero policy.sql revoca
  // las columnas que solo deben moverse por documento. Un update directo a
  // `stock` o a `balance` se saltaría el motor de existencias entero.
  await db.comoAutenticado()
  await db.falla(
    () => db.sql("update public.product set stock = 999999 where id = $1", [ID.caja12]),
    /permission denied/i
  )
  await db.falla(
    () => db.sql("update public.client set balance = 0 where id = $1", [ID.clienteUno]),
    /permission denied/i
  )
  await db.comoDueno()
})

prueba("pero las columnas normales sí se pueden editar", async (db) => {
  // El contrapunto del anterior: si la revocación fuera demasiado amplia, la
  // aplicación no podría ni renombrar un cliente y parecería un bug de RLS.
  await db.comoAutenticado()
  await db.sql("update public.client set name = 'Renombrado' where id = $1", [ID.clienteUno])
  assert.equal(
    await db.valor("select name from public.client where id = $1", [ID.clienteUno]),
    "Renombrado"
  )
  await db.comoDueno()
})
