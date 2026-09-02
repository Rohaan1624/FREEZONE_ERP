import { test } from "node:test"
import assert from "node:assert/strict"

import {
  PLANTILLAS,
  planProductos,
  planClientes,
  planFacturas,
  resumen,
  faltantes,
} from "./importar.js"
import { parseCSV, generaCSV } from "./csv.js"

const filas = (csv) => parseCSV(csv).filas
const estados = (plan) => plan.map((r) => r.estado)

/* --------------------------------------------------------------- productos -- */

test("crea el producto y anota la existencia inicial", () => {
  const p = planProductos(
    filas("sku,descripcion,unidad,piezas_por_bulto,costo,precio,peso_por_bulto_kg,cbm_por_bulto,existencia_inicial\nabc-100,Producto uno,pza,12,8.00,14.50,9.4,0.045,1840")
  )
  assert.deepEqual(estados(p), ["crear"])
  assert.equal(p[0].datos.producto.sku, "ABC-100") // se normaliza a mayúsculas
  assert.equal(p[0].datos.producto.unit, "PZA")
  assert.equal(p[0].datos.producto.qty_unit, 12)
  assert.equal(p[0].datos.producto.cost_price, 8)
  assert.equal(p[0].datos.existencia_inicial, 1840)
})

test("los opcionales ausentes quedan null, no cero", () => {
  const p = planProductos(filas("sku,costo,precio\nABC-100,,"))
  assert.equal(p[0].datos.producto.cost_price, null)
  assert.equal(p[0].datos.producto.sale_price, null)
  // Un SKU sin costo es un SKU sin costo; a $0 reportaría 100% de margen.
})

test("piezas por bulto y existencia toman su valor por defecto", () => {
  const p = planProductos(filas("sku\nABC-100"))
  assert.equal(p[0].datos.producto.qty_unit, 1)
  assert.equal(p[0].datos.existencia_inicial, 0)
})

test("omite lo que ya está en el catálogo — re-correr no duplica", () => {
  const p = planProductos(filas("sku\nABC-100\nDEF-200"), {
    existentes: [{ sku: "ABC-100" }],
  })
  assert.deepEqual(estados(p), ["omitir", "crear"])
})

test("el cruce con el catálogo no distingue mayúsculas", () => {
  const p = planProductos(filas("sku\nabc-100"), { existentes: [{ sku: "ABC-100" }] })
  assert.deepEqual(estados(p), ["omitir"])
})

test("SKU repetido DENTRO del archivo es error, no omisión", () => {
  const p = planProductos(filas("sku\nABC-100\nABC-100"))
  assert.deepEqual(estados(p), ["crear", "error"])
  assert.match(p[1].motivo, /repetido en el archivo/)
})

test("errores de captura en los números", () => {
  const p = planProductos(
    filas("sku,costo,existencia_inicial,piezas_por_bulto\nA,x,,\nB,-1,,\nC,,-5,\nD,,,0")
  )
  assert.deepEqual(estados(p), ["error", "error", "error", "error"])
  assert.match(p[0].motivo, /no es un número/)
  assert.match(p[1].motivo, /negativo/)
  assert.match(p[2].motivo, /negativa/)
  assert.match(p[3].motivo, /1 o más/)
})

test("sin SKU no hay producto", () => {
  const p = planProductos(filas("sku,descripcion\n,Sin sku"))
  assert.deepEqual(estados(p), ["error"])
})

/* ---------------------------------------------------------------- clientes -- */

test("crea el cliente con sus condiciones", () => {
  const p = planClientes(filas("nombre,ruc,tipo,dias_credito\nJohn Doe,100123456789,empresa,30"))
  assert.deepEqual(estados(p), ["crear"])
  assert.equal(p[0].datos.cliente.client_type, "company")
  assert.equal(p[0].datos.cliente.payment_terms, 30)
  assert.equal(p[0].datos.cliente.identifier, "100123456789")
})

test("acepta los tipos en español y en inglés", () => {
  const p = planClientes(filas("nombre,tipo\nA,persona\nB,Gobierno\nC,company\nD,"))
  assert.deepEqual(
    p.map((r) => r.datos.cliente.client_type),
    ["individual", "government", "company", "company"]
  )
})

test("un tipo inventado se rechaza en vez de caer en empresa por silencio", () => {
  const p = planClientes(filas("nombre,tipo\nA,mayorista"))
  assert.deepEqual(estados(p), ["error"])
  assert.match(p[0].motivo, /tipo desconocido/)
})

