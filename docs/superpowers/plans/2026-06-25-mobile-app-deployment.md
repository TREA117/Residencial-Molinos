# Mobile App Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar la app móvil de Real Molinos 3 en GitHub, configurar EAS Build para testeo en emulador Android, y cubrir ciberseguridad, legal, moderación de archivos subidos y eliminación de cuenta con anonimización.

**Architecture:** La app móvil (React Native + Expo 56) vive en `mobile/` con su propio repo git. Se publica en un repo separado en GitHub, se vincula a EAS Build para compilar APKs en la nube, y se extiende con dos Supabase Edge Functions (moderación de archivos vía Cloud Vision y eliminación de cuenta). El botón "Eliminar cuenta" se agrega tanto a la app móvil como a la web.

**Tech Stack:** Expo 56 / React Native, EAS CLI, Supabase Edge Functions (Deno), Google Cloud Vision API, @supabase/supabase-js v2, HTML/CSS/JS vanilla (web).

## Global Constraints

- No frameworks nuevos en la app web (sin React, Vue, jQuery)
- Paleta de colores: navy `#001534`, gold `#C89A2B` — no modificar sin autorización
- Versión de scripts web: actualizar querystring `?v=YYYYMMDD` en index.html al modificar cualquier JS
- La `service_role` key nunca va en código cliente — solo en Edge Functions como variable de entorno
- `google-service-account.json` y `.env` nunca se commitean
- Supabase URL del proyecto: `https://qxjuztctbpwymmskdyqw.supabase.co`
- Package name Android: `com.realmolinos3.app`
- Usar skills disponibles (supabase, expo-deployment, security-review) en cada fase correspondiente

---

## File Map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `mobile/.env` | Crear (no commitear) | Anon key de Supabase |
| `mobile/app.json` | Modificar | Agregar EAS projectId tras `eas init` |
| `mobile/src/services/supabase.js` | Modificar | Exportar SUPABASE_URL |
| `mobile/src/services/auth.js` | Modificar | Agregar `deleteAccount()` |
| `mobile/src/services/resident.js` | Modificar | Agregar `validateImageAsset()` |
| `mobile/src/app/(resident)/account.jsx` | Modificar | Agregar sección "Eliminar cuenta" |
| `supabase/functions/eliminar-cuenta/index.ts` | Crear | Edge Function: anonimizar + borrar auth user |
| `supabase/functions/moderar-comprobante/index.ts` | Crear | Edge Function: Cloud Vision Safe Search |
| `supabase-migration-v2.sql` | Crear | Columnas soft delete + tabla audit_log |
| `privacidad.html` | Modificar | Disclosure IA, tabla datos, link a ToS, proceso de eliminación |
| `terminos.html` | Crear | Términos de servicio con cláusula de arbitraje |
| `js/app.js` | Modificar | Botón "Eliminar cuenta" en vista residente web |
| `index.html` | Modificar | Modal confirmar eliminación + link a terminos.html |

---

## Task 1: GitHub Remote + Push

**Files:**
- No se modifica ningún archivo

- [ ] **Paso 1: Agregar remote y renombrar rama**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
git remote add origin https://github.com/TREA117/real-molinos-3-app.git
git branch -m master main
```

- [ ] **Paso 2: Push inicial**

```bash
git push -u origin main
```

Resultado esperado: el código aparece en https://github.com/TREA117/real-molinos-3-app con rama `main`. Los `node_modules/` NO se suben (están en `.gitignore`).

- [ ] **Paso 3: Verificar en GitHub**

Abrir https://github.com/TREA117/real-molinos-3-app y confirmar que aparecen las carpetas `src/`, `assets/`, `app.json`, `eas.json`, `package.json`.

---

## Task 2: Variables de entorno + EAS Init

**Files:**
- Crear: `mobile/.env` (no commitear)
- Modificar: `mobile/app.json`

- [ ] **Paso 1: Crear .env con anon key**

Abrir `index.html` del proyecto web y buscar `window.SUPABASE_CONFIG`. Copiar el valor de `anonKey`. Luego crear `mobile/.env`:

```
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

(Pegar la anon key real que obtuviste de index.html.)

- [ ] **Paso 2: Verificar que .env no se suba a git**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
git status
```

`.env` no debe aparecer en los archivos rastreados. Si aparece, verificar que `mobile/.gitignore` contiene la línea `.env*.local` o agregar `.env` explícitamente.

- [ ] **Paso 3: Instalar EAS CLI e iniciar sesión**

```bash
npm install -g eas-cli
eas login
```

Se abrirá el navegador para autenticarse con tu cuenta de expo.dev.

- [ ] **Paso 4: Inicializar EAS en el proyecto**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
eas init
```

