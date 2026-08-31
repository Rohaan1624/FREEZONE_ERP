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
    // Control segmentado con esquinas del sistema: la navegación principal ya
    // es subrayada, así que una sub-navegación subrayada debajo confundiría los
    // dos niveles. Un control con marco se lee como otra cosa.
    <nav className="inline-flex self-start overflow-hidden rounded-md border border-neutral-300">
      {TABS.map(({ to, label, icon: Icon, end }, i) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 px-4 py-1.5 text-[13px] transition-colors",
              i > 0 && "border-l border-neutral-300",
              isActive
                ? "bg-ink font-semibold text-paper"
                : "bg-white text-neutral-600 hover:bg-neutral-100 hover:text-ink"
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
