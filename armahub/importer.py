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
from .auth import get_current_user, ROL_MAP, _rol_proyecto_usuarios
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
    replace_keys: Optional[str] = Query(None, description="Lista de claves 'eje|piso|ciclo' separadas por ';' a reemplazar antes del UPSERT"),
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
    try:
        df = pd.read_csv(StringIO(data_text), sep="|")
    except Exception as e:
        # Un CSV mal formado (nº de columnas inconsistente por pipes/comillas en
        # valores de texto, etc.) hacía crashear pandas → HTTP 500 sin body →
        # el frontend mostraba "sesión expirada" engañosamente.
        return {
            "ok": False,
            "error": f"No se pudo leer el CSV '{file.filename}'. Formato inválido: {str(e)[:200]}",
            "csv_parse_error": True,
            "archivo": file.filename,
        }
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
                    # Auto-add creator to proyecto_usuarios. proyecto_usuarios.rol
                    # tiene un CHECK legacy que NO acepta 'miembro'/'jefe_servicio';
                    # se mapean a 'cubicador' (rol equivalente en cubicación) para no
                    # violar el constraint y colgar la importación.
                    cur.execute("SELECT id FROM users WHERE email = %s", (user.get("email"),))
                    creator_row = cur.fetchone()
                    if creator_row:
                        rol = _rol_proyecto_usuarios(user.get('role', ''))
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
    cod_prod_corregidos = 0

    for idx, r in df.iterrows():
        row_num = idx + 2  # +2: 1-indexed + header row

        # Validación: ID_UNICO obligatorio
        id_unico = str(r["ID_UNICO"]).strip() if pd.notna(r["ID_UNICO"]) else ""
        if not id_unico or id_unico == "nan":
            rejected_rows.append(f"Fila {row_num}: ID_UNICO vacío")
            continue

        # Parseo numérico — valores no numéricos en campos estructurales son rechazo duro
        try:
            diam = float(r["DIAM"]) if pd.notna(r["DIAM"]) else None
        except (ValueError, TypeError):
            rejected_rows.append(f"Fila {row_num}: DIAM inválido '{r['DIAM']}'")
            continue

        try:
            largo = float(r["LARGO_TOTAL"]) if pd.notna(r["LARGO_TOTAL"]) else None
        except (ValueError, TypeError):
            rejected_rows.append(f"Fila {row_num}: LARGO_TOTAL inválido '{r['LARGO_TOTAL']}'")
            continue

        try:
            mult = float(r["MULT"]) if ("MULT" in df.columns and pd.notna(r["MULT"])) else None
        except (ValueError, TypeError):
            mult = None

        try:
            cant_total = float(r["CANT"]) if pd.notna(r["CANT"]) else None
        except (ValueError, TypeError):
            rejected_rows.append(f"Fila {row_num}: CANT inválido '{r['CANT']}'")
            continue

        if cant_total is not None and mult is not None and mult > 0:
            cant = cant_total / mult
        else:
            cant = cant_total

        # Corrección automática de COD_PROD desfasado respecto al DIAM.
        # No se muta el DataFrame (evita crashes/upcast al asignar string a una
        # columna que pandas infirió como numérica). El valor corregido se guarda
        # aparte y se usa directo en el upsert más abajo.
        cod_prod_corregido = None
        if diam is not None:
            _cod_esperado = _DIAM_COD_MAP.get(diam)
            if _cod_esperado is not None:
                _col_cod = "COD_PROD" if "COD_PROD" in df.columns else ("COD_PROYECTO" if "COD_PROYECTO" in df.columns else None)
                if _col_cod is not None:
                    _cod_actual = _normalizar_cod_prod(r[_col_cod])
                    if _cod_actual and _cod_actual != _cod_esperado:
                        cod_prod_corregido = _cod_esperado
                        cod_prod_corregidos += 1

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
            cod_prod_corregido or _normalizar_cod_prod(r["COD_PROD"] if "COD_PROD" in df.columns else (r["COD_PROYECTO"] if "COD_PROYECTO" in df.columns else None)) or None,
            _opt_text("NOMBRE_DWG"),
        ))

    upsert_sql = """
    INSERT INTO barras
    (id_unico,id_proyecto,nombre_proyecto,plano_code,nombre_plano,sector,piso,ciclo,eje,diam,largo_total,mult,cant,cant_total,peso_unitario,peso_total,version_mod,version_exp,fecha_carga,
     bar_id,estructura,tipo,marca,figura,esp,dim_a,dim_b,dim_c,dim_d,dim_e,dim_f,dim_g,dim_h,dim_i,ang1,ang2,ang3,ang4,radio,cod_proyecto,nombre_dwg,
     origen,import_id)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
            %s,%s)
    ON CONFLICT (id_unico, id_proyecto) DO UPDATE SET
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

    # Con UNIQUE(id_unico, id_proyecto) el mismo id_unico puede existir en distintas
    # obras sin conflicto. No se necesita pre-detección cross-obra.
    barras_otra_obra = 0
    obras_conflicto: dict = {}

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

    # Determinar modo y alcance del reemplazo (trazabilidad)
    if replace_full_planos and replace_keys:
        modo_reemplazo = 'mixto'
        scope_reemplazo = f"planos: {replace_full_planos}; ejes: {replace_keys}"[:500]
    elif replace_full_planos:
        modo_reemplazo = 'por_planos'
        scope_reemplazo = replace_full_planos[:500]
    elif replace_keys:
        modo_reemplazo = 'por_ejes'
        scope_reemplazo = replace_keys[:500]
    else:
        modo_reemplazo = 'ninguno'
        scope_reemplazo = None

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Registrar import PRIMERO para obtener import_id
            cur.execute("""
                INSERT INTO imports (id_proyecto, nombre_proyecto, usuario, archivo, fecha, barras_count, kilos, estado, version_archivo, plano_code, errores, modo_reemplazo, scope_reemplazo, barras_eliminadas_previo)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                modo_reemplazo,
                scope_reemplazo,
                0,  # se actualiza después del DELETE selectivo
            ))
            import_id = cur.fetchone()[0]

            # ── DELETE selectivo previo (decidido por el usuario en preview) ──
            barras_eliminadas_previo = 0
            # 5M.5: capturar las barras EDITADAS A MANO que este DELETE borra, para
            # dejar rastro en el audit_log (el re-import las elimina sin retorno).
            editadas_borradas = []
            try:
                if replace_full_planos:
                    planos = [p.strip() for p in replace_full_planos.split(';') if p.strip()]
                    if planos:
                        cur.execute(
                            "DELETE FROM barras WHERE id_proyecto = %s AND plano_code = ANY(%s) "
                            "RETURNING marca, piso, eje, ciclo, editado_por",
                            (proyecto_id, planos),
                        )
                        for m, pi, ej, ci, edp in cur.fetchall():
                            barras_eliminadas_previo += 1
                            if edp:
                                editadas_borradas.append({"marca": m, "piso": pi, "eje": ej, "ciclo": ci, "editado_por": edp})
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
                    for eje, piso, ciclo in triples:
                        cur.execute(
                            """
                            DELETE FROM barras
                            WHERE id_proyecto = %s
                              AND COALESCE(eje, '')   = %s
                              AND COALESCE(piso, '')  = %s
                              AND COALESCE(ciclo, '') = %s
                            RETURNING marca, piso, eje, ciclo, editado_por
                            """,
                            (proyecto_id, eje, piso, ciclo),
                        )
                        for m, pi, ej, ci, edp in cur.fetchall():
                            barras_eliminadas_previo += 1
                            if edp:
                                editadas_borradas.append({"marca": m, "piso": pi, "eje": ej, "ciclo": ci, "editado_por": edp})
            except Exception as _e:
                # Si falla el DELETE selectivo, abortar la importación
                raise

            # Persistir barras eliminadas en el registro de import
            if barras_eliminadas_previo > 0:
                cur.execute(
                    "UPDATE imports SET barras_eliminadas_previo = %s WHERE id = %s",
                    (barras_eliminadas_previo, import_id),
                )

            # ── UPSERT barras ──
            # El ON CONFLICT (id_unico) DO UPDATE maneja reimportaciones.
            # La limpieza de cargas antiguas se hace via DELETE /cargas/{id}
            # (que borra por import_id), NO por plano_code — evita borrar
            # data de otros archivos que comparten plano_code.
            if rows_to_upsert:
                rows_with_import = [row + ('csv', import_id) for row in rows_to_upsert]
                cur.executemany(upsert_sql, rows_with_import)
                # Verificar integridad post-upsert: las barras realmente deben haber
                # quedado en la BD con el import_id correcto.
                cur.execute("SELECT COUNT(*) FROM barras WHERE import_id = %s", (import_id,))
                actual_en_db = cur.fetchone()[0]
                if actual_en_db != len(rows_to_upsert):
                    raise RuntimeError(
                        f"Integridad post-carga fallida: se esperaban {len(rows_to_upsert)} barras "
                        f"pero quedaron {actual_en_db} en la BD. Se revirtio la importacion."
                    )

            # ── Marcar imports supersedidos ──────────────────────────────────────
            # Si un import anterior de esta obra quedó sin barras activas (porque
            # el DELETE selectivo o el UPSERT las reasignó al nuevo import_id),
            # se marca como supersedido por el import actual.
            cur.execute("""
                UPDATE imports
                SET supersedida_por = %s
                WHERE id_proyecto = %s
                  AND id != %s
                  AND supersedida_por IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM barras WHERE barras.import_id = imports.id
                  )
            """, (import_id, proyecto_id, import_id))
            # ────────────────────────────────────────────────────────────────────

    audit(user.get("email","unknown"), "importar_csv", f"{file.filename} → {proyecto_nombre} ({len(rows_to_upsert)} barras, {round(total_kilos,1)} kg, estado={estado})", "proyecto", proyecto_id)

    # 5M.5: rastro del EVENTO DESTRUCTIVO — el re-import eliminó barras que habían
    # sido editadas a mano en la plataforma (se borran sin retorno). Una línea de
    # audit con el conteo + detalle (marca/ubicación/quién editó), para poder
    # responder "¿por qué se perdió mi corrección?".
    if editadas_borradas:
        n = len(editadas_borradas)
        muestras = editadas_borradas[:15]
        detalle_list = "; ".join(
            f"{(b['marca'] or b.get('id_unico') or '?')} ({'/'.join([x for x in [b.get('piso'), b.get('eje'), b.get('ciclo')] if x])}) editó {(b['editado_por'] or '?').split('@')[0]}"
            for b in muestras
        )
        if n > len(muestras):
            detalle_list += f"; …y {n - len(muestras)} más"
        audit(
            user.get("email", "unknown"),
            "reimport_borro_editadas",
            f"Import '{file.filename}' → {proyecto_nombre}: eliminó {n} barra(s) editada(s) a mano en la plataforma: {detalle_list}",
            "proyecto",
            proyecto_id,
        )

    _cache.invalidate("stats:", "landing:")

    # ── Auditoría de fundaciones mal catalogadas ──
    # Convención ArmaHub: las barras con sector=FUND deben estar asignadas al
    # piso "PF" (nivel base). Si vienen con piso distinto (P1, S1, etc.) se
    # avisa al usuario para que corrija la cubicación en origen.
    fund_misplaced = {}  # { piso: {"barras": int, "kg": float} }
    for row in rows_to_upsert:
        sector_val = (row[5] or "").upper()
        piso_val = (row[6] or "").strip()
        if sector_val == "FUND":
            piso_up = piso_val.upper()
            if piso_up not in ("PF", "FUND", "FUNDACION", "FUNDACIÓN"):
                slot = fund_misplaced.setdefault(piso_val or "(sin piso)", {"barras": 0, "kg": 0.0})
                slot["barras"] += 1
                slot["kg"] += float(row[15] or 0)  # peso_total
    fund_misplaced_list = [
        {"piso": p, "barras": v["barras"], "kg": round(v["kg"], 2)}
        for p, v in sorted(fund_misplaced.items())
    ]

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
        "barras_otra_obra": barras_otra_obra,
        "obras_conflicto": obras_conflicto,
        "fund_misplaced": fund_misplaced_list,
        "cod_prod_corregidos": cod_prod_corregidos,
    }


