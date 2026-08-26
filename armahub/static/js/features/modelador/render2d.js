// =============================================================================
// Modelador — DIBUJANTE 2D PURO (el de los cuadrantes del editor, sin DOM)
//
// QUÉ ES: la geometría de dibujo de una vista 2D —proyectar, encuadrar, rebanar en
// profundidad y convertir barras en trazos— extraída de `_dibujarVista2D`
// (template_editor.js) a funciones que NO tocan el DOM, NO leen `ST` y NO conocen
// una cámara. Entra un arreglo de `placements` (lo que devuelve
// ModeladorGenerar.generarElemento) y sale texto SVG o datos de trazo.
//
// POR QUÉ EXISTE (26-ago): la columna «Sección» del Gestor de templates dibujaba un
// ESQUEMA —un resumen de decenas de bytes que el backend derivaba de la receta— y el
// usuario pidió «que se vea como se ve en el editor, más ampliada y precisa». La única
// forma honesta de conseguirlo es dibujar con el MOTOR REAL y con el MISMO dibujante;
// cualquier otra cosa son dos verdades sobre el mismo fierro. De ahí que este archivo
// sea el dibujante del editor y no una segunda versión suya: el editor le pide los
// mismos trazos que emitía a mano.
//
// LO QUE ENTRA POR PARÁMETRO (y por qué)
//   · el COLOR — igual que disenadorMotor.TINTA. `colorDe(pl)` lo resuelve quien
//     llama (el editor con su paleta única COL2D); acá no hay ni un hex de fierro.
//   · el ROL — `rolDe(pl)`. La autoridad del rol es ModeladorReglas y vive en el
//     llamador; este archivo sólo pregunta «¿es cabezal?» para decidir si la barra
//     se ve de punta.
//   · las LETRAS de los ejes — el editor reetiqueta x/y/z a Y/Z/X para la obra
//     (EJE_DISPLAY). Ese diccionario es suyo; acá se recibe ya traducido.
//   · qué está APAGADO — `oculto(ci)`; una barra invisible no se agrupa.
// Nada de eso se adivina: sin `colorDe` no se dibuja fierro, y punto.
//
// LOS DOS RECORTES SON EJES DISTINTOS Y SE COMBINAN
//   1) REBANADA (profundidad). Una vista 2D proyecta TODA la profundidad sobre el
//      plano: en el corte horizontal de un muro eso apila los 250 cm de altura encima
//      del corte. El editor ya resuelve esto con dos clipping planes sobre una banda
//      (ST.corteEspesor / _semiEspesorCorte / o.corte) y con el mismo vocabulario:
//      «rebanada». Acá se dibuja en SVG puro, sin three.js, así que la banda se aplica
//      a mano sobre los placements — mismo concepto, misma palabra, otra herramienta.
//   2) EXTREMOS (a lo largo). Un plano muy alargado —un muro es 524 × 20— no se lee
//      entero: a escala fiel su espesor mide 9 px. Se recorta a los DOS extremos, a la
//      MISMA escala, uno al lado del otro.
// Son independientes: los dos cuadros de los extremos muestran la MISMA rebanada.
//
// LO QUE ESTE ARCHIVO NO HACE: elegir el plano (eso es PLANOS_POR_ELEMENTO, en el
// editor), nombrar los ejes, conocer tipos de elemento. No hay una sola rama por
// tipología ni por rol de elemento: todo sale de la geometría que entra.
//
// DIBUJAR NO ESCRIBE: ninguna función de acá muta los placements ni sus puntos.
// =============================================================================
(function (global) {
  'use strict';

  // ---- CONSTANTES DE DIBUJO -------------------------------------------------
  // Radio mínimo de una barra vista de punta, en px. Es el mismo piso que ya usaba
  // `_dibujarVista2D`: por debajo el círculo desaparece en zoom-out extremo.
  var R_MIN_PX = 1.5;

  // ESPESOR DE LA REBANADA, en cm. El usuario lo acotó: «no más de 25 o 30 cms».
  // Se toma el techo, 30, y el número está MEDIDO contra el muro de referencia
  // (524 × 250 × 20): la separación de sus distribuciones EN PROFUNDIDAD es de
  // 18,8 cm la malla horizontal (@20) y 48,8 cm la traba (@40). Con 30 cm la banda
  // contiene SIEMPRE al menos una fila de cualquier reparto de hasta @30 —que es la
  // familia entera de mallas— y deja sitio para que el buscador de posición (ver
  // `rebanada`) encuentre una banda donde además caiga la traba. Con 20 cm el margen
  // de maniobra desaparece; con más de 30 se vuelve a apilar fierro que el corte no
  // debería mostrar.
  var REBANADA_CM = 30;

  // Cuántas separaciones de la distribución tiene que abarcar como mínimo la ventana
  // de un extremo. Con menos de DOS posiciones consecutivas el reparto no se lee (y
  // una traba @40 puede no aparecer en el recorte): se vería un fierro suelto en vez
  // de un patrón. Medido en el muro de referencia: paso máximo 39,9 cm → ventana 79,7.
  var PASOS_MIN_VENTANA = 2;

  function _num(v) { return Math.round(Number(v) * 100) / 100; }
  // La medida COMO SE ESCRIBIÓ: 20 y no 20.0, 2.5 y no 2.50. Es cifra del usuario —no
  // se le agregan decimales que él no puso— y desde que cada fila usa su propia escala
  // es lo único que dice el tamaño de verdad.
  function _medida(v) {
    var n = Math.round(Number(v) * 10) / 10;
    return String(n === Math.round(n) ? Math.round(n) : n);
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // PROYECCIÓN
  // ---------------------------------------------------------------------------
  // Proyector genérico: dado el def de un plano → función punto3D → {u,v}. Son las
  // mismas tres líneas que tenía el editor; viven acá para que el dibujo del gestor y
  // el del cuadrante no puedan proyectar distinto.
  function proyector(def) {
    return function (p) { return { u: p[def.u], v: p[def.v] }; };
  }

  // Eje del mundo con MAYOR extensión de una polilínea = "por dónde corre" la barra.
  function ejeMayorSpan(pts) {
    if (!pts || pts.length < 2) return null;
    var lo = { x: Infinity, y: Infinity, z: Infinity };
    var hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.x < lo.x) lo.x = p.x; if (p.x > hi.x) hi.x = p.x;
      if (p.y < lo.y) lo.y = p.y; if (p.y > hi.y) hi.y = p.y;
      if (p.z < lo.z) lo.z = p.z; if (p.z > hi.z) hi.z = p.z;
    }
    var mejor = 'x', span = hi.x - lo.x;
    if (hi.y - lo.y > span) { mejor = 'y'; span = hi.y - lo.y; }
    if (hi.z - lo.z > span) { mejor = 'z'; span = hi.z - lo.z; }
    return mejor;
  }

  // Extensión de UNA barra en un eje del mundo. Devuelve null si no tiene puntos
  // legibles (no se inventa un cero, que la pondría en el origen).
  function tramo(pl, eje) {
    var pts = pl && pl.puntos;
    if (!pts || !pts.length) return null;
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var v = pts[i][eje];
      if (!isFinite(v)) continue;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    return isFinite(lo) ? { lo: lo, hi: hi, c: (lo + hi) / 2, span: hi - lo } : null;
  }

  // La UNIDAD DE MATERIAL de un placement. El editor la llama `ci` (índice del
  // componente); fuera del editor —el gestor genera desde la receta cruda— no hay
  // meta.ci todavía y manda comp_id. Se pregunta por las dos porque el que llama no
  // tiene por qué preparar los placements sólo para esto.
  function clavePieza(pl) {
    if (pl && pl.meta && pl.meta.ci != null) return 'i' + pl.meta.ci;
    return 'c' + ((pl && pl.comp_id) || '');
  }

  // ---------------------------------------------------------------------------
  // AGRUPADOR — un trazo por componente, no dos nodos por barra (ver la nota de PERF
  // en _dibujarVista2D). `clave(pl, ci)` devuelve el discriminante FINO; devolver
  // null descarta. `oculto(ci)` es el filtro de la ampolleta del editor.
  // ---------------------------------------------------------------------------
  function agrupar(placements, clave, oculto) {
    var grupos = [], indice = {};
    for (var i = 0; i < (placements || []).length; i++) {
      var pl = placements[i];
      if (!pl) continue;
      var ci = (pl.meta && pl.meta.ci != null) ? pl.meta.ci : -1;
      if (oculto && oculto(ci)) continue;
      var k = clave ? clave(pl, ci) : '';
      if (k == null) continue;
      k = ci + '|' + k;
      var g = indice[k];
      if (!g) { g = indice[k] = { ci: ci, clave: k, pls: [] }; grupos.push(g); }
      g.pls.push(pl);
    }
    return grupos;
  }

  // ---------------------------------------------------------------------------
  // ENCUADRE
  // ---------------------------------------------------------------------------
  // Caja envolvente de lo proyectado (+ el rectángulo de hormigón si lo hay).
  function bbox(placements, proj, rect) {
    var u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    function acc(u, v) {
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    if (rect && rect.W > 0 && rect.H > 0) {
      acc(-rect.W / 2, -rect.H / 2); acc(rect.W / 2, rect.H / 2);
    }
    for (var i = 0; i < (placements || []).length; i++) {
      var pts = (placements[i] && placements[i].puntos) || [];
      for (var k = 0; k < pts.length; k++) {
        var q = proj(pts[k]);
        if (isFinite(q.u) && isFinite(q.v)) acc(q.u, q.v);
      }
    }
    if (!isFinite(u0) || !isFinite(v0)) return null;
    return { u0: u0, u1: u1, v0: v0, v1: v1 };
  }

  // TRANSFORM AFÍN (u,v) cm → px. La misma forma que usa el editor: X = cu + ku·u,
  // Y = cv + kv·v, con kv<0 porque la y del SVG crece hacia abajo. `s` = px/cm.
  function _t(cu, ku, cv, kv) {
    return { cu: cu, ku: ku, cv: cv, kv: kv, s: Math.abs(ku) || 1 };
  }
  function tX(t, u) { return t.cu + t.ku * u; }
  function tY(t, v) { return t.cv + t.kv * v; }

  // La caja envolvente CENTRADA en un viewBox de VW×VH con un margen en px. Es el
  // encuadre del "SVG plano" que el editor usa cuando todavía no hay render 3D detrás.
  function encuadre(bb, VW, VH, margen) {
    if (!bb) return null;
    var m = (margen == null) ? 30 : margen;
    var spanU = Math.max(bb.u1 - bb.u0, 1e-6), spanV = Math.max(bb.v1 - bb.v0, 1e-6);
    var s = Math.min((VW - 2 * m) / spanU, (VH - 2 * m) / spanV);
    return _t((VW - spanU * s) / 2 - bb.u0 * s, s, (VH - spanV * s) / 2 + bb.v1 * s, -s);
  }

  // Una VENTANA concreta (u0..u1, v0..v1) centrada en una caja de px, a una escala
  // DADA. Es lo que permite que los dos cuadros de los extremos compartan escala: la
  // escala se decide una vez y los dos la reciben.
  function encuadreVentana(vent, caja, s) {
    var wpx = (vent.u1 - vent.u0) * s, hpx = (vent.v1 - vent.v0) * s;
    return _t(caja.x + (caja.w - wpx) / 2 - vent.u0 * s, s,
      caja.y + (caja.h - hpx) / 2 + vent.v1 * s, -s);
  }

  // ---------------------------------------------------------------------------
  // REBANADA EN PROFUNDIDAD
  // ---------------------------------------------------------------------------
  // Devuelve la banda {lo, hi, c, esp} sobre el eje de PROFUNDIDAD del plano, o null
  // si el elemento es más delgado que la rebanada (entonces se ve entero y no hay nada
  // que recortar ni nada que advertir).
  //
  // DÓNDE SE PONE LA BANDA es tan importante como cuánto mide, y NO se pone al medio
  // por decreto. Medido en el muro de referencia: una banda de 30 cm centrada en la
  // mitad de la altura contiene la malla horizontal y la vertical pero NO la traba
  // —que es justo lo que distingue «dos cortinas cosidas» de «dos cortinas sueltas»,
  // o sea la pregunta que esta miniatura vino a contestar—. Así que la posición se
  // ELIGE: entre las bandas candidatas gana la que muestra MÁS PIEZAS DISTINTAS y, a
  // igualdad, la más cercana al centro del elemento (la zona típica, no el arranque).
  //
  // Las CANDIDATAS son las mismas «rebanadas» que ya busca el editor
  // (_slicesEnProfundidad): los centros de las piezas que el plano cruza DE CANTO —las
  // que viven casi en un solo valor de la profundidad, como un estribo o una traba—.
  // Una pieza que CORRE por la profundidad (una malla vertical en un corte horizontal)
  // atraviesa cualquier banda, así que no aporta candidatas ni discrimina.
  function rebanada(placements, def, opts) {
    opts = opts || {};
    var dep = def.depth;
    var piezas = [], gLo = Infinity, gHi = -Infinity, i;
    for (i = 0; i < (placements || []).length; i++) {
      var tr = tramo(placements[i], dep);
      if (!tr) continue;
      tr.k = clavePieza(placements[i]);
      piezas.push(tr);
      if (tr.lo < gLo) gLo = tr.lo; if (tr.hi > gHi) gHi = tr.hi;
    }
    if (!piezas.length) return null;
    var total = gHi - gLo;
    var esp = Math.min((opts.espesor != null) ? Number(opts.espesor) : REBANADA_CM, total);
    if (!(esp > 0) || esp >= total) return null;   // más delgado que la rebanada: entero

    // «Cruza de canto» = su extensión en profundidad es pequeña. Mismo umbral que el
    // editor: el 15% del espesor, con piso 8 cm y techo 40.
    var umbral = Math.min(Math.max(total * 0.15, 8), 40);
    var cand = [];
    for (i = 0; i < piezas.length; i++) if (piezas[i].span <= umbral) cand.push(piezas[i].c);
    cand.sort(function (a, b) { return a - b; });
    var uniq = [];
    for (i = 0; i < cand.length; i++) {
      if (!uniq.length || Math.abs(cand[i] - uniq[uniq.length - 1]) > 0.5) uniq.push(cand[i]);
    }
    var centro = (gLo + gHi) / 2;
    function acotar(c) {
      var lo = Math.max(gLo, Math.min(gHi - esp, c - esp / 2));
      return { lo: lo, hi: lo + esp, c: lo + esp / 2, esp: esp };
    }
    if (!uniq.length) return acotar(centro);
    var mejor = null;
    for (i = 0; i < uniq.length; i++) {
      var b = acotar(uniq[i]), vistas = {}, n = 0;
      for (var j = 0; j < piezas.length; j++) {
        if (piezas[j].hi < b.lo || piezas[j].lo > b.hi) continue;
        if (!vistas[piezas[j].k]) { vistas[piezas[j].k] = 1; n++; }
      }
      var d = Math.abs(b.c - centro);
      if (!mejor || n > mejor.n || (n === mejor.n && d < mejor.d)) mejor = { b: b, n: n, d: d };
    }
    return mejor.b;
  }

  // Las barras que la banda deja pasar. Devuelve un arreglo NUEVO: los placements no
  // se tocan.
  function filtrar(placements, def, banda) {
    if (!banda) return (placements || []).slice();
    var out = [];
    for (var i = 0; i < (placements || []).length; i++) {
      var tr = tramo(placements[i], def.depth);
      if (tr && tr.hi >= banda.lo && tr.lo <= banda.hi) out.push(placements[i]);
    }
    return out;
  }

  // PASO TÍPICO de las distribuciones a lo largo de un eje: por cada pieza, la mediana
  // del hueco entre sus posiciones consecutivas; se devuelve el MAYOR de todas. Es lo
  // que dice cuánto elemento hay que mostrar para que el reparto se lea como reparto.
  // Una pieza con una sola posición en ese eje no tiene paso y no cuenta.
  function pasoTipico(placements, eje) {
    var porPieza = {}, i;
    for (i = 0; i < (placements || []).length; i++) {
      var tr = tramo(placements[i], eje);
      if (!tr) continue;
      var k = clavePieza(placements[i]);
      (porPieza[k] = porPieza[k] || []).push(Math.round(tr.c * 100) / 100);
    }
    var mejor = 0;
    Object.keys(porPieza).forEach(function (k) {
      var a = porPieza[k].slice().sort(function (x, y) { return x - y; });
      var cen = [];
      for (var j = 0; j < a.length; j++) if (!cen.length || a[j] !== cen[cen.length - 1]) cen.push(a[j]);
      if (cen.length < 2) return;
      var gaps = [];
      for (var m = 1; m < cen.length; m++) gaps.push(cen[m] - cen[m - 1]);
      gaps.sort(function (x, y) { return x - y; });
      var med = gaps[Math.floor(gaps.length / 2)];
      if (med > mejor) mejor = med;
    });
    return mejor;
  }

  // ---------------------------------------------------------------------------
  // TRAZOS — las barras de una vista, ya proyectadas, como datos de path
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // EL PISO DE LOS REDONDOS, PROPORCIONAL (26-ago)
  // ---------------------------------------------------------------------------
  // Una barra vista DE PUNTA se dibuja con su radio REAL, pero a las escalas a las que
  // se mira un elemento entero —el cuadrante del editor anda entre 0,7 y 1,5 px/cm y la
  // miniatura en ~1— el radio real de un φ16 es 0,8 px: no se ve. De ahí el piso.
  //
  // EL PROBLEMA DEL PISO A SECAS es que APLASTA información: con él un φ8 y un φ25 salen
  // exactamente del mismo tamaño, y «¿el cabezal es más gordo que la traba?» deja de
  // tener respuesta en el dibujo. (Medido: por debajo de 1,88 px/cm TODOS los diámetros
  // de un muro caen al piso — le pasaba al cuadrante del editor tanto como a la lista.)
  //
  // Así que el piso se aplica UNA vez, al más fino del dibujo, y todos los demás se
  // engordan por EL MISMO FACTOR: los redondos salen más grandes de lo que son —y el
  // título lo dice cuando pasa— pero sus tamaños RELATIVOS vuelven a ser los reales.
  // Devuelve 1 cuando a esa escala ya se ven solos.
  function engordeRedondos(placements, def, s, opts) {
    opts = opts || {};
    var rolDe = opts.rolDe;
    var rMin = (opts.rMin != null) ? Number(opts.rMin) : R_MIN_PX;
    if (!rolDe) return 1;
    var dMin = Infinity;
    for (var i = 0; i < (placements || []).length; i++) {
      var pl = placements[i];
      if (!pl || !pl.puntos) continue;
      if (rolDe(pl) !== 'cabezal') continue;
      if (ejeMayorSpan(pl.puntos) !== def.depth) continue;   // no se ve de punta en esta vista
      var d = Number(pl.diam);
      if (isFinite(d) && d > 0 && d < dMin) dMin = d;
    }
    if (!isFinite(dMin)) return 1;
    var rReal = (dMin / 2) * Math.abs(s || 1);
    return (rReal > 0 && rReal < rMin) ? (rMin / rReal) : 1;
  }

  // Un círculo como SUBTRAZO de un path (dos semiarcos relativos): es lo que permite
  // meter TODAS las barras de punta de un componente en UN solo nodo.
  function dCirculo(cx, cy, r) {
    var rr = r.toFixed(1), d2 = (2 * r).toFixed(1);
    return 'M' + (cx - r).toFixed(1) + ',' + cy.toFixed(1) +
      'a' + rr + ',' + rr + ' 0 1,0 ' + d2 + ',0' +
      'a' + rr + ',' + rr + ' 0 1,0 -' + d2 + ',0Z';
  }

  // (placements, def, transform, opts) → un registro por GRUPO de dibujo:
  //   { ci, rol, color, punta, op, diam, d, dHalo, dHit }
  // `d` es el trazo (o los círculos, si la barra se ve de punta), `dHalo` el contorno
  // de selección y `dHit` la zona de clic; los dos últimos sólo si se piden — el
  // gestor no tiene ni selección ni clic sobre la miniatura y construirlos sería
  // fabricar texto que nadie lee.
  //
  // opts: { colorDe(pl), rolDe(pl), oculto(ci), opacidadDe(pl,rol), halo, hit, rMin }
  function trazos(placements, def, t, opts) {
    opts = opts || {};
    var colorDe = opts.colorDe, rolDe = opts.rolDe;
    if (!colorDe || !rolDe) return [];
    var opacidadDe = opts.opacidadDe || function () { return 1; };
    var conHalo = opts.halo !== false, conHit = opts.hit !== false;
    var rMin = (opts.rMin != null) ? Number(opts.rMin) : R_MIN_PX;
    // Cuánto hay que engordar los redondos para que el más fino se vea (ver arriba).
    var engorde = engordeRedondos(placements, def, t && t.s, opts);
    var proj = proyector(def);
    // La clave lleva la PIEZA además del ci porque quien llama puede no haber
    // etiquetado los placements: el editor sí lo hace (meta.ci) y ahí este trozo es
    // constante dentro de cada grupo —o sea, la partición no cambia—, pero el gestor
    // dibuja lo que sale del motor tal cual, sin ci, y sin esto dos componentes del
    // mismo color se fundirían en un solo trazo.
    var grupos = agrupar(placements, function (pl) {
      var rolK = rolDe(pl);
      var puntaK = (rolK === 'cabezal' && ejeMayorSpan(pl.puntos) === def.depth);
      return (puntaK ? 'o' : 'l') + colorDe(pl) + '|' + opacidadDe(pl, rolK) + '|' + clavePieza(pl);
    }, opts.oculto);

    var out = [];
    for (var gi = 0; gi < grupos.length; gi++) {
      var gr = grupos[gi], pl0 = gr.pls[0];
      var rol = rolDe(pl0);
      // ¿La barra se ve DE PUNTA en esta vista? (su eje longitudinal es la profundidad
      // del plano) → círculo, no polilínea. Criterio GEOMÉTRICO: sirve igual para
      // piezas volteadas, cuyo eje longitudinal ya cambió de verdad.
      var punta = (rol === 'cabezal' && ejeMayorSpan(pl0.puntos) === def.depth);
      var dTrazo = '', dHalo = '', dHit = '', diam = 0;
      for (var k = 0; k < gr.pls.length; k++) {
        var pl = gr.pls[k];
        if (Number(pl.diam) > diam) diam = Number(pl.diam);
        var raw = pl.puntos || [], pts = [], q;
        for (var r = 0; r < raw.length; r++) {
          q = proj(raw[r]);
          if (isFinite(q.u) && isFinite(q.v)) pts.push(q);
        }
        if (!pts.length) continue;
        if (punta) {
          // Punto representativo = el TRAMO RECTO que corre en profundidad (el cuerpo
          // de la barra), NO pts[0] (que es la punta del gancho). Todos los puntos del
          // tramo proyectan al mismo (u,v): se toma el extremo del segmento con mayor
          // delta en la profundidad.
          var q0 = pts[0], mejorDelta = -1;
          for (var si = 1; si < raw.length; si++) {
            var dd = Math.abs((raw[si][def.depth] || 0) - (raw[si - 1][def.depth] || 0));
            if (dd > mejorDelta) { mejorDelta = dd; q0 = proj(raw[si]); }
          }
          // Radio de la barra en px. pl.diam viene en CENTÍMETROS (reglas.js lo
          // convierte una sola vez: φ16 → 1.6) y t.s es px/cm. El `engorde` es común a
          // TODO el dibujo, así que un φ25 sigue saliendo más gordo que un φ8.
          // Sin diámetro no hay radio que escalar: se dibuja al piso, para que una barra
          // con el dato roto se VEA en vez de desaparecer del corte.
          var dCm = Number(pl.diam);
          var rPx = (dCm > 0) ? (dCm / 2) * Math.abs(t.s || 1) * engorde : rMin;
          var cx = tX(t, q0.u), cy = tY(t, q0.v);
          dTrazo += dCirculo(cx, cy, rPx);
          if (conHalo) dHalo += dCirculo(cx, cy, rPx + 2.5);
          if (conHit) dHit += dCirculo(cx, cy, Math.max(7.5, rPx + 3));
        } else {
          var seg = '';
          for (var p = 0; p < pts.length; p++) {
            seg += (p ? 'L' : 'M') + tX(t, pts[p].u).toFixed(1) + ',' + tY(t, pts[p].v).toFixed(1) +
              (p < pts.length - 1 ? ' ' : '');
          }
          dTrazo += (dTrazo ? ' ' : '') + seg;
        }
      }
      if (!dTrazo) continue;
      out.push({
        ci: gr.ci, rol: rol, color: colorDe(pl0), punta: punta, engorde: engorde,
        op: opacidadDe(pl0, rol), diam: diam,
        d: dTrazo, dHalo: (conHalo ? dHalo : ''), dHit: (conHit ? dHit : '')
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // EL PLAN DE LA MINIATURA — qué se va a dibujar, antes de dibujarlo
  // ---------------------------------------------------------------------------
  // Se separa del SVG a propósito: el TOOLTIP tiene que decir exactamente lo que la
  // imagen muestra (qué plano, qué mide, qué rebanada, si son extremos y cuánto se ve),
  // y si esa frase se derivara por su cuenta sería una segunda verdad que puede
  // desmentir al dibujo. Acá se decide UNA vez y el texto y los píxeles leen lo mismo.
  //
  // ESTO ES UNA PREVISUALIZACIÓN, NO UN PLANO (26-ago, decisión del usuario).
  // Hubo una versión con ESCALA COMÚN a toda la lista, para que comparar dos filas a
  // ojo significara algo. Se probó y él la descartó con el argumento correcto: «es que
  // esto es una previsualización… entonces nos da lo mismo la escala, queremos ver un
  // detalle claro de qué se trata el template». Normalizar la escala obliga a que el
  // elemento más exigente encoja a todos los demás, y lo que se pierde —el fierro
  // grande— es justo lo que la columna vino a mostrar.
  //
  // ASÍ QUE LA REGLA ES OTRA, Y ES UNA SOLA: **el corte LLENA EL ALTO del cuadro.**
  //   escala = alto útil / lo que mide el corte a lo alto
  // De ahí sale todo lo demás. Un muro de 15 cm y uno de 60 salen los dos con el mismo
  // grosor en pantalla: el fierro se ve grande siempre, que es el pedido. Una viga que
  // se dibuja entera llena el alto igual, con sus 60 cm de canto, y por eso sale
  // angosta. No hay una rama por elemento: hay un alto que se llena.
  //
  // LO QUE ESO CUESTA, Y CÓMO SE PAGA. Dos filas dejan de ser comparables a ojo: que un
  // corte se vea más grueso que otro ya NO significa que lo sea. Se compensa diciendo
  // las medidas: el rótulo lleva SIEMPRE los centímetros reales del hormigón (ver
  // `rotulos`), así que el tamaño lo dan los números y no el dibujo. Callarlo sería
  // dejar que la imagen afirme algo que no sostiene.
  //
  // Y EL ANCHO PASA A SER VARIABLE, porque ya no lo fija nadie: es cuánto elemento hay
  // que enseñar, por la escala que acaba de salir del alto. Va ACOTADO (ANCHO_CUADRO_MAX)
  // para que un muro con muchísimo confinamiento no estire la fila sin límite; cuando el
  // tope corta, el plan lo DICE (`ventanaCorta`) con los centímetros que quedaron fuera.
  //
  // POR QUÉ SIEMPRE LOS DOS EXTREMOS y no uno solo cuando el fierro «parece simétrico»:
  // mostrar un extremo AFIRMA que el otro es igual. Es una afirmación sobre el fierro,
  // derivada de leer la receta, y si se equivoca miente justo donde más importa. Con
  // los dos cuadros no se afirma nada: se muestran los dos y quien mira compara.
  //
  // Reparto de la miniatura, en px del viewBox. Va en UNA tabla porque el plan, el
  // dibujo y la hoja de estilo tienen que estar de acuerdo sobre el mismo rectángulo:
  // `cabecera` es la franja del rótulo del plano, `pie` la de los rótulos de cada
  // cuadro, `hueco` la calle entre los dos y `aire` el margen alrededor del elemento
  // para que su borde no quede pegado al marco (y se vea que ahí TERMINA).
  var LAYOUT = { pad: 3, cabecera: 12, pie: 12, hueco: 10, aire: 3 };

  // EL TOPE DEL ANCHO DE UN CUADRO, en px. Es el límite que el propio usuario previó:
  // «si hacemos algo con demasiado confinamiento se pierde la gracia, entonces debe
  // estar limitado». Con el corte llenando el alto, un muro de 20 cm sale a 4 px/cm,
  // así que 280 px son ~69 cm de muro por extremo: el cabezal y un par de barras del
  // reparto corrido, que es lo que se vino a mirar.
  //
  // NO HAY CÓMO TENER LAS DOS COSAS, y conviene tenerlo escrito: el ancho de un cuadro
  // es `ventana × escala`, y la escala ya la fijó el alto, así que cada centímetro de
  // muro que se pide se paga en píxeles de fila. Enseñar los 163 cm que pide un muro
  // con 80 cm de cabezal costaría ~650 px POR CUADRO. Por eso hay tope, y por eso lo
  // que no entra se DICE (`ventanaCorta`) en vez de disimularse.
  var ANCHO_CUADRO_MAX = 280;
  // Y un ancho MÍNIMO para el SVG entero: el rótulo lleva las medidas del hormigón y
  // tiene que caber aunque el dibujo salga angosto (una viga vista de canto son 40 px).
  var ANCHO_MIN = 200;
  // EL ANCHO MÁXIMO QUE PUEDE SALIR, y es una GARANTÍA, no un deseo: dos cuadros al
  // tope, su calle y los márgenes. Ninguna rama de `plan` puede devolver un `W` mayor,
  // y hay un test que lo afirma sobre el SVG PUBLICADO.
  //
  // POR QUÉ IMPORTA TANTO: si el SVG sale más ancho que la celda que lo muestra, el
  // navegador lo escala entero para que quepa — y con él el alto. La regla del alto la
  // desharía el CSS después de que el código la cumplió, que es la misma regresión de
  // siempre cometida una capa más abajo. La hoja de estilo reserva EXACTAMENTE este
  // número (ver catalogo.html).
  var ANCHO_MAX = 2 * ANCHO_CUADRO_MAX + LAYOUT.hueco + 2 * LAYOUT.pad;

  // Las cajas de dibujo, en px del viewBox. `alto` manda; el ancho lo devuelve el plan.
  function cajas(alto, lay) {
    lay = lay || LAYOUT;
    var ch = alto - lay.cabecera - lay.pie - 2 * lay.pad;
    return { x: lay.pad, y: lay.cabecera + lay.pad, h: ch, util: ch - 2 * lay.aire, aire: lay.aire };
  }

  // CUÁNDO SE PUEDE RECORTAR. Un elemento sólo se parte en dos extremos si de verdad es
  // ALARGADO: cortarle la profundidad a una viga de 30 × 60 sería tan absurdo como
  // cortarle el espesor a un muro. La relación es de FORMA (largo/corto), no de tipo:
  // un muro corto y rechoncho cae solo del lado de «entero».
  var RELACION_RECORTE = 4;
  function recortable(corto, largo) { return (largo / corto) >= RELACION_RECORTE; }

  // plan(placements, def, alto, opts) — `alto` en px; el ANCHO sale calculado (base.W).
  function plan(placements, def, alto, opts) {
    opts = opts || {};
    var lay = opts.layout || LAYOUT;
    var banda = (opts.rebanada === false) ? null : rebanada(placements, def, opts);
    var pls = filtrar(placements, def, banda);
    var bb = bbox(pls, proyector(def), opts.rect);
    if (!bb) return null;

    var cj = cajas(alto, lay);
    if (!(cj.util > 0)) return null;
    var w = Math.max(bb.u1 - bb.u0, 1e-6), h = Math.max(bb.v1 - bb.v0, 1e-6);

    // LA ESCALA LA FIJA EL HORMIGÓN, NO EL BBOX (26-ago, cuarta regresión — la única
    // que llegó a producción con la suite verde, porque las fixtures eran recetas
    // limpias). `h` es el alto de TODO lo dibujado, y una receta real puede tener
    // fierro que SOBRESALE del hormigón: una pata de gancho, una pieza mal posada,
    // fierro fuera —que el motor genera a propósito, como dato honesto—. Un solo
    // fierro asomado 17 cm inflaba el bbox de un muro de 20 a 54, la escala caía de
    // 4 a 1,5 y la SECCIÓN entera se encogía; y de paso un muro corto caía en
    // «elemento completo». La regla del usuario es sobre el hormigón («que se agranda
    // la sección de hormigón»), así que la escala sale de SUS medidas y de nada más.
    // El fierro asomado SE DIBUJA IGUAL —hasta el borde del cuadro, donde el viewport
    // lo recorta— y el tooltip dice que existe (`fuera`): no se esconde, porque
    // seguramente es un defecto de la receta que al usuario le conviene ver; pero
    // tampoco manda sobre el tamaño de lo que sí está bien.
    var hayHorm = !!(opts.rect && opts.rect.W > 0 && opts.rect.H > 0);
    var hormW = hayHorm ? Number(opts.rect.W) : w;
    var hormH = hayHorm ? Number(opts.rect.H) : h;
    // El hormigón del motor vive CENTRADO en el origen: lo que el bbox tenga más allá
    // de sus medias caras es fierro fuera. (Sin hormigón no hay contra qué medir, y
    // entonces el bbox es la única verdad disponible.)
    var fuera = hayHorm && (bb.v1 > hormH / 2 + 0.5 || bb.v0 < -hormH / 2 - 0.5 ||
                            bb.u1 > hormW / 2 + 0.5 || bb.u0 < -hormW / 2 - 0.5);
    var porU = (hormW >= hormH);
    var largoDim = porU ? hormW : hormH, cortoDim = porU ? hormH : hormW;
    var parte = recortable(cortoDim, largoDim);

    // LA VENTANA que hay que enseñar por extremo: hasta donde llega el confinamiento
    // más un par de barras del reparto corrido, para que se vea DÓNDE TERMINA. La manda
    // quien llama, porque sale de la receta; si no viaja, se mide el paso del reparto
    // sobre lo que el motor produjo.
    var paso = pasoTipico(pls, porU ? def.u : def.v);
    var pedida = Math.min(largoDim, Math.max(Number(opts.ventana) || 0, PASOS_MIN_VENTANA * paso));

    var base = {
      banda: banda, plsBanda: pls, bbox: bb, rect: opts.rect || null,
      paso: paso, pedida: pedida, confin: Number(opts.confin) || 0, H: alto,
      fuera: fuera
    };
    var techo = (opts.anchoMax != null) ? Number(opts.anchoMax) : ANCHO_CUADRO_MAX;

    // EL CORTE LLENA EL ALTO: la escala es espesor-del-hormigón contra alto útil, y
    // nada más la toca. La franja vertical que se dibuja es LA DEL HORMIGÓN (centrado
    // en el origen); el fierro que asome por arriba o por abajo se recorta en el marco.
    var s = cj.util / hormH;
    var aireCm = cj.aire / s;
    var vv0 = -hormH / 2, vv1 = hormH / 2;
    var anchoEntero = w * s + 2 * cj.aire;       // lo que pediría TODO lo dibujado
    var vent = Math.min(pedida, (techo - cj.aire) / s);

    // --- RECORTE VERTICAL (un plano más alto que ancho) -----------------------
    // Lo que llena el alto es la propia ventana, así que la escala sale de ella — y
    // para que el ancho no se dispare, la ventana no puede ser MENOR que la que el
    // hormigón necesita para caber en el cuadro. Se enseña un poco más de lo pedido,
    // nunca más chico. (Hoy ningún muro entra por acá —su plano es largo × espesor,
    // siempre más ancho que alto—, pero una rama sin acotar ya costó tres regresiones.)
    if (parte && !porU) {
      var ventMin = hormW * cj.util / (techo - 2 * cj.aire);
      var ventV = Math.min(largoDim, Math.max(pedida, ventMin));
      if (2 * ventV < largoDim) {
        s = cj.util / ventV;
        aireCm = cj.aire / s;
        var anchoV = hormW * s + 2 * cj.aire;
        base.escala = s;
        base.modo = 'extremos';
        base.ventana = ventV;
        base.ventanaCorta = (base.confin > 0 && ventV < base.confin - 0.5);
        base.W = Math.max(ANCHO_MIN, Math.round(2 * anchoV + lay.hueco + 2 * lay.pad));
        var x0v = (base.W - (2 * anchoV + lay.hueco)) / 2;
        var b0 = -hormH / 2 - aireCm, b1 = hormH / 2 + aireCm;
        var spanV = ventV + aireCm;
        base.cuadros = [-1, 1].map(function (lado, idx) {
          var lo = (lado < 0) ? b0 : (b1 - spanV), hi = (lado < 0) ? (b0 + spanV) : b1;
          return {
            caja: { x: x0v + idx * (anchoV + lay.hueco), y: cj.y, w: anchoV, h: cj.h },
            vent: { u0: -hormW / 2 - aireCm, u1: hormW / 2 + aireCm, v0: lo, v1: hi },
            extremo: lado, eje: def.v
          };
        });
        base.engorde = engordeRedondos(pls, def, s, opts);
        return base;
      }
      // los dos extremos se solaparían → se ve entero, con la escala del hormigón
    }

    // --- UN SOLO CUADRO ------------------------------------------------------
    // Se ve entero si no es alargado (a un rechoncho no se le corta nada), si cabe de
    // verdad A ESTA ESCALA, o si los dos extremos se solaparían (dos cuadros dirían
    // dos veces lo mismo). Ninguno de los tres casos negocia la escala.
    if (!parte || !porU || anchoEntero <= techo || 2 * vent >= largoDim) {
      // El ancho de salida va ACOTADO A LA CELDA (ANCHO_MAX): si saliera más ancho,
      // el navegador encogería el SVG entero — y con él el alto, que es la regresión
      // de siempre una capa más abajo. El hormigón nunca toca este tope (por forma,
      // su ancho a esta escala es < RELACION_RECORTE × el alto útil): lo único que el
      // recorte puede tocar es fierro asomado.
      var anchoE = Math.min(anchoEntero, ANCHO_MAX - 2 * lay.pad);
      base.escala = s;
      base.modo = 'entero';
      base.ventana = hormW;
      base.ventanaCorta = false;
      base.W = Math.max(ANCHO_MIN, Math.round(anchoE + 2 * lay.pad));
      base.cuadros = [{
        caja: { x: (base.W - anchoE) / 2, y: cj.y, w: anchoE, h: cj.h },
        vent: { u0: bb.u0 - aireCm, u1: bb.u1 + aireCm, v0: vv0, v1: vv1 }, extremo: 0
      }];
      base.engorde = engordeRedondos(pls, def, s, opts);
      return base;
    }

    // --- DOS CUADROS: un extremo cada uno, recorte a lo ancho -----------------
    // El cuadro mide la ventana MÁS el aire de FUERA (la punta del hormigón tiene que
    // verse terminar); por dentro el dibujo llega al borde, porque ahí el elemento
    // SIGUE y lo que hay es un corte. Los extremos se anclan en las puntas del
    // HORMIGÓN: un fierro que asome más allá de la punta se recorta en el marco.
    var anchoCuadro = vent * s + cj.aire;
    base.escala = s;
    base.modo = 'extremos';
    base.ventana = vent;
    // ¿CUPO EL CONFINAMIENTO? Ésa es la pregunta, no si cupo la ventana ideal: lo que
    // no se puede callar es que quede fierro de extremo FUERA del cuadro, porque
    // entonces el dibujo deja creer que el confinamiento termina donde termina el marco.
    base.ventanaCorta = (base.confin > 0 && vent < base.confin - 0.5);
    base.W = Math.max(ANCHO_MIN, Math.round(2 * anchoCuadro + lay.hueco + 2 * lay.pad));
    var x0 = (base.W - (2 * anchoCuadro + lay.hueco)) / 2;
    var a0 = -hormW / 2 - aireCm, a1 = hormW / 2 + aireCm;
    var span = vent + aireCm;
    base.cuadros = [-1, 1].map(function (lado, idx) {
      var lo = (lado < 0) ? a0 : (a1 - span), hi = (lado < 0) ? (a0 + span) : a1;
      return {
        caja: { x: x0 + idx * (anchoCuadro + lay.hueco), y: cj.y, w: anchoCuadro, h: cj.h },
        vent: { u0: lo, u1: hi, v0: vv0, v1: vv1 },
        extremo: lado, eje: def.u
      };
    });
    base.engorde = engordeRedondos(pls, def, s, opts);
    return base;
  }

  // ---------------------------------------------------------------------------
  // COLORES DEL CORTE (no del fierro: el fierro lo pinta quien llama)
  // ---------------------------------------------------------------------------
  var TINTA = {
    hormigon: '#eceff1', hormigonBorde: '#b0bec5', recub: '#cfd8dc',
    rotulo: '#78909c', hueco: '#b0bec5', marco: '#eceff1'
  };

  // ---------------------------------------------------------------------------
  // SVG
  // ---------------------------------------------------------------------------
  function _abre(W, H) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
      '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  }

  // EL HUECO: lo que no se puede dibujar NO recibe una silueta inventada.
  function hueco(W, H, texto) {
    return _abre(W, H) +
      '<rect x="2" y="2" width="' + (W - 4) + '" height="' + (H - 4) +
      '" rx="3" fill="none" stroke="' + TINTA.hueco + '" stroke-width="1" stroke-dasharray="3 2.5"/>' +
      '<text x="' + (W / 2) + '" y="' + (H / 2 + 3) + '" font-size="9" fill="' + TINTA.hueco +
      '" text-anchor="middle">' + _esc(texto || 'no se puede dibujar') + '</text></svg>';
  }

  function _texto(x, y, s, tam, color, anchor) {
    return '<text x="' + _num(x) + '" y="' + _num(y) + '" font-size="' + tam +
      '" fill="' + color + '" text-anchor="' + (anchor || 'middle') + '">' + _esc(s) + '</text>';
  }

  // UN cuadro: un <svg> ANIDADO. Recorta solo (un viewport SVG no deja salir lo que se
  // le pasa), así que las barras que cruzan el borde de la ventana quedan cortadas sin
  // clipPath ni ids inventados — que en una tabla de 80 filas serían 160 ids que
  // colisionan.
  // Las barras que ESTE cuadro muestra: las que cruzan su ventana. El <svg> anidado ya
  // recorta lo que sobra, pero emitir el componente entero en los dos cuadros mete en
  // el DOM el doble de geometría de la que se ve — y en una tabla de ochenta filas eso
  // se nota. Se filtra por INTERSECCIÓN, no por contención: una barra que cruza el
  // borde de la ventana se dibuja y el viewport la corta.
  function _enVentana(pls, def, vent) {
    var out = [];
    for (var i = 0; i < pls.length; i++) {
      var tu = tramo(pls[i], def.u), tv = tramo(pls[i], def.v);
      if (!tu || !tv) continue;
      if (tu.hi < vent.u0 || tu.lo > vent.u1) continue;
      if (tv.hi < vent.v0 || tv.lo > vent.v1) continue;
      out.push(pls[i]);
    }
    return out;
  }

  function _cuadro(cu, pls, def, s, opts) {
    pls = _enVentana(pls, def, cu.vent);
    var t = encuadreVentana(cu.vent, { x: 0, y: 0, w: cu.caja.w, h: cu.caja.h }, s);
    var partes = ['<svg x="' + _num(cu.caja.x) + '" y="' + _num(cu.caja.y) + '" width="' +
      _num(cu.caja.w) + '" height="' + _num(cu.caja.h) + '" viewBox="0 0 ' +
      _num(cu.caja.w) + ' ' + _num(cu.caja.h) + '">'];
    var rect = opts.rect;
    if (rect && rect.W > 0 && rect.H > 0) {
      partes.push('<rect x="' + _num(Math.min(tX(t, -rect.W / 2), tX(t, rect.W / 2))) +
        '" y="' + _num(Math.min(tY(t, rect.H / 2), tY(t, -rect.H / 2))) +
        '" width="' + _num(rect.W * t.s) + '" height="' + _num(rect.H * t.s) +
        '" fill="' + (opts.hormigon || TINTA.hormigon) + '" stroke="' +
        (opts.hormigonBorde || TINTA.hormigonBorde) + '" stroke-width=".8"/>');
      if (rect.iW > 0 && rect.iH > 0) {
        partes.push('<rect x="' + _num(Math.min(tX(t, -rect.iW / 2), tX(t, rect.iW / 2))) +
          '" y="' + _num(Math.min(tY(t, rect.iH / 2), tY(t, -rect.iH / 2))) +
          '" width="' + _num(rect.iW * t.s) + '" height="' + _num(rect.iH * t.s) +
          '" fill="none" stroke="' + (opts.recub || TINTA.recub) +
          '" stroke-width=".6" stroke-dasharray="2.5 2"/>');
      }
    }
    var tz = trazos(pls, def, t, {
      colorDe: opts.colorDe, rolDe: opts.rolDe, opacidadDe: opts.opacidadDe,
      halo: false, hit: false
    });
    for (var i = 0; i < tz.length; i++) {
      var z = tz[i];
      if (z.punta) {
        partes.push('<path d="' + z.d + '" fill="' + z.color + '"/>');
      } else {
        // GROSOR REAL de la barra, con un piso legible: φ10 a 1,36 px/cm son 1,36 px.
        // Es el mismo trato que ya recibía la barra vista de punta (radio real, piso
        // de 1,5 px) — un grosor fijo diría que un φ8 y un φ25 son la misma barra.
        var gr = Math.max(0.9, (z.diam || 1) * s);
        partes.push('<path d="' + z.d + '" fill="none" stroke="' + z.color +
          '" stroke-width="' + _num(gr) + '" stroke-linecap="round" stroke-linejoin="round"' +
          (z.op !== 1 ? ' opacity="' + z.op + '"' : '') + '/>');
      }
    }
    partes.push('</svg>');
    return partes.join('');
  }

  // svg(placements, def, ancho, alto, opts) → el <svg> como TEXTO.
  //   placements: lo que devuelve ModeladorGenerar (NO se toca).
  //   def:        el plano { u, v, depth } — lo elige quien llama (PLANOS_POR_ELEMENTO).
  //   opts:       { rect, colorDe, rolDe, opacidadDe, letras, rebanada, espesor,
  //                 hormigon, hormigonBorde, recub, rotulo, plan }
  // `opts.plan` es el plan YA calculado: quien necesita el tooltip lo pide primero (es
  // el que sabe qué se va a ver) y lo pasa, en vez de que se derive dos veces.
  // El ANCHO ya no entra: lo devuelve el plan (p.W), porque sale de cuánto elemento hay
  // que enseñar por la escala que fijó el alto. Varía de una fila a otra y eso es el
  // punto: la celda reserva el máximo y cada dibujo ocupa lo suyo.
  function svg(placements, def, alto, opts) {
    opts = opts || {};
    alto = Number(alto) || 116;
    if (!def || !def.u || !def.v || !def.depth) return hueco(ANCHO_MIN, alto, 'sin plano');
    if (!placements || !placements.length) return hueco(ANCHO_MIN, alto, 'sin barras');
    var p = opts.plan || plan(placements, def, alto, opts);
    if (!p) return hueco(ANCHO_MIN, alto, 'sin geometría');
    var lay = opts.layout || LAYOUT;
    var W = p.W, H = p.H;
    var rot = rotulos(p, def, opts.letras);
    var partes = [_abre(W, H)];
    partes.push(_texto(W / 2, lay.cabecera - 3, rot.cabecera, 8, opts.rotulo || TINTA.rotulo));
    for (var i = 0; i < p.cuadros.length; i++) {
      var cu = p.cuadros[i];
      partes.push('<rect x="' + _num(cu.caja.x) + '" y="' + _num(cu.caja.y) + '" width="' +
        _num(cu.caja.w) + '" height="' + _num(cu.caja.h) + '" fill="none" stroke="' +
        (opts.marco || TINTA.marco) + '" stroke-width="1"/>');
      partes.push(_cuadro(cu, p.plsBanda, def, p.escala, opts));
      partes.push(_texto(cu.caja.x + cu.caja.w / 2, H - 3, rot.pies[i], 8,
        opts.rotulo || TINTA.rotulo));
    }
    partes.push('</svg>');
    return partes.join('');
  }

  // ---------------------------------------------------------------------------
  // LO QUE SE ESTÁ MIRANDO, DICHO CON PALABRAS
  // ---------------------------------------------------------------------------
  // `letras` traduce un eje interno a la letra que el usuario ve (el editor reetiqueta
  // x/y/z → Y/Z/X para la obra). Sin ese diccionario se dicen los ejes del motor: es
  // menos útil, pero no es mentira.
  //
  // Y NO SE DICE QUE EL DIBUJO SEA APROXIMADO, porque ya no lo es: sale del motor. Lo
  // que sí se dice —porque callarlo sería la misma mentira al revés— es que se está
  // viendo una REBANADA y no todo el fondo, y que cada cuadro es UN EXTREMO.
  function rotulos(p, def, letras) {
    var L = letras || {};
    function l(e) { return L[e] || String(e).toUpperCase(); }
    var cab = l(def.u) + l(def.v);
    // LAS MEDIDAS DEL HORMIGÓN, SIEMPRE. Desde que cada fila usa su propia escala
    // (ver `plan`), el dibujo ya no dice el tamaño: lo dicen estos dos números. Sin
    // ellos la miniatura dejaría creer que un muro de 15 cm y uno de 60 son iguales,
    // porque los dos llenan el alto del cuadro.
    if (p.rect && p.rect.W > 0 && p.rect.H > 0) {
      cab += ' · ' + _medida(p.rect.W) + ' × ' + _medida(p.rect.H) + ' cm';
    }
    if (p.banda) cab += ' · rebanada ' + Math.round(p.banda.esp) + ' cm en ' + l(def.depth);
    var pies = p.cuadros.map(function (cu) {
      if (!cu.extremo) return '';
      return 'extremo ' + l(cu.eje) + (cu.extremo < 0 ? '−' : '+') +
        ' · ' + Math.round(p.ventana) + ' cm';
    });
    if (p.modo === 'entero') pies[0] = 'elemento completo';
    return { cabecera: cab, pies: pies };
  }

  // El TOOLTIP. Vive acá, con el dibujo, porque describe exactamente lo que el dibujo
  // hizo: dos copias de esta frase serían dos promesas distintas sobre la misma imagen.
  function titulo(p, def, letras) {
    if (!p) return 'Esta receta no se puede dibujar: ábrela para ver qué le falta.';
    var L = letras || {};
    function l(e) { return L[e] || String(e).toUpperCase(); }
    var t = 'Corte ' + l(def.u) + l(def.v) + ', dibujado con el motor del editor.';
    if (p.banda) {
      t += ' Se ve una REBANADA de ' + Math.round(p.banda.esp) + ' cm de profundidad (eje ' +
        l(def.depth) + '), no todo el fondo del elemento: proyectarlo entero apila ' +
        'unas barras sobre otras.';
    }
    // EL FIERRO ASOMADO SE DICE. La escala sale del hormigón (ver `plan`), así que lo
    // que sobresale se recorta en el marco del cuadro: callarlo dejaría al usuario sin
    // saber por qué hay fierro tocando el borde — y sin ver un defecto de su receta.
    if (p.fuera) {
      t += ' OJO: esta receta tiene fierro FUERA del hormigón; se dibuja hasta el borde ' +
        'del cuadro, sin achicar la sección — revisa la receta.';
    }
    if (p.modo === 'extremos') {
      t += ' El elemento es demasiado alargado para leerse entero, así que van sus DOS ' +
        'extremos: ' + Math.round(p.ventana) + ' cm de largo cada uno.';
      // SI LA VENTANA NO LLEGÓ AL FINAL DEL CONFINAMIENTO HAY QUE DECIRLO: callarlo
      // dejaría creer que el confinamiento termina donde termina el cuadro.
      if (p.ventanaCorta) {
        t += ' OJO: la receta acota fierro hasta los ' + Math.round(p.confin) +
          ' cm desde la punta — más adentro de lo que cabe en el cuadro a la escala de la ' +
          'lista. Lo que se ve es el arranque del confinamiento, no todo. Ábrelo para verlo entero.';
      }
    }
    if (p.engorde > 1.01) {
      t += ' Las barras que se ven DE PUNTA van engordadas ×' +
        (Math.round(p.engorde * 10) / 10) + ' para que la más fina se vea a este tamaño;' +
        ' entre ellas sí guardan su proporción real.';
    }
    // CADA FILA VA A SU ESCALA, y hay que decirlo: es la diferencia entre «este muro es
    // más grueso» y «este muro se dibujó más grande». El corte llena el alto del cuadro
    // en todas las filas, así que el tamaño en pantalla NO compara: comparan los
    // números del rótulo, que son los centímetros reales.
    t += ' Es una previsualización: el corte se dibuja llenando el alto del cuadro (' +
      (Math.round(p.escala * 100) / 100) + ' px/cm en esta fila), así que su tamaño en ' +
      'pantalla no se puede comparar con el de otra fila — las medidas van en el rótulo.';
    return t;
  }

  var API = {
    // el dibujante
    svg: svg, plan: plan, titulo: titulo, rotulos: rotulos, hueco: hueco,
    // las piezas que también usa el editor
    proyector: proyector, ejeMayorSpan: ejeMayorSpan, agrupar: agrupar,
    trazos: trazos, dCirculo: dCirculo, engordeRedondos: engordeRedondos,
    bbox: bbox, encuadre: encuadre, encuadreVentana: encuadreVentana,
    tX: tX, tY: tY, tramo: tramo,
    // la rebanada y el encuadre, sueltos (los tests y el gestor los leen)
    rebanada: rebanada, filtrar: filtrar, pasoTipico: pasoTipico, enVentana: _enVentana,
    cajas: cajas,
    // números con nombre, para no cazarlos en el código
    REBANADA_CM: REBANADA_CM, ANCHO_CUADRO_MAX: ANCHO_CUADRO_MAX,
    ANCHO_MIN: ANCHO_MIN, ANCHO_MAX: ANCHO_MAX,
    RELACION_RECORTE: RELACION_RECORTE, recortable: recortable,
    PASOS_MIN_VENTANA: PASOS_MIN_VENTANA, LAYOUT: LAYOUT, TINTA: TINTA
  };
  global.ModeladorRender2D = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
