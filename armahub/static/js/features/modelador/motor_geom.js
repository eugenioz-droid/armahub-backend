// =============================================================================
// Modelador 3D — MOTOR GEOMÉTRICO (F0 · T0.2)
// Genera la MALLA SÓLIDA de una barra (cilindros por tramo recto + toros
// tangentes en los dobleces, con radio de doblado de norma). Portado de la
// maqueta validada static/demo/rebar3d.js.
//
// Fuente ÚNICA de geometría 3D del modelador. Client-side: usa window.THREE
// (CDN three@0.160.0). También corre en Node para tests headless de geometría
// (la parte de render se salta si no hay THREE con las clases de mesh).
//
// Unidades internas del modelador = CENTÍMETROS (el elemento se define en cm;
// los diámetros llegan en cm — el panel convierte mm→cm).
// =============================================================================
(function (global) {
  'use strict';

  var THREE = global.THREE;

  // ---- Norma de doblado (aprox. NCh 204 / ACI 318) --------------------------
  // Radio INTERNO de doblado: 2φ para φ ≤ 16 mm, 3.5φ para φ > 16 mm.
  // Trabajamos en cm → el umbral 16 mm = 1.6 cm.
  var NORMA = { limiteDiametroCm: 1.6, factorChico: 2, factorGrande: 3.5 };

  function radioDobladoNorma(diamCm, factorExtra) {
    var f = (diamCm <= NORMA.limiteDiametroCm) ? NORMA.factorChico : NORMA.factorGrande;
    return f * diamCm * (factorExtra || 1);
  }

  // ---- Análisis de la polilínea (independiente de THREE, testeable) ---------
  // Dada una lista de puntos {x,y,z} (o Vector3) + diámetro (cm), calcula los
  // dobleces (fillets tangentes) en cada vértice interior. Devuelve una lista
  // paralela a los puntos: dobleces[i] = {T1,T2,O,ang,R,...} o null.
  // No depende de THREE: usa aritmética de vectores propia → corre en Node.
  function _sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function _len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
  function _norm(a) { var l = _len(a) || 1e-12; return { x: a.x / l, y: a.y / l, z: a.z / l }; }
  function _dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function _cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  function _addS(a, d, s) { return { x: a.x + d.x * s, y: a.y + d.y * s, z: a.z + d.z * s }; }
  function _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function _dist(a, b) { return _len(_sub(a, b)); }

  // Limpia puntos duplicados consecutivos (tol²).
  function _limpiarPuntos(puntos) {
    var pts = [];
    for (var i = 0; i < puntos.length; i++) {
      var p = { x: +puntos[i].x, y: +puntos[i].y, z: +puntos[i].z };
      if (!pts.length) { pts.push(p); continue; }
      var q = pts[pts.length - 1];
      var dd = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y) + (p.z - q.z) * (p.z - q.z);
      if (dd > 1e-8) pts.push(p);
    }
    return pts;
  }

  // Calcula los dobleces. rTubo y radioInt en cm. Devuelve {pts, dobleces}.
  function analizarBarra(puntos, diamCm, opciones) {
    opciones = opciones || {};
    var rTubo = diamCm / 2;
    var radioInt = (opciones.radioInterno !== undefined) ? opciones.radioInterno
                                                         : radioDobladoNorma(diamCm);
    var Rc = radioInt + rTubo;   // radio del EJE de la barra en el doblez
    var pts = _limpiarPuntos(puntos);
    var dobleces = [];
    var i;
    for (i = 0; i < pts.length; i++) dobleces.push(null);
    if (pts.length < 2) return { pts: pts, dobleces: dobleces, Rc: Rc, rTubo: rTubo };
    for (i = 1; i < pts.length - 1; i++) {
      var d1 = _norm(_sub(pts[i], pts[i - 1]));
      var d2 = _norm(_sub(pts[i + 1], pts[i]));
      var ang = Math.acos(_clamp(_dot(d1, d2), -1, 1));
      if (ang < 0.01) continue;   // colineal
      var R = Rc;
      var t = R * Math.tan(ang / 2);   // tangencia desde el vértice
      var tMax = 0.49 * Math.min(_dist(pts[i], pts[i - 1]), _dist(pts[i + 1], pts[i]));
      if (t > tMax) { t = tMax; R = t / Math.tan(ang / 2); }   // reducir radio si no cabe
      var T1 = _addS(pts[i], d1, -t);
      var T2 = _addS(pts[i], d2, t);
      var eje = _norm(_cross(d1, d2));
      var haciaCentro = _norm(_cross(eje, d1));
      var O = _addS(T1, haciaCentro, R);
      dobleces[i] = {
        T1: T1, T2: T2, O: O, ang: ang, R: R,
        u: { x: -haciaCentro.x, y: -haciaCentro.y, z: -haciaCentro.z },   // O->T1
        d1: d1, eje: eje
      };
    }
    return { pts: pts, dobleces: dobleces, Rc: Rc, rTubo: rTubo };
  }

  // ---- Fusión de geometrías (three.min.js no trae BufferGeometryUtils) ------
  // Igual patrón que rebar3d.js: fusiona partes [{geo, matriz}] en una sola.
  function fusionarGeometrias(partes) {
    if (!THREE) return null;
    if (THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeGeometries) {
      // Si el navegador cargó BufferGeometryUtils, aplicamos las matrices y usamos su merge.
      var listos = [];
      for (var k = 0; k < partes.length; k++) {
        var gk = partes[k].geo.clone();
        gk.applyMatrix4(partes[k].matriz);
        listos.push(gk);
        partes[k].geo.dispose();
      }
      var m = THREE.BufferGeometryUtils.mergeGeometries(listos, false);
      listos.forEach(function (g) { g.dispose(); });
      return m;
    }
    // Fusión manual (mismo código de rebar3d.js).
    var totalV = 0, totalI = 0, i, j;
    for (i = 0; i < partes.length; i++) {
      totalV += partes[i].geo.attributes.position.count;
      totalI += partes[i].geo.index.count;
    }
    var pos = new Float32Array(totalV * 3);
    var nor = new Float32Array(totalV * 3);
    var TipoIdx = (totalV > 65535) ? Uint32Array : Uint16Array;
    var idx = new TipoIdx(totalI);
    var vo = 0, io = 0;
    var v = new THREE.Vector3();
    var nm = new THREE.Matrix3();
    for (i = 0; i < partes.length; i++) {
      var g = partes[i].geo, mm = partes[i].matriz;
      var pa = g.attributes.position, na = g.attributes.normal, ia = g.index;
      nm.getNormalMatrix(mm);
      for (j = 0; j < pa.count; j++) {
        v.fromBufferAttribute(pa, j).applyMatrix4(mm);
        pos[(vo + j) * 3] = v.x; pos[(vo + j) * 3 + 1] = v.y; pos[(vo + j) * 3 + 2] = v.z;
        v.fromBufferAttribute(na, j).applyMatrix3(nm).normalize();
        nor[(vo + j) * 3] = v.x; nor[(vo + j) * 3 + 1] = v.y; nor[(vo + j) * 3 + 2] = v.z;
      }
      for (j = 0; j < ia.count; j++) idx[io + j] = ia.getX(j) + vo;
      vo += pa.count; io += ia.count;
      g.dispose();
    }
    var salida = new THREE.BufferGeometry();
    salida.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    salida.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    salida.setIndex(new THREE.BufferAttribute(idx, 1));
    return salida;
  }

  function _cilindroParte(a, b, rTubo, segRad) {
    var largo = _dist(a, b);
    if (largo < 1e-6) return null;
    var geo = new THREE.CylinderGeometry(rTubo, rTubo, largo, segRad, 1, false);
    var dir = _norm(_sub(b, a));
    var q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir.x, dir.y, dir.z));
    var m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    m.setPosition(new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2));
    return { geo: geo, matriz: m };
  }

  // ---- Generador central: barra sólida (Mesh) desde polilínea + diámetro ----
  // puntos: [{x,y,z}] o Vector3[]. diamCm en cm. material = THREE.Material.
  // Devuelve THREE.Mesh (fusionada) o THREE.Group (fallback), o null si <2 pts.
  function barraSolida(puntos, diamCm, material, opciones) {
    if (!THREE) return null;
    opciones = opciones || {};
    var segRad = opciones.segmentosRadiales || 12;
    var info = analizarBarra(puntos, diamCm, opciones);
    var pts = info.pts, dobleces = info.dobleces, rTubo = info.rTubo;
    if (pts.length < 2) return null;

    var partes = [];
    var cursor = pts[0];
    for (var i = 1; i < pts.length; i++) {
      var d = dobleces[i];
      var recto = _cilindroParte(cursor, d ? d.T1 : pts[i], rTubo, segRad);
      if (recto) partes.push(recto);
      if (d) {
        var nSeg = Math.max(4, Math.ceil(d.ang / (Math.PI / 16)));   // ~11° por segmento
        var geoCodo = new THREE.TorusGeometry(d.R, rTubo, segRad, nSeg, d.ang);
        // base local del toro: X = u (O->T1), Y = d1, Z = eje del doblez
        var m = new THREE.Matrix4().makeBasis(
          new THREE.Vector3(d.u.x, d.u.y, d.u.z),
          new THREE.Vector3(d.d1.x, d.d1.y, d.d1.z),
          new THREE.Vector3(d.eje.x, d.eje.y, d.eje.z));
        m.setPosition(new THREE.Vector3(d.O.x, d.O.y, d.O.z));
        partes.push({ geo: geoCodo, matriz: m });
        cursor = d.T2;
      } else {
        cursor = pts[i];
      }
    }
    var merged = fusionarGeometrias(partes);
    if (merged) return new THREE.Mesh(merged, material);
    // Fallback (no debería pasar con THREE presente): grupo de meshes sin fusionar.
    var grp = new THREE.Group();
    partes.forEach(function (p) {
      p.geo.applyMatrix4(p.matriz);
      grp.add(new THREE.Mesh(p.geo, material));
    });
    return grp;
  }

  // ---- Largo REAL de la polilínea (para chequeos) ---------------------------
  // Suma de segmentos rectos entre puntos consecutivos (sin descontar dobleces).
  // Es la longitud de la polilínea, NO el largo de norma (que suma lados que la
  // figura usa; eso lo calcula el backend). Útil para tests de puntos.
  function largoPolilinea(puntos) {
    var pts = _limpiarPuntos(puntos);
    var total = 0;
    for (var i = 1; i < pts.length; i++) total += _dist(pts[i - 1], pts[i]);
    return total;
  }

  var API = {
    NORMA: NORMA,
    radioDobladoNorma: radioDobladoNorma,
    analizarBarra: analizarBarra,
    barraSolida: barraSolida,
    fusionarGeometrias: fusionarGeometrias,
    largoPolilinea: largoPolilinea
  };

  global.ModeladorMotorGeom = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
