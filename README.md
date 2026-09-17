# Real Molinos 3 — Privada
## Sistema de Gestión de Condominio

Dos apps sobre la misma base de Supabase:
- **Web** (raíz de este repo) — HTML/CSS/JS vanilla, sin build, se sirve directo desde GitHub Pages.
- **Mobile** (`mobile/`) — Expo/React Native, repo git propio, documentación propia
  (`mobile/AGENTS.md`, `mobile/CLAUDE-DEV.md`, `mobile/CLAUDE-DESIGN.md`).

## Estado actual (2026-07-23)

| | Estado |
|---|---|
| **Web** | Live en producción — https://trea117.github.io/Residencial-Molinos |
| **Mobile / Android** | Publicada en Google Play |
| **Mobile / iOS** | `1.0.0` build `8` — en revisión de App Store Connect / TestFlight, con testers activos |
| **Supabase** | Proyecto `Molinos` (`qxjuztctbpwymmskdyqw`), RLS activo, ~30 residentes reales aprobados |

Para agentes/desarrolladores: las reglas de comportamiento y el detalle técnico de cada app viven en
su propio `CLAUDE.md` (web: este directorio; mobile: `mobile/`) — este README es solo el mapa
general. El historial de features ya implementadas está en [`docs/README.md`](docs/README.md), no
hace falta leerlo para trabajar en el estado actual del proyecto.

---

## Diagrama del proceso de la aplicación (web — el flujo de mobile es equivalente)

```
╔══════════════════════════════════════════════════════════════════════╗
║                     FLUJO GENERAL DE LA APP                         ║
╚══════════════════════════════════════════════════════════════════════╝

┌─────────────┐
│   USUARIO   │
│  (Cliente)  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       PANTALLA DE INICIO                            │
│                                                                     │
│   ┌──────────────┐          ┌─────────────────────────────────┐    │
│   │ ¿Tiene       │ SÍ       │  INICIAR SESIÓN                 │    │
│   │ cuenta?      ├─────────►│  Correo + Contraseña / OTP      │    │
│   └──────┬───────┘          └──────────────┬──────────────────┘    │
│          │ NO                               │                       │
│          ▼                                  ▼                       │
│   ┌──────────────────────┐      ┌──────────────────────────┐       │
│   │  REGISTRO            │      │ ¿Está autorizado?        │       │
│   │  • Nombre completo   │      └───────────┬──────────────┘       │
│   │  • Correo            │                  │                       │
│   │  • Celular           │       NO ◄───────┤ SÍ                   │
│   │  • Nº Depto (10H)    │       │          │                       │
│   │  • Contraseña        │       │          ▼                       │
│   └──────────┬───────────┘       │   ┌──────────────┐              │
│              │                   │   │  ACCESO A    │              │
│              ▼                   │   │  LA APP      │              │
│   ┌──────────────────────┐       │   └──────────────┘              │
│   │ Notificación         │       │                                  │
│   │ automática a ADMIN   │       ▼                                  │
│   │ (pendiente de        │  ┌─────────────────────────────────┐    │
│   │  autorización)       │  │  Pantalla: Acceso pendiente     │    │
│   └──────────────────────┘  │  "Administración te notificará" │    │
└─────────────────────────────┴─────────────────────────────────────-┘

═══════════════════════════════════════════════════════════════════════
                    VISTA DEL RESIDENTE AUTORIZADO
═══════════════════════════════════════════════════════════════════════

┌──────────────────────────────────────────────────────────────────┐
│  SIDEBAR RESIDENTE                                               │
│  ├── Mis pagos            ← pantalla principal                   │
│  ├── Estado de cuenta     ← historial + multas + convenios       │
│  └── Contactos            ← admin, caseta, emergencias           │
└──────────────────────────────────────────────────────────────────┘

FLUJO DE PAGO (días 1–10 del mes: banner de recordatorio activo):

  Residente                           Administración
     │                                      │
     │  1. Toca "Subir comprobante"         │
     │  2. Selecciona mes + monto           │
     │  3. Ingresa fecha de pago            │
     │  4. Adjunta imagen/PDF               │
     │  5. Envía ───────────────────────────►│
     │                                      │ 6. Recibe notificación
     │                                      │ 7. Ve imagen del comprobante
     │                                      │ 8. Verifica el pago
     │                                      │
     │  ◄─── APROBADO ─────────────────────┤
     │                                      │ 9. Genera recibo automático
     │  10. Recibe recibo (PDF)             │    Nombre: YYYY-MM-DEPTO
     │      en pantalla + descarga          │    Comprobante: YYYY-MM-DEPTO-C
     │                                      │ 10. Recibo guardado en Supabase
     │                                      │ 11. Se registra como ingreso
     │                                      │     en módulo de finanzas

═══════════════════════════════════════════════════════════════════════
                     VISTA DEL ADMINISTRADOR
═══════════════════════════════════════════════════════════════════════

┌──────────────────────────────────────────────────────────────────┐
│  SIDEBAR ADMINISTRADOR                                           │
│  ├── Dashboard            ← métricas + gráficas + actividad      │
│  ├── Residentes           ← autorizar/rechazar/editar/eliminar   │
│  ├── Comprobantes         ← revisar y aprobar pagos              │
│  ├── Archivos             ← carpetas por departamento            │
│  ├── Multas / Adeudos     ← cargos puntuales por residente       │
│  ├── Ingresos / Egresos   ← CSV import, registro manual          │
│  ├── Reportes             ← estado de cobros del mes             │
│  └── Editar contactos     ← teléfonos que ven los residentes     │
└──────────────────────────────────────────────────────────────────┘

GESTIÓN DE RESIDENTES:
  Registro pendiente → Admin ve solicitud → Autoriza o Rechaza
  Si autoriza: residente puede entrar y subir comprobantes
  Si rechaza:  residente no puede acceder a la app

CARGOS PUNTUALES (Multas / Adeudos / Cuotas extraordinarias):
  El admin crea el cargo desde "Multas / Adeudos" → elige tipo (Multa, Adeudo o
  Cuota extraordinaria), residente, monto y descripción. El residente ve el cargo
  pendiente en su "Estado de cuenta" y lo salda subiendo comprobante (o el admin lo
  registra como pago en efectivo, vinculándolo al cargo). A diferencia de la cuota
  de mantenimiento mensual, estos cargos no se generan automáticamente y no se
  mezclan con la lista de cuotas regulares del residente hasta ser saldados.
  "Cuota extraordinaria" usa el mismo mecanismo que Multa/Adeudo — pensado para
  derramas o gastos extraordinarios del condominio (ej. mantenimiento mayor,
  reparaciones no presupuestadas) que se cobran a un residente en particular.
  A diferencia de Multa/Adeudo, una cuota extraordinaria NO se vincula a un
  "cargo pendiente a saldar" ni pide mes de pago en el formulario (ni al
  registrarla el admin en efectivo, ni al subir el residente su comprobante)
  — solo se registra con la fecha de pago. Su recibo tampoco muestra la fila
  "Período".

ARCHIVOS Y LIMPIEZA AUTOMÁTICA:
  ┌────────────────────────────────────────────────────────────┐
  │  Nomenclatura de archivos:                                 │
  │  Recibo:      YYYY-MM-DEPTO        (ej: 2026-06-10H)      │
  │  Comprobante: YYYY-MM-DEPTO-C      (ej: 2026-06-10H-C)    │
  │                                                            │
  │  Ventana de descarga: días 10 al 15 de cada mes           │
  │  Al descargar: archivos del mes anterior son eliminados    │
  │  automáticamente de Supabase Storage                       │
  │  Si no se descarga: eliminación automática el día 15       │
  └────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════
                         BASE DE DATOS (SUPABASE)
═══════════════════════════════════════════════════════════════════════

Tablas (ver detalle completo en CLAUDE.md):
  users         → id, name, email, password_hash, role, phone, depto, depto_status, fee
  payments      → unifica pagos de residentes E ingresos/egresos de admin — id, resident_id,
                  resident_name, depto, month, amount, status, type (income|expense), description,
                  category, reference, notes, sent_date, payment_date, approved_date, receipt_num,
                  receipt_url, voucher_url
  notifications → id, user_id, message, is_read, created_at
  settings      → fila única (id=1): default_fee, contacts (jsonb)

No existen tablas `residents` ni `finances` separadas — todo pago/transacción vive en `payments`
con el campo `type`, y los contactos viven en `settings.contacts` (no en db.js local).

Storage buckets:
  comprobantes/ → imágenes de comprobantes subidas por residentes
  recibos/      → recibos JPEG generados por admin al aprobar un pago

---

## Estructura del proyecto

```
real-molinos-3/
├── index.html          ← App completa (HTML + estructura)
├── css/
│   └── styles.css      ← Paleta oficial RM3 + estilos
├── js/
│   ├── supabase.js     ← Cliente y helpers de Supabase
│   ├── db.js           ← Base de datos local + contactos
│   ├── data.js         ← Sincronización con Supabase
│   ├── auth.js         ← Login, registro, sesión
│   ├── app.js          ← Vistas del residente
│   └── admin.js        ← Vistas del administrador
└── assets/
    ├── LogoM3.svg               ← Logo oficial (preferido)
    ├── LogoM3.jpg               ← Logo oficial (fallback)
    └── firma-administracion.png ← Firma real usada en recibos generados
