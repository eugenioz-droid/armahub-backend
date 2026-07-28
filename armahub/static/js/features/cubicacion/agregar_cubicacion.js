// ArmaHub — 5N-C: "Agregar Cubicación" (Formulario de Cubicación).
// Grilla estilo planilla para ingresar barras manuales. Reusa: /filters (cascada de
// ubicación), /figuras-catalogo + disenadorMotor.dibujarFigura (figura+render),
// /lotes + /lotes/{id}/barras (backend 5N-B). IDs propios 'ac*' (no chocan con el
// Bar Manager, que vive en el DOM a la vez). Scope global (como filtros.js/barmanager.js).

// ---- Estado del módulo ----
var _acProyCache = [];        // [{id, nombre}] para resolver el buscador de obra
var _acFiguras = {};          // codigo -> {parciales, angulos, radio, geometria}
var _acFilas = [];            // filas de la grilla (cada una = una barra a crear)
var _acVista = 'plano';       // 'agrupar' | 'plano' | 'color'
var _acRenders = true;        // mostrar mini-render de figura
var _acLoteId = null;         // lote en curso (se crea al guardar)
var _acLoteEstado = null;     // 'borrador' | 'terminada'
var _acSeq = 0;               // id local incremental de fila
var _acEjesObra = [];         // ejes existentes de la obra (para autocompletar/advertir)

var _AC_DIMS = ['dim_a','dim_b','dim_c','dim_d','dim_e','dim_f','dim_g','dim_h','dim_i'];
var _AC_ANGS = ['ang1','ang2','ang3','ang4'];
var _AC_LETRAS = ['A','B','C','D','E','F','G','H','I'];

// Loader del tab (registrado en shell.js tabLoaders). Se llama al abrir el tab.
async function loadAgregarCubicacion() {
  await _acCargarFiguras();
  await _acCargarProyectos();
  if (_acFilas.length === 0) acAgregarFila();   // arrancar con una fila vacía
  _acRender();
}
window.loadAgregarCubicacion = loadAgregarCubicacion;

// ---- Carga de datos maestros ----
async function _acCargarFiguras() {
  try {
    var data = await apiGet('/figuras-catalogo');
    (data && data.figuras || []).forEach(function(f) { _acFiguras[f.codigo] = f; });
  } catch (e) { /* degrada: sin figuras el form igual pide dims por defecto */ }
}
async function _acCargarProyectos() {
  try {
    var data = await apiGet('/filters');
    _acProyCache = (data && data.proyectos) || [];
    var dl = document.getElementById('acProyectosDatalist');
    if (dl) dl.innerHTML = _acProyCache.map(function(p) {
      return '<option value="' + _acEsc(p.nombre || p.id) + '"></option>';
    }).join('');
  } catch (e) { /* degrada */ }
}

function _acEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}

// ---- Buscador de obra (resuelve texto -> id, luego carga ubicación de esa obra) ----
function acProyectoInput() {
  var input = document.getElementById('acProyectoInput');
  var sel = document.getElementById('acProyecto');
  if (!input || !sel) return;
  var txt = (input.value || '').trim().toLowerCase();
  var id = '';
  var exact = _acProyCache.find(function(p) { return String(p.nombre || p.id).toLowerCase() === txt; });
  if (exact) id = String(exact.id);
  else {
    var pref = _acProyCache.filter(function(p) { return String(p.nombre || p.id).toLowerCase().indexOf(txt) === 0; });
    if (pref.length === 1) id = String(pref[0].id);
  }
  if (id === sel.value) return;
  sel.value = id;
  if (id) _acCargarUbicacion(id);
}
window.acProyectoInput = acProyectoInput;

// Poblar los datalists de ubicación (sector/piso/ciclo/eje) con lo existente de la obra.
async function _acCargarUbicacion(idProyecto) {
  try {
    var d = await apiGet('/filters?proyecto=' + encodeURIComponent(idProyecto));
    _acFillDatalist('acSectorDatalist', d && d.sectores);
    _acFillDatalist('acPisoDatalist', d && d.pisos);
    _acFillDatalist('acCicloDatalist', d && d.ciclos);
    _acFillDatalist('acEjeDatalist', d && d.ejes);
    _acEjesObra = (d && d.ejes) || [];
  } catch (e) { /* degrada */ }
}
function _acFillDatalist(id, items) {
  var dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = (items || []).map(function(v) { return '<option value="' + _acEsc(v) + '"></option>'; }).join('');
}

