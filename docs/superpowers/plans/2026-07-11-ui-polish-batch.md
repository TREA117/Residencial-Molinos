# Lote de ajustes de UI/UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar el lote de 12 ajustes de UI/UX del spec `2026-07-11-ui-polish-batch-design.md` en
web y mobile (Android/iOS), y publicar los cambios de mobile a las pruebas internas vía EAS.

**Architecture:** Cambios de UI/lógica en `js/app.js`/`js/admin.js`/`index.html` (web) y en las
pantallas equivalentes de `mobile/src/app/(admin)/*` y `mobile/src/app/(resident)/*` (mobile), más
una extensión de la función Postgres `fn_resident_finances_summary` (agrega 2 columnas para
"Mantenimientos pagados" sin crear una función nueva).

**Tech Stack:** Vanilla JS + Chart.js (web), Expo/React Native (mobile), Supabase Postgres, EAS
Update/Build.

## Global Constraints

- No se corrige el bug de "Total adeudado" no apareciendo cuando solo la cuota (sin multas) está
  pendiente — explícitamente fuera de alcance.
- No se construye cron real en Supabase (pg_cron/Edge Function) para la limpieza de archivos — se
  usa el mismo patrón "corre cuando un admin abre la app" que ya usa `checkAndApplyLateFees`.
- El filtro de semestre siempre son 2 opciones por año listadas como `"${año} (Ene-Jun)"` /
  `"${año} (Jul-Dic)"`, solo si ese semestre tiene movimientos aprobados; default = semestre que
  contiene el mes actual.
- El selector de "año a pagar" del pago de año completo son exactamente 2 opciones: año actual y
  año actual + 1.
- Al modificar `js/app.js` o `js/admin.js`, bumpear `?v=YYYYMMDD` en `index.html` a `20260711b` (ya
  están en `20260711` de la sesión anterior el mismo día).
- Mobile no requiere nuevas dependencias nativas en este lote — el publish final puede ir por
  `eas update` (OTA) en vez de un build nativo completo.

---

### Task 1: Base de datos — extender `fn_resident_finances_summary`

**Files:**
- Ninguno en los repos — se aplica vía Supabase MCP (`apply_migration`), `project_id: qxjuztctbpwymmskdyqw`.

**Interfaces:**
- Produces: `fn_resident_finances_summary(p_year integer, p_current_month_label text)` →
  `(total_income numeric, total_expense numeric, month_start date, month_income numeric, month_expense numeric, maintenance_paid_count integer, maintenance_total_residents integer)`
  — reemplaza la firma anterior (`p_year` solo), consumida por Tasks 11 y 20.

- [ ] **Step 1: Aplicar la migración**

`apply_migration`, `name: fn_resident_finances_summary_maintenance_count`:

```sql
DROP FUNCTION IF EXISTS public.fn_resident_finances_summary(integer);

CREATE OR REPLACE FUNCTION public.fn_resident_finances_summary(p_year integer, p_current_month_label text)
 RETURNS TABLE(total_income numeric, total_expense numeric, month_start date, month_income numeric, month_expense numeric, maintenance_paid_count integer, maintenance_total_residents integer)
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
          and p.month ilike '%' || p_current_month_label || '%')::integer as paid_count,
      (select count(*) from public.users u where u.depto_status = 'approved')::integer as total_residents
  )
  select t.total_income, t.total_expense, mo.month_start, mo.month_income, mo.month_expense,
         ma.paid_count, ma.total_residents
  from totals t, monthly mo, maint ma
  order by mo.month_start;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_resident_finances_summary(integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_resident_finances_summary(integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_resident_finances_summary(integer, text) TO authenticated;
```

- [ ] **Step 2: Verificar que la firma vieja ya no existe y la nueva funciona**

`execute_sql`:
```sql
select * from public.fn_resident_finances_summary(2026, 'julio 2026');
```
Expected: 12 filas, cada una con `maintenance_paid_count`/`maintenance_total_residents` iguales
(agregados globales, no por mes), sin error.

- [ ] **Step 3: Verificar permisos**

```sql
select has_function_privilege('anon', 'public.fn_resident_finances_summary(integer, text)', 'EXECUTE') as anon_can,
       has_function_privilege('authenticated', 'public.fn_resident_finances_summary(integer, text)', 'EXECUTE') as auth_can;
```
Expected: `anon_can = false`, `auth_can = true`.

No hay commit de git — el cambio vive en Supabase.

---

### Task 2: Web — pago de año completo, selector de años

**Files:**
- Modify: `js/admin.js` (`openCashPaymentModal`, `onCashFullYearChange`, `saveCashPaymentFullYear`)
- Modify: `index.html` (checkbox label, línea 626)

**Interfaces:**
- Produces: `_populateCashMonthOptions()`, `_populateCashYearOptions()` — nuevas funciones helper,
  no consumidas fuera de este archivo.

- [ ] **Step 1: Extraer la población de meses a una función reusable**

En `js/admin.js`, reemplazar el bloque de `openCashPaymentModal()` que puebla `#cashMonth`:

```js
function openCashPaymentModal() {
  // Residentes autorizados ordenados por depto
  const sel = document.getElementById('cashResidentId');
  sel.innerHTML = visibleResidents()
    .filter(r => r.status === 'approved')
    .sort((a, b) => (a.depto||'').localeCompare(b.depto||''))
    .map(r => `<option value="${escH(r.id)}">${escH(r.depto)} — ${escH(r.name)}</option>`)
    .join('');
  document.getElementById('cashAmount').value = DB.settings?.defaultFee || 400;
  document.getElementById('cashDate').value   = new Date().toISOString().split('T')[0];
  document.getElementById('cashNotes').value  = '';
  document.getElementById('cashType').value   = 'Mantenimiento';
  document.getElementById('cashFineSection')?.classList.add('hidden');
  document.getElementById('cashFullYear').checked = false;
  document.getElementById('cashFullYearField')?.classList.remove('hidden');
  onCashFullYearChange();
  openModal('modalCashPayment');
}

function _populateCashMonthOptions() {
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mSel = document.getElementById('cashMonth');
  const now = new Date();
  const opts = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    opts.push(`<option value="${label}"${i===0?' selected':''}>${label}</option>`);
  }
  mSel.innerHTML = opts.join('');
}

function _populateCashYearOptions() {
  const mSel = document.getElementById('cashMonth');
  const currentYear = new Date().getFullYear();
  mSel.innerHTML = [currentYear, currentYear + 1]
    .map(y => `<option value="${y}"${y===currentYear?' selected':''}>${y}</option>`)
    .join('');
}
```

- [ ] **Step 2: `onCashFullYearChange()` reconstruye las opciones según el checkbox**

```js
function onCashFullYearChange() {
  const fullYear = document.getElementById('cashFullYear').checked;
  document.getElementById('cashMonthLabel').textContent = fullYear ? 'Año' : 'Mes de pago';
  document.getElementById('cashAmountLabel').textContent = fullYear ? 'Monto mensual ($)' : 'Monto ($)';
  if (fullYear) {
    _populateCashYearOptions();
  } else {
    _populateCashMonthOptions();
  }
}
```

- [ ] **Step 3: Simplificar la extracción del año en `saveCashPaymentFullYear()`**

En `js/admin.js`, dentro de `saveCashPaymentFullYear()`, cambiar:
```js
  const year = monthSel.split(' ').pop();
```
por:
```js
  const year = monthSel;
```
(`monthSel` es `document.getElementById('cashMonth').value` — ahora ya es directamente el año,
p.ej. `"2026"`, sin necesidad de extraerlo de un string "Mes Año".)

