// ========================= CUBICACIÓN — Filtros Dependientes + Persistencia (E.4) =========================
const FILTER_STORAGE_KEY = 'armahub_filters';

// ─────────────────────────────────────────────────────────────────────────────
// 5M.14 — CONSTANTE ÚNICA de filtros del Bar Manager (fuente de verdad).
// Antes, la lista de IDs de filtros estaba duplicada ~9 veces con subsets distintos
// → cambiar/agregar un filtro obligaba a tocar todas y "cada cambio rompía otro".
// Ahora cada lista se DERIVA de aquí. Para agregar un filtro: un objeto más, y punto.
// Flags:
//   grupo:       'ubicacion' | 'faceta' | 'avanzado'  (separa cómo se construye el param)
//   param:       nombre del query param al backend (¡casi nunca == id! ej. plano→plano_code)
//   persiste:    se guarda/restaura en sessionStorage (sobrevive F5)
//   limpiaProy:  se limpia (value='') al cambiar de obra
//   snapshot:    entra al snapshot de revert por bloqueo de edición
//   esFoco:      cuenta como "filtro activo" (proyecto NO — es la obra, no un foco)
// Flags adicionales:
//   sanea:          usa _valorFiltroValido (auto-limpia valor "fantasma") al construir el param
//   activaVistaPlana: filtro de nivel-barra → activa la vista PLANA cuando tiene valor
// CAMBIOS de comportamiento (mejoras, corrigen bugs latentes que detectó la auditoría):
//  - filtroOrigen ENTRA a la constante con limpiaProy:true → antes quedaba "pegado" al cambiar
//    de obra (no se limpiaba); ahora sí. Es avanzado, esFoco (cuenta como filtro activo).
var BM_FILTROS = [
  { id:'proyecto',        param:'proyecto',   grupo:'ubicacion', persiste:true,  limpiaProy:false, snapshot:true,  esFoco:false, sanea:false, activaVistaPlana:false },
  { id:'plano',           param:'plano_code', grupo:'ubicacion', persiste:false, limpiaProy:true,  snapshot:true,  esFoco:true,  sanea:false, activaVistaPlana:false },
  { id:'sector',          param:'sector',     grupo:'ubicacion', persiste:false, limpiaProy:true,  snapshot:true,  esFoco:true,  sanea:false, activaVistaPlana:false },
  { id:'piso',            param:'piso',       grupo:'ubicacion', persiste:false, limpiaProy:true,  snapshot:true,  esFoco:true,  sanea:false, activaVistaPlana:false },
  { id:'ciclo',           param:'ciclo',      grupo:'ubicacion', persiste:false, limpiaProy:true,  snapshot:true,  esFoco:true,  sanea:false, activaVistaPlana:false },
  { id:'eje',             param:'eje',        grupo:'ubicacion', persiste:false, limpiaProy:true,  snapshot:true,  esFoco:true,  sanea:false, activaVistaPlana:false },
  { id:'filtroFigura',    param:'figura',     grupo:'faceta',    persiste:true,  limpiaProy:true,  snapshot:true,  esFoco:true,  sanea:true,  activaVistaPlana:true  },
  { id:'filtroTipologia', param:'marca',      grupo:'faceta',    persiste:true,  limpiaProy:true,  snapshot:true,  esFoco:true,  sanea:true,  activaVistaPlana:true  },
  { id:'filtroDiametro',  param:'diam',       grupo:'faceta',    persiste:true,  limpiaProy:true,  snapshot:true,  esFoco:true,  sanea:true,  activaVistaPlana:true  },
  { id:'filtroCarga',     param:'import_id',  grupo:'avanzado',  persiste:false, limpiaProy:false, snapshot:true,  esFoco:true,  sanea:false, activaVistaPlana:false }, // se limpia vía clearCargaFilter
  { id:'filtroOrigen',    param:'origen',     grupo:'avanzado',  persiste:false, limpiaProy:true,  snapshot:false, esFoco:true,  sanea:false, activaVistaPlana:false },
];
window.BM_FILTROS = BM_FILTROS;   // contrato compartido explícito (lo usa barmanager.js)

// Derivaciones (reproducen EXACTAMENTE las listas que había, verificadas 1:1):
// 5M.9 — Persistencia SELECTIVA (F5): proyecto + figura/tipología/diámetro SÍ; el resto NO
// (recordar ubicación esconde data → "resultados fantasma"). Los NO persistidos arrancan vacíos.
const FILTER_PERSIST_KEYS = BM_FILTROS.filter(function(f){ return f.persiste; }).map(function(f){ return f.id; });

// 5M.12 — snapshot para revertir el filtro bloqueado en modo edición (congela navegación
// mientras hay cambios; el usuario debe Guardar/Descartar antes de cambiar de vista).
var _BM_FILTROS_IDS = BM_FILTROS.filter(function(f){ return f.snapshot; }).map(function(f){ return f.id; });
var _bmFiltrosSnapshot = {};   // último valor CONOCIDO/aplicado de cada filtro

