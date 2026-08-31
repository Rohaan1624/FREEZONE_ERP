import * as React from "react"
import { Check, X, CircleAlert, UserPlus, PackagePlus } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"

/**
 * Alta rápida de cliente / SKU sin salir del documento que se está capturando.
 *
 * Deliberadamente un diálogo y NO una navegación a /clientes o /productos: irse
 * a otra pantalla se llevaría por delante los renglones ya escritos. Aquí se
 * crea la fila, se devuelve al formulario y queda YA seleccionada — que es la
 * razón por la que alguien abre esto a mitad de una factura.
 *
 * Escribe directo a la tabla (client y product son de nivel 1: tienen políticas
 * de insert propias), así que no hace falta ningún RPC.
 *
 * Sobre <dialog>: da foco atrapado, Escape y capa superior de regalo. El foco
 * arranca en el primer campo porque aquí la acción principal SÍ es escribir,
 * al revés que en el diálogo de borrado, donde arranca en «Cancelar».
 */
function Dialogo({ abierto, titulo, icono: Icono, children, onCancelar, onGuardar, guardando, error }) {
  const ref = React.useRef(null)

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
        e.preventDefault()
        if (!guardando) onCancelar()
      }}
      onClick={(e) => {
        if (e.target === ref.current && !guardando) onCancelar()
      }}
      className="m-auto w-[min(94vw,560px)] registro p-0 text-ink backdrop:bg-ink/45"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          onGuardar()
        }}
        className="flex flex-col gap-4 p-6"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-ink text-paper">
            <Icono className="size-5" />
          </span>
          <h3 className="m-0 text-[19px] font-semibold">{titulo}</h3>
          <button
            type="button"
            onClick={() => !guardando && onCancelar()}
            aria-label="Cerrar"
            className="accion ml-auto size-8"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">{children}</div>

        {error && (
          <div className="flex items-center gap-2.5 casilla px-3 py-2.5 text-[13px]">
            <CircleAlert className="size-[19px] shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => !guardando && onCancelar()}
            className="boton boton-claro"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="boton boton-ink"
          >
            <Check className="size-4" />
            {guardando ? "Guardando…" : "Crear y usar"}
          </button>
        </div>
      </form>
    </dialog>
  )
}

const tile = "block casilla px-4 py-2.5"
const rotulo = "rotulo"
const campo = "mt-0.5 w-full bg-transparent text-base outline-none"

function Campo({ etiqueta, ancho, mono, ...props }) {
  return (
    <label className={cn(tile, ancho && "col-span-full")}>
      <span className={rotulo}>{etiqueta}</span>
      <input className={cn(campo, mono && "tabular-nums")} {...props} />
    </label>
  )
}

/* --------------------------------------------------------------- CLIENTE -- */

const CLIENTE_VACIO = { name: "", identifier: "", contact: "", address: "", country: "", payment_terms: 0 }

