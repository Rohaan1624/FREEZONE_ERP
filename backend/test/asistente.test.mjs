import { prueba, assert, ANA, BETO } from "./ayuda.mjs"

/**
 * EL CUPO DEL ASISTENTE
 *
 * Es lo único del sistema que le pone freno a un coste externo: sin esto,
 * cualquiera con sesión puede vaciar la cuota de Groq de toda la empresa en una
 * tarde.
 *
 * Por eso el contador vive en Postgres y no en el navegador ni en la Edge
 * Function: es el único sitio donde comprobar-y-sumar puede ser atómico, y el
 * único que el cliente no puede mentir.
 */

const limite = async (db, cual) => (await db.rpc("asistente_limites"))[cual]

prueba("los límites salen de un solo sitio", async (db) => {
  // Estuvieron duplicados entre consumir() y cupo(), y se desincronizaron: la
  // cabecera decía que quedaban consultas y el servidor las rechazaba.
  const l = await db.rpc("asistente_limites")
  assert.equal(typeof l.hora, "number")
  assert.equal(typeof l.dia, "number")
  assert.ok(l.hora > 0 && l.dia >= l.hora)
  assert.ok(l.zona, "sin zona horaria no se puede prometer «se reinicia mañana»")
})

prueba("consultar el cupo NO lo gasta", async (db) => {
  // Se llama al pintar la pantalla; si gastara, abrir el asistente sin
  // preguntar nada ya te costaría una consulta.
  const antes = await db.rpc("asistente_cupo")
  await db.rpc("asistente_cupo")
  await db.rpc("asistente_cupo")
  const despues = await db.rpc("asistente_cupo")
  assert.equal(despues.restantes_hora, antes.restantes_hora)
  assert.equal(despues.restantes_dia, antes.restantes_dia)
})

prueba("cada consumo descuenta uno", async (db) => {
  const antes = await db.rpc("asistente_cupo")
  const r = await db.rpc("asistente_consumir")
  assert.equal(r.permitido, true)
  assert.equal(r.restantes_hora, antes.restantes_hora - 1)

  const despues = await db.rpc("asistente_cupo")
  assert.equal(despues.restantes_hora, antes.restantes_hora - 1, "cupo y consumir no coinciden")
})

prueba("al llegar al tope de la hora deja de permitir, y dice por qué", async (db) => {
  const porHora = await limite(db, "hora")
  for (let i = 0; i < porHora; i++) {
    const r = await db.rpc("asistente_consumir")
    assert.equal(r.permitido, true, `rechazó en la consulta ${i + 1} de ${porHora}`)
  }

  const extra = await db.rpc("asistente_consumir")
  assert.equal(extra.permitido, false)
  assert.equal(extra.restantes_hora, 0)
  assert.ok(extra.motivo, "rechaza sin decir por qué")
})

prueba("rechazar NO sigue sumando al contador", async (db) => {
  // Si el rechazo incrementara igual, alguien que insiste se quedaría sin cupo
  // del día sin haber recibido una sola respuesta.
  const porHora = await limite(db, "hora")
  for (let i = 0; i < porHora; i++) await db.rpc("asistente_consumir")

  const primerRechazo = await db.rpc("asistente_consumir")
  await db.rpc("asistente_consumir")
  await db.rpc("asistente_consumir")
  const ultimo = await db.rpc("asistente_cupo")

  assert.equal(primerRechazo.permitido, false)
  assert.equal(
    ultimo.restantes_dia,
    (await db.rpc("asistente_cupo")).restantes_dia,
    "los intentos rechazados siguieron gastando el cupo del día"
  )
  assert.ok(ultimo.restantes_dia > 0, "los rechazos se comieron el cupo diario")
})

prueba("el cupo es POR PERSONA, no compartido", async (db) => {
  await db.rpc("asistente_consumir")
  const deAna = await db.rpc("asistente_cupo")

  await db.uid(BETO)
  const deBeto = await db.rpc("asistente_cupo")

  assert.ok(
    deBeto.restantes_hora > deAna.restantes_hora,
    "el consumo de Ana le descontó a Beto"
  )
})

prueba("sin sesión no se consume nada", async (db) => {
  await db.uid(null)
  await db.falla(() => db.rpc("asistente_consumir"), /not authenticated|null/i)
})

prueba("el contador se guarda por día y hora de la zona del negocio", async (db) => {
  // Con UTC el cupo diario se reiniciaría a las 7 de la tarde hora de Panamá, y
  // el mensaje «se reinicia mañana» sería mentira.
  await db.rpc("asistente_consumir")
  const zona = await limite(db, "zona")
  const fila = await db.uno(
    `select dia::text, hora, consultas from public.asistente_uso
      where user_id = $1 order by dia desc, hora desc limit 1`,
    [ANA]
  )
  const esperado = await db.uno(
    `select (now() at time zone $1)::date::text as dia,
            extract(hour from (now() at time zone $1))::int as hora`,
    [zona]
  )
  assert.equal(fila.dia, esperado.dia)
  assert.equal(fila.hora, esperado.hora)
  assert.ok(fila.consultas >= 1)
})

/* ---------------------------------------------------- el uso es privado -- */

prueba("cada quien ve solo su propio uso", async (db) => {
  await db.rpc("asistente_consumir")
  await db.comoAutenticado()
  assert.ok(
    (await db.valor("select count(*)::int from public.asistente_uso")) > 0,
    "Ana no ve su propio uso"
  )

  await db.uid(BETO)
  assert.equal(
    await db.valor("select count(*)::int from public.asistente_uso"),
    0,
    "Beto ve el uso de Ana"
  )
  await db.comoDueno()
})

prueba("el contador no se puede tocar a mano desde el navegador", async (db) => {
  // Si se pudiera, el límite sería decorativo: bastaría un update para
  // resetearlo y seguir gastando la cuota de Groq de la empresa.
  await db.rpc("asistente_consumir")
  await db.comoAutenticado()

  await db.falla(
    () => db.sql("update public.asistente_uso set consultas = 0 where user_id = $1", [ANA]),
    /permission denied/i
  )
  await db.falla(
    () =>
      db.sql(
        "insert into public.asistente_uso (user_id, dia, hora, consultas) values ($1, current_date, 0, -999)",
        [ANA]
      ),
    /permission denied/i
  )
  await db.falla(
    () => db.sql("delete from public.asistente_uso where user_id = $1", [ANA]),
    /permission denied/i
  )
  await db.comoDueno()
})
