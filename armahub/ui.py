"""
ui.py (refactorizado)
-----
UI con estructura de tabs por rol.
CSS y JS extraídos a archivos estáticos (static/css/app.css, static/js/app.js).

Incluye:
- GET /ui/login      (login)
- GET /ui            (app con tabs: Obras, Bar Manager, Dashboards, Pedidos, Exportación)
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
  <link rel="stylesheet" href="/static/css/app.css">
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
    <button class="tab-btn" onclick="switchTab('obras')">📦 Obras</button>
    <button class="tab-btn" onclick="switchTab('buscar')">🔍 Bar Manager</button>
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

  <!-- TAB 1: OBRAS -->
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

  <!-- TAB 2: BAR MANAGER -->
  <div id="tab-buscar" class="tab-content">
    <div class="card">
      <h3>Bar Manager</h3>
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

<script src="/static/js/app.js"></script>
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
