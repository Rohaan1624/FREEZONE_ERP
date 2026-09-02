import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { etiquetaRango, POR_PAGINA } from "@/lib/lista"

/**
 * Pie de paginación: dónde estás y cómo moverte.
 *
 * Anterior/Siguiente y no numeritos de página: con miles de renglones la fila
 * de números no cabe, y nadie salta a la página 47 a propósito — para llegar a
 * un registro concreto se usa el buscador, que ahora consulta al servidor.
 *
 * El rango siempre se muestra, aunque haya una sola página. Saber que estás
 * viendo «1 – 8 de 8» es justo lo que faltaba antes: sin ese texto no había
 * forma de notar que la lista venía recortada.
 */
export function Paginacion({ pagina, cuantos, total, onPagina, cargando }) {
  const ultima = Math.max(0, Math.ceil((total ?? 0) / POR_PAGINA) - 1)
  const hayMas = pagina < ultima

  return (
    <div className="flex flex-wrap items-center gap-3 px-1 text-[13px] text-neutral-600">
      <span className="tabular-nums">
        {total === null ? "…" : etiquetaRango(pagina, cuantos, total)}
      </span>

      {(pagina > 0 || hayMas) && (
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onPagina(pagina - 1)}
            disabled={pagina === 0 || cargando}
            className={cn("accion", "disabled:opacity-30")}
            title="Página anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="px-1 tabular-nums">
            {pagina + 1} / {ultima + 1}
          </span>
          <button
            onClick={() => onPagina(pagina + 1)}
            disabled={!hayMas || cargando}
            className={cn("accion", "disabled:opacity-30")}
            title="Página siguiente"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  )
}
