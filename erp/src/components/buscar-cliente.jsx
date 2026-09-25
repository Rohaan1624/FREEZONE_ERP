import * as React from "react"
import { ChevronDown, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { filtroTexto } from "@/lib/lista"

/**
 * Elegir cliente buscando en el servidor, no en una lista cargada.
 *
 * Un <select> obliga a traer TODOS los clientes al abrir la factura: con diez
 * mil son diez mil filas por pantalla, cada vez. Aquí solo viaja lo que se
 * escribe y vuelven ocho coincidencias. El índice trigrama de
 * migration-007-busqueda-clientes.sql hace que el `ilike '%texto%'` no recorra
 * la tabla entera.
 *
 * Dos detalles que evitan carga y errores:
 *  - Espera 250 ms sin teclear antes de preguntar: escribir «almacen» no son
 *    siete consultas.
 *  - Cada respuesta lleva su número de pedido y solo se pinta la última; una
 *    respuesta lenta de «alm» no pisa la de «almacen».
 */

export const COLUMNAS_CLIENTE = "id,name,identifier,payment_terms,balance,address,country"
const TOPE = 8
const ESPERA_MS = 250

export function BuscarCliente({ cliente, onElegir, className }) {
  const [abierto, setAbierto] = React.useState(false)
  const [q, setQ] = React.useState("")
  const [res, setRes] = React.useState({ para: null, filas: [] })
  const [activo, setActivo] = React.useState(0)
  const pedido = React.useRef(0)
  const caja = React.useRef(null)

  React.useEffect(() => {
    if (!abierto) return
    const n = ++pedido.current
    const t = setTimeout(() => {
      let consulta = supabase.from("client").select(COLUMNAS_CLIENTE).order("name").limit(TOPE)
      const f = filtroTexto(q, ["name", "identifier"])
      if (f) consulta = consulta.or(f)
      consulta.then(({ data }) => {
        if (n !== pedido.current) return
        setRes({ para: q, filas: data ?? [] })
        setActivo(0)
      })
    }, ESPERA_MS)
    return () => clearTimeout(t)
  }, [q, abierto])

  // Cerrar al hacer clic fuera.
  React.useEffect(() => {
    if (!abierto) return
    const fuera = (e) => caja.current && !caja.current.contains(e.target) && cerrar()
    document.addEventListener("mousedown", fuera)
    return () => document.removeEventListener("mousedown", fuera)
  }, [abierto])

  function cerrar() {
    setAbierto(false)
    setQ("")
  }

  function elegir(c) {
    onElegir(c)
    cerrar()
  }

  const filas = res.filas
  const buscandoAun = res.para !== q

  return (
    <div ref={caja} className={cn("relative", className)}>
      {abierto ? (
        <div className="mt-0.5 flex items-center gap-2">
          <Search className="size-4 shrink-0 text-neutral-600" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActivo((i) => Math.min(i + 1, filas.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActivo((i) => Math.max(i - 1, 0))
              } else if (e.key === "Enter" && filas[activo]) {
                e.preventDefault()
                elegir(filas[activo])
              } else if (e.key === "Escape") {
                cerrar()
              }
            }}
            placeholder="Nombre o RUC"
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="mt-0.5 flex w-full min-w-0 items-center gap-2 text-left text-base"
        >
          <span className={cn("min-w-0 flex-1 truncate", !cliente && "text-neutral-600")}>
            {cliente?.name ?? "Elegir cliente"}
          </span>
          <ChevronDown className="size-4 shrink-0 text-neutral-600" />
        </button>
      )}

      {abierto && (
        <div className="absolute top-full right-0 left-0 z-20 mt-2 min-w-[260px] rounded-md border border-neutral-300 bg-white p-1 shadow-lg">
          {filas.length === 0 ? (
            <div className="px-3 py-2 text-[13px] text-neutral-700">
              {buscandoAun ? "Buscando…" : q.trim() ? "Ningún cliente coincide." : "Todavía no hay clientes."}
            </div>
          ) : (
            filas.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setActivo(i)}
                onClick={() => elegir(c)}
                className={cn(
                  "flex w-full items-baseline gap-3 rounded px-3 py-2 text-left text-sm",
                  i === activo && "bg-newsprint"
                )}
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.identifier && (
                  <span className="shrink-0 text-[11px] text-neutral-700 tabular-nums">
                    {c.identifier}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
