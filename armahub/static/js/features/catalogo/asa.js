// CATÁLOGO aSa (7-oct) — todas las figuras que usa aSa, dibujadas con NUESTRO motor.
//
// PARA QUÉ EXISTE. Para ver de un vistazo con qué figuras tenemos problemas, en vez de
// descubrirlo una por una cuando a alguien le toca auditarlas. Cada figura se reconstruye
// desde lo que manda aSa (los lados de `LegAngle`, los vectores de `ShapeDims`, el
// mandril) y se compara contra la envolvente que aSa declara: lo que no cuadra sale
// marcado, con el motivo.
//
// aSa NO tiene un catálogo de formas —se probaron ocho endpoints y todos dan 401—, así que
// la lista sale de recorrer barras reales (scripts/escanear_figuras_asa.py). Por eso cada
// tarjeta muestra de qué barra concreta salió: si una figura se ve rara, ahí está el
// código de control y la marca para ir a mirarla en aSa.
(function (global) {
  'use strict';

  var CAS = { figuras: [], cargado: false };
  var CAS_F = { estado: 'todas' };   // todas | problema | nativas
  var CAS_TAM = { w: 160, h: 96 };   // el dibujo: más grande que una miniatura, se mira

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }

  // EL DIBUJO. La misma policurva que usan las auditorías: puntos en mm (se pasan a cm,
  // que es lo que entiende el motor) y un tramo por segmento, recto o arco. Los arcos van
  // con su radio y su sentido —traducido a la convención del lienzo— para que el motor no
  // les meta un codo encima.
  function dibujo(f) {
    var M = global.disenadorMotor;
    if (!M || !M.svgDesdePuntos || !(f.puntos || []).length) return '';
    var pts = f.puntos.map(function (p) { return { x: p[0] / 10, y: p[1] / 10 }; });
    var tramos = f.tramos || [];
    var completo = tramos.length === pts.length - 1;
    try {
      return M.svgDesdePuntos(pts, {
        width: CAS_TAM.w, height: CAS_TAM.h, pad: 18,
        tipos_seg: completo ? tramos.map(function (s) { return s.tipo === 'arco' ? 'arco' : 'recto'; }) : null,
        radios_seg: completo ? tramos.map(function (s) { return s.tipo === 'arco' ? (s.radio || 0) / 10 : 0; }) : null,
        sweeps_seg: completo ? tramos.map(function (s) { return s.sweep == null ? 1 : 1 - s.sweep; }) : null,
        labels: completo ? tramos.map(function (s) { return (s.tipo === 'recto' && s.largo) ? String(Math.round(s.largo / 10)) : ''; }) : [],
        labels_auto: completo, angulos: completo, cotas_arco_iso: [],
        diam_mm: f.diam, metrico: true
      });
    } catch (e) { return ''; }
  }

  function visibles() {
    return CAS.figuras.filter(function (f) {
      if (CAS_F.estado === 'problema') return !f.ok;
      if (CAS_F.estado === 'nativas') return !f.en_catalogo;
      return true;
    });
  }

  function pintarKpis() {
    var el = document.getElementById('casKpis');
    if (!el) return;
    var n = CAS.figuras.length;
    var mal = CAS.figuras.filter(function (f) { return !f.ok; }).length;
    var nativas = CAS.figuras.filter(function (f) { return !f.en_catalogo; }).length;
    var barras = CAS.figuras.reduce(function (a, f) { return a + (f.barras || 0); }, 0);
    el.innerHTML =
      '<div class="caskpi"><b>' + n + '</b>figuras distintas</div>' +
      '<div class="caskpi"><b>' + (n - mal) + '</b>se dibujan bien</div>' +
      '<div class="caskpi"><b>' + mal + '</b>con problema</div>' +
      '<div class="caskpi"><b>' + nativas + '</b>no están en nuestro catálogo</div>' +
      '<div class="caskpi"><b>' + num(barras) + '</b>barras vistas</div>';
  }

  function pintarFiltros() {
    var el = document.getElementById('casFiltros');
    if (!el) return;
    var ops = [['todas', 'Todas'], ['problema', 'Con problema'], ['nativas', 'Sólo nativas de aSa']];
    el.innerHTML = '<span class="dshbl">Ver</span><div class="dshchips" id="casChips">' +
      ops.map(function (o) {
        return '<button data-v="' + o[0] + '" class="' + (CAS_F.estado === o[0] ? 'on' : '') + '">' +
               esc(o[1]) + '</button>';
      }).join('') + '</div>' +
      '<span class="muted" style="font-size:11px">Salen de barras reales; la tarjeta dice de cuál.</span>';
    el.querySelectorAll('#casChips button').forEach(function (b) {
      b.addEventListener('click', function () {
        CAS_F.estado = b.dataset.v;
        pintarFiltros(); pintarLista();
      });
    });
  }

  function pintarLista() {
    var el = document.getElementById('casLista');
    if (!el) return;
    var figs = visibles();
    if (!figs.length) {
      el.innerHTML = '<div class="muted" style="padding:22px; text-align:center; font-size:12px">' +
        (CAS.figuras.length
          ? 'Ninguna figura con ese filtro.'
          : 'Todavía no se ha barrido aSa. Se llena con <code>scripts/escanear_figuras_asa.py</code>.') +
        '</div>';
      return;
    }
    el.innerHTML = '<div class="casgrid">' + figs.map(function (f) {
      var svg = dibujo(f);
      var clases = 'cascard' + (f.ok ? '' : ' mal') + (f.en_catalogo ? '' : ' nocat');
      // El aviso dice POR QUÉ no cuadra, no sólo que no cuadra: «la envolvente no cuadra:
      // construida 2070 × 600, aSa dice 2135 × 297» es una pista; «error» no es nada.
      var aviso = f.ok ? '' : '<div class="casaviso">⚠ ' + esc(f.motivo || 'no se pudo reconstruir') + '</div>';
      return '<div class="' + clases + '">' +
        '<div class="cascod">' + esc(f.codigo) +
          '<span class="casetq ' + (f.en_catalogo ? 'propia' : 'nativa') + '">' +
          (f.en_catalogo ? 'en catálogo' : 'sólo aSa') + '</span></div>' +
        '<div class="casdib">' + (svg || '<span class="muted" style="font-size:11px">sin dibujo</span>') + '</div>' +
        '<div class="casinfo">' + num(f.barras) + ' barra(s) · φ' + num(f.diam) + 'mm' +
          (f.tridimensional ? ' · 3D' : '') + '</div>' +
        '<div class="casinfo" title="' + esc((f.obra || '') + ' · ' + (f.cc || '') + ' · ' + (f.marca || '')) + '">' +
          esc(f.cc || '') + ' · ' + esc(f.marca || '') + '</div>' +
        aviso + '</div>';
    }).join('') + '</div>';
  }

  global.loadCatalogoAsa = async function () {
    if (!document.getElementById('catSubAsa')) return;
    if (CAS.cargado) { pintarKpis(); pintarFiltros(); pintarLista(); return; }
    var lista = document.getElementById('casLista');
    if (lista) lista.innerHTML = '<div class="muted" style="padding:22px; text-align:center">Cargando…</div>';
    try {
      var d = await global.apiGet('/catalogo-asa/figuras');
      CAS.figuras = (d && d.figuras) || [];
      CAS.cargado = true;
    } catch (e) {
      if (lista) lista.innerHTML = '<div class="muted" style="padding:22px; text-align:center">' +
        esc(e.message || 'No se pudo cargar') + '</div>';
      return;
    }
    pintarKpis(); pintarFiltros(); pintarLista();
  };

  // Para los tests: las reglas puras, sin DOM.
  global.__catalogoAsaTest = { visibles: visibles, dibujo: dibujo, CAS: CAS, CAS_F: CAS_F };

})(window);
