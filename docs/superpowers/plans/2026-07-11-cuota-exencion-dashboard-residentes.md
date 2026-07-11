# Cuota persistente, exención de mantenimiento y dashboard financiero de residentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ocultar la "Cuota mensual" cuando ya está pagada, quitar la tarjeta "En revisión", agregar
exención de cuota de mantenimiento por residente, y dar a los residentes un dashboard financiero
de solo lectura (balance/ingresos/egresos totales + gráfica) — en web y mobile (Android/iOS).

**Architecture:** Cambios de UI/lógica en `js/app.js`/`js/admin.js`/`index.html` (web) y en
`mobile/src/app/(resident)/*`, `mobile/src/app/(admin)/residentes.jsx`,
`mobile/src/services/{data,admin}.js` (mobile), más un nuevo campo de columna
(`exento_mantenimiento`) y una nueva función Postgres (`fn_resident_finances_summary`) en
Supabase.

**Tech Stack:** Vanilla JS + Chart.js (web), Expo/React Native (mobile), Supabase Postgres/RLS.

## Global Constraints

- No se toca ningún archivo de código de negocio fuera de lo listado en cada task.
- El campo nuevo es `exento_mantenimiento` (boolean, snake_case, sigue la convención de `is_deleted`
  en `users`).
- Los badges "En revisión" por fila individual en listas de pagos **no se tocan** — solo se quita
  la tarjeta resumen "En revisión" del grid de métricas de Estado de cuenta.
- El admin conserva control total sobre todos los residentes (exentos o no) — la exención solo
  afecta lo que el propio residente ve/puede autoiniciar.
- Al modificar `js/app.js` o `js/admin.js`, bumpear el querystring `?v=YYYYMMDD` correspondiente en
  `index.html` (regla de `CLAUDE.md`). Fecha a usar: `20260711`.
- **Corrección técnica sobre el spec aprobado**: el spec asumía que el dashboard de residente podía
  reutilizar la agregación de `renderDashboard()`/`AdminDashboard` tal cual. Verificado contra la
  base de datos real (Supabase MCP): la política RLS `payments_select_own_or_admin` limita a un
  residente a `resident_id = auth.uid()` — nunca ve pagos de otros residentes ni transacciones de
  administración (que no tienen `resident_id`). Las funciones agregadas ya existentes
  (`fn_month_totals`, `fn_remanente`, `fn_resident_report`) son `SECURITY DEFINER` pero **cada una
  filtra internamente con `and public.is_admin()`**, así que devuelven vacío/cero si las llama un
  residente — no sirven para esto tal cual. Se necesita una función nueva,
  `fn_resident_finances_summary`, sin ese filtro de admin, que devuelva solo agregados (nunca filas
  individuales) y esté restringida a `authenticated` (no `anon`) — sigue exactamente el patrón que
  ya usa este proyecto para exponer agregados sin exponer filas.

---

### Task 1: Migración de base de datos — exención + función de finanzas para residentes

**Files:**
- Ninguno en los repos — se aplica directo contra el proyecto Supabase `qxjuztctbpwymmskdyqw` vía
  MCP (`apply_migration`), siguiendo la práctica ya usada en este proyecto (no hay carpeta de
  migraciones versionada en ningún repo).

**Interfaces:**
- Produces: columna `users.exento_mantenimiento` (boolean, default `false`), leída por Tasks 2, 3,
  6, 7. Función `public.fn_resident_finances_summary(p_year integer)` → tabla
  `(total_income numeric, total_expense numeric, month_start date, month_income numeric, month_expense numeric)`,
  una fila por mes del año pedido, consumida por Tasks 5 y 8.

- [ ] **Step 1: Aplicar la migración**

Ejecutar con `apply_migration` (`project_id: qxjuztctbpwymmskdyqw`,
`name: exento_mantenimiento_and_resident_finances`):

```sql
-- 1. Campo de exención de cuota de mantenimiento
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS exento_mantenimiento BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. El trigger que evita auto-escalación de privilegios en updates propios
--    debe fijar también este campo, o cualquier residente podría auto-otorgarse
--    la exención vía un update normal de su propia fila (RLS ya permite eso
--    para el resto de columnas — ver users_update_own_or_admin).
CREATE OR REPLACE FUNCTION public.prevent_self_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.depto_status := old.depto_status;
    new.fee := old.fee;
    new.exento_mantenimiento := old.exento_mantenimiento;
  end if;
  return new;
end;
$function$;

-- 3. Agregado de finanzas para residentes — SIN el filtro "and public.is_admin()"
--    que sí llevan fn_month_totals/fn_remanente/fn_resident_report (esas son
--    admin-only a propósito). Esta solo devuelve totales/agregados por mes,
--    nunca filas individuales de payments, así que es seguro exponerla a
--    cualquier usuario autenticado (residente o admin).
CREATE OR REPLACE FUNCTION public.fn_resident_finances_summary(p_year integer)
 RETURNS TABLE(total_income numeric, total_expense numeric, month_start date, month_income numeric, month_expense numeric)
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
  )
  select t.total_income, t.total_expense, mo.month_start, mo.month_income, mo.month_expense
  from totals t, monthly mo
  order by mo.month_start;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_resident_finances_summary(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_resident_finances_summary(integer) TO authenticated;
```

- [ ] **Step 2: Verificar la columna nueva**

Ejecutar con `execute_sql` (mismo `project_id`):
```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'users' and column_name = 'exento_mantenimiento';
```
Expected: una fila, `data_type = 'boolean'`, `column_default = 'false'`.

- [ ] **Step 3: Verificar que el trigger quedó actualizado**

```sql
select pg_get_functiondef(oid) from pg_proc where proname = 'prevent_self_role_escalation';
```
Expected: el cuerpo incluye la línea `new.exento_mantenimiento := old.exento_mantenimiento;`.

- [ ] **Step 4: Verificar que la nueva función existe y NO requiere ser admin**

```sql
select * from public.fn_resident_finances_summary(2026);
```
Expected: 12 filas (una por mes de 2026), `total_income`/`total_expense` iguales en todas las filas
(son agregados globales, no por mes), sin error — a diferencia de `fn_month_totals` (que devolvería
0 si se llamara sin ser admin, por el `and public.is_admin()` interno que esta función nueva no
tiene).

- [ ] **Step 5: Verificar permisos de ejecución**

```sql
select has_function_privilege('anon', 'public.fn_resident_finances_summary(integer)', 'EXECUTE') as anon_can,
       has_function_privilege('authenticated', 'public.fn_resident_finances_summary(integer)', 'EXECUTE') as auth_can;
```
Expected: `anon_can = false`, `auth_can = true`.

No hay commit de git en este task — el cambio vive únicamente en Supabase.

---

### Task 2: Web — exponer el campo y toggle de admin

**Files:**
- Modify: `js/data.js:71` (columna en `loadDB`)
- Modify: `js/app.js:39` (columna en el reload de `goTo('residents')`)
- Modify: `index.html:557-580` (checkbox en `modalEditResident`)
- Modify: `js/admin.js:230-261` (`editResidentModal`, `saveEditResident`)

**Interfaces:**
- Consumes: columna `exento_mantenimiento` de Task 1.
- Produces: `DB.residents[].exento_mantenimiento` / `DB.users[].exento_mantenimiento` /
  `currentUser.exento_mantenimiento` disponibles para Tasks 3 y 4 (currentUser ya los trae gratis
  vía `select('*')` en `js/auth.js:138`, sin cambios ahí).

- [ ] **Step 1: Agregar la columna a las dos listas explícitas**

En `js/data.js:71`:
```js
sb.listColumns('users', 'id,name,email,role,phone,depto,depto_status,fee,exento_mantenimiento,created_at'),
```

En `js/app.js:39`:
```js
const users = await sb.listColumns('users', 'id,name,email,role,phone,depto,depto_status,fee,exento_mantenimiento,created_at');
```

- [ ] **Step 2: Agregar el checkbox al modal de edición**

