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
    .tab-content { display: none; padding: 20px; max-width: 1600px; margin: 0 auto; }
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
    <button class="tab-btn" onclick="switchTab('buscar')">🔍 Admin Data</button>
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
    <div class="kpi-row" style="margin-top: 8px;">
      <div class="kpi-card" style="border-top: 3px solid #8BC34A;">
        <div class="kpi-label">PPB (Peso Prom. Barra)</div>
        <div class="kpi-value" id="kpiPPB" style="font-size:20px;">—</div>
      </div>
      <div class="kpi-card" style="border-top: 3px solid #558B2F;">
        <div class="kpi-label">PPI (Peso Prom. Item)</div>
        <div class="kpi-value" id="kpiPPI" style="font-size:20px;">—</div>
      </div>
      <div class="kpi-card" style="border-top: 3px solid #33691E;">
        <div class="kpi-label">Diámetro Promedio</div>
        <div class="kpi-value" id="kpiDiam" style="font-size:20px;">—</div>
      </div>
      <div class="kpi-card" style="border-top: 3px solid #9E9E9E;">
        <div class="kpi-label">Items únicos</div>
        <div class="kpi-value" id="kpiItems">—</div>
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
      <h3>Crear obra manualmente</h3>
      <div class="row" style="gap: 8px; align-items: flex-end;">
        <div class="col">
          <label style="font-size: 12px; color: #666;">Nombre de la obra</label>
          <input type="text" id="newObraName" placeholder="Ej: Edificio Central - Torre A" style="width: 100%;" />
        </div>
        <div class="col" style="max-width:220px;">
          <label style="font-size: 12px; color: #666;">Calculista (opcional)</label>
          <input type="text" id="newObraCalculista" placeholder="Nombre calculista" style="width: 100%;" />
        </div>
        <div>
          <button onclick="crearObra()">+ Crear obra</button>
        </div>
      </div>
      <div id="crearObraMsg" style="margin-top: 8px;"></div>
    </div>

    <div class="card">
      <h3>Mis proyectos</h3>
      <div id="proyectosContainer" style="min-height: 200px;">
        <div class="muted">Cargando...</div>
      </div>
    </div>

    <div class="card" id="moverBarrasCard" style="display: none;">
      <h3>Mover barras entre proyectos</h3>
      <div class="row" style="gap: 8px; align-items: flex-end; flex-wrap: wrap;">
        <div class="col">
          <label style="font-size: 12px; color: #666;">Origen</label>
          <select id="moverOrigen"></select>
        </div>
        <div class="col">
          <label style="font-size: 12px; color: #666;">Destino</label>
          <select id="moverDestino"></select>
        </div>
        <div class="col">
          <label style="font-size: 12px; color: #666;">Sector (opcional)</label>
          <input type="text" id="moverSector" placeholder="Ej: ELEV" />
        </div>
        <div class="col">
          <label style="font-size: 12px; color: #666;">Piso (opcional)</label>
          <input type="text" id="moverPiso" placeholder="Ej: P1" />
        </div>
        <div class="col">
          <label style="font-size: 12px; color: #666;">Ciclo (opcional)</label>
          <input type="text" id="moverCiclo" placeholder="Ej: C1" />
        </div>
      </div>
      <div style="margin-top: 8px;">
        <button onclick="moverBarras()">Mover barras</button>
      </div>
      <div id="moverBarrasMsg" style="margin-top: 8px;"></div>
    </div>
  </div>

  <!-- TAB 2: ADMINISTRADOR DE DATA -->
  <div id="tab-buscar" class="tab-content">
    <div class="card">
      <h3>Administrador de Data</h3>
      <div class="row" style="gap:8px; align-items:flex-end;">
        <div class="col" style="position:relative; flex:2;">
          <label style="font-size:11px; color:#666; font-weight:600;">Proyecto *</label>
          <div style="position:relative;">
            <span style="position:absolute; left:8px; top:50%; transform:translateY(-50%); font-size:14px; color:#999; pointer-events:none;">🔍</span>
            <input type="text" id="proyectoSearchInput" placeholder="Buscar proyecto..." oninput="filterProjectSelect('proyectoSearchInput','proyecto')" style="padding-left:30px; width:100%; font-size:13px; margin-bottom:4px;" />
          </div>
          <select id="proyecto" onchange="onProyectoChange()">
            <option value="">-- Selecciona proyecto --</option>
          </select>
        </div>
        <div class="col">
          <label style="font-size:11px; color:#666;">Plano</label>
          <select id="plano" onchange="onFilterChange()">
            <option value="">Todos</option>
          </select>
        </div>
        <div class="col">
          <label style="font-size:11px; color:#666;">Sector</label>
          <select id="sector" onchange="onFilterChange()">
            <option value="">Todos</option>
          </select>
        </div>
        <div class="col">
          <label style="font-size:11px; color:#666;">Piso</label>
          <select id="piso" onchange="onFilterChange()">
            <option value="">Todos</option>
          </select>
        </div>
        <div class="col">
          <label style="font-size:11px; color:#666;">Ciclo</label>
          <select id="ciclo" onchange="onFilterChange()">
            <option value="">Todos</option>
          </select>
        </div>
      </div>

      <div class="row" style="gap:8px; margin-top:8px; align-items:flex-end;">
        <div class="col" style="flex:2;">
          <input id="q" placeholder="Buscar por ID, Eje..." onkeyup="if(event.key==='Enter') buscar(true)" style="font-size:13px;" />
        </div>
        <div class="col">
          <select id="order_by" onchange="buscar(true)" style="font-size:12px;">
            <option value="sector">Orden: Sector</option>
            <option value="piso">Orden: Piso</option>
            <option value="ciclo">Orden: Ciclo</option>
            <option value="eje">Orden: Eje</option>
            <option value="diam">Orden: \u03c6</option>
            <option value="peso_total">Orden: Peso</option>
            <option value="cant_total">Orden: Cantidad</option>
            <option value="largo_total">Orden: Largo</option>
            <option value="id_unico">Orden: ID</option>
          </select>
        </div>
        <div class="col" style="flex:0;">
          <select id="order_dir" onchange="buscar(true)" style="font-size:12px;">
            <option value="asc">ASC</option>
            <option value="desc">DESC</option>
          </select>
        </div>
        <button onclick="buscar(true)" style="font-size:12px; padding:6px 14px;">🔍 Buscar</button>
        <button class="secondary" onclick="resetFiltros()" style="font-size:12px; padding:6px 14px;">Limpiar</button>
      </div>
    </div>

    <!-- TOOLBAR ACCIONES SELECCIONADAS -->
    <div id="barrasToolbar" class="card" style="display:none; background:#f9fff4; border:1px solid #8BC34A; padding:10px 16px;">
      <div class="row" style="gap:10px; align-items:center; flex-wrap:wrap;">
        <strong id="selectedCount" style="font-size:13px;">0 seleccionadas</strong>
        <select id="accionDestProyecto" style="font-size:12px; max-width:200px;">
          <option value="">Mover a proyecto...</option>
        </select>
        <button onclick="accionMoverProyecto()" style="font-size:12px; padding:4px 12px;">Mover proyecto</button>
        <select id="accionSector" style="font-size:12px; max-width:140px;">
          <option value="">Cambiar sector...</option>
          <option value="FUND">FUND</option>
          <option value="ELEV">ELEV</option>
          <option value="LCIELO">LCIELO</option>
          <option value="VCIELO">VCIELO</option>
        </select>
        <button onclick="accionCambiarSector()" style="font-size:12px; padding:4px 12px;">Cambiar sector</button>
        <button class="secondary" onclick="clearSeleccion()" style="font-size:11px; padding:4px 10px;">Deseleccionar</button>
      </div>
    </div>

    <div class="card" style="padding:8px 16px;">
      <div class="muted" id="count" style="margin-bottom:6px;"></div>
      <div style="overflow-x: auto;">
        <table id="tabla" style="font-size:12px; white-space:nowrap;">
          <thead></thead>
          <tbody></tbody>
        </table>
      </div>

      <div class="row" style="justify-content: center; margin-top: 12px; gap:8px;">
        <button onclick="prevPage()" style="font-size:12px; padding:4px 14px;">◀ Anterior</button>
        <span class="muted" id="pageInfo" style="font-size:12px;"></span>
        <button onclick="nextPage()" style="font-size:12px; padding:4px 14px;">Siguiente ▶</button>
      </div>
    </div>
  </div>

  <!-- TAB 3: DASHBOARDS -->
  <div id="tab-dashboards" class="tab-content">
    <div style="display:flex; gap:16px; align-items:flex-start;">
      <!-- COLUMNA IZQUIERDA (60%) — Resumen + Gráficos + Sectores -->
      <div style="flex:3; min-width:0;">
        <div class="card">
          <h3>Resumen general</h3>
          <div id="generalStats">
            <div class="muted">Cargando...</div>
          </div>
        </div>

        <div class="card">
          <h3>Gráficos por dimensión</h3>
          <div class="row" style="flex-wrap:wrap; gap:4px;">
            <button onclick="loadDashboard('sector')" style="font-size:12px; padding:4px 10px;">Sector</button>
            <button onclick="loadDashboard('piso')" style="font-size:12px; padding:4px 10px;">Piso</button>
            <button onclick="loadDashboard('ciclo')" style="font-size:12px; padding:4px 10px;">Ciclo</button>
            <button onclick="loadDashboard('plano_code')" style="font-size:12px; padding:4px 10px;">Plano</button>
            <button onclick="loadDashboard('id_proyecto')" style="font-size:12px; padding:4px 10px;">Proyecto</button>
            <button onclick="loadDashboard('eje')" style="font-size:12px; padding:4px 10px;">Eje</button>
          </div>
          <div id="dashTotals" class="muted" style="margin: 8px 0;"></div>
          <div style="height: 320px; margin-top: 8px;">
            <canvas id="dashChart"></canvas>
          </div>
        </div>

        <div class="card">
          <h3>Sectores constructivos</h3>
          <div class="row" style="margin-bottom: 8px; gap: 6px; align-items: center;">
            <div style="position:relative; flex:1; max-width:220px;">
              <span style="position:absolute; left:8px; top:50%; transform:translateY(-50%); font-size:14px; color:#999; pointer-events:none;">🔍</span>
              <input type="text" id="sectorSearchInput" placeholder="Buscar proyecto..." oninput="filterProjectSelect('sectorSearchInput','sectorProyectoFilter')" style="padding-left:28px; width:100%; font-size:12px;" />
            </div>
            <select id="sectorProyectoFilter" onchange="loadSectores()" style="flex:1; font-size:12px;">
              <option value="">Todos los proyectos</option>
            </select>
          </div>
          <div id="sectoresTotals" class="muted" style="margin-bottom: 6px; font-size:12px;"></div>
          <div style="overflow-x: auto; max-height: 350px;">
            <table id="sectoresTable" style="width: 100%; font-size:12px;">
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
          <div style="height: 280px; margin-top: 12px;">
            <canvas id="sectoresChart"></canvas>
          </div>
        </div>
      </div>

      <!-- COLUMNA DERECHA (40%) — Matriz constructiva (sticky) -->
      <div style="flex:2; min-width:0; position:sticky; top:16px; align-self:flex-start;">
        <div class="card">
          <h3>Matriz constructiva</h3>
          <div class="row" style="margin-bottom: 8px; gap: 6px; align-items: center;">
            <div style="position:relative; flex:1;">
              <span style="position:absolute; left:8px; top:50%; transform:translateY(-50%); font-size:14px; color:#999; pointer-events:none;">🔍</span>
              <input type="text" id="matrizSearchInput" placeholder="Buscar proyecto..." oninput="filterProjectSelect('matrizSearchInput','matrizProyectoFilter')" style="padding-left:28px; width:100%; font-size:13px;" />
            </div>
            <select id="matrizProyectoFilter" onchange="loadMatriz()" style="flex:1; font-size:12px;">
              <option value="">— Selecciona proyecto —</option>
            </select>
          </div>
          <div id="matrizContainer" style="overflow-x: auto; overflow-y: auto; max-height:70vh;">
            <div class="muted">Selecciona un proyecto para ver la matriz constructiva</div>
          </div>
        </div>
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

  <!-- TAB 5: EXPORTACIÓN -->
  <div id="tab-export" class="tab-content">
    <div class="card">
      <h3>Exportar a producción (aSa Studio)</h3>
      <p class="muted" style="margin-bottom:12px;">Genera un ZIP con un archivo Excel por cada combinación SECTOR + PISO + CICLO.</p>
      <div class="row" style="gap:8px; align-items:flex-end;">
        <div class="col" style="flex:2; position:relative;">
          <label style="font-size:11px; color:#666; font-weight:600;">Proyecto *</label>
          <div style="position:relative;">
            <span style="position:absolute; left:8px; top:50%; transform:translateY(-50%); font-size:14px; color:#999; pointer-events:none;">🔍</span>
            <input type="text" id="exportProyectoSearch" placeholder="Buscar proyecto..." oninput="filterProjectSelect('exportProyectoSearch','exportProyecto')" style="padding-left:30px; width:100%; font-size:13px; margin-bottom:4px;" />
          </div>
          <select id="exportProyecto" onchange="previewExport()">
            <option value="">-- Selecciona proyecto --</option>
          </select>
        </div>
        <button onclick="descargarExport()" style="font-size:13px; padding:8px 20px;">📥 Descargar ZIP</button>
      </div>
      <div id="exportPreview" style="margin-top:16px;"></div>
      <div id="exportStatus" class="muted" style="margin-top:8px;"></div>
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

  <!-- MODAL: Nuevo proyecto detectado al importar -->
  <div id="newProjectModal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:9999; align-items:center; justify-content:center;">
    <div style="background:#fff; border-radius:12px; padding:24px; max-width:420px; width:90%; box-shadow:0 8px 32px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 4px 0; color:#1a1a1a;">Nuevo proyecto detectado</h3>
      <p id="newProjMsg" class="muted" style="margin:0 0 16px 0; font-size:13px;"></p>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px; color:#666; display:block; margin-bottom:4px;">Nombre del proyecto</label>
        <input type="text" id="newProjNombre" readonly style="width:100%; background:#f5f5f5; font-size:13px;" />
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px; color:#666; display:block; margin-bottom:4px;">Calculista</label>
        <input type="text" id="newProjCalculista" placeholder="Nombre del calculista (opcional)" style="width:100%; font-size:13px;" />
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px; color:#666; display:block; margin-bottom:4px;">Dueño del proyecto</label>
        <select id="newProjOwner" style="width:100%; font-size:13px;">
          <option value="">Cargando usuarios...</option>
        </select>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
        <button class="secondary" onclick="closeNewProjectModal(false)" style="padding:8px 16px;">Cancelar</button>
        <button onclick="closeNewProjectModal(true)" style="padding:8px 16px;">Crear y continuar</button>
      </div>
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

