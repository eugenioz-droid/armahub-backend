# PROGRAMA MAESTRO — Saneamiento y Expansión (2026-H2)

**Propósito:** hoja de ruta ejecutable para llevar ArmaHub a estándar profesional (seguridad, limpieza,
escalabilidad) y construir la expansión (pre-armado, app de clientes, CRM, templates 3D), cumpliendo la
Ley 21.719. Se ejecuta POR FASES con Claude: el usuario dice **"ejecuta M0"** y la fase corre completa
(código → tests → deploy → verificación) sin re-preguntar producto.

**Codificación:** fases `M0…M7` + transversales `C` (compliance) e `I` (infraestructura). Cada tarea
lleva una etiqueta:
- **[AUTO]** — todo definido; Claude la ejecuta sin input del usuario.
- **[DEF]** — requiere una definición de producto del usuario ANTES de codear (listadas al final de cada fase).
- **[ACCIÓN-USUARIO]** — la hace el usuario (dashboards Render/Supabase, contrataciones, reuniones).

Convive con `programa-versiones/programa_v1.00.md` (roadmap de features F5-F15): este programa NO lo
reemplaza — lo ordena. Donde una fase M toca una F existente, se referencia. Auditoría fuente: 3 agentes
2026-08-06 (seguridad, frontend/repo, SPECS).

**Regla de ejecución:** cada fase = una rama si toca >5 archivos; commit atómico por tarea; tests y
verificación de deploy SIEMPRE; nada destructivo sin backup previo (BD) — ver I.2.

---

## M0 · SEGURIDAD CRÍTICA — ✅ EJECUTADA 06-ago-2026 (commit 49cbf39, verificada en prod)
*Bloqueantes antes de exponer clientes externos. Fuente: auditoría C1-C5, A1-A7.*
*Verificado en producción: signup→403, rate limit→429 al 6º intento, headers presentes,
health sin internals. NOTA: los tokens antiguos quedaron inválidos → re-login único.*

| # | Tarea | Criterio de aceptación |
|---|---|---|
| M0.1 | JWT_SECRET fail-fast: el server NO arranca si falta la env o vale el default | Arranque aborta con mensaje claro; prod verificado tras deploy |
| M0.2 | Deshabilitar `/auth/signup` (403 + mensaje "usuarios se crean por Admin") | Endpoint responde 403; login/Admin intactos |
| M0.3 | JWT con expiración (8h laborales + renovación silenciosa en el front si el token está por vencer) | Token viejo expira; sesión activa no se corta a mitad de trabajo |
| M0.4 | Borrar `app.py`, `clean_db.py`, `migrate_imagenes_a_r2.py` de la raíz (verificado: prod corre armahub.main) | Archivos fuera; deploy arranca OK |
| M0.5 | Rate limit en `/auth/login` (slowapi o contador simple por IP: 5 intentos/min) | 6º intento en 1 min → 429 |
| M0.6 | `/health` sin fuga de internals (solo ok/error por componente, sin `str(e)` ni nombres de bucket) | Respuesta sin detalles internos |
| M0.7 | Security headers middleware (X-Frame-Options, X-Content-Type-Options, HSTS) | Headers presentes en respuestas |
| M0.8 | Handlers que devuelven `str(e)` al cliente → mensaje genérico + traceback a log (reclamos.py, importer.py, barras.py) | Ningún 500 expone tipo/estructura interna |
| M0.9 | `audit()` deja de tragar errores en silencio (log warning) | Fallo de auditoría queda logueado |
| M0.10 | Carpeta de seguridad para la reunión con infosec (ver anexo A) | Docs generados en docs/seguridad/ |

## M1 · HIGIENE Y LIMPIEZA — ✅ EJECUTADA 06-ago-2026 (commits 251c6e3…3db3431, verificada en prod)
*Fuente: auditoría frontend/repo + código muerto backend.*
*Notas de ejecución: M1.3 encontró menos duplicados que la auditoría (escapeHtml ya estaba
consolidado); lo real consolidado = peso.py (4 copias BE) + rol_colores.js (2 paletas divergentes,
6 sitios) + orden_pisos.js (2 copias FE sin FUND). M1.10 (campo plano) SALTADA — espera [DEF]
columna visible. Migración 102 = unicidad num_obra/correlativo con reparación de duplicados.*