Cuando pregunte por el nombre del proyecto, usar `real-molinos-3`. Esto modifica `app.json` agregando:

```json
"extra": {
  "eas": { "projectId": "<uuid-generado-por-eas>" }
}
```

- [ ] **Paso 5: Commitear app.json actualizado**

```bash
git add app.json
git commit -m "feat: vincular proyecto a EAS Build (projectId)"
git push
```

---

## Task 3: Android Studio + Dev Build + Emulador

**Files:**
- No se modifica ningún archivo de código

- [ ] **Paso 1: Instalar Android Studio**

Descargar desde https://developer.android.com/studio e instalar con opciones por defecto. Requiere ~10 GB de espacio.

- [ ] **Paso 2: Crear AVD (emulador)**

Dentro de Android Studio:
1. Menú → More Actions → Virtual Device Manager (o Tools → Device Manager)
2. Create Virtual Device
3. Seleccionar: **Pixel 8** → Next
4. Seleccionar system image: **API 35 (Android 15, x86_64)** → Download si no está → Next → Finish

- [ ] **Paso 3: Compilar APK de desarrollo en EAS**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
eas build --platform android --profile development
```

EAS sube el código, compila en la nube (~15-20 min primer build). Al terminar, muestra un link de descarga. Descargar el `.apk`.

- [ ] **Paso 4: Instalar APK en el emulador**

1. Iniciar el AVD desde Device Manager
2. Arrastrar el archivo `.apk` descargado sobre la ventana del emulador

O desde terminal (si `adb` está en PATH tras instalar Android Studio):
```bash
adb install "C:\Users\Edson Trejo\Downloads\build-*.apk"
```

Resultado esperado: la app aparece en el launcher del emulador con el ícono de Real Molinos 3.

- [ ] **Paso 5: Conectar Metro Bundler**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo start
```

Presionar `a` para conectar al emulador. La app debe abrir con la pantalla de login.

- [ ] **Paso 6: Smoke test básico**

Probar en el emulador:
- Login con `admin@molino.com` / `admin123` → ver dashboard admin
- Login con `edson_al6@hotmail.com` → ver pantalla de mis pagos
- Logout y volver a login

Si hay error de conexión a Supabase, verificar que `.env` tiene la anon key correcta y reiniciar con `npx expo start --clear`.

---

## Task 4: Security Audit + Upload Validation

**Files:**
- Modificar: `mobile/src/services/resident.js`

### Auditoría de API keys

- [ ] **Paso 1: Verificar que service_role key no está en el cliente móvil**

```bash
grep -r "service_role" "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile\src"
```

Resultado esperado: sin resultados. Si aparece algo, eliminarlo inmediatamente.

- [ ] **Paso 2: Verificar que service_role key no está en el cliente web**

```bash
grep -r "service_role" "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\js"
```

Resultado esperado: sin resultados.

- [ ] **Paso 3: Verificar SQL injection en funciones RPC**

Abrir `supabase-migration-auth-native.sql` y buscar cualquier concatenación de string con datos de usuario del tipo `'... ' || variable`. Todas las funciones deben usar parámetros `$1`, `$2`, etc. No se requiere cambio si el resultado es que no hay concatenaciones.

### Validación de uploads

- [ ] **Paso 4: Agregar validateImageAsset a resident.js**

En `mobile/src/services/resident.js`, agregar antes de la función `uploadVoucherImage`:

```javascript
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function validateImageAsset(asset) {
  if (!ALLOWED_MIME.includes(asset.mimeType)) {
    throw new Error('Tipo de archivo no permitido. Solo se aceptan JPG, PNG y WebP.');
  }
  if (asset.fileSize && asset.fileSize > MAX_SIZE_BYTES) {
    throw new Error('El archivo excede el límite de 10 MB.');
  }
}
```

- [ ] **Paso 5: Llamar validateImageAsset al inicio de uploadVoucherImage**

Modificar la función `uploadVoucherImage` en `mobile/src/services/resident.js`. El inicio de la función debe quedar:

```javascript
export async function uploadVoucherImage(asset, depto) {
  validateImageAsset(asset);           // ← agregar esta línea
  const today = new Date();
  // ... resto sin cambio
```

