import { test } from "node:test"
import assert from "node:assert/strict"

import { columnasOpcionales } from "./documento.js"

test("sin origen ni composición en ningún renglón, no se abre ninguna columna", () => {
  assert.deepEqual(
    columnasOpcionales([
      { type: "product", origin: null, composition: null },
      { type: "miscellaneous", origin: "", composition: "   " },
    ]),
    { origen: false, composicion: false }
  )
})

test("basta un renglón con origen para abrir esa columna, y solo esa", () => {
  assert.deepEqual(
    columnasOpcionales([
      { type: "product", origin: null },
      { type: "miscellaneous", origin: "China" },
    ]),
    { origen: true, composicion: false }
  )
})

test("cada columna se decide por separado", () => {
  assert.deepEqual(
    columnasOpcionales([
      { type: "product", origin: "India" },
      { type: "product", composition: "100% algodón" },
    ]),
    { origen: true, composicion: true }
  )
})

test("un cargo no abre columnas aunque traiga datos", () => {
  assert.deepEqual(columnasOpcionales([{ type: "charge", origin: "China", composition: "acero" }]), {
    origen: false,
    composicion: false,
  })
})

test("sin renglones, sin columnas", () => {
  assert.deepEqual(columnasOpcionales(), { origen: false, composicion: false })
})
