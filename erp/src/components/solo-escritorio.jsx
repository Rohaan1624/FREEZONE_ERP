import * as React from "react"
import { Monitor } from "lucide-react"

/**
 * El muro de «ábrelo en una computadora».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN MURO Y NO UNA VERSIÓN APRETADA
 * ─────────────────────────────────────────────────────────────────────────────
 * La app hoy no cabe en un teléfono, y no de forma cosmética: el shell tiene
 * `overflow-hidden`, así que lo que se sale del ancho NO SE PUEDE ALCANZAR ni
 * arrastrando. En la lista de facturas eso deja fuera el total, el saldo y el
 * estado. Además el encabezado y el riel de pestañas se comen 520 de los 844
 * píxeles de una pantalla típica antes de que empiece el contenido.
 *
 * Dejarla entrar «a ver qué tal» es peor que cerrarla: alguien capturaría una
 * factura viendo media pantalla y creyendo que la vio entera. Un muro honesto
 * cuesta una pantalla; una factura mal capturada cuesta una devolución.
 *
 * Es temporal. Cuando la app sea responsive de verdad —tarjetas en vez de
 * tablas, barra inferior, escala de texto móvil— esto se borra entero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SE MIDE EL ANCHO, NO EL USER-AGENT
 * ─────────────────────────────────────────────────────────────────────────────
 * El user-agent miente y hay que mantenerlo. El ancho es el problema real: una
 * ventana de escritorio estrecha sufre exactamente lo mismo que un teléfono, y
 * al ensancharla el muro desaparece solo.
 */

// Por debajo de esto la lista de facturas ya recorta columnas. Coincide con el
// breakpoint `md` de Tailwind, que es donde el resto de la app cambia de forma.
const MINIMO = 768

export function useEsAngosto(minimo = MINIMO) {
  const consulta = () =>
    typeof window !== "undefined" && window.matchMedia(`(max-width: ${minimo - 1}px)`).matches

  const [angosto, setAngosto] = React.useState(consulta)

  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${minimo - 1}px)`)
    // El evento «change», no un listener de resize: matchMedia solo dispara al
    // CRUZAR el umbral, así que no re-renderiza en cada píxel del arrastre.
    // El valor de arranque ya lo puso el inicializador de useState, así que
    // aquí no hace falta un setState extra.
    const alCambiar = (e) => setAngosto(e.matches)
    mq.addEventListener("change", alCambiar)
    return () => mq.removeEventListener("change", alCambiar)
  }, [minimo])

  return angosto
}

export function SoloEscritorio({ children }) {
  const angosto = useEsAngosto()
  if (!angosto) return children

  return (
    // `print:hidden` no basta: si alguien imprime desde una ventana angosta,
    // hay que esconder el muro Y enseñar el documento. Por eso el muro se
    // oculta al imprimir y los hijos se siguen montando debajo.
    <>
      <div className="fixed inset-0 z-50 grid place-items-center bg-paper px-6 text-ink print:hidden">
        <div className="w-full max-w-[34ch] text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-ink text-paper">
            <Monitor className="size-6" />
          </div>
          <h1 className="mt-5 mb-0 text-[24px] leading-tight font-semibold">
            Ábrelo en una computadora
          </h1>
          <p className="mt-3 mb-0 text-[15px] leading-snug text-balance text-neutral-700">
            Todavía no cabe en un teléfono: las tablas de facturas y productos se recortan y no se
            pueden desplazar. Estamos en ello.
          </p>
          <p className="mt-5 mb-0 text-[13px] leading-snug text-balance text-neutral-600">
            Si estás en una computadora, ensancha la ventana y esta pantalla desaparece sola.
          </p>
        </div>
      </div>
      {/* Montados pero tapados: así imprimir desde el móvil sigue funcionando. */}
      <div className="hidden print:block">{children}</div>
    </>
  )
}