// Advertencia SUAVE de eje parecido (5N.11): no bloquea, solo avisa. Compara normalizado
// (trim + colapsar espacios + minúsculas); si existe uno igual normalizado pero distinto
// tal cual, sugiere el existente. NUNCA fusiona.
function acEjeInput() {
  var input = document.getElementById('acEje');
  var av = document.getElementById('acEjeAviso');
  if (!input || !av) return;
  var v = (input.value || '');
  var norm = _acNorm(v);
  if (!norm) { av.style.display = 'none'; return; }
  var iguales = _acEjesObra.filter(function(e) { return _acNorm(e) === norm && e !== v; });
  if (iguales.length) {
    av.textContent = '⚠ Existe "' + iguales[0] + '". ¿Es ese o uno nuevo?';
    av.style.display = '';
  } else { av.style.display = 'none'; }
}
window.acEjeInput = acEjeInput;
function _acNorm(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

// ---- Grilla: filas ----
function _acNuevaFila() {
  _acSeq++;
  return {
    _id: _acSeq,
    sector: null, piso: null, ciclo: null, eje: null,
    diam: null, figura: null, marca: null, cant: 1, mult: 1,
    dim_a: null, dim_b: null, dim_c: null, dim_d: null, dim_e: null,
    dim_f: null, dim_g: null, dim_h: null, dim_i: null,
    ang1: null, ang2: null, ang3: null, ang4: null, radio: null
  };
}
function acAgregarFila() {
  var f = _acNuevaFila();
  // Heredar la ubicación por defecto de la cabecera.
  f.sector = _acVal('acSector'); f.piso = _acVal('acPiso');
  f.ciclo = _acVal('acCiclo'); f.eje = _acVal('acEje');
  _acFilas.push(f);
  _acRender();
}
window.acAgregarFila = acAgregarFila;
function _acVal(id) { var el = document.getElementById(id); return el && el.value ? el.value : null; }

function acBorrarFila(fid) {
  _acFilas = _acFilas.filter(function(f) { return f._id !== fid; });
  _acRender();
}
window.acBorrarFila = acBorrarFila;

// Actualiza un campo de una fila desde un input de la grilla.
function acSetCampo(fid, campo, valor) {
  var f = _acFilas.find(function(x) { return x._id === fid; });
  if (!f) return;
  var num = ['diam','cant','mult','radio'].indexOf(campo) !== -1 || campo.indexOf('dim_') === 0 || campo.indexOf('ang') === 0;
  f[campo] = (valor === '' || valor == null) ? null : (num ? Number(valor) : valor);
  // Al cambiar figura, re-render (cambian las dims pedidas) y refrescar preview de esa fila.
  if (campo === 'figura') _acRender();
  else _acActualizarFilaVisual(f);
}
window.acSetCampo = acSetCampo;

// Qué dims usa la figura elegida (parciales). Si no hay figura, no pide dims.
function _acDimsDeFigura(codigo) {
  var fig = _acFiguras[codigo];
  if (!fig) return { dims: [], angs: 0, radio: false };
  var letras = (fig.parciales || []).map(function(l) { return String(l).trim().toUpperCase(); });
  var dims = letras.filter(function(l) { return _AC_LETRAS.indexOf(l) !== -1; })
                   .map(function(l) { return 'dim_' + l.toLowerCase(); });
  return { dims: dims, angs: (fig.angulos || []).length, radio: !!fig.radio };
}

// Largo automático de una fila (suma de las dims que usa la figura; radio no suma).
function _acLargoFila(f) {
  if (!f.figura || !_acFiguras[f.figura]) return null;
  var info = _acDimsDeFigura(f.figura);
  var total = 0;
  for (var i = 0; i < info.dims.length; i++) {
    var v = f[info.dims[i]];
    if (v == null || isNaN(v)) return null;   // falta un lado usado
    total += Number(v);
  }
  return total;
}
// Peso teórico (kg) de una fila. Mismo cálculo que el backend (sin factor de obra,
// que es del server; acá es solo preview).
function _acPesoFila(f) {
  var largo = _acLargoFila(f);
  if (f.diam == null || largo == null) return null;
  var pu = 7850 * 3.1416 * (Number(f.diam) / 2000) * (Number(f.diam) / 2000) * (largo / 100);
  var ct = (Number(f.cant) || 0) * (Number(f.mult) || 1);
  return pu * ct;
}

// ---- Render de la grilla ----
function acSetVista(v) {
  _acVista = v;
  ['agrupar','plano','color'].forEach(function(m) {
    var b = document.getElementById('acVista' + m.charAt(0).toUpperCase() + m.slice(1));
    if (b) { b.style.background = (m === v) ? '#00695c' : '#fff'; b.style.color = (m === v) ? '#fff' : '#00695c'; }
  });
  _acRender();
}
window.acSetVista = acSetVista;
function acToggleRender() {
  var c = document.getElementById('acToggleRender');
  _acRenders = !!(c && c.checked);
  _acRender();
}
window.acToggleRender = acToggleRender;

// Color por elemento constructivo (para la "agrupación visual" sin colapsar).
var _AC_COLORES = ['#e8f5e9','#e3f2fd','#fff3e0','#f3e5f5','#e0f2f1','#fce4ec'];
function _acColorElemento(f) {
  if (_acVista !== 'color') return '';
  var key = (f.sector || '') + '|' + (f.piso || '') + '|' + (f.eje || '');
  var idx = _acHash(key) % _AC_COLORES.length;
  return _AC_COLORES[idx];
}
function _acHash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff; return h; }

