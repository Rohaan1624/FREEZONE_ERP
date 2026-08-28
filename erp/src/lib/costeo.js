import { M, mul, div, sumar } from "./dinero.js"

/**
 * Prorrateo de gastos de una entrada — el «costo aterrizado».
 *
 * Los gastos de un contenedor (flete, maniobras, permisos) no son de ningún SKU
 * en particular, pero el costo real de la mercancía sí los incluye. Hay que
 * repartirlos, y la base del reparto cambia el resultado.
 *
 * SE REPARTE POR VALOR: cada renglón absorbe la misma proporción de gastos que
 * aporta de mercancía. Un SKU que es el 80% de la compra carga con el 80% del
 * flete.
 *
 * La alternativa obvia —dividir los gastos entre el total de unidades y sumar
 * lo mismo a cada una— castiga a los SKU baratos: con $2,000 de gastos sobre
 * 1,000 unidades de $8 y 500 de $4, el reparto plano sube el de $8 un 16.7% y
 * el de $4 un 33.3%, nada más porque es barato. El flete no sabe eso.
 *
 * Por valor el reparto se colapsa en UN SOLO multiplicador, y ahí está lo
 * bonito del método: el álgebra cancela la cantidad, así que
 *
 *     aporte del renglón = gastos x (qty x costo) / mercancía
 *     por unidad         = gastos x costo / mercancía
 *     costo aterrizado   = costo x (1 + gastos/mercancía)
 *
 * es decir `costo x factor`, con el mismo factor para todos. Se audita de un
 * vistazo y reconcilia solo: sum(qty x aterrizado) = mercancía + gastos, exacto.
 *
 * LÍMITE CONOCIDO: por valor es la base correcta para lo que escala con el
 * valor (seguro, comisiones). El flete marítimo se cobra por volumen, así que
 * si un contenedor mezcla mercancía cara-compacta con barata-voluminosa, el
 * reparto por valor le carga de más a la cara. Con mercancía pareja la
 * diferencia es mínima. Si algún día hace falta, la base se elige por renglón
 * de gasto (valor / CBM / peso / bultos) sin cambiar nada de esto.
 *
 * Nada de esto se guarda ni sobrescribe product.cost_price: se recalcula al
 * vuelo desde los renglones, igual que los bultos.
 */

const importe = (l) => mul(l.qty, l.cost_unit)

/**
 * @param lineas renglones tal como los tiene el formulario: {type, qty, cost_unit}
 * @returns totales y dos funciones por renglón, todo en Big
 */
export function costeo(lineas = []) {
  const productos = lineas.filter((l) => l.type === "product")
  const cargos = lineas.filter((l) => l.type !== "product")

  const mercancia = sumar(productos, importe)
  const gastos = sumar(cargos, importe)

  // div() devuelve null si la mercancía es 0 — no hay sobre qué repartir.
  // Sin base no se inventa una: el costo se queda como se capturó y la UI
  // avisa, que es más honesto que repartir entre cero renglones válidos.
  const factor = div(mercancia.plus(gastos), mercancia)

  return {
    mercancia,
    gastos,
    total: mercancia.plus(gastos),
    unidades: sumar(productos, (l) => l.qty),
    factor,
    prorrateable: factor !== null,

    /** Costo unitario ya con su parte de los gastos. */
    aterrizado: (l) => (factor === null ? M(l.cost_unit) : mul(l.cost_unit, factor)),

    /** Cuántos gastos absorbe el renglón completo — para mostrar el desglose. */
    absorbido: (l) => (factor === null ? M(0) : mul(importe(l), factor.minus(1))),
  }
}
