# Lote de ajustes de UI/UX — web y mobile (Android/iOS)

## Contexto

Batería de correcciones y ajustes de UI solicitados tras revisar la app en uso, cubriendo: registro
de pago anual, gráfica de flujo mensual (dashboard admin y Finanzas de residentes), tabla "Mis
pagos", tarjeta de adeudo en Estado de cuenta, pantalla Multas/Adeudos, botón de importar CSV,
filtro de Torre en Reportes, y las tarjetas del Dashboard. Aplica a los tres frentes: web, y mobile
(el mismo código sirve para Android e iOS) — al final se hace un build+submit de EAS a las pistas
internas de Play Store y TestFlight.

Investigación de código confirmó la ubicación exacta de cada elemento (ver Diseño). Las siguientes
decisiones se confirmaron con el usuario durante brainstorming:

- El filtro de semestre usa etiquetas tipo "2026 (Ene-Jun)" / "2026 (Jul-Dic)", con el semestre que
  contiene el mes actual seleccionado por default.
- La tarjeta "Total pagado" en Estado de cuenta se elimina. "Cuota mensual" y "Total adeudado este
  mes" **mantienen** su comportamiento actual de ocultarse cuando no hay nada pendiente — no se
  vuelven siempre-visibles ni cambian a verde/$0. Solo se les agrega el signo negativo en rojo
  cuando sí hay adeudo (ya se muestran en rojo hoy, falta el signo).
- El bug de que "Total adeudado" no aparece cuando la cuota está sin pagar pero no hay multas
  pendientes **no se corrige** en este lote — queda como está.
- "Quitar disponibilidad, atenuar el recibo" aplica tanto a web (que sí tiene la columna) como a
  mobile (agregar el mismo atenuado, aunque mobile nunca tuvo columna de disponibilidad).
- El botón "Pagado" en Multas/Adeudos usa `btn-success` en web y un nuevo `variant="success"` en el
  `Button` de mobile (ya existen `colors.success`/`colors.successBg` en el theme, sin usar hoy).
- "Mantenimientos pagados" (X/Y): Y = residentes con `depto_status='approved'` únicamente. Se agrega
  tanto al Dashboard de admin (reemplazando "Residentes activos") como al tab "Finanzas" de
  residentes (como tarjeta nueva) — en ambos casos es del mes calendario en curso, sin importar qué
  semestre esté seleccionado en la gráfica de flujo.
- El selector de "año a pagar" del pago de año completo muestra exactamente 2 opciones: el año en
  curso y el siguiente (para prepagar por adelantado) — no un rango de 3 años ni los 12 meses.
- La limpieza de archivos (días 10-15) **no** se vuelve un borrado automático silencioso: en vez de
  eso, a partir del día 16 se bloquea al admin de usar el resto del panel (no puede cambiar de
  pantalla) hasta que complete "Descargar y limpiar" él mismo — así el respaldo (ZIP descargado a su
  equipo) y el borrado siempre suceden con una persona presente, nunca sin supervisión.

## Alcance

**Incluye**, en web + mobile salvo que se indique "solo web" (el elemento no existe en mobile):

1. **Registrar pago del año completo** (modal de pago en efectivo, admin): al marcar el checkbox,
   el selector de mes pasa a mostrar solo años (no "Mes Año"); se quita la leyenda
   "(elige cualquier mes de ese año)"; el texto del checkbox se acorta a "Registrar el año completo".
2. **Gráfica "Flujo mensual"** (Dashboard admin y Finanzas residentes, web + mobile): el filtro pasa
   de año completo a semestres ("2026 (Ene-Jun)", "2026 (Jul-Dic)", etc.), mostrando siempre 6
   meses en la gráfica; un semestre solo aparece como opción si tiene al menos un movimiento
   aprobado en ese rango.
3. **"Mis pagos"**: se quita la columna "Disponibilidad" (solo web la tiene); el botón/celda de
   "Recibo" se atenúa (opacidad reducida) cuando el archivo ya no está disponible, tanto en la tabla
   web como en la lista de mobile. Se quita la leyenda "Vouchers y recibos disponibles en la nube
   solo el mes de pago." (solo web).
