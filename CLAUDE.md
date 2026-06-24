# Real Molinos 3 — Privada
## Agente de desarrollo — lee esto antes de cualquier cambio

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

## ¿Qué es este proyecto?
App web de gestión de condominio residencial para **Real Molinos 3 Privada**.
Stack: HTML + CSS + JavaScript vanilla + Supabase (REST + Storage).
**Sin frameworks. Sin npm. Sin build process.**
Se sirve directamente desde GitHub Pages — un solo `git push` actualiza la app en vivo.

---

## Estructura de archivos

```
Residencial-Molinos-main/
├── index.html              ← TODA la estructura HTML + modales + config Supabase
├── css/styles.css          ← Paleta navy/gold — NO modificar variables de color sin autorización
├── js/
│   ├── supabase.js         ← Cliente Supabase (REST + supabase-js). NO tocar salvo bugs.
│   ├── db.js               ← DB local en memoria + objeto contacts + settings.defaultFee
│   ├── data.js             ← loadDB(), normalizeUser/Payment(), syncResidentsFromUsers(), toDbPayment(), toDbTransaction()
│   ├── auth.js             ← login, registro, sesión persistente (localStorage), timeout inactividad 10min
│   ├── app.js              ← Vistas residente: mis pagos, estado cuenta, subir comprobante, recibo, contactos
│   └── admin.js            ← Vistas admin: dashboard, residentes, comprobantes, archivos, finanzas, reportes, contactos editor
├── assets/
│   ├── LogoM3.svg          ← Logo oficial (preferir siempre SVG)
│   └── LogoM3.jpg          ← Fallback
└── CLAUDE.md               ← Este archivo
```

---

## Supabase
- **URL base**: `https://qxjuztctbpwymmskdyqw.supabase.co/rest/v1/`
- **Anon key**: está en `index.html` en `window.SUPABASE_CONFIG`
- **RLS**: activado en `users`/`payments`/`notifications`/`settings` y en `storage.objects`, con políticas reales por rol (ver `supabase-migration-auth-native.sql`, sección "FASE 2 — Endurecimiento de RLS"). Un residente solo lee/escribe su propia fila/pagos; solo `role='admin'` (función `is_admin()`) tiene acceso completo. Al agregar cualquier query nueva, verificar que respete esta separación — no asumir acceso libre a otras tablas/filas.

### Tablas en Supabase (esquema real)

**users**
```
id, name, email, password_hash, role (admin|resident),
phone, depto, depto_status (pending|approved|rejected), fee, created_at
```

**payments** — unifica pagos de residentes E ingresos/egresos de admin
```
id, resident_id, resident_name, depto, month, amount,
status (pending|approved|rejected),
type (income|expense),
description, category, reference, notes, provider,
sent_date, payment_date, approved_date,
receipt_num, receipt_url, voucher_url,
has_voucher, created_at
```

**notifications**
```
id, user_id, message, is_read (bool), created_at
```

**settings** (una sola fila con id=1)
```
id, default_fee (numeric), contacts (jsonb), created_at
```

### Storage buckets
- `comprobantes/` → imágenes subidas por residentes. Path: `DEPTO/YYYY-MM-DEPTO-C_timestamp.ext`
- `recibos/` → recibos generados como JPEG por admin. Path: `DEPTO/YYYY-MM-DEPTO.jpg`

---

## Nomenclatura de archivos
- Recibo:      `YYYY-MM-DEPTO`       ej: `2026-06-10H`
- Comprobante: `YYYY-MM-DEPTO-C`     ej: `2026-06-10H-C`
- Depto siempre en **MAYÚSCULAS SIN ESPACIOS** ej: `10H`, `3B`, `201`

---

## Paleta de colores — NO cambiar sin autorización
```css
--navy:       #001534   /* sidebar, headers, botones primarios */
--gold:       #C89A2B   /* acentos, CTA, títulos sobre fondo dark */
--gold-light: #E9DFCE   /* fondos de cards y banners */
--slate:      #3F4750   /* texto secundario */
--mist:       #ACA79D   /* texto terciario */
--cream:      #F6F4F4   /* fondo general */
```

---

## Reglas críticas al modificar código

1. **NO agregar frameworks** (React, Vue, jQuery, etc.)
2. **NO agregar npm/package.json** — el proyecto no tiene build process
3. **Nombres de columna**: JS usa camelCase, Supabase usa snake_case → siempre normalizar en `data.js`
4. **La tabla `payments` unifica TODO** — pagos de residentes + transacciones de admin. El campo `type` distingue `income`/`expense`
5. **No crear tabla `finances` separada** — las transacciones de admin van en `payments` con `type=expense|income` y sin `resident_id`
6. **Session**: se guarda en `localStorage` con key `rm3_session`. Timeout de inactividad: 10 minutos
7. **Recibos**: se generan como imagen JPEG con `html2canvas` y se suben al bucket `recibos/`. NO usar PDF.
8. **Versión de scripts**: al modificar cualquier JS actualizar el querystring `?v=YYYYMMDD` en `index.html`

---

## Flujo del negocio

### Residente
1. Se registra → va a Supabase `users` con `depto_status=pending`
2. Admin ve la solicitud y autoriza → `depto_status=approved`
3. Residente autorizado entra → puede subir comprobante (imagen) con monto y fecha
4. Comprobante sube a Storage `comprobantes/` y se inserta en `payments` con `status=pending`
5. Admin revisa imagen → aprueba → `status=approved`, se genera recibo JPEG → Storage `recibos/`
6. Residente ve su historial y puede descargar recibo

### Admin
- Dashboard: balance por mes, gráfica, actividad reciente
- Residentes: autorizar/rechazar/editar/eliminar
- Comprobantes: revisar imagen → aprobar/rechazar
- Archivos: carpetas por depto, descarga ZIP días 10-15, limpieza automática
- Finanzas: ingresos/egresos directos (van a `payments` con `type=income|expense`)
- Reportes: estado de cobros del mes
- Editar contactos: modifica `settings.contacts` en Supabase

### Notificaciones
- Al rechazar un pago → se inserta en `notifications` con `user_id` del residente
- El residente las ve en su pantalla de "Mis pagos" hasta marcarlas como leídas

---

## Cuentas de prueba actuales en Supabase
- `admin@molino.com` / `admin123` → rol admin
- Edson Aldair Trejo Ramirez (`edson_al6@hotmail.com`) → residente real, depto 10G, approved
- Por el momento solo existen estas dos cuentas (la vieja `persona@gmail.com` de prueba ya no es válida — no usarla como referencia).

---

## GitHub
- Repositorio: `https://github.com/TREA117/Residencial-Molinos`
- Rama: `main`
- Deploy: GitHub Pages → `https://trea117.github.io/Residencial-Molinos`

---

## Comandos frecuentes
```bash
# Subir cambios
git add . && git commit -m "descripción" && git push

# Ver cambios sin hacer commit
git status
git diff js/app.js

# Revertir un archivo
git checkout -- js/app.js
```

---

## SQL de migración completo
Ver archivo `supabase-migration.sql` en la raíz del proyecto.
