import { CircleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { BotonGoogle } from "@/components/boton-google"

/**
 * La única puerta de entrada: Google. Entrar y crear cuenta son lo mismo
 * —Supabase crea la cuenta la primera vez—, así que es una sola pantalla y
 * lo dice, para que nadie ande buscando un «regístrate».
 */
export function LoginForm({ className, onGoogle, error = "", ...props }) {
  return (
    <div className={cn("flex w-full max-w-[430px] flex-col gap-5", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-[25px]">Entrar</CardTitle>
          <FieldDescription>
            Con tu cuenta de Google. Si es la primera vez, tu cuenta se crea al momento.
          </FieldDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <BotonGoogle onClick={onGoogle} />
            {error && (
              <div className="flex items-center gap-2.5 rounded-md border border-neutral-300 bg-paper px-3 py-2.5 text-[13px]">
                <CircleAlert className="size-[19px] shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}
