from fastapi import FastAPI, UploadFile, File
import pandas as pd
import sqlite3
from io import StringIO
from datetime import datetime, timezone

app = FastAPI(title="ArmaHub Backend")

DB = "armahub.db"

def conn():
    return sqlite3.connect(DB)

def init_db():
    c = conn()
    c.execute("""
    CREATE TABLE IF NOT EXISTS barras (
        id_unico TEXT PRIMARY KEY,
        id_proyecto TEXT,
        plano_code TEXT,
        sector TEXT,
        piso TEXT,
        ciclo TEXT,
        eje TEXT,

        diam REAL,
        largo_total REAL,
        mult REAL,

        cant REAL,
        cant_total REAL,

        peso_unitario REAL,
        peso_total REAL,

        version_mod TEXT,
        version_exp TEXT,
        fecha_carga TEXT
    )
    """)
    c.commit()
    c.close()

init_db()

@app.get("/")
def root():
    return {"ok": True, "service": "armahub-backend"}

@app.post("/import/armadetailer")
async def import_armadetailer(file: UploadFile = File(...)):
    raw = (await file.read()).decode("utf-8", errors="replace")
    lines = raw.splitlines()

    # Buscar dónde empieza la tabla real (cabecera)
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith("ID|ESTRUCTURA|"):
            header_idx = i
            break
    if header_idx is None:
        return {"ok": False, "error": "No se encontró cabecera ID|ESTRUCTURA| en el CSV."}

    data_text = "\n".join(lines[header_idx:])
    df = pd.read_csv(StringIO(data_text), sep="|")

    # Columnas mínimas del CSV fuente
    required = [
        "ID_UNICO", "ID_PROYECTO", "PLANO_CODE",
        "SECTOR", "PISO", "CICLO", "EJE",
        "DIAM", "LARGO_TOTAL", "CANT",
        "VERSION_MOD", "VERSION_EXP"
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        return {"ok": False, "error": f"Faltan columnas requeridas: {missing}"}

    c = conn()
    upserted = 0

    for _, r in df.iterrows():
        diam = float(r["DIAM"]) if pd.notna(r["DIAM"]) else None
        largo = float(r["LARGO_TOTAL"]) if pd.notna(r["LARGO_TOTAL"]) else None
        mult = float(r["MULT"]) if ("MULT" in df.columns and pd.notna(r["MULT"])) else None

        # CSV trae CANT como total (ya multiplicada)
        cant_total = float(r["CANT"]) if pd.notna(r["CANT"]) else None

        # Cantidad "parcial" estilo ArmaHub (solo si mult existe y > 0)
        if cant_total is not None and mult is not None and mult > 0:
            cant = cant_total / mult
        else:
            cant = cant_total

        # Peso unitario según fórmula ArmaHub (OJO: depende de unidades del largo)
        # Fórmula del doc: 7850 * 3.1416 * (diam/20)^2 * Largo * 0.01
        peso_unitario = None
        if diam is not None and largo is not None:
            peso_unitario = 7850 * 3.1416 * (diam / 2000) ** 2 * (largo / 100)
            
        peso_total = None
        if peso_unitario is not None and cant_total is not None:
            peso_total = peso_unitario * cant_total
        
        fecha_carga = datetime.now(timezone.utc).isoformat()

        c.execute("""
        INSERT OR REPLACE INTO barras
        (id_unico,id_proyecto,plano_code,sector,piso,ciclo,eje,diam,largo_total,mult,cant,cant_total,peso_unitario,peso_total,version_mod,version_exp,fecha_carga)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            str(r["ID_UNICO"]),
            str(r["ID_PROYECTO"]),
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
            fecha_carga,
        ))
        upserted += 1

    c.commit()
    c.close()

    return {"ok": True, "rows_upserted": upserted}

@app.get("/stats")
def stats():
    c = conn()

    total_barras = c.execute("SELECT COUNT(*) FROM barras").fetchone()[0]
    total_kilos_exact = c.execute("SELECT COALESCE(SUM(peso_total),0) FROM barras").fetchone()[0]

    # Suma "tipo GStarCAD": redondeo por item a 2 decimales y luego suma
    rows = c.execute("SELECT COALESCE(peso_total,0) FROM barras").fetchall()
    total_kilos_item_rounded = sum(round(r[0], 2) for r in rows)

    c.close()
    return {
        "total_barras": total_barras,
        "total_kilos_exact": total_kilos_exact,
        "total_kilos_item_rounded": total_kilos_item_rounded}

        # =========================
# Filtros disponibles
# =========================
@app.get("/filters")
def filters():
    c = conn()

    sectores = [r[0] for r in c.execute("SELECT DISTINCT sector FROM barras ORDER BY sector").fetchall()]
    pisos = [r[0] for r in c.execute("SELECT DISTINCT piso FROM barras ORDER BY piso").fetchall()]
    ciclos = [r[0] for r in c.execute("SELECT DISTINCT ciclo FROM barras ORDER BY ciclo").fetchall()]
    planos = [r[0] for r in c.execute("SELECT DISTINCT plano_code FROM barras ORDER BY plano_code").fetchall()]
    proyectos = [r[0] for r in c.execute("SELECT DISTINCT id_proyecto FROM barras ORDER BY id_proyecto").fetchall()]

    c.close()

    return {
        "sectores": sectores,
        "pisos": pisos,
        "ciclos": ciclos,
        "planos": planos,
        "proyectos": proyectos
    }


# =========================
# Consulta de barras con filtros
# =========================
@app.get("/barras")
def get_barras(
    proyecto: str = None,
    plano_code: str = None,
    sector: str = None,
    piso: str = None,
    ciclo: str = None
):
    c = conn()

    query = "SELECT * FROM barras WHERE 1=1"
    params = []

    if proyecto:
        query += " AND id_proyecto = ?"
        params.append(proyecto)
    if plano_code:
        query += " AND plano_code = ?"
        params.append(plano_code)
    if sector:
        query += " AND sector = ?"
        params.append(sector)
    if piso:
        query += " AND piso = ?"
        params.append(piso)
    if ciclo:
        query += " AND ciclo = ?"
        params.append(ciclo)

    rows = c.execute(query, params).fetchall()
    columns = [description[0] for description in c.execute("PRAGMA table_info(barras)").fetchall()]

    c.close()

    result = []
    for row in rows:
        result.append(dict(zip(columns, row)))

    return {
        "count": len(result),
        "data": result
    }

@app.get("/dashboard")
def dashboard(group_by: str = "ciclo"):
    allowed = {"sector", "piso", "ciclo", "plano_code", "id_proyecto"}
    if group_by not in allowed:
        return {"ok": False, "error": f"group_by debe ser uno de {sorted(list(allowed))}"}

    c = conn()

    total = c.execute("""
        SELECT COUNT(*) AS barras, COALESCE(SUM(peso_total),0) AS kilos
        FROM barras
    """).fetchone()

    rows = c.execute(f"""
        SELECT {group_by} AS grupo,
               COUNT(*) AS barras,
               COALESCE(SUM(peso_total),0) AS kilos
        FROM barras
        GROUP BY {group_by}
        ORDER BY kilos DESC
    """).fetchall()

    c.close()

    return {
        "total": {"barras": total[0], "kilos": total[1]},
        "group_by": group_by,
        "items": [{"grupo": r[0], "barras": r[1], "kilos": r[2]} for r in rows]
    }  