// Wrapper para los filtros de faceta (figura/tipología/diámetro), que llamaban
// buscar(true) directo desde el HTML sin pasar por ningún guard.
function onFacetaFilterChange(id) {
  if (_bmBloqueadoPorEdicion(id)) return;
  saveFiltersToStorage();
  buscar(true);
}

// Guarda el estado actual de los filtros como "válido" (llamar tras cada
// búsqueda exitosa, para saber a qué revertir si luego se bloquea un cambio).
function _bmGuardarSnapshotFiltros() {
  _BM_FILTROS_IDS.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) _bmFiltrosSnapshot[id] = el.value;
  });
}

// Bloqueo de filtros MIENTRAS el modo edición está activo (no solo si hay cambios).
// Decisión de flujo: entrar a edición congela los filtros → el usuario no puede ir
// filtrando y perder el rastro de sus cambios; debe SALIR de edición (guardar/
// descartar) para volver a navegar. Avisa, revierte el select y bloquea (true).
function _bmBloqueadoPorEdicion(selectId) {
  if (typeof bmEnModoEdicion !== 'function' || !bmEnModoEdicion()) return false;
  var el = document.getElementById(selectId);
  if (el && (selectId in _bmFiltrosSnapshot)) el.value = _bmFiltrosSnapshot[selectId];
  if (typeof showToast === 'function') {
    showToast('Estás en modo edición: los filtros están bloqueados. Sal de edición (guarda o descarta) para cambiar de filtro.', 'error');
  } else {
    alert('Estás en modo edición: los filtros están bloqueados. Sal de edición para cambiar de filtro.');
  }
  return true;
}

// sessionStorage (no localStorage): sobrevive un refresh (F5) para no perder el
// trabajo por un recargado accidental, pero se BORRA al cerrar la pestaña o salir
// del Bar Manager. Así los filtros no quedan "pegados" entre sesiones/navegación.
function saveFiltersToStorage() {
  const state = {};
  FILTER_PERSIST_KEYS.forEach(f => {
    const el = document.getElementById(f);
    if (el && el.value) state[f] = el.value;
  });
  try {
    if (Object.keys(state).length) sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(FILTER_STORAGE_KEY);
  } catch(e) {}
}

function restoreFiltersFromStorage() {
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

// Limpia la memoria de filtros (al salir del Bar Manager). Los filtros no deben
// sobrevivir a la salida de la pantalla.
function clearFiltersStorage() {
  try { sessionStorage.removeItem(FILTER_STORAGE_KEY); } catch(e) {}
}

// ¿Hay algún filtro de UBICACIÓN/foco activo? (sector/piso/ciclo/eje/figura/
// tipología/diámetro/plano/carga). El proyecto NO cuenta: es la obra, no un foco.
// Lo usa el aviso al salir del Bar Manager ("se perderán los filtros").
function bmHayFiltrosActivos() {
  var ids = BM_FILTROS.filter(function(f){ return f.esFoco; }).map(function(f){ return f.id; });
  return ids.some(function(id) { var el = document.getElementById(id); return el && el.value; });
}
window.bmHayFiltrosActivos = bmHayFiltrosActivos;
window.clearFiltersStorage = clearFiltersStorage;

// Bloquea/desbloquea VISUALMENTE los filtros (al entrar/salir de modo edición).
// disabled real (refuerza el guard) + gris + tooltip. Incluye el proyecto y el
// botón de limpiar/buscar, para que quede claro que la navegación está congelada.
function bmSetFiltrosBloqueados(bloq) {
  // Bloqueo VISUAL = todos los filtros de la constante (incl. filtroOrigen) + 2 controles
  // extra que no son "filtros de datos" pero sí deben congelarse: la búsqueda libre (q, hoy
  // DOM muerto) y el input de texto del buscador de obra.
  var ids = BM_FILTROS.map(function(f){ return f.id; }).concat(['q','bmProyectoSearchInput']);
  ids.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.disabled = !!bloq;
    el.style.opacity = bloq ? '0.5' : '';
    el.style.cursor = bloq ? 'not-allowed' : '';
    el.title = bloq ? 'Bloqueado en modo edición — sal de edición para filtrar' : '';
  });
  // Banda indicadora sobre el panel de filtros.
  var panel = document.getElementById('bmFiltrosPanel');
  var aviso = document.getElementById('bmFiltrosBloqueadosAviso');
  if (bloq && !aviso && panel) {
    aviso = document.createElement('div');
    aviso.id = 'bmFiltrosBloqueadosAviso';
    aviso.textContent = '🔒 Filtros bloqueados mientras editas. Guarda o descarta para volver a filtrar.';
    aviso.style.cssText = 'background:#fff3e0; color:#e65100; border:1px solid #ffb74d; border-radius:6px; padding:5px 10px; font-size:12px; font-weight:600; margin-bottom:8px;';
    panel.insertBefore(aviso, panel.firstChild);
  } else if (!bloq && aviso) {
    aviso.remove();
  }
}
window.bmSetFiltrosBloqueados = bmSetFiltrosBloqueados;

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
  const si = document.getElementById('bmProyectoSearchInput');
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
  // 5M.10: poblar el datalist del buscador único de obra (nombre visible; el id
  // vive en el <select> oculto y se resuelve en onProyectoInput).
  _fillProyectosDatalist(data.proyectos);
  fillSelect('exportProyecto', data.proyectos, 'proyectos');
  // (5N.16: se quitaron los fillSelect de sectorProyectoFilter/matrizProyectoFilter/
  //  navProyectoFilter — eran no-ops de la matriz muerta dashboards.js, ya eliminada.)
  fillSelect('pedidoProyecto', data.proyectos, 'proyectos');
  // Dependent selects
  fillSelect('plano', data.planos, 'planos');
  fillSelect('sector', data.sectores);
  fillSelect('piso', data.pisos);
  fillSelect('ciclo', data.ciclos);
  // Eje/Losa: buscador de TEXTO (input+datalist), poblado con los ejes de la obra.
  _fillEjesDatalist(data.ejes);
  // Filtro de texto por Plano: datalist con los NOMBRES de plano de la obra (autocompletado).
  _fillPlanosDatalist(data.planos);

}

