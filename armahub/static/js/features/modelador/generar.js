// =============================================================================
// Modelador 3D — GENERAR (F0 · T0.6)
// generarViga(receta) → expande TODOS los componentes con el motor de reglas →
// placements 3D → convierte cada placement a una BarraPayload (mismo shape que
// ac2Payload) para POST /lotes/{id}/barras.
//
// CONTRATO (del guion): el motor SOLO llena figura + dim_* + ang* + diam + cant
// + mult (+ origen/template_instancia_id). NO envía largo ni peso: el BACKEND
// los calcula (largo_desde_lados + peso.py + factor de obra). El kg del resumen
// (stats en vivo) se estima aquí con la MISMA fórmula (espejo de peso.py) pero
// NO se envía.
//
// Además, el payload debe llenar EXACTAMENTE los slots que la FIGURA usa (según
// sus parciales/ángulos del catálogo) y dejar el resto vacío, para pasar
// validar_geometria en el backend.
//
// Depende de ModeladorReglas (expandirComponente). No usa THREE → testeable.
// =============================================================================
(function (global) {
  'use strict';

  // Resolver la dependencia EN EL MOMENTO DE USARLA, no al cargar el módulo: en el
  // navegador los scripts se cargan en PARALELO y generar.js puede ejecutarse ANTES
  // que reglas.js → capturarlo aquí daba null para siempre (bug "0 barras").
  function _reglas() {
    return global.ModeladorReglas ||
      (typeof require !== 'undefined' ? require('./reglas.js') : null);
  }

  // Espejo del catálogo (armahub/catalogo.py _FIGURAS_SEED) SOLO para las figuras
  // de la viga-semilla. Se usa para saber QUÉ slots llenar (parciales/ángulos) y
  // así pasar validar_geometria. Si en el futuro se leen del backend, reemplazar
  // esta tabla por el GET /figuras-catalogo.
  var FIGURAS = {
    '101A': { parciales: ['A'], angulos: [], radio: false },
    '102A': { parciales: ['A', 'B'], angulos: [], radio: false },
    '103A': { parciales: ['A', 'B', 'C'], angulos: [], radio: false },
    '103B': { parciales: ['A', 'B', 'C'], angulos: [45, 45], radio: false },
    '104D': { parciales: ['A', 'B', 'C', 'D'], angulos: [135, 135], radio: false }
  };

  var LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

  // PESO espejo de peso.py: 7850·π·(φmm/2000)²·(largo cm/100). SOLO para stats.
  function pesoUnitarioEstimado(diamMm, largoCm) {
    if (diamMm == null || largoCm == null) return null;
    return 7850 * Math.PI * Math.pow(Number(diamMm) / 2000, 2) * (Number(largoCm) / 100);
  }

  // Largo estimado = suma de los lados (dims) que la figura USA (espejo de
  // largo_desde_lados; el radio no suma). SOLO para stats — el backend recalcula.
  function largoEstimado(figura, dimsLetras) {
    var spec = FIGURAS[figura];
    if (!spec) return null;
    var total = 0;
    for (var i = 0; i < spec.parciales.length; i++) {
      var v = dimsLetras[spec.parciales[i]];
      if (v == null || !isFinite(v)) return null;
      total += Number(v);
    }
    return total;
  }

  // Convierte un placement (dims por letra) a la BarraPayload del backend.
  // marca = tipología (+ el suf viaja aparte en suf_tipo, como en ac2Payload).
  // Llena SOLO los slots que la figura usa; el resto va null.
  function placementABarra(pl, ctx) {
    var spec = FIGURAS[pl.figura] || { parciales: [], angulos: [], radio: false };
    var diamMm = Math.round(pl.diam * 10);   // cm → mm (diámetro estándar)
    var b = {
      // Ubicación: del contexto del lote (AC2), no de la receta.
      sector: ctx.sector || null, ciclo: ctx.ciclo || null,
      piso: ctx.piso || null, eje: ctx.eje || null,
      nombre_plano: ctx.nombre_plano || null,
      diam: diamMm,
      figura: pl.figura,
      marca: pl.tipologia || null,
      cant: 1, mult: 1,
      radio: null,
      revisada: false,
      suf_tipo: (pl.suf_tipo || '').trim() || null,
      // origen/template — el backend los aceptará (T1.1). Default seguro.
      origen: 'template',
      template_instancia_id: (ctx.template_instancia_id != null ? ctx.template_instancia_id : null)
    };
    // dim_a..dim_i: solo los parciales de la figura.
    LETRAS.forEach(function (L) {
      var col = 'dim_' + L.toLowerCase();
      b[col] = (spec.parciales.indexOf(L) !== -1 && pl.dims[L] != null) ? Number(pl.dims[L]) : null;
    });
    // ang1..ang4: los ángulos de la figura (convención del catálogo).
    for (var a = 0; a < 4; a++) {
      b['ang' + (a + 1)] = (a < spec.angulos.length) ? Number(spec.angulos[a]) : null;
    }
    return b;
  }

  // AGRUPACIÓN por item/etiqueta: barras IDÉNTICAS (misma figura/diam/dims/marca/
  // suf/ángulos) se colapsan a 1 fila con cant = N (lógica cant/mult de barras).
  // Espeja la regla de fabricación (§0-5ter): capas iguales → 1 etiqueta ×N.
  function _claveBarra(b) {
    return [b.figura, b.diam, b.marca, b.suf_tipo,
      b.dim_a, b.dim_b, b.dim_c, b.dim_d, b.dim_e, b.dim_f, b.dim_g, b.dim_h, b.dim_i,
      b.ang1, b.ang2, b.ang3, b.ang4].join('|');
  }

  function agruparBarras(barras) {
    var mapa = {}, orden = [];
    barras.forEach(function (b) {
      var k = _claveBarra(b);
      if (!mapa[k]) { mapa[k] = Object.assign({}, b, { cant: 0 }); orden.push(k); }
      mapa[k].cant += 1;
    });
    return orden.map(function (k) { return mapa[k]; });
  }

  // ---------------------------------------------------------------------------
  // RETRANQUEO / DEPENDENCIAS (§DISCOVERY-INTERACCIÓN-2.B/C)
  // ---------------------------------------------------------------------------
  // Modelo CORREGIDO del usuario (NO escalones): la barra se desplaza COMPLETA
  // hacia el núcleo. Si es recta (101A) sólo cambia de posición (largo IGUAL);
  // si tiene patas (103x) el tramo B se corre adentro y las patas A/C se ACORTAN
  // en el offset → el largo (suma de lados) baja → el peso sale bien.
  //
  // PRIORIDAD: número GLOBAL único por componente. El de MENOR número va más
  // AFUERA (al recubrimiento); el de MAYOR número se retranquea hacia el núcleo
  // una cantidad = diámetro de la barra prioritaria con la que cruza, en las
  // caras donde la cruza.
  //
  // MVP (límites documentados):
  //  - Grafo simple: cada componente con prioridad se compara con TODOS los de
  //    prioridad menor (más externos). El offset acumulado = suma de los φ de las
  //    prioritarias cuya ORIENTACIÓN es transversal (cruzan la barra).
  //  - "cara donde cruza": se aproxima por orientación. Un cabezal (corre en X)
  //    se retranquea en Y (hacia el núcleo) por cada estribo/traba prioritaria
  //    (corren en YZ). Un estribo/traba se retranquea si hay un cabezal más
  //    prioritario (raro). Si NINGUNA prioritaria cruza a la barra, NO se ajusta.
  //  - Simplificación explícita: se retranquea la barra COMPLETA (los 4 lados por
  //    igual) cuando depende de una prioritaria que va por fuera; NO se hace el
  //    análisis lado-por-lado fino (queda como límite del MVP → 'pendientes').

  // Orientación dominante de un placement: 'X' (longitudinal, corre en el largo)
  // o 'YZ' (transversal: estribo/traba en el plano de sección).
  function _orientacion(pl) {
    var pts = pl.puntos || [];
    if (pts.length < 2) return 'X';
    var dx = 0, dyz = 0;
    for (var i = 1; i < pts.length; i++) {
      dx += Math.abs(pts[i].x - pts[i - 1].x);
      dyz += Math.abs(pts[i].y - pts[i - 1].y) + Math.abs(pts[i].z - pts[i - 1].z);
    }
    return (dx >= dyz) ? 'X' : 'YZ';
  }

  // Desplaza TODOS los puntos de un placement por (dx,dy,dz).
  // PERF (F0·esArco): conserva el flag `esArco` del punto original. Ese flag lo pone
  // figura_puntos._arcoYZ en los puntos MUESTREADOS de un arco y motor_geom lo usa
  // para NO meter un fillet-toro redundante ahí. Recrear el punto sin él (esto era
  // un .map que sólo copiaba x/y/z) hacía que un estribo RETRANQUEADO por prioridad
  // perdiera la optimización y volviera a generar ~14 toros por codo. Es aditivo:
  // no cambia ninguna coordenada.
  function _trasladar(pts, dx, dy, dz) {
    return pts.map(function (p) {
      var q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (p.esArco) q.esArco = true;
      return q;
    });
  }

  // resolverDependencias(placements) → placements ajustados (in-place sobre copias).
  // Requiere que los placements traigan `prioridad` (del componente). Los que no
  // tienen prioridad se dejan intactos (funcionan como si no chocaran con nadie).
  function resolverDependencias(placements) {
    if (!placements || !placements.length) return placements;
    // Índice de placements por prioridad presente.
    var conPrio = placements.filter(function (p) { return p.prioridad != null; });
    if (conPrio.length < 2) return placements;   // nada que resolver

    // φ (cm) máximo por nivel de prioridad — el offset que impone una prioritaria.
    // Se agrupa por prioridad y orientación para poder decidir cruces.
    var porPrio = {};   // prioridad → { diam, orient, comp_id }
    conPrio.forEach(function (p) {
      var k = p.prioridad;
      if (!porPrio[k]) porPrio[k] = { diam: p.diam, orient: _orientacion(p) };
      else { porPrio[k].diam = Math.max(porPrio[k].diam, p.diam); }
    });
    var prios = Object.keys(porPrio).map(Number).sort(function (a, b) { return a - b; });

    placements.forEach(function (pl) {
      if (pl.prioridad == null) return;
      var miOrient = _orientacion(pl);
      // Suma de φ de TODAS las prioritarias MÁS EXTERNAS (prioridad menor) cuya
      // orientación es transversal a la mía (la cruzan).
      var offset = 0;
      prios.forEach(function (pr) {
        if (pr >= pl.prioridad) return;            // sólo las más externas
        var info = porPrio[pr];
        if (info.orient === miOrient) return;      // paralelas: no se cruzan
        offset += info.diam;                       // cruza → retranquea 1·φ
      });
      if (offset <= 0) return;
      pl._retranqueo = offset;
      if (miOrient === 'X') {
        // Cabezal: se corre en Y hacia el núcleo. Dirección: cara sup → -Y, inf → +Y.
        var cara = (pl.meta && pl.meta.cara) || (pl.puntos[1] && pl.puntos[1].y > 0 ? 'sup' : 'inf');
        var s = (cara === 'sup') ? -1 : 1;
        pl.puntos = _trasladar(pl.puntos, 0, s * offset, 0);
        // Patas A/C (103x) se ACORTAN en el offset (el tramo B se corrió adentro,
        // el extremo de la pata sigue anclado al recubrimiento externo).
        _acortarPatas(pl, offset);
      } else {
        // Estribo/traba transversal: se corre en Z hacia el núcleo (aprox por el
        // signo del primer punto). Límite MVP: sin lado-por-lado.
        var sz = (pl.puntos[0] && pl.puntos[0].z > 0) ? -1 : 1;
        pl.puntos = _trasladar(pl.puntos, 0, 0, sz * offset);
      }
    });
    return placements;
  }

  // Acorta las patas A y/o C de un placement 103x en `off` cm y recalcula la
  // geometría de esos ganchos (el resto queda igual). Recta (101A) no tiene patas.
  function _acortarPatas(pl, off) {
    var f = (pl.figura || '').toUpperCase();
    if (f.indexOf('103') !== 0 && f.indexOf('104') !== 0) return;   // sólo figuras con patas
    if (pl.dims && pl.dims.A != null) pl.dims.A = Math.max(0, Number(pl.dims.A) - off);
    if (pl.dims && pl.dims.C != null) pl.dims.C = Math.max(0, Number(pl.dims.C) - off);
    // Reflejar el acortamiento en la polilínea: los puntos de gancho (primero y
    // último cuando hay patas) se acercan `off` hacia el tramo (en Y).
    var pts = pl.puntos;
    if (!pts || pts.length < 4) return;   // patrón 103x = [pataA, x0, x1, pataC]
    var first = pts[0], second = pts[1];
    var last = pts[pts.length - 1], prev = pts[pts.length - 2];
    // La pata va de `second` a `first` en Y; acortarla = mover `first` hacia `second`.
    var dirA = Math.sign(first.y - second.y) || 0;
    first.y -= dirA * off;
    var dirC = Math.sign(last.y - prev.y) || 0;
    last.y -= dirC * off;
  }

  // generarViga(receta) → { placements, barras, resumen }
  // receta = { tipo:'viga', geometria:{largo,ancho,alto,recub_sup,recub_inf,recub_lat}, componentes:[...] }
  // ctx = { sector, ciclo, piso, eje, nombre_plano, template_instancia_id } (contexto del lote)
  function generarViga(receta, ctx) {
    ctx = ctx || {};
    var geo = receta.geometria || {};
    var host = {
      largo: Number(geo.largo), alto: Number(geo.alto), ancho: Number(geo.ancho),
      recub_sup: geo.recub_sup != null ? Number(geo.recub_sup) : 4,
      recub_inf: geo.recub_inf != null ? Number(geo.recub_inf) : 4,
      recub_lat: geo.recub_lat != null ? Number(geo.recub_lat) : 3
    };
    var REGLAS = _reglas();
    if (!REGLAS) { console.error('[generar] ModeladorReglas no disponible aún'); return { placements: [], barras: [], resumen: { items: 0, barras: 0, kg: 0 } }; }
    var placements = [];
    (receta.componentes || []).forEach(function (comp) {
      var pls = REGLAS.expandirComponente(comp, host);
      placements = placements.concat(pls);
    });
    // ETAPA DE DEPENDENCIAS/RETRANQUEO — DESPUÉS de expandir. Aplica el offset al
    // anchor (traslada la barra completa hacia el núcleo) y acorta patas 103x.
    // Sin prioridades = no-op → generarViga base queda IDÉNTICA.
    resolverDependencias(placements);
    // Barras SIN agrupar (1 por placement) — el shape del backend.
    var barrasSueltas = placements.map(function (pl) { return placementABarra(pl, ctx); });
    // Barras AGRUPADAS por item/etiqueta (cant = N) — lo que se carga al despiece.
    var barras = agruparBarras(barrasSueltas);

    // Resumen (stats en vivo) — kg estimado en el front (NO se envía).
    var totalBarrasFisicas = 0, totalKg = 0;
    barras.forEach(function (b) {
      var dimsLetras = {};
      LETRAS.forEach(function (L) { var v = b['dim_' + L.toLowerCase()]; if (v != null) dimsLetras[L] = v; });
      var largo = largoEstimado(b.figura, dimsLetras);
      var pu = pesoUnitarioEstimado(b.diam, largo);
      var cantTotal = (b.cant || 0) * (b.mult || 1);
      b._largoEstimado = largo;
      b._pesoEstimado = (pu != null) ? pu * cantTotal : null;
      totalBarrasFisicas += cantTotal;
      if (pu != null) totalKg += pu * cantTotal;
    });

    return {
      placements: placements,
      barras: barras,
      resumen: {
        items: barras.length,
        barras: totalBarrasFisicas,
        kg: Math.round(totalKg * 10) / 10
      }
    };
  }

  var API = {
    FIGURAS: FIGURAS,
    generarViga: generarViga,
    resolverDependencias: resolverDependencias,
    placementABarra: placementABarra,
    agruparBarras: agruparBarras,
    pesoUnitarioEstimado: pesoUnitarioEstimado,
    largoEstimado: largoEstimado
  };

  global.ModeladorGenerar = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
