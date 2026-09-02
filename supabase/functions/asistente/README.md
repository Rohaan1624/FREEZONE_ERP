# Función `asistente`

Intermediario entre la app y Groq. **No corre ningún modelo**: guarda la llave,
comprueba la sesión y descuenta el cupo.

## Antes de desplegar

1. **Aplica la migración** `backend/migration-004-asistente.sql`, que crea
   `asistente_uso`, `asistente_consumir()` y `asistente_cupo()`. Sin eso la
   función devuelve «No se pudo verificar tu cupo».

2. **Consigue una llave de Groq** en <https://console.groq.com> y guárdala como
   secreto del proyecto — nunca en el repositorio ni en el `.env` del frontend:

   ```
   supabase secrets set GROQ_API_KEY=gsk_...
   ```

3. **El modelo tiene que estar en tu plan.** No basta con que exista: los
   modelos de producción de Groq no están todos en el plan gratuito. Los de
   texto que sí lo están son `qwen/qwen3.8-27b`, `qwen/qwen3.6-27b`,
   `openai/gpt-oss-20b` y `openai/gpt-oss-120b`.

   El valor por defecto es `qwen/qwen3.8-27b`. Para cambiarlo:

   ```
   supabase secrets set GROQ_MODEL=<el-id>
   ```

   Los secretos se leen en cada invocación, así que cambiarlo **no** requiere
   volver a desplegar la función.

   **Los límites del plan gratuito son de toda la organización**, no por
   usuario: 30 peticiones/minuto, 1,000/día y 8,000 tokens/minuto. Como el
   prompt son ~600 tokens, el techo real son unas 12 preguntas por minuto — el
   de tokens aprieta antes que el de peticiones. Y las 1,000 diarias se reparten
   entre todos: con el límite de 150/día por persona que pone
   `migration-004-asistente.sql`, seis personas ya rozarían el tope.

4. **Acota el origen** (opcional pero recomendado). Sin esto acepta llamadas de
   cualquier dominio:

   ```
   supabase secrets set ORIGEN_PERMITIDO=https://tu-subdominio.vercel.app
   ```

5. Despliega:

   ```
   supabase functions deploy asistente
   ```

`SUPABASE_URL` y `SUPABASE_ANON_KEY` las inyecta Supabase sola; no hay que
configurarlas.

## Qué recibe y qué devuelve

```jsonc
// POST, con el JWT de Supabase en Authorization
{ "prompt": "<el catálogo, lo genera construyePrompt()>", "pregunta": "¿cuánto me debe John Doe?" }

// 200
{ "texto": "{\"intencion\":\"saldo_cliente\",\"parametros\":{\"cliente\":\"John Doe\"}}",
  "cupo": { "permitido": true, "restantes_hora": 28, "restantes_dia": 148 } }
```

El `texto` vuelve **sin validar**: lo valida el navegador con `valida()`, que ya
está probada. Duplicar esa lógica aquí crearía dos copias que se desincronizan.

## Si el navegador bloquea la llamada

`Request header field x-client-info is not allowed` significa que la función
desplegada es anterior al arreglo de CORS. `supabase-js` manda `x-client-info`
y `apikey` en toda petición; las cuatro cabeceras tienen que estar permitidas.
Vuelve a desplegar.

## Códigos de error

| código | qué pasó |
|---|---|
| 401 | sin sesión o sesión inválida |
| 413 | prompt o pregunta demasiado largos — el tope que impide usar esto como proxy gratuito de LLM |
| 429 | **tu** cupo (30/hora, 150/día) **o** el de Groq — el mensaje distingue cuál |
| 502 | Groq no respondió o devolvió algo ilegible |
| 504 | Groq tardó más de 15 s |
| 500 | falta `GROQ_API_KEY`, o falló el descuento de cupo |

## Por qué el cupo se descuenta antes de llamar a Groq

Si se descontara después, un fallo del proveedor dejaría el contador sin mover
y un bucle seguiría golpeando sin tope. Descontar antes cuesta que una consulta
perdida por un error de red gaste cupo — barato al lado de quemar la cuota
gratuita de toda la empresa en minutos.

## Prueba local

```
supabase functions serve asistente --env-file supabase/.env.local
```

```bash
curl -i localhost:54321/functions/v1/asistente \
  -H "Authorization: Bearer <un JWT real de un usuario>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"responde solo JSON","pregunta":"hola"}'
```
