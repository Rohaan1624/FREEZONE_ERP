import { supabase, rpc } from "./supabase"
import { usd, n0 } from "./format"
import { M, sumar } from "./dinero"
import { resuelveCliente, resuelveProducto } from "./consultas"

/**
 * Lo que el asistente puede CREAR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS FASES, Y LA PRIMERA NO ESCRIBE
 * ─────────────────────────────────────────────────────────────────────────────
 *   propone()  resuelve nombres contra la base, calcula totales y devuelve una
 *              vista previa. NO toca nada.
 *   aplica()   escribe. Solo la llama el botón de confirmar.
 *
 * La resolución ocurre en propone(), no en aplica(), y eso es el punto: lo que
 * la persona ve en la vista previa —este cliente, este SKU, este precio— es
 * literalmente el payload que se va a guardar. Si se resolviera al confirmar,
 * la pantalla estaría enseñando una intención y guardando otra cosa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO ESTÁ EN consultas.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Ese archivo es de solo lectura y hay una prueba que lo verifica leyendo su
 * texto: si aparece un .insert( ahí, falla. Separarlos mantiene esa garantía
 * comprobable en vez de convertirla en una convención que alguien rompe sin
 * enterarse.
 *
 * SOLO SE CREA. No hay editar ni borrar, a propósito: crear de más se arregla
 * dando de baja o ignorando; sobrescribir una factura que ya salió, no.
 */

/* ------------------------------------------------------------ la propuesta -- */

/**
 * La cuarta forma de resultado: algo que va a pasar si lo confirmas.
 *
 * `payload` es lo que se escribirá, ya resuelto. `avisos` son cosas que la
 * persona debería mirar antes de decir que sí y que NO impiden guardar —
 * bloquear por ellas obligaría a salir del asistente a arreglar algo que
 * quizá está bien.
 */
const propuesta = (accion, titulo, resumen, campos, { lineas = null, total = null, avisos = [], payload }) => ({
  tipo: "propuesta",
  accion,
  titulo,
  resumen,
  campos,
  lineas,
  total,
  avisos,
  payload,
})

const oNada = (v) => (v === "" || v == null ? null : v)
const vacio = (v) => v === "" || v == null

/**
 * Reparte los campos entre los que se pintan y los que solo se nombran.
 *
 * Una ficha de alta con cinco «—» seguidos es ruido: la mitad de las casillas
 * no dicen nada y el ojo tiene que descartarlas para llegar a lo que sí se
 * capturó. Pero tampoco se pueden esconder, porque parte de revisar un alta es
 * ver qué va a quedar en blanco. Así que los llenos se enseñan y los vacíos se
 * resumen en una frase.
 */
function reparte(pares) {
  const llenos = pares.filter(([, v]) => !vacio(v)).map(([k, v]) => [k, String(v)])
  const huecos = pares.filter(([, v]) => vacio(v)).map(([k]) => k.toLowerCase())
  const aviso =
    huecos.length === 0
      ? null
      : `Va sin ${huecos.length === 1 ? huecos[0] : `${huecos.slice(0, -1).join(", ")} ni ${huecos.at(-1)}`}. Lo puedes completar después.`
  return { llenos, aviso }
}

/* -------------------------------------------------------------- propuestas -- */

