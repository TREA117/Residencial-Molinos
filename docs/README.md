# docs/ — historial de desarrollo

Todo lo que hay bajo `superpowers/specs/` y `superpowers/plans/` documenta features **ya
implementadas y en producción**, no trabajo pendiente. Se generaron con la metodología de la skill
`superpowers` (brainstorm → spec → plan → ejecución) y se conservan como referencia de por qué el
código quedó como quedó — útil si algo de esto necesita tocarse de nuevo.

No hay ningún spec/plan activo en este momento (julio 2026): el proyecto está en fase de
mantenimiento + revisión de App Store para `mobile/`, no en desarrollo de features nuevas.

## Índice (todas shippeadas)

| Spec + plan | Qué resolvió |
|---|---|
| `2026-06-25-mobile-app-deployment-design.md` + `.../2026-06-25-mobile-app-deployment.md` | Publicó la app móvil en su propio repo de GitHub, la vinculó a EAS Build, y agregó las Edge Functions `eliminar-cuenta` y `moderar-comprobante` (moderación de comprobantes vía Cloud Vision), el botón "Eliminar cuenta" (web + mobile) y los documentos legales (`terminos.html`, actualización de `privacidad.html`). Recuperado de un backup local el 2026-07-29; no estaba indexado aquí. |
| `2026-07-03-registro-anti-suplantacion-design.md` | Cierra un hueco de seguridad en el registro de residentes: bloquea que alguien se registre con el correo/depto de un residente real que aún no se ha registrado. Sin plan asociado (solo cambios de RPC en Supabase). |
| `2026-07-10-ios-testflight-build-design.md` + `.../2026-07-10-ios-testflight-build.md` | Agregó el build/submit de iOS a `eas.json`/`app.json` y la primera subida a TestFlight/App Store Connect — es el trabajo que dejó la app en el estado actual (en revisión). |
| `2026-07-11-cuota-exencion-dashboard-residentes-design.md` + plan | Cuota visible de forma persistente, exención de cuota por residente, dashboard financiero de solo lectura para residentes (web + mobile). |
| `2026-07-11-ui-polish-batch-design.md` + plan | Lote de 12 mejoras de UI/UX (tabla de Mis Pagos, Estado de cuenta, Multas/Adeudos, filtro de Reportes, etc.) en web + mobile. |
| `2026-07-12-pago-anual-registro-unico-design.md` + plan | Pago de año completo como un solo registro/recibo en vez de 12 filas — columnas `covers_full_year`/`period_year` (web + mobile). |

Los task-briefs/reports de ejecución de cada plan viven en `.superpowers/sdd/` (raíz del repo) y en
`mobile/.superpowers/sdd/` — son artefactos de trabajo internos de la skill, no están en git
(`.gitignore` propio dentro de esa carpeta), y no hace falta leerlos para entender el estado actual
del proyecto; los specs/plans de arriba ya resumen el resultado.
