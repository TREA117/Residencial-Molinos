# CLAUDE-DEV — Agente de Desarrollo
## Real Molinos 3 · React Native + Expo

> Este agente es el experto en lógica de negocio, base de datos, autenticación,
> Capacitor/Expo, notificaciones y deployment. Lee este archivo completo antes
> de tocar cualquier archivo JS/TS de lógica, servicios o configuración.

---

## Reglas de comportamiento del agente — no violar

1. Think before acting. Read existing files before writing code.
2. Be concise in output but thorough in reasoning.
3. Prefer editing over rewriting whole files.
4. Do not re-read files you have already read unless the file may have changed.
5. Test your code before declaring done.
6. No sycophantic openers or closing fluff.
7. Keep solutions simple and direct.
8. User instructions always override this file.
9. Antes de actuar sobre cualquier petición de trabajo en este proyecto, revisa las skills disponibles (todas las instaladas, p.ej. superpowers) y usa las que apliquen — no te lo saltes aunque la tarea parezca simple o la petición sea solo una pregunta.

---

## Stack tecnológico

| Capa | Tecnología | Justificación |
|---|---|---|
| App framework | **Expo SDK 51+** (React Native) | Permite correr en Android, Web y (solo para pruebas) iOS vía Expo Go |
| Lenguaje | **JavaScript** (no TypeScript por ahora) | Menor curva de aprendizaje, migrar después |
| Backend/DB | **Supabase** | Ya configurado, mismas tablas |
| Auth | **Supabase Auth nativo** | Reemplaza contraseñas en texto plano |
| Storage | **Supabase Storage** | Buckets: comprobantes/, recibos/ |
| Navegación | **Expo Router** (file-based routing) | Más simple que React Navigation |
| Estado global | **Zustand** | Reemplaza el objeto DB global |
| Build Android | **EAS Build** o local | Android Studio en Windows |
| Deploy web | **GitHub Pages / Expo web export** | Mismo codebase, sin tienda |
| Deploy Android | **GitHub Actions + EAS** | Push → build → Google Play |

> **Plataformas objetivo: Android + Web.** No se publicará en App Store (se
> evita el costo anual de Apple Developer Program y la complejidad de build
> en Mac/EAS para iOS). iOS solo se soporta para pruebas vía Expo Go durante
> desarrollo — no es un objetivo de distribución.

---

## Estructura de carpetas (solo dev)

```
src/
├── app/                    ← Expo Router (file-based routing)
│   ├── (auth)/
│   │   ├── login.jsx
│   │   ├── register.jsx
│   │   └── pending.jsx
│   ├── (resident)/
│   │   ├── _layout.jsx     ← Bottom tabs residente
│   │   ├── index.jsx       ← Mis pagos
│   │   ├── account.jsx     ← Estado de cuenta
│   │   └── contacts.jsx    ← Contactos
│   ├── (admin)/
│   │   ├── _layout.jsx     ← Bottom tabs admin
│   │   ├── index.jsx       ← Dashboard
│   │   ├── residents.jsx   ← Gestión de residentes
│   │   ├── payments.jsx    ← Comprobantes
│   │   ├── vouchers.jsx    ← Archivos
│   │   ├── finances.jsx    ← Ingresos/egresos
│   │   └── contacts-edit.jsx
│   └── _layout.jsx         ← Root layout con AuthProvider
├── services/
│   ├── supabase.js         ← Cliente Supabase configurado
│   ├── auth.js             ← Login, registro, sesión
│   ├── payments.js         ← CRUD pagos y comprobantes
│   ├── residents.js        ← CRUD residentes
│   ├── finances.js         ← Ingresos/egresos
│   ├── notifications.js    ← Push notifications
│   ├── storage.js          ← Upload/download Supabase Storage
│   └── receipts.js         ← Generación de recibos
├── store/
│   ├── useAuthStore.js     ← Usuario actual, sesión
│   ├── usePaymentsStore.js ← Pagos del usuario
│   ├── useResidentsStore.js← Lista de residentes (admin)
│   └── useFinancesStore.js ← Ingresos/egresos (admin)
├── hooks/
│   ├── useAuth.js
│   ├── usePayments.js
│   └── useNotifications.js
└── utils/
    ├── format.js           ← fmt() fmtDate() fmtDepto()
    ├── validators.js       ← validarDepto(), validarEmail()
    └── constants.js        ← PAYMENT_DAYS, RECEIPT_FORMATS, etc.
```

