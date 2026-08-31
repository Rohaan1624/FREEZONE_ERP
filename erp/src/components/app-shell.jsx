import * as React from "react"
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom"
import { ChartLine, Receipt, Users, Package, Truck, LogOut, Settings } from "lucide-react"

import { cn } from "@/lib/utils"
import { useAuth, RUTA_NUEVA_CLAVE } from "@/lib/auth"
import { supabase } from "@/lib/supabase"

const NAV = [
  { to: "/", label: "Resumen", icon: ChartLine, end: true },
  { to: "/facturas", label: "Facturas", icon: Receipt },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/productos", label: "Productos", icon: Package },
  { to: "/entradas", label: "Entradas", icon: Truck },
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

  return (
    <div className="min-h-svh bg-paper px-6 pt-4 pb-8 text-ink print:bg-white print:p-0">
      <div className="mx-auto flex max-w-[1460px] flex-col gap-4">
        <header className="flex items-center gap-4 print:hidden">
          <div className="flex items-center gap-3">
            {empresa?.logo_url ? (
              <img
                src={empresa.logo_url}
                alt=""
                className="size-10 rounded-2xl bg-newsprint object-contain"
              />
            ) : (
              <div className="grid size-10 place-items-center rounded-2xl bg-ink text-[17px] font-semibold text-paper">
                {iniciales}
              </div>
            )}
            <div className="text-[19px] leading-tight font-semibold tracking-[-0.02em]">
              {nombre}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <NavLink
              to="/empresa"
              className="grid size-8 place-items-center rounded-md text-neutral-600 hover:bg-newsprint hover:text-ink"
              title="Datos de la empresa"
            >
              <Settings className="size-[18px]" />
            </NavLink>
            <span className="max-w-[24ch] truncate text-[13px] text-neutral-600">
              {usuario?.email}
            </span>
            <button
              onClick={salir}
              title="Cerrar sesión"
              className="grid size-8 place-items-center rounded-md text-neutral-600 hover:bg-newsprint hover:text-ink"
            >
              <LogOut className="size-[17px]" />
            </button>
          </div>
        </header>

        {/* Riel con filete, no píldoras con iconos en círculos: ese gesto es el
            que hace que un ERP parezca una plantilla, se come una fila entera
            de alto y deja de escalar pasadas seis secciones. */}
        <nav className="flex flex-wrap gap-7 border-b border-neutral-300 print:hidden">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "-mb-px flex items-center gap-2 border-b-2 pb-2.5 text-sm transition-colors",
                  isActive
                    ? "border-ink font-semibold text-ink"
                    : "border-transparent text-neutral-600 hover:text-ink"
                )
              }
            >
              <Icon className="size-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>

        <Outlet context={{ empresa, recargarEmpresa: setEmpresa }} />
      </div>
    </div>
  )
}