# ========================= MAPEO DIÁMETRO → CÓDIGO PRODUCTO =========================

# Códigos de producto oficiales Armacero por diámetro (mm)
_DIAM_COD_MAP: dict[float, str] = {
    8.0:  "110002788",
    10.0: "110002774",
    12.0: "110002710",
    16.0: "110002776",
    18.0: "110002718",
    22.0: "110002790",
    25.0: "110002717",
    28.0: "110002777",
    32.0: "110002778",
    36.0: "110002779",
}


def _normalizar_cod_prod(val) -> str:
    """Convierte un valor de COD_PROD a string limpio. Si pandas infirió la
    columna como numérica (todos los códigos son números), el valor llega como
    float y str() daría '110002788.0'. Aquí se recorta el '.0' para comparar y
    guardar el código como texto entero, sin decimal espurio. Devuelve '' si es
    nulo/vacío/nan.
    """
    if val is None:
        return ""
    try:
        if pd.isna(val):
            return ""
    except (ValueError, TypeError):
        pass
    # Números (float/int) → entero sin decimal
    if isinstance(val, float):
        if val.is_integer():
            return str(int(val))
        return str(val)
    if isinstance(val, int):
        return str(val)
    s = str(val).strip()
    if s.lower() == "nan" or not s:
        return ""
    # String que en realidad es un float entero ('110002788.0')
    if s.endswith(".0") and s[:-2].isdigit():
        return s[:-2]
    return s


