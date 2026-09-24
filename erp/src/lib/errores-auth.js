/**
 * Los errores de Supabase Auth, dichos en español y con la salida correcta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UN MENSAJE QUE DA LA ESPERA EQUIVOCADA ES PEOR QUE NO DAR NINGUNA
 * ─────────────────────────────────────────────────────────────────────────────
 * Esto vivía dentro de auth.jsx y metía TODOS los 429 en el mismo saco:
 * «espera un minuto». Son dos límites distintos y solo uno dura un minuto.
 *
 *   · Por dirección: 60 segundos entre peticiones al mismo correo.
 *   · Por proyecto:  2 correos POR HORA con el SMTP que trae Supabase, y ese
 *                    no se puede subir desde el panel.
 *
 * Decirle «espera un minuto» a alguien que topó con el segundo lo manda a
 * reintentar cinco veces, fallar cinco veces y concluir que el registro está
 * roto. La espera real es una hora.
 *
 * Está en su propio archivo, sin importar nada, para poder probarlo: auth.jsx
 * arrastra el cliente de Supabase, que revienta al importarse sin variables de
 * entorno. Y esto merece prueba precisamente porque el fallo no es que truene,
 * es que aconseje mal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PARA QUIEN ADMINISTRA EL PROYECTO
 * ─────────────────────────────────────────────────────────────────────────────
 * El tope de 2 correos por hora es del remitente de desarrollo de Supabase. La
 * salida es configurar SMTP propio en Authentication → SMTP Settings; ahí el
 * límite pasa a ser el que se ponga en Authentication → Rate Limits, y de paso
 * los correos salen del dominio propio en vez del compartido, que es la
 * diferencia entre llegar a la bandeja y llegar a no deseados.
 */

export function traducirError(mensaje) {
  const m = String(mensaje ?? "")

  /* --------------------------------------------------------- límites 429 -- */
  // Primero el que trae la espera EXACTA dentro del mensaje: si Supabase ya
  // dijo cuántos segundos faltan, repetirlo vale más que cualquier texto mío.
  const segundos = m.match(/after (\d+)\s*seconds?/i)
  if (segundos) {
    const n = Number(segundos[1])
    return `Espera ${n} ${n === 1 ? "segundo" : "segundos"} antes de volver a intentarlo.`
  }

  // El del PROYECTO. Va antes que el genérico porque también dice «rate
  // limit», y caer en el genérico es justo el error que se está arreglando.
  if (/email rate limit|over_email_send_rate_limit|email_send_rate_limit/i.test(m))
    return "No pudimos enviarte el correo: el envío llegó a su límite por hora. Vuelve a intentarlo dentro de una hora."

  if (/For security purposes/i.test(m))
    return "Espera un minuto antes de volver a intentarlo."

  if (/rate limit|too many requests|over_request_rate_limit/i.test(m))
    return "Demasiados intentos seguidos. Espera un momento y vuelve a intentarlo."

  /* ------------------------------------------------------------ sesión ---- */
  if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos."
  if (/Email not confirmed/i.test(m)) return "Confirma tu correo antes de entrar."
  if (/Auth session missing|session_not_found/i.test(m))
    return "El enlace expiró. Pide uno nuevo desde “¿Olvidaste tu contraseña?”."

  /* ---------------------------------------------------------- contraseña -- */
  // El mínimo lo decide el proyecto, así que se lee del propio mensaje en vez
  // de repetir un número que puede dejar de ser cierto al cambiar el ajuste.
  const minimo = m.match(/Password should be at least (\d+)/i)
  if (minimo) return `La contraseña debe tener al menos ${minimo[1]} caracteres.`
  if (/Password should be/i.test(m)) return "Esa contraseña no cumple los requisitos."
  if (/New password should be different/i.test(m))
    return "La contraseña nueva debe ser distinta de la anterior."

  /* -------------------------------------------------------------- alta ---- */
  if (/Signups not allowed/i.test(m))
    return "Los registros están cerrados. Pide a administración que cree tu cuenta."
  if (/User already registered/i.test(m))
    return "Ese correo ya tiene una cuenta. Entra con tu contraseña o recupérala."
  if (/Unable to validate email|invalid format|email address .* is invalid|invalid email/i.test(m))
    return "Ese correo no parece válido. Revísalo."

  /* -------------------------------------------------------------- correo -- */
  // Un fallo del SMTP no es culpa de quien se registra, y «Error sending
  // confirmation email» en inglés no le dice qué hacer.
  if (/Error sending|SMTP|failed to send/i.test(m))
    return "No pudimos enviar el correo. Inténtalo de nuevo en unos minutos."

  return m
}
