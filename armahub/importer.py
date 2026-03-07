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

from fastapi import APIRouter, UploadFile, File, Depends, Query
import pandas as pd
from io import StringIO
from datetime import datetime, timezone
from typing import Optional

from .db import get_conn
from .auth import get_current_user

router = APIRouter()


@router.post("/import/armadetailer")
async def import_armadetailer(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
    reasignar_a: Optional[str] = Query(None, description="ID de proyecto existente para reasignar barras"),
    forzar: bool = Query(False, description="Forzar importación ignorando duplicados de nombre"),
    calculista: Optional[str] = Query(None, description="Nombre del calculista (solo al crear proyecto nuevo)"),
    confirmar_nuevo: bool = Query(False, description="Confirmar creación de proyecto nuevo"),
):
    raw = (await file.read()).decode("utf-8", errors="replace")
    lines = raw.splitlines()

    # Extraer nombre del proyecto desde línea 2: "PROYECTO: PROY-XXXX|Nombre Proyecto"
    proyecto_id = None
    proyecto_nombre = None
    plano_nombre = None  # Nombre del plano (si viene en metadatos)
    
    for line in lines[:10]:  # Buscar en metadatos (primeras 10 líneas)
        if line.startswith("PROYECTO:"):
            partes = line.replace("PROYECTO:", "").strip().split("|")
            if len(partes) >= 2:
                proyecto_id = partes[0].strip()
                proyecto_nombre = partes[1].strip()
        elif line.startswith("PLANO:"):
            # Formato esperado: "PLANO: UID-XXXX|Nombre del Plano"
            partes = line.replace("PLANO:", "").strip().split("|", 1)
            if len(partes) >= 2:
                plano_nombre = partes[1].strip()

    if not proyecto_id or not proyecto_nombre:
        return {"ok": False, "error": "No se encontró PROYECTO en línea 2 del formato 'PROYECTO: ID|NOMBRE'."}

    # --- Detección de proyectos duplicados (mismo nombre, distinto ID) ---
    if reasignar_a:
        # El usuario eligió reasignar a un proyecto existente
        proyecto_id = reasignar_a
    elif not forzar:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id_proyecto, nombre_proyecto
                    FROM proyectos
                    WHERE nombre_proyecto = %s AND id_proyecto != %s
                """, (proyecto_nombre, proyecto_id))
                duplicado = cur.fetchone()
                if duplicado:
                    return {
                        "ok": False,
                        "duplicate_warning": True,
                        "mensaje": f"Ya existe el proyecto \"{duplicado[1]}\" con ID {duplicado[0]}. El archivo trae ID {proyecto_id}.",
                        "proyecto_existente_id": duplicado[0],
                        "proyecto_existente_nombre": duplicado[1],
                        "proyecto_nuevo_id": proyecto_id,
                        "proyecto_nuevo_nombre": proyecto_nombre,
                        "archivo": file.filename,
                    }

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

    # Validación de sectores: rechazar archivo si contiene sectores inválidos
    SECTORES_VALIDOS = {"FUND", "ELEV", "LCIELO", "VCIELO"}
    sectores_en_csv = set()
    for val in df["SECTOR"].dropna().unique():
        s = str(val).strip().upper()
        if s and s != "NAN":
            sectores_en_csv.add(s)
    sectores_invalidos = sectores_en_csv - SECTORES_VALIDOS
    if sectores_invalidos:
        # Contar barras por sector inválido
        conteo = {}
        for val in df["SECTOR"].dropna():
            s = str(val).strip().upper()
            if s in sectores_invalidos:
                conteo[s] = conteo.get(s, 0) + 1
        detalle = ", ".join(f"{s} ({n} barras)" for s, n in sorted(conteo.items()))
        return {
            "ok": False,
            "invalid_sectors": True,
            "mensaje": f"El archivo contiene sectores inválidos: {detalle}. Sectores permitidos: {', '.join(sorted(SECTORES_VALIDOS))}. Corrige el archivo y vuelve a cargarlo.",
            "sectores_invalidos": sorted(sectores_invalidos),
            "sectores_validos": sorted(SECTORES_VALIDOS),
            "archivo": file.filename,
        }

    # Detectar si el proyecto es nuevo o existente
    is_new_project = False
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (proyecto_id,))
            is_new_project = cur.fetchone() is None

    # Si es proyecto nuevo y no se confirmó → pedir confirmación via popup
    if is_new_project and not confirmar_nuevo:
        return {
            "ok": False,
            "new_project": True,
            "mensaje": f"Proyecto nuevo detectado: \"{proyecto_nombre}\" (ID: {proyecto_id}). Confirma para crearlo.",
            "proyecto_id": proyecto_id,
            "proyecto_nombre": proyecto_nombre,
            "archivo": file.filename,
        }

    # Guardar o actualizar proyecto en tabla proyectos
    with get_conn() as conn:
        with conn.cursor() as cur:
            if is_new_project:
                # Nuevo: crear con owner_id y calculista
                cur.execute("SELECT id FROM users WHERE email = %s", (user.get("email"),))
                owner_row = cur.fetchone()
                owner_id = owner_row[0] if owner_row else None
                cur.execute("""
                    INSERT INTO proyectos (id_proyecto, nombre_proyecto, usuario_creador, owner_id, calculista)
                    VALUES (%s, %s, %s, %s, %s)
                """, (proyecto_id, proyecto_nombre, user.get("email", "unknown"), owner_id, calculista))
            else:
                # Existente: solo actualizar nombre
                cur.execute("""
                    UPDATE proyectos SET nombre_proyecto = %s WHERE id_proyecto = %s
                """, (proyecto_nombre, proyecto_id))

    now_iso = datetime.now(timezone.utc).isoformat()
    rows_to_upsert = []
    rejected_rows = []
    warnings = []

    for idx, r in df.iterrows():
        row_num = idx + 2  # +2: 1-indexed + header row

        # Validación: ID_UNICO obligatorio
        id_unico = str(r["ID_UNICO"]).strip() if pd.notna(r["ID_UNICO"]) else ""
        if not id_unico or id_unico == "nan":
            rejected_rows.append(f"Fila {row_num}: ID_UNICO vacío")
            continue

        # Parseo numérico con validación
        try:
            diam = float(r["DIAM"]) if pd.notna(r["DIAM"]) else None
        except (ValueError, TypeError):
            warnings.append(f"Fila {row_num}: DIAM inválido '{r['DIAM']}', se ignora")
            diam = None

        try:
            largo = float(r["LARGO_TOTAL"]) if pd.notna(r["LARGO_TOTAL"]) else None
        except (ValueError, TypeError):
            warnings.append(f"Fila {row_num}: LARGO_TOTAL inválido '{r['LARGO_TOTAL']}', se ignora")
            largo = None

        try:
            mult = float(r["MULT"]) if ("MULT" in df.columns and pd.notna(r["MULT"])) else None
        except (ValueError, TypeError):
            mult = None

        try:
            cant_total = float(r["CANT"]) if pd.notna(r["CANT"]) else None
        except (ValueError, TypeError):
            warnings.append(f"Fila {row_num}: CANT inválido '{r['CANT']}', se ignora")
            cant_total = None

        if cant_total is not None and mult is not None and mult > 0:
            cant = cant_total / mult
        else:
            cant = cant_total

        # Advertencia: datos incompletos para calcular peso
        if diam is None or largo is None:
            warnings.append(f"Fila {row_num}: sin diam/largo, peso no calculado")

        # Fórmula ArmaHub (diam mm, largo cm => kg)
        peso_unitario = None
        if diam is not None and largo is not None:
            peso_unitario = 7850 * 3.1416 * (diam / 2000) ** 2 * (largo / 100)

        peso_total = None
        if peso_unitario is not None and cant_total is not None:
            peso_total = peso_unitario * cant_total

        # Normalización de texto: strip whitespace, reemplazar nan
        def _clean(val):
            s = str(val).strip() if pd.notna(val) else ""
            return s if s and s.lower() != "nan" else ""

        rows_to_upsert.append((
            id_unico,
            str(r["ID_PROYECTO"]).strip(),
            proyecto_nombre,
            _clean(r["PLANO_CODE"]),
            plano_nombre,
            _clean(r["SECTOR"]),
            _clean(r["PISO"]),
            _clean(r["CICLO"]),
            _clean(r["EJE"]),
            diam,
            largo,
            mult,
            cant,
            cant_total,
            peso_unitario,
            peso_total,
            _clean(r["VERSION_MOD"]),
            _clean(r["VERSION_EXP"]),
            now_iso,
        ))

    upsert_sql = """
    INSERT INTO barras
    (id_unico,id_proyecto,nombre_proyecto,plano_code,nombre_plano,sector,piso,ciclo,eje,diam,largo_total,mult,cant,cant_total,peso_unitario,peso_total,version_mod,version_exp,fecha_carga)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT (id_unico) DO UPDATE SET
        id_proyecto=EXCLUDED.id_proyecto,
        nombre_proyecto=EXCLUDED.nombre_proyecto,
        plano_code=EXCLUDED.plano_code,
        nombre_plano=EXCLUDED.nombre_plano,
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

    total_kilos = sum(r[15] for r in rows_to_upsert if r[15] is not None)

    # Extraer version y plano del primer row para tracking
    first_version = str(df.iloc[0]["VERSION_EXP"]) if len(df) > 0 and pd.notna(df.iloc[0]["VERSION_EXP"]) else None
    first_plano = str(df.iloc[0]["PLANO_CODE"]) if len(df) > 0 and pd.notna(df.iloc[0]["PLANO_CODE"]) else None

    # Determinar estado de la importación
    if len(rows_to_upsert) == 0 and len(rejected_rows) > 0:
        estado = "error"
    elif len(rejected_rows) > 0:
        estado = "parcial"
    else:
        estado = "ok"

    # Construir resumen de errores (max 500 chars para BD)
    errores_text = None
    all_issues = rejected_rows + warnings[:20]  # Limitar warnings
    if all_issues:
        errores_text = "; ".join(all_issues)[:500]

    with get_conn() as conn:
        with conn.cursor() as cur:
            if rows_to_upsert:
                cur.executemany(upsert_sql, rows_to_upsert)
            # Registrar en historial de importaciones
            cur.execute("""
                INSERT INTO imports (id_proyecto, nombre_proyecto, usuario, archivo, fecha, barras_count, kilos, estado, version_archivo, plano_code, errores)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                proyecto_id,
                proyecto_nombre,
                user.get("email", "unknown"),
                file.filename or "sin_nombre.csv",
                now_iso,
                len(rows_to_upsert),
                round(total_kilos, 2),
                estado,
                first_version,
                first_plano,
                errores_text,
            ))

    result = {
        "ok": True,
        "proyecto": proyecto_nombre,
        "rows_upserted": len(rows_to_upsert),
        "kilos": round(total_kilos, 2),
        "total_filas_csv": len(df),
        "filas_rechazadas": len(rejected_rows),
        "advertencias": len(warnings),
        "estado": estado,
    }
    if rejected_rows:
        result["rejected"] = rejected_rows[:10]
    if warnings:
        result["warnings"] = warnings[:10]
    return result