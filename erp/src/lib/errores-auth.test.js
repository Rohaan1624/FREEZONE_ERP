import { test } from "node:test"
import assert from "node:assert/strict"

import { traducirError } from "./errores-auth.js"

/* ================================================================== *
 * LOS DOS LÍMITES DE 429 NO DURAN LO MISMO
 * ================================================================== *
 * Era un solo caso que decía «espera un minuto» para cualquier 429, y con
 * el tope de correos del proyecto —2 por hora— eso manda a la persona a
 * reintentar cinco veces y concluir que el registro está roto.
 *
 * Un mensaje que da la espera equivocada es peor que no dar ninguna: la
 * primera hace perder el tiempo con confianza.
 */

test("el tope de correos del PROYECTO dice una hora, no un minuto", () => {
  for (const m of [
    "email rate limit exceeded",
    "over_email_send_rate_limit",
    "Email rate limit exceeded for this project",
  ]) {
    const r = traducirError(m)
    assert.match(r, /una hora/, `«${m}» no menciona la hora: ${r}`)
    assert.doesNotMatch(r, /un minuto/, `«${m}» sigue diciendo un minuto: ${r}`)
  }
})

test("el freno por dirección sí es de un minuto", () => {
  assert.match(traducirError("For security purposes, you can only do this once"), /un minuto/)
})

test("si Supabase dice cuántos segundos faltan, se repite ESE número", () => {
  // Vale más que cualquier texto propio: es la espera real que queda.
  assert.match(
    traducirError("For security purposes, you can only request this after 47 seconds."),
    /47 segundos/
  )
  assert.match(traducirError("you can only request this after 1 second"), /1 segundo\b/)
})

test("la espera exacta gana sobre el mensaje genérico", () => {
  // Los dos textos traen «rate limit»; el orden de los casos es el que decide.
  const r = traducirError("Request rate limit reached, try again after 12 seconds")
  assert.match(r, /12 segundos/, `cayó en el genérico: ${r}`)
})

test("cualquier otro 429 no promete una espera que no conoce", () => {
  const r = traducirError("Too many requests")
  assert.match(r, /Demasiados intentos/)
  assert.doesNotMatch(r, /\d+ segundos|una hora/, `inventó una espera: ${r}`)
})

/* ---------------------------------------------------------- contraseña -- */

test("el mínimo de contraseña se lee del mensaje, no se escribe a mano", () => {
  // El ajuste vive en el panel de Supabase; repetir un 6 aquí deja de ser
  // cierto en cuanto alguien lo sube y nadie se acuerda de este archivo.
  assert.match(traducirError("Password should be at least 6 characters"), /al menos 6/)
  assert.match(traducirError("Password should be at least 12 characters"), /al menos 12/)
})

test("una contraseña rechazada por otra regla no inventa un número", () => {
  const r = traducirError("Password should contain at least one symbol")
  assert.doesNotMatch(r, /\d+ caracteres/, `se inventó un mínimo: ${r}`)
})

/* --------------------------------------------------------------- resto -- */

test("los errores de sesión y de alta se traducen", () => {
  assert.match(traducirError("Invalid login credentials"), /incorrectos/)
  assert.match(traducirError("Email not confirmed"), /Confirma tu correo/)
  assert.match(traducirError("User already registered"), /ya tiene una cuenta/)
  assert.match(traducirError("Signups not allowed for this instance"), /cerrados/)
  assert.match(traducirError("Unable to validate email address: invalid format"), /no parece válido/)
})

test("un fallo del SMTP se dice sin culpar a quien se registra", () => {
  const r = traducirError("Error sending confirmation email")
  assert.match(r, /No pudimos enviar/)
  assert.doesNotMatch(r, /SMTP|Error sending/, `deja el mensaje técnico en pantalla: ${r}`)
})

test("lo que no se reconoce se deja pasar tal cual, no se esconde", () => {
  // Tragarse un error desconocido detrás de un «algo salió mal» es como se
  // pierde la única pista que había.
  assert.equal(traducirError("Weird new Supabase error"), "Weird new Supabase error")
})

test("null o vacío no truenan", () => {
  for (const v of [null, undefined, ""]) assert.equal(typeof traducirError(v), "string")
})