async function apiPostJson(url, body) {
  const h = authHeaders();
  h['Content-Type'] = 'application/json';
  const res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
  if (res.status === 401) { logout(); return null; }
  return await res.json();
}

async function apiDelete(url) {
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) { logout(); return null; }
  return await res.json();
}

// ========================= NEW PROJECT MODAL =========================
let _newProjResolve = null;

async function openNewProjectModal(data) {
  document.getElementById('newProjMsg').textContent = data.mensaje || '';
  document.getElementById('newProjNombre').value = data.proyecto_nombre || '';
  document.getElementById('newProjCalculista').value = '';

  // Load users for owner select
  const sel = document.getElementById('newProjOwner');
  sel.innerHTML = '<option value="">Cargando...</option>';
  const usersData = await apiGet('/users/list');
  if (usersData && usersData.users) {
    const me = localStorage.getItem('armahub_email') || '';
    sel.innerHTML = usersData.users.map(u =>
      `<option value="${u.id}" ${u.email === me ? 'selected' : ''}>${u.email} (${u.role})</option>`
    ).join('');
  }

  const modal = document.getElementById('newProjectModal');
  modal.style.display = 'flex';

  return new Promise(resolve => { _newProjResolve = resolve; });
}

function closeNewProjectModal(confirmed) {
  document.getElementById('newProjectModal').style.display = 'none';
  if (_newProjResolve) {
    if (confirmed) {
      _newProjResolve({
        confirmed: true,
        calculista: document.getElementById('newProjCalculista').value.trim(),
      });
    } else {
      _newProjResolve({ confirmed: false });
    }
    _newProjResolve = null;
  }
}

