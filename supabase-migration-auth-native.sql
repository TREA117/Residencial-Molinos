-- ============================================================
-- Real Molinos 3 — Migración a Supabase Auth nativo
-- ============================================================
-- Este script se corre A MANO en el SQL Editor de Supabase
-- (Project → SQL Editor) UNA SOLA VEZ. Es DDL (ALTER TABLE,
-- CREATE FUNCTION) y eso no se puede hacer vía la API REST con
-- la anon key — por eso esta parte sí necesita el SQL Editor.
--
-- Contexto: hoy `users.id` es entero (serial). `auth.users.id`
-- (Supabase Auth nativo) siempre es UUID. No hay cast directo
-- de int a uuid en Postgres, así que las filas existentes
-- reciben un UUID aleatorio temporal aquí.
--
-- La reconciliación de cada cuenta (vincular ese UUID temporal
-- con el auth.users.id real, una vez que la persona se vuelve a
-- registrar) NO requiere que vuelvas a este SQL Editor: este
-- script crea una función `reconcile_user_auth_id(...)` que la
-- app llama automáticamente vía `supabase.rpc(...)` en el
-- momento del registro. Como RLS está desactivado en todas las
-- tablas (CLAUDE.md), la anon key ya puede escribir esas filas;
-- lo único que no puede hacer por REST es el ALTER TABLE.
--
-- Antes de correr nada: respalda las 3 tablas (Table Editor →
-- Export CSV, o Database → Backups).
-- ============================================================


-- ============================================================
-- FASE 1 — Esquema (correr UNA SOLA VEZ, antes de que nadie
-- se registre con Supabase Auth)
-- ============================================================

create extension if not exists pgcrypto;

-- --- Paso 0: verificar el nombre real de la PK de `users` ---
-- Por defecto Postgres la llama "users_pkey", pero confírmalo:
--   select conname from pg_constraint
--   where conrelid = 'public.users'::regclass and contype = 'p';
-- Si el nombre es distinto, reemplázalo en el `drop constraint`
-- de abajo.

-- --- Paso 1: revisar si hay datos no nulos en las FKs ---
-- Si cualquiera de estos dos selects regresa > 0, NO uses los
-- pasos "using null" de abajo — usa la variante con JOIN que
-- está al final de este archivo (sección "VARIANTE CON JOIN").
--   select count(*) from public.payments      where resident_id is not null;
--   select count(*) from public.notifications  where user_id     is not null;

-- --- Paso 2: users — respaldar id viejo, retipar a uuid ---
alter table public.users add column if not exists legacy_id integer;
update public.users set legacy_id = id where legacy_id is null;
alter table public.users add column if not exists auth_synced boolean not null default false;

alter table public.users alter column id drop default;
alter table public.users drop constraint users_pkey; -- ver Paso 0 si el nombre no coincide
alter table public.users alter column id type uuid using gen_random_uuid();
alter table public.users alter column id set default gen_random_uuid();
alter table public.users add constraint users_pkey primary key (id);
drop sequence if exists public.users_id_seq;

-- --- Paso 3: payments.resident_id — retipar a uuid ---
-- Solo válido si el Paso 1 confirmó 0 filas con resident_id no nulo.
alter table public.payments add column if not exists resident_legacy_id integer;
update public.payments set resident_legacy_id = resident_id where resident_legacy_id is null;
alter table public.payments alter column resident_id type uuid using null;

-- --- Paso 4: notifications.user_id — retipar a uuid ---
-- Solo válido si el Paso 1 confirmó 0 filas con user_id no nulo.
alter table public.notifications add column if not exists user_legacy_id integer;
update public.notifications set user_legacy_id = user_id where user_legacy_id is null;
alter table public.notifications alter column user_id type uuid using null;

-- --- Paso 5: función de reconciliación, llamada por la app ---
-- La app (web y móvil) hace esto automáticamente con
-- `supabase.rpc('reconcile_user_auth_id', { p_old_id, p_new_id })`
-- cuando alguien con cuenta existente se vuelve a registrar — no
-- hay que volver a tocar el SQL Editor para cada cuenta. La
-- verificación de email evita que cualquiera con la anon key
-- pueda reconciliar un id ajeno.
create or replace function public.reconcile_user_auth_id(p_old_id uuid, p_new_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_email text;
  v_new_email text;
begin
  select email into v_old_email from public.users where id = p_old_id;
  select email into v_new_email from auth.users   where id = p_new_id;

  if v_old_email is null or v_new_email is null or lower(v_old_email) <> lower(v_new_email) then
    raise exception 'reconcile_user_auth_id: email no coincide o falta fila (old=%, new=%)', p_old_id, p_new_id;
  end if;

  update public.payments      set resident_id = p_new_id where resident_id = p_old_id;
  update public.notifications set user_id     = p_new_id where user_id     = p_old_id;
  update public.users set id = p_new_id, auth_synced = true where id = p_old_id;

  -- Cuenta de antes de la migración: ya estaba aprobada bajo el sistema
  -- viejo, así que se confirma de una vez (no hay un botón "Autorizar"
  -- para ella en la app, a diferencia de los residentes nuevos).
  update auth.users set email_confirmed_at = now()
  where id = p_new_id and email_confirmed_at is null;
end;
$$;

grant execute on function public.reconcile_user_auth_id(uuid, uuid) to anon, authenticated;

-- --- Paso 5b: confirmar correo — la llama la app cuando el admin
-- aprueba a un residente (botón "Autorizar"), NO se confirma sola al
-- registrarse. "Confirm email" se queda ACTIVADO en el proyecto;
-- esta función es la única forma de saltarlo, y solo el flujo de
-- aprobación del admin la invoca.
create or replace function public.confirm_user_email(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update auth.users set email_confirmed_at = now()
  where id = p_user_id and email_confirmed_at is null;
end;
$$;

grant execute on function public.confirm_user_email(uuid) to anon, authenticated;

-- --- Paso 5c: eliminar residente por completo — la llama la app cuando el
-- admin presiona "Eliminar" en Residentes. Antes de esta función,
-- "Eliminar" solo borraba la fila de `public.users`, dejando viva la
-- cuenta en `auth.users`: la persona "eliminada" seguía pudiendo
-- iniciar sesión (la app le mostraba "no se encontró tu perfil", pero
-- su credencial nunca se revocaba). Esta función borra perfil + Auth
-- + notificaciones juntos, y nunca permite borrar una cuenta admin.
create or replace function public.delete_resident_complete(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.users where id = p_user_id;

  if v_role is null then
    return; -- ya no existe el perfil, nada que hacer
  end if;

  if v_role = 'admin' then
    raise exception 'delete_resident_complete: no se puede eliminar una cuenta admin (id=%)', p_user_id;
  end if;

  delete from public.notifications where user_id = p_user_id;
  delete from public.users where id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$$;

grant execute on function public.delete_resident_complete(uuid) to anon, authenticated;

-- ============================================================
-- FASE 2 — Endurecimiento de RLS (2026-06-24)
-- ============================================================
-- Antes de esto, `users`, `payments`, `notifications` y `settings` tenían
-- RLS activado (rowsecurity=true) pero con una sola política "allow_all"
-- (qual=true) para anon+authenticated — en la práctica equivalente a no
-- tener RLS: cualquier residente autenticado podía leer/escribir CUALQUIER
-- fila de CUALQUIER tabla, incluyendo ponerse role='admin' a sí mismo.
-- Esta fase la reemplaza por políticas reales por operación. Ver
-- la migración "harden_rls_policies" aplicada vía Supabase MCP para el
-- SQL completo (función is_admin(), políticas, trigger
-- prevent_self_role_escalation). También se aplicó
-- "harden_comprobantes_storage_policies": UPDATE/DELETE en el bucket
-- comprobantes ahora requieren is_admin() (antes cualquier authenticated
-- podía borrar el comprobante de cualquier otro residente).
--
-- Resumen de las políticas resultantes:
--   users:         select/update propio o admin; insert propio (forzando
--                  role=resident, depto_status=pending) o admin; delete solo admin.
--   payments:      select propio (resident_id=auth.uid()) o admin; insert
--                  propio forzando status=pending,type=income (no autoaprobarse)
--                  o admin; update/delete solo admin.
--   notifications: select/update propio (marcar leído) o admin; insert/delete solo admin.
--   settings:      select cualquier authenticated; insert/update solo admin.
--   storage comprobantes: select/insert abiertos a authenticated (público
--                  para mostrar imágenes sin token); update/delete solo admin.
--
-- Probado con 2 residentes de prueba + cuentas reales: aislamiento entre
-- residentes, bloqueo de autoescalación (el trigger revierte
-- role/depto_status/fee si quien edita no es admin), y que el admin sigue
-- teniendo acceso completo a todo.

-- --- Paso 6: verificación ---
-- Debe mostrar 2 filas (o las que existan), cada una con un
-- `id` UUID nuevo, su `legacy_id` original (1, 6, ...) y
-- `auth_synced = false`.
select id, legacy_id, email, role, auth_synced from public.users order by legacy_id;


-- ============================================================
-- FALLBACK MANUAL — normalmente NO necesitas esto. Úsalo solo
-- si el RPC automático falla a mitad de camino (ej. se cerró la
-- app justo después del signUp) y quieres reconciliar una
-- cuenta a mano.
-- ============================================================
-- select public.reconcile_user_auth_id(
--   (select id from public.users where email = 'admin@molino.com'),
--   (select id from auth.users   where email = 'admin@molino.com')
-- );


-- ============================================================
-- VARIANTE CON JOIN — usar en vez de los Pasos 3/4 de la Fase 1
-- SOLO SI el Paso 1 detectó filas con resident_id/user_id no
-- nulos (preserva el vínculo usando legacy_id en vez de
-- simplemente vaciar la columna).
-- ============================================================

-- payments:
-- alter table public.payments add column if not exists resident_legacy_id integer;
-- update public.payments set resident_legacy_id = resident_id where resident_legacy_id is null;
-- alter table public.payments add column resident_id_new uuid;
-- update public.payments p
--   set resident_id_new = u.id
--   from public.users u
--   where u.legacy_id = p.resident_id;
-- alter table public.payments drop column resident_id;
-- alter table public.payments rename column resident_id_new to resident_id;

-- notifications:
-- alter table public.notifications add column if not exists user_legacy_id integer;
-- update public.notifications set user_legacy_id = user_id where user_legacy_id is null;
-- alter table public.notifications add column user_id_new uuid;
-- update public.notifications n
--   set user_id_new = u.id
--   from public.users u
--   where u.legacy_id = n.user_id;
-- alter table public.notifications drop column user_id;
-- alter table public.notifications rename column user_id_new to user_id;
