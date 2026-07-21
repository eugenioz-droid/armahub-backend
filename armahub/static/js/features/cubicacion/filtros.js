// ========================= CUBICACIÓN — Filtros Dependientes + Persistencia (E.4) =========================
const FILTER_STORAGE_KEY = 'armahub_filters';

// NOTA: NO persistimos `q` (búsqueda libre por ID/eje) — es input transitorio.
// Persistimos solo los selects de cascada + filtros de carga/origen.
function saveFiltersToStorage() {
  const state = {};
  ['proyecto','plano','sector','piso','ciclo','eje','filtroCarga','filtroOrigen'].forEach(f => {
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
    // Restaurar valores que no dependen de selects pobladas (ninguno hoy);
    // los selects se restauran tras `loadFilters` desde el state retornado.
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

function onProyectoChange() {
  // When project changes, reload dependent filters for that project
  const proy = document.getElementById('proyecto').value;
  // Clear dependent selects (their current values may not exist in new project)
  ['plano','sector','piso','ciclo','eje','filtroFigura','filtroTipologia'].forEach(f => { const el=document.getElementById(f); if(el) el.value = ''; });
  clearCargaFilter(true);
  loadFilters(proy ? { proyecto: proy } : null);
  loadCargasDropdown(proy);
  loadFacetasDropdown(proy);   // 5M.2: figuras/tipologías presentes en la obra
  saveFiltersToStorage();
  buscar(true);
}

// 5M.2: puebla los selectores de figura y tipología con lo PRESENTE en la obra
// (no el catálogo entero). Filtro de solo lectura para navegar.
async function loadFacetasDropdown(idProyecto) {
  var selFig = document.getElementById('filtroFigura');
  var selTip = document.getElementById('filtroTipologia');
  if (selFig) selFig.innerHTML = '<option value="">Figura: Todas</option>';
  if (selTip) selTip.innerHTML = '<option value="">Tipología: Todas</option>';
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
