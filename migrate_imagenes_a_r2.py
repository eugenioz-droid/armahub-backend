"""
migrate_imagenes_a_r2.py
------------------------
Migración one-shot: copia las imágenes de reclamos desde BYTEA (columna `data`
en PostgreSQL) hacia Cloudflare R2, y guarda el `storage_key` en la BD.

GARANTÍAS DE SEGURIDAD:
- NO DESTRUCTIVO: no borra el BYTEA original. Quedan las dos copias (BD + R2)
  hasta que el usuario valide y decida limpiar (paso aparte, tarea 3.9).
- IDEMPOTENTE: si una imagen ya tiene storage_key, se omite. Se puede correr
  varias veces sin re-subir ni duplicar.
- La asociación imagen↔reclamo NO se toca: la fila y su `reclamo_id` se conservan;
  el storage_key incluso incluye el reclamo_id en la ruta (reclamos/<tipo>/<id>/...).
- Si una imagen falla, se reporta y se continúa con las demás (no aborta todo).

REQUISITOS:
- Variables de entorno R2 configuradas (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY, R2_BUCKET) y DATABASE_URL apuntando a la BD.
- boto3 instalado.

USO:
    python migrate_imagenes_a_r2.py            # migra de verdad
    python migrate_imagenes_a_r2.py --dry-run  # solo cuenta y simula, no sube nada
"""

import sys
from armahub.db import get_conn
from armahub import storage


def _tipo_to_subcarpeta(tipo: str) -> str:
    return "analisis" if tipo == "ImagenesAnalisis" else "registro"


def main(dry_run: bool = False) -> int:
    if not storage.is_configured():
        print("ERROR: R2 no está configurado (faltan boto3 o env vars R2_*).")
        print("Configura las credenciales R2 antes de migrar.")
        return 1

    print(f"Storage R2: {storage.health()}")
    print(f"Modo: {'DRY-RUN (no sube nada)' if dry_run else 'MIGRACIÓN REAL'}")
    print("-" * 60)

    # 1) Inventario: imágenes con BYTEA y sin storage_key todavía
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, reclamo_id, filename, content_type, tipo,
                       octet_length(data) AS bytes
                FROM reclamo_imagenes
                WHERE data IS NOT NULL
                  AND (storage_key IS NULL OR storage_key = '')
                ORDER BY id ASC
            """)
            pendientes = cur.fetchall()

    total = len(pendientes)
    print(f"Imágenes pendientes de migrar: {total}")
    if total == 0:
        print("Nada que migrar. Todo ya está en R2 o no hay imágenes.")
        return 0

    total_bytes = sum((r[5] or 0) for r in pendientes)
    print(f"Tamaño total a mover: {total_bytes / (1024*1024):.1f} MB")
    print("-" * 60)

    if dry_run:
        for img_id, reclamo_id, filename, ct, tipo, nbytes in pendientes:
            sub = _tipo_to_subcarpeta(tipo or "ImagenesRegistro")
            key = storage.build_key("reclamos", sub, str(reclamo_id), filename=filename or f"img_{img_id}")
            print(f"  [dry] img {img_id} (reclamo {reclamo_id}) → {key}")
        print("-" * 60)
        print(f"DRY-RUN completo. {total} imágenes se migrarían. Nada subido.")
        return 0

    # 2) Migración real, una por una
    ok = 0
    fallidas = []
    for img_id, reclamo_id, filename, ct, tipo, nbytes in pendientes:
        try:
            # Leer el binario de esta imagen puntual
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT data FROM reclamo_imagenes WHERE id = %s", (img_id,))
                    row = cur.fetchone()
                    if not row or row[0] is None:
                        fallidas.append((img_id, "sin data"))
                        continue
                    data = bytes(row[0])

            # Subir a R2
            sub = _tipo_to_subcarpeta(tipo or "ImagenesRegistro")
            key = storage.build_key("reclamos", sub, str(reclamo_id), filename=filename or f"img_{img_id}")
            storage.upload_file(key, data, ct or "application/octet-stream")

            # Guardar storage_key (NO se borra el BYTEA)
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE reclamo_imagenes SET storage_key = %s WHERE id = %s",
                        (key, img_id),
                    )

            ok += 1
            print(f"  ✓ img {img_id} (reclamo {reclamo_id}) → {key}")
        except Exception as exc:
            fallidas.append((img_id, str(exc)))
            print(f"  ✗ img {img_id}: {exc}")

    print("-" * 60)
    print(f"Migradas OK: {ok}/{total}")
    if fallidas:
        print(f"Fallidas: {len(fallidas)}")
        for img_id, err in fallidas:
            print(f"   - img {img_id}: {err}")
        print("Las fallidas conservan su BYTEA intacto. Se pueden reintentar.")
    print("")
    print("IMPORTANTE: el BYTEA original NO se borró. Validar que las imágenes se")
    print("ven bien desde R2 antes de eliminar la columna `data` (tarea 3.9).")
    return 0 if not fallidas else 2


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    sys.exit(main(dry_run=dry))
