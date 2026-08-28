/**
 * Factura y packing list en PDF, generados en el navegador.
 *
 * Por qué no window.print(): el navegador NO permite forzar «Guardar como PDF»
 * sin abrir su diálogo — es una restricción de seguridad deliberada. Para que
 * el botón descargue de una vez hay que construir el PDF nosotros.
 *
 * jsPDF dibuja TEXTO VECTORIAL, no una captura de pantalla. Eso importa en una
 * factura: el archivo se puede buscar, copiar y seleccionar, pesa ~20 KB en vez
 * de ~1 MB, y no se pixela al hacer zoom. (html2canvas haría lo contrario.)
 *
 * Las fuentes estándar de jsPDF usan WinAnsi, que cubre Latin-1: los acentos y
 * la ñ salen bien sin incrustar tipografías.
 *
 * El módulo se importa de forma DIFERIDA desde la página, así que estos ~150 KB
 * no entran en el bundle inicial: se descargan la primera vez que alguien pulsa
 * el botón.
 */
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

import { usd, n2, n0, fecha } from "./format.js"
import { mul, sumar, centavos } from "./dinero.js"
import { costeo } from "./costeo.js"

const M = 14 // margen en mm, igual que la hoja en pantalla

/** Nombre de archivo seguro: 1208/26 sería una ruta, no un nombre. */
export const nombreArchivo = (prefijo, num) =>
  `${prefijo} ${String(num ?? "").replace(/[\\/:*?"<>|]/g, "-")}`.trim()

const texto = (v) => (v == null ? "" : String(v))

function datosComunes(inv) {
  const lineas = inv.transaction ?? []
  // Los cargos son dinero, no bultos: no son un renglón de mercancía. En la
  // factura salen desglosados entre el subtotal y el total, y en el packing
  // list no salen nunca — esa lista se cotejará contra las cajas.
  const mercancia = lineas.filter((l) => l.type !== "charge")
  const cargos = lineas.filter((l) => l.type === "charge")
  const importe = (l) => centavos(mul(l.qty, l.unit_price))
  return {
    lineas,
    mercancia,
    cargos,
    importe,
    totalBultos: lineas.reduce((t, l) => t + Number(l.bultos ?? 0), 0),
    // product.weight_kg es el peso POR BULTO, no por pieza — así se pesa la
    // mercancía en la práctica. Multiplicar por qty inflaría el peso tantas
    // veces como piezas trae cada bulto (12 por caja -> 12x el peso real).
    totalPeso: mercancia.reduce((t, l) => t + peso(l), 0),
    totalCubicaje: mercancia.reduce((t, l) => t + cubicaje(l), 0),
    // El subtotal es SOLO mercancía: sumar aquí los cargos los contaría dos
    // veces, porque abajo se listan uno por uno antes del total.
    subtotal: sumar(mercancia, importe),
  }
}

/**
 * Peso y volumen de un renglón. weight_kg y cbm son POR BULTO, así que ambos
 * se multiplican por los bultos, nunca por las piezas: un SKU de 12 por caja
 * daría 12x de más en las dos columnas. Sin bultos no hay forma de saberlo.
 */
const peso = (l) => Number(l.bultos ?? 0) * Number(l.product?.weight_kg ?? 0)
const cubicaje = (l) => Number(l.bultos ?? 0) * Number(l.product?.cbm ?? 0)

const cantidad = (l) =>
  `${n0(l.qty)}${l.unit ? ` ${l.unit}` : l.product?.unit ? ` ${l.product.unit}` : ""}`

/**
 * Membrete de la empresa, arriba a la izquierda. Idéntico en la factura y en la
 * entrada — misma papelería. Devuelve la y de continuación.
 */
