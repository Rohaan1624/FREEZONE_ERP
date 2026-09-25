import * as React from "react"
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom"
import { ChartLine, Receipt, Users, Package, Truck, Sparkles, LogOut, Settings } from "lucide-react"

import { cn } from "@/lib/utils"
import { useAuth, RUTA_NUEVA_CLAVE } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { ASISTENTE_ACTIVO } from "@/lib/banderas"

// El asistente solo aparece si su bandera está encendida. Enseñar la pestaña
// con la función apagada llevaría a una pantalla que redirige sola, que se lee
// como un bug y no como una decisión.
const NAV = [
  { to: "/resumen", label: "Resumen", icon: ChartLine },
  { to: "/facturas", label: "Facturas", icon: Receipt },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/productos", label: "Productos", icon: Package },
  { to: "/entradas", label: "Entradas", icon: Truck },
  ...(ASISTENTE_ACTIVO ? [{ to: "/asistente", label: "Asistente", icon: Sparkles }] : []),
]

export function AppShell() {
  const { session, cargando, recuperando, usuario, salir } = useAuth()
  const [empresa, setEmpresa] = React.useState(null)
  const location = useLocation()

  React.useEffect(() => {
    if (!session) return
    // RLS scopes this to the signed-in user, so there is exactly one row and
    // no user_id filter is needed here.
    supabase
      .from("company")
      .select("*")
      .maybeSingle()
      .then(({ data }) => setEmpresa(data))
  }, [session])

  if (cargando) return null
  // A recovery link produces a valid session, so this guard has to come first —
  // otherwise the user lands in the app with their OLD password still working
  // and never sees the change-password screen.
  if (recuperando) return <Navigate to={RUTA_NUEVA_CLAVE} replace />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />

  const nombre = empresa?.name ?? "Mi Empresa"
  const iniciales = nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("")

  const logo = (clase) =>
    empresa?.logo_url ? (
      <img src={empresa.logo_url} alt="" className={cn("shrink-0 bg-white object-contain", clase)} />
    ) : (
      <div className={cn("grid shrink-0 place-items-center font-semibold", clase)}>{iniciales}</div>
    )

  return (
    /* Alto fijo con el contenido desplazándose adentro, no la ventana entera.
       El menú se queda siempre a la vista —que es lo que uno espera de un
       ERP— y, sobre todo, deja que una pantalla pida el alto completo: sin
       esto el asistente no puede tener su caja de texto abajo, porque la
       página crece con cada respuesta y el input se va al fondo.

       En escritorio: riel oscuro de iconos a la izquierda y la página en un
       panel claro redondeado. En el teléfono: la página a lo ancho y el menú
       abajo, al alcance del pulgar.

       Los `print:` no son cosmética: sin ellos una factura de tres páginas se
       imprimiría recortada al alto de la pantalla. */
    <div className="flex h-svh flex-col overflow-hidden bg-paper text-ink md:flex-row md:bg-ink md:p-2.5 print:block print:h-auto print:overflow-visible print:bg-white print:p-0">
      {/* overflow-y-auto como último recurso: si ni compacto cabe (zoom muy
          alto), el riel se desplaza en vez de esconder cerrar sesión. */}
      <aside className="hidden w-[84px] shrink-0 flex-col items-center gap-1 overflow-y-auto py-3 [scrollbar-width:none] md:flex bajo:gap-0.5 bajo:py-2 muybajo:gap-0 muybajo:py-1 print:hidden">
        <NavLink to="/resumen" title={nombre} className="mb-5 shrink-0 no-underline bajo:mb-2 muybajo:mb-1">
          {logo("size-11 rounded-2xl bg-paper text-[15px] text-ink muybajo:size-9 muybajo:text-[13px]")}
        </NavLink>

        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              cn(
                "group relative flex w-[72px] shrink-0 flex-col items-center gap-1 rounded-xl py-2 text-[11px] no-underline transition-colors hover:no-underline bajo:py-1 muybajo:py-0.5",
                isActive ? "text-paper" : "text-paper/55 hover:text-paper"
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Marca de la sección activa, pegada al borde del riel. */}
                {isActive && (
                  <span className="absolute top-1/2 -left-1.5 h-6 w-[3px] -translate-y-1/2 rounded-full bg-paper" />
                )}
                <span
                  className={cn(
                    "grid size-10 place-items-center rounded-xl transition-colors muybajo:size-9",
                    isActive ? "bg-paper/12" : "group-hover:bg-paper/6"
                  )}
                >
                  <Icon className="size-[19px]" />
                </span>
                <span className="bajo:hidden">{label}</span>
              </>
            )}
          </NavLink>
        ))}

        <div className="mt-auto flex shrink-0 flex-col items-center gap-1 pt-2 muybajo:gap-0 muybajo:pt-1">
          <NavLink
            to="/empresa"
            title="Datos de la empresa"
            className={({ isActive }) =>
              cn(
                "grid size-10 place-items-center rounded-xl transition-colors muybajo:size-9",
                isActive ? "bg-paper/12 text-paper" : "text-paper/55 hover:bg-paper/6 hover:text-paper"
              )
            }
          >
            <Settings className="size-[19px]" />
          </NavLink>
          <button
            onClick={salir}
            title="Cerrar sesión"
            className="grid size-10 place-items-center rounded-xl text-paper/55 transition-colors hover:bg-paper/6 hover:text-paper muybajo:size-9"
          >
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 bg-paper px-4 pt-3 md:rounded-[26px] md:px-8 md:pt-6 print:block print:rounded-none print:p-0">
        <header className="mx-auto flex w-full max-w-[1400px] items-center gap-3 print:hidden">
          {/* En el teléfono no hay riel: el logo y el nombre van aquí. */}
          <div className="md:hidden">{logo("size-9 rounded-xl bg-ink text-[14px] text-paper")}</div>
          <div className="min-w-0 truncate text-[17px] font-semibold tracking-[-0.02em] md:text-[22px]">
            {nombre}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
            {/* En escritorio empresa y salir viven en el riel; aquí solo el
                correo, para saber con qué cuenta se está. */}
            <span className="hidden max-w-[28ch] truncate rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[13px] text-neutral-700 shadow-xs md:inline">
              {usuario?.email}
            </span>
            <NavLink
              to="/empresa"
              className="grid size-9 place-items-center rounded-lg text-neutral-600 hover:bg-newsprint hover:text-ink md:hidden"
              title="Datos de la empresa"
            >
              <Settings className="size-[18px]" />
            </NavLink>
            <button
              onClick={salir}
              title="Cerrar sesión"
              className="grid size-9 place-items-center rounded-lg text-neutral-600 hover:bg-newsprint hover:text-ink md:hidden"
            >
              <LogOut className="size-[17px]" />
            </button>
          </div>
        </header>

        {/* La región que se desplaza. `min-h-0` es obligatorio: sin él un hijo
            flex se niega a encogerse por debajo de su contenido y el scroll se
            va a la ventana, que es justo lo que estamos evitando. */}
        <div
          data-scroll
          className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-6 md:-mx-8 md:px-8 md:pb-8 print:m-0 print:h-auto print:overflow-visible print:p-0"
        >
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet context={{ empresa, recargarEmpresa: setEmpresa }} />
          </div>
        </div>
      </div>

      {/* En el teléfono el menú va abajo. Queda FUERA de la región que
          desplaza, así que siempre está a la vista. */}
      <nav className="flex shrink-0 border-t border-neutral-200 bg-white/90 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden print:hidden">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 pt-2 pb-1.5 text-[11px] no-underline hover:no-underline",
                isActive ? "font-semibold text-ink" : "text-neutral-600"
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-full transition-colors",
                    isActive && "bg-ink text-paper"
                  )}
                >
                  <Icon className="size-[18px]" />
                </span>
                <span className="max-w-full truncate">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