- [ ] **Paso 6: Verificar en el emulador**

Con `npx expo start`, intentar subir un comprobante. El flujo normal debe seguir funcionando. Intentar subir un archivo que no sea imagen (si el picker lo permite) — debe mostrar el error "Tipo de archivo no permitido".

- [ ] **Paso 7: Commitear**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
git add src/services/resident.js
git commit -m "security: validar tipo MIME y tamaño de imagen antes de upload"
git push
```

---

## Task 5: Database Migration (Soft Delete + Audit Log)

**Files:**
- Crear: `supabase-migration-v2.sql`

- [ ] **Paso 1: Crear el archivo de migración**

Crear `supabase-migration-v2.sql` en la raíz del proyecto web con el siguiente contenido:

```sql
-- ============================================================
-- Real Molinos 3 — Migración v2
-- Soft delete en users + tabla audit_log
-- Correr UNA SOLA VEZ en SQL Editor de Supabase
-- ============================================================

-- 1. Columnas para soft delete en users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_deleted
  ON public.users(is_deleted)
  WHERE is_deleted = TRUE;

-- 2. Tabla audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type   TEXT        NOT NULL,
  user_id      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  file_path    TEXT,
  result       JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. RLS en audit_log: solo admin puede leer, nadie escribe directamente
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_audit_log"
  ON public.audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Sin política de INSERT/UPDATE/DELETE desde cliente:
-- solo las Edge Functions (service_role) escriben en audit_log.
```

- [ ] **Paso 2: Ejecutar en Supabase SQL Editor**

1. Ir a https://supabase.com/dashboard/project/qxjuztctbpwymmskdyqw/sql/new
2. Pegar el contenido del archivo
3. Click "Run"
4. Verificar que no hay errores

- [ ] **Paso 3: Verificar columnas**

En el SQL Editor, ejecutar:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('is_deleted', 'deleted_at');
```

Resultado esperado: 2 filas con `is_deleted` (boolean) y `deleted_at` (timestamp with time zone).

- [ ] **Paso 4: Verificar tabla audit_log**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'audit_log';
```

Resultado esperado: filas con `id`, `event_type`, `user_id`, `file_path`, `result`, `created_at`.

- [ ] **Paso 5: Commitear archivo de migración al repo web**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
git add supabase-migration-v2.sql
git commit -m "feat: migración v2 — soft delete en users + tabla audit_log"
git push
```

---

## Task 6: Edge Function eliminar-cuenta

**Files:**
- Crear: `supabase/functions/eliminar-cuenta/index.ts`

- [ ] **Paso 1: Instalar Supabase CLI y vincular proyecto**

```bash
npm install -g supabase
supabase login
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
supabase init
supabase link --project-ref qxjuztctbpwymmskdyqw
```

Cuando pregunte por la database password, ingresar la password del proyecto de Supabase.

- [ ] **Paso 2: Crear la Edge Function**

```bash
supabase functions new eliminar-cuenta
```

Esto crea `supabase/functions/eliminar-cuenta/index.ts`.

- [ ] **Paso 3: Escribir la Edge Function**

