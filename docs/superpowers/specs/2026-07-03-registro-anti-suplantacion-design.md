# Endurecer registro de residentes contra suplantación de correo/depto

## Contexto

Durante una auditoría de seguridad de Supabase (proyecto `qxjuztctbpwymmskdyqw`) se identificó que
`register_resident_profile` y `reconcile_user_auth_id` (funciones `SECURITY DEFINER` llamadas desde
`js/auth.js::doRegister()`) son necesariamente invocables sin sesión (`anon`), porque `signUp()` no
otorga sesión hasta que se confirma el correo, y esta app confirma el correo manualmente vía admin,
nunca por link automático de Supabase.

Su única validación es que el `p_id` provisto corresponda a una fila de `auth.users` cuyo email
coincida con `p_email`. Esto deja abierto un escenario: alguien podría registrarse usando el correo de
un residente real que **aún no se ha registrado**, quedándose con el depto en estado `pending` antes
que el dueño legítimo. Si el admin aprueba sin verificar identidad fuera de la app, el atacante se
queda con la cuenta; si no aprueba, el residente real de todos modos ya no puede registrarse con su
propio correo (Supabase rechaza correos duplicados en `auth.users`).

Al investigar esto se encontró un segundo problema, independiente pero relacionado: `fetchProfileByEmail()`
en `js/auth.js` corre como `anon` **antes** de `signUp()`, pero la política RLS de `users`
(`users_select_own_or_admin`) exige rol `authenticated`. Esa consulta por lo tanto **siempre devuelve
vacío** para el llamador anónimo, así que la rama de "vincular cuenta legacy existente"
(`reconcile_user_auth_id`) nunca se dispara desde la UI — todo registro cae en
`register_resident_profile`, incluidas cuentas legacy que deberían vincularse.

El admin de este proyecto confirmó que verifica identidad de los residentes por fuera de la app antes
de aprobar, así que el mecanismo elegido es un bloqueo automático en la base de datos (defensa
adicional, no depende solo del criterio del admin) en vez de solo una señal visual.

## Alcance

**Incluye:**
- A. Nueva RPC `check_email_registration_status` para detectar correctamente cuentas
  existentes/legacy antes de `signUp()`, reemplazando la consulta rota.
- B. Bloqueo duro en `register_resident_profile` cuando el depto solicitado ya tiene otro residente
  `pending` o `approved`.

**Explícitamente fuera de alcance:**
- No se toca `reconcile_user_auth_id` (ya valida correo correctamente).
- No se cambia el modelo de confirmación manual de correo por admin.
- No se agrega ninguna señal visual en `admin.js` — se descartó porque, con el bloqueo duro de (B),
  nunca puede existir un choque de depto en pending/aprobado simultáneamente, así que un aviso de
  "depto duplicado" sería código muerto.

## A. RPC para detectar cuenta existente antes de `signUp()`

### Función Postgres

```sql
CREATE OR REPLACE FUNCTION public.check_email_registration_status(p_email text)
RETURNS TABLE(existing_id uuid, is_legacy boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select id, (legacy_id is not null and not auth_synced)
  from public.users
  where lower(email) = lower(p_email) and is_deleted = false
  limit 1
$$;

REVOKE EXECUTE ON FUNCTION public.check_email_registration_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_registration_status(text) TO anon, authenticated;
```

Devuelve como máximo una fila con únicamente `existing_id` y `is_legacy` — nunca nombre, teléfono,
depto ni fee. Esto evita filtrar más información de la que Supabase Auth ya filtra por su cuenta (el
propio `signUp()` ya responde distinto según si el correo existe o no en `auth.users`).

### Cambio en `js/auth.js`

En `doRegister()`, reemplazar:
```js
const existing = await fetchProfileByEmail(email);
```
por una llamada a la nueva RPC. Comportamiento resultante:

| Resultado de la RPC | Acción |
|---|---|
| `is_legacy = true` | Igual que hoy: llamar `reconcile_user_auth_id(p_old_id: existing_id, p_new_id: data.user.id)` — ahora sí se ejecuta, porque antes `existing` siempre era `null`. |
| existe pero `is_legacy = false` | Nuevo: mostrar error "Ya existe una cuenta con este correo. Si es tuya, usa 'Olvidé mi contraseña'." y no llamar a ninguna RPC de registro. |
| no existe ninguna fila | Igual que hoy: continuar a `register_resident_profile`. |

`fetchProfileByEmail()` (que sigue usándose en `doLogin()` con sesión ya autenticada, donde RLS sí
permite leer la propia fila) no se modifica — solo se deja de usar en el pre-check de `doRegister()`.

## B. Bloqueo de depto duplicado en `register_resident_profile`

```sql
CREATE OR REPLACE FUNCTION public.register_resident_profile(
  p_id uuid, p_name text, p_email text, p_phone text, p_depto text, p_fee numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_auth_email text;
begin
  select email into v_auth_email from auth.users where id = p_id;
  if v_auth_email is null or lower(v_auth_email) <> lower(p_email) then
    raise exception 'register_resident_profile: el id no corresponde a una cuenta de auth recién creada con ese correo';
  end if;

  if exists (select 1 from public.users where id = p_id) then
    raise exception 'register_resident_profile: el perfil ya existe';
  end if;

  if exists (
    select 1 from public.users
    where depto = p_depto and is_deleted = false
      and depto_status in ('pending', 'approved') and id <> p_id
  ) then
    raise exception 'register_resident_profile: ya existe un residente pendiente o aprobado para el depto %', p_depto;
  end if;

  insert into public.users (id, name, email, phone, depto, role, depto_status, fee)
  values (p_id, p_name, p_email, p_phone, p_depto, 'resident', 'pending', p_fee);
end;
$function$;
```

Solo se agrega el nuevo bloque `if exists (...)`; el resto de la función queda igual.

### Cambio en `js/auth.js`

En el `catch` de `doRegister()` (donde hoy se relanza `rpcError` genérico), detectar el mensaje
`'ya existe un residente pendiente o aprobado'` y mostrar un texto más claro al usuario en vez del
error crudo de Postgres, ej.: "Ya hay un registro para este departamento. Si hubo un cambio de
residente, contacta al administrador."

### Rotación de depto

Si un residente se muda y entra uno nuevo, el flujo sigue siendo el mismo que ya existe hoy: el admin
debe eliminar al residente anterior (`delete_resident_complete`, ya gateado por `is_admin()`) antes de
que el nuevo pueda registrarse para ese depto. Este cambio no agrega fricción operativa nueva.

## Fuera de alcance / no resuelto por este diseño

Ninguna de las dos partes evita que alguien registre una cuenta usando el correo exacto de un
residente real que **todavía no existe en `public.users`** (ni como legacy ni como perfil actual) —
seguir dependiendo, para ese caso específico, de que el admin verifique identidad fuera de la app
antes de aprobar el depto (confirmado que ya lo hace). El bloqueo de depto (B) sí evita que ese ataque
se repita una segunda vez sobre el mismo depto una vez que ya hay una fila `pending`/`approved`.

## Testing

- Registro nuevo (correo nunca visto): sigue funcionando igual, sin cambios de comportamiento.
- Registro con correo de cuenta legacy no vinculada (`legacy_id` no nulo, `auth_synced = false`):
  ahora sí dispara `reconcile_user_auth_id` en vez de caer (rota) en `register_resident_profile`.
- Registro con correo de una cuenta ya vinculada (`auth_synced = true` o sin `legacy_id`): muestra el
  nuevo mensaje de error en vez de intentar registrar.
- Dos registros distintos para el mismo `depto` mientras el primero sigue `pending` o `approved`: el
  segundo debe fallar con el nuevo mensaje de depto duplicado.
- Registro para un `depto` cuyo único residente previo ya fue eliminado (`delete_resident_complete`):
  debe permitirse sin bloqueo.