function cabeceraEmpresa(doc, emp, y) {
  doc.setFont("helvetica", "bold").setFontSize(16)
  doc.text(texto(emp.name).toUpperCase(), M, y + 4)
  y += 9

  doc.setFont("helvetica", "normal").setFontSize(8.5)
  const renglones = [
    emp.tax_id ? `RUC. ${emp.tax_id}` : null,
    ...texto(emp.address).split("\n").filter(Boolean),
    [emp.contact ? `TEL: ${emp.contact}` : null, emp.email ? `E-MAIL: ${emp.email}` : null]
      .filter(Boolean)
      .join(" · ") || null,
  ].filter(Boolean)
  for (const l of renglones) {
    doc.text(l, M, y)
    y += 4
  }
  return y
}

/** Bloque de dos columnas clave/valor, como la cabecera de la factura. */
function camposDosColumnas(doc, filas, ancho, y, salto = 5.5) {
  const col2 = ancho / 2 + 2
  doc.setFontSize(9)
  for (const [ka, va, kb, vb] of filas) {
    doc.setFont("helvetica", "bold").text(ka, M, y)
    doc.setFont("helvetica", "normal").text(texto(va), M + 32, y)
    if (kb) {
      doc.setFont("helvetica", "bold").text(kb, col2, y)
      doc.setFont("helvetica", "normal").text(texto(vb), col2 + 32, y)
    }
    y += salto
  }
  return y
}

const etiqueta = (l) =>
  l.type === "product" ? l.product?.description || l.product?.sku || "" : l.description || ""

/* ------------------------------------------------------------------ FACTURA */

export function pdfFactura(inv, empresa) {
  const doc = new jsPDF({ unit: "mm", format: "letter" })
  const emp = empresa ?? {}
  const cli = inv.client ?? {}
  const { mercancia, cargos, importe, totalBultos, totalPeso, subtotal } = datosComunes(inv)
  const ancho = doc.internal.pageSize.getWidth()
  let y = M

  y = cabeceraEmpresa(doc, emp, y)

  y += 2
  doc.setLineWidth(0.6).line(M, y, ancho - M, y)
  y += 6

  y = camposDosColumnas(
    doc,
    [
      ["Factura No.:", inv.invoice_num, "Orden de Compra:", inv.purchase_order],
      ["Fecha:", fecha(inv.date_created), "Marcas:", inv.marks],
      ["Vendido a:", inv.client_name ?? cli.name, "Consignado a:", inv.consigned_to],
      ["Dirección:", cli.address, "Despachado:", inv.dispatched],
      ["País:", cli.country, "Vendedor:", inv.salesperson],
      [
        "Términos de Pago:",
        inv.due_date
          ? cli.payment_terms
            ? `Fact. Crédito (${cli.payment_terms} días)`
            : `Vence ${fecha(inv.due_date)}`
          : "Fact. Contado (0 días)",
        "Embarcado vía:",
        inv.shipped_via,
      ],
    ],
    ancho,
    y
  )

  y += 3

  autoTable(doc, {
    startY: y,
    head: [["BULTOS", "REFERENCIA", "DESCRIPCIÓN", "CANTIDAD", "PRECIO", "TOTAL"]],
    // Solo mercancía: los cargos van desglosados debajo del subtotal.
    body: mercancia.map((l) => [
      l.bultos == null ? "" : n0(l.bultos),
      texto(l.product?.sku),
      etiqueta(l),
      cantidad(l),
      usd(l.unit_price),
      usd(importe(l)),
    ]),
    margin: { left: M, right: M },
    styles: { font: "helvetica", fontSize: 9, lineColor: 0, lineWidth: 0.25, textColor: 0 },
    headStyles: { fillColor: false, textColor: 0, fontStyle: "bold", halign: "center" },
    columnStyles: {
      0: { halign: "center", cellWidth: 20 },
      3: { cellWidth: 26 },
      4: { halign: "right", cellWidth: 24 },
      5: { halign: "right", cellWidth: 26 },
    },
  })

  y = doc.lastAutoTable.finalY + 5
  doc.setLineWidth(0.6).line(M, y, ancho - M, y)
  y += 5

  doc.setFontSize(9)
  doc.setFont("helvetica", "bold").text("Total Bultos:", M, y)
  doc.setFont("helvetica", "normal").text(n0(totalBultos), M + 24, y)
  doc.setFont("helvetica", "bold").text("Total Peso:", M + 45, y)
  doc.setFont("helvetica", "normal").text(n2(totalPeso), M + 68, y)
  doc.setFont("helvetica", "bold").text("Subtotal:", ancho - M - 40, y)
  doc.setFont("helvetica", "normal").text(usd(subtotal), ancho - M, y, { align: "right" })

  // Cada cargo, con su concepto, entre el subtotal y el total. Van aquí y no
  // en la tabla porque no son mercancía: no llevan bultos, referencia ni
  // cantidad, y el cliente espera verlos como flete/seguro/manejo sumándose
  // aparte a lo que compró.
  const rotuloX = ancho - M - 70
  for (const c of cargos) {
    y += 5.5
    const nombre = doc.splitTextToSize(texto(c.description) || "Cargo", 40)[0]
    doc.setFont("helvetica", "normal").text(`${nombre}:`, rotuloX, y)
    doc.text(usd(importe(c)), ancho - M, y, { align: "right" })
  }

  y += 4
  if (cargos.length) {
    doc.setLineWidth(0.3).line(rotuloX, y, ancho - M, y)
    y += 3
  }

  doc.setFont("helvetica", "bold").setFontSize(11)
  doc.text(`TOTAL: ${usd(inv.total)}`, ancho - M, y + 3, { align: "right" })
  y += 3

  if (inv.notes) {
    y += 10
    doc.setFont("helvetica", "bold").setFontSize(8.5).text("Notas:", M, y)
    doc.setFont("helvetica", "normal")
    doc.text(doc.splitTextToSize(texto(inv.notes), ancho - M * 2 - 14), M + 14, y)
  }

  return doc
}

