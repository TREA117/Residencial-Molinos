# CLAUDE-DESIGN — Agente de Diseño
## Real Molinos 3 · React Native + Expo

> Este agente es el experto en diseño visual, componentes UI y experiencia de usuario.
> Lee este archivo completo antes de tocar cualquier archivo de estilos o componentes visuales.

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

## Identidad del proyecto

**Real Molinos 3 Privada** — App de gestión de condominio residencial.
Usuarios: residentes (inquilinos) y un administrador.
Plataformas de distribución: **Android + Web** (mismo codebase con Expo).
No se publica en App Store. El código sigue siendo compatible con iOS y se
puede probar vía Expo Go durante desarrollo, pero no es un objetivo de
diseño optimizar/pulir específicamente para iOS por ahora.

---

## Paleta de colores oficial — NO modificar sin autorización

```js
// theme/colors.js
export const colors = {
  navy:        '#001534',   // fondo sidebar, headers, botones primarios
  navyDark:    '#000D20',   // pressed state de navy
  navyLight:   '#002456',   // hover state de navy
  gold:        '#C89A2B',   // acentos, CTA, iconos sobre fondo dark
  goldLight:   '#E9DFCE',   // fondos de cards, banners suaves
  goldDark:    '#B8891F',   // pressed state de gold
  slate:       '#3F4750',   // texto secundario
  mist:        '#ACA79D',   // texto terciario, placeholders
  cream:       '#F6F4F4',   // fondo general de la app
  white:       '#FFFFFF',   // superficies de cards

  // Semánticos
  success:     '#1A5C2C',
  successBg:   '#E6F4EA',
  error:       '#8B2020',
  errorBg:     '#FDEAEA',
  warning:     '#7A4B00',
  warningBg:   '#FDF3DC',
  info:        '#0C3068',
  infoBg:      '#E0EAFB',
}
```

---

## Tipografía

```js
// theme/typography.js
// Expo usa System font por defecto — NO importar Google Fonts externamente
export const typography = {
  fontFamily: {
    regular: undefined,      // System font
    medium:  undefined,
    bold:    undefined,
  },
  fontSize: {
    xs:   11,
    sm:   13,
    base: 15,
    lg:   17,
    xl:   20,
    xxl:  26,
    hero: 32,
  },
  lineHeight: {
    tight:  1.2,
    normal: 1.5,
    loose:  1.7,
  }
}
```

---

## Estructura de carpetas (solo diseño)

```
src/
├── theme/
│   ├── colors.js        ← paleta completa
│   ├── typography.js    ← tamaños y pesos
│   ├── spacing.js       ← escala de espaciado (4, 8, 12, 16, 24, 32, 48)
│   └── index.js         ← exporta todo
├── components/
│   ├── ui/
│   │   ├── Button.jsx        ← primary, gold, secondary, danger, ghost
│   │   ├── Card.jsx          ← surface card con borde gold-light
│   │   ├── Badge.jsx         ← pending, approved, rejected, income, expense
│   │   ├── Input.jsx         ← text input con estilo RM3
│   │   ├── Modal.jsx         ← modal con header navy/gold
│   │   ├── Toast.jsx         ← notificación temporal
│   │   ├── Avatar.jsx        ← iniciales del usuario
│   │   ├── Divider.jsx       ← separador con línea gold-light
│   │   ├── EmptyState.jsx    ← cuando no hay datos
│   │   └── Logo.jsx          ← LogoM3 SVG component
│   ├── layout/
│   │   ├── BottomTabBar.jsx  ← navegación principal (reemplaza sidebar)
│   │   ├── Header.jsx        ← header por pantalla con logo esquina
│   │   └── SafeAreaWrapper.jsx
│   └── screens/
│       (componentes específicos de cada pantalla)
└── assets/
    ├── LogoM3.svg
    ├── LogoM3.png        ← fallback para React Native Image
    └── icon.png          ← ícono de la app (1024x1024)
```