function _acRender() {
  var cont = document.getElementById('acGrid');
  if (!cont) return;
  // Cabecera de la grilla.
  var cols = ['#','Sector','Piso','Ciclo','Eje/Losa','Figura'];
  if (_acRenders) cols.push('Dibujo');
  cols = cols.concat(_AC_LETRAS.map(function(l){ return l; }));
  cols = cols.concat(['α1','α2','α3','α4','R','φ','Cant','Mult','Largo','Peso','']);
  var html = '<table style="width:100%; font-size:11px; border-collapse:collapse; white-space:nowrap;">';
  html += '<tr style="background:#f5f5f5; position:sticky; top:0;">' +
    cols.map(function(c){ return '<th style="padding:3px 5px; border-bottom:1px solid #ddd; font-weight:600;">' + c + '</th>'; }).join('') + '</tr>';

  var filas = _acFilas.slice();
  if (_acVista === 'agrupar') filas.sort(_acCmpAgrupar);
  filas.forEach(function(f, i) {
    html += _acFilaHTML(f, i);
  });
  html += '</table>';
  cont.innerHTML = html;

  var res = document.getElementById('acResumen');
  if (res) res.textContent = _acFilas.length + ' barra(s) en el lote';
  _acActualizarEstadoLote();
}

function _acCmpAgrupar(a, b) {
  return ((a.sector||'')+(a.piso||'')+(a.eje||'')).localeCompare((b.sector||'')+(b.piso||'')+(b.eje||''));
}