---

## Supabase — configuración

### Cliente
```js
// services/supabase.js
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://qxjuztctbpwymmskdyqw.supabase.co';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,          // Persiste sesión en el dispositivo
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,      // Necesario en React Native
  },
});
```

### Variables de entorno
```
# .env.local (NO subir a GitHub)
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Tablas en Supabase (esquema real — no cambiar sin migración)

### users
```sql
id, name, email, password_hash, role (admin|resident),
phone, depto, depto_status (pending|approved|rejected),
fee, created_at
```
> Con Supabase Auth nativo, `password_hash` pasa a ser manejado por `auth.users`.
> La tabla `public.users` se convierte en tabla de perfil extendido.

### payments — tabla unificada
```sql
id, resident_id, resident_name, depto, month, amount,
status (pending|approved|rejected), type (income|expense),
description, category, reference, notes, provider,
sent_date, payment_date, approved_date,
receipt_num, receipt_url, voucher_url, has_voucher, created_at
```
> Esta tabla maneja TANTO pagos de residentes COMO ingresos/egresos del admin.
> Diferenciar con: resident_id IS NOT NULL → pago de residente.
> resident_id IS NULL → transacción directa de admin.

### notifications
```sql
id, user_id, message, is_read (bool), created_at
```

### settings (una sola fila con id=1)
```sql
id=1, default_fee (numeric), contacts (jsonb), created_at
```

### Storage buckets
- `comprobantes/` → imágenes subidas por residentes
- `recibos/` → JPEGs generados al aprobar

---

## Nomenclatura de archivos en Storage

```
Recibo:      YYYY-MM-DEPTO         ej: 2026-06-10H.jpg
Comprobante: YYYY-MM-DEPTO-C       ej: 2026-06-10H-C_1718900000.jpg
Path completo: DEPTO/YYYY-MM-DEPTO.jpg
```

---

## Supabase Auth nativo — implementación

```js
// services/auth.js

// Registro
export async function register({ email, pass, name, phone, depto }) {
  const deptoFmt = depto.toUpperCase().replace(/\s+/g, '');

  const { data, error } = await supabase.auth.signUp({
    email,
    password: pass,
    options: {
      data: { name, phone, depto: deptoFmt, role: 'resident' }
    }
  });
  if (error) throw error;

  // Crear perfil en tabla pública
  await supabase.from('users').insert({
    id: data.user.id,   // mismo UUID que auth.users
    name, email, phone,
    depto: deptoFmt,
    depto_status: 'pending',
    role: 'resident',
    fee: 400,
  });
  return data;
}

// Login
export async function login(email, pass) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) throw error;
  return data;
}

// Logout
export async function logout() {
  await supabase.auth.signOut();
}

// Sesión actual
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Escuchar cambios de sesión
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}
```

---

## Zustand — store de autenticación

```js
// store/useAuthStore.js
import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  user:    null,
  session: null,
  loading: true,

  setUser:    (user)    => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
  clear:      ()        => set({ user: null, session: null }),
}));
```

---

## Flujo de autenticación completo

```
App abre
  ↓
getSession() → ¿hay sesión?
  ↓ SÍ                         ↓ NO
Obtener perfil               → Pantalla Login/Register
  de public.users
  ↓
¿role === 'admin'?
  ↓ SÍ              ↓ NO
Admin tabs       ¿depto_status === 'approved'?
                   ↓ SÍ              ↓ NO
              Resident tabs      Pantalla Pending