| # | Tarea | Criterio |
|---|---|---|
| M1.1 | Borrar editor v1 muerto (5 rastros: agregar_cubicacion.js, su .html, include en app.html, bloque bootstrap.js, entrada shell.js) | Tab agregar2 funciona idéntico; v1 no se descarga |
| M1.2 | Unificar orden de pisos: `orden.py` (BE) + `shared/orden_pisos.js` (FE) como fuentes únicas; migrar pisoOrder/_pisoSortKey/ac2OrdPiso. Decisión técnica: SM=9999 (criterio de orden.py) | Un solo criterio; matrices/exportación/editor ordenan igual |
| M1.3 | Consolidar helpers duplicados en shared/: escapeHtml (×7), formatters kg (×8, + variante compacta 1k/1M), colores de rol (×3), fórmula de peso (×5 → módulo BE único) | Cero definiciones locales duplicadas |
| M1.4 | Migrar `_ac2Get/Post/Patch/Delete` → shared/api.js; montar `lotes_router` también en /api/v1 (fix M1 auditoría) | Editor funciona; una sola convención de rutas |
| M1.5 | Borrar código muerto backend: cuerpos tras `raise` en endpoints 403, 5 funciones sin llamadores de reclamos_queries.py, `_role_puede` | py_compile OK; grep sin referencias |
| M1.6 | Repo: mover docs sueltos de la raíz a docs/ (consolidar PROTOCOLO duplicado), .docx a archive/, smoke_test a scripts/, borrar docs/specs/ vacío, ampliar .gitignore | Raíz limpia: solo código, config y Readme |
| M1.7 | Unificar caché de reclamos en cache.py (eliminar `_reclamos_cache` global) | Un solo mecanismo de caché |
| M1.8 | Fix carreras MAX+1 (num_obra, REC-, numero_calidad) con retry sobre UNIQUE | Dos creaciones concurrentes no duplican correlativo |
| M1.9 | **Panel de Cubicación en el Hub** (lupa = agrandar el mismo panel; data = TODO CSV+creados vía param `origen`) y en **Bar Manager** | Hub y BM usan shared/panel_cubicacion.js; modal zoom viejo eliminado |
| M1.10 | Campo **plano por lote** (columna en lotes + estampar a barras + mostrar) — [DEF: en qué columna visible] | Cubicador registra plano al crear despiece |

**[DEF] de M1:** solo M1.10 (columna visible del plano). Todo lo demás es automático.

## M2 · AUTORIZACIÓN MULTI-OBRA REAL — [AUTO] 70% · ~2 sesiones
*Encender el scope por obra (hoy apagado: todo usuario ve todo). Prerrequisito duro de M5.*

- M2.1 [DEF] **Matriz de visibilidad**: ¿qué ve cada rol interno? (propuesta: admin/admin_calidad/usc = todo; miembro = todo lo interno; cliente = SOLO su(s) obra(s) vía proyecto_usuarios). Confirmar antes de codear.
- M2.2 [AUTO] Implementar `_get_allowed_project_ids` real según matriz + aplicar a endpoints destructivos (C5).
- M2.3 [AUTO] Tests de autorización (usuario de obra A no ve/borra obra B).
- M2.4 [AUTO] Registro de auditoría reforzado en operaciones sensibles (base para C.2).

## M3 · DEUDA ESTRUCTURAL SELECTIVA — mixta · ~2-3 sesiones
- M3.1 [AUTO] Diseño técnico: parámetros de barra extensibles (JSONB) — solo DISEÑO (doc), se implementa cuando multicatálogo/templates lo exijan.
- M3.2 [DEF+AUTO] Config de pisos de obra homologada (diseño existente en diseno_editor_cubicacion.md; requiere 2-3 decisiones).
- M3.3 [DEF] **Modelo LIBRE de cubicaciones (infraestructura)** — diseño del "tipo de obra" (edificio|libre): sin ubicación de edificio, orden por pedido, campos libres, MISMO export aSa. FACTIBLE (motor ya paramétrico). Solo programa/diseño hasta que el usuario defina infraestructura.
- M3.4 [AUTO] `sector_estado` como fuente del dirty-flag (migrar lectores; diseño ya existe).

## M4 · PRE-ARMADO (producción) — [DEF] discovery primero · arranca ~11-ago
*Terreno nuevo (solo existe como área de reclamos). Módulo para el administrador del pre-armado.*

- M4.1 [DEF] **Discovery con el usuario** (la próxima semana): rendimientos (¿kg/HH? ¿por cuadrilla/persona?), producción (¿unidad: elemento, kg, pedido?), asistencia (¿marcaje simple o turnos?; OJO datos personales → C.1), programación (¿horizonte, dependencias con despieces/pedidos?). Preparo cuestionario guiado antes de la sesión.
- M4.2 [AUTO tras M4.1] Modelo de datos + migraciones + caluga (tab) con maqueta visual primero (método acordado).
- M4.3 [AUTO] Panel de Cubicación reutilizado para producción (mismo componente, data de producción) si aplica.

## M5 · EPIC APP CLIENTES — sub-fases · el mayor
*Base ya diseñada: programa_pedidos_cliente.md (portal separado, misma API, flujo cliente→USC→cubicador) + F7 Mis Proyectos + F13 App Terreno. PWA (sin app stores).*

