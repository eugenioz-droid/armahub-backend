# Tarea — Combobox buscable (desplegable con búsqueda) reutilizable

> **Estado:** PENDIENTE. Mejora transversal de UX.
> **Objetivo:** reemplazar los `<select>` de listas largas por un componente que permita escribir para filtrar las opciones dinámicamente.

## Rendimiento — confirmado SIN problema
El filtrado es **en el cliente**, sobre opciones ya cargadas en el DOM: cero llamadas extra al servidor, instantáneo. El riesgo de rendimiento solo aparece con listas de **miles** de opciones (ahí se requiere búsqueda paginada en backend) — no es el caso de esta plataforma (clientes, usuarios, proyectos están en órdenes de decenas/cientos). Si alguna lista creciera mucho, se migra ese caso puntual a búsqueda server-side.

## Componente propuesto
Un helper reutilizable `makeSearchableSelect(selectId)` que envuelve un `<select>` existente y le agrega un input de búsqueda que filtra las opciones. Sin librerías externas (mantener el patrón vanilla actual). Aplicable de forma incremental: se conecta select por select sin reescribir formularios.

## Levantamiento — dónde aplica (beneficio alto → bajo)

### Alto (listas que crecen: clientes, usuarios, proyectos)
| Ubicación | Select | Archivo |
|---|---|---|
| Reclamos — crear | `recProyecto` (proyecto) | reclamos.html:66 |
| Reclamos — crear | `recResponsable` (usuario) | reclamos.html:160 |
| Reclamos — filtros | `recFiltroProyecto` | reclamos.html:237 |
| Reclamos — filtros | `recFiltroResponsable` | reclamos.html:240 |
| Reclamos — detalle | `recDetailProyecto` | reclamos.html:278 |
| Reclamos — editar | `recEditProyecto` | reclamos.html:326 |
| Reclamos — editar | `recEditResponsable` | reclamos.html:342 |
| **Reclamos Internos (futuro)** | cliente, área destino | (a crear) |
| Admin — áreas | `areaUserSelect` (asignar usuario a área) | admin.html |
| Obras — crear | `newObraCliente`, `newObraCalculista` | obras.html:117,123 |
| Proyecto (app) | `newProjCliente` | app.html:164 |
| Obra editar | `editObraCalculista` | app.html:237 |
| Pedidos | `pedidoProyecto` | pedidos.html:9 |

### Bajo (listas cortas/fijas: no urgente)
Estados, tipos, categorías, prioridad, año, unidades de tiempo, roles — son enumeraciones cortas (<10 opciones). No necesitan búsqueda; se pueden dejar como están.

## Orden sugerido
1. Crear el helper `makeSearchableSelect`.
2. Aplicarlo primero a los de Reclamos (cliente, proyecto, responsable) — son los más usados.
3. Extender a Obras/Pedidos/Admin.

## Notas
- Mantener accesible por teclado (flechas + enter).
- Conservar el `id` del `<select>` original para no romper el código que lee `.value`.
- Reusar en Reclamos Internos desde el inicio (cliente y área destino).