test("omite por RUC si ya existe", () => {
  const p = planClientes(filas("nombre,ruc\nOtro Nombre,100123456789"), {
    existentes: [{ name: "John Doe", identifier: "100123456789" }],
  })
  assert.deepEqual(estados(p), ["omitir"])
})

test("sin RUC, el cruce es por nombre normalizado", () => {
  const p = planClientes(filas("nombre\n  john doe  "), {
    existentes: [{ name: "John Doe", identifier: null }],
  })
  assert.deepEqual(estados(p), ["omitir"])
})

test("dos clientes sin RUC y con el mismo nombre son indistinguibles", () => {
  const p = planClientes(filas("nombre\nJohn Doe\nJohn Doe"))
  assert.deepEqual(estados(p), ["crear", "error"])
})

/* -------------------------------------------------------- facturas abiertas -- */

const CLIENTES = [
  { id: "k1", name: "John Doe", identifier: "100123456789" },
  { id: "k2", name: "Jane Roe", identifier: null },
]

test("crea la factura abierta con su fecha real", () => {
  const p = planFacturas(
    filas("folio,ruc_cliente,fecha,importe,importe_pagado\nINV-00891,100123456789,12/05/2026,5140.25,2000"),
    { clientes: CLIENTES, hoy: "2026-08-29" }
  )
  assert.deepEqual(estados(p), ["crear"])
  const d = p[0].datos
  assert.equal(d.factura.invoice_num, "INV-00891")
  assert.equal(d.factura.client_id, "k1")
  assert.equal(d.factura.fecha, "2026-05-12")
  assert.equal(d.factura.importe, 5140.25)
  assert.equal(d.pago.amount, 2000)
  assert.equal(d.pago.fecha, "2026-05-12")
})

test("sin abono no genera pago", () => {
  const p = planFacturas(filas("folio,ruc_cliente,fecha,importe\nA,100123456789,12/05/2026,100"), {
    clientes: CLIENTES,
    hoy: "2026-08-29",
  })
  assert.equal(p[0].datos.pago, null)
})

test("una factura ya pagada completa NO se importa", () => {
  // No cambia ningún saldo y duplicaría los reportes de periodo.
  const p = planFacturas(
    filas("folio,ruc_cliente,fecha,importe,importe_pagado\nA,100123456789,12/05/2026,100,100"),
    { clientes: CLIENTES, hoy: "2026-08-29" }
  )
  assert.deepEqual(estados(p), ["omitir"])
  assert.match(p[0].motivo, /pagada por completo/)
})

test("cruza por nombre cuando no hay RUC", () => {
  const p = planFacturas(
    filas("folio,nombre_cliente,fecha,importe\nA,jane roe,12/05/2026,100"),
    { clientes: CLIENTES, hoy: "2026-08-29" }
  )
  assert.equal(p[0].datos.factura.client_id, "k2")
})

test("cliente inexistente: dice que hay que importarlos primero", () => {
  const p = planFacturas(
    filas("folio,ruc_cliente,fecha,importe\nA,999,12/05/2026,100\nB,,12/05/2026,100"),
    { clientes: CLIENTES, hoy: "2026-08-29" }
  )
  assert.deepEqual(estados(p), ["error", "error"])
  assert.match(p[0].motivo, /impórtalos primero/)
  assert.match(p[1].motivo, /falta el cliente/)
})

test("fecha futura rechazada — el backend también la rechaza", () => {
  const p = planFacturas(
    filas("folio,ruc_cliente,fecha,importe\nA,100123456789,01/01/2062,100"),
    { clientes: CLIENTES, hoy: "2026-08-29" }
  )
  assert.deepEqual(estados(p), ["error"])
  assert.match(p[0].motivo, /futura/)
})

test("vencimiento anterior a la emisión", () => {
  const p = planFacturas(
    filas("folio,ruc_cliente,fecha,fecha_vencimiento,importe\nA,100123456789,12/05/2026,01/05/2026,100"),
    { clientes: CLIENTES, hoy: "2026-08-29" }
  )
  assert.deepEqual(estados(p), ["error"])
})

test("vencimiento omitido queda null para que lo calcule el backend", () => {
  const p = planFacturas(
    filas("folio,ruc_cliente,fecha,fecha_vencimiento,importe\nA,100123456789,12/05/2026,,100"),
    { clientes: CLIENTES, hoy: "2026-08-29" }
  )
  assert.equal(p[0].datos.factura.vence, null)
})

