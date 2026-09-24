import { prueba, assert, ID, linea, cargo, miscelaneo } from "./ayuda.mjs"

/**
 * EL MOTOR DE EXISTENCIAS
 *
 * functions.sql declara su propia invariante en la cabecera: una factura tiene
 * una HUELLA —sus cantidades de producto cuando está activa o cerrada, y nada
 * cuando es borrador— y toda operación es mover esa huella de un estado a otro
 * y aplicar la diferencia.
 *
 * Esa tabla de transiciones es exactamente lo que se prueba aquí, caso por
 * caso. Es la parte del sistema donde un error no se nota: el inventario queda
 * mal por dos unidades y nadie lo ve hasta que alguien cuenta el almacén.
 */

/* --------------------------------------------------- crear y no crear -- */

prueba("un borrador no reserva nada", async (db) => {
  const antes = await db.stock(ID.caja12)
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 30)],
    p_status: "draft",
  })
  assert.equal(await db.stock(ID.caja12), antes, "un borrador movió existencia")
})

prueba("una factura activa descuenta al crearse", async (db) => {
  const antes = await db.stock(ID.caja12)
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 30)],
    p_status: "active",
  })
  assert.equal(await db.stock(ID.caja12), antes - 30)
})

prueba("los cargos y los misceláneos son dinero, no mercancía", async (db) => {
  const antes = await db.stock(ID.caja12)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Flete marítimo", 250), miscelaneo("Muestra sin SKU", 5, 20)],
    p_status: "active",
  })
  assert.equal(await db.stock(ID.caja12), antes, "un cargo movió existencia")
  // Pero SÍ cuentan en el total: 250 + 5×20
  assert.equal(await db.total(id), 350)
})

/* ------------------------------------------------------------- editar -- */

prueba("subir la cantidad descuenta solo la DIFERENCIA", async (db) => {
  const antes = await db.stock(ID.caja12)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 3)],
    p_status: "active",
  })
  assert.equal(await db.stock(ID.caja12), antes - 3)

  await db.rpc("update_invoice", { p_invoice_id: id, p_lines: [linea(ID.caja12, 5)] })
  // −5 en total, no −8: si se descontara el nuevo valor entero, cada edición
  // iría comiendo inventario que nunca salió del almacén.
  assert.equal(await db.stock(ID.caja12), antes - 5)
})

prueba("bajar la cantidad devuelve la diferencia", async (db) => {
  const antes = await db.stock(ID.caja12)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 5)],
    p_status: "active",
  })
  await db.rpc("update_invoice", { p_invoice_id: id, p_lines: [linea(ID.caja12, 1)] })
  assert.equal(await db.stock(ID.caja12), antes - 1)
})

prueba("quitar el renglón devuelve todo", async (db) => {
  const antes = await db.stock(ID.caja12)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 40)],
    p_status: "active",
  })
  await db.rpc("update_invoice", { p_invoice_id: id, p_lines: [cargo("Solo flete", 100)] })
  assert.equal(await db.stock(ID.caja12), antes)
})

prueba("editar un borrador no toca nada, por mucho que cambien las cantidades", async (db) => {
  const antes = await db.stock(ID.caja12)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 10)],
    p_status: "draft",
  })
  await db.rpc("update_invoice", { p_invoice_id: id, p_lines: [linea(ID.caja12, 900)] })
  assert.equal(await db.stock(ID.caja12), antes)
})

/* ---------------------------------------------------------- de estado -- */

prueba("emitir un borrador descuenta; devolverlo a borrador reintegra", async (db) => {
  const antes = await db.stock(ID.caja12)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 25)],
    p_status: "draft",
  })
  assert.equal(await db.stock(ID.caja12), antes)

  await db.rpc("set_invoice_status", { p_invoice_id: id, p_status: "active" })
  assert.equal(await db.stock(ID.caja12), antes - 25, "emitir no descontó")

  await db.rpc("set_invoice_status", { p_invoice_id: id, p_status: "draft" })
  assert.equal(await db.stock(ID.caja12), antes, "volver a borrador no reintegró")
})

