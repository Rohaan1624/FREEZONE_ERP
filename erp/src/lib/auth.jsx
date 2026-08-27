import * as React from "react"
import { supabase } from "@/lib/supabase"

const AuthContext = React.createContext(null)

/** Where Supabase sends people after they click the reset link in their email. */
export const RUTA_NUEVA_CLAVE = "/nueva-clave"

export function AuthProvider({ children }) {
  const [session, setSession] = React.useState(null)
  const [cargando, setCargando] = React.useState(true)
  const [recuperando, setRecuperando] = React.useState(false)

  React.useEffect(() => {
    // getSession() reads the token already in localStorage, so a refresh does
    // not bounce the user back to the login screen.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCargando(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((evento, sesion) => {
      // A recovery link is a REAL sign-in: Supabase hands back a live session.
      // Without this flag the app would treat it as a normal login and drop the
      // user on the dashboard with their old password still in force. The flag
      // pins them to the change-password screen until they actually change it.
      if (evento === "PASSWORD_RECOVERY") setRecuperando(true)
      if (evento === "SIGNED_OUT") setRecuperando(false)
      setSession(sesion)
      setCargando(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = React.useMemo(
    () => ({
      session,
      cargando,
      recuperando,
      usuario: session?.user ?? null,

      async entrar(email, clave) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: clave,
        })
        if (error) throw new Error(traducirError(error.message))
      },

      /**
       * Sends the reset email. Deliberately does NOT reveal whether the address
       * exists — Supabase returns success either way, and so do we, so this
       * cannot be used to enumerate who has an account.
       */
      async pedirRecuperacion(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}${RUTA_NUEVA_CLAVE}`,
        })
        if (error) throw new Error(traducirError(error.message))
      },

      async cambiarClave(nueva) {
        const { error } = await supabase.auth.updateUser({ password: nueva })
        if (error) throw new Error(traducirError(error.message))
        setRecuperando(false)
      },

      async salir() {
        setRecuperando(false)
        await supabase.auth.signOut()
      },
    }),
    [session, cargando, recuperando]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>")
  return ctx
}

function traducirError(mensaje) {
  if (/Invalid login credentials/i.test(mensaje)) return "Correo o contraseña incorrectos."
  if (/Email not confirmed/i.test(mensaje)) return "Confirma tu correo antes de entrar."
  if (/Password should be/i.test(mensaje)) return "La contraseña debe tener al menos 6 caracteres."
  if (/New password should be different/i.test(mensaje))
    return "La contraseña nueva debe ser distinta de la anterior."
  if (/Auth session missing|session_not_found/i.test(mensaje))
    return "El enlace expiró. Pide uno nuevo desde “¿Olvidaste tu contraseña?”."
  if (/For security purposes|rate limit|too many/i.test(mensaje))
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a intentar."
  if (/Signups not allowed/i.test(mensaje))
    return "Los registros están cerrados. Pide a administración que cree tu cuenta."
  return mensaje
}
