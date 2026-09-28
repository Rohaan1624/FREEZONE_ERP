import { Navigate } from "react-router-dom"

/**
 * Crear cuenta ya es entrar con Google por primera vez, y eso vive en /login.
 * La ruta se queda para que no se rompan los enlaces viejos que ya circulan.
 */
export default function Registro() {
  return <Navigate to="/login" replace />
}
