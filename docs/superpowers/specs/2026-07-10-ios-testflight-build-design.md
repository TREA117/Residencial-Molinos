# Build y submit de iOS a TestFlight

## Contexto

La app móvil (`mobile/`, Expo SDK 56) ya tiene un flujo de build/submit funcionando para Android:
`eas.json` define un perfil `production` con `autoIncrement: true` y un bloque `submit.production.android`
que usa un service account de Google (`google-service-account.json`, gitignoreado) para subir
automáticamente a la pista `internal` de Play Console. Ese flujo ya se usó con éxito (versionCode 6,
julio 2026).

`eas.json` no tiene ningún bloque `ios` — ni en `build` ni en `submit`. `app.json` sí tiene
`ios.bundleIdentifier: "com.realmolinos3.app"` (cambio ya presente en el working tree, sin commitear),
pero no tiene `ios.buildNumber`.

El usuario ya tiene una cuenta Apple Developer Program activa, pero nada más configurado del lado de
Apple (sin app en App Store Connect, sin certificados, sin API key). Todas las dependencias nativas del
proyecto (`expo-file-system`, `expo-image-picker`, `react-native-webview`, `expo-router`, etc.) son
multiplataforma; el único plugin de config custom (`./plugins/withPhoneOnlyManifest.js`) modifica el
manifest de Android y no afecta a iOS.

## Alcance

**Incluye:**
- A. Bloque `build.production.ios` en `eas.json` (build de distribución `.ipa`, sin config especial de
  `buildType` — a diferencia de Android, iOS no distingue apk/app-bundle).
- B. Bloque `submit.production.ios` en `eas.json`, autenticado vía App Store Connect API Key
  (`.p8`), para permitir `--auto-submit` no interactivo igual que Android.
- C. `ios.buildNumber` inicial en `app.json` (arranca en `"1"`) para que `autoIncrement` tenga de dónde
  partir.
- D. El usuario genera la API Key (.p8 + Key ID + Issuer ID) desde App Store Connect → Users and Access
  → Integrations, rol "App Manager", y la comparte para guardarla localmente en `mobile/` (ya cubierta
  por `*.p8` en `.gitignore`, nunca se commitea).
- E. Ejecutar `eas build --platform ios --profile production --non-interactive --auto-submit`, igual
  patrón que se usó para Android.

**Explícitamente fuera de alcance:**
- No se prepara ficha de App Store (screenshots, descripción, política de privacidad, categorías). El
  usuario confirmó que por ahora solo quiere llegar a TestFlight.
- No se crea el registro de la app en App Store Connect manualmente — se deja que EAS lo registre
  automáticamente en el primer build (comportamiento estándar de `eas build` con credenciales
  gestionadas), dado que la API key tendrá permiso "App Manager".
- No se toca ningún código de la app (no hay cambios de comportamiento nativo pendientes para iOS; los
  cuatro fixes de la ronda anterior — efectivo, recibos, adeudo, multas — ya están en el código
  compartido y no requieren nada iOS-específico).
- No se agrega grupo de testers de TestFlight vía automatización — eso se hace manualmente en App Store
  Connect después del submit, igual que la promoción manual internal→closed testing que se hizo en
  Android.

## Diseño

### `eas.json`

Agregar, dentro de `build.production`:
```json
"ios": {}
```
(vacío es suficiente — EAS usa defaults de distribución `store` para el perfil `production`; no hace
falta `distribution`/`buildConfiguration` explícitos salvo que se necesite algo distinto).

Agregar, dentro de `submit.production`:
```json
"ios": {
  "appleId": "<correo de la cuenta Apple Developer>",
  "ascAppId": null,
  "appStoreConnectApiKeyPath": "./appstore-connect-api-key.p8",
  "appStoreConnectApiKeyIssuerId": "<issuer id>",
  "appStoreConnectApiKeyId": "<key id>"
}
```
`ascAppId` se puede omitir si EAS crea la app automáticamente en el primer submit; si falla por no
encontrar la app, se completa después con el ID numérico que devuelva App Store Connect.

### `app.json`

Agregar `"buildNumber": "1"` dentro de `ios`, junto al `bundleIdentifier` ya presente.

### Archivo de credencial

`mobile/appstore-connect-api-key.p8` — el usuario lo genera y lo comparte; se guarda tal cual, sin
modificar. Ya cubierto por `.gitignore` (`*.p8`).

### Ejecución

Mismo patrón que Android: `eas build --platform ios --profile production --non-interactive --auto-submit`,
corrido en background dado el tiempo histórico de build. Se monitorea el log hasta confirmar
`Build finished` y `Submitted your app to App Store Connect` (o el mensaje equivalente).

### Manejo de errores esperables

- **Bundle ID no registrado en el Apple Developer Portal**: EAS lo registra automáticamente si la API
  key tiene permisos suficientes; si falla, se le pide al usuario que lo registre manualmente en
  developer.apple.com → Certificates, Identifiers & Profiles.
- **App no existe en App Store Connect**: mismo caso — EAS puede crearla si la API key tiene rol "App
  Manager"; si no, se le pide al usuario crearla manualmente (nombre, SKU, bundle ID) antes de reintentar
  el submit.
- **Icono con canal alpha**: `assets/icon.png` es 1024×1024 RGBA. Apple a veces rechaza iconos de App
  Store con canal alpha. Si el build/submit falla por esto, se genera una versión sin alpha y se
  referencia solo para iOS (o se reemplaza el ícono global si el usuario lo prefiere) — no se resuelve
  preventivamente porque no es seguro que cause problema en este flujo de build para TestFlight.

## Testing

- `npx expo export --platform ios` (sin dispositivo/simulador disponible en este entorno) para
  validar que el bundle exporta sin errores antes de lanzar el build real en EAS.
- Verificación manual post-submit: el usuario confirma en App Store Connect → TestFlight que el build
  aparece y agrega el grupo de testers.
