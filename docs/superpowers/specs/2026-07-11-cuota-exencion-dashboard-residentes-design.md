# Cuota persistente, exención de mantenimiento y dashboard financiero para residentes

## Contexto

Testers de la app móvil (cerrada en Play Store, TestFlight recién habilitado) reportaron varios problemas.
Investigación de código (no solo lectura del reporte) confirmó lo siguiente:

**Bugs reales, confirmados en código (web + mobile):**
- La tarjeta/etiqueta "Cuota mensual" con el monto de la cuota se muestra siempre, en 4 lugares
  distintos, sin importar si el residente ya pagó el mes en curso: web `renderMyPayments()`
  (`js/app.js:144,150`, stat `#resFeeDisplay`) y `renderMyAccount()` (`js/app.js:294`, tile
  "Cuota mensual"); mobile `(resident)/index.jsx:100-103` (header) y `(resident)/account.jsx:96`
  (tile "Cuota mensual"). Ya existe en ambos codebases un flag `feeAlreadyPaidThisMonth` calculado
  (de una sesión anterior) pero **solo se usa para la tarjeta "Total adeudado"**, nunca para ocultar
  la tarjeta "Cuota mensual" en sí ni el stat de `renderMyPayments`/header de `index.jsx`.
- La tarjeta resumen "EN REVISIÓN — N comprobantes pendientes" en Estado de cuenta (web
  `js/app.js:293`, mobile `account.jsx:95`) — el usuario confirmó por captura que quiere que
  desaparezca esta tarjeta específica del grid de métricas. Los badges "En revisión" por fila
  individual en las listas de pagos **no se tocan**.

**Reportes descartados tras investigación — NO son bugs de código:**
Tres reportes adicionales del tester ("solo se puede pagar mantenimiento" al subir comprobante,
"ya no aparece el adeudo de multas/recargos") **no se reprodujeron en el código actual**: el
selector "Tipo de pago" (Mantenimiento/Multa/Adeudo) existe tanto en web (`index.html:491-497`,
`js/app.js:383-384`) como en mobile (`(resident)/index.jsx:248-249`, commit `4903499`), y la
lógica de multas/adeudos pendientes (`createFine`/`saveFine` → `isFineCharge`/`pendingFines`)
coincide exactamente entre web y mobile, y web ya funciona correctamente para un tester real. La
explicación más probable es que el tester seguía con una build vieja del móvil (el fix es del
commit `4903499`, que requirió una build nueva de EAS por dependencias nativas nuevas — el submit
de esa build recién se completó hoy). **Este plan NO incluye ninguna tarea para "arreglar" estos 3
reportes** — si tras confirmar que el tester tiene la build más reciente el problema persiste, se
investigará como un issue nuevo y separado.

**Features nuevas solicitadas:**
- Exención de cuota de mantenimiento por residente: no existe ningún campo de exención hoy (se
  verificó — cero coincidencias de `exempt`/`exento` en todo el repo). En una sesión anterior se
  decidió explícitamente NO construir esto ("prefiero decidir caso por caso"); ahora se pide
  construirlo.
- Dashboard financiero restringido para residentes: reutiliza la lógica ya existente del dashboard
  de admin (`js/admin.js:62-142` `renderDashboard`/`renderCharts`; mobile
  `(admin)/index.jsx:22-135` `AdminDashboard`) pero solo con gráfica de flujo mensual + balance
  total + ingresos totales + egresos totales — sin "Residentes activos" ni "Actividad reciente".

## Alcance

**Incluye**, en web + mobile (mobile cubre Android e iOS con el mismo código):

- A. Ocultar la tarjeta/monto "Cuota mensual" en las 4 ubicaciones cuando ya está pagada este mes.
- B. Quitar la tarjeta resumen "En revisión" del grid de métricas de Estado de cuenta (ambas
  plataformas). Los badges por fila no se tocan.
