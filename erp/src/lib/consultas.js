import { supabase, rpc } from "./supabase"
import { usd, n0, fecha } from "./format"
import { sumar } from "./dinero"
import { filtroTexto } from "./lista"
import { argsRpc, desdeRpc } from "./resumen"
import { INTENCIONES, SOCIALES } from "./intenciones"

/**
 * Los ejecutores del catálogo de intenciones.
 *
 * Aquí es donde la app contesta: recibe `{intencion, parametros}` YA VALIDADO
 * y corre la consulta real. El modelo no participa de este lado — por eso
 * ninguna cifra que se pinte puede haber sido inventada.
 *
 * TODO ES SOLO LECTURA. Ningún ejecutor escribe; crear productos o facturas
 * viene después y por otra puerta, con vista previa y confirmación.
 *
 * RLS sigue haciendo su trabajo: las consultas salen con la sesión de quien
 * pregunta, así que el asistente no puede enseñar nada que esa persona no
 * pudiera abrir a mano.
 *
 * Varias de estas ya existían — resumen_dashboard, invoice_listado,
 * totales_productos — de arreglar la paginación. Se reusan tal cual en lugar
 * de escribir una segunda versión que tarde o temprano daría otro número.
 */

/* ------------------------------------------------------------- resultados -- */
// Tres formas y nada más, para que la pantalla no tenga un caso por intención.
//
// Todas llevan `resumen`: la frase en español que se lee arriba del dato.
//
// ESA FRASE LA ESCRIBE LA APP, NUNCA EL MODELO. Es lo que hace que el asistente
// se sienta una conversación sin poder equivocarse: las cifras que aparecen en
// el texto son las mismas que vienen de Postgres, interpoladas aquí. Si la
// redactara el modelo tendría que leerle los números y repetirlos, y ahí es
// donde un modelo transpone dígitos con total seguridad.

const cifra = (resumen, titulo, valor, detalle = null, enlace = null) => ({
  tipo: "cifra",
  resumen,
  titulo,
  valor,
  detalle,
  enlace,
})

const tabla = (
  resumen,
  titulo,
  columnas,
  filas,
  { vacio = "Sin resultados.", enlace = null } = {}
) => ({
  tipo: "tabla",
  resumen,
  titulo,
  columnas,
  filas,
  vacio,
  enlace,
})

const ficha = (resumen, titulo, campos, { subtitulo = null, enlace = null } = {}) => ({
  tipo: "ficha",
  resumen,
  titulo,
  subtitulo,
  campos,
  enlace,
})

/**
 * Cuarta forma: una respuesta que es solo texto.
 *
 * Rompe el «tres formas y ya», y vale la pena: un saludo no tiene dato de
 * respaldo que enseñar, y meterlo a la fuerza en una ficha vacía se vería peor
 * que tener un caso más.
 */
const mensaje = (resumen, sugerencias = []) => ({ tipo: "mensaje", resumen, sugerencias })

/** «3 facturas» / «1 factura» — sin el «(s)» que delata una plantilla. */
const plural = (n, singular, prural) => `${n0(n)} ${n === 1 ? singular : prural}`

/** Un fallo de consulta se cuenta como tal, no se disfraza de «sin datos». */
const revienta = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Encuentra UN producto por SKU o por descripción.
 *
 * El SKU viene del modelo copiando lo que escribió el usuario, así que puede
 * ser parcial («la esponja») o traer comodines. filtroTexto() los escapa: sin
 * eso, preguntar por «100%» traería medio catálogo.
 */
async function buscaProducto(texto) {
  let q = supabase.from("product").select("*").limit(5)
  const f = filtroTexto(texto, ["sku", "description"])
  if (f) q = q.or(f)
  const filas = revienta(await q)

  if (!filas.length) return { error: `No encontré ningún producto que coincida con «${texto}».` }
  // Coincidencia exacta de SKU gana sobre cualquier parcial.
  const exacto = filas.find((p) => p.sku.toLowerCase() === texto.trim().toLowerCase())
  if (exacto) return { producto: exacto }
  if (filas.length > 1)
    return {
      ambiguo: filas,
      error: `«${texto}» coincide con ${filas.length} productos. Sé más específico.`,
    }
  return { producto: filas[0] }
}