function _acFilaHTML(f, i) {
  var bg = _acColorElemento(f);
  var trStyle = bg ? (' style="background:' + bg + ';"') : '';
  var info = f.figura ? _acDimsDeFigura(f.figura) : { dims: [], angs: 0, radio: false };
  function inp(campo, w, tipo) {
    var val = f[campo] == null ? '' : f[campo];
    return '<input type="' + (tipo||'text') + '" value="' + _acEsc(val) + '" ' +
      'oninput="acSetCampo(' + f._id + ',\'' + campo + '\',this.value)" ' +
      'data-fid="' + f._id + '" data-campo="' + campo + '" ' +
      'style="width:' + (w||46) + 'px; font-size:11px; box-sizing:border-box; border:1px solid #ddd; padding:1px 2px;" />';
  }
  var td = '<td style="padding:2px 3px; border-bottom:1px solid #eee;">';
  var h = '<tr' + trStyle + '>';
  h += td + (i+1) + '</td>';
  h += td + inp('sector', 70) + '</td>';
  h += td + inp('piso', 50) + '</td>';
  h += td + inp('ciclo', 50) + '</td>';
  h += td + inp('eje', 60) + '</td>';
  // Figura: input con datalist del catálogo.
  h += td + '<input type="text" list="acFigurasDatalist" value="' + _acEsc(f.figura||'') + '" ' +
       'oninput="acSetCampo(' + f._id + ',\'figura\',this.value)" style="width:70px; font-size:11px; border:1px solid #ddd; padding:1px 2px;" /></td>';
  // Dibujo (opcional).
  if (_acRenders) {
    h += td + '<span id="acFig-' + f._id + '">' + _acMiniFigura(f) + '</span></td>';
  }
  // Dims A-I: solo editable si la figura la usa; si no, celda deshabilitada.
  _AC_LETRAS.forEach(function(l) {
    var campo = 'dim_' + l.toLowerCase();
    var usa = info.dims.indexOf(campo) !== -1 || !f.figura;
    if (usa) h += td + inp(campo, 40, 'number') + '</td>';
    else h += '<td style="padding:2px 3px; border-bottom:1px solid #eee; background:#fafafa;"></td>';
  });
  // Ángulos.
  _AC_ANGS.forEach(function(a, idx) {
    var usa = idx < info.angs || !f.figura;
    if (usa) h += td + inp(a, 40, 'number') + '</td>';
    else h += '<td style="padding:2px 3px; border-bottom:1px solid #eee; background:#fafafa;"></td>';
  });
  // Radio.
  var usaR = info.radio || !f.figura;
  h += usaR ? (td + inp('radio', 44, 'number') + '</td>')
            : '<td style="padding:2px 3px; border-bottom:1px solid #eee; background:#fafafa;"></td>';
  // φ, cant, mult, largo (auto), peso (auto).
  h += td + inp('diam', 44, 'number') + '</td>';
  h += td + inp('cant', 44, 'number') + '</td>';
  h += td + inp('mult', 40, 'number') + '</td>';
  h += td + '<span id="acLargo-' + f._id + '" style="color:#00695c; font-weight:600;">' + _acFmt(_acLargoFila(f)) + '</span></td>';
  h += td + '<span id="acPeso-' + f._id + '" style="color:#00695c; font-weight:600;">' + _acFmt(_acPesoFila(f), 2) + '</span></td>';
  h += td + '<button onclick="acBorrarFila(' + f._id + ')" title="Quitar fila" style="border:none; background:none; color:#c62828; cursor:pointer; font-size:13px;">✕</button></td>';
  h += '</tr>';
  return h;
}

function _acFmt(v, dec) {
  if (v == null || isNaN(v)) return '—';
  return dec ? Number(v).toFixed(dec) : Math.round(Number(v));
}

// Mini-render de la figura de una fila, escalado a sus dims.
function _acMiniFigura(f) {
  if (!f.figura || !_acFiguras[f.figura]) return '<span style="color:#bbb;">—</span>';
  var fig = _acFiguras[f.figura];
  if (!fig.geometria || !fig.geometria.tramos || !fig.geometria.tramos.length) return '<span style="color:#bbb;">—</span>';
  if (!window.disenadorMotor || !window.disenadorMotor.dibujarFigura) return '<span style="color:#bbb;">—</span>';
  // dims map A:valor para escalar el dibujo.
  var dims = {};
  _AC_LETRAS.forEach(function(l) { var v = f['dim_' + l.toLowerCase()]; if (v != null && !isNaN(v)) dims[l] = Number(v); });
  try { return window.disenadorMotor.dibujarFigura(fig.geometria, dims, { width: 70, height: 46, pad: 8 }); }
  catch (e) { return '<span style="color:#bbb;">—</span>'; }
}

// Actualiza en vivo largo/peso/dibujo de una fila sin re-render completo (para no perder
// el foco de la celda que se está editando).
function _acActualizarFilaVisual(f) {
  var l = document.getElementById('acLargo-' + f._id); if (l) l.textContent = _acFmt(_acLargoFila(f));
  var p = document.getElementById('acPeso-' + f._id); if (p) p.textContent = _acFmt(_acPesoFila(f), 2);
  if (_acRenders) { var g = document.getElementById('acFig-' + f._id); if (g) g.innerHTML = _acMiniFigura(f); }
}

function _acActualizarEstadoLote() {
  var el = document.getElementById('acLoteEstado');
  if (!el) return;
  if (_acLoteId) el.textContent = 'Lote #' + _acLoteId + ' · ' + (_acLoteEstado || 'borrador');
  else el.textContent = 'Lote nuevo (sin guardar)';
}

