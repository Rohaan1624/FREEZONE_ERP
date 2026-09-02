import { test } from "node:test"
import assert from "node:assert/strict"

import { parseCSV, detectaDelimitador, aNumero, aFecha, normaliza, generaCSV } from "./csv.js"

/* ------------------------------------------------------------ delimitador -- */

test("detecta el punto y coma de Excel en español", () => {
  assert.equal(detectaDelimitador("sku;descripcion;costo\nA;B;1"), ";")
})

test("detecta la coma", () => {
  assert.equal(detectaDelimitador("sku,descripcion,costo\nA,B,1"), ",")
})

test("no cuenta separadores dentro de comillas", () => {
  // Con coma real y un encabezado entrecomillado que contiene punto y coma.
  assert.equal(detectaDelimitador('sku,"precio; con flete",costo'), ",")
})

test("una sola columna sin separadores cae en coma", () => {
  assert.equal(detectaDelimitador("sku\nABC-100"), ",")
})

/* ---------------------------------------------------------------- números -- */

test("acepta punto decimal y coma decimal", () => {
  assert.equal(aNumero("5.50"), 5.5)
  assert.equal(aNumero("5,50"), 5.5)
})

test("separadores de miles en las dos convenciones", () => {
  assert.equal(aNumero("1,234.50"), 1234.5)
  assert.equal(aNumero("1.234,50"), 1234.5)
  assert.equal(aNumero("12.480,50"), 12480.5)
})

test("símbolos de moneda y espacios", () => {
  assert.equal(aNumero("$1,234.50"), 1234.5)
  assert.equal(aNumero(" 42 "), 42)
})

test("vacío es null, no cero — un costo ausente no es un costo de $0", () => {
  assert.equal(aNumero(""), null)
  assert.equal(aNumero(null), null)
  assert.equal(aNumero("   "), null)
  assert.equal(aNumero("abc"), null)
  assert.equal(aNumero("0"), 0) // cero explícito sí es cero
})

test("negativos", () => {
  assert.equal(aNumero("-12"), -12)
  assert.equal(aNumero("-1.234,50"), -1234.5)
})

/* ----------------------------------------------------------------- fechas -- */

test("ISO", () => {
  assert.equal(aFecha("2026-05-12"), "2026-05-12")
})

test("día primero, que es la convención local", () => {
  assert.equal(aFecha("12/05/2026"), "2026-05-12")
  assert.equal(aFecha("3-5-2026"), "2026-05-03")
})

test("si el primero no puede ser día, se invierte", () => {
  // 13 no es mes, así que 05/13 solo puede ser mes/día.
  assert.equal(aFecha("05/13/2026"), "2026-05-13")
})

test("año de dos dígitos", () => {
  assert.equal(aFecha("12/05/26"), "2026-05-12")
  assert.equal(aFecha("12/05/99"), "1999-05-12")
})

test("fechas imposibles se rechazan en vez de correrse de mes", () => {
  // JS convertiría el 31 de febrero en 3 de marzo sin avisar.
  assert.equal(aFecha("31/02/2026"), null)
  assert.equal(aFecha("32/01/2026"), null)
  assert.equal(aFecha("no es fecha"), null)
  assert.equal(aFecha(""), null)
})

/* ------------------------------------------------------------ encabezados -- */

test("normaliza acentos, mayúsculas y espacios", () => {
  assert.equal(normaliza(" Descripción "), "descripcion")
  assert.equal(normaliza("PIEZAS POR BULTO"), "piezas_por_bulto")
  assert.equal(normaliza("Días de crédito"), "dias_de_credito")
})

/* ----------------------------------------------------------------- parseo -- */

test("archivo típico de Excel en español: BOM, punto y coma, CRLF", () => {
  const texto = "\uFEFFsku;descripción;costo\r\nABC-100;Producto uno;5,50\r\n"
  const { encabezados, filas, delimitador } = parseCSV(texto)
  assert.equal(delimitador, ";")
  assert.deepEqual(encabezados, ["sku", "descripcion", "costo"])
  assert.equal(filas.length, 1)
  assert.equal(filas[0].sku, "ABC-100")
  assert.equal(filas[0].descripcion, "Producto uno")
  assert.equal(aNumero(filas[0].costo), 5.5)
})

test("el BOM no se queda pegado al primer encabezado", () => {
  // El síntoma clásico: «falta la columna sku» con la columna sku a la vista.
  const { encabezados } = parseCSV("\uFEFFsku,descripcion\nA,B")
  assert.equal(encabezados[0], "sku")
  assert.notEqual(encabezados[0], "\uFEFFsku")
})

test("campos entrecomillados con el separador adentro", () => {
  const { filas } = parseCSV('nombre,direccion\n"Doe, John","Calle 1, Local 1"')
  assert.equal(filas[0].nombre, "Doe, John")
  assert.equal(filas[0].direccion, "Calle 1, Local 1")
})

test("comillas escapadas", () => {
  const { filas } = parseCSV('sku,descripcion\nA,"Tubo 2"" reforzado"')
  assert.equal(filas[0].descripcion, 'Tubo 2" reforzado')
})

test("salto de línea dentro de un campo entrecomillado", () => {
  const { filas } = parseCSV('nombre,direccion\nJohn,"Calle 1\nCiudad"')
  assert.equal(filas.length, 1)
  assert.equal(filas[0].direccion, "Calle 1\nCiudad")
})

test("los renglones vacíos del final se ignoran", () => {
  const { filas } = parseCSV("sku,costo\nA,1\n\n\n")
  assert.equal(filas.length, 1)
})

test("celdas faltantes al final del renglón quedan vacías, no undefined", () => {
  const { filas } = parseCSV("sku,descripcion,costo\nA")
  assert.equal(filas[0].descripcion, "")
  assert.equal(filas[0].costo, "")
})

test("_n apunta al renglón real del archivo para poder señalarlo en Excel", () => {
  const { filas } = parseCSV("sku\nA\nB\nC")
  assert.deepEqual(
    filas.map((f) => f._n),
    [2, 3, 4]
  )
})

test("columnas de más en un renglón no rompen el resto", () => {
  const { filas } = parseCSV("sku,costo\nA,1,basura\nB,2")
  assert.equal(filas.length, 2)
  assert.equal(filas[1].sku, "B")
})

/* --------------------------------------------------------------- plantilla -- */

test("generaCSV escapa y lleva BOM para que Excel abra los acentos", () => {
  const csv = generaCSV(["sku", "descripcion"], [["A", "Tubo, 2 pulgadas"]])
  assert.ok(csv.startsWith("\uFEFF"))
  assert.ok(csv.includes('"Tubo, 2 pulgadas"'))
  assert.ok(csv.includes("\r\n"))
})

test("lo que genera se puede volver a leer", () => {
  const csv = generaCSV(
    ["sku", "descripcion", "costo"],
    [["ABC-100", 'Tubo 2" con "comillas"', "5.50"]]
  )
  const { filas } = parseCSV(csv)
  assert.equal(filas[0].sku, "ABC-100")
  assert.equal(filas[0].descripcion, 'Tubo 2" con "comillas"')
  assert.equal(aNumero(filas[0].costo), 5.5)
})
