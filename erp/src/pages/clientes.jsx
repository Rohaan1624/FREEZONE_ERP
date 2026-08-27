import * as React from "react"
import { Link } from "react-router-dom"
import { Plus, Check, Trash2, X, Pencil, CircleAlert, Store, ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { Confirmar } from "@/components/confirmar"
import { usd } from "@/lib/format"
import { sumar } from "@/lib/dinero"

const TIPOS = ["company", "individual", "government"]
const ETIQUETA_TIPO = { company: "Empresa", individual: "Persona", government: "Gobierno" }
const TERMINOS = [0, 15, 30, 45, 60]

const VACIO = {
  name: "",
  identifier: "",
  contact: "",
  email: "",
  client_type: "company",
  payment_terms: 0,
  address: "",
  country: "",
}

export default function Clientes() {
  const [filas, setFilas] = React.useState([])
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState("")
  const [busca, setBusca] = React.useState("")
  const [form, setForm] = React.useState(null) // null = closed, {} = new, {id} = edit
  const [guardando, setGuardando] = React.useState(false)
  const [aBorrar, setABorrar] = React.useState(null) // the client awaiting confirmation
  const [borrando, setBorrando] = React.useState(false)

  // Bumping this refetches. The fetch lives inside the effect with a liveness
  // guard so a response that lands after the user navigates away is dropped
  // instead of calling setState on an unmounted component — and two fetches in
  // flight can never apply out of order.
  const [recarga, setRecarga] = React.useState(0)
  const cargar = React.useCallback(() => setRecarga((n) => n + 1), [])

  React.useEffect(() => {
    let vivo = true
    supabase
      .from("client")
      .select("*")
      .order("name")
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setError(error.message)
        else setFilas(data ?? [])
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [recarga])

  async function guardar() {
    setError("")
    if (!form.name.trim()) return setError("El nombre no puede quedar vacío.")
    setGuardando(true)

    // balance is NOT sent: policy.sql revoked that column, and it is derived
    // from invoices minus payments. Including it fails with permission denied.
    const cuerpo = {
      name: form.name.trim(),
      identifier: form.identifier?.trim() || null,
      contact: form.contact?.trim() || null,
      email: form.email?.trim() || null,
      client_type: form.client_type,
      payment_terms: Number(form.payment_terms) || 0,
      // Salen en la cabecera de la factura impresa (Dirección / País).
      address: form.address?.trim() || null,
      country: form.country?.trim() || null,
    }

    const q = form.id
      ? supabase.from("client").update(cuerpo).eq("id", form.id).select()
      : supabase.from("client").insert(cuerpo).select()

    const { data, error } = await q
    setGuardando(false)
    if (error) return setError(error.message)
    if (!data?.length) return setError("No se guardó: la fila no es tuya o RLS la bloqueó.")
    setForm(null)
    cargar()
  }

  async function borrar() {
    const c = aBorrar
    if (!c) return
    setError("")
    setBorrando(true)
    // RLS makes a blocked row INVISIBLE to delete — it returns 0 rows rather
    // than an error. .select() lets us tell "deleted" from "silently refused".
    const { data, error } = await supabase.from("client").delete().eq("id", c.id).select()
    setBorrando(false)
    setABorrar(null)
    if (error) {
      return setError(
        /foreign key/i.test(error.message)
          ? `No se puede eliminar a ${c.name}: tiene facturas o pagos registrados. Su historial debe conservarse.`
          : error.message
      )
    }
    if (!data?.length) {
      return setError(
        `No se puede eliminar a ${c.name}: su saldo debe ser 0 y no debe tener facturas ni pagos.`
      )
    }
    cargar()
  }

  const q = busca.trim().toLowerCase()
  const visibles = filas.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.identifier ?? "").toLowerCase().includes(q) ||
      (c.contact ?? "").toLowerCase().includes(q)
  )
  const porCobrar = sumar(filas, (c) => c.balance)

  const campo = "mt-0.5 w-full bg-transparent text-base outline-none"
  const tile = "block rounded-2xl bg-paper px-4 py-2.5"
  const rotulo = "text-[10px] tracking-[0.1em] text-ink/50 uppercase"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h3 className="m-0 text-[21px] font-semibold">Clientes</h3>
          <div className="text-[13px] text-neutral-700">
            {filas.length} cuentas · por cobrar {usd(porCobrar)}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nombre, RUC o contacto"
            className="h-9 w-[250px] rounded-full bg-newsprint px-3.5 text-sm outline-none"
          />
          <button
            onClick={() => setForm({ ...VACIO })}
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper"
          >
            <Plus className="size-4" />
            Nuevo cliente
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-newsprint px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {form && (
        <section className="rounded-[22px] bg-newsprint p-6">
          <div className="mb-4 flex items-center gap-3">
            <h4 className="m-0 font-semibold">
              {form.id ? "Editar cliente" : "Nuevo cliente"}
            </h4>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => {
                  setForm(null)
                  setError("")
                }}
                className="flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-sm"
              >
                <X className="size-4" />
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando}
                className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40"
              >
                <Check className="size-4" />
                {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-2.5">
            <label className={tile}>
              <span className={rotulo}>Nombre *</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Acme Trading LLC"
                className={campo}
                autoFocus
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>RUC / identificador</span>
              <input
                value={form.identifier ?? ""}
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                placeholder="100123456789"
                className={cn(campo, "tabular-nums")}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>Contacto</span>
              <input
                value={form.contact ?? ""}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                placeholder="+971 50 000 0000"
                className={campo}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>Correo</span>
              <input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="compras@cliente.com"
                className={campo}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>Dirección</span>
              <input
                value={form.address ?? ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="PANAMA"
                className={campo}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>País</span>
              <input
                value={form.country ?? ""}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                placeholder="PANAMA"
                className={campo}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>Tipo</span>
              <select
                value={form.client_type}
                onChange={(e) => setForm({ ...form, client_type: e.target.value })}
                className={campo}
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className={tile}>
              <span className={rotulo}>Condiciones de pago</span>
              <select
                value={form.payment_terms}
                onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                className={campo}
              >
                {TERMINOS.map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? "Contado" : `Neto ${d}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-neutral-700">
            El saldo no se captura: se calcula solo, sumando facturas emitidas y restando pagos.
            Las condiciones de pago se copian a cada factura nueva como su fecha de vencimiento.
          </p>
        </section>
      )}

      {cargando && <div className="p-6 text-center text-sm text-neutral-700">Cargando…</div>}

      {!cargando && visibles.length === 0 && (
        <div className="rounded-[22px] bg-newsprint p-10 text-center">
          <div className="text-base font-semibold">
            {filas.length === 0 ? "Todavía no hay clientes" : "Ninguna cuenta coincide"}
          </div>
          <div className="mt-1 text-[13px] text-neutral-700">
            {filas.length === 0
              ? "Crea el primero para poder facturar."
              : "Prueba con otra búsqueda."}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3">
        {visibles.map((c) => (
          /**
           * The whole card opens the statement. Built as a "stretched link":
           * a REAL <a> absolutely covering the card, with the action buttons
           * layered above it. That keeps proper link semantics — right-click,
           * middle-click, open in a new tab, keyboard focus — which an onClick
           * handler on a <div> would silently lose, and it avoids nesting
           * <button> inside <a>, which is invalid HTML.
           *
           * The affordances are deliberate and redundant: pointer cursor over
           * the whole card, a lift on hover, the arrow slides right, and a
           * standing "Ver estado de cuenta" label. Nobody has to guess.
           */
          <article
            key={c.id}
            className="group relative flex cursor-pointer flex-col gap-3 rounded-[20px] bg-newsprint p-4 transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ink"
          >
            <Link
              to={`/clientes/${c.id}`}
              aria-label={`Ver estado de cuenta de ${c.name}`}
              className="absolute inset-0 z-0 rounded-[20px]"
            />

            {/* pointer-events-none so clicks fall through to the link beneath */}
            <div className="pointer-events-none relative z-10 flex items-start gap-3">
              <span className="grid size-[42px] shrink-0 place-items-center rounded-[14px] bg-paper">
                <Store className="size-[22px] text-neutral-700" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[17px] leading-tight font-semibold">{c.name}</div>
                <div className="truncate text-xs text-neutral-700 tabular-nums">
                  {[c.identifier, c.contact, c.email].filter(Boolean).join(" · ") || "sin datos"}
                </div>
              </div>
              <span className="ml-auto shrink-0 rounded-full bg-paper px-3 py-1 text-xs">
                {ETIQUETA_TIPO[c.client_type] ?? c.client_type ?? "—"}
              </span>
            </div>

            {/* No "alta" tile: client has no date_created column. */}
            <div className="pointer-events-none relative z-10 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-paper px-3 py-2">
                <div className="text-[9px] tracking-[0.1em] text-ink/50 uppercase">Saldo</div>
                <div className="text-[18px] font-semibold tabular-nums">{usd(c.balance)}</div>
              </div>
              <div className="rounded-xl bg-paper px-3 py-2">
                <div className="text-[9px] tracking-[0.1em] text-ink/50 uppercase">
                  Condiciones
                </div>
                <div className="text-[18px] font-semibold tabular-nums">
                  {c.payment_terms ? `Neto ${c.payment_terms}` : "Contado"}
                </div>
              </div>
            </div>

            {/* pointer-events-none on the ROW, not just the label: the label
                alone lets the click through, but then it lands on this wrapper,
                which sits at z-10 — above the stretched link at z-0 — and dies
                there. The two buttons re-enable pointer events for themselves. */}
            <div className="pointer-events-none relative z-10 flex items-center gap-2">
              {/* The standing cue that the card itself is the way in */}
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                Ver estado de cuenta
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
              </span>

              {/* z-20 + pointer-events-auto: these sit ABOVE the stretched link */}
              <button
                onClick={() => setForm({ ...c })}
                className="pointer-events-auto relative z-20 ml-auto grid size-8 place-items-center rounded-full bg-paper transition-shadow hover:shadow-sm"
                title="Editar cliente"
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => setABorrar(c)}
                disabled={Number(c.balance) !== 0}
                title={
                  Number(c.balance) !== 0
                    ? "Solo se puede eliminar un cliente con saldo 0"
                    : "Eliminar cliente"
                }
                className="pointer-events-auto relative z-20 grid size-8 place-items-center rounded-full bg-paper transition-shadow hover:shadow-sm disabled:opacity-35 disabled:hover:shadow-none"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </article>
        ))}
      </div>

      <Confirmar
        abierto={Boolean(aBorrar)}
        ocupado={borrando}
        titulo={`¿Eliminar a ${aBorrar?.name ?? ""}?`}
        descripcion="Esta acción no se puede deshacer."
        detalles={[
          "Se borra la ficha del cliente de forma permanente.",
          "Solo es posible si su saldo es 0 y no tiene facturas ni pagos registrados; si los tiene, el sistema lo impedirá para conservar el historial.",
          "Si solo quieres dejar de usarlo, edítalo en lugar de eliminarlo.",
        ]}
        textoConfirmar="Eliminar cliente"
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </div>
  )
}
