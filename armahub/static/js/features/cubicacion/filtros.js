// ========================= CUBICACIÓN — Filtros Dependientes + Persistencia (E.4) =========================
const FILTER_STORAGE_KEY = 'armahub_filters';

// 5M.9 — Persistencia SELECTIVA para sobrevivir refresh (F5):
//   • proyecto (obra) + filtros de nivel-barra (figura/tipología/diámetro) SÍ.
//   • ubicación (sector/piso/ciclo/eje) y avanzados (plano/carga/origen) NO:
//     recordarlos "esconde" data sin que el usuario sepa por qué (resultados
//     fantasma). Así el usuario vuelve a la OBRA y la VISTA en que estaba, con
//     los filtros de foco limpios.
// Los que NO se persisten arrancan vacíos siempre.
const FILTER_PERSIST_KEYS = ['proyecto','filtroFigura','filtroTipologia','filtroDiametro'];

function saveFiltersToStorage() {
  const state = {};
  FILTER_PERSIST_KEYS.forEach(f => {
    const el = document.getElementById(f);
    if (el && el.value) state[f] = el.value;
  });
  try {
    if (Object.keys(state).length) localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(FILTER_STORAGE_KEY);
  } catch(e) {}
}

function restoreFiltersFromStorage() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

// 5M.9: al entrar/refrescar el Bar Manager, restaura la obra guardada y sus
// filtros de nivel-barra, carga las facetas de esa obra y busca. Devuelve true
// si restauró una obra (para que el arranque no pise la selección).
async function restoreBarManagerState() {
  const state = restoreFiltersFromStorage();
  if (!state || !state.proyecto) return false;
  const selProy = document.getElementById('proyecto');
  if (!selProy) return false;
  // La obra debe existir en la lista (permisos/carga); si no, no restaurar.
  if (!Array.from(selProy.options).some(o => o.value === state.proyecto)) return false;
  selProy.value = state.proyecto;
  // Reflejar el nombre de la obra en el input de búsqueda (coherencia visual).
  const si = document.getElementById('proyectoSearchInput');
  if (si && selProy.selectedIndex >= 0) si.value = selProy.options[selProy.selectedIndex].textContent;
  // Cargar dependientes + facetas de esa obra (necesario para que las opciones
  // de figura/tipología/diámetro existan antes de re-seleccionarlas).
  await loadFilters({ proyecto: state.proyecto });
  if (typeof loadCargasDropdown === 'function') await loadCargasDropdown(state.proyecto);
  if (typeof loadFacetasDropdown === 'function') await loadFacetasDropdown(state.proyecto);
  ['filtroFigura','filtroTipologia','filtroDiametro'].forEach(function(f) {
    const el = document.getElementById(f);
    if (el && state[f] && Array.from(el.options).some(o => o.value === state[f])) el.value = state[f];
  });
  await buscar(true);
  return true;
}

async function loadFilters(depParams) {
  // Build query string for dependent filtering
  const qp = new URLSearchParams();
  if (depParams) {
    if (depParams.proyecto) qp.set('proyecto', depParams.proyecto);
    if (depParams.plano) qp.set('plano_code', depParams.plano);
    if (depParams.sector) qp.set('sector', depParams.sector);
    if (depParams.piso) qp.set('piso', depParams.piso);
    if (depParams.ciclo) qp.set('ciclo', depParams.ciclo);
  }
  const qs = qp.toString();
  const data = await apiGet('/filters' + (qs ? '?' + qs : ''));
  if (!data) return;
  
  function fillSelect(selId, items, mode = 'plain') {
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
      if (mode === 'planos') {
        o.value = x.code;
        o.textContent = x.nombre || x.code;
      } else if (mode === 'proyectos') {
        o.value = x.id;
        o.textContent = x.nombre || x.id;
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
  
  // Proyectos always full list (show nombre, value=id)
  fillSelect('proyecto', data.proyectos, 'proyectos');
  fillSelect('exportProyecto', data.proyectos, 'proyectos');
  fillSelect('sectorProyectoFilter', data.proyectos, 'proyectos');
  fillSelect('matrizProyectoFilter', data.proyectos, 'proyectos');
  fillSelect('navProyectoFilter', data.proyectos, 'proyectos');
  fillSelect('pedidoProyecto', data.proyectos, 'proyectos');
  // Dependent selects
  fillSelect('plano', data.planos, 'planos');
  fillSelect('sector', data.sectores);
  fillSelect('piso', data.pisos);
  fillSelect('ciclo', data.ciclos);
  fillSelect('eje', data.ejes);

}

// 5M.9: plegar/desplegar el bloque de filtros avanzados (plano/carga/origen).
function toggleFiltrosAvanzados() {
  var box = document.getElementById('filtrosAvanzados');
  var btn = document.getElementById('btnFiltrosAvanzados');
  if (!box) return;
  var abierto = box.style.display !== 'none';
  box.style.display = abierto ? 'none' : '';
  if (btn) btn.textContent = abierto ? '⚙ Filtros avanzados ▾' : '⚙ Filtros avanzados ▴';
}

function onProyectoChange() {
  // When project changes, reload dependent filters for that project
  const proy = document.getElementById('proyecto').value;
  // Clear dependent selects (their current values may not exist in new project)
  ['plano','sector','piso','ciclo','eje','filtroFigura','filtroTipologia','filtroDiametro'].forEach(f => { const el=document.getElementById(f); if(el) el.value = ''; });
  clearCargaFilter(true);
  loadFilters(proy ? { proyecto: proy } : null);
  loadCargasDropdown(proy);
  loadFacetasDropdown(proy);   // 5M.2: figuras/tipologías presentes en la obra
  if (typeof bmResetModoEdicion === 'function') bmResetModoEdicion();  // 5M.3
  saveFiltersToStorage();
  buscar(true);
}

// 5M.2: puebla los selectores de figura y tipología con lo PRESENTE en la obra
// (no el catálogo entero). Filtro de solo lectura para navegar.
async function loadFacetasDropdown(idProyecto) {
  var selFig = document.getElementById('filtroFigura');
  var selTip = document.getElementById('filtroTipologia');
  var selDia = document.getElementById('filtroDiametro');
  // Placeholder sin repetir el nombre del filtro (el label ya lo dice).
  if (selFig) selFig.innerHTML = '<option value="">Todas</option>';
  if (selTip) selTip.innerHTML = '<option value="">Todas</option>';
  if (selDia) selDia.innerHTML = '<option value="">Todos</option>';
  if (!idProyecto) return;
  var data = await apiGet('/barras/facetas?proyecto=' + encodeURIComponent(idProyecto));
  if (!data) return;
  if (selFig && data.figuras) {
    data.figuras.forEach(function(f) {
      var o = document.createElement('option'); o.value = f; o.textContent = f; selFig.appendChild(o);
    });
  }
  if (selTip && data.tipologias) {
    data.tipologias.forEach(function(t) {
      var o = document.createElement('option'); o.value = t; o.textContent = t; selTip.appendChild(o);
    });
  }
  // 5M.9: diámetros presentes en la obra (φ8, φ10…).
  if (selDia && data.diametros) {
    data.diametros.forEach(function(d) {
      var o = document.createElement('option'); o.value = d; o.textContent = 'φ' + d; selDia.appendChild(o);
    });
  }
}

async function loadCargasDropdown(idProyecto) {
  var sel = document.getElementById('filtroCarga');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas las cargas</option>';
  if (!idProyecto) return;
  var data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/cargas?limit=100');
  if (!data || !data.cargas || data.cargas.length === 0) return;
  data.cargas.forEach(function(c) {
    var label = (c.archivo || 'Carga #' + c.id) + ' (' + (c.barras_count || 0) + ' barras';
    if (c.kilos) label += ', ' + Math.round(c.kilos).toLocaleString('es-CL') + ' kg';
    label += ') - ' + (c.fecha ? c.fecha.substring(0, 10) : '?');
    var opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = label;
    sel.appendChild(opt);
  });
}

function onCargaFilterChange() {
  var sel = document.getElementById('filtroCarga');
  var badge = document.getElementById('cargaFilterBadge');
  if (sel && sel.value && badge) {
    var txt = sel.options[sel.selectedIndex].textContent;
    document.getElementById('cargaFilterLabel').textContent = txt;
    badge.style.display = '';
  } else if (badge) {
    badge.style.display = 'none';
  }
  saveFiltersToStorage();
  buscar(true);
}

function onFilterChange() {
  // When any sub-filter changes, reload further dependent filters
  const proy = document.getElementById('proyecto').value;
  const plano = document.getElementById('plano').value;
  const sector = document.getElementById('sector').value;
  const piso = document.getElementById('piso').value;
  const ciclo = document.getElementById('ciclo') ? document.getElementById('ciclo').value : '';
  const dep = {};
  if (proy) dep.proyecto = proy;
  if (plano) dep.plano = plano;
  if (sector) dep.sector = sector;
  if (piso) dep.piso = piso;
  if (ciclo) dep.ciclo = ciclo;
  loadFilters(Object.keys(dep).length ? dep : null);
  saveFiltersToStorage();
  buscar(true);
}