Reemplazar el contenido de `supabase/functions/eliminar-cuenta/index.ts` con:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verificar el JWT del usuario
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Token inválido' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = user.id;

  // 1. Anonimizar PII en public.users
  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({
      name: 'Usuario Eliminado',
      email: `deleted_${userId}@realmolinos3.anon`,
      phone: null,
      password_hash: null,
      is_deleted: true,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    return new Response(JSON.stringify({ error: 'Error al anonimizar datos: ' + updateError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Eliminar notificaciones del usuario
  await supabaseAdmin.from('notifications').delete().eq('user_id', userId);

  // 3. Registrar en audit_log
  await supabaseAdmin.from('audit_log').insert({
    event_type: 'account_deleted',
    user_id: userId,
    result: { reason: 'user_request', timestamp: new Date().toISOString() },
  });

  // 4. Eliminar de auth.users (irreversible)
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteError) {
    return new Response(JSON.stringify({ error: 'Error al eliminar cuenta de auth: ' + deleteError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Paso 4: Desplegar la Edge Function**

```bash
supabase functions deploy eliminar-cuenta
```

Resultado esperado: `Deployed Function eliminar-cuenta`

- [ ] **Paso 5: Verificar en Supabase Dashboard**

Ir a https://supabase.com/dashboard/project/qxjuztctbpwymmskdyqw/functions y confirmar que aparece `eliminar-cuenta`.

- [ ] **Paso 6: Commitear**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
git add supabase/functions/eliminar-cuenta/index.ts supabase/config.toml
git commit -m "feat: edge function eliminar-cuenta con soft delete y anonimización"
git push
```

---

## Task 7: Edge Function moderar-comprobante

**Files:**
- Crear: `supabase/functions/moderar-comprobante/index.ts`

- [ ] **Paso 1: Obtener API key de Google Cloud Vision**

1. Ir a https://console.cloud.google.com
2. Crear proyecto (o usar uno existente)
3. Habilitar "Cloud Vision API" (buscar en la biblioteca de APIs)
4. Ir a Credentials → Create Credentials → API Key
5. En API Key restrictions: restringir a "Cloud Vision API"
6. Copiar la key

- [ ] **Paso 2: Configurar el secreto en Supabase**

```bash
supabase secrets set CLOUD_VISION_API_KEY=AIzaSy...tuKeyAqui
```

- [ ] **Paso 3: Crear la Edge Function**

```bash
supabase functions new moderar-comprobante
```

- [ ] **Paso 4: Escribir la Edge Function**

Reemplazar el contenido de `supabase/functions/moderar-comprobante/index.ts` con:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FLAGGED_LEVELS = new Set(['LIKELY', 'VERY_LIKELY']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let payload: { record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const record = payload.record;
  if (!record || !record.has_voucher || !record.voucher_url) {
    return new Response('ok', { status: 200 });
  }

  const paymentId = record.id as string;
  const userId = record.resident_id as string | null;
  const voucherUrl = record.voucher_url as string;

  // Descargar imagen del Storage
  const imgResponse = await fetch(voucherUrl);
  if (!imgResponse.ok) {
    return new Response('ok', { status: 200 }); // no bloquear si no se puede descargar
  }
  const imgBuffer = await imgResponse.arrayBuffer();
  const base64 = encodeBase64(new Uint8Array(imgBuffer));

  // Llamar a Cloud Vision Safe Search
  const apiKey = Deno.env.get('CLOUD_VISION_API_KEY')!;
  const visionRes = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: 'SAFE_SEARCH_DETECTION', maxResults: 1 }],
        }],
      }),
    }
  );

  const visionData = await visionRes.json();
  const safe = visionData.responses?.[0]?.safeSearchAnnotation ?? {};

  const isFlagged =
    FLAGGED_LEVELS.has(safe.adult) ||
    FLAGGED_LEVELS.has(safe.violence) ||
    FLAGGED_LEVELS.has(safe.racy);

  // Registrar en audit_log
  await supabaseAdmin.from('audit_log').insert({
    event_type: 'file_moderation',
    user_id: userId,
    file_path: voucherUrl,
    result: { safeSearch: safe, flagged: isFlagged },
  });

  if (isFlagged) {
    // Rechazar el pago automáticamente
    await supabaseAdmin
      .from('payments')
      .update({ status: 'rejected' })
      .eq('id', paymentId);

    // Notificar al residente
    if (userId) {
      await supabaseAdmin.from('notifications').insert({
        user_id: userId,
        message: 'Tu comprobante fue rechazado automáticamente por contener contenido no permitido por nuestras políticas.',
      });
    }
  }

  return new Response('ok', { status: 200 });
});
```

- [ ] **Paso 5: Desplegar la Edge Function**

```bash
supabase functions deploy moderar-comprobante
```

- [ ] **Paso 6: Configurar el Database Webhook en Supabase**

1. Ir a https://supabase.com/dashboard/project/qxjuztctbpwymmskdyqw/database/hooks
2. Click "Create a new hook"
3. Configurar:
   - Name: `moderar_comprobante_on_insert`
   - Table: `payments`
   - Events: `INSERT`
   - Type: `HTTP Request`
   - Method: `POST`
   - URL: `https://qxjuztctbpwymmskdyqw.supabase.co/functions/v1/moderar-comprobante`
   - Headers: `Content-Type: application/json`
4. Guardar

- [ ] **Paso 7: Commitear**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
git add supabase/functions/moderar-comprobante/index.ts
git commit -m "feat: edge function moderar-comprobante con Cloud Vision Safe Search"
git push
```

---

## Task 8: Delete Account UI — Mobile

**Files:**
- Modificar: `mobile/src/services/supabase.js`
- Modificar: `mobile/src/services/auth.js`
- Modificar: `mobile/src/app/(resident)/account.jsx`

- [ ] **Paso 1: Exportar SUPABASE_URL desde supabase.js**

En `mobile/src/services/supabase.js`, cambiar:

```javascript
const SUPABASE_URL = 'https://qxjuztctbpwymmskdyqw.supabase.co';
```

a:

```javascript
export const SUPABASE_URL = 'https://qxjuztctbpwymmskdyqw.supabase.co';
```

- [ ] **Paso 2: Agregar deleteAccount() en auth.js**

En `mobile/src/services/auth.js`, agregar el import al inicio:

```javascript
import { supabase } from './supabase';
import { SUPABASE_URL } from './supabase';
import { validarEmail, validarPassword, validarDepto } from '../utils/validators';
```

Y agregar al final del archivo, después de `logout()`:

```javascript
export async function deleteAccount() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('No hay sesión activa.');

  const response = await fetch(`${SUPABASE_URL}/functions/v1/eliminar-cuenta`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'No se pudo eliminar la cuenta. Intenta más tarde.');
  }

  await supabase.auth.signOut();
}
```

- [ ] **Paso 3: Agregar sección "Eliminar cuenta" en account.jsx**

En `mobile/src/app/(resident)/account.jsx`, reemplazar el bloque de imports completo con:

```javascript
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from "expo-router/react-navigation";

import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { ListRow } from '../../components/ui/ListRow';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { MetricCard } from '../../components/ui/MetricCard';
import { ReceiptSheet } from '../../components/ui/ReceiptSheet';
import { Button } from '../../components/ui/Button';
import { colors } from '../../theme/colors';
import { AppAlert } from '../../utils/alert';
import { getCurrentProfile, deleteAccount } from '../../services/auth';
import { fetchPayments, fetchSettings } from '../../services/data';
import { fmt, fmtDate } from '../../utils/format';
```

Dentro del componente `MyAccountScreen`, agregar después de la declaración de estados existentes:

```javascript
const router = useRouter();
const [deleting, setDeleting] = useState(false);

async function handleDeleteAccount() {
  AppAlert.alert(
    'Eliminar cuenta',
    '¿Estás seguro? Esta acción eliminará permanentemente tu cuenta y todos tus datos personales. Es irreversible.',
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Continuar',
        style: 'destructive',
        onPress: () => {
          AppAlert.alert(
            'Confirmación final',
            'Se eliminarán tus datos y se cerrará tu sesión permanentemente. ¿Confirmas?',
            [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Eliminar permanentemente',
                style: 'destructive',
                onPress: async () => {
                  setDeleting(true);
                  try {
                    await deleteAccount();
                    router.replace('/(auth)/login');
                  } catch (e) {
                    AppAlert.alert('Error', e.message || 'No se pudo eliminar la cuenta.');
                  } finally {
                    setDeleting(false);
                  }
                },
              },
            ]
          );
        },
      },
    ]
  );
}
```

Al final del JSX, antes del cierre de `<ScreenContainer>` y después de `<ReceiptSheet .../>`, agregar:

```jsx
<View style={{ marginTop: 32, marginBottom: 8 }}>
  <SectionHeader title="Zona de peligro" />
  <Card>
    <Button
      title={deleting ? 'Eliminando...' : 'Eliminar mi cuenta'}
      variant="danger"
      loading={deleting}
      onPress={handleDeleteAccount}
      style={{ marginTop: 4 }}
    />
  </Card>
</View>
```

- [ ] **Paso 4: Verificar en el emulador**

Con `npx expo start` y el emulador corriendo:
1. Login como residente
2. Ir a la pestaña "Estado de cuenta"
3. Hacer scroll al fondo — debe aparecer la sección "Zona de peligro" con el botón rojo
4. Presionar el botón → debe aparecer el primer alert de confirmación
5. Cancelar → no debe pasar nada

No completar el flujo de eliminación en pruebas (borraría la cuenta real). Confirmar solo que los alerts aparecen correctamente.

- [ ] **Paso 5: Commitear al repo mobile**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
git add src/services/supabase.js src/services/auth.js src/app/\(resident\)/account.jsx
git commit -m "feat: botón eliminar cuenta con soft delete y anonimización (App Store guideline 5.1.1)"
git push
```

---

## Task 9: Delete Account UI — Web

**Files:**
- Modificar: `js/app.js`
- Modificar: `index.html`

- [ ] **Paso 1: Agregar deleteAccount() en js/app.js**

Buscar en `js/app.js` la función `logout` o `handleLogout`. Agregar después de ella:

```javascript
async function deleteAccountWeb() {
  const confirmed1 = window.confirm(
    '¿Estás seguro?\n\nEsta acción eliminará permanentemente tu cuenta y todos tus datos personales. Es irreversible.'
  );
  if (!confirmed1) return;

  const confirmed2 = window.confirm(
    'Confirmación final: se eliminarán tus datos y se cerrará tu sesión permanentemente.\n\n¿Confirmas la eliminación?'
  );
  if (!confirmed2) return;

  const btn = document.getElementById('btn-delete-account');
  if (btn) { btn.disabled = true; btn.textContent = 'Eliminando...'; }

  try {
    const sessionRaw = localStorage.getItem('rm3_session');
    const session = sessionRaw ? JSON.parse(sessionRaw) : null;
    if (!session?.access_token) throw new Error('No hay sesión activa.');

    const res = await fetch('https://qxjuztctbpwymmskdyqw.supabase.co/functions/v1/eliminar-cuenta', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'No se pudo eliminar la cuenta.');
    }

    await supabase.auth.signOut();
    localStorage.removeItem('rm3_session');
    window.location.reload();
  } catch (e) {
    alert('Error: ' + (e.message || 'No se pudo eliminar la cuenta. Intenta más tarde.'));
    if (btn) { btn.disabled = false; btn.textContent = 'Eliminar mi cuenta'; }
  }
}
```

- [ ] **Paso 2: Agregar sección eliminar cuenta en la vista de residente**

En `js/app.js`, buscar donde se renderiza la vista principal del residente (la función que construye el HTML del dashboard residente). Al final de ese HTML, agregar el botón:

```javascript
// Buscar la función que genera el contenido de la vista residente y agregar al final del innerHTML:
`<div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--gold-light)">
  <p style="font-size:.85rem;color:var(--mist);margin:0 0 .75rem">Zona de peligro</p>
  <button id="btn-delete-account"
    onclick="deleteAccountWeb()"
    style="background:#fff;color:#c0392b;border:1px solid #c0392b;border-radius:8px;
           padding:.6rem 1.2rem;font-size:.9rem;cursor:pointer;font-family:inherit">
    Eliminar mi cuenta
  </button>
</div>`
```

- [ ] **Paso 3: Actualizar el querystring del script en index.html**

En `index.html`, buscar la línea que carga `js/app.js` y actualizar la versión:

```html
<script src="js/app.js?v=20260625"></script>
```

- [ ] **Paso 4: Verificar en el navegador**

1. Abrir la app web en el navegador
2. Login como residente
3. Al fondo de la vista, debe aparecer el botón "Eliminar mi cuenta"
4. Presionar → debe aparecer el primer `confirm` del navegador
5. Cancelar → no debe pasar nada

- [ ] **Paso 5: Commitear al repo web**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
git add js/app.js index.html
git commit -m "feat: botón eliminar cuenta en app web (requerido por Apple App Store)"
git push
```

---

## Task 10: Legal Documents

**Files:**
- Modificar: `privacidad.html`
- Crear: `terminos.html`

- [ ] **Paso 1: Crear terminos.html**

Crear `terminos.html` en la raíz del proyecto web:

```html
<!DOCTYPE html>
<html lang="es-MX">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Términos de servicio — Real Molinos 3</title>
<link rel="icon" href="assets/LogoM3.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap">
<style>
  :root{
    --navy:#001534; --gold:#C89A2B; --gold-light:#E9DFCE;
    --slate:#3F4750; --mist:#ACA79D; --cream:#F6F4F4;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--cream);color:var(--slate);font-family:'Inter',sans-serif;line-height:1.6}
  header{background:var(--navy);color:var(--cream);padding:2.5rem 1.5rem;text-align:center}
  header img{height:64px;margin-bottom:.75rem}
  header h1{font-family:'Fraunces',serif;font-weight:600;margin:.25rem 0 0;font-size:1.6rem;color:var(--gold-light)}
  header p{margin:.25rem 0 0;color:var(--mist);font-size:.85rem;letter-spacing:.05em;text-transform:uppercase}
  main{max-width:760px;margin:0 auto;padding:2.5rem 1.5rem 4rem}
  h2{font-family:'Fraunces',serif;font-weight:600;color:var(--navy);font-size:1.25rem;margin-top:2.25rem;border-bottom:2px solid var(--gold);padding-bottom:.4rem}
  ul{padding-left:1.25rem}
  li{margin-bottom:.4rem}
  .updated{color:var(--mist);font-size:.85rem;margin-top:0}
  .card{background:#fff;border-radius:12px;padding:1.25rem 1.5rem;margin:1rem 0;border:1px solid var(--gold-light)}
  .card.warning{border-left:4px solid var(--gold)}
  a{color:var(--navy);font-weight:600}
  footer{text-align:center;color:var(--mist);font-size:.8rem;padding:2rem 0}
</style>
</head>
<body>
<header>
  <img src="assets/LogoM3.svg" alt="Real Molinos 3">
  <h1>Términos de servicio</h1>
  <p>Real Molinos 3 — Privada</p>
</header>
<main>
  <p class="updated">Última actualización: 25 de junio de 2026</p>

  <p>Al usar la aplicación (web o móvil) de <strong>Real Molinos 3 Privada</strong> aceptas estos términos. Si no los aceptas, no uses la aplicación.</p>

  <h2>1. Uso permitido</h2>
  <p>Esta aplicación es exclusiva para residentes y la administración de Real Molinos 3 Privada. Está diseñada para gestionar pagos de cuotas de mantenimiento del condominio.</p>

  <h2>2. Contenido que puedes subir</h2>
  <p>Solo puedes subir imágenes de comprobantes de pago propios (capturas de pantalla o fotos de transferencias bancarias). Al subir cualquier archivo declaras que:</p>
  <ul>
    <li>El contenido es de tu autoría o tienes derechos para subirlo.</li>
    <li>No contiene material ilícito, ofensivo, ni que infrinja derechos de terceros.</li>
  </ul>
  <p>Nos reservamos el derecho de eliminar cualquier contenido que viole estas condiciones.</p>

  <h2>3. Moderación automática de archivos</h2>
  <p>Los archivos que subes son analizados automáticamente por herramientas de moderación de contenido para detectar material inapropiado. Si un archivo es detectado como inapropiado, será rechazado automáticamente y recibirás una notificación.</p>

  <h2>4. Uso de inteligencia artificial</h2>
  <p>Esta aplicación fue desarrollada con asistencia de herramientas de inteligencia artificial (Claude Code de Anthropic). La app en sí no procesa tus datos con modelos de IA en tiempo real, con excepción de la moderación automática de imágenes subidas (Google Cloud Vision).</p>

  <h2>5. Eliminación de cuenta</h2>
  <p>Puedes solicitar la eliminación de tu cuenta en cualquier momento desde la sección "Eliminar mi cuenta" dentro de la aplicación. Al eliminar tu cuenta:</p>
  <ul>
    <li>Tus datos personales serán anonimizados de forma irreversible.</li>
    <li>Tu historial de pagos se conserva (anonimizado) por necesidades contables del condominio.</li>
    <li>Tu sesión será cerrada inmediatamente.</li>
  </ul>

  <h2>6. Limitación de responsabilidad</h2>
  <p>La administración del condominio no se hace responsable por interrupciones del servicio, pérdida de datos derivada de causas de fuerza mayor, ni por el mal uso de la aplicación por parte de terceros.</p>

  <h2>7. Resolución de disputas y arbitraje vinculante</h2>
  <div class="card warning">
    <p>Cualquier controversia, reclamación o disputa derivada del uso de esta aplicación o relacionada con estos términos se resolverá exclusivamente mediante <strong>arbitraje individual vinculante</strong>, conforme a las reglas de la Cámara de Comercio Internacional (CCI), con sede en la Ciudad de México, y bajo las leyes del Estado de Jalisco, México.</p>
    <p><strong>Las partes renuncian expresamente a iniciar o participar en demandas colectivas (class actions) o litigios ante tribunales ordinarios</strong>, salvo para solicitar medidas cautelares urgentes cuando sea estrictamente necesario.</p>
    <p style="font-size:.85rem;color:var(--mist);margin-bottom:0">Nota: Esta cláusula debe ser revisada por un abogado antes de su aplicación vinculante.</p>
  </div>

  <h2>8. Modificaciones</h2>
  <p>Podemos modificar estos términos en cualquier momento. El uso continuado de la aplicación tras la publicación de cambios implica aceptación de los nuevos términos.</p>

  <h2>9. Contacto</h2>
  <div class="card">
    📧 <a href="mailto:admin@realmolinos3.com">admin@realmolinos3.com</a>
  </div>

  <p style="margin-top:2rem"><a href="privacidad.html">← Ver Política de privacidad</a></p>
</main>
<footer>Real Molinos 3 Privada — Este documento no constituye asesoría legal.</footer>
</body>
</html>
```

- [ ] **Paso 2: Actualizar privacidad.html**

En `privacidad.html`, realizar los siguientes cambios:

**2a.** Actualizar la fecha (línea 50):
```html
<p class="updated">Última actualización: 25 de junio de 2026</p>
```

**2b.** Reemplazar la sección `<h2>4. Con quién compartimos tus datos</h2>` para agregar Cloud Vision:

```html
<h2>4. Con quién compartimos tus datos</h2>
<p>No vendemos ni compartimos tus datos con terceros ajenos a la operación del condominio. Internamente:</p>
<ul>
  <li>Cada residente solo puede ver su propia información y sus propios pagos.</li>
  <li>Solo la administración del condominio tiene acceso a los datos de todos los residentes, necesario para gestionar los cobros.</li>
</ul>
<p>Las imágenes de comprobantes de pago son analizadas automáticamente por <a href="https://cloud.google.com/vision" target="_blank" rel="noopener">Google Cloud Vision</a> para moderación de contenido. Google no almacena estas imágenes ni las usa para entrenar modelos.</p>
<p>Los datos se almacenan en servidores de <a href="https://supabase.com" target="_blank" rel="noopener">Supabase</a>, con cifrado en tránsito y control de acceso por fila a nivel de base de datos.</p>
```

**2c.** Reemplazar la sección `<h2>5. Tiempo de conservación</h2>`:

```html
<h2>5. Tiempo de conservación y eliminación de cuenta</h2>
<p>Conservamos tu información mientras seas residente activo del condominio. Puedes solicitar la eliminación de tu cuenta en cualquier momento desde la sección "Eliminar mi cuenta" en la app. Al hacerlo, tus datos personales serán anonimizados de forma irreversible; tu historial de pagos se conserva (anonimizado) por necesidades contables.</p>
```

**2d.** Agregar nueva sección antes de la sección 6 ("Tus derechos"):

```html
<h2>6. Uso de inteligencia artificial</h2>
<p>Esta aplicación fue desarrollada con asistencia de herramientas de inteligencia artificial (Claude Code de Anthropic). La app no procesa tus datos con IA en tiempo real, con excepción de la moderación automática de imágenes subidas (Google Cloud Vision Safe Search).</p>
```

**2e.** Renumerar secciones existentes (buscar y reemplazar exactamente):
- `<h2>6. Tus derechos (ARCO)</h2>` → `<h2>7. Tus derechos (ARCO)</h2>`
- `<h2>7. Menores de edad</h2>` → `<h2>8. Menores de edad</h2>`
- `<h2>8. Cambios a este aviso</h2>` → `<h2>9. Cambios a este aviso</h2>`
- `<h2>9. Contacto</h2>` → `<h2>10. Contacto</h2>`

**2f.** Agregar link a Términos de servicio al final de `<main>`, antes del cierre:

```html
<p style="margin-top:2rem"><a href="terminos.html">Ver Términos de servicio →</a></p>
```

- [ ] **Paso 3: Verificar en el navegador**

Abrir `privacidad.html` y `terminos.html` en el navegador. Verificar:
- Links entre ambas páginas funcionan
- La cláusula de arbitraje aparece en la card con borde dorado
- La tabla de datos está actualizada
- La fecha dice "25 de junio de 2026"

- [ ] **Paso 4: Commitear**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
git add privacidad.html terminos.html
git commit -m "legal: términos de servicio con arbitraje, disclosure de IA, proceso de eliminación de cuenta"
git push
```

---

## Verificación final

- [ ] App mobile compila y corre en el emulador sin errores de consola
- [ ] Upload de comprobante funciona (imagen válida pasa, tipo inválido muestra error)
- [ ] Botón "Eliminar cuenta" visible en app mobile y web, sin completar el flujo en producción durante pruebas
- [ ] `privacidad.html` y `terminos.html` accesibles desde el navegador
- [ ] Edge Functions visibles en Supabase Dashboard → Edge Functions
- [ ] Database Webhook configurado en Supabase Dashboard → Database → Webhooks
- [ ] Tabla `audit_log` y columnas `is_deleted`/`deleted_at` en `users` presentes en Supabase
- [ ] `grep -r "service_role" mobile/src` → sin resultados