---

## Navegación — Bottom Tab Bar (NO sidebar)

En móvil el sidebar es un antipatrón. Usar bottom tabs:

```
┌────────────────────────────────────────┐
│  Header: Logo RM3 esquina + título     │
├────────────────────────────────────────┤
│                                        │
│         Contenido de la pantalla       │
│                                        │
├────────────────────────────────────────┤
│  [Inicio]  [Pagos]  [Cuenta]  [Info]  │  ← Residente
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│  Header: Logo RM3 esquina + título     │
├────────────────────────────────────────┤
│                                        │
│         Contenido de la pantalla       │
│                                        │
├────────────────────────────────────────┤
│ [Panel] [Residentes] [Pagos] [Finanzas]│  ← Admin
└────────────────────────────────────────┘
```

```js
// Colores del Bottom Tab Bar
tabBar: {
  backgroundColor: colors.navy,
  activeTintColor:   colors.gold,
  inactiveTintColor: colors.mist,
  borderTopColor:    colors.goldLight,
  borderTopWidth:    0.5,
}
```

---

## Componentes clave — especificaciones

### Button
```
Primary:   bg=navy,      text=gold,    border=none
Gold:      bg=gold,      text=navy,    border=none
Secondary: bg=white,     text=slate,   border=1px mist
Danger:    bg=errorBg,   text=error,   border=1px error
Ghost:     bg=transparent, text=navy,  border=none
```
- Altura: 48px (mínimo área de toque 44pt en iOS)
- Border radius: 8px
- Font size: 15px, weight 500
- Loading state: ActivityIndicator en color del texto

### Card
```
bg: white
border: 1px goldLight (E9DFCE)
borderRadius: 12px
padding: 16px
shadow: iOS: { shadowColor:#000, shadowOffset:{0,2}, shadowOpacity:0.06, shadowRadius:8 }
        Android: elevation: 2
```
- Header de card: bg=navy, texto=gold, padding 12x16

### Badge
```
pending:  bg=#FDF3DC, text=#7A4B00
approved: bg=#E6F4EA, text=#1A5C2C
rejected: bg=#FDEAEA, text=#8B2020
income:   bg=#E0EAFB, text=#0C3068
expense:  bg=#FDEAEA, text=#8B2020
```
- Padding: 3px 10px, border-radius: 99px, font-size: 12px

### Input
```
bg: white
border: 1px solid mist
borderRadius: 8px
padding: 12px 14px
height: 48px
focus: border=gold
placeholder: color=mist
label: color=slate, font-size=12px, uppercase, letter-spacing=0.5
```

### Modal
```
Header: bg=navy, text=gold, padding=16x20
Body: bg=white, padding=20
Footer: border-top=1px goldLight, padding=14x20
Backdrop: rgba(0,21,52,0.6)
Border radius: 14px (top only en bottom sheet)
```

---

## Safe Areas — crítico para iOS

```js
// SIEMPRE envolver pantallas con SafeAreaView
import { SafeAreaView } from 'react-native-safe-area-context';

// Nunca usar padding hardcoded para status bar
// Nunca usar margin negativo para ocultar el notch
// Bottom tab bar: agregar paddingBottom para home indicator de iPhone
```

---

## Pantalla de Login — especificación visual

```
Fondo: gradiente navy (#001534) → navyLight (#002456) — todo el fondo
Logo: centrado, 120x120, con margen superior generoso
"Real Molinos 3" text: gold, 22px, letra-espaciado 0.08em
"Privada" text: mist, 12px, uppercase
Divisor: línea gold, ancho=60%, centrado
Card de login: white, border-radius=16px, padding=24px
  ↳ flota sobre el fondo navy
  ↳ sombra: elevation=16 / shadowOpacity=0.25
```

---

## Pantalla de Mis Pagos (residente) — especificación visual