```

---

## Upload de comprobantes

```js
// services/storage.js
export async function uploadVoucher(file, userId, depto) {
  const today  = new Date();
  const mm     = String(today.getMonth()+1).padStart(2,'0');
  const yyyy   = today.getFullYear();
  const ext    = file.uri.split('.').pop();
  const path   = `${depto}/${yyyy}-${mm}-${depto}-C_${Date.now()}.${ext}`;

  // file = { uri, type, name } desde expo-image-picker
  const formData = new FormData();
  formData.append('file', { uri: file.uri, type: file.type, name: file.name });

  const { error } = await supabase.storage
    .from('comprobantes')
    .upload(path, formData, { upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from('comprobantes').getPublicUrl(path);
  return data.publicUrl;
}
```

---

## Generación de recibos

En React Native NO hay `html2canvas`. Alternativas:

```js
// Opción A — react-native-view-shot (recomendada)
// Renderiza un componente React Native como imagen
import ViewShot from 'react-native-view-shot';

const receiptRef = useRef();
const capture = async () => {
  const uri = await receiptRef.current.capture();
  // uri = path local a la imagen
  return uri;
};

// Opción B — expo-print (PDF en lugar de imagen)
import * as Print from 'expo-print';
const { uri } = await Print.printToFileAsync({ html: receiptHtml });
```

> Usar Opción A (view-shot) para mantener consistencia con el diseño RM3.
> El recibo se renderiza como componente React Native, se captura como JPEG
> y se sube a Storage bucket `recibos/`.

---

## Notificaciones push

```js
// services/notifications.js
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

export async function registerForPushNotifications() {
  if (!Device.isDevice) return null;   // No funciona en simulador

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return null;

  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
  })).data;

  // Guardar token en Supabase para enviar notificaciones después
  await supabase.from('users')
    .update({ push_token: token })
    .eq('id', currentUserId);

  return token;
}

// Enviar notificación a un residente (desde el admin)
export async function notifyResident(userId, message) {
  const { data } = await supabase
    .from('users').select('push_token').eq('id', userId).single();
  if (!data?.push_token) return;

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to:    data.push_token,
      title: 'Real Molinos 3',
      body:  message,
    }),
  });
}
```

> Agregar columna `push_token TEXT` a la tabla `users` en Supabase.

---

## Validaciones críticas

```js
// utils/validators.js

// Depto: siempre MAYÚSCULAS, sin espacios
export function validarDepto(depto) {
  const d = String(depto).toUpperCase().replace(/\s+/g, '');
  if (!d) throw new Error('El número de departamento es requerido');
  if (d !== d.toUpperCase()) throw new Error('El departamento debe estar en MAYÚSCULAS');
  if (/\s/.test(d)) throw new Error('El departamento no puede contener espacios');
  return d;
}

// Email
export function validarEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email)) throw new Error('Correo electrónico inválido');
  return email.toLowerCase().trim();
}

// Contraseña
export function validarPassword(pass) {
  if (pass.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  return pass;
}
```

---

## Plugins y habilidades — lista completa

### Core (ya en Expo, sin instalar)
| Plugin | Para qué |
|---|---|
| `expo-router` | Navegación file-based |
| `expo-image-picker` | Seleccionar foto comprobante |
| `expo-camera` | Tomar foto del comprobante |
| `expo-notifications` | Push notifications |
| `expo-secure-store` | Guardar tokens de forma segura |
| `expo-file-system` | Manejo de archivos locales |
| `expo-sharing` | Compartir recibo por WhatsApp/correo |
| `@expo/vector-icons` | Iconografía Ionicons |

### Instalar con `npx expo install`
| Plugin | Para qué | Comando |
|---|---|---|
| `expo-linear-gradient` | Gradiente en login | `npx expo install expo-linear-gradient` |
| `expo-haptics` | Vibración al aprobar/rechazar | `npx expo install expo-haptics` |
| `expo-print` | Generar PDFs de recibos | `npx expo install expo-print` |
| `expo-media-library` | Guardar recibo en galería | `npx expo install expo-media-library` |
| `react-native-view-shot` | Capturar recibo como imagen | `npx expo install react-native-view-shot` |

### Instalar con `npm install`
| Plugin | Para qué | Comando |
|---|---|---|
| `@supabase/supabase-js` | Cliente Supabase | `npm install @supabase/supabase-js` |
| `@react-native-async-storage/async-storage` | Sesión persistente | `npx expo install @react-native-async-storage/async-storage` |
| `zustand` | Estado global | `npm install zustand` |
| `react-native-reanimated` | Animaciones 60fps | `npx expo install react-native-reanimated` |

### Habilidades de Claude Code para este proyecto
| Habilidad | Descripción |
|---|---|
| `supabase` | Queries, inserts, updates, RLS, Storage |
| `expo-router` | Layouts, tabs, stacks, deep links |
| `react-native` | Components, StyleSheet, FlatList, Modal |
| `zustand` | Stores, selectors, hydration |
| `eas-build` | Configuración eas.json, profiles, builds |
| `push-notifications` | Expo Push, tokens, envío servidor |
| `image-picker` | Selección, compresión, upload |

---

## EAS Build — solo Android (sin Apple Developer Program)

```json
// eas.json
{
  "cli": { "version": ">= 10.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "android": { "buildType": "app-bundle" }
    }
  },
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "production"
      }
    }
  }
}
```

> Sin bloques `ios` en `build`/`submit` — no se compila para App Store. Para
> probar en iPhone durante desarrollo basta con Expo Go (`npx expo start`,
> escanear el QR), sin necesidad de EAS ni cuenta de Apple Developer.

### Comandos EAS
```bash
# Instalar EAS CLI
npm install -g eas-cli