async function buscaCliente(texto) {
  let q = supabase.from("client").select("*").limit(5)
  const f = filtroTexto(texto, ["name", "identifier"])
  if (f) q = q.or(f)
  const filas = revienta(await q)

  if (!filas.length) return { error: `No encontré ningún cliente que coincida con «${texto}».` }
  const exacto = filas.find((c) => c.name.toLowerCase() === texto.trim().toLowerCase())
  if (exacto) return { cliente: exacto }
  if (filas.length > 1)
    return { error: `«${texto}» coincide con ${filas.length} clientes. Sé más específico.` }
  return { cliente: filas[0] }
}

const ETIQUETA_PERIODO = { anio: "del año", mes: "del mes", semana: "de la semana" }

/** Preguntas de ejemplo, repartidas por el catálogo y sin las sociales. */
function muestrario(cuantas) {
  const reales = Object.entries(INTENCIONES).filter(([n]) => !SOCIALES.has(n))
  const paso = Math.max(1, Math.floor(reales.length / cuantas))
  const salida = []
  for (let i = 0; i < reales.length && salida.length < cuantas; i += paso) {
    salida.push(reales[i][1].ejemplos[0])
  }
  return salida
}

/** Lo que se contesta cuando la pregunta no cae en el catálogo. */
export function sinEntender() {
  return mensaje(
    "No supe qué consultar con eso. Puedo ayudarte con inventario, clientes, facturas y compras — prueba con una de estas:",
    muestrario(4)
  )
}

/* ------------------------------------------------------------ ejecutores -- */

