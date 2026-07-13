# Pago de año completo como registro único Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el registro de pago de año completo cree **un solo registro** en `payments` con **un
solo recibo**, sin romper ninguna de las 8 comparaciones "¿pagó este mes?" (JS) ni las 2 funciones
Postgres que hoy dependen de que exista una fila por mes.

**Architecture:** Se agregan 2 columnas a `payments` (`covers_full_year`, `period_year`). Una función
helper `paymentCoversMonth(p, monthLabel, year)` reemplaza cada comparación exacta
`p.month === monthLabel` por una que también reconoce cobertura anual. Las 2 funciones Postgres
ganan una rama `OR` equivalente. `saveCashPaymentFullYear()` (web y mobile) pasa de insertar N filas
a insertar 1 con el monto total.

**Tech Stack:** Vanilla JS (web), Expo/React Native (mobile), Supabase Postgres.

## Global Constraints

- Los 12 meses siguen "saltándose" si ya están pagados individualmente (mismo comportamiento actual)
  — solo cambia que el resultado se guarda como 1 fila con el monto total de los meses faltantes, no
  como N filas.
- `covers_full_year` default `false`, `period_year` default `null` — cero impacto en pagos
  mensuales normales existentes o futuros.
- La comparación `alreadyCharged` dentro de `checkAndApplyLateFees()` (recargo ya aplicado este mes)
  **no** se toca — ese check es sobre filas `category==='Adeudo'`, y una fila de año completo siempre
  es `category==='Mantenimiento'`, así que nunca podría coincidir de todas formas.
- Mobile no requiere cambios en `enqueueReceipts`/`advanceReceiptQueue`/`receiptQueueRef` — ya
  procesan arreglos de 1 elemento correctamente (confirmado por investigación de código, sin task
  dedicada).
- Al modificar `js/app.js`/`js/admin.js`, bumpear `?v=` en `index.html` (usar `20260712c`, ya que
  `20260712b`/`20260712d` fueron usados hoy).

---

### Task 1: Migración DB — columnas + 2 funciones Postgres

**Files:**
- Ninguno en los repos — vía Supabase MCP (`apply_migration`), `project_id: qxjuztctbpwymmskdyqw`.

**Interfaces:**
- Produces: columnas `payments.covers_full_year` (boolean), `payments.period_year` (integer);
  `fn_resident_report(p_month_label)` y `fn_resident_finances_summary(p_year, p_current_month_label)`
  actualizadas — consumidas por Tasks 3, 4, 6, 8.

- [ ] **Step 1: Aplicar la migración**

`apply_migration`, `name: payments_covers_full_year`:

