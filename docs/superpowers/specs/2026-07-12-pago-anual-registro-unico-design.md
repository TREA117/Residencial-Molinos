# Pago de año completo como registro único

## Contexto

El registro de "pago de año completo" (checkbox en el modal de pago en efectivo, admin) hoy inserta
**12 filas individuales** en `payments` — una por mes, cada una `status='approved'`,
`category='Mantenimiento'`, con su propio `receipt_num` y su propio recibo JPEG generado. Esto fue
deliberado en su momento porque casi toda la lógica de "¿ya pagó este mes?" en el resto de la app
compara por igualdad exacta de texto: `payment.month === "Julio 2026"`.

El usuario pidió cambiar esto a **un solo registro** que genere **un solo recibo**, visible como una
sola línea en todas las pantallas donde aparece, pero sin romper nada de lo que depende de la
semántica mensual actual: las tarjetas "Cuota mensual"/"Ya pagaste" (banner), el recargo automático
por atraso, "Mantenimientos pagados X/Y" (dashboard), y Reportes.

Investigación de código (esta sesión) mapeó **9 sitios de comparación exacta** `payment.month === <mes
actual>` en JavaScript, más **2 funciones Postgres** que hacen `payments.month ILIKE '%<mes>%'`:

**JavaScript (comparación exacta, 9 sitios):**
- Web `js/app.js`: `checkPaymentBanner()` (línea 113), `renderMyPayments()` (línea 167),
  `renderMyAccount()` (línea 296)
- Web `js/admin.js`: `checkAndApplyLateFees()` — `hasPaid` (línea 1773) y `alreadyCharged` (línea
  1782), `renderDashboard()` — `maintPaidCount` (línea 84)
- Mobile: `(admin)/index.jsx` — `maintPaidCount` (línea 110), `(resident)/index.jsx` —
  `alreadyPaidThisMonth` (línea 81), `(resident)/account.jsx` — `feeAlreadyPaidThisMonth` (línea 86)

**Postgres (ILIKE contra texto libre, 2 funciones):**
- `fn_resident_report(p_month_label)` — `has_current` = `exists(... p.month ilike '%'||p_month_label||'%')`
- `fn_resident_finances_summary(p_year, p_current_month_label)` — CTE `maint`, mismo patrón ILIKE

Si el registro único tuviera `month = "Año completo 2026"`, ninguno de estos 11 checks reconocería
ese pago como cobertura de "Julio 2026" — el residente volvería a ver "Pagar ahora", recibiría el
recargo de $50, y Reportes lo marcaría "Pendiente" cada mes, exactamente lo que el usuario pidió
evitar.

También se confirmó (investigación de código, sin necesidad de cambios):
- Las plantillas de recibo (`buildReceiptHTML` en web, `ReceiptGenerator.jsx` en mobile) renderizan
  el campo "Período" como texto libre sin parseo — aceptan cualquier string sin tocar la plantilla.
- Mobile no necesita cambios en su mecanismo de cola de recibos (`enqueueReceipts`): ya maneja
  arreglos de 1 elemento correctamente, es compartido con el flujo de aprobación individual y no debe
  tocarse.
- Web's `saveCashPaymentFullYear()` genera recibos en un `for` sobre las filas insertadas — al
  insertar solo 1 fila, ese mismo loop ya genera solo 1 recibo sin necesidad de código especial.
- Las tablas de listado (Mis pagos, Comprobantes del admin, Estado de cuenta, Archivos) mostrarán
  automáticamente una sola línea una vez que solo exista 1 fila en la base de datos — no requieren
  cambios de agrupación visual.

## Alcance

**Incluye:**
1. Migración DB: 2 columnas nuevas en `payments` — `covers_full_year boolean not null default false`,
   `period_year integer null` (solo se llena en filas de año completo).
2. Actualizar las 2 funciones Postgres (`fn_resident_report`, `fn_resident_finances_summary`) para
   que su lógica de "¿pagó este mes?" también reconozca `covers_full_year=true AND period_year =
   <año del mes consultado>` como cobertura válida, sin dejar de funcionar para pagos mensuales
   normales.
