import { prueba, assert, ID, cargo } from "./ayuda.mjs"

/**
 * EL DOCUMENTO: folio, fechas y lo que se imprime
 *
 * Nada de esto mueve existencias ni dinero, pero es lo que sale en el papel que
 * recibe el cliente — y un folio repetido o una fecha corrida rompen la
 * contabilidad igual de bien que un total mal sumado.
 */

/* --------------------------------------------------------------- folio -- */

prueba("el folio se asigna solo, con prefijo y relleno a cinco dígitos", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
  })
  const num = await db.valor("select invoice_num from public.invoice where id = $1", [id])
  assert.match(num, /^INV-\d{5}$/, `folio inesperado: ${num}`)
})

prueba("dos facturas seguidas no repiten folio", async (db) => {
  const a = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("A", "1.00")],
    p_status: "draft",
  })
  const b = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("B", "1.00")],
    p_status: "draft",
  })
  const [na, nb] = await Promise.all([
    db.valor("select invoice_num from public.invoice where id = $1", [a]),
    db.valor("select invoice_num from public.invoice where id = $1", [b]),
  ])
  assert.notEqual(na, nb)
})

prueba("un folio dado a mano se respeta tal cual", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_invoice_num: "MANUAL-7",
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
  })
  assert.equal(await db.valor("select invoice_num from public.invoice where id = $1", [id]), "MANUAL-7")
})

prueba("un folio vacío o en blanco cuenta como no dado", async (db) => {
  for (const folio of ["", "   "]) {
    const id = await db.rpc("create_invoice", {
      p_client_id: ID.clienteUno,
      p_invoice_num: folio,
      p_lines: [cargo("Servicio", "10.00")],
      p_status: "draft",
    })
    const num = await db.valor("select invoice_num from public.invoice where id = $1", [id])
    assert.match(num, /^INV-\d{5}$/, `un folio en blanco no se autoasignó: ${num}`)
  }
})

prueba("el mismo folio no se puede usar dos veces en la misma cuenta", async (db) => {
  await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_invoice_num: "REPE-1",
    p_lines: [cargo("A", "1.00")],
    p_status: "draft",
  })
  await db.falla(
    () =>
      db.rpc("create_invoice", {
        p_client_id: ID.clienteUno,
        p_invoice_num: "REPE-1",
        p_lines: [cargo("B", "1.00")],
        p_status: "draft",
      }),
    /duplicate key|invoice_user_num_key/i
  )
})

/* --------------------------------------------------------------- fechas -- */

prueba("sin fecha, la factura es de hoy", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
  })
  const dia = await db.valor(
    "select date_created::date = current_date as hoy from public.invoice where id = $1",
    [id]
  )
  assert.equal(dia, true)
})

prueba("se puede antedatar", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
    p_date: "2026-05-15",
  })
  assert.equal(
    await db.valor("select date_created::date::text from public.invoice where id = $1", [id]),
    "2026-05-15"
  )
})

prueba("pero NO se puede adelantar", async (db) => {
  // Una fecha futura casi siempre es un dedazo del CSV (2062 por 2026), y
  // dejaría la factura fuera de todo reporte de periodo sin que nadie lo note.
  await db.falla(
    () =>
      db.rpc("create_invoice", {
        p_client_id: ID.clienteUno,
        p_lines: [cargo("Servicio", "10.00")],
        p_status: "draft",
        p_date: "2099-01-01",
      }),
    /no puede ser futura/
  )
})

prueba("el vencimiento se cuenta desde la EMISIÓN, no desde hoy", async (db) => {
  // Cliente Uno es a 30 días. Importar una factura de mayo tiene que vencer en
  // junio, no treinta días después del día del cambio de sistema — si no, entra
  // clasificada como vigente llevando meses vencida.
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "active",
    p_date: "2026-05-01",
  })
  assert.equal(
    await db.valor("select due_date::text from public.invoice where id = $1", [id]),
    "2026-05-31"
  )
})

