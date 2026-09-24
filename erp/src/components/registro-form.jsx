import * as React from "react"
import { Link } from "react-router-dom"
import { UserPlus, CircleAlert, MailCheck, ArrowLeft } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * Alta de una empresa nueva.
 *
 * Se piden TRES cosas y no dos: el nombre de la empresa no es decoración, es
 * lo que crea la cuenta como inquilino —su propia numeración de facturas, su
 * propio catálogo— a través del trigger handle_new_user. Pedirlo después
 * dejaría a todo el mundo llamándose «My Company» hasta que alguien encontrara
 * la pantalla de Empresa.
 */

// Por encima del mínimo de Supabase (6). Esto guarda cartera y costos de
// compra: seis caracteres es poco para lo que hay detrás. El servidor manda de
// todas formas, así que esto solo puede ser más estricto, nunca más laxo.
const MINIMO_CLAVE = 8

export function RegistroForm({ className, onRegistrar, ...props }) {
  const [empresa, setEmpresa] = React.useState("")
  const [correo, setCorreo] = React.useState("")
  const [clave, setClave] = React.useState("")
  const [repetir, setRepetir] = React.useState("")
  const [error, setError] = React.useState("")
  const [enviando, setEnviando] = React.useState(false)
  const [listo, setListo] = React.useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError("")

    if (!empresa.trim()) return setError("Escribe el nombre de tu empresa.")
    if (!correo.trim()) return setError("Escribe tu correo.")
    if (clave.length < MINIMO_CLAVE)
      return setError(`La contraseña debe tener al menos ${MINIMO_CLAVE} caracteres.`)
    // Se confirma porque con el correo por confirmar NO se puede entrar a
    // probarla: un dedazo aquí se descubre al día siguiente, cuando el enlace
    // ya caducó y no se sabe si el fallo fue el correo o la contraseña.
    if (clave !== repetir) return setError("Las dos contraseñas no coinciden.")

    setEnviando(true)
    try {
      await onRegistrar?.({ empresa, correo, clave })
      setListo(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  // Redactado para NO revelar si el correo ya tenía cuenta. Supabase responde
  // igual en los dos casos justamente para que esta pantalla no sirva de
  // directorio de quién está registrado, y el mensaje acompaña esa decisión.
  if (listo) {
    return (
      <div className={cn("flex w-full max-w-[430px] flex-col gap-5", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle className="text-[25px]">Revisa tu correo</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start gap-2.5 rounded-md border border-neutral-300 bg-paper px-3 py-3 text-[13px]">
              <MailCheck className="mt-px size-[19px] shrink-0" />
              <span>
                Enviamos un enlace a <strong>{correo.trim()}</strong>. Ábrelo para confirmar la
                cuenta y entrar. Si ese correo ya tenía una cuenta, el mensaje te lo dirá.
              </span>
            </div>
            <FieldDescription>
              ¿No llega? Mira en la carpeta de no deseados. El enlace caduca en 24 horas.
            </FieldDescription>
            <Button asChild variant="secondary">
              <Link className="flex" to="/login">
                <ArrowLeft />
                Ir a iniciar sesión
              </Link>
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
          <CardTitle className="text-[25px]">Crear una cuenta</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <FieldDescription>
                Tu empresa arranca vacía y solo tú ves sus datos. Podrás importar tu catálogo y tus
                clientes desde un archivo.
              </FieldDescription>

              <Field variant="tile">
                <FieldLabel htmlFor="empresa">Nombre de la empresa</FieldLabel>
                <Input
                  id="empresa"
                  name="empresa"
                  type="text"
                  autoComplete="organization"
                  placeholder="Mi Empresa, S.A."
                  value={empresa}
                  onChange={(e) => setEmpresa(e.target.value)}
                  autoFocus
                  required
                />
                <FieldDescription>Sale en tus facturas. Lo puedes cambiar después.</FieldDescription>
              </Field>

              <Field variant="tile">
                <FieldLabel htmlFor="correo">Correo</FieldLabel>
                <Input
                  id="correo"
                  name="correo"
                  type="email"
                  autoComplete="email"
                  placeholder="correo@miempresa.com"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  required
                />
              </Field>

              <Field variant="tile">
                <FieldLabel htmlFor="clave">Contraseña</FieldLabel>
                <Input
                  id="clave"
                  name="clave"
                  type="password"
                  autoComplete="new-password"
                  placeholder="········"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  required
                />
                <FieldDescription>Mínimo {MINIMO_CLAVE} caracteres.</FieldDescription>
              </Field>

              <Field variant="tile">
                <FieldLabel htmlFor="repetir">Repite la contraseña</FieldLabel>
                <Input
                  id="repetir"
                  name="repetir"
                  type="password"
                  autoComplete="new-password"
                  placeholder="········"
                  value={repetir}
                  onChange={(e) => setRepetir(e.target.value)}
                  required
                />
              </Field>

              {error && (
                <div className="flex items-center gap-2.5 rounded-md border border-neutral-300 bg-paper px-3 py-2.5 text-[13px]">
                  <CircleAlert className="size-[19px] shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={enviando}>
                <UserPlus />
                {enviando ? "Creando…" : "Crear cuenta"}
              </Button>

              <FieldDescription className="text-center">
                ¿Ya tienes cuenta?{" "}
                <Link to="/login" className="underline underline-offset-2">
                  Inicia sesión
                </Link>
              </FieldDescription>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
