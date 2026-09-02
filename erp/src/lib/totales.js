import * as React from "react"

import { rpc } from "./supabase"

/**
 * Los totales de la cabecera de una lista, calculados en el servidor.
 *
 * POR QUÉ NO SE SUMA EN EL NAVEGADOR
 *
 * «4 cuentas · por cobrar $27,911.15» salía de sumar el arreglo que la pantalla
 * ya tenía cargado. Eso solo funciona mientras quepa TODO, y deja de funcionar
 * de la peor manera posible: con paginación sumaría nada más la página visible,
 * y pasadas mil filas PostgREST recorta la respuesta sin devolver error. En los
 * dos casos la cifra sale más chica de lo real y nada en la pantalla lo indica.
 *
 * Un total equivocado en la cabecera de un ERP es peor que no tenerlo: la gente
 * lo lee de reojo y toma decisiones con él.
 *
 * @param fn      nombre del RPC: 'totales_facturas', 'totales_clientes'…
 * @param recarga cámbialo para volver a pedir después de crear o borrar algo
 * @returns el objeto del RPC, o null mientras llega — la pantalla debe pintar
 *          «…» con null y NUNCA cero, que se leería como un dato real.
 */
export function useTotales(fn, recarga = 0) {
  const [datos, setDatos] = React.useState(null)

  React.useEffect(() => {
    let vivo = true
    rpc(fn)
      .then((t) => vivo && setDatos(t))
      // Un fallo aquí no debe tumbar la lista: la cabecera se queda en «…» y
      // los renglones, que son lo importante, se siguen viendo.
      .catch(() => vivo && setDatos(null))
    return () => {
      vivo = false
    }
  }, [fn, recarga])

  return datos
}
