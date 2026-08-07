// =============================================================================
// Maqueta M7 — Render sólido de armadura
// Demo standalone de nivel de detalle 3D. NO es producto: responde la pregunta
// "¿qué detalle 3D podemos lograr de forma eficiente?" con barras SÓLIDAS
// (cilindros + sectores de toro en los dobleces, radio interno de norma) y una
// viga paramétrica completa (longitudinales, estribos con gancho 135°, trabas).
//
// Técnica de rendimiento: cada FORMA de barra se fusiona en UNA BufferGeometry
// (fusionarGeometrias) y las barras repetidas se dibujan con THREE.InstancedMesh
// => toda la viga son ~5 draw calls independiente del número de estribos.
//
// Unidades internas: metros. Se ejecuta también en Node (para tests de
// geometría) — la parte de escena/UI solo corre si existe document.
// =============================================================================
(function (global) {
  'use strict';

  var THREE = global.THREE;

  // ---- Norma de doblado (aprox. NCh 204 / ACI 318) --------------------------
  // Radio INTERNO de doblado: 2phi para phi <= 16 mm, 3.5phi para phi > 16 mm.
  // Parametrizable vía NORMA o con opciones.radioInterno en crearGeometriaBarra.
  var NORMA = {
    limiteDiametro: 0.016, // m
    factorChico: 2,
    factorGrande: 3.5
  };

  function radioDobladoNorma(diametro, factorExtra) {
    var f = (diametro <= NORMA.limiteDiametro) ? NORMA.factorChico : NORMA.factorGrande;
    return f * diametro * (factorExtra || 1);
  }

  function v3(x, y, z) { return new THREE.Vector3(x, y, z); }

  // ---- Fusión de geometrías (three.min.js no trae BufferGeometryUtils) ------
  // partes: [{ geo: BufferGeometry indexada con position+normal, matriz: Matrix4 }]
  function fusionarGeometrias(partes) {
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
      var g = partes[i].geo, m = partes[i].matriz;
      var pa = g.attributes.position, na = g.attributes.normal, ia = g.index;
      nm.getNormalMatrix(m);
      for (j = 0; j < pa.count; j++) {
        v.fromBufferAttribute(pa, j).applyMatrix4(m);
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

  function agregarCilindro(partes, a, b, rTubo, segRad) {
    var largo = a.distanceTo(b);
    if (largo < 1e-6) return;
    var geo = new THREE.CylinderGeometry(rTubo, rTubo, largo, segRad, 1, false);
    var dir = new THREE.Vector3().subVectors(b, a).normalize();
    var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    var m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    m.setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
    partes.push({ geo: geo, matriz: m });
  }

  // ---- Generador central: barra sólida desde polilínea 3D + diámetro --------
  // Tramos rectos = cilindros con tapa; dobleces = sectores de toro con radio
  // de eje = radioInterno + phi/2. En cada vértice interior se calcula el
  // empalme tangente (fillet) y se acortan los tramos rectos.
  // opciones: { radioInterno (m), segmentosRadiales }
  function crearGeometriaBarra(puntos, diametro, opciones) {
    opciones = opciones || {};
    var rTubo = diametro / 2;
    var radioInt = (opciones.radioInterno !== undefined)
      ? opciones.radioInterno : radioDobladoNorma(diametro);
    var Rc = radioInt + rTubo; // radio del eje de la barra en el doblez
    var segRad = opciones.segmentosRadiales || 12;

    // limpiar puntos duplicados
    var pts = [];
    for (var i = 0; i < puntos.length; i++) {
      if (!pts.length || puntos[i].distanceToSquared(pts[pts.length - 1]) > 1e-16) {
        pts.push(puntos[i].clone());
      }
    }
    if (pts.length < 2) return null;

    // dobleces en vértices interiores
    var dobleces = [];
    for (i = 0; i < pts.length; i++) dobleces.push(null);
    for (i = 1; i < pts.length - 1; i++) {
      var d1 = new THREE.Vector3().subVectors(pts[i], pts[i - 1]).normalize();
      var d2 = new THREE.Vector3().subVectors(pts[i + 1], pts[i]).normalize();
      var ang = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
      if (ang < 0.01) continue; // colineal
      var R = Rc;
      var t = R * Math.tan(ang / 2); // distancia de tangencia desde el vértice
      var tMax = 0.49 * Math.min(pts[i].distanceTo(pts[i - 1]), pts[i + 1].distanceTo(pts[i]));
      if (t > tMax) { t = tMax; R = t / Math.tan(ang / 2); } // reducir radio si no cabe
      var T1 = pts[i].clone().addScaledVector(d1, -t);
      var T2 = pts[i].clone().addScaledVector(d2, t);
      var eje = new THREE.Vector3().crossVectors(d1, d2).normalize();
      var haciaCentro = new THREE.Vector3().crossVectors(eje, d1).normalize();
      var O = T1.clone().addScaledVector(haciaCentro, R);
      dobleces[i] = {
        T1: T1, T2: T2, O: O, ang: ang, R: R,
        u: haciaCentro.clone().negate(), // O->T1
        d1: d1, eje: eje
      };
    }

    // tramos rectos + codos
    var partes = [];
    var cursor = pts[0];
    for (i = 1; i < pts.length; i++) {
      var d = dobleces[i];
      agregarCilindro(partes, cursor, d ? d.T1 : pts[i], rTubo, segRad);
      if (d) {
        var nSeg = Math.max(4, Math.ceil(d.ang / (Math.PI / 16))); // ~11° por segmento
        var geoCodo = new THREE.TorusGeometry(d.R, rTubo, segRad, nSeg, d.ang);
        // base local del toro: X = u (O->T1), Y = d1, Z = eje del doblez
        var m = new THREE.Matrix4().makeBasis(d.u, d.d1, d.eje);
        m.setPosition(d.O);
        partes.push({ geo: geoCodo, matriz: m });
        cursor = d.T2;
      } else {
        cursor = pts[i];
      }
    }
    return fusionarGeometrias(partes);
  }

  // ---- Polilíneas de las barras de la viga ----------------------------------
  // Eje de la viga = X, alto = Y, ancho = Z. Viga centrada en el origen.

  // Estribo cerrado con ganchos sísmicos a 135° en la esquina superior
  // izquierda. La pasada de cierre va desplazada 1.15*phi en X (polilínea 3D:
  // los dos extremos quedan lado a lado, no superpuestos).
  function puntosEstribo(w2, h2, dia, radioInterno) {
    var Rc = radioInterno + dia / 2;
    var t135 = Rc * Math.tan(Math.PI * 0.375); // tangencia del doblez de 135°
    var ext = t135 + Math.max(6 * dia, 0.075); // extensión libre de norma tras el doblez
    var dg = 0.70710678 * ext;
    var dx = 1.15 * dia;
    return [
      v3(0, h2 - dg, -w2 + dg),  // punta gancho 1 (hacia el núcleo, 45°)
      v3(0, h2, -w2),            // doblez 135°
      v3(0, -h2, -w2),
      v3(0, -h2, w2),
      v3(0, h2, w2),
      v3(dx, h2, -w2),           // pasada de cierre
      v3(dx, h2 - dg, -w2 + dg)  // punta gancho 2
    ];
  }

  // Barra longitudinal con ganchos a 90° en ambos extremos (extensión 12*phi,
  // recortada si el alto de la viga no la admite). sentido: -1 = gancho hacia
  // abajo (barras superiores), +1 = hacia arriba (inferiores).
  function puntosLongitudinal(L2, dia, sentido, radioInterno, altoDisponible) {
    var Rc = radioInterno + dia / 2;
    var ext = Math.min(12 * dia, Math.max(0.04, altoDisponible * 0.8 - Rc));
    var e = Rc + ext; // tangencia + extensión
    if (altoDisponible < Rc * 2 || ext < dia * 2) {
      return [v3(-L2, 0, 0), v3(L2, 0, 0)]; // no cabe el gancho: barra recta
    }
    return [
      v3(-L2, sentido * e, 0),
      v3(-L2, 0, 0),
      v3(L2, 0, 0),
      v3(L2, sentido * e, 0)
    ];
  }

  // Traba vertical: gancho 135° arriba (cruza sobre la barra longitudinal) y
  // gancho 90° abajo. Se genera centrada en z=0 (el z real lo da la instancia).
  function puntosTraba(ySup, dia, diaLong, radioInterno) {
    var Rc = radioInterno + dia / 2;
    var off = (dia + diaLong) / 2;
    var oz = off * 1.05;   // el tramo vertical pasa al costado de las barras
    var oy = off * 1.7;    // los dobleces quedan sobre/bajo las barras
    var t135 = Rc * 2.41421356;
    var e135 = t135 + Math.max(6 * dia, 0.075);
    var e90 = Rc + Math.max(6 * dia, 0.075);
    var dg = 0.70710678 * e135;
    return [
      v3(0, ySup + oy - dg, oz - dg), // punta gancho 135°
      v3(0, ySup + oy, oz),           // doblez 135°
      v3(0, -ySup - oy, oz),          // doblez 90°
      v3(0, -ySup - oy, oz - e90)     // pie del gancho 90°
    ];
  }

  // ---- Materiales (compartidos entre reconstrucciones) ----------------------
  var _materiales = null;
  function obtenerMateriales() {
    if (_materiales) return _materiales;
    _materiales = {
      acero: new THREE.MeshStandardMaterial({ color: 0x8b9bb0, metalness: 0.6, roughness: 0.5 }),
      estribo: new THREE.MeshStandardMaterial({ color: 0x6f7d8f, metalness: 0.6, roughness: 0.55 }),
      traba: new THREE.MeshStandardMaterial({ color: 0x9aa8bb, metalness: 0.6, roughness: 0.5 }),
      hormigon: new THREE.MeshStandardMaterial({
        color: 0xb9bfc9, transparent: true, opacity: 0.15, depthWrite: false
      }),
      borde: new THREE.LineBasicMaterial({ color: 0x4a545f })
    };
    return _materiales;
  }

  // ---- Viga paramétrica completa --------------------------------------------
  // p: { L, b, h, r, s, diaLong, diaEst, nSup, nInf, factorRadio, segRad } (m)
  // Devuelve { grupo, hormigon, geometrias, nBarras, nEstribos, nTrabas, nTriangulos }
  function construirViga(p) {
    var mat = obtenerMateriales();
    var grupo = new THREE.Group();
    var geometrias = [];
    var nBarras = 0, nTris = 0;
    var i, j, m4;

    var factorR = p.factorRadio || 1;
    var segRad = p.segRad || 12;
    var re = p.diaEst / 2;
    var w2s = p.b / 2 - p.r - re;                    // semiancho eje estribo
    var h2s = p.h / 2 - p.r - re;                    // semialto eje estribo
    var yT = h2s - (p.diaEst + p.diaLong) / 2;       // nivel barras superiores
    var zMax = Math.max(w2s - (p.diaEst + p.diaLong) / 2, 0.001);
    var radioEst = radioDobladoNorma(p.diaEst, factorR);
    var radioLong = radioDobladoNorma(p.diaLong, factorR);

    function registrarInstanciada(geo, material, cantidad, posiciones) {
      var malla = new THREE.InstancedMesh(geo, material, cantidad);
      var m = new THREE.Matrix4();
      for (var k = 0; k < cantidad; k++) {
        m.makeTranslation(posiciones[k][0], posiciones[k][1], posiciones[k][2]);
        malla.setMatrixAt(k, m);
      }
      malla.instanceMatrix.needsUpdate = true;
      malla.frustumCulled = false; // matrices de instancia mueven fuera del bbox base
      grupo.add(malla);
      geometrias.push(geo);
      nBarras += cantidad;
      nTris += (geo.index.count / 3) * cantidad;
      return malla;
    }

    // Estribos: 1 geometría + InstancedMesh a lo largo de X
    var geoEst = crearGeometriaBarra(
      puntosEstribo(w2s, h2s, p.diaEst, radioEst),
      p.diaEst, { radioInterno: radioEst, segmentosRadiales: segRad });
    var nEst = Math.max(2, Math.floor((p.L - 2 * p.r - p.diaEst) / p.s) + 1);
    var xsEst = [];
    var x0 = -((nEst - 1) * p.s) / 2;
    for (i = 0; i < nEst; i++) xsEst.push([x0 + i * p.s, 0, 0]);
    registrarInstanciada(geoEst, mat.estribo, nEst, xsEst);

    // Barras longitudinales: 2 geometrías (gancho abajo / arriba) instanciadas
    var L2 = p.L / 2 - p.r - p.diaEst;
    var altoDisp = yT + h2s;
    var posSup = [], posInf = [];
    for (i = 0; i < p.nSup; i++) {
      posSup.push([0, yT, -zMax + i * (2 * zMax / (p.nSup - 1))]);
    }
    for (i = 0; i < p.nInf; i++) {
      posInf.push([0, -yT, -zMax + i * (2 * zMax / (p.nInf - 1))]);
    }
    var opLong = { radioInterno: radioLong, segmentosRadiales: segRad };
    var geoSup = crearGeometriaBarra(
      puntosLongitudinal(L2, p.diaLong, -1, radioLong, altoDisp), p.diaLong, opLong);
    var geoInf = crearGeometriaBarra(
      puntosLongitudinal(L2, p.diaLong, 1, radioLong, altoDisp), p.diaLong, opLong);
    registrarInstanciada(geoSup, mat.acero, p.nSup, posSup);
    registrarInstanciada(geoInf, mat.acero, p.nInf, posInf);

    // Trabas verticales si el ancho lo amerita (y hay barras interiores que atar)
    var nTrabasPorEstribo = 0;
    if (p.b >= 0.35 && p.nSup >= 3) {
      nTrabasPorEstribo = (p.b >= 0.60 && p.nSup >= 4) ? 2 : 1;
    }
    var nTrabas = 0;
    if (nTrabasPorEstribo > 0) {
      var interiores = [];
      for (i = 1; i < p.nSup - 1; i++) interiores.push(posSup[i][2]);
      var zsTrabas = [];
      if (nTrabasPorEstribo === 1 || interiores.length === 1) {
        zsTrabas.push(interiores[Math.floor((interiores.length - 1) / 2)]);
      } else {
        zsTrabas.push(interiores[0]);
        zsTrabas.push(interiores[interiores.length - 1]);
      }
      var geoTraba = crearGeometriaBarra(
        puntosTraba(yT, p.diaEst, p.diaLong, radioEst),
        p.diaEst, { radioInterno: radioEst, segmentosRadiales: segRad });
      var posTrabas = [];
      for (i = 0; i < nEst; i++) {
        for (j = 0; j < zsTrabas.length; j++) {
          posTrabas.push([xsEst[i][0] - 1.2 * p.diaEst, 0, zsTrabas[j]]);
        }
      }
      nTrabas = posTrabas.length;
      registrarInstanciada(geoTraba, mat.traba, nTrabas, posTrabas);
    }

    // Hormigón: caja semitransparente + aristas (toggleable)
    var geoCaja = new THREE.BoxGeometry(p.L, p.h, p.b);
    var hormigon = new THREE.Group();
    hormigon.add(new THREE.Mesh(geoCaja, mat.hormigon));
    var geoAristas = new THREE.EdgesGeometry(geoCaja);
    hormigon.add(new THREE.LineSegments(geoAristas, mat.borde));
    geometrias.push(geoCaja, geoAristas);
    nTris += 12;
    grupo.add(hormigon);

    return {
      grupo: grupo,
      hormigon: hormigon,
      geometrias: geometrias,
      nBarras: nBarras,
      nEstribos: nEst,
      nTrabas: nTrabas,
      nTriangulos: Math.round(nTris)
    };
  }

  // API pública (también usada por el test de Node)
  global.RebarDemo = {
    NORMA: NORMA,
    radioDobladoNorma: radioDobladoNorma,
    crearGeometriaBarra: crearGeometriaBarra,
    fusionarGeometrias: fusionarGeometrias,
    puntosEstribo: puntosEstribo,
    puntosLongitudinal: puntosLongitudinal,
    puntosTraba: puntosTraba,
    construirViga: construirViga
  };

  // ==========================================================================
  // Escena + UI (solo navegador)
  // ==========================================================================
  if (typeof document === 'undefined' || !document.getElementById('escena')) return;

  if (!THREE) {
    document.getElementById('errorCdn').style.display = 'block';
    return;
  }

  var contenedor = document.getElementById('escena');
  var escena = new THREE.Scene();
  escena.background = new THREE.Color(0x14171c);

  var camara = new THREE.PerspectiveCamera(
    45, contenedor.clientWidth / contenedor.clientHeight, 0.05, 300);

  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
  renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
  contenedor.appendChild(renderer.domElement);

  escena.add(new THREE.AmbientLight(0xffffff, 0.45));
  var luz1 = new THREE.DirectionalLight(0xffffff, 1.6);
  luz1.position.set(5, 9, 4);
  escena.add(luz1);
  var luz2 = new THREE.DirectionalLight(0x9db4d4, 0.4);
  luz2.position.set(-6, 3, -7);
  escena.add(luz2);

  var grilla = new THREE.GridHelper(24, 24, 0x2b313b, 0x21262e);
  escena.add(grilla);

  // ---- Órbita manual (sin OrbitControls: patrón three.min global del repo) --
  var orb = { theta: 0.75, phi: 1.12, radio: 9, target: new THREE.Vector3(0, 0, 0) };
  function actualizarCamara() {
    var sp = Math.sin(orb.phi);
    camara.position.set(
      orb.target.x + orb.radio * sp * Math.sin(orb.theta),
      orb.target.y + orb.radio * Math.cos(orb.phi),
      orb.target.z + orb.radio * sp * Math.cos(orb.theta));
    camara.lookAt(orb.target);
  }

  var arrastre = null;
  var dom = renderer.domElement;
  dom.addEventListener('pointerdown', function (e) {
    arrastre = { x: e.clientX, y: e.clientY, boton: e.button, shift: e.shiftKey };
    dom.setPointerCapture(e.pointerId);
  });
  dom.addEventListener('pointermove', function (e) {
    if (!arrastre) return;
    var dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
    arrastre.x = e.clientX; arrastre.y = e.clientY;
    if (arrastre.boton === 2 || arrastre.shift) {
      var esc = orb.radio * 0.0011;
      var dir = new THREE.Vector3();
      camara.getWorldDirection(dir);
      var der = new THREE.Vector3().crossVectors(dir, camara.up).normalize();
      var arriba = new THREE.Vector3().crossVectors(der, dir).normalize();
      orb.target.addScaledVector(der, -dx * esc);
      orb.target.addScaledVector(arriba, dy * esc);
    } else {
      orb.theta -= dx * 0.005;
      orb.phi = Math.min(Math.PI - 0.05, Math.max(0.05, orb.phi - dy * 0.005));
    }
    actualizarCamara();
  });
  dom.addEventListener('pointerup', function () { arrastre = null; });
  dom.addEventListener('pointercancel', function () { arrastre = null; });
  dom.addEventListener('wheel', function (e) {
    e.preventDefault();
    orb.radio = Math.min(80, Math.max(0.4, orb.radio * Math.exp(e.deltaY * 0.0009)));
    actualizarCamara();
  }, { passive: false });
  dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---- Controles ------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  var inp = {
    L: $('inpL'), b: $('inpB'), h: $('inpH'), r: $('inpR'), s: $('inpS'),
    diaLong: $('inpDiaLong'), diaEst: $('inpDiaEst'),
    nSup: $('inpNSup'), nInf: $('inpNInf'),
    factorRadio: $('inpFactorRadio'), segRad: $('inpSegRad')
  };
  var chkHormigon = $('chkHormigon');
  var st = {
    barras: $('stBarras'), estribos: $('stEstribos'), tris: $('stTris'),
    calls: $('stCalls'), fps: $('stFps')
  };

  function fmt(n) { return n.toLocaleString('es-CL'); }

  function leerParametros() {
    function num(el, def) { var x = parseFloat(el.value); return isFinite(x) ? x : def; }
    return {
      L: num(inp.L, 8),
      b: num(inp.b, 30) / 100,
      h: num(inp.h, 60) / 100,
      r: num(inp.r, 4) / 100,
      s: num(inp.s, 12) / 100,
      diaLong: num(inp.diaLong, 22) / 1000,
      diaEst: num(inp.diaEst, 10) / 1000,
      nSup: Math.min(8, Math.max(2, Math.round(num(inp.nSup, 4)))),
      nInf: Math.min(8, Math.max(2, Math.round(num(inp.nInf, 5)))),
      factorRadio: num(inp.factorRadio, 1),
      segRad: Math.round(num(inp.segRad, 12))
    };
  }

  function actualizarEtiquetas(p) {
    $('valL').textContent = p.L.toFixed(1) + ' m';
    $('valB').textContent = Math.round(p.b * 100) + ' cm';
    $('valH').textContent = Math.round(p.h * 100) + ' cm';
    $('valR').textContent = (p.r * 100).toFixed(1) + ' cm';
    $('valS').textContent = Math.round(p.s * 100) + ' cm';
  }

  var viga = null;
  function reconstruir() {
    var p = leerParametros();
    actualizarEtiquetas(p);
    if (viga) {
      escena.remove(viga.grupo);
      for (var i = 0; i < viga.geometrias.length; i++) viga.geometrias[i].dispose();
      viga = null;
    }
    viga = construirViga(p);
    viga.hormigon.visible = chkHormigon.checked;
    escena.add(viga.grupo);
    grilla.position.y = -p.h / 2 - 0.02;
    st.barras.textContent = fmt(viga.nBarras);
    st.estribos.textContent = fmt(viga.nEstribos) + ' / ' + fmt(viga.nTrabas);
    st.tris.textContent = fmt(viga.nTriangulos);
  }

  var reconstruccionPendiente = false;
  function programarReconstruccion() {
    if (reconstruccionPendiente) return;
    reconstruccionPendiente = true;
    global.requestAnimationFrame(function () {
      reconstruccionPendiente = false;
      reconstruir();
    });
  }

  Object.keys(inp).forEach(function (k) {
    inp[k].addEventListener('input', programarReconstruccion);
    inp[k].addEventListener('change', programarReconstruccion);
  });
  chkHormigon.addEventListener('change', function () {
    if (viga) viga.hormigon.visible = chkHormigon.checked;
  });

  global.addEventListener('resize', function () {
    camara.aspect = contenedor.clientWidth / contenedor.clientHeight;
    camara.updateProjectionMatrix();
    renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
  });

  // ---- Bucle de render + FPS ------------------------------------------------
  var cuadros = 0;
  var tPrevio = (global.performance || Date).now();
  function bucle() {
    global.requestAnimationFrame(bucle);
    renderer.render(escena, camara);
    cuadros++;
    var t = (global.performance || Date).now();
    if (t - tPrevio >= 500) {
      st.fps.textContent = String(Math.round(cuadros * 1000 / (t - tPrevio)));
      st.calls.textContent = String(renderer.info.render.calls);
      cuadros = 0;
      tPrevio = t;
    }
  }

  reconstruir();
  orb.radio = leerParametros().L * 0.85 + 1.5;
  actualizarCamara();
  bucle();

})(typeof window !== 'undefined' ? window : globalThis);
