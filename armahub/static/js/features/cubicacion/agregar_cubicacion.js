// ArmaHub — "Agregar Cubicación" (Formulario de Cubicación) — modelo GRUPOS por elemento.
// Contexto global (Obra·Ciclo·Sector) + GRUPOS (cada uno = Eje + plano + pisos + barras).
// Al guardar, cada grupo se ESTAMPA en sus pisos: 1 barra por (barra × piso). El backend
// (lotes.py) recibe el array ya expandido, valida geometría, asigna PROD por diámetro, y
// calcula largo/peso. Reusa /filters (contexto), /figuras-catalogo (figuras+render),
// /barras/facetas (marcas). Scope global. IDs 'ac*'.

// ---- Estado ----
var _acProyCache = [];        // [{id, nombre}]
var _acFiguras = {};          // codigo -> figura del catálogo
var _acMarcas = [];           // marcas existentes de la obra (para el datalist)
var _acGrupos = [];           // [{_id, eje, nombre_plano, pisos:[], barras:[]}]
var _acRenders = true;
var _acLoteId = null;
var _acLoteEstado = null;
var _acSeq = 0;               // id incremental (grupos y barras)
var _acEjesObra = [];

var _AC_LETRAS = ['A','B','C','D','E','F','G','H','I'];
var _AC_ANGS = ['ang1','ang2','ang3','ang4'];

// Loader del tab.
async function loadAgregarCubicacion() {
  await _acCargarFiguras();
  await _acCargarProyectos();
  if (_acGrupos.length === 0) acAgregarGrupo();
  acRender();
}
window.loadAgregarCubicacion = loadAgregarCubicacion;

// ---- Datos maestros ----
async function _acCargarFiguras() {
  try {
    var d = await apiGet('/figuras-catalogo');
    (d && d.figuras || []).forEach(function(f) { _acFiguras[f.codigo] = f; });
  } catch (e) {}
}
async function _acCargarProyectos() {
  try {
    var d = await apiGet('/filters');
    _acProyCache = (d && d.proyectos) || [];
    var dl = document.getElementById('acProyectosDatalist');
    if (dl) dl.innerHTML = _acProyCache.map(function(p) {
      return '<option value="' + _acEsc(p.nombre || p.id) + '"></option>';
    }).join('');
  } catch (e) {}
}
function _acEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}

// ---- Buscador de obra → carga contexto (ciclos/ejes/marcas de la obra) ----
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
  if (id) { _acCargarContexto(id); _acCargarMarcas(id); }
}
window.acProyectoInput = acProyectoInput;