prueba("de activa a cerrada no mueve nada: la huella es la misma", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 12)],
    p_status: "active",
  })
  const conActiva = await db.stock(ID.caja12)
  await db.rpc("set_invoice_status", { p_invoice_id: id, p_status: "closed" })
  assert.equal(await db.stock(ID.caja12), conActiva)
})

prueba("editar líneas Y emitir a la vez descuenta lo NUEVO, no la diferencia", async (db) => {
  // El comentario de update_invoice avisa de esto: si la huella vieja se leyera
  // después del cambio de estado, contaría como ya reservadas unas unidades que
  // nunca salieron, y descontaría de menos.
  const antes = await db.stock(ID.caja12)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 3)],
    p_status: "draft",
  })
  await db.rpc("update_invoice", {
    p_invoice_id: id,
    p_lines: [linea(ID.caja12, 10)],
    p_status: "active",
  })
  assert.equal(await db.stock(ID.caja12), antes - 10, "descontó 7 en vez de 10")
})

/* ------------------------------------------------------------ borrar -- */

prueba("borrar una activa devuelve la existencia", async (db) => {
  const antes = await db.stock(ID.caja12)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 60)],
    p_status: "active",
  })
  await db.rpc("delete_invoice", { p_invoice_id: id })
  assert.equal(await db.stock(ID.caja12), antes)
})

prueba("borrar un borrador no devuelve nada, porque no había tomado nada", async (db) => {
  const antes = await db.stock(ID.caja12)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 60)],
    p_status: "draft",
  })
  await db.rpc("delete_invoice", { p_invoice_id: id })
  assert.equal(await db.stock(ID.caja12), antes)
})

/* ---------------------------------------------- una cerrada está congelada */

prueba("una factura cerrada no se edita, no cambia de estado y no se borra", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 5)],
    p_status: "closed",
  })

  await db.falla(
    () => db.rpc("update_invoice", { p_invoice_id: id, p_lines: [linea(ID.caja12, 9)] }),
    /closed and cannot be edited/
  )
  await db.falla(
    () => db.rpc("set_invoice_status", { p_invoice_id: id, p_status: "draft" }),
    /closed and cannot change status/
  )
  await db.falla(() => db.rpc("delete_invoice", { p_invoice_id: id }), /closed and cannot be deleted/)
})

prueba("reopen_invoice es la única puerta de salida, y solo desde cerrada", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.caja12, 5)],
    p_status: "active",
  })
  await db.falla(() => db.rpc("reopen_invoice", { p_invoice_id: id }), /only a closed invoice/)

  await db.rpc("set_invoice_status", { p_invoice_id: id, p_status: "closed" })
  const conCerrada = await db.stock(ID.caja12)
  await db.rpc("reopen_invoice", { p_invoice_id: id })

  assert.equal(await db.valor("select status from public.invoice where id = $1", [id]), "active")
  // Reabrir no mueve existencia: cerrada y activa tienen la misma huella.
  assert.equal(await db.stock(ID.caja12), conCerrada)
})

/* ------------------------------------------------- no hay existencia -- */

prueba("no se puede facturar más de lo que hay", async (db) => {
  const hay = await db.stock(ID.caja12)
  await db.falla(
    () =>
      db.rpc("create_invoice", {
        p_client_id: ID.clienteUno,
        p_lines: [linea(ID.caja12, hay + 1)],
        p_status: "active",
      }),
    /existencia insuficiente/
  )
  assert.equal(await db.stock(ID.caja12), hay, "falló pero dejó existencia movida")
})

prueba("el mensaje usa las cifras que la persona está viendo, no el delta interno", async (db) => {
  // El comentario de apply_stock_delta explica por qué: editar de 50 a 250 pide
  // un delta de 200, pero la persona escribió 250 y ve 100 en pantalla.
  // Reportar «faltan 200» no coincide con ningún número de su pantalla.
  const hay = await db.stock(ID.suelto) // 500
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.suelto, 50)],
    p_status: "active",
  })

  const e = await db.falla(
    () => db.rpc("update_invoice", { p_invoice_id: id, p_lines: [linea(ID.suelto, hay + 100)] }),
    /existencia insuficiente/
  )
  // Pide lo que escribió…
  assert.match(e.message, new RegExp(`pides ${hay + 100}\\b`), e.message)
  // …y lo disponible incluye lo que este mismo documento ya tenía reservado.
  assert.match(e.message, new RegExp(`disponible ${hay}\\b`), e.message)
  assert.match(e.message, /ya reservados por este documento/)
})

