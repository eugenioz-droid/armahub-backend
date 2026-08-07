// ========================= CUBICACIÓN — Bar Manager (vista por elementos) =========================
// Un "elemento" = barras que comparten (piso, sector, eje).
// Vista jerárquica: Elemento (parent) → Ciclos (sub) → Barras individuales.
// Vista de SOLO LECTURA: la edición/creación/eliminación se gestiona vía CSV o pedidos.

let currentOffset = 0;
const pageLimit = 50;             // 50 elementos por página
let lastTotal = 0;
let lastElementos = [];           // cache de elementos visibles
const expanded = new Set();       // claves "piso||sector||eje"
const detailCache = new Map();    // key -> array de barras

// 5M.8.3: mapa figura(código) → figura completa del catálogo, para mostrar mini-render.
// Se carga una vez, perezoso. Si no hay geometría o falla, degrada a solo texto (cero
// riesgo). Guardamos la figura ENTERA (no solo la geometría) porque el render escalado
// del botón "Ver dibujo" necesita `f.radio` para decidir si la figura es escalable
// (mismo criterio que el editor Agregar Despiece).
let _bmGeometrias = null;         // { codigo: figuraCompleta } cuando cargó con ÉXITO | null si no
let _bmGeomPromesa = null;        // promesa en curso (evita cargas duplicadas concurrentes)
// Carga las geometrías del catálogo UNA vez. Antes marcaba _bmGeometrias={} ANTES del await, así que
// si algo re-renderizaba antes de que el fetch terminara (o si fallaba), quedaba "cargado" vacío y NO
// reintentaba → el render quedaba en blanco para siempre. Ahora _bmGeometrias solo se setea al ÉXITO;
// si falla se deja null para reintentar, y las cargas concurrentes comparten la misma promesa.
async function _bmCargarGeometrias() {
  if (_bmGeometrias) return;            // ya cargado con éxito
  if (_bmGeomPromesa) return _bmGeomPromesa;   // carga en curso → esperar la misma
  _bmGeomPromesa = (async function() {
    try {
      const data = await apiGet('/figuras-catalogo');
      const mapa = {};
      (data && data.figuras || []).forEach(function(f) {
        if (f.geometria && f.geometria.tramos && f.geometria.tramos.length) {
          mapa[f.codigo] = f;          // figura completa: { codigo, geometria, radio, ... }
        }
      });
      _bmGeometrias = mapa;            // recién ahora "cargado" (con éxito)
    } catch (e) {
      _bmGeometrias = null;            // falló → permitir reintento en el próximo render
    } finally {
      _bmGeomPromesa = null;
    }
  })();
  return _bmGeomPromesa;
}
// Geometría cruda del catálogo para un código (o null). Helper para no repetir el
// acceso _bmGeometrias[codigo].geometria en varios sitios.
function _bmGeoDe(codigo) {
  var f = codigo && _bmGeometrias && _bmGeometrias[codigo];
  return (f && f.geometria) || null;
}
// Mini-SVG de la figura a tamaño fijo, SIN escalar a las dims (se usa en la celda
// "Figura" como referencia visual del tipo). '' si no hay geometría / motor.
function _bmMiniFigura(codigo) {
  var geo = _bmGeoDe(codigo);
  if (!geo) return '';
  if (!window.disenadorMotor || !window.disenadorMotor.dibujarFigura) return '';
  try {
    return window.disenadorMotor.dibujarFigura(geo, null, { width: 90, height: 72, pad: 12 });
  } catch (e) { return ''; }
}

// ── RENDER ESCALADO A LAS DIMS DE LA BARRA (columna "Render", toggle Render + S/M/L/XL) ──
// Réplica del control del editor Agregar Despiece: un toggle "Render" y tamaños S/M/L/XL. Por defecto
// DESACTIVADO (el dibujo escalado tiene costo). Análogo a AC2.render / AC2.tam / ac2SetTam del editor.
let bmVerRender = true;   // Render ON por defecto (el checkbox del HTML nace checked)
let bmTam = 'm';   // tamaño del render: s/m/l/xl (igual que AC2.tam)
// Tamaños del dibujo por lado (mismos valores que AC2_TAM del editor).
const BM_TAM = { s:{w:70,h:52}, m:{w:110,h:80}, l:{w:160,h:118}, xl:{w:220,h:160} };

// Piso visual por lado (ningún lado se dibuja menor a este % del mayor). Mismo valor
// que AC2_MIN_LADO_REL del editor: evita que un lado chico se pierda cuando otro es enorme.
const BM_MIN_LADO_REL = 0.28;
const BM_LADOS = ['A','B','C','D','E','F','G','H','I'];

// SVG de la figura ESCALADA a las medidas reales de la barra (A,B,C… reales), igual
// criterio que ac2FigSvg del editor: si la geometría trae `tramos` + `puntos` dibujados,
// sin radio y sin etiquetas-manda, se reconstruyen los puntos conservando la ORIENTACIÓN
// original pero con la LONGITUD nueva (cada lado a su dim). En figuras con radio/etiquetas
// manuales se deja el dibujo original del catálogo (deuda: los radios aún no escalan).
// Devuelve '' si no hay figura/geometría/motor (la celda degrada a solo texto).
function _bmFiguraSvg(b) {
  if (!b) return '';
  var f = b.figura && _bmGeometrias && _bmGeometrias[b.figura];
  var geo = f && f.geometria;
  if (!geo || !window.disenadorMotor || !window.disenadorMotor.dibujarFigura) return '';
  // dims {A:val,B:val,...} desde b.dim_a..dim_i (medidas reales de esta barra).
  var dims = {};
  BM_LADOS.forEach(function(L) {
    var v = b['dim_' + L.toLowerCase()];
    if (v != null && v !== '' && !isNaN(v)) dims[L] = Number(v);
  });
  var geoUse = geo;
  var tieneDims = Object.keys(dims).length > 0;
  var escalable = (tieneDims && geo.tramos && geo.tramos.length &&
                   geo.puntos && geo.puntos.length >= 2 &&
                   !f.radio && !geo.etiquetas_manda);
  if (escalable) {
    // Longitud nueva de cada segmento = dim del lado (o el largo original si falta).
    var largos = [];
    for (var mi = 0; mi < geo.tramos.length && mi + 1 < geo.puntos.length; mi++) {
      var dxm = geo.puntos[mi + 1].x - geo.puntos[mi].x;
      var dym = geo.puntos[mi + 1].y - geo.puntos[mi].y;
      var l0 = Math.sqrt(dxm * dxm + dym * dym) || 1;
      var vm = dims[geo.tramos[mi].lado];
      largos.push((vm != null && !isNaN(vm) && vm > 0) ? Number(vm) : l0);
    }
    var maxLado = Math.max.apply(null, largos.concat([1]));
    var minLado = maxLado * BM_MIN_LADO_REL;
    // Reconstruir puntos conservando la DIRECCIÓN unitaria original, con la longitud nueva.
    var op = geo.puntos, np = [{ x: op[0].x, y: op[0].y }];
    for (var si = 0; si < geo.tramos.length && si + 1 < op.length; si++) {
      var dx = op[si + 1].x - op[si].x, dy = op[si + 1].y - op[si].y;
      var len0 = Math.sqrt(dx * dx + dy * dy) || 1;
      var lnew = Math.max(largos[si], minLado);
      var ux = dx / len0, uy = dy / len0;
      var last = np[np.length - 1];
      np.push({ x: last.x + ux * lnew, y: last.y + uy * lnew });
    }
    geoUse = {}; for (var kk in geo) geoUse[kk] = geo[kk];
    geoUse.puntos = np;          // puntos re-escalados, misma orientación
    geoUse.etiquetas = [];       // sin etiquetas decorativas encima del valor
    // Mostrar el VALOR de cada lado (no la letra) en el label del tramo.
    geoUse.tramos = geo.tramos.map(function(tr) {
      var vv = dims[tr.lado]; var nt = {}; for (var k2 in tr) nt[k2] = tr[k2];
      if (vv != null) nt.lado = String(vv); return nt;
    });
  }
  try {
    var t = BM_TAM[bmTam] || BM_TAM.m;   // tamaño elegido (S/M/L/XL)
    return '<span style="display:inline-block; vertical-align:middle;">' +
      window.disenadorMotor.dibujarFigura(geoUse, dims, { width: t.w, height: t.h, pad: 20 }) +
      '</span>';
  } catch (e) { return ''; }
}

