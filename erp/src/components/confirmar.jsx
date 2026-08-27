import * as React from "react"
import { TriangleAlert, X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Destructive-action confirmation.
 *
 * Built on the native <dialog> with showModal() rather than a hand-rolled
 * overlay: that gives a real focus trap, Escape-to-close, the top layer (so no
 * z-index fights with the stretched-link cards), and inert background content —
 * all of which a <div> overlay has to reimplement badly.
 *
 * The confirm button is never the autofocused one. Focus lands on Cancelar, so
 * a reflexive Enter after opening the dialog does nothing destructive.
 */
export function Confirmar({
  abierto,
  titulo,
  descripcion,
  detalles = [],
  textoConfirmar = "Eliminar",
  textoOcupado = "Eliminando…",
  ocupado = false,
  onConfirmar,
  onCancelar,
}) {
  const ref = React.useRef(null)

  // Syncing a React prop with an imperative DOM API — the legitimate use of an
  // effect. No setState here, so no cascading render.
  React.useEffect(() => {
    const d = ref.current
    if (!d) return
    if (abierto && !d.open) d.showModal()
    if (!abierto && d.open) d.close()
  }, [abierto])

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        // Escape. Let the parent own the state instead of the DOM closing
        // itself behind React's back.
        e.preventDefault()
        if (!ocupado) onCancelar?.()
      }}
      onClick={(e) => {
        // Clicking the backdrop: the dialog element itself is the backdrop
        // region, so a click landing on it (not on the card) means outside.
        if (e.target === ref.current && !ocupado) onCancelar?.()
      }}
      className="m-auto w-[min(92vw,460px)] rounded-[22px] bg-newsprint p-0 text-ink backdrop:bg-ink/45"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-ink text-paper">
            <TriangleAlert className="size-[22px]" />
          </span>
          <div className="min-w-0">
            <h3 className="m-0 text-[19px] leading-tight font-semibold text-balance">{titulo}</h3>
            {descripcion && (
              <p className="mt-1 mb-0 text-[13px] text-neutral-700 text-pretty">{descripcion}</p>
            )}
          </div>
          <button
            onClick={() => !ocupado && onCancelar?.()}
            aria-label="Cerrar"
            className="ml-auto grid size-8 shrink-0 place-items-center rounded-full bg-paper"
          >
            <X className="size-4" />
          </button>
        </div>

        {detalles.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1.5 rounded-2xl bg-paper p-4 pl-4 text-[13px]">
            {detalles.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="text-neutral-700">
                  ·
                </span>
                <span className="text-pretty">{d}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <button
            autoFocus
            onClick={() => !ocupado && onCancelar?.()}
            className="rounded-full bg-paper px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={ocupado}
            className={cn(
              "rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40"
            )}
          >
            {ocupado ? textoOcupado : textoConfirmar}
          </button>
        </div>
      </div>
    </dialog>
  )
}