```

`mobile/` no comparte código con lo de arriba — ver su propia estructura en `mobile/CLAUDE-DEV.md`.

---

## Cómo abrir

1. Abre la carpeta en VS Code
2. Clic derecho en `index.html` → Open with Live Server
3. O abre `index.html` directamente en el navegador

---

## Paleta de colores oficial

| Color   | Hex       | Uso                          |
|---------|-----------|------------------------------|
| Navy    | `#001534` | Sidebar, headers, botones    |
| Gold    | `#C89A2B` | Acentos, CTA, títulos        |
| Cream   | `#E9DFCE` | Fondos de cards y banners    |
| Slate   | `#3F4750` | Texto secundario             |
| Mist    | `#ACA79D` | Texto terciario, placeholders|
| White   | `#F6F4F4` | Fondo general                |

---

## Supabase

No hay archivo de migración `.sql` en el repo — el schema ya vive en Supabase (proyecto `Molinos`,
ref `qxjuztctbpwymmskdyqw`) y se administra vía SQL Editor del dashboard o el MCP de Supabase.

**RLS está ACTIVO** en `users`/`payments`/`notifications`/`settings` y `storage.objects`, con
políticas reales por rol (un residente solo ve su propia fila/pagos; solo `role='admin'` tiene
acceso completo vía `is_admin()`). No desactivar RLS.

Cuentas demo para probar la app (ver CLAUDE.md para credenciales vigentes):
- `admin@molino.com` → rol admin
- `residente.demo@molino.com` → rol resident, depto REV1