/* ------------------------------------------------------------- PACKING LIST */

export function pdfPackingList(inv, empresa) {
  const doc = new jsPDF({ unit: "mm", format: "letter" })
  const emp = empresa ?? {}
  const cli = inv.client ?? {}
  const { mercancia, totalBultos, totalPeso, totalCubicaje } = datosComunes(inv)
  const ancho = doc.internal.pageSize.getWidth()
  const centro = ancho / 2
  let y = M + 4

  doc.setFont("helvetica", "bold").setFontSize(12)
  doc.text(texto(emp.name).toUpperCase(), centro, y, { align: "center" })
  y += 6
  doc.text("PACKING LIST (LISTA DE EMPAQUE)", centro, y, { align: "center" })
  y += 9

  doc.setFontSize(9)
  const par = (k, v, x) => {
    doc.setFont("helvetica", "bold").text(k, x, y)
    const w = doc.getTextWidth(k)
    doc.setFont("helvetica", "normal").text(texto(v), x + w + 2, y)
  }
  par("NOMBRE:", inv.client_name ?? cli.name, M)
  y += 6
  par("FECHA:", fecha(inv.date_created), M)
  par("PEDIDO:", inv.purchase_order, M + 62)
  par("FACTURA:", inv.invoice_num, M + 118)
  y += 6
  par("VENDEDOR:", inv.salesperson, M)
  y += 6
  par("DIRECCION:", cli.address, M)
  par("MARCAS:", inv.marks, M + 118)
  y += 6

  autoTable(doc, {
    startY: y,
    head: [["BULTOS", "PESO", "CUBICAJE", "REFERENCIA", "DESCRIPCION", "CANTIDAD"]],
    body: mercancia.map((l) => [
      l.bultos == null ? "" : n0(l.bultos),
      n2(peso(l)),
      cubicaje(l).toFixed(1),
      texto(l.product?.sku),
      etiqueta(l),
      cantidad(l),
    ]),
    foot: [[n0(totalBultos), n2(totalPeso), totalCubicaje.toFixed(1), "", "", ""]],
    margin: { left: M, right: M },
    // Sin retícula completa: la muestra solo lleva líneas arriba y abajo del
    // encabezado y sobre los totales.
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, textColor: 0, halign: "center" },
    headStyles: {
      fontStyle: "bold",
      lineColor: 0,
      lineWidth: { top: 0.3, bottom: 0.3 },
    },
    footStyles: { fontStyle: "bold", lineColor: 0, lineWidth: { top: 0.3 }, textColor: 0 },
  })

  y = doc.lastAutoTable.finalY + 8
  doc.setFont("helvetica", "bold").setFontSize(10)
  doc.text("FIN DE LA LISTA DE EMPAQUE", centro, y, { align: "center" })

  // Bloque de firmas: la copia del almacén se firma a mano.
  y += 26
  const firmas = ["APROBADO POR", "SACADO POR", "VERIFICADO POR", "EMPACADO POR"]
  const util = ancho - M * 2
  const paso = util / firmas.length
  doc.setFontSize(9)
  firmas.forEach((t, i) => {
    const cx = M + paso * i + paso / 2
    doc.setLineWidth(0.3).line(cx - paso / 2 + 6, y, cx + paso / 2 - 6, y)
    doc.setFont("helvetica", "bold").text(t, cx, y + 5, { align: "center" })
  })

  return doc
}