- C. Nuevo campo `exento_mantenimiento` (boolean) en `users`, con toggle de admin al editar un
  residente (web: modal `modalEditResident`; mobile: `EditResidentSheet` en `residentes.jsx`).
  Para un residente exento:
  - No se le muestra el banner "Pagar ahora" ni "Ya pagaste" de mantenimiento (se oculta el banner
    completo, no solo el monto).
  - No se le muestra la tarjeta/monto "Cuota mensual" en ninguna de las 4 ubicaciones de (A).
  - No cuenta para "Total adeudado" ni el cálculo de cuota pendiente.
  - Se quita la opción "Mantenimiento mensual" del selector "Tipo de pago" al subir comprobante
    (web `index.html:493`/`js/app.js`; mobile `PAYMENT_TYPES` en `(resident)/index.jsx:190-194`) —
    solo puede subir Multa/Adeudo.
  - El cron de recargo por atraso (`checkAndApplyLateFees`, `js/admin.js:1670+`, solo existe en
    web) debe saltarse a los residentes exentos — hoy no hay equivalente en mobile así que no
    aplica ahí.
  - El admin conserva control total: puede seguir registrando un pago en efectivo o cualquier
    transacción de tipo Mantenimiento para ese residente manualmente si alguna vez hiciera falta —
    la exención solo afecta lo que el residente ve/puede autoiniciar, no las herramientas de admin.
- D. Nueva pestaña/sección "Finanzas" solo para residentes (web: nuevo `nav-item` +
  `goTo('finances')`; mobile: nuevo `Tabs.Screen` en `(resident)/_layout.jsx`), con: gráfica de
  flujo mensual (mismo componente/lógica que admin, IDs/estado separados para no chocar con el
  dashboard de admin que coexiste en el mismo DOM), balance total, ingresos totales, egresos
  totales. Sin lista de residentes ni actividad reciente — un residente no debe ver el detalle de
  transacciones individuales de otros residentes/proveedores.

**Explícitamente fuera de alcance:**
- No se investigan ni "arreglan" los 3 reportes descartados (selector de tipo de pago, multas no
  visibles) — ver justificación arriba. Si el usuario confirma que persisten en una build
  actualizada, es trabajo de una sesión/spec separada.
- No se toca el mecanismo de recargo por atraso en mobile (no existe hoy).
- No se agrega la posibilidad de que el residente vea transacciones individuales en el nuevo
  dashboard — solo los 4 totales/gráfica pedidos explícitamente.
- No se migra el campo `fee` existente ni se toca su semántica — la exención es un campo nuevo e
  independiente, no una reutilización de `fee: 0` (confirmado en la investigación: los 5 sitios que
  leen `fee` usan `||`, que trata `0` como falsy y caería al fee por default — reutilizar `fee`
  para exención requeriría tocar esos 5 sitios de todos modos, así que un campo dedicado es más
  simple y explícito).

## Diseño

### A. Ocultar "Cuota mensual" cuando ya está pagada

Cada uno de los 4 sitios ya tiene o puede derivar un booleano equivalente a
`feeAlreadyPaidThisMonth`. La tarjeta/stat completa (no solo el número) se deja de renderizar
cuando ese booleano es `true` — mismo patrón condicional que ya usa el banner
"Pagar ahora"/"Ya pagaste" en `checkPaymentBanner()`/`index.jsx`, aplicado ahora también a las
tarjetas de monto.

En web `renderMyPayments()` (`js/app.js`), hoy no existe cálculo de `feeAlreadyPaidThisMonth` (solo
existe dentro de `renderMyAccount()` y `checkPaymentBanner()`) — se debe replicar el mismo cálculo
localmente en `renderMyPayments()` para decidir si renderizar el stat `#resFeeDisplay`.

### B. Quitar tarjeta "En revisión"

Eliminar el bloque `<div class="metric">...En revisión...</div>` de `renderMyAccount()`
(`js/app.js:293`) y el `<MetricCard label="En revisión" ...>` de `account.jsx:95`. El resto del
grid de métricas (Total pagado, Cuota mensual, Total adeudado) se mantiene igual, solo con un
elemento menos.

### C. Exención de mantenimiento

**Base de datos** (aplicado directo contra Supabase, ya que no hay archivo `.sql` versionado en
ningún repo para las migraciones recientes — se aplican vía Supabase MCP como se ha hecho antes):
```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS exento_mantenimiento BOOLEAN NOT NULL DEFAULT FALSE;
```
Y actualizar el trigger `prevent_self_role_escalation()` (`SECURITY DEFINER`, ya existente) para
que también fije `new.exento_mantenimiento := old.exento_mantenimiento;` cuando `not is_admin()` —
sin esto, cualquier residente podría auto-otorgarse la exención vía un update normal de su propia
fila (la política RLS de UPDATE en `users` permite que cada quien edite su propia fila sin
restricción de columna).

**Lectura del campo**: agregar `exento_mantenimiento` a las listas de columnas explícitas
(`js/data.js:71` y `mobile/src/services/data.js:76`) — si no, Supabase nunca lo devuelve aunque la
columna exista. No requiere mapeo camelCase/snake_case adicional en `normalizeUser` (patrón simple,
igual que `fee`).