# Login con tu cuenta Expo
eas login

# Build Android para pruebas (APK)
eas build --platform android --profile preview

# Build Android producción (AAB para Play Store)
eas build --platform android --profile production

# Submit directo a Google Play
eas submit --platform android
```

---

## Ventana de descarga y limpieza automática

```js
// utils/cleanup.js
export function isDownloadWindowOpen() {
  const day = new Date().getDate();
  return day >= 10 && day <= 15;
}

export async function downloadAndCleanup() {
  if (!isDownloadWindowOpen()) {
    throw new Error('La descarga solo está disponible del día 10 al 15 de cada mes');
  }
  // 1. Descargar CSV de pagos aprobados
  // 2. Eliminar comprobantes del mes anterior de Supabase Storage
  // 3. Limpiar receipt_url y voucher_url de la tabla payments
  const prevMonth = getPrevMonthThreshold();
  await supabase.from('payments')
    .update({ receipt_url: null, voucher_url: null })
    .lt('approved_date', prevMonth)
    .eq('status', 'approved');
}

function getPrevMonthThreshold() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().split('T')[0];
}
```

---

## Reglas de desarrollo — NO violar

1. **`npx expo install`** para plugins de Expo — nunca `npm install` a secas para paquetes nativos
2. **Variables de entorno** con prefijo `EXPO_PUBLIC_` para el cliente, sin prefijo para el servidor
3. **Nunca subir `.env.local`** a GitHub — está en `.gitignore`
4. **Supabase anon key** solo en variables de entorno, nunca hardcodeada en el código
5. **Validar depto** siempre antes de guardar — mayúsculas, sin espacios
6. **Tabla `payments` unifica todo** — no crear tabla `finances` separada
7. **`AsyncStorage`** para sesión de Supabase, **`SecureStore`** para datos sensibles
8. **Push tokens** siempre en `users.push_token` — actualizar al iniciar sesión
9. **`eas build --platform android`** para compilar — no se compila ni se publica para iOS
10. **Probar en dispositivo físico** con Expo Go antes de hacer build (Android y, si quieres, iPhone — Expo Go no requiere cuenta de Apple Developer)

---

## Checklist antes de hacer build de producción

- [ ] `.env.local` tiene todas las variables definidas y NO está en GitHub
- [ ] `eas.json` configurado con todos los profiles
- [ ] Supabase Auth nativo activado (no contraseñas en texto plano)
- [ ] Push notifications registradas y push_token en tabla users
- [ ] Buckets `comprobantes` y `recibos` en Supabase Storage (Public)
- [ ] Columna `push_token TEXT` en tabla `users`
- [ ] SQL de migración ejecutado en Supabase (ver supabase-migration.sql)
- [ ] `app.json` con bundle identifier correcto (com.realmolinos3.app)
- [ ] Ícono 1024x1024 en `assets/icon.png`
- [ ] Splash screen configurado
- [ ] Sin `console.log` en código de producción
- [ ] Probado en Android físico (iOS vía Expo Go es opcional, no bloquea el release)

---

## GitHub Actions — CI/CD (opcional, para después)

```yaml
# .github/workflows/build.yml
name: EAS Build
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g eas-cli
      - run: npm install
      - run: eas build --platform android --profile production --non-interactive
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
          EXPO_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

---

## Costos de publicación (referencia)

| Servicio | Costo | Notas |
|---|---|---|
| Google Play Console | $25 USD | Pago único para siempre |
| Expo EAS Build (plan Free) | $0 | 30 builds/mes, suficiente para empezar |
| Expo EAS Build (plan Production) | $29 USD/mes | Si necesitas más builds |
| Supabase (Free tier) | $0 | Hasta 500MB DB y 1GB Storage |
| GitHub Pages (web) | $0 | Hosting de la versión web |

> No se incluye Apple Developer Program ($99 USD/año) — no se publicará en
> App Store. Si más adelante cambias de opinión, esa es la única cuenta de
> pago que faltaría agregar; el código en Expo ya es compatible con iOS.
