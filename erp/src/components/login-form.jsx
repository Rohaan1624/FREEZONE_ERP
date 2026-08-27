import * as React from "react"
import { LogIn, CircleAlert, MailCheck, ArrowLeft, Send } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({ className, onEntrar, onRecuperar, ...props }) {
  const [modo, setModo] = React.useState("entrar")
  const [correo, setCorreo] = React.useState("")
  const [clave, setClave] = React.useState("")
  const [error, setError] = React.useState("")
  const [enviado, setEnviado] = React.useState(false)
  const [enviando, setEnviando] = React.useState(false)

  const recuperando = modo === "recuperar"

  function cambiarModo(nuevo) {
    setModo(nuevo)
    setError("")
    setEnviado(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError("")

    if (!correo.trim()) return setError("Escribe tu correo para continuar.")
    if (!recuperando && !clave) return setError("Escribe tu contraseña.")

    setEnviando(true)
    try {
      if (recuperando) {
        await onRecuperar?.(correo)
        setEnviado(true)
      } else {
        await onEntrar?.({ correo, clave })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  // Confirmation is intentionally worded so it does not reveal whether the
  // address has an account — otherwise this page becomes a way to find out
  // who works here.
  if (recuperando && enviado) {
    return (
      <div className={cn("flex w-full max-w-[430px] flex-col gap-5", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle className="text-[25px]">Revisa tu correo</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start gap-2.5 rounded-[14px] bg-paper px-3 py-3 text-[13px]">
              <MailCheck className="mt-px size-[19px] shrink-0" />
              <span>
                Si <strong>{correo.trim()}</strong> tiene una cuenta, le enviamos un enlace para
                cambiar la contraseña. El enlace caduca en una hora.
              </span>
            </div>
            <Button type="button" variant="secondary" onClick={() => cambiarModo("entrar")}>
              <ArrowLeft />
              Volver a iniciar sesión
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={cn("flex w-full max-w-[430px] flex-col gap-5", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-[25px]">
            {recuperando ? "Recuperar contraseña" : "Iniciar sesión"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              {recuperando && (
                <FieldDescription>
                  Escribe tu correo y te enviaremos un enlace para elegir una contraseña nueva.
                </FieldDescription>
              )}

              <Field variant="tile">
                <FieldLabel htmlFor="correo">Correo</FieldLabel>
                <Input
                  id="correo"
                  name="correo"
                  type="email"
                  autoComplete="email"
                  placeholder="ventas@empresa.com"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  autoFocus
                  required
                />
              </Field>

              {!recuperando && (
                <Field variant="tile">
                  <FieldLabel htmlFor="clave">Contraseña</FieldLabel>
                  <Input
                    id="clave"
                    name="clave"
                    type="password"
                    autoComplete="current-password"
                    placeholder="········"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    required
                  />
                </Field>
              )}

              {error && (
                <div className="flex items-center gap-2.5 rounded-[14px] bg-paper px-3 py-2.5 text-[13px]">
                  <CircleAlert className="size-[19px] shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={enviando}>
                {recuperando ? <Send /> : <LogIn />}
                {enviando ? "Un momento…" : recuperando ? "Enviar enlace" : "Entrar"}
              </Button>

              <FieldDescription className="text-center">
                {recuperando ? (
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => cambiarModo("entrar")}
                  >
                    Volver a iniciar sesión
                  </button>
                ) : (
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => cambiarModo("recuperar")}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                )}
              </FieldDescription>

              {!recuperando && (
                <FieldDescription className="text-center">
                  Las cuentas las crea administración.
                </FieldDescription>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