```sql
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS covers_full_year BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS period_year INTEGER NULL;

CREATE OR REPLACE FUNCTION public.fn_resident_report(p_month_label text)
 RETURNS TABLE(resident_id uuid, depto text, name text, fee numeric, status text, has_current boolean, latest_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    u.id,
    u.depto,
    u.name,
    u.fee,
    u.depto_status,
    exists (
      select 1 from public.payments p
      where p.resident_id = u.id and p.status = 'approved'
        and (
          p.month ilike '%' || p_month_label || '%'
          or (p.covers_full_year and p.period_year = substring(p_month_label from '\d{4}$')::int)
        )
    ),
    (
      select max(coalesce(p.approved_date, p.payment_date, p.sent_date))
      from public.payments p
      where p.resident_id = u.id and p.status = 'approved'
    )
  from public.users u
  where u.role <> 'admin' and public.is_admin();
$function$;

DROP FUNCTION IF EXISTS public.fn_resident_finances_summary(integer, text);

CREATE OR REPLACE FUNCTION public.fn_resident_finances_summary(p_year integer, p_current_month_label text)
 RETURNS TABLE(total_income numeric, total_expense numeric, month_start date, month_income numeric, month_expense numeric, maintenance_paid_count integer, maintenance_total_residents integer, maintenance_exempt_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with totals as (
    select
      coalesce(sum(case when type = 'income'  then amount else 0 end), 0) as total_income,
      coalesce(sum(case when type = 'expense' then amount else 0 end), 0) as total_expense
    from public.payments
    where status = 'approved'
  ),
  months as (
    select generate_series(
      make_date(p_year, 1, 1),
      make_date(p_year, 12, 1),
      interval '1 month'
    )::date as month_start
  ),
  monthly as (
    select
      m.month_start,
      coalesce(sum(case when p.type = 'income'  then p.amount else 0 end), 0) as month_income,
      coalesce(sum(case when p.type = 'expense' then p.amount else 0 end), 0) as month_expense
    from months m
    left join public.payments p
      on p.status = 'approved'
      and coalesce(p.approved_date, p.payment_date, p.sent_date) >= m.month_start
      and coalesce(p.approved_date, p.payment_date, p.sent_date) < (m.month_start + interval '1 month')
    group by m.month_start
  ),
  maint as (
    select
      (select count(distinct p.resident_id) from public.payments p
        where p.status = 'approved'
          and (p.category = 'Mantenimiento' or p.category is null)
          and (
            p.month ilike '%' || p_current_month_label || '%'
            or (p.covers_full_year and p.period_year = substring(p_current_month_label from '\d{4}$')::int)
          ))::integer as paid_count,
      (select count(*) from public.users u where u.depto_status = 'approved' and u.exento_mantenimiento = false)::integer as total_residents,
      (select count(*) from public.users u where u.depto_status = 'approved' and u.exento_mantenimiento = true)::integer as exempt_count
  )
  select t.total_income, t.total_expense, mo.month_start, mo.month_income, mo.month_expense,
         ma.paid_count, ma.total_residents, ma.exempt_count
  from totals t, monthly mo, maint ma
  order by mo.month_start;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_resident_finances_summary(integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_resident_finances_summary(integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_resident_finances_summary(integer, text) TO authenticated;
```

- [ ] **Step 2: Verificar columnas nuevas**

`execute_sql`:
```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'payments' and column_name in ('covers_full_year','period_year')
order by column_name;
```
Expected: 2 filas — `covers_full_year` (boolean, default `false`), `period_year` (integer, default
`null`).

- [ ] **Step 3: Verificar `fn_resident_report` con un registro sintético**

```sql
-- Sin insertar datos reales: confirmar que la función sigue devolviendo filas
-- para el mes actual sin errores de sintaxis en la nueva rama OR.
select count(*) from public.fn_resident_report('julio 2026');
```
Expected: un número (cuenta de residentes), sin error.

- [ ] **Step 4: Verificar `fn_resident_finances_summary` con los datos reales existentes**

```sql
select maintenance_paid_count, maintenance_total_residents, maintenance_exempt_count
from public.fn_resident_finances_summary(2026, 'julio 2026') limit 1;
```
Expected: mismos valores que antes de esta migración (sin residentes con `covers_full_year=true`
todavía, el resultado no debe cambiar).

- [ ] **Step 5: Prueba directa del match por año — simular una fila `covers_full_year`**

```sql
-- Prueba de humo dentro de una transacción que se revierte — no deja datos.
begin;
insert into public.payments (resident_id, resident_name, depto, month, amount, status, type, category, covers_full_year, period_year)
select id, name, depto, 'Año completo 2026', 4800, 'approved', 'income', 'Mantenimiento', true, 2026
from public.users where role='resident' and depto_status='approved' limit 1;

select maintenance_paid_count from public.fn_resident_finances_summary(2026, 'julio 2026');
-- Expected: +1 respecto al valor del Step 4 (el residente sintético ahora cuenta como pagado en julio).

select has_current from public.fn_resident_report('julio 2026')
where resident_id = (select resident_id from public.payments where covers_full_year = true limit 1);
-- Expected: true.

rollback;
```

No hay commit de git — el cambio vive en Supabase.

---

### Task 2: Web `js/data.js` — columna nueva + normalización

**Files:**
- Modify: `js/data.js`

**Interfaces:**
- Produces: `DB.payments[].coversFullYear` (boolean), `DB.payments[].periodYear` (number|null) —
  consumidos por Task 3, Task 4.

- [ ] **Step 1: Agregar las columnas a `loadDB()`**

```js
sb.listColumns('payments', 'id,resident_id,resident_name,depto,month,amount,status,sent_date,approved_date,receipt_num,voucher_url,payment_date,receipt_url,type,description,category,reference,notes,provider,covers_full_year,period_year'),
```

