-- =============================================================================
-- migration-004-asistente — límite de uso del asistente, por usuario
-- =============================================================================
-- Re-runnable: se puede aplicar las veces que haga falta.
--
-- POR QUÉ ESTO VIVE EN POSTGRES Y NO EN LA EDGE FUNCTION
--
-- El límite tiene que ser durable y no falsificable. En memoria de la función
-- se pierde en cada arranque en frío y no se comparte entre instancias; en el
-- navegador lo brinca cualquiera con las herramientas de desarrollador. Aquí
-- es una tabla con RLS y una función SECURITY DEFINER: el usuario puede LEER
-- su consumo pero no escribirlo, así que no puede reiniciar su propio contador.
--
-- Protege dos cosas distintas:
--   1. La cuota gratuita de Groq, que es de toda la empresa. Un bucle en una
--      pantalla la quema en minutos y deja al resto sin asistente.
--   2. El reparto entre personas: que alguien no se lleve el día entero.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- asistente_uso — un renglón por usuario y hora
-- -----------------------------------------------------------------------------
-- Ventanas fijas (no deslizantes) a propósito: una ventana deslizante exige
-- guardar cada consulta con su marca de tiempo y barrerlas en cada llamada.
-- Con ventana fija basta un contador, y la diferencia práctica —que el cupo
-- se reinicie en la hora en punto— no le importa a nadie aquí.
create table if not exists public.asistente_uso (
  user_id   uuid     not null references auth.users (id) on delete cascade,
  dia       date     not null,
  hora      smallint not null check (hora between 0 and 23),
  consultas integer  not null default 0 check (consultas >= 0),
  primary key (user_id, dia, hora)
);

alter table public.asistente_uso enable row level security;

-- Solo lectura de lo propio. NO hay política de insert ni de update: la única
-- forma de mover el contador es la función de abajo, que corre como definer.
-- Es el mismo patrón de las tablas de nivel 2 (invoice, payments…).
drop policy if exists asistente_uso_leer on public.asistente_uso;
create policy asistente_uso_leer on public.asistente_uso
  for select using (user_id = auth.uid());

-- Los permisos de tabla, explícitos. Supabase concede todo sobre las tablas de
-- public por omisión (por eso policy.sql REVOCA en vez de conceder), y aunque
-- RLS ya bloquea las escrituras por falta de política, depender de un default
-- implícito para algo que guarda un contador anti-abuso es apostar a que ese
-- default no cambie. Aquí se dice en voz alta: solo lectura.
revoke all on public.asistente_uso from anon, authenticated;
grant select on public.asistente_uso to authenticated;

create index if not exists asistente_uso_dia_idx on public.asistente_uso (dia);


-- -----------------------------------------------------------------------------
-- asistente_limites — los topes, en UN solo lugar
-- -----------------------------------------------------------------------------
-- Estaban escritos dos veces: como constantes en asistente_consumir y a mano en
-- asistente_cupo. Cambiar uno y no el otro haría que la pantalla prometiera un
-- cupo distinto del que se aplica — el usuario ve «te quedan 20» y a la quinta
-- lo cortan. Una sola definición y las dos funciones la leen.
--
-- La ZONA HORARIA también vive aquí. Con UTC el cupo diario se reiniciaría a
-- las 7 de la tarde hora de Panamá, y el mensaje «se reinicia mañana» sería
-- mentira. Con la zona del negocio, «mañana» quiere decir mañana.
create or replace function public.asistente_limites()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('hora', 30, 'dia', 150, 'zona', 'America/Panama');
$$;

grant execute on function public.asistente_limites() to authenticated, anon;


