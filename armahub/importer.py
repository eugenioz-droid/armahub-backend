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
import uuid

from .db import get_conn, audit
from .auth import get_current_user, ROL_MAP
from . import cache as _cache

router = APIRouter()


@router.post("/import/armadetailer")
async def import_armadetailer(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
    obra_destino: Optional[str] = Query(None, description="ID de obra destino (selector obligatorio en frontend)"),
    reasignar_a: Optional[str] = Query(None, description="ID de proyecto existente para reasignar barras"),
    forzar: bool = Query(False, description="Forzar importación ignorando duplicados de nombre"),
    calculista: Optional[str] = Query(None, description="Nombre del calculista (solo al crear proyecto nuevo)"),
    confirmar_nuevo: bool = Query(False, description="Confirmar creación de proyecto nuevo"),
    constructora_id: Optional[int] = Query(None, description="ID de constructora a asignar al proyecto nuevo"),
    asignar_a: Optional[str] = Query(None, description="ID de obra existente para asignar el código de proyecto del CSV como alias"),
    owner_id: Optional[int] = Query(None, description="(deprecado, ignorado)"),
    proyecto_nombre_manual: Optional[str] = Query(None, description="Nombre de proyecto cuando CSV no trae PROYECTO:"),
    proyecto_nombre_override: Optional[str] = Query(None, description="Nombre override para el proyecto (usuario editó el nombre)"),
    replace_keys: Optional[str] = Query(None, description="Lista de claves 'plano|piso|ciclo' separadas por ';' a reemplazar antes del UPSERT"),
    replace_full_planos: Optional[str] = Query(None, description="Lista de plano_code separados por ';' a reemplazar completos antes del UPSERT"),
):
    raw = (await file.read()).decode("utf-8", errors="replace")
    lines = raw.splitlines()

    # ── obra_destino: si viene, forzar todo al proyecto seleccionado ──
    if obra_destino:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id_proyecto, nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (obra_destino,))
                dest_row = cur.fetchone()
                if not dest_row:
                    return {"ok": False, "error": f"Obra destino '{obra_destino}' no existe."}
                proyecto_id = dest_row[0]
                proyecto_nombre = dest_row[1]
    else:
        # Fallback: extraer del CSV (flujo legacy)
        proyecto_id = None
        proyecto_nombre = None

    plano_nombre = None
    
    for line in lines[:10]:  # Buscar en metadatos (primeras 10 líneas)
        if not obra_destino and line.startswith("PROYECTO:"):
            partes = line.replace("PROYECTO:", "").strip().split("|")
            if len(partes) >= 2:
                proyecto_id = partes[0].strip()
                proyecto_nombre = partes[1].strip()
        elif line.startswith("PLANO:"):
            # Formato esperado: "PLANO: UID-XXXX|Nombre del Plano"
            partes = line.replace("PLANO:", "").strip().split("|", 1)
            if len(partes) >= 2:
                plano_nombre = partes[1].strip()

    # Aplicar override de nombre si el usuario lo editó en el modal
    # ── Resolución de proyecto (solo si NO viene obra_destino) ──
    if not obra_destino:
        # Aplicar override de nombre si el usuario lo editó en el modal
        if proyecto_nombre_override and proyecto_nombre_override.strip():
            proyecto_nombre = proyecto_nombre_override.strip()

        if not proyecto_id or not proyecto_nombre:
            if reasignar_a:
                # El usuario eligió un proyecto existente — usar ese
                proyecto_id = reasignar_a
                with get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (proyecto_id,))
                        row = cur.fetchone()
                        if not row:
                            return {"ok": False, "error": f"Proyecto {proyecto_id} no existe."}
                        proyecto_nombre = row[0]
            elif confirmar_nuevo and proyecto_nombre_manual:
                # El usuario quiere crear un proyecto nuevo sin PROYECTO: en CSV
                proyecto_id = "MANUAL-" + str(uuid.uuid4().hex[:8].upper())
                proyecto_nombre = proyecto_nombre_manual
            else:
                # CSV sin PROYECTO: — pedir al frontend que elija
                return {
                    "ok": False,
                    "missing_project": True,
                    "mensaje": "El archivo no contiene línea PROYECTO:. Selecciona un proyecto existente o crea uno nuevo.",
                    "archivo": file.filename,
                }

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

    # --- Detección de archivo duplicado (mismo nombre, mismo proyecto) ---
    if not forzar:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, fecha FROM imports WHERE id_proyecto = %s AND archivo = %s ORDER BY id DESC LIMIT 1",
                    (proyecto_id, file.filename)
                )
                dup_carga = cur.fetchone()
                if dup_carga:
                    return {
                        "ok": False,
                        "duplicate_file": True,
                        "mensaje": f"El archivo '{file.filename}' ya fue cargado en este proyecto el {dup_carga[1][:10]}. ¿Deseas reemplazar esa carga?",
                        "carga_existente_id": dup_carga[0],
                        "archivo": file.filename,
                        "id_proyecto": proyecto_id,
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
    # Strip whitespace from column names (handles trailing spaces/CR from Excel re-saves)
    df.columns = df.columns.str.strip()

    required = [
        "ID_UNICO", "ID_PROYECTO", "PLANO_CODE",
        "SECTOR", "PISO", "CICLO", "EJE",
        "DIAM", "LARGO_TOTAL", "CANT",
        "VERSION_MOD"
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        found = list(df.columns)
        return {"ok": False, "error": f"Faltan columnas requeridas: {missing}. Columnas encontradas en archivo: {found}"}

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

    # ── Pre-validation: check ALL rows before any DB operation ──
    total_filas = len(df)
    filas_invalidas = []
    id_unico_all = []  # collect for duplicate detection

    for idx, r in df.iterrows():
        row_num = idx + 2  # +2: 1-indexed + header row
        errores_fila = []

        # 1. ID_UNICO obligatorio
        id_unico_val = str(r["ID_UNICO"]).strip() if pd.notna(r["ID_UNICO"]) else ""
        if not id_unico_val or id_unico_val.lower() == "nan":
            errores_fila.append("ID_UNICO vacío")
        else:
            id_unico_all.append(id_unico_val)

        # 2. ID consistency: ID_UNICO debe contener ID_PROYECTO + PLANO_CODE + ID
        if id_unico_val and id_unico_val.lower() != "nan":
            row_proyecto = str(r["ID_PROYECTO"]).strip() if pd.notna(r["ID_PROYECTO"]) else ""
            row_plano = str(r["PLANO_CODE"]).strip() if pd.notna(r["PLANO_CODE"]) else ""
            bar_id = ""
            if "ID" in df.columns and pd.notna(r.get("ID")):
                bar_id = str(r["ID"]).strip()
                if bar_id.lower() == "nan":
                    bar_id = ""

            inconsistencias = []
            if row_proyecto and row_proyecto.lower() != "nan" and row_proyecto not in id_unico_val:
                inconsistencias.append(f"ID_PROYECTO '{row_proyecto}' no en ID_UNICO")
            if row_plano and row_plano.lower() != "nan" and row_plano not in id_unico_val:
                inconsistencias.append(f"PLANO_CODE '{row_plano}' no en ID_UNICO")
            if bar_id and bar_id not in id_unico_val:
                inconsistencias.append(f"ID '{bar_id}' no en ID_UNICO")
            if inconsistencias:
                errores_fila.append("ID inconsistente: " + "; ".join(inconsistencias))

        if errores_fila:
            filas_invalidas.append((row_num, errores_fila))

    # Check 1: per-row validation errors
    if filas_invalidas:
        n_inv = len(filas_invalidas)
        detalle_items = []
        for rn, errs in filas_invalidas[:10]:
            detalle_items.append(f"Fila {rn}: {', '.join(errs)}")
        detalle = "; ".join(detalle_items)
        if n_inv > 10:
            detalle += f" ... y {n_inv - 10} más"
        return {
            "ok": False,
            "validation_failed": True,
            "mensaje": f"{n_inv}/{total_filas} barras inválidas. {detalle}",
            "barras_invalidas": n_inv,
            "total_filas": total_filas,
            "archivo": file.filename,
        }

    # Check 2: duplicate ID_UNICO within the same file
    id_unico_counts = {}
    for v in id_unico_all:
        id_unico_counts[v] = id_unico_counts.get(v, 0) + 1
    duplicados = {k: c for k, c in id_unico_counts.items() if c > 1}
    if duplicados:
        n_dup_ids = len(duplicados)
        n_dup_barras = sum(duplicados.values())
        n_unicas = len(id_unico_counts) - n_dup_ids + n_dup_ids  # total unique keys
        detalle = ", ".join(f"'{k}' (×{c})" for k, c in list(duplicados.items())[:5])
        if n_dup_ids > 5:
            detalle += f" ... y {n_dup_ids - 5} más"
        return {
            "ok": False,
            "validation_failed": True,
            "mensaje": f"Archivo tiene {total_filas} barras pero {n_dup_ids} ID_UNICO están duplicados ({n_dup_barras} filas afectadas). Solo se cargarían {len(id_unico_counts)} únicas. Duplicados: {detalle}",
            "barras_invalidas": n_dup_barras,
            "total_filas": total_filas,
            "archivo": file.filename,
        }

    # Detectar si el proyecto es nuevo o existente (incluye aliases)
    # (solo cuando NO viene obra_destino — en ese caso ya está resuelto)
    is_new_project = False
    resolved_via_alias = False
    csv_proyecto_id = proyecto_id  # guardar el ID original del CSV

    if not obra_destino:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (proyecto_id,))
                row = cur.fetchone()
                if not row:
                    # Buscar en aliases
                    cur.execute("SELECT id_proyecto FROM proyecto_aliases WHERE alias = %s", (proyecto_id,))
                    alias_row = cur.fetchone()
                    if alias_row:
                        proyecto_id = alias_row[0]
                        resolved_via_alias = True
                        cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (proyecto_id,))
                        prow = cur.fetchone()
                        if prow:
                            proyecto_nombre = prow[0]
                    else:
                        is_new_project = True

        # Si el usuario quiere asignar a una obra existente (crear alias)
        if asignar_a and csv_proyecto_id:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    # Validar que el CSV project ID no esté ya asignado a OTRA obra
                    cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (csv_proyecto_id,))
                    if cur.fetchone():
                        return {"ok": False, "error": f"El código {csv_proyecto_id} ya existe como proyecto independiente y no puede reasignarse."}
                    cur.execute("SELECT id_proyecto FROM proyecto_aliases WHERE alias = %s", (csv_proyecto_id,))
                    existing_alias = cur.fetchone()
                    if existing_alias and existing_alias[0] != asignar_a:
                        return {"ok": False, "error": f"El código {csv_proyecto_id} ya está asignado a otra obra ({existing_alias[0]})."}
                    # Verificar que la obra destino existe
                    cur.execute("SELECT id_proyecto, nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (asignar_a,))
                    dest = cur.fetchone()
                    if not dest:
                        return {"ok": False, "error": f"Obra destino {asignar_a} no existe."}
                    # Crear alias si no existe
                    if not existing_alias:
                        cur.execute("""
                            INSERT INTO proyecto_aliases (alias, id_proyecto, creado_por)
                            VALUES (%s, %s, %s)
                            ON CONFLICT (alias) DO NOTHING
                        """, (csv_proyecto_id, asignar_a, user.get("email", "unknown")))
                    proyecto_id = asignar_a
                    proyecto_nombre = dest[1]
                    is_new_project = False
                    resolved_via_alias = True

        # Si es proyecto nuevo y no se confirmó → pedir confirmación via popup
        if is_new_project and not confirmar_nuevo:
            # Obtener lista de obras existentes para que el frontend ofrezca asignar
            obras_sin_id = []
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT id_proyecto, nombre_proyecto FROM proyectos ORDER BY nombre_proyecto")
                    obras_sin_id = [{"id_proyecto": r[0], "nombre_proyecto": r[1]} for r in cur.fetchall()]
            return {
                "ok": False,
                "new_project": True,
                "mensaje": f"Proyecto nuevo detectado: \"{proyecto_nombre}\" (ID: {csv_proyecto_id}). Puedes crear un proyecto nuevo o asignar a una obra existente.",
                "proyecto_id": csv_proyecto_id,
                "proyecto_nombre": proyecto_nombre,
                "archivo": file.filename,
                "obras_existentes": obras_sin_id,
            }

        # Guardar o actualizar proyecto en tabla proyectos
        with get_conn() as conn:
            with conn.cursor() as cur:
                if is_new_project:
                    # Nuevo: crear proyecto
                    cur.execute("""
                        INSERT INTO proyectos (id_proyecto, nombre_proyecto, usuario_creador, constructora_id)
                        VALUES (%s, %s, %s, %s)
                    """, (proyecto_id, proyecto_nombre, user.get("email", "unknown"), constructora_id))
                    # Auto-add creator to proyecto_usuarios
                    cur.execute("SELECT id FROM users WHERE email = %s", (user.get("email"),))
                    creator_row = cur.fetchone()
                    if creator_row:
                        rol = ROL_MAP.get(user.get('role', ''), 'cubicador')
                        cur.execute("""
                            INSERT INTO proyecto_usuarios (id_proyecto, user_id, rol)
                            VALUES (%s, %s, %s)
                            ON CONFLICT (id_proyecto, user_id) DO NOTHING
                        """, (proyecto_id, creator_row[0], rol))
                else:
                    # Existente: solo actualizar nombre (si no vino de alias, mantener nombre de la obra)
                    if not resolved_via_alias:
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

        def _opt_float(col):
            if col not in df.columns:
                return None
            try:
                return float(r[col]) if pd.notna(r[col]) else None
            except (ValueError, TypeError):
                return None

        def _opt_text(col):
            if col not in df.columns:
                return None
            return _clean(r[col]) or None

        rows_to_upsert.append((
            id_unico,
            proyecto_id,
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
            _opt_text("VERSION_EXP"),
            now_iso,
            # Columnas adicionales ArmaDetailer
            _opt_text("ID"),
            _opt_text("ESTRUCTURA"),
            _opt_text("TIPO"),
            _opt_text("MARCA"),
            _opt_text("FIGURA"),
            _opt_float("ESP"),
            _opt_float("A"),
            _opt_float("B"),
            _opt_float("C"),
            _opt_float("D"),
            _opt_float("E"),
            _opt_float("F"),
            _opt_float("G"),
            _opt_float("H"),
            _opt_float("I"),
            _opt_float("ANG1"),
            _opt_float("ANG2"),
            _opt_float("ANG3"),
            _opt_float("ANG4"),
            _opt_float("R"),
            _opt_text("COD_PROD") or _opt_text("COD_PROYECTO"),
            _opt_text("NOMBRE_DWG"),
        ))

    upsert_sql = """
    INSERT INTO barras
    (id_unico,id_proyecto,nombre_proyecto,plano_code,nombre_plano,sector,piso,ciclo,eje,diam,largo_total,mult,cant,cant_total,peso_unitario,peso_total,version_mod,version_exp,fecha_carga,
     bar_id,estructura,tipo,marca,figura,esp,dim_a,dim_b,dim_c,dim_d,dim_e,dim_f,dim_g,dim_h,dim_i,ang1,ang2,ang3,ang4,radio,cod_proyecto,nombre_dwg,
     origen,import_id)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
            %s,%s)
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
        fecha_carga=EXCLUDED.fecha_carga,
        bar_id=EXCLUDED.bar_id,
        estructura=EXCLUDED.estructura,
        tipo=EXCLUDED.tipo,
        marca=EXCLUDED.marca,
        figura=EXCLUDED.figura,
        esp=EXCLUDED.esp,
        dim_a=EXCLUDED.dim_a,
        dim_b=EXCLUDED.dim_b,
        dim_c=EXCLUDED.dim_c,
        dim_d=EXCLUDED.dim_d,
        dim_e=EXCLUDED.dim_e,
        dim_f=EXCLUDED.dim_f,
        dim_g=EXCLUDED.dim_g,
        dim_h=EXCLUDED.dim_h,
        dim_i=EXCLUDED.dim_i,
        ang1=EXCLUDED.ang1,
        ang2=EXCLUDED.ang2,
        ang3=EXCLUDED.ang3,
        ang4=EXCLUDED.ang4,
        radio=EXCLUDED.radio,
        cod_proyecto=EXCLUDED.cod_proyecto,
        nombre_dwg=EXCLUDED.nombre_dwg,
        origen=EXCLUDED.origen,
        import_id=EXCLUDED.import_id
    """

    total_kilos = sum(r[15] for r in rows_to_upsert if r[15] is not None)  # index 15 = peso_total

    # Extraer version y plano del primer row para tracking
    first_version = (str(df.iloc[0]["VERSION_EXP"]).strip() if len(df) > 0 and "VERSION_EXP" in df.columns and pd.notna(df.iloc[0]["VERSION_EXP"]) else None) or None
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
            # Registrar import PRIMERO para obtener import_id
            cur.execute("""
                INSERT INTO imports (id_proyecto, nombre_proyecto, usuario, archivo, fecha, barras_count, kilos, estado, version_archivo, plano_code, errores)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
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
            import_id = cur.fetchone()[0]

            # ── DELETE selectivo previo (decidido por el usuario en preview) ──
            barras_eliminadas_previo = 0
            try:
                if replace_full_planos:
                    planos = [p.strip() for p in replace_full_planos.split(';') if p.strip()]
                    if planos:
                        cur.execute(
                            "DELETE FROM barras WHERE id_proyecto = %s AND plano_code = ANY(%s)",
                            (proyecto_id, planos),
                        )
                        barras_eliminadas_previo += cur.rowcount or 0
                if replace_keys:
                    triples = []
                    for token in replace_keys.split(';'):
                        token = token.strip()
                        if not token:
                            continue
                        parts = token.split('|')
                        if len(parts) != 3:
                            continue
                        triples.append((parts[0].strip(), parts[1].strip(), parts[2].strip()))
                    for plano, piso, ciclo in triples:
                        cur.execute(
                            """
                            DELETE FROM barras
                            WHERE id_proyecto = %s
                              AND COALESCE(plano_code, '') = %s
                              AND COALESCE(piso, '')       = %s
                              AND COALESCE(ciclo, '')      = %s
                            """,
                            (proyecto_id, plano, piso, ciclo),
                        )
                        barras_eliminadas_previo += cur.rowcount or 0
            except Exception as _e:
                # Si falla el DELETE selectivo, abortar la importación
                raise

            # ── UPSERT barras ──
            # El ON CONFLICT (id_unico) DO UPDATE maneja reimportaciones.
            # La limpieza de cargas antiguas se hace via DELETE /cargas/{id}
            # (que borra por import_id), NO por plano_code — evita borrar
            # data de otros archivos que comparten plano_code.
            if rows_to_upsert:
                rows_with_import = [row + ('csv', import_id) for row in rows_to_upsert]
                cur.executemany(upsert_sql, rows_with_import)

    audit(user.get("email","unknown"), "importar_csv", f"{file.filename} → {proyecto_nombre} ({len(rows_to_upsert)} barras, {round(total_kilos,1)} kg, estado={estado})", "proyecto", proyecto_id)

    _cache.invalidate("stats:", "landing:")

    return {
        "ok": True,
        "proyecto": proyecto_nombre,
        "id_proyecto": proyecto_id,
        "barras": len(rows_to_upsert),
        "rows_upserted": len(rows_to_upsert),
        "kilos": round(total_kilos, 2),
        "total_filas": len(df),
        "rechazadas": len(rejected_rows),
        "filas_rechazadas": len(rejected_rows),
        "warnings": warnings[:30],
        "advertencias": len(warnings),
        "rejected": rejected_rows[:30],
        "estado": estado,
        "is_new_project": is_new_project,
        "barras_eliminadas_previo": barras_eliminadas_previo,
    }


# ========================= PREVIEW DE IMPORTACIÓN =========================

def _parse_csv_preview_groups(raw: str):
    """Lee el CSV, ubica la cabecera 'ID|ESTRUCTURA|' y devuelve:
      - groups_pc: dict {(plano, piso, ciclo): count}     — claves de reemplazo
      - groups_pp: dict {(plano, piso): count}            — totales por piso
      - planos: set de plano_codes detectados
    Para el preview no calcula peso.
    """
    lines = raw.splitlines()
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith("ID|ESTRUCTURA|"):
            header_idx = i
            break
    if header_idx is None:
        return None, None, None
    data_text = "\n".join(lines[header_idx:])
    try:
        df = pd.read_csv(StringIO(data_text), sep="|")
    except Exception:
        return None, None, None
    df.columns = df.columns.str.strip()
    needed = {"PLANO_CODE", "PISO", "CICLO"}
    if not needed.issubset(set(df.columns)):
        return None, None, None
    groups_pc: dict = {}
    groups_pp: dict = {}
    planos: set = set()
    for _, r in df.iterrows():
        def _v(col):
            v = r.get(col)
            if v is None:
                return ""
            try:
                if pd.isna(v):
                    return ""
            except Exception:
                pass
            s = str(v).strip()
            return "" if s.lower() == "nan" else s
        plano = _v("PLANO_CODE")
        piso  = _v("PISO")
        ciclo = _v("CICLO")
        if plano:
            planos.add(plano)
        k_pc = (plano, piso, ciclo)
        groups_pc[k_pc] = groups_pc.get(k_pc, 0) + 1
        k_pp = (plano, piso)
        groups_pp[k_pp] = groups_pp.get(k_pp, 0) + 1
    return groups_pc, groups_pp, planos


@router.post("/import/armadetailer/preview")
async def import_armadetailer_preview(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
    obra_destino: str = Query(..., description="ID de obra destino (obligatorio)"),
):
    """Devuelve un preview del impacto del CSV agrupado por (plano, piso),
    restringido a los pisos que vienen en el CSV. NO toca la BD.

    Para cada (plano, piso) presente en el CSV devuelve:
      - existentes_bd: barras totales en BD (todos los ciclos) para ese (plano, piso)
      - existentes_replace: barras BD en los ciclos que vienen en el CSV (serán reemplazadas)
      - existentes_keep: barras BD en ciclos NO incluidos en el CSV (se conservan)
      - nuevas_csv: barras que aporta el CSV
      - final: existentes_keep + nuevas_csv (lo que quedará tras importar)
      - action: 'replace' si existentes_replace > 0, sino 'add'
    """
    raw = (await file.read()).decode("utf-8", errors="replace")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto, nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (obra_destino,))
            row = cur.fetchone()
            if not row:
                return {"ok": False, "error": f"Obra destino '{obra_destino}' no existe."}
            proyecto_nombre = row[1]

            groups_pc, groups_pp, planos_csv = _parse_csv_preview_groups(raw)
            if groups_pc is None:
                return {"ok": False, "error": "No se pudo leer el CSV (cabecera ID|ESTRUCTURA| no encontrada o columnas requeridas faltantes)."}

            # Pisos por plano que vienen en el CSV
            pisos_por_plano: dict = {}
            for (p, pi) in groups_pp.keys():
                pisos_por_plano.setdefault(p, set()).add(pi)

            # Conteos en BD para SOLO los (plano, piso) del CSV, agrupados por (plano, piso, ciclo)
            db_pc: dict = {}
            if pisos_por_plano:
                for plano, pisos in pisos_por_plano.items():
                    cur.execute(
                        """
                        SELECT COALESCE(piso, '')  AS piso,
                               COALESCE(ciclo, '') AS ciclo,
                               COUNT(*)            AS n
                        FROM barras
                        WHERE id_proyecto = %s
                          AND plano_code = %s
                          AND COALESCE(piso, '') = ANY(%s)
                        GROUP BY 1, 2
                        """,
                        (obra_destino, plano, list(pisos)),
                    )
                    for piso, ciclo, n in cur.fetchall():
                        db_pc[(plano, piso, ciclo)] = int(n)

    # Set de claves (plano, piso, ciclo) presentes en CSV → ciclos que serán reemplazados
    replace_pc_keys = set(groups_pc.keys())

    # Filas por (plano, piso) — solo las del CSV
    pisos_rows = []
    for (plano, piso) in sorted(groups_pp.keys(), key=lambda k: (k[0], _piso_sort_key(k[1]))):
        nuevas_csv = groups_pp[(plano, piso)]

        # Sumar BD por ciclos que sí vienen en CSV (replace) vs los que no (keep)
        existentes_replace = 0
        existentes_keep = 0
        for (p, pi, ci), n in db_pc.items():
            if p != plano or pi != piso:
                continue
            if (p, pi, ci) in replace_pc_keys:
                existentes_replace += n
            else:
                existentes_keep += n
        existentes_bd = existentes_replace + existentes_keep
        final = existentes_keep + nuevas_csv
        action = "replace" if existentes_replace > 0 else "add"

        pisos_rows.append({
            "plano_code": plano,
            "piso": piso,
            "existentes_bd": existentes_bd,
            "existentes_replace": existentes_replace,
            "existentes_keep": existentes_keep,
            "nuevas_csv": nuevas_csv,
            "final": final,
            "action": action,
        })

    # Server-side: armar replace_keys para reusar en el import real
    replace_keys_str = ";".join(f"{p}|{pi}|{ci}" for (p, pi, ci) in sorted(replace_pc_keys))

    total_csv         = sum(groups_pp.values())
    total_replace     = sum(r["existentes_replace"] for r in pisos_rows)
    pisos_a_reemplazar = sum(1 for r in pisos_rows if r["action"] == "replace")
    pisos_a_sumar      = sum(1 for r in pisos_rows if r["action"] == "add")

    return {
        "ok": True,
        "obra_id": obra_destino,
        "obra_nombre": proyecto_nombre,
        "archivo": file.filename,
        "planos": sorted(planos_csv) if planos_csv else [],
        "pisos": pisos_rows,
        "replace_keys": replace_keys_str,
        "summary": {
            "total_csv": total_csv,
            "total_db_a_reemplazar": total_replace,
            "pisos_a_reemplazar": pisos_a_reemplazar,
            "pisos_a_sumar": pisos_a_sumar,
        },
    }


def _piso_sort_key(piso: str):
    """Orden natural para pisos tipo P1, P2, ..., P10, P11."""
    s = (piso or "").strip()
    if not s:
        return (1, 0, "")
    # Extraer prefijo no numérico + número final si lo hay
    import re
    m = re.match(r"^([A-Za-z\-_/]*)(\d+)?", s)
    if m and m.group(2):
        return (0, int(m.group(2)), m.group(1) or "")
    return (2, 0, s)