```
Banner de período de pago (días 1-10):
  bg: gradiente navy→navyLight horizontal
  borde: 1px gold
  ícono calendario: gold, 24px
  título: gold, 15px, 500
  subtítulo: goldLight, 13px

Depto banner:
  bg: navy
  número de depto: gold, 32px, 700
  estado verificado: goldLight, 12px
  cuota mensual: gold, 22px, 700

CTA subir comprobante:
  borde: 2px dashed gold
  bg: goldLight (E9DFCE)
  ícono upload: gold, 32px
  texto: navy, 16px, 500
```

---

## Header de pantallas internas

```
bg: navy
height: 56px + safe area top
Logo RM3: esquina derecha, 32px height
Título: gold, 17px, 500, centrado
Back button: chevron gold, izquierda
```

---

## Iconografía

Usar `@expo/vector-icons` con la familia `Ionicons`:
```
home-outline         → Inicio / Dashboard
card-outline         → Mis pagos / Comprobantes
document-text-outline→ Estado de cuenta / Reportes
call-outline         → Contactos
people-outline       → Residentes
stats-chart-outline  → Finanzas
folder-outline       → Archivos
settings-outline     → Configuración
checkmark-circle     → Aprobado (verde)
close-circle         → Rechazado (rojo)
time-outline         → Pendiente (amber)
cloud-upload-outline → Subir comprobante
```

---

## Reglas de diseño — NO violar

1. **Nunca usar color fuera de la paleta oficial** sin autorización
2. **Mínimo 44pt de área de toque** en todos los elementos interactivos
3. **Nunca texto blanco sobre gold** — usar navy sobre gold
4. **Nunca gold sobre blanco puro** — el contraste es bajo (usar navy en su lugar)
5. **Safe areas siempre** — nunca `position:absolute` sin considerar notch/home indicator
6. **No sidebar en móvil** — siempre bottom tabs
7. **Logo en header de pantallas internas** — esquina superior derecha
8. **Logo centrado en pantalla de auth** — con espacio generoso arriba
9. **Cards con sombra sutil** — no flat sobre fondo cream
10. **Bottom tab activo** — siempre gold, inactivo siempre mist

---

## Animaciones permitidas

```js
// Solo estas — nada más sin consultar
LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
Animated.timing(opacity, { toValue:1, duration:200, useNativeDriver:true });
Animated.spring(translateY, { toValue:0, useNativeDriver:true });
// Para listas: FlatList con built-in scroll
// Para skeletons: solo opacity pulse, sin librerías externas
```

---

## Plugins recomendados para diseño

| Plugin | Para qué | Instalar |
|---|---|---|
| `react-native-safe-area-context` | Safe areas iOS/Android | Ya incluido en Expo |
| `@expo/vector-icons` | Iconografía Ionicons | Ya incluido en Expo |
| `expo-linear-gradient` | Gradiente en login y banners | `npx expo install expo-linear-gradient` |
| `react-native-reanimated` | Animaciones fluidas 60fps | `npx expo install react-native-reanimated` |
| `react-native-skeleton-placeholder` | Loading states de pantallas | `npm install react-native-skeleton-placeholder` |
| `expo-haptics` | Vibración al aprobar/rechazar | `npx expo install expo-haptics` |
| `react-native-fast-image` | Carga optimizada de comprobantes | `npm install react-native-fast-image` |

---

## Checklist antes de entregar cualquier componente

- [ ] Usa colores de `theme/colors.js`, nunca hardcoded
- [ ] Área de toque ≥ 44px en todos los botones
- [ ] SafeAreaView aplicado correctamente
- [ ] Funciona en Android (sin notch) — prioridad de distribución. iPhone (notch) vía Expo Go es soporte best-effort gracias a SafeAreaView, no bloquea el release
- [ ] Dark mode: NO implementar por ahora — la app es light mode únicamente
- [ ] Loading state contemplado
- [ ] Empty state contemplado
- [ ] Logo RM3 visible en el lugar correcto
- [ ] Sin `console.log` en producción