- M5.0 [ACCIÓN-USUARIO] Infra previa: I.1-I.4 completas (staging, dominio, backups, Render pagado).
- M5.1 [DEF] Discovery de cierre: decisiones abiertas del doc (visibilidad de estados en tiempo real, forward USC obligatorio, flujo de rechazo, multi-obra por constructora).
- M5.2 [AUTO tras DEF] Portal base: login cliente, scope por obra (usa M2), branding separado.
- M5.3 [AUTO] Pedidos del cliente (flujo completo del doc con estados y notificaciones).
- M5.4 [DEF+AUTO] **Aprobación de cubicaciones por el cliente** (revisar/aprobar/sugerir → aviso a USC y cubicador; el CUBICADOR valida). Definir: qué ve el cliente (resumen vs detalle de barras) y plazos.
- M5.5 [DEF+AUTO] **Protocolo de revisión de enfierradura por elemento** (checklist por muro/losa/viga, firma cliente + ITO en canvas, PDF, archivo en R2, imprimir). Definir: campos del protocolo con el equipo de obra.
- M5.6 [AUTO] **Picking QR**: escaneo de tarjetas aSa desde la PWA (cámara) + check contra sistema. (Necesito 2-3 ejemplos reales del QR de aSa para mapear su contenido.)
- M5.7 [AUTO] Gancho certificados de acería (campos/relaciones preparados, sin implementar).

## M6 · CRM / LEADS — [DEF] discovery · después de M5 (o intercalado)
- M6.1 [DEF] Discovery: pipeline de leads (etapas), quién lo usa, qué es una oportunidad vs cliente.
- M6.2 [AUTO tras DEF] Caluga con modelo cuentas/contactos/leads/seguimientos (F11), **nacida cumpliendo 21.719** (consentimiento, borrado por derecho ARCO).

## M7 · TEMPLATES 3D PARAMÉTRICOS — deseable · por versiones
*Evaluación honesta: la BASE está cerca (render 3D rápido + catálogo con geometría real + motor paramétrico). El "editor de modelado libre" es lo de otra envergadura. Camino incremental:*

- M7.0 ✅ **Maqueta de nivel de detalle** (06-ago-2026): `/static/demo/rebar3d.html` — viga paramétrica con barras SÓLIDAS (cilindros + codos toroidales con radio de doblado de norma 2φ/3.5φ), ganchos 90°/135° sísmicos, trabas, hormigón semitransparente, órbita/zoom. Rendimiento: geometría fusionada + InstancedMesh = 5 draw calls para TODA la viga (~965k triángulos en el peor caso del UI) → congestión verificable visualmente rotando. Conclusión: el detalle "barra sólida con radios reales" es BARATO; no hacer corrugas geométricas ni colisión automática en v1.
- M7.1 [DEF+AUTO] **v1 — Templates codificados consumibles**: viga/columna/muro RECTANGULAR con reglas paramétricas fijas (largo/ancho/alto hormigón, recubrimiento, φ y espaciamiento de estribos, condiciones de confinamiento, cabezales/trabas/laterales) → genera la lista de barras (figuras del catálogo con dims calculadas) → vista 3D del CONJUNTO (posicionando las barras en el espacio, con la técnica validada en M7.0) → botón "cargar al editor" (las barras entran al despiece). ALCANZABLE con esfuerzo medio; todo client-side + catálogo.
- M7.2 [AUTO] v2 — Editor de REGLAS: el usuario ajusta parámetros del template y guarda variantes (JSON de reglas editable con UI de formulario, no modelado libre).
- M7.3 [futuro] v3 — Modelado libre / secciones circulares → recién aquí es "otro nivel"; se evalúa tras v1/v2.

## C · TRANSVERSAL COMPLIANCE LEY 21.719 (vigencia 1-dic-2026)
- C.1 [AUTO] **Registro de cumplimiento con trazabilidad**: `docs/compliance/ley21719.md` — tabla viva: requisito legal → estado → implementación (commit/fecha/evidencia) → pendiente. Se actualiza en CADA fase que toque datos personales. Este ES el formato de revisión (auditable por cualquiera).
- C.2 [AUTO] Registro de actividades de tratamiento (doc: qué datos, de quién, para qué, dónde, quién accede).
- C.3 [AUTO, en M5] Política de privacidad + consentimiento en el portal de clientes; diseño BD que permita exportar/eliminar los datos de una persona (ARCO).
- C.4 [ACCIÓN-USUARIO] Aceptar/archivar DPAs de Supabase, Render, Cloudflare, Resend; designar DPO (puede ser el propio usuario).