3. Reescribir `saveCashPaymentFullYear()` (web y mobile) para insertar **una sola fila**:
   - `amount` = monto mensual capturado × cantidad de meses del año que **aún no** tienen un pago de
     Mantenimiento aprobado (se sigue respetando "no duplicar meses ya pagados", solo que ahora se
     refleja como un total en una fila, no como N filas).
   - Si los 12 meses ya están cubiertos (individualmente o por un `covers_full_year` previo), se
     bloquea igual que hoy con el mismo mensaje de error.
   - `month` = `"Año completo {año}"` (texto de display, ya no se usa para matching).
   - `covers_full_year = true`, `period_year = {año}`.
   - `receipt_num` = `"{año}-ANUAL-{depto}"` (formato distinto al mensual `{año}-{mm}-{depto}` para
     evitar cualquier colisión).
4. Agregar un helper de "¿esta fila cubre el mes M del año Y?" (mismo nombre/firma en los 9 sitios
   JS) que reemplaza la comparación exacta por: `p.month === monthLabel || (p.coversFullYear &&
   Number(p.periodYear) === year)`.
5. Reflejar las 2 columnas nuevas en `normalizePayment()` (web y mobile) y en las listas explícitas
   de columnas (`js/data.js`, `mobile/src/services/data.js`) y en el `insert('payments', ...)` de
   cualquier otro flujo que construya filas de pago (sin cambiar su comportamiento — las columnas
   nuevas default a `false`/`null` para todo lo demás).
6. Ajustar el "Concepto" del recibo (web `buildReceiptHTML`, mobile `ReceiptGenerator.jsx`) para que
   diga "Cuota de mantenimiento — Año completo {año}" cuando `covers_full_year` sea `true`, en vez del
   texto fijo "Cuota de mantenimiento mensual".

**Explícitamente fuera de alcance:**
- No se toca el mecanismo de cola de recibos de mobile (`enqueueReceipts`/`advanceReceiptQueue`) —
  ya funciona correctamente con arreglos de 1 elemento, confirmado por investigación de código.
- No se cambia el campo "Monto mensual ($)" del formulario a "Monto total anual" — el admin sigue
  ingresando el monto mensual y el sistema calcula el total internamente, igual que hoy.
- No se resuelve el caso de un residente que ya tiene ALGUNOS meses pagados individualmente y luego
  se le registra "año completo" para los restantes — el sistema simplemente calcula el total sobre
  los meses faltantes y marca la fila como `covers_full_year=true` de todas formas (la redundancia
  con los meses ya cubiertos individualmente es inofensiva para los checks, que son un OR). No se
  bloquea este caso ni se pide confirmación extra — mismo comportamiento de "saltar meses pagados"
  que ya existe hoy, solo que ahora colapsado en una fila en vez de N.

## Diseño

### 1. Migración DB

```sql
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS covers_full_year BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS period_year INTEGER NULL;
```

### 2. Funciones Postgres

**`fn_resident_report`**: cambiar el `exists(...)` de `has_current` de:
```sql
exists (
  select 1 from public.payments p
  where p.resident_id = u.id and p.status = 'approved'
    and p.month ilike '%' || p_month_label || '%'
)
```
a:
```sql
exists (
  select 1 from public.payments p
  where p.resident_id = u.id and p.status = 'approved'
    and (
      p.month ilike '%' || p_month_label || '%'
      or (p.covers_full_year and p.period_year = substring(p_month_label from '\d{4}$')::int)
    )
)
```
(`substring(p_month_label from '\d{4}$')` extrae los últimos 4 dígitos del label, ej. "julio 2026" →
"2026" — robusto sin importar el nombre del mes, ya que el formato siempre es "<mes> <año>".)

**`fn_resident_finances_summary`**: mismo patrón en el CTE `maint`, columna `paid_count`:
```sql
(select count(distinct p.resident_id) from public.payments p
  where p.status = 'approved'
    and (p.category = 'Mantenimiento' or p.category is null)
    and (
      p.month ilike '%' || p_current_month_label || '%'
      or (p.covers_full_year and p.period_year = substring(p_current_month_label from '\d{4}$')::int)
    ))::integer as paid_count,
```

