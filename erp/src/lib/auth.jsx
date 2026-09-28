import * as React from "react"
import { supabase } from "@/lib/supabase"
import { traducirError } from "@/lib/errores-auth"

const AuthContext = React.createContext(null)

/**
 * Sesión con Google, y nada más: sin contraseñas, sin correos de confirmación
 * ni de recuperación. Supabase crea la cuenta la primera vez que alguien entra.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = React.useState(null)
  const [cargando, setCargando] = React.useState(true)

  React.useEffect(() => {
    // getSession() lee el token ya guardado, así que recargar no manda de
    // vuelta al login. Al volver de Google, además, termina de canjear el
    // código de la URL antes de responder.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCargando(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, sesion) => {
      setSession(sesion)
      setCargando(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = React.useMemo(
    () => ({
      session,
      cargando,
      usuario: session?.user ?? null,

      /**
       * Entrar con Google. Sirve igual para una cuenta nueva que para una que
       * ya existe: Supabase la crea la primera vez.
       *
       * Una cuenta nueva nace sin nombre de empresa (Google no lo sabe): el
       * trigger handle_new_user le pone el genérico y AppShell lo pide la
       * primera vez.
       *
       * Regresa a /login y no al panel: con sesión, /login manda solo al
       * panel; y si Google devolvió un error (por ejemplo, se canceló), es la
       * pantalla que lo sabe mostrar. `prompt: select_account` deja elegir la
       * cuenta en vez de entrar con la última usada, que en una computadora
       * compartida sería la de otra persona.
       */
      async entrarConGoogle() {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/login`,
            queryParams: { prompt: "select_account" },
          },
        })
        if (error) throw new Error(traducirError(error.message))
      },

      async salir() {
        await supabase.auth.signOut()
      },
    }),
    [session, cargando]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>")
  return ctx
}
