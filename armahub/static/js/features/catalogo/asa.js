// CATÁLOGO aSa (7-oct) — las figuras de aSa, con el trazo que exportó ella misma.
//
// DE DÓNDE SALE. aSa no entrega las figuras por la API (ocho endpoints probados, los ocho
// 401), pero sí las EXPORTA: el archivo RDX trae, por figura, las coordenadas con que
// dibuja cada lado. Eso se carga con scripts/importar_rdx_figuras.py y es lo que se ve
// acá: el dibujo de aSa, no nuestra reconstrucción.
//
// PARA QUÉ. Para tener el catálogo completo a la vista —531 figuras, no sólo las que
// alcanzamos a ver en barras— y para saber de cada una si la usamos y si la tenemos.
(function (global) {
  'use strict';

  var CAS = { figuras: [], fuera: [], cargado: false };
  var CAS_F = { estado: 'todas' };
  var CAS_TAM = { w: 160, h: 104 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }

  // EL DIBUJO. Los puntos vienen en las unidades del dibujo de aSa —no son milímetros ni
  // centímetros: son el esquema con el que ella representa la figura— así que se dibujan
  // sin grosor real: `metrico` apagado y el trazo nominal. Pedirle al motor que aplique un
  // φ sobre coordenadas que no son centímetros daría un grosor inventado.
  function dibujo(f) {
    var M = global.disenadorMotor;
    if (!M || !M.svgDesdePuntos || (f.puntos || []).length < 2) return '';
    var pts = f.puntos.map(function (p) { return { x: p[0], y: p[1] }; });
    var lados = f.lados || [];
    var completo = lados.length === pts.length - 1;
    try {
      return M.svgDesdePuntos(pts, {
        width: CAS_TAM.w, height: CAS_TAM.h, pad: 16,
        labels: completo ? lados.map(function (l) { return l.nombre || ''; }) : [],
        labels_auto: completo, angulos: false, cotas_arco_iso: []
      });
    } catch (e) { return ''; }
  }

  function visibles() {
    return CAS.figuras.filter(function (f) {
      if (CAS_F.estado === 'usadas') return f.barras > 0;
      if (CAS_F.estado === 'sin_catalogo') return !f.en_catalogo;
      if (CAS_F.estado === 'problema') return f.cadena_rota;
      if (CAS_F.estado === 'td') return f.tridimensional;
      return true;
    });
  }

  function pintarKpis() {
    var el = document.getElementById('casKpis');
    if (!el) return;
    var n = CAS.figuras.length;
    var usadas = CAS.figuras.filter(function (f) { return f.barras > 0; }).length;
    var propias = CAS.figuras.filter(function (f) { return f.en_catalogo; }).length;
    var rotas = CAS.figuras.filter(function (f) { return f.cadena_rota; }).length;
    el.innerHTML =
      '<div class="caskpi"><b>' + n + '</b>figuras en aSa</div>' +
      '<div class="caskpi"><b>' + usadas + '</b>usadas en barras reales</div>' +
      '<div class="caskpi"><b>' + propias + '</b>también en el catálogo ArmaHub</div>' +
      '<div class="caskpi"><b>' + rotas + '</b>con el trazo partido</div>' +
      (CAS.fuera.length
        ? '<div class="caskpi" title="' + esc(CAS.fuera.join(', ')) +
          '"><b>' + CAS.fuera.length + '</b>usadas y NO están en el catálogo</div>' : '');
  }

  function pintarFiltros() {
    var el = document.getElementById('casFiltros');
    if (!el) return;
    var ops = [['todas', 'Todas'], ['usadas', 'Usadas en barras'],
               ['sin_catalogo', 'No están en ArmaHub'], ['td', 'En 3D'],
               ['problema', 'Trazo partido']];
    el.innerHTML = '<span class="dshbl">Ver</span><div class="dshchips" id="casChips">' +
      ops.map(function (o) {
        return '<button data-v="' + o[0] + '" class="' + (CAS_F.estado === o[0] ? 'on' : '') + '">' +
               esc(o[1]) + '</button>';
      }).join('') + '</div>' +
      '<span class="muted" style="font-size:11px">El trazo es el que exportó aSa.</span>';
    el.querySelectorAll('#casChips button').forEach(function (b) {
      b.addEventListener('click', function () {
        CAS_F.estado = b.dataset.v; pintarFiltros(); pintarLista();
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
          : 'Todavía no se ha cargado el catálogo. Se llena con el export RDX de aSa y ' +
            '<code>scripts/importar_rdx_figuras.py</code>.') + '</div>';
      return;
    }
    el.innerHTML = '<div class="casgrid">' + figs.map(function (f) {
      var svg = dibujo(f);
      var clases = 'cascard' + (f.cadena_rota ? ' mal' : '') + (f.en_catalogo ? '' : ' nocat');
      var etq = f.en_catalogo
        ? '<span class="casetq propia">en ArmaHub</span>'
        : '<span class="casetq nativa">sólo aSa</span>';
      var uso = f.barras
        ? num(f.barras) + ' barra(s)' + (f.cc ? ' · ' + esc(f.cc) : '')
        : '<span style="color:#b0bec5">sin uso registrado</span>';
      return '<div class="' + clases + '">' +
        '<div class="cascod">' + esc(f.codigo) + etq + '</div>' +
        '<div class="casdib">' + (svg || '<span class="muted" style="font-size:11px">sin trazo</span>') + '</div>' +
        '<div class="casinfo">' + (f.lados || []).length + ' lado(s)' +
          (f.tridimensional ? ' · 3D' : '') + (f.generica ? '' : ' · de obra') + '</div>' +
        '<div class="casinfo">' + uso + '</div>' +
        (f.cadena_rota ? '<div class="casaviso">⚠ el trazo viene en pedazos sueltos</div>' : '') +
        '</div>';
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
      CAS.fuera = (d && d.fuera_del_catalogo) || [];
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
