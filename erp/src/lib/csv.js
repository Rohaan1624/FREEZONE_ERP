/**
 * Lector de CSV para la importación desde el sistema anterior.
 *
 * Sin dependencia: las bibliotecas de CSV pesan más que esto y ninguna resuelve
 * lo que de verdad rompe aquí, que no es el formato sino Excel en español.
 *
 * Lo que sí rompe, en orden de frecuencia:
 *
 *   1. El separador es `;`, no `,`. Excel usa el separador de lista del sistema,
 *      y en configuración regional española eso es punto y coma. Un archivo
 *      "CSV" exportado en Panamá o México casi nunca viene con comas.
 *   2. Decimales con coma: 5,50 en vez de 5.50. Va de la mano de lo anterior.
 *   3. BOM al inicio (U+FEFF). Excel lo escribe al guardar como UTF-8 y sin
 *      quitarlo el PRIMER encabezado no coincide con nada — el síntoma es
 *      «falta la columna sku» con la columna sku a la vista.
 *   4. Saltos CRLF y una última línea vacía.
 *   5. Encabezados con acentos y mayúsculas inconsistentes.
 *
 * Todo eso se normaliza aquí para que las reglas de negocio no lo vuelvan a ver.
 */

/** Quita acentos, espacios y mayúsculas: 'Descripción ' -> 'descripcion'. */
export const normaliza = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")

/**
 * Adivina el separador contando ocurrencias FUERA de comillas en la primera
 * línea. Contar a secas fallaría con un encabezado como "Precio, con IVA".
 */
export function detectaDelimitador(texto) {
  const linea = texto.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? ""
  let dentro = false
  const cuenta = { ",": 0, ";": 0, "\t": 0 }
  for (const ch of linea) {
    if (ch === '"') dentro = !dentro
    else if (!dentro && ch in cuenta) cuenta[ch]++
  }
  // Empate en 0 -> coma, que es lo que produce cualquier exportador serio.
  return [";", "\t", ","].find((d) => cuenta[d] > 0) ?? ","
}

/**
 * Convierte texto a número aceptando las dos convenciones decimales.
 *
 * El separador decimal es el ÚLTIMO punto o coma que aparezca: en "1.234,50"
 * la coma manda y en "1,234.50" manda el punto. Lo anterior son separadores de
 * miles y se tiran. Devuelve null si no hay número, para que «vacío» siga
 * siendo distinto de cero — un costo ausente no es un costo de $0.
 */
export function aNumero(v) {
  const s = String(v ?? "").trim().replace(/[$\s]/g, "")
  if (s === "") return null
  const ultimoPunto = s.lastIndexOf(".")
  const ultimaComa = s.lastIndexOf(",")
  const corte = Math.max(ultimoPunto, ultimaComa)
  let limpio
  if (corte === -1) {
    limpio = s.replace(/[^0-9-]/g, "")
  } else {
    const ent = s.slice(0, corte).replace(/[^0-9-]/g, "")
    const dec = s.slice(corte + 1).replace(/[^0-9]/g, "")
    limpio = dec === "" ? ent : `${ent}.${dec}`
  }
  if (limpio === "" || limpio === "-") return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

/**
 * Fecha en las formas que produce Excel: ISO, d/m/a y m/d/a.
 *
 * AMBIGÜEDAD REAL: 03/05/2026 puede ser 3 de mayo o 5 de marzo y el archivo no
 * dice cuál. Se asume DÍA PRIMERO, que es la convención en Panamá y en toda
 * Latinoamérica; con el otro orden la fecha existe igual y nadie se entera.
 * Por eso la pantalla muestra las fechas ya interpretadas ANTES de escribir:
 * es la única forma de que alguien note que están al revés.
 *
 * Devuelve 'YYYY-MM-DD' o null.
 */
export function aFecha(v) {
  const s = String(v ?? "").trim()
  if (s === "") return null

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return armaFecha(+iso[1], +iso[2], +iso[3])

  const sep = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (sep) {
    let [, a, b, anio] = sep
    let dd = +a
    let mm = +b
    // Día primero, salvo que sea imposible (13/05 -> el 13 es el mes).
    if (dd > 12 && mm <= 12) {
      // ya está bien
    } else if (mm > 12 && dd <= 12) {
      ;[dd, mm] = [mm, dd]
    }
    let y = +anio
    if (y < 100) y += y < 70 ? 2000 : 1900
    return armaFecha(y, mm, dd)
  }
  return null
}

function armaFecha(y, m, d) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null
  const f = new Date(Date.UTC(y, m - 1, d))
  // Rechaza el 31 de febrero en vez de dejar que JS lo corra a marzo.
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null
  return f.toISOString().slice(0, 10)
}

/**
 * Parte el texto en filas y celdas respetando comillas.
 *
 * Se hace a mano y no con split porque un campo entrecomillado puede contener
 * el separador, saltos de línea y comillas escapadas como "". Un split simple
 * parte "Calle 1, Local 1" en dos columnas y desalinea el resto del renglón.
 */
function celdas(texto, delim) {
  const filas = []
  let fila = []
  let campo = ""
  let dentro = false

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]

    if (dentro) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else dentro = false
      } else campo += c
      continue
    }

    if (c === '"') dentro = true
    else if (c === delim) {
      fila.push(campo)
      campo = ""
    } else if (c === "\n") {
      fila.push(campo)
      filas.push(fila)
      fila = []
      campo = ""
    } else if (c !== "\r") campo += c
  }
  fila.push(campo)
  filas.push(fila)
  return filas
}

/**
 * Lee un CSV completo.
 *
 * @returns {{encabezados: string[], filas: object[], delimitador: string}}
 *   `filas` son objetos con las claves ya normalizadas, más `_n` con el número
 *   de renglón EN EL ARCHIVO (contando el encabezado), para que un error se
 *   pueda señalar como «línea 42» y la persona lo encuentre en Excel.
 */
export function parseCSV(texto) {
  const limpio = String(texto ?? "").replace(/^\uFEFF/, "")
  const delimitador = detectaDelimitador(limpio)
  const crudas = celdas(limpio, delimitador)

  const encabezados = (crudas[0] ?? []).map(normaliza)
  const filas = []

  for (let i = 1; i < crudas.length; i++) {
    const c = crudas[i]
    // Renglón totalmente vacío: Excel siempre deja al menos uno al final.
    if (c.every((x) => String(x).trim() === "")) continue
    const o = { _n: i + 1 }
    encabezados.forEach((h, j) => {
      if (h) o[h] = String(c[j] ?? "").trim()
    })
    filas.push(o)
  }

  return { encabezados, filas, delimitador }
}

/** Genera un CSV a partir de encabezados y filas — para las plantillas. */
export function generaCSV(encabezados, filas = []) {
  const esc = (v) => {
    const s = String(v ?? "")
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // BOM + CRLF: así Excel abre los acentos bien de doble clic, sin asistente.
  return (
    "\uFEFF" +
    [encabezados, ...filas].map((f) => f.map(esc).join(",")).join("\r\n") +
    "\r\n"
  )
}
