import * as React from "react"
import { useOutletContext } from "react-router-dom"
import { Check, CircleAlert } from "lucide-react"

import { supabase } from "@/lib/supabase"

/**
 * company is the account's profile row. policy.sql gives it a SELECT and an
 * UPDATE policy and NO insert/delete policy — it is created once by the
 * on_auth_user_created trigger at signup and dies with the account.
 *
 * Only these six columns are grantable. next_invoice_num is deliberately not:
 * it is a counter owned by create_invoice, and letting someone set it backwards
 * would collide with folios already issued.
 */
const CAMPOS = [
  { k: "name", label: "Nombre de la empresa", placeholder: "Mi Empresa, S.A.", required: true },
  { k: "tax_id", label: "RUC", placeholder: "000000-0-000000 D.V. 00", mono: true },
  { k: "contact", label: "Teléfono", placeholder: "000-0000" },
  { k: "email", label: "Correo", placeholder: "correo@miempresa.com", type: "email" },
  { k: "website", label: "Sitio web", placeholder: "empresa.com" },
  { k: "invoice_prefix", label: "Serie de folios", placeholder: "INV-", mono: true },
  { k: "logo_url", label: "URL del logo", placeholder: "https://…/logo.png", ancho: true },
]

// Va aparte porque es multilínea: cada renglón se imprime tal cual en la
// cabecera de la factura, igual que en la papelería.
const CAMPO_DIRECCION = "address"

export default function Empresa() {
  const { empresa, recargarEmpresa } = useOutletContext()
  const [form, setForm] = React.useState(null)
  const [origen, setOrigen] = React.useState(null)
  const [error, setError] = React.useState("")
  const [guardado, setGuardado] = React.useState(false)
  const [guardando, setGuardando] = React.useState(false)

  // Seed the form from the row the shell already loaded. Done during render
  // rather than in an effect: an effect would render once with form === null,
  // then setState and render again. This is React's documented "adjust state
  // when a prop changes" pattern — the id guard stops it looping.
  if (empresa && empresa.id !== origen) {
    setOrigen(empresa.id)
    setForm({ ...empresa })
  }

  if (!form) return <div className="p-6 text-sm text-neutral-700">Cargando…</div>

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setGuardado(false)
  }

  const sucio = [...CAMPOS.map((c) => c.k), CAMPO_DIRECCION].some(
    (k) => (form[k] ?? "") !== (empresa?.[k] ?? "")
  )

  async function guardar() {
    setError("")
    if (!String(form.name ?? "").trim()) return setError("El nombre de la empresa no puede quedar vacío.")

    setGuardando(true)
    // Only the grantable columns are sent. Including next_invoice_num here
    // would fail with "permission denied for table company".
    const parche = Object.fromEntries(
      [...CAMPOS.map((c) => c.k), CAMPO_DIRECCION].map((k) => [
        k,
        String(form[k] ?? "").trim() || null,
      ])
    )
    const { data, error } = await supabase
      .from("company")
      .update(parche)
      .eq("id", form.id)
      .select()
      .maybeSingle()
    setGuardando(false)

    if (error) return setError(error.message)
    setForm({ ...data })
    recargarEmpresa(data) // refresh the header without a page reload
    setGuardado(true)
  }

  const proximoFolio =
    (form.invoice_prefix ?? "") + String(empresa?.next_invoice_num ?? 1).padStart(5, "0")

  return (
    <div className="flex flex-col gap-3">
      <section className="registro p-6">
        <div className="mb-4 flex flex-wrap items-start gap-4">
          <div>
            <div className="rotulo">
              Configuración
            </div>
            <h2 className="m-0 text-[25px] font-semibold">Datos de la empresa</h2>
            <div className="text-[13px] text-neutral-700">
              Aparecen en el encabezado y en cada factura que emitas.
            </div>
          </div>
          <button
            onClick={guardar}
            disabled={!sucio || guardando}
            className="boton boton-ink ml-auto"
          >
            <Check className="size-4" />
            {guardando ? "Guardando…" : guardado && !sucio ? "Guardado" : "Guardar cambios"}
          </button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-2.5">
          {CAMPOS.map((c) => (
            <label
              key={c.k}
              className={`block casilla px-4 py-2.5 ${c.ancho ? "col-span-full" : ""}`}
            >
              <span className="rotulo">
                {c.label}
                {c.required && " *"}
              </span>
              <input
                type={c.type ?? "text"}
                value={form[c.k] ?? ""}
                onChange={(e) => set(c.k, e.target.value)}
                placeholder={c.placeholder}
                className={`mt-0.5 w-full bg-transparent text-base outline-none ${c.mono ? "tabular-nums" : ""}`}
              />
            </label>
          ))}
        </div>

        <label className="mt-2.5 block casilla px-4 py-2.5">
          <span className="rotulo">Dirección</span>
          <textarea
            value={form.address ?? ""}
            onChange={(e) => set("address", e.target.value)}
            rows={2}
            placeholder={"Calle 1, Local 1\nCiudad, País"}
            className="mt-0.5 w-full resize-y bg-transparent text-base outline-none"
          />
          <span className="text-[11px] text-neutral-700">
            Un renglón por línea; se imprime igual en la factura.
          </span>
        </label>

        {error && (
          <div className="mt-3 flex items-center gap-2.5 casilla px-3 py-2.5 text-[13px]">
            <CircleAlert className="size-[19px] shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </section>

      <section className="registro p-6">
        <h4 className="m-0 mb-3 font-semibold">Numeración de facturas</h4>
        <div className="flex flex-wrap items-center gap-3">
          <div className="casilla px-4 py-3">
            <div className="rotulo">
              Próximo folio
            </div>
            <div className="text-[21px] font-semibold tabular-nums">{proximoFolio}</div>
          </div>
          <p className="max-w-[52ch] text-[13px] text-neutral-700">
            El contador lo lleva el servidor, así que dos personas guardando al mismo tiempo nunca
            reciben el mismo folio. Puedes cambiar la serie cuando quieras — el contador no se
            reinicia, de modo que los folios siguen siendo únicos.
          </p>
        </div>
      </section>
    </div>
  )
}
