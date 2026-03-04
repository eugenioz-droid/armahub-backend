from fastapi import FastAPI, UploadFile, File
import pandas as pd
import sqlite3
from io import StringIO
from datetime import datetime, timezone
import jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import HTMLResponse
from jinja2 import Template
import os
import psycopg
from urllib.parse import urlparse

app = FastAPI(title="ArmaHub Backend")

DB = os.getenv("ARMAHUB_DB", "armahub.db")



def conn():
    db_url = os.getenv("DATABASE_URL")

    if db_url:
        if db_url.startswith("postgres://"):
            db_url = "postgresql://" + db_url[len("postgres://"):]
        return psycopg.connect(db_url)

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
    c.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL
    )
    """)

    c.commit()
    c.close()

init_db()

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
auth_scheme = HTTPBearer()

def create_token(email: str, role: str):
    payload = {"email": email, "role": role}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")

@app.post("/auth/register")
def register(email: str, password: str, role: str = "operador"):
    if role not in ("admin", "operador"):
        raise HTTPException(status_code=400, detail="role debe ser admin u operador")

    c = conn()
    password_hash = pwd_context.hash(password)
    try:
        c.execute("INSERT INTO users (email, password_hash, role) VALUES (?,?,?)", (email, password_hash, role))
        c.commit()
    except Exception:
        c.close()
        raise HTTPException(status_code=400, detail="Email ya existe")
    c.close()
    return {"ok": True}

@app.post("/auth/login")
def login(email: str, password: str):
    c = conn()
    row = c.execute("SELECT email, password_hash, role FROM users WHERE email = ?", (email,)).fetchone()
    c.close()

    if not row:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    db_email, db_hash, db_role = row
    if not pwd_context.verify(password, db_hash):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    token = create_token(db_email, db_role)
    return {"access_token": token, "token_type": "bearer", "role": db_role}

@app.get("/")
def root():
    return {"ok": True, "service": "armahub-backend"}

@app.post("/import/armadetailer")
async def import_armadetailer(file: UploadFile = File(...), user=Depends(get_current_user)):
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
    ciclo: str = None,
    user=Depends(get_current_user)
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
def dashboard(group_by: str = "ciclo", user=Depends(get_current_user)):
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

# =========================
# UI mínima (sin frontend separado)
# =========================

LOGIN_HTML = Template("""
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ArmaHub - Login</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
    input, button { padding: 10px; margin: 6px 0; width: 100%; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 16px; }
    .muted { color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <h2>ArmaHub</h2>
  <div class="card">
    <h3>Login</h3>
    <input id="email" placeholder="Email" />
    <input id="password" type="password" placeholder="Password" />
    <button onclick="doLogin()">Entrar</button>
    <div id="msg" class="muted"></div>
  </div>

<script>
async function doLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const msg = document.getElementById('msg');
  msg.textContent = "Ingresando...";

  const params = new URLSearchParams({ email, password });
  const res = await fetch('/auth/login?' + params.toString(), { method: 'POST' });
  const data = await res.json();

  if (!res.ok) {
    msg.textContent = "Error: " + (data.detail || JSON.stringify(data));
    return;
  }

  localStorage.setItem('armahub_token', data.access_token);
  window.location.href = '/ui';
}
</script>
</body>
</html>
""")

APP_HTML = Template("""
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ArmaHub</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1100px; margin: 30px auto; padding: 0 16px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin: 10px 0; }
    select, input, button { padding: 8px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #eee; padding: 6px; font-size: 12px; }
    th { background: #fafafa; text-align: left; }
    .muted { color: #666; font-size: 12px; }
    .right { float: right; }
  </style>
</head>
<body>
  <h2>ArmaHub <span class="right"><button onclick="logout()">Salir</button></span></h2>

  <div class="card">
    <h3>1) Importar CSV</h3>
    <input type="file" id="csvFile" />
    <button onclick="importCSV()">Importar</button>
    <div id="importMsg" class="muted"></div>
  </div>

  <div class="card">
    <h3>2) Dashboard</h3>
    <div class="row">
      <button onclick="loadDashboard('ciclo')">Por ciclo</button>
      <button onclick="loadDashboard('sector')">Por sector</button>
      <button onclick="loadDashboard('piso')">Por piso</button>
      <button onclick="loadDashboard('plano_code')">Por plano</button>
      <button onclick="loadDashboard('id_proyecto')">Por proyecto</button>
    </div>
    <pre id="dash" class="muted"></pre>
  </div>

  <div class="card">
    <h3>3) Buscar barras</h3>
    <div class="row">
      <select id="proyecto"></select>
      <select id="plano"></select>
      <select id="sector"></select>
      <select id="piso"></select>
      <select id="ciclo"></select>
      <button onclick="buscar()">Buscar</button>
    </div>
    <div class="muted" id="count"></div>
    <div style="overflow:auto; max-height: 420px;">
      <table id="tabla"></table>
    </div>
  </div>

