import { NavLink } from "react-router-dom"
import { Truck, SlidersHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Both ways stock enters or leaves outside of a sale.
 *   Entradas — goods arriving, with a document behind them
 *   Ajustes  — the documented exception: shrinkage, counts, samples
 */
const TABS = [
  { to: "/entradas", label: "Entradas", icon: Truck, end: true },
  { to: "/entradas/ajustes", label: "Ajustes", icon: SlidersHorizontal },
]

export function SubNavInventario() {
  return (
    <nav className="inline-flex self-start gap-1 rounded-full bg-newsprint p-1">
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] transition-colors",
              isActive ? "bg-ink text-paper" : "text-ink hover:bg-paper"
            )
          }
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
