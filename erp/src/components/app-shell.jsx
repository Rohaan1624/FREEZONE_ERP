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
    <div className="min-h-svh bg-paper px-6 pt-4 pb-8 text-ink">
      <div className="mx-auto flex max-w-[1460px] flex-col gap-4">
        <header className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            {empresa?.logo_url ? (
              <img
                src={empresa.logo_url}
                alt=""
                className="size-11 rounded-[14px] bg-newsprint object-contain"
              />
            ) : (
              <div className="grid size-11 place-items-center rounded-[14px] bg-ink text-[18px] font-semibold text-paper">
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
              className="grid size-9 place-items-center rounded-full bg-newsprint"
              title="Datos de la empresa"
            >
              <Settings className="size-[19px]" />
            </NavLink>
            <div className="flex items-center gap-2.5 rounded-full bg-newsprint py-1.5 pr-1.5 pl-4 text-[13px]">
              <span className="max-w-[22ch] truncate">{usuario?.email}</span>
              <button
                onClick={salir}
                title="Cerrar sesión"
                className="grid size-[30px] place-items-center rounded-full bg-paper"
              >
                <LogOut className="size-[17px]" />
              </button>
            </div>
          </div>
        </header>

        <nav className="inline-flex self-start gap-1.5 rounded-full bg-newsprint p-1.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-full py-1.5 pr-5 pl-1.5 text-sm transition-colors",
                  isActive ? "bg-ink text-paper" : "text-ink hover:bg-paper"
                )
              }
            >
              <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-paper text-ink">
                <Icon className="size-5" />
              </span>
              {label}
            </NavLink>
          ))}
        </nav>

        <Outlet context={{ empresa, recargarEmpresa: setEmpresa }} />
      </div>
    </div>
  )
}
