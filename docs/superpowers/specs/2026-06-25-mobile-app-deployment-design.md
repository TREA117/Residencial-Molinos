---
name: mobile-app-deployment
description: Publicar la app móvil de Real Molinos 3 en GitHub, configurar EAS Build y preparar para testeo con emulador Android antes de subir a Play Store
metadata:
  type: project
---

# Diseño: Publicación de App Móvil Real Molinos 3

**Fecha:** 2026-06-25  
**Repo destino:** https://github.com/TREA117/real-molinos-3-app.git  
**Stack:** React Native + Expo 56 + EAS Build  

---

## Contexto

La app móvil vive en `mobile/` dentro del repo web. Tiene su propio git local en rama `master` sin remote. El código está completo (auth, vistas residente y admin, integración Supabase). El `.gitignore` raíz ya excluye `mobile/` del repo web.

El objetivo es:
1. Subir el código a GitHub
2. Vincular con EAS Build
3. Testear en emulador Android antes de publicar en Play Store

---

## Enfoque elegido: EAS Development Build + Emulador

Se descarta Expo Go (no representativo de producción) y build local con Android Studio (complejo en Windows). Se usa EAS para compilar en la nube y testear en emulador local.

---

## Sección 1: Repositorio GitHub

**Archivos afectados:** ninguno (solo operaciones git)

Pasos:
1. `cd mobile/`
2. `git remote add origin https://github.com/TREA117/real-molinos-3-app.git`
3. `git branch -m master main` — renombrar rama a `main`
4. `git push -u origin main`

Lo que **no** se sube (ya en `mobile/.gitignore`):
- `node_modules/`
- `.expo/`
- `google-service-account.json`
- `.env` / `.env*.local`
- `/ios` y `/android` (carpetas nativas generadas)

---

## Sección 2: Variables de entorno y EAS Init

### `.env` (local, nunca commitear)

Crear `mobile/.env`:
```
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key de Supabase>
```

La anon key está en `index.html` del proyecto web dentro de `window.SUPABASE_CONFIG`.  
Expo expone automáticamente variables con prefijo `EXPO_PUBLIC_` a la app.

### EAS Init

```bash
cd mobile/
npx eas-cli login          # autenticarse en expo.dev
npx eas-cli init           # vincula proyecto → agrega projectId a app.json
```

`eas init` modifica `app.json` agregando:
```json
"extra": {
  "eas": { "projectId": "<uuid generado>" }
}
```

Este cambio **sí se sube** al repo (es público e inofensivo).

### Build de desarrollo

```bash
npx eas-cli build --platform android --profile development
```

- Compila en servidores de Expo (~10-20 min primer build)
- Genera APK descargable desde expo.dev
- El APK incluye el cliente de desarrollo (hot reload activo)

---

## Sección 3: Android Studio y flujo de pruebas

### Setup del emulador (una sola vez)

1. Instalar Android Studio: https://developer.android.com/studio
2. Dentro de Android Studio → **Device Manager** → **Create Virtual Device**
3. Configuración recomendada: **Pixel 8, API 35 (Android 15)**
4. Iniciar el AVD
5. Instalar el APK: arrastrar el archivo `.apk` al emulador o:
   ```bash
   adb install <ruta-al-apk>
   ```

### Flujo de pruebas diario

Con el emulador corriendo:
```bash
cd mobile/
npx expo start
# Presionar 'a' para conectar al emulador
```

Metro Bundler conecta al APK de desarrollo con recarga en caliente.

**Casos a probar:**
- Login con admin y residente
- Registro de residente nuevo
- Subir comprobante (imagen)
- Vistas admin: comprobantes, residentes, finanzas, reportes
- Notificaciones de rechazo
- Descarga de recibo

### Flujo hacia Play Store (cuando esté listo)

1. `npx eas-cli build --platform android --profile production` → genera `.aab`
2. Google Play Console → Internal Testing → subir `.aab` manualmente
3. Agregar emails de testers desde la consola
4. Testers instalan desde el link de la consola en cualquier dispositivo Android

Para submit automático (opcional, requiere `google-service-account.json`):
```bash
npx eas-cli submit --platform android --profile production
```

---

## Consideraciones de seguridad

- `EXPO_PUBLIC_SUPABASE_ANON_KEY` es la anon key (pública por diseño en Supabase) — seguro exponer en cliente
- `google-service-account.json` nunca se sube al repo (ya en `.gitignore`)
- RLS activo en Supabase protege los datos — la app no tiene acceso privilegiado

---

## Archivos que se modifican

| Archivo | Cambio |
|---|---|
| `mobile/app.json` | Agrega `extra.eas.projectId` (tras `eas init`) |
| `mobile/.env` | Crear con `EXPO_PUBLIC_SUPABASE_ANON_KEY` (no commitear) |

No se crean archivos nuevos de código. No se modifica la app web.
