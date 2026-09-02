import { aNumero, aFecha, normaliza } from "./csv.js"

/**
 * Reglas de la importación desde el sistema anterior.
 *
 * Todo aquí es una función pura: filas leídas del CSV más lo que ya existe en
 * la base, y sale un PLAN — qué se va a crear, qué se omite y qué está mal, con
 * el número de renglón del archivo. Nada escribe. La pantalla enseña el plan y
 * solo entonces se aplica.
 *
 * Esa separación es el punto: en una migración el archivo viene mal las
 * primeras veces, y descubrirlo a la mitad de la escritura deja medio catálogo
 * cargado y nadie sabe qué quedó.
 *
 * QUÉ SE IMPORTA Y QUÉ NO
 *   productos + existencia inicial   sí — la existencia entra como AJUSTE, no
 *                                    escrita a mano, para que quede el rastro
 *   clientes                         sí
 *   facturas ABIERTAS                sí, con su fecha real: sin eso la
 *                                    antigüedad del saldo nace mintiendo
 *   facturas ya pagadas              NO — no aportan a ningún número vivo y
 *                                    duplicarían todo reporte de periodo
 *   entradas históricas              NO — una entrada cerrada mueve existencia
 *                                    y chocaría con el ajuste de apertura
 *
 * Re-importar el mismo archivo no duplica: lo que ya existe se omite. Se omite
 * y no se actualiza, a propósito — si alguien corrigió un costo a mano después
 * de la primera carga, una segunda pasada no debe pisárselo.
 */

/* -------------------------------------------------------------- plantillas -- */

export const PLANTILLAS = {
  productos: {
    titulo: "Productos",
    archivo: "productos.csv",
    descripcion:
      "El catálogo con su existencia actual. La existencia entra como ajuste de apertura, así que queda registrada de dónde salió.",
    columnas: [
      ["sku", "obligatorio · identifica al producto y es la llave para no duplicar"],
      ["descripcion", ""],
      ["unidad", "PZA, BOX, DOC, CTN, KG, PAL"],
      ["piezas_por_bulto", "para convertir cantidad ⇄ bultos · si se omite, 1"],
      ["costo", "costo unitario"],
      ["precio", "precio de lista"],
      ["peso_por_bulto_kg", "peso de UN bulto, no de una pieza"],
      ["cbm_por_bulto", "volumen de UN bulto"],
      ["existencia_inicial", "lo que hay en piso hoy · si se omite, 0"],
    ],
    ejemplo: ["ABC-100", "Descripción del producto", "PZA", "12", "8.00", "14.50", "9.4", "0.045", "1840"],
  },
  clientes: {
    titulo: "Clientes",
    archivo: "clientes.csv",
    descripcion:
      "Las cuentas. El saldo NO se captura aquí: sale solo de las facturas abiertas que importes después.",
    columnas: [
      ["nombre", "obligatorio"],
      ["ruc", "identificador fiscal · es la llave preferida para cruzar facturas"],
      ["contacto", "teléfono"],
      ["correo", ""],
      ["direccion", ""],
      ["pais", ""],
      ["tipo", "empresa, persona o gobierno · si se omite, empresa"],
      ["dias_credito", "0 = contado · si se omite, 0"],
    ],
    ejemplo: ["John Doe", "100123456789", "000-0000", "correo@cliente.com", "Calle 1, Local 1", "Colombia", "empresa", "30"],
  },
  facturas: {
    titulo: "Facturas abiertas",
    archivo: "facturas-abiertas.csv",
    descripcion:
      "SOLO lo que está sin cobrar. Van con su fecha real para que la antigüedad sirva desde el primer día. No metas las ya pagadas: no cambian ningún saldo y duplicarían los reportes.",
    columnas: [
      ["folio", "obligatorio · el número del sistema anterior"],
      ["ruc_cliente", "cruza con el RUC del cliente ya importado"],
      ["nombre_cliente", "se usa solo si no hay RUC · tiene que coincidir exacto"],
      ["fecha", "obligatorio · fecha de emisión real"],
      ["fecha_vencimiento", "si se omite, se calcula con los días de crédito del cliente"],
      ["importe", "obligatorio · el total de la factura, sin restar abonos"],
      ["importe_pagado", "lo ya abonado · si se omite, 0"],
    ],
    // Un valor por columna, en el mismo orden. Si falta uno, la plantilla sale
    // con los datos corridos una casilla y el ejemplo enseña el formato mal.
    ejemplo: ["INV-00891", "100123456789", "", "12/05/2026", "", "5140.25", "2000.00"],
  },
}

