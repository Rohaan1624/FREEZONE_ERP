import { Link, Navigate } from "react-router-dom"
import {
  ArrowRight,
  Boxes,
  Calculator,
  Check,
  FileText,
  FileUp,
  Lock,
  Wallet,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth"
import { MapaComercio } from "@/components/mapa-comercio"

/**
 * La portada pública.
 *
 * A diferencia del resto del sistema (serif, papel), aquí va en sans y fondo
 * oscuro: es la cara de venta, no el documento de trabajo. Todo el texto se
 * mantiene corto a propósito — quien llega ya sabe qué le duele.
 *
 * Todas las secciones usan el mismo `Marco`, así los bordes izquierdos
 * coinciden de arriba abajo. Las esquinas van en px explícitos: los tokens
 * `rounded-*` del sistema están en 2px, que es papelería, no web.
 */

const FUNCIONES = [
  {
    icono: Calculator,
    titulo: "Costos de importación",
    texto: "El flete y los gastos se reparten solos en cada bulto.",
  },
  {
    icono: Boxes,
    titulo: "Inventario al día",
    texto: "Cada entrada y cada factura mueven el mismo stock.",
  },
  {
    icono: FileText,
    titulo: "Factura y packing list",
    texto: "En PDF, listos para enviar al cliente.",
  },
  {
    icono: Wallet,
    titulo: "Cuentas por cobrar",
    texto: "Quién te debe y desde cuándo, de un vistazo.",
  },
  {
    icono: FileUp,
    titulo: "Importa lo que ya tienes",
    texto: "Catálogo, clientes y saldos desde un archivo.",
  },
  {
    icono: Lock,
    titulo: "Tus datos, solo tuyos",
    texto: "Cada empresa ve únicamente su información.",
  },
]

const INCLUIDO = [
  "Productos, clientes y facturas sin límite",
  "Costeo de entradas",
  "Factura y packing list en PDF",
  "Importación desde archivo",
]

function Marco({ children, className }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-6", className)}>{children}</div>
}

function BotonPrincipal({ className }) {
  return (
    <Link
      to="/registro"
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-white px-5 text-[15px] font-medium text-neutral-950 transition-colors hover:bg-white/85",
        className
      )}
    >
      Acceder al software
      <ArrowRight className="size-4" />
    </Link>
  )
}

