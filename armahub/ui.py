"""
ui.py (refactorizado)
-----
UI con estructura de tabs por rol.

Incluye:
- GET /ui/login      (login)
- GET /ui            (app con tabs: Mis Obras, Búsqueda, Dashboards, Pedidos, Exportación)
- GET /ui/bootstrap  (crear primer admin si no hay usuarios)
"""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from jinja2 import Template
from .db import users_count

router = APIRouter()

LOGIN_HTML = Template("""
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ArmaHub - Login</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; background: #f5f5f5; }
    input, button { padding: 10px; margin: 6px 0; width: 100%; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px; }
    button { background: #8BC34A; color: white; cursor: pointer; font-weight: bold; }
    button:hover { background: #558B2F; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 16px; background: white; }
    .muted { color: #666; font-size: 12px; }
    a { color: #8BC34A; text-decoration:none; font-weight: bold; }
    h2 { color: #2C2C2C; }
  </style>
</head>
<body>
  <h2>ArmaHub — Sistema de Cubicación</h2>

  <div class="card" id="bootstrapHint" style="display:none;">
    <b>Primera vez (BD vacía)</b>
    <div class="muted">Si aún no existen usuarios, crea el primer admin acá:</div>
    <div style="margin-top:8px;">
      <a href="/ui/bootstrap">Crear admin inaugural</a>
    </div>
  </div>

  <div class="card">
    <h3>Ingreso</h3>
    <input id="email" placeholder="Email" />
    <input id="password" type="password" placeholder="Contraseña" />
    <button onclick="doLogin()">Entrar</button>
    <div id="msg" class="muted" style="margin-top:10px;"></div>
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

(async function checkBootstrap() {
  try {
    const res = await fetch('/ui/bootstrap', { method: 'GET' });
    if (res.ok) {
      document.getElementById('bootstrapHint').style.display = 'block';
    }
  } catch(e) {}
})();
</script>
</body>
</html>
""")

