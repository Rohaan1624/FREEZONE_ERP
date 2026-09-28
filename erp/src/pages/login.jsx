import * as React from "react"
import { Navigate } from "react-router-dom"

import { LoginForm } from "@/components/login-form"
import { errorDeRetorno } from "@/components/boton-google"
import { useAuth } from "@/lib/auth"

/**
 * Entrar y crear cuenta, en una sola pantalla. También es a donde Google
 * regresa: con sesión manda al panel, y si Google devolvió un error lo enseña.
 */
export default function Login() {
  const { session, cargando, entrarConGoogle } = useAuth()
  // Se lee una sola vez, al montar: errorDeRetorno limpia la URL.
  const [error] = React.useState(errorDeRetorno)

  if (cargando) return null
  if (session) return <Navigate to="/resumen" replace />

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm error={error} onGoogle={entrarConGoogle} />
      </div>
    </div>
  )
}