export default function Inicio() {
  const { session, cargando } = useAuth()

  // Quien ya entró no viene a leer la portada: va al trabajo.
  if (cargando) return null
  if (session) return <Navigate to="/resumen" replace />

  return (
    <div className="portada min-h-svh overflow-x-clip bg-[#09090b] text-white antialiased">
      {/* ───────────────────────────────────────────────────────── menú */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#09090b]/75 backdrop-blur-md">
        <Marco className="flex h-16 items-center gap-8 whitespace-nowrap">
          <span className="text-[15px] font-semibold whitespace-nowrap tracking-tight">Zona Libre ERP</span>
          <nav className="hidden items-center gap-6 text-[14px] text-white/60 sm:flex">
            <a href="#funciones" className="transition-colors hover:text-white">
              Funciones
            </a>
            <a href="#precio" className="transition-colors hover:text-white">
              Precio
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/login"
              className="rounded-[10px] px-3 py-2 text-[14px] text-white/70 transition-colors hover:text-white"
            >
              Entrar
            </Link>
            <Link
              to="/registro"
              className="rounded-[10px] bg-white px-3.5 py-2 text-[14px] font-medium text-neutral-950 transition-colors hover:bg-white/85"
            >
              Crear cuenta
            </Link>
          </div>
        </Marco>
      </header>

      {/* ───────────────────────────────────────────────────────── hero */}
      <section className="relative">
        {/* Resplandor detrás del titular: da profundidad sin imagen. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[640px]"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(56,189,248,0.16), transparent 70%)",
          }}
        />
        <Marco className="relative flex flex-col items-center pt-20 text-center sm:pt-28">
        

          <h1 className="mt-6 mb-0 max-w-[16ch] text-[40px] leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-[64px]">
            El ERP hecho para la Zona Libre de Colón
          </h1>
          <p className="mt-5 mb-0 max-w-[52ch] text-[17px] leading-relaxed text-balance text-white/60 sm:text-[19px]">
            Inventario, costos de importación y facturación en un solo lugar. Para quien compra en
            Asia y reexporta a Latinoamérica.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <BotonPrincipal />
            <Link
              to="/login"
              className="inline-flex h-11 items-center rounded-[10px] border border-white/15 px-5 text-[15px] font-medium text-white/85 transition-colors hover:bg-white/5"
            >
              Ya tengo cuenta
            </Link>
          </div>
        </Marco>

        {/* El mapa, como pieza central. */}
        <Marco className="relative mt-16 sm:mt-20">
          <div className="rounded-[18px] border border-white/10 bg-white/[0.02] p-3 shadow-[0_0_80px_-20px_rgba(56,189,248,0.25)] sm:p-6">
            <MapaComercio className="block w-full" />
            <div className="mt-2 flex justify-center gap-6 text-[13px] text-white/55">
              <span className="inline-flex items-center gap-2">
                <span className="size-2 rounded-full bg-amber-300" /> Entra desde Asia
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="size-2 rounded-full bg-sky-400" /> Sale a Latinoamérica
              </span>
            </div>
          </div>
        </Marco>
      </section>

      {/* ──────────────────────────────────────────────────── funciones */}
      <section id="funciones" className="scroll-mt-16 py-28">
        <Marco>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="m-0 text-[32px] leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-[40px]">
              Deja atrás las hojas de cálculo
            </h2>
            <p className="mt-4 mb-0 text-[17px] text-white/60">
              Todo lo que mueve un contenedor, en un solo sistema.
            </p>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FUNCIONES.map(({ icono: Icono, titulo, texto }) => (
              <div
                key={titulo}
                className="rounded-[18px] border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20"
              >
                <div className="grid size-10 place-items-center rounded-[10px] border border-white/10 bg-white/5">
                  <Icono className="size-5 text-white/85" />
                </div>
                <h3 className="mt-5 mb-0 text-[16px] font-semibold">{titulo}</h3>
                <p className="mt-1.5 mb-0 text-[15px] leading-relaxed text-white/55">{texto}</p>
              </div>
            ))}
          </div>
        </Marco>
      </section>

      {/* ──────────────────────────────────────────────────────── precio */}
      <section id="precio" className="scroll-mt-16 border-t border-white/10 py-28">
        <Marco className="flex flex-col items-center">
          <h2 className="m-0 text-center text-[32px] leading-tight font-semibold tracking-[-0.03em] sm:text-[40px]">
            Precio
          </h2>
          <p className="mt-4 mb-0 text-center text-[17px] text-white/60">
            Gratis mientras dure la fase inicial.
          </p>

          <div className="mt-12 w-full max-w-sm rounded-[18px] border border-white/15 bg-white/[0.03] p-8">
            <div className="text-[14px] font-medium text-white/70">Plan inicial</div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-[56px] leading-none font-semibold tracking-[-0.04em]">$0</span>
              <span className="text-[15px] text-white/50">/ mes</span>
            </div>
            <ul className="mt-8 mb-0 flex list-none flex-col gap-3 p-0">
              {INCLUIDO.map((linea) => (
                <li key={linea} className="flex items-center gap-3 text-[15px] text-white/80">
                  <Check className="size-4 shrink-0 text-emerald-400" />
                  {linea}
                </li>
              ))}
            </ul>
            <BotonPrincipal className="mt-8 w-full" />
          </div>
        </Marco>
      </section>

      {/* ─────────────────────────────────────────────────────── pie */}
      <footer className="border-t border-white/10 py-8">
        <Marco className="flex flex-wrap items-center gap-4 text-[13px] text-white/45">
          <span>© {new Date().getFullYear()} Zona Libre ERP</span>
          <Link to="/login" className="ml-auto transition-colors hover:text-white">
            Entrar
          </Link>
        </Marco>
      </footer>
    </div>
  )
}
