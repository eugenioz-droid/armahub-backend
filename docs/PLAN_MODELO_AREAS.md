# Plan — Conectar el modelo de áreas al flujo de reclamos

> **Objetivo:** que el flujo de un reclamo (con o sin etapa de revisión) y los permisos se decidan por el **área real** del reclamo, no por heurística de texto. Habilita: el flag de revisión configurable, el filtrado por área, y desbloquea el listado de Reclamos Internos (Fase 5 del refactor).
>
> **Estado:** PLANIFICADO. Base ya existente: tablas `areas` (11 áreas), `area_usuarios`, `area_rca_*` (migraciones 55-58).
> **Decisiones del usuario (2026-06-12):** ver al final.

---

## 1. Principio de diseño: UN flujo con una etapa opcional

No son "dos flujos". Es **un flujo** con una etapa de revisión **opcional por área**:

```
ABIERTO → EN_ANALISIS → [EN_REVISION] → VALIDACION → CERRADO
                            ▲
                            └── opcional: solo si el área tiene_revision = TRUE
```

- **Área sin revisión** (nivel base, solo Jefe de Servicio): `en_analisis → validacion` directo.
- **Área con revisión** (el jefe sumó gente bajo él): `en_analisis → en_revision → validacion`.

El "nivel" del que habla el usuario = el flag `tiene_revision` del área. No hay rol nuevo: cualquier **miembro del área** puede hacer el análisis inicial; si el área tiene revisión, su Jefe de Servicio revisa antes de Calidad.

## 2. Modelo de niveles (decisión del usuario)

| Nivel del área | Quién hay | tiene_revision | Flujo |
|---|---|---|---|
| Base | Solo Jefe de Servicio | FALSE | análisis → validación (directo a Calidad) |
| +1 (con revisión) | Jefe + miembros que analizan | TRUE | análisis (miembro) → revisión (jefe) → validación (Calidad) |

- Hoy solo **Cubicaciones** está en nivel +1 (`tiene_revision = TRUE`).
- El resto (Producción, Logística, etc.) arranca en nivel base.
- Cualquier **miembro** del área puede hacer el análisis (no se requiere un rol "analista" explícito — decisión del usuario).

## 3. Cambios de datos

### 3.1 Flag de revisión por área
- **Migración:** `ALTER TABLE areas ADD COLUMN tiene_revision BOOLEAN DEFAULT FALSE;`
- Seed: `UPDATE areas SET tiene_revision = TRUE WHERE slug = 'cubicaciones';`
- **Una sola fuente de verdad por área.** NO va en la tabla usuarios (sería duplicar y desincronizar — el flag describe al área, no a la persona).

### 3.2 Área del reclamo
- **Migración:** `ALTER TABLE reclamos ADD COLUMN area_id BIGINT REFERENCES areas(id);`
- **Se infiere del usuario**, no se pide en pantalla: al crear/asignar, `area_id` sale del `area_usuarios` del responsable. Si el usuario tiene varias áreas → caso borde: se elige (raro; resolver con un desplegable solo en ese caso).
- **Migración de datos viejos:** mapear `area_aplica` (texto) → `area_id` por nombre/slug. `area_aplica` se conserva como histórico, no se dropea (regla de integridad: no borrar datos).

## 4. Cambios de lógica

### 4.1 Decisión del flujo (reemplaza la heurística de texto)
Hoy en `detail-flow.js` (`cerrarReclamo`):
```js
var esCubicacion = (area.indexOf('cubicac') === 0) || !!cubicador_asignado;  // ❌ heurística
```
Nuevo: el backend (o el front leyendo el área) decide por `areas.tiene_revision` del `area_id` del reclamo:
```
estadoDestino = area.tiene_revision ? 'en_revision' : 'validacion'
```
Lo correcto es que **el backend** resuelva el estado destino al enviar, leyendo el flag del área. El front solo manda "enviar"; el backend sabe si hay revisión o no. Más robusto (no se puede falsear desde el cliente).

### 4.2 Permisos por área
- "En revisión" la ve el **Jefe de Servicio de ESA área** (de `area_usuarios.rol_area = 'jefe_servicio'`), no cualquier admin. (admin/admin_calidad siguen como fallback total).
- La cola "En revisión" del sub-tab Validaciones se filtra por las áreas donde el usuario es jefe.

## 5. Panel del flag (decisión del usuario: simple, en Admin)
- Mini-listado de las 11 áreas con un checkbox `tiene_revision` cada una, en Admin/Gestión.
- Endpoint `GET/PATCH /areas` (o reusar el de áreas si existe).
- Migrable a Calidad más adelante (no se justifica hoy).

## 6. Cubicador externo
- Es un **miembro del área Cubicaciones** con acceso restringido: solo tab Reclamos, solo sus propios reclamos.
- No se crea tipo de usuario nuevo. Los roles legacy `cubicador`/`externo` se mantienen por compatibilidad.

## 7. Matriz de acceso (quién entra a dónde)
Se mantiene como **tabla viva en SPECS** (sección nueva 1.6), fácil de editar: rol × tab/módulo × permiso. Fuente de verdad de "quién ve qué". Ver SPECS.

---

## 8. Fases de ejecución (cada una: commit + push + prueba)

**Fase A — Flag de revisión por área**
- Migración `tiene_revision` + seed Cubicaciones.
- Panel checkbox en Admin/Gestión + endpoint.
- (Aún no cambia el flujo; solo deja el dato y el panel listos.)

**Fase B — area_id en reclamos**
- Migración `area_id` + migración de datos `area_aplica → area_id`.
- Inferir `area_id` del usuario al crear/asignar.

**Fase C — Flujo por flag**
- `cerrarReclamo`/backend deciden el estado destino por `area.tiene_revision`.
- Quitar la heurística de texto.
- Prueba: Cubicaciones pasa por revisión; otra área va directo.

**Fase D — Permisos por área**
- Cola "En revisión" filtrada por las áreas donde el usuario es jefe_servicio.

**Fase E — Reclamos Internos (Fase 5 del refactor)**
- Parametrizar `list.js`, reusar el modal. Distinguir cliente/interno (definir: ¿por área? ¿flag?).

---

## 9. Decisiones tomadas (2026-06-12)
- Área del reclamo: **se infiere del usuario** (su `area_usuarios`).
- Flag `tiene_revision`: **en la tabla `areas`** (NO en usuarios). Panel simple en Admin.
- Análisis inicial: **cualquier miembro** del área (sin rol "analista" explícito).
- "Niveles" = el flag por área. Hoy solo Cubicaciones en TRUE.
- Cubicador externo = miembro de Cubicaciones con acceso restringido.

## 10. Pendiente de definir (antes de Fase E)
- Cómo se marca un reclamo como **interno** vs **cliente** (¿el área lo determina? ¿un flag aparte?).
- Columnas de la tabla de Internos.