// Celda "Render" para una barra (o '' si el toggle está apagado). Se inserta en el
// header y en cada fila SIEMPRE juntos, para no descuadrar columnas.
function _bmCeldaDibujo(b) {
  if (!bmVerRender) return '';
  var svg = _bmFiguraSvg(b);
  var cont = svg || '<span class="muted" style="font-size:10px;">—</span>';
  return '<td style="padding:2px 6px; text-align:center;">' + cont + '</td>';
}

// Toggle "Render": guarda el estado, muestra/oculta los botones S/M/L/XL y re-renderiza la vista
// actual. Async: al ACTIVAR el render asegura que las geometrías estén cargadas ANTES de dibujar (si
// no, la vista plana re-renderizaba con _bmGeometrias vacío → columna Render en blanco). Análogo a
// ac2Render del editor.
async function bmToggleRender(on) {
  bmVerRender = !!on;
  var tams = document.getElementById('bmRenderTams');
  if (tams) tams.style.display = bmVerRender ? '' : 'none';
  if (bmVerRender && typeof _bmCargarGeometrias === 'function') await _bmCargarGeometrias();
  if (typeof bmReRenderVistaActual === 'function') bmReRenderVistaActual();
}
// Tamaño del render (S/M/L/XL). Pinta el botón activo (verde) y re-renderiza. Igual que ac2SetTam.
function bmSetTam(t) {
  bmTam = t;
  ['s','m','l','xl'].forEach(function(x) {
    var b = document.getElementById('bmr_' + x); if (!b) return;
    var on = (t === x); b.style.background = on ? '#8BC34A' : '#fff'; b.style.color = on ? '#fff' : '#607d8b';
  });
  if (bmVerRender && typeof bmReRenderVistaActual === 'function') bmReRenderVistaActual();
}
window.bmSetTam = bmSetTam;
window.bmToggleRender = bmToggleRender;

const SECTOR_LABEL = {
  'ELEV': 'Elevación',
  'LCIELO': 'Losas',
  'VCIELO': 'Vigas',
  'FUND': 'Fundación'
};
const SECTOR_COLOR = {
  'ELEV': '#1565C0',
  'LCIELO': '#7B1FA2',
  'VCIELO': '#00897B',
  'FUND': '#6D4C41'
};

function _elemKey(e) {
  return (e.piso || '') + '||' + (e.sector || '') + '||' + (e.eje || '');
}

function _origenBadge(o) {
  if (o === 'manual') return '<span style="background:#1565C0;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">manual</span>';
  if (o === 'pedido') return '<span style="background:#FF9800;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">pedido</span>';
  return '<span style="background:#9E9E9E;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">csv</span>';
}

function _sectorBadge(s) {
  const lbl = SECTOR_LABEL[s] || s || '—';
  const col = SECTOR_COLOR[s] || '#555';
  return '<span style="background:' + col + ';color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;">' + lbl + '</span>';
}

// Paleta estable para ciclos: hash → color suave consistente.
// 20 colores; se reciclan automáticamente si hay más ciclos (módulo).
const CICLO_PALETTE = [
  '#1565C0', '#7B1FA2', '#00897B', '#6D4C41',
  '#C62828', '#2E7D32', '#EF6C00', '#283593',
  '#AD1457', '#5D4037', '#0277BD', '#558B2F',
  '#D81B60', '#00695C', '#F4511E', '#3949AB',
  '#8E24AA', '#43A047', '#FB8C00', '#3F51B5'
];
function _cicloColor(c) {
  if (!c) return '#999';
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0;
  return CICLO_PALETTE[h % CICLO_PALETTE.length];
}
function _cicloBadge(c) {
  if (!c) return '<span class="muted">—</span>';
  const col = _cicloColor(c);
  return '<span style="background:' + col + ';color:#fff;padding:2px 7px;border-radius:9px;font-size:10px;font-weight:600;">' + c + '</span>';
}
function _ciclosCell(arr) {
  if (!arr || !arr.length) return '<span class="muted">—</span>';
  if (arr.length <= 4) return arr.map(_cicloBadge).join(' ');
  return arr.slice(0, 3).map(_cicloBadge).join(' ') +
    ' <span class="muted" style="font-size:10px;">+' + (arr.length - 3) + '</span>';
}

function _phiText(emin, emax) {
  if (emin == null && emax == null) return '—';
  if (emin === emax || emax == null) return 'φ' + emin;
  return 'φ' + emin + '–' + emax;
}