const EJECUTORES = {
  async existencia_sku({ sku }) {
    const { producto: p, error } = await buscaProducto(sku)
    if (error) return { error }
    const agotado = Number(p.stock) === 0
    return ficha(
      agotado
        ? `${p.sku} está agotado.`
        : `Hay ${plural(p.stock, p.unit ?? "unidad", p.unit ?? "unidades")} de ${p.sku}` +
          (p.sale_price == null ? "." : `, a ${usd(p.sale_price)} cada uno.`),
      p.description || p.sku,
      [
        ["Existencia", `${n0(p.stock)} ${p.unit ?? "PZA"}`],
        ["Bultos", p.qty_unit > 1 ? n0(p.stock / p.qty_unit) : "—"],
        ["Costo", p.cost_price == null ? "sin costo" : usd(p.cost_price)],
        ["Precio", p.sale_price == null ? "sin precio" : usd(p.sale_price)],
      ],
      { subtitulo: `${p.sku}${p.qty_unit > 1 ? ` · ${p.qty_unit} por bulto` : ""}`,
        enlace: `/productos/${p.id}` }
    )
  },

  async sin_existencia() {
    const filas = revienta(
      await supabase.from("product").select("id,sku,description,unit").eq("stock", 0).order("sku").limit(50)
    )
    return tabla(
      filas.length === 0
        ? "Ningún producto está en cero."
        : `${plural(filas.length, "producto está agotado", "productos están agotados")}.`,
      "Productos agotados",
      [
        { k: "sku", etiqueta: "SKU" },
        { k: "description", etiqueta: "Descripción" },
      ],
      filas,
      { vacio: "Ningún producto está en cero.", enlace: "/productos" }
    )
  },

  async movimientos_sku({ sku }) {
    const { producto: p, error } = await buscaProducto(sku)
    if (error) return { error }
    const movs = revienta(
      await supabase
        .from("stock_movement")
        .select("*")
        .eq("product_id", p.id)
        .order("occurred_at", { ascending: false })
        .limit(20)
    )
    return tabla(
      movs.length === 0
        ? `${p.sku} no tiene movimientos registrados.`
        : `${p.sku} tuvo ${plural(movs.length, "movimiento", "movimientos")}; el último fue el ${fecha(movs[0].occurred_at)}. Hoy quedan ${n0(p.stock)}.`,
      `Movimientos de ${p.sku}`,
      [
        { k: "cuando", etiqueta: "Fecha" },
        { k: "referencia", etiqueta: "Documento" },
        { k: "contraparte", etiqueta: "Origen o destino" },
        { k: "cantidad", etiqueta: "Cantidad", align: "right" },
      ],
      movs.map((m) => ({
        cuando: fecha(m.occurred_at),
        referencia: m.reference ?? "Ajuste",
        contraparte: m.counterparty ?? m.description ?? "—",
        cantidad: `${m.qty_delta > 0 ? "+" : ""}${n0(m.qty_delta)}`,
      })),
      { vacio: "Este SKU no tiene movimientos.", enlace: `/productos/${p.id}` }
    )
  },

  async valor_inventario() {
    const t = await rpc("totales_productos")
    return cifra(
      `Tu inventario vale ${usd(t.valor_inventario)} a costo, repartido en ${plural(t.skus, "SKU", "SKU")}.` +
        (t.sin_costo > 0
          ? ` ${plural(t.sin_costo, "no tiene costo capturado y no se valuó", "no tienen costo capturado y no se valuaron")}.`
          : ""),
      "Inventario valuado a costo",
      usd(t.valor_inventario),
      `${n0(t.skus)} SKU${t.sin_costo > 0 ? ` · ${t.sin_costo} sin costo, no valuados` : ""}`,
      "/productos"
    )
  },

  async saldo_cliente({ cliente }) {
    const { cliente: c, error } = await buscaCliente(cliente)
    if (error) return { error }
    const abiertas = revienta(
      await supabase
        .from("invoice_listado")
        .select("invoice_num,date_created,due_date,saldo,estado")
        .eq("client_id", c.id)
        .gt("saldo", 0)
        .neq("status", "draft")
        .order("due_date")
        .limit(20)
    )
    const vencidas = abiertas.filter((f) => f.estado === "Vencida")
    return tabla(
      Number(c.balance) === 0
        ? `${c.name} no debe nada.`
        : `${c.name} te debe ${usd(c.balance)} en ${plural(abiertas.length, "factura abierta", "facturas abiertas")}.` +
          (vencidas.length ? ` ${plural(vencidas.length, "está vencida", "están vencidas")}.` : ""),
      `${c.name} debe ${usd(c.balance)}`,
      [
        { k: "invoice_num", etiqueta: "Folio" },
        { k: "emitida", etiqueta: "Emitida", align: "right" },
        { k: "vence", etiqueta: "Vence", align: "right" },
        { k: "saldoTxt", etiqueta: "Saldo", align: "right" },
        { k: "estado", etiqueta: "Estado" },
      ],
      abiertas.map((f) => ({
        ...f,
        emitida: fecha(f.date_created),
        vence: f.due_date ? fecha(f.due_date) : "—",
        saldoTxt: usd(f.saldo),
      })),
      { vacio: "No tiene facturas abiertas.", enlace: `/clientes/${c.id}` }
    )
  },

  async facturas_vencidas() {
    const filas = revienta(
      await supabase
        .from("invoice_listado")
        .select("invoice_num,client_name,due_date,saldo,dias_vencida")
        .eq("estado", "Vencida")
        .order("dias_vencida", { ascending: false })
        .limit(50)
    )
    const totalVencido = sumar(filas, (f) => f.saldo)
    return tabla(
      filas.length === 0
        ? "No tienes ninguna factura vencida."
        : `${plural(filas.length, "factura vencida", "facturas vencidas")} por ${usd(totalVencido)}. La más atrasada lleva ${n0(filas[0].dias_vencida)} días.`,
      "Facturas vencidas",
      [
        { k: "invoice_num", etiqueta: "Folio" },
        { k: "client_name", etiqueta: "Cliente" },
        { k: "vence", etiqueta: "Venció", align: "right" },
        { k: "dias", etiqueta: "Días", align: "right" },
        { k: "saldoTxt", etiqueta: "Saldo", align: "right" },
      ],
      filas.map((f) => ({
        ...f,
        vence: f.due_date ? fecha(f.due_date) : "—",
        dias: n0(f.dias_vencida),
        saldoTxt: usd(f.saldo),
      })),
      { vacio: "No hay facturas vencidas.", enlace: "/facturas" }
    )
  },

  async factura({ folio }) {
    let q = supabase.from("invoice_listado").select("*").limit(5)
    const f = filtroTexto(folio, ["invoice_num", "client_name"])
    if (f) q = q.or(f)
    const filas = revienta(await q)

    if (!filas.length) return { error: `No encontré ninguna factura «${folio}».` }
    if (filas.length > 1)
      return { error: `«${folio}» coincide con ${filas.length} facturas. Dame el folio completo.` }

    const i = filas[0]
    return ficha(
      `${i.invoice_num} es de ${i.client_name ?? "un cliente sin nombre"} por ${usd(i.total)}. ` +
        (i.estado === "Pagada"
          ? "Está pagada."
          : `Debe ${usd(i.saldo)}` +
            (i.estado === "Vencida" ? `, vencida hace ${n0(i.dias_vencida)} días.` : ".")),
      i.invoice_num,
      [
        ["Cliente", i.client_name ?? "—"],
        ["Emitida", fecha(i.date_created)],
        ["Vence", i.due_date ? fecha(i.due_date) : "contado"],
        ["Total", usd(i.total)],
        ["Pagado", usd(i.pagado)],
        ["Saldo", usd(i.saldo)],
        ["Estado", i.estado],
      ],
      { subtitulo: i.estado === "Vencida" ? `vencida hace ${n0(i.dias_vencida)} días` : null,
        enlace: `/facturas/${i.id}` }
    )
  },

  async por_cobrar() {
    // Del mismo RPC que alimenta el tablero: una sola definición de antigüedad.
    const r = desdeRpc(await rpc("resumen_dashboard", argsRpc("mes")), "mes")
    const total = sumar(r.edades, (e) => e.v)
    // Las cubetas 1..3 son las vencidas; la 0 es «por vencer».
    const vencido = sumar(r.edades.slice(1), (e) => e.v)
    return tabla(
      total.eq(0)
        ? "No te deben nada."
        : `Te deben ${usd(total)} en total` +
          (vencido.eq(0) ? ", nada vencido todavía." : `, de los cuales ${usd(vencido)} ya está vencido.`),
      `Por cobrar ${usd(total)}`,
      [
        { k: "k", etiqueta: "Antigüedad" },
        { k: "v", etiqueta: "Saldo", align: "right" },
      ],
      r.edades.map((e) => ({ k: e.k, v: usd(e.v) })),
      { enlace: "/clientes" }
    )
  },

  async ventas_periodo({ periodo }) {
    const r = desdeRpc(await rpc("resumen_dashboard", argsRpc(periodo)), periodo)
    const previo = r.barras.totalPrevio
    return cifra(
      r.numFacturas === 0
        ? `No has facturado nada ${ETIQUETA_PERIODO[periodo]}.`
        : `Facturaste ${usd(r.barras.totalActual)} ${ETIQUETA_PERIODO[periodo]}, en ${plural(r.numFacturas, "factura", "facturas")}.` +
          (previo.eq(0) ? "" : ` En el mismo periodo de ${r.barras.anioPrevio} fueron ${usd(previo)}.`),
      `Facturado ${ETIQUETA_PERIODO[periodo]}`,
      usd(r.barras.totalActual),
      previo.eq(0)
        ? `${n0(r.numFacturas)} facturas`
        : `${n0(r.numFacturas)} facturas · ${usd(previo)} en ${r.barras.anioPrevio}`,
      "/"
    )
  },

  async top_skus({ periodo }) {
    const r = desdeRpc(await rpc("resumen_dashboard", argsRpc(periodo)), periodo)
    return tabla(
      r.top.length === 0
        ? `No vendiste productos ${ETIQUETA_PERIODO[periodo]}.`
        : `Lo que más vendiste ${ETIQUETA_PERIODO[periodo]} fue ${r.top[0].sku} con ${usd(r.top[0].importe)}.`,
      `Más vendidos ${ETIQUETA_PERIODO[periodo]}`,
      [
        { k: "sku", etiqueta: "SKU" },
        { k: "nombre", etiqueta: "Producto" },
        { k: "unidadesTxt", etiqueta: "Unidades", align: "right" },
        { k: "importeTxt", etiqueta: "Importe", align: "right" },
      ],
      r.top.map((t) => ({ ...t, unidadesTxt: n0(t.unidades), importeTxt: usd(t.importe) })),
      { vacio: "Sin ventas de productos en el periodo.", enlace: "/" }
    )
  },

  async saludo() {
    return mensaje(
      "Hola. Puedo consultarte el inventario, los saldos de tus clientes y tus facturas.",
      muestrario(3)
    )
  },

  async ayuda() {
    // La lista se arma del catálogo, no a mano: si mañana se agrega una
    // intención, la ayuda la menciona sola en vez de quedarse vieja.
    const puede = Object.entries(INTENCIONES)
      .filter(([n]) => !SOCIALES.has(n))
      .map(([, i]) => `· ${i.descripcion}`)
      .join("\n")
    return mensaje(
      `Consulto lo que ya está en tu ERP y te lo enseño con el dato de respaldo. Las cifras salen de la base, nunca me las invento.\n\n${puede}\n\nPor ahora solo consulto: no creo ni modifico nada.`,
      muestrario(4)
    )
  },

  async entradas_pendientes() {
    const filas = revienta(
      await supabase
        .from("purchase")
        .select("id,entry_no,provider,origin,total,date_created")
        .eq("status", "active")
        .order("date_created", { ascending: false })
        .limit(50)
    )
    const enCamino = sumar(filas, (p) => p.total)
    return tabla(
      filas.length === 0
        ? "No tienes entradas pendientes de recibir."
        : `${plural(filas.length, "entrada está", "entradas están")} por recibir, por ${usd(enCamino)} en mercancía.`,
      "Entradas por recibir",
      [
        { k: "entry_no", etiqueta: "Entrada" },
        { k: "provider", etiqueta: "Proveedor" },
        { k: "origin", etiqueta: "Origen" },
        { k: "registrada", etiqueta: "Registrada", align: "right" },
        { k: "totalTxt", etiqueta: "Costo", align: "right" },
      ],
      filas.map((p) => ({
        ...p,
        provider: p.provider ?? "—",
        origin: p.origin ?? "—",
        registrada: fecha(p.date_created),
        totalTxt: usd(p.total),
      })),
      { vacio: "No hay entradas pendientes de recibir.", enlace: "/entradas" }
    )
  },
}

/**
 * Corre una intención ya validada.
 *
 * @returns el resultado a pintar, o {error} con un mensaje para la persona.
 */
export async function ejecuta(intencion, parametros) {
  const fn = EJECUTORES[intencion]
  // No debería pasar: valida() ya filtró contra el catálogo. Está por si algún
  // día se agrega una intención al catálogo y se olvida su ejecutor.
  if (!fn) return { error: `Todavía no sé contestar «${intencion}».` }
  try {
    return await fn(parametros)
  } catch (e) {
    return { error: `No se pudo consultar: ${e.message}` }
  }
}

/** Las intenciones que tienen ejecutor — para la prueba de cobertura. */
export const CON_EJECUTOR = Object.keys(EJECUTORES)
