// =============================================================================
// Modelador 3D — PANEL / CABLEADO (F1 · T1.3 T1.4 T1.6 T1.7)
// Cablea el modal "3D Template" (tabs/modelador3d_modal.html) al motor F0:
//   - renderiza los componentes de la receta (viga-semilla) en el panel,
//   - cada cambio → regenera barras (generar.js) → redibuja el 3D (motor_geom)
//     → actualiza stats + resumen,
//   - Three.js se carga ON-DEMAND (CDN); si falta WebGL, mensaje claro,
//   - "Cargar al despiece": expande la receta y las manda a POST /lotes/{id}/barras
//     (mismo endpoint que ac2Guardar) con origen='template',
//   - "Guardar/Cargar template": POST/GET /templates.
//
// Coordenadas del motor = cm, viga centrada en origen (X=largo, Y=alto, Z=ancho).
// Colores por tipología (calcan la maqueta). Pan con botón MEDIO (no rota).
// =============================================================================
(function (global) {
  'use strict';

  var THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';

  var ST = {
    receta: null,        // receta viva (se muta al ajustar el panel)
    // De QUÉ template salió la receta viva (id de templates_catalogo) o null si es la
    // semilla / algo armado a mano. Viaja en POST /elementos/instancia como
    // template_id: sin él la traza nacía SIEMPRE en NULL y el 409 que protege el
    // DELETE ("este template ya generó barras") no se disparaba nunca, porque no
    // había una sola fila que apuntara a un template.
    templateId: null,
    ultimoOut: null,     // salida de generarViga (barras + resumen)
    piso: null,          // piso (floor) del elemento — se pide al cargar (AC2 no tiene piso global)
    // three
    scene: null, camera: null, renderer: null, world: null, grid: null,
    verHormigon: true, tema: 'medio', ejeRot: 'libre',
    rotX: 0.62, rotY: 0.85, dist: 900, target: null, panX: 0, panY: 0,
    materiales: null, hormigonGroup: null, rafId: null, arrastre: null,
    threeCargado: false, webglOk: null, resizeObs: null,
    // PERF (F0·iv) — render-on-demand: el loop sólo pinta si algo marcó dirty
    // (_marcarSucio desde cámara/pan/zoom/resize/redibujo/tema/toolbar).
    dirty: true, _vw: 0, _vh: 0
  };

  // SWATCHES del panel — MISMA paleta que el editor (COL2D). Esta tabla tenía 5
  // claves propias y ya había divergido (LT #455a64 vs #607d8b) y no conocía
  // NINGUNA tipología de muro/losa/columna: todas caían al gris del fallback.
  // Si el editor no está cargado se usa este mínimo, ya alineado con él.
  var COLORES_TIP_FALLBACK = {
    CBS: '#1565c0', CBI: '#00897b', ES: '#e65100', TRV: '#7b1fa2', LT: '#607d8b'
  };
  function _colorTip(tip) {
    var te = global.TemplateEditor;
    if (te && te.colorDeTipologia) return te.colorDeTipologia(tip);
    return COLORES_TIP_FALLBACK[String(tip || '').toUpperCase()] || null;
  }
  var TEMAS = {
    oscuro: { bg: 0x14171c, g1: 0x2a3340, g2: 0x222a34, CBS: 0x4d9bff, CBI: 0x2fd6c4, ES: 0xff8c42, TRV: 0xc07bff, LT: 0x90a4ae },
    medio: { bg: 0x2b3242, g1: 0x4a5568, g2: 0x3a4353, CBS: 0x3f7fd0, CBI: 0x26a69a, ES: 0xef7d3a, TRV: 0xa56bd0, LT: 0x78909c },
    claro: { bg: 0xd8dee7, g1: 0xb4bdc9, g2: 0xc6cdd6, CBS: 0x1565c0, CBI: 0x00897b, ES: 0xe65100, TRV: 0x7b1fa2, LT: 0x455a64 }
  };

  function $(id) { return document.getElementById(id); }
  function _deps() {
    return {
      gen: global.ModeladorGenerar, reglas: global.ModeladorReglas,
      geom: global.ModeladorMotorGeom, semilla: global.ModeladorSemilla
    };
  }

  // --------------------------------------------------------------------------
  // Carga de Three.js on-demand
  // --------------------------------------------------------------------------
  function cargarThree() {
    return new Promise(function (resolve) {
      if (global.THREE) { resolve(true); return; }
      var s = document.querySelector('script[data-m3d-three]');
      if (s) { s.addEventListener('load', function () { resolve(!!global.THREE); }, { once: true });
               s.addEventListener('error', function () { resolve(false); }, { once: true }); return; }
      s = document.createElement('script');
      s.src = THREE_CDN; s.dataset.m3dThree = '1';
      s.addEventListener('load', function () { resolve(!!global.THREE); }, { once: true });
      s.addEventListener('error', function () { resolve(false); }, { once: true });
      document.head.appendChild(s);
    });
  }

  // --------------------------------------------------------------------------
  // Contexto del despiece (AC2)
  // --------------------------------------------------------------------------
  // Contexto del despiece. NOTA: en AC2 el `piso` es POR BARRA (no hay un piso
  // global); el backend lo EXIGE no vacío. Por eso el piso lo pide "Cargar al
  // despiece" (ST.piso), y aquí solo se refleja el último elegido para el resumen.
  function _ctxAC2() {
    var A = global.AC2 || {};
    return {
      loteId: A.loteId || null,
      sector: A.sector || null, ciclo: A.ciclo || null, eje: A.eje || null,
      piso: ST.piso || null,
      nombre_plano: A.plano || null,
      proyecto: A.proyecto || null
    };
  }

  // --------------------------------------------------------------------------
  // Panel: render de componentes desde la receta
  // --------------------------------------------------------------------------
  // ROL — lo pregunta al MOTOR (consolidación 15-ago). Este panel tenía su propia
  // tabla, y ya había DIVERGIDO de las otras dos: clasificaba por prefijo 'TR', así
  // que una TC salía 'cabezal' (texto y color equivocados) y seguía emitiendo un
  // rol 'traba' que el motor mató con el Modelo A. La autoridad es una sola.
  function _rolDe(comp) {
    var reglas = global.ModeladorReglas;
    if (comp && reglas && reglas.rolDeComponente) return reglas.rolDeComponente(comp);
    return 'cabezal';
  }

  // Texto descriptivo (el ".cap" de cada componente en la maqueta).
  function _capTexto(comp) {
    var rol = _rolDe(comp);
    // (el rol 'traba' murió con el Modelo A: el motor nunca lo devuelve)
    if (rol === 'estribo') return 'Estribo cerrado con gancho. Espaciamiento por zonas a lo largo de la viga.';
    return 'Un componente = N capas iguales o distintas (capas iguales → 1 etiqueta / 1 tanda).';
  }

  function renderComponentes() {
    var cont = $('m3d_componentes'); if (!cont) return;
    var comps = ST.receta.componentes || [];
    $('m3d_compCount').textContent = comps.length;
    var html = '';
    comps.forEach(function (comp, idx) {
      var col = _colorTip(comp.tipologia) || _colorTip(_rolDe(comp) === 'estribo' ? 'ES' : 'LT') || '#607d8b';
      var dist = comp.distribucion || {};
      var meta = 'ø' + comp.diam + ' · fig ' + comp.figura + ' · ';
      if (dist.modo === 'layered') meta += (dist.n_capas || 1) + ((dist.n_capas || 1) === 1 ? ' capa' : ' capas');
      else if (dist.modo === 'linear') meta += 'por tramos';
      html += '<div class="comp' + (idx === 0 ? ' open sel' : '') + '" data-idx="' + idx + '">' +
        '<div class="head" onclick="modelador3dToggleComp(event,' + idx + ')">' +
          '<span class="drag" title="Arrastra para reordenar">⠿</span>' +
          '<span class="swatch" style="background:' + col + '"></span>' +
          '<span class="tip">' + comp.tipologia + '</span>' +
          '<span class="suf">' + (comp.suf_tipo || '') + '</span>' +
          '<span class="meta">· ' + meta + '</span><span class="sp"></span>' +
          '<button class="mini" title="Duplicar" onclick="modelador3dDuplicarComp(event,' + idx + ')">⧉</button>' +
          '<button class="mini" title="Quitar" onclick="modelador3dQuitarComp(event,' + idx + ')">🗑</button>' +
        '</div>' +
        '<div class="body">' + _cuerpoComp(comp, idx) + '</div>' +
      '</div>';
    });
    cont.innerHTML = html;
  }

  function _cuerpoComp(comp, idx) {
    var h = '';
    // Descripción del componente
    h += '<div class="cap">' + _capTexto(comp) + '</div>';
    // Figura / φ / cara
    h += '<div class="grid3">' +
      '<div class="fld"><label>Figura</label><input type="text" list="m3d_figs" value="' + comp.figura + '" onchange="modelador3dSetComp(' + idx + ',\'figura\',this.value)"></div>' +
      '<div class="fld"><label>φ <span class="u">mm</span></label>' + _selDiam(comp.diam, idx) + '</div>' +
      '<div class="fld"><label>Cara</label>' + _radialCara(comp.cara, idx) + '</div>' +
    '</div>';
    // Recubrimiento override
    h += '<div class="fld" style="margin-top:8px"><label>Recub. (override) <span class="u">cm</span></label>' +
      '<input type="number" placeholder="global (' + (ST.receta.geometria.recub_sup != null ? ST.receta.geometria.recub_sup : 4) + ')" style="width:130px" ' +
      'value="' + (comp.recub_override != null ? comp.recub_override : '') + '" ' +
      'onchange="modelador3dSetComp(' + idx + ',\'recub_override\',this.value===\'\'?null:+this.value)"></div>';
    // Dims dinámicas (según parciales de la figura + ángulos + R)
    h += _dimsHtml(comp, idx);
    // Distribución
    if (comp.distribucion && comp.distribucion.modo === 'layered') h += _capasHtml(comp, idx);
    else if (comp.distribucion && comp.distribucion.modo === 'linear') h += _zonasHtml(comp, idx);
    return h;
  }

  function _selDiam(diam, idx) {
    var ds = [8, 10, 12, 16, 18, 22, 25, 28, 32, 36];
    var o = ds.map(function (d) { return '<option' + (d === diam ? ' selected' : '') + '>' + d + '</option>'; }).join('');
    return '<select onchange="modelador3dSetComp(' + idx + ',\'diam\',+this.value)">' + o + '</select>';
  }
  function _radialCara(cara, idx) {
    function b(v, t) { return '<button class="' + (cara === v ? 'on' : '') + '" onclick="modelador3dSetComp(' + idx + ',\'cara\',\'' + v + '\')">' + t + '</button>'; }
    return '<div class="radial">' + b('sup', 'Sup') + b('inf', 'Inf') + b('lateral', 'Lat') + '</div>';
  }

  // Dims: cada parcial de la figura como fila Fija/Auto + bloque Ángulos + bloque
  // Radio (calca la maqueta template3d). Usa la tabla de figuras de generar.js.
  function _dimsHtml(comp, idx) {
    var d = _deps();
    var spec = (d.gen && d.gen.FIGURAS[comp.figura]) || { parciales: [], angulos: [], radio: false };
    var dims = comp.dims || {};
    // Parciales A..I
    var rows = '';
    spec.parciales.forEach(function (L) {
      var cfg = dims[L] || { modo: 'auto' };
      var fija = cfg.modo === 'fija';
      rows += '<div class="dimrow"><span class="lb">' + L + '</span>' +
        '<input type="number" ' + (fija ? '' : 'disabled') + ' value="' + (cfg.valor != null ? cfg.valor : '') + '" title="cm" ' +
          'onchange="modelador3dSetDim(' + idx + ',\'' + L + '\',\'valor\',this.value)">' +
        '<span class="autotag"><button class="' + (fija ? 'on' : '') + '" onclick="modelador3dSetDim(' + idx + ',\'' + L + '\',\'modo\',\'fija\')">Fija</button>' +
          '<button class="' + (!fija ? 'on' : '') + '" onclick="modelador3dSetDim(' + idx + ',\'' + L + '\',\'modo\',\'auto\')">Auto</button></span></div>';
    });
    // Ángulos (según la figura) — vienen del catálogo (fijos por la figura elegida).
    var angs = '';
    (spec.angulos || []).forEach(function (a, i) {
      angs += '<div class="dimrow"><span class="lb lba">α' + (i + 1) + '</span>' +
        '<input type="number" value="' + a + '" title="grados">' +
        '<span class="autotag"><button class="on">Fija</button><button>Auto</button></span></div>';
    });
    var bloqueAng = '<div class="subh">Ángulos (según la figura)</div>' +
      (angs || '<div class="dimrow"><span class="lb lba">α</span><input type="number" placeholder="—" title="esta figura no usa ángulos" disabled><span class="autotag"><button>Fija</button><button>Auto</button></span></div>');
    // Radio (tramo curvo, si la figura lo usa)
    var usaR = !!spec.radio;
    var rVal = (dims.R && dims.R.valor != null) ? dims.R.valor : '';
    var rFija = usaR && dims.R && dims.R.modo === 'fija';
    var bloqueR = '<div class="subh">Radio (tramo curvo, si la figura lo usa)</div>' +
      '<div class="dimrow"><span class="lb lbr">R</span>' +
      '<input type="number" ' + (usaR ? '' : 'disabled') + ' placeholder="' + (usaR ? 'cm' : '—') + '" ' +
        'title="' + (usaR ? 'radio de desarrollo' : 'radio de desarrollo (esta figura no usa R)') + '" ' +
        'value="' + rVal + '" onchange="modelador3dSetDim(' + idx + ',\'R\',\'valor\',this.value)">' +
      '<span class="autotag"><button class="' + (rFija ? 'on' : '') + '" ' + (usaR ? 'onclick="modelador3dSetDim(' + idx + ',\'R\',\'modo\',\'fija\')"' : '') + '>Fija</button>' +
        '<button class="' + (usaR && !rFija ? 'on' : '') + '" ' + (usaR ? 'onclick="modelador3dSetDim(' + idx + ',\'R\',\'modo\',\'auto\')"' : '') + '>Auto</button></span></div>';
    return '<div class="dims"><div class="dh">Dimensiones · figura ' + comp.figura + '</div>' + rows +
      bloqueAng + bloqueR +
      '<div class="note">Los campos (dims, ángulos, R) dependen de la figura elegida. "Auto" deriva del elemento (B = largo − recubr.); "Fija" = la pones tú.</div></div>';
  }

  // Tabla de CAPAS (calca la maqueta): cada capa = fila con N° barras + offset a
  // la cara (retranqueo hacia el núcleo), con ＋capa / quitar capa. El motor usa
  // n_capas (nº de filas) y barras_capa (capas iguales); el offset por capa se
  // deriva del índice × (diam+gap) — la columna offset ajusta el gap del set.
  function _capasHtml(comp, idx) {
    var dist = comp.distribucion;
    var nCapas = Math.max(1, dist.n_capas || 1);
    var barras = dist.barras_capa || 1;
    var gap = (dist.gap != null) ? dist.gap : 0;
    var diamCm = (comp.diam || 0) / 10;
    var rows = '';
    for (var c = 0; c < nCapas; c++) {
      var offset = Math.round((c * (diamCm + gap)) * 10) / 10;   // retranqueo de esta capa
      rows += '<div class="cr"><span class="n">' + (c + 1) + '</span>' +
        '<input type="number" value="' + barras + '" onchange="modelador3dSetDist(' + idx + ',\'barras_capa\',+this.value)">' +
        '<input type="number" value="' + offset + '" ' + (c === 0 ? 'disabled title="capa base"' : 'onchange="modelador3dSetOffsetCapa(' + idx + ',' + c + ',+this.value)"') + '>' +
        '<button class="del" title="Quitar capa" ' + (nCapas > 1 ? 'onclick="modelador3dQuitarCapa(' + idx + ')"' : 'disabled') + '>✕</button></div>';
    }
    return '<div class="capas"><div class="ch"><span>#</span><span>N° barras</span><span>Offset cara (cm)</span><span></span></div>' +
      rows +
      '<button class="addcapa" onclick="modelador3dAgregarCapa(' + idx + ')">＋ capa</button></div>' +
      '<div class="note">' + nCapas + ' capa' + (nCapas === 1 ? '' : 's') + ' iguales (' + barras + 'ø' + comp.diam + ') → se agrupan como 1 etiqueta con cantidad ×' + nCapas + '.</div>';
  }

  // Zonas de espaciamiento (estribo/traba) — calca la maqueta: label + header +
  // una fila por zona (long / @ / = barras calculado) + ＋zona / quitar zona.
  function _zonasHtml(comp, idx) {
    var dist = comp.distribucion, zonas = dist.zonas || [];
    var d = _deps(); var redondeo = (d.reglas && d.reglas.redondeoCantidadZona) || function () { return 0; };
    var head = '<div style="margin-top:10px;font-size:11px;font-weight:700;color:var(--muted)">Zonas de espaciamiento</div>' +
      '<div class="zona zh"><span class="z">#</span><span>Longitud cm</span><span>@ cm</span><span>= barras</span></div>';
    var rows = '';
    zonas.forEach(function (z, zi) {
      rows += '<div class="zona"><span class="z">' + (zi + 1) + '</span>' +
        '<input type="number" class="z_len" value="' + z.long + '" onchange="modelador3dSetZona(' + idx + ',' + zi + ',\'long\',+this.value)">' +
        '<input type="number" class="z_sep" value="' + z.sep + '" onchange="modelador3dSetZona(' + idx + ',' + zi + ',\'sep\',+this.value)">' +
        '<span class="meta calc">' + redondeo(z.long, z.sep) + '</span></div>';
    });
    return head + rows +
      '<button class="addbtn" style="margin-top:8px;padding:6px" onclick="modelador3dAgregarZona(' + idx + ')">＋ zona</button>' +
      '<div class="note">La cantidad se calcula sola (longitud ÷ @). El redondeo replica el criterio de ADetailer.</div>';
  }

  // --------------------------------------------------------------------------
  // Setters del panel (mutan la receta y regeneran)
  // --------------------------------------------------------------------------
  function _leerGeometria() {
    var g = ST.receta.geometria;
    g.largo = +$('m3d_largo').value || g.largo;
    g.ancho = +$('m3d_ancho').value || g.ancho;
    g.alto = +$('m3d_alto').value || g.alto;
    g.recub_sup = +$('m3d_recub').value; g.recub_inf = +$('m3d_recub').value;
    g.recub_lat = +$('m3d_recubl').value;
  }

  global.modelador3dToggleComp = function (ev, idx) {
    // No colapsar si el click fue en un botón mini (duplicar/quitar).
    if (ev && ev.target && ev.target.classList && ev.target.classList.contains('mini')) return;
    var el = document.querySelector('#m3d_componentes .comp[data-idx="' + idx + '"]');
    if (el) el.classList.toggle('open');
  };
  global.modelador3dSetComp = function (idx, campo, val) {
    ST.receta.componentes[idx][campo] = val;
    renderComponentes(); regenerar();
  };

  // ---- Componentes: duplicar / quitar / agregar (calca ⧉ 🗑 y ＋ Agregar) ----
  global.modelador3dDuplicarComp = function (ev, idx) {
    if (ev) ev.stopPropagation();
    var orig = ST.receta.componentes[idx];
    var copia = JSON.parse(JSON.stringify(orig));
    ST.receta.componentes.splice(idx + 1, 0, copia);
    renderComponentes(); regenerar();
  };
  global.modelador3dQuitarComp = function (ev, idx) {
    if (ev) ev.stopPropagation();
    if (ST.receta.componentes.length <= 1) { alert('Debe quedar al menos un componente.'); return; }
    ST.receta.componentes.splice(idx, 1);
    renderComponentes(); regenerar();
  };
  global.modelador3dAgregarComponente = function () {
    // Componente nuevo por defecto: cabezal longitudinal recto (101A), 1 capa.
    ST.receta.componentes.push({
      tipologia: 'LT', figura: '101A', diam: 12, suf_tipo: '', cara: 'sup',
      recub_override: null, angulos: [],
      dims: { A: { modo: 'auto' } },
      distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0, sentido: 'nucleo' }
    });
    renderComponentes(); regenerar();
  };

  // ---- Capas: agregar / quitar / offset (columna Offset cara de la maqueta) ----
  global.modelador3dAgregarCapa = function (idx) {
    var dist = ST.receta.componentes[idx].distribucion;
    dist.n_capas = Math.max(1, (dist.n_capas || 1) + 1);
    renderComponentes(); regenerar();
  };
  global.modelador3dQuitarCapa = function (idx) {
    var dist = ST.receta.componentes[idx].distribucion;
    dist.n_capas = Math.max(1, (dist.n_capas || 1) - 1);
    renderComponentes(); regenerar();
  };
  global.modelador3dSetOffsetCapa = function (idx, capa, val) {
    // El offset de la capa `capa` = capa × (diam+gap). Despejamos el gap del set
    // para que la 2ª capa quede al offset pedido (todas las capas comparten gap).
    var comp = ST.receta.componentes[idx], dist = comp.distribucion;
    var diamCm = (comp.diam || 0) / 10;
    if (capa >= 1) dist.gap = Math.max(0, (val / capa) - diamCm);
    renderComponentes(); regenerar();
  };

  // ---- Zonas: agregar (＋ zona de la maqueta) -------------------------------
  global.modelador3dAgregarZona = function (idx) {
    var dist = ST.receta.componentes[idx].distribucion;
    if (!dist.zonas) dist.zonas = [];
    dist.zonas.push({ long: 100, sep: 20 });
    renderComponentes(); regenerar();
  };
  global.modelador3dSetDim = function (idx, letra, campo, val) {
    var dims = ST.receta.componentes[idx].dims || (ST.receta.componentes[idx].dims = {});
    var cfg = dims[letra] || (dims[letra] = { modo: 'auto' });
    if (campo === 'modo') cfg.modo = val;
    else { cfg.valor = +val; }
    renderComponentes(); regenerar();
  };
  global.modelador3dSetDist = function (idx, campo, val) {
    ST.receta.componentes[idx].distribucion[campo] = val;
    regenerar();
  };
  global.modelador3dSetZona = function (idx, zi, campo, val) {
    ST.receta.componentes[idx].distribucion.zonas[zi][campo] = val;
    // actualizar el "= barras" en vivo sin re-render completo
    regenerar(); renderComponentes();
  };

  // --------------------------------------------------------------------------
  // Generar + stats + resumen
  // --------------------------------------------------------------------------
  function regenerar() {
    var d = _deps();
    if (!d.gen) return;
    _leerGeometria();
    var out = d.gen.generarViga(ST.receta, _ctxAC2());
    ST.ultimoOut = out;
    _pintarStats(out);
    _pintarResumen(out);
    if (ST.threeCargado && ST.webglOk) _redibujar(out);
  }

  function _pintarStats(out) {
    $('m3d_stItems').textContent = out.resumen.items;
    $('m3d_stBarras').textContent = out.resumen.barras;
    $('m3d_stKg').textContent = _num(out.resumen.kg) + ' kg';
    $('m3d_resumenSub').textContent = out.resumen.items + ' items · ' + out.resumen.barras + ' barras · ' + _num(out.resumen.kg) + ' kg · se actualiza en vivo';
  }

  function _num(n) { try { return Number(n).toLocaleString('es-CL'); } catch (e) { return '' + n; } }
  function _cel(v) { return (v == null || v === '') ? '—' : v; }

  function _pintarResumen(out) {
    var body = $('m3d_resumenBody'); if (!body) return;
    body.innerHTML = out.barras.map(function (b) {
      return '<tr><td><span class="rtip">' + (b.marca || '') + '</span> <span class="rsuf">' + (b.suf_tipo || '') + '</span></td>' +
        '<td>' + (b.figura || '') + '</td><td class="r">' + b.diam + '</td><td class="r">' + b.cant + '</td>' +
        '<td class="r">' + _cel(b.dim_a) + '</td><td class="r">' + _cel(b.dim_b) + '</td><td class="r">' + _cel(b.dim_c) + '</td><td class="r">' + _cel(b.dim_d) + '</td>' +
        '<td class="r">' + _cel(b.ang1) + '</td><td class="r">' + _cel(b.ang2) + '</td>' +
        '<td class="r">' + _cel(b.radio) + '</td>' +
        '<td class="r">' + _cel(b._largoEstimado != null ? Math.round(b._largoEstimado) : null) + '</td>' +
        '<td class="r">' + _cel(b._pesoEstimado != null ? _num(Math.round(b._pesoEstimado * 10) / 10) : null) + '</td></tr>';
    }).join('');
  }

  // --------------------------------------------------------------------------
  // 3D — escena, materiales, redibujo (porta rebar3d + template3d)
  // --------------------------------------------------------------------------
  function _initEscena() {
    var THREE = global.THREE;
    var cv = $('m3d_cv'), host = $('m3d_view');
    ST.scene = new THREE.Scene();
    ST.camera = new THREE.PerspectiveCamera(38, 1, 1, 8000);
    try {
      ST.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    } catch (e) { ST.webglOk = false; return false; }
    ST.world = new THREE.Group(); ST.scene.add(ST.world);
    ST.target = new THREE.Vector3(0, 0, 0);
    ST.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    var dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(1, 1.4, 0.8); ST.scene.add(dir);
    var dir2 = new THREE.DirectionalLight(0xbcd4ff, 0.35); dir2.position.set(-1, -0.4, -0.7); ST.scene.add(dir2);
    ST.grid = new THREE.GridHelper(1400, 28, 0x4a5568, 0x3a4353); ST.grid.position.y = -1; ST.scene.add(ST.grid);
    ST.materiales = {
      CBS: new THREE.MeshStandardMaterial({ color: 0x3f7fd0, metalness: 0.55, roughness: 0.5 }),
      CBI: new THREE.MeshStandardMaterial({ color: 0x26a69a, metalness: 0.55, roughness: 0.5 }),
      ES: new THREE.MeshStandardMaterial({ color: 0xef7d3a, metalness: 0.55, roughness: 0.5 }),
      TRV: new THREE.MeshStandardMaterial({ color: 0xa56bd0, metalness: 0.55, roughness: 0.5 }),
      LT: new THREE.MeshStandardMaterial({ color: 0x78909c, metalness: 0.55, roughness: 0.5 }),
      hormigon: new THREE.MeshStandardMaterial({ color: 0x9aa6b5, transparent: true, opacity: 0.16, roughness: 0.9, depthWrite: false })
    };
    _bindOrbita(cv, host);
    _aplicarTema(ST.tema);
    ST.webglOk = true;
    // Encuadre + dimensionar YA (el modal es visible → #m3d_view tiene tamaño).
    // Evita el primer frame en 0×0 (canvas negro) hasta que el loop resizea.
    if (ST.receta && ST.receta.geometria) _fit(ST.receta.geometria.largo);
    _resize();
    _loop();
    return true;
  }

  function _matDe(comp) {
    var t = (comp.marca || comp.tipologia || '').toUpperCase();
    if (ST.materiales[t]) return ST.materiales[t];
    var rol = _rolDe({ tipologia: t });
    if (rol === 'estribo') return ST.materiales.ES;
    if (rol === 'traba') return ST.materiales.TRV;
    return ST.materiales.LT;
  }

  // PERF (F0·iii) — vaciar el world LIBERANDO la GPU. `remove()` sólo desengancha el
  // objeto del grafo; la BufferGeometry sigue ocupando memoria de video (three no
  // libera buffers WebGL por GC). Regenerar muchas veces acumulaba geometrías
  // huérfanas. Se dispone la GEOMETRÍA de cada descendiente; los MATERIALES son
  // COMPARTIDOS (ST.materiales) → NUNCA se disponen. Los materiales creados al vuelo
  // (edges del hormigón) se marcan con userData._propio y sí se disponen.
  function _vaciarWorld() {
    if (!ST.world) return;
    while (ST.world.children.length) {
      var obj = ST.world.children[0];
      ST.world.remove(obj);
      if (obj.traverse) {
        obj.traverse(function (n) {
          if (n.geometry && n.geometry.dispose) n.geometry.dispose();
          if (n.material && n.material.userData && n.material.userData._propio && n.material.dispose) {
            n.material.dispose();
          }
        });
      } else if (obj.geometry && obj.geometry.dispose) {
        obj.geometry.dispose();
      }
    }
  }

  function _redibujar(out) {
    var THREE = global.THREE, geom = _deps().geom;
    if (!THREE || !ST.world) return;
    _vaciarWorld();
    var g = ST.receta.geometria;
    // Hormigón
    if (ST.verHormigon) {
      var box = new THREE.Mesh(new THREE.BoxGeometry(g.largo, g.alto, g.ancho), ST.materiales.hormigon);
      var matEdges = new THREE.LineBasicMaterial({ color: 0x3a4658 });
      matEdges.userData._propio = true;   // creado al vuelo → se dispone al vaciar
      var edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(g.largo, g.alto, g.ancho)), matEdges);
      ST.world.add(box); ST.world.add(edges);
    }
    // Barras: usa los PLACEMENTS (poses 3D) del último generar.
    (out.placements || []).forEach(function (pl) {
      var mat = _matDe({ marca: pl.tipologia });
      var mesh = geom.barraSolida(pl.puntos, pl.diam, mat, { segmentosRadiales: 10 });
      if (mesh) ST.world.add(mesh);
    });
    _fit(g.largo);
    ST.dirty = true;   // PERF (render-on-demand): la escena cambió → repintar
  }

  function _fit(largo) { ST.dist = largo * 1.15 + 160; ST.dirty = true; }

  function _aplicarTema(t) {
    var THREE = global.THREE, T = TEMAS[t] || TEMAS.medio;
    if (!ST.scene) return;
    ST.scene.background = new THREE.Color(T.bg);
    if (ST.grid) { ST.scene.remove(ST.grid); }
    ST.grid = new THREE.GridHelper(1400, 28, T.g1, T.g2); ST.grid.position.y = -1; ST.scene.add(ST.grid);
    ST.materiales.CBS.color.setHex(T.CBS); ST.materiales.CBI.color.setHex(T.CBI);
    ST.materiales.ES.color.setHex(T.ES); ST.materiales.TRV.color.setHex(T.TRV);
    ST.materiales.LT.color.setHex(T.LT);
    ST.tema = t;
    ST.dirty = true;   // PERF (render-on-demand): cambió fondo/colores → repintar
  }

  function _applyCam() {
    var THREE = global.THREE;
    var cx = ST.dist * Math.cos(ST.rotX) * Math.sin(ST.rotY);
    var cy = ST.dist * Math.sin(ST.rotX);
    var cz = ST.dist * Math.cos(ST.rotX) * Math.cos(ST.rotY);
    ST.camera.up.set(0, 1, 0);
    ST.camera.position.set(cx + ST.target.x, cy + ST.target.y, cz + ST.target.z);
    ST.camera.lookAt(ST.target);
    var right = new THREE.Vector3().setFromMatrixColumn(ST.camera.matrix, 0);
    var up = new THREE.Vector3().setFromMatrixColumn(ST.camera.matrix, 1);
    var shift = right.multiplyScalar(ST.panX).add(up.multiplyScalar(ST.panY));
    ST.camera.position.add(shift);
    ST.camera.lookAt(new THREE.Vector3().copy(ST.target).add(shift));
  }

  function _bindOrbita(cv, host) {
    var drag = false, panning = false, lx = 0, ly = 0;
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('mousedown', function (e) {
      lx = e.clientX; ly = e.clientY;
      // Pan con botón MEDIO (1) o derecho (2) — NO rota. Rotar = botón izquierdo.
      if (e.button === 1 || e.button === 2 || e.shiftKey) { panning = true; e.preventDefault(); }
      else drag = true;
    });
    global.addEventListener('mouseup', function () { drag = false; panning = false; });
    global.addEventListener('mousemove', function (e) {
      var dx = e.clientX - lx, dy = e.clientY - ly;
      if (panning) { ST.panX -= dx * ST.dist * 0.0011; ST.panY += dy * ST.dist * 0.0011; lx = e.clientX; ly = e.clientY; _marcarSucio(); return; }
      if (!drag) return;
      if (ST.ejeRot === 'libre') { ST.rotY -= dx * 0.008; ST.rotX += dy * 0.008; }
      else if (ST.ejeRot === 'y') { ST.rotY -= dx * 0.008; }
      else if (ST.ejeRot === 'x') { ST.rotX += dy * 0.008; }
      else if (ST.ejeRot === 'z') { ST.rotY -= dx * 0.008; }
      ST.rotX = Math.max(-1.45, Math.min(1.45, ST.rotX)); lx = e.clientX; ly = e.clientY;
      _marcarSucio();   // PERF: la cámara cambió → repintar
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault(); ST.dist *= (e.deltaY > 0 ? 1.1 : 0.9); ST.dist = Math.max(120, Math.min(6000, ST.dist));
      _marcarSucio();
    }, { passive: false });
  }

  function _resize() {
    if (!ST.renderer) return;
    var host = $('m3d_view'); if (!host) return;
    var w = host.clientWidth, h = host.clientHeight;
    // Si el view aún no tiene tamaño (layout no asentado), cae al stage o a un mínimo,
    // NUNCA aborta con 0×0 (esa era la causa del "canvas negro sin nada").
    if (!w || !h) {
      var st = $('m3d_stage');
      if (st) { w = w || st.clientWidth; h = h || st.clientHeight; }
      if (!w) w = 640; if (!h) h = 420;
    }
    // PERF: sólo re-dimensionar cuando el tamaño CAMBIÓ (setSize por frame era
    // trabajo inútil) y marcar dirty para que el loop repinte ese frame.
    if (ST._vw === w && ST._vh === h) return;
    ST._vw = w; ST._vh = h;
    ST.renderer.setSize(w, h, false);
    ST.renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    if (ST.camera) { ST.camera.aspect = w / h; ST.camera.updateProjectionMatrix(); }
    _marcarSucio();
  }

  // PERF (F0·iv) — RENDER ON DEMAND. El loop renderizaba a 60 fps aunque la escena
  // estuviera quieta (GPU al 100% sin razón con elementos grandes). Ahora sólo pinta
  // si algo marcó ST.dirty: cámara/pan/zoom (_bindOrbita), resize, redibujo, tema,
  // toolbar. El rAF sigue corriendo (es barato) pero sin trabajo de GPU.
  function _marcarSucio() { ST.dirty = true; }

  function _loop() {
    ST.rafId = global.requestAnimationFrame(_loop);
    if (!$('m3d_backdrop') || !$('m3d_backdrop').classList.contains('on')) return;   // no renderizar cerrado
    _resize();                 // marca dirty si el tamaño cambió
    if (!ST.dirty) return;     // nada cambió → no gastar GPU
    ST.dirty = false;
    _applyCam(); ST.renderer.render(ST.scene, ST.camera);
  }

  // --------------------------------------------------------------------------
  // Toolbar
  // --------------------------------------------------------------------------
  function _bindToolbar() {
    var th = $('m3d_tHorm');
    if (th) th.onclick = function () { ST.verHormigon = !ST.verHormigon; th.classList.toggle('on', ST.verHormigon); if (ST.ultimoOut) _redibujar(ST.ultimoOut); };
    var tr = $('m3d_tReset');
    if (tr) tr.onclick = function () { ST.rotX = 0.62; ST.rotY = 0.85; ST.panX = 0; ST.panY = 0; if (ST.target) ST.target.set(0, 0, 0); _fit(ST.receta.geometria.largo); };
    var tema = $('m3d_tema');
    if (tema) tema.querySelectorAll('button').forEach(function (bt) {
      bt.onclick = function () { tema.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); bt.classList.add('on'); _aplicarTema(bt.getAttribute('data-tema')); if (ST.ultimoOut) _redibujar(ST.ultimoOut); };
    });
    var ejes = $('m3d_ejes');
    if (ejes) ejes.querySelectorAll('button').forEach(function (bt) {
      bt.onclick = function () { ejes.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); bt.classList.add('on'); ST.ejeRot = bt.getAttribute('data-eje'); };
    });
    // Anclar centro: la órbita ya gira alrededor del centro (0,0,0); el toggle lo
    // deja explícito (calca la maqueta). Cotas/Medir: aún no operativos (visual).
    var ta = $('m3d_tAncla');
    if (ta) ta.onclick = function () { ta.classList.toggle('on'); if (ST.target) ST.target.set(0, 0, 0); ST.panX = 0; ST.panY = 0; _marcarSucio(); };
    var tc = $('m3d_tCotas'); if (tc) tc.onclick = function () { tc.classList.toggle('on'); };
    var tm = $('m3d_tMedir'); if (tm) tm.onclick = function () { tm.classList.toggle('on'); };
    // Inputs de geometría: enganchar una sola vez (evita listeners duplicados al
    // reabrir el modal).
    if (!ST._geomBound) {
      ['m3d_largo', 'm3d_ancho', 'm3d_alto', 'm3d_recub', 'm3d_recubl'].forEach(function (id) {
        var e = $(id); if (e) e.addEventListener('input', regenerar);
      });
      ST._geomBound = true;
    }
  }

  // --------------------------------------------------------------------------
  // ABRIR / CERRAR
  // --------------------------------------------------------------------------
  global.modelador3dAbrir = function () {
    var d = _deps();
    if (!d.gen || !d.semilla) { alert('El Modelador 3D aún se está cargando. Reintenta en un momento.'); return; }
    var ctx = _ctxAC2();
    if (!ctx.loteId) { alert('Primero crea o abre un despiece (con Obra, Ciclo y Eje) para cargar barras del Enfierrador 3D.'); return; }
    if (!ST.receta) ST.receta = d.semilla.semillaViga();
    var bd = $('m3d_backdrop'); bd.classList.add('on');
    _marcarSucio();   // PERF (render-on-demand): al abrir siempre hay que pintar
    var sub = $('m3d_ctxSub');
    if (sub) sub.innerHTML = 'Despiece activo · <b>' + (ctx.sector || '—') + '</b> · Ciclo ' + (ctx.ciclo || '—') + ' · Eje ' + (ctx.eje || '—');
    // Poblar los inputs de geometría desde la receta.
    $('m3d_largo').value = ST.receta.geometria.largo;
    $('m3d_ancho').value = ST.receta.geometria.ancho;
    $('m3d_alto').value = ST.receta.geometria.alto;
    $('m3d_recub').value = ST.receta.geometria.recub_sup;
    $('m3d_recubl').value = ST.receta.geometria.recub_lat;
    renderComponentes();
    _bindToolbar();
    regenerar();   // stats + resumen aunque el 3D no esté listo aún
    // Cargar Three.js e iniciar la escena. Se difiere a 2 frames para que el modal
    // (recién mostrado con .on) tenga tamaño real → el canvas nunca se crea en 0×0.
    global.requestAnimationFrame(function () { global.requestAnimationFrame(function () {
      if (!ST.threeCargado) {
        cargarThree().then(function (ok) {
          ST.threeCargado = true;
          if (!ok || !global.THREE) { console.warn('[3D Template] Three.js no cargó'); _mostrarWebglMsg(); return; }
          var iniciado = _initEscena();
          if (!iniciado || !ST.webglOk) { console.warn('[3D Template] WebGL no disponible'); _mostrarWebglMsg(); return; }
          if (ST.ultimoOut) _redibujar(ST.ultimoOut);
          _resize();
          console.log('[3D Template] escena iniciada · placements:', (ST.ultimoOut && ST.ultimoOut.placements || []).length);
        });
      } else if (ST.webglOk) {
        if (ST.ultimoOut) _redibujar(ST.ultimoOut);
        _resize();
        if (ST.rafId == null) _loop();   // reanudar el loop si estaba parado
      } else if (ST.webglOk === false) {
        _mostrarWebglMsg();
      }
    }); });
  };

  // Tras mostrar el modal, el layout puede tardar un frame en asentarse. Forzamos
  // un resize + encuadre en el siguiente frame para que el canvas NO quede en 0×0
  // ni con aspecto incorrecto (causa típica del "canvas negro / viga estirada").
  function _resizeDiferido() {
    global.requestAnimationFrame(function () {
      _resize();
      if (ST.receta && ST.receta.geometria) _fit(ST.receta.geometria.largo);
      global.requestAnimationFrame(_resize);
    });
  }

  function _mostrarWebglMsg() {
    var m = $('m3d_webglMsg'), cv = $('m3d_cv');
    if (m) m.style.display = 'flex';
    if (cv) cv.style.display = 'none';
  }

  global.modelador3dCerrar = function () {
    var bd = $('m3d_backdrop'); if (bd) bd.classList.remove('on');
  };

  global.modelador3dRegenerar = function () {
    // Vuelve a la viga-semilla original (avisa que descarta ajustes).
    if (!confirm('Regenerar vuelve a la viga base y descarta los ajustes del panel. ¿Continuar?')) return;
    ST.receta = _deps().semilla.semillaViga();
    // La receta ya no es la del template que estuviera cargado: la traza no debe
    // seguir diciendo que estas barras salieron de él.
    ST.templateId = null;
    $('m3d_largo').value = ST.receta.geometria.largo;
    $('m3d_ancho').value = ST.receta.geometria.ancho;
    $('m3d_alto').value = ST.receta.geometria.alto;
    $('m3d_recub').value = ST.receta.geometria.recub_sup;
    $('m3d_recubl').value = ST.receta.geometria.recub_lat;
    renderComponentes(); regenerar();
  };

  // --------------------------------------------------------------------------
  // CARGAR AL DESPIECE (T1.6) — reusa POST /lotes/{id}/barras
  // --------------------------------------------------------------------------
  global.modelador3dCargarAlDespiece = async function () {
    var A = global.AC2 || {};
    if (!A.loteId) { alert('No hay un despiece activo. Crea uno en el Fabricator primero.'); return; }
    if (!ST.ultimoOut || !ST.ultimoOut.barras.length) { alert('No hay barras generadas para cargar.'); return; }
    // PISO: el backend lo exige por barra y AC2 no tiene piso global → pedirlo (default = último).
    var piso = prompt('¿A qué piso pertenece esta viga? (ej. P4)', ST.piso || A.sector || '');
    if (piso == null) return;
    piso = piso.trim();
    if (!piso) { alert('El piso es obligatorio para cargar las barras.'); return; }
    ST.piso = piso;
    regenerar();   // re-genera con el piso ya fijado (queda en cada barra)
    var ctx = _ctxAC2();
    // Traza opcional: guardar la receta como instancia (elementos_template) para template_instancia_id.
    var instId = null;
    try {
      // template_id = el template del que salió esta receta (o null si se armó a
      // mano). Es la única fila que registra "estas barras vienen de este template",
      // y es la que hace real el 409 del DELETE.
      var ri = await _post('/elementos/instancia', { lote_id: ctx.loteId, template_id: ST.templateId, params: ST.receta });
      if (ri && ri.ok && ri.id) instId = ri.id;
    } catch (e) { /* la traza es opcional; seguimos sin ella */ }
    // Armar las barras con el shape del backend (ya lo trae generar), estampando piso/template/origen.
    var barras = ST.ultimoOut.barras.map(function (b) {
      var o = {}; for (var k in b) if (b.hasOwnProperty(k) && k.charAt(0) !== '_') o[k] = b[k];
      o.piso = piso;
      o.template_instancia_id = instId;
      o.origen = 'template';
      return o;
    });
    try {
      var r = await _post('/lotes/' + ctx.loteId + '/barras', { barras: barras });
      if (!r || !r.ok) {
        var d = r && r.detail; alert('No se cargaron las barras' + (d ? ': ' + (d.msg || JSON.stringify(d)) : '') + '.'); return;
      }
      var n = r.creadas || barras.length;
      alert('✅ ' + n + ' item(s) del Enfierrador 3D cargados al despiece. Aparecen en el editor y en el Bar Manager (origen=template).');
      modelador3dCerrar();
      // Refrescar la grilla del Fabricator si tiene el hook.
      if (typeof global.ac2CargarLote === 'function') { try { global.ac2CargarLote(ctx.loteId); } catch (e) {} }
      else if (typeof global.ac2CargarLotes === 'function') { try { global.ac2CargarLotes(); } catch (e) {} }
    } catch (e) { alert('Error de red al cargar las barras. Reintenta.'); }
  };

  // --------------------------------------------------------------------------
  // GUARDAR / CARGAR TEMPLATE (T1.7)
  // --------------------------------------------------------------------------
  global.modelador3dGuardarTemplate = async function () {
    var ctx = _ctxAC2();
    var nombre = prompt('Nombre del template (ej. "Viga tipo Explora P1-P4"):', '');
    if (nombre == null) return;
    nombre = nombre.trim(); if (!nombre) { alert('El nombre es obligatorio.'); return; }
    try {
      var r = await _post('/templates', { nombre: nombre, tipo: 'viga', params: ST.receta, obra: ctx.proyecto });
      if (r && r.ok) {
        // Desde acá la receta viva ES la de ese template: lo que se cargue al
        // despiece queda trazado contra él.
        if (r.id != null) ST.templateId = r.id;
        alert('💾 Template "' + nombre + '" guardado.');
      } else {
        // El backend explica POR QUÉ (422 con la receta que no genera barras, 403…);
        // tragarse el motivo dejaba al usuario sin nada que corregir.
        var d = r && r.detail;
        alert('No se pudo guardar el template' + (d ? ': ' + (d.msg || (typeof d === 'string' ? d : JSON.stringify(d))) : '') + '.');
      }
    } catch (e) { alert('Error de red al guardar el template.'); }
  };

  global.modelador3dCargarTemplate = async function () {
    var ctx = _ctxAC2();
    try {
      var r = await _get('/templates?tipo=viga' + (ctx.proyecto ? '&obra=' + encodeURIComponent(ctx.proyecto) : ''));
      var tpls = (r && r.templates) || [];
      if (!tpls.length) { alert('No hay templates guardados todavía. Ajusta una viga y usa "Guardar como template".'); return; }
      var lista = tpls.map(function (t, i) { return (i + 1) + ') ' + t.nombre + (t.obra ? '' : ' (general)'); }).join('\n');
      var sel = prompt('Elige un template (número):\n' + lista, '1');
      if (sel == null) return;
      var idx = parseInt(sel, 10) - 1;
      if (isNaN(idx) || !tpls[idx]) { alert('Selección inválida.'); return; }
      // GET /templates ya NO devuelve la receta completa (la lista solo sirve para
      // ELEGIR): la receta se pide por id al template elegido.
      var det = await _get('/templates/' + encodeURIComponent(tpls[idx].id));
      if (!det || !det.params || !det.params.geometria) { alert('No se pudo abrir el template elegido.'); return; }
      ST.receta = det.params;
      // De acá sale la traza: las barras que se carguen al despiece con esta receta
      // quedan apuntando a ESTE template (elementos_template.template_id).
      ST.templateId = (det.id != null) ? det.id : tpls[idx].id;
      $('m3d_largo').value = ST.receta.geometria.largo;
      $('m3d_ancho').value = ST.receta.geometria.ancho;
      $('m3d_alto').value = ST.receta.geometria.alto;
      $('m3d_recub').value = ST.receta.geometria.recub_sup;
      $('m3d_recubl').value = ST.receta.geometria.recub_lat;
      renderComponentes(); regenerar();
      alert('📂 Template "' + tpls[idx].nombre + '" cargado. Ajusta y carga al despiece.');
    } catch (e) { alert('Error de red al listar templates.'); }
  };

  // --------------------------------------------------------------------------
  // HTTP — reusa los helpers de la app (shared/api.js): base /api/v1, token
  // armahub_token, manejo de 401. apiPostJson devuelve data (o null en error) →
  // normalizamos a {ok,...}. apiGet devuelve data (o null).
  // --------------------------------------------------------------------------
  async function _post(url, body) {
    if (typeof global.apiPostJson !== 'function') { alert('No se pudo contactar la API (helper no cargado).'); return { ok: false }; }
    var data = await global.apiPostJson(url, body);
    if (data == null) return { ok: false };   // apiPostJson devuelve null en 401 / parse error
    // apiPostJson NO chequea response.ok → un error del backend llega como {detail:...}
    // (shape de FastAPI) SIN ok. Solo consideramos éxito si el backend puso ok:true.
    if (data.ok === undefined) data.ok = !data.detail;   // con detail = error; sin él = éxito legado
    return data;
  }
  async function _get(url) {
    if (typeof global.apiGet !== 'function') return null;
    return global.apiGet(url);   // devuelve data o null (apiGet ya maneja errores)
  }

  // Exponer para tests / depuración.
  global.ModeladorPanel = {
    _st: ST, regenerar: regenerar, renderComponentes: renderComponentes,
    _ctxAC2: _ctxAC2
  };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