BOOTSTRAP_HTML = Template("""
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ArmaHub - Bootstrap</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; background: #f5f5f5; }
    input, button { padding: 10px; margin: 6px 0; width: 100%; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px; }
    button { background: #8BC34A; color: white; cursor: pointer; font-weight: bold; }
    button:hover { background: #558B2F; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 16px; background: white; }
    .muted { color: #666; font-size: 12px; }
    a { color: #8BC34A; text-decoration: none; font-weight: bold; }
    .status-ok { color: #1a7f37; font-size: 12px; }
    .status-err { color: #b42318; font-size: 12px; }
    h2 { color: #2C2C2C; }
  </style>
</head>
<body>
  <h2>Crear Administrador Inaugural</h2>

  <div class="card">
    <div class="muted">
      Esto solo funciona si <b>no existe ningún usuario</b> en la base de datos.
      Si ya existe un usuario, esta pantalla se bloquea.
    </div>

    <h3>Crear primer admin</h3>
    <input id="email" placeholder="Email admin" />
    <input id="password" type="password" placeholder="Contraseña" />
    <button onclick="createAdmin()">Crear admin</button>
    <div id="msg" class="muted" style="margin-top:10px;"></div>

    <div style="margin-top:10px;">
      <a href="/ui/login">← Volver a login</a>
    </div>
  </div>

<script>
async function createAdmin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const msg = document.getElementById('msg');
  msg.textContent = "Creando...";

  const params = new URLSearchParams({ email, password });
  const res = await fetch('/bootstrap/create-admin?' + params.toString(), { method: 'POST' });
  const data = await res.json();

  if (!res.ok) {
    msg.textContent = "Error: " + (data.detail || JSON.stringify(data));
    return;
  }

  msg.innerHTML = "Admin creado ✅. Ahora puedes <a href='/ui/login'>loguearte</a>.";
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
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
  <meta http-equiv="Pragma" content="no-cache">
  <title>ArmaHub — Sistema de Cubicación</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0; padding: 0; 
      background: #f5f5f5;
      color: #2C2C2C;
    }
    
    /* Header */
    .header {
      background: white;
      border-bottom: 3px solid #8BC34A;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .header h1 { margin: 0; color: #2C2C2C; font-size: 24px; }
    .user-info {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .user-badge { 
      display: inline-block;
      padding: 6px 12px; 
      background: #F5F5F5;
      border: 1px solid #ddd;
      border-radius: 20px;
      font-size: 12px;
      color: #555;
    }
    .btn-logout {
      background: #8BC34A;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
    }
    .btn-logout:hover { background: #558B2F; }
    
    /* Tabs */
    .tabs {
      background: white;
      border-bottom: 1px solid #ddd;
      padding: 0;
      display: flex;
      gap: 0;
      margin: 0;
    }
    .tab-btn {
      background: none;
      border: none;
      padding: 16px 20px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #666;
      border-bottom: 3px solid transparent;
      transition: all 0.2s;
    }
    .tab-btn:hover { color: #2C2C2C; background: #f9f9f9; }
    .tab-btn.active { 
      color: #8BC34A;
      border-bottom-color: #8BC34A;
    }
    
    /* Tab content */
    .tab-content { display: none; padding: 20px; max-width: 1200px; margin: 0 auto; }
    .tab-content.active { display: block; }
    
    /* Cards */
    .card {
      background: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .card h3 { margin-top: 0; color: #2C2C2C; }
    
    /* Buttons */
    button {
      padding: 10px 16px;
      background: #8BC34A;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      font-size: 14px;
      transition: all 0.2s;
    }
    button:hover { background: #558B2F; }
    button.secondary { background: #ddd; color: #2C2C2C; }
    button.secondary:hover { background: #ccc; }
    button.danger { background: #b42318; }
    button.danger:hover { background: #8b1a14; }
    
    /* Inputs */
    input, select, textarea {
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-family: inherit;
      font-size: 14px;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: #8BC34A;
      box-shadow: 0 0 0 2px rgba(139, 195, 74, 0.1);
    }
    
    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      overflow: hidden;
    }
    th {
      background: #f5f5f5;
      border-bottom: 2px solid #ddd;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #2C2C2C;
      font-size: 13px;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #efefef;
      font-size: 13px;
    }
    tr:hover { background: #fafafa; }
    
    /* Utilities */
    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      margin: 12px 0;
    }
    .col {
      flex: 1;
      min-width: 200px;
    }
    .muted { color: #666; font-size: 12px; }
    .status-ok { color: #1a7f37; }
    .status-err { color: #b42318; }
    .status-warn { color: #ff9800; }
    
    /* Badges */
    .badge {
      display: inline-block;
      padding: 4px 8px;
      background: #8BC34A;
      color: white;
      border-radius: 3px;
      font-size: 12px;
      margin-right: 4px;
    }
    
    /* Global status */
    #globalStatus {
      position: sticky;
      top: 0;
      padding: 12px 20px;
      background: #f0f0f0;
      border-bottom: 2px solid #ddd;
      z-index: 100;
      margin: 0;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div style="display: flex; align-items: center; gap: 12px;">
      <img src="/static/images/logo-armacero.png" alt="ArmaCero Logo" style="height: auto; max-height: 70px; width: auto; object-fit: contain;" onerror="this.style.display='none';">
      <h1 style="margin: 0; color: #2C2C2C; font-size: 24px;">ArmaHub</h1>
    </div>
    <div class="user-info">
      <span class="user-badge" id="whoEmail">—</span>
      <span class="user-badge" id="whoRole">—</span>
      <button class="btn-logout" onclick="logout()">Salir</button>
    </div>
  </div>

  <!-- Global Status -->
  <div id="globalStatus" class="muted"></div>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('obras')">📦 Mis Obras</button>
    <button class="tab-btn" onclick="switchTab('buscar')">🔍 Buscar Barras</button>
    <button class="tab-btn" onclick="switchTab('dashboards')">📊 Dashboards</button>
    <button class="tab-btn" onclick="switchTab('pedidos')">📝 Pedidos</button>
    <button class="tab-btn" onclick="switchTab('export')">📥 Exportación</button>
  </div>

  <!-- TAB 1: MIS OBRAS -->
  <div id="tab-obras" class="tab-content active">
    <div class="card">
      <h3>Cargar datos de obra</h3>
      <div class="row">
        <input type="file" id="csvFile" placeholder="Seleccionar CSV..." />
        <button onclick="importCSV()">📤 Importar CSV</button>
      </div>
      <div id="importMsg" class="muted" style="margin-top: 8px;"></div>
    </div>

    <div class="card">
      <h3>Mis proyectos</h3>
      <div id="proyectosContainer" style="min-height: 200px;">
        <div class="muted">Cargando...</div>
      </div>
    </div>

    <div class="card">
      <h3>Historial de cargas</h3>
      <div class="row">
        <select id="filtroProyectoCarga" onchange="loadCargas()">
          <option value="">Todos los proyectos</option>
        </select>
      </div>
      <div style="overflow-x: auto;">
        <table id="cargasTable">
          <thead>
            <tr>
              <th>Proyecto</th>
              <th>Usuario</th>
              <th>Fecha</th>
              <th>Versión</th>
              <th>Barras cargadas</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="cargasBody">
            <tr><td colspan="6" class="muted">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- TAB 2: BUSCAR BARRAS -->
  <div id="tab-buscar" class="tab-content">
    <div class="card">
      <h3>Filtros</h3>
      <div class="row">
        <div class="col">
          <select id="proyecto" onchange="buscar(true)">
            <option value="">Proyecto (todos)</option>
          </select>
        </div>
        <div class="col">
          <select id="plano" onchange="buscar(true)">
            <option value="">Plano (todos)</option>
          </select>
        </div>
        <div class="col">
          <select id="sector" onchange="buscar(true)">
            <option value="">Sector (todos)</option>
          </select>
        </div>
        <div class="col">
          <select id="piso" onchange="buscar(true)">
            <option value="">Piso (todos)</option>
          </select>
        </div>
        <div class="col">
          <select id="ciclo" onchange="buscar(true)">
            <option value="">Ciclo (todos)</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div class="col" style="flex: 2;">
          <input id="q" placeholder="Buscar por ID, Eje o Plano..." onkeyup="if(event.key==='Enter') buscar(true)" />
        </div>
        <div class="col">
          <select id="order_by" onchange="buscar(true)">
            <option value="fecha_carga">Orden: Fecha carga</option>
            <option value="peso_total">Orden: Peso</option>
            <option value="cant_total">Orden: Cantidad</option>
            <option value="diam">Orden: Diámetro</option>
            <option value="largo_total">Orden: Largo</option>
            <option value="plano_code">Orden: Plano</option>
            <option value="id_unico">Orden: ID único</option>
          </select>
        </div>
        <div class="col">
          <select id="order_dir" onchange="buscar(true)">
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </select>
        </div>
      </div>

      <div class="row">
        <button onclick="buscar(true)">🔍 Buscar</button>
        <button class="secondary" onclick="resetFiltros()">Limpiar filtros</button>
        <span class="muted" id="pageInfo"></span>
      </div>
    </div>

    <div class="card">
      <div class="muted" id="count"></div>
      <div style="overflow-x: auto; margin-top: 12px;">
        <table id="tabla">
          <thead></thead>
          <tbody></tbody>
        </table>
      </div>

      <div class="row" style="justify-content: center; margin-top: 16px;">
        <button onclick="prevPage()">◀ Anterior</button>
        <button onclick="nextPage()">Siguiente ▶</button>
      </div>
    </div>
  </div>

  <!-- TAB 3: DASHBOARDS -->
  <div id="tab-dashboards" class="tab-content">
    <div class="card">
      <h3>Resumen general</h3>
      <div id="generalStats">
        <div class="muted">Cargando...</div>
      </div>
    </div>

    <div class="card">
      <h3>Gráficos por dimensión</h3>
      <div class="row">
        <button onclick="loadDashboard('sector')">Sector</button>
        <button onclick="loadDashboard('piso')">Piso</button>
        <button onclick="loadDashboard('ciclo')">Ciclo</button>
        <button onclick="loadDashboard('plano_code')">Plano</button>
        <button onclick="loadDashboard('id_proyecto')">Proyecto</button>
        <button onclick="loadDashboard('eje')">Eje</button>
      </div>
      <div id="dashTotals" class="muted" style="margin: 12px 0;"></div>
      <div style="height: 360px; margin-top: 16px;">
        <canvas id="dashChart"></canvas>
      </div>
    </div>
  </div>

  <!-- TAB 4: PEDIDOS (Future MVP) -->
  <div id="tab-pedidos" class="tab-content">
    <div class="card">
      <h3>Solicitar material</h3>
      <p class="muted">Funcionalidad en desarrollo. Próximamente podrás crear solicitudes de barras manualmente.</p>
    </div>
  </div>

  <!-- TAB 5: EXPORTACIÓN (Future) -->
  <div id="tab-export" class="tab-content">
    <div class="card">
      <h3>Exportar a producción (aSa Studio)</h3>
      <p class="muted">Funcionalidad en desarrollo. Próximamente podrás descargar en formato aSa.</p>
    </div>
  </div>

<script>
// ========================= AUTH =========================
function token() { return localStorage.getItem('armahub_token'); }
function authHeaders() {
  const t = token();
  return t ? { "Authorization": "Bearer " + t } : {};
}
function logout() {
  localStorage.removeItem('armahub_token');
  window.location.href = '/ui/login';
}

async function apiGet(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) { logout(); return null; }
  
  let data = null;
  try { data = await res.json(); } catch (e) {
    console.error("JSON parse error:", e);
    await setGlobalStatus("Error: respuesta inválida", "err");
    return null;
  }
  
  if (!res.ok) {
    const msg = data?.detail || data?.error || ("HTTP " + res.status);
    console.error("API Error:", msg, data);
    await setGlobalStatus("Error: " + msg, "err");
    return null;
  }
  
  return data;
}

async function apiPost(url, params) {
  const res = await fetch(url + "?" + new URLSearchParams(params).toString(), {
    method: 'POST',
    headers: authHeaders()
  });
  if (res.status === 401) { logout(); return null; }
  return { ok: res.ok, data: await res.json() };
}

async function apiPostFile(url, file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: form });
  if (res.status === 401) { logout(); return null; }
  return await res.json();
}

// ========================= UI =========================
async function setGlobalStatus(text, kind = 'info') {
  const el = document.getElementById('globalStatus');
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : kind === 'warn' ? 'status-warn' : 'muted';
  el.textContent = text || '';
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  
  document.getElementById('tab-' + tabName).classList.add('active');
  event.target.classList.add('active');
}

// ========================= INIT =========================
async function loadMe() {
  const me = await apiGet('/me');
  if (!me) return;
  document.getElementById('whoEmail').textContent = me.email;
  document.getElementById('whoRole').textContent = "Rol: " + me.role;
  if (me.role === 'admin') {
    await setGlobalStatus("Sesión como ADMIN", "ok");
  } else {
    await setGlobalStatus("Sesión iniciada", "ok");
  }
}

async function loadProyectos() {
  const data = await apiGet('/proyectos');
  if (!data) return;
  
  const container = document.getElementById('proyectosContainer');
  if (!data.proyectos || data.proyectos.length === 0) {
    container.innerHTML = '<div class="muted">No hay proyectos cargados</div>';
    return;
  }
  
  container.innerHTML = data.proyectos.map(p => `
    <div class="card" style="margin: 12px 0; padding: 16px; border-left: 4px solid #8BC34A;">
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <h4 style="margin: 0 0 8px 0;">${p.nombre_proyecto}</h4>
          <div class="muted">
            <span class="badge">${p.total_kilos.toFixed(0)} kg</span>
            <span class="badge">${p.total_barras} barras</span>
          </div>
        </div>
        <div style="text-align: right;">
          <button class="secondary" onclick="viewProyecto('${p.id_proyecto}')">Ver detalles</button>
        </div>
      </div>
    </div>
  `).join('');
}

async function loadFilters() {
  const data = await apiGet('/filters');
  if (!data) return;
  
  function fillSelect(selId, items, isPlanos = false) {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = '<option value="">Todos</option>';
    (items || []).forEach(x => {
      const o = document.createElement('option');
      if (isPlanos) {
        o.value = x.code;
        o.textContent = x.nombre || x.code;
      } else {
        o.value = x;
        o.textContent = x;
      }
      sel.appendChild(o);
    });
    sel.value = val;
  }
  
  fillSelect('proyecto', data.proyectos);
  fillSelect('plano', data.planos, true);  // true = isPlanos
  fillSelect('sector', data.sectores);
  fillSelect('piso', data.pisos);
  fillSelect('ciclo', data.ciclos);
}

async function importCSV() {
  const fileInput = document.getElementById('csvFile');
  const msg = document.getElementById('importMsg');
  
  if (!fileInput.files.length) {
    msg.textContent = "Selecciona un archivo en formato CSV";
    return;
  }
  
  msg.textContent = "Importando...";
  await setGlobalStatus("Cargando archivo...", "warn");
  
  const data = await apiPostFile('/import/armadetailer', fileInput.files[0]);
  if (!data) {
    await setGlobalStatus("Sesión expirada", "err");
    return;
  }
  
  if (data.ok === false) {
    msg.textContent = "Error: " + (data.error || JSON.stringify(data));
    await setGlobalStatus("Error importando CSV", "err");
    return;
  }
  
  msg.innerHTML = `✅ ${data.proyecto}: ${data.rows_upserted} barras importadas`;
  await setGlobalStatus("Importación exitosa", "ok");
  fileInput.value = '';
  
  await loadProyectos();
  await loadFilters();
  await loadDashboard('sector');
}

// ========================= CARGAS (PLACEHOLDER) =========================
async function loadCargas() {
  const tbody = document.getElementById('cargasBody');
  tbody.innerHTML = '<tr><td colspan="6" class="muted">Funcionalidad en desarrollo</td></tr>';
}

// ========================= BUSCAR BARRAS =========================
let currentOffset = 0;
const pageLimit = 50;
let lastTotal = 0;
let currentOrderBy = "fecha_carga";
let currentOrderDir = "desc";

const ORDERABLE_COLS = new Set([
  "fecha_carga", "peso_total", "peso_unitario", "cant_total",
  "diam", "largo_total", "id_proyecto", "plano_code", "sector", "piso", "ciclo", "eje", "id_unico"
]);

async function buscar(reset = false) {
  if (reset) currentOffset = 0;
  
  const params = new URLSearchParams();
  ['proyecto', 'plano', 'sector', 'piso', 'ciclo'].forEach(f => {
    const v = document.getElementById(f).value;
    if (v) params.set(f === 'plano' ? 'plano_code' : f, v);
  });
  
  const q = document.getElementById('q').value.trim();
  if (q) params.set('q', q);
  
  params.set('limit', pageLimit);
  params.set('offset', currentOffset);
  params.set('order_by', document.getElementById('order_by').value);
  params.set('order_dir', document.getElementById('order_dir').value);
  
  const url = '/barras?' + params.toString();
  console.log("Fetching: " + url);
  
  const data = await apiGet(url);
  if (!data) return;
  
  lastTotal = data.total || 0;
  const page = Math.floor(currentOffset / pageLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(lastTotal / pageLimit));
  
  document.getElementById('count').textContent = `${data.count} de ${lastTotal} resultados — Página ${page}/${totalPages}`;
  
  const table = document.getElementById('tabla');
  table.innerHTML = '';
  
  if (!data.data || !data.data.length) {
    table.innerHTML = '<tr><td colspan="20" class="muted" style="padding: 20px; text-align: center;">Sin resultados</td></tr>';
    return;
  }
  
  const cols = Object.keys(data.data[0]);
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  
  cols.forEach(c => {
    const th = document.createElement('th');
    const isOrderable = ORDERABLE_COLS.has(c);
    if (isOrderable) {
      th.style.cursor = 'pointer';
      th.onclick = () => {
        currentOrderBy = c;
        currentOrderDir = currentOrderDir === 'asc' ? 'desc' : 'asc';
        buscar(true);
      };
    }
    th.textContent = c + (c === currentOrderBy ? (currentOrderDir === 'asc' ? ' ▲' : ' ▼') : '');
    headerRow.appendChild(th);
  });
  
  thead.appendChild(headerRow);
  table.appendChild(thead);
  
  const tbody = document.createElement('tbody');
  data.data.forEach(row => {
    const tr = document.createElement('tr');
    cols.forEach(c => {
      const td = document.createElement('td');
      td.textContent = row[c];
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

function resetFiltros() {
  ['proyecto', 'plano', 'sector', 'piso', 'ciclo'].forEach(f => {
    document.getElementById(f).value = '';
  });
  document.getElementById('q').value = '';
  buscar(true);
}

function prevPage() {
  currentOffset = Math.max(0, currentOffset - pageLimit);
  buscar(false);
}

function nextPage() {
  if (currentOffset + pageLimit >= lastTotal) return;
  currentOffset += pageLimit;
  buscar(false);
}

// ========================= DASHBOARD =========================
let chart = null;

function renderChart(labels, values, title) {
  const ctx = document.getElementById('dashChart').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: title, data: values, backgroundColor: '#8BC34A' }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y' }
  });
}

async function loadDashboard(groupBy) {
  await setGlobalStatus("Cargando gráfico...", "warn");
  const data = await apiGet('/dashboard?group_by=' + encodeURIComponent(groupBy));
  if (!data) return;
  
  document.getElementById('dashTotals').textContent = `Total: ${data.total.barras} barras — ${data.total.kilos.toFixed(2)} kg`;
  
  const labels = data.items.map(x => (x.grupo === null || x.grupo === '' || x.grupo === undefined) ? '(sin valor)' : x.grupo);
  const values = data.items.map(x => Number(x.kilos || 0));
  
  renderChart(labels, values, `Kilos por ${groupBy}`);
  await setGlobalStatus("Gráfico actualizado", "ok");
}

// ========================= INIT =========================
(async function init() {
  if (!token()) { window.location.href = '/ui/login'; return; }
  await loadMe();
  await loadProyectos();
  await loadFilters();
  await loadCargas();
  await loadDashboard('sector');
  await buscar(true);
})();
</script>
</body>
</html>
""")

@router.get("/ui/login", response_class=HTMLResponse)
def ui_login():
    return LOGIN_HTML.render()

@router.get("/ui/bootstrap", response_class=HTMLResponse)
def ui_bootstrap():
    if users_count() > 0:
        return HTMLResponse(
            "<h3>Bootstrap deshabilitado: ya existen usuarios.</h3><a href='/ui/login'>Volver</a>",
            status_code=403,
        )
    return BOOTSTRAP_HTML.render()

@router.get("/ui", response_class=HTMLResponse)
def ui_app():
    html = APP_HTML.render()
    return HTMLResponse(
        content=html,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )
