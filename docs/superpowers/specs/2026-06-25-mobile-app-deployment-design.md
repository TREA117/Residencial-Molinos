---
name: mobile-app-deployment
description: Publicar la app móvil de Real Molinos 3 en GitHub, configurar EAS Build, preparar para Play Store y cubrir ciberseguridad, legal, moderación de archivos y eliminación de cuenta
metadata:
  type: project
---

# Diseño: Publicación de App Móvil Real Molinos 3

**Fecha:** 2026-06-25
**Repo destino:** https://github.com/TREA117/real-molinos-3-app.git
**Stack:** React Native + Expo 56 + EAS Build + Supabase Edge Functions

---

## Contexto

La app móvil vive en `mobile/` dentro del repo web. Tiene su propio git local en rama `master` sin remote. El código está completo (auth, vistas residente y admin, integración Supabase). El `.gitignore` raíz ya excluye `mobile/` del repo web.

El objetivo es:
1. Subir el código a GitHub
2. Vincular con EAS Build y testear en emulador Android
3. Cubrir ciberseguridad, legal/privacidad, moderación de archivos y eliminación de cuenta

---

## Enfoque elegido: EAS Development Build + Emulador

Se descarta Expo Go (no representativo de producción) y build local con Android Studio (complejo en Windows). Se usa EAS para compilar en la nube y testear en emulador local.

---

## Sección 1: Repositorio GitHub

**Archivos afectados:** ninguno (solo operaciones git)

Pasos:
1. `cd mobile/`
2. `git remote add origin https://github.com/TREA117/real-molinos-3-app.git`
3. `git branch -m master main`
4. `git push -u origin main`

Lo que **no** se sube (ya en `mobile/.gitignore`):
- `node_modules/`
- `.expo/`
- `google-service-account.json`
- `.env` / `.env*.local`
- `/ios` y `/android`

---

## Sección 2: Variables de entorno y EAS Init

### `.env` (local, nunca commitear)

Crear `mobile/.env`:
```
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key de Supabase>
```

La anon key está en `index.html` → `window.SUPABASE_CONFIG`.

La API key de Cloud Vision **no va en el cliente** — se configura como secreto en la Edge Function:
```bash
npx supabase secrets set CLOUD_VISION_API_KEY=<tu key>
```

### EAS Init

```bash
cd mobile/
npx eas-cli login
npx eas-cli init
```

`eas init` agrega a `app.json`:
```json
"extra": {
  "eas": { "projectId": "<uuid generado>" }
}
```

Este cambio sí se sube al repo.

### Build de desarrollo

```bash
npx eas-cli build --platform android --profile development
```

- Compila en servidores de Expo (~10-20 min primer build)
- Genera APK descargable desde expo.dev con hot reload activo

---

## Sección 3: Android Studio y flujo de pruebas

### Setup del emulador (una sola vez)

1. Instalar Android Studio: https://developer.android.com/studio
2. Device Manager → Create Virtual Device → **Pixel 8, API 35 (Android 15)**
3. Instalar el APK: arrastrar al emulador o `adb install <archivo.apk>`

### Flujo de pruebas diario

```bash
cd mobile/
npx expo start   # presionar 'a' para conectar al emulador
```

**Casos a probar:**
- Login admin y residente
- Registro de residente nuevo
- Subir comprobante (imagen válida e imagen inválida)
- Vistas admin: comprobantes, residentes, finanzas, reportes
- Notificaciones de rechazo
- Flujo de eliminar cuenta (confirmar anonimización)

### Flujo hacia Play Store

1. `npx eas-cli build --platform android --profile production` → `.aab`
2. Google Play Console → Internal Testing → subir `.aab`
3. Agregar testers por email desde la consola

Submit automático (requiere `google-service-account.json`):
```bash
npx eas-cli submit --platform android --profile production
```

---

## Sección 4: Ciberseguridad

### Rate limiting
Supabase Auth tiene rate limiting integrado: 5 intentos de login por hora por IP. No requiere configuración adicional. Documentar en el README del repo mobile.

### Auditoría de API keys
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`: pública por diseño (solo da acceso sujeto a RLS) — seguro en cliente
- `service_role` key: **jamás** en código cliente — auditar todos los archivos `.js`/`.jsx` buscando `service_role` o `SERVICE_ROLE`
- `CLOUD_VISION_API_KEY`: secreto de Supabase Edge Function (nunca en cliente) — restringir en Google Cloud Console por IP del servidor de Supabase
- **Auditoría:** `grep -r "service_role" mobile/src/` debe retornar cero resultados

### SQL injection
`@supabase/supabase-js` usa queries parametrizadas internamente. Las funciones RPC en Supabase usan parámetros `$1`/`$2` — no hay interpolación de strings. Auditar `supabase-migration.sql` y cualquier función RPC en busca de concatenación de strings con datos de usuario.

### Validación de uploads (primera línea de defensa)
Antes de subir al Storage, validar en cliente:
- Tipo MIME: solo `image/jpeg`, `image/png`, `image/webp`
- Tamaño: ≤ 10 MB
- Dimensiones: > 100×100 px (evita archivos corruptos o píxel de tracking)

---

## Sección 5: Legal y Privacidad

### Uso de IA
Claude Code (Anthropic) fue utilizado para asistir en el desarrollo. La app **no** tiene funciones de IA de cara al usuario (sin procesamiento de lenguaje natural, sin modelos generativos en tiempo real). Incluir en la política de privacidad:

> "Esta aplicación fue desarrollada con asistencia de herramientas de inteligencia artificial (Claude Code de Anthropic). Ningún dato de usuario es procesado por sistemas de IA en tiempo real."

### Etiqueta de privacidad — datos recolectados

Para el formulario **Data Safety** de Google Play y App Store Connect:

| Dato | Tipo | Finalidad | Compartido con terceros |
|---|---|---|---|
| Nombre completo | Identidad personal | Identificación en la plataforma | No |
| Correo electrónico | Contacto | Autenticación y notificaciones | No |
| Teléfono | Contacto | Contacto por administración | No |
| Número de departamento | Identificador de usuario | Asociar pagos y cuenta | No |
| Monto y fecha de pago | Financiero | Registro de cuotas de mantenimiento | No |
| Imagen de comprobante de pago | Contenido del usuario | Verificación de pago por admin | Google Cloud Vision (moderación) |
| Historial de pagos | Financiero | Estado de cuenta del residente | No |

### Términos de servicio — cláusula de arbitraje

Agregar a `terminos.html` (crear si no existe) o a `privacidad.html`:

> **Resolución de disputas y arbitraje vinculante.** Cualquier controversia derivada del uso de esta aplicación se resolverá mediante arbitraje individual vinculante conforme a las reglas de la Cámara de Comercio Internacional. Las partes renuncian expresamente a iniciar o participar en demandas colectivas (class actions). Esta cláusula no aplica a solicitudes de medidas cautelares urgentes.

**Nota:** Un abogado debe revisar esta cláusula antes de publicarla. La ley aplicable es la del estado de Jalisco, México.

### DMCA / Derechos de autor
Los usuarios solo pueden subir imágenes de comprobantes de pago propios. Riesgo de infracción de copyright: prácticamente nulo. No se requiere pago a ningún servicio de licencias. Incluir en los ToS:

> "El usuario garantiza que los archivos subidos son de su autoría o cuenta con los derechos para subirlos. Nos reservamos el derecho de eliminar cualquier contenido que infrinja derechos de terceros."

---

## Sección 6: Moderación de archivos subidos

### Arquitectura

```
Usuario sube imagen
       ↓
Validación cliente (tipo/tamaño/dimensiones)
       ↓
Upload a Storage comprobantes/
       ↓
INSERT en payments (has_voucher=true)
       ↓
Supabase Edge Function: moderar-comprobante
       ↓
Google Cloud Vision Safe Search API
       ↓
LIKELY/VERY_LIKELY en adult|violence|racy?
   ├── SÍ → payments.status='rejected', INSERT notificación, INSERT audit_log
   └── NO → no acción (admin revisa manualmente)
```

### Edge Function: `moderar-comprobante`

- Trigger: Database Webhook en INSERT a `payments` con `has_voucher=true`
- Descarga imagen desde Storage usando `service_role` (solo en servidor)
- Llama a Cloud Vision Safe Search Detection
- Escribe resultado en `audit_log`

**Costo:** Cloud Vision Safe Search — primeras 1,000 imágenes/mes gratis. Para ~20-50 comprobantes mensuales: $0.

### Tabla nueva: `audit_log`

```sql
CREATE TABLE audit_log (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type   TEXT NOT NULL,  -- 'file_moderation', 'account_deleted', etc.
  user_id      UUID REFERENCES users(id),
  file_path    TEXT,
  result       JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

RLS: solo admin puede leer. Nadie puede escribir directamente (solo Edge Functions con service_role).

---

## Sección 7: Eliminar cuenta (soft delete + anonimización)

### Migración de base de datos

```sql
ALTER TABLE users
  ADD COLUMN is_deleted  BOOLEAN     DEFAULT FALSE,
  ADD COLUMN deleted_at  TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX idx_users_is_deleted ON users(is_deleted) WHERE is_deleted = TRUE;
```

### Proceso de eliminación (irreversible)

1. **Anonimizar PII en `users`:**
   ```sql
   UPDATE users SET
     name          = 'Usuario Eliminado',
     email         = 'deleted_' || id || '@realmolinos3.anon',
     phone         = NULL,
     password_hash = NULL,
     is_deleted    = TRUE,
     deleted_at    = NOW()
   WHERE id = <user_id>;
   ```
2. **Eliminar notificaciones:** `DELETE FROM notifications WHERE user_id = <user_id>`
3. **Conservar `payments`:** necesarios para contabilidad — `resident_name`/`depto` quedan como dato histórico sin PII vinculada al usuario activo
4. **Revocar sesión:** `supabase.auth.signOut()`
5. **Eliminar cuenta Auth:** Edge Function con `service_role` → `supabase.auth.admin.deleteUser(id)`
6. **Registrar en `audit_log`:** event_type='account_deleted', user_id, created_at

### UI — botón "Eliminar cuenta"

**App móvil** (`mobile/src/app/(resident)/account.jsx`):
- Sección inferior separada del resto del perfil
- Botón rojo con icono de advertencia: "Eliminar mi cuenta"
- Alert paso 1: "¿Estás seguro? Esta acción es irreversible."
- Alert paso 2: "Escribe ELIMINAR para confirmar" (TextInput)
- Solo procede si el texto coincide exactamente

**App web** (`js/app.js` + `index.html`):
- Mismo patrón en la vista de residente
- Requerido por Apple App Store guideline 5.1.1 y Google Play policy

---

## Archivos que se crean o modifican

| Archivo | Cambio |
|---|---|
| `mobile/app.json` | Agrega `extra.eas.projectId` tras `eas init` |
| `mobile/.env` | Crear local con anon key y Cloud Vision key (no commitear) |
| `mobile/src/app/(resident)/account.jsx` | Agregar sección "Eliminar cuenta" |
| `mobile/src/services/auth.js` | Agregar función `deleteAccount()` |
| `supabase/functions/moderar-comprobante/index.ts` | Nueva Edge Function (moderación) |
| `supabase/functions/eliminar-cuenta/index.ts` | Nueva Edge Function (delete Auth user) |
| `supabase-migration.sql` | Nuevas columnas `is_deleted`/`deleted_at` + tabla `audit_log` |
| `privacidad.html` o `terminos.html` | Cláusula de arbitraje + etiqueta de datos + disclosure IA |
| `js/app.js` | Botón "Eliminar cuenta" en vista residente web |
| `index.html` | Modal/sección eliminar cuenta en web |

---

## Notas finales

- La cláusula de arbitraje debe ser revisada por un abogado antes de publicar
- `google-service-account.json` nunca se sube al repo
- La Cloud Vision API key debe restringirse por package name en Google Cloud Console
- Los skills disponibles (supabase, expo-deployment, security-review) deben invocarse en cada fase de implementación correspondiente
