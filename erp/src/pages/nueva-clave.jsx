import * as React from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { CircleAlert, KeyRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth"

const MINIMO = 6

export default function NuevaClave() {
  const { session, cargando, recuperando, cambiarClave, salir } = useAuth()
  const navigate = useNavigate()
  const [clave, setClave] = React.useState("")
  const [repetir, setRepetir] = React.useState("")
  const [error, setError] = React.useState("")
  const [guardando, setGuardando] = React.useState(false)

  if (cargando) return null

  // Reached without a recovery link and without being signed in: the token
  // expired, or someone typed the URL directly.
  if (!session) return <Navigate to="/login" replace />

  async function handleSubmit(event) {
    event.preventDefault()
    setError("")
    if (clave.length < MINIMO) return setError(`La contraseña debe tener al menos ${MINIMO} caracteres.`)
    if (clave !== repetir) return setError("Las dos contraseñas no coinciden.")

    setGuardando(true)
    try {
      await cambiarClave(clave)
      navigate("/", { replace: true })
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex w-full max-w-[430px] flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-[25px]">Elige una contraseña</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  <FieldDescription>
                    {recuperando
                      ? "Tu enlace es válido. Escribe la contraseña que usarás de ahora en adelante."
                      : "Escribe la contraseña que usarás de ahora en adelante."}
                  </FieldDescription>

                  <Field variant="tile">
                    <FieldLabel htmlFor="clave">Contraseña nueva</FieldLabel>
                    <Input
                      id="clave"
                      type="password"
                      autoComplete="new-password"
                      placeholder="········"
                      value={clave}
                      onChange={(e) => setClave(e.target.value)}
                      autoFocus
                      required
                    />
                  </Field>

                  <Field variant="tile">
                    <FieldLabel htmlFor="repetir">Repite la contraseña</FieldLabel>
                    <Input
                      id="repetir"
                      type="password"
                      autoComplete="new-password"
                      placeholder="········"
                      value={repetir}
                      onChange={(e) => setRepetir(e.target.value)}
                      required
                    />
                  </Field>

                  {error && (
                    <div className="flex items-center gap-2.5 rounded-[14px] bg-paper px-3 py-2.5 text-[13px]">
                      <CircleAlert className="size-[19px] shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={guardando}>
                    <KeyRound />
                    {guardando ? "Guardando…" : "Guardar y entrar"}
                  </Button>

                  <FieldDescription className="text-center">
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={async () => {
                        await salir()
                        navigate("/login", { replace: true })
                      }}
                    >
                      Cancelar y cerrar sesión
                    </button>
                  </FieldDescription>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