/* ------------------------------------------------------- ENTRADA / COSTEO -- */

/**
 * Entrada en papel: qué llegó, qué se pagó de gastos y en cuánto quedó costando
 * cada SKU ya con el prorrateo encima.
 *
 * Es un documento INTERNO, no se le entrega a nadie — por eso lleva costos, que
 * es justo lo que la factura nunca debe mostrar.
 *
 * Recibe los renglones tal como los tiene el formulario ({type, sku, nombre,
 * qty, bultos, unit, cost_unit}), no la fila de la base, para que el papel diga
 * exactamente lo que está viendo en pantalla quien le da a imprimir.
 */
export function pdfEntrada(compra, empresa) {
  const doc = new jsPDF({ unit: "mm", format: "letter" })
  const emp = empresa ?? {}
  const lineas = compra.lineas ?? []
  const ancho = doc.internal.pageSize.getWidth()

  const productos = lineas.filter((l) => l.type === "product")
  const cargos = lineas.filter((l) => l.type === "charge")
  const { mercancia, gastos, total, unidades, factor, prorrateable, aterrizado } = costeo(lineas)
  const totalBultos = sumar(productos, (l) => l.bultos ?? 0)
  const importe = (l) => centavos(mul(l.qty, l.cost_unit))

  let y = M
  y = cabeceraEmpresa(doc, emp, y)

  y += 2
  doc.setLineWidth(0.6).line(M, y, ancho - M, y)
  y += 6

  y = camposDosColumnas(
    doc,
    [
      ["Entrada No.:", compra.entry_no, "Peso neto (kg):", n2(compra.net_weight_kgs ?? 0)],
      ["Proveedor:", compra.provider, "Peso bruto (kg):", n2(compra.gross_weight_kgs ?? 0)],
      ["Origen:", compra.origin, "CBM:", texto(compra.cbm)],
      [
        "Fecha:",
        fecha(compra.date_created),
        "Estado:",
        // Sin guión largo: las fuentes estándar de jsPDF son WinAnsi y U+2014
        // queda fuera de Latin-1, así que se imprimiría como un hueco.
        compra.status === "closed" ? "Recibida (ya subió al inventario)" : "Pendiente",
      ],
    ],
    ancho,
    y
  )

  y += 3

  // Ocho columnas caben en carta a 8 pt. Los dos pares se leen en paralelo:
  // lo capturado a la izquierda, lo aterrizado a la derecha.
  autoTable(doc, {
    startY: y,
    head: [
      [
        "BULTOS",
        "REFERENCIA",
        "DESCRIPCIÓN",
        "CANTIDAD",
        "COSTO U.",
        "IMPORTE",
        "COSTO FINAL U.",
        "IMPORTE FINAL",
      ],
    ],
    body: productos.map((l) => [
      l.bultos == null ? "" : n0(l.bultos),
      texto(l.sku),
      texto(l.nombre),
      cantidad(l),
      usd(l.cost_unit),
      usd(importe(l)),
      usd(aterrizado(l)),
      usd(mul(l.qty, aterrizado(l))),
    ]),
    margin: { left: M, right: M },
    styles: { font: "helvetica", fontSize: 8, lineColor: 0, lineWidth: 0.25, textColor: 0 },
    headStyles: { fillColor: false, textColor: 0, fontStyle: "bold", halign: "center" },
    columnStyles: {
      0: { halign: "center", cellWidth: 15 },
      1: { cellWidth: 22 },
      3: { halign: "right", cellWidth: 20 },
      4: { halign: "right", cellWidth: 18 },
      5: { halign: "right", cellWidth: 22 },
      6: { halign: "right", cellWidth: 21, fontStyle: "bold" },
      7: { halign: "right", cellWidth: 24, fontStyle: "bold" },
    },
  })

  y = doc.lastAutoTable.finalY + 5
  doc.setLineWidth(0.6).line(M, y, ancho - M, y)
  y += 5

  doc.setFontSize(9)
  doc.setFont("helvetica", "bold").text("Total Bultos:", M, y)
  doc.setFont("helvetica", "normal").text(n0(totalBultos), M + 24, y)
  doc.setFont("helvetica", "bold").text("Unidades:", M + 45, y)
  doc.setFont("helvetica", "normal").text(n0(unidades), M + 66, y)
  doc.setFont("helvetica", "bold").text("Mercancía:", ancho - M - 40, y)
  doc.setFont("helvetica", "normal").text(usd(mercancia), ancho - M, y, { align: "right" })

  // Cada gasto con su concepto, igual que los cargos en la factura: sumados en
  // bloque no se puede auditar de dónde salió el prorrateo.
  const rotuloX = ancho - M - 70
  for (const c of cargos) {
    y += 5.5
    const nombre = doc.splitTextToSize(texto(c.description) || "Gasto", 40)[0]
    doc.setFont("helvetica", "normal").text(`${nombre}:`, rotuloX, y)
    doc.text(usd(importe(c)), ancho - M, y, { align: "right" })
  }

  y += 4
  if (cargos.length) {
    doc.setLineWidth(0.3).line(rotuloX, y, ancho - M, y)
    y += 3
  }

  doc.setFont("helvetica", "bold").setFontSize(11)
  doc.text(`COSTO EN ALMACÉN: ${usd(total)}`, ancho - M, y + 3, { align: "right" })
  y += 9

  // La frase que explica el resto de la hoja. Sin ella, el «costo final u.» es
  // un número que nadie puede reconstruir dentro de seis meses.
  doc.setFont("helvetica", "normal").setFontSize(8.5)
  const nota = prorrateable
    ? `Los gastos se reparten por valor: cada SKU absorbe la misma proporción que aporta a la ` +
      `mercancía. Factor de costeo +${factor.minus(1).times(100).toFixed(1)}% ` +
      `(${usd(gastos)} de gastos sobre ${usd(mercancia)} de mercancía).`
    : "Sin mercancía valorizada no hay base para repartir los gastos: los costos finales son los capturados."
  doc.text(doc.splitTextToSize(nota, ancho - M * 2), M, y)

  return doc
}

/** Genera y descarga. El nombre lleva el número de factura. */
export function descargar(tipo, inv, empresa) {
  const doc = tipo === "packing" ? pdfPackingList(inv, empresa) : pdfFactura(inv, empresa)
  const nombre = nombreArchivo(tipo === "packing" ? "PackingList" : "Factura", inv.invoice_num)
  doc.setProperties({ title: nombre, subject: `Cliente: ${inv.client_name ?? ""}` })
  doc.save(`${nombre}.pdf`)
}

/** Igual, para la liquidación de una entrada. */
export function descargarEntrada(compra, empresa) {
  const doc = pdfEntrada(compra, empresa)
  const nombre = nombreArchivo("Entrada", compra.entry_no)
  doc.setProperties({ title: nombre, subject: `Proveedor: ${compra.provider ?? ""}` })
  doc.save(`${nombre}.pdf`)
}
