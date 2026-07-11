# iOS TestFlight Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el repo `mobile/` listo para correr `eas build --platform ios --profile production --non-interactive --auto-submit` y que el build llegue automáticamente a TestFlight, replicando el flujo ya usado en Android.

**Architecture:** Cambios puramente de configuración en `mobile/eas.json` y `mobile/app.json` (sin tocar código de la app — todas las dependencias ya son multiplataforma), más una credencial local (App Store Connect API Key `.p8`) que el usuario genera y provee.

**Tech Stack:** Expo SDK 56, EAS Build/Submit CLI, App Store Connect API Key auth.

## Global Constraints

- No se toca ningún archivo de código de la app (`src/**`) — el spec confirma que no hay comportamiento iOS-específico pendiente.
- El archivo `.p8` de la API Key NUNCA se commitea (ya cubierto por `*.p8` en `.gitignore:9`).
- `ios.bundleIdentifier` ya es `com.realmolinos3.app` (no cambiar).
- Alcance limitado a TestFlight — no se toca ficha de App Store Connect (screenshots, descripción, etc.).
- Mismo patrón no-interactivo que Android: `--non-interactive --auto-submit`, corrido con `run_in_background: true` dado el tiempo histórico de build.

---

### Task 1: Config base de iOS en eas.json y app.json (sin credenciales)

**Files:**
- Modify: `mobile/eas.json`
- Modify: `mobile/app.json`

**Interfaces:**
- Produces: perfil `build.production.ios` en `eas.json` (consumido por Task 4 al correr `eas build --platform ios`).
- Produces: `app.json` → `expo.ios.buildNumber` (consumido por `autoIncrement` en Task 4).

- [ ] **Step 1: Agregar bloque `ios` al perfil `production` de `build` en `eas.json`**

En `mobile/eas.json`, dentro de `"build": { "production": { ... } }`, junto a `"android": { "buildType": "app-bundle" }`, agregar:

```json
      "ios": {},
```

Quedando (sección `production` completa):
```json
    "production": {
      "android": { "buildType": "app-bundle" },
      "ios": {},
      "autoIncrement": true,
      "env": {
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4anV6dGN0YnB3eW1tc2tkeXF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNjg5NjAsImV4cCI6MjA5Njg0NDk2MH0.PZFOWDjcpeohOm9yXldpH3QzaQs2g0rIqx07_UHcwhs"
      }
    }
```

- [ ] **Step 2: Agregar `buildNumber` a `ios` en `app.json`**

En `mobile/app.json`, dentro de `"ios": { "supportsTablet": true, "bundleIdentifier": "com.realmolinos3.app" }`, agregar `buildNumber`:

```json
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.realmolinos3.app",
      "buildNumber": "1"
    },
```

- [ ] **Step 3: Validar JSON válido**

Run (desde `mobile/`):
```bash
node -e "JSON.parse(require('fs').readFileSync('eas.json','utf8')); JSON.parse(require('fs').readFileSync('app.json','utf8')); console.log('OK')"
```
Expected: `OK` (si hay error de sintaxis, el `JSON.parse` lanza y lo muestra).

- [ ] **Step 4: Commit**

```bash
cd mobile
git add eas.json app.json
git commit -m "feat(ios): agregar perfil de build production para iOS"
```

Nota: `app.json` también trae el `bundleIdentifier` y el `versionCode: 6` de Android ya pendientes de commits anteriores (ver `git status` antes de este `git add` — son cambios legítimos del usuario, no descartar).

---

### Task 2: Credencial de App Store Connect y bloque submit.production.ios

**Files:**
- Create: `mobile/appstore-connect-api-key.p8` (provisto por el usuario, nunca commiteado — ya cubierto por `.gitignore`)
- Modify: `mobile/eas.json`

**Interfaces:**
- Consumes: ninguno de Task 1 salvo la estructura ya presente en `eas.json`.
- Produces: perfil `submit.production.ios` (consumido por `--auto-submit` en Task 4).

- [ ] **Step 1: Pedir al usuario los 4 datos necesarios**

En App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API**, generar una key nueva con rol **App Manager**. Apple entrega, una sola vez:
- El archivo `.p8` (descarga única — si se pierde hay que generar otra key).
- El **Key ID** (ej. `ABC123DEFG`).
- El **Issuer ID** (UUID, visible arriba de la tabla de keys).

Además se necesita el **Apple ID** (correo) de la cuenta developer.

Pedir estos 4 datos al usuario si no los ha compartido ya en el chat.

- [ ] **Step 2: Guardar el archivo `.p8`**

Guardar el contenido que el usuario comparta en `mobile/appstore-connect-api-key.p8` tal cual (sin modificar formato PEM). Confirmar que **no** aparece en `git status` como trackeable (debe caer bajo el patrón `*.p8` de `.gitignore`):

Run (desde `mobile/`):
```bash
git check-ignore -v appstore-connect-api-key.p8
```
Expected: imprime la regla de `.gitignore` que lo cubre (confirma que está ignorado).

- [ ] **Step 3: Agregar bloque `submit.production.ios` a `eas.json`**

Reemplazar los placeholders `<...>` con los valores reales del usuario:

```json
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "internal"
      },
      "ios": {
        "appleId": "<correo Apple ID del usuario>",
        "ascAppId": null,
        "appStoreConnectApiKeyPath": "./appstore-connect-api-key.p8",
        "appStoreConnectApiKeyIssuerId": "<issuer id>",
        "appStoreConnectApiKeyId": "<key id>"
      }
    }
  }
```

- [ ] **Step 4: Validar JSON válido**

