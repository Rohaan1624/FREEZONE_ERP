import * as React from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Recorrido guiado de la primera vez.
 *
 * Cada paso apunta a un elemento marcado con `data-tour="…"` en su pantalla y
 * lo ilumina con un recorte en el velo oscuro; al lado, una tarjeta explica
 * qué es y para qué sirve. El recorrido va de pantalla en pantalla solo: un
 * paso con `ruta` navega hasta ella; uno sin `ruta` se queda donde está.
 *
 * El orden sigue el de alguien que empieza: sus datos, su catálogo, sus
 * clientes, sus compras, cómo facturar, y al final dónde ver cómo va.
 *
 * Si un elemento no aparece (una pantalla que tardó, un botón que no se
 * muestra en el teléfono), la tarjeta sale centrada sin recorte en vez de
 * atorarse: el recorrido nunca se queda colgado.
 */
const PASOS = [
  {
    titulo: "Bienvenido a ERP ZL",
    texto:
      "En un par de minutos te mostramos dónde está cada cosa: primero los datos de tu empresa, luego catálogo, clientes y compras, y al final cómo facturar. Puedes salir cuando quieras.",
  },

  // ── Empresa
  {
    ruta: "/empresa",
    objetivo: "nav-/empresa",
    titulo: "Empresa",
    texto: "Los datos de tu empresa y la configuración. Empezamos por aquí.",
  },
  {
    objetivo: "empresa-name",
    titulo: "Nombre de la empresa",
    texto: "Sale en el encabezado de la app y en cada factura y packing list.",
  },
  {
    objetivo: "empresa-tax_id",
    titulo: "RUC",
    texto: "Tu RUC con su dígito verificador. Se imprime debajo del nombre en cada factura.",
  },
  {
    objetivo: "empresa-contact",
    titulo: "Teléfono, correo y sitio web",
    texto:
      "Tus datos de contacto, en la línea de contacto de la factura. El que dejes vacío simplemente no se imprime.",
  },
  {
    objetivo: "empresa-invoice_prefix",
    titulo: "Serie de folios",
    texto:
      "El prefijo de tus facturas: con «INV-» salen INV-00001, INV-00002… Puedes cambiarlo cuando quieras; el número nunca se repite.",
  },
  {
    objetivo: "empresa-logo_url",
    titulo: "Logo",
    texto:
      "La dirección web de tu logo (PNG o JPG). Aparece en el menú de la app en lugar de tus iniciales.",
  },
  {
    objetivo: "empresa-direccion",
    titulo: "Dirección",
    texto: "Un renglón por línea, tal como quieres verla impresa en la factura.",
  },
  {
    objetivo: "empresa-guardar",
    titulo: "Guardar cambios",
    texto: "Se activa cuando cambias algo. Nada se guarda hasta que lo pulses.",
  },
  {
    objetivo: "empresa-importar",
    titulo: "¿Ya tienes datos en otro sistema?",
    texto:
      "Importa tu catálogo, tus clientes y las facturas que te deben desde archivos CSV (Excel los guarda así). Antes de guardar te muestra qué se va a crear, qué se omite y qué tiene errores.",
  },

  // ── Productos
  {
    ruta: "/productos",
    objetivo: "nav-/productos",
    titulo: "Productos",
    texto: "Tu catálogo de SKU, con su existencia, costo y precio.",
  },
  {
    objetivo: "productos-nuevo",
    titulo: "Nuevo SKU",
    texto:
      "Código, descripción, unidad, piezas por bulto, costo y precio de venta. La existencia no se escribe aquí: sube con las entradas y baja con las facturas.",
  },
  {
    objetivo: "productos-buscar",
    titulo: "Buscar",
    texto: "Por SKU o descripción. Toca un producto para ver todos sus movimientos.",
  },

  // ── Clientes
  {
    ruta: "/clientes",
    objetivo: "nav-/clientes",
    titulo: "Clientes",
    texto: "A quién le vendes y cuánto te debe cada uno.",
  },
  {
    objetivo: "clientes-nuevo",
    titulo: "Nuevo cliente",
    texto:
      "Nombre, RUC, dirección y condiciones de pago. Las condiciones (contado, neto 30…) fijan el vencimiento de cada factura nueva. El saldo se calcula solo.",
  },
  {
    objetivo: "clientes-buscar",
    titulo: "Buscar",
    texto: "Por nombre, RUC o contacto. Toca un cliente para ver su estado de cuenta y registrar pagos.",
  },

  // ── Entradas
  {
    ruta: "/entradas",
    objetivo: "nav-/entradas",
    titulo: "Entradas",
    texto: "Tus compras de mercancía: lo que llega del proveedor.",
  },
  {
    objetivo: "entradas-nueva",
    titulo: "Nueva entrada",
    texto:
      "Captura los productos del contenedor y sus gastos: flete, maniobras, trámites. El sistema reparte los gastos entre la mercancía y te da el costo real de cada bulto. La existencia sube al cerrar la entrada.",
  },
  {
    objetivo: "sub-/entradas/ajustes",
    titulo: "Ajustes de inventario",
    texto: "Para roturas, mermas o conteos físicos. Cada ajuste queda registrado con su motivo.",
  },

  // ── Facturas
  {
    ruta: "/facturas",
    objetivo: "nav-/facturas",
    titulo: "Facturas",
    texto: "Tus ventas. Al entrar ves las abiertas: las que todavía falta cobrar.",
  },
  {
    objetivo: "facturas-filtro",
    titulo: "Filtro por estado",
    texto: "Borrador, pendiente, parcial, vencida o pagada. El número al lado dice cuántas hay.",
  },
  {
    objetivo: "facturas-buscar",
    titulo: "Buscar",
    texto: "Por folio o por cliente. No importan las tildes ni el orden de las palabras.",
  },
  {
    objetivo: "facturas-nueva",
    titulo: "Nueva factura",
    texto: "Vamos a verla por dentro.",
  },
  {
    ruta: "/facturas/nueva",
    objetivo: "factura-cliente",
    titulo: "Cliente",
    texto:
      "Búscalo por nombre o RUC. Si es nuevo, créalo con el botón de al lado sin salir de la factura.",
  },
  {
    objetivo: "factura-fecha",
    titulo: "Fecha y vencimiento",
    texto:
      "Puedes antedatar una factura, pero no ponerle fecha futura. El vencimiento sale de las condiciones de pago del cliente.",
  },
  {
    objetivo: "factura-descontar",
    titulo: "Descontar del inventario",
    texto:
      "Apagado, la factura se guarda como borrador: no mueve inventario ni cuenta en el saldo del cliente. Enciéndelo para emitirla; antes te pide confirmación.",
  },
  {
    objetivo: "factura-documento",
    titulo: "Datos del documento",
    texto:
      "Opcionales y solo se imprimen: facturar a otro nombre o dirección, orden de compra, marcas, datos de embarque.",
  },
  {
    objetivo: "factura-lineas",
    titulo: "Renglones",
    texto:
      "Productos del inventario (se capturan en bultos), cargos como el flete, y misceláneos para lo que no está en tu catálogo.",
  },
  {
    objetivo: "factura-resumen",
    titulo: "Resumen y guardar",
    texto:
      "Totales, bultos y el total a cobrar. El botón dice exactamente lo que va a hacer: guardar un borrador o emitir la factura.",
  },

  // ── Resumen
  {
    ruta: "/resumen",
    objetivo: "nav-/resumen",
    titulo: "Resumen",
    texto: "Cómo va el negocio, de un vistazo.",
  },
  {
    objetivo: "resumen-ingresos",
    titulo: "Ingresos",
    texto:
      "Lo facturado por año, mes o semana, contra el periodo anterior. El ícono de tabla muestra las cifras exactas.",
  },
  {
    objetivo: "resumen-indicadores",
    titulo: "Indicadores",
    texto: "Lo cobrado, el margen bruto, el valor de tu inventario y cuántas facturas llevas.",
  },
  {
    objetivo: "resumen-cobrar",
    titulo: "Cuentas por cobrar",
    texto: "Lo que te deben, por antigüedad. «Por cliente» te dice quién.",
  },
  {
    objetivo: "tour-repetir",
    titulo: "¡Listo!",
    texto: "Si quieres ver el recorrido otra vez, está aquí.",
  },
]

// La ruta de un paso es la suya o la del último paso que la tenía.
function rutaDe(i) {
  for (let k = i; k >= 0; k--) if (PASOS[k].ruta) return PASOS[k].ruta
  return null
}

// El mismo `data-tour` puede estar dos veces (menú lateral y barra del
// teléfono): se usa el que está a la vista.
function visible(clave) {
  for (const el of document.querySelectorAll(`[data-tour="${CSS.escape(clave)}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

const MARGEN = 8 // aire alrededor del recorte
const HUECO = 14 // entre el recorte y la tarjeta

export function Recorrido({ onTerminar }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [i, setI] = React.useState(0)
  const [rect, setRect] = React.useState(null)
  const [perdido, setPerdido] = React.useState(false)
  const tarjeta = React.useRef(null)
  const [tam, setTam] = React.useState({ w: 340, h: 180 })

  const paso = PASOS[i]
  const ultimo = i === PASOS.length - 1
  const ruta = rutaDe(i)

  // Ir a la pantalla del paso.
  React.useEffect(() => {
    if (ruta && pathname !== ruta) navigate(ruta)
  }, [ruta, pathname, navigate])

  // Encontrar el elemento, llevarlo a la vista y seguirlo: la página puede
  // moverse (carga de datos, desplazamiento suave, cambio de tamaño).
  React.useEffect(() => {
    setRect(null)
    setPerdido(false)
    if (!paso.objetivo) return
    if (ruta && pathname !== ruta) return
    let raf
    let visto = false
    const inicio = performance.now()
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const mirar = () => {
      const el = visible(paso.objetivo)
      if (el) {
        if (!visto) {
          el.scrollIntoView({ block: "center", behavior: suave ? "smooth" : "auto" })
          visto = true
        }
        const r = el.getBoundingClientRect()
        setRect((p) =>
          p && p.top === r.top && p.left === r.left && p.width === r.width && p.height === r.height
            ? p
            : { top: r.top, left: r.left, width: r.width, height: r.height }
        )
      } else if (!visto && performance.now() - inicio > 2500) {
        setPerdido(true)
        return
      }
      raf = requestAnimationFrame(mirar)
    }
    raf = requestAnimationFrame(mirar)
    return () => cancelAnimationFrame(raf)
  }, [i, paso.objetivo, ruta, pathname])

  // Medir la tarjeta para colocarla sin que se salga de la pantalla.
  React.useLayoutEffect(() => {
    const el = tarjeta.current
    if (el) setTam((p) => (p.w === el.offsetWidth && p.h === el.offsetHeight ? p : { w: el.offsetWidth, h: el.offsetHeight }))
  })

  const siguiente = React.useCallback(() => (ultimo ? onTerminar() : setI((n) => n + 1)), [ultimo, onTerminar])
  const anterior = React.useCallback(() => setI((n) => Math.max(0, n - 1)), [])

  React.useEffect(() => {
    const tecla = (e) => {
      if (e.key === "Escape") onTerminar()
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault()
        siguiente()
      } else if (e.key === "ArrowLeft") anterior()
    }
    window.addEventListener("keydown", tecla)
    return () => window.removeEventListener("keydown", tecla)
  }, [siguiente, anterior, onTerminar])

  const recorte = rect && {
    top: rect.top - MARGEN,
    left: rect.left - MARGEN,
    width: rect.width + MARGEN * 2,
    height: rect.height + MARGEN * 2,
  }
  const pos = colocar(recorte, tam)
  const esperando = paso.objetivo && !rect && !perdido

  return (
    <div className="fixed inset-0 z-[60] print:hidden" role="dialog" aria-modal="true" aria-label={paso.titulo}>
      {/* Capa que atrapa los clics: durante el recorrido no se opera la app. */}
      <div className="absolute inset-0" />

      {recorte ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-white/80 transition-all duration-300 ease-out"
          style={{ ...recorte, boxShadow: "0 0 0 9999px rgba(32,30,29,0.58)" }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-ink/58 transition-opacity" />
      )}

      <div
        ref={tarjeta}
        className={cn(
          "absolute flex w-[min(360px,calc(100vw-32px))] flex-col gap-3 rounded-2xl bg-white p-5 shadow-lg transition-[top,left,opacity] duration-300 ease-out",
          esperando && "opacity-0"
        )}
        style={pos}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-neutral-600 tabular-nums">
            {i === 0 ? "Recorrido" : `${i} de ${PASOS.length - 1}`}
          </span>
          <button
            type="button"
            onClick={onTerminar}
            title="Salir del recorrido"
            className="accion ml-auto size-7"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Barra de avance: dice cuánto falta sin contar pasos. */}
        <div className="h-1 overflow-hidden rounded-full bg-newsprint">
          <div
            className="h-full rounded-full bg-ink transition-[width] duration-300"
            style={{ width: `${(i / (PASOS.length - 1)) * 100}%` }}
          />
        </div>
        <div>
          <h4 className="m-0 text-[18px]">{paso.titulo}</h4>
          <p className="mt-1.5 mb-0 text-[14px] leading-relaxed text-neutral-700">{paso.texto}</p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {i === 0 ? (
            <button type="button" onClick={onTerminar} className="boton px-2 text-neutral-600 hover:text-ink">
              Ahora no
            </button>
          ) : (
            <button type="button" onClick={anterior} className="boton boton-claro">
              <ArrowLeft className="size-4" />
              Anterior
            </button>
          )}
          <button type="button" onClick={siguiente} autoFocus className="boton boton-ink ml-auto">
            {i === 0 ? "Empezar" : ultimo ? "Terminar" : "Siguiente"}
            {ultimo ? <Check className="size-4" /> : <ArrowRight className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Dónde va la tarjeta: debajo del recorte si cabe; si no, encima; si el
 * elemento es muy alto (una lista, el menú lateral), a un costado; y si nada
 * cabe, abajo al centro. Siempre dentro de la pantalla, con 16px de margen.
 */
function colocar(r, { w, h }) {
  const W = window.innerWidth
  const H = window.innerHeight
  const m = 16
  const encajarX = (x) => Math.min(Math.max(x, m), W - w - m)
  const encajarY = (y) => Math.min(Math.max(y, m), H - h - m)
  if (!r) return { top: encajarY((H - h) / 2), left: encajarX((W - w) / 2) }

  const centroX = r.left + r.width / 2 - w / 2
  if (r.top + r.height + HUECO + h <= H - m) return { top: r.top + r.height + HUECO, left: encajarX(centroX) }
  if (r.top - HUECO - h >= m) return { top: r.top - HUECO - h, left: encajarX(centroX) }
  const centroY = encajarY(r.top + r.height / 2 - h / 2)
  if (r.left + r.width + HUECO + w <= W - m) return { top: centroY, left: r.left + r.width + HUECO }
  if (r.left - HUECO - w >= m) return { top: centroY, left: r.left - HUECO - w }
  return { top: H - h - m, left: encajarX((W - w) / 2) }
}