prueba("un vencimiento explícito gana sobre los días del cliente", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "active",
    p_due_date: "2026-12-25",
  })
  assert.equal(
    await db.valor("select due_date::text from public.invoice where id = $1", [id]),
    "2026-12-25"
  )
})

prueba("un abono tampoco puede tener fecha futura", async (db) => {
  await db.falla(
    () =>
      db.rpc("create_payment", {
        p_client_id: ID.clienteUno,
        p_amount: "10.00",
        p_date: "2099-01-01",
      }),
    /no puede ser futura/
  )
})

/* ------------------------------------------- lo que se imprime (bill_to) -- */

prueba("el nombre y la dirección alternos se guardan al crear", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
    p_doc: {
      bill_to_name: "SUCURSAL COLÓN, S.A.",
      bill_to_address: "Calle 14, Local 27",
      bill_to_country: "Panamá",
    },
  })
  const f = await db.uno(
    "select bill_to_name, bill_to_address, bill_to_country, client_name from public.invoice where id = $1",
    [id]
  )
  assert.equal(f.bill_to_name, "SUCURSAL COLÓN, S.A.")
  assert.equal(f.bill_to_address, "Calle 14, Local 27")
  // Y el nombre REAL sigue congelado aparte: es lo que lee el buscador.
  assert.equal(f.client_name, "Cliente Uno")
})

prueba("mandar la clave VACÍA limpia el alterno y devuelve el del cliente", async (db) => {
  // Esta es la razón de que bill_to_* use `p_doc ? clave` en vez del `coalesce`
  // de los campos de embarque: quien se equivoque escribiendo la razón social
  // tiene que poder deshacerlo.
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
    p_doc: { bill_to_name: "ME EQUIVOQUÉ, S.A." },
  })

  await db.rpc("update_invoice", {
    p_invoice_id: id,
    p_lines: [cargo("Servicio", "10.00")],
    p_doc: { bill_to_name: "" },
  })
  assert.equal(
    await db.valor("select bill_to_name from public.invoice where id = $1", [id]),
    null,
    "no se pudo borrar el nombre alterno"
  )
})

prueba("omitir la clave no toca lo que ya había", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
    p_doc: { bill_to_name: "SUCURSAL", bill_to_address: "Calle 14" },
  })
  // Un formulario parcial que solo manda «marks» no debe borrar lo demás.
  await db.rpc("update_invoice", {
    p_invoice_id: id,
    p_lines: [cargo("Servicio", "10.00")],
    p_doc: { marks: "S/M" },
  })
  const f = await db.uno(
    "select bill_to_name, bill_to_address, marks from public.invoice where id = $1",
    [id]
  )
  assert.equal(f.bill_to_name, "SUCURSAL")
  assert.equal(f.bill_to_address, "Calle 14")
  assert.equal(f.marks, "S/M")
})

prueba("los campos de EMBARQUE también se pueden borrar", async (db) => {
  // Antes no se podía: usaban `coalesce(nullif(x,''), columna)`, así que vaciar
  // el campo mandaba '', nullif lo volvía NULL y el coalesce restauraba el
  // valor viejo. Un vendedor mal escrito quedaba pegado al documento para
  // siempre, sin forma de quitarlo desde la aplicación.
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
    p_doc: { salesperson: "R. Díaz", marks: "S/M" },
  })
  await db.rpc("update_invoice", {
    p_invoice_id: id,
    p_lines: [cargo("Servicio", "10.00")],
    p_doc: { salesperson: "" }, // marks no viaja: no debe tocarse
  })
  const f = await db.uno(
    "select salesperson, marks from public.invoice where id = $1",
    [id]
  )
  assert.equal(f.salesperson, null, "no se pudo borrar el vendedor")
  assert.equal(f.marks, "S/M", "borró un campo que ni siquiera se mandó")
})

/* --------------------------------------------- la dirección congelada -- */

prueba("la dirección y el país del cliente se congelan al emitir", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "active",
  })
  const f = await db.uno(
    "select client_address, client_country from public.invoice where id = $1",
    [id]
  )
  assert.equal(f.client_address, "Calle 1, Local 1")
  assert.equal(f.client_country, "Panamá")
})