### 3. `saveCashPaymentFullYear()` — web (`js/admin.js`)

Reemplaza el `newRows = monthsToInsert.map(...)` (que crea N filas) por una sola fila:
```js
const amount = parseFloat(document.getElementById('cashAmount').value) * monthsToInsert.length;
const newRow = {
  resident_id: residentId, resident_name: resident.name,
  depto: resident.depto, month: `Año completo ${year}`, amount,
  status: 'approved', type: 'income',
  description: `Cuota mantenimiento año completo ${year} — Depto ${resident.depto}`,
  category: 'Mantenimiento',
  payment_date: payDate, approved_date: today,
  receipt_num: `${year}-ANUAL-${resident.depto}`,
  covers_full_year: true, period_year: Number(year),
  notes: notes || `Pago en efectivo (año completo ${year}) registrado por administración`,
};
```
El resto de la función (insert, notificación, loop de generación de recibo) sigue funcionando igual
porque ahora opera sobre un array de 1 elemento en vez de hasta 12 — sin necesidad de reescribir esa
parte.

### 4. `saveCashPaymentFullYear()` — mobile (`mobile/src/services/admin.js`)

Mismo cambio: una sola fila con `amount = amount * monthsToInsert.length`, `covers_full_year: true,
period_year: Number(year)`, `receipt_num: \`${year}-ANUAL-${depto}\``. El array de retorno sigue
siendo `[fila]` (via `.insert(newRows).select()`), así que `comprobantes.jsx`'s `enqueueReceipts(rows)`
no necesita ningún cambio.

### 5. Helper de cobertura (9 sitios JS)

Mismo patrón en los 3 archivos (`js/app.js`, `js/admin.js`, y sus 3 equivalentes mobile) — agregar
una función local:
```js
function paymentCoversMonth(p, monthLabel, year) {
  return p.month === monthLabel || (p.coversFullYear && Number(p.periodYear) === year);
}
```
y reemplazar cada `p.month === currentMonthLabel` (o variantes) por
`paymentCoversMonth(p, currentMonthLabel, currentYearNumber)`.

### 6. Normalización

`normalizePayment()` (web y mobile): agregar
```js
coversFullYear: !!p.covers_full_year,
periodYear: p.period_year ?? null,
```
Listas de columnas (`js/data.js:72`, `mobile/src/services/data.js:77`): agregar
`covers_full_year,period_year` a la cadena `select`.

### 7. Recibos — Concepto dinámico

Web `buildReceiptHTML()` y mobile `ReceiptGenerator.jsx`'s `buildConcept()`: cuando
`p.category !== 'Multa' && p.category !== 'Adeudo'`, cambiar el string fijo
`'Cuota de mantenimiento mensual'` por:
```js
p.coversFullYear ? `Cuota de mantenimiento — Año completo ${p.periodYear || ''}`.trim() : 'Cuota de mantenimiento mensual'
```

## Testing

- Registrar un año completo de prueba y confirmar en Supabase: **1 sola fila** con
  `covers_full_year=true`, `period_year` correcto, `amount` = monto × meses cubiertos.
- Confirmar que se genera **1 solo recibo** (no 12), con "Período: Año completo 2026" y "Concepto:
  Cuota de mantenimiento — Año completo 2026".
- Con ese residente: confirmar que en **julio** (o cualquier mes del año pagado) no aparece "Pagar
  ahora", la tarjeta "Cuota mensual" permanece oculta, no se le aplica el recargo de $50 después del
  día 10, cuenta como "pagado" en "Mantenimientos pagados X/Y", y Reportes lo marca "Pagado" — todo
  para CUALQUIER mes del año, no solo el mes en que se registró el pago.
- Confirmar que "Mis pagos"/"Estado de cuenta"/Comprobantes admin/Archivos muestran **una sola línea**
  para este pago, con su propio recibo descargable.
- Repetir la verificación para un año SIN el pago anual (comportamiento normal, sin regresión).