test("importes inválidos", () => {
  const p = planFacturas(
    filas("folio,ruc_cliente,fecha,importe,importe_pagado\nA,100123456789,12/05/2026,,\nB,100123456789,12/05/2026,0,\nC,100123456789,12/05/2026,100,-5"),
    { clientes: CLIENTES, hoy: "2026-08-29" }
  )
  assert.deepEqual(estados(p), ["error", "error", "error"])
})

test("folio duplicado en el archivo y folio ya existente", () => {
  const p = planFacturas(
    filas("folio,ruc_cliente,fecha,importe\nA,100123456789,12/05/2026,100\nA,100123456789,12/05/2026,100\nB,100123456789,12/05/2026,100"),
    { clientes: CLIENTES, folios: ["B"], hoy: "2026-08-29" }
  )
  assert.deepEqual(estados(p), ["crear", "error", "omitir"])
})

/* ---------------------------------------------------------------- resumen -- */

test("resumen cuenta por estado", () => {
  const p = planProductos(filas("sku\nA\nA\nB"), { existentes: [{ sku: "B" }] })
  assert.deepEqual(resumen(p), { crear: 1, omitir: 1, error: 1, total: 3 })
})

test("faltantes señala columnas obligatorias ausentes", () => {
  assert.deepEqual(faltantes(["descripcion", "costo"], ["sku"]), ["sku"])
  assert.deepEqual(faltantes(["sku", "costo"], ["sku"]), [])
})

/* ------------------------------------------------- el archivo real de Excel -- */

test("archivo de Excel en español de punta a punta", () => {
  // BOM, punto y coma, decimales con coma, fechas d/m/a, acentos.
  const csv =
    "\uFEFFfolio;ruc_cliente;fecha;importe;importe_pagado\r\n" +
    "INV-00891;100123456789;12/05/2026;5.140,25;2.000,00\r\n" +
    "INV-00892;100123456789;03/06/2026;1.200,00;\r\n"
  const p = planFacturas(filas(csv), { clientes: CLIENTES, hoy: "2026-08-29" })
  assert.deepEqual(estados(p), ["crear", "crear"])
  assert.equal(p[0].datos.factura.importe, 5140.25)
  assert.equal(p[0].datos.pago.amount, 2000)
  assert.equal(p[1].datos.factura.fecha, "2026-06-03")
  assert.equal(p[1].datos.pago, null)
})

test("cada error trae el renglón del archivo para poder buscarlo en Excel", () => {
  const p = planProductos(filas("sku\nA\n\nB\n,"))
  const conError = p.filter((r) => r.estado === "error")
  assert.ok(conError.every((r) => typeof r.n === "number" && r.n >= 2))
})

/* -------------------------------------------------------------- plantillas -- */

test("cada plantilla tiene un valor de ejemplo por columna", () => {
  // Con un valor de menos la plantilla sale corrida una casilla y el ejemplo
  // enseña el formato equivocado — y la plantilla es lo PRIMERO que ven.
  for (const [clave, p] of Object.entries(PLANTILLAS)) {
    assert.equal(p.ejemplo.length, p.columnas.length, `plantilla ${clave}`)
  }
})

test("la plantilla que se descarga se puede volver a importar sin errores", () => {
  // El viaje redondo completo: generar -> leer -> planear.
  const gen = (clave) => {
    const p = PLANTILLAS[clave]
    return parseCSV(generaCSV(p.columnas.map(([c]) => c), [p.ejemplo])).filas
  }

  assert.deepEqual(estados(planProductos(gen("productos"))), ["crear"])
  assert.deepEqual(estados(planClientes(gen("clientes"))), ["crear"])
  assert.deepEqual(
    estados(planFacturas(gen("facturas"), { clientes: CLIENTES, hoy: "2026-08-29" })),
    ["crear"]
  )
})

test("la plantilla de facturas mapea el ejemplo a la columna correcta", () => {
  const p = PLANTILLAS.facturas
  const [f] = parseCSV(generaCSV(p.columnas.map(([c]) => c), [p.ejemplo])).filas
  assert.equal(f.folio, "INV-00891")
  assert.equal(f.ruc_cliente, "100123456789")
  assert.equal(f.fecha, "12/05/2026")   // no bajo nombre_cliente
  assert.equal(f.importe, "5140.25")
  assert.equal(f.importe_pagado, "2000.00")
})