prueba("si el cliente se muda, la factura vieja NO cambia", async (db) => {
  // Este era el fallo: la impresión leía client.address en vivo, así que una
  // mudanza reescribía el domicilio de todas las facturas históricas.
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "active",
  })
  await db.sql("update public.client set address = 'Se mudó, Calle 99' where id = $1", [
    ID.clienteUno,
  ])

  assert.equal(
    await db.valor("select client_address from public.invoice where id = $1", [id]),
    "Calle 1, Local 1",
    "la mudanza reescribió una factura ya emitida"
  )
})

prueba("cambiar la factura de cliente vuelve a congelar la dirección del nuevo", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
  })
  await db.rpc("update_invoice", {
    p_invoice_id: id,
    p_lines: [cargo("Servicio", "10.00")],
    p_client_id: ID.clienteDos,
  })
  const f = await db.uno(
    "select client_name, client_address from public.invoice where id = $1",
    [id]
  )
  assert.equal(f.client_name, "Cliente Dos")
  assert.equal(
    f.client_address,
    "Calle 2, Local 2",
    "quedó el domicilio de un cliente que ya no tiene que ver con el documento"
  )
})

prueba("el congelado y el alterno son cosas distintas y no se pisan", async (db) => {
  // El formulario manda las claves vacías cuando el campo está en blanco. Si
  // el alterno y el congelado compartieran columna, cada guardado borraría el
  // congelado y la factura volvería a seguir al cliente vivo.
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
    p_doc: { bill_to_address: "Calle 14, Local 27" },
  })
  await db.rpc("update_invoice", {
    p_invoice_id: id,
    p_lines: [cargo("Servicio", "10.00")],
    p_doc: { bill_to_address: "" }, // se quita el alterno
  })
  const f = await db.uno(
    "select bill_to_address, client_address from public.invoice where id = $1",
    [id]
  )
  assert.equal(f.bill_to_address, null, "el alterno no se quitó")
  assert.equal(f.client_address, "Calle 1, Local 1", "quitar el alterno borró el congelado")
})

prueba("una clave desconocida en p_doc se ignora sin reventar", async (db) => {
  // Fue un fallo real: el navegador mandaba bill_to_* a un RPC que todavía no
  // las conocía, la llamada respondía bien y el dato se perdía en silencio.
  // Que no reviente es correcto; lo que hacía falta era la prueba.
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
    p_doc: { clave_que_no_existe: "x", marks: "S/M" },
  })
  assert.equal(await db.valor("select marks from public.invoice where id = $1", [id]), "S/M")
})

prueba("cambiar de cliente vuelve a congelar el nombre real", async (db) => {
  const id = await db.rpc("create_invoice", {
    p_client_id: ID.clienteUno,
    p_lines: [cargo("Servicio", "10.00")],
    p_status: "draft",
  })
  assert.equal(
    await db.valor("select client_name from public.invoice where id = $1", [id]),
    "Cliente Uno"
  )

  await db.rpc("update_invoice", {
    p_invoice_id: id,
    p_lines: [cargo("Servicio", "10.00")],
    p_client_id: ID.clienteDos,
  })
  assert.equal(
    await db.valor("select client_name from public.invoice where id = $1", [id]),
    "Cliente Dos"
  )
})

/* ----------------------------------------------------------- validación -- */

prueba("un estado inválido se rechaza", async (db) => {
  await db.falla(
    () =>
      db.rpc("create_invoice", {
        p_client_id: ID.clienteUno,
        p_lines: [],
        p_status: "pagada",
      }),
    /invalid status/
  )
})

prueba("p_lines tiene que ser un arreglo", async (db) => {
  await db.falla(
    () =>
      db.rpc("create_invoice", {
        p_client_id: ID.clienteUno,
        p_lines: { type: "charge" },
        p_status: "draft",
      }),
    /must be a JSON array/
  )
})
