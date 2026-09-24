# Pruebas de las funciones de Postgres

```bash
cd backend
npm install     # solo la primera vez
npm test
```

`pretest` levanta un Postgres 16 en Docker, le aplica el esquema completo
—`schema.sql`, `policy.sql`, las seis migraciones y `functions.sql`— y siembra
dos cuentas. Si el contenedor ya está con el esquema puesto, no lo vuelve a
aplicar: correr las pruebas dos veces seguidas es inmediato.

| | |
|---|---|
| `npm test` | correr todo |
| `npm run db:recrear` | tirar la base y rehacerla desde cero (tras tocar un `.sql`) |
| `npm run db:parar` | apagar el contenedor |

**Después de editar cualquier `.sql` hay que correr `npm run db:recrear`**, o las
pruebas seguirán corriendo contra la versión anterior y pasarán sin significar
nada.

## Por qué contra un Postgres de verdad

Lo que se prueba aquí *es* Postgres: `for update`, jsonb, RLS, `security
definer`, `search_path`, restricciones. Un doble no tiene ninguna de esas cosas,
así que probar contra él solo confirmaría que el doble se comporta como el
doble.

Los fallos reales de este proyecto lo confirman: una clave de `p_doc` que el RPC
descartaba en silencio, un `coalesce` que impedía borrar un campo, una columna
revocada que hacía fallar un guardado. Ninguno es un error de lógica; todos son
la costura con la base.

## Cómo está montado

**Una prueba, una transacción que siempre se deshace.** Estas pruebas mueven
existencias y saldos. Si una revienta a la mitad y deja una factura activa, la
siguiente arranca con el inventario movido y falla por un motivo que no es el
suyo. Con el `rollback` no hay estado que arrastrar, ni orden de ejecución que
importe, ni limpieza que se pueda olvidar de una tabla nueva.

**`auth.uid()` lee un GUC**, no devuelve un uuid fijo. Eso es lo que permite
cambiar de usuario a media transacción y pedirle a Beto que intente tocar lo de
Ana — que es la única forma de probar la seguridad, porque dentro de una función
`security definer` **RLS no se aplica** y lo único que separa a un inquilino de
otro son los filtros `user_id = v_uid` escritos a mano.

**Se replican los permisos que Supabase da por defecto.** `policy.sql` los da por
hechos: sus `revoke` por columna solo significan algo si antes existe el permiso
amplio. Sin eso, las pruebas de RLS darían «permission denied» para todo y
pasarían por el motivo equivocado.

**Las existencias se siembran con `create_adjustment`**, no con un `update` a la
columna. `stock` está revocada y solo se mueve por documento; sembrarla a mano
dejaría las pruebas montadas sobre un camino que la aplicación no puede usar.

## Qué se cubre

| Archivo | Qué fija |
|---|---|
| `existencias` | La tabla de transiciones de la huella que `functions.sql` declara en su cabecera: borrador no reserva, activa descuenta, editar aplica la diferencia, borrar devuelve. Compras, ajustes, y que una cerrada esté congelada. |
| `dinero` | `invoice.total` y `client.balance` como derivaciones: que ningún camino de escritura se olvide de recalcularlas. Incluye el sobrepago, donde el saldo del cliente queda negativo pero el de la factura se recorta a cero. |
| `aislamiento` | Que una cuenta no pueda tocar la otra, por las funciones y por RLS directa. Incluye que las columnas derivadas (`stock`, `balance`) estén revocadas y que las normales sí se puedan editar. |
| `documento` | Folio, fechas, los `bill_to_*` y la dirección congelada: que vaciar cualquier campo del documento lo borre de verdad, y que mudar a un cliente no reescriba sus facturas viejas. |
| `vistas` | El estado de `invoice_listado` y su orden de casos (vencida y pagada es **Pagada**), los `totales_*` y el tablero. |
| `asistente` | El cupo: que consultarlo no lo gaste, que los rechazos no sigan sumando, que sea por persona y que el contador no se pueda tocar a mano. |

## Tienen dientes

Se comprobó rompiendo el SQL a propósito y confirmando que las pruebas lo
atrapan:

| Mutación | Resultado |
|---|---|
| La huella deja de excluir borradores | 3 fallos |
| `update_invoice` pierde su filtro `user_id` | 1 fallo |
| `Vencida` se evalúa antes que `Pagada` | 1 fallo |
| El margen deja de excluir los SKU sin costo | 1 fallo |
| El saldo del cliente cuenta los borradores | 2 fallos |
| Vuelve el `coalesce` de los campos de embarque | 1 fallo |
| `create_invoice` deja de congelar la dirección | 3 fallos |
| Cambiar de cliente no recongela la dirección | 1 fallo |

Si se añade una función nueva, vale la pena repetir el ejercicio: una prueba que
no falla cuando rompes lo que dice cubrir no está cubriendo nada.
