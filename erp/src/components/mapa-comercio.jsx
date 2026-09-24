import * as React from "react"

/**
 * Panamá como centro de acopio: entra de Asia, sale a toda Latinoamérica.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ES UN MAPA DE VERDAD
 * ─────────────────────────────────────────────────────────────────────────────
 * En un mapa real, Colombia, Ecuador, Panamá y Costa Rica caben en un pulgar:
 * los destinos quedarían amontonados encima del centro y el dibujo no diría
 * nada. Y China e India caerían al otro extremo del mundo, leyéndose de derecha
 * a izquierda.
 *
 * Así que es un diagrama de FLUJO con forma de mapa: origen a la izquierda,
 * Zona Libre en medio, destino a la derecha. Se lee en el orden en que se lee
 * cualquier cosa, y dice lo único que tiene que decir — la mercancía entra por
 * un lado, se consolida y sale por el otro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL MOVIMIENTO SE APAGA SI EL SISTEMA LO PIDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Todo se anima con CSS, no con SMIL ni con un bucle de JavaScript, justamente
 * para que `prefers-reduced-motion` pueda pararlo (index.css). Sin movimiento
 * el dibujo sigue completo y legible: las rutas y los nodos ya cuentan la
 * historia, la animación solo le da dirección.
 */

const ANCHO = 1200
const ALTO = 560

const HUB = { x: 600, y: 280 }

// Entra: de dónde llega el contenedor.
const ORIGENES = [
  { x: 330, y: 110, nombre: "China" },
  { x: 285, y: 225, nombre: "India" },
  { x: 285, y: 340, nombre: "Vietnam" },
  { x: 330, y: 455, nombre: "Turquía" },
]

// Sale: a dónde se reexporta, ya consolidado.
const DESTINOS = [
  { x: 850, y: 60, nombre: "México" },
  { x: 885, y: 135, nombre: "Guatemala" },
  { x: 905, y: 210, nombre: "R. Dominicana" },
  { x: 912, y: 285, nombre: "Colombia" },
  { x: 905, y: 360, nombre: "Ecuador" },
  { x: 885, y: 435, nombre: "Perú" },
  { x: 850, y: 510, nombre: "Chile" },
]

/**
 * Una curva del nodo al centro.
 *
 * El punto de control se desplaza PERPENDICULAR a la recta, así cada ruta se
 * abre con la misma mano y el haz no se ve como un manojo de rectas.
 */
function arco(a, b, curva = 0.12) {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  return `M ${a.x} ${a.y} Q ${mx - dy * curva} ${my + dx * curva} ${b.x} ${b.y}`
}

function Ruta({ d, retraso, saliente }) {
  const lado = saliente ? "sale" : "entra"
  return (
    <>
      <path d={d} className={`mc-ruta mc-ruta-${lado}`} fill="none" />
      {/* El guion que viaja: es lo que da el SENTIDO. Sin él, una línea
          entre dos puntos no dice si la carga entra o sale. */}
      <path
        d={d}
        fill="none"
        className={`mc-pulso mc-pulso-${lado}`}
        style={{ animationDelay: `${retraso}s` }}
      />
    </>
  )
}

// La etiqueta va del lado de AFUERA del nodo: así ninguna ruta la cruza.
function Nodo({ x, y, nombre, saliente }) {
  return (
    <g className={saliente ? "mc-nodo mc-nodo-sale" : "mc-nodo mc-nodo-entra"}>
      <circle cx={x} cy={y} r="14" className="mc-nodo-aro" />
      <circle cx={x} cy={y} r="6" />
      <text
        x={saliente ? x + 24 : x - 24}
        y={y + 7}
        textAnchor={saliente ? "start" : "end"}
        className="mc-etiqueta"
      >
        {nombre}
      </text>
    </g>
  )
}

export function MapaComercio({ className }) {
  // Los arcos se calculan una vez: son geometría fija, no estado.
  const entradas = React.useMemo(() => ORIGENES.map((o) => arco(o, HUB)), [])
  const salidas = React.useMemo(() => DESTINOS.map((d) => arco(HUB, d)), [])

  return (
    <svg
      viewBox={`0 0 ${ANCHO} ${ALTO}`}
      className={className}
      role="img"
      aria-label="Diagrama: la mercancía entra desde Asia a la Zona Libre de Colón y sale hacia toda Latinoamérica."
    >
      <defs>
        <radialGradient id="mc-halo">
          <stop offset="0%" className="mc-halo-centro" />
          <stop offset="100%" className="mc-halo-borde" />
        </radialGradient>
      </defs>

      {entradas.map((d, i) => (
        <Ruta key={`e${i}`} d={d} retraso={i * 0.9} />
      ))}
      {salidas.map((d, i) => (
        <Ruta key={`s${i}`} d={d} retraso={1.2 + i * 0.6} saliente />
      ))}

      {ORIGENES.map((o) => (
        <Nodo key={o.nombre} {...o} />
      ))}
      {DESTINOS.map((d) => (
        <Nodo key={d.nombre} {...d} saliente />
      ))}

      {/* El centro, al final para que quede por encima de todas las rutas. */}
      <circle cx={HUB.x} cy={HUB.y} r="130" fill="url(#mc-halo)" />
      <circle cx={HUB.x} cy={HUB.y} r="34" className="mc-hub-onda" fill="none" />
      <circle cx={HUB.x} cy={HUB.y} r="34" className="mc-hub-onda mc-hub-onda-2" fill="none" />
      <circle cx={HUB.x} cy={HUB.y} r="15" className="mc-hub" />
      <text x={HUB.x} y={HUB.y - 50} textAnchor="middle" className="mc-hub-texto">
        PANAMÁ
      </text>
    </svg>
  )
}