// ========================= UI =========================
async function setGlobalStatus(text, kind = 'info') {
  const el = document.getElementById('globalStatus');
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : kind === 'warn' ? 'status-warn' : 'muted';
  el.textContent = text || '';
}

// Typeahead filter: filters <select> options by text typed in a search input
function filterProjectSelect(inputId, selectId) {
  const q = document.getElementById(inputId).value.toLowerCase().trim();
  const sel = document.getElementById(selectId);
  for (let i = 0; i < sel.options.length; i++) {
    const opt = sel.options[i];
    if (i === 0) { opt.style.display = ''; continue; } // always show first (placeholder)
    opt.style.display = opt.textContent.toLowerCase().includes(q) ? '' : 'none';
  }
  // If current selection is hidden, reset to first option
  if (sel.selectedIndex > 0 && sel.options[sel.selectedIndex].style.display === 'none') {
    sel.selectedIndex = 0;
  }
  // If only one visible option (besides placeholder), auto-select it
  const visible = Array.from(sel.options).filter((o, i) => i > 0 && o.style.display !== 'none');
  if (visible.length === 1) {
    visible[0].selected = true;
    sel.dispatchEvent(new Event('change'));
  }
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
  localStorage.setItem('armahub_email', me.email);
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
  
  container.innerHTML = data.proyectos.map(p => {
    const ownerText = p.owner_email ? p.owner_email : '(sin dueño)';
    const calcText = p.calculista ? p.calculista : '';
    return `
    <div class="card" style="margin: 12px 0; padding: 16px; border-left: 4px solid #8BC34A;">
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <h4 style="margin: 0 0 6px 0;" id="pname-${p.id_proyecto}">${p.nombre_proyecto}</h4>
          <div class="muted" style="margin-bottom:4px;">
            <span class="badge">${p.total_kilos.toFixed(0)} kg</span>
            <span class="badge">${p.total_barras} barras</span>
            <span class="muted" style="font-size:11px; margin-left:8px;">ID: ${p.id_proyecto}</span>
          </div>
          <div style="font-size:11px; color:#666;">
            <span>👤 ${ownerText}</span>
            ${calcText ? '<span style="margin-left:10px;">📐 Calculista: ' + calcText + '</span>' : ''}
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="secondary" style="font-size:12px; padding:4px 10px;" onclick="toggleCargasProyecto('${p.id_proyecto}')">Cargas</button>
          <button class="secondary" style="font-size:12px; padding:4px 10px;" onclick="toggleAutorizados('${p.id_proyecto}')">Usuarios</button>
          <button class="secondary" style="font-size:12px; padding:4px 10px;" onclick="editarObra('${p.id_proyecto}', '${p.nombre_proyecto.replace(/'/g, "\\'")}')">Renombrar</button>
          <button class="secondary" style="font-size:12px; padding:4px 10px; color:#b42318; border-color:#b42318;" onclick="eliminarObra('${p.id_proyecto}', '${p.nombre_proyecto.replace(/'/g, "\\'")}', ${p.total_barras})">Eliminar</button>
        </div>
      </div>
      <div id="cargas-${p.id_proyecto}" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid #eee;">
        <div style="font-size:12px; font-weight:bold; margin-bottom:6px;">Historial de cargas</div>
        <div id="cargas-list-${p.id_proyecto}" class="muted" style="font-size:12px;">Cargando...</div>
      </div>
      <div id="autorizados-${p.id_proyecto}" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid #eee;">
        <div style="font-size:12px; font-weight:bold; margin-bottom:6px;">Usuarios autorizados</div>
        <div id="autorizados-list-${p.id_proyecto}" class="muted" style="font-size:12px;">Cargando...</div>
        <div style="display:flex; gap:6px; align-items:center; margin-top:8px;">
          <select id="autorizar-user-${p.id_proyecto}" style="font-size:12px; flex:1;"><option>Cargando...</option></select>
          <button class="secondary" style="font-size:11px; padding:3px 8px;" onclick="autorizarUsuario('${p.id_proyecto}')">+ Autorizar</button>
        </div>
      </div>
    </div>
  `}).join('');

  // Populate sector constructivo project filter
  const spf = document.getElementById('sectorProyectoFilter');
  const prev = spf.value;
  spf.innerHTML = '<option value="">Todos los proyectos</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prev) spf.value = prev;

  // Populate matriz constructiva project filter
  const mpf = document.getElementById('matrizProyectoFilter');
  const prevM = mpf.value;
  mpf.innerHTML = '<option value="">\u2014 Selecciona un proyecto \u2014</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prevM) mpf.value = prevM;

  // Populate mover barras selectors & show card if >1 project
  const opts = data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  document.getElementById('moverOrigen').innerHTML = opts;
  document.getElementById('moverDestino').innerHTML = opts;
  document.getElementById('moverBarrasCard').style.display = data.proyectos.length > 1 ? '' : 'none';
}

// ========================= ADMIN OBRAS =========================
async function crearObra() {
  const name = document.getElementById('newObraName').value.trim();
  const calc = document.getElementById('newObraCalculista').value.trim();
  const msg = document.getElementById('crearObraMsg');
  if (!name) { msg.innerHTML = '<span class="status-err">Ingresa un nombre para la obra</span>'; return; }
  msg.innerHTML = '<span class="muted">Creando...</span>';
  const body = { nombre_proyecto: name };
  if (calc) body.calculista = calc;
  const res = await fetch('/proyectos', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    msg.innerHTML = '<span class="status-ok">Obra creada: ' + data.nombre_proyecto + ' (ID: ' + data.id_proyecto + ')</span>';
    document.getElementById('newObraName').value = '';
    document.getElementById('newObraCalculista').value = '';
    await loadProyectos();
    await loadFilters();
    await loadInicio();
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (data.detail || data.error || 'desconocido') + '</span>';
  }
}

