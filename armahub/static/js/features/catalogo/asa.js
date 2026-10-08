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
  var CAS_F = { estado: 'todas', texto: '', cotas: true };
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
  // LAS COTAS DE aSa. El trazo dice por dónde va el fierro; las cotas son lo que aSa
  // escribe encima —la altura, el ancho, el ángulo entre dos lados— y son la mitad de lo
  // que se lee en una figura. Vienen del mismo RDX (ver la migración 132) y se dibujan con
  // las mismas piezas que el editor: la línea de cota, sus dos patitas hasta los vértices
  // que mide, y la letra con que aSa la llama.
  //
  // El ángulo (`AN`) sólo trae el vértice: no hay arco que dibujar, así que va su letra en
  // el punto donde aSa la pone. Dibujar un arco inventado sería agregar información que
  // aSa no dio.
  function etiquetasDe(f) {
    var out = [];
    (f.cotas || []).forEach(function (c) {
      if (c.linea && c.linea.length === 2) {
        out.push({ tipo: c.tipo === 'WR' ? 'radio' : 'cota',
                   x1: c.linea[0][0], y1: c.linea[0][1], x2: c.linea[1][0], y2: c.linea[1][1] });
        (c.ref || []).forEach(function (r) {
          out.push({ tipo: 'auxiliar', x1: r[0][0], y1: r[0][1], x2: r[1][0], y2: r[1][1] });
        });
      }
      var t = c.texto || c.centro;
      if (t) out.push({ tipo: c.tipo === 'AN' ? 'angulo' : 'letra', texto: c.nombre || '', x: t[0], y: t[1] });
    });
    return out;
  }

  function dibujo(f) {
    var M = global.disenadorMotor;
    if (!M || !M.svgDesdePuntos || (f.puntos || []).length < 2) return '';
    var pts = f.puntos.map(function (p) { return { x: p[0], y: p[1] }; });
    var lados = f.lados || [];
    var completo = lados.length === pts.length - 1;
    // LOS LADOS CURVOS SE DIBUJAN CURVOS. Las coordenadas del RDX son sólo las puntas de
    // cada lado, así que unirlas con rectas convierte una barra en arco en una barra
    // recta: la 201A, que es un arco de 60°, salía como una línea. El RDX sí dice cuáles
    // son curvos (`DrawingArcAngle`, `DrawingArcRadius` y el centro `Cen`), y el
    // importador deja eso resuelto en cada lado. Son 300 lados en 189 figuras.
    //
    // EL SENTIDO SE INVIERTE, igual que en el formulario de auditoría. El `sweep` del
    // importador es 1 = antihorario con la Y hacia ARRIBA, que es como vienen las
    // coordenadas de aSa; el motor voltea la Y para dibujar (comprobado: el punto (0,100)
    // sale arriba en pantalla) y entrega el número como sweep-flag del comando A de SVG,
    // que mide ángulos con la Y hacia ABAJO. Voltear la Y invierte el sentido de giro, así
    // que lo que era antihorario pasa a horario y el flag tiene que ir al revés.
    //
    // Caso de control, la 201A: un arco de 60° cuyo centro aSa pone BAJO la cuerda, así
    // que la barra bombea hacia ARRIBA. Su sweep geométrico es 0, y en SVG el flag que
    // bombea hacia arriba es el 1. O sea 1 − s. (Primero lo puse tal cual, mirando el
    // path a ojo en vez de calcularlo; salieron todas espejadas y el usuario lo vio.)
    var curvos = completo && lados.some(function (l) { return l.curvo; });
    try {
      return M.svgDesdePuntos(pts, {
        width: CAS_TAM.w, height: CAS_TAM.h, pad: 16,
        labels: completo ? lados.map(function (l) { return l.nombre || ''; }) : [],
        labels_auto: completo, angulos: false, cotas_arco_iso: [],
        tipos_seg: curvos ? lados.map(function (l) { return l.curvo ? 'arco' : 'recto'; }) : null,
        radios_seg: curvos ? lados.map(function (l) { return l.radio_arco || 0; }) : null,
        sweeps_seg: curvos ? lados.map(function (l) { return l.sweep == null ? 1 : 1 - l.sweep; }) : null,
        etiquetas: CAS_F.cotas ? etiquetasDe(f) : []
      });
    } catch (e) { return ''; }
  }

  // BUSCAR UNA FIGURA POR SU NOMBRE. Con 531 tarjetas, encontrar la T12 a ojo es
  // desplazarse veinte pantallas. Busca en el código y en el CC de ejemplo, que son los dos
  // datos por los que uno llega a una figura: o sabe cómo se llama, o la vio en un pedido.
  // Varias palabras separadas por espacio tienen que estar TODAS (no es «o»), así se puede
  // afinar escribiendo más en vez de empezar de nuevo.
  function pasaTexto(f) {
    var q = (CAS_F.texto || '').trim().toLowerCase();
    if (!q) return true;
    var heno = [f.codigo, f.cc, f.marca, f.obra, f.descripcion]
      .filter(Boolean).join(' ').toLowerCase();
    return q.split(/\s+/).every(function (p) { return heno.indexOf(p) >= 0; });
  }

  function visibles() {
    return CAS.figuras.filter(function (f) {
      if (!pasaTexto(f)) return false;
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
      '<input id="casBuscar" class="casbuscar" type="search" placeholder="Buscar figura (T12, 104E1, un CC…)" ' +
      'value="' + esc(CAS_F.texto || '') + '" autocomplete="off">' +
      '<div class="dshchips"><button id="casCotas" class="' + (CAS_F.cotas ? 'on' : '') + '" ' +
      'title="Las cotas que dibuja aSa: altura, ancho y los ángulos entre lados.">Cotas</button></div>' +
      '<span class="muted" style="font-size:11px">El trazo y las cotas son los que exportó aSa.</span>';
    el.querySelectorAll('#casChips button').forEach(function (b) {
      b.addEventListener('click', function () {
        CAS_F.estado = b.dataset.v; pintarFiltros(); pintarLista();
      });
    });
    var tog = document.getElementById('casCotas');
    if (tog) {
      tog.addEventListener('click', function () {
        CAS_F.cotas = !CAS_F.cotas; pintarFiltros(); pintarLista();
      });
    }
    var caja = document.getElementById('casBuscar');
    if (caja) {
      // SÓLO SE REPINTA LA LISTA, no los filtros: volver a dibujar el input mientras se
      // escribe le quita el foco al campo y la segunda letra se pierde.
      caja.addEventListener('input', function () {
        CAS_F.texto = caja.value; pintarLista();
      });
    }
  }

  function pintarLista() {
    var el = document.getElementById('casLista');
    if (!el) return;
    var figs = visibles();
    if (!figs.length) {
      el.innerHTML = '<div class="muted" style="padding:22px; text-align:center; font-size:12px">' +
        (!CAS.figuras.length
          ? 'Todavía no se ha cargado el catálogo. Se llena con el export RDX de aSa y ' +
            '<code>scripts/importar_rdx_figuras.py</code>.'
          : (CAS_F.texto || '').trim()
            ? 'Ninguna figura dice «' + esc(CAS_F.texto.trim()) + '».'
            : 'Ninguna figura con ese filtro.') + '</div>';
      return;
    }
    // CUÁNTAS SE ESTÁN VIENDO. Con 531 figuras y un buscador, no saber si quedaron 3 o 300
    // obliga a contarlas a ojo o a bajar hasta el final.
    el.innerHTML = '<div class="muted" style="font-size:11px; margin-bottom:6px">' +
      (figs.length === CAS.figuras.length
        ? figs.length + ' figuras'
        : figs.length + ' de ' + CAS.figuras.length + ' figuras') + '</div>' +
      '<div class="casgrid">' + figs.map(function (f) {
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