/* ------------------------------------------------------------------ ayudas -- */

const texto = (v) => String(v ?? "").trim()
const vacio = (v) => texto(v) === ""

const entero = (v, porDefecto = null) => {
  const n = aNumero(v)
  if (n === null) return porDefecto
  return Math.round(n)
}

const TIPO_CLIENTE = {
  empresa: "company",
  company: "company",
  persona: "individual",
  individual: "individual",
  natural: "individual",
  gobierno: "government",
  government: "government",
}

const fila = (f, estado, motivo, datos = null) => ({
  n: f._n,
  estado,
  motivo,
  datos,
})

/** Resume un plan para la cabecera de la pantalla. */
export function resumen(plan) {
  return {
    crear: plan.filter((r) => r.estado === "crear").length,
    omitir: plan.filter((r) => r.estado === "omitir").length,
    error: plan.filter((r) => r.estado === "error").length,
    total: plan.length,
  }
}

/** Columnas obligatorias que el archivo no trae. */
export function faltantes(encabezados, requeridas) {
  return requeridas.filter((c) => !encabezados.includes(c))
}

/* --------------------------------------------------------------- productos -- */

export function planProductos(filas, { existentes = [] } = {}) {
  const enBase = new Set(existentes.map((p) => texto(p.sku).toUpperCase()))
  const enArchivo = new Set()

  return filas.map((f) => {
    const sku = texto(f.sku).toUpperCase()
    if (sku === "") return fila(f, "error", "falta el SKU")

    if (enArchivo.has(sku)) return fila(f, "error", `SKU repetido en el archivo: ${sku}`)
    enArchivo.add(sku)

    if (enBase.has(sku)) return fila(f, "omitir", "ya existe en el catálogo")

    const porBulto = entero(f.piezas_por_bulto, 1)
    if (porBulto !== null && porBulto < 1)
      return fila(f, "error", "piezas por bulto debe ser 1 o más")

    const inicial = entero(f.existencia_inicial, 0)
    if (inicial < 0) return fila(f, "error", "la existencia inicial no puede ser negativa")

    // Los cuatro numéricos opcionales comparten regla: si vienen, no negativos.
    const nums = {}
    for (const [col, clave] of [
      ["costo", "cost_price"],
      ["precio", "sale_price"],
      ["peso_por_bulto_kg", "weight_kg"],
      ["cbm_por_bulto", "cbm"],
    ]) {
      if (vacio(f[col])) {
        nums[clave] = null
        continue
      }
      const n = aNumero(f[col])
      if (n === null) return fila(f, "error", `${col} no es un número: «${f[col]}»`)
      if (n < 0) return fila(f, "error", `${col} no puede ser negativo`)
      nums[clave] = n
    }

    return fila(f, "crear", inicial > 0 ? `existencia inicial ${inicial}` : "", {
      producto: {
        sku,
        description: texto(f.descripcion) || null,
        unit: texto(f.unidad).toUpperCase() || null,
        qty_unit: porBulto,
        ...nums,
      },
      existencia_inicial: inicial,
    })
  })
}

/* ---------------------------------------------------------------- clientes -- */

export function planClientes(filas, { existentes = [] } = {}) {
  const rucEnBase = new Set(existentes.map((c) => texto(c.identifier)).filter(Boolean))
  const nombreEnBase = new Set(existentes.map((c) => normaliza(c.name)))
  const enArchivo = new Set()

  return filas.map((f) => {
    const nombre = texto(f.nombre)
    if (nombre === "") return fila(f, "error", "falta el nombre")

    const ruc = texto(f.ruc)
    // La llave es el RUC si lo hay; si no, el nombre normalizado. Dos clientes
    // con el mismo nombre y sin RUC son indistinguibles y hay que decirlo.
    const llave = ruc || normaliza(nombre)
    if (enArchivo.has(llave))
      return fila(f, "error", ruc ? `RUC repetido en el archivo: ${ruc}` : "nombre repetido en el archivo")
    enArchivo.add(llave)

    if (ruc ? rucEnBase.has(ruc) : nombreEnBase.has(normaliza(nombre)))
      return fila(f, "omitir", "ya existe")

    const tipoCrudo = normaliza(f.tipo)
    if (tipoCrudo && !TIPO_CLIENTE[tipoCrudo])
      return fila(f, "error", `tipo desconocido: «${f.tipo}» · usa empresa, persona o gobierno`)

    const dias = entero(f.dias_credito, 0)
    if (dias < 0) return fila(f, "error", "los días de crédito no pueden ser negativos")

    return fila(f, "crear", dias > 0 ? `neto ${dias}` : "contado", {
      cliente: {
        name: nombre,
        identifier: ruc || null,
        contact: texto(f.contacto) || null,
        email: texto(f.correo) || null,
        address: texto(f.direccion) || null,
        country: texto(f.pais) || null,
        client_type: TIPO_CLIENTE[tipoCrudo] ?? "company",
        payment_terms: dias,
      },
    })
  })
}