async function _acCargarContexto(idProyecto) {
  try {
    var d = await apiGet('/filters?proyecto=' + encodeURIComponent(idProyecto));
    _acFillDatalist('acCicloDatalist', d && d.ciclos);
    _acEjesObra = (d && d.ejes) || [];
    acRender();   // re-render para poblar los datalists de eje de cada grupo
  } catch (e) {}
}
async function _acCargarMarcas(idProyecto) {
  try {
    var d = await apiGet('/barras/facetas?proyecto=' + encodeURIComponent(idProyecto));
    _acMarcas = (d && d.tipologias) || [];   // 'tipologias' = marcas presentes en la obra
    _acRefrescarDatalists();
  } catch (e) {}
}
function _acFillDatalist(id, items) {
  var dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = (items || []).map(function(v) { return '<option value="' + _acEsc(v) + '"></option>'; }).join('');
}
function _acNorm(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

// ---- Grupos ----
function _acNuevoGrupo() {
  _acSeq++;
  return { _id: _acSeq, eje: '', nombre_plano: '', pisos: [], barras: [_acNuevaBarra()] };
}
function _acNuevaBarra() {
  _acSeq++;
  var b = { _id: _acSeq, marca: '', figura: '', diam: null, cant: 1, mult: 1, radio: null };
  _AC_LETRAS.forEach(function(l) { b['dim_' + l.toLowerCase()] = null; });
  _AC_ANGS.forEach(function(a) { b[a] = null; });
  return b;
}
function acAgregarGrupo() { _acGrupos.push(_acNuevoGrupo()); acRender(); }
window.acAgregarGrupo = acAgregarGrupo;

function acBorrarGrupo(gid) {
  if (_acGrupos.length <= 1) { _acGrupos = [_acNuevoGrupo()]; }
  else _acGrupos = _acGrupos.filter(function(g) { return g._id !== gid; });
  acRender();
}
window.acBorrarGrupo = acBorrarGrupo;

function acDuplicarGrupo(gid) {
  var g = _acGrupos.find(function(x) { return x._id === gid; });
  if (!g) return;
  var copia = JSON.parse(JSON.stringify(g));
  _acSeq++; copia._id = _acSeq;
  copia.barras.forEach(function(b) { _acSeq++; b._id = _acSeq; });
  _acGrupos.push(copia);
  acRender();
}
window.acDuplicarGrupo = acDuplicarGrupo;

function acSetGrupo(gid, campo, valor) {
  var g = _acGrupos.find(function(x) { return x._id === gid; });
  if (!g) return;
  g[campo] = valor;
  if (campo === 'eje') _acAvisoEje(gid, valor);
}
window.acSetGrupo = acSetGrupo;

// Pisos del grupo: se ingresan como texto "P3,P4,P5" o rango "P3-P7" (se expande).
function acSetPisos(gid, texto) {
  var g = _acGrupos.find(function(x) { return x._id === gid; });
  if (!g) return;
  g.pisos = _acParsePisos(texto);
  var ind = document.getElementById('acPisosInd-' + gid);
  if (ind) ind.textContent = g.pisos.length ? (g.pisos.length + ' piso(s): ' + g.pisos.join(', ')) : '';
}
window.acSetPisos = acSetPisos;

// Acepta "P3,P4,P5", "3,4,5", "P3-P7" (rango numérico con prefijo P). Devuelve lista.
function _acParsePisos(texto) {
  var out = [];
  (texto || '').split(',').forEach(function(tok) {
    tok = tok.trim();
    if (!tok) return;
    var m = tok.match(/^([A-Za-z]*)(\d+)\s*-\s*([A-Za-z]*)(\d+)$/);
    if (m) {
      var pref = m[1] || m[3] || '';
      var a = parseInt(m[2], 10), b = parseInt(m[4], 10);
      if (a <= b) for (var i = a; i <= b; i++) out.push(pref + i);
    } else out.push(tok);
  });
  // dedup preservando orden
  var seen = {}; return out.filter(function(p) { if (seen[p]) return false; seen[p] = 1; return true; });
}

function _acAvisoEje(gid, valor) {
  var av = document.getElementById('acEjeAviso-' + gid);
  if (!av) return;
  var norm = _acNorm(valor);
  if (!norm) { av.style.display = 'none'; return; }
  var iguales = _acEjesObra.filter(function(e) { return _acNorm(e) === norm && e !== valor; });
  if (iguales.length) { av.textContent = '⚠ Existe "' + iguales[0] + '"'; av.style.display = ''; }
  else av.style.display = 'none';
}

// ---- Barras de un grupo ----
function acAgregarBarra(gid) {
  var g = _acGrupos.find(function(x) { return x._id === gid; });
  if (g) { g.barras.push(_acNuevaBarra()); acRender(); }
}
window.acAgregarBarra = acAgregarBarra;

function acBorrarBarra(gid, bid) {
  var g = _acGrupos.find(function(x) { return x._id === gid; });
  if (!g) return;
  g.barras = g.barras.filter(function(b) { return b._id !== bid; });
  if (!g.barras.length) g.barras.push(_acNuevaBarra());
  acRender();
}
window.acBorrarBarra = acBorrarBarra;

// Copiar una barra hacia abajo (duplica al final del grupo).
function acCopiarBarra(gid, bid) {
  var g = _acGrupos.find(function(x) { return x._id === gid; });
  if (!g) return;
  var b = g.barras.find(function(x) { return x._id === bid; });
  if (!b) return;
  var c = JSON.parse(JSON.stringify(b)); _acSeq++; c._id = _acSeq;
  g.barras.push(c); acRender();
}
window.acCopiarBarra = acCopiarBarra;

function acSetBarra(gid, bid, campo, valor) {
  var g = _acGrupos.find(function(x) { return x._id === gid; });
  if (!g) return;
  var b = g.barras.find(function(x) { return x._id === bid; });
  if (!b) return;
  var num = ['diam','cant','mult','radio'].indexOf(campo) !== -1 || campo.indexOf('dim_') === 0 || campo.indexOf('ang') === 0;
  b[campo] = (valor === '' || valor == null) ? null : (num ? Number(valor) : valor);
  if (campo === 'figura') acRender();        // cambian las dims pedidas
  else _acActualizarBarraVisual(gid, b);
}
window.acSetBarra = acSetBarra;

// ---- Geometría / largo / peso ----
function _acDimsDeFigura(codigo) {
  var fig = _acFiguras[codigo];
  if (!fig) return { dims: [], angs: 0, radio: false };
  var letras = (fig.parciales || []).map(function(l) { return String(l).trim().toUpperCase(); });
  var dims = letras.filter(function(l) { return _AC_LETRAS.indexOf(l) !== -1; })
                   .map(function(l) { return 'dim_' + l.toLowerCase(); });
  return { dims: dims, angs: (fig.angulos || []).length, radio: !!fig.radio };
}
function _acLargoBarra(b) {
  if (!b.figura || !_acFiguras[b.figura]) return null;
  var info = _acDimsDeFigura(b.figura), total = 0;
  for (var i = 0; i < info.dims.length; i++) {
    var v = b[info.dims[i]];
    if (v == null || isNaN(v)) return null;
    total += Number(v);
  }
  return total;
}
function _acPesoBarra(b) {
  var largo = _acLargoBarra(b);
  if (b.diam == null || largo == null) return null;
  var pu = 7850 * 3.1416 * (Number(b.diam) / 2000) * (Number(b.diam) / 2000) * (largo / 100);
  return pu * ((Number(b.cant) || 0) * (Number(b.mult) || 1));
}

// ---- Render ----
function acToggleRender() {
  var c = document.getElementById('acToggleRender');
  _acRenders = !!(c && c.checked);
  acRender();
}
window.acToggleRender = acToggleRender;

function acRender() {
  var cont = document.getElementById('acGrupos');
  if (!cont) return;
  _acAsegurarDatalists();
  cont.innerHTML = _acGrupos.map(_acGrupoHTML).join('');
  // Restaurar indicador de pisos por grupo.
  _acGrupos.forEach(function(g) {
    var ind = document.getElementById('acPisosInd-' + g._id);
    if (ind) ind.textContent = g.pisos.length ? (g.pisos.length + ' piso(s): ' + g.pisos.join(', ')) : '';
  });
  var res = document.getElementById('acResumen');
  if (res) {
    var totalItems = _acGrupos.reduce(function(s, g) {
      return s + g.barras.filter(function(b){ return b.diam != null; }).length * Math.max(1, g.pisos.length);
    }, 0);
    res.textContent = _acGrupos.length + ' grupo(s) · ' + totalItems + ' barra(s) al guardar';
  }
  _acActualizarEstadoLote();
}
window.acRender = acRender;

// Etiquetas y colores de sector, iguales al Bar Manager (SECTOR_LABEL/SECTOR_COLOR).
var _AC_SECT_LBL = { ELEV:'Elevación', LCIELO:'Losas', VCIELO:'Vigas', FUND:'Fundación' };
var _AC_SECT_COL = { ELEV:'#1565C0', LCIELO:'#7B1FA2', VCIELO:'#00897B', FUND:'#6D4C41' };
function _acCtx() {
  return { sector: _acVal('acSector'), ciclo: _acVal('acCiclo') };
}
function _acVal(id) { var el = document.getElementById(id); return el && el.value ? el.value : ''; }
// Badge de sector tipo pill, igual al _sectorBadge del Bar Manager.
function _acSectorBadge(s) {
  var lbl = _AC_SECT_LBL[s] || s || '—', col = _AC_SECT_COL[s] || '#555';
  return '<span style="background:' + col + ';color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;">' + _acEsc(lbl) + '</span>';
}

function _acGrupoHTML(g) {
  var ctx = _acCtx();
  var h = '<div style="border:1px solid #e0e0e0; border-radius:8px; margin-bottom:14px; overflow:hidden;">';
  // Cabecera del grupo: badge de sector (color BM) + ciclo + eje.
  h += '<div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; padding:8px 10px; background:#f7f7f7; border-bottom:1px solid #eee;">';
  h += '<div style="align-self:center; min-width:170px; font-size:12px; color:#37474f;">' +
       _acSectorBadge(ctx.sector) + ' <b>' + _acEsc(ctx.ciclo || '—') + '</b> · Eje <b>' + _acEsc(g.eje || '—') + '</b></div>';
  h += _acCampo('Eje/Losa', '<input type="text" list="acEjeDatalist" value="' + _acEsc(g.eje) + '" oninput="acSetGrupo(' + g._id + ',\'eje\',this.value)" style="' + _acInpStyle(110) + '"/><span id="acEjeAviso-' + g._id + '" style="display:none; font-size:10px; color:#e65100;"></span>');
  h += _acCampo('Plano (origen)', '<input type="text" value="' + _acEsc(g.nombre_plano) + '" oninput="acSetGrupo(' + g._id + ',\'nombre_plano\',this.value)" placeholder="nombre del plano" style="' + _acInpStyle(140) + '"/>');
  h += _acCampo('Pisos', '<input type="text" value="' + _acEsc(g.pisos.join(',')) + '" oninput="acSetPisos(' + g._id + ',this.value)" placeholder="P3,P4,P5 o P3-P7" style="' + _acInpStyle(150) + '"/><span id="acPisosInd-' + g._id + '" style="font-size:10px; color:#00695c;"></span>');
  h += '<div style="flex:1;"></div>';
  // Rollup del grupo (Σ), estética Bar Manager: N barras · uds · kg (considera el
  // estampado en pisos: cada barra × nº de pisos).
  var roll = _acRollupGrupo(g);
  h += '<div style="align-self:center; font-size:11px; color:#666; margin-right:6px;">' +
       '<b style="color:#37474f;">' + roll.n + '</b> barras · <b style="color:#37474f;">' + _acFmt(roll.uds) + '</b> uds · <b style="color:#00695c;">' + _acFmt(roll.kg, 1) + '</b> kg</div>';
  h += '<button onclick="acAgregarBarra(' + g._id + ')" style="font-size:11px; padding:4px 10px; background:#00695c; color:#fff; border:none; border-radius:4px; cursor:pointer;">＋ barra</button>';
  h += '<button onclick="acDuplicarGrupo(' + g._id + ')" title="Duplicar grupo" style="font-size:11px; padding:4px 8px; background:#fff; color:#00695c; border:1px solid #00695c; border-radius:4px; cursor:pointer;">⧉</button>';
  h += '<button onclick="acBorrarGrupo(' + g._id + ')" title="Quitar grupo" style="font-size:13px; padding:2px 8px; border:none; background:none; color:#c62828; cursor:pointer;">✕</button>';
  h += '</div>';
  // Grilla de barras del grupo. Orden de columnas homologado con el Bar Manager:
  // Marca · φ · Cant · Mult · Largo · Peso · Figura · [Dibujo] · A-I · α1-α4 · R.
  h += '<div style="overflow-x:auto;"><table style="width:100%; min-width:1100px; font-size:11px; border-collapse:collapse; white-space:nowrap;">';
  var cols = ['Marca', 'φ', 'Cant', 'Mult', 'Largo', 'Peso', 'Figura'];
  if (_acRenders) cols.push('Dibujo');
  cols = cols.concat(_AC_LETRAS).concat(['α1','α2','α3','α4','R','']);
  h += '<tr style="color:#666; background:#fafafa;">' + cols.map(function(c){ return '<th style="padding:3px 6px; border-bottom:1px solid #ddd; font-weight:600; text-align:left;">' + c + '</th>'; }).join('') + '</tr>';
  g.barras.forEach(function(b) { h += _acBarraHTML(g, b); });
  h += '</table></div>';
  h += '</div>';
  return h;
}

function _acCampo(label, inner) {
  return '<div style="display:flex; flex-direction:column;"><label style="font-size:10px; color:#607d8b; font-weight:600;">' + label + '</label>' + inner + '</div>';
}
function _acInpStyle(w) { return 'width:' + w + 'px; font-size:12px; height:28px; box-sizing:border-box; border:1px solid #cfd8dc; padding:1px 4px;'; }

function _acBarraHTML(g, b) {
  var info = b.figura ? _acDimsDeFigura(b.figura) : { dims: [], angs: 0, radio: false };
  function inp(campo, w, tipo) {
    return '<input type="' + (tipo||'text') + '" value="' + _acEsc(b[campo]==null?'':b[campo]) + '" ' +
      'oninput="acSetBarra(' + g._id + ',' + b._id + ',\'' + campo + '\',this.value)" ' +
      'style="width:' + (w||42) + 'px; font-size:11px; box-sizing:border-box; border:1px solid #ddd; padding:1px 2px;" />';
  }
  var td = '<td style="padding:2px 6px; border-bottom:1px solid #f0f0f0;">';
  var vacio = '<td style="padding:2px 6px; border-bottom:1px solid #f0f0f0; background:#fafafa;"></td>';
  var h = '<tr>';
  // Orden homologado con el Bar Manager: Marca · φ · Cant · Mult · Largo · Peso · Figura
  // · [Dibujo] · A-I · α1-α4 · R · acciones.
  // Marca (datalist de marcas de la obra).
  h += td + '<input type="text" list="acMarcasDatalist" value="' + _acEsc(b.marca||'') + '" oninput="acSetBarra(' + g._id + ',' + b._id + ',\'marca\',this.value)" style="width:64px; font-size:11px; border:1px solid #ddd; padding:1px 2px; font-weight:600;"/></td>';
  h += td + inp('diam', 42, 'number') + '</td>';
  h += td + inp('cant', 42, 'number') + '</td>';
  h += td + inp('mult', 38, 'number') + '</td>';
  h += td + '<span id="acLargo-' + b._id + '" style="color:#1565c0; font-weight:600;">' + _acFmt(_acLargoBarra(b)) + '</span></td>';
  h += td + '<span id="acPeso-' + b._id + '" style="color:#00695c; font-weight:600;">' + _acFmt(_acPesoBarra(b), 1) + '</span></td>';
  // Figura (datalist del catálogo).
  h += td + '<input type="text" list="acFigurasDatalist" value="' + _acEsc(b.figura||'') + '" oninput="acSetBarra(' + g._id + ',' + b._id + ',\'figura\',this.value)" style="width:64px; font-size:11px; border:1px solid #ddd; padding:1px 2px;"/></td>';
  if (_acRenders) h += td + '<span id="acFig-' + b._id + '">' + _acMiniFigura(b) + '</span></td>';
  _AC_LETRAS.forEach(function(l) {
    var campo = 'dim_' + l.toLowerCase();
    var usa = info.dims.indexOf(campo) !== -1 || !b.figura;
    h += usa ? (td + inp(campo, 38, 'number') + '</td>') : vacio;
  });
  _AC_ANGS.forEach(function(a, idx) {
    var usa = idx < info.angs || !b.figura;
    h += usa ? (td + inp(a, 38, 'number') + '</td>') : vacio;
  });
  var usaR = info.radio || !b.figura;
  h += usaR ? (td + inp('radio', 42, 'number') + '</td>') : vacio;
  h += td + '<button onclick="acCopiarBarra(' + g._id + ',' + b._id + ')" title="Copiar barra" style="border:none; background:none; color:#1565c0; cursor:pointer; font-size:12px;">⎘</button>' +
       '<button onclick="acBorrarBarra(' + g._id + ',' + b._id + ')" title="Quitar" style="border:none; background:none; color:#c62828; cursor:pointer; font-size:12px;">✕</button></td>';
  h += '</tr>';
  return h;
}

function _acFmt(v, dec) { if (v == null || isNaN(v)) return '—'; return dec ? Number(v).toFixed(dec) : Math.round(Number(v)); }

// Rollup del grupo: totales considerando el estampado en pisos (cada barra se replica
// en nº de pisos). n = nº de items al guardar; uds = Σ cant_total; kg = Σ peso_total.
function _acRollupGrupo(g) {
  var mult = Math.max(1, g.pisos.length);   // sin pisos → cuenta 1 vez
  var n = 0, uds = 0, kg = 0;
  g.barras.forEach(function(b) {
    if (b.diam == null) return;
    n += mult;
    var ct = (Number(b.cant) || 0) * (Number(b.mult) || 1);
    uds += ct * mult;
    var p = _acPesoBarra(b);
    if (p != null) kg += p * mult;
  });
  return { n: n, uds: uds, kg: kg };
}

function _acMiniFigura(b) {
  if (!b.figura || !_acFiguras[b.figura]) return '<span style="color:#bbb;">—</span>';
  var fig = _acFiguras[b.figura];
  if (!fig.geometria || !fig.geometria.tramos || !fig.geometria.tramos.length) return '<span style="color:#bbb;">—</span>';
  if (!window.disenadorMotor || !window.disenadorMotor.dibujarFigura) return '<span style="color:#bbb;">—</span>';
  var dims = {};
  _AC_LETRAS.forEach(function(l) { var v = b['dim_' + l.toLowerCase()]; if (v != null && !isNaN(v)) dims[l] = Number(v); });
  try { return window.disenadorMotor.dibujarFigura(fig.geometria, dims, { width: 64, height: 42, pad: 6 }); }
  catch (e) { return '<span style="color:#bbb;">—</span>'; }
}

function _acActualizarBarraVisual(gid, b) {
  var l = document.getElementById('acLargo-' + b._id); if (l) l.textContent = _acFmt(_acLargoBarra(b));
  var p = document.getElementById('acPeso-' + b._id); if (p) p.textContent = _acFmt(_acPesoBarra(b), 2);
  if (_acRenders) { var f = document.getElementById('acFig-' + b._id); if (f) f.innerHTML = _acMiniFigura(b); }
}

function _acActualizarEstadoLote() {
  var el = document.getElementById('acLoteEstado');
  if (!el) return;
  el.textContent = _acLoteId ? ('Lote #' + _acLoteId + ' · ' + (_acLoteEstado || 'borrador')) : 'Lote nuevo (sin guardar)';
}

// Datalists compartidos (figuras, marcas, eje). Se agregan una vez al contenedor.
function _acAsegurarDatalists() {
  var wrap = document.getElementById('acGrupos');
  if (!wrap) return;
  _acDatalist('acFigurasDatalist', Object.keys(_acFiguras).map(function(c) {
    var f = _acFiguras[c]; return { v: c, l: c + (f.parciales && f.parciales.length ? ' (' + f.parciales.join('') + ')' : '') };
  }));
  _acDatalist('acMarcasDatalist', _acMarcas.map(function(m) { return { v: m, l: m }; }));
  _acDatalist('acEjeDatalist', _acEjesObra.map(function(e) { return { v: e, l: e }; }));
}
function _acDatalist(id, opts) {
  var dl = document.getElementById(id);
  if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.getElementById('acGrupos').appendChild(dl); }
  dl.innerHTML = opts.map(function(o) { return '<option value="' + _acEsc(o.v) + '">' + _acEsc(o.l) + '</option>'; }).join('');
}
function _acRefrescarDatalists() { _acDatalist('acMarcasDatalist', _acMarcas.map(function(m){ return { v:m, l:m }; })); }