export function CrearCliente({ abierto, nombreInicial = "", onCreado, onCancelar }) {
  const [f, setF] = React.useState(CLIENTE_VACIO)
  const [error, setError] = React.useState("")
  const [guardando, setGuardando] = React.useState(false)
  const [sembrado, setSembrado] = React.useState(null)

  // Reseed each time it opens, carrying whatever was typed in the search box.
  if (abierto && sembrado !== nombreInicial) {
    setSembrado(nombreInicial)
    setF({ ...CLIENTE_VACIO, name: nombreInicial })
    setError("")
  }
  if (!abierto && sembrado !== null) setSembrado(null)

  async function guardar() {
    setError("")
    if (!f.name.trim()) return setError("El nombre no puede quedar vacío.")
    setGuardando(true)
    const { data, error } = await supabase
      .from("client")
      .insert({
        name: f.name.trim(),
        identifier: f.identifier.trim() || null,
        contact: f.contact.trim() || null,
        address: f.address.trim() || null,
        country: f.country.trim() || null,
        payment_terms: Number(f.payment_terms) || 0,
      })
      .select()
      .maybeSingle()
    setGuardando(false)
    if (error) return setError(error.message)
    onCreado(data)
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  return (
    <Dialogo
      abierto={abierto}
      titulo="Nuevo cliente"
      icono={UserPlus}
      onCancelar={onCancelar}
      onGuardar={guardar}
      guardando={guardando}
      error={error}
    >
      <Campo etiqueta="Nombre *" value={f.name} onChange={set("name")} placeholder="John Doe" autoFocus ancho />
      <Campo etiqueta="RUC / identificador" value={f.identifier} onChange={set("identifier")} placeholder="100123456789" mono />
      <Campo etiqueta="Contacto" value={f.contact} onChange={set("contact")} placeholder="000-0000" />
      <Campo etiqueta="Dirección" value={f.address} onChange={set("address")} placeholder="Calle 1, Local 1" />
      <Campo etiqueta="País" value={f.country} onChange={set("country")} placeholder="País" />
      <label className={tile}>
        <span className={rotulo}>Condiciones de pago</span>
        <select value={f.payment_terms} onChange={set("payment_terms")} className={campo}>
          {[0, 15, 30, 45, 60].map((d) => (
            <option key={d} value={d}>
              {d === 0 ? "Contado" : `Neto ${d}`}
            </option>
          ))}
        </select>
      </label>
    </Dialogo>
  )
}

/* -------------------------------------------------------------- PRODUCTO -- */

const PRODUCTO_VACIO = {
  sku: "",
  description: "",
  unit: "PZA",
  qty_unit: 1,
  cost_price: "",
  sale_price: "",
  weight_kg: "",
  cbm: "",
}

export function CrearProducto({ abierto, skuInicial = "", onCreado, onCancelar }) {
  const [f, setF] = React.useState(PRODUCTO_VACIO)
  const [error, setError] = React.useState("")
  const [guardando, setGuardando] = React.useState(false)
  const [sembrado, setSembrado] = React.useState(null)

  if (abierto && sembrado !== skuInicial) {
    setSembrado(skuInicial)
    setF({ ...PRODUCTO_VACIO, sku: skuInicial.toUpperCase() })
    setError("")
  }
  if (!abierto && sembrado !== null) setSembrado(null)

  const num = (v) => (String(v ?? "").trim() === "" ? null : Number(v))

  async function guardar() {
    setError("")
    if (!f.sku.trim()) return setError("El SKU no puede quedar vacío.")
    setGuardando(true)
    // stock NO se manda: la columna está revocada. Un SKU nuevo nace en 0 y
    // sube con una entrada cerrada o un ajuste.
    const { data, error } = await supabase
      .from("product")
      .insert({
        sku: f.sku.trim().toUpperCase(),
        description: f.description.trim() || null,
        unit: f.unit.trim() || null,
        qty_unit: Math.max(1, Math.round(Number(f.qty_unit) || 1)),
        cost_price: num(f.cost_price),
        sale_price: num(f.sale_price),
        weight_kg: num(f.weight_kg),
        cbm: num(f.cbm),
      })
      .select()
      .maybeSingle()
    setGuardando(false)
    if (error) {
      return setError(
        /duplicate key/i.test(error.message)
          ? `Ya tienes un SKU ${f.sku.trim().toUpperCase()}.`
          : error.message
      )
    }
    onCreado(data)
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  return (
    <Dialogo
      abierto={abierto}
      titulo="Nuevo SKU"
      icono={PackagePlus}
      onCancelar={onCancelar}
      onGuardar={guardar}
      guardando={guardando}
      error={error}
    >
      <Campo etiqueta="SKU *" value={f.sku} onChange={set("sku")} placeholder="ABC-100" autoFocus mono />
      <Campo etiqueta="Descripción" value={f.description} onChange={set("description")} placeholder="Descripción del producto" ancho />
      <Campo etiqueta="Unidad" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value.toUpperCase() })} list="unidades-rapido" placeholder="PZA" />
      <Campo etiqueta="Piezas por bulto" value={f.qty_unit} onChange={set("qty_unit")} inputMode="numeric" placeholder="12" mono />
      <Campo etiqueta="Costo unitario" value={f.cost_price} onChange={set("cost_price")} inputMode="decimal" placeholder="5.50" mono />
      <Campo etiqueta="Precio de lista" value={f.sale_price} onChange={set("sale_price")} inputMode="decimal" placeholder="12.00" mono />
      <Campo etiqueta="Peso por bulto (kg)" value={f.weight_kg} onChange={set("weight_kg")} inputMode="decimal" placeholder="9.4" mono />
      <Campo etiqueta="CBM por bulto" value={f.cbm} onChange={set("cbm")} inputMode="decimal" placeholder="0.0450" mono />
      <p className="col-span-full m-0 text-[11px] text-neutral-700">
        La existencia arranca en 0: sube al cerrar una entrada o con un ajuste. Peso y CBM son por
        bulto, no por pieza.
      </p>
      <datalist id="unidades-rapido">
        {["PZA", "BOX", "DOC", "CTN", "KG", "PAL"].map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
    </Dialogo>
  )
}