## I · TRANSVERSAL INFRAESTRUCTURA
- I.1 [ACCIÓN-USUARIO] Render: plan pagado del servicio + **crear servicio staging** (misma repo, rama `staging`, BD de prueba propia).
- I.2 [ACCIÓN-USUARIO] Supabase: plan con backups automáticos/PITR. **Regla desde ya: backup manual antes de cada migración que toque datos.**
- I.3 [ACCIÓN-USUARIO] Dominio propio + subdominios (interno/clientes) + dominio Resend verificado.
- I.4 [AUTO] Cloudflare delante (WAF/rate limit) + Sentry + UptimeRobot (todo gratis) — guío la config.

---

## Anexo A · Preparación reunión Seguridad Informática (en ~2 semanas)
Lo que típicamente piden y qué llevaremos (se genera en M0.10, carpeta `docs/seguridad/`):
1. **Diagrama de arquitectura** y flujo de datos (Render/Supabase/R2/Resend, auth JWT, quién accede a qué).
2. **Inventario de datos personales** (C.2) y subprocesadores con sus DPAs.
3. **Modelo de accesos**: roles, scope por obra, creación de usuarios (manual por admin — punto a favor).
4. **Plan de remediación**: la auditoría propia + M0/M2 en curso — llegar con gaps identificados y plan es la mejor posición posible.
5. **Respuestas al cuestionario típico**: cifrado en tránsito (TLS, sí) y reposo (Supabase/R2, sí), backups (I.2), logs/auditoría (audit_log), gestión de vulnerabilidades (este programa), respuesta a incidentes (borrador 1 página), MFA (no aún — roadmap), pentest (no aún — ofrecer post-M0/M2).
Proceso típico: cuestionario → reunión → observaciones → plan de remediación → seguimiento. Nada de esto asusta si llegamos con la carpeta lista.

---

## Cómo ejecutar este programa conmigo
1. **"ejecuta M0"** → corro la fase completa (rama → tareas → tests → deploy → verificación → reporte).
2. Igual con **"ejecuta M1"**. M0+M1 son 100% automáticas (salvo M1.10 que saltaré si no defines la columna).
3. Las [DEF] se resuelven en UNA sesión de decisiones por fase (te llevo cuestionario cerrado, respondes, ejecuto).
4. Las [ACCIÓN-USUARIO] te las recuerdo con instrucciones paso a paso cuando bloqueen una fase.

---

## COLA DE TAREAS PENDIENTES (bugs/mejoras reportados por el usuario)
Se atienden cuando termine el foco actual (Template Editor). Orden = de llegada.

### T1 · [BUG] Los comentarios no se guardan al crear una obra (sección Clientes)
Reportado 10-ago. El usuario creó una obra y **los comentarios no quedaron guardados**.
Investigar: el form de creación de obra en la sección de clientes (¿el campo comentarios se envía en
el payload? ¿el endpoint lo persiste? ¿la columna existe en la tabla?). Revisar el POST de creación
vs el de edición (puede que el de edición sí guarde y el de creación no — patrón habitual).
Dejar un test o verificación que falle si vuelve a ocurrir.

### T2 · [MEJORA] Columna "responsable que envía a validar" en Validación de reclamos
Reportado 10-ago. En la sección de **validación de reclamos**, agregar una columna con el
**responsable que envió el reclamo a validar** (p.ej. el cubicador).
REGLA CLAVE: al pasar a la etapa siguiente (**admin de calidad**), esa columna debe SEGUIR mostrando
**quien envió a revisar** — NO quien validó. Es decir: el dato se captura al momento del envío y se
conserva; no se sobrescribe con el usuario de la etapa actual.
CONDICIÓN DEL USUARIO: "si esto generara problemas, no lo hagas" → si el dato no está persistido hoy
(no existe columna/registro de quién envió) y requiere migración + backfill de histórico, EVALUAR y
consultar antes de implementar. Si el dato ya existe (audit_log o campo de estado), es directo.

### T3 · [SEGURIDAD] Activar RLS en Supabase (warning "Table publicly accessible")
Reportado 11-ago (correo de Supabase + Security Advisor: 37 tablas de `public` sin Row-Level
Security). NO es algo que rompimos: es la condición del proyecto desde el inicio. Riesgo real HOY:
bajo — ArmaHub solo usa la conexión Postgres directa (la API REST automática de Supabase no se usa
y la llave `anon` no está publicada), pero la puerta existe sin candado.
FIX (barato, no afecta al backend porque se conecta como dueño de las tablas y el dueño ignora RLS):
pegar en el SQL Editor de Supabase:
```sql
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
```
Después: probar la web (login, listados, guardar barra). Revertir = mismo bloque con DISABLE.
Hacerlo en un momento tranquilo (no mientras un cubicador trabaja) y ANTES de la reunión de
infosec (~20-ago). Alternativa equivalente: Settings → API → quitar `public` de "Exposed schemas".
