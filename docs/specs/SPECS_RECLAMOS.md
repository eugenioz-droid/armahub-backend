# Especificaciones Funcionales — Caluga Reclamos

> **Propósito:** fuente de verdad funcional de la caluga. Se actualiza cada vez que se agrega,
> cambia o elimina un flujo, rol o comportamiento. Sirve para ordenar implementaciones y como
> referencia para nuevos roles o secciones.
>
> Última actualización: 2026-06-10

---

## 1. Propósito de la caluga

Gestión del ciclo de vida de reclamos de calidad: desde el registro inicial hasta el cierre con
PDF e informe enviado por correo. Incluye análisis de causa, acciones correctivas y validación.

**Usuarios principales:** USC (crea y supervisa), Cubicador/Externo (analiza y responde), Admin (gestión total).

---

## 2. Flujo de estados

```
abierto → en_analisis → validacion → cerrado
                                   ↘ rechazado → en_analisis (reabre automático)
```

| Estado | Significado | Quién puede avanzar |
|--------|-------------|---------------------|
| `abierto` | Recién creado, esperando respuesta | USC crea; cubicador/externo responden |
| `en_analisis` | Cubicador está trabajando el análisis | — |
| `validacion` | Cubicador envió para que USC valide | Cubicador/Externo (propios) + admin/admin2 |
| `cerrado` | USC validó y aprobó | Admin/admin2 |
| `rechazado` | Rechazado definitivamente | Admin/admin2 |

---

## 3. Roles y permisos por acción

### 3.1 Crear reclamo
- USC: sí, se auto-asigna como responsable
- Admin/admin2: sí
- Cubicador/Externo/Cliente: no

### 3.2 Ver listado
- Admin/admin2/cubicador: todos los reclamos (toggle "Todos/Mis Reclamos")
- USC: propios por defecto (toggle disponible para ver todos en lectura)
- Externo: solo propios, sin toggle
- Cliente: no tiene acceso a la caluga

### 3.3 Ver detalle (GET /reclamos/{id})
- Admin/admin2/cubicador: cualquier reclamo
- USC: solo donde es `creado_por` o `asignado_a`
- Externo: solo donde es `cubicador_asignado` o `respuesta_por`
- Cliente: no

### 3.4 Sección 1 — Registro (form básico)
Campos: título, descripción, proyecto, USC responsable, cubicador responsable, prioridad, id_calidad, observaciones.

| Acción | Admin/admin2 | USC (propio) | Cubicador | Externo | Cliente |
|--------|:---:|:---:|:---:|:---:|:---:|
| Ver | ✅ | ✅ | ✅ | ✅ | — |
| Editar | ✅ | ✅ (estado=abierto) | — | — | — |

### 3.5 Sección 2 — Análisis (form cubicador)
Campos: categoría Ishikawa, sub-causa, respuesta/justificación, área aplica, fecha análisis, kilos mal fabricados, imágenes de análisis, acciones correctivas.

| Acción | Admin/admin2 | USC | Cubicador (propio) | Externo (propio) | Cliente |
|--------|:---:|:---:|:---:|:---:|:---:|
| Ver | ✅ | ✅ | ✅ | ✅ | — |
| Editar | ✅ | — | ✅ | ✅ | — |
| **Botón "Enviar a validación"** (morado) | ✅ | — | ✅ | ✅ | — |

> El botón morado aparece para cubicador Y externo (propios). Fue un bug que externo no lo tenía — corregido 2026-06-10.

### 3.6 Sección 3 — Validación (rectángulo verde)
Campos: resultado (aprobado/rechazado/corregido), observaciones, tiempo de respuesta.

| Acción | Admin/admin2 | USC | Cubicador | Externo | Cliente |
|--------|:---:|:---:|:---:|:---:|:---:|
| **Ver sección** | ✅ | — | — | — | — |
| Editar y guardar | ✅ | — | — | — | — |

> La sección completa (rectángulo verde) es invisible para todos excepto admin/admin2. Corregido 2026-06-10 (antes los campos se deshabilitaban pero el contenedor era visible).

### 3.7 Imágenes
| Tipo | Quién puede subir | Quién puede eliminar |
|------|-------------------|----------------------|
| ImagenesRegistro (evidencia USC) | Admin/admin2/USC | Admin/admin2 + USC (propios) |
| ImagenesAnalisis (evidencia cubicador) | Admin/admin2/Cubicador/Externo | Admin/admin2 + Cubicador/Externo (propios) |

Las imágenes viven en Cloudflare R2 (`reclamos/registro/` y `reclamos/analisis/`).
Se sirven via presigned URL (válida 1 hora). No hay URL pública permanente — acceso requiere
autenticación para obtener la URL, pero la URL en sí es válida durante 1 hora sin reautenticarse.
**Política aceptada:** para uso interno de Armacero, esto es suficiente.

### 3.8 Acciones correctivas
| Acción | Admin/admin2 | USC (propio) | Cubicador (propio) | Externo (propio) |
|--------|:---:|:---:|:---:|:---:|
| Agregar | ✅ | — | ✅ | ✅ |
| Editar | ✅ | ✅ | ✅ | ✅ |
| Eliminar | ✅ | ✅ | ✅ | ✅ |

### 3.9 PDF e informe por correo
| Acción | Admin/admin2 | USC (propio) | Cubicador (propio) | Externo |
|--------|:---:|:---:|:---:|:---:|
| Exportar PDF | ✅ | ✅ | ✅ | — |
| Enviar informe por correo | ✅ | ✅ | — | — |

El PDF incluye: header, sección registro, análisis, acciones, validación, imágenes, timeline de seguimientos.
Imágenes se descargan de R2 en el momento de generar el PDF.

---

## 4. Pendientes funcionales (F5 del programa)

| # | Descripción | Estado |
|---|-------------|--------|
| 5.3 | Política acceso imágenes R2 documentada — presigned URL 1h, aceptado para uso interno | ☑ |
| 5.4 | QA visual PDF: campos largos, reclamos sin acciones, sin validación | ☐ |
| 5.5 | Fix: cubicador externo sin botón "enviar a validar" | ☑ (2026-06-10) |
| 5.6 | Optimizar query listado: LEFT JOIN + GROUP BY + índices | ☐ |
| 5.7 | Evaluar split de reclamos.py | ☐ |
| 5.8–5.12 | Envío de informe por correo (tabla reclamo_envios, endpoint, UI, historial, dashboard) | ☐ |
| 5.13–5.17 | Multi-origen: tipos, orígenes, UI segmentable | ☐ |

---

## 5. Decisiones de diseño registradas

- **Un solo helper de correo** (`mailer.py`) reutilizado por todas las calugas — no duplicar.
- **No hay estado `accion_correctiva`** — fue eliminado (migración 46), todo pasa a `cerrado`.
- **No hay estado `validado`** — fue eliminado (migración 47), merged a `cerrado`.
- **Correlativo de calidad:** `anio_calidad` (int) + `numero_calidad` (int), display como "2026-003".
- **Multi-origen pendiente de discovery** con el usuario antes de implementar (F5C).
