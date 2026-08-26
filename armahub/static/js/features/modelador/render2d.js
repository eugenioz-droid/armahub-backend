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

  // Cuántos PÍXELES necesita el lado CORTO del plano para que el fierro se lea. Sale
  // del caso real: las dos cortinas de un muro caen al 15% y al 85% del espesor, o sea
  // separadas el 70% del lado corto. Para que se lean como DOS líneas con hormigón en
  // medio ese hueco no puede bajar de ~18 px → el lado corto necesita ~26. Por debajo
  // de eso el elemento entero no se puede mostrar y hay que recortar a los extremos.
  var CORTO_MIN_PX = 26;

  // Cuántas separaciones de la distribución tiene que abarcar como mínimo la ventana
  // de un extremo. Con menos de DOS posiciones consecutivas el reparto no se lee (y
  // una traba @40 puede no aparecer en el recorte): se vería un fierro suelto en vez
  // de un patrón. Medido en el muro de referencia: paso máximo 39,9 cm → ventana 79,7.
  var PASOS_MIN_VENTANA = 2;

  function _num(v) { return Math.round(Number(v) * 100) / 100; }
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
          // Radio REAL de la barra en px. pl.diam viene en CENTÍMETROS (reglas.js lo
          // convierte una sola vez: φ16 → 1.6) y t.s es px/cm.
          var rPx = Math.max(rMin, (Number(pl.diam) / 2) * Math.abs(t.s || 1));
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
        ci: gr.ci, rol: rol, color: colorDe(pl0), punta: punta,
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
  // imagen muestra (qué plano, qué rebanada, si son extremos y de qué largo), y si esa
  // frase se derivara por su cuenta sería una segunda verdad que puede desmentir al
  // dibujo. Acá se decide UNA vez y el texto y los píxeles leen lo mismo.
  //
  // LA REGLA DEL ENCUADRE, y sale de la PROPORCIÓN del plano — no del tipo de elemento
  // (un muro corto cae solo en el primer caso y una viga larguísima en el segundo, sin
  // que nadie los registre en ninguna lista):
  //   · el plano CABE a proporción legible → UN cuadro con el elemento entero;
  //   · no cabe → DOS cuadros lado a lado, a la MISMA escala, uno por extremo.
  // «Cabe» se mide, no se opina: es que el lado CORTO del plano llegue a CORTO_MIN_PX
  // al dibujar el elemento completo en la caja disponible.
  //
  // POR QUÉ SIEMPRE LOS DOS EXTREMOS y no uno solo cuando el fierro «parece simétrico»:
  // mostrar un extremo AFIRMA que el otro es igual. Es una afirmación sobre el fierro,
  // derivada de leer la receta, y si se equivoca miente justo donde más importa. Con
  // los dos cuadros no se afirma nada: se muestran los dos extremos y quien mira
  // compara. La información sigue estando —si son distintos, se ve— pero ya no la
  // produce una inferencia nuestra.
  //
  // Tamaño y reparto de la miniatura, en px del viewBox. Va en UNA tabla porque el
  // plan, el dibujo y la hoja de estilo tienen que estar de acuerdo sobre el mismo
  // rectángulo: `cabecera` es la franja del rótulo del plano, `pie` la de los rótulos
  // de cada cuadro, `hueco` la calle entre los dos y `aire` el margen que se deja
  // alrededor del elemento para que su borde no quede pegado al marco (y se vea que
  // ahí TERMINA, en vez de parecer que sigue).
  var LAYOUT = { pad: 3, cabecera: 12, pie: 12, hueco: 10, aire: 3 };

  // En un recorte a un extremo el aire va SÓLO por fuera: por dentro el dibujo tiene
  // que llegar al borde del cuadro, porque ahí el elemento SIGUE y lo que hay es un
  // corte, no un final. Va como fracción de la ventana para que no dependa de la
  // escala. 4,5% de 80 cm son 3,6 cm ≈ 5 px en la miniatura.
  var AIRE_EXTREMO = 0.045;

  function plan(placements, def, W, H, opts) {
    opts = opts || {};
    var lay = opts.layout || LAYOUT;
    var banda = (opts.rebanada === false) ? null : rebanada(placements, def, opts);
    var pls = filtrar(placements, def, banda);
    var bb = bbox(pls, proyector(def), opts.rect);
    if (!bb) return null;

    var cajaW = W - 2 * lay.pad;
    var cajaH = H - lay.cabecera - lay.pie - 2 * lay.pad;
    if (!(cajaW > 0) || !(cajaH > 0)) return null;
    var w = Math.max(bb.u1 - bb.u0, 1e-6), h = Math.max(bb.v1 - bb.v0, 1e-6);

    // ¿Entra entero y legible?
    // La escala del elemento ENTERO se calcula contra la caja MENOS el aire: si no, el
    // hormigón queda pegado al marco por el lado que manda y no se ve dónde termina.
    var sEntero = Math.min((cajaW - 2 * lay.aire) / w, (cajaH - 2 * lay.aire) / h);
    var cortoPx = Math.min(w, h) * sEntero;
    var base = {
      banda: banda, plsBanda: pls, bbox: bb, rect: opts.rect || null,
      cortoPx: cortoPx, minCorto: CORTO_MIN_PX
    };
    if (cortoPx >= CORTO_MIN_PX) {
      base.modo = 'entero';
      base.escala = sEntero;
      base.cuadros = [{
        caja: { x: lay.pad, y: lay.cabecera + lay.pad, w: cajaW, h: cajaH },
        vent: { u0: bb.u0, u1: bb.u1, v0: bb.v0, v1: bb.v1 }, extremo: 0
      }];
      return base;
    }

    // DOS CUADROS. Se recorta por el eje LARGO del plano (el que no cabe), que puede
    // ser el horizontal o el vertical: no se da por hecho que un plano alargado lo sea
    // siempre a lo ancho.
    var porU = (w >= h);
    var largoDim = porU ? w : h, cortoDim = porU ? h : w;
    var FW = (cajaW - lay.hueco) / 2, FH = cajaH;
    var FL = porU ? FW : FH, FC = porU ? FH : FW;

    // LA VENTANA. Dos exigencias, y manda la mayor:
    //   · llenar el cuadro (si sobra alto, se está desaprovechando la ampliación);
    //   · abarcar al menos DOS separaciones del reparto más suelto, o el recorte
    //     enseñaría un fierro solitario en vez de un patrón — y podría dejar fuera
    //     la traba, que es lo que distingue un muro de otro.
    var paso = pasoTipico(pls, porU ? def.u : def.v);
    var vent = Math.max(cortoDim * (FL / FC), PASOS_MIN_VENTANA * paso);
    vent = Math.min(vent, largoDim);
    base.paso = paso;
    base.ventana = vent;
    // Si la ventana se comió el elemento entero, los dos cuadros dirían lo mismo: es
    // el caso de un cuadro, y se cae ahí solo.
    if (!(vent < largoDim)) {
      base.modo = 'entero';
      base.escala = sEntero;
      base.cuadros = [{
        caja: { x: lay.pad, y: lay.cabecera + lay.pad, w: cajaW, h: cajaH },
        vent: { u0: bb.u0, u1: bb.u1, v0: bb.v0, v1: bb.v1 }, extremo: 0
      }];
      return base;
    }
    var s = Math.min(FL / vent, (FC - 2 * lay.aire) / cortoDim);
    base.modo = 'extremos';
    base.escala = s;
    // La ventana se DESPLAZA hacia afuera: el borde del elemento queda dentro del
    // cuadro con su aire, y el lado de adentro llega al marco —que es donde el corte
    // sucede—. Las dos ventanas siguen midiendo lo mismo, o sea la misma escala.
    var aire = vent * AIRE_EXTREMO;
    var a0 = (porU ? bb.u0 : bb.v0) - aire, a1 = (porU ? bb.u1 : bb.v1) + aire;
    var y = lay.cabecera + lay.pad;
    base.cuadros = [-1, 1].map(function (lado, idx) {
      var lo = (lado < 0) ? a0 : (a1 - vent), hi = (lado < 0) ? (a0 + vent) : a1;
      return {
        caja: { x: lay.pad + idx * (FW + lay.hueco), y: y, w: FW, h: FH },
        vent: porU ? { u0: lo, u1: hi, v0: bb.v0, v1: bb.v1 }
          : { u0: bb.u0, u1: bb.u1, v0: lo, v1: hi },
        extremo: lado, eje: porU ? def.u : def.v
      };
    });
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
  function svg(placements, def, W, H, opts) {
    opts = opts || {};
    W = Number(W) || 232; H = Number(H) || 96;
    if (!def || !def.u || !def.v || !def.depth) return hueco(W, H, 'sin plano');
    if (!placements || !placements.length) return hueco(W, H, 'sin barras');
    var p = opts.plan || plan(placements, def, W, H, opts);
    if (!p) return hueco(W, H, 'sin geometría');
    var lay = opts.layout || LAYOUT;
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
    if (p.banda) cab += ' · rebanada ' + Math.round(p.banda.esp) + ' cm en ' + l(def.depth);
    var pies = p.cuadros.map(function (cu) {
      if (!cu.extremo) return '';
      return 'extremo ' + l(cu.eje) + (cu.extremo < 0 ? '−' : '+');
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
    if (p.modo === 'extremos') {
      t += ' El elemento es demasiado alargado para leerse entero, así que van sus DOS ' +
        'extremos, a la misma escala: ' + Math.round(p.ventana) + ' cm cada uno.';
    }
    return t;
  }

  var API = {
    // el dibujante
    svg: svg, plan: plan, titulo: titulo, rotulos: rotulos, hueco: hueco,
    // las piezas que también usa el editor
    proyector: proyector, ejeMayorSpan: ejeMayorSpan, agrupar: agrupar,
    trazos: trazos, dCirculo: dCirculo,
    bbox: bbox, encuadre: encuadre, encuadreVentana: encuadreVentana,
    tX: tX, tY: tY, tramo: tramo,
    // la rebanada y el encuadre, sueltos (los tests y el gestor los leen)
    rebanada: rebanada, filtrar: filtrar, pasoTipico: pasoTipico, enVentana: _enVentana,
    // números con nombre, para no cazarlos en el código
    REBANADA_CM: REBANADA_CM, CORTO_MIN_PX: CORTO_MIN_PX,
    PASOS_MIN_VENTANA: PASOS_MIN_VENTANA, LAYOUT: LAYOUT, TINTA: TINTA
  };
  global.ModeladorRender2D = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
