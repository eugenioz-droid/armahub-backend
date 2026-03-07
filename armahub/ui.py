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
      background: #1a1a1a;
      border-bottom: 3px solid #8BC34A;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .header h1 { margin: 0; color: #8BC34A; font-size: 30px; letter-spacing: 1px; }
    .user-info {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .user-badge { 
      display: inline-block;
      padding: 6px 12px; 
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 20px;
      font-size: 12px;
      color: #ccc;
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

    /* KPI Cards (Tab Inicio) */
    .kpi-row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin: 16px 0;
    }
    .kpi-card {
      flex: 1;
      min-width: 180px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 10px;
      padding: 20px;
      text-align: center;
      box-shadow: 0 2px 6px rgba(0,0,0,0.06);
      border-top: 4px solid #8BC34A;
    }
    .kpi-card .kpi-value {
      font-size: 32px;
      font-weight: 700;
      color: #8BC34A;
      margin: 4px 0;
    }
    .kpi-card .kpi-label {
      font-size: 13px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .inicio-grid {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 20px;
      margin-top: 16px;
    }
    @media (max-width: 900px) {
      .inicio-grid { grid-template-columns: 1fr; }
    }
    .proyecto-mini {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid #f0f0f0;
    }
    .proyecto-mini:last-child { border-bottom: none; }
    .proyecto-mini .pm-name { font-weight: 500; color: #2C2C2C; font-size: 14px; }
    .proyecto-mini .pm-kilos { font-weight: 700; color: #8BC34A; font-size: 14px; }
    
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
    <h1>ArmaHub</h1>
    <div class="user-info">
      <span class="user-badge" id="whoEmail">—</span>
      <span class="user-badge" id="whoRole">—</span>
      <button class="btn-logout" onclick="logout()">Salir</button>
      <img src="/static/Logo%20Banner%201.PNG" alt="ArmaCero" style="height: 40px; width: auto; margin-left: 12px;" onerror="this.style.display='none';">
    </div>
  </div>

  <!-- Global Status -->
  <div id="globalStatus" class="muted"></div>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('inicio')">🏠 Inicio</button>
    <button class="tab-btn" onclick="switchTab('obras')">📦 Mis Obras</button>
    <button class="tab-btn" onclick="switchTab('buscar')">🔍 Buscar Barras</button>
    <button class="tab-btn" onclick="switchTab('dashboards')">📊 Dashboards</button>
    <button class="tab-btn" onclick="switchTab('pedidos')">📝 Pedidos</button>
    <button class="tab-btn" onclick="switchTab('export')">📥 Exportación</button>
    <button class="tab-btn" id="adminTabBtn" onclick="switchTab('admin')" style="display:none;">⚙️ Admin</button>
  </div>

  <!-- TAB 0: INICIO (Landing) -->
  <div id="tab-inicio" class="tab-content active">
    <div class="kpi-row" id="kpiRow">
      <div class="kpi-card">
        <div class="kpi-label">Proyectos</div>
        <div class="kpi-value" id="kpiProyectos">—</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Barras totales</div>
        <div class="kpi-value" id="kpiBarras">—</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Kilos totales</div>
        <div class="kpi-value" id="kpiKilos">—</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Última carga</div>
        <div class="kpi-value" id="kpiUltimaCarga" style="font-size:18px;">—</div>
      </div>
    </div>

    <div class="inicio-grid">
      <div>
        <div class="card">
          <h3>Top 5 proyectos por kilos</h3>
          <div style="height: 280px;">
            <canvas id="inicioChart"></canvas>
          </div>
        </div>
      </div>
      <div>
        <div class="card">
          <h3>Resumen por proyecto</h3>
          <div id="proyectosMiniList">
            <div class="muted">Cargando...</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- TAB 1: MIS OBRAS -->
  <div id="tab-obras" class="tab-content">
    <div class="card">
      <h3>Cargar datos de obra</h3>
      <div id="dropZone" style="border: 2px dashed #8BC34A; border-radius: 10px; padding: 30px; text-align: center; background: #f9fff4; cursor: pointer; transition: all 0.2s; margin-bottom: 12px;"
           ondragover="event.preventDefault(); this.style.background='#e8f5e9'; this.style.borderColor='#558B2F';"
           ondragleave="this.style.background='#f9fff4'; this.style.borderColor='#8BC34A';"
           ondrop="handleDrop(event)"
           onclick="document.getElementById('csvFile').click()">
        <div style="font-size: 36px; margin-bottom: 8px;">📂</div>
        <div style="font-size: 15px; font-weight: 500; color: #2C2C2C;">Arrastra archivos CSV aquí o haz clic para seleccionar</div>
        <div class="muted" style="margin-top: 4px;">Puedes seleccionar múltiples archivos a la vez</div>
        <div class="muted" style="margin-top: 4px; color: #ff9800;">Re-importar un archivo actualiza los datos existentes (no duplica)</div>
      </div>
      <input type="file" id="csvFile" accept=".csv,.txt" multiple style="display: none;" onchange="handleFileSelect(this.files)" />
      <div id="fileList" style="margin: 8px 0;"></div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button id="importBtn" onclick="importAllFiles()" disabled style="opacity: 0.5;">📤 Importar archivos</button>
        <button class="secondary" id="clearBtn" onclick="clearFiles()" style="display: none;">Limpiar</button>
        <span id="importProgress" class="muted"></span>
      </div>
      <div id="importResults" style="margin-top: 12px;"></div>
    </div>

    <div class="card">
      <h3>Últimas cargas</h3>
      <div id="cargasRecientes">
        <div class="muted">Cargando...</div>
      </div>
    </div>

    <div class="card">
      <h3>Mis proyectos</h3>
      <div id="proyectosContainer" style="min-height: 200px;">
        <div class="muted">Cargando...</div>
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

    <div class="card">
      <h3>Sectores constructivos (sector + piso + ciclo)</h3>
      <div class="row" style="margin-bottom: 12px;">
        <select id="sectorProyectoFilter" onchange="loadSectores()">
          <option value="">Todos los proyectos</option>
        </select>
      </div>
      <div id="sectoresTotals" class="muted" style="margin-bottom: 8px;"></div>
      <div style="overflow-x: auto; max-height: 400px;">
        <table id="sectoresTable" style="width: 100%;">
          <thead>
            <tr>
              <th>Sector constructivo</th>
              <th style="text-align:right;">Barras</th>
              <th style="text-align:right;">Kilos</th>
            </tr>
          </thead>
          <tbody id="sectoresBody">
            <tr><td colspan="3" class="muted">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
      <div style="height: 320px; margin-top: 16px;">
        <canvas id="sectoresChart"></canvas>
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

  <!-- TAB 6: ADMIN (solo visible para admin) -->
  <div id="tab-admin" class="tab-content">
    <div class="card">
      <h3>Estado de la base de datos</h3>
      <div id="dbInfoContainer">
        <div class="muted">Cargando...</div>
      </div>
      <button onclick="loadDbInfo()" class="secondary" style="margin-top: 12px;">Actualizar info</button>
    </div>

    <div class="card" style="border-left: 4px solid #b42318;">
      <h3 style="color: #b42318;">Resetear base de datos</h3>
      <p class="muted">Elimina todas las barras y proyectos. Los usuarios se mantienen.</p>
      <div class="row">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="resetKeepUsers" checked>
          Mantener usuarios
        </label>
      </div>
      <div class="row">
        <input id="resetConfirm" placeholder="Escribe CONFIRMAR para habilitar" style="max-width: 300px;" />
        <button class="danger" onclick="resetDatabase()">Resetear BD</button>
      </div>
      <div id="resetMsg" class="muted" style="margin-top: 8px;"></div>
    </div>

    <div class="card">
      <h3>Gestión de usuarios</h3>
      <div class="row">
        <input id="newUserEmail" placeholder="Email" style="max-width: 250px;" />
        <input id="newUserPassword" type="password" placeholder="Contraseña" style="max-width: 200px;" />
        <select id="newUserRole" style="max-width: 150px;">
          <option value="operador">Operador</option>
          <option value="admin">Admin</option>
        </select>
        <button onclick="createUser()">Crear usuario</button>
      </div>
      <div id="createUserMsg" class="muted" style="margin-top: 8px;"></div>
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
  // Find the button that triggered the switch
  const btns = document.querySelectorAll('.tab-btn');
  btns.forEach(b => { if (b.textContent.includes(tabName === 'inicio' ? 'Inicio' : tabName === 'obras' ? 'Mis Obras' : tabName === 'buscar' ? 'Buscar' : tabName === 'dashboards' ? 'Dashboards' : tabName === 'pedidos' ? 'Pedidos' : tabName === 'export' ? 'Exportación' : 'Admin')) b.classList.add('active'); });
}

// ========================= INIT =========================
async function loadMe() {
  const me = await apiGet('/me');
  if (!me) return;
  document.getElementById('whoEmail').textContent = me.email;
  document.getElementById('whoRole').textContent = "Rol: " + me.role;
  if (me.role === 'admin') {
    document.getElementById('adminTabBtn').style.display = '';
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

  // Populate sector constructivo project filter
  const spf = document.getElementById('sectorProyectoFilter');
  const prev = spf.value;
  spf.innerHTML = '<option value="">Todos los proyectos</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prev) spf.value = prev;
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

// ========================= MULTI-FILE IMPORT =========================
let pendingFiles = [];

function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.style.background = '#f9fff4';
  e.currentTarget.style.borderColor = '#8BC34A';
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv') || f.name.endsWith('.txt'));
  if (files.length === 0) { alert('Solo se aceptan archivos CSV (.csv o .txt)'); return; }
  addFiles(files);
}

function handleFileSelect(fileList) {
  addFiles(Array.from(fileList));
}

function addFiles(files) {
  files.forEach(f => {
    if (!pendingFiles.find(p => p.name === f.name && p.size === f.size)) {
      pendingFiles.push(f);
    }
  });
  renderFileList();
}

function renderFileList() {
  const el = document.getElementById('fileList');
  const btn = document.getElementById('importBtn');
  const clearBtn = document.getElementById('clearBtn');
  if (pendingFiles.length === 0) {
    el.innerHTML = '';
    btn.disabled = true; btn.style.opacity = '0.5';
    clearBtn.style.display = 'none';
    return;
  }
  btn.disabled = false; btn.style.opacity = '1';
  clearBtn.style.display = '';
  el.innerHTML = pendingFiles.map((f, i) => `
    <div style="display:flex; align-items:center; gap:8px; padding:4px 8px; background:#f5f5f5; border-radius:4px; margin:4px 0; font-size:13px;">
      <span>📄 ${f.name}</span>
      <span class="muted">(${(f.size/1024).toFixed(1)} KB)</span>
      <button class="secondary" style="padding:2px 8px; font-size:11px;" onclick="removeFile(${i})">✕</button>
    </div>
  `).join('');
}

function removeFile(idx) {
  pendingFiles.splice(idx, 1);
  renderFileList();
}

function clearFiles() {
  pendingFiles = [];
  document.getElementById('csvFile').value = '';
  document.getElementById('importResults').innerHTML = '';
  document.getElementById('importProgress').textContent = '';
  renderFileList();
}

async function importAllFiles() {
  if (pendingFiles.length === 0) return;
  const btn = document.getElementById('importBtn');
  const progress = document.getElementById('importProgress');
  const results = document.getElementById('importResults');
  btn.disabled = true; btn.style.opacity = '0.5';
  results.innerHTML = '';
  const total = pendingFiles.length;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < total; i++) {
    const f = pendingFiles[i];
    progress.textContent = `Importando ${i+1} de ${total}: ${f.name}...`;
    await setGlobalStatus(`Importando archivo ${i+1}/${total}...`, 'warn');

    const data = await apiPostFile('/import/armadetailer', f);

    if (!data) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: sesión expirada</div>`;
      errorCount++;
      continue;
    }
    if (data.ok === false) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: ${data.error || 'Error desconocido'}</div>`;
      errorCount++;
      continue;
    }

    const kilosText = data.kilos ? ` — ${Math.round(data.kilos).toLocaleString()} kg` : '';
    results.innerHTML += `<div class="status-ok" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data.rows_upserted} barras (${data.proyecto})${kilosText}</div>`;
    successCount++;
  }

  progress.textContent = `Listo: ${successCount} exitosos, ${errorCount} con error`;
  await setGlobalStatus(`Importación completa: ${successCount}/${total} archivos`, successCount === total ? 'ok' : 'warn');

  pendingFiles = [];
  document.getElementById('csvFile').value = '';
  renderFileList();

  await loadCargas();
  await loadProyectos();
  await loadFilters();
  await loadInicio();
  await loadDashboard('sector');
}

// ========================= CARGAS RECIENTES =========================
async function loadCargas() {
  const container = document.getElementById('cargasRecientes');
  const data = await apiGet('/cargas/recientes?limit=5');
  if (!data) { container.innerHTML = '<div class="muted">Error cargando historial</div>'; return; }
  if (!data.cargas || data.cargas.length === 0) {
    container.innerHTML = '<div class="muted">No hay cargas registradas</div>';
    return;
  }
  container.innerHTML = `
    <table style="width:100%;">
      <thead><tr>
        <th>Proyecto</th><th>Archivo</th><th>Barras</th><th>Kilos</th><th>Usuario</th><th>Fecha</th>
      </tr></thead>
      <tbody>${data.cargas.map(c => {
        let fecha = '';
        if (c.fecha) {
          const d = new Date(c.fecha);
          fecha = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
        }
        return `<tr>
          <td><strong>${c.nombre_proyecto || c.id_proyecto}</strong></td>
          <td class="muted">${c.archivo || '-'}</td>
          <td>${c.barras_count}</td>
          <td>${Math.round(c.kilos || 0).toLocaleString()} kg</td>
          <td class="muted">${c.usuario}</td>
          <td class="muted">${fecha}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  `;
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

// ========================= SECTORES CONSTRUCTIVOS =========================
let sectoresChart = null;

async function loadSectores() {
  const sel = document.getElementById('sectorProyectoFilter');
  const proy = sel.value;
  let url = '/dashboard/sectores';
  if (proy) url += '?proyecto=' + encodeURIComponent(proy);

  const data = await apiGet(url);
  if (!data) return;

  const tbody = document.getElementById('sectoresBody');
  const totals = document.getElementById('sectoresTotals');

  if (!data.items || data.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Sin datos de sectores</td></tr>';
    totals.textContent = '';
    if (sectoresChart) { sectoresChart.destroy(); sectoresChart = null; }
    return;
  }

  const totalBarras = data.items.reduce((s, i) => s + i.barras, 0);
  const totalKilos = data.items.reduce((s, i) => s + i.kilos, 0);
  totals.textContent = `${data.items.length} sectores — ${totalBarras.toLocaleString()} barras — ${Math.round(totalKilos).toLocaleString()} kg`;

  tbody.innerHTML = data.items.map(i => `
    <tr>
      <td><strong>${i.sector_constructivo}</strong></td>
      <td style="text-align:right;">${i.barras.toLocaleString()}</td>
      <td style="text-align:right;">${Math.round(i.kilos).toLocaleString()} kg</td>
    </tr>
  `).join('');

  // Chart
  const labels = data.items.map(i => i.sector_constructivo);
  const kilosData = data.items.map(i => i.kilos);
  const barrasData = data.items.map(i => i.barras);
  const ctx = document.getElementById('sectoresChart').getContext('2d');
  if (sectoresChart) sectoresChart.destroy();
  sectoresChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Kilos', data: kilosData, backgroundColor: '#8BC34A', borderRadius: 3, yAxisID: 'y' },
        { label: 'Barras', data: barrasData, backgroundColor: '#42A5F5', borderRadius: 3, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { type: 'linear', position: 'left', title: { display: true, text: 'Kilos' }, ticks: { callback: v => v.toLocaleString() } },
        y1: { type: 'linear', position: 'right', title: { display: true, text: 'Barras' }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

// ========================= INICIO (Landing) =========================
let inicioChart = null;

async function loadInicio() {
  const data = await apiGet('/stats');
  if (!data) return;

  document.getElementById('kpiProyectos').textContent = data.total_proyectos;
  document.getElementById('kpiBarras').textContent = data.total_barras.toLocaleString();
  document.getElementById('kpiKilos').textContent = Math.round(data.total_kilos).toLocaleString() + ' kg';
  
  if (data.ultima_carga) {
    const d = new Date(data.ultima_carga);
    document.getElementById('kpiUltimaCarga').textContent = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
  } else {
    document.getElementById('kpiUltimaCarga').textContent = 'Sin cargas';
  }

  // Top 5 chart
  const top5 = data.top5 || [];
  const labels = top5.map(p => p.nombre);
  const values = top5.map(p => p.kilos);
  const ctx = document.getElementById('inicioChart').getContext('2d');
  if (inicioChart) inicioChart.destroy();
  inicioChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Kilos', data: values, backgroundColor: '#8BC34A', borderRadius: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: v => v.toLocaleString() + ' kg' } } }
    }
  });

  // Project mini-cards
  const list = document.getElementById('proyectosMiniList');
  if (!data.proyectos || data.proyectos.length === 0) {
    list.innerHTML = '<div class="muted" style="padding:12px;">No hay proyectos cargados</div>';
    return;
  }
  list.innerHTML = data.proyectos.map(p => `
    <div class="proyecto-mini">
      <span class="pm-name">${p.nombre}</span>
      <span class="pm-kilos">${Math.round(p.kilos).toLocaleString()} kg</span>
    </div>
  `).join('');
}

// ========================= ADMIN =========================
async function loadDbInfo() {
  const data = await apiGet('/admin/db-info');
  if (!data) return;
  document.getElementById('dbInfoContainer').innerHTML = `
    <div class="row">
      <div class="card" style="flex:1; text-align:center; margin:4px;">
        <div style="font-size:28px; font-weight:bold; color:#8BC34A;">${data.barras}</div>
        <div class="muted">Barras</div>
      </div>
      <div class="card" style="flex:1; text-align:center; margin:4px;">
        <div style="font-size:28px; font-weight:bold; color:#8BC34A;">${data.proyectos}</div>
        <div class="muted">Proyectos</div>
      </div>
      <div class="card" style="flex:1; text-align:center; margin:4px;">
        <div style="font-size:28px; font-weight:bold; color:#8BC34A;">${data.usuarios}</div>
        <div class="muted">Usuarios</div>
      </div>
      <div class="card" style="flex:1; text-align:center; margin:4px;">
        <div style="font-size:28px; font-weight:bold; color:#8BC34A;">${data.kilos_totales.toFixed(0)}</div>
        <div class="muted">Kilos totales</div>
      </div>
    </div>
  `;
}

async function resetDatabase() {
  const confirm = document.getElementById('resetConfirm').value.trim();
  const keepUsers = document.getElementById('resetKeepUsers').checked;
  const msg = document.getElementById('resetMsg');

  if (confirm !== 'CONFIRMAR') {
    msg.textContent = 'Debes escribir CONFIRMAR para ejecutar el reset.';
    msg.className = 'status-err';
    return;
  }

  if (!window.confirm('¿Estás seguro? Esta acción eliminará TODOS los datos de barras y proyectos.')) {
    return;
  }

  msg.textContent = 'Reseteando...';
  msg.className = 'status-warn';

  const params = new URLSearchParams({ confirm: 'CONFIRMAR', keep_users: keepUsers });
  const res = await fetch('/admin/reset-db?' + params.toString(), {
    method: 'POST',
    headers: authHeaders()
  });
  const data = await res.json();

  if (!res.ok) {
    msg.textContent = 'Error: ' + (data.detail || JSON.stringify(data));
    msg.className = 'status-err';
    return;
  }

  const r = data.reset;
  msg.textContent = `Reset completo. Eliminadas: ${r.barras_eliminadas} barras, ${r.proyectos_eliminados} proyectos.`;
  msg.className = 'status-ok';
  document.getElementById('resetConfirm').value = '';

  await loadDbInfo();
  await loadProyectos();
  await loadFilters();
  await loadDashboard('sector');
}

async function createUser() {
  const email = document.getElementById('newUserEmail').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;
  const msg = document.getElementById('createUserMsg');

  if (!email || !password) {
    msg.textContent = 'Email y contraseña son requeridos.';
    msg.className = 'status-err';
    return;
  }

  const params = new URLSearchParams({ email, password, role });
  const res = await fetch('/auth/register?' + params.toString(), {
    method: 'POST',
    headers: authHeaders()
  });
  const data = await res.json();

  if (!res.ok) {
    msg.textContent = 'Error: ' + (data.detail || JSON.stringify(data));
    msg.className = 'status-err';
    return;
  }

  msg.textContent = `Usuario ${email} (${role}) creado exitosamente.`;
  msg.className = 'status-ok';
  document.getElementById('newUserEmail').value = '';
  document.getElementById('newUserPassword').value = '';
}

// ========================= INIT =========================
(async function init() {
  if (!token()) { window.location.href = '/ui/login'; return; }
  await loadMe();
  await loadInicio();
  await loadProyectos();
  await loadFilters();
  await loadCargas();
  await loadDashboard('sector');
  await loadSectores();
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
