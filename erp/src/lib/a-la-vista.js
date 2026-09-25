import * as React from "react"

/**
 * Lleva un formulario a la vista cada vez que se abre para otro registro.
 *
 * En las listas el panel de edición vive ARRIBA. Quien pulsa «editar» en un
 * renglón de abajo no lo ve abrirse y no sabe qué está editando. `autoFocus`
 * no basta: solo actúa al montar, así que si el panel ya estaba abierto y se
 * pulsa editar en otro renglón, nada se mueve.
 *
 * `clave` identifica QUÉ se edita (el id, o "nuevo"); con null el panel está
 * cerrado. El efecto corre al cambiar la clave, no con cada tecla.
 */
export function useALaVista(clave) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const el = ref.current
    if (clave == null || !el) return
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" })
    // preventScroll: el desplazamiento ya lo hace scrollIntoView, suave; el
    // foco por su cuenta saltaría de golpe.
    el.querySelector("input, select, textarea")?.focus({ preventScroll: true })
  }, [clave])
  return ref
}