def _detectar_cod_prod_desfasados(raw: str) -> list[dict]:
    """Parsea el CSV y retorna filas donde COD_PROD no coincide con el código
    esperado para su DIAM. Cada entry: {fila, diam, cod_actual, cod_esperado}.
    Solo evalúa filas con DIAM conocido y COD_PROD no vacío.
    """
    lines = raw.splitlines()
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith("ID|ESTRUCTURA|"):
            header_idx = i
            break
    if header_idx is None:
        return []
    try:
        df = pd.read_csv(StringIO("\n".join(lines[header_idx:])), sep="|")
    except Exception:
        return []
    df.columns = df.columns.str.strip()
    if "DIAM" not in df.columns:
        return []
    col_cod = "COD_PROD" if "COD_PROD" in df.columns else ("COD_PROYECTO" if "COD_PROYECTO" in df.columns else None)
    if col_cod is None:
        return []

    desfasados = []
    for idx, r in df.iterrows():
        try:
            diam = float(r["DIAM"]) if pd.notna(r["DIAM"]) else None
        except (ValueError, TypeError):
            continue
        if diam is None:
            continue
        cod_esperado = _DIAM_COD_MAP.get(diam)
        if cod_esperado is None:
            continue  # diámetro no está en el mapa (diámetro no estándar)
        cod_actual = _normalizar_cod_prod(r[col_cod])
        if not cod_actual:
            continue  # sin código en CSV — no hay desfase detectable
        if cod_actual != cod_esperado:
            desfasados.append({
                "fila": int(idx) + 2,
                "diam": diam,
                "cod_actual": cod_actual,
                "cod_esperado": cod_esperado,
            })
    return desfasados


