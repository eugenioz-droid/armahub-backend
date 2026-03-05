"""
ui.py
-----
UI mínima (sin frontend separado).

Incluye:
- GET /ui/login      (login)
- GET /ui            (app: importar, filtros, tabla, dashboard con gráfico, crear usuario)
- GET /ui/bootstrap  (crear primer admin si no hay usuarios)

A (crear usuarios desde UI):
- Visible solo si rol = admin (usa /me)
- Llama POST /auth/register con token

B (dashboard con gráficos):
- Usa /dashboard y grafica con Chart.js
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
    body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
    input, button { padding: 10px; margin: 6px 0; width: 100%; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 16px; }
    .muted { color: #666; font-size: 12px; }
    a { color: #0366d6; text-decoration:none; }
  </style>
</head>
<body>
  <h2>ArmaHub</h2>

  <div class="card" id="bootstrapHint" style="display:none;">
    <b>Primera vez (BD vacía)</b>
    <div class="muted">Si aún no existen usuarios, crea el primer admin acá:</div>
    <div style="margin-top:8px;">
      <a href="/ui/bootstrap">/ui/bootstrap</a>
    </div>
  </div>

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

(async function checkBootstrap() {
  // Mostramos hint si /ui/bootstrap existe y está habilitado (devuelve 200)
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
    body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
    input, button { padding: 10px; margin: 6px 0; width: 100%; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 16px; }
    .muted { color: #666; font-size: 12px; }
    a { color: #0366d6; text-decoration:none; }
    .status-ok { color: #1a7f37; font-size: 12px; }
    .status-err { color: #b42318; font-size: 12px; }
    .status-warn { color: #a15c00; font-size: 12px; }
  </style>
</head>
<body>
  <h2>Bootstrap Admin</h2>

  <div class="card">
    <div class="muted">
      Esto solo funciona si <b>no existe ningún usuario</b> en la base de datos.
      Si ya existe un usuario, esta pantalla se bloquea.
    </div>

    <h3>Crear primer admin</h3>
    <input id="email" placeholder="Email admin" />
    <input id="password" type="password" placeholder="Password" />
    <button onclick="createAdmin()">Crear admin</button>
    <div id="msg" class="muted"></div>

    <div style="margin-top:10px;">
      <a href="/ui/login">Volver a login</a>
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

  msg.textContent = "Admin creado ✅. Ahora puedes loguearte.";
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
  <!-- anti-cache en HTML -->
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
  <meta http-equiv="Pragma" content="no-cache">
  <title>ArmaHub</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1100px; margin: 30px auto; padding: 0 16px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin: 10px 0; }
    select, input, button { padding: 8px; }
    input { min-width: 220px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #eee; padding: 6px; font-size: 12px; }
    th { background: #fafafa; text-align: left; position: sticky; top: 0; }
    .muted { color: #666; font-size: 12px; }
    .right { float: right; }
    .badge { display:inline-block; padding: 4px 8px; border:1px solid #eee; border-radius: 999px; font-size: 12px; color:#444; margin-right:6px; }
    .status-ok { color: #1a7f37; font-size: 12px; }
    .status-err { color: #b42318; font-size: 12px; }
    .status-warn { color: #a15c00; font-size: 12px; }
  </style>
</head>
<body>
  <h2>
    ArmaHub
    <span class="right">
      <span class="badge" id="whoEmail"></span>
      <span class="badge" id="whoRole"></span>
      <button onclick="logout()">Salir</button>
    </span>
  </h2>

  <div id="globalStatus" class="muted"></div>

  <div class="card">
    <h3>1) Importar CSV</h3>
    <input type="file" id="csvFile" />
    <button onclick="importCSV()">Importar</button>
    <div id="importMsg" class="muted"></div>
  </div>

  <!-- A: Crear usuarios desde UI (solo admin) -->
  <div class="card" id="adminCard" style="display:none;">
    <h3>Admin — Crear usuario</h3>
    <div class="row">
      <input id="newEmail" placeholder="Email" />
      <input id="newPassword" type="password" placeholder="Password" />
      <select id="newRole">
        <option value="operador">operador</option>
        <option value="admin">admin</option>
      </select>
      <button onclick="crearUsuario()">Crear</button>
    </div>
    <div id="adminMsg" class="muted"></div>
  </div>

  <!-- B: Dashboard con gráficos -->
  <div class="card">
    <h3>2) Dashboard</h3>
    <div class="row">
      <button onclick="loadDashboard('ciclo')">Kilos por ciclo</button>
      <button onclick="loadDashboard('piso')">Kilos por piso</button>
      <button onclick="loadDashboard('eje')">Kilos por eje</button>
      <button onclick="loadDashboard('sector')">Kilos por sector</button>
      <button onclick="loadDashboard('plano_code')">Kilos por plano</button>
      <button onclick="loadDashboard('id_proyecto')">Kilos por proyecto</button>
    </div>
    <div class="muted" id="dashTotals"></div>
    <div style="height:360px; margin-top:10px;">
      <canvas id="dashChart"></canvas>
    </div>
  </div>

  <div class="card">
    <h3>3) Buscar barras</h3>

    <div class="row">
      <select id="proyecto"></select>
      <select id="plano"></select>
      <select id="sector"></select>
      <select id="piso"></select>
      <select id="ciclo"></select>
    </div>

    <div class="row" style="margin-top:10px;">
      <input id="q" placeholder="Buscar (id_unico / eje / plano)..." />

      <select id="order_by">
        <option value="fecha_carga">Orden: fecha_carga</option>
        <option value="peso_total">Orden: peso_total</option>
        <option value="cant_total">Orden: cant_total</option>
        <option value="diam">Orden: diam</option>
        <option value="largo_total">Orden: largo_total</option>
        <option value="plano_code">Orden: plano_code</option>
        <option value="eje">Orden: eje</option>
        <option value="id_unico">Orden: id_unico</option>
      </select>

      <select id="order_dir">
        <option value="desc">desc</option>
        <option value="asc">asc</option>
      </select>

      <button onclick="buscar(true)">Buscar</button>
    </div>

    <div class="row" style="margin-top:10px;">
      <button onclick="prevPage()">◀ Anterior</button>
      <button onclick="nextPage()">Siguiente ▶</button>
      <span class="muted" id="pageInfo"></span>
    </div>

    <div class="muted" id="count"></div>

    <div style="overflow:auto; max-height: 420px; margin-top:10px;">
      <table id="tabla"></table>
    </div>
  </div>

<script>
/** =========================
 *  Auth helpers
 *  ========================= */
function token() { return localStorage.getItem('armahub_token'); }
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

  if (res.status === 401) {
    console.warn("401 Unauthorized, logging out");
    logout();
    return null;
  }

  let data = null;
  try { data = await res.json(); } catch (e) {
    console.error("Failed to parse JSON from " + url, e);
    await setGlobalStatus("Error: respuesta inválida de " + url, "err");
    return null;
  }

  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) ? (data.detail || data.error) : ("HTTP " + res.status);
    console.error("API Error from " + url + ": " + msg, data);
    await setGlobalStatus("Error API: " + url + " → " + msg, "err");
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

/** =========================
 *  UI status
 *  ========================= */
async function setGlobalStatus(text, kind) {
  const el = document.getElementById('globalStatus');
  if (!el) return;
  el.className = 'muted';
  if (kind === 'ok') el.className = 'status-ok';
  if (kind === 'err') el.className = 'status-err';
  if (kind === 'warn') el.className = 'status-warn';
  el.textContent = text || '';
}

/** =========================
 *  Chart.js dashboard
 *  ========================= */
let chart = null;
function renderChart(labels, values, title) {
  const ctx = document.getElementById('dashChart').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: title, data: values }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

/** =========================
 *  Pagination + sorting state
 *  ========================= */
let currentOffset = 0;
const pageLimit = 200;
let lastTotal = 0;

let currentOrderBy = "fecha_carga";
let currentOrderDir = "desc";

// Columnas permitidas para ordenar (blindaje UI)
const ORDERABLE_COLS = new Set([
  "fecha_carga",
  "peso_total",
  "peso_unitario",
  "cant_total",
  "diam",
  "largo_total",
  "id_proyecto",
  "plano_code",
  "sector",
  "piso",
  "ciclo",
  "eje",
  "id_unico"
]);

/** =========================
 *  Load current user
 *  ========================= */
async function loadMe() {
  const me = await apiGet('/me');
  if (!me) return;

  document.getElementById('whoEmail').textContent = me.email;
  document.getElementById('whoRole').textContent = "Rol: " + me.role;

  if (me.role === 'admin') {
    document.getElementById('adminCard').style.display = 'block';
    await setGlobalStatus("Sesión iniciada como admin. Puedes crear usuarios.", "ok");
  } else {
    await setGlobalStatus("Sesión iniciada.", "ok");
  }
}

/** =========================
 *  Admin create user
 *  ========================= */
async function crearUsuario() {
  const adminMsg = document.getElementById('adminMsg');
  adminMsg.textContent = "Creando...";

  const email = document.getElementById('newEmail').value.trim();
  const password = document.getElementById('newPassword').value;
  const role = document.getElementById('newRole').value;

  const res = await apiPost('/auth/register', { email, password, role });
  if (!res) return;

  if (!res.ok) {
    adminMsg.textContent = "Error: " + (res.data.detail || JSON.stringify(res.data));
    return;
  }

  adminMsg.textContent = "Usuario creado ✅";
  document.getElementById('newEmail').value = '';
  document.getElementById('newPassword').value = '';
}

/** =========================
 *  Filters
 *  ========================= */
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
    (items || []).forEach(x => {
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

/** =========================
 *  Import CSV
 *  ========================= */
async function importCSV() {
  const fileInput = document.getElementById('csvFile');
  const msg = document.getElementById('importMsg');

  if (!fileInput.files.length) {
    msg.textContent = "Selecciona un CSV.";
    return;
  }

  msg.textContent = "Importando...";
  await setGlobalStatus("Importando CSV...", "warn");

  const data = await apiPostFile('/import/armadetailer', fileInput.files[0]);
  if (!data) {
    await setGlobalStatus("Sesión expirada.", "err");
    return;
  }

  if (data.ok === false) {
    msg.textContent = JSON.stringify(data);
    await setGlobalStatus("Error importando: " + (data.error || "revisa el CSV"), "err");
    return;
  }

  msg.textContent = JSON.stringify(data);
  await setGlobalStatus("Importación exitosa ✅", "ok");

  await loadFilters();
  await loadDashboard('ciclo');
  await buscar(true);
}

/** =========================
 *  Dashboard
 *  ========================= */
async function loadDashboard(groupBy) {
  await setGlobalStatus("Cargando dashboard...", "warn");

  const data = await apiGet('/dashboard?group_by=' + encodeURIComponent(groupBy));
  if (!data) {
    await setGlobalStatus("Sesión expirada.", "err");
    return;
  }

  document.getElementById('dashTotals').textContent =
    `Total: ${data.total.barras} barras — ${Number(data.total.kilos).toFixed(2)} kg`;

  const labels = data.items.map(x => (x.grupo === null || x.grupo === undefined || x.grupo === '') ? '(vacío)' : x.grupo);
  const values = data.items.map(x => Number(x.kilos || 0));

  renderChart(labels, values, `Kilos por ${groupBy}`);
  await setGlobalStatus("Dashboard actualizado ✅", "ok");
}

/** =========================
 *  Bars table (paged + ordered + search)
 *  ========================= */
async function buscar(reset=false) {
  if (reset) currentOffset = 0;

  const params = new URLSearchParams();

  const proyecto = document.getElementById('proyecto').value;
  const plano = document.getElementById('plano').value;
  const sector = document.getElementById('sector').value;
  const piso = document.getElementById('piso').value;
  const ciclo = document.getElementById('ciclo').value;

  const q = document.getElementById('q').value.trim();

  // sync selectors with current state
  document.getElementById('order_by').value = currentOrderBy;
  document.getElementById('order_dir').value = currentOrderDir;

  if (proyecto) params.set('proyecto', proyecto);
  if (plano) params.set('plano_code', plano);
  if (sector) params.set('sector', sector);
  if (piso) params.set('piso', piso);
  if (ciclo) params.set('ciclo', ciclo);

  if (q) params.set('q', q);

  params.set('limit', String(pageLimit));
  params.set('offset', String(currentOffset));
  params.set('order_by', currentOrderBy);
  params.set('order_dir', currentOrderDir);

  const url = '/barras?' + params.toString();
  console.log("Fetching: " + url);
  
  const data = await apiGet(url);
  if (!data) {
    console.error("No data returned from /barras");
    return;
  }

  console.log("Response from /barras:", data);

  lastTotal = data.total || 0;

  document.getElementById('count').textContent =
    `Resultados en esta página: ${data.count} — Total: ${lastTotal}`;

  const page = Math.floor(currentOffset / pageLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(lastTotal / pageLimit));

  document.getElementById('pageInfo').textContent =
    `Página ${page} / ${totalPages} (limit ${pageLimit})`;

  const table = document.getElementById('tabla');
  table.innerHTML = '';

  // BLINDAJE: data.data puede venir vacío o no venir
  if (!data.data || !data.data.length) {
    console.log("No data rows returned");
    document.getElementById('count').textContent =
      `Resultados en esta página: 0 — Total: ${lastTotal}`;
    return;
  }

  console.log("Rendering " + data.data.length + " rows");
  const cols = Object.keys(data.data[0]);
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  cols.forEach(c => {
    const th = document.createElement('th');

    const isOrderable = ORDERABLE_COLS.has(c);

    if (isOrderable) {
      th.style.cursor = 'pointer';
    } else {
      th.style.color = "#888";
    }

    const arrow = (c === currentOrderBy) ? (currentOrderDir === 'asc' ? ' ▲' : ' ▼') : '';
    th.textContent = c + arrow;

    if (isOrderable) {
      th.onclick = () => {
        if (currentOrderBy === c) {
          currentOrderDir = (currentOrderDir === 'asc') ? 'desc' : 'asc';
        } else {
          currentOrderBy = c;
          currentOrderDir = 'asc';
        }
        buscar(true);
      };
    }

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

function prevPage() {
  currentOffset = Math.max(0, currentOffset - pageLimit);
  buscar(false);
}
function nextPage() {
  if (currentOffset + pageLimit >= lastTotal) return;
  currentOffset = currentOffset + pageLimit;
  buscar(false);
}

// Selector de orden: si el usuario cambia los selects, actualizamos estado y buscamos
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'order_by') {
    currentOrderBy = e.target.value;
    buscar(true);
  }
  if (e.target && e.target.id === 'order_dir') {
    currentOrderDir = e.target.value;
    buscar(true);
  }
  // Filtros: cuando cambian proyecto, plano, sector, piso, ciclo, buscar nuevamente
  if (e.target && ['proyecto', 'plano', 'sector', 'piso', 'ciclo'].includes(e.target.id)) {
    buscar(true);
  }
});

(async function init() {
  if (!token()) { window.location.href = '/ui/login'; return; }
  await loadMe();
  await loadFilters();
  await loadDashboard('ciclo');
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
    # Si ya existen usuarios, bloquea bootstrap (no muestra formulario)
    if users_count() > 0:
        return HTMLResponse(
            "<h3>Bootstrap deshabilitado: ya existen usuarios.</h3><a href='/ui/login'>Volver</a>",
            status_code=403,
        )
    return BOOTSTRAP_HTML.render()

@router.get("/ui", response_class=HTMLResponse)
def ui_app():
    # anti-cache desde headers HTTP (más efectivo que solo HTML)
    html = APP_HTML.render()
    return HTMLResponse(
        content=html,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )