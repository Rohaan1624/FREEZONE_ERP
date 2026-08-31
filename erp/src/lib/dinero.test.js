import { test } from "node:test"
import assert from "node:assert/strict"

import { M, sumar, usd, centavos } from "./dinero.js"

/**
 * La trampa que costó un bug real en la lista de facturas: el saldo pendiente
 * se mostraba $0.00 teniendo dos facturas abiertas.
 *
 * Big.valueOf() devuelve un STRING, así que `0 + Big` no suma: concatena. El
 * acumulador se convierte en "07480.55140.25", M() no puede leer dos puntos
 * decimales y cae a 0 — sin lanzar nada, que es lo que lo hizo invisible.
 */
test("sumar() suma Bigs; el + de JavaScript los concatena", () => {
  const saldos = [M("7480.50"), M("5140.25")]

  // Lo que hacía el código viejo.
  const roto = saldos.reduce((t, s) => t + s, 0)
  assert.equal(typeof roto, "string")
  assert.equal(roto, "07480.55140.25")
  assert.equal(usd(roto), "$0.00") // el síntoma exacto que se veía en pantalla

  // Lo que hay que usar.
  assert.equal(sumar(saldos).toFixed(2), "12620.75")
  assert.equal(usd(sumar(saldos)), "$12,620.75")
})

test("sumar() con selector sobre objetos", () => {
  const facturas = [{ est: { saldo: M("7480.50") } }, { est: { saldo: M("5140.25") } }]
  assert.equal(usd(sumar(facturas, (f) => f.est.saldo)), "$12,620.75")
})

test("comparar un Big contra un número sí funciona", () => {
  // `<` fuerza valueOf a string y JavaScript lo reconvierte a número para la
  // comparación relacional, así que esto nunca estuvo roto — pero .lt() dice
  // lo que quiere decir y no depende de esa cadena de coerciones.
  assert.equal(M("7480.50") < 0.01, false)
  assert.equal(M("0") < 0.01, true)
  assert.equal(M("7480.50").lt(0.01), false)
  assert.equal(M("0").lt(0.01), true)
})

test("sumar() de una lista vacía es 0, no NaN ni ''", () => {
  assert.equal(sumar([]).toFixed(2), "0.00")
  assert.equal(usd(sumar([])), "$0.00")
})

test("centavos redondea half-up, como Postgres numeric", () => {
  assert.equal(centavos("1.005").toFixed(2), "1.01")
  assert.equal(centavos("2.675").toFixed(2), "2.68")
})

test("M() convierte basura a 0 en lugar de NaN", () => {
  for (const v of [null, undefined, "", "abc", "-", ".", "07480.55140.25"]) {
    assert.equal(M(v).toFixed(2), "0.00", `M(${JSON.stringify(v)})`)
  }
})