const PROPONEN = {
  async crear_cliente(p) {
    const nombre = String(p.nombre ?? "").trim()
    if (!nombre) return { error: "Necesito el nombre del cliente." }

    // Un duplicado no bloquea, avisa. La misma empresa puede estar dos veces
    // con nombres distintos y aun así ser dos cuentas legítimas; decidirlo es
    // de quien conoce el negocio, no mío.
    const { data: parecidos } = await supabase
      .from("client")
      .select("name")
      .ilike("name", `%${nombre.replace(/[%_\\]/g, "\\$&")}%`)
      .limit(3)

    const avisos = parecidos?.length
      ? [`Ya tienes ${parecidos.length === 1 ? "un cliente" : "clientes"} con un nombre parecido: ${parecidos.map((c) => c.name).join(", ")}.`]
      : []

    const dias = Number(p.dias_credito) || 0
    const { llenos, aviso } = reparte([
      ["Nombre", nombre],
      ["RUC o cédula", p.identificador],
      ["Contacto", p.contacto],
      ["Correo", p.email],
      ["Crédito", dias > 0 ? `${dias} días` : "Contado"],
      ["Dirección", p.direccion],
      ["País", p.pais],
    ])
    if (aviso) avisos.push(aviso)

    return propuesta(
      "crear_cliente",
      nombre,
      `Voy a dar de alta a ${nombre}${dias > 0 ? ` con ${dias} días de crédito` : " de contado"}. ¿Lo creo?`,
      llenos,
      {
        avisos,
        payload: {
          name: nombre,
          identifier: oNada(p.identificador),
          contact: oNada(p.contacto),
          email: oNada(p.email),
          // El formulario de la app manda siempre este tipo por defecto; el
          // asistente no tiene por qué adivinar otro.
          client_type: "company",
          payment_terms: dias,
          address: oNada(p.direccion),
          country: oNada(p.pais),
        },
      }
    )
  },

  async crear_producto(p) {
    const sku = String(p.sku ?? "").trim().toUpperCase()
    if (!sku) return { error: "Necesito el SKU del producto." }

    // Aquí el duplicado SÍ bloquea: el SKU es único en la base, así que
    // confirmar llevaría a un error de restricción en vez de a un producto.
    // Mejor decirlo antes de enseñar un botón que no va a funcionar.
    const { data: ya } = await supabase
      .from("product")
      .select("id,sku,description")
      .eq("sku", sku)
      .maybeSingle()
    if (ya)
      return {
        error: `Ya existe el SKU ${sku}${ya.description ? ` (${ya.description})` : ""}. Los SKU no se repiten, y por ahora no puedo modificar uno que ya existe.`,
      }

    const porBulto = Math.max(1, Math.round(Number(p.por_bulto) || 1))
    const costo = p.costo == null ? null : M(p.costo)
    const precio = p.precio == null ? null : M(p.precio)

    const avisos = []
    if (precio == null) avisos.push("Sin precio de venta: tendrás que ponerlo antes de facturarlo.")
    if (costo != null && precio != null && precio.lte(costo))
      avisos.push("El precio no es mayor que el costo.")

    const { llenos, aviso } = reparte([
      ["SKU", sku],
      ["Descripción", p.descripcion],
      ["Unidad", p.unidad],
      ["Por bulto", n0(porBulto)],
      ["Costo", costo == null ? null : usd(costo)],
      ["Precio", precio == null ? null : usd(precio)],
      // Se dice explícitamente para que nadie espere que el asistente pueda
      // fijar existencia: esa columna solo se mueve por documento.
      ["Existencia", "0 · entra por compra o ajuste"],
    ])
    if (aviso) avisos.push(aviso)

    return propuesta(
      "crear_producto",
      sku,
      `Voy a dar de alta el SKU ${sku}${p.descripcion ? ` (${p.descripcion})` : ""}. ¿Lo creo?`,
      llenos,
      {
        avisos,
        payload: {
          sku,
          description: oNada(p.descripcion),
          unit: oNada(p.unidad),
          qty_unit: porBulto,
          cost_price: costo == null ? null : costo.toFixed(2),
          sale_price: precio == null ? null : precio.toFixed(2),
        },
      }
    )
  },

  async crear_factura(p) {
    const { cliente: c, varios, error } = await resuelveCliente(String(p.cliente ?? ""))
    if (error) return { error }
    if (varios)
      return {
        error: `«${p.cliente}» coincide con ${varios.length} clientes: ${varios.map((x) => x.name).join(", ")}. Dime cuál.`,
      }

    const crudas = Array.isArray(p.lineas) ? p.lineas : []
    if (!crudas.length) return { error: "Necesito al menos una línea para la factura." }

    const lineas = []
    const avisos = []

    for (const l of crudas) {
      // Sin producto es una línea libre: se factura tal cual y no mueve stock.
      if (!l.producto) {
        if (l.precio == null)
          return { error: `La línea «${l.descripcion}» no tiene precio y no es un producto del catálogo.` }
        lineas.push({
          type: "miscellaneous",
          product_id: null,
          description: l.descripcion,
          qty: Math.round(l.cantidad),
          bultos: null,
          unit: null,
          unit_price: M(l.precio).toFixed(2),
          _etiqueta: l.descripcion,
          _sku: "—",
        })
        continue
      }

      const r = await resuelveProducto(l.producto)
      if (r.error) return { error: r.error }
      // Un producto ambiguo NO se resuelve al azar: media docena de peines y
      // elegir uno «el que sea» es como se factura el SKU equivocado.
      if (r.varios)
        return {
          error: `«${l.producto}» coincide con ${r.varios.length} productos: ${r.varios.map((x) => x.sku).join(", ")}. Dime el SKU exacto.`,
        }

      const prod = r.producto
      const precio = l.precio != null ? M(l.precio) : prod.sale_price != null ? M(prod.sale_price) : null
      if (precio == null)
        return { error: `${prod.sku} no tiene precio de venta y tú no me diste uno.` }

      const qty = Math.round(l.cantidad)
      if (Number(prod.stock) < qty)
        avisos.push(
          `${prod.sku}: pides ${n0(qty)} y hay ${n0(prod.stock)} en existencia.`
        )
      if (l.precio == null) avisos.push(`${prod.sku}: usé el precio del catálogo, ${usd(precio)}.`)

      lineas.push({
        type: "product",
        product_id: prod.id,
        description: null,
        qty,
        bultos: null,
        unit: prod.unit ?? null,
        unit_price: precio.toFixed(2),
        _etiqueta: prod.description || prod.sku,
        _sku: prod.sku,
      })
    }

    const total = sumar(lineas, (l) => M(l.unit_price).times(l.qty))

    return propuesta(
      "crear_factura",
      `Factura para ${c.name}`,
      `Voy a preparar una factura de ${usd(total)} para ${c.name}, con ${lineas.length === 1 ? "una línea" : `${lineas.length} líneas`}. Se guarda como BORRADOR: no descuenta inventario hasta que la emitas. ¿La creo?`,
      [
        ["Cliente", c.name],
        ["Crédito", Number(c.payment_terms) > 0 ? `${c.payment_terms} días` : "Contado"],
        ["Estado", "Borrador"],
      ],
      {
        lineas: lineas.map((l) => ({
          sku: l._sku,
          descripcion: l._etiqueta,
          cantidad: n0(l.qty),
          precio: usd(l.unit_price),
          importe: usd(M(l.unit_price).times(l.qty)),
        })),
        total: usd(total),
        avisos,
        payload: {
          p_client_id: c.id,
          // Las claves con _ son solo para pintar la vista previa; no viajan.
          p_lines: lineas.map(({ _etiqueta, _sku, ...resto }) => resto),
          // BORRADOR y no activa, a propósito: emitir mueve inventario, y eso
          // no debería pasar por una frase mal entendida. La persona abre la
          // factura, la revisa y la emite desde su pantalla.
          p_status: "draft",
          p_notes: String(p.notas ?? "").trim(),
          p_due_date: null,
        },
      }
    )
  },
}