// ---- Estampado + Guardar ----
// Expande todos los grupos a un array plano de barras (1 por barra×piso), con el contexto.
function _acExpandir() {
  var ctx = _acCtx();
  var items = [];
  _acGrupos.forEach(function(g) {
    var pisos = g.pisos.length ? g.pisos : [null];   // sin pisos → 1 item sin piso
    g.barras.forEach(function(b) {
      if (b.diam == null) return;                      // barra incompleta se omite
      pisos.forEach(function(piso) {
        var it = { sector: ctx.sector || null, ciclo: ctx.ciclo || null, piso: piso,
                   eje: g.eje || null, nombre_plano: g.nombre_plano || null,
                   diam: Number(b.diam), figura: b.figura || null, marca: b.marca || null,
                   cant: Number(b.cant) || 1, mult: Number(b.mult) || 1,
                   radio: b.radio != null ? Number(b.radio) : null };
        _AC_LETRAS.forEach(function(l) { var k = 'dim_' + l.toLowerCase(); it[k] = b[k] != null ? Number(b[k]) : null; });
        _AC_ANGS.forEach(function(a) { it[a] = b[a] != null ? Number(b[a]) : null; });
        items.push(it);
      });
    });
  });
  return items;
}

async function acGuardar() {
  var sel = document.getElementById('acProyecto');
  var idProyecto = sel && sel.value;
  if (!idProyecto) { alert('Elige la obra.'); return; }
  if (!_acVal('acSector') || !_acVal('acCiclo')) { alert('Completa Sector y Ciclo.'); return; }
  var items = _acExpandir();
  if (!items.length) { alert('Agrega al menos una barra con diámetro (y pisos si quieres replicar).'); return; }
  try {
    if (!_acLoteId) {
      var r = await apiPostJson('/lotes', { id_proyecto: idProyecto });
      if (!r || !r.lote_id) { alert('No se pudo crear el lote.'); return; }
      _acLoteId = r.lote_id; _acLoteEstado = 'borrador';
    }
    var res = await apiPostJson('/lotes/' + _acLoteId + '/barras', { barras: items });
    if (res && res.ok) {
      if (typeof showToast === 'function') showToast(res.creadas + ' barra(s) guardadas · lote #' + _acLoteId, 'success');
      _acGrupos = [_acNuevoGrupo()]; acRender();
    } else { alert('No se pudieron guardar las barras.'); }
  } catch (e) {
    // El backend devuelve 400 con detalle de geometría inválida.
    var msg = (e && e.detail && e.detail.msg) || (e && e.message) || 'Error al guardar.';
    alert(msg);
  }
  _acActualizarEstadoLote();
}
window.acGuardar = acGuardar;

async function acTerminarLote() {
  if (!_acLoteId) { alert('Primero guarda las barras.'); return; }
  if (!confirm('Terminar el lote #' + _acLoteId + '?\n\nLas barras quedarán bloqueadas aquí; se editan desde el Bar Manager.')) return;
  try {
    var res = await apiPostJson('/lotes/' + _acLoteId + '/terminar', {});
    if (res && res.ok) {
      if (typeof showToast === 'function') showToast('Lote #' + _acLoteId + ' terminado.', 'success');
      _acLoteId = null; _acLoteEstado = null; _acGrupos = [_acNuevoGrupo()]; acRender();
    }
  } catch (e) { alert('Error al terminar.'); }
  _acActualizarEstadoLote();
}
window.acTerminarLote = acTerminarLote;
