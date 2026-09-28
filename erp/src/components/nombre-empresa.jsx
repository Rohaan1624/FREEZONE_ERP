import * as React from "react"
import { Building2, Check } from "lucide-react"

import { supabase } from "@/lib/supabase"

/**
 * El nombre que handle_new_user (backend/functions.sql) pone cuando el alta
 * no trae `company_name`. Con Google siempre pasa: Google no sabe cómo se
 * llama la empresa. Mientras la empresa se llame así, se pide el nombre.
 */
export const NOMBRE_GENERICO = "My Company"

/**
 * Se pide una sola vez, al entrar por primera vez. No se puede saltar: el
 * nombre sale impreso en cada factura y packing list, y «My Company» en una
 * factura real sería peor que esperar diez segundos.
 */
export function NombreEmpresa({ empresa, onGuardado }) {
  const [nombre, setNombre] = React.useState("")
  const [guardando, setGuardando] = React.useState(false)
  const [error, setError] = React.useState("")

  async function guardar(e) {
    e.preventDefault()
    const limpio = nombre.trim()
    if (!limpio) return setError("Escribe el nombre de tu empresa.")
    setGuardando(true)
    setError("")
    const { data, error } = await supabase
      .from("company")
      .update({ name: limpio })
      .eq("id", empresa.id)
      .select()
      .maybeSingle()
    setGuardando(false)
    if (error) return setError(error.message)
    onGuardado(data)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-sm print:hidden">
      <form
        onSubmit={guardar}
        className="flex w-full max-w-[420px] flex-col gap-4 rounded-3xl bg-white p-6 shadow-lg"
      >
        <span className="grid size-11 place-items-center rounded-xl bg-newsprint">
          <Building2 className="size-5" />
        </span>
        <div>
          <h3 className="m-0 text-[21px]">¿Cómo se llama tu empresa?</h3>
          <p className="mt-1 mb-0 text-[14px] text-neutral-700">
            Sale en tus facturas y packing lists. Luego puedes completar RUC, dirección y logo en
            Empresa.
          </p>
        </div>
        <label className="casilla block">
          <span className="rotulo">Nombre de la empresa</span>
          <input
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Comercializadora Ejemplo, S.A."
            className="mt-0.5 w-full bg-transparent text-base outline-none"
          />
        </label>
        {error && <p className="m-0 text-[13px] text-destructive">{error}</p>}
        <button type="submit" disabled={guardando} className="boton boton-ink justify-center">
          <Check className="size-4" />
          {guardando ? "Guardando…" : "Continuar"}
        </button>
      </form>
    </div>
  )
}
