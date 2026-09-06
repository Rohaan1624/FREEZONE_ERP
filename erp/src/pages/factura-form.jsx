import * as React from "react"
import { Link, useNavigate, useParams, useBlocker } from "react-router-dom"
import {
  ArrowLeft,
  Save,
  PackageCheck,
  Trash2,
  Plus,
  PlusCircle,
  Package,
  Tag,
  Truck,
  Cuboid,
  CornerDownLeft,
  Ship,
  UserPlus,
  PackagePlus,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase, rpc } from "@/lib/supabase"
import { CrearCliente, CrearProducto } from "@/components/crear-rapido"
import { Confirmar } from "@/components/confirmar"
import { usd, n0, fecha, hoyISO, masDias } from "@/lib/format"
import {
  lineaSuelta,
  agrega,
  agregaProducto,
  actualiza,
  elimina,
  porTipo,
  importe,
  total as totalDe,
  subtotalTipo,
  incompletas,
  sinExistencia,
  disponible,
  aPayload,
  desdeFilas,
  llevaBultos,
  convierteBultos,
} from "@/lib/lineas"

const TABS = [
  { id: "product", label: "Productos", icon: Package },
  { id: "charge", label: "Cargos", icon: Truck },
  { id: "miscellaneous", label: "Misceláneos", icon: Tag },
]

const UNIDADES = ["PZA", "BOX", "DOC", "CTN", "KG", "PAL"]

// Datos del DOCUMENTO: solo salen impresos, no afectan existencia ni saldo.
// Viajan agrupados como p_doc (jsonb) para que agregar un campo más no cambie
// la firma del RPC otra vez.
//
// Los tres primeros son OVERRIDES de la ficha del cliente, y por eso su
// placeholder es el dato real: dejarlos en blanco imprime lo del cliente, y
// verlo ahí en gris dice la regla sin necesidad de explicarla. Su `cliente`
// marca de dónde sale ese respaldo.
const CAMPOS_DOC = [
  ["bill_to_name", "Vendido a", "", "name"],
  ["bill_to_address", "Dirección", "", "address"],
  ["bill_to_country", "País", "", "country"],
  ["purchase_order", "Orden de compra", "OC-0001"],
  ["salesperson", "Vendedor", "John Doe"],
  ["consigned_to", "Consignado a", "John Doe"],
  ["marks", "Marcas", "S/M"],
  ["dispatched", "Despachado", ""],
  ["shipped_via", "Embarcado vía", ""],
]
const DOC_VACIO = Object.fromEntries(CAMPOS_DOC.map(([k]) => [k, ""]))

// One grid per line shape, shared by the header row and its rows so the
// columns line up. Un producto ya no lleva columna de selector: se hace clic
// en el campo que se quiere escribir. Misceláneos llevan los dos campos
// sueltos porque no convierten; los cargos ninguno, porque son dinero.
const GRID = {
  product: "grid-cols-[minmax(0,1.5fr)_86px_86px_70px_92px_minmax(0,0.8fr)_34px]",
  miscellaneous: "grid-cols-[minmax(0,1.7fr)_86px_86px_70px_92px_minmax(0,0.8fr)_34px]",
  charge: "grid-cols-[minmax(0,2fr)_86px_92px_minmax(0,0.8fr)_34px]",
}
const TH = "rotulo"
const SUB = "block text-[9px] normal-case tracking-normal"

/**
 * One form for creating AND editing an invoice — update_invoice takes the same
 * whole-document shape create_invoice does, so a single component covers both.
 * A closed invoice cannot be edited (the backend refuses), so the caller never
 * routes here for one.
 */