// ========================= CARGAS POR PROYECTO =========================
async function toggleCargasProyecto(idProyecto) {
  const panel = document.getElementById('cargas-' + idProyecto);
  if (panel.style.display === 'none') {
    panel.style.display = '';
    await loadCargasProyecto(idProyecto);
  } else {
    panel.style.display = 'none';
  }
}

async function loadCargasProyecto(idProyecto) {
  const list = document.getElementById('cargas-list-' + idProyecto);
  const data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/cargas?limit=10');
  if (!data || !data.cargas) { list.innerHTML = '<span class="muted">Error cargando</span>'; return; }
  if (data.cargas.length === 0) {
    list.innerHTML = '<span class="muted">Sin cargas registradas para este proyecto</span>';
    return;
  }
  list.innerHTML = `
    <table style="width:100%; font-size:12px;">
      <thead><tr><th>Archivo</th><th>Plano</th><th>Barras</th><th>Kilos</th><th>Versi\u00f3n</th><th>Usuario</th><th>Fecha</th><th></th></tr></thead>
      <tbody>${data.cargas.map(c => {
        let fecha = '';
        if (c.fecha) {
          const d = new Date(c.fecha);
          fecha = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
        }
        const estadoBadge = c.estado && c.estado !== 'ok' ? '<span style="color:#856404; font-size:10px;">(' + c.estado + ')</span> ' : '';
        return '<tr>' +
          '<td>' + estadoBadge + (c.archivo || '-') + '</td>' +
          '<td>' + (c.plano_code || '-') + '</td>' +
          '<td>' + c.barras_count + '</td>' +
          '<td>' + Math.round(c.kilos || 0).toLocaleString() + ' kg</td>' +
          '<td>' + (c.version_archivo || '-') + '</td>' +
          '<td class="muted">' + c.usuario + '</td>' +
          '<td class="muted">' + fecha + '</td>' +
          '<td><button class="secondary" style="padding:2px 6px; font-size:10px; color:#b42318;" onclick="deleteCarga(' + c.id + ',\\'' + idProyecto.replace(/'/g, "&#39;") + '\\')">Eliminar</button></td>' +
        '</tr>';
      }).join('')}</tbody>
    </table>`;
}