En `index.html`, dentro de `#modalEditResident` (después del `<select id="editResStatus">`, antes
de la línea informativa de la cuota, línea 573):
```html
      <div class="field"><label for="editResStatus">Estado</label>
        <select id="editResStatus"><option value="approved">Autorizado</option><option value="pending">Pendiente</option><option value="rejected">Rechazado</option></select>
      </div>
      <div class="field" style="margin-top:4px">
        <label style="display:flex;align-items:center;gap:8px;font-weight:400;cursor:pointer">
          <input type="checkbox" id="editResExento" style="width:16px;height:16px">
          Exento de cuota de mantenimiento
        </label>
      </div>
      <div style="font-size:11px;color:var(--mist)">La cuota mensual ($400) es la misma para todos los residentes y se controla desde Editar contactos.</div>
```

- [ ] **Step 3: Poblar y guardar el checkbox**

En `js/admin.js`, `editResidentModal()` (línea 230-240), agregar tras `editResStatus`:
```js
function editResidentModal(id) {
  const r = DB.residents.find(r=>r.id===id);
  if (!r) return;
  document.getElementById('editResId').value    = r.id;
  document.getElementById('editResName').value  = r.name  ||'';
  document.getElementById('editResEmail').value = r.email ||'';
  document.getElementById('editResPhone').value = r.phone ||'';
  document.getElementById('editResDepto').value = r.depto ||'';
  document.getElementById('editResStatus').value= r.status||'pending';
  document.getElementById('editResExento').checked = !!r.exento_mantenimiento;
  openModal('modalEditResident');
}
```

En `saveEditResident()` (línea 242-261):
```js
async function saveEditResident() {
  const id  = document.getElementById('editResId').value;
  const r   = DB.residents.find(r=>r.id===id);
  if (!r) return;
  const name   = document.getElementById('editResName').value.trim();
  const email  = document.getElementById('editResEmail').value.trim();
  const phone  = document.getElementById('editResPhone').value.trim();
  const depto  = document.getElementById('editResDepto').value.trim().toUpperCase().replace(/\s+/g,'');
  const status = document.getElementById('editResStatus').value;
  const exento = document.getElementById('editResExento').checked;
  try {
    await window.SUPABASE.update('users', id, { name, email, phone, depto, depto_status: status, exento_mantenimiento: exento });
    r.name=name; r.email=email; r.phone=phone; r.depto=depto; r.status=status; r.exento_mantenimiento=exento;
    const u = DB.users.find(u=>u.id===id);
    if (u) { u.name=name; u.email=email; u.phone=phone; u.depto=depto; u.depto_status=status; u.deptoStatus=status; u.exento_mantenimiento=exento; }
    closeModal('modalEditResident'); renderResidents(); showToast('Residente actualizado ✓');
  } catch(e) {
    console.error('Supabase update user failed', e);
    showToast('Error al guardar: '+(e?.message||e),'error');
  }
}
```

- [ ] **Step 4: Verificación manual**

Con el server local corriendo (o GitHub Pages), como admin: editar un residente, marcar el
checkbox, guardar, reabrir el modal de edición del mismo residente → el checkbox debe seguir
marcado. Confirmar en Supabase (`select exento_mantenimiento from users where id='<id>'`) que
guardó `true`.

- [ ] **Step 5: Commit**

```bash
git add js/data.js js/app.js js/admin.js index.html
git commit -m "feat: exención de cuota de mantenimiento por residente (web, admin)"
```

---

### Task 3: Web — ocultar cuota pagada/exenta, quitar tarjeta "En revisión", filtrar tipo de pago

**Files:**
- Modify: `js/app.js` (`checkPaymentBanner`, `renderMyPayments`, `renderMyAccount`,
  `openModalUploadPayment`)
- Modify: `index.html:340-343` (wrapper id en el bloque de cuota de `pageMyPayments`)

**Interfaces:**
- Consumes: `currentUser.exento_mantenimiento` (Task 2).

- [ ] **Step 1: Agregar wrapper id al bloque de cuota en `pageMyPayments`**

En `index.html`, dentro de `#residentBanner` (línea 340-343):
```html
          <div style="text-align:right" id="resFeeBlock">
            <div style="font-size:11px;color:var(--mist);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px">Cuota mensual</div>
            <div style="font-size:22px;font-weight:700;color:var(--gold)" id="resFeeDisplay">—</div>
          </div>
```
(solo se agregó `id="resFeeBlock"` al `<div style="text-align:right">` existente.)

- [ ] **Step 2: Ocultar el banner completo para residentes exentos, en `checkPaymentBanner()`**