- [ ] **Step 4: Acortar el texto del checkbox**

En `index.html:626`, cambiar:
```html
    Registrar el año completo (12 meses) en vez de solo un mes
```
por:
```html
    Registrar el año completo
```

- [ ] **Step 5: Validar sintaxis**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/admin.js
```
Expected: sin salida (sin errores).

- [ ] **Step 6: Commit**

```bash
git add js/admin.js index.html
git commit -m "fix: selector de año (no meses) al registrar pago de año completo"
```

---

### Task 3: Mobile — pago de año completo, selector de años

**Files:**
- Modify: `mobile/src/app/(admin)/comprobantes.jsx` (`CashPaymentSheet`)

**Interfaces:**
- Consumes: `saveCashPaymentFullYear({ year, ... })` de `../../services/admin` (ya recibe `year`
  como string, sin cambios en ese servicio).

- [ ] **Step 1: Agregar `yearOptions` y reiniciar `month` al alternar `fullYear`**

En `CashPaymentSheet` (`comprobantes.jsx`), reemplazar el bloque desde la declaración de
`monthOptions` hasta el segundo `useEffect`:

```jsx
function CashPaymentSheet({ visible, onClose, residents, payments, onSaved }) {
  const monthOptions = Array.from({ length: 13 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const label = `${CASH_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    return { value: label, label };
  });
  const yearOptions = [0, 1].map((i) => {
    const y = new Date().getFullYear() + i;
    return { value: String(y), label: String(y) };
  });
  const residentOptions = [...residents]
    .filter((r) => r.depto_status === 'approved')
    .sort((a, b) => (a.depto || '').localeCompare(b.depto || ''))
    .map((r) => ({ value: r.id, label: `${r.depto || '—'} — ${r.name}` }));

  const [residentId, setResidentId] = useState('');
  const [month, setMonth] = useState(monthOptions[0]?.value || '');
  const [category, setCategory] = useState('Mantenimiento');
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [linkedFineId, setLinkedFineId] = useState('');
  const [fullYear, setFullYear] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setResidentId(''); setMonth(monthOptions[0]?.value || ''); setCategory('Mantenimiento');
      setAmount(''); setPayDate(new Date().toISOString().split('T')[0]); setNotes(''); setLinkedFineId('');
      setFullYear(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const isFineType = category === 'Multa' || category === 'Adeudo';

  useEffect(() => {
    if (isFineType && fullYear) setFullYear(false);
  }, [isFineType, fullYear]);

  useEffect(() => {
    setMonth(fullYear ? yearOptions[0].value : monthOptions[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullYear]);
```
(el resto del componente, desde `const fineOptions = [...]` en adelante, no cambia en este step.)

- [ ] **Step 2: Simplificar la extracción del año en `handleSave()`**

Cambiar:
```js
      if (fullYear && !isFineType) {
        const year = month.split(' ').pop();
```
por:
```js
      if (fullYear && !isFineType) {
        const year = month;
```

- [ ] **Step 3: Usar `yearOptions` en el `ListPicker` y acortar textos**

Cambiar:
```jsx
          <Text style={{ fontSize: 13, color: colors.navy, flex: 1 }}>Registrar el año completo (12 meses) en vez de solo un mes</Text>
        </Pressable>
      )}
      <ListPicker label={fullYear ? 'Año (elige cualquier mes de ese año)' : 'Mes'} value={month} onChange={setMonth} options={monthOptions} style={{ marginBottom: 12 }} />
```
por:
```jsx
          <Text style={{ fontSize: 13, color: colors.navy, flex: 1 }}>Registrar el año completo</Text>
        </Pressable>
      )}
      <ListPicker label={fullYear ? 'Año' : 'Mes'} value={month} onChange={setMonth} options={fullYear ? yearOptions : monthOptions} style={{ marginBottom: 12 }} />
```

- [ ] **Step 4: Validar**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform android
```
Expected: exporta sin errores.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
rm -rf dist
git add "src/app/(admin)/comprobantes.jsx"
git commit -m "fix: selector de año (no meses) al registrar pago de año completo (mobile)"
```

---

### Task 4: Web — filtro de semestre en Dashboard de admin

**Files:**
- Modify: `js/admin.js` (`renderCharts`)

**Interfaces:**
- Produces: reemplaza el `<select id="chartFlowYear">` de años por opciones de semestre; consumido
  visualmente, sin interfaz de código hacia otras tasks.

- [ ] **Step 1: Reescribir `renderCharts()` con filtro de semestres**

```js
function renderCharts() {
  const approved = DB.payments.filter(p=>p.status==='approved');
  const txDate = p => p.approvedDate||p.approved_date||'';
  const allMonthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  const years = [...new Set(approved.map(p=>String(txDate(p)).slice(0,4)).filter(y=>/^\d{4}$/.test(y)))];
  const currentYear = String(new Date().getFullYear());
  if (!years.includes(currentYear)) years.push(currentYear);
  years.sort();

  function halfHasData(year, half) {
    const startMonth = half === 1 ? 0 : 6;
    return approved.some(p => {
      const m = String(txDate(p)).match(/^(\d{4})-(\d{2})/);
      if (!m || m[1] !== year) return false;
      const monthIdx = Number(m[2]) - 1;
      return monthIdx >= startMonth && monthIdx < startMonth + 6;
    });
  }

  const options = [];
  years.forEach(y => {
    [1, 2].forEach(half => {
      if (halfHasData(y, half)) {
        options.push({
          value: `${y}-${half}`,
          label: half === 1 ? `${y} (Ene-Jun)` : `${y} (Jul-Dic)`,
        });
      }
    });
  });
  // Siempre incluir el semestre actual aunque no tenga datos, para que el
  // filtro nunca quede vacío en un dashboard recién estrenado.
  const today = new Date();
  const currentHalf = today.getMonth() < 6 ? 1 : 2;
  const currentValue = `${currentYear}-${currentHalf}`;
  if (!options.some(o => o.value === currentValue)) {
    options.push({ value: currentValue, label: currentHalf === 1 ? `${currentYear} (Ene-Jun)` : `${currentYear} (Jul-Dic)` });
  }
  options.sort((a, b) => a.value.localeCompare(b.value));

  const yearSel = document.getElementById('chartFlowYear');
  if (yearSel && yearSel.children.length === 0) {
    options.forEach(o => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; yearSel.appendChild(opt); });
    yearSel.value = currentValue;
  }
  const [selYear, selHalf] = (yearSel?.value || currentValue).split('-');
  const startIdx = selHalf === '1' ? 0 : 6;

  const monthNames = allMonthNames.slice(startIdx, startIdx + 6);
  const mKeys = monthNames.map((_,i)=>`${selYear}-${String(startIdx+i+1).padStart(2,'0')}`);
  const incomes  = mKeys.map(m=>approved.filter(p=>p.type==='income' &&String(txDate(p)).startsWith(m)).reduce((s,p)=>s+Number(p.amount||0),0));
  const expenses = mKeys.map(m=>approved.filter(p=>p.type==='expense'&&String(txDate(p)).startsWith(m)).reduce((s,p)=>s+Number(p.amount||0),0));
  if (chartFlow) chartFlow.destroy();
  const ctx1 = document.getElementById('chartFlow');
  if (ctx1) chartFlow = new Chart(ctx1, {
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
(`onchange="renderCharts()"` en `#chartFlowYear`, ya existente en `index.html:202`, sigue
funcionando igual — el `<select>` ahora solo tiene opciones de semestre en vez de años.)

- [ ] **Step 2: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/admin.js
git add js/admin.js
git commit -m "feat: filtro de semestre (6 meses) en la gráfica de flujo mensual del dashboard"
```

---

### Task 5: Web — filtro de semestre en Finanzas de residentes + "Mantenimientos pagados"

**Files:**
- Modify: `js/app.js` (`renderMyFinances`)
- Modify: `index.html` (agregar `id="myFinMaint"` metric, quitar captions)

**Interfaces:**
- Consumes: `fn_resident_finances_summary(p_year, p_current_month_label)` (Task 1).

- [ ] **Step 1: Agregar tarjeta "Mantenimientos pagados" a la sección de Finanzas**

En `index.html`, dentro de `#pageMyFinances` (agregado en la sesión anterior), el `<div class="metrics" id="myFinMetrics"></div>` ya existe y se llena dinámicamente por `renderMyFinances()` —
no requiere cambio de markup, solo de la función (Step 2).

- [ ] **Step 2: Reescribir `renderMyFinances()` con semestres, sin captions, con Mantenimientos pagados**

```js
async function renderMyFinances() {
  const client = window.SUPABASE?.client?.();
  if (!client) return;
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonthLabel = `${today.toLocaleDateString('es-MX', { month: 'long' })} ${currentYear}`;

  const [curRes, prevRes] = await Promise.all([
    client.rpc('fn_resident_finances_summary', { p_year: currentYear, p_current_month_label: currentMonthLabel }),
    client.rpc('fn_resident_finances_summary', { p_year: currentYear - 1, p_current_month_label: currentMonthLabel }),
  ]);
  if (curRes.error) { console.error('fn_resident_finances_summary failed', curRes.error); return; }
  if (prevRes.error) { console.error('fn_resident_finances_summary failed', prevRes.error); return; }
  const dataByYear = { [currentYear]: curRes.data || [], [currentYear - 1]: prevRes.data || [] };

  const allMonthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  function monthIdxOf(s) { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? +m[2]-1 : 0; }
  function halfRows(year, half) {
    const rows = dataByYear[year] || [];
    const startIdx = half === 1 ? 0 : 6;
    return rows.filter(r => { const idx = monthIdxOf(r.month_start); return idx >= startIdx && idx < startIdx + 6; });
  }
  function halfHasData(year, half) {
    return halfRows(year, half).some(r => Number(r.month_income) > 0 || Number(r.month_expense) > 0);
  }

  const options = [];
  [currentYear - 1, currentYear].forEach(y => {
    [1, 2].forEach(half => { if (halfHasData(y, half)) options.push({ year: y, half }); });
  });
  const currentHalf = today.getMonth() < 6 ? 1 : 2;
  if (!options.some(o => o.year === currentYear && o.half === currentHalf)) {
    options.push({ year: currentYear, half: currentHalf });
  }
  options.sort((a, b) => a.year - b.year || a.half - b.half);

  const yearSel = document.getElementById('myFinChartYear');
  if (yearSel && yearSel.children.length === 0) {
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = `${o.year}-${o.half}`;
      opt.textContent = o.half === 1 ? `${o.year} (Ene-Jun)` : `${o.year} (Jul-Dic)`;
      yearSel.appendChild(opt);
    });
    yearSel.value = `${currentYear}-${currentHalf}`;
  }
  const [selYearStr, selHalfStr] = (yearSel?.value || `${currentYear}-${currentHalf}`).split('-');
  const rows = halfRows(Number(selYearStr), Number(selHalfStr));

  const totalIncome  = Number((dataByYear[currentYear] || [])[0]?.total_income)  || 0;
  const totalExpense = Number((dataByYear[currentYear] || [])[0]?.total_expense) || 0;
  const balance = totalIncome - totalExpense;
  const maintPaid  = Number((dataByYear[currentYear] || [])[0]?.maintenance_paid_count) || 0;
  const maintTotal = Number((dataByYear[currentYear] || [])[0]?.maintenance_total_residents) || 0;

  const area = document.getElementById('myFinMetrics');
  if (area) area.innerHTML = `
    <div class="metric"><div class="metric-label">Balance total</div><div class="metric-value" style="color:${balance>=0?'var(--navy)':'var(--c-red)'}">${fmt(balance)}</div></div>
    <div class="metric"><div class="metric-label">Ingresos totales</div><div class="metric-value">${fmt(totalIncome)}</div></div>
    <div class="metric"><div class="metric-label">Egresos totales</div><div class="metric-value">${fmt(totalExpense)}</div></div>
    <div class="metric"><div class="metric-label">Mantenimientos pagados</div><div class="metric-value">${maintPaid}/${maintTotal}</div></div>`;

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
(reemplaza por completo la función `renderMyFinances()` agregada la sesión anterior en `js/app.js`;
`myFinChartInstance`, ya declarado como variable de módulo, no cambia. `#myFinChartYear`'s
`onchange="renderMyFinances()"` en `index.html` sigue funcionando igual.)

- [ ] **Step 2: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/app.js
git add js/app.js
git commit -m "feat: filtro de semestre y tarjeta Mantenimientos pagados en Finanzas de residentes"
```

---

### Task 6: Mobile — filtro de semestre en Dashboard de admin + Mantenimientos pagados

**Files:**
- Modify: `mobile/src/app/(admin)/index.jsx` (`AdminDashboard`)

**Interfaces:**
- Ninguna nueva — usa `payments`/`residents` ya cargados en el estado del componente.

- [ ] **Step 1: Reescribir el cálculo de años/semestre y las tarjetas de métrica**

Reemplazar desde `const years = ...` hasta el final del `return` del componente:

```jsx
  const years = [...new Set(approved.map((p) => String(p.approvedDate || p.approved_date || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))];
  const currentYear = String(new Date().getFullYear());
  if (!years.includes(currentYear)) years.push(currentYear);
  years.sort();

  function monthIdxFromDate(str) {
    const m = String(str).match(/^(\d{4})-(\d{2})/);
    return m ? { year: m[1], idx: Number(m[2]) - 1 } : null;
  }
  function halfHasData(y, half) {
    const startIdx = half === 1 ? 0 : 6;
    return approved.some((p) => {
      const d = monthIdxFromDate(p.approvedDate || p.approved_date || '');
      return d && d.year === y && d.idx >= startIdx && d.idx < startIdx + 6;
    });
  }

  const semesterOptions = [];
  years.forEach((y) => { [1, 2].forEach((half) => { if (halfHasData(y, half)) semesterOptions.push({ y, half }); }); });
  const today = new Date();
  const currentHalf = today.getMonth() < 6 ? 1 : 2;
  if (!semesterOptions.some((o) => o.y === currentYear && o.half === currentHalf)) {
    semesterOptions.push({ y: currentYear, half: currentHalf });
  }
  semesterOptions.sort((a, b) => a.y.localeCompare(b.y) || a.half - b.half);
  const semesterValueOptions = semesterOptions.map((o) => ({
    value: `${o.y}-${o.half}`,
    label: o.half === 1 ? `${o.y} (Ene-Jun)` : `${o.y} (Jul-Dic)`,
  }));
  const [selYear, selHalfStr] = semester.split('-');
  const selHalf = Number(selHalfStr);
  const startIdx = selHalf === 1 ? 0 : 6;
  const chartData = MONTH_NAMES.slice(startIdx, startIdx + 6).map((label, i) => {
    const key = `${selYear}-${String(startIdx + i + 1).padStart(2, '0')}`;
    const income = approved.filter((p) => p.type === 'income' && String(p.approvedDate || p.approved_date || '').startsWith(key)).reduce((s, p) => s + Number(p.amount || 0), 0);
    const expense = approved.filter((p) => p.type === 'expense' && String(p.approvedDate || p.approved_date || '').startsWith(key)).reduce((s, p) => s + Number(p.amount || 0), 0);
    return { label, income, expense };
  });

  const currentMonthLabel = `${MONTH_NAMES_FULL[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const maintPaidCount = new Set(
    approved
      .filter((p) => (p.category === 'Mantenimiento' || !p.category) && p.month === currentMonthLabel)
      .map((p) => p.residentId || p.resident_id)
  ).size;

  const recent = payments
    .map((p) => {
      const isResident = !!(p.residentId || p.resident_id);
      const descBase = p.description || (isResident ? 'Pago ' + (p.month || '') + ' — Depto ' + (p.depto || '') : '—');
      const date = p.approvedDate || p.approved_date || p.sentDate || p.sent_date;
      const dispType = p.status === 'pending' || p.status === 'rejected' ? 'payment' : p.type;
      return { date, desc: descBase, provider: p.provider, type: dispType, amount: p.amount, status: p.status };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <PageHeader title="Dashboard" subtitle="Resumen general de la privada" />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        <MetricCard label="Balance total" value={fmt(balance)} valueColor={balance >= 0 ? colors.navy : colors.error} />
        <MetricCard label="Ingresos totales" value={fmt(totalIncome)} />
        <MetricCard label="Egresos totales" value={fmt(totalExpense)} />
        <MetricCard label="Mantenimientos pagados" value={`${maintPaidCount}/${approvedRes}`} />
      </View>

      <Card style={{ marginBottom: 18 }}>
        <SectionHeader
          title="Flujo mensual"
          right={<ListPicker label="Semestre" value={semester} onChange={setSemester} options={semesterValueOptions} />}
        />
        <View style={{ padding: 16 }}>
          <MiniBarChart data={chartData} />
        </View>
      </Card>

      <Card>
        <SectionHeader title="Actividad reciente" />
        {recent.length === 0 ? (
          <EmptyState message="Aún no hay movimientos registrados" />
        ) : (
          recent.map((r, i) => (
            <ListRow
              key={i}
              last={i === recent.length - 1}
              title={r.desc}
              subtitle={r.provider ? `${r.provider} · ${fmtDate(r.date)}` : fmtDate(r.date)}
              right={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: r.type === 'income' ? colors.navy : colors.error }}>
                    {r.type === 'income' ? '+' : '−'}{fmt(r.amount)}
                  </Text>
                  <Badge variant={r.status} />
                </View>
              }
            />
          ))
        )}
      </Card>
    </ScreenContainer>
  );
}
```

- [ ] **Step 2: Reemplazar el `useState(year)` por `useState(semester)` y agregar `MONTH_NAMES_FULL`**

Cambiar:
```jsx
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
```
por:
```jsx
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTH_NAMES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
```
Y dentro de `AdminDashboard`, cambiar:
```jsx
  const [year, setYear] = useState(String(new Date().getFullYear()));
```
por:
```jsx
  const _today0 = new Date();
  const [semester, setSemester] = useState(`${_today0.getFullYear()}-${_today0.getMonth() < 6 ? 1 : 2}`);
```

- [ ] **Step 3: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform android
npx expo export --platform ios
rm -rf dist
git add "src/app/(admin)/index.jsx"
git commit -m "feat: filtro de semestre y Mantenimientos pagados en el dashboard de admin (mobile)"
```

---

### Task 7: Mobile — filtro de semestre en Finanzas de residentes + Mantenimientos pagados

**Files:**
- Modify: `mobile/src/services/data.js` (`fetchResidentFinancesSummary`)
- Modify: `mobile/src/app/(resident)/finances.jsx`

**Interfaces:**
- Consumes: `fn_resident_finances_summary(p_year, p_current_month_label)` (Task 1).

- [ ] **Step 1: Actualizar `fetchResidentFinancesSummary` para el nuevo parámetro**

```js
export async function fetchResidentFinancesSummary(year, currentMonthLabelStr) {
  const { data, error } = await supabase.rpc('fn_resident_finances_summary', { p_year: year, p_current_month_label: currentMonthLabelStr });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 2: Reescribir `ResidentFinancesScreen` completo**

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
import { fetchResidentFinancesSummary, currentMonthLabel } from '../../services/data';
import { fmt } from '../../utils/format';

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const CURRENT_YEAR = new Date().getFullYear();

function monthIndexFromDateStr(str) {
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Number(m[2]) - 1 : 0;
}

export default function ResidentFinancesScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dataByYear, setDataByYear] = useState({});
  const today = new Date();
  const [semester, setSemester] = useState(`${CURRENT_YEAR}-${today.getMonth() < 6 ? 1 : 2}`);

  const load = useCallback(async () => {
    try {
      const label = currentMonthLabel();
      const [curRows, prevRows] = await Promise.all([
        fetchResidentFinancesSummary(CURRENT_YEAR, label),
        fetchResidentFinancesSummary(CURRENT_YEAR - 1, label),
      ]);
      setDataByYear({ [CURRENT_YEAR]: curRows, [CURRENT_YEAR - 1]: prevRows });
    } catch (e) {
      console.error('No se pudo cargar Finanzas', e);
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

  function halfRows(year, half) {
    const rows = dataByYear[year] || [];
    const startIdx = half === 1 ? 0 : 6;
    return rows.filter((r) => { const idx = monthIndexFromDateStr(r.month_start); return idx >= startIdx && idx < startIdx + 6; });
  }
  function halfHasData(year, half) {
    return halfRows(year, half).some((r) => Number(r.month_income) > 0 || Number(r.month_expense) > 0);
  }

  const semesterOptions = [];
  [CURRENT_YEAR - 1, CURRENT_YEAR].forEach((y) => { [1, 2].forEach((half) => { if (halfHasData(y, half)) semesterOptions.push({ y, half }); }); });
  const currentHalf = today.getMonth() < 6 ? 1 : 2;
  if (!semesterOptions.some((o) => o.y === CURRENT_YEAR && o.half === currentHalf)) {
    semesterOptions.push({ y: CURRENT_YEAR, half: currentHalf });
  }
  semesterOptions.sort((a, b) => a.y - b.y || a.half - b.half);
  const semesterValueOptions = semesterOptions.map((o) => ({
    value: `${o.y}-${o.half}`,
    label: o.half === 1 ? `${o.y} (Ene-Jun)` : `${o.y} (Jul-Dic)`,
  }));

  const [selYearStr, selHalfStr] = semester.split('-');
  const rows = halfRows(Number(selYearStr), Number(selHalfStr));
  const curYearRows = dataByYear[CURRENT_YEAR] || [];
  const totalIncome = Number(curYearRows[0]?.total_income) || 0;
  const totalExpense = Number(curYearRows[0]?.total_expense) || 0;
  const balance = totalIncome - totalExpense;
  const maintPaid = Number(curYearRows[0]?.maintenance_paid_count) || 0;
  const maintTotal = Number(curYearRows[0]?.maintenance_total_residents) || 0;

  const chartData = rows.map((r) => ({
    label: MONTH_NAMES[monthIndexFromDateStr(r.month_start)],
    income: Number(r.month_income) || 0,
    expense: Number(r.month_expense) || 0,
  }));

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <PageHeader title="Finanzas" subtitle="Resumen financiero de la privada" />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        <MetricCard label="Balance total" value={fmt(balance)} valueColor={balance >= 0 ? colors.navy : colors.error} />
        <MetricCard label="Ingresos totales" value={fmt(totalIncome)} />
        <MetricCard label="Egresos totales" value={fmt(totalExpense)} />
        <MetricCard label="Mantenimientos pagados" value={`${maintPaid}/${maintTotal}`} />
      </View>

      <Card>
        <SectionHeader
          title="Flujo mensual"
          right={<ListPicker label="Semestre" value={semester} onChange={setSemester} options={semesterValueOptions} />}
        />
        <View style={{ padding: 16 }}>
          <MiniBarChart data={chartData} />
        </View>
      </Card>
    </ScreenContainer>
  );
}
```

- [ ] **Step 3: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform android
npx expo export --platform ios
rm -rf dist
git add src/services/data.js "src/app/(resident)/finances.jsx"
git commit -m "feat: filtro de semestre y Mantenimientos pagados en Finanzas de residentes (mobile)"
```

---

### Task 8: Web — "Mis pagos": quitar Disponibilidad, atenuar recibo, quitar leyenda

**Files:**
- Modify: `index.html` (`#pageMyPayments` thead, caption)
- Modify: `js/app.js` (`renderMyPayments`)

- [ ] **Step 1: Quitar la columna del `<thead>` y la leyenda**

En `index.html`:
```html
        <div class="card-head"><span class="card-title">Mis pagos</span></div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Mes</th><th>Monto</th><th>Fecha pago</th><th>Enviado</th><th>Estado</th><th>Recibo</th></tr></thead>
          <tbody id="tblMyPayments"></tbody>
        </table></div>
```
(se quitó la línea de la leyenda "☁️ Vouchers y recibos..." y el `<th>Disponibilidad</th>`.)

- [ ] **Step 2: Quitar la celda de Disponibilidad y atenuar el botón de Recibo**

En `renderMyPayments()`, dentro del `.map(p => ...)`:
```js
      .map(p => `<tr>
        <td>${escH(p.month||'—')}</td>
        <td>${fmt(p.amount)}</td>
        <td>${p.paymentDate || p.payment_date ? fmtDate(p.paymentDate||p.payment_date) : '—'}</td>
        <td>${fmtDate(p.sentDate||p.sent_date)}</td>
        <td><span class="badge ${p.status==='approved'?'badge-approved':p.status==='pending'?'badge-pending':'badge-rejected'}">${p.status==='approved'?'Aprobado':p.status==='pending'?'En revisión':'Rechazado'}</span></td>
        <td>${(p.receiptNum||p.receipt_num)
          ? `<button class="btn btn-secondary btn-sm"${(p.receiptUrl||p.receipt_url)?'':' style="opacity:0.4"'} onclick="showReceipt(${p.id})">${p.receiptNum||p.receipt_num}</button>`
          : '—'}</td>
      </tr>`).join('') ||
      '<tr><td colspan="6" style="text-align:center;color:var(--mist);padding:1.5rem">Sin pagos registrados</td></tr>';
```
(quitó la `<td>` de Disponibilidad; agregó `opacity:0.4` inline al botón de Recibo cuando
`!(p.receiptUrl||p.receipt_url)`; `colspan` del mensaje vacío bajó de 7 a 6.)

- [ ] **Step 3: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/app.js
git add js/app.js index.html
git commit -m "fix: quitar columna Disponibilidad, atenuar recibo no disponible en Mis pagos"
```

---

### Task 9: Mobile — "Mis pagos": atenuar recibo no disponible

**Files:**
- Modify: `mobile/src/app/(resident)/index.jsx`

- [ ] **Step 1: Atenuar la fila cuando el recibo ya no está disponible**

En la sección "Mis pagos" (dentro del `.map` de `payments`), cambiar:
```jsx
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
```
por:
```jsx
            .map((p, i, arr) => {
              const receiptUnavailable = p.status === 'approved' && !(p.receiptUrl || p.receipt_url);
              return (
                <View key={p.id} style={receiptUnavailable ? { opacity: 0.4 } : undefined}>
                  <ListRow
                    last={i === arr.length - 1}
                    title={`${p.month || '—'} · ${fmt(p.amount)}`}
                    subtitle={`Enviado ${fmtDate(p.sentDate || p.sent_date)}`}
                    onPress={p.status === 'approved' ? () => setViewingReceipt(p) : undefined}
                    right={<Badge variant={p.status} label={p.status === 'pending' ? 'En revisión' : undefined} />}
                  />
                </View>
              );
            })
```

- [ ] **Step 2: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform android
rm -rf dist
git add "src/app/(resident)/index.jsx"
git commit -m "fix: atenuar recibo no disponible en Mis pagos (mobile)"
```

---

### Task 10: Web — Estado de cuenta: quitar "Total pagado", signo negativo

**Files:**
- Modify: `js/app.js` (`renderMyAccount`)

- [ ] **Step 1: Quitar la tarjeta "Total pagado" y agregar el signo negativo**

En `renderMyAccount()`, dentro del template de `area.innerHTML`, cambiar:
```js
  area.innerHTML = `
    <div class="metrics" style="margin-bottom:1.5rem">
      <div class="metric"><div class="metric-label">Total pagado</div><div class="metric-value" style="color:var(--navy)">${fmt(totalPaid)}</div><div class="metric-change up">${approved.length} pagos aprobados</div></div>
      ${showFeeTile ? `<div class="metric"><div class="metric-label">Cuota mensual</div><div class="metric-value">${fmt(fee)}</div><div class="metric-change">mantenimiento</div></div>` : ''}
      ${pendingFinesTotal > 0 ? `<div class="metric" style="border-left:3px solid #dc2626"><div class="metric-label" style="color:#dc2626">Total adeudado este mes</div><div class="metric-value" style="color:#dc2626">${fmt(totalOwed)}</div><div class="metric-change">${(exento || feeAlreadyPaidThisMonth) ? '' : 'cuota + '}${pendingFines.length} cargo(s) pendiente(s)</div></div>` : ''}
    </div>
```
por:
```js
  area.innerHTML = `
    <div class="metrics" style="margin-bottom:1.5rem">
      ${showFeeTile ? `<div class="metric"><div class="metric-label">Cuota mensual</div><div class="metric-value">${fmt(fee)}</div><div class="metric-change">mantenimiento</div></div>` : ''}
      ${pendingFinesTotal > 0 ? `<div class="metric" style="border-left:3px solid #dc2626"><div class="metric-label" style="color:#dc2626">Total adeudado este mes</div><div class="metric-value" style="color:#dc2626">-${fmt(totalOwed)}</div><div class="metric-change">${(exento || feeAlreadyPaidThisMonth) ? '' : 'cuota + '}${pendingFines.length} cargo(s) pendiente(s)</div></div>` : ''}
    </div>
```
(la variable `totalPaid` sigue calculándose arriba en la función, pero ya no se usa en el markup —
dejarla como está, no requiere quitarse del cálculo ya que no rompe nada tenerla sin usar en el
render; solo se quita del template.)

- [ ] **Step 2: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/app.js
git add js/app.js
git commit -m "fix: quitar tarjeta 'Total pagado' y agregar signo negativo a Total adeudado"
```

---

### Task 11: Mobile — Estado de cuenta: quitar "Total pagado", signo negativo

**Files:**
- Modify: `mobile/src/app/(resident)/account.jsx`

- [ ] **Step 1: Quitar el `MetricCard` de "Total pagado" y agregar el signo negativo**

Cambiar:
```jsx
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
```
por:
```jsx
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        {showFeeTile ? <MetricCard label="Cuota mensual" value={fmt(fee)} sub="mantenimiento" /> : null}
        {pendingFinesTotal > 0 && (
          <MetricCard
            label="Total adeudado este mes"
            value={'-' + fmt(totalOwed)}
            sub={(exempt || feeAlreadyPaidThisMonth) ? `${pendingFines.length} cargo(s) pendiente(s)` : `cuota + ${pendingFines.length} cargo(s) pendiente(s)`}
            valueColor={colors.error}
            style={{ borderTopColor: colors.error }}
          />
        )}
      </View>
```
(`totalPaid` y `approved.length` siguen calculados arriba pero ya no se usan en este bloque —
`approved` sigue usándose más abajo para otros cálculos, no se toca.)

- [ ] **Step 2: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform android
rm -rf dist
git add "src/app/(resident)/account.jsx"
git commit -m "fix: quitar tarjeta 'Total pagado' y agregar signo negativo a Total adeudado (mobile)"
```

---

### Task 12: Web — Multas/Adeudos: filtro depto, quitar Estado, botón Pagado verde

**Files:**
- Modify: `index.html` (`#pageFines` header + thead)
- Modify: `js/admin.js` (`renderFines`, `deleteFine`)

**Interfaces:**
- Produces: fix del bug de `deleteFine()` (item 10 del spec) incluido en este mismo task por tocar
  el mismo archivo/función vecina.

- [ ] **Step 1: Agregar el `<select>` de filtro y quitar la columna Estado**

En `index.html`, reemplazar el bloque `#pageFines`:
```html
      <!-- ── MULTAS Y ADEUDOS (admin) ───────────────── -->
      <div id="pageFines" class="page">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div><div class="page-title">Multas y adeudos</div><div class="page-sub">Cargos adicionales por departamento</div></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select id="filterFineDepto" style="padding:5px 10px;border:1px solid var(--c-border);border-radius:var(--r-sm);font-size:13px" onchange="renderFines()">
              <option value="">Todos los deptos</option>
            </select>
            <button class="btn btn-gold btn-sm" onclick="openAddFineModal()">+ Agregar cargo</button>
          </div>
        </div>
        <div class="card">
          <div class="tbl-wrap"><table>
            <thead><tr><th>Residente</th><th>Depto</th><th>Tipo</th><th>Descripción</th><th>Monto</th><th>Mes</th><th>Acciones</th></tr></thead>
            <tbody id="tblFines"></tbody>
          </table></div>
        </div>
      </div>
```

- [ ] **Step 2: Reescribir `renderFines()` con el filtro, sin columna Estado, botón Pagado verde**

```js
function renderFines() {
  const depto = document.getElementById('filterFineDepto')?.value || '';
  const fines = DB.payments.filter(p =>
    (p.residentId||p.resident_id) &&
    (p.category==='Multa'||p.category==='Adeudo') &&
    p.status==='pending' &&
    (!depto || p.depto === depto)
  );

  const deptoSel = document.getElementById('filterFineDepto');
  if (deptoSel && deptoSel.children.length === 1) {
    const allFines = DB.payments.filter(p => (p.residentId||p.resident_id) && (p.category==='Multa'||p.category==='Adeudo') && p.status==='pending');
    [...new Set(allFines.map(p=>p.depto).filter(Boolean))].sort().forEach(d=>{
      const o=document.createElement('option'); o.value=d; o.textContent=d; deptoSel.appendChild(o);
    });
  }

  const tbody = document.getElementById('tblFines');
  if (!tbody) return;
  tbody.innerHTML = fines.map(p => `<tr>
    <td>${escH(p.resident_name||p.residentName||'—')}</td>
    <td><strong>${escH(p.depto||'—')}</strong></td>
    <td><span class="badge ${p.category==='Multa'?'badge-rejected':'badge-pending'}">${escH(p.category)}</span></td>
    <td style="max-width:200px;white-space:normal">${escH(p.description||'—')}</td>
    <td>${fmt(p.amount)}</td>
    <td>${escH(p.month||'—')}</td>
    <td>
      <button class="btn btn-sm btn-success" style="min-width:90px" onclick="markFinePaid('${escH(p.id)}')">Pagado</button>
      <button class="btn btn-sm" style="min-width:90px;background:#fee2e2;color:#b91c1c" onclick="deleteFine('${escH(p.id)}')">Eliminar</button>
    </td>
  </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--mist);padding:1.5rem">Sin cargos pendientes</td></tr>';
}
```

- [ ] **Step 3: Fix `deleteFine()` — comparación de tipos**

Cambiar:
```js
    DB.payments = DB.payments.filter(p => p.id !== id);
```
por:
```js
    DB.payments = DB.payments.filter(p => String(p.id) !== String(id));
```

- [ ] **Step 4: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/admin.js
git add js/admin.js index.html
git commit -m "feat: filtro de depto y botón Pagado verde en Multas/Adeudos; fix bug de eliminar sin refrescar"
```

---

### Task 13: Mobile — Multas/Adeudos: filtro depto, botón Pagado verde, mismo tamaño

**Files:**
- Modify: `mobile/src/components/ui/Button.jsx` (nuevo variant `success`)
- Modify: `mobile/src/app/(admin)/multas.jsx`

- [ ] **Step 1: Agregar el variant `success` al componente Button**

En `mobile/src/components/ui/Button.jsx`, cambiar:
```js
const VARIANTS = {
  primary: { bg: colors.navy, text: colors.gold, border: 'transparent' },
  gold: { bg: colors.gold, text: colors.navy, border: 'transparent' },
  secondary: { bg: colors.white, text: colors.slate, border: colors.mist },
  danger: { bg: colors.errorBg, text: colors.error, border: colors.error },
  ghost: { bg: 'transparent', text: colors.navy, border: 'transparent' },
};
```
por:
```js
const VARIANTS = {
  primary: { bg: colors.navy, text: colors.gold, border: 'transparent' },
  gold: { bg: colors.gold, text: colors.navy, border: 'transparent' },
  secondary: { bg: colors.white, text: colors.slate, border: colors.mist },
  danger: { bg: colors.errorBg, text: colors.error, border: colors.error },
  success: { bg: colors.successBg, text: colors.success, border: colors.success },
  ghost: { bg: 'transparent', text: colors.navy, border: 'transparent' },
};
```

- [ ] **Step 2: Filtro de depto + botón success + mismo tamaño en `MultasScreen`**

Agregar estado de filtro y `ListPicker` en `MultasScreen`, y cambiar `load()`/render de la lista:

```jsx
export default function MultasScreen() {
  const [loading, setLoading] = useState(true);
  const [fines, setFines] = useState([]);
  const [residents, setResidents] = useState([]);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [pendingReceipt, setPendingReceipt] = useState(null);
  const [deptoFilter, setDeptoFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const [payments, users] = await Promise.all([fetchPayments(), fetchUsers()]);
      setFines(
        payments.filter(
          (p) =>
            (p.residentId || p.resident_id) &&
            (p.category === 'Multa' || p.category === 'Adeudo') &&
            p.status === 'pending'
        )
      );
      setResidents(users.filter((u) => u.role !== 'admin' && u.depto_status === 'approved'));
    } catch (e) {
      console.error('No se pudieron cargar las multas', e);
    } finally {
      setLoading(false);
    }
  }, []);
```
(esta parte no cambia salvo la línea nueva `const [deptoFilter, setDeptoFilter] = useState('');` —
se muestra completa por claridad.)

Después de la verificación de `loading`, antes de `function handleDelete`, agregar:
```jsx
  const deptoOptions = [
    { value: '', label: 'Todos los deptos' },
    ...[...new Set(fines.map((f) => f.depto).filter(Boolean))].sort().map((d) => ({ value: d, label: d })),
  ];
  const filteredFines = deptoFilter ? fines.filter((f) => f.depto === deptoFilter) : fines;
```

Cambiar el JSX de la sección de filtro/lista:
```jsx
      <View style={{ marginBottom: 12 }}>
        <Button title="+ Nuevo cargo" variant="gold" onPress={() => setAdding(true)} style={{ height: 38 }} />
      </View>

      <ListPicker label="Departamento" value={deptoFilter} onChange={setDeptoFilter} options={deptoOptions} placeholder="Todos los deptos" style={{ marginBottom: 12 }} />

      <Card>
        <SectionHeader title={`Pendientes (${filteredFines.length})`} />
        {filteredFines.length === 0 ? (
          <EmptyState icon="checkmark-circle-outline" message="Sin cargos pendientes" />
        ) : (
          filteredFines.map((p, i) => (
            <ListRow
              key={p.id}
              last={i === filteredFines.length - 1}
              title={`${p.residentName || p.resident_name || '—'} · Depto ${p.depto || '—'}`}
              subtitle={`${p.category} · ${p.month || '—'} · ${fmt(p.amount)}${p.description ? '\n' + p.description : ''}`}
              right={
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Button
                    title="Pagado"
                    variant="success"
                    loading={busyId === p.id}
                    onPress={() => handleMarkPaid(p)}
                    style={{ height: 32, width: 80 }}
                  />
                  <Button
                    title="🗑"
                    variant="danger"
                    onPress={() => handleDelete(p)}
                    style={{ height: 32, width: 80 }}
                  />
                </View>
              }
            />
          ))
        )}
      </Card>
```

- [ ] **Step 3: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform android
rm -rf dist
git add src/components/ui/Button.jsx "src/app/(admin)/multas.jsx"
git commit -m "feat: filtro de depto, botón Pagado verde y mismo tamaño en Multas/Adeudos (mobile)"
```

---

### Task 14: Web — Ingresos/Egresos: texto del botón Importar

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Cambiar el texto del botón**

```html
            <button class="btn btn-secondary btn-sm" onclick="openModalImport()">⬆ Importar</button>
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
git add index.html
git commit -m "fix: acortar texto del botón Importar CSV a Importar"
```

---

### Task 15: Web — Reportes: filtro de Torre

**Files:**
- Modify: `index.html` (`#pageReports` header)
- Modify: `js/admin.js` (`renderReports`)

- [ ] **Step 1: Agregar el `<select>` de Torre**

En `index.html`:
```html
      <div id="pageReports" class="page">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div><div class="page-title">Reportes</div><div class="page-sub">Estado de cobros del mes en curso</div></div>
          <select id="filterReportTorre" style="padding:5px 10px;border:1px solid var(--c-border);border-radius:var(--r-sm);font-size:13px" onchange="renderReports()">
            <option value="">Todas las torres</option>
          </select>
        </div>
```

- [ ] **Step 2: Filtrar `rows` por torre en `renderReports()`**

Cambiar:
```js
      rows = (reportRes.data || []).filter(r => r.depto !== 'REV1'); // cuenta de revisión de Google Play
    } catch (e) {
      console.error('No se pudo cargar el reporte', e);
      showToast('Error al cargar el reporte: '+(e?.message||e), 'error');
    }
  }
```
por:
```js
      rows = (reportRes.data || []).filter(r => r.depto !== 'REV1'); // cuenta de revisión de Google Play
    } catch (e) {
      console.error('No se pudo cargar el reporte', e);
      showToast('Error al cargar el reporte: '+(e?.message||e), 'error');
    }
  }

  const torreOf = depto => String(depto||'').replace(/[A-Za-z]+$/,'');
  const torreSel = document.getElementById('filterReportTorre');
  if (torreSel && torreSel.children.length === 1) {
    [...new Set(rows.map(r=>torreOf(r.depto)).filter(Boolean))]
      .sort((a,b)=>Number(a)-Number(b))
      .forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; torreSel.appendChild(o); });
  }
  const torreFilter = torreSel?.value || '';
  if (torreFilter) rows = rows.filter(r => torreOf(r.depto) === torreFilter);
```

- [ ] **Step 3: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/admin.js
git add js/admin.js index.html
git commit -m "feat: filtro de Torre en Reportes"
```

---

### Task 16: Mobile — Reportes: filtro de Torre

**Files:**
- Modify: `mobile/src/app/(admin)/reportes.jsx`

- [ ] **Step 1: Agregar estado de filtro, opciones de torre, y aplicar el filtro a la lista**

```jsx
export default function ReportesScreen() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [fee, setFee] = useState(400);
  const [remanente, setRemanente] = useState(0);
  const [ingresosMes, setIngresosMes] = useState(0);
  const [egresosMes, setEgresosMes] = useState(0);
  const [torreFilter, setTorreFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const monthStart = firstDayOfCurrentMonth();
      const [reportRows, totals, remanenteData, settings] = await Promise.all([
        fetchResidentReport(currentMonthLabel()),
        fetchMonthTotals(monthStart),
        fetchRemanente(monthStart),
        fetchSettings(),
      ]);
      setRows(reportRows);
      setIngresosMes(totals.income);
      setEgresosMes(totals.expense);
      setRemanente(remanenteData);
      setFee(settings.defaultFee);
    } catch (e) {
      console.error('No se pudo cargar el reporte', e);
    } finally {
      setLoading(false);
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

  const remanenteSig = remanente + ingresosMes - egresosMes;
  const torreOf = (depto) => String(depto || '').replace(/[A-Za-z]+$/, '');
  const torreOptions = [
    { value: '', label: 'Todas las torres' },
    ...[...new Set(rows.map((r) => torreOf(r.depto)).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b))
      .map((t) => ({ value: t, label: t })),
  ];
  const filteredRows = torreFilter ? rows.filter((r) => torreOf(r.depto) === torreFilter) : rows;

  return (
    <ScreenContainer>
      <PageHeader title="Reportes" subtitle="Estado de cobros del mes en curso" onBack={() => router.back()} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <MetricCard label="Remanente anterior" value={fmt(remanente)} valueColor={remanente >= 0 ? colors.navy : colors.error} />
        <MetricCard label="Ingresos del mes" value={fmt(ingresosMes)} />
        <MetricCard label="Egresos del mes" value={fmt(egresosMes)} valueColor={colors.error} />
        <MetricCard label="Remanente siguiente" value={fmt(remanenteSig)} valueColor={remanenteSig >= 0 ? colors.navy : colors.error} />
      </View>

      <ListPicker label="Torre" value={torreFilter} onChange={setTorreFilter} options={torreOptions} placeholder="Todas las torres" style={{ marginBottom: 12 }} />

      <Card>
        <SectionHeader title="Estado de cobros — mes actual" />
        {filteredRows.map((r, i) => {
          const status = r.has_current ? 'approved' : r.status === 'approved' ? 'pending' : 'rejected';
          return (
            <ListRow
              key={r.resident_id}
              last={i === filteredRows.length - 1}
              title={`Depto ${r.depto || '—'} · ${r.name}`}
              subtitle={`Cuota ${fmt(r.fee || fee)} · Último pago ${r.latest_date ? fmtDate(r.latest_date) : '—'}`}
              right={<Badge variant={status} label={r.has_current ? 'Pagado' : r.status === 'approved' ? 'Pendiente' : 'Inactivo'} />}
            />
          );
        })}
      </Card>
    </ScreenContainer>
  );
}
```

- [ ] **Step 2: Agregar el import de `ListPicker`**

```jsx
import { ListPicker } from '../../components/ui/ListPicker';
```
(junto a los demás imports de `components/ui` al inicio del archivo.)

- [ ] **Step 3: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
npx expo export --platform android
rm -rf dist
git add "src/app/(admin)/reportes.jsx"
git commit -m "feat: filtro de Torre en Reportes (mobile)"
```

---

### Task 17: Web — Archivos: ventana de días 10-15 y bloqueo forzoso

**Files:**
- Modify: `index.html` (botón, banner de bloqueo)
- Modify: `js/admin.js` (`renderVouchers`, `goTo`, `downloadAndCleanup`)

- [ ] **Step 1: Agregar el banner de bloqueo al markup**

En `index.html`, dentro de `#pageVouchers`, antes de `<div id="vouchersArea">`:
```html
      <div id="pageVouchers" class="page">
        <div id="cleanupBlockBanner" class="hidden" style="background:#fef2f2;border:1px solid #fecaca;border-radius:var(--r-lg);padding:1rem 1.25rem;margin-bottom:1rem;color:#991b1b;font-weight:500"></div>
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div><div class="page-title">Archivos por departamento</div><div class="page-sub">Comprobantes y recibos organizados en carpetas</div></div>
          <button class="btn btn-gold btn-sm" id="btnDownloadCleanup" onclick="downloadAndCleanup()">⬇ Descargar y limpiar</button>
        </div>
        <div id="vouchersArea"></div>
      </div>
```

- [ ] **Step 2: Deshabilitar el botón fuera de la ventana 10-15, en `renderVouchers()`**

En `js/admin.js`, dentro de `renderVouchers()` (agregar al inicio de la función, antes de construir
el resto del contenido):
```js
function renderVouchers() {
  const today = new Date();
  const day = today.getDate();
  const btn = document.getElementById('btnDownloadCleanup');
  if (btn) {
    const inWindow = day >= 10 && day <= 15;
    btn.disabled = !inWindow;
    btn.style.opacity = inWindow ? '1' : '0.5';
    btn.title = inWindow ? '' : 'Solo disponible del día 10 al 15 del mes';
  }
  // ... resto de la función existente, sin cambios ...
```

- [ ] **Step 3: Bloqueo forzoso desde el día 16 — nueva función + hook en `goTo()`**

Agregar, junto a `checkAndApplyLateFees` (después de su definición):
```js
/* ── BLOQUEO FORZOSO DE LIMPIEZA DE ARCHIVOS (día 16+) ───────── */
function pendingCleanupBlock() {
  const today = new Date();
  if (today.getDate() <= 15) return false;
  return DB.payments.some(p => p.status === 'approved' && ((p.receiptUrl||p.receipt_url) || (p.voucherUrl||p.voucher_url)));
}

function enforceCleanupBlock() {
  const blocked = pendingCleanupBlock();
  const banner = document.getElementById('cleanupBlockBanner');
  if (banner) {
    banner.classList.toggle('hidden', !blocked);
    if (blocked) banner.textContent = `Antes de continuar, descarga y limpia los archivos del período — hoy es día ${new Date().getDate()}, la ventana para hacerlo (10-15) ya pasó.`;
  }
  return blocked;
}
```

Modificar `goTo()` (al inicio de la función, antes de cualquier otra cosa) para redirigir si está
bloqueado y la página destino no es `vouchers`:
```js
async function goTo(page) {
  if (currentUser?.role === 'admin' && page !== 'vouchers' && enforceCleanupBlock()) {
    page = 'vouchers';
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
```
(el resto de `goTo()`, no mostrado aquí, no cambia — solo se agregó el bloque `if` al inicio, antes
de la línea `document.querySelectorAll('.page')...` que ya existe.)

- [ ] **Step 4: Liberar el bloqueo al completar la limpieza**

Al final de `downloadAndCleanup()`, después de la línea `updatePendingCounts();` y antes del
`if (clearedIds.length === toArchive.length) { ... }`, agregar:
```js
  enforceCleanupBlock();
```

- [ ] **Step 5: Validar y commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
node --check js/admin.js
git add js/admin.js index.html
git commit -m "feat: ventana de días 10-15 y bloqueo forzoso de limpieza de archivos"
```

- [ ] **Step 6: Verificación manual**

En consola del navegador, como admin: `DB.payments.find(p=>p.status==='approved')` debe existir con
`receipt_url`/`voucher_url` no nulos; simular día 16+ evaluando `pendingCleanupBlock()` directamente
en consola (no se puede cambiar `new Date()` del sistema sin herramientas de dev tools) y confirmar
que devuelve `true`; confirmar que `enforceCleanupBlock()` muestra el banner y que `goTo('residents')`
(u otra página) redirige de vuelta a `vouchers` mientras el bloqueo esté activo.

---

### Task 18: Bump de versión de scripts

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Bump**

```html
<script src="js/app.js?v=20260711b"></script>
<script src="js/admin.js?v=20260711b"></script>
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main"
git add index.html
git commit -m "chore: bump versión de scripts tras el lote de ajustes de UI"
```

---

### Task 19: Publicar cambios de mobile (EAS Update)

**Files:**
- Ninguno — solo comandos.

**Interfaces:**
- Consumes: todos los commits de Tasks 3, 6, 7, 9, 11, 13, 16 (mobile).

- [ ] **Step 1: Confirmar que no hay dependencias nativas nuevas**

```bash
cd "C:\Users\Edson Trejo\Desktop\Residencial-Molinos-main\mobile"
git diff origin/main -- package.json
```
Expected: sin diferencias (ninguna task de este plan tocó `package.json`) — confirma que
`eas update` (OTA) es suficiente, sin necesitar un build nativo completo.

- [ ] **Step 2: Revisar canal/rama de update del perfil de producción**

```bash
cat eas.json
```
Buscar `"channel"` bajo el perfil `production` en el bloque `build` (o la config de `updates` en
`app.json`). Si no hay canal explícito, usar `npx eas-cli channel:list` para confirmar el nombre del
canal activo en producción antes del Step 3.

- [ ] **Step 3: Publicar la actualización OTA**

```bash
npx eas-cli update --branch production --message "Lote de ajustes UI: semestres, año completo, Multas/Adeudos, Reportes, Archivos"
```
(sustituir `production` por el nombre real de branch/canal confirmado en el Step 2 si difiere.)
Ejecutar con `run_in_background: true` si tarda, y confirmar el resultado antes de continuar.

- [ ] **Step 4: Verificar el despliegue**

```bash
npx eas-cli update:list --branch production --limit 1
```
Expected: el update recién publicado aparece como el más reciente, con el mensaje del Step 3.

---

## Self-Review Notes

- **Cobertura del spec:** ítems 1-12 del spec cubiertos por Tasks 2-3 (año completo), 4-7
  (semestres + Mantenimientos pagados), 8-9 (Mis pagos), 10-11 (Estado de cuenta), 12-13
  (Multas/Adeudos + fix deleteFine), 14 (Importar), 15-16 (Torre), 17 (Archivos), 18 (versión), 19
  (publish). El ítem "verificación de año completo sin código" (spec #9) no tiene task de código
  propia — se cubre como paso de Testing dentro de Task 3/2 (ya funciona, solo se verifica).
- **Placeholders:** ninguno — todo el código mostrado es código completo listo para pegar.
- **Consistencia de nombres:** `fn_resident_finances_summary(p_year, p_current_month_label)` se
  llama igual en Task 5 (web) y Task 7 (mobile, vía `fetchResidentFinancesSummary`). El formato de
  valor de semestre (`"${year}-${half}"`, half `1`|`2`) es el mismo en Tasks 4, 5, 6, 7. El variant
  `success` del `Button` de mobile (Task 13) se define una sola vez y se usa igual ahí.
- **Riesgo identificado:** Task 17 modifica `goTo()`, una función usada en TODA la navegación de la
  app (residentes y admin) — el `if` agregado explícitamente solo aplica cuando
  `currentUser?.role === 'admin'`, para no afectar a residentes. Verificar con cuidado en Step 6 que
  el login/logout y la navegación de residente no se ven afectados.