# ========================= PREVIEW DE IMPORTACIÓN =========================

def _parse_csv_preview_groups(raw: str):
    """Lee el CSV, ubica la cabecera 'ID|ESTRUCTURA|' y devuelve:
      - groups_epc: dict {(eje, piso, ciclo): count}   — claves de reemplazo (sin plano)
      - groups_ep:  dict {(eje, piso): {"count": int, "planos": set, "ciclos": set}}
      - planos: set de plano_codes detectados (a nivel CSV)
      - ejes_planos: dict {eje: set(planos)} — para detectar multi-plano por eje
    Para el preview no calcula peso. plano_code se ignora a propósito en las
    claves de reemplazo: si Detailer entrega varios plano_code para un mismo
    eje, igual queremos que el reemplazo borre todas las barras del eje en
    ese (piso, ciclo).
    """
    lines = raw.splitlines()
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith("ID|ESTRUCTURA|"):
            header_idx = i
            break
    if header_idx is None:
        return None, None, None, None
    data_text = "\n".join(lines[header_idx:])
    try:
        df = pd.read_csv(StringIO(data_text), sep="|")
    except Exception:
        return None, None, None, None
    df.columns = df.columns.str.strip()
    needed = {"PISO", "CICLO", "EJE"}
    if not needed.issubset(set(df.columns)):
        return None, None, None, None
    has_plano = "PLANO_CODE" in df.columns
    groups_epc: dict = {}
    groups_ep:  dict = {}
    planos: set = set()
    ejes_planos: dict = {}
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
        plano = _v("PLANO_CODE") if has_plano else ""
        piso  = _v("PISO")
        ciclo = _v("CICLO")
        eje   = _v("EJE")
        if plano:
            planos.add(plano)
        if eje:
            ejes_planos.setdefault(eje, set())
            if plano:
                ejes_planos[eje].add(plano)
        k_epc = (eje, piso, ciclo)
        groups_epc[k_epc] = groups_epc.get(k_epc, 0) + 1
        slot = groups_ep.setdefault((eje, piso), {"count": 0, "planos": set(), "ciclos": set()})
        slot["count"] += 1
        if plano:
            slot["planos"].add(plano)
        if ciclo:
            slot["ciclos"].add(ciclo)
    return groups_epc, groups_ep, planos, ejes_planos


