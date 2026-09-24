import { prueba, assert, ID, linea, cargo, miscelaneo } from "./ayuda.mjs"

/**
 * TOTALES Y SALDOS
 *
 * `invoice.total` y `client.balance` son DERIVACIONES: dada la misma base hay
 * una sola respuesta correcta. Lo que se prueba aquí es que no se desvíen —
 * que ningún camino de escritura se olvide de recalcularlas.
 *
 * Es el tipo de error que no revienta: el saldo queda mal por un abono y se
 * descubre cuando alguien reclama que ya pagó.
 */

/* ------------------------------------------------- el total de la factura */

prueba("el total suma productos, cargos y misceláneos", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [
      linea(ID.caja12, 10, "5.00"), //  50.00
      cargo("Flete", "120.50"), // 120.50
      miscelaneo("Empaque", 3, "4.25"), //  12.75
    ],
    p_status: "active",
  })
  assert.equal(await db.total(id), 183.25)
})

prueba("editar los renglones recalcula el total", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 10, "5.00")],
    p_status: "active",
  })
  assert.equal(await db.total(id), 50)

  await db.rpc("update_invoice", { p_invoice_id: id, p_lines: [linea(ID.caja12, 3, "5.00")] })
  assert.equal(await db.total(id), 15)
})

prueba("los centavos no se pierden: el total es numeric, no coma flotante", async (db) => {
  // 3 × 0.10 en coma flotante da 0.30000000000000004.
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("a", "0.10"), cargo("b", "0.10"), cargo("c", "0.10")],
    p_status: "active",
  })
  assert.equal(await db.valor("select total::text from public.invoice where id = $1", [id]), "0.30")
})

/* ----------------------------------------------------- el saldo del cliente */

prueba("un borrador no debe nada", async (db) => {
  const antes = await db.saldo(ID.clienteUno)
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "500.00")],
    p_status: "draft",
  })
  assert.equal(await db.saldo(ID.clienteUno), antes, "un borrador movió el saldo")
})

prueba("emitir la factura sube el saldo; volverla a borrador lo baja", async (db) => {
  const antes = await db.saldo(ID.clienteUno)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "500.00")],
    p_status: "draft",
  })
  await db.rpc("set_invoice_status", { p_invoice_id: id, p_status: "active" })
  assert.equal(await db.saldo(ID.clienteUno), antes + 500)

  await db.rpc("set_invoice_status", { p_invoice_id: id, p_status: "draft" })
  assert.equal(await db.saldo(ID.clienteUno), antes)
})

prueba("un abono baja el saldo y borrarlo lo devuelve", async (db) => {
  const antes = await db.saldo(ID.clienteUno)
  const factura = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "1000.00")],
    p_status: "active",
  })
  assert.equal(await db.saldo(ID.clienteUno), antes + 1000)

  const pago = await db.rpc("create_payment", {
    p_client_id: ID.clienteUno,
    p_amount: "400.00",
    p_invoice_id: factura,
  })
  assert.equal(await db.saldo(ID.clienteUno), antes + 600)

  await db.rpc("delete_payment", { p_payment_id: pago })
  assert.equal(await db.saldo(ID.clienteUno), antes + 1000)
})

prueba("cambiar una factura de cliente recalcula los DOS saldos", async (db) => {
  const uno = await db.saldo(ID.clienteUno)
  const dos = await db.saldo(ID.clienteDos)

  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "300.00")],
    p_status: "active",
  })
  assert.equal(await db.saldo(ID.clienteUno), uno + 300)

  await db.rpc("update_invoice", {
    p_invoice_id: id,
    p_lines: [cargo("Servicio", "300.00")],
    p_client_id: ID.clienteDos,
  })
  // Recalcular solo el nuevo dejaría al primero debiendo algo que ya no es suyo.
  assert.equal(await db.saldo(ID.clienteUno), uno, "el cliente viejo se quedó con la deuda")
  assert.equal(await db.saldo(ID.clienteDos), dos + 300)
})

prueba("borrar la factura quita la deuda", async (db) => {
  const antes = await db.saldo(ID.clienteUno)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "250.00")],
    p_status: "active",
  })
  await db.rpc("delete_invoice", { p_invoice_id: id })
  assert.equal(await db.saldo(ID.clienteUno), antes)
})

prueba("editar el importe de una factura emitida mueve el saldo", async (db) => {
  const antes = await db.saldo(ID.clienteUno)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
  })
  await db.rpc("update_invoice", { p_invoice_id: id, p_lines: [cargo("Servicio", "175.00")] })
  assert.equal(await db.saldo(ID.clienteUno), antes + 175)
})

prueba("un sobrepago deja el SALDO en negativo, pero el de la factura se recorta a cero", async (db) => {
  // La diferencia es deliberada y conviene fijarla: a nivel de CLIENTE un
  // sobrepago es saldo a favor y tiene que verse; a nivel de FACTURA una deuda
  // negativa no significa nada, así que la vista lo recorta.
  const antes = await db.saldo(ID.clienteUno)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
  })
  await db.rpc("create_payment", {
    p_client_id: ID.clienteUno,
    p_amount: "150.00",
    p_invoice_id: id,
  })

  assert.equal(await db.saldo(ID.clienteUno), antes - 50, "el saldo a favor se perdió")
  const f = await db.uno(
    "select saldo::text, estado from public.invoice_listado where id = $1",
    [id]
  )
  // Por valor y no por texto: `greatest(numeric, 0)` devuelve un 0 sin escala
  // («0», no «0.00»). Es indistinto —el frontend lo formatea igual— y fijar la
  // escala aquí probaría un detalle de presentación de Postgres, no la regla.
  assert.equal(Number(f.saldo), 0, "la factura reporta deuda negativa")
  assert.equal(f.estado, "Pagada")
})

/* ------------------------------------------------------ validaciones ----- */

prueba("un abono tiene que ser positivo", async (db) => {
  for (const monto of ["0", "-10.00"]) {
    await db.falla(
      () => db.rpc("create_payment", { p_client_id: ID.clienteUno, p_amount: monto }),
      /payment amount must be positive/
    )
  }
})

prueba("un abono no puede apuntar a la factura de otro cliente", async (db) => {
  const deUno = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "100.00")],
    p_status: "active",
  })
  await db.falla(
    () =>
      db.rpc("create_payment", {
        p_client_id: ID.clienteDos,
        p_amount: "50.00",
        p_invoice_id: deUno,
      }),
    /does not belong to client/
  )
})

prueba("editar un abono recalcula el saldo", async (db) => {
  const antes = await db.saldo(ID.clienteUno)
  const factura = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "500.00")],
    p_status: "active",
  })
  const pago = await db.rpc("create_payment", {
    p_client_id: ID.clienteUno,
    p_amount: "100.00",
    p_invoice_id: factura,
  })
  assert.equal(await db.saldo(ID.clienteUno), antes + 400)

  await db.rpc("update_payment", { p_payment_id: pago, p_amount: "300.00" })
  assert.equal(await db.saldo(ID.clienteUno), antes + 200)
})

prueba("el total de una factura sin renglones es cero, no nulo", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [],
    p_status: "draft",
  })
  assert.equal(await db.total(id), 0)
})