async function deleteCarga(cargaId, idProyecto) {
  if (!confirm('Eliminar esta carga? Se borrar\u00e1n las barras importadas en esa fecha.')) return;
  const res = await apiDelete('/cargas/' + cargaId);
  if (res && res.ok) {
    alert('Carga eliminada: ' + res.barras_eliminadas + ' barras borradas');
    await loadCargasProyecto(idProyecto);
    await loadProyectos();
    await loadInicio();
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

// ========================= AUTORIZADOS POR PROYECTO =========================
async function toggleAutorizados(idProyecto) {
  const panel = document.getElementById('autorizados-' + idProyecto);
  if (panel.style.display === 'none') {
    panel.style.display = '';
    await loadAutorizados(idProyecto);
    await loadUserSelect(idProyecto);
  } else {
    panel.style.display = 'none';
  }
}

async function loadAutorizados(idProyecto) {
  const list = document.getElementById('autorizados-list-' + idProyecto);
  const data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizados');
  if (!data || !data.autorizados) { list.innerHTML = '<span class="muted">Error cargando</span>'; return; }
  if (data.autorizados.length === 0) {
    list.innerHTML = '<span class="muted">Sin usuarios adicionales autorizados</span>';
    return;
  }
  list.innerHTML = data.autorizados.map(a => `
    <div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
      <span>${a.email}</span>
      <span class="badge" style="font-size:10px;">${a.rol}</span>
      <button class="secondary" style="font-size:10px; padding:1px 6px; color:#b42318; border-color:#b42318;" onclick="revocarUsuario('${idProyecto}', ${a.user_id})">✕</button>
    </div>
  `).join('');
}

async function loadUserSelect(idProyecto) {
  const sel = document.getElementById('autorizar-user-' + idProyecto);
  const data = await apiGet('/users/list');
  if (!data || !data.users) { sel.innerHTML = '<option>Error</option>'; return; }
  sel.innerHTML = data.users.map(u => `<option value="${u.id}">${u.email}</option>`).join('');
}

async function autorizarUsuario(idProyecto) {
  const sel = document.getElementById('autorizar-user-' + idProyecto);
  const userId = parseInt(sel.value);
  if (!userId) return;
  const res = await fetch('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, rol: 'editor' })
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await loadAutorizados(idProyecto);
    await setGlobalStatus('Usuario autorizado', 'ok');
  } else {
    await setGlobalStatus(data.detail || 'Error autorizando', 'err');
  }
}

async function revocarUsuario(idProyecto, userId) {
  if (!confirm('Revocar acceso de este usuario?')) return;
  const res = await fetch('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar/' + userId, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await loadAutorizados(idProyecto);
    await setGlobalStatus('Acceso revocado', 'ok');
  } else {
    await setGlobalStatus(data.detail || 'Error revocando', 'err');
  }
}

async function editarObra(id, nombreActual) {
  const nuevo = prompt('Nuevo nombre para la obra:', nombreActual);
  if (!nuevo || nuevo.trim() === '' || nuevo.trim() === nombreActual) return;
  const res = await fetch('/proyectos/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre_proyecto: nuevo.trim() })
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await setGlobalStatus('Obra renombrada: ' + nuevo.trim(), 'ok');
    await loadProyectos();
    await loadFilters();
    await loadInicio();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

async function eliminarObra(id, nombre, barrasCount) {
  const msg = barrasCount > 0
    ? 'Se eliminarán ' + barrasCount + ' barras asociadas a "' + nombre + '". Esta acción no se puede deshacer.'
    : 'Se eliminará la obra "' + nombre + '" (sin barras). Esta acción no se puede deshacer.';
  if (!confirm(msg)) return;
  const confirmText = prompt('Escribe ELIMINAR para confirmar:');
  if (confirmText !== 'ELIMINAR') { alert('Cancelado'); return; }
  const res = await fetch('/proyectos/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await setGlobalStatus('Obra eliminada: ' + nombre + ' (' + data.barras_eliminadas + ' barras)', 'ok');
    await loadProyectos();
    await loadFilters();
    await loadInicio();
    await loadDashboard('sector');
    await loadSectores();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

async function moverBarras() {
  const origen = document.getElementById('moverOrigen').value;
  const destino = document.getElementById('moverDestino').value;
  const msg = document.getElementById('moverBarrasMsg');
  if (!origen || !destino) { msg.innerHTML = '<span class="status-err">Selecciona origen y destino</span>'; return; }
  if (origen === destino) { msg.innerHTML = '<span class="status-err">Origen y destino deben ser diferentes</span>'; return; }
  const body = { destino_id: destino };
  const sector = document.getElementById('moverSector').value.trim();
  const piso = document.getElementById('moverPiso').value.trim();
  const ciclo = document.getElementById('moverCiclo').value.trim();
  if (sector) body.sector = sector;
  if (piso) body.piso = piso;
  if (ciclo) body.ciclo = ciclo;
  if (!confirm('Mover barras del proyecto seleccionado al destino. ¿Continuar?')) return;
  msg.innerHTML = '<span class="muted">Moviendo...</span>';
  const res = await fetch('/proyectos/' + encodeURIComponent(origen) + '/mover-barras', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    msg.innerHTML = '<span class="status-ok">Movidas ' + data.movidas + ' barras</span>';
    await loadProyectos();
    await loadFilters();
    await loadInicio();
    await loadDashboard('sector');
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (data.detail || data.message || 'desconocido') + '</span>';
  }
}

// ========================= FILTROS DEPENDIENTES + PERSISTENCIA =========================
const FILTER_STORAGE_KEY = 'armahub_filters';

function saveFiltersToStorage() {
  const state = {};
  ['proyecto','plano','sector','piso','ciclo','q','order_by','order_dir'].forEach(f => {
    const el = document.getElementById(f);
    if (el) state[f] = el.value;
  });
  try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}

function restoreFiltersFromStorage() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    // Restore order fields first (they don't depend on data)
    ['order_by','order_dir','q'].forEach(f => {
      const el = document.getElementById(f);
      if (el && state[f] !== undefined) el.value = state[f];
    });
    // Return filter state for loadFilters to use after populating selects
    return state;
  } catch(e) { return null; }
}

async function loadFilters(depParams) {
  // Build query string for dependent filtering
  const qp = new URLSearchParams();
  if (depParams) {
    if (depParams.proyecto) qp.set('proyecto', depParams.proyecto);
    if (depParams.plano) qp.set('plano_code', depParams.plano);
    if (depParams.sector) qp.set('sector', depParams.sector);
    if (depParams.piso) qp.set('piso', depParams.piso);
  }
  const qs = qp.toString();
  const data = await apiGet('/filters' + (qs ? '?' + qs : ''));
  if (!data) return;
  
  function fillSelect(selId, items, isPlanos = false) {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const val = sel.value;
    const placeholder = sel.options[0] ? sel.options[0].textContent : 'Todos';
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = placeholder;
    sel.appendChild(opt0);
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
    // Restore previous value if still in options
    if (val && Array.from(sel.options).some(o => o.value === val)) {
      sel.value = val;
    }
  }
  
  // Proyectos always full list
  fillSelect('proyecto', data.proyectos);
  fillSelect('exportProyecto', data.proyectos);
  fillSelect('sectorProyectoFilter', data.proyectos);
  fillSelect('matrizProyectoFilter', data.proyectos);
  // Dependent selects
  fillSelect('plano', data.planos, true);
  fillSelect('sector', data.sectores);
  fillSelect('piso', data.pisos);
  fillSelect('ciclo', data.ciclos);

}

function onProyectoChange() {
  // When project changes, reload dependent filters for that project
  const proy = document.getElementById('proyecto').value;
  // Clear dependent selects (their current values may not exist in new project)
  ['plano','sector','piso','ciclo'].forEach(f => { document.getElementById(f).value = ''; });
  loadFilters(proy ? { proyecto: proy } : null);
  saveFiltersToStorage();
  buscar(true);
}

function onFilterChange() {
  // When any sub-filter changes, reload further dependent filters
  const proy = document.getElementById('proyecto').value;
  const plano = document.getElementById('plano').value;
  const sector = document.getElementById('sector').value;
  const piso = document.getElementById('piso').value;
  const dep = {};
  if (proy) dep.proyecto = proy;
  if (plano) dep.plano = plano;
  if (sector) dep.sector = sector;
  if (piso) dep.piso = piso;
  loadFilters(Object.keys(dep).length ? dep : null);
  saveFiltersToStorage();
  buscar(true);
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
    if (data.ok === false && data.new_project) {
      // Proyecto nuevo detectado — mostrar popup para confirmar creación
      const modalResult = await openNewProjectModal(data);
      if (!modalResult.confirmed) {
        results.innerHTML += `<div class="status-warn" style="padding:4px 0; font-size:13px;">⏭️ ${f.name}: creación cancelada</div>`;
        errorCount++;
        continue;
      }
      let retryUrl = '/import/armadetailer?confirmar_nuevo=true';
      if (modalResult.calculista) {
        retryUrl += '&calculista=' + encodeURIComponent(modalResult.calculista);
      }
      const data2 = await apiPostFile(retryUrl, f);
      if (data2 && data2.ok) {
        const kilosText2 = data2.kilos ? ` — ${Math.round(data2.kilos).toLocaleString()} kg` : '';
        results.innerHTML += `<div class="status-ok" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data2.rows_upserted} barras (${data2.proyecto})${kilosText2} (nuevo proyecto)</div>`;
        successCount++;
      } else {
        results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: ${data2?.error || data2?.mensaje || 'Error creando proyecto'}</div>`;
        errorCount++;
      }
      continue;
    }
    if (data.ok === false && data.duplicate_warning) {
      // Proyecto duplicado detectado — preguntar al usuario
      const choice = confirm(
        `⚠️ ${data.mensaje}\n\n` +
        `¿Deseas reasignar las barras al proyecto existente (ID: ${data.proyecto_existente_id})?\n\n` +
        `[Aceptar] = Reasignar al existente\n[Cancelar] = Crear proyecto nuevo con ID ${data.proyecto_nuevo_id}`
      );
      let retryUrl;
      if (choice) {
        retryUrl = '/import/armadetailer?reasignar_a=' + encodeURIComponent(data.proyecto_existente_id);
      } else {
        retryUrl = '/import/armadetailer?forzar=true';
      }
      const data2 = await apiPostFile(retryUrl, f);
      if (data2 && data2.ok) {
        const kilosText2 = data2.kilos ? ` — ${Math.round(data2.kilos).toLocaleString()} kg` : '';
        results.innerHTML += `<div class="status-ok" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data2.rows_upserted} barras (${data2.proyecto})${kilosText2} ${choice ? '(reasignado)' : '(nuevo)'}</div>`;
        successCount++;
      } else {
        results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: ${data2?.error || 'Error en reimportación'}</div>`;
        errorCount++;
      }
      continue;
    }
    if (data.ok === false && data.invalid_sectors) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">🚫 ${f.name}: ${data.mensaje}</div>`;
      errorCount++;
      continue;
    }
    if (data.ok === false) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: ${data.error || data.mensaje || 'Error desconocido'}</div>`;
      errorCount++;
      continue;
    }

    const kilosText = data.kilos ? ` — ${Math.round(data.kilos).toLocaleString()} kg` : '';
    let validInfo = '';
    if (data.filas_rechazadas > 0) validInfo += ` ⚠️ ${data.filas_rechazadas} rechazadas`;
    if (data.advertencias > 0) validInfo += ` ℹ️ ${data.advertencias} advertencias`;
    const statusClass = data.estado === 'ok' ? 'status-ok' : 'status-warn';
    results.innerHTML += `<div class="${statusClass}" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data.rows_upserted} barras (${data.proyecto})${kilosText}${validInfo}</div>`;
    if (data.rejected && data.rejected.length > 0) {
      results.innerHTML += `<div class="muted" style="padding:2px 0 4px 20px; font-size:11px;">Rechazadas: ${data.rejected.slice(0,5).join(', ')}</div>`;
    }
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
        <th>Proyecto</th><th>Archivo</th><th>Plano</th><th>Barras</th><th>Kilos</th><th>Versión</th><th>Usuario</th><th>Fecha</th>
      </tr></thead>
      <tbody>${data.cargas.map(c => {
        let fecha = '';
        if (c.fecha) {
          const d = new Date(c.fecha);
          fecha = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
        }
        const estadoBadge = c.estado === 'ok' ? '' : `<span class="badge" style="background:#fff3cd; color:#856404; font-size:10px;">${c.estado}</span> `;
        return `<tr>
          <td>${estadoBadge}<strong>${c.nombre_proyecto || c.id_proyecto}</strong></td>
          <td class="muted" style="font-size:11px;">${c.archivo || '-'}</td>
          <td class="muted" style="font-size:11px;">${c.plano_code || '-'}</td>
          <td>${c.barras_count}</td>
          <td>${Math.round(c.kilos || 0).toLocaleString()} kg</td>
          <td class="muted" style="font-size:11px;">${c.version_archivo || '-'}</td>
          <td class="muted">${c.usuario}</td>
          <td class="muted" style="font-size:11px;">${fecha}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  `;
}

// ========================= ADMINISTRADOR DE DATA =========================
let currentOffset = 0;
const pageLimit = 100;
let lastTotal = 0;
let selectedBarras = new Set();

// Columnas compactas para la tabla
const DISPLAY_COLS = [
  { key: 'id_unico', label: 'ID', short: true },
  { key: 'sector',   label: 'Sector' },
  { key: 'piso',     label: 'Piso' },
  { key: 'ciclo',    label: 'Ciclo' },
  { key: 'eje',      label: 'Eje' },
  { key: 'diam',     label: '\u03c6', fmt: v => v != null ? Math.round(v) : '' },
  { key: 'cant_total', label: 'Cant', fmt: v => v != null ? Math.round(v) : '' },
  { key: 'largo_total', label: 'Largo', fmt: v => v != null ? Math.round(v) : '' },
  { key: 'peso_unitario', label: 'Peso U.', fmt: v => v != null ? v.toFixed(2) : '' },
  { key: 'peso_total', label: 'Peso Total', fmt: v => v != null ? v.toFixed(1) : '' },
];

function shortId(id) {
  if (!id) return '';
  const parts = id.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : id;
}

function updateToolbar() {
  const tb = document.getElementById('barrasToolbar');
  const cnt = document.getElementById('selectedCount');
  if (selectedBarras.size > 0) {
    tb.style.display = '';
    cnt.textContent = selectedBarras.size + ' seleccionada' + (selectedBarras.size > 1 ? 's' : '');
  } else {
    tb.style.display = 'none';
  }
}

function toggleBarra(id) {
  if (selectedBarras.has(id)) selectedBarras.delete(id);
  else selectedBarras.add(id);
  const cb = document.getElementById('cb_' + CSS.escape(id));
  if (cb) cb.checked = selectedBarras.has(id);
  const row = document.getElementById('row_' + CSS.escape(id));
  if (row) row.style.background = selectedBarras.has(id) ? '#f0f9e8' : '';
  updateToolbar();
}

function toggleAllBarras(checked) {
  document.querySelectorAll('.barra-cb').forEach(cb => {
    const id = cb.dataset.id;
    if (checked) selectedBarras.add(id); else selectedBarras.delete(id);
    cb.checked = checked;
    const row = document.getElementById('row_' + CSS.escape(id));
    if (row) row.style.background = checked ? '#f0f9e8' : '';
  });
  updateToolbar();
}

function clearSeleccion() {
  selectedBarras.clear();
  document.querySelectorAll('.barra-cb').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('tbody tr').forEach(tr => { tr.style.background = ''; });
  const sa = document.getElementById('selectAll');
  if (sa) sa.checked = false;
  updateToolbar();
}

async function accionMoverProyecto() {
  if (selectedBarras.size === 0) return alert('Selecciona al menos una barra');
  const dest = document.getElementById('accionDestProyecto').value;
  if (!dest) return alert('Selecciona proyecto destino');
  if (!confirm('Mover ' + selectedBarras.size + ' barra(s) al proyecto seleccionado?')) return;
  const res = await apiPostJson('/barras/mover', { id_unicos: Array.from(selectedBarras), destino_id: dest });
  if (res && res.ok) {
    alert('Movidas: ' + res.movidas + ' barras');
    clearSeleccion();
    buscar(true);
    loadProyectos();
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

async function accionCambiarSector() {
  if (selectedBarras.size === 0) return alert('Selecciona al menos una barra');
  const sec = document.getElementById('accionSector').value;
  if (!sec) return alert('Selecciona sector destino');
  if (!confirm('Cambiar sector de ' + selectedBarras.size + ' barra(s) a ' + sec + '?')) return;
  const res = await apiPostJson('/barras/mover', { id_unicos: Array.from(selectedBarras), nuevo_sector: sec });
  if (res && res.ok) {
    alert('Actualizadas: ' + res.movidas + ' barras');
    clearSeleccion();
    buscar(true);
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

async function buscar(reset = false) {
  if (reset) { currentOffset = 0; selectedBarras.clear(); updateToolbar(); }

  const proy = document.getElementById('proyecto').value;
  if (!proy) {
    document.getElementById('count').textContent = 'Selecciona un proyecto para ver sus barras.';
    document.getElementById('tabla').innerHTML = '';
    return;
  }

  const params = new URLSearchParams();
  params.set('proyecto', proy);
  ['plano', 'sector', 'piso', 'ciclo'].forEach(f => {
    const v = document.getElementById(f).value;
    if (v) params.set(f === 'plano' ? 'plano_code' : f, v);
  });

  const q = document.getElementById('q').value.trim();
  if (q) params.set('q', q);

  params.set('limit', pageLimit);
  params.set('offset', currentOffset);
  params.set('order_by', document.getElementById('order_by').value);
  params.set('order_dir', document.getElementById('order_dir').value);

  saveFiltersToStorage();
  const data = await apiGet('/barras?' + params.toString());
  if (!data) return;

  lastTotal = data.total || 0;
  const page = Math.floor(currentOffset / pageLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(lastTotal / pageLimit));

  document.getElementById('count').textContent = lastTotal.toLocaleString() + ' barras en proyecto';
  document.getElementById('pageInfo').textContent = 'P\u00e1g ' + page + '/' + totalPages;

  // Populate toolbar project selector
  const destSel = document.getElementById('accionDestProyecto');
  if (destSel.options.length <= 1) {
    const fd = await apiGet('/filters');
    if (fd && fd.proyectos) {
      fd.proyectos.forEach(p => {
        if (p !== proy) {
          const o = document.createElement('option');
          o.value = p; o.textContent = p;
          destSel.appendChild(o);
        }
      });
    }
  }

  const table = document.getElementById('tabla');
  table.innerHTML = '';

  if (!data.data || !data.data.length) {
    table.innerHTML = '<tr><td colspan="12" class="muted" style="padding:20px; text-align:center;">Sin resultados</td></tr>';
    return;
  }

  // Header
  let hdr = '<thead><tr style="font-size:11px;"><th style="width:28px;"><input type="checkbox" id="selectAll" onchange="toggleAllBarras(this.checked)" /></th>';
  DISPLAY_COLS.forEach(c => {
    const ord = document.getElementById('order_by').value;
    const dir = document.getElementById('order_dir').value;
    const arrow = c.key === ord ? (dir === 'asc' ? ' \u25b2' : ' \u25bc') : '';
    hdr += '<th style="cursor:pointer; padding:4px 6px;" onclick="document.getElementById(\\'order_by\\').value=\\'' + c.key + '\\'; buscar(true);">' + c.label + arrow + '</th>';
  });
  hdr += '</tr></thead>';

  // Body
  let body = '<tbody>';
  data.data.forEach(row => {
    const id = row.id_unico;
    const sel = selectedBarras.has(id);
    body += '<tr id="row_' + id.replace(/"/g, '') + '" style="' + (sel ? 'background:#f0f9e8;' : '') + '">';
    body += '<td style="width:28px;"><input type="checkbox" class="barra-cb" data-id="' + id + '" id="cb_' + id.replace(/"/g, '') + '" ' + (sel ? 'checked' : '') + ' onchange="toggleBarra(\\'' + id.replace(/'/g, "\\'") + '\\')" /></td>';
    DISPLAY_COLS.forEach(c => {
      let val = row[c.key];
      if (c.short) val = shortId(val);
      if (c.fmt) val = c.fmt(row[c.key]);
      body += '<td style="padding:3px 6px;">' + (val != null && val !== '' ? val : '') + '</td>';
    });
    body += '</tr>';
  });
  body += '</tbody>';

  table.innerHTML = hdr + body;
}

function resetFiltros() {
  ['proyecto', 'plano', 'sector', 'piso', 'ciclo'].forEach(f => {
    document.getElementById(f).value = '';
  });
  document.getElementById('q').value = '';
  const si = document.getElementById('proyectoSearchInput');
  if (si) si.value = '';
  try { localStorage.removeItem(FILTER_STORAGE_KEY); } catch(e) {}
  // Reset toolbar project selector
  const destSel = document.getElementById('accionDestProyecto');
  if (destSel) { destSel.innerHTML = '<option value="">Mover a proyecto...</option>'; }
  selectedBarras.clear();
  updateToolbar();
  loadFilters();
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

// ========================= EXPORTACIÓN =========================
async function previewExport() {
  const proy = document.getElementById('exportProyecto').value;
  const preview = document.getElementById('exportPreview');
  const status = document.getElementById('exportStatus');
  if (!proy) { preview.innerHTML = ''; status.textContent = ''; return; }

  status.textContent = 'Cargando vista previa...';
  const data = await apiGet('/barras?proyecto=' + encodeURIComponent(proy) + '&limit=1&offset=0');
  if (!data) { status.textContent = 'Error cargando datos'; return; }

  const total = data.total || 0;
  if (total === 0) {
    preview.innerHTML = '<span class="muted">Este proyecto no tiene barras para exportar.</span>';
    status.textContent = '';
    return;
  }

  // Get sector/piso/ciclo combos
  const filters = await apiGet('/filters?proyecto=' + encodeURIComponent(proy));
  let combos = '';
  if (filters) {
    const sectores = filters.sectores || [];
    const pisos = filters.pisos || [];
    const ciclos = filters.ciclos || [];
    combos = '<div style="margin-top:8px; font-size:12px;">' +
      '<strong>Sectores:</strong> ' + (sectores.join(', ') || '-') + '<br>' +
      '<strong>Pisos:</strong> ' + (pisos.join(', ') || '-') + '<br>' +
      '<strong>Ciclos:</strong> ' + (ciclos.join(', ') || '-') +
      '</div>';
  }

  preview.innerHTML = '<div style="background:#f8f9fa; padding:12px; border-radius:6px; font-size:13px;">' +
    '<strong>' + total.toLocaleString() + ' barras</strong> disponibles para exportar.' +
    combos +
    '<p class="muted" style="margin-top:8px; font-size:11px;">Se generará un archivo .xlsx por cada combinación SECTOR + PISO + CICLO.</p>' +
    '</div>';
  status.textContent = '';
}

async function descargarExport() {
  const proy = document.getElementById('exportProyecto').value;
  if (!proy) return alert('Selecciona un proyecto');
  const status = document.getElementById('exportStatus');
  status.textContent = 'Generando archivos Excel...';

  try {
    const res = await fetch('/proyectos/' + encodeURIComponent(proy) + '/exportar', { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) {
      const err = await res.json();
      status.textContent = 'Error: ' + (err.detail || 'desconocido');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = res.headers.get('Content-Disposition');
    const fn = cd ? cd.split('filename=')[1].replace(/"/g, '') : 'export.zip';
    a.download = fn;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    status.textContent = 'Descarga completada.';
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }
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

// Reusable piso ordering function (building order: SM top, subterráneos bottom)
function pisoOrder(p) {
  const up = (p || '').toUpperCase().trim();
  if (up === 'SM' || up === 'SALA DE MAQUINAS') return 9999;
  const m = up.match(/^S(\d+)/);
  if (m) return -parseInt(m[1]);
  const m2 = up.match(/^P(\d+)/);
  if (m2) return parseInt(m2[1]);
  const m3 = up.match(/(\d+)/);
  if (m3) return parseInt(m3[1]);
  return 0;
}

async function loadDashboard(groupBy) {
  await setGlobalStatus("Cargando gráfico...", "warn");
  const data = await apiGet('/dashboard?group_by=' + encodeURIComponent(groupBy));
  if (!data) return;
  
  document.getElementById('dashTotals').textContent = `Total: ${data.total.barras} barras — ${data.total.kilos.toFixed(2)} kg`;
  
  // Sort by building order when grouping by piso
  let items = data.items;
  if (groupBy === 'piso') {
    items = [...items].sort((a, b) => pisoOrder(b.grupo) - pisoOrder(a.grupo));
  }

  const labels = items.map(x => (x.grupo === null || x.grupo === '' || x.grupo === undefined) ? '(sin valor)' : x.grupo);
  const values = items.map(x => Number(x.kilos || 0));
  
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

  // Sort by building order (piso)
  data.items.sort((a, b) => pisoOrder(a.piso) - pisoOrder(b.piso));

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

// ========================= MATRIZ CONSTRUCTIVA =========================
async function loadMatriz() {
  const container = document.getElementById('matrizContainer');
  const proy = document.getElementById('matrizProyectoFilter').value;
  if (!proy) {
    container.innerHTML = '<div class="muted">Selecciona un proyecto para ver la matriz constructiva</div>';
    return;
  }

  container.innerHTML = '<div class="muted">Cargando matriz...</div>';
  const data = await apiGet('/dashboard/sectores?proyecto=' + encodeURIComponent(proy));
  if (!data || !data.items || data.items.length === 0) {
    container.innerHTML = '<div class="muted">Sin datos de sectores para este proyecto</div>';
    return;
  }

  // Build lookup: key = "sector|piso|ciclo" => {barras, kilos}
  const lookup = {};
  let maxKilos = 0;
  data.items.forEach(i => {
    const s = (i.sector || '?').toUpperCase().trim();
    const p = (i.piso || '?').trim();
    const c = (i.ciclo || '?').trim();
    const key = s + '|' + p + '|' + c;
    lookup[key] = { barras: i.barras, kilos: i.kilos };
    if (i.kilos > maxKilos) maxKilos = i.kilos;
  });

  // Collect unique pisos and ciclos
  const pisosSet = new Set();
  const ciclosSet = new Set();
  const sectoresSet = new Set();
  data.items.forEach(i => {
    pisosSet.add((i.piso || '?').trim());
    ciclosSet.add((i.ciclo || '?').trim());
    sectoresSet.add((i.sector || '?').toUpperCase().trim());
  });

  // Sort pisos using global pisoOrder (building order: SM top, subterráneos bottom)
  const pisos = Array.from(pisosSet).sort((a, b) => pisoOrder(a) - pisoOrder(b));
  // Reverse so highest floor is at top of table
  pisos.reverse();

  const ciclos = Array.from(ciclosSet).sort((a, b) => {
    const na = parseInt((a.match(/(\d+)/) || [0,0])[1]);
    const nb = parseInt((b.match(/(\d+)/) || [0,0])[1]);
    return na - nb;
  });

  // Determine sub-row types per piso
  // Standard order top-to-bottom within a piso: LCIELO, VCIELO, ELEV
  // FUND only appears at the lowest piso
  const TYPE_ORDER = ['LCIELO', 'VCIELO', 'ELEV'];
  const lowestPiso = pisos[pisos.length - 1]; // after reverse, last = lowest

  // For each piso, determine which sector types exist
  function getTypesForPiso(piso) {
    const types = [];
    // Check for FUND (only lowest piso typically)
    if (piso === lowestPiso) {
      for (const c of ciclos) {
        if (lookup['FUND|' + piso + '|' + c]) { types.push('FUND'); break; }
      }
    }
    // Always check standard types, but only include if data exists for this piso
    for (const t of TYPE_ORDER) {
      for (const c of ciclos) {
        if (lookup[t + '|' + piso + '|' + c]) { types.push(t); break; }
      }
    }
    // Also check for any other sector types not in standard list
    for (const s of sectoresSet) {
      if (s === 'FUND' || TYPE_ORDER.includes(s)) continue;
      for (const c of ciclos) {
        if (lookup[s + '|' + piso + '|' + c]) { types.push(s); break; }
      }
    }
    return types.length > 0 ? types : ['ELEV']; // fallback
  }

  // Heatmap color function — concrete gray scale
  function heatColor(kilos) {
    if (!kilos || maxKilos === 0) return '#fff';
    const ratio = Math.min(kilos / maxKilos, 1);
    // From light concrete (#D6D6D6) to dark concrete (#6B6B6B)
    const v = Math.round(214 - ratio * (214 - 107));
    return `rgb(${v},${v},${v})`;
  }

  // Load completed sectors from localStorage
  const completedKey = 'armahub_completed_' + proy;
  let completedSectors = {};
  try { completedSectors = JSON.parse(localStorage.getItem(completedKey) || '{}'); } catch(e) {}

  function toggleCompleted(cellKey) {
    if (completedSectors[cellKey]) {
      delete completedSectors[cellKey];
    } else {
      completedSectors[cellKey] = true;
    }
    try { localStorage.setItem(completedKey, JSON.stringify(completedSectors)); } catch(e) {}
    loadMatriz(); // re-render
  }
  // Expose to global scope for onclick
  window._matrizToggle = toggleCompleted;

  // Build HTML table — compact building look
  let html = '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
  html += '<thead><tr><th style="border:1px solid #ccc; padding:4px 6px; background:#1a1a1a; color:#8BC34A; white-space:nowrap;">Piso</th>';
  ciclos.forEach(c => {
    html += `<th style="border:1px solid #ccc; padding:4px 6px; background:#1a1a1a; color:#8BC34A; text-align:center; white-space:nowrap;">${c}</th>`;
  });
  html += '</tr></thead><tbody>';

  pisos.forEach((piso, pisoIdx) => {
    const types = getTypesForPiso(piso);
    types.forEach((tipo, typeIdx) => {
      html += '<tr>';
      if (typeIdx === 0) {
        html += `<td rowspan="${types.length}" style="border:1px solid #ccc; padding:4px 6px; font-weight:bold; background:#fff; color:#1a1a1a; vertical-align:middle; text-align:center; font-size:12px; white-space:nowrap;">${piso}</td>`;
      }
      ciclos.forEach(ciclo => {
        const key = tipo + '|' + piso + '|' + ciclo;
        const d = lookup[key];
        const isCompleted = !!completedSectors[key];
        if (d) {
          const bg = heatColor(d.kilos);
          const textColor = isCompleted ? '#558B2F' : (d.kilos > maxKilos * 0.5 ? '#fff' : '#1a1a1a');
          html += `<td style="border:1px solid #aaa; padding:3px 4px; background:${bg}; text-align:center; position:relative;" title="${tipo} ${piso} ${ciclo}: ${d.barras} barras, ${Math.round(d.kilos).toLocaleString()} kg">`;
          html += `<input type="checkbox" ${isCompleted ? 'checked' : ''} onclick="window._matrizToggle('${key}')" style="position:absolute; top:2px; right:2px; width:12px; height:12px; cursor:pointer; accent-color:#8BC34A;" title="Marcar como completado" />`;
          html += `<div style="font-weight:600; font-size:9px; color:${textColor}; opacity:0.85;">${tipo}</div>`;
          html += `<div style="font-size:11px; font-weight:bold; color:${textColor};">${Math.round(d.kilos).toLocaleString()} kg</div>`;
          html += `<div style="font-size:9px; color:${textColor}; opacity:0.7;">${d.barras} bar</div>`;
          html += '</td>';
        } else {
          html += `<td style="border:1px solid #eee; padding:3px 4px; background:#fff; text-align:center;"></td>`;
        }
      });
      html += '</tr>';
    });
  });

  html += '</tbody></table>';

  // Legend
  html += '<div style="margin-top:8px; display:flex; gap:10px; align-items:center; font-size:11px; flex-wrap:wrap;">';
  html += '<span class="muted">Intensidad (kg):</span>';
  html += '<span style="display:inline-block; width:16px; height:12px; background:#D6D6D6; border:1px solid #aaa; vertical-align:middle;"></span> <span class="muted">Menos</span>';
  html += '<span style="display:inline-block; width:16px; height:12px; background:#A8A8A8; border:1px solid #aaa; vertical-align:middle;"></span>';
  html += '<span style="display:inline-block; width:16px; height:12px; background:#6B6B6B; border:1px solid #aaa; vertical-align:middle;"></span> <span class="muted">Más</span>';
  html += '<span style="margin-left:8px;">☐ = Pendiente</span>';
  html += '<span style="color:#558B2F; font-weight:bold;">☑ = Completado</span>';
  html += '</div>';

  container.innerHTML = html;
}

// ========================= INICIO (Landing) =========================
let inicioChart = null;

async function loadInicio() {
  let data;
  try {
    data = await apiGet('/stats');
  } catch(e) { console.error('loadInicio error:', e); return; }
  if (!data) return;

  document.getElementById('kpiProyectos').textContent = data.total_proyectos;
  document.getElementById('kpiBarras').textContent = data.total_barras.toLocaleString();
  document.getElementById('kpiKilos').textContent = Math.round(data.total_kilos).toLocaleString() + ' kg';

  // KPIs avanzados
  document.getElementById('kpiPPB').textContent = data.ppb ? data.ppb.toFixed(2) + ' kg' : '—';
  document.getElementById('kpiPPI').textContent = data.ppi ? data.ppi.toFixed(2) + ' kg' : '—';
  document.getElementById('kpiDiam').textContent = data.diam_promedio ? data.diam_promedio.toFixed(1) + ' mm' : '—';
  document.getElementById('kpiItems').textContent = data.total_items ? data.total_items.toLocaleString() : '—';

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

  // Restore saved filters from localStorage
  const saved = restoreFiltersFromStorage();
  const dep = {};
  if (saved && saved.proyecto) dep.proyecto = saved.proyecto;
  await loadFilters(Object.keys(dep).length ? dep : null);
  // Now set saved select values after options are populated
  if (saved) {
    ['proyecto','plano','sector','piso','ciclo'].forEach(f => {
      const el = document.getElementById(f);
      if (el && saved[f]) el.value = saved[f];
    });
  }

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