/* ---------------------------------------------------------------- escribir -- */

const APLICAN = {
  async crear_cliente(payload) {
    const { data, error } = await supabase.from("client").insert(payload).select("id,name").maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error("No se guardó: RLS bloqueó la fila.")
    return { resumen: `Listo, ${data.name} ya está en tus clientes.`, enlace: `/clientes/${data.id}` }
  },

  async crear_producto(payload) {
    const { data, error } = await supabase.from("product").insert(payload).select("id,sku").maybeSingle()
    if (error) {
      if (/duplicate key/i.test(error.message))
        throw new Error(`Alguien creó el SKU ${payload.sku} mientras revisabas esto.`)
      throw new Error(error.message)
    }
    if (!data) throw new Error("No se guardó: RLS bloqueó la fila.")
    return { resumen: `Listo, ${data.sku} ya está en tu catálogo.`, enlace: `/productos/${data.id}` }
  },

  async crear_factura(payload) {
    const id = await rpc("create_invoice", payload)
    return {
      resumen: "Listo, la factura quedó como borrador. Ábrela para revisarla y emitirla.",
      enlace: `/facturas/${id}`,
    }
  },
}

/* ------------------------------------------------------------------- api -- */

/** Arma la vista previa. NO escribe nada. */
export async function propone(intencion, parametros) {
  const fn = PROPONEN[intencion]
  if (!fn) return { error: `Todavía no sé crear «${intencion}».` }
  try {
    return await fn(parametros)
  } catch (e) {
    return { error: `No se pudo preparar: ${e.message}` }
  }
}

/**
 * Escribe una propuesta ya confirmada.
 *
 * Recibe la propuesta ENTERA y no unos parámetros sueltos, para que lo que se
 * guarda sea exactamente el payload que se pintó. Volver a resolver aquí
 * abriría la puerta a guardar algo distinto de lo que se aprobó.
 */
export async function aplica(prop) {
  const fn = APLICAN[prop?.accion]
  if (!fn) return { error: "Esa propuesta ya no es válida." }
  try {
    return await fn(prop.payload)
  } catch (e) {
    return { error: `No se pudo guardar: ${e.message}` }
  }
}

/** Las acciones con implementación — para la prueba de cobertura. */
export const CON_PROPUESTA = Object.keys(PROPONEN)
export const CON_APLICACION = Object.keys(APLICAN)