function _fmt(n, d = 0) {
  if (n == null) return '';
  return Number(n).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ========================= FETCH + RENDER =========================

function _buildFilterParams() {
  const params = new URLSearchParams();
  const proy = document.getElementById('proyecto').value;
  if (!proy) return null;
  params.set('proyecto', proy);
  // Filtros de UBICACIÓN (excepto proyecto, ya seteado arriba): value directo → su param.
  // Las facetas (figura/tipología/diámetro) y avanzados van aparte porque usan
  // _valorFiltroValido (auto-sanean valores fantasma), comportamiento distinto.
  BM_FILTROS.filter(function(f){ return f.grupo === 'ubicacion' && f.id !== 'proyecto'; })
            .forEach(function(f) {
    const el = document.getElementById(f.id);
    const v = el && el.value;
    if (v) params.set(f.param, v);
  });
  // Búsqueda libre eliminada (5M.9): el elemento 'q' ya no existe en el DOM.
  // Se mantiene la guarda por si algún flujo antiguo aún lo referencia.
  const qEl = document.getElementById('q');
  const q = qEl ? (qEl.value || '').trim() : '';
  if (q) params.set('q', q);
  // Filtro de diámetro (5M.9): activa vista plana igual que figura/tipología.
  const fd = document.getElementById('filtroDiametro');
  if (_valorFiltroValido(fd)) params.set('diam', fd.value);
  const fo = document.getElementById('filtroOrigen');
  if (fo && fo.value) params.set('origen', fo.value);
  const fc = document.getElementById('filtroCarga');
  if (fc && fc.value) params.set('import_id', fc.value);
  // 5M.2: filtros por figura y tipología (marca)
  const ff = document.getElementById('filtroFigura');
  if (_valorFiltroValido(ff)) params.set('figura', ff.value);
  const fm = document.getElementById('filtroTipologia');
  if (_valorFiltroValido(fm)) params.set('marca', fm.value);
  return params;
}

// Un <select> de faceta (figura/tipología/diámetro) solo aporta filtro si su
// valor sigue existiendo entre sus opciones. Evita que un valor PEGADO (de otra
// obra o de localStorage) filtre por algo inexistente → vista plana vacía sin
// error. Si el valor quedó fantasma, se limpia en el acto.
function _valorFiltroValido(sel) {
  if (!sel || !sel.value) return false;
  var opciones = sel.options ? Array.from(sel.options) : [];
  var existe = opciones.some(function(o) { return o.value === sel.value; });
  if (!existe) { sel.value = ''; return false; }   // auto-sanear el pegado
  return true;
}

// 5M.9: la vista PLANA se activa cuando hay un filtro de nivel-barra activo
// (figura o tipología; ampliable a diámetro después). Devuelve una tabla única de
// todas las barras del filtro, editable, sin desplegables de agrupación. Sin esos
// filtros, la vista normal AGRUPADA (piso/sector/eje → ciclos → barras).
function _modoVistaPlana() {
  // Filtros de nivel-barra (derivado de BM_FILTROS: activaVistaPlana). Agregar un 4º
  // filtro de nivel-barra = marcar su flag en la constante, sin tocar aquí.
  var campos = BM_FILTROS.filter(function(f){ return f.activaVistaPlana; }).map(function(f){ return f.id; });
  return campos.some(function(id) {
    // Usa la misma validación que _buildFilterParams: un valor pegado/fantasma
    // NO activa la vista plana (y se auto-limpia). Así no queda una tabla vacía.
    return _valorFiltroValido(document.getElementById(id));
  });
}

async function buscar(reset = false) {
  if (reset) {
    currentOffset = 0;
    expanded.clear();
    detailCache.clear();
    // 5M.11: al cambiar el filtro/lista, la selección previa ya no aplica.
    if (typeof bmLimpiarSeleccion === 'function') bmLimpiarSeleccion();
  }

  const kpisEl = document.getElementById('bmKpis');
  const countEl = document.getElementById('count');
  const tbl = document.getElementById('tabla');
  const pageInfo = document.getElementById('pageInfo');

  const params = _buildFilterParams();
  if (!params) {
    kpisEl.innerHTML = '<span class="muted">Selecciona un proyecto…</span>';
    countEl.textContent = '';
    tbl.innerHTML = '';
    pageInfo.textContent = '';
    if (_coberturaVisible) loadCobertura();
    return;
  }

  params.set('limit', pageLimit);
  params.set('offset', currentOffset);

  if (typeof saveFiltersToStorage === 'function') saveFiltersToStorage();
  // 5M.8.3: cargar geometrías del catálogo (perezoso) para el mini-render de figura.
  if (typeof _bmCargarGeometrias === 'function') await _bmCargarGeometrias();

  // Bifurcación vista plana / agrupada (5M.9).
  if (_modoVistaPlana()) {
    await _buscarPlano(params);
    return;
  }

  const data = await apiGet('/barras/elementos?' + params.toString());
  if (!data) return;

  lastTotal = data.total || 0;
  lastElementos = data.data || [];
  const summary = data.summary || {};

  // KPIs. Nomenclatura estandarizada: elementos (agrupaciones) · items (nº de filas/entradas =
  // barras_total COUNT) · barras (físicas = Σ cant_total) · kg.
  kpisEl.innerHTML =
    '<span><strong>' + _fmt(summary.elementos_total || 0) + '</strong> elementos</span>' +
    '<span class="muted">·</span>' +
    '<span title="Entradas / filas"><strong>' + _fmt(summary.barras_total || 0) + '</strong> items</span>' +
    '<span class="muted">·</span>' +
    '<span title="Barras físicas = Σ (cantidad × multiplicador)"><strong>' + _fmt(summary.cant_total_sum || 0) + '</strong> barras</span>' +
    '<span class="muted">·</span>' +
    '<span><strong>' + _fmt(summary.kg_total || 0, 1) + '</strong> kg</span>' +
    '<span class="muted">·</span>' +
    '<span>' + _fmt(summary.pisos_count || 0) + ' pisos</span>' +
    '<span class="muted">·</span>' +
    '<span>' + _fmt(summary.sectores_count || 0) + ' sectores</span>' +
    '<span class="muted">·</span>' +
    '<span>' + _fmt(summary.ejes_count || 0) + ' ejes</span>';

  const cargaActive = document.getElementById('filtroCarga') && document.getElementById('filtroCarga').value;
  countEl.textContent = (cargaActive ? 'Filtrado por carga · ' : '') +
    _fmt(lastTotal) + ' elemento' + (lastTotal === 1 ? '' : 's');

  const page = Math.floor(currentOffset / pageLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(lastTotal / pageLimit));
  pageInfo.textContent = 'Pág ' + page + '/' + totalPages;

  _renderElementos();

  // Si la matriz de cobertura está visible, mantenerla sincronizada con los filtros.
  if (_coberturaVisible) {
    loadCobertura();
  }

  // 5M.3: panel de ediciones manuales recientes de la obra.
  if (typeof cargarEdicionesRecientes === 'function') cargarEdicionesRecientes();
  if (typeof bmCargarEliminadas === 'function') bmCargarEliminadas();   // panel de barras eliminadas (historial)
  // 5M.12: esta combinación de filtros quedó aplicada con éxito — es el estado
  // al que hay que revertir si luego se bloquea un cambio con edición pendiente.
  if (typeof _bmGuardarSnapshotFiltros === 'function') _bmGuardarSnapshotFiltros();
}

// ========================= VISTA PLANA (5M.9) =========================
// Tabla única de todas las barras del filtro (figura/tipología), editable, paginada,
// sin desplegables. Mismas columnas que el detalle agrupado.
var lastBarrasPlano = [];

async function _buscarPlano(params) {
  const kpisEl = document.getElementById('bmKpis');
  const countEl = document.getElementById('count');
  const tbl = document.getElementById('tabla');
  const pageInfo = document.getElementById('pageInfo');

  // El endpoint /barras espera 'proyecto' + filtros; ya vienen en params. Orden CONSTRUCTIVO
  // (piso bajo→alto → sector → ciclo → eje → diam): antes ordenaba por plano_code alfabético y los
  // pisos salían desordenados (P1, P10, P2…). El criterio lo define el backend (ORDER_CONSTRUCTIVO_SQL).
  params.set('order_by', 'constructivo');
  params.set('order_dir', 'asc');
  const data = await apiGet('/barras?' + params.toString());
  if (!data) return;

  lastBarrasPlano = data.data || [];
  lastTotal = data.total || lastBarrasPlano.length;

  // KPIs simples de la vista plana.
  const sumKg = lastBarrasPlano.reduce((s, b) => s + (Number(b.peso_total) || 0), 0);
  const sumCant = lastBarrasPlano.reduce((s, b) => s + (Number(b.cant_total) || 0), 0);
  kpisEl.innerHTML =
    '<span style="color:#5d4037; font-weight:600;">📋 Vista plana</span>' +
    '<span class="muted">·</span>' +
    '<span title="Entradas / filas del filtro"><strong>' + _fmt(lastTotal) + '</strong> items (filtro)</span>' +
    '<span class="muted">·</span>' +
    '<span title="Barras físicas de la página = Σ cant_total"><strong>' + _fmt(sumCant) + '</strong> barras pág.</span>' +
    '<span class="muted">·</span>' +
    '<span><strong>' + _fmt(sumKg, 1) + '</strong> kg pág.</span>';
  countEl.textContent = _fmt(lastTotal) + ' item' + (lastTotal === 1 ? '' : 's') + ' (mostrando ' + lastBarrasPlano.length + ')';
  const page = Math.floor(currentOffset / pageLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(lastTotal / pageLimit));
  pageInfo.textContent = 'Pág ' + page + '/' + totalPages;

  _renderPlano();

  if (_coberturaVisible) loadCobertura();
  if (typeof cargarEdicionesRecientes === 'function') cargarEdicionesRecientes();
  if (typeof bmCargarEliminadas === 'function') bmCargarEliminadas();   // panel de barras eliminadas (historial)
  if (typeof _bmGuardarSnapshotFiltros === 'function') _bmGuardarSnapshotFiltros();
}

// 5M.9 optimistic update: actualiza una barra en las estructuras en memoria
// (vista plana + cache de detalles agrupados) sin re-pedir la lista.
function bmActualizarBarraEnMemoria(barra) {
  if (!barra || barra.id == null) return;
  // Vista plana.
  for (let i = 0; i < lastBarrasPlano.length; i++) {
    if (lastBarrasPlano[i].id === barra.id) { lastBarrasPlano[i] = barra; break; }
  }
  // Cache de detalles agrupados (detailCache: key → [barras]).
  if (typeof detailCache !== 'undefined' && detailCache.forEach) {
    detailCache.forEach(function(barras, key) {
      for (let j = 0; j < barras.length; j++) {
        if (barras[j].id === barra.id) { barras[j] = barra; break; }
      }
    });
  }
}
window.bmActualizarBarraEnMemoria = bmActualizarBarraEnMemoria;

// Re-renderiza la vista activa (plana o agrupada) desde memoria, sin fetch.
function bmReRenderVistaActual() {
  if (typeof _modoVistaPlana === 'function' && _modoVistaPlana()) {
    _renderPlano();
  } else {
    _renderElementos();
    if (typeof reRenderDetallesAbiertos === 'function') reRenderDetallesAbiertos();
  }
}
window.bmReRenderVistaActual = bmReRenderVistaActual;

function _renderPlano() {
  const tbl = document.getElementById('tabla');
  if (!lastBarrasPlano.length) {
    tbl.innerHTML = '<tbody><tr><td style="padding:12px; color:#888;">No hay barras con ese filtro.</td></tr></tbody>';
    return;
  }
  const editando = (typeof bmEnModoEdicion === 'function') && bmEnModoEdicion();
  // Contenedor con scroll acotado SIEMPRE (no solo en edición). Con solo overflow-x
  // la barra de scroll horizontal quedaba al final de toda la tabla (había que bajar
  // toda la página para alcanzarla → "el panel me queda fuera / no lo veo completo").
  // Con max-height el viewport queda acotado y la barra horizontal siempre es accesible.
  // max-width:100% ata el ancho al card para que el scroll interno reciba el desborde.
  const scrollWrap = editando
    ? 'overflow:auto; max-height:65vh; max-width:100%;'
    : 'overflow:auto; max-height:70vh; max-width:100%;';
  // 5M.11: columna de selección solo en modo MASIVO (no en edición normal).
  var masivo = (typeof bmEnModoMasivo === 'function') && bmEnModoMasivo();
  var colSel = masivo
    ? '<th style="text-align:center; padding:3px 4px;"><input type="checkbox" id="bmSelTodas" onclick="bmToggleSeleccionTodas(this.checked)" title="Marcar todas" /></th>'
    : '';
  let html = '<tbody><tr><td style="padding:0;"><div style="' + scrollWrap + '">' +
    '<table style="width:100%; min-width:1300px; font-size:11px; border-collapse:collapse;">' +
    '<thead><tr style="color:#666; background:#fafafa; position:sticky; top:0;">' +
    colSel +
    '<th style="text-align:left; padding:3px 6px;">Piso</th>' +
    '<th style="text-align:left; padding:3px 6px;">Sector</th>' +
    '<th style="text-align:left; padding:3px 6px;">Ciclo</th>' +
    '<th style="text-align:left; padding:3px 6px;">Eje</th>' +
    '<th style="text-align:left; padding:3px 6px;">Tipología</th>' +
    '<th style="text-align:right; padding:3px 6px;">φ</th>' +
    '<th style="text-align:right; padding:3px 6px;">Cant</th>' +
    '<th style="text-align:right; padding:3px 6px;">Largo</th>' +
    '<th style="text-align:right; padding:3px 6px;">Peso Tot</th>' +
    '<th style="text-align:left; padding:3px 6px;">Figura</th>' +
    // Columna "Render" solo con el toggle activo. El <td> correspondiente lo agrega
    // _bmFilaBarraHTML con el mismo flag, para no descuadrar header vs filas.
    (bmVerRender ? '<th style="text-align:center; padding:3px 6px;">Render</th>' : '') +
    ['A','B','C','D','E','F','G','H','I'].map(L => '<th style="text-align:right; padding:3px 6px;">' + L + '</th>').join('') +
    ['α1','α2','α3','α4'].map(L => '<th style="text-align:right; padding:3px 6px;">' + L + '</th>').join('') +
    '<th style="text-align:right; padding:3px 6px;">R</th>' +
    (editando ? '<th style="text-align:center; padding:3px 6px;">🗑</th>' : '') +
    '</tr></thead><tbody>';
  lastBarrasPlano.forEach(b => {
    html += _bmFilaBarraHTML(b, editando, true);
  });
  html += '</tbody></table></div></td></tr></tbody>';
  tbl.innerHTML = html;
  // Validar filas en modo edición (resalta incoherentes).
  if (editando && typeof bmValidarTodasLasFilas === 'function') setTimeout(bmValidarTodasLasFilas, 30);
  // 5M.11: sincronizar checkbox "todas" + contador tras el re-render (modo masivo).
  if (masivo) {
    var selTodas = document.getElementById('bmSelTodas');
    if (selTodas && typeof bmSeleccionCount === 'function') {
      var n = bmSeleccionCount();
      selTodas.checked = (n > 0 && n === lastBarrasPlano.length);
    }
    if (typeof bmActualizarBarraSeleccion === 'function') bmActualizarBarraSeleccion();
  }
}

function _renderElementos() {
  const tbl = document.getElementById('tabla');
  if (!lastElementos.length) {
    tbl.innerHTML =
      '<tr><td colspan="10" class="muted" style="padding:24px; text-align:center;">' +
      'Sin elementos para los filtros actuales.</td></tr>';
    return;
  }

  let html = '<thead><tr style="font-size:11px; background:#f7f7f7;">' +
    '<th style="width:24px;"></th>' +
    '<th style="padding:6px 8px; text-align:left;">Piso</th>' +
    '<th style="padding:6px 8px; text-align:left;">Sector</th>' +
    '<th style="padding:6px 8px; text-align:left;">Ciclos</th>' +
    '<th style="padding:6px 8px; text-align:left;">Eje</th>' +
    '<th style="padding:6px 8px; text-align:right;">Items</th>' +
    '<th style="padding:6px 8px; text-align:right;">Σ Cant</th>' +
    '<th style="padding:6px 8px; text-align:right;">Σ Largo (cm)</th>' +
    '<th style="padding:6px 8px; text-align:right;">Σ Kg</th>' +
    '<th style="padding:6px 8px; text-align:left;">φ / Origen</th>' +
    '</tr></thead><tbody>';

  lastElementos.forEach((e, idx) => {
    const key = _elemKey(e);
    const isOpen = expanded.has(key);
    const arrow = isOpen ? '▾' : '▸';
    const safeKey = key.replace(/'/g, "\\'");

    const origenes = (e.origenes || []).map(_origenBadge).join(' ');

    html += '<tr class="bm-elem-row" style="cursor:pointer; border-top:1px solid #eee;" ' +
      'onclick="toggleElemento(' + idx + ')">' +
      '<td style="padding:6px 4px; text-align:center; color:#1565C0; font-weight:700;">' + arrow + '</td>' +
      '<td style="padding:6px 8px; font-weight:600;">' + (e.piso || '—') + '</td>' +
      '<td style="padding:6px 8px;">' + _sectorBadge(e.sector) + '</td>' +
      '<td style="padding:6px 8px;">' + _ciclosCell(e.ciclos) + '</td>' +
      '<td style="padding:6px 8px; font-family:monospace; font-weight:600;">' + (e.eje || '—') + '</td>' +
      '<td style="padding:6px 8px; text-align:right;">' + _fmt(e.items) + '</td>' +
      '<td style="padding:6px 8px; text-align:right;">' + _fmt(e.sum_cant_total) + '</td>' +
      '<td style="padding:6px 8px; text-align:right;">' + _fmt(e.sum_largo_total) + '</td>' +
      '<td style="padding:6px 8px; text-align:right; font-weight:600;">' + _fmt(e.sum_kg, 1) + '</td>' +
      '<td style="padding:6px 8px;"><span style="color:#666; font-size:11px;">' + _phiText(e.diam_min, e.diam_max) + '</span> ' + origenes + '</td>' +
      '</tr>';

    html += '<tr class="bm-elem-detail" id="bm-detail-' + idx + '" style="display:' + (isOpen ? '' : 'none') + ';">' +
      '<td></td><td colspan="9" style="padding:0 12px 8px 12px; background:#fafbfc;">' +
      '<div id="bm-detail-content-' + idx + '" class="muted" style="font-size:11px; padding:8px;">' +
      (isOpen ? 'Cargando…' : '') +
      '</div></td></tr>';
  });

  html += '</tbody>';
  tbl.innerHTML = html;

  // Hidratar detalles ya expandidos
  lastElementos.forEach((e, idx) => {
    if (expanded.has(_elemKey(e))) _hydrateDetail(idx);
  });
}

async function toggleElemento(idx) {
  const e = lastElementos[idx]; if (!e) return;
  const key = _elemKey(e);
  const row = document.getElementById('bm-detail-' + idx);
  const arrowCell = row && row.previousElementSibling && row.previousElementSibling.firstElementChild;

  if (expanded.has(key)) {
    expanded.delete(key);
    if (row) row.style.display = 'none';
    if (arrowCell) arrowCell.textContent = '▸';
    return;
  }
  expanded.add(key);
  if (row) row.style.display = '';
  if (arrowCell) arrowCell.textContent = '▾';
  await _hydrateDetail(idx);
}

async function _hydrateDetail(idx) {
  const e = lastElementos[idx]; if (!e) return;
  const key = _elemKey(e);
  const cont = document.getElementById('bm-detail-content-' + idx);
  if (!cont) return;

  let barras = detailCache.get(key);
  if (!barras) {
    cont.textContent = 'Cargando…';
    const params = _buildFilterParams();
    if (!params) return;
    // Sobreescribir con filtros del elemento (independiente de los selects)
    params.set('piso', e.piso || '');
    params.set('sector', e.sector || '');
    params.delete('ciclo');                 // permitir TODOS los ciclos del elemento
    params.set('eje', e.eje || '');
    params.delete('q');
    params.set('limit', '500');
    params.set('offset', '0');
    params.set('order_by', 'constructivo');   // dentro del elemento: ciclo → eje → diam (criterio único)
    params.set('order_dir', 'asc');
    const res = await apiGet('/barras?' + params.toString());
    barras = (res && res.data) ? res.data : [];
    detailCache.set(key, barras);
  }
  _renderDetail(cont, e, barras);
  // 5M.4: si está en modo edición, validar las filas recién dibujadas (resalta rojo).
  if (typeof bmValidarTodasLasFilas === 'function') setTimeout(bmValidarTodasLasFilas, 30);
}

// 5M.3: re-dibuja los detalles ya expandidos (sin re-fetch) al cambiar el modo
// edición, para que aparezcan/desaparezcan los inputs.
function reRenderDetallesAbiertos() {
  lastElementos.forEach(function(e, idx) {
    var cont = document.getElementById('bm-detail-content-' + idx);
    if (!cont) return;
    var row = document.getElementById('bm-detail-' + idx);
    if (row && row.style.display === 'none') return; // no expandido
    var barras = detailCache.get(_elemKey(e));
    if (barras) _renderDetail(cont, e, barras);
  });
}
window.reRenderDetallesAbiertos = reRenderDetallesAbiertos;

// 5M.9: render de UNA fila de barra, compartido por la vista agrupada (_renderDetail)
// y la vista plana (_renderPlano). conUbicacion=true antepone piso/sector/ciclo/eje.
function _bmFilaBarraHTML(b, editando, conUbicacion) {
  function _n(v, d) { if (v == null || v === '' || isNaN(v)) return ''; return d ? Number(v).toFixed(d) : Math.round(Number(v)); }
  function _celdaEdit(campo, val, dec, ancho) {
    if (!editando) return '<td style="padding:2px 6px; text-align:right; color:#444;">' + _n(val, dec) + '</td>';
    // Valor EFECTIVO: el cambio pendiente si existe, si no el de memoria. Así un
    // re-render (marcar todas, togglear masivo, paginar) NUNCA pierde los cambios.
    var ef = (typeof bmValorEfectivoCelda === 'function') ? bmValorEfectivoCelda(b.id, campo, val) : { valor: val, tocado: false };
    var v = ef.valor;
    // Un lado/ángulo/radio NO usado se guarda como 0 en el backend (no NULL). Para
    // el usuario, 0 = "vacío" (lado que la figura no usa). Mostrar el 0 hacía que un
    // borrado pareciera no haber funcionado (reaparecía "0"). Por eso 0 → vacío.
    var esGeom = /^(dim_|ang|radio)/.test(campo);
    var mostrar = (v == null || (esGeom && Number(v) === 0)) ? '' : v;
    var bg = ef.tocado ? ' background:#fff3cd;' : '';   // amarillo = modificado sin guardar
    return '<td style="padding:1px 3px; text-align:right;"><input type="number" step="any" value="' + mostrar +
      '" data-barra-id="' + b.id + '" data-campo="' + campo + '" id="bmcell-' + b.id + '-' + campo + '" onchange="bmRegistrarCambio(this)" ' +
      'style="width:' + (ancho || 60) + 'px; font-size:11px; text-align:right; padding:1px 3px;' + bg + '" /></td>';
  }
  function _celdaFigura() {
    if (!editando) {
      // La columna Figura muestra SOLO el código (como en el editor). El DIBUJO de la figura vive en
      // la columna "Render" aparte, controlada por el toggle Render + S/M/L/XL — así no hay dos dibujos
      // duplicados (antes esta celda tenía un mini-render fijo, redundante con la columna Render).
      var cont = (b.figura || '—');
      return '<td style="padding:2px 6px; color:#666; white-space:nowrap;">' + cont + '</td>';
    }
    var efF = (typeof bmValorEfectivoCelda === 'function') ? bmValorEfectivoCelda(b.id, 'figura', b.figura) : { valor: b.figura, tocado: false };
    var bgF = efF.tocado ? ' background:#fff3cd;' : '';
    return '<td style="padding:1px 3px;"><input type="text" list="bmFigurasDatalist" value="' + (efF.valor || '') +
      '" data-barra-id="' + b.id + '" data-campo="figura" id="bmcell-' + b.id + '-figura" onchange="bmRegistrarCambio(this)" ' +
      'style="width:64px; font-size:11px; padding:1px 3px;' + bgF + '" /></td>';
  }
  // Celda del LARGO. Si hay cambios de geometría pendientes, muestra el largo YA
  // recalculado (suma de lados efectivos) en color, con nota "se guardará así".
  // Si no, el largo de memoria. Evita el desconcierto de ver el largo viejo (192)
  // cuando los lados ya suman otra cosa (180).
  function _celdaLargo() {
    var lEf = (editando && typeof bmLargoEfectivo === 'function') ? bmLargoEfectivo(b) : null;
    var idAttr = ' id="bmlargo-' + b.id + '"';
    if (lEf != null) {
      return '<td' + idAttr + ' style="padding:2px 6px; text-align:right; color:#1565c0; font-weight:600;" title="Largo recalculado de los lados (se guardará así)">' + _n(lEf, 0) + '</td>';
    }
    return '<td' + idAttr + ' style="padding:2px 6px; text-align:right; color:#888;" title="Se calcula de la suma de los lados">' + _n(b.largo_total, 0) + '</td>';
  }
  var dimKeys = ['dim_a','dim_b','dim_c','dim_d','dim_e','dim_f','dim_g','dim_h','dim_i'];
  var angKeys = ['ang1','ang2','ang3','ang4'];
  var dims = dimKeys.map(k => _celdaEdit(k, b[k], 0)).join('');
  var angs = angKeys.map(k => _celdaEdit(k, b[k], 1)).join('');
  var editadaBorde = b.editado_por ? 'border-left:3px solid #8d6e63;' : '';
  var editadaTitle = b.editado_por ? (' title="Editada por ' + b.editado_por + '"') : '';
  // Resalte azul suave si la barra está SELECCIONADA en modo masivo (mismo criterio que el creador).
  var selBg = ((typeof bmEnModoMasivo === 'function') && bmEnModoMasivo()
               && (typeof bmEstaSeleccionada === 'function') && bmEstaSeleccionada(b.id))
    ? 'background:#e3f2fd;' : '';
  var ubic = '';
  if (conUbicacion) {
    // 5M.11: celda de selección (solo en modo MASIVO, vista plana).
    var selCell = '';
    if ((typeof bmEnModoMasivo === 'function') && bmEnModoMasivo()) {
      var checked = (typeof bmEstaSeleccionada === 'function' && bmEstaSeleccionada(b.id)) ? ' checked' : '';
      selCell = '<td style="padding:2px 4px; text-align:center;"><input type="checkbox"' + checked +
        ' onclick="bmToggleSeleccion(' + b.id + ', this.checked)" /></td>';
    }
    ubic = selCell +
      '<td style="padding:2px 6px; font-size:10px;">' + (b.piso || '—') + '</td>' +
      '<td style="padding:2px 6px;">' + _sectorBadge(b.sector) + '</td>' +
      '<td style="padding:2px 6px;">' + _cicloBadge(b.ciclo) + '</td>' +
      '<td style="padding:2px 6px; font-size:10px;">' + (b.eje || '—') + '</td>';
  } else {
    var idShort = (b.id_unico || '').split('-').slice(-1)[0];
    ubic = '<td style="padding:2px 6px; font-family:monospace; font-size:10px; position:sticky; left:0; background:#fff;" title="' + (b.id_unico || '') + '">' + (b.editado_por ? '✏️ ' : '') + idShort + '</td>';
  }
  var html = '<tr id="bmrow-' + b.id + '" style="border-top:1px solid #f0f0f0; ' + editadaBorde + selBg + '"' + editadaTitle + '>' +
    ubic +
    '<td style="padding:2px 6px; font-weight:600;">' + (conUbicacion && b.editado_por ? '✏️ ' : '') + (b.marca || '—') + '</td>' +
    _celdaEdit('diam', b.diam, 0) +
    _celdaEdit('cant_total', b.cant_total, 0) +
    _celdaLargo();
  if (!conUbicacion) html += '<td style="padding:2px 6px; text-align:right;">' + _n(b.peso_unitario, 2) + '</td>';
  html += '<td style="padding:2px 6px; text-align:right;">' + _n(b.peso_total, 1) + '</td>';
  if (!conUbicacion) {
    html += '<td style="padding:2px 6px;">' + _origenBadge(b.origen) + '</td>' +
      '<td style="padding:2px 6px; color:#666;">' + (b.plano_code || '—') + '</td>';
  }
  // Celda "Render" tras Figura (solo con el toggle activo). _bmCeldaDibujo devuelve ''
  // cuando está apagado, así el <td> aparece SIEMPRE junto a su <th> (no descuadra).
  html += _celdaFigura() + _bmCeldaDibujo(b) + dims + angs + _celdaEdit('radio', b.radio, 1);
  // Acción ELIMINAR por fila: solo en modo edición. Borra la barra (con registro histórico).
  if ((typeof bmEnModoEdicion === 'function') && bmEnModoEdicion()) {
    html += '<td style="padding:2px 6px; text-align:center;">' +
      '<span onclick="bmEliminarBarra(' + b.id + ')" title="Eliminar esta barra (queda solo en el historial)" ' +
      'style="color:#c62828; cursor:pointer; font-size:13px;">🗑</span></td>';
  }
  html += '</tr>';
  return html;
}

function _renderDetail(cont, elem, barras) {
  if (!barras.length) {
    cont.innerHTML = '<em>Sin barras detalladas para este elemento.</em>';
    return;
  }
  const editando = (typeof bmEnModoEdicion === 'function') && bmEnModoEdicion();
  // Agrupar por ciclo
  const byCiclo = {};
  barras.forEach(b => {
    const c = b.ciclo || '—';
    (byCiclo[c] = byCiclo[c] || []).push(b);
  });
  const ciclos = Object.keys(byCiclo).sort((a, b) => {
    const na = parseInt((a.match(/\d+/) || [0])[0], 10);
    const nb = parseInt((b.match(/\d+/) || [0])[0], 10);
    return na - nb || a.localeCompare(b);
  });

  const dimKeys = ['dim_a','dim_b','dim_c','dim_d','dim_e','dim_f','dim_g','dim_h','dim_i'];
  const dimLabels = ['A','B','C','D','E','F','G','H','I'];
  const angKeys = ['ang1','ang2','ang3','ang4'];
  const angLabels = ['α1','α2','α3','α4'];

  function _num(v, d = 0) {
    if (v == null || v === '' || isNaN(v)) return '';
    return d ? Number(v).toFixed(d) : Math.round(Number(v));
  }

  let html = '';
  ciclos.forEach(c => {
    const grp = byCiclo[c];
    const sumKg = grp.reduce((s, b) => s + (Number(b.peso_total) || 0), 0);
    const sumCant = grp.reduce((s, b) => s + (Number(b.cant_total) || 0), 0);
    // 5M.4: el contenedor de la tabla tiene alto acotado con scroll SIEMPRE (antes solo
    // en edición) para que la barra de scroll horizontal quede accesible (no al final de
    // toda la data → antes había que bajar toda la página para alcanzarla). max-width:100%
    // ata el ancho al card para que el desborde vaya al scroll interno, no fuera de pantalla.
    const scrollWrap = editando
      ? 'overflow:auto; max-height:60vh; max-width:100%;'
      : 'overflow:auto; max-height:60vh; max-width:100%;';
    html += '<div style="margin:6px 0; border-left:3px solid ' + _cicloColor(c) + '; padding:4px 10px; background:#fff; border-radius:0 4px 4px 0;">' +
      '<div style="font-size:11px; color:' + _cicloColor(c) + '; font-weight:700; margin-bottom:4px;">' +
      'Ciclo ' + c + ' · ' + grp.length + ' items · ' + _fmt(sumCant) + ' barras · ' + _fmt(sumKg, 1) + ' kg' +
      '</div>' +
      '<div style="' + scrollWrap + '">' +
      '<table style="width:100%; min-width:1100px; font-size:11px; border-collapse:collapse;">' +
      '<thead><tr style="color:#666; background:#fafafa;">' +
      '<th style="text-align:left; padding:2px 6px; position:sticky; left:0; background:#fafafa;">ID</th>' +
      '<th style="text-align:left; padding:2px 6px;">Tipología</th>' +
      '<th style="text-align:right; padding:2px 6px;">φ</th>' +
      '<th style="text-align:right; padding:2px 6px;">Cant</th>' +
      '<th style="text-align:right; padding:2px 6px;">Largo</th>' +
      '<th style="text-align:right; padding:2px 6px;">Peso U.</th>' +
      '<th style="text-align:right; padding:2px 6px;">Peso Tot</th>' +
      '<th style="text-align:left; padding:2px 6px;">Origen</th>' +
      '<th style="text-align:left; padding:2px 6px;">Plano</th>' +
      '<th style="text-align:left; padding:2px 6px;">Figura</th>' +
      // Columna "Render" solo con el toggle activo (mismo flag que el <td> en _bmFilaBarraHTML).
      (bmVerRender ? '<th style="text-align:center; padding:2px 6px;">Render</th>' : '') +
      dimLabels.map(L => '<th style="text-align:right; padding:2px 6px;">' + L + '</th>').join('') +
      angLabels.map(L => '<th style="text-align:right; padding:2px 6px;">' + L + '</th>').join('') +
      '<th style="text-align:right; padding:2px 6px;">R</th>' +
      (editando ? '<th style="text-align:center; padding:2px 6px;">🗑</th>' : '') +
      '</tr></thead><tbody>';
    grp.forEach(b => {
      html += _bmFilaBarraHTML(b, editando, false);
    });
    html += '</tbody></table></div></div>';
  });
  cont.innerHTML = html;
}

// ========================= EXPANDIR / COLAPSAR TODOS =========================
async function expandAll() {
  if (!lastElementos.length) return;
  for (let i = 0; i < lastElementos.length; i++) {
    const key = _elemKey(lastElementos[i]);
    if (!expanded.has(key)) expanded.add(key);
  }
  _renderElementos();
}

function collapseAll() {
  expanded.clear();
  _renderElementos();
}

// ========================= MAPA DE COBERTURA PISO × CICLO =========================
let _coberturaVisible = false;

function toggleCobertura() {
  _coberturaVisible = !_coberturaVisible;
  const card = document.getElementById('bmCoberturaCard');
  const btn = document.getElementById('btnCobertura');
  if (_coberturaVisible) {
    card.style.display = '';
    if (btn) btn.textContent = '📊 Ocultar cobertura';
    loadCobertura();
  } else {
    card.style.display = 'none';
    if (btn) btn.textContent = '📊 Mostrar cobertura';
  }
}

async function loadCobertura() {
  const cont = document.getElementById('bmCoberturaContent');
  const info = document.getElementById('bmCoberturaInfo');
  const proy = document.getElementById('proyecto').value;
  if (!proy) {
    cont.innerHTML = '<div class="muted" style="padding:12px;">Selecciona un proyecto.</div>';
    if (info) info.textContent = '';
    return;
  }
  cont.innerHTML = '<div class="muted" style="padding:12px;">Cargando…</div>';

  // Reusa los filtros de proyecto/plano/sector/origen/carga (ignora piso/ciclo/eje
  // porque la matriz se construye sobre TODOS los pisos y ciclos del scope).
  const params = new URLSearchParams();
  params.set('proyecto', proy);
  ['plano', 'sector'].forEach(f => {
    const v = document.getElementById(f) && document.getElementById(f).value;
    if (v) params.set(f === 'plano' ? 'plano_code' : f, v);
  });
  const fo = document.getElementById('filtroOrigen');
  if (fo && fo.value) params.set('origen', fo.value);
  const fc = document.getElementById('filtroCarga');
  if (fc && fc.value) params.set('import_id', fc.value);

  const data = await apiGet('/barras/cobertura?' + params.toString());
  if (!data) { cont.innerHTML = '<div class="muted">Sin datos.</div>'; return; }

  _renderCobertura(cont, data, info);
}

// M1.2: el criterio de pisos vive en shared/orden_pisos.js (pisoOrder global).

function _renderCobertura(cont, data, info) {
  if (!data.pisos.length || !data.ciclos.length) {
    cont.innerHTML = '<div class="muted" style="padding:12px;">No hay datos para los filtros actuales.</div>';
    if (info) info.textContent = '';
    return;
  }

  // Sectores estructurales (orden vertical fijo en cada piso).
  const SECT_NORMALES = ['LCIELO', 'VCIELO', 'ELEV'];
  const SECT_FUND = 'FUND';

  // ── Reagrupar: cualquier barra con sector=FUND se "atribuye" al piso PF
  // (las fundaciones viven en el nivel base). Si su piso original no era PF,
  // se acumula igual y se registra advertencia para el usuario.
  const fundMisPlaced = {}; // { pisoOriginal: { ciclo: {barras, kg} } }
  const cellsRegrouped = []; // [{piso, ciclo, sector, barras, kg}]
  const pfAcc = {};          // { ciclo: {barras, kg} }

  data.cells.forEach(c => {
    if ((c.sector || '').toUpperCase() === SECT_FUND) {
      const pisoUp = (c.piso || '').toUpperCase().trim();
      if (pisoUp !== 'PF') {
        if (!fundMisPlaced[c.piso]) fundMisPlaced[c.piso] = {};
        const slot = fundMisPlaced[c.piso][c.ciclo] || { barras: 0, kg: 0 };
        slot.barras += c.barras; slot.kg += c.kg;
        fundMisPlaced[c.piso][c.ciclo] = slot;
      }
      // Acumular bajo PF (sumando todos los orígenes).
      const acc = pfAcc[c.ciclo] || { barras: 0, kg: 0 };
      acc.barras += c.barras; acc.kg += c.kg;
      pfAcc[c.ciclo] = acc;
    } else {
      cellsRegrouped.push(c);
    }
  });
  Object.keys(pfAcc).forEach(ciclo => {
    cellsRegrouped.push({
      piso: 'PF', ciclo: ciclo, sector: SECT_FUND,
      barras: pfAcc[ciclo].barras, kg: pfAcc[ciclo].kg,
    });
  });

  // Pisos efectivos: los originales no-PF + PF (si hay datos FUND).
  const pisosSet = new Set();
  cellsRegrouped.forEach(c => { if (c.piso) pisosSet.add(c.piso); });
  const pisos = Array.from(pisosSet).sort((a, b) => pisoOrder(b) - pisoOrder(a));

  // Ciclos: orden numérico.
  const ciclos = data.ciclos.slice().sort((a, b) => {
    const na = parseInt((a.match(/\d+/) || [0])[0], 10);
    const nb = parseInt((b.match(/\d+/) || [0])[0], 10);
    return na - nb || a.localeCompare(b);
  });

  // Indexar (piso → ciclo → sector → cell)
  const idx = {};
  cellsRegrouped.forEach(c => {
    if (!idx[c.piso]) idx[c.piso] = {};
    if (!idx[c.piso][c.ciclo]) idx[c.piso][c.ciclo] = {};
    idx[c.piso][c.ciclo][c.sector || ''] = c;
  });

  // Re-calcular max_kg sobre datos reagrupados (PF combinado).
  let maxKg = 0;
  cellsRegrouped.forEach(c => { if (c.kg > maxKg) maxKg = c.kg; });

  // Estadística de cobertura: cruces piso × ciclo con al menos 1 barra.
  const totalCruces = pisos.length * ciclos.length;
  const cruceSet = new Set();
  cellsRegrouped.forEach(c => { if (c.barras > 0) cruceSet.add(c.piso + '||' + c.ciclo); });
  const cobPct = totalCruces ? Math.round(cruceSet.size * 100 / totalCruces) : 0;
  if (info) info.textContent = cruceSet.size + ' / ' + totalCruces + ' cruces (' + cobPct + '%)';

  const fmtKg = (n) => Math.round(n).toLocaleString('es-CL');
  const COLOR = '#1565C0';
  const COLOR_RGB = '21,101,192';

  // ── Warning de FUND mal catalogadas ────────────────────────────────
  let warnHtml = '';
  const misKeys = Object.keys(fundMisPlaced);
  if (misKeys.length) {
    const lista = misKeys.map(p => {
      const total = Object.values(fundMisPlaced[p]).reduce((s, x) => s + x.kg, 0);
      return p + ' (' + fmtKg(total) + ' kg)';
    }).join(', ');
    warnHtml = '<div style="background:#fff3cd; border:1px solid #ffc107; color:#856404; ' +
      'padding:8px 12px; border-radius:6px; margin-bottom:10px; font-size:12px;">' +
      '⚠️ <strong>Fundaciones mal catalogadas:</strong> hay barras con sector ' +
      '<code>FUND</code> asignadas a pisos distintos de <code>PF</code>: ' + lista + '. ' +
      'Se muestran agregadas en la fila <code>PF</code>. ' +
      'Corrige el piso en la carga para reflejar correctamente el nivel base.' +
      '</div>';
  }

  // ── Tabla ───────────────────────────────────────────────────────────
  // Anchos compactos. Tabla envuelta en wrapper con scroll horizontal y
  // alineada a la izquierda para que con 1 ciclo no se vea estirada.
  const W_CIC = 112;

  let html = warnHtml;
  html += '<div style="overflow-x:auto; max-width:100%;">';
  html += '<table style="border-collapse:collapse; font-size:11px; width:auto; margin:0;">';
  html += '<colgroup>';
  html += '<col style="width:1px;">';   // piso (auto-shrink)
  html += '<col style="width:1px;">';   // sector (auto-shrink)
  ciclos.forEach(() => { html += '<col style="width:' + W_CIC + 'px;">'; });
  html += '</colgroup>';

  // Header
  html += '<thead><tr>';
  html += '<th style="position:sticky; left:0; background:#fff; padding:2px 6px;"></th>';
  html += '<th style="background:#fff; padding:2px 6px;"></th>';
  ciclos.forEach(c => {
    const col = _cicloColor(c);
    html += '<th style="padding:4px 8px; text-align:center; color:#fff; background:' + col +
      '; border-radius:3px; font-size:11px;">' + c + '</th>';
  });
  html += '</tr></thead><tbody>';

  pisos.forEach((p, pi) => {
    const pisoUp = (p || '').toUpperCase().trim();
    const isPF = pisoUp === 'PF' || pisoUp === 'FUND' || pisoUp === 'FUNDACION';
    const sectoresPiso = isPF ? [SECT_FUND] : SECT_NORMALES;
    const isFirstPiso = pi === 0;

    sectoresPiso.forEach((s, si) => {
      const isFirstSector = si === 0;
      const isLastSector = si === sectoresPiso.length - 1;
      const borderTop = isFirstSector ? 'border-top:2px solid #222;' : 'border-top:1px solid #f0f0f0;';
      const borderBottom = isLastSector ? 'border-bottom:2px solid #222;' : '';
      html += '<tr style="' + borderTop + borderBottom + '">';

      if (isFirstSector) {
        html += '<th rowspan="' + sectoresPiso.length + '" ' +
          'style="position:sticky; left:0; background:#fafafa; padding:4px 8px; ' +
          'text-align:center; vertical-align:middle; font-weight:700; font-size:12px; ' +
          'white-space:nowrap; border-right:2px solid #222;' +
          (isFirstPiso ? ' border-top:2px solid #222;' : '') +
          ' border-bottom:2px solid #222;' +
          '">' + p + '</th>';
      }

      html += '<td style="padding:4px 8px; text-align:left; color:#444; ' +
        'font-size:11px; font-weight:600; background:#fafafa; white-space:nowrap; ' +
        'border-right:1px solid #ddd;' +
        (isFirstSector ? ' border-top:2px solid #222;' : '') +
        (isLastSector ? ' border-bottom:2px solid #222;' : '') +
        '">' + s + '</td>';

      ciclos.forEach(c => {
        const cell = ((idx[p] || {})[c] || {})[s];
        const kg = cell ? cell.kg : 0;
        const barras = cell ? cell.barras : 0;
        const pe = p.replace(/'/g, "\\'");
        const ce = c.replace(/'/g, "\\'");
        const se = s;
        const tdBorders =
          (isFirstSector ? 'border-top:2px solid #222;' : '') +
          (isLastSector ? 'border-bottom:2px solid #222;' : '');
        if (barras > 0) {
          const ratio = maxKg > 0 ? Math.min(1, kg / maxKg) : 0.5;
          const alpha = (0.35 + ratio * 0.65).toFixed(2);
          const bg = 'rgba(' + COLOR_RGB + ',' + alpha + ')';
          const tooltip = p + ' · ' + c + ' · ' + s + ' — ' + barras + ' barras · ' + fmtKg(kg) + ' kg';
          const onclick = isPF
            ? "filtrarPorCobertura('','" + ce + "','" + se + "')"
            : "filtrarPorCobertura('" + pe + "','" + ce + "','" + se + "')";
          html += '<td onclick="' + onclick + '" title="' + tooltip + '" ' +
            'style="cursor:pointer; background:' + bg + '; color:#fff; font-weight:700; ' +
            'font-size:11px; padding:6px 6px; text-align:center;' + tdBorders + '">' +
            fmtKg(kg) + ' kg</td>';
        } else {
          html += '<td style="background:transparent;' + tdBorders + '"></td>';
        }
      });
      html += '</tr>';
    });
  });
  html += '</tbody></table>';
  html += '</div>';

  // Leyenda simplificada (un solo color, intensidad ∝ kg).
  html += '<div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:10px; font-size:11px; color:#666;">';
  html += '<span style="display:inline-flex; align-items:center; gap:5px;">' +
    '<span style="display:inline-block; width:14px; height:14px; background:rgba(' + COLOR_RGB + ',0.95); border-radius:3px;"></span>' +
    'mayor concentración de kg</span>';
  html += '<span style="display:inline-flex; align-items:center; gap:5px;">' +
    '<span style="display:inline-block; width:14px; height:14px; background:rgba(' + COLOR_RGB + ',0.4); border-radius:3px;"></span>' +
    'menor concentración</span>';
  html += '<span style="color:#999;">· celda en blanco = sin cubicación</span>';
  html += '</div>';

  cont.innerHTML = html;
}

function filtrarPorCobertura(piso, ciclo, sector) {
  const pSel = document.getElementById('piso');
  const cSel = document.getElementById('ciclo');
  const sSel = document.getElementById('sector');
  if (pSel) {
    if (piso) {
      if (!Array.from(pSel.options).some(o => o.value === piso)) {
        const o = document.createElement('option'); o.value = piso; o.textContent = piso;
        pSel.appendChild(o);
      }
      pSel.value = piso;
    } else {
      pSel.value = '';
    }
  }
  if (cSel) {
    if (!Array.from(cSel.options).some(o => o.value === ciclo)) {
      const o = document.createElement('option'); o.value = ciclo; o.textContent = ciclo;
      cSel.appendChild(o);
    }
    cSel.value = ciclo;
  }
  if (sSel && sector) {
    if (!Array.from(sSel.options).some(o => o.value === sector)) {
      const o = document.createElement('option'); o.value = sector; o.textContent = sector;
      sSel.appendChild(o);
    }
    sSel.value = sector;
  }
  const eSel = document.getElementById('eje'); if (eSel) eSel.value = '';
  if (typeof onFilterChange === 'function') onFilterChange();
  else buscar(true);
}

// ========================= RESET / CARGA / PAGINACIÓN =========================

function resetFiltros() {
  if (typeof bmEnModoEdicion === 'function' && bmEnModoEdicion()) {
    if (typeof showToast === 'function') showToast('Estás en modo edición: los filtros están bloqueados. Sal de edición para limpiar filtros.', 'error');
    return;
  }
  // Reset TOTAL: limpia todos los de ubicación (incl. proyecto). Facetas/avanzados abajo.
  BM_FILTROS.filter(function(f){ return f.grupo === 'ubicacion'; }).forEach(function(f) {
    const el = document.getElementById(f.id); if (el) el.value = '';
  });
  const qel = document.getElementById('q'); if (qel) qel.value = '';
  const fo = document.getElementById('filtroOrigen'); if (fo) fo.value = '';
  const ff = document.getElementById('filtroFigura'); if (ff) ff.value = '';
  const ftip = document.getElementById('filtroTipologia'); if (ftip) ftip.value = '';
  const fdia = document.getElementById('filtroDiametro'); if (fdia) fdia.value = '';
  if (typeof clearCargaFilter === 'function') clearCargaFilter(true);
  if (typeof loadCargasDropdown === 'function') loadCargasDropdown('');
  const si = document.getElementById('bmProyectoSearchInput'); if (si) si.value = '';
  // Limpiar memoria de filtros (session + cualquier residuo viejo en local).
  try { sessionStorage.removeItem(FILTER_STORAGE_KEY); localStorage.removeItem(FILTER_STORAGE_KEY); } catch (e) {}

  // Estado interno: limpiar resultados previos para evitar que queden barras
  // de la búsqueda anterior en pantalla cuando no hay proyecto seleccionado.
  expanded.clear();
  detailCache.clear();
  lastElementos = [];
  lastTotal = 0;
  currentOffset = 0;

  // UI: borrar tabla, KPIs y contadores explícitamente.
  const tbl = document.getElementById('tabla'); if (tbl) tbl.innerHTML = '';
  const kpis = document.getElementById('bmKpis'); if (kpis) kpis.innerHTML = '<span class="muted">Selecciona un proyecto…</span>';
  const cnt = document.getElementById('count'); if (cnt) cnt.textContent = '';
  const pi = document.getElementById('pageInfo'); if (pi) pi.textContent = '';

  // Cobertura: ocultarla y resetear estado.
  const cobCard = document.getElementById('bmCoberturaCard');
  const cobBtn = document.getElementById('btnCobertura');
  const cobCont = document.getElementById('bmCoberturaContent');
  const cobInfo = document.getElementById('bmCoberturaInfo');
  if (cobCard) cobCard.style.display = 'none';
  if (cobBtn) cobBtn.textContent = '📊 Mostrar cobertura';
  if (cobCont) cobCont.innerHTML = '';
  if (cobInfo) cobInfo.textContent = '';
  _coberturaVisible = false;

  if (typeof loadFilters === 'function') loadFilters();
  buscar(true);
}

async function verBarrasCarga(importId, idProyecto, archivo) {
  if (typeof bmEnModoEdicion === 'function' && bmEnModoEdicion()) {
    if (typeof showToast === 'function') showToast('Estás en modo edición: los filtros están bloqueados. Sal de edición para navegar a una carga.', 'error');
    return;
  }
  switchTab('buscar');
  const proySel = document.getElementById('proyecto');
  if (proySel) proySel.value = idProyecto;
  // Limpiar subfiltros de ubicación (excepto proyecto, recién seteado) para no contaminar.
  BM_FILTROS.filter(function(f){ return f.grupo === 'ubicacion' && f.id !== 'proyecto'; }).forEach(function(f) {
    var el = document.getElementById(f.id); if (el) el.value = '';
  });
  var qel = document.getElementById('q'); if (qel) qel.value = '';
  await loadCargasDropdown(idProyecto);
  const fc = document.getElementById('filtroCarga');
  if (fc) fc.value = importId;
  document.getElementById('cargaFilterBadge').style.display = '';
  document.getElementById('cargaFilterLabel').textContent = archivo || ('Carga #' + importId);
  buscar(true);
}

function clearCargaFilter(skipSearch) {
  if (!skipSearch && typeof bmEnModoEdicion === 'function' && bmEnModoEdicion()) {
    if (typeof showToast === 'function') showToast('Estás en modo edición: los filtros están bloqueados. Sal de edición para cambiar de filtro.', 'error');
    return;
  }
  const fc = document.getElementById('filtroCarga');
  if (fc) fc.value = '';
  const badge = document.getElementById('cargaFilterBadge');
  if (badge) badge.style.display = 'none';
  if (!skipSearch) buscar(true);
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
