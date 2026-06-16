# Real Molinos 3 — Privada
## Sistema de Gestión de Condominio

---

## Diagrama del proceso de la aplicación

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
│  ├── Ingresos / Egresos   ← CSV import, registro manual          │
│  ├── Reportes             ← estado de cobros del mes             │
│  └── Editar contactos     ← teléfonos que ven los residentes     │
└──────────────────────────────────────────────────────────────────┘

GESTIÓN DE RESIDENTES:
  Registro pendiente → Admin ve solicitud → Autoriza o Rechaza
  Si autoriza: residente puede entrar y subir comprobantes
  Si rechaza:  residente no puede acceder a la app

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

Tablas:
  users       → id, name, email, password_hash, role, phone, depto, depto_status, fee
  residents   → id, name, email, phone, depto, status, fee, user_id
  payments    → id, resident_id, resident_name, depto, month, amount, status,
                sent_date, approved_date, receipt_num, voucher_url, payment_date
  finances    → id, date, description, category, type, amount, reference, notes
  contacts    → gestionados en DB local (db.js) y editables por admin

Storage buckets:
  comprobantes/ → imágenes de comprobantes subidas por residentes

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
    ├── LogoM3.svg      ← Logo oficial (preferido)
    └── LogoM3.jpg      ← Logo oficial (fallback)
```

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

## SQL para Supabase

Ejecuta el archivo `supabase-migration.sql` en el SQL Editor de Supabase para:
- Agregar columna `voucher_url` a payments
- Verificar los 2 usuarios demo
- Desactivar RLS en todas las tablas
- Crear índices de rendimiento