// ---- Guardar / Terminar ----
async function acGuardarBarras() {
  var sel = document.getElementById('acProyecto');
  var idProyecto = sel && sel.value;
  if (!idProyecto) { alert('Elige la obra antes de guardar.'); return; }
  var validas = _acFilas.filter(function(f) { return f.diam != null; });
  if (!validas.length) { alert('Agrega al menos una barra con diámetro.'); return; }
  try {
    if (!_acLoteId) {
      var r = await apiPostJson('/lotes', { id_proyecto: idProyecto });
      if (!r || !r.lote_id) { alert('No se pudo crear el lote.'); return; }
      _acLoteId = r.lote_id; _acLoteEstado = 'borrador';
    }
    var payload = { barras: validas.map(_acFilaAPayload) };
    var res = await apiPostJson('/lotes/' + _acLoteId + '/barras', payload);
    if (res && res.ok) {
      if (typeof showToast === 'function') showToast(res.creadas + ' barra(s) guardadas en el lote #' + _acLoteId, 'success');
      _acFilas = []; acAgregarFila();   // limpiar para seguir cargando
    } else { alert('No se pudieron guardar las barras.'); }
  } catch (e) { alert('Error al guardar: ' + (e && e.message || e)); }
  _acActualizarEstadoLote();
}
window.acGuardarBarras = acGuardarBarras;

function _acFilaAPayload(f) {
  var p = { sector: f.sector, piso: f.piso, ciclo: f.ciclo, eje: f.eje,
            diam: Number(f.diam), figura: f.figura || null, marca: f.marca || null,
            cant: Number(f.cant) || 1, mult: Number(f.mult) || 1, radio: f.radio != null ? Number(f.radio) : null };
  _AC_DIMS.forEach(function(d) { p[d] = f[d] != null ? Number(f[d]) : null; });
  _AC_ANGS.forEach(function(a) { p[a] = f[a] != null ? Number(f[a]) : null; });
  return p;
}

async function acTerminarLote() {
  if (!_acLoteId) { alert('Primero guarda las barras del lote.'); return; }
  if (!confirm('Terminar el lote #' + _acLoteId + '?\n\nLas barras quedarán bloqueadas en este formulario; se editan luego desde el Bar Manager.')) return;
  try {
    var res = await apiPostJson('/lotes/' + _acLoteId + '/terminar', {});
    if (res && res.ok) {
      _acLoteEstado = 'terminada';
      if (typeof showToast === 'function') showToast('Lote #' + _acLoteId + ' terminado.', 'success');
      _acLoteId = null; _acLoteEstado = null; _acFilas = []; acAgregarFila();
    }
  } catch (e) { alert('Error al terminar: ' + (e && e.message || e)); }
  _acActualizarEstadoLote();
}
window.acTerminarLote = acTerminarLote;

// ---- Replicar en pisos (modal simple) ----
function acReplicarModal() {
  if (!_acFilas.length) { alert('No hay filas para replicar.'); return; }
  var pisos = prompt('Replicar TODAS las filas actuales en estos pisos (separados por coma):\nEj. 3, 4, 5');
  if (!pisos) return;
  var lista = pisos.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (!lista.length) return;
  var base = _acFilas.slice();
  lista.forEach(function(piso) {
    base.forEach(function(f) {
      var copia = JSON.parse(JSON.stringify(f));
      _acSeq++; copia._id = _acSeq; copia.piso = piso;
      _acFilas.push(copia);
    });
  });
  _acRender();
}
window.acReplicarModal = acReplicarModal;

// Datalist de figuras (una vez, al primer render). Se agrega al DOM del tab.
function _acAsegurarDatalistFiguras() {
  if (document.getElementById('acFigurasDatalist')) return;
  var dl = document.createElement('datalist');
  dl.id = 'acFigurasDatalist';
  dl.innerHTML = Object.keys(_acFiguras).map(function(c) {
    var f = _acFiguras[c];
    var label = c + (f.parciales && f.parciales.length ? ' (' + f.parciales.join('') + ')' : '');
    return '<option value="' + _acEsc(c) + '">' + _acEsc(label) + '</option>';
  }).join('');
  var wrap = document.getElementById('acGridWrap');
  if (wrap) wrap.appendChild(dl);
}

// Envolver _acRender para asegurar el datalist de figuras.
var _acRenderBase = _acRender;
_acRender = function() { _acAsegurarDatalistFiguras(); _acRenderBase(); };