-- -----------------------------------------------------------------------------
-- asistente_consumir — comprueba y descuenta en un solo paso
-- -----------------------------------------------------------------------------
-- LOS LÍMITES SON CONSTANTES, NO PARÁMETROS. Si el tope viniera de quien llama,
-- bastaría con pedir 999999 para no tener tope. La Edge Function llama a esto
-- sin argumentos y no puede negociar su cupo.
--
-- El bloqueo consultivo por usuario serializa comprobar-y-descontar. Sin él dos
-- pestañas simultáneas leen el mismo contador, las dos se ven por debajo del
-- tope y las dos pasan — el mismo error de lectura obsoleta que ya arreglamos
-- en la huella de las facturas.
--
-- Devuelve jsonb: {permitido, restantes_hora, restantes_dia, motivo}
create or replace function public.asistente_consumir()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Generosos para el uso normal, apretados contra un bucle accidental.
  v_lim         jsonb   := public.asistente_limites();
  c_limite_hora integer := (v_lim ->> 'hora')::integer;
  c_limite_dia  integer := (v_lim ->> 'dia')::integer;
  c_zona        text    := v_lim ->> 'zona';

  v_uid  uuid := auth.uid();
  v_dia  date;
  v_hora smallint;
  v_hora_actual integer;
  v_dia_actual  integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  v_dia  := (now() at time zone c_zona)::date;
  v_hora := extract(hour from (now() at time zone c_zona))::smallint;

  -- Serializa a ESTE usuario hasta el fin de la transacción.
  perform pg_advisory_xact_lock(hashtext('asistente:' || v_uid::text));

  select coalesce(consultas, 0) into v_hora_actual
    from public.asistente_uso
   where user_id = v_uid and dia = v_dia and hora = v_hora;
  v_hora_actual := coalesce(v_hora_actual, 0);

  select coalesce(sum(consultas), 0) into v_dia_actual
    from public.asistente_uso
   where user_id = v_uid and dia = v_dia;

  -- Se comprueba ANTES de descontar: una consulta rechazada no gasta cupo, o
  -- quien topa el límite se quedaría fuera más tiempo por seguir intentando.
  if v_hora_actual >= c_limite_hora then
    return jsonb_build_object(
      'permitido', false,
      'restantes_hora', 0,
      'restantes_dia', greatest(c_limite_dia - v_dia_actual, 0),
      'motivo', format('Llegaste a %s consultas en esta hora. Se reinicia en la próxima.', c_limite_hora));
  end if;

  if v_dia_actual >= c_limite_dia then
    return jsonb_build_object(
      'permitido', false,
      'restantes_hora', greatest(c_limite_hora - v_hora_actual, 0),
      'restantes_dia', 0,
      'motivo', format('Llegaste a %s consultas hoy. Se reinicia mañana.', c_limite_dia));
  end if;

  insert into public.asistente_uso (user_id, dia, hora, consultas)
  values (v_uid, v_dia, v_hora, 1)
  on conflict (user_id, dia, hora)
    do update set consultas = public.asistente_uso.consultas + 1;

  return jsonb_build_object(
    'permitido', true,
    'restantes_hora', c_limite_hora - v_hora_actual - 1,
    'restantes_dia',  c_limite_dia  - v_dia_actual  - 1,
    'motivo', null);
end;
$$;

revoke execute on function public.asistente_consumir() from public, anon;
grant  execute on function public.asistente_consumir() to authenticated;


-- -----------------------------------------------------------------------------
-- asistente_cupo — cuánto queda, SIN descontar
-- -----------------------------------------------------------------------------
-- Para que la pantalla pueda avisar «te quedan 3» sin gastar una consulta al
-- preguntarlo. Es de lectura pura, así que va como invoker y RLS la acota.
create or replace function public.asistente_cupo()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with l as (select public.asistente_limites() as v),
       ahora as (select (now() at time zone (select v ->> 'zona' from l)) as t),
       uso as (
         select coalesce(sum(consultas) filter (
                  where hora = extract(hour from (select t from ahora))::smallint), 0) as en_hora,
                coalesce(sum(consultas), 0) as en_dia
           from public.asistente_uso
          where user_id = auth.uid()
            and dia = (select t from ahora)::date
       )
  select jsonb_build_object(
    'restantes_hora', greatest((select (v ->> 'hora')::int from l) - uso.en_hora, 0),
    'restantes_dia',  greatest((select (v ->> 'dia')::int  from l) - uso.en_dia,  0))
  from uso;
$$;

revoke execute on function public.asistente_cupo() from public, anon;
grant  execute on function public.asistente_cupo() to authenticated;


-- -----------------------------------------------------------------------------
-- Limpieza
-- -----------------------------------------------------------------------------
-- La tabla crece un renglón por usuario y hora ACTIVA: con cinco personas son
-- unos pocos miles al año, así que no hace falta automatizar nada. Si algún día
-- estorba, esto la poda y es seguro correrlo cuando sea:
--
--   delete from public.asistente_uso where dia < current_date - 90;
