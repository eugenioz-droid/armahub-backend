// =============================================================================
// Modelador 3D — REGLAS / EXPANSOR GENÉRICO DE DISTRIBUCIÓN (F0 · T0.4)
// El corazón del motor: un componente = figura base + una CADENA de
// "distribuidores" (operadores). expandirComponente() despacha por modo y
// devuelve una lista de Placements (poses de barra). Un solo mecanismo sirve a
// viga/muro/columna (§0-11ter del diseño).
//
// Placement = {
//   puntos: [{x,y,z}],   // polilínea 3D de ESA barra (host coords, cm)
//   diam,                // cm
//   tipologia, figura, suf_tipo,
//   dims: {A,B,C,D,...}, // dims efectivas de la barra (para el payload/estimación)
//   angulos: [..],       // ángulos de la figura (persistir con la convención catálogo)
//   meta: { cara, capa, zona }   // trazabilidad (no se persiste, sí agrupa)
// }
//
// MVP: LINEAR (estribos por zonas) + LAYERED (cabezales en capas). Grid /
// Perimeter / Points = stubs que devuelven [] (2ª entrega: muro/columna).
//
// Depende de ModeladorFiguraPuntos (figuraAPuntos). No usa THREE → testeable.
// =============================================================================
(function (global) {
  'use strict';

  var FP = global.ModeladorFiguraPuntos ||
    (typeof require !== 'undefined' ? require('./figura_puntos.js') : null);

  // ---------------------------------------------------------------------------
  // T0.5 — REDONDEO DE CANTIDAD (longitud ÷ @ → nº de barras)
  // ---------------------------------------------------------------------------
  // REDONDEO DE ESTRIBOS — ESPEJO EXACTO de ArmaPilot (verificado 08-ago contra el
  // código real: bar_model.py::calc_line_count y LISP ARM-FLUJOS-CALC-LINE-COUNT):
  //     count = ceil(dist_util / esp) + 1    ("cerrando el intervalo útil")
  //     garantiza que la separación REAL nunca exceda `esp` ("cada @ o menos").
  //     edge: esp<=0 o dist<=0 → 1.
  // OJO (uniones de zona): si una zona TERMINA donde otra ARRANCA, el estribo del
  // punto de unión NO se duplica. Lo maneja distribuidorLinear al encadenar zonas
  // (última posición de una zona = primera de la siguiente → se cuenta 1 sola vez).
  // Esta función = conteo de UNA zona aislada (con sus 2 extremos); el encadenado
  // descuenta la frontera compartida.
  function redondeoCantidadZona(longitud, sep) {
    var s = Number(sep) || 0, d = Number(longitud) || 0;
    if (s <= 0 || d <= 0) return 1;
    return Math.ceil(d / s) + 1;
  }

  // ---------------------------------------------------------------------------
  // DISTRIBUIDORES
  // ---------------------------------------------------------------------------

  // LINEAR — a lo largo del eje X (largo). cfg.zonas = [{long, sep}] (cm). Por
  // cada zona: n = redondeoCantidadZona(long, sep); posiciona n placements
  // repartidos por la zona. Usado por estribos (con confinamiento por zonas).
  // base: { figura, diam, tipologia, suf, dims, angulos, host, anchorBase, rol }
  function distribuidorLinear(base, cfg, host) {
    var placements = [];
    var zonas = (cfg && cfg.zonas) || [];
    var start = (cfg && cfg.start_offset) || (base.anchorBase && base.anchorBase.recubExtremo) || 0;
    var xcur = -host.largo / 2 + start;   // arranca tras el recubrimiento
    var x1 = host.largo / 2 - start;
    for (var zi = 0; zi < zonas.length; zi++) {
      var z = zonas[zi];
      var n = redondeoCantidadZona(z.long, z.sep);
      for (var k = 0; k < n; k++) {
        var xx = xcur + k * (Number(z.sep) || 0);
        if (xx > x1 + 1e-6) break;
        var anchor = _mezclarAnchor(base.anchorBase, { x: xx });
        var puntos = FP.figuraAPuntos(base.figura, base.dims, host, anchor,
          { rol: base.rol || 'estribo', diamCm: base.diam });
        placements.push(_placement(base, puntos, { zona: zi + 1 }));
      }
      xcur += Number(z.long) || 0;
    }
    return placements;
  }

  // LAYERED — n_capas × barras_capa, apiladas hacia el núcleo con gap. Usado por
  // cabezales (cara sup/inf). Reparte barras_capa a lo ancho (Z); cada capa se
  // retranquea hacia el núcleo por su índice (offset = capa_idx*(diam+gap)).
  // cfg: { n_capas, barras_capa, gap, sentido:'nucleo' }
  function distribuidorLayered(base, cfg, host) {
    var placements = [];
    var nCapas = Math.max(1, (cfg && cfg.n_capas) || 1);
    var nBarras = Math.max(1, (cfg && cfg.barras_capa) || 1);
    var gap = (cfg && cfg.gap != null) ? cfg.gap : 0;
    var recubLat = (base.anchorBase && base.anchorBase.recubLat != null) ? base.anchorBase.recubLat : 3;
    var zHalf = host.ancho / 2 - recubLat - base.diam / 2;
    var cara = (base.anchorBase && base.anchorBase.cara) || 'sup';
    var s = (cara === 'sup') ? -1 : 1;   // hacia el núcleo
    var yBorde = (cara === 'sup')
      ? (host.alto / 2 - (base.anchorBase.recub || 4) - base.diam / 2)
      : (-host.alto / 2 + (base.anchorBase.recub || 4) + base.diam / 2);
    for (var c = 0; c < nCapas; c++) {
      var y = yBorde + s * c * (base.diam + gap);   // retranqueo por capa
      for (var i = 0; i < nBarras; i++) {
        var z = (nBarras > 1) ? (-zHalf + (2 * zHalf) * (i / (nBarras - 1))) : 0;
        var anchor = _mezclarAnchor(base.anchorBase, { y: y, z: z, cara: cara });
        var puntos = FP.figuraAPuntos(base.figura, base.dims, host, anchor,
          { rol: base.rol || 'cabezal', diamCm: base.diam });
        placements.push(_placement(base, puntos, { capa: c + 1, cara: cara }));
      }
    }
    return placements;
  }

  // GRID / PERIMETER / POINTS — STUBS (2ª entrega: muro/columna/puntuales).
  // TODO(2ª entrega): implementar malla 2D (muro), perímetro (columna) y puntual.
  function distribuidorGrid(base, cfg, host) { return []; /* TODO malla 2D muro */ }
  function distribuidorPerimeter(base, cfg, host) { return []; /* TODO longitudinales columna */ }
  function distribuidorPoints(base, cfg, host) { return []; /* TODO bastones/puntuales */ }

  // ---------------------------------------------------------------------------
  // EXPANSOR: despacha por comp.distribucion.modo
  // ---------------------------------------------------------------------------
  function expandirComponente(comp, host) {
    var dist = comp.distribucion || {};
    var base = _baseDeComponente(comp, host);
    switch (dist.modo) {
      case 'linear': return distribuidorLinear(base, dist, host);
      case 'layered': return distribuidorLayered(base, dist, host);
      case 'grid': return distribuidorGrid(base, dist, host);
      case 'perimeter': return distribuidorPerimeter(base, dist, host);
      case 'points': return distribuidorPoints(base, dist, host);
      default: return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  // Resuelve las dims EFECTIVAS de un componente: cada dim 'auto' se deriva del
  // host; 'fija' toma su valor. Para el MVP: en cabezal, B(auto)=largo−2·recub;
  // en estribo, los lados del perímetro (auto)=alto/ancho−2·recub.
  function _dimsEfectivas(comp, host) {
    var dims = {};
    var g = comp.dims || {};
    var recub = (host.recub_sup != null ? host.recub_sup : 4);
    var recubLat = (host.recub_lat != null ? host.recub_lat : 3);
    Object.keys(g).forEach(function (k) {
      var d = g[k];
      if (d && d.modo === 'fija') { dims[k] = Number(d.valor); return; }
      // AUTO: deriva según rol + letra.
      if (comp._rol === 'cabezal') {
        // B = largo − 2·recub extremo (patas van fuera del tramo B)
        dims[k] = host.largo - 2 * recub;
      } else if (comp._rol === 'estribo') {
        // perímetro: A/C = alto útil; B/D = ancho útil (aprox — el backend recalcula largo)
        var altoUtil = host.alto - 2 * recub;
        var anchoUtil = host.ancho - 2 * recubLat;
        dims[k] = (k === 'A' || k === 'C') ? anchoUtil : altoUtil;
      } else {
        dims[k] = host.alto - 2 * recub;
      }
    });
    return dims;
  }

  function _baseDeComponente(comp, host) {
    comp._rol = comp._rol || _rolDeTipologia(comp.tipologia, comp.cara);
    var recub = (comp.recub_override != null) ? comp.recub_override
      : (comp.cara === 'inf' ? (host.recub_inf != null ? host.recub_inf : 4)
                             : (host.recub_sup != null ? host.recub_sup : 4));
    return {
      figura: comp.figura, diam: Number(comp.diam) / 10,   // mm → cm
      tipologia: comp.tipologia, suf: comp.suf_tipo || '',
      dims: _dimsEfectivas(comp, host),
      angulos: comp.angulos || null,
      rol: comp._rol,
      anchorBase: {
        cara: comp.cara, recub: recub,
        recubLat: (host.recub_lat != null ? host.recub_lat : 3),
        recubExtremo: recub
      }
    };
  }

  function _rolDeTipologia(tip, cara) {
    var t = (tip || '').toUpperCase();
    if (t === 'ES' || t === 'ESC' || t === 'EC') return 'estribo';
    if (t === 'TRV' || t === 'TR' || t === 'TC' || t === 'TRC' || t === 'TRL' || t === 'TRF') return 'traba';
    return 'cabezal';   // CBS/CBI/CB/LT/… longitudinales
  }

  function _mezclarAnchor(baseAnchor, extra) {
    var a = {};
    for (var k in baseAnchor) if (baseAnchor.hasOwnProperty(k)) a[k] = baseAnchor[k];
    for (var j in extra) if (extra.hasOwnProperty(j)) a[j] = extra[j];
    return a;
  }

  function _placement(base, puntos, meta) {
    return {
      puntos: puntos, diam: base.diam,
      tipologia: base.tipologia, figura: base.figura, suf_tipo: base.suf,
      dims: base.dims, angulos: base.angulos,
      meta: meta || {}
    };
  }

  var API = {
    redondeoCantidadZona: redondeoCantidadZona,
    expandirComponente: expandirComponente,
    distribuidorLinear: distribuidorLinear,
    distribuidorLayered: distribuidorLayered,
    distribuidorGrid: distribuidorGrid,
    distribuidorPerimeter: distribuidorPerimeter,
    distribuidorPoints: distribuidorPoints
  };

  global.ModeladorReglas = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
