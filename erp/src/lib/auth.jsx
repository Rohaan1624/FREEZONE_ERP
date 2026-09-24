import * as React from "react"
import { supabase } from "@/lib/supabase"
import { traducirError } from "@/lib/errores-auth"

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
       * Alta de una cuenta NUEVA, con su empresa.
       *
       * ───────────────────────────────────────────────────────────────────────
       * `company_name` NO es un nombre cualquiera
       * ───────────────────────────────────────────────────────────────────────
       * El trigger handle_new_user de functions.sql lee exactamente esa clave
       * de raw_user_meta_data para crear la fila de `company`, que es lo que
       * convierte a un usuario suelto en un inquilino con su propia
       * numeración de facturas. Si se escribe distinto, el alta funciona pero
       * la empresa nace llamándose «My Company» y nadie entiende por qué.
       *
       * ───────────────────────────────────────────────────────────────────────
       * DEVUELVE SI HAY QUE CONFIRMAR, Y NO DICE SI EL CORREO YA EXISTÍA
       * ───────────────────────────────────────────────────────────────────────
       * Con la confirmación por correo activada, Supabase no entrega sesión:
       * `session` viene en null y la persona tiene que abrir el enlace. Por eso
       * se devuelve un booleano en vez de asumir que ya entró.
       *
       * Y con un correo YA REGISTRADO, Supabase tampoco falla: responde un
       * usuario con `identities` vacío. Eso es a propósito —si fallara, esta
       * pantalla serviría para averiguar quién tiene cuenta— así que aquí se
       * trata igual que un alta buena, misma respuesta y mismo mensaje. Es la
       * misma regla que ya sigue pedirRecuperacion().
       */
      async registrar(email, clave, empresa) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: clave,
          options: {
            data: { company_name: empresa.trim() },
            // Al confirmar, el enlace devuelve a la app con la sesión en el
            // hash; supabase-js la recoge sola y AuthProvider la ve.
            emailRedirectTo: window.location.origin,
          },
        })
        if (error) throw new Error(traducirError(error.message))
        return { debeConfirmar: !data.session }
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
