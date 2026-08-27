# ERP_ZL

ERP de zona franca: facturación, inventario, compras y cuentas por cobrar.
Postgres + Supabase en el backend, React + Vite en el frontend.

El inventario y los saldos **no se editan a mano**. Se mueven a través de
funciones en la base de datos que bloquean filas, validan y calculan — de modo
que dos personas trabajando al mismo tiempo no pueden vender la misma
existencia dos veces ni dejar un saldo incorrecto.

---

## Cómo está construido

```
backend/     SQL que se aplica al proyecto de Supabase
  schema.sql                 9 tablas, constraints, índices, RLS activo
  policy.sql                 16 políticas + permisos por columna
  functions.sql              12 RPCs, 1 vista, 1 trigger  (re-ejecutable)
  migration-001-pricing.sql  precios, condiciones de pago, vencimiento
  migration-002-bultos.sql   bultos y unidad en los renglones

erp/         aplicación React (Vite, Tailwind 4, shadcn)
  src/lib/     supabase, auth, dinero (big.js), líneas, resumen  + 64 tests
  src/pages/   13 pantallas
```

### El principio: dos niveles de permisos

| | Tablas | Cómo se escribe |
|---|---|---|
| **Nivel 1** | `company`, `client`, `product` | Directo, con RLS |
| **Nivel 2** | `invoice`, `transaction`, `purchase`, `entry`, `payments`, `adjustment` | **Solo por RPC** |

Las tablas de nivel 2 tienen política de `SELECT` y **ninguna** política de
escritura. Esa ausencia es el candado: PostgREST rechaza cualquier `insert` o
`update` directo, y solo las funciones `security definer` — que corren como
dueñas de la tabla — pueden escribirlas.

Así, crear una factura *siempre* pasa por `create_invoice()`, que verifica
existencia, bloquea las filas de producto y descuenta en una sola transacción.
No hay un camino alterno que se salte esa lógica.

### Columnas derivadas

`invoice.total`, `purchase.total`, `client.balance` y `product.stock` se
calculan en el servidor y **no son escribibles** por la aplicación — el permiso
está revocado a nivel de columna. Mandarlas en un `update` falla con
`permission denied`. La única forma de moverlas es a través de la operación real
que las justifica.

### El modelo de existencia

Una factura tiene una **huella**: sus cantidades de producto cuando está
`active` o `closed`, y **nada** cuando es `draft`.

```
draft   -> {}          no reserva nada
active  -> {SKU: 12}   descontado de product.stock
closed  -> {SKU: 12}   sigue descontado, congelado
```

Cada operación es el mismo movimiento — llevar la huella de un valor a otro:

```
crear como activa       {} -> {A:3}       descuenta 3
editar 3 -> 5           {A:3} -> {A:5}    descuenta 2 más (verificado)
editar 5 -> 1           {A:5} -> {A:1}    devuelve 4
emitir (draft->active)  {} -> {A:3}       descuenta 3
eliminar una activa     {A:3} -> {}       devuelve 3
cerrar una entrada      {} -> {A:-100}    suma 100
```

`apply_stock_delta()` es el **único** lugar donde `product.stock` cambia. Escribir
esa aritmética por separado en crear / editar / eliminar / cambiar estado es
cómo se terminan teniendo cuatro errores distintos.

### Concurrencia

Varias personas comparten la misma cuenta, así que los bloqueos son reales:

- **Filas de producto** (`for update`, en orden determinista) — dos facturas no
  pueden leer la misma existencia y venderla ambas.
- **Fila de factura**, antes de leer su huella — sin esto, dos ediciones
  simultáneas aplican su delta contra la misma huella vieja y la existencia
  queda mal.
- **Fila de cliente**, antes de sumar su saldo.
- **Fila de empresa**, para asignar el folio — `update … returning` es atómico,
  así que dos «Nueva factura» al mismo instante nunca reciben el mismo número.

### Dinero