// Puebla el datalist del filtro de plano con los nombres de plano únicos de la obra.
function _fillPlanosDatalist(planos) {
  var dl = document.getElementById('bmPlanosDatalist');
  if (!dl) return;
  var nombres = [];
  (planos || []).forEach(function(p) {
    var n = (p && (p.nombre || p.code)) || '';
    n = String(n).trim();
    if (n && nombres.indexOf(n) === -1) nombres.push(n);
  });
  nombres.sort();
  dl.innerHTML = nombres.map(function(n) {
    return '<option value="' + n.replace(/"/g, '&quot;') + '"></option>';
  }).join('');
}

// 5M.10: buscador único de obra (input + datalist). El datalist muestra los
// nombres; el <select id="proyecto"> oculto conserva el id real. _proyectosCache
// mapea nombre→id para resolver lo que el usuario escribe/elige.
// Buscador de obra del Bar Manager = COMPONENTE reutilizable (shared/buscador_obra.js), el
// MISMO que usa el creador de barras. Se instancia una vez (lazy, guard anti-doble). El
// callback onElegir = onProyectoChange (recarga el Bar Manager), igual que antes.
var _bmBuscadorObra = null;
function _bmGetBuscadorObra() {
  if (!_bmBuscadorObra && window.BuscadorObra) {
    _bmBuscadorObra = window.BuscadorObra.crear({
      inputId: 'bmProyectoSearchInput',
      datalistId: 'bmProyectosDatalist',
      selectId: 'proyecto',
      onElegir: function () { onProyectoChange(); }
    });
  }
  return _bmBuscadorObra;
}
// Puebla el buscador con las obras (lo llama loadFilters). Conserva el nombre para no tocar
// a su llamador.
function _fillProyectosDatalist(proyectos) {
  var b = _bmGetBuscadorObra();
  if (b) b.setProyectos(proyectos || []);
}

// --- Lista de OBRAS con barras (CSV + manual) — mismo concepto que el landing del editor ---
// Visible SOLO cuando aún no se eligió obra. Click en una fila la selecciona en el buscador.
// Usa /proyectos (trae total_barras + total_kilos; excluye borrador globalmente).
var _bmObrasCargadas = false;
async function bmCargarObras(force) {
  var card = document.getElementById('bmObrasCard');
  if (!card) return;
  // Si ya hay obra elegida, ocultar la lista.
  var proy = (document.getElementById('proyecto') || {}).value || '';
  if (proy) { card.style.display = 'none'; return; }
  card.style.display = '';
  if (_bmObrasCargadas && !force) return;
  var data = await apiGet('/proyectos');
  var obras = (data && data.proyectos) || [];
  // Solo las que tienen barras; de mayor a menor kilos.
  obras = obras.filter(function(o){ return (o.total_barras || 0) > 0; })
               .sort(function(a,b){ return (b.total_kilos||0) - (a.total_kilos||0); });
  var body = document.getElementById('bmObrasBody');
  if (!body) return;
  var _fmt = function(v){ return Math.round(v||0).toLocaleString('es-CL'); };
  var _esc = function(s){ var d=document.createElement('div'); d.textContent=(s==null?'':String(s)); return d.innerHTML; };
  body.innerHTML = obras.map(function(o){
    var id = o.id_proyecto || o.id;
    var nom = o.nombre_proyecto || o.nombre || id;
    return '<tr style="border-top:1px solid #f0f0f0; cursor:pointer;" onmouseover="this.style.background=\'#f5faf5\'" onmouseout="this.style.background=\'\'"' +
           ' onclick="bmElegirObra(\'' + String(id).replace(/'/g,"\\'") + '\', \'' + String(nom).replace(/'/g,"\\'") + '\')">' +
           '<td style="padding:6px 8px; color:#558B2F; font-weight:600;">' + _esc(nom) + '</td>' +
           '<td style="padding:6px 8px; text-align:right;">' + _fmt(o.total_barras) + '</td>' +
           '<td style="padding:6px 8px; text-align:right;">' + _fmt(o.total_kilos) + ' kg</td></tr>';
  }).join('') || '<tr><td colspan="3" style="padding:10px; color:#b0bec5; font-style:italic;">No hay obras con barras.</td></tr>';
  _bmObrasCargadas = true;
}

// Selecciona una obra desde la lista: pone el valor en el buscador y dispara el cambio.
window.bmElegirObra = function(id, nombre) {
  var input = document.getElementById('bmProyectoSearchInput');
  var sel = document.getElementById('proyecto');
  if (input) input.value = nombre || '';
  if (sel) {
    var found = false;
    for (var i=0;i<sel.options.length;i++){ if(sel.options[i].value===id){ sel.selectedIndex=i; found=true; break; } }
    if (!found){ var op=document.createElement('option'); op.value=id; op.text=nombre||id; sel.appendChild(op); sel.value=id; }
  }
  var card = document.getElementById('bmObrasCard'); if (card) card.style.display = 'none';
  if (typeof onProyectoChange === 'function') onProyectoChange();
};

// --- Buscador de Eje/Losa (texto) — clonado del de obra, pero SIN id que resolver ---
// El eje es texto libre: lo escrito ES el valor del filtro. Se puebla el datalist con los
// ejes de la obra (una obra puede tener ~140, por eso es buscador y no <select>).
function _fillEjesDatalist(ejes) {
  var dl = document.getElementById('bmEjesDatalist');
  if (!dl) return;
  dl.innerHTML = (ejes || []).map(function(e) {
    return '<option value="' + String(e).replace(/"/g, '&quot;') + '"></option>';
  }).join('');
}

// El usuario escribió/eligió un eje. Dispara la búsqueda con el texto actual. Debounce corto
// para no rearmar en cada tecla; al elegir del datalist (change) aplica de inmediato. Igual
// que el de obra, se llama en input/change/blur. onFilterChange lee el #eje.value directo.
var _bmEjeTimer = null;
function onEjeInput() {
  if (typeof _bmBloqueadoPorEdicion === 'function' && _bmBloqueadoPorEdicion('eje')) return;
  if (_bmEjeTimer) clearTimeout(_bmEjeTimer);
  _bmEjeTimer = setTimeout(function() { _bmEjeTimer = null; onFilterChange('eje'); }, 200);
}

// Filtro de texto por PLANO (nombre_plano), con debounce. Filtra en la vista actual
// (agrupada o plana); ya NO fuerza la vista plana — eso lo controla solo el toggle.
var _bmPlanoTimer = null;
function onPlanoTxtInput() {
  if (typeof _bmBloqueadoPorEdicion === 'function' && _bmBloqueadoPorEdicion('plano')) return;
  if (_bmPlanoTimer) clearTimeout(_bmPlanoTimer);
  _bmPlanoTimer = setTimeout(function() { _bmPlanoTimer = null; buscar(true); }, 250);
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
  if (_bmBloqueadoPorEdicion('proyecto')) return;
  // When project changes, reload dependent filters for that project
  const proy = document.getElementById('proyecto').value;
  // Clear dependent selects (their current values may not exist in new project)
  BM_FILTROS.filter(function(f){ return f.limpiaProy; }).forEach(function(f){ const el=document.getElementById(f.id); if(el) el.value = ''; });
  clearCargaFilter(true);
  loadFilters(proy ? { proyecto: proy } : null);
  loadCargasDropdown(proy);
  loadFacetasDropdown(proy);   // 5M.2: figuras/tipologías presentes en la obra
  if (typeof bmResetModoEdicion === 'function') bmResetModoEdicion();  // 5M.3
  saveFiltersToStorage();
  buscar(true);
  if (typeof bmCargarObras === 'function') bmCargarObras();   // muestra/oculta la lista según haya obra
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
  if (_bmBloqueadoPorEdicion('filtroCarga')) return;
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

function onFilterChange(idOrigen) {
  if (_bmBloqueadoPorEdicion(idOrigen)) return;
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

