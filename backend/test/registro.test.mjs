import { prueba, assert } from "./ayuda.mjs"

/**
 * EL ALTA DE UNA CUENTA NUEVA
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE TRIGGER ES LO QUE CONVIERTE UN USUARIO EN UN INQUILINO
 * ─────────────────────────────────────────────────────────────────────────────
 * Al registrarse, Supabase inserta en auth.users y nada más. Lo que hace que
 * esa persona tenga una empresa —con su propia numeración de facturas, su
 * catálogo y su cartera— es handle_new_user.
 *
 * Si falla, el alta «funciona»: el correo llega, la contraseña sirve, se entra…
 * y la primera factura revienta con «no company row for this account», que no
 * le dice nada a nadie. Por eso se prueba aquí y no a mano.
 *
 * El formulario manda el nombre en `company_name` dentro de raw_user_meta_data.
 * Esa clave es un contrato entre el navegador y este trigger, y no hay nada que
 * lo verifique en medio: escribirla distinta no da error, solo deja a la
 * empresa llamándose «My Company».
 */

const nuevoUsuario = (db, id, meta) =>
  db.sql(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, $2, $3::jsonb)`,
    [id, `${id.slice(0, 8)}@alta.test`, JSON.stringify(meta)]
  )

const empresaDe = (db, id) =>
  db.uno(
    "select name, email, invoice_prefix, next_invoice_num from public.company where user_id = $1",
    [id]
  )

const ID_A = "d1111111-1111-1111-1111-111111111111"
const ID_B = "d2222222-2222-2222-2222-222222222222"

prueba("registrarse crea la empresa con el nombre que se escribió", async (db) => {
  await nuevoUsuario(db, ID_A, { company_name: "Mi Empresa, S.A." })
  const e = await empresaDe(db, ID_A)
  assert.ok(e, "no se creó la fila de company: el alta quedaría inservible")
  assert.equal(e.name, "Mi Empresa, S.A.")
})

prueba("el correo del alta queda en la empresa", async (db) => {
  await nuevoUsuario(db, ID_A, { company_name: "Mi Empresa, S.A." })
  const e = await empresaDe(db, ID_A)
  assert.equal(e.email, `${ID_A.slice(0, 8)}@alta.test`)
})

prueba("sin nombre, la empresa nace con uno por defecto y no en blanco", async (db) => {
  // company.name es NOT NULL, así que aquí no basta con «no pongas nada»: sin
  // el coalesce del trigger, el insert reventaría y el registro fallaría entero.
  for (const meta of [{}, { company_name: "" }, { company_name: "   " }]) {
    await db.sql("delete from public.company where user_id = $1", [ID_A])
    await db.sql("delete from auth.users where id = $1", [ID_A])
    await nuevoUsuario(db, ID_A, meta)
    const e = await empresaDe(db, ID_A)
    assert.ok(e, `el alta falló con ${JSON.stringify(meta)}`)
    assert.ok(e.name?.trim(), "la empresa nació sin nombre")
  }
})

prueba("cada cuenta arranca su propia numeración de facturas", async (db) => {
  // Es lo que de verdad significa «inquilino»: si el contador fuera compartido,
  // dos empresas se repartirían los folios y ninguna tendría su serie completa.
  await nuevoUsuario(db, ID_A, { company_name: "Empresa A" })
  await nuevoUsuario(db, ID_B, { company_name: "Empresa B" })
  const [a, b] = [await empresaDe(db, ID_A), await empresaDe(db, ID_B)]
  assert.equal(a.next_invoice_num, b.next_invoice_num, "no arrancan igual")
  assert.equal(a.invoice_prefix, b.invoice_prefix)
})

prueba("una cuenta nueva nace VACÍA: sin clientes, productos ni facturas", async (db) => {
  // Lo que garantiza que un registro nuevo no vea datos de otra empresa.
  await nuevoUsuario(db, ID_A, { company_name: "Empresa A" })
  await db.uid(ID_A)
  await db.comoAutenticado()
  for (const tabla of ["client", "product", "invoice", "purchase", "payments"]) {
    assert.equal(
      await db.valor(`select count(*)::int from public.${tabla}`),
      0,
      `una cuenta recién creada ve filas en ${tabla}`
    )
  }
  await db.comoDueno()
})

prueba("y puede facturar desde el primer minuto", async (db) => {
  // La prueba de que el alta dejó todo lo necesario: sin la fila de company,
  // create_invoice falla al repartir el folio.
  await nuevoUsuario(db, ID_A, { company_name: "Empresa A" })
  await db.uid(ID_A)

  const cliente = await db.valor(
    `insert into public.client (name, payment_terms, user_id)
     values ('Primer cliente', 0, $1) returning id`,
    [ID_A]
  )
  const factura = await db.rpc("create_invoice", {
    p_client_id: cliente,
    p_lines: [{ type: "charge", description: "Servicio", qty: 1, unit_price: "100.00" }],
    p_status: "active",
  })
  const f = await db.uno(
    "select invoice_num, client_name from public.invoice where id = $1",
    [factura]
  )
  assert.match(f.invoice_num, /^INV-\d{5}$/)
  assert.equal(f.client_name, "Primer cliente")
})

prueba("registrarse dos veces con el mismo id no duplica la empresa", async (db) => {
  // El trigger lleva `on conflict do nothing`. Sin eso, un reintento del alta
  // chocaría con company_user_id_key y el error saldría como un fallo de
  // registro inexplicable.
  await nuevoUsuario(db, ID_A, { company_name: "Empresa A" })
  await db.falla(
    () => nuevoUsuario(db, ID_A, { company_name: "Otra vez" }),
    /duplicate key|users_pkey/i
  )
  assert.equal(
    await db.valor("select count(*)::int from public.company where user_id = $1", [ID_A]),
    1
  )
})
