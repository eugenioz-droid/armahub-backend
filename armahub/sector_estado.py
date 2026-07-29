"""5N.3/5N.4 (Rediseno B) — Estado del SECTOR CONSTRUCTIVO como entidad.

El sector constructivo = (id_proyecto, sector, piso, ciclo). Estos helpers mantienen la
tabla `sector_estado` (migracion 086) actualizada por EVENTOS, reemplazando el hack de
"restar fechas" (export_log.fecha vs MAX(barras.fecha_carga)) que tenia una brecha: no
detectaba las ediciones de barra.

Estados:
    'pendiente'  -> nunca exportado
    'exportado'  -> al dia (exportado, sin cambios posteriores)
    'modificado' -> cambio despues de exportar (rojo en las matrices)

DISENO:
- Todas las funciones reciben un CURSOR ya abierto (participan de la transaccion del
  caller: crear/editar barra, exportar). No abren conexion propia -> atomicidad con la
  operacion que dispara el evento.
- Nunca borran barras ni datos. Solo hacen UPSERT del estado del sector.
- La clave unica coincide EXACTA con el indice ux_sector_estado_clave de la migracion
  086: (id_proyecto, COALESCE(sector,''), COALESCE(piso,''), COALESCE(ciclo,'')).
"""

from datetime import datetime, timezone


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def marcar_sector_modificado(cur, id_proyecto, sector, piso, ciclo, por=None):
    """Evento: el contenido del sector cambio (crear/editar/eliminar barra, o reimport
    con cambios). Si el sector estaba 'exportado', pasa a 'modificado'. Si no existia,
    se crea como 'pendiente' (nunca fue exportado, no hay nada desactualizado todavia).

    Idempotente por la clave unica; el ON CONFLICT decide la transicion.
    """
    now = _now_iso()
    # Columnas NOT NULL DEFAULT '' (migracion 086) → normalizar NULL a '' y usar ON
    # CONFLICT sobre columnas DIRECTAS (Postgres lo matchea siempre; con COALESCE en el
    # target no, y colgaba el arranque).
    sector = sector or ''; piso = piso or ''; ciclo = ciclo or ''
    cur.execute(
        """
        INSERT INTO sector_estado
            (id_proyecto, sector, piso, ciclo, estado, modificado_fecha, actualizado_fecha, actualizado_por)
        VALUES (%s, %s, %s, %s, 'pendiente', %s, %s, %s)
        ON CONFLICT (id_proyecto, sector, piso, ciclo)
        DO UPDATE SET
            -- Si estaba exportado, ahora esta desactualizado -> 'modificado'.
            -- Si estaba pendiente, sigue pendiente (nunca se exporto). 'modificado' se mantiene.
            estado = CASE WHEN sector_estado.estado = 'exportado' THEN 'modificado'
                          ELSE sector_estado.estado END,
            modificado_fecha = EXCLUDED.modificado_fecha,
            actualizado_fecha = EXCLUDED.actualizado_fecha,
            actualizado_por = EXCLUDED.actualizado_por
        """,
        (id_proyecto, sector, piso, ciclo, now, now, por),
    )


def marcar_sector_exportado(cur, id_proyecto, sector, piso, ciclo, por=None):
    """Evento: el sector se exporto. Pasa a 'exportado' (al dia), sin importar el estado
    previo. Se registra la fecha de exportacion.
    """
    now = _now_iso()
    sector = sector or ''; piso = piso or ''; ciclo = ciclo or ''
    cur.execute(
        """
        INSERT INTO sector_estado
            (id_proyecto, sector, piso, ciclo, estado, exportado_fecha, actualizado_fecha, actualizado_por)
        VALUES (%s, %s, %s, %s, 'exportado', %s, %s, %s)
        ON CONFLICT (id_proyecto, sector, piso, ciclo)
        DO UPDATE SET
            estado = 'exportado',
            exportado_fecha = EXCLUDED.exportado_fecha,
            actualizado_fecha = EXCLUDED.actualizado_fecha,
            actualizado_por = EXCLUDED.actualizado_por
        """,
        (id_proyecto, sector, piso, ciclo, now, now, por),
    )


def estado_de_sectores(cur, id_proyecto):
    """Devuelve {export_key: {estado, exportado_fecha, modificado_fecha}} para el
    proyecto. export_key = UPPER(sector)_piso_ciclo, MISMA convencion que el dirty-flag
    actual (export.py) para que el frontend no cambie de clave. Lo consumen los lectores
    del dirty-flag (export-history) al migrar a estados persistidos.
    """
    cur.execute(
        """
        SELECT UPPER(sector) || '_' || piso || '_' || ciclo AS export_key,
               estado, exportado_fecha, modificado_fecha
        FROM sector_estado
        WHERE id_proyecto = %s
        """,
        (id_proyecto,),
    )
    out = {}
    for key, estado, exp_f, mod_f in cur.fetchall():
        out[key] = {"estado": estado, "exportado_fecha": exp_f, "modificado_fecha": mod_f}
    return out