- [ ] **Step 2: Normalizar en `normalizePayment()`**

```js
function normalizePayment(p) {
  if (!p) return p;
  return { ...p,
    residentId:   p.residentId   || p.resident_id   || null,
    residentName: p.residentName || p.resident_name || '',
    sentDate:     p.sentDate     || p.sent_date     || '',
    approvedDate: p.approvedDate || p.approved_date || null,
    paymentDate:  p.paymentDate  || p.payment_date  || null,
    receiptNum:   p.receiptNum   || p.receipt_num   || null,
    receiptUrl:   p.receiptUrl   || p.receipt_url   || null,
    voucherUrl:   p.voucherUrl   || p.voucher_url   || null,
    type:         p.type         || 'income',
    description:  p.description  || '',
    category:     p.category     || '',
    reference:    p.reference    || '',
    notes:        p.notes        || '',
    provider:     p.provider     || '',
    coversFullYear: !!p.covers_full_year,
    periodYear:     p.period_year ?? null,
  };
}
```

- [ ] **Step 3: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/data.js
git add js/data.js
git commit -m "feat: agregar covers_full_year/period_year a la carga y normalización de pagos"
```

---

### Task 3: Web `js/app.js` — helper de cobertura + 3 checks + concepto de recibo

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `p.coversFullYear`, `p.periodYear` (Task 2).
- Produces: `paymentCoversMonth(p, monthLabel, year)` — función global de módulo, consumida también
  por Task 4 (`js/admin.js`, cargado después de `app.js`, mismo scope global de scripts no-módulo).

- [ ] **Step 1: Agregar el helper `paymentCoversMonth`**

Justo después de la declaración de `_MONTH_NAMES` (`js/app.js`, línea 87), agregar:

```js
/* Un pago "cubre" un mes si coincide exactamente con ese mes (caso normal),
   o si es un registro de año completo (covers_full_year) para ese mismo año
   — evita que el pago de año completo deje de "contar" para cualquier mes
   que no sea aquel en el que se registró. */
function paymentCoversMonth(p, monthLabel, year) {
  return p.month === monthLabel || (p.coversFullYear && Number(p.periodYear) === year);
}
```

- [ ] **Step 2: `checkPaymentBanner()` — usar el helper**

Reemplazar (dentro de `checkPaymentBanner`, ~línea 108-114):
```js
    const alreadyPaid = DB.payments.some(p =>
      (p.residentId === currentUser.id || p.resident_id === currentUser.id ||
       p.residentName === currentUser.name || p.resident_name === currentUser.name) &&
      (p.category === 'Mantenimiento' || !p.category) &&
      p.status === 'approved' &&
      p.month === monthLabel
    );
```
por:
```js
    const alreadyPaid = DB.payments.some(p =>
      (p.residentId === currentUser.id || p.resident_id === currentUser.id ||
       p.residentName === currentUser.name || p.resident_name === currentUser.name) &&
      (p.category === 'Mantenimiento' || !p.category) &&
      p.status === 'approved' &&
      paymentCoversMonth(p, monthLabel, today.getFullYear())
    );