```js
function checkPaymentBanner() {
  const today = new Date();
  const day   = today.getDate();
  const banner = document.getElementById('paymentDayBanner');
  if (!banner || !currentUser || currentUser.role === 'admin') return;
  if (currentUser.exento_mantenimiento) { banner.classList.add('hidden'); return; }
  if (day >= 1 && day <= 10) {
    const fee = currentUser.fee || DB.settings?.defaultFee || 400;
    const monthLabel = `${_MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;
    const monthName  = today.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    const alreadyPaid = DB.payments.some(p =>
      (p.residentId === currentUser.id || p.resident_id === currentUser.id ||
       p.residentName === currentUser.name || p.resident_name === currentUser.name) &&
      (p.category === 'Mantenimiento' || !p.category) &&
      p.status === 'approved' &&
      p.month === monthLabel
    );
    banner.classList.remove('hidden');
    banner.innerHTML = alreadyPaid ? `
      <div class="payment-alert-banner">
        <div class="payment-alert-icon">✅</div>
        <div class="payment-alert-text">
          <div class="payment-alert-title">Ya pagaste tu mantenimiento de ${monthName}</div>
          <div class="payment-alert-sub">Gracias por tu pago — puedes ver tu recibo en "Mis pagos".</div>
        </div>
      </div>` : `
      <div class="payment-alert-banner">
        <div class="payment-alert-icon">🗓️</div>
        <div class="payment-alert-text">
          <div class="payment-alert-title">Período de pago activo — días 1 al 10</div>
          <div class="payment-alert-sub">Tu cuota de mantenimiento de ${monthName} es <strong>${fmt(fee)}</strong>. Realiza tu pago antes del día 10.</div>
        </div>
        <button class="btn btn-gold btn-sm" onclick="openModalUploadPayment()">Pagar ahora</button>
      </div>`;
  } else {
    banner.classList.add('hidden');
  }
}
```
(único cambio real: la nueva línea `if (currentUser.exento_mantenimiento) { ...; return; }` justo
después del primer `if`.)

- [ ] **Step 3: Ocultar el bloque de cuota en `renderMyPayments()` cuando ya está pagada o exenta**

```js
function renderMyPayments() {
  if (!currentUser) return;
  checkPaymentBanner();

  const res = DB.residents.find(r =>
    r.userId === currentUser.id || r.user_id === currentUser.id || r.email === currentUser.email
  );
  const depto  = res?.depto  || currentUser.depto  || '—';
  const status = res?.status || currentUser.deptoStatus || currentUser.depto_status || (currentUser.depto ? 'approved' : 'pending');
  const fee    = currentUser.fee || DB.settings?.defaultFee || 400;

  const deptoNumEl    = document.getElementById('resDeptoNum');
  const deptoStatusEl = document.getElementById('resDeptoStatus');
  const feeBlockEl    = document.getElementById('resFeeBlock');
  const feeEl         = document.getElementById('resFeeDisplay');
  const ctaEl         = document.getElementById('uploadCTAArea');
  const alertEl       = document.getElementById('deptoVerifAlert');

  if (deptoNumEl)    deptoNumEl.textContent    = 'Depto ' + depto;
  if (deptoStatusEl) deptoStatusEl.textContent = status === 'approved' ? '✓ Verificado' : '⏳ Pendiente de verificación';
  if (feeEl)         feeEl.textContent         = fmt(fee);

  const currentMonthLabelMP = `${_MONTH_NAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const feeAlreadyPaidThisMonthMP = DB.payments.some(p =>
    (p.residentId === currentUser.id || p.resident_id === currentUser.id ||
     p.residentName === currentUser.name || p.resident_name === currentUser.name) &&
    (p.category === 'Mantenimiento' || !p.category) &&
    p.status === 'approved' &&
    p.month === currentMonthLabelMP
  );
  if (feeBlockEl) feeBlockEl.classList.toggle('hidden', feeAlreadyPaidThisMonthMP || !!currentUser.exento_mantenimiento);

  const isApproved = status === 'approved';
  if (!isApproved) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-info">Tu departamento está en proceso de verificación. El administrador te notificará cuando tengas acceso.</div>';
    if (ctaEl)   { ctaEl.style.opacity = '0.4'; ctaEl.style.pointerEvents = 'none'; }
  } else {
    if (alertEl) alertEl.innerHTML = '';
    if (ctaEl)   { ctaEl.style.opacity = '1'; ctaEl.style.pointerEvents = 'auto'; }
  }

  const notifEl = document.getElementById('userNotifications');
  if (notifEl) {
    const myNotifs = DB.notifications.filter(n =>
      (n.userId === currentUser.id || n.user_id === currentUser.id) && !n.isRead && !n.is_read
    );
    notifEl.innerHTML = myNotifs.map(n => `
      <div class="alert alert-error" style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
        <span>🔔 ${n.message}</span>
        <button class="btn btn-secondary btn-sm" onclick="markNotificationRead(${n.id})">Marcar como leído</button>
      </div>`).join('');
  }

  const myPays = DB.payments.filter(p =>
    (p.residentId === currentUser.id || p.resident_id === currentUser.id ||
     p.residentName === currentUser.name || p.resident_name === currentUser.name) &&
    p.category !== 'Multa' && p.category !== 'Adeudo'
  );
  const tbody = document.getElementById('tblMyPayments');
  if (tbody) {
    tbody.innerHTML = myPays
      .sort((a, b) => new Date(b.sentDate||b.sent_date) - new Date(a.sentDate||a.sent_date))
      .map(p => `<tr>
        <td>${escH(p.month||'—')}</td>
        <td>${fmt(p.amount)}</td>
        <td>${p.paymentDate || p.payment_date ? fmtDate(p.paymentDate||p.payment_date) : '—'}</td>
        <td>${fmtDate(p.sentDate||p.sent_date)}</td>
        <td><span class="badge ${p.status==='approved'?'badge-approved':p.status==='pending'?'badge-pending':'badge-rejected'}">${p.status==='approved'?'Aprobado':p.status==='pending'?'En revisión':'Rechazado'}</span></td>
        <td>${(p.receiptNum||p.receipt_num)
          ? `<button class="btn btn-secondary btn-sm" onclick="showReceipt(${p.id})">${p.receiptNum||p.receipt_num}</button>`
          : '—'}</td>
        <td style="display:flex;gap:4px;flex-wrap:wrap">
          <span class="badge ${(p.receiptUrl||p.receipt_url)?'badge-approved':'badge-rejected'}">${(p.receiptUrl||p.receipt_url)?'Recibo ✓':'Recibo ✕'}</span>
          <span class="badge ${(p.voucherUrl||p.voucher_url)?'badge-approved':'badge-rejected'}">${(p.voucherUrl||p.voucher_url)?'Comprobante ✓':'Comprobante ✕'}</span>
        </td>
      </tr>`).join('') ||
      '<tr><td colspan="7" style="text-align:center;color:var(--mist);padding:1.5rem">Sin pagos registrados</td></tr>';
  }
}
```
(cambios: variables `feeBlockEl`, `currentMonthLabelMP`/`feeAlreadyPaidThisMonthMP` nuevas, y la
línea `if (feeBlockEl) feeBlockEl.classList.toggle(...)`; el resto de la función queda igual —
se muestra completa por la regla de "código completo en cada step".)

- [ ] **Step 4: Quitar la tarjeta "En revisión" y ocultar "Cuota mensual" en `renderMyAccount()`**

```js
function renderMyAccount() {
  if (!currentUser) return;
  const myPays = DB.payments.filter(p =>
    p.residentId === currentUser.id || p.resident_id === currentUser.id ||
    p.residentName === currentUser.name || p.resident_name === currentUser.name
  );
  const approved = myPays.filter(p => p.status === 'approved');
  const pending  = myPays.filter(p => p.status === 'pending');
  const rejected = myPays.filter(p => p.status === 'rejected');
  const totalPaid = approved.reduce((s,p) => s + Number(p.amount||0), 0);
  const fee = currentUser.fee || DB.settings?.defaultFee || 400;
  const exento = !!currentUser.exento_mantenimiento;

  const area = document.getElementById('accountArea');
  if (!area) return;
  const isFineCharge = p => (p.category === 'Multa' || p.category === 'Adeudo') && !p.voucher_url && !p.voucherUrl;
  const pendingFines = myPays.filter(p => p.status === 'pending' && isFineCharge(p));
  const pendingFinesTotal = pendingFines.reduce((s,p) => s + Number(p.amount||0), 0);

  const currentMonthLabel = `${_MONTH_NAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const feeAlreadyPaidThisMonth = approved.some(p =>
    (p.category === 'Mantenimiento' || !p.category) && p.month === currentMonthLabel
  );
  const showFeeTile = !exento && !feeAlreadyPaidThisMonth;
  const totalOwed = (exento || feeAlreadyPaidThisMonth ? 0 : fee) + pendingFinesTotal;

  function statusLabel(p) {
    if (p.status === 'approved') return ['badge-approved', 'Pagado'];
    if (p.status === 'rejected') return ['badge-rejected', 'Rechazado'];
    if (isFineCharge(p)) return ['badge-rejected', 'Pendiente de pago'];
    return ['badge-pending', 'En revisión'];
  }

  area.innerHTML = `
    <div class="metrics" style="margin-bottom:1.5rem">
      <div class="metric"><div class="metric-label">Total pagado</div><div class="metric-value" style="color:var(--navy)">${fmt(totalPaid)}</div><div class="metric-change up">${approved.length} pagos aprobados</div></div>
      ${showFeeTile ? `<div class="metric"><div class="metric-label">Cuota mensual</div><div class="metric-value">${fmt(fee)}</div><div class="metric-change">mantenimiento</div></div>` : ''}
      ${pendingFinesTotal > 0 ? `<div class="metric" style="border-left:3px solid #dc2626"><div class="metric-label" style="color:#dc2626">Total adeudado este mes</div><div class="metric-value" style="color:#dc2626">${fmt(totalOwed)}</div><div class="metric-change">${(exento || feeAlreadyPaidThisMonth) ? '' : 'cuota + '}${pendingFines.length} cargo(s) pendiente(s)</div></div>` : ''}
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">Estado de cuenta</span></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Mes</th><th>Concepto</th><th>Monto</th><th>Fecha</th><th>Estado</th><th>Recibo</th></tr></thead>
        <tbody>
          ${myPays.sort((a,b)=>new Date(b.sentDate||b.sent_date)-new Date(a.sentDate||a.sent_date)).map(p=>{
            const [badgeCls, label] = statusLabel(p);
            return `<tr>
              <td>${escH(p.month||'—')}</td>
              <td>${p.category && p.category !== 'Mantenimiento' ? `<span class="badge ${p.category==='Multa'?'badge-rejected':'badge-pending'}" style="font-size:11px">${escH(p.category)}</span> ` : ''}${escH(p.description||'Cuota de mantenimiento')}</td>
              <td>${fmt(p.amount)}</td>
              <td>${p.approvedDate||p.approved_date ? fmtDate(p.approvedDate||p.approved_date) : p.sentDate||p.sent_date ? fmtDate(p.sentDate||p.sent_date) : '—'}</td>
              <td><span class="badge ${badgeCls}">${label}</span></td>
              <td>${(p.receiptNum||p.receipt_num)?`<button class="btn btn-secondary btn-sm" onclick="showReceipt(${p.id})">${escH(p.receiptNum||p.receipt_num)}</button>`:'—'}</td>
            </tr>`;
          }).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--mist);padding:1.5rem">Sin movimientos</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
}
```
(cambios respecto al original: `const exento = ...` nueva; se quitó por completo el
`<div class="metric">En revisión...</div>`; el tile "Cuota mensual" ahora está envuelto en
`${showFeeTile ? \`...\` : ''}`; `totalOwed` y el texto del tile de adeudado ahora consideran
`exento`.)

- [ ] **Step 5: Quitar "Mantenimiento" del selector de tipo de pago si el residente está exento**

En `openModalUploadPayment()`:
```js
function openModalUploadPayment() {
  const res    = DB.residents.find(r => r.userId===currentUser?.id||r.user_id===currentUser?.id||r.email===currentUser?.email);
  const status = res?.status || currentUser?.deptoStatus || currentUser?.depto_status || (currentUser?.depto ? 'approved' : 'pending');
  if (status !== 'approved') { showToast('Tu departamento aún no ha sido verificado', 'error'); return; }
  populatePayMonthOptions();
  const payTypeSel = document.getElementById('payType');
  if (payTypeSel) {
    const options = currentUser?.exento_mantenimiento
      ? [['Multa','Multa'],['Adeudo','Adeudo']]
      : [['Mantenimiento','Mantenimiento mensual'],['Multa','Multa'],['Adeudo','Adeudo']];
    payTypeSel.innerHTML = options.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  }
  document.getElementById('payAmount').value    = '';
  document.getElementById('payDate').value      = new Date().toISOString().split('T')[0];
  document.getElementById('uploadFileName').textContent = 'Sin archivo seleccionado';
  openModal('modalUploadPayment');
}
```

- [ ] **Step 6: Bump de versión de script**

En `index.html`, cambiar:
```html
<script src="js/app.js?v=20260709"></script>
```
a:
```html
<script src="js/app.js?v=20260711"></script>
```

- [ ] **Step 7: Verificación manual**

Abrir la app en navegador, iniciar sesión como un residente con un pago de Mantenimiento aprobado
este mes: la tarjeta "Cuota mensual" no debe aparecer en "Estado de cuenta" ni en "Mis pagos", y el
banner debe decir "Ya pagaste". Confirmar que la tarjeta "En revisión" ya no existe. Marcar a ese
residente como exento (Task 2), recargar sesión: banner oculto, tarjeta "Cuota mensual" oculta, y
el selector "Tipo de pago" al abrir "Subir comprobante" solo muestra Multa/Adeudo.

- [ ] **Step 8: Commit**

```bash
git add js/app.js index.html
git commit -m "fix: ocultar cuota mensual pagada/exenta y quitar tarjeta 'En revisión'"
```

---

### Task 4: Web — el recargo automático por atraso salta a residentes exentos

**Files:**
- Modify: `js/admin.js:1670-1720` (`checkAndApplyLateFees`)

**Interfaces:**
- Consumes: `resident.exento_mantenimiento` (viene de `visibleResidents()` → `DB.residents`, que ya
  trae el campo por Task 2).

- [ ] **Step 1: Saltar residentes exentos en el loop**

```js
async function checkAndApplyLateFees() {
  if (_lateFeeCheckDone) return;
  _lateFeeCheckDone = true;

  const today = new Date();
  if (today.getDate() <= 10) return; // Solo aplica pasado el día 10

  const currentMonthStr = MONTHS_ES[today.getMonth()] + ' ' + today.getFullYear();
  const approvedResidents = visibleResidents().filter(r => r.status === 'approved');
  let applied = 0;

  for (const resident of approvedResidents) {
    if (resident.exento_mantenimiento) continue;
    const rid = resident.id;

    // ¿Ya pagó el mantenimiento de este mes (aprobado o comprobante en revisión)?
    const hasPaid = DB.payments.some(p =>
      (p.resident_id === rid || p.residentId === rid) &&
      p.month === currentMonthStr &&
      (!p.category || p.category === 'Mantenimiento') &&
      (p.status === 'approved' || p.status === 'pending')
    );
    if (hasPaid) continue;

    // ¿Ya se le aplicó el recargo este mes?
    const alreadyCharged = DB.payments.some(p =>
      (p.resident_id === rid || p.residentId === rid) &&
      p.month === currentMonthStr &&
      p.category === 'Adeudo' &&
      p.description === 'Recargo por pago tardío'
    );
    if (alreadyCharged) continue;

    // Aplicar $50 de recargo
    try {
      const rows = await window.SUPABASE.insert('payments', {
        resident_id:   rid,
        resident_name: resident.name,
        depto:         resident.depto,
        month:         currentMonthStr,
        amount:        50,
        status:        'pending',
        type:          'income',
        description:   'Recargo por pago tardío',
        category:      'Adeudo',
        notes:         `Cargo automático por falta de pago antes del día 10 de ${currentMonthStr}`,
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row) {
        DB.payments.push(typeof normalizePayment === 'function' ? normalizePayment(row) : row);
        applied++;
      }
    } catch(e) {
      console.error('Error al aplicar recargo a depto', resident.depto, e);
    }
  }

  if (applied > 0) {
    showToast(`Recargo de $50 aplicado a ${applied} departamento(s) sin pago`);
    updatePendingCounts();
    if (document.getElementById('tblFines')) renderFines();
  }
}
```
(único cambio real respecto al original: la línea `if (resident.exento_mantenimiento) continue;`
justo después de `for (const resident of approvedResidents) {`; el resto de la función es idéntico
al código actual.)

- [ ] **Step 2: Bump de versión de script**

En `index.html`:
```html
<script src="js/admin.js?v=20260711"></script>
```

- [ ] **Step 3: Verificación manual**

Con un residente marcado exento y sin pago de mantenimiento este mes, después del día 10: entrar al
Dashboard de admin (dispara `checkAndApplyLateFees()`), confirmar en Supabase que NO se insertó
ningún registro `category='Adeudo', description='Recargo por pago tardío'` para ese residente. Con
un residente NO exento en la misma condición, sí debe generarse.

- [ ] **Step 4: Commit**

```bash
git add js/admin.js index.html
git commit -m "fix: recargo automático por atraso ya no aplica a residentes exentos"
```

---

### Task 5: Web — nuevo dashboard "Finanzas" para residentes

**Files:**
- Modify: `index.html` (nav item de residente, nueva sección `#pageMyFinances`)
- Modify: `js/app.js` (`goTo()` renders map, nueva función `renderMyFinances()`, nueva variable
  `myFinChartInstance`)

**Interfaces:**
- Consumes: `fn_resident_finances_summary(p_year)` (Task 1) vía
  `window.SUPABASE.client().rpc(...)` (mismo patrón que `calcRemanente()` en `js/admin.js:34-41`).

- [ ] **Step 1: Nav item de residente**

En `index.html`, dentro de `#navResident` (después del nav-item de "Estado de cuenta", línea
163-166):
```html
          <div class="nav-item" onclick="goTo('myAccount')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>Estado de cuenta</span>
          </div>
          <div class="nav-item" onclick="goTo('myFinances')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
            <span>Finanzas</span>
          </div>
```

- [ ] **Step 2: Sección de página nueva**

En `index.html`, después de `<!-- ── MY ACCOUNT (resident) ──────────────── -->` / `#pageMyAccount`
(línea 365-368), antes de `<!-- ── CONTACTS (resident) ──────────────── -->`:
```html
      <!-- ── MY FINANCES (resident) ─────────────────── -->
      <div id="pageMyFinances" class="page">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div><div class="page-title">Finanzas</div><div class="page-sub">Resumen financiero de la privada</div></div>
          <select id="myFinChartYear" style="padding:5px 10px;border:1px solid var(--c-border);border-radius:var(--r-sm);font-size:13px" onchange="renderMyFinances()"></select>
        </div>
        <div class="metrics" id="myFinMetrics"></div>
        <div class="card">
          <div class="card-head"><span class="card-title">Flujo mensual</span></div>
          <div class="card-body"><div class="chart-wrap"><canvas id="myFinChart"></canvas></div></div>
        </div>
      </div>
```

- [ ] **Step 3: `renderMyFinances()` y wiring en `goTo()`**

En `js/app.js`, junto a `let chartFlow = null;` (línea 16), agregar:
```js
let myFinChartInstance = null;
```

En el mapa `renders` dentro de `goTo()` (línea 53-67), agregar la entrada:
```js
  const renders = {
    dashboard:    renderDashboard,
    residents:    renderResidents,
    payments:     renderPayments,
    vouchers:     renderVouchers,
    finances:     renderFinances,
    reports:      renderReports,
    myPayments:   renderMyPayments,
    myAccount:    renderMyAccount,
    myFinances:   renderMyFinances,
    contacts:     renderContacts,
    editContacts: renderEditContacts,
    reglamento:   typeof renderReglamento === 'function' ? renderReglamento : null,
    fines:        typeof renderFines      === 'function' ? renderFines      : null,
    myReglamento: renderMyReglamento,
  };
```

Nueva función `renderMyFinances()`, agregada después de `renderMyAccount()`:
```js
/* ── MY FINANCES (resident, solo lectura) ──────────────────── */
async function renderMyFinances() {
  const yearSel = document.getElementById('myFinChartYear');
  const currentYear = new Date().getFullYear();
  if (yearSel && yearSel.children.length === 0) {
    for (let y = currentYear - 2; y <= currentYear; y++) {
      const o = document.createElement('option'); o.value = y; o.textContent = y;
      yearSel.appendChild(o);
    }
    yearSel.value = currentYear;
  }
  const year = Number(yearSel?.value || currentYear);

  const client = window.SUPABASE?.client?.();
  if (!client) return;
  const { data, error } = await client.rpc('fn_resident_finances_summary', { p_year: year });
  if (error) { console.error('fn_resident_finances_summary failed', error); return; }
  const rows = data || [];

  const totalIncome  = Number(rows[0]?.total_income)  || 0;
  const totalExpense = Number(rows[0]?.total_expense) || 0;
  const balance = totalIncome - totalExpense;

  const area = document.getElementById('myFinMetrics');
  if (area) area.innerHTML = `
    <div class="metric"><div class="metric-label">Balance total</div><div class="metric-value" style="color:${balance>=0?'var(--navy)':'var(--c-red)'}">${fmt(balance)}</div><div class="metric-change">Ingresos − Egresos</div></div>
    <div class="metric"><div class="metric-label">Ingresos totales</div><div class="metric-value">${fmt(totalIncome)}</div><div class="metric-change up">↑ acumulado</div></div>
    <div class="metric"><div class="metric-label">Egresos totales</div><div class="metric-value">${fmt(totalExpense)}</div><div class="metric-change down">↓ acumulado</div></div>`;

  const allMonthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  // month_start viene como 'YYYY-MM-DD'; no usar `new Date(string)` directo
  // (se interpreta como UTC medianoche y se corre un mes atrás en México) —
  // mismo cuidado que ya usa fmtDate() al inicio de este archivo.
  const monthIdxOf = s => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? +m[2]-1 : 0; };
  const monthNames = rows.map(r => allMonthNames[monthIdxOf(r.month_start)]);
  const incomes  = rows.map(r => Number(r.month_income)  || 0);
  const expenses = rows.map(r => Number(r.month_expense) || 0);

  if (myFinChartInstance) myFinChartInstance.destroy();
  const ctx = document.getElementById('myFinChart');
  if (ctx) myFinChartInstance = new Chart(ctx, {
    type:'bar',
    data:{labels:monthNames, datasets:[
      {label:'Ingresos', data:incomes,  backgroundColor:'rgba(200,154,43,0.3)', borderColor:'var(--gold)', borderWidth:2, borderRadius:4},
      {label:'Egresos',  data:expenses, backgroundColor:'rgba(139,32,32,0.2)',  borderColor:'var(--c-red)',  borderWidth:2, borderRadius:4}
    ]},
    options:{responsive:true, maintainAspectRatio:false,
      plugins:{legend:{labels:{font:{size:11}, color:'#3F4750'}}},
      scales:{x:{grid:{display:false}}, y:{grid:{color:'rgba(0,0,0,0.04)'}, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'k'}}}
    }
  });
}
```

- [ ] **Step 4: Bump de versión de script**

En `index.html` (mismo archivo/línea que Task 3 Step 6 — si Task 3 ya corrió, esta línea ya dice
`?v=20260711`; confirmar que sigue así, no bumpear dos veces el mismo día):
```html
<script src="js/app.js?v=20260711"></script>
```

- [ ] **Step 5: Verificación manual**

Iniciar sesión como residente, ir a "Finanzas": debe mostrar balance/ingresos/egresos totales y la
gráfica de flujo mensual, con los MISMOS números que ve el admin en su Dashboard para el mismo año
(comparar valores). Cambiar el año en el selector y confirmar que la gráfica se actualiza. Abrir
las herramientas de red del navegador y confirmar que la llamada de red es al RPC
`fn_resident_finances_summary` (no a un `select` directo de `payments`) — así se confirma que no se
está trayendo el detalle de transacciones de otros residentes al cliente.

- [ ] **Step 6: Commit**

```bash
git add js/app.js index.html
git commit -m "feat: dashboard de finanzas de solo lectura para residentes"
```

---

### Task 6: Mobile — exponer el campo y toggle de admin

**Files:**
- Modify: `mobile/src/services/data.js:76` (`USERS_COLUMNS`)
- Modify: `mobile/src/app/(admin)/residentes.jsx` (`EditResidentSheet`)

**Interfaces:**
- Consumes: columna `exento_mantenimiento` (Task 1).
- Produces: `resident.exento_mantenimiento` / `profile.exento_mantenimiento` disponibles para Tasks
  7 y 8 (`profile` ya lo trae gratis vía `select('*')` en `mobile/src/services/auth.js:4-12`, sin
  cambios ahí).

- [ ] **Step 1: Agregar la columna a `USERS_COLUMNS`**

En `mobile/src/services/data.js:76`:
```js
const USERS_COLUMNS = 'id,name,email,role,phone,depto,depto_status,fee,exento_mantenimiento,created_at';
```

- [ ] **Step 2: Toggle en `EditResidentSheet`**

En `mobile/src/app/(admin)/residentes.jsx`, agregar `STATUS_OPTIONS`-style opciones para el
toggle (junto a `STATUS_OPTIONS`, línea 21-25):
```js
const EXEMPT_OPTIONS = [
  { value: 'no', label: 'No' },
  { value: 'si', label: 'Sí, exento' },
];
```

En `EditResidentSheet` (línea 168-223), agregar estado y UI:
```jsx
function EditResidentSheet({ resident, onClose, onSaved, onDelete }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [depto, setDepto] = useState('');
  const [status, setStatus] = useState('pending');
  const [exempt, setExempt] = useState('no');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (resident) {
      setName(resident.name || '');
      setEmail(resident.email || '');
      setPhone(resident.phone || '');
      setDepto(resident.depto || '');
      setStatus(resident.status || 'pending');
      setExempt(resident.exento_mantenimiento ? 'si' : 'no');
    }
  }, [resident]);

  if (!resident) return null;

  async function handleSave() {
    setSaving(true);
    try {
      await saveResident(resident.id, {
        name, email, phone,
        depto: depto.toUpperCase().replace(/\s+/g, ''),
        depto_status: status,
        exento_mantenimiento: exempt === 'si',
      });
      onSaved();
      onClose();
    } catch (e) {
      AppAlert.alert('Error', 'No se pudo guardar: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible={!!resident}
      onClose={onClose}
      title="Editar residente"
      footer={
        <>
          <Button title="Eliminar" variant="danger" onPress={() => onDelete(resident)} style={{ height: 38 }} />
          <Button title="Guardar" variant="gold" loading={saving} onPress={handleSave} style={{ height: 38 }} />
        </>
      }
    >
      <Input label="Nombre" value={name} onChangeText={setName} style={{ marginBottom: 12 }} />
      <Input label="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" style={{ marginBottom: 12 }} />
      <Input label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={{ marginBottom: 12 }} />
      <Input label="Departamento" value={depto} onChangeText={setDepto} autoCapitalize="characters" style={{ marginBottom: 12 }} />
      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.slate, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Estado
      </Text>
      <ListPicker label="Estado" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.slate, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 }}>
        Exento de cuota de mantenimiento
      </Text>
      <ListPicker label="Exento de cuota de mantenimiento" value={exempt} onChange={setExempt} options={EXEMPT_OPTIONS} />
    </Sheet>
  );
}
```

- [ ] **Step 3: Verificación**

```bash
cd mobile
npx expo export --platform android
```
Expected: exporta sin errores. Verificación funcional manual (sin simulador en este entorno):
abrir la app en un dispositivo/simulador propio, editar un residente, marcar "Sí, exento", guardar,
reabrir → sigue marcado. Confirmar en Supabase que `exento_mantenimiento = true` para ese usuario.

- [ ] **Step 4: Commit**

```bash
cd mobile
git add src/services/data.js src/app/\(admin\)/residentes.jsx
git commit -m "feat: exención de cuota de mantenimiento por residente (mobile, admin)"
```

---

### Task 7: Mobile — ocultar cuota pagada/exenta, quitar tarjeta "En revisión", filtrar tipo de pago

**Files:**
- Modify: `mobile/src/app/(resident)/index.jsx`
- Modify: `mobile/src/app/(resident)/account.jsx`

**Interfaces:**
- Consumes: `profile.exento_mantenimiento` (Task 6).

- [ ] **Step 1: `index.jsx` — ocultar header de cuota y banners para exentos, filtrar `PAYMENT_TYPES`**

Reemplazar el archivo completo con:
```jsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from "expo-router/react-navigation";
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { Card } from '../../components/ui/Card';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { ListRow } from '../../components/ui/ListRow';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Sheet } from '../../components/ui/Sheet';
import { ReceiptSheet } from '../../components/ui/ReceiptSheet';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ListPicker } from '../../components/ui/ListPicker';
import { colors } from '../../theme/colors';
import { AppAlert } from '../../utils/alert';
import { pickImageWeb } from '../../utils/webImagePicker';
import { getCurrentProfile } from '../../services/auth';
import { fetchPayments, fetchNotifications, fetchSettings } from '../../services/data';
import { uploadVoucherImage, savePaymentRecord, markNotificationRead } from '../../services/resident';
import { fmt, fmtDate } from '../../utils/format';

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CURRENT_YEAR = new Date().getFullYear();
const MONTHS = MONTH_NAMES.map((m) => ({ value: `${m} ${CURRENT_YEAR}`, label: `${m} ${CURRENT_YEAR}` }));

export default function MyPaymentsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);
  const [payments, setPayments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [fee, setFee] = useState(400);
  const [uploadVisible, setUploadVisible] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState(null);

  const load = useCallback(async () => {
    try {
      const p = await getCurrentProfile();
      setProfile(p);
      const [allPayments, allNotifs, settings] = await Promise.all([fetchPayments(), fetchNotifications(), fetchSettings()]);
      setPayments(allPayments.filter((pay) => pay.residentId === p?.id || pay.resident_id === p?.id));
      setNotifications(allNotifs.filter((n) => (n.userId === p?.id || n.user_id === p?.id) && !n.isRead));
      setFee(p?.fee || settings.defaultFee);
    } catch (e) {
      console.error('No se pudo cargar Mis pagos', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !profile) {
    return (
      <ScreenContainer scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.navy} />
        </View>
      </ScreenContainer>
    );
  }

  const status = profile.deptoStatus || profile.depto_status || 'pending';
  const isApproved = status === 'approved';
  const isExempt = !!profile.exento_mantenimiento;
  const today = new Date();
  const inPaymentWindow = today.getDate() >= 1 && today.getDate() <= 10;
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

  async function handleMarkRead(n) {
    try {
      await markNotificationRead(n.id);
      setNotifications((prev) => prev.filter((x) => x.id !== n.id));
    } catch (e) {
      AppAlert.alert('Error', 'No se pudo actualizar la notificación');
    }
  }

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <View style={{ backgroundColor: colors.navy, borderRadius: 16, padding: 20, marginBottom: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontSize: 11, color: colors.mist, textTransform: 'uppercase', letterSpacing: 0.6 }}>Mi departamento</Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: colors.gold, marginTop: 4 }}>Depto {profile.depto || '—'}</Text>
          <Text style={{ fontSize: 12, color: colors.goldLight, marginTop: 4 }}>{isApproved ? '✓ Verificado' : '⏳ Pendiente de verificación'}</Text>
        </View>
        {!isExempt && !alreadyPaidThisMonth ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 11, color: colors.mist, textTransform: 'uppercase', letterSpacing: 0.6 }}>Cuota mensual</Text>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: colors.gold, marginTop: 4 }}>{fmt(fee)}</Text>
          </View>
        ) : null}
      </View>

      {!isApproved ? (
        <View style={{ backgroundColor: colors.infoBg, borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <Text style={{ color: colors.info, fontSize: 13 }}>Tu departamento está en proceso de verificación. Te notificaremos cuando tengas acceso.</Text>
        </View>
      ) : null}

      {isApproved && !isExempt && inPaymentWindow && alreadyPaidThisMonth ? (
        <View style={{ backgroundColor: colors.navy, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.gold }}>
          <Text style={{ fontFamily: 'Inter_600SemiBold', color: colors.gold, fontSize: 14 }}>✅ Ya pagaste tu mantenimiento de {monthLabel}</Text>
          <Text style={{ color: colors.goldLight, fontSize: 12, marginTop: 4 }}>Gracias por tu pago — puedes ver tu recibo tocando el pago en la lista de abajo.</Text>
        </View>
      ) : null}

      {isApproved && !isExempt && inPaymentWindow && !alreadyPaidThisMonth ? (
        <View style={{ backgroundColor: colors.navy, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.gold }}>
          <Text style={{ fontFamily: 'Inter_600SemiBold', color: colors.gold, fontSize: 14 }}>Período de pago activo — días 1 al 10</Text>
          <Text style={{ color: colors.goldLight, fontSize: 12, marginTop: 4 }}>
            Tu cuota de mantenimiento de {monthLabel} es {fmt(fee)}. Realiza tu pago antes del día 10.
          </Text>
          <Button title="Pagar ahora" variant="gold" onPress={() => setUploadVisible(true)} style={{ marginTop: 10, height: 36 }} />
        </View>
      ) : null}

      {notifications.map((n) => (
        <View key={n.id} style={{ backgroundColor: colors.errorBg, borderRadius: 10, padding: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="notifications-outline" size={18} color={colors.error} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.error }}>{n.message}</Text>
          <Pressable onPress={() => handleMarkRead(n)}>
            <Text style={{ fontSize: 11, color: colors.error, textDecorationLine: 'underline' }}>Marcar leído</Text>
          </Pressable>
        </View>
      ))}

      <Pressable
        disabled={!isApproved}
        onPress={() => setUploadVisible(true)}
        style={{
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: colors.gold,
          borderRadius: 16,
          padding: 28,
          alignItems: 'center',
          backgroundColor: colors.goldLight,
          opacity: isApproved ? 1 : 0.4,
          marginBottom: 16,
        }}
      >
        <Ionicons name="cloud-upload-outline" size={28} color={colors.gold} />
        <Text style={{ fontFamily: 'Inter_600SemiBold', color: colors.navy, marginTop: 8 }}>Subir comprobante de pago</Text>
        <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>Adjunta tu transferencia o depósito del mes</Text>
      </Pressable>

      <Card>
        <SectionHeader title="Mis pagos" />
        {payments.length === 0 ? (
          <EmptyState icon="card-outline" message="Sin pagos registrados" />
        ) : (
          [...payments]
            .sort((a, b) => new Date(b.sentDate || b.sent_date) - new Date(a.sentDate || a.sent_date))
            .map((p, i, arr) => (
              <ListRow
                key={p.id}
                last={i === arr.length - 1}
                title={`${p.month || '—'} · ${fmt(p.amount)}`}
                subtitle={`Enviado ${fmtDate(p.sentDate || p.sent_date)}`}
                onPress={p.status === 'approved' ? () => setViewingReceipt(p) : undefined}
                right={<Badge variant={p.status} label={p.status === 'pending' ? 'En revisión' : undefined} />}
              />
            ))
        )}
      </Card>

      <UploadSheet
        visible={uploadVisible}
        onClose={() => setUploadVisible(false)}
        profile={profile}
        onSaved={load}
      />
      <ReceiptSheet payment={viewingReceipt} onClose={() => setViewingReceipt(null)} />
    </ScreenContainer>
  );
}

const ALL_PAYMENT_TYPES = [
  { value: 'Mantenimiento', label: 'Mantenimiento mensual' },
  { value: 'Multa', label: 'Multa' },
  { value: 'Adeudo', label: 'Adeudo' },
];

function UploadSheet({ visible, onClose, profile, onSaved }) {
  const paymentTypes = profile?.exento_mantenimiento
    ? ALL_PAYMENT_TYPES.filter((t) => t.value !== 'Mantenimiento')
    : ALL_PAYMENT_TYPES;
  const [category, setCategory] = useState(paymentTypes[0].value);
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()].value);
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [asset, setAsset] = useState(null);
  const [saving, setSaving] = useState(false);

  async function pickImage() {
    // En web, expo-image-picker abre el selector con dispatchEvent(MouseEvent)
    // en vez de input.click() — los navegadores no abren el diálogo nativo de
    // archivos para eso, así que el botón no hace nada. Se usa un picker propio.
    if (Platform.OS === 'web') {
      const result = await pickImageWeb();
      if (!result.canceled && result.assets?.[0]) setAsset(result.assets[0]);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      AppAlert.alert('Permiso requerido', 'Necesitamos acceso a tus fotos para adjuntar el comprobante.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) setAsset(result.assets[0]);
  }

  async function handleSubmit() {
    const amt = parseFloat(amount);
    if (!amt) { AppAlert.alert('Falta el monto', 'Ingresa el monto pagado'); return; }
    if (!asset) { AppAlert.alert('Falta el comprobante', 'Adjunta una imagen del comprobante'); return; }
    setSaving(true);
    try {
      const voucherUrl = await uploadVoucherImage(asset, profile.depto);
      await savePaymentRecord({ month, amount: amt, voucherUrl, paymentDate, category }, profile, profile.depto);
      onSaved();
      setAmount(''); setAsset(null); setCategory(paymentTypes[0].value);
      onClose();
      AppAlert.alert('Listo', '✓ Comprobante enviado con imagen');
    } catch (e) {
      AppAlert.alert('Error', 'No se pudo enviar el comprobante: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Subir comprobante de pago"
      footer={<Button title="Enviar comprobante" variant="gold" loading={saving} onPress={handleSubmit} style={{ height: 38 }} />}
    >
      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.slate, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Tipo de pago</Text>
      <ListPicker label="Tipo de pago" value={category} onChange={setCategory} options={paymentTypes} />
      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.slate, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 }}>Mes de pago</Text>
      <ListPicker label="Mes de pago" value={month} onChange={setMonth} options={MONTHS} />
      <Input label="Monto pagado (MXN)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={{ marginTop: 14, marginBottom: 12 }} />
      <Input label="Fecha en que realizaste el pago" value={paymentDate} onChangeText={setPaymentDate} style={{ marginBottom: 14 }} />
      <Pressable
        onPress={pickImage}
        style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: colors.gold, borderRadius: 12, padding: 18, alignItems: 'center', backgroundColor: colors.goldLight }}
      >
        <Ionicons name="image-outline" size={24} color={colors.gold} />
        <Text style={{ fontSize: 13, color: colors.navy, marginTop: 6 }}>{asset ? 'Imagen seleccionada ✓' : 'Toca para seleccionar imagen'}</Text>
      </Pressable>
    </Sheet>
  );
}
```

- [ ] **Step 2: `account.jsx` — quitar tarjeta "En revisión", ocultar "Cuota mensual" si pagada/exenta**

Reemplazar el archivo completo con:
```jsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect } from "expo-router/react-navigation";

import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { ListRow } from '../../components/ui/ListRow';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { MetricCard } from '../../components/ui/MetricCard';
import { ReceiptSheet } from '../../components/ui/ReceiptSheet';
import { colors } from '../../theme/colors';
import { getCurrentProfile } from '../../services/auth';
import { fetchPayments, fetchSettings } from '../../services/data';
import { fmt, fmtDate } from '../../utils/format';

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function isFineCharge(p) {
  return (p.category === 'Multa' || p.category === 'Adeudo') && !p.voucher_url && !p.voucherUrl;
}

function paymentStatus(p) {
  if (p.status === 'approved') return { variant: 'approved', label: 'Pagado' };
  if (p.status === 'rejected') return { variant: 'rejected', label: 'Rechazado' };
  if (isFineCharge(p))        return { variant: 'rejected', label: 'Pendiente de pago' };
  return { variant: 'pending', label: 'En revisión' };
}

function paymentTitle(p) {
  const concept = p.description || (p.category === 'Mantenimiento' || !p.category ? 'Cuota de mantenimiento' : p.category);
  return p.month ? `${p.month} · ${concept}` : concept;
}

export default function MyAccountScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payments, setPayments] = useState([]);
  const [fee, setFee] = useState(400);
  const [exempt, setExempt] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState(null);

  const load = useCallback(async () => {
    try {
      const profile = await getCurrentProfile();
      const [allPayments, settings] = await Promise.all([fetchPayments(), fetchSettings()]);
      setPayments(allPayments.filter((p) => p.residentId === profile?.id || p.resident_id === profile?.id));
      setFee(profile?.fee || settings.defaultFee);
      setExempt(!!profile?.exento_mantenimiento);
    } catch (e) {
      console.error('No se pudo cargar el estado de cuenta', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.navy} />
        </View>
      </ScreenContainer>
    );
  }

  const approved = payments.filter((p) => p.status === 'approved');
  const pending = payments.filter((p) => p.status === 'pending');
  const totalPaid = approved.reduce((s, p) => s + Number(p.amount || 0), 0);

  const pendingFines = pending.filter(isFineCharge);
  const pendingFinesTotal = pendingFines.reduce((s, p) => s + Number(p.amount || 0), 0);

  // No sumar la cuota mensual si ya hay un pago de Mantenimiento aprobado
  // este mes, o si el residente está exento — si no, "Total adeudado" seguía
  // contando los $400 del mes ya pagado (o de una cuota que no le corresponde)
  // además de las multas/adeudos pendientes.
  const today = new Date();
  const currentMonthLabel = `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;
  const feeAlreadyPaidThisMonth = approved.some((p) =>
    (p.category === 'Mantenimiento' || !p.category) && p.month === currentMonthLabel
  );
  const showFeeTile = !exempt && !feeAlreadyPaidThisMonth;
  const totalOwed = (exempt || feeAlreadyPaidThisMonth ? 0 : fee) + pendingFinesTotal;

  const sorted = [...payments].sort((a, b) => new Date(b.sentDate || b.sent_date) - new Date(a.sentDate || a.sent_date));

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <PageHeader title="Estado de cuenta" subtitle="Historial de pagos y adeudos" />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <MetricCard label="Total pagado" value={fmt(totalPaid)} sub={`${approved.length} pagos aprobados`} />
        {showFeeTile ? <MetricCard label="Cuota mensual" value={fmt(fee)} sub="mantenimiento" /> : null}
        {pendingFinesTotal > 0 && (
          <MetricCard
            label="Total adeudado este mes"
            value={fmt(totalOwed)}
            sub={(exempt || feeAlreadyPaidThisMonth) ? `${pendingFines.length} cargo(s) pendiente(s)` : `cuota + ${pendingFines.length} cargo(s) pendiente(s)`}
            valueColor={colors.error}
            style={{ borderTopColor: colors.error }}
          />
        )}
      </View>

      {pendingFines.length > 0 && (
        <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <Text style={{ fontFamily: 'Inter_600SemiBold', color: '#b91c1c', marginBottom: 6 }}>
            ⚠ Tienes {pendingFines.length} cargo(s) pendiente(s)
          </Text>
          {pendingFines.map((p, i) => (
            <Text key={p.id ?? i} style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 2 }}>
              • {p.category}: {p.description || '—'} — {fmt(p.amount)} ({p.month || '—'})
            </Text>
          ))}
          <Text style={{ fontSize: 12, color: '#991b1b', marginTop: 6 }}>
            Puedes saldarlo desde "Mis pagos" → Subir comprobante, seleccionando el tipo de cargo (Multa o Adeudo) que corresponda.
          </Text>
        </View>
      )}

      <Card>
        <SectionHeader title="Estado de cuenta" />
        {sorted.length === 0 ? (
          <EmptyState message="Sin movimientos" />
        ) : (
          sorted.map((p, i) => {
            const { variant, label } = paymentStatus(p);
            return (
              <ListRow
                key={p.id}
                last={i === sorted.length - 1}
                title={paymentTitle(p)}
                subtitle={`${fmt(p.amount)} · ${fmtDate(p.approvedDate || p.approved_date || p.sentDate || p.sent_date)}`}
                onPress={p.status === 'approved' && (p.receiptNum || p.receipt_num) ? () => setViewingReceipt(p) : undefined}
                right={<Badge variant={variant} label={label} />}
              />
            );
          })
        )}
      </Card>
      <ReceiptSheet payment={viewingReceipt} onClose={() => setViewingReceipt(null)} />
    </ScreenContainer>
  );
}
```
(cambios respecto al original: nuevo state `exempt`/`setExempt`, poblado en `load()`; `showFeeTile`
nuevo; el `<MetricCard label="En revisión" .../>` se quitó por completo; el tile "Cuota mensual"
ahora es condicional; `totalOwed` y el `sub` del tile de adeudado ahora consideran `exempt`.)

- [ ] **Step 3: Verificación**

```bash
cd mobile
npx expo export --platform ios
npx expo export --platform android
```
Expected: ambos exportan sin errores. Verificación funcional manual (dispositivo/simulador propio):
residente con mantenimiento pagado este mes → no ve tarjeta "Cuota mensual" en ninguna pantalla, ni
banner de pago. Residente exento → mismo comportamiento, y el picker "Tipo de pago" al subir
comprobante no incluye "Mantenimiento mensual". Confirmar que la tarjeta "En revisión" ya no
aparece en Estado de cuenta.

- [ ] **Step 4: Commit**

```bash
cd mobile
git add "src/app/(resident)/index.jsx" "src/app/(resident)/account.jsx"
git commit -m "fix: ocultar cuota mensual pagada/exenta y quitar tarjeta 'En revisión' (mobile)"
```

---

### Task 8: Mobile — nueva pestaña "Finanzas" para residentes

**Files:**
- Create: `mobile/src/app/(resident)/finances.jsx`
- Modify: `mobile/src/app/(resident)/_layout.jsx`
- Modify: `mobile/src/services/data.js` (nueva función `fetchResidentFinancesSummary`)

**Interfaces:**
- Consumes: `fn_resident_finances_summary(p_year)` (Task 1).

- [ ] **Step 1: Nueva función de servicio**

En `mobile/src/services/data.js`, agregar después de `fetchResidentReport()` (línea 129-133):
```js
export async function fetchResidentFinancesSummary(year) {
  const { data, error } = await supabase.rpc('fn_resident_finances_summary', { p_year: year });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 2: Crear `finances.jsx`**

```jsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useFocusEffect } from "expo-router/react-navigation";

import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { MetricCard } from '../../components/ui/MetricCard';
import { Card } from '../../components/ui/Card';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { MiniBarChart } from '../../components/ui/MiniBarChart';
import { ListPicker } from '../../components/ui/ListPicker';
import { colors } from '../../theme/colors';
import { fetchResidentFinancesSummary } from '../../services/data';
import { fmt } from '../../utils/format';

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR].map((y) => ({ value: String(y), label: String(y) }));

// month_start viene como 'YYYY-MM-DD'; no usar `new Date(string)` directo
// (se interpreta como UTC medianoche y en México se corre un mes atrás).
function monthIndexFromDateStr(str) {
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Number(m[2]) - 1 : 0;
}

export default function ResidentFinancesScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState([]);
  const [year, setYear] = useState(String(CURRENT_YEAR));

  const load = useCallback(async (y) => {
    try {
      setRows(await fetchResidentFinancesSummary(Number(y)));
    } catch (e) {
      console.error('No se pudo cargar Finanzas', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(year); }, [load, year]));

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.navy} />
        </View>
      </ScreenContainer>
    );
  }

  const totalIncome = Number(rows[0]?.total_income) || 0;
  const totalExpense = Number(rows[0]?.total_expense) || 0;
  const balance = totalIncome - totalExpense;
  const chartData = rows.map((r) => ({
    label: MONTH_NAMES[monthIndexFromDateStr(r.month_start)],
    income: Number(r.month_income) || 0,
    expense: Number(r.month_expense) || 0,
  }));

  function handleYearChange(y) {
    setYear(y);
    setLoading(true);
    load(y);
  }

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(year); }}>
      <PageHeader title="Finanzas" subtitle="Resumen financiero de la privada" />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        <MetricCard label="Balance total" value={fmt(balance)} sub="Ingresos − Egresos" valueColor={balance >= 0 ? colors.navy : colors.error} />
        <MetricCard label="Ingresos totales" value={fmt(totalIncome)} sub="↑ acumulado" />
        <MetricCard label="Egresos totales" value={fmt(totalExpense)} sub="↓ acumulado" />
      </View>

      <Card>
        <SectionHeader
          title="Flujo mensual"
          right={<ListPicker label="Año" value={year} onChange={handleYearChange} options={YEAR_OPTIONS} />}
        />
        <View style={{ padding: 16 }}>
          <MiniBarChart data={chartData} />
        </View>
      </Card>
    </ScreenContainer>
  );
}
```

- [ ] **Step 3: Nuevo tab en el layout de residente**

En `mobile/src/app/(resident)/_layout.jsx`:
```jsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';

function tabIcon(name) {
  return ({ color, size }) => <Ionicons name={name} size={size} color={color} />;
}

export default function ResidentTabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.mist,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          height: 58 + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 10),
        },
        tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Mis pagos', tabBarIcon: tabIcon('card-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Estado de cuenta', tabBarIcon: tabIcon('document-text-outline') }} />
      <Tabs.Screen name="finances" options={{ title: 'Finanzas', tabBarIcon: tabIcon('stats-chart-outline') }} />
      <Tabs.Screen name="contacts" options={{ title: 'Contactos', tabBarIcon: tabIcon('call-outline') }} />
    </Tabs>
  );
}
```
(único cambio: la línea nueva `<Tabs.Screen name="finances" .../>` entre `account` y `contacts`.)

- [ ] **Step 4: Verificación**

```bash
cd mobile
npx expo export --platform ios
npx expo export --platform android
```
Expected: ambos exportan sin errores, sin módulos sin resolver. Verificación funcional manual
(dispositivo/simulador propio): el tab "Finanzas" aparece entre "Estado de cuenta" y "Contactos";
al abrirlo muestra los mismos totales que ve el admin en su Dashboard para el año seleccionado.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add "src/app/(resident)/finances.jsx" "src/app/(resident)/_layout.jsx" src/services/data.js
git commit -m "feat: pestaña de finanzas de solo lectura para residentes (mobile)"
```

---

## Self-Review Notes

- **Cobertura del spec:** A (ocultar cuota pagada) → Tasks 3, 7. B (quitar "En revisión") → Tasks 3,
  7. C (exención completa: schema, admin UI, ocultar cobro/banner/payType, cron) → Tasks 1, 2, 3, 4,
  6, 7. D (dashboard de finanzas para residentes) → Tasks 1, 5, 8.
- **Corrección de diseño vs. spec:** el spec asumía reutilizar la agregación cliente del dashboard
  de admin tal cual para D; la investigación de RLS (Task 1) mostró que eso no funcionaría para un
  residente real — se documentó la corrección y se agregó la función `fn_resident_finances_summary`
  como parte de Task 1, sin cambiar el alcance/comportamiento visible pedido por el usuario (mismos
  4 números + gráfica, nada más).
- **Placeholders:** ninguno — todo el código mostrado es completo y lista para pegar en cada
  archivo, no hay "TODO"/fragmentos parciales.
- **Consistencia de nombres:** `exento_mantenimiento` (DB) se usa igual en ambos codebases; en JS de
  web se lee como `currentUser.exento_mantenimiento`/`r.exento_mantenimiento`; en mobile como
  `profile.exento_mantenimiento`/`resident.exento_mantenimiento` — coincide con el patrón ya
  existente para `fee`/`depto_status` en cada codebase. `fn_resident_finances_summary` se llama
  igual en Task 5 (web, vía `client.rpc`) y Task 8 (mobile, vía `supabase.rpc` en el nuevo
  `fetchResidentFinancesSummary`).