export default function FacturaForm() {
  const navigate = useNavigate()
  const { id } = useParams()
  const editando = Boolean(id)
  const [clientes, setClientes] = React.useState([])
  const [productos, setProductos] = React.useState([])
  const [clienteId, setClienteId] = React.useState("")
  const [tab, setTab] = React.useState("product")
  const [lineas, setLineas] = React.useState([])
  const [notas, setNotas] = React.useState("")
  const [dias, setDias] = React.useState("0")
  // Apagado por defecto: descontar es la acción IRREVERSIBLE de esta pantalla,
  // y tenerla encendida de salida hacía que una factura a medio capturar
  // moviera existencias en cuanto alguien pulsaba guardar.
  const [descontar, setDescontar] = React.useState(false)
  const [busca, setBusca] = React.useState("")
  const [error, setError] = React.useState("")
  const [guardando, setGuardando] = React.useState(false)
  const [cargando, setCargando] = React.useState(editando)
  const [original, setOriginal] = React.useState(null)
  const [vence, setVence] = React.useState("")
  const [doc, setDoc] = React.useState({ ...DOC_VACIO })
  const [verEmbarque, setVerEmbarque] = React.useState(false)
  const [nuevoCliente, setNuevoCliente] = React.useState(false)
  const [nuevoSku, setNuevoSku] = React.useState(false)
  // Solo se puede fijar al CREAR: create_invoice acepta p_date, update_invoice
  // no. Al editar se pinta de solo lectura.
  const [emitida, setEmitida] = React.useState(hoyISO())
  const [confirmaInventario, setConfirmaInventario] = React.useState(false)
  const [base, setBase] = React.useState(null)

  React.useEffect(() => {
    supabase
      .from("client")
      // address y country se traen para poder enseñarlos como placeholder de
      // los campos alternos: así se ve qué se va a imprimir si se dejan vacíos.
      .select("id,name,payment_terms,balance,address,country")
      .order("name")
      .then(({ data }) => {
        setClientes(data ?? [])
        if (data?.length) {
          setClienteId(data[0].id)
          setDias(String(data[0].payment_terms ?? 0))
        }
      })
    supabase
      .from("product")
      .select("id,sku,description,unit,qty_unit,stock,sale_price")
      .order("sku")
      .then(({ data }) => setProductos(data ?? []))
  }, [])

  // Editing: pull the saved document back into editable lines. desdeFilas
  // re-derives bultos for product rows saved before that column existed, and
  // leaves miscelláneos blank because there is nothing to infer from.
  React.useEffect(() => {
    if (!editando) return
    let vivo = true
    supabase
      .from("invoice")
      .select("*, transaction(*, product(id,sku,description,unit,qty_unit,stock,sale_price))")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setError(error.message)
        else if (data) {
          setOriginal(data)
          setClienteId(data.client_id)
          setNotas(data.notes ?? "")
          setVence(data.due_date ?? "")
          setEmitida(String(data.date_created ?? "").slice(0, 10))
          // Se lee del estado guardado, NO del valor por defecto. Ponerlo en
          // false al abrir una factura ya emitida haría que guardarla la
          // devolviera a borrador y regresara el stock sin que nadie lo pida.
          setDescontar(data.status !== "draft")
          setDoc(Object.fromEntries(CAMPOS_DOC.map(([k]) => [k, data[k] ?? ""])))
          // Si la factura ya trae datos de embarque, abre la sección para que
          // no queden escondidos detrás de un colapsable.
          setVerEmbarque(CAMPOS_DOC.some(([k]) => data[k]))
          const iniciales = desdeFilas(
            data.transaction ?? [],
            (data.transaction ?? []).map((t) => t.product).filter(Boolean)
          )
          setLineas(iniciales)
          // La referencia contra la que se decide si hay cambios sin guardar.
          // Se congela AQUÍ y no se recalcula después: rehacer desdeFilas más
          // tarde usaría el catálogo de productos, que puede no haber llegado
          // todavía, y una línea vieja sin bultos guardados se rederivaría
          // distinta — dando un «hay cambios» que nadie hizo.
          setBase(JSON.stringify(aPayload(iniciales)))
        }
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [id, editando])

  const cliente = clientes.find((c) => c.id === clienteId)

  function elegirCliente(id) {
    setClienteId(id)
    const c = clientes.find((x) => x.id === id)
    if (c) setDias(String(c.payment_terms ?? 0))
  }

  // Every mutation goes through lineas.js and addresses lines by their stable
  // id, so the filtered tab view can never edit or delete the wrong row.
  const set = (id, patch) => setLineas((ls) => actualiza(ls, id, patch))
  const quitar = (id) => setLineas((ls) => elimina(ls, id))

  const agregar = (p) => {
    setLineas((ls) => agregaProducto(ls, p))
    setBusca("")
  }

  const visibles = porTipo(lineas, tab)
  const cuenta = (t) => porTipo(lineas, t).length || ""
  const total = totalDe(lineas)
  const bultosTotales = lineas.reduce((t, l) => t + (llevaBultos(l.type) ? Number(l.bultos || 0) : 0), 0)

  const q = busca.trim().toLowerCase()
  const sugerencias = q
    ? productos.filter((p) => `${p.sku} ${p.description ?? ""}`.toLowerCase().includes(q)).slice(0, 4)
    : []

  // In create mode the terms dropdown drives the date. In edit mode the stored
  // due_date is loaded as-is — recomputing it from today would silently move
  // the due date of an invoice issued weeks ago every time someone saved it.
  const aplicarTerminos = (d) => {
    setDias(d)
    setVence(Number(d) > 0 ? masDias(hoyISO(), d) : "")
  }
  const faltantes = incompletas(lineas)

  // Units this invoice ALREADY holds. Only an issued invoice has taken any —
  // a draft reserves nothing, so editing one competes with the full free stock.
  const yaReservado = React.useMemo(() => {
    if (!editando || !original || original.status === "draft") return {}
    const m = {}
    for (const t of original.transaction ?? []) {
      if (t.type === "product" && t.product_id)
        m[t.product_id] = (m[t.product_id] ?? 0) + Number(t.qty ?? 0)
    }
    return m
  }, [editando, original])

  const cortos = descontar ? sinExistencia(lineas, yaReservado) : []
  const puedeGuardar = lineas.length > 0 && faltantes.length === 0 && clienteId && !guardando

  /* ------------------------------------------------- cambios sin guardar -- */
  // Se compara contra lo CARGADO, no contra un flag que cada onChange tendría
  // que acordarse de levantar: ese flag se olvida en el primer campo nuevo que
  // alguien añada, y entonces el aviso deja de salir sin que nadie lo note.
  const hayDoc = CAMPOS_DOC.some(([k]) => (doc[k] ?? "").trim())
  const sucio = React.useMemo(() => {
    // Al guardar se apaga: si no, el propio navigate() del guardado abriría el
    // aviso de «vas a perder los cambios» justo después de guardarlos.
    if (guardando) return false
    // Capturando: cuenta también la cabecera. Escribir una razón social larga
    // y perderla por no haber puesto renglones todavía sería absurdo.
    if (!editando) return lineas.length > 0 || hayDoc || notas.trim() !== ""
    if (!original || base === null) return false
    return (
      !CAMPOS_DOC.every(([k]) => (doc[k] ?? "") === (original[k] ?? "")) ||
      clienteId !== original.client_id ||
      notas !== (original.notes ?? "") ||
      vence !== (original.due_date ?? "") ||
      descontar !== (original.status !== "draft") ||
      JSON.stringify(aPayload(lineas)) !== base
    )
  }, [guardando, editando, original, base, lineas, clienteId, notas, vence, descontar, doc, hayDoc])

  // Navegación DENTRO de la app: pestañas del menú, «cancelar y volver» y el
  // botón atrás del navegador. Necesita el data router de App.jsx.
  const bloqueo = useBlocker(sucio)

  // Y esto es lo otro: useBlocker no ve cerrar ni recargar la pestaña.
  React.useEffect(() => {
    if (!sucio) return
    const alSalir = (e) => e.preventDefault()
    window.addEventListener("beforeunload", alSalir)
    return () => window.removeEventListener("beforeunload", alSalir)
  }, [sucio])

  /* ------------------------------------------------------ qué hace el botón */
  // El botón dice EXACTAMENTE lo que va a pasar. Antes decía «Emitir factura»
  // con un ✓ tanto si creaba un borrador como si movía inventario, y no había
  // manera de saber cuál de las tres cosas estabas haciendo.
  const accion = descontar
    ? { texto: editando ? "Guardar y aplicar al inventario" : "Crear y aplicar al inventario", Icono: PackageCheck }
    : { texto: editando ? "Guardar cambios" : "Guardar borrador", Icono: Save }

  // Lo que de verdad sale del almacén, para que el aviso diga una cifra y no
  // una advertencia genérica que nadie lee.
  const aDescontar = React.useMemo(
    () => porTipo(lineas, "product").reduce((t, l) => t + Number(l.qty || 0), 0),
    [lineas]
  )
  const skusTocados = porTipo(lineas, "product").length

  function alPulsarGuardar() {
    if (!puedeGuardar) return
    // Solo se pregunta por lo irreversible. Guardar un borrador no mueve nada,
    // así que interrumpir ahí sería ruido que enseña a ignorar los diálogos.
    if (descontar) setConfirmaInventario(true)
    else guardar()
  }

  async function guardar() {
    setConfirmaInventario(false)
    setError("")
    setGuardando(true)
    try {
      const comun = {
        p_lines: aPayload(lineas),
        p_status: descontar ? "active" : "draft",
        // '' clears the note; null would mean "leave it alone" server-side.
        p_notes: notas.trim(),
        p_due_date: vence || null,
        p_doc: doc,
      }
      if (editando) {
        await rpc("update_invoice", { p_invoice_id: id, p_client_id: clienteId, ...comun })
        navigate(`/facturas/${id}`)
      } else {
        // p_date solo existe al crear: update_invoice no puede mover
        // date_created, así que al editar la fecha es de solo lectura.
        const nuevo = await rpc("create_invoice", {
          p_client_id: clienteId,
          p_date: emitida || null,
          ...comun,
        })
        navigate(`/facturas/${nuevo}`)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <div className="p-6 text-sm text-neutral-700">Cargando…</div>
  if (editando && !original) {
    return (
      <div className="registro p-10 text-center">
        <div className="text-base font-semibold">Esa factura no existe</div>
        <Link to="/facturas" className="mt-4 inline-block text-[13px] underline underline-offset-2">
          Volver a facturas
        </Link>
      </div>
    )
  }

  const campo =
    "entrada-texto h-8 px-2.5"

  return (
    <div className="flex flex-col gap-3">
      <Link
        to={editando ? `/facturas/${id}` : "/facturas"}
        className="flex items-center gap-2 self-start text-[13px]"
      >
        <ArrowLeft className="size-4" />
        {editando ? "Descartar cambios" : "Cancelar y volver"}
      </Link>

      <section className="registro p-6">
        <div className="mb-4 flex flex-wrap items-start gap-4">
          <div>
            <div className="rotulo">
              {editando ? "Edición" : "Captura"}
            </div>
            <h2 className="m-0 text-[25px] font-semibold">
              {editando ? original.invoice_num : "Nueva factura"}
            </h2>
            <div className="text-[13px] text-neutral-700">
              {editando
                ? `Emitida ${fecha(original.date_created)} · se reemplazan todos los renglones`
                : "El folio se asigna al guardar"}
            </div>
          </div>
          <button
            onClick={alPulsarGuardar}
            disabled={!puedeGuardar}
            className="boton boton-ink ml-auto"
          >
            <accion.Icono className="size-4" />
            {guardando ? "Guardando…" : accion.texto}
          </button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2.5">
          <div className="casilla px-4 py-2.5">
            <span className="rotulo">Cliente</span>
            <div className="flex items-center gap-2">
              <select
                value={clienteId}
                onChange={(e) => elegirCliente(e.target.value)}
                className="mt-0.5 min-w-0 flex-1 bg-transparent text-base outline-none"
              >
                {clientes.length === 0 && <option value="">Todavía no hay clientes</option>}
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {/* Alta sin salir: navegar a /clientes se llevaría los renglones. */}
              <button
                type="button"
                onClick={() => setNuevoCliente(true)}
                title="Crear un cliente sin salir de la factura"
                className="accion shrink-0"
              >
                <UserPlus className="size-4" />
              </button>
            </div>
          </div>

          {/* La fecha SOLO se elige al crear: create_invoice acepta p_date pero
              update_invoice no puede mover date_created. Al editar se enseña
              en gris para que se vea cuál es sin prometer que se puede cambiar. */}
          <label className="block casilla px-4 py-2.5">
            <span className="rotulo">Fecha de emisión</span>
            {editando ? (
              <span className="mt-0.5 block text-base tabular-nums text-neutral-700">
                {fecha(original.date_created)}
              </span>
            ) : (
              <input
                type="date"
                value={emitida}
                // create_invoice rechaza fechas futuras: casi siempre son un
                // dedazo, y dejarían la factura fuera de todo reporte.
                max={hoyISO()}
                onChange={(e) => setEmitida(e.target.value)}
                className="mt-0.5 w-full bg-transparent text-base tabular-nums outline-none"
              />
            )}
            <span className="text-[11px] text-neutral-700">
              {editando ? "No se puede cambiar" : "Antedatar sí, adelantar no"}
            </span>
          </label>

          <label className="block casilla px-4 py-2.5">
            <span className="rotulo">
              Condiciones de pago
            </span>
            <select
              value={dias}
              onChange={(e) => aplicarTerminos(e.target.value)}
              className="mt-0.5 w-full bg-transparent text-base outline-none"
            >
              <option value="0">Contado</option>
              <option value="15">Neto 15</option>
              <option value="30">Neto 30</option>
              <option value="45">Neto 45</option>
              <option value="60">Neto 60</option>
            </select>
          </label>

          <label className="block casilla px-4 py-2.5">
            <span className="rotulo">Vence</span>
            <input
              type="date"
              value={vence}
              onChange={(e) => setVence(e.target.value)}
              className="mt-0.5 w-full bg-transparent text-base tabular-nums outline-none"
            />
            <span className="text-[11px] text-neutral-700">
              {vence ? fecha(vence) : "Contado · pago inmediato"}
            </span>
          </label>

          <div className="casilla px-4 py-2.5">
            <div className="rotulo">
              Saldo del cliente
            </div>
            <div className="mt-1 text-base tabular-nums">{usd(cliente?.balance ?? 0)}</div>
          </div>
        </div>

        <button
          onClick={() => setDescontar((v) => !v)}
          className={cn(
            "mt-2.5 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left",
            descontar ? "bg-ink text-paper" : "bg-paper text-ink"
          )}
        >
          <span
            className={cn(
              "flex h-[26px] w-[46px] shrink-0 items-center rounded-full p-[3px]",
              descontar ? "justify-end bg-paper/40" : "justify-start bg-ink/15"
            )}
          >
            <span className={cn("block size-5 rounded-full", descontar ? "bg-paper" : "bg-newsprint")} />
          </span>
          <span>
            <span className="block text-[15px] font-semibold">Descontar del inventario</span>
            <span className="block text-xs opacity-75">
              {editando
                ? descontar
                  ? original.status === "draft"
                    ? "Al guardar pasa a activa y descuenta la existencia."
                    : "Sigue activa: solo se ajusta la diferencia de existencia."
                  : original.status === "draft"
                    ? "Sigue como borrador: el inventario no se mueve."
                    : "Al guardar vuelve a borrador y devuelve la existencia."
                : descontar
                  ? "Se emite como activa: la existencia baja al guardar."
                  : "Se guarda como borrador: el inventario no se mueve."}
            </span>
          </span>
          <Cuboid className="ml-auto size-6" />
        </button>
      </section>

      {/* Datos de embarque — colapsado por defecto: son opcionales y la mayoría
          de las facturas no los usan, pero cuando hacen falta salen impresos
          tanto en la factura como en el packing list. */}
      <section className="registro p-6">
        <button
          onClick={() => setVerEmbarque((v) => !v)}
          className="flex w-full items-center gap-3 text-left"
        >
          <Ship className="size-[18px] text-neutral-700" />
          <span className="font-semibold">Datos del documento</span>
          <span className="text-[13px] text-neutral-700">
            {CAMPOS_DOC.filter(([k]) => doc[k]?.trim()).length || "ninguno"}
            {CAMPOS_DOC.filter(([k]) => doc[k]?.trim()).length ? " capturados" : ""} · opcionales,
            solo se imprimen
          </span>
          <span className="ml-auto text-[13px]">{verEmbarque ? "Ocultar" : "Mostrar"}</span>
        </button>

        {verEmbarque && (
          <>
            <p className="mt-3 mb-0 max-w-[70ch] text-[13px] text-neutral-700">
              Los tres primeros salen de la ficha del cliente. Escríbelos solo si esta factura
              debe imprimirse a otro nombre o dirección — el saldo sigue yendo a{" "}
              {cliente?.name ?? "el cliente"} y el buscador la sigue encontrando por su nombre real.
            </p>
            <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2.5">
              {CAMPOS_DOC.map(([k, etiqueta, ph, deCliente]) => (
                <label key={k} className="block casilla px-4 py-2.5">
                  <span className="rotulo">{etiqueta}</span>
                  <input
                    value={doc[k] ?? ""}
                    onChange={(e) => setDoc({ ...doc, [k]: e.target.value })}
                    // Para los alternos el placeholder es el dato REAL del
                    // cliente: así se ve qué se va a imprimir si se deja en
                    // blanco, sin tener que explicarlo con un texto de ayuda.
                    placeholder={deCliente ? (cliente?.[deCliente] ?? "") : ph}
                    className="mt-0.5 w-full bg-transparent text-base outline-none"
                  />
                </label>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.56fr)]">
        <div className="flex flex-col gap-3">
          <section className="registro p-6">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="inline-flex overflow-hidden rounded-md border border-neutral-300">
                {TABS.map(({ id, label, icon: Icon }, i) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-1.5 text-[13px] transition-colors",
                      i > 0 && "border-l border-neutral-300",
                      tab === id ? "bg-ink text-paper" : "text-ink"
                    )}
                  >
                    <Icon className="size-4" />
                    {label} {cuenta(id)}
                  </button>
                ))}
              </div>
              {tab === "product" ? (
                <div className="ml-auto flex items-center gap-2">
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter adds the top hit, so a fast typist never leaves the
                      // keyboard: type three letters, Enter, next SKU.
                      if (e.key === "Enter" && sugerencias[0]) {
                        e.preventDefault()
                        agregar(sugerencias[0])
                      }
                    }}
                    placeholder="Buscar SKU para agregar"
                    className="entrada-texto w-[250px]"
                  />
                  <button
                    onClick={() => setNuevoSku(true)}
                    title="Crear un SKU sin salir de la factura"
                    className="boton boton-claro shrink-0 gap-1.5 text-[13px]"
                  >
                    <PackagePlus className="size-4" />
                    Nuevo SKU
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setLineas((ls) => agrega(ls, lineaSuelta(tab)))}
                  className="boton boton-claro ml-auto text-[13px]"
                >
                  <Plus className="size-4" />
                  Agregar renglón
                </button>
              )}
            </div>

            {/* A search result is not obviously an action, so say so outright:
                a standing instruction, a per-row "Agregar" pill with a plus,
                and a pointer cursor. Enter adds the first hit. */}
            {/* Buscó algo y no existe: ofrecer crearlo con ese nombre ya puesto */}
            {tab === "product" && busca.trim() && sugerencias.length === 0 && (
              <button
                onClick={() => setNuevoSku(true)}
                className="mb-3 flex w-full items-center gap-2 casilla p-3 text-left text-[13px] hover:shadow-sm"
              >
                <PackagePlus className="size-4 shrink-0" />
                <span>
                  Ningún SKU coincide con «<b>{busca.trim()}</b>». Crearlo ahora.
                </span>
              </button>
            )}

            {sugerencias.length > 0 && (
              <div className="mb-3 casilla/60 p-2">
                <div className="flex items-center gap-2 px-1.5 pb-2 text-[11px] text-neutral-700">
                  <CornerDownLeft className="size-3.5" />
                  Haz clic en un SKU para agregarlo — o pulsa Enter para el primero
                </div>
                <div className="flex flex-col gap-1.5">
                  {sugerencias.map((p, i) => (
                    <button
                      key={p.id}
                      onClick={() => agregar(p)}
                      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 casilla p-2.5 text-left ring-ink transition hover:shadow-md hover:ring-1 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm">{p.description || p.sku}</div>
                        <div className="text-[11px] text-neutral-700 tabular-nums">
                          {p.sku} · {p.qty_unit > 1 ? `${p.qty_unit} por bulto` : "suelto"} ·{" "}
                          {p.unit ?? "PZA"}
                        </div>
                      </div>
                      <div className="text-xs text-neutral-700 tabular-nums">
                        existencia {n0(p.stock)}
                      </div>
                      <div className="text-sm tabular-nums">
                        {p.sale_price == null ? "sin precio" : usd(p.sale_price)}
                      </div>
                      <span className="flex items-center gap-1.5 rounded-md bg-newsprint px-3 py-1.5 text-[12px] font-semibold transition-colors group-hover:bg-ink group-hover:text-paper">
                        <PlusCircle className="size-4" />
                        Agregar
                        {i === 0 && (
                          <kbd className="ml-0.5 rounded bg-ink/10 px-1 py-px font-sans text-[10px] group-hover:bg-paper/20">
                            ⏎
                          </kbd>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {visibles.length === 0 && (
              <div className="casilla p-10 text-center">
                <div className="text-base font-semibold">
                  {tab === "product" ? "Busca un SKU arriba para agregarlo" : "Sin renglones"}
                </div>
                <div className="text-[13px] text-neutral-700">
                  {tab === "product"
                    ? "Los productos mueven inventario."
                    : tab === "charge"
                      ? "Fletes y servicios: sin bultos ni unidad."
                      : "Artículos fuera del catálogo. Llevan bultos, pero no tocan inventario."}
                </div>
              </div>
            )}

            {/* Column headers. Cantidad and Bultos always sit side by side so
                it is visible which number is raw units (what moves stock) and
                which is packages. */}
            {visibles.length > 0 && (
              <div className={cn("grid items-end gap-2 px-3 pb-2", GRID[tab], TH)}>
                <div>{tab === "product" ? "Producto" : "Concepto"}</div>
                <div className="text-right">
                  Cantidad<span className={SUB}>unidades</span>
                </div>
                {llevaBultos(tab) && (
                  <div className="text-right">
                    Bultos<span className={SUB}>paquetes</span>
                  </div>
                )}
                {llevaBultos(tab) && <div>Unidad</div>}
                <div className="text-right">{tab === "charge" ? "Monto" : "Precio"}</div>
                <div className="text-right">Importe</div>
                <div />
              </div>
            )}

            <div className="flex flex-col gap-2">
              {visibles.map((l) => (
                <div key={l.id} className={cn("grid items-center gap-2 casilla p-3", GRID[l.type])}>
                  {/* concepto */}
                  {l.type === "product" ? (
                    <div className="min-w-0">
                      <div className="truncate text-sm">{l.nombre}</div>
                      <div className="text-[11px] text-neutral-700 tabular-nums">
                        {l.sku} ·{" "}
                        {descontar && Number(l.qty) > disponible(l, yaReservado)
                          ? `excede disponible (${n0(disponible(l, yaReservado))})`
                          : `${l.piezasPorBulto} por bulto · disp. ${n0(disponible(l, yaReservado))}`}
                      </div>
                    </div>
                  ) : (
                    <input
                      value={l.description}
                      onChange={(e) => set(l.id, { description: e.target.value })}
                      placeholder={l.type === "charge" ? "Concepto del cargo" : "Concepto"}
                      className={campo}
                    />
                  )}

                  {/* Cantidad y bultos: se escribe en el que se toque.
                      Antes había una columna aparte con un par de botones
                      «Cant.|Bultos» de 11px para elegir cuál mandaba. Sobra:
                      el campo que quieres llenar ya lo estás señalando con el
                      cursor. Al enfocar el atenuado, pasa a ser el que manda y
                      el otro se recalcula. */}
                  <input
                    value={l.qty}
                    onChange={(e) => set(l.id, { qty: e.target.value, modo: "qty" })}
                    onFocus={() => convierteBultos(l.type) && set(l.id, { modo: "qty" })}
                    readOnly={convierteBultos(l.type) && l.modo === "bultos"}
                    inputMode="numeric"
                    title={
                      convierteBultos(l.type) && l.modo === "bultos"
                        ? "Sale de los bultos. Haz clic para escribir unidades."
                        : undefined
                    }
                    className={cn(
                      campo,
                      "text-right tabular-nums",
                      convierteBultos(l.type) &&
                        l.modo === "bultos" &&
                        "cursor-pointer border-dashed text-neutral-700"
                    )}
                  />

                  {/* bultos — derived for products, free for misceláneos, absent for cargos */}
                  {llevaBultos(l.type) && (
                    <input
                      value={l.bultos ?? ""}
                      onChange={(e) => set(l.id, { bultos: e.target.value, modo: "bultos" })}
                      onFocus={() => convierteBultos(l.type) && set(l.id, { modo: "bultos" })}
                      readOnly={convierteBultos(l.type) && l.modo === "qty"}
                      inputMode="decimal"
                      placeholder={convierteBultos(l.type) ? "" : "—"}
                      title={
                        convierteBultos(l.type) && l.modo === "qty"
                          ? "Sale de las unidades. Haz clic para escribir bultos."
                          : undefined
                      }
                      className={cn(
                        campo,
                        "text-right tabular-nums",
                        convierteBultos(l.type) &&
                          l.modo === "qty" &&
                          "cursor-pointer border-dashed text-neutral-700"
                      )}
                    />
                  )}

                  {llevaBultos(l.type) && (
                    <input
                      value={l.unit ?? ""}
                      onChange={(e) => set(l.id, { unit: e.target.value.toUpperCase() })}
                      list="unidades-erp"
                      placeholder="PZA"
                      className={cn(campo, "px-2 text-center")}
                    />
                  )}

                  <input
                    value={l.unit_price}
                    onChange={(e) => set(l.id, { unit_price: e.target.value })}
                    inputMode="decimal"
                    placeholder={l.type === "charge" ? "Monto" : "Precio"}
                    className={cn(campo, "text-right tabular-nums")}
                  />
                  <div className="text-right text-[15px] font-semibold tabular-nums">
                    {usd(importe(l))}
                  </div>
                  <button
                    onClick={() => quitar(l.id)}
                    title="Quitar renglón"
                    className="accion justify-self-end"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            <datalist id="unidades-erp">
              {UNIDADES.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </section>

          <section className="registro p-6">
            <h4 className="m-0 mb-3 font-semibold">Notas al cliente</h4>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Instrucciones de entrega, acuerdos de precio, referencias…"
              className="min-h-[88px] w-full resize-y casilla px-4 py-3 text-sm outline-none"
            />
          </section>
        </div>

        <aside className="sticky top-4 flex flex-col gap-3 registro p-6 text-sm">
          <h4 className="m-0 mb-1 font-semibold">Resumen</h4>
          {TABS.map(({ id, label }) => {
            const sub = subtotalTipo(lineas, id)
            return (
              <div key={id} className="flex justify-between">
                <span className="text-neutral-700">{label}</span>
                <span className="tabular-nums">{sub ? usd(sub) : "—"}</span>
              </div>
            )
          })}
          <div className="flex justify-between border-t border-ink/10 pt-2">
            <span className="text-neutral-700">Bultos totales</span>
            <span className="tabular-nums">{bultosTotales ? n0(bultosTotales) : "—"}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between casilla px-3 py-2.5">
            <span className="text-[15px] font-semibold">Total</span>
            <span className="text-[27px] font-semibold tracking-[-0.02em] tabular-nums">
              {usd(total)}
            </span>
          </div>

          {cortos.length > 0 && (
            <div className="casilla p-3 text-[13px]">
              Sin existencia suficiente para {cortos.map((l) => l.sku).join(", ")}. El servidor
              rechazará la factura al emitirla — bájala a borrador o ajusta la cantidad.
            </div>
          )}
          {error && <div className="rounded-md bg-ink p-3 text-[13px] text-paper">{error}</div>}

          <button
            onClick={alPulsarGuardar}
            disabled={!puedeGuardar}
            className="boton boton-ink w-full justify-center"
          >
            <accion.Icono className="size-4" />
            {guardando ? "Guardando…" : accion.texto}
          </button>
          <div className="text-center text-xs text-neutral-700">
            {lineas.length === 0
              ? "Agrega al menos un renglón."
              : faltantes.length > 0
                ? `Faltan datos en ${faltantes.length} renglón${faltantes.length > 1 ? "es" : ""}.`
                : descontar
                  ? "Se emite activa y descuenta inventario."
                  : "Se guarda como borrador, sin mover inventario."}
          </div>
        </aside>
      </div>

      <Confirmar
        abierto={bloqueo.state === "blocked"}
        titulo="Hay cambios sin guardar"
        descripcion={
          editando
            ? "Si sales ahora, los cambios de esta factura se pierden."
            : "Si sales ahora, esta factura se pierde entera: todavía no se ha guardado nada."
        }
        detalles={
          lineas.length
            ? [`${lineas.length} ${lineas.length === 1 ? "renglón capturado" : "renglones capturados"} por ${usd(total)}.`]
            : []
        }
        textoConfirmar="Salir sin guardar"
        textoOcupado="Saliendo…"
        onConfirmar={() => bloqueo.proceed?.()}
        onCancelar={() => bloqueo.reset?.()}
      />

      {/* Solo para lo irreversible. Guardar un borrador no abre nada: un
          diálogo que sale siempre es un diálogo que se cierra sin leer. */}
      <Confirmar
        abierto={confirmaInventario}
        titulo={editando ? "Aplicar los cambios al inventario" : "Aplicar esta factura al inventario"}
        descripcion={
          editando
            ? `Se ajustará la existencia por la diferencia contra lo que ${original?.invoice_num ?? "la factura"} tiene guardado.`
            : `Saldrán del almacén ${n0(aDescontar)} unidades de ${skusTocados} ${skusTocados === 1 ? "SKU" : "SKU distintos"}.`
        }
        detalles={
          cortos.length
            ? cortos.map(
                (l) => `${l.sku}: pides ${n0(l.qty)} y hay ${n0(disponible(l, yaReservado))} disponibles.`
              )
            : []
        }
        textoConfirmar={editando ? "Guardar y aplicar" : "Crear y aplicar"}
        textoOcupado="Guardando…"
        ocupado={guardando}
        onConfirmar={guardar}
        onCancelar={() => setConfirmaInventario(false)}
      />

      <CrearCliente
        abierto={nuevoCliente}
        onCancelar={() => setNuevoCliente(false)}
        onCreado={(c) => {
          // Entra a la lista Y queda elegido: es justo para lo que se abrió.
          setClientes((cs) => [...cs, c].sort((a, b) => a.name.localeCompare(b.name)))
          setClienteId(c.id)
          aplicarTerminos(String(c.payment_terms ?? 0))
          setNuevoCliente(false)
        }}
      />

      <CrearProducto
        abierto={nuevoSku}
        skuInicial={busca.trim()}
        onCancelar={() => setNuevoSku(false)}
        onCreado={(p) => {
          setProductos((ps) => [...ps, p].sort((a, b) => a.sku.localeCompare(b.sku)))
          agregar(p) // ya queda como renglón, sin buscarlo otra vez
          setNuevoSku(false)
        }}
      />
    </div>
  )
}
