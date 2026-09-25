import * as React from "react"

import { supabase } from "@/lib/supabase"
import { filtroTexto } from "@/lib/lista"

/**
 * Sugerencias de SKU buscadas en el servidor mientras se escribe.
 *
 * Sustituye a «cargar todo el catálogo y filtrar en el navegador», que con
 * miles de SKU es una consulta enorme cada vez que se abre una factura, una
 * entrada o un ajuste. Aquí solo viajan las pocas filas que coinciden, y el
 * índice trigrama de migration-008-busqueda-productos.sql hace que el
 * `ilike '%texto%'` no recorra la tabla.
 *
 *  - Espera 250 ms sin teclear antes de preguntar.
 *  - Solo devuelve filas que corresponden EXACTAMENTE al texto actual. Así un
 *    Enter rápido no agrega el primer resultado de una búsqueda anterior: si
 *    la respuesta aún no llega, no hay nada que agregar.
 */
const ESPERA_MS = 250

export function useBuscarProductos(texto, columnas, tope = 4) {
  const [res, setRes] = React.useState({ para: null, filas: [] })
  const pedido = React.useRef(0)
  const q = texto.trim()

  React.useEffect(() => {
    const n = ++pedido.current
    if (!q) return
    const t = setTimeout(() => {
      supabase
        .from("product")
        .select(columnas)
        .or(filtroTexto(q, ["sku", "description"]))
        .order("sku")
        .limit(tope)
        .then(({ data }) => {
          if (n === pedido.current) setRes({ para: q, filas: data ?? [] })
        })
    }, ESPERA_MS)
    return () => clearTimeout(t)
  }, [q, columnas, tope])

  const listo = q !== "" && res.para === q
  return { sugerencias: listo ? res.filas : [], buscando: q !== "" && !listo }
}
