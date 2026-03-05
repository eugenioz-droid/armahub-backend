"""
importer.py
-----------
Importación del CSV desde ArmaDetailer.

Endpoint:
- POST /import/armadetailer

Características:
- Busca cabecera "ID|ESTRUCTURA|" para ignorar metadata previa
- Lee CSV con separador "|"
- Calcula peso según fórmula ArmaHub
- UPSERT masivo (executemany + ON CONFLICT) para rendimiento
"""

from fastapi import APIRouter, UploadFile, File, Depends
import pandas as pd
from io import StringIO
from datetime import datetime, timezone

from .db import get_conn
from .auth import get_current_user

router = APIRouter()


@router.post("/import/armadetailer")
async def import_armadetailer(file: UploadFile = File(...), user=Depends(get_current_user)):
    raw = (await file.read()).decode("utf-8", errors="replace")
    lines = raw.splitlines()

    # Extraer nombre del proyecto desde línea 2: "PROYECTO: PROY-XXXX|Nombre Proyecto"
    proyecto_id = None
    proyecto_nombre = None
    
    for line in lines[:6]:  # Buscar en metadatos (primeras 6 líneas)
        if line.startswith("PROYECTO:"):
            partes = line.replace("PROYECTO:", "").strip().split("|")
            if len(partes) >= 2:
                proyecto_id = partes[0].strip()
                proyecto_nombre = partes[1].strip()
            break

    if not proyecto_id or not proyecto_nombre:
        return {"ok": False, "error": "No se encontró PROYECTO en línea 2 del formato 'PROYECTO: ID|NOMBRE'."}

    # Buscar cabecera "ID|ESTRUCTURA|" para ignorar metadata previa
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith("ID|ESTRUCTURA|"):
            header_idx = i
            break
    if header_idx is None:
        return {"ok": False, "error": "No se encontró cabecera ID|ESTRUCTURA| en el CSV."}

    data_text = "\n".join(lines[header_idx:])
    df = pd.read_csv(StringIO(data_text), sep="|")

    required = [
        "ID_UNICO", "ID_PROYECTO", "PLANO_CODE",
        "SECTOR", "PISO", "CICLO", "EJE",
        "DIAM", "LARGO_TOTAL", "CANT",
        "VERSION_MOD", "VERSION_EXP"
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        return {"ok": False, "error": f"Faltan columnas requeridas: {missing}"}

    # Guardar o actualizar proyecto en tabla proyectos
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO proyectos (id_proyecto, nombre_proyecto, usuario_creador)
                VALUES (%s, %s, %s)
                ON CONFLICT (id_proyecto) DO UPDATE SET nombre_proyecto = EXCLUDED.nombre_proyecto
            """, (proyecto_id, proyecto_nombre, user.get("email", "unknown")))

    now_iso = datetime.now(timezone.utc).isoformat()
    rows_to_upsert = []

    for _, r in df.iterrows():
        diam = float(r["DIAM"]) if pd.notna(r["DIAM"]) else None
        largo = float(r["LARGO_TOTAL"]) if pd.notna(r["LARGO_TOTAL"]) else None
        mult = float(r["MULT"]) if ("MULT" in df.columns and pd.notna(r["MULT"])) else None

        cant_total = float(r["CANT"]) if pd.notna(r["CANT"]) else None
        if cant_total is not None and mult is not None and mult > 0:
            cant = cant_total / mult
        else:
            cant = cant_total

        # Fórmula ArmaHub (diam mm, largo cm => kg)
        peso_unitario = None
        if diam is not None and largo is not None:
            peso_unitario = 7850 * 3.1416 * (diam / 2000) ** 2 * (largo / 100)

        peso_total = None
        if peso_unitario is not None and cant_total is not None:
            peso_total = peso_unitario * cant_total

        rows_to_upsert.append((
            str(r["ID_UNICO"]),
            str(r["ID_PROYECTO"]),
            proyecto_nombre,
            str(r["PLANO_CODE"]),
            str(r["SECTOR"]),
            str(r["PISO"]),
            str(r["CICLO"]),
            str(r["EJE"]),
            diam,
            largo,
            mult,
            cant,
            cant_total,
            peso_unitario,
            peso_total,
            str(r["VERSION_MOD"]),
            str(r["VERSION_EXP"]),
            now_iso,
        ))

    upsert_sql = """
    INSERT INTO barras
    (id_unico,id_proyecto,nombre_proyecto,plano_code,sector,piso,ciclo,eje,diam,largo_total,mult,cant,cant_total,peso_unitario,peso_total,version_mod,version_exp,fecha_carga)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT (id_unico) DO UPDATE SET
        id_proyecto=EXCLUDED.id_proyecto,
        nombre_proyecto=EXCLUDED.nombre_proyecto,
        plano_code=EXCLUDED.plano_code,
        sector=EXCLUDED.sector,
        piso=EXCLUDED.piso,
        ciclo=EXCLUDED.ciclo,
        eje=EXCLUDED.eje,
        diam=EXCLUDED.diam,
        largo_total=EXCLUDED.largo_total,
        mult=EXCLUDED.mult,
        cant=EXCLUDED.cant,
        cant_total=EXCLUDED.cant_total,
        peso_unitario=EXCLUDED.peso_unitario,
        peso_total=EXCLUDED.peso_total,
        version_mod=EXCLUDED.version_mod,
        version_exp=EXCLUDED.version_exp,
        fecha_carga=EXCLUDED.fecha_carga
    """

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(upsert_sql, rows_to_upsert)

    return {"ok": True, "proyecto": proyecto_nombre, "rows_upserted": len(rows_to_upsert)}