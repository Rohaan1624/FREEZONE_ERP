import { Navigate } from "react-router-dom"

import { RegistroForm } from "@/components/registro-form"
import { useAuth, RUTA_NUEVA_CLAVE } from "@/lib/auth"

export default function Registro() {
  const { session, cargando, recuperando, registrar } = useAuth()

  if (cargando) return null
  // Mismo orden que en login: un enlace de recuperación SÍ deja sesión viva,
  // así que hay que mirarlo antes que `session` o alguien que viene a cambiar
  // su contraseña acabaría en el panel con la vieja todavía funcionando.
  if (recuperando) return <Navigate to={RUTA_NUEVA_CLAVE} replace />
  if (session) return <Navigate to="/resumen" replace />

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <RegistroForm
          onRegistrar={({ empresa, correo, clave }) => registrar(correo, clave, empresa)}
        />
      </div>
    </div>
  )
}