@router.post("/import/armadetailer/preview")
async def import_armadetailer_preview(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
    obra_destino: str = Query(..., description="ID de obra destino (obligatorio)"),
):
    """Devuelve un preview del impacto del CSV agrupado por (eje, piso),
    restringido a los ejes/pisos que vienen en el CSV. NO toca la BD.

    plano_code se IGNORA en la lógica de reemplazo (bug Detailer puede entregar
    varios planos para un mismo eje). El reemplazo se hace por (eje, piso, ciclo).

    Para cada (eje, piso) presente en el CSV devuelve:
      - existentes_bd: barras BD para ese (eje, piso) en TODOS los ciclos
      - existentes_replace: barras BD en (eje, piso, ciclo) presentes en CSV (serán reemplazadas)
      - existentes_keep: barras BD en (eje, piso, ciclo) NO incluidos en CSV (se conservan)
      - nuevas_csv: barras que aporta el CSV
      - final: existentes_keep + nuevas_csv
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

            groups_epc, groups_ep, planos_csv, ejes_planos = _parse_csv_preview_groups(raw)
            if groups_epc is None:
                return {"ok": False, "error": "No se pudo leer el CSV (cabecera ID|ESTRUCTURA| no encontrada o columnas EJE/PISO/CICLO faltantes)."}

            ejes_csv  = sorted({e for (e, _p) in groups_ep.keys() if e})
            pisos_csv = sorted({p for (_e, p) in groups_ep.keys()}, key=_piso_sort_key)
            planos_list = sorted(planos_csv) if planos_csv else []

            # BD: contar barras por (eje, piso, ciclo) restringido a los ejes y pisos
            # del CSV. n = total; n_edit = cuántas fueron EDITADAS a mano en la
            # plataforma (editado_por IS NOT NULL) — 5M.5: para avisar qué trabajo
            # manual reescribiría el re-import.
            db_epc: dict = {}
            db_epc_edit: dict = {}
            if ejes_csv and pisos_csv:
                cur.execute(
                    """
                    SELECT COALESCE(eje, '')   AS eje,
                           COALESCE(piso, '')  AS piso,
                           COALESCE(ciclo, '') AS ciclo,
                           COUNT(*)                                                 AS n,
                           COUNT(*) FILTER (WHERE editado_por IS NOT NULL)           AS n_edit
                    FROM barras
                    WHERE id_proyecto = %s
                      AND COALESCE(eje, '')  = ANY(%s)
                      AND COALESCE(piso, '') = ANY(%s)
                    GROUP BY 1, 2, 3
                    """,
                    (obra_destino, ejes_csv, pisos_csv),
                )
                for eje, piso, ciclo, n, n_edit in cur.fetchall():
                    db_epc[(eje, piso, ciclo)] = int(n)
                    db_epc_edit[(eje, piso, ciclo)] = int(n_edit or 0)

            # Detalle de las barras editadas a mano que serían reemplazadas (para
            # mostrar quién editó qué). Solo en (eje, piso, ciclo) que el CSV pisa.
            replace_keys_pre = set(groups_epc.keys())
            editadas_detalle = []
            if ejes_csv and pisos_csv and replace_keys_pre:
                cur.execute(
                    """
                    SELECT COALESCE(eje,'') , COALESCE(piso,''), COALESCE(ciclo,''),
                           marca, id_unico, editado_por, editado_fecha
                    FROM barras
                    WHERE id_proyecto = %s
                      AND editado_por IS NOT NULL
                      AND COALESCE(eje, '')  = ANY(%s)
                      AND COALESCE(piso, '') = ANY(%s)
                    ORDER BY editado_fecha DESC NULLS LAST
                    LIMIT 200
                    """,
                    (obra_destino, ejes_csv, pisos_csv),
                )
                for e, pi, ci, marca, id_unico, edp, edf in cur.fetchall():
                    if (e, pi, ci) in replace_keys_pre:
                        editadas_detalle.append({
                            "eje": e, "piso": pi, "ciclo": ci,
                            "marca": marca, "id_unico": id_unico,
                            "editado_por": edp, "editado_fecha": edf,
                        })

    # Set de claves (eje, piso, ciclo) presentes en CSV → ciclos que serán reemplazados
    replace_epc_keys = set(groups_epc.keys())

    # Filas por (eje, piso)
    pisos_rows = []
    sorted_eps = sorted(groups_ep.keys(), key=lambda k: (k[0], _piso_sort_key(k[1])))
    for (eje, piso) in sorted_eps:
        info = groups_ep[(eje, piso)]
        nuevas_csv = info["count"]
        planos_str = ", ".join(sorted(info["planos"])) if info["planos"] else ""

        existentes_replace = 0
        existentes_keep = 0
        editadas_replace = 0   # 5M.5: editadas a mano que este re-import pisaría
        for (e, pi, ci), n in db_epc.items():
            if e != eje or pi != piso:
                continue
            if (e, pi, ci) in replace_epc_keys:
                existentes_replace += n
                editadas_replace += db_epc_edit.get((e, pi, ci), 0)
            else:
                existentes_keep += n
        existentes_bd = existentes_replace + existentes_keep
        final = existentes_keep + nuevas_csv
        action = "replace" if existentes_replace > 0 else "add"

        pisos_rows.append({
            "eje": eje,
            "piso": piso,
            "plano_code": planos_str,
            "existentes_bd": existentes_bd,
            "existentes_replace": existentes_replace,
            "existentes_keep": existentes_keep,
            "editadas_replace": editadas_replace,
            "nuevas_csv": nuevas_csv,
            "final": final,
            "action": action,
        })

    # Server-side: armar replace_keys (formato eje|piso|ciclo) para el import real
    replace_keys_str = ";".join(f"{e}|{pi}|{ci}" for (e, pi, ci) in sorted(replace_epc_keys))

    total_csv         = sum(info["count"] for info in groups_ep.values())
    total_replace     = sum(r["existentes_replace"] for r in pisos_rows)
    total_editadas    = sum(r["editadas_replace"] for r in pisos_rows)   # 5M.5
    pisos_a_reemplazar = sum(1 for r in pisos_rows if r["action"] == "replace")
    pisos_a_sumar      = sum(1 for r in pisos_rows if r["action"] == "add")

    # Detección de multi-plano por eje (bug Detailer) — informativo, ya no afecta el cálculo
    multi_plano_warning = False
    ejes_con_multi_plano = []
    for eje, planos_set in (ejes_planos or {}).items():
        if len(planos_set) > 1:
            multi_plano_warning = True
            ejes_con_multi_plano.append({"eje": eje, "planos": sorted(planos_set)})
    if len(planos_list) > 1:
        multi_plano_warning = True

    cod_prod_desfasados = _detectar_cod_prod_desfasados(raw)

    return {
        "ok": True,
        "obra_id": obra_destino,
        "obra_nombre": proyecto_nombre,
        "archivo": file.filename,
        "planos": planos_list,
        "ejes": ejes_csv,
        "pisos": pisos_rows,
        "replace_keys": replace_keys_str,
        "multi_plano_warning": multi_plano_warning,
        "ejes_multi_plano": ejes_con_multi_plano,
        "cod_prod_desfasados": cod_prod_desfasados,
        # 5M.5: barras editadas a mano en la plataforma que este re-import pisaría.
        "editadas_a_reemplazar": editadas_detalle,
        "summary": {
            "total_csv": total_csv,
            "total_db_a_reemplazar": total_replace,
            "total_editadas_a_reemplazar": total_editadas,
            "pisos_a_reemplazar": pisos_a_reemplazar,
            "pisos_a_sumar": pisos_a_sumar,
            "cod_prod_a_corregir": len(cod_prod_desfasados),
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