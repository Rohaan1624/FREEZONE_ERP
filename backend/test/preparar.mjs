import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Levanta un Postgres de verdad y le aplica el esquema entero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN POSTGRES DE VERDAD Y NO UN SIMULACRO
 * ─────────────────────────────────────────────────────────────────────────────
 * Lo que se prueba aquí ES Postgres: `for update`, jsonb, RLS, security definer,
 * search_path, restricciones. Un doble no tiene ninguna de esas cosas, así que
 * probar contra él solo confirmaría que el doble se comporta como el doble.
 *
 * Los fallos reales de este proyecto lo confirman: una clave de `p_doc` que el
 * RPC descartaba en silencio, un `coalesce` que impedía borrar un campo, una
 * columna revocada. Ninguno es un error de lógica; todos son la costura con la
 * base.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CÓMO SE FINGE SUPABASE
 * ─────────────────────────────────────────────────────────────────────────────
 * El esquema depende de tres cosas que pone Supabase y no Postgres: el esquema
 * `auth` con su tabla `users`, la función `auth.uid()`, y los roles
 * `authenticated` y `anon`.
 *
 * `auth.uid()` se define leyendo un GUC en vez de devolver un uuid fijo, y eso
 * es lo que hace posible la mitad interesante de las pruebas: cambiar de
 * usuario dentro de una transacción para comprobar que una cuenta no puede
 * tocar los datos de otra. Toda la seguridad de las RPC son filtros
 * `user_id = v_uid` escritos a mano, así que probar que funcionan es probar la
 * seguridad.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const BACKEND = path.join(AQUI, "..")

export const CONTENEDOR = "pg_erp_pruebas"
export const PUERTO = 55433
export const URL_BASE = `postgres://postgres:pruebas@localhost:${PUERTO}/postgres`

// Los dos inquilinos de las pruebas. Fijos y legibles: cuando una prueba falla,
// «…0001 no puede tocar la factura de …0002» se entiende de un vistazo.
export const ANA = "a0000000-0000-0000-0000-000000000001"
export const BETO = "b0000000-0000-0000-0000-000000000002"

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" })

const psql = (sql) =>
  execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  })

const vive = () => {
  try {
    return docker("inspect", "-f", "{{.State.Running}}", CONTENEDOR).trim() === "true"
  } catch {
    return false
  }
}

/**
 * Lo que Supabase da hecho.
 *
 * `auth.uid()` es STABLE, no IMMUTABLE: cambia con el GUC dentro de la misma
 * transacción y Postgres no debe cachear su resultado entre llamadas.
 */
const CIMIENTOS = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
end $$;

create extension if not exists pgcrypto;
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('prueba.uid', true), '')::uuid
$$;

grant usage on schema auth to authenticated, anon;
grant select on auth.users to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- LOS PERMISOS QUE SUPABASE DA POR DEFECTO, Y QUE policy.sql DA POR HECHOS
-- ───────────────────────────────────────────────────────────────────────────
-- policy.sql lo dice en su propio comentario: «Supabase grants table-wide
-- UPDATE to authenticated by default, and a column-level revoke cannot punch a
-- hole in a table-level grant».
--
-- O sea que sus «revoke ... on client» solo significan algo si antes existe el
-- permiso amplio. Sin esto, las pruebas de RLS darían «permission denied» para
-- TODO y pasarían por el motivo equivocado: parecerían demostrar que las
-- columnas están protegidas cuando en realidad no habría ni permiso de leer.
--
-- Va con ALTER DEFAULT PRIVILEGES para que lo hereden también las tablas que
-- crean las migraciones, igual que pasa en el proyecto real.
grant usage on schema public to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated, anon;
alter default privileges in schema public grant all on sequences to authenticated, anon;
`

/**
 * Datos base, COMPARTIDOS y comprometidos.
 *
 * Cada prueba corre dentro de una transacción que se deshace al final, así que
 * esto se siembra una vez y nadie lo ensucia. Ana y Beto existen para poder
 * comprobar el aislamiento entre cuentas.
 *
 * Las existencias entran por un AJUSTE, no con un update a la columna: `stock`
 * está revocada y solo se mueve por documento. Sembrarla a mano dejaría la
 * prueba montada sobre un camino que la aplicación no puede usar.
 */
const SEMILLA = `
set local prueba.uid = '${ANA}';

insert into auth.users (id, email, raw_user_meta_data) values
  ('${ANA}',  'ana@prueba.test',  '{"company_name":"Ana Import, S.A."}'),
  ('${BETO}', 'beto@prueba.test', '{"company_name":"Beto Trading"}')
on conflict (id) do nothing;