/* -------------------------------------------------------- facturas abiertas -- */

/**
 * @param clientes los que YA están en la base — por eso el orden de importación
 *   no es negociable: clientes antes que facturas, o ninguna cruza.
 * @param folios   los invoice_num ya existentes, para no duplicar al re-correr.
 * @param hoy      inyectable para poder probar el rechazo de fechas futuras.
 */
export function planFacturas(filas, { clientes = [], folios = [], hoy = null } = {}) {
  const porRuc = new Map()
  const porNombre = new Map()
  for (const c of clientes) {
    const r = texto(c.identifier)
    if (r) porRuc.set(r, c)
    porNombre.set(normaliza(c.name), c)
  }
  const foliosEnBase = new Set(folios.map(texto))
  const enArchivo = new Set()
  const limite = hoy ?? new Date().toISOString().slice(0, 10)

  return filas.map((f) => {
    const folio = texto(f.folio)
    if (folio === "") return fila(f, "error", "falta el folio")

    if (enArchivo.has(folio)) return fila(f, "error", `folio repetido en el archivo: ${folio}`)
    enArchivo.add(folio)

    if (foliosEnBase.has(folio)) return fila(f, "omitir", "ya existe una factura con ese folio")

    const ruc = texto(f.ruc_cliente)
    const nombre = texto(f.nombre_cliente)
    const cliente = ruc ? porRuc.get(ruc) : nombre ? porNombre.get(normaliza(nombre)) : null
    if (!cliente) {
      if (!ruc && !nombre) return fila(f, "error", "falta el cliente (RUC o nombre)")
      return fila(
        f,
        "error",
        ruc
          ? `no hay cliente con RUC ${ruc} · impórtalos primero`
          : `no hay cliente llamado «${nombre}» · el nombre debe coincidir exacto`
      )
    }

    const fecha = aFecha(f.fecha)
    if (!fecha) return fila(f, "error", `fecha inválida: «${texto(f.fecha)}»`)
    if (fecha > limite) return fila(f, "error", `la fecha es futura: ${fecha}`)

    let vence = null
    if (!vacio(f.fecha_vencimiento)) {
      vence = aFecha(f.fecha_vencimiento)
      if (!vence) return fila(f, "error", `vencimiento inválido: «${texto(f.fecha_vencimiento)}»`)
      if (vence < fecha) return fila(f, "error", "el vencimiento es anterior a la emisión")
    }

    const importe = aNumero(f.importe)
    if (importe === null) return fila(f, "error", "falta el importe")
    if (importe <= 0) return fila(f, "error", "el importe debe ser mayor que cero")

    const pagado = vacio(f.importe_pagado) ? 0 : aNumero(f.importe_pagado)
    if (pagado === null) return fila(f, "error", `importe pagado inválido: «${f.importe_pagado}»`)
    if (pagado < 0) return fila(f, "error", "el importe pagado no puede ser negativo")
    // Si ya está pagada completa no va: no cambia ningún saldo y solo
    // ensuciaría los reportes de periodo. Se queda en el sistema anterior.
    if (pagado >= importe)
      return fila(f, "omitir", "ya está pagada por completo · no se importa historia saldada")

    return fila(
      f,
      "crear",
      pagado > 0
        ? `${cliente.name} · abonado ${pagado.toFixed(2)}, queda ${(importe - pagado).toFixed(2)}`
        : cliente.name,
      {
        factura: {
          client_id: cliente.id,
          invoice_num: folio,
          fecha,
          vence,
          importe,
        },
        pago: pagado > 0 ? { amount: pagado, fecha } : null,
      }
    )
  })
}