4. **Estado de cuenta — "Total adeudado este mes"**: se le agrega signo negativo cuando hay adeudo
   (ej. "-$450.00"); se elimina la tarjeta "Total pagado" por completo. Sin más cambios de
   comportamiento (ver Contexto).
5. **Multas / Adeudos** (admin): se agrega filtro por Departamento a la tabla/lista; se quita la
   columna "Estado" (solo web la tiene); el botón "Marcar pagado" pasa a decir solo "Pagado" y se
   pinta verde (`btn-success`/`variant="success"`); ambos botones de acción quedan del mismo tamaño.
6. **Ingresos / Egresos** (admin, solo web): el botón "⬆ Importar CSV" pasa a decir "⬆ Importar".
7. **Reportes** (admin): se agrega filtro por Torre (número de depto sin la letra, ej. "10H" → "10").
8. **Dashboard** (admin y Finanzas de residentes, web + mobile): se quitan las leyendas/captions bajo
   cada tarjeta de métrica ("Ingresos − Egresos", "↑ acumulado", "↓ acumulado", "N pendientes de
   auth"/"N pendientes"). La tarjeta "Residentes activos" del Dashboard de admin se reemplaza por
   "MANTENIMIENTOS PAGADOS" con valor "X/Y" (residentes con mantenimiento aprobado este mes /
   residentes aprobados totales). Se agrega la misma tarjeta "Mantenimientos pagados" al tab
   Finanzas de residentes (no reemplaza nada ahí, se suma a Balance/Ingresos/Egresos).
9. **Pago de año completo — cobertura mes a mes ya correcta (verificación, sin código)**: se
   confirmó por lectura de código que `saveCashPaymentFullYear()` (web y mobile) inserta 12 filas
   individuales de `Mantenimiento`, una por mes, cada una con `status:'approved'` y el mismo formato
   de `month` (`"NombreMes Año"`) que usan `checkAndApplyLateFees()` y los checks de
   "Cuota mensual"/"Total adeudado" (`feeAlreadyPaidThisMonth`, `alreadyPaid`, etc.). Por diseño,
   esto ya hace que: (a) el recargo por atraso nunca se aplique a un mes ya cubierto por un pago de
   año completo, y (b) "Cuota mensual"/"Total adeudado" se oculten mes a mes durante todo el año
   pagado, y vuelvan a aparecer el año siguiente si no se registra un nuevo pago anual — sin
   necesidad de ningún flag o lógica especial de "año completo". Se agrega como paso de
   verificación/testing, no como cambio de código.
10. **Bug: "Multas / Adeudos" no refresca al eliminar** (solo web — mobile no tiene este bug, ver
    Diseño): `deleteFine()` compara `p.id !== id` sin normalizar tipos; `id` llega como string desde
    el botón y `p.id` es numérico en `DB.payments`, así que la comparación estricta nunca es igual y
    la fila nunca se quita del arreglo local — solo desaparece al recargar la página (cuando
    `loadDB()` vuelve a traer todo de Supabase, donde sí está borrado). Fix de una línea.
11. **Archivos — ventana de días 10-15 + bloqueo forzoso**: el botón "Descargar y limpiar" pasa a
    estar deshabilitado fuera de los días 10-15 del mes. A partir del día 16, si todavía quedan
    comprobantes/recibos sin archivar de ese ciclo, se bloquea la navegación del admin a cualquier
    otra pantalla (con un aviso fijo) hasta que complete "Descargar y limpiar" — mismo patrón de
    "correr en el próximo login de un admin" que ya usa `checkAndApplyLateFees`, sin necesidad de
    cron real en el servidor. Solo web (mobile no tiene esta función, ver Diseño).
12. **Build + submit**: al terminar, correr `eas build` + `eas submit` (Android production →
    internal track; iOS production → TestFlight) para que los cambios de mobile lleguen a las
    pruebas internas — a diferencia de la última ronda, esta sí puede ir por actualización OTA
    (`eas update`) si no se agregan dependencias nativas nuevas (ninguno de estos cambios las
    requiere), evitando el ciclo completo de build nativo. Se confirmará con el usuario cuál usar en
    el plan de implementación.

**Explícitamente fuera de alcance:**
- No se corrige el bug de "Total adeudado" no apareciendo cuando solo la cuota (sin multas) está
  pendiente — el usuario lo dejó explícitamente para después.
- No se cambia el ícono/texto "🗑" del botón eliminar en Multas (mobile) — solo se iguala su tamaño
  al botón "Pagado".
- No se toca la lógica de `checkAndApplyLateFees` ni la exención de mantenimiento (ya implementadas).
- No se construye un cron real en el servidor (Supabase pg_cron/Edge Function) para la limpieza de
  archivos — se usa el mismo patrón "corre cuando un admin abre la app" ya establecido en este
  proyecto, decisión explícita del usuario.
- No se agrega funcionalidad de Archivos/limpieza a mobile — hoy es de solo lectura ahí y este lote
  no cambia eso, solo ajusta el flujo web.

## Diseño

### 1. Registrar año completo — selector de años, no meses

**Web** (`js/admin.js`, `index.html:606-639`): en `onCashFullYearChange()`, cuando `fullYear` es
`true`, reconstruir `#cashMonth` con exactamente 2 opciones de año (currentYear, currentYear+1 — año
en curso y el siguiente, para prepagar por adelantado) en vez de dejar las opciones "Mes Año" ya
pobladas por `openCashPaymentModal()`; cuando se
desmarca, restaurar las opciones de mes originales (re-llamar la función que las puebla). Label
pasa de `'Año (elige cualquier mes de ese año)'` a `'Año'`. `saveCashPaymentFullYear()` ya hace
`monthSel.split(' ').pop()` para extraer el año de un string "Mes Año" — como ahora `cashMonth.value`
será directamente el año (ej. "2026"), simplificar esa línea a usar `monthSel` tal cual (ya no hay
"Mes " que quitar). Checkbox label en `index.html:626`: quitar "(12 meses) en vez de solo un mes",
dejar solo "Registrar el año completo".

**Mobile** (`comprobantes.jsx`): mismo patrón — el `ListPicker` de mes (línea 392) debe recibir un
`options` distinto cuando `fullYear` es `true` (2 opciones de año — actual y siguiente — en vez de
`monthOptions`), y el `value`/`onChange` deben manejar un año en vez de un string "Mes Año". Label
baja a `'Año'`. Texto del checkbox (línea ~389) baja a "Registrar el año completo".

### 2. Gráfica "Flujo mensual" — filtro de semestres

Reemplaza el filtro de año por un filtro de semestre en las 4 superficies (web admin `renderCharts()`,
web residente `renderMyFinances()`, mobile admin `AdminDashboard`, mobile residente
`ResidentFinancesScreen`). Cada opción es un par `(año, mitad)` con mitad `1` = Ene-Jun, mitad `2` =
Jul-Dic; etiqueta `"${año} (Ene-Jun)"` / `"${año} (Jul-Dic)"`. Un semestre solo se lista si tiene al
menos un pago aprobado con monto de ingreso o egreso `> 0` en ese rango de 6 meses. Selección por
default: el semestre que contiene el mes actual.

**Admin (web y mobile)**: ya tienen todos los pagos aprobados cargados en memoria/estado — construir
la lista de `(año, mitad)` candidatos a partir de los años presentes en los datos (mismo `years`
actual), expandido a 2 mitades por año, filtrando las que no tengan movimientos. La gráfica solo
pinta los 6 meses de la mitad seleccionada (antes: hasta 12, o 8 para el año actual por el
`startIdx=4` — ese `startIdx` especial para el año en curso ya no aplica, cada semestre define sus
propios 6 meses fijos).

**Residentes (web y mobile)**: la RPC `fn_resident_finances_summary(p_year)` **no cambia** — sigue
devolviendo las 12 filas mensuales de un año. El filtrado a 6 meses y la detección de "tiene
movimientos" se hacen en el cliente sobre las filas ya traídas. Para poder listar qué semestres
tienen datos sin adivinar, se trae por adelantado el año actual y el anterior (2 llamadas a la RPC
al cargar la pantalla, en paralelo) y se guardan ambos resultados en memoria; cambiar de semestre
en el selector solo cambia qué 6 filas ya cargadas se grafican, sin nueva llamada de red salvo que
el usuario navegue a un año no traído aún (no hay selector de año fuera de los 2 ya cargados, dado
que las opciones se limitan a esos 4 semestres candidatos).

### 3. "Mis pagos"

**Web**: quitar la columna `<th>Disponibilidad</th>` (`index.html`) y su `<td>` correspondiente
(`js/app.js`, dentro de `renderMyPayments()`). En la celda de "Recibo" (el `<button>` que ya existe),
agregar `style="opacity:0.4"` cuando `!(p.receiptUrl||p.receipt_url)` (el número de recibo puede
seguir existiendo aunque el archivo ya se haya limpiado del storage). Quitar la línea
`<div ...>☁️ Vouchers y recibos disponibles en la nube solo el mes de pago.</div>` (`index.html:360`).

**Mobile** (`index.jsx`, sección "Mis pagos"): agregar el mismo atenuado — envolver el `ListRow` (o
pasar `style`) con opacidad reducida cuando el pago está aprobado pero `!(p.receiptUrl||p.receipt_url)`.

### 4. Estado de cuenta — signo negativo, quitar "Total pagado"

**Web** (`renderMyAccount()`, `js/app.js`): quitar el `<div class="metric">Total pagado...</div>`.
En el tile de "Total adeudado este mes", cambiar `${fmt(totalOwed)}` por `-${fmt(totalOwed)}` (el
tile solo se renderiza cuando `pendingFinesTotal > 0`, así que `totalOwed` siempre es positivo ahí —
agregar el signo es seguro).

**Mobile** (`account.jsx`): quitar el `<MetricCard label="Total pagado" .../>`. En el
`MetricCard` de "Total adeudado este mes", cambiar `value={fmt(totalOwed)}` por
`value={'-' + fmt(totalOwed)}`.

### 5. Multas / Adeudos

**Web** (`js/admin.js` `renderFines()`, `index.html:407-418`): agregar `<select id="filterFineDepto">`
en el header de la página (mismo patrón que `#filterPayDepto` en Comprobantes — opción "Todos los
deptos" + opciones pobladas dinámicamente de los deptos presentes, `onchange="renderFines()"`).
`renderFines()` filtra por ese depto además del filtro de `status==='pending'` que ya tiene. Quitar
`<th>Estado</th>` del `<thead>` y su `<td>` correspondiente en el row-template. Botón
`Marcar pagado` → texto `Pagado`, clase `btn-gold` → `btn-success`. Agregar `style="min-width:90px"`
(o valor equivalente) a AMBOS botones ("Pagado" y "Eliminar") para que midan igual.

**Mobile** (`multas.jsx`): agregar filtro de depto (un `ListPicker` arriba de la lista, mismo patrón
que otros filtros de depto en la app — opciones pobladas de los deptos presentes en `fines`).
Cambiar el `<Button title="Pagado" variant="gold" .../>` a `variant="success"` (requiere agregar
`success: { bg: colors.success, text: colors.white, border: 'transparent' }` — o con `colors.successBg`
de fondo y `colors.success` de texto, para mantener el mismo patrón visual claro-sobre-oscuro que
usa `danger` hoy — a `VARIANTS` en `mobile/src/components/ui/Button.jsx`). Igualar tamaño de los
dos botones con un `width` explícito consistente en ambos (en vez de solo `paddingHorizontal`).

### 6. Ingresos / Egresos — texto del botón

**Web** (`index.html:287`): `⬆ Importar CSV` → `⬆ Importar`. Sin cambios de lógica
(`openModalImport()` sigue igual). No existe pantalla de Finanzas equivalente en mobile con este
botón (mobile no tiene una pantalla "Ingresos/Egresos" separada del Dashboard) — cambio solo web.

### 7. Reportes — filtro de Torre

**Web** (`js/admin.js` `renderReports()`, `index.html:311-325`): agregar
`<select id="filterReportTorre">` en el `page-header`, poblado con las torres distintas derivadas de
`depto.replace(/[A-Z]+$/i, '')` de los residentes visibles, ordenadas numéricamente. `renderReports()`
filtra `tblReport` por ese valor de torre (comparando `depto` de cada fila con el mismo regex
aplicado). **Mobile** (`reportes.jsx`): mismo filtro con `ListPicker`, mismo cálculo de torre.

### 8. Dashboard — quitar captions, "Mantenimientos pagados"

**Web `renderDashboard()`** (`js/admin.js:79-84`): quitar los 4 `<div class="metric-change">...</div>`
de las 4 tarjetas. Cambiar la tarjeta "Residentes activos" por:
```js
<div class="metric"><div class="metric-label">Mantenimientos pagados</div><div class="metric-value">${maintPaidCount}/${approvedRes}</div></div>
```
donde `maintPaidCount` = cantidad de residentes aprobados con un pago `category==='Mantenimiento'`
(o sin categoría) `status==='approved'` cuyo `month` sea el mes calendario actual (mismo criterio
que ya usa `checkAndApplyLateFees`/`feeAlreadyPaidThisMonth` en otras partes del código, contando
residentes distintos, no pagos).

**Web `renderMyFinances()`** (`js/app.js`): quitar los 3 `<div class="metric-change">` de sus
tarjetas (Balance/Ingresos/Egresos). Agregar una 4ª tarjeta "Mantenimientos pagados" con el mismo
formato X/Y — como el residente no puede ver `DB.residents`/`DB.payments` completos por RLS, estos
dos números deben venir de la misma función Postgres: extender `fn_resident_finances_summary` para
devolver dos columnas adicionales, constantes por fila igual que `total_income`/`total_expense`:
`maintenance_paid_count` (residentes aprobados con mantenimiento pagado este mes) y
`maintenance_total_residents` (total de residentes con `depto_status='approved'`). No se crea una
función nueva — se modifica la existente (mismo nombre/firma `fn_resident_finances_summary(p_year)`,
solo más columnas en el `RETURNS TABLE`).

**Mobile `AdminDashboard`** (`index.jsx`): mismos cambios que web admin — quitar los 4 `sub` de los
`MetricCard`, reemplazar el de "Residentes activos" por "Mantenimientos pagados" con
`value={`${maintPaidCount}/${approvedRes}`}` sin `sub`.

**Mobile `ResidentFinancesScreen`** (`finances.jsx`): quitar los 3 `sub` de sus `MetricCard`, agregar
una 4ª `MetricCard` "Mantenimientos pagados" leyendo las 2 columnas nuevas de la RPC (mismo patrón
que `total_income`/`total_expense`, tomando `rows[0]`).

### 9. Pago de año completo — verificación de cobertura mes a mes

Sin cambios de código. `saveCashPaymentFullYear()` (web `js/admin.js:515-609`, mobile
`mobile/src/services/admin.js:219-268`) inserta una fila por mes con `status:'approved'`,
`category:'Mantenimiento'`, `month: "${monthName} ${year}"` — el mismo formato exacto que usa
`checkAndApplyLateFees()` (`currentMonthStr = MONTHS_ES[today.getMonth()] + ' ' + today.getFullYear()`)
y los checks de `feeAlreadyPaidThisMonth`/`alreadyPaid` en `renderMyAccount`/`checkPaymentBanner`/
`renderMyPayments` (web) y sus equivalentes en `account.jsx`/`index.jsx` (mobile). Verificado que
los 3 arreglos de nombres de mes (`MONTHS` en `saveCashPaymentFullYear` web, `CASH_MONTHS` en la
versión mobile, `MONTHS_ES` en el cron de recargos) son textualmente idénticos — sin diferencias de
acentos/mayúsculas que pudieran romper el `===`. Solo se agrega como paso de Testing.

### 10. Fix: `deleteFine()` no refresca la tabla

**Web** (`js/admin.js:1653-1666`), línea exacta a cambiar:
```js
    DB.payments = DB.payments.filter(p => p.id !== id);
```
por:
```js
    DB.payments = DB.payments.filter(p => String(p.id) !== String(id));
```
(mismo patrón de coerción explícita que ya usa `markFinePaid()` en el mismo archivo,
`String(x.id) !== String(id)`). Sin cambios adicionales — `renderFines()` ya se llama después.
Mobile no tiene este bug: su `MultasScreen` recarga la lista completa desde Supabase
(`fetchFines`/`load()`) tras cada acción en vez de mantener un filtro local en memoria.

### 11. Archivos — ventana de días 10-15 y bloqueo forzoso

**Botón deshabilitado fuera de la ventana** (`index.html:271-278`, `js/admin.js`): agregar
`disabled` (y estilo atenuado) al botón "Descargar y limpiar" cuando
`today.getDate() < 10 || today.getDate() > 15`, calculado al renderizar `#pageVouchers`
(`renderVouchers()`).

**Bloqueo forzoso a partir del día 16**: agregar un chequeo (mismo patrón que
`checkAndApplyLateFees`/`_lateFeeCheckDone` — corre una vez por sesión de admin, disparado desde
`goTo()` o el render del Dashboard) que, si `today.getDate() > 15` **y** existe al menos un pago
`status==='approved'` con `receipt_url`/`voucher_url` no nulos (señal de que aún no se ha archivado
este ciclo), fuerza la navegación a `#pageVouchers` y bloquea el resto de `.nav-item` (deshabilitar
sus `onclick` o interceptar `goTo()` para redirigir de vuelta a `vouchers` mientras la condición siga
activa) hasta que `downloadAndCleanup()` complete exitosamente — el cual, al limpiar
`receipt_url`/`voucher_url` de todos los pagos aprobados, hace que la condición dejar de cumplirse y
libera la navegación normal. Mostrar un aviso fijo explicando por qué está bloqueado
("Antes de continuar, descarga y limpia los archivos del período — hoy es día {N}, la ventana para
hacerlo (10-15) ya pasó."). Solo web — `mobile/src/app/(admin)/archivos.jsx` es de solo lectura, sin
botón de descarga/limpieza que gatear.

## Testing

- Validación de sintaxis (`node --check` en web) y `npx expo export --platform ios|android` en
  mobile tras cada bloque de cambios, como en sesiones anteriores.
- Verificación manual de cada punto contra este documento antes de dar la tarea por terminada —
  dado que no hay credenciales de prueba funcionando para un recorrido de UI en vivo (ver limitación
  de la sesión anterior), la verificación es por revisión de código + posible sesión de navegador
  como admin si se recupera una contraseña válida.
- Antes del build/submit final: confirmar con el usuario si procede como actualización OTA
  (`eas update`) o build nativo completo, y a qué canal/rama de EAS Update apunta el perfil de
  producción actual (revisar `eas.json`/`app.json` por `runtimeVersion`/canales configurados).
- Para el punto 9: registrar un pago de año completo de prueba y confirmar en Supabase que las 12
  filas quedan con `month` en el formato correcto, luego confirmar manualmente (o por SQL) que
  `checkAndApplyLateFees` las detecta como pagadas para el mes en curso.
- Para el punto 10: eliminar un cargo en Multas/Adeudos y confirmar que desaparece de la tabla sin
  necesidad de recargar la página.
- Para el punto 11: probar manualmente cambiando la fecha del sistema (o simulando `today.getDate()`
  en consola) a un día 16+ con pagos aprobados que tengan `receipt_url`/`voucher_url` no nulos, y
  confirmar que el admin queda atrapado en Archivos hasta completar la limpieza.
