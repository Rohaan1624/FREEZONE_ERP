import { test as nodeTest } from "node:test"
import assert from "node:assert/strict"
import pg from "pg"

import { URL_BASE, ANA, BETO } from "./preparar.mjs"

/**
 * El arnés: una prueba = una transacción que SIEMPRE se deshace.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ROLLBACK Y NO LIMPIEZA A MANO
 * ─────────────────────────────────────────────────────────────────────────────
 * Estas pruebas mueven existencias y saldos. Si una revienta a la mitad y deja
 * una factura activa, la siguiente arranca con el inventario movido y falla por
 * un motivo que no es el suyo — y entonces se persigue el fallo equivocado.
 *
 * Con la transacción deshecha no hay estado que arrastrar, no hay orden de
 * ejecución que importe, y no hay código de limpieza que se pueda olvidar de
 * una tabla nueva.
 *
 * Una conexión por prueba, no un pool compartido: `set local` y los bloqueos
 * `for update` son de la sesión, así que compartirla haría que una prueba
 * viera lo que otra tiene a medias.
 */

export { assert, ANA, BETO }

/** Un uuid fijo y legible, para que un fallo diga «…-1111» y no un hexadecimal. */
export const ID = {
  clienteUno: "c1111111-1111-1111-1111-111111111111",
  clienteDos: "c2222222-2222-2222-2222-222222222222",
  clienteBeto: "c3333333-3333-3333-3333-333333333333",
  caja12: "91111111-1111-1111-1111-111111111111",
  suelto: "92222222-2222-2222-2222-222222222222",
  sinCosto: "93333333-3333-3333-3333-333333333333",
  deBeto: "94444444-4444-4444-4444-444444444444",
}

/**
 * Envuelve una prueba en su transacción.
 *
 * Dentro, `db` expone lo justo para leerse como una frase:
 *   db.uid(BETO)                 cambia de usuario a media transacción
 *   db.rpc("create_invoice", …)  llama una función por nombre
 *   db.uno("select …")           una fila
 *   db.valor("select …")         un solo dato
 *   db.falla(fn, /texto/)        exige que reviente, y con qué mensaje
 */
export function prueba(nombre, fn) {
  nodeTest(nombre, async () => {
    const cliente = new pg.Client({ connectionString: URL_BASE })
    await cliente.connect()
    try {
      await cliente.query("begin")
      const db = creaApi(cliente)
      await db.uid(ANA) // por defecto se es Ana; quien pruebe aislamiento cambia
      await fn(db)
    } finally {
      // Siempre. Incluso —sobre todo— si la prueba falló.
      await cliente.query("rollback").catch(() => {})
      await cliente.end().catch(() => {})
    }
  })
}

function creaApi(cliente) {
  const api = {
    cliente,

    /** Quién dice ser la sesión. Es lo que leen todas las RPC vía auth.uid(). */
    async uid(quien) {
      // set_config con local=true: se deshace con la transacción, igual que el
      // resto de la prueba.
      await cliente.query("select set_config('prueba.uid', $1, true)", [quien])
    },

    /** Actúa como el rol `authenticated`, con RLS activa, hasta el rollback. */
    async comoAutenticado() {
      await cliente.query("set local role authenticated")
    },
    async comoDueno() {
      await cliente.query("reset role")
    },

    async sql(texto, params = []) {
      const r = await cliente.query(texto, params)
      return r.rows
    },

    async uno(texto, params = []) {
      const filas = await api.sql(texto, params)
      return filas[0] ?? null
    },

    async valor(texto, params = []) {
      const fila = await api.uno(texto, params)
      return fila ? Object.values(fila)[0] : null
    },

    /**
     * Llama una RPC con parámetros NOMBRADOS.
     *
     * Con posicionales, añadir un parámetro en medio de la firma rompería en
     * silencio todas las llamadas de las pruebas; así falla con el nombre que
     * no existe, que es un error que se lee.
     */
    async rpc(fn, args = {}) {
      const nombres = Object.keys(args)
      const lista = nombres.map((n, i) => `${n} => $${i + 1}`).join(", ")
      const valores = nombres.map((n) => {
        const v = args[n]
        // jsonb y arreglos viajan como texto; node-postgres no adivina el tipo
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v
      })
      const r = await cliente.query(`select public.${fn}(${lista}) as r`, valores)
      return r.rows[0]?.r ?? null
    },

    /** La existencia actual de un producto. */
    stock: (id) => api.valor("select stock from public.product where id = $1", [id]),

    /** El saldo actual de un cliente. */
    saldo: (id) =>
      api.valor("select balance::text from public.client where id = $1", [id]).then(Number),

    /** El total de una factura. */
    total: (id) =>
      api.valor("select total::text from public.invoice where id = $1", [id]).then(Number),

    /**
     * Exige que algo reviente, y que el mensaje diga lo que debe decir.
     *
     * Comprobar solo «falló» deja pasar que falle por el motivo equivocado —
     * una restricción de clave foránea en vez de la validación que se quería.
     *
     * OJO: tras un error, Postgres aborta la transacción. Se abre un savepoint
     * antes y se vuelve a él después, para que la prueba pueda seguir
     * comprobando cosas.
     */
    async falla(accion, comoDice) {
      await cliente.query("savepoint antes_del_fallo")
      let error = null
      try {
        await accion()
      } catch (e) {
        error = e
      }
      await cliente.query("rollback to savepoint antes_del_fallo")

      assert.ok(error, "se esperaba un error y no hubo ninguno")
      if (comoDice) {
        assert.match(
          error.message,
          comoDice,
          `falló, pero por otro motivo: ${error.message}`
        )
      }
      return error
    },
  }
  return api
}

/* ------------------------------------------------------------- atajos --- */

/** Una línea de producto para p_lines. */
export const linea = (product_id, qty, unit_price = 10, extra = {}) => ({
  type: "product",
  product_id,
  qty,
  unit_price: String(unit_price),
  ...extra,
})

/** Una línea de cargo: dinero, no mercancía. */
export const cargo = (description, monto) => ({
  type: "charge",
  description,
  qty: 1,
  unit_price: String(monto),
})

/** Una línea suelta que no es del catálogo. */
export const miscelaneo = (description, qty, monto) => ({
  type: "miscellaneous",
  description,
  qty,
  unit_price: String(monto),
})