```

- [ ] **Step 3: `renderMyPayments()` — usar el helper**

Reemplazar (~línea 161-168):
```js
  const currentMonthLabelMP = `${_MONTH_NAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const feeAlreadyPaidThisMonthMP = DB.payments.some(p =>
    (p.residentId === currentUser.id || p.resident_id === currentUser.id ||
     p.residentName === currentUser.name || p.resident_name === currentUser.name) &&
    (p.category === 'Mantenimiento' || !p.category) &&
    p.status === 'approved' &&
    p.month === currentMonthLabelMP
  );
```
por:
```js
  const currentMonthLabelMP = `${_MONTH_NAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const feeAlreadyPaidThisMonthMP = DB.payments.some(p =>
    (p.residentId === currentUser.id || p.resident_id === currentUser.id ||
     p.residentName === currentUser.name || p.resident_name === currentUser.name) &&
    (p.category === 'Mantenimiento' || !p.category) &&
    p.status === 'approved' &&
    paymentCoversMonth(p, currentMonthLabelMP, new Date().getFullYear())
  );
```

- [ ] **Step 4: `renderMyAccount()` — usar el helper**

Reemplazar (~línea 294-297):
```js
  const currentMonthLabel = `${_MONTH_NAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const feeAlreadyPaidThisMonth = approved.some(p =>
    (p.category === 'Mantenimiento' || !p.category) && p.month === currentMonthLabel
  );
```
por:
```js
  const currentMonthLabel = `${_MONTH_NAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const feeAlreadyPaidThisMonth = approved.some(p =>
    (p.category === 'Mantenimiento' || !p.category) && paymentCoversMonth(p, currentMonthLabel, new Date().getFullYear())
  );
```

- [ ] **Step 5: `buildReceiptHTML()` — concepto dinámico para año completo**

Reemplazar (~línea 581-583):
```js
  const concept      = _esc((p.category === 'Multa' || p.category === 'Adeudo')
    ? (p.description || p.category)
    : 'Cuota de mantenimiento mensual');
```
por:
```js
  const concept      = _esc((p.category === 'Multa' || p.category === 'Adeudo')
    ? (p.description || p.category)
    : (p.coversFullYear ? `Cuota de mantenimiento — Año completo ${p.periodYear || ''}`.trim() : 'Cuota de mantenimiento mensual'));
```

- [ ] **Step 6: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/app.js
git add js/app.js
git commit -m "feat: reconocer pagos de año completo en cuota mensual/banner/recibo (web)"
```

---

### Task 4: Web `js/admin.js` — `saveCashPaymentFullYear()` a fila única + recargo + dashboard

**Files:**
- Modify: `js/admin.js`

**Interfaces:**
- Consumes: `paymentCoversMonth()` (Task 3, global de módulo, `admin.js` carga después de `app.js`).

- [ ] **Step 1: Reescribir `saveCashPaymentFullYear()` para insertar una sola fila**

Reemplazar la función completa (líneas 573-667 actuales) por:

```js
async function saveCashPaymentFullYear() {
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const residentId = document.getElementById('cashResidentId').value;
  const monthSel   = document.getElementById('cashMonth').value;
  const monthlyAmount = parseFloat(document.getElementById('cashAmount').value);
  const payDate    = document.getElementById('cashDate').value;
  const notes      = document.getElementById('cashNotes').value.trim();
  if (!residentId || !monthSel || !monthlyAmount || !payDate) {
    showToast('Completa todos los campos requeridos', 'error'); return;
  }
  const resident = DB.residents.find(r => r.id === residentId);
  if (!resident) { showToast('Residente no encontrado', 'error'); return; }

  const year = monthSel;
  const today = new Date().toISOString().split('T')[0];

  const alreadyPaidMonths = new Set(
    DB.payments.filter(p =>
      (p.resident_id === residentId || p.residentId === residentId) &&
      (p.category === 'Mantenimiento' || !p.category) &&
      p.status === 'approved'
    ).map(p => p.month)
  );
  const monthsToInsert = MONTHS.filter(m => !alreadyPaidMonths.has(`${m} ${year}`));
  if (!monthsToInsert.length) {
    showToast(`Ese residente ya tiene los 12 meses de ${year} pagados`, 'error'); return;
  }

  const btn = document.querySelector('#modalCashPayment .btn-gold');
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

  try {
    const totalAmount = monthlyAmount * monthsToInsert.length;
    const newRow = {
      resident_id: residentId, resident_name: resident.name,
      depto: resident.depto, month: `Año completo ${year}`, amount: totalAmount,
      status: 'approved', type: 'income',
      description: `Cuota mantenimiento año completo ${year} — Depto ${resident.depto}`,
      category: 'Mantenimiento',
      payment_date: payDate, approved_date: today,
      receipt_num: `${year}-ANUAL-${resident.depto}`,
      covers_full_year: true, period_year: Number(year),
      notes: notes || `Pago en efectivo (año completo ${year}, ${monthsToInsert.length} mes(es)) registrado por administración`,
    };

    const rows = await window.SUPABASE.insert('payments', newRow);
    const insertedRows = Array.isArray(rows) ? rows : [rows];
    if (!insertedRows.length) throw new Error('Sin respuesta del servidor');

    const insertedPayments = insertedRows.map(row => ({
      ...row,
      residentId: row.resident_id, residentName: row.resident_name,
      receiptNum: row.receipt_num, receiptUrl: null,
      paymentDate: row.payment_date, approvedDate: row.approved_date,
      coversFullYear: !!row.covers_full_year, periodYear: row.period_year ?? null,
      hasVoucher: false,
    }));
    DB.payments.push(...insertedPayments);

    try {
      const notifRows = await window.SUPABASE.insert('notifications', {
        user_id: residentId,
        message: `Se registró tu pago de mantenimiento del año ${year} (${monthsToInsert.length} mes(es)) por administración. Ya puedes ver tu recibo.`,
        is_read: false,
      });
      const notifRow = Array.isArray(notifRows) ? notifRows[0] : notifRows;
      if (notifRow && typeof normalizeNotification === 'function') DB.notifications.push(normalizeNotification(notifRow));
    } catch(ne) { console.warn('No se pudo crear la notificación', ne); }

    closeModal('modalCashPayment');
    renderPayments();
    showToast(`✓ Año ${year} registrado (${monthsToInsert.length} mes(es)) — generando recibo...`);

    for (const p of insertedPayments) {
      try {
        const blob = await generateReceiptImageBlob(p);
        const url  = await uploadReceiptImage(p, blob);
        if (!url) throw new Error('uploadReceiptImage no devolvió URL');
        await window.SUPABASE.update('payments', p.id, { receipt_url: url });
        p.receiptUrl = url; p.receipt_url = url;
      } catch(ue) {
        console.error('No se pudo subir el recibo de', p.month, ue);
      }
    }
    if (typeof renderMyPayments === 'function') renderMyPayments();
    if (typeof renderVouchers === 'function') renderVouchers();
    showToast(`✓ Recibo del año ${year} generado`);
  } catch(e) {
    console.error('Error al registrar el año completo', e);
    showToast('Error: ' + (e?.message||e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Registrar y generar recibo'; }
  }
}
```
(cambios clave respecto al original: `monthlyAmount` en vez de `amount` para el valor del campo;
`newRow` único en vez de `newRows` mapeado por mes; `totalAmount = monthlyAmount * monthsToInsert.length`;
`month: "Año completo ${year}"`, `covers_full_year: true`, `period_year: Number(year)`,
`receipt_num` con formato `ANUAL`; el resto — inserción, notificación, loop de recibo — sin cambios
estructurales, ahora opera sobre 1 elemento en vez de hasta 12.)

- [ ] **Step 2: `checkAndApplyLateFees()` — usar el helper en `hasPaid` (no en `alreadyCharged`)**

Reemplazar (~línea 1771-1776):
```js
    const hasPaid = DB.payments.some(p =>
      (p.resident_id === rid || p.residentId === rid) &&
      p.month === currentMonthStr &&
      (!p.category || p.category === 'Mantenimiento') &&
      (p.status === 'approved' || p.status === 'pending')
    );
```
por:
```js
    const hasPaid = DB.payments.some(p =>
      (p.resident_id === rid || p.residentId === rid) &&
      paymentCoversMonth(p, currentMonthStr, today.getFullYear()) &&
      (!p.category || p.category === 'Mantenimiento') &&
      (p.status === 'approved' || p.status === 'pending')
    );
```
(el check `alreadyCharged` inmediatamente después, líneas 1780-1785, **no se toca** — filtra
`category==='Adeudo'`, que un registro de año completo nunca tiene.)

- [ ] **Step 3: `renderDashboard()` — usar el helper en `maintPaidCount`**

Reemplazar (~línea 79-86):
```js
  const currentMonthLabel = `${MONTHS_ES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const maintPaidCount = new Set(
    DB.payments.filter(p =>
      p.status==='approved' &&
      (p.category==='Mantenimiento' || !p.category) &&
      p.month === currentMonthLabel
    ).map(p => p.residentId || p.resident_id)
  ).size;
```
por:
```js
  const currentMonthLabel = `${MONTHS_ES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const currentYearNum = new Date().getFullYear();
  const maintPaidCount = new Set(
    DB.payments.filter(p =>
      p.status==='approved' &&
      (p.category==='Mantenimiento' || !p.category) &&
      paymentCoversMonth(p, currentMonthLabel, currentYearNum)
    ).map(p => p.residentId || p.resident_id)
  ).size;
```

- [ ] **Step 4: Bump de versión y validar**

En `index.html`:
```html
<script src="js/app.js?v=20260712c"></script>
<script src="js/admin.js?v=20260712e"></script>
```

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/admin.js
```

- [ ] **Step 5: Commit**

```bash
git add js/admin.js index.html
git commit -m "feat: pago de año completo como registro único (web) — recibo único, cuota/recargo/dashboard reconocen cobertura anual"
```

---

### Task 5: Mobile `mobile/src/services/data.js` — columna nueva + normalización

**Files:**
- Modify: `mobile/src/services/data.js`

**Interfaces:**
- Produces: `payment.coversFullYear`, `payment.periodYear` — consumidos por Tasks 6, 7, 8.

- [ ] **Step 1: Agregar las columnas a `PAYMENTS_COLUMNS`**

```js
const PAYMENTS_COLUMNS = 'id,resident_id,resident_name,depto,month,amount,status,sent_date,approved_date,receipt_num,voucher_url,payment_date,receipt_url,type,description,category,reference,notes,provider,covers_full_year,period_year';
```

- [ ] **Step 2: Normalizar en `normalizePayment()`**

```js
export function normalizePayment(p) {
  if (!p) return p;
  return {
    ...p,
    residentId: p.residentId || p.resident_id || null,
    residentName: p.residentName || p.resident_name || '',
    sentDate: p.sentDate || p.sent_date || '',
    approvedDate: p.approvedDate || p.approved_date || null,
    paymentDate: p.paymentDate || p.payment_date || null,
    receiptNum: p.receiptNum || p.receipt_num || null,
    receiptUrl: p.receiptUrl || p.receipt_url || null,
    voucherUrl: p.voucherUrl || p.voucher_url || null,
    type: p.type || 'income',
    description: p.description || '',
    category: p.category || '',
    reference: p.reference || '',
    notes: p.notes || '',
    provider: p.provider || '',
    coversFullYear: !!p.covers_full_year,
    periodYear: p.period_year ?? null,
  };
}
```

- [ ] **Step 3: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform android
rm -rf dist
git add src/services/data.js
git commit -m "feat: agregar covers_full_year/period_year a la carga y normalización de pagos (mobile)"
```

---

### Task 6: Mobile `mobile/src/utils/format.js` — helper de cobertura

**Files:**
- Modify: `mobile/src/utils/format.js`

**Interfaces:**
- Produces: `paymentCoversMonth(p, monthLabel, year)`, exportado — consumido por Task 8.

- [ ] **Step 1: Agregar el helper**

Al final del archivo:

```js
// Un pago "cubre" un mes si coincide exactamente con ese mes (caso normal),
// o si es un registro de año completo (coversFullYear) para ese mismo año —
// evita que el pago de año completo deje de "contar" para cualquier mes que
// no sea aquel en el que se registró.
export function paymentCoversMonth(p, monthLabel, year) {
  return p.month === monthLabel || (p.coversFullYear && Number(p.periodYear) === year);
}
```

- [ ] **Step 2: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform android
rm -rf dist
git add src/utils/format.js
git commit -m "feat: agregar helper paymentCoversMonth (mobile)"
```

---

### Task 7: Mobile `mobile/src/services/admin.js` — `saveCashPaymentFullYear()` a fila única

**Files:**
- Modify: `mobile/src/services/admin.js`

**Interfaces:**
- Produces: `saveCashPaymentFullYear({...})` ahora devuelve un array de 1 fila (antes hasta 12) —
  consumido sin cambios por `comprobantes.jsx`'s `enqueueReceipts(rows)` (ya maneja arreglos de
  cualquier longitud, incluida 1).

- [ ] **Step 1: Reescribir `saveCashPaymentFullYear()`**

Reemplazar la función completa por:

```js
// Registra el mantenimiento del año completo de un residente como UN SOLO
// pago (un recibo) — el monto es el mensual × la cantidad de meses que aún
// no estén pagados individualmente ese año (se siguen saltando los ya
// pagados, para no duplicar cobros).
export async function saveCashPaymentFullYear({ residentId, residentName, depto, year, amount, payDate, notes }) {
  const today = new Date().toISOString().split('T')[0];

  const { data: existing, error: fetchErr } = await supabase
    .from('payments')
    .select('month')
    .eq('resident_id', residentId)
    .eq('status', 'approved')
    .or('category.eq.Mantenimiento,category.is.null');
  if (fetchErr) throw fetchErr;
  const alreadyPaidMonths = new Set((existing || []).map((p) => p.month));

  const monthsToInsert = CASH_MONTHS.filter((m) => !alreadyPaidMonths.has(`${m} ${year}`));
  if (!monthsToInsert.length) throw new Error(`Ese residente ya tiene los 12 meses de ${year} pagados`);

  const totalAmount = amount * monthsToInsert.length;
  const newRow = {
    resident_id: residentId, resident_name: residentName,
    depto, month: `Año completo ${year}`, amount: totalAmount,
    status: 'approved', type: 'income',
    description: `Cuota mantenimiento año completo ${year} — Depto ${depto}`,
    category: 'Mantenimiento',
    payment_date: payDate, approved_date: today,
    receipt_num: `${year}-ANUAL-${depto}`,
    covers_full_year: true, period_year: Number(year),
    notes: notes || `Pago en efectivo (año completo ${year}, ${monthsToInsert.length} mes(es)) registrado por administración`,
  };

  const { data, error } = await supabase.from('payments').insert(newRow).select();
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [data];

  try {
    await supabase.from('notifications').insert({
      user_id: residentId,
      message: `Se registró tu pago de mantenimiento del año ${year} (${monthsToInsert.length} mes(es)) por administración. Ya puedes ver tu recibo.`,
      is_read: false,
    });
  } catch (notifErr) {
    console.warn('No se pudo crear la notificación', notifErr);
  }

  return rows;
}
```
(`CASH_MONTHS` ya está declarado como constante de módulo en este archivo, sin cambios ahí.)

- [ ] **Step 2: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform android
rm -rf dist
git add src/services/admin.js
git commit -m "feat: pago de año completo como registro único (mobile) — un recibo, monto total"
```

---

### Task 8: Mobile — aplicar el helper en las 3 pantallas + concepto del recibo

**Files:**
- Modify: `mobile/src/app/(admin)/index.jsx`
- Modify: `mobile/src/app/(resident)/index.jsx`
- Modify: `mobile/src/app/(resident)/account.jsx`
- Modify: `mobile/src/components/ReceiptGenerator.jsx`

**Interfaces:**
- Consumes: `paymentCoversMonth` (Task 6, importado desde `../../utils/format` o `../../../utils/format`
  según la profundidad relativa de cada archivo).

- [ ] **Step 1: `(admin)/index.jsx` — importar el helper y usarlo en `maintPaidCount`**

Agregar al import existente de `../../utils/format`:
```jsx
import { fmt, fmtDate, paymentCoversMonth } from '../../utils/format';
```
Reemplazar (líneas ~107-111):
```jsx
  const currentMonthLabel = `${MONTH_NAMES_FULL[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const maintPaidCount = new Set(
    approved
      .filter((p) => (p.category === 'Mantenimiento' || !p.category) && p.month === currentMonthLabel)
      .map((p) => p.residentId || p.resident_id)
  ).size;
```
por:
```jsx
  const currentMonthLabel = `${MONTH_NAMES_FULL[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const currentYearNum = new Date().getFullYear();
  const maintPaidCount = new Set(
    approved
      .filter((p) => (p.category === 'Mantenimiento' || !p.category) && paymentCoversMonth(p, currentMonthLabel, currentYearNum))
      .map((p) => p.residentId || p.resident_id)
  ).size;
```

- [ ] **Step 2: `(resident)/index.jsx` — importar el helper y usarlo en `alreadyPaidThisMonth`**

Verificar el import existente de `fmt, fmtDate` desde `'../../utils/format'` y agregar
`paymentCoversMonth` a esa misma línea. Reemplazar (líneas ~74-82):
```jsx
  const monthLabel = today.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  const currentMonthValue = `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;
  // No mostrar "Pagar ahora" si ya hay un pago de mantenimiento aprobado este
  // mes (p.ej. registrado en efectivo por administración) — antes esto solo
  // miraba el rango de fechas y el adeudo nunca se "quitaba" en la app.
  const alreadyPaidThisMonth = payments.some((p) =>
    (p.category === 'Mantenimiento' || !p.category) &&
    p.status === 'approved' &&
    p.month === currentMonthValue
  );
```
por:
```jsx
  const monthLabel = today.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  const currentMonthValue = `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;
  // No mostrar "Pagar ahora" si ya hay un pago de mantenimiento aprobado este
  // mes (p.ej. registrado en efectivo por administración, o un pago de año
  // completo que cubre este mes) — antes esto solo miraba el rango de fechas
  // y el adeudo nunca se "quitaba" en la app.
  const alreadyPaidThisMonth = payments.some((p) =>
    (p.category === 'Mantenimiento' || !p.category) &&
    p.status === 'approved' &&
    paymentCoversMonth(p, currentMonthValue, today.getFullYear())
  );
```

- [ ] **Step 3: `(resident)/account.jsx` — importar el helper y usarlo en `feeAlreadyPaidThisMonth`**

Agregar `paymentCoversMonth` al import existente de `'../../utils/format'`. Reemplazar (líneas
~84-87):
```jsx
  const today = new Date();
  const currentMonthLabel = `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;
  const feeAlreadyPaidThisMonth = approved.some((p) =>
    (p.category === 'Mantenimiento' || !p.category) && p.month === currentMonthLabel
  );
```
por:
```jsx
  const today = new Date();
  const currentMonthLabel = `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;
  const feeAlreadyPaidThisMonth = approved.some((p) =>
    (p.category === 'Mantenimiento' || !p.category) && paymentCoversMonth(p, currentMonthLabel, today.getFullYear())
  );
```

- [ ] **Step 4: `ReceiptGenerator.jsx` — concepto dinámico para año completo**

Reemplazar (`buildConcept`, líneas 37-40):
```jsx
function buildConcept(p) {
  if (p.category === 'Multa' || p.category === 'Adeudo') return p.description || p.category;
  return 'Cuota de mantenimiento mensual';
}
```
por:
```jsx
function buildConcept(p) {
  if (p.category === 'Multa' || p.category === 'Adeudo') return p.description || p.category;
  if (p.coversFullYear) return `Cuota de mantenimiento — Año completo ${p.periodYear || ''}`.trim();
  return 'Cuota de mantenimiento mensual';
}
```

- [ ] **Step 5: Validar**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform ios
npx expo export --platform android
rm -rf dist
```
Expected: ambos exportan sin errores (confirma que los imports de `paymentCoversMonth` resuelven
correctamente en los 3 archivos).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/index.jsx" "src/app/(resident)/index.jsx" "src/app/(resident)/account.jsx" src/components/ReceiptGenerator.jsx
git commit -m "feat: reconocer pagos de año completo en cuota mensual/dashboard/recibo (mobile)"
```

---

## Self-Review Notes

- **Cobertura del spec:** ítem 1 (migración) → Task 1. Ítem 2 (funciones Postgres) → Task 1. Ítem 3
  (`saveCashPaymentFullYear` web) → Task 4. Ítem 4 (mobile) → Task 7. Ítem 5 (helper 9 sitios) →
  Tasks 3, 4, 6, 8 — corregido a **8 sitios reales** durante la escritura del plan: el check
  `alreadyCharged` de `checkAndApplyLateFees` se identificó como no aplicable (filtra
  `category==='Adeudo'`, que un registro de año completo nunca tiene) y se documentó explícitamente
  en Task 4 Step 2 en vez de tocarlo innecesariamente. Ítem 6 (normalización + columnas) → Tasks 2, 5.
  Ítem 7 (concepto de recibo) → Tasks 3, 8.
- **Placeholders:** ninguno — todo el código mostrado es completo, listo para pegar en cada archivo.
- **Consistencia de nombres:** `paymentCoversMonth(p, monthLabel, year)` tiene la misma firma en las
  4 implementaciones (web global-scope en `js/app.js`, mobile exportada desde
  `mobile/src/utils/format.js`). `covers_full_year`/`period_year` (DB, snake_case) se normalizan
  siempre a `coversFullYear`/`periodYear` (JS, camelCase) en los 2 `normalizePayment()`, igual patrón
  que el resto de campos ya existentes en esas funciones.
