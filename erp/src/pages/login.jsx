import { Navigate } from "react-router-dom"
import { LoginForm } from "@/components/login-form"
import { useAuth, RUTA_NUEVA_CLAVE } from "@/lib/auth"

export default function Login() {
  const { session, cargando, recuperando, entrar, pedirRecuperacion } = useAuth()

  if (cargando) return null
  // A recovery link signs the user in for real, so check this BEFORE session.
  if (recuperando) return <Navigate to={RUTA_NUEVA_CLAVE} replace />
  if (session) return <Navigate to="/" replace />

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm
          onEntrar={({ correo, clave }) => entrar(correo, clave)}
          onRecuperar={(correo) => pedirRecuperacion(correo)}
        />
      </div>
    </div>
  )
}