**UI de admin**: checkbox nuevo en `modalEditResident` (`index.html`, junto a `editResStatus`),
poblado/guardado en `editResidentModal()`/`saveEditResident()` (`js/admin.js:230-261`) igual que
los demás campos. En mobile, nuevo estado + toggle en `EditResidentSheet`
(`residentes.jsx:168-223`), pasado a `saveResident(id, { ...fields, exento_mantenimiento })`
(`mobile/src/services/admin.js:29-33`, ya genérico, no necesita cambios).

**Efecto en pantallas de residente**: cada uno de los 4 sitios de (A), más el banner
"Pagar ahora"/"Ya pagaste" (web `checkPaymentBanner()`, mobile `index.jsx` banner), agregan
`residentExempt` a su condición existente — se oculta la tarjeta/banner si
`feeAlreadyPaidThisMonth || residentExempt`. El cálculo de "Total adeudado"/`totalOwed` también
usa `residentExempt` para no sumar la cuota (mismo `if` que ya usa `feeAlreadyPaidThisMonth`).

**Selector de tipo de pago**: al construir `PAYMENT_TYPES` (mobile) o las `<option>` de `payType`
(web), si el residente actual tiene `exento_mantenimiento === true`, se omite la opción
"Mantenimiento mensual" — el residente solo puede elegir Multa o Adeudo.

**Cron de recargo por atraso** (`checkAndApplyLateFees`, `js/admin.js:1670+`, web-only): el loop
`for (const resident of approvedResidents)` agrega un `if (resident.exento_mantenimiento) continue;`
al inicio, antes de revisar si pagó — un residente exento nunca debe recibir el recargo de $50 por
"no pagar" una cuota que no le corresponde.

### D. Dashboard financiero para residentes ("Finanzas")

**Web**: nuevo `nav-item` en la sección de nav de residente (`index.html`, junto a
`myAccount`/`contacts`, ~línea 163-173) con `onclick="goTo('finances')"`. Nueva sección de página
(estructura similar a `myAccount`, ~línea 366) con 3 `<div class="metric">` (Balance, Ingresos,
Egresos — misma marca visual que las de admin) + un `<canvas>` con `id` propio (ej.
`residentChartFlow`) y su `<select id="residentChartFlowYear">`, para no chocar con los IDs
`chartFlow`/`chartFlowYear`/`metricsArea` que usa el dashboard de admin (ambas secciones coexisten
en el mismo DOM, solo una visible según rol). Nueva función `renderResidentFinances()` en
`js/app.js` que reutiliza el mismo cálculo de `totalIncome`/`totalExpense`/`balance` y la misma
lógica de agrupar por mes que `renderCharts()`, pero filtrando solo esos 3 totales + la gráfica (sin
"Residentes activos" ni tabla de actividad reciente) — se llama a `goTo()` para engancharla al
router de vistas existente.

**Mobile**: nueva ruta `mobile/src/app/(resident)/finances.jsx`, nuevo `Tabs.Screen` en
`(resident)/_layout.jsx` (junto a `index`/`account`/`contacts`). El componente reutiliza
`fetchPayments()` + el mismo cálculo de `balance`/`totalIncome`/`totalExpense`/`chartData` que
`AdminDashboard` (`(admin)/index.jsx:58-76`) y el mismo componente `MiniBarChart`, pero solo
renderiza el bloque de 3 `MetricCard` (Balance/Ingresos/Egresos, sin "Residentes activos") + la
`Card` de "Flujo mensual" — sin la `Card` de "Actividad reciente".

## Testing

- Verificación manual en navegador (web) y `npx expo export --platform ios|android` (mobile, sin
  simulador disponible en este entorno) tras cada bloque de cambios, como se ha hecho en sesiones
  anteriores.
- Para (C): probar con un residente marcado exento que (1) no vea cobro de mantenimiento en
  ninguna pantalla, (2) no pueda seleccionar "Mantenimiento" al subir comprobante, (3) no reciba el
  recargo automático de $50 aunque pase el día 10 sin pagar, (4) el admin sí pueda seguir
  registrándole un pago de Mantenimiento manual si quisiera.
- Para (D): confirmar que los 3 totales y la gráfica del nuevo dashboard de residente coinciden
  exactamente con los que ve el admin para el mismo período (mismo cálculo, misma fuente de datos).
- Antes de dar por buenos los 3 reportes descartados, pedir al tester que confirme número de
  versión/build instalada y que reintente tras actualizar — no se escribe código para esto en este
  plan.