`numeric(12,2)` en Postgres y [big.js](https://mikemcl.github.io/big.js/) en el
navegador. Nada de flotantes.

```
                big.js      float
0.1 + 0.2       0.3         0.30000000000000004
7 × 1.15        8.05        8.049999999999999
100×(7×1.15)    805.00      804.9999999999989
```

Ningún total que JavaScript calcula se guarda: la aplicación manda solo lo que
el usuario escribió (`qty`, `unit_price`) y el servidor recalcula el resto.

---

## Puesta en marcha

### 1. Base de datos

En el SQL Editor de Supabase, **en este orden**:

```
1. backend/schema.sql       una sola vez
2. backend/policy.sql       una sola vez
3. backend/functions.sql    re-ejecutable, aplícalo tras cualquier cambio
```

`schema.sql` y `policy.sql` no son re-ejecutables (usan `create table` /
`create policy`). `functions.sql` sí lo es: trae sus propios `drop … if exists`.

Si ya tenías una versión anterior aplicada, corre además
`migration-001-pricing.sql` y `migration-002-bultos.sql`, **y vuelve a aplicar
`functions.sql`** — las migraciones solo agregan columnas; son las funciones las
que aprenden a usarlas.

### 2. Autenticación

Los registros están cerrados: las cuentas las crea administración desde el
panel de Supabase.

- **Auth → Providers → Email**: activa *Disable signup*
- **Auth → URL Configuration**: agrega `http://localhost:3000/nueva-clave` y el
  equivalente en producción, o el enlace de recuperación no funcionará
- Al crear un usuario, puedes ponerle metadata `{"company_name": "Tu Empresa"}`;
  el trigger `on_auth_user_created` la usa para crear su fila en `company`. Si
  no, queda como «My Company» y se edita después en *Datos de la empresa*.

### 3. Aplicación

```bash
cd erp
cp .env.example .env      # y llénalo con los datos de tu proyecto
npm install
npm run dev               # http://localhost:3000
```

### Verificaciones útiles

```bash
npm test          # 64 tests: dinero, líneas, márgenes, agregados
npm run lint
npm run build
```

```sql
-- la vista debe conservar esta opción, o expone datos de todas las cuentas
select relname, reloptions from pg_class where relname = 'stock_movement';
-- esperado: {security_invoker=true}
```

---

## Pantallas

| Ruta | |
|---|---|
| `/` | Resumen: ingresos vs. año anterior, cobrado, margen, inventario, antigüedad de saldos, SKU más vendidos |
| `/facturas` · `/nueva` · `/:id` · `/:id/editar` | Listado, alta, detalle con pagos y cambios de estado, edición |
| `/clientes` · `/:id` | Alta y edición; estado de cuenta con cargos, abonos y saldo corrido |
| `/productos` | Catálogo con costo, precio, margen y markup |
| `/entradas` · `/nueva` · `/:id` | Compras: captura libre mientras están pendientes, la existencia sube al cerrar |
| `/entradas/ajustes` | Ajustes de inventario: solo alta, nunca edición ni borrado |
| `/empresa` | Datos de la empresa y serie de folios |
| `/login` · `/nueva-clave` | Acceso y recuperación de contraseña |

---

## Decisiones que conviene conocer

**Una factura cerrada es inmutable.** No se edita, no se elimina, no cambia de
estado. `reopen_invoice()` existe como salida explícita y deliberada; el camino
normal la mantiene congelada.

**Una entrada cerrada no se reabre.** Ya movió existencia que las facturas
pueden haber consumido. Corrígela mientras esté pendiente.

**Los ajustes son solo de alta.** Para corregir uno se crea el contrario, y así
queda el rastro completo de cómo llegó la existencia a su número actual.

**Una compra no se elimina nunca**, y un cliente o producto con historial
tampoco (`on delete restrict`).

**El costo faltante no es costo cero.** Un SKU sin costo capturado no reporta
100 % de margen ni se valúa en cero: se excluye del cálculo y se informa
aparte («3 sin costo»).

---

## Pendientes conocidos

- `product.stock` y `transaction.qty` son enteros — no se puede facturar 2.5 kg
- No hay bucket de Storage: `company.logo_url` acepta una URL, no una subida
- Sin detalle de producto todavía, aunque la vista `stock_movement` ya responde
  «¿por qué este SKU está en 8?»
- Una cuenta compartida entre varias personas no distingue quién hizo qué; el
  camino barato sería una tabla `company_members` y logins por persona
- `purchase.entry_no` es único por cuenta, pero `entry` no tiene columnas de
  bultos ni unidad (eso vive solo del lado de facturación)
