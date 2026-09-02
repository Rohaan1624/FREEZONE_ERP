import * as React from "react"
import { Link } from "react-router-dom"
import { Plus, Check, Trash2, X, Pencil, CircleAlert, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { Confirmar } from "@/components/confirmar"
import { usd } from "@/lib/format"
import { useTotales } from "@/lib/totales"
import { Paginacion } from "@/components/paginacion"
import { useDebounce, rango, filtroTexto } from "@/lib/lista"

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
  const [pagina, setPagina] = React.useState(0)
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

  const q = useDebounce(busca)
  const clave = `${pagina}|${q}|${recarga}`
  const [datos, setDatos] = React.useState(null)

  React.useEffect(() => {
    let vivo = true
    // Búsqueda y orden en el servidor: filtrar el arreglo cargado solo
    // encontraría lo que ya estaba en la página visible.
    let consulta = supabase
      .from("client")
      .select("*", { count: "exact" })
      .order("name")
      .range(...rango(pagina))
    const f = filtroTexto(q, ["name", "identifier", "contact"])
    if (f) consulta = consulta.or(f)

    consulta.then(({ data, error, count }) => {
      if (!vivo) return
      if (error) setError(error.message)
      else setDatos({ clave, filas: data ?? [], total: count ?? 0 })
    })
    return () => {
      vivo = false
    }
  }, [clave, pagina, q, recarga])

  const cargando = datos?.clave !== clave
  const filas = datos?.filas ?? []
  const total = datos?.total ?? null

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

  // Del servidor: sumar `filas` daría solo lo cargado.
  const totales = useTotales("totales_clientes", recarga)


  // Mismo sistema que el libro de facturas: hojas blancas con filete, reglas
  // entre renglones y radios de la escala (--radius-md 2px, --radius-2xl 4px).
  const campo = "mt-0.5 w-full bg-transparent text-base outline-none"
  // El panel del formulario va en gris y los campos en blanco: el papel donde
  // se escribe es blanco, el chrome alrededor es el tinte.
  const tile = "casilla block"
  const rotulo = "rotulo"
  const COLS =
    "grid-cols-[minmax(0,1fr)_minmax(120px,0.4fr)_minmax(88px,0.28fr)_minmax(110px,0.32fr)_150px_70px]"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h3 className="m-0 text-[21px] font-semibold">Clientes</h3>
          <div className="text-[13px] text-neutral-700">
            {totales ? totales.cuentas : "…"} cuentas · por cobrar{" "}
            <span className="tabular-nums">{totales ? usd(totales.por_cobrar) : "…"}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-500" />
            <input
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                setPagina(0)
              }}
              placeholder="Buscar nombre, RUC o contacto"
              className="entrada-texto w-[260px] pr-3 pl-9"
            />
          </div>
          <button
            onClick={() => setForm({ ...VACIO })}
            className="boton boton-ink"
          >
            <Plus className="size-4" />
            Nuevo cliente
          </button>
        </div>
      </div>

      {error && (
        <div className="registro flex items-center gap-2.5 px-4 py-3 text-[13px]">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {form && (
        <section className="panel">
          <div className="mb-4 flex items-center gap-3">
            <h4 className="m-0 font-semibold">{form.id ? "Editar cliente" : "Nuevo cliente"}</h4>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => {
                  setForm(null)
                  setError("")
                }}
                className="boton boton-claro"
              >
                <X className="size-4" />
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando}
                className="boton boton-ink"
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
                placeholder="John Doe"
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
                placeholder="000-0000"
                className={campo}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>Correo</span>
              <input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="correo@cliente.com"
                className={campo}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>Dirección</span>
              <input
                value={form.address ?? ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Calle 1, Local 1"
                className={campo}
              />
            </label>
            <label className={tile}>
              <span className={rotulo}>País</span>
              <input
                value={form.country ?? ""}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                placeholder="País"
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

      {!cargando && filas.length === 0 && (
        <div className="registro p-10 text-center">
          <div className="text-base font-semibold">
            {q ? "Ninguna cuenta coincide" : "Todavía no hay clientes"}
          </div>
          <div className="mt-1 text-[13px] text-neutral-700">
            {q ? "Prueba con otra búsqueda." : "Crea el primero para poder facturar."}
          </div>
        </div>
      )}

      {filas.length > 0 && (
        // Tabla y no rejilla de tarjetas: aquí se viene a barrer la columna de
        // saldos de arriba abajo, y en tarjetas cada saldo queda a distinta
        // altura, así que no se pueden comparar de un vistazo.
        <div className="registro overflow-hidden">
          <div
            className={cn(
              "registro-cab rotulo grid items-center gap-3",
              COLS
            )}
          >
            <div>Cliente</div>
            <div>País</div>
            <div>Tipo</div>
            <div>Condiciones</div>
            <div className="text-right">Saldo</div>
            <div />
          </div>

          {filas.map((c) => (
            /**
             * The whole row opens the statement. Built as a "stretched link":
             * a REAL <a> absolutely covering the row, with the action buttons
             * layered above it. That keeps proper link semantics — right-click,
             * middle-click, open in a new tab, keyboard focus — which an onClick
             * handler on a <div> would silently lose, and it avoids nesting
             * <button> inside <a>, which is invalid HTML.
             */
            <div
              key={c.id}
              className={cn(
                "registro-fila group relative grid cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-neutral-100 focus-within:bg-neutral-100",
                COLS
              )}
            >
              <Link
                to={`/clientes/${c.id}`}
                aria-label={`Ver estado de cuenta de ${c.name}`}
                className="absolute inset-0 z-0"
              />

              {/* pointer-events-none so clicks fall through to the link beneath */}
              <div className="pointer-events-none relative z-10 min-w-0">
                <div className="truncate text-sm font-semibold">{c.name}</div>
                <div className="truncate text-[11px] text-neutral-600 tabular-nums">
                  {[c.identifier, c.contact, c.email].filter(Boolean).join(" · ") || "sin datos"}
                </div>
              </div>
              <div className="pointer-events-none relative z-10 truncate text-[13px] text-neutral-600">
                {c.country || "—"}
              </div>
              <div className="pointer-events-none relative z-10 text-[13px] text-neutral-600">
                {ETIQUETA_TIPO[c.client_type] ?? c.client_type ?? "—"}
              </div>
              <div className="pointer-events-none relative z-10 text-[13px] text-neutral-600 tabular-nums">
                {c.payment_terms ? `Neto ${c.payment_terms}` : "Contado"}
              </div>
              <div className="pointer-events-none relative z-10 text-right text-sm font-semibold tabular-nums">
                {Number(c.balance) === 0 ? (
                  <span className="text-neutral-400">—</span>
                ) : (
                  usd(c.balance)
                )}
              </div>

              {/* z-20 + pointer-events-auto: estos van ENCIMA del enlace estirado */}
              <div className="relative z-20 flex items-center justify-end gap-1">
                <button
                  onClick={() => setForm({ ...c })}
                  className="accion"
                  title="Editar cliente"
                >
                  <Pencil className="size-[15px]" />
                </button>
                <button
                  onClick={() => setABorrar(c)}
                  disabled={Number(c.balance) !== 0}
                  title={
                    Number(c.balance) !== 0
                      ? "Solo se puede eliminar un cliente con saldo 0"
                      : "Eliminar cliente"
                  }
                  className="accion"
                >
                  <Trash2 className="size-[15px]" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(filas.length > 0 || pagina > 0) && (
        <Paginacion
          pagina={pagina}
          cuantos={filas.length}
          total={total}
          onPagina={setPagina}
          cargando={cargando}
        />
      )}

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