Run (desde `mobile/`):
```bash
node -e "JSON.parse(require('fs').readFileSync('eas.json','utf8')); console.log('OK')"
```
Expected: `OK`.

- [ ] **Step 5: Commit (solo eas.json — el .p8 nunca se commitea)**

```bash
cd mobile
git add eas.json
git commit -m "feat(ios): configurar submit automático a TestFlight vía App Store Connect API Key"
```

Run: `git status` — confirmar que `appstore-connect-api-key.p8` sigue apareciendo como ignorado/no trackeado, no como staged.

---

### Task 3: Validar export de iOS antes del build real

**Files:**
- Ninguno (solo validación, no hay cambios de código en este task).

**Interfaces:**
- Consumes: nada nuevo — valida que el bundle JS exporta sin errores antes de gastar tiempo de build en EAS.

- [ ] **Step 1: Correr export de iOS**

Run (desde `mobile/`):
```bash
npx expo export --platform ios
```
Expected: termina con `Exported: dist` (o ruta equivalente) sin errores de resolución de módulos. Si falla por un módulo nativo faltante (como pasó con `@expo/metro-runtime` en Android), instalar con `npx expo install <paquete>` y volver a correr.

- [ ] **Step 2: Limpiar el output de export (no se commitea)**

Run (desde `mobile/`):
```bash
rm -rf dist
```
(`dist/` ya está en `.gitignore:6`, este paso es solo limpieza local.)

---

### Task 4: Build de producción iOS + auto-submit a App Store Connect

**Files:**
- Ninguno directamente — este task ejecuta EAS CLI, que puede modificar `app.json` (`ios.buildNumber` autoincrementado) como efecto secundario, igual que pasó con `versionCode` en Android.

**Interfaces:**
- Consumes: `build.production.ios` y `submit.production.ios` de `eas.json` (Tasks 1 y 2).

- [ ] **Step 1: Confirmar sesión de EAS activa**

Run:
```bash
cd mobile
npx eas-cli whoami
```
Expected: imprime el usuario/cuenta `trea117` (misma cuenta usada para el build de Android). Si no hay sesión, correr `npx eas-cli login` (interactivo, requiere que el usuario lo haga).

- [ ] **Step 2: Lanzar el build con auto-submit, en background**

Run (`run_in_background: true`, dado el tiempo histórico de build de +1h):
```bash
cd mobile
npx eas-cli build --platform ios --profile production --non-interactive --auto-submit
```

- [ ] **Step 3: Chequeo temprano (a los ~20-30s)**

Revisar el output inicial del comando en background para confirmar que no falló de inmediato (ej. error de credenciales, bundle ID no registrable, key inválida). Si fallo inmediato: leer el mensaje de error, corregir (puede requerir que el usuario registre el bundle ID manualmente en developer.apple.com, o cree la app en App Store Connect si la API key no tiene permiso de autocreación), y relanzar desde Step 2.

- [ ] **Step 4: Esperar notificación de finalización**

No hacer polling — esperar la notificación automática de tarea en background (igual que se hizo con el build de Android). Cuando complete, leer el log completo:
```bash
cd mobile
npx eas-cli build:list --platform ios --limit 1
```
Expected: status `finished`, con link al `.ipa` y confirmación `Submitted your app to App Store Connect` (o mensaje equivalente de submit).

- [ ] **Step 5: Confirmar buildNumber actualizado**

Run:
```bash
cd mobile
git diff app.json
```
Expected: `ios.buildNumber` incrementado (de `"1"` a `"2"` si es un segundo intento, o se mantiene en `"1"` si fue el primero exitoso). No commitear este cambio automáticamente — reportarlo al usuario igual que se hizo con `versionCode` en Android, para que decida cuándo commitearlo.

---

### Task 5: Reportar resultado y siguiente paso manual en TestFlight

**Files:**
- Ninguno.

- [ ] **Step 1: Resumir al usuario**

Confirmar por chat:
- Link al `.ipa` generado (de la salida de EAS).
- Link a la página de build en expo.dev.
- Confirmación de que el submit a App Store Connect se completó.
- Recordatorio: el usuario debe entrar a App Store Connect → TestFlight, esperar a que Apple termine de procesar el build (puede tardar de minutos a ~1h por el escaneo automático de Apple), y agregar el grupo de testers internos para que puedan instalarlo.

- [ ] **Step 2: Confirmar estado de git en `mobile/`**

Run:
```bash
cd mobile
git status
```
Mostrar al usuario qué queda sin commitear (ej. `app.json` con el `buildNumber` nuevo) para que decida si lo commitea ahora o lo deja para el próximo build, igual que con Android.

---

## Self-Review Notes

- **Cobertura del spec:** A (build.production.ios) → Task 1. B (submit.production.ios) → Task 2. C (ios.buildNumber) → Task 1. D (API Key del usuario) → Task 2. E (ejecución build+submit) → Task 4. Manejo de errores esperables (bundle ID / app no registrada / icono alpha) → Task 4 Step 3 cubre los dos primeros; el de ícono alpha no se aborda preventivamente por diseño (spec: "no se resuelve preventivamente"), se deja como troubleshooting si el submit lo rechaza — no requiere task propio.
- **Placeholders:** los únicos `<...>` en el plan son valores reales que debe proveer el usuario (Apple ID, Key ID, Issuer ID) — no son placeholders de plan sin resolver, son inputs externos documentados explícitamente en Task 2 Step 1.
- **Consistencia de nombres:** `appstore-connect-api-key.p8` se usa igual en Task 2 Steps 2/3 y Task 4. `submit.production.ios` y `build.production.ios` coinciden con la estructura real de `eas.json` ya leída del repo.
