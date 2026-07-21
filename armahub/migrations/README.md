# Migraciones ArmaHub

Directorio de migraciones de base de datos. **A partir de la migración 82**, cada
migración nueva va como su propio archivo `.sql` aquí (registro ordenado, estilo Tekplan).

Las migraciones 1–81 viven en el array `MIGRATIONS` dentro de `armahub/db.py` (legacy,
no se tocan). El cargador aplica primero ese array y luego los archivos de este directorio,
todo contra el mismo registro `schema_migrations` (por número de versión).

## Cómo agregar una migración nueva

1. Crea un archivo con el formato **`NNN_descripcion_corta.sql`**, donde `NNN` es el
   número de versión (siguiente disponible, ≥ 82). Ejemplo: `082_obras_columna_estado.sql`.
2. Escribe el SQL. Puede tener varias sentencias separadas por `;`. Usa `IF NOT EXISTS`
   o el patrón `DO $$ ... EXCEPTION WHEN duplicate_column THEN NULL ... $$` para que sea
   idempotente (no falle si ya se aplicó parcialmente).
3. La primera línea puede ser un comentario `-- descripción` que se guarda como
   descripción de la migración.
4. Al arrancar la app, la migración se aplica sola si aún no está en `schema_migrations`.

## Reglas

- **Numeración correlativa y única.** No repetir números. El siguiente disponible manda.
- **Nunca modificar una migración ya aplicada** (en producción ya corrió). Para corregir,
  crear una migración nueva.
- **No borrar archivos** de migraciones ya aplicadas (rompe la trazabilidad).
- El número de versión sale del prefijo `NNN` del nombre del archivo.

## Ejemplo (`082_ejemplo.sql`)

```sql
-- obras: columna estado (ejemplo)
DO $$ BEGIN
  ALTER TABLE proyectos ADD COLUMN estado TEXT DEFAULT 'activa';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```
