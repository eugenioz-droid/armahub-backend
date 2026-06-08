# Documentacion ArmaHub

Este directorio concentra la documentacion operativa y tecnica vigente de ArmaHub.

## Documentos principales

| Documento | Estado | Uso |
|-----------|--------|-----|
| `../armahub-protocolo.md` | Vigente | Protocolo especifico del proyecto |
| `programa-versiones/programa_v1.00.md` | **Vigente (oficial, reordenado 2026-06-08)** | Programa de trabajo activo |
| `Armahub_Documento_Base_Desarrollo_v0_1.docx` | Fuente de producto (guia, no definitiva) | Vision base de plataforma, calugas y fases |
| `../ROLES_Y_PERMISOS.md` | Vigente por auditar | Matriz de roles, vistas y acciones |
| `../MODELO_DE_DATOS.md` | Desactualizado (dice migraciones 28-32; real ~52) | Por actualizar en tarea 1.6 del programa |

## Documentos fuente / historicos

| Documento | Estado | Accion |
|-----------|--------|--------|
| `archive/superseded/programa_v1.00_codex.md` | Superseded | Version inicial CODEX, reemplazada por el programa vigente. Solo trazabilidad |
| `../Roadmap.md` | Fuente historica (OBSOLETO) | Pendientes ya barridos al programa vigente. Archivar (tarea 1.3) |
| `../ROADMAP_RECLAMOS.md` | Fuente historica (OBSOLETO) | Pendientes ya barridos al programa vigente. Archivar (tarea 1.3) |
| `../refactor-analysis.md` | Fuente arquitectonica | Decision cerrada en tarea 1.4: backend se mantiene por dominio, NO migra a modules/ |
| `../diseno_repositorios_imagenes.md` | Fuente tecnica | Decision cerrada en tarea 1.5: storage va a R2, NO filesystem local |

## Estructura

```text
docs/
├─ README.md
├─ programa-versiones/
│  └─ programa_v1.00.md
└─ archive/
   └─ superseded/
      └─ README.md
```

## Regla de limpieza

No se elimina ni mueve ningun documento historico sin confirmacion del usuario. Primero se clasifica, luego se archiva o se reemplaza.
