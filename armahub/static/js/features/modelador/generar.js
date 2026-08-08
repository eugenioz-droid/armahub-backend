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
    placementABarra: placementABarra,
    agruparBarras: agruparBarras,
    pesoUnitarioEstimado: pesoUnitarioEstimado,
    largoEstimado: largoEstimado
  };

  global.ModeladorGenerar = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