-- Clientes
insert into public.client (id, name, payment_terms, address, country, user_id) values
  ('c1111111-1111-1111-1111-111111111111', 'Cliente Uno', 30, 'Calle 1, Local 1', 'Panamá', '${ANA}'),
  ('c2222222-2222-2222-2222-222222222222', 'Cliente Dos', 0,  'Calle 2, Local 2', 'Panamá', '${ANA}'),
  ('c3333333-3333-3333-3333-333333333333', 'Cliente de Beto', 15, null, null,        '${BETO}')
on conflict (id) do nothing;

-- Productos. qty_unit distinto en cada uno para que las conversiones de bultos
-- no puedan pasar por casualidad.
insert into public.product (id, sku, description, unit, qty_unit, cost_price, sale_price, user_id) values
  ('91111111-1111-1111-1111-111111111111', 'CAJA-12',  'Producto por docena', 'PZA', 12,  2.00, 5.00, '${ANA}'),
  ('92222222-2222-2222-2222-222222222222', 'SUELTO-1', 'Producto suelto',     'PZA', 1,   1.50, 4.00, '${ANA}'),
  ('93333333-3333-3333-3333-333333333333', 'SINCOSTO', 'Producto sin costo',  'PZA', 1,   null, 9.00, '${ANA}'),
  ('94444444-4444-4444-4444-444444444444', 'DE-BETO',  'Producto de Beto',    'PZA', 1,   1.00, 3.00, '${BETO}')
on conflict (id) do nothing;
`

/** Existencia inicial, por el mismo camino que usaría la aplicación. */
const EXISTENCIAS = `
set local prueba.uid = '${ANA}';
select public.create_adjustment('91111111-1111-1111-1111-111111111111', 'add', 1200, 'saldo inicial de prueba');
select public.create_adjustment('92222222-2222-2222-2222-222222222222', 'add', 500,  'saldo inicial de prueba');
select public.create_adjustment('93333333-3333-3333-3333-333333333333', 'add', 100,  'saldo inicial de prueba');
set local prueba.uid = '${BETO}';
select public.create_adjustment('94444444-4444-4444-4444-444444444444', 'add', 50, 'saldo inicial de prueba');
`

const ARCHIVOS = [
  "schema.sql",
  "policy.sql",
  "migration-001-pricing.sql",
  "migration-002-bultos.sql",
  "migration-003-datos-documento.sql",
  "migration-004-asistente.sql",
  "migration-005-datos-impresos.sql",
  "migration-006-direccion-congelada.sql",
  "functions.sql",
]

export async function preparaBase({ recrear = false } = {}) {
  if (recrear && vive()) {
    try {
      docker("rm", "-f", CONTENEDOR)
    } catch {
      /* ya no estaba */
    }
  }

  if (!vive()) {
    try {
      docker("rm", "-f", CONTENEDOR)
    } catch {
      /* no existía */
    }
    docker(
      "run", "-d", "--name", CONTENEDOR,
      "-e", "POSTGRES_PASSWORD=pruebas",
      "-p", `${PUERTO}:5432`,
      "postgres:16"
    )
    // pg_isready antes de hablarle, o el primer psql sale con «connection refused»
    for (let i = 0; i < 60; i++) {
      try {
        docker("exec", CONTENEDOR, "pg_isready", "-U", "postgres")
        break
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  }

  // Idempotente: si el esquema ya está y no se pidió recrear, no se re-aplica.
  // Aplicar todo tarda ~10 s y las pruebas se corren muchas veces seguidas.
  let yaEsta = false
  try {
    const r = psql("select to_regclass('public.invoice') is not null as si;")
    yaEsta = /\bt\b/.test(r) && !recrear
  } catch {
    yaEsta = false
  }

  if (!yaEsta) {
    psql(CIMIENTOS)
    for (const f of ARCHIVOS) {
      psql(fs.readFileSync(path.join(BACKEND, f), "utf8"))
    }
    // Las dos van juntas en una transacción para que el GUC del uid valga en
    // todas sus sentencias: `set local` muere al acabar la transacción.
    psql(`begin;\n${SEMILLA}\ncommit;`)
    psql(`begin;\n${EXISTENCIAS}\ncommit;`)
  }

  return { url: URL_BASE, ANA, BETO }
}

// Ejecutable directamente: `node test/preparar.mjs [--recrear]`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const recrear = process.argv.includes("--recrear")
  preparaBase({ recrear })
    .then(() => console.log(`base lista en ${URL_BASE}${recrear ? " (recreada)" : ""}`))
    .catch((e) => {
      console.error("no pude preparar la base:", e.stderr?.toString?.() ?? e.message)
      process.exit(1)
    })
}