prueba("devolver existencia nunca falla, aunque el producto esté en cero", async (db) => {
  const hay = await db.stock(ID.suelto)
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [linea(ID.suelto, hay)],
    p_status: "active",
  })
  assert.equal(await db.stock(ID.suelto), 0)
  await db.rpc("delete_invoice", { p_invoice_id: id })
  assert.equal(await db.stock(ID.suelto), hay)
})

/* ------------------------------------------------------------ compras -- */

prueba("una compra abierta no ha llegado: no suma existencia", async (db) => {
  const antes = await db.stock(ID.caja12)
  await db.rpc("create_purchase", {
    p_entry_no: "ENT-PRUEBA-1",
    p_lines: [{ type: "product", product_id: ID.caja12, qty_unit: 500, cost_unit: "2.00" }],
  })
  assert.equal(await db.stock(ID.caja12), antes)
})

prueba("cerrar la compra suma la existencia UNA vez", async (db) => {
  const antes = await db.stock(ID.caja12)
  const id = await db.rpc("create_purchase", {
    p_entry_no: "ENT-PRUEBA-2",
    p_lines: [{ type: "product", product_id: ID.caja12, qty_unit: 500, cost_unit: "2.00" }],
  })
  await db.rpc("close_purchase", { p_purchase_id: id })
  assert.equal(await db.stock(ID.caja12), antes + 500)

  // Y no se puede volver a cerrar para sumar otra vez.
  await db.falla(() => db.rpc("close_purchase", { p_purchase_id: id }), /already closed/)
})

prueba("una compra cerrada ya no se edita", async (db) => {
  const id = await db.rpc("create_purchase", {
    p_entry_no: "ENT-PRUEBA-3",
    p_lines: [{ type: "product", product_id: ID.caja12, qty_unit: 10, cost_unit: "2.00" }],
  })
  await db.rpc("close_purchase", { p_purchase_id: id })
  await db.falla(
    () =>
      db.rpc("update_purchase", {
        p_purchase_id: id,
        p_lines: [{ type: "product", product_id: ID.caja12, qty_unit: 99, cost_unit: "2.00" }],
      }),
    /closed and cannot be edited/
  )
})

/* -------------------------------------------------------- ajustes ------ */

prueba("un ajuste suma y otro resta", async (db) => {
  const antes = await db.stock(ID.suelto)
  await db.rpc("create_adjustment", {
    p_product_id: ID.suelto,
    p_type: "add",
    p_qty: 10,
    p_description: "conteo",
  })
  assert.equal(await db.stock(ID.suelto), antes + 10)

  await db.rpc("create_adjustment", {
    p_product_id: ID.suelto,
    p_type: "remove",
    p_qty: 4,
    p_description: "rotura",
  })
  assert.equal(await db.stock(ID.suelto), antes + 6)
})

prueba("un ajuste no puede dejar la existencia en negativo", async (db) => {
  const hay = await db.stock(ID.suelto)
  await db.falla(
    () => db.rpc("create_adjustment", { p_product_id: ID.suelto, p_type: "remove", p_qty: hay + 1 }),
    /existencia insuficiente/
  )
  assert.equal(await db.stock(ID.suelto), hay)
})

prueba("un ajuste exige un tipo y una cantidad con sentido", async (db) => {
  await db.falla(
    () => db.rpc("create_adjustment", { p_product_id: ID.suelto, p_type: "quitar", p_qty: 1 }),
    /type must be add or remove/
  )
  await db.falla(
    () => db.rpc("create_adjustment", { p_product_id: ID.suelto, p_type: "add", p_qty: 0 }),
    /qty must be a positive number/
  )
})