<script>
function token() {
  return localStorage.getItem('armahub_token');
}
function authHeaders() {
  const t = token();
  if (!t) return {};
  return { "Authorization": "Bearer " + t };
}
function logout() {
  localStorage.removeItem('armahub_token');
  window.location.href = '/ui/login';
}
async function apiGet(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) { logout(); return null; }
  return await res.json();
}
async function apiPostFile(url, file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: form });
  if (res.status === 401) { logout(); return null; }
  return await res.json();
}

async function loadFilters() {
  const data = await apiGet('/filters');
  if (!data) return;

  function fill(selId, items, label) {
    const sel = document.getElementById(selId);
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = label;
    sel.appendChild(opt0);
    items.forEach(x => {
      const o = document.createElement('option');
      o.value = x;
      o.textContent = x;
      sel.appendChild(o);
    });
  }

  fill('proyecto', data.proyectos, 'Proyecto (todos)');
  fill('plano', data.planos, 'Plano (todos)');
  fill('sector', data.sectores, 'Sector (todos)');
  fill('piso', data.pisos, 'Piso (todos)');
  fill('ciclo', data.ciclos, 'Ciclo (todos)');
}

async function importCSV() {
  const fileInput = document.getElementById('csvFile');
  const msg = document.getElementById('importMsg');
  if (!fileInput.files.length) { msg.textContent = "Selecciona un CSV."; return; }

  msg.textContent = "Importando...";
  const data = await apiPostFile('/import/armadetailer', fileInput.files[0]);
  if (!data) return;
  msg.textContent = JSON.stringify(data);
  await loadFilters();
  await loadDashboard('ciclo');
}

async function loadDashboard(groupBy) {
  const data = await apiGet('/dashboard?group_by=' + encodeURIComponent(groupBy));
  if (!data) return;
  document.getElementById('dash').textContent = JSON.stringify(data, null, 2);
}

async function buscar() {
  const params = new URLSearchParams();
  const proyecto = document.getElementById('proyecto').value;
  const plano = document.getElementById('plano').value;
  const sector = document.getElementById('sector').value;
  const piso = document.getElementById('piso').value;
  const ciclo = document.getElementById('ciclo').value;

  if (proyecto) params.set('proyecto', proyecto);
  if (plano) params.set('plano_code', plano);
  if (sector) params.set('sector', sector);
  if (piso) params.set('piso', piso);
  if (ciclo) params.set('ciclo', ciclo);

  const data = await apiGet('/barras?' + params.toString());
  if (!data) return;

  document.getElementById('count').textContent = "Resultados: " + data.count;

  const table = document.getElementById('tabla');
  table.innerHTML = '';

  if (!data.data.length) return;

  const cols = Object.keys(data.data[0]);
  const thead = document.createElement('tr');
  cols.forEach(c => {
    const th = document.createElement('th');
    th.textContent = c;
    thead.appendChild(th);
  });
  table.appendChild(thead);

  data.data.forEach(row => {
    const tr = document.createElement('tr');
    cols.forEach(c => {
      const td = document.createElement('td');
      td.textContent = row[c];
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
}

(async function init() {
  if (!token()) { window.location.href = '/ui/login'; return; }
  await loadFilters();
  await loadDashboard('ciclo');
})();
</script>
</body>
</html>
""")

@app.get("/ui/login", response_class=HTMLResponse)
def ui_login():
    return LOGIN_HTML.render()

@app.get("/ui", response_class=HTMLResponse)
def ui_app():
    return APP_HTML.render()