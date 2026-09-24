/**
 * Interruptores de funciones que se encienden por entorno.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL ASISTENTE ESTÁ APAGADO
 * ─────────────────────────────────────────────────────────────────────────────
 * No es por el código —funciona y tiene sus pruebas— sino por la cuota. El plan
 * gratuito de Groq da ~200.000 tokens al día POR ORGANIZACIÓN, no por cuenta, y
 * cada pregunta gasta unos 2.100 entre el prompt y el hilo. Eso son unas 93
 * preguntas diarias repartidas entre TODOS los inquilinos.
 *
 * Con una sola empresa usándolo eso alcanza. En cuanto se abra el registro, el
 * segundo cliente que pregunte algo le quita el cupo al primero, y los dos ven
 * «el asistente está saturado» sin entender por qué. Un límite por persona no
 * arregla eso: el techo es de la organización.
 *
 * Se vuelve a encender cuando haya plan de pago o un tope diario por cuenta
 * derivado del presupuesto real, no inventado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTO NO ES UNA PUERTA CON LLAVE
 * ─────────────────────────────────────────────────────────────────────────────
 * Esconder la ruta quita el acceso normal, pero cualquiera con sesión puede
 * llamar a la Edge Function directamente. El cierre de verdad está allá: la
 * función responde 503 si no existe su propio interruptor
 * (ASISTENTE_ACTIVO en los secretos de Supabase). Aquí solo se evita enseñar
 * una pestaña que va a fallar.
 *
 * Las VITE_* se resuelven al COMPILAR, así que cambiar esto exige reconstruir.
 */

export const ASISTENTE_ACTIVO = import.meta.env.VITE_ASISTENTE === "1"
