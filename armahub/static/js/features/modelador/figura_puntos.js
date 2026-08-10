// =============================================================================
// Modelador 3D — FIGURA → PUNTOS (F0 · T0.3)
// Dada una figura del catálogo (sus `parciales`/lados + ángulos) y las dims
// efectivas (cm), produce la POLILÍNEA 3D de esa barra, ubicada según un
// `anchor` (cara del hormigón + recubrimiento) dentro de la caja del elemento.
//
// Sistema de coordenadas del HOST (viga), unidades = cm, viga centrada en origen:
//   X = eje longitudinal (largo)   → [-largo/2, +largo/2]
//   Y = alto                       → [-alto/2, +alto/2]  (sup = +, inf = -)
//   Z = ancho                      → [-ancho/2, +ancho/2]
//
// El MVP resuelve las figuras de la viga-semilla de forma PARAMÉTRICA a partir
// de sus parciales/ángulos (no necesita leer geometria JSON del catálogo, que
// puede no existir para estas figuras). Diseñado como un conjunto de
// "constructores por rol" (cabezal longitudinal / estribo perimetral / traba)
// despachados por la figura + tipología. Escala a más figuras agregando casos.
//
// NOTA de convención: los ángulos del catálogo (45/135) describen el gancho; el
// motor de render usa el giro real. Aquí se dibuja la forma con ganchos a 45°/90°
// coherentes con la maqueta rebar3d (estético; el cálculo de kilos lo hace el
// backend por suma de lados).
// =============================================================================
(function (global) {
  'use strict';

  function V(x, y, z) { return { x: x, y: y, z: z }; }

  // Extensión libre del gancho tras el doblez (norma aprox): 6φ, mínimo ~7.5 cm.
  function extGancho(diamCm) { return Math.max(6 * diamCm, 7.5); }

  // ---- CABEZAL / longitudinal: barra a lo largo de X, con ganchos en extremos.
  // host: {largo, alto, ancho}. anchor: {cara:'sup'|'inf', y, z, recubExtremo}.
  // dims: {A, B, C} de la figura (A,C = patas del gancho; B = tramo largo). Si la
  // figura no usa gancho (101A = solo A recto) se dibuja recta.
  // sentidoGancho: -1 = gancho hacia abajo (barras superiores), +1 = hacia arriba.
  function _cabezalLongitudinal(figura, dims, host, anchor, diamCm) {
    var y = anchor.y, z = anchor.z;
    var s = (anchor.cara === 'sup') ? -1 : 1;   // gancho hacia el núcleo
    var f = (figura || '').toUpperCase();
    // Empalme: cuánto asoma FUERA del hormigón y por qué extremo (dato de
    // trazabilidad; la dim ya viene alargada, aquí sólo se orienta el excedente
    // al extremo indicado en vez de repartirlo simétrico). eIni/eFin en X.
    var emp = anchor.empalme || null;
    var eIni = 0, eFin = 0;
    if (emp && emp.valor > 0) {
      if (emp.extremo === 'inicio') eIni = emp.valor;
      else if (emp.extremo === 'fin') eFin = emp.valor;
      else if (emp.extremo === 'ambos') { eIni = emp.valor; eFin = emp.valor; }
    }
    // 101A (una sola dim A): barra RECTA de largo A (no hay patas de gancho).
    if (f.indexOf('101') === 0) {
      var largoRecto = (dims.A != null) ? dims.A : (host.largo - 2 * (anchor.recubExtremo || 0));
      // El excedente de empalme (eIni+eFin) ya está DENTRO de largoRecto (dim
      // alargada). Se ubica el segmento asimétrico: la mitad "base" centrada y
      // el empalme sobresaliendo por su extremo.
      var lBase = largoRecto - eIni - eFin;
      var xi = -lBase / 2 - eIni, xf = lBase / 2 + eFin;
      return [V(xi, y, z), V(xf, y, z)];
    }
    var largoTramo = (dims.B != null) ? dims.B : (host.largo - 2 * (anchor.recubExtremo || 0));
    // El empalme del tramo largo se reparte al extremo indicado sobre B.
    var bBase = largoTramo - eIni - eFin;
    var x0 = -bBase / 2 - eIni, x1 = bBase / 2 + eFin;
    var A = (dims.A != null) ? dims.A : 0;
    var C = (dims.C != null) ? dims.C : 0;
    // 102x / recta sin patas → segmento simple.
    if (!A && !C) return [V(x0, y, z), V(x1, y, z)];
    // 103x: pata A (inicio) + tramo B + pata C (fin), ganchos hacia el núcleo (90°).
    var pts = [];
    if (A) pts.push(V(x0, y + s * A, z));
    pts.push(V(x0, y, z));
    pts.push(V(x1, y, z));
    if (C) pts.push(V(x1, y + s * C, z));
    return pts;
  }

  // ---- MARCO de recubrimiento del núcleo (compartido estribo/traba) ----------
  // El estribo y la traba encuadran el MISMO rectángulo útil dentro del hormigón:
  //   semialto  h2 = alto/2  − recub VERTICAL  (recub sup/inf, típ. 4 cm)
  //   semiancho w2 = ancho/2 − recub LATERAL   (recub_lat, típ. 3 cm)
  // El recub vertical y el lateral son DISTINTOS; usarlos cruzados dejaba un lado
  // corto (bug: el estribo no encuadraba el perímetro y la traba no coincidía con
  // el estribo). anchor.recub = recub vertical; anchor.recubLat = recub lateral
  // (lo pasa reglas.js _baseDeComponente). Si recubLat falta, cae a recub (así el
  // marco sigue siendo cuadrado-coherente y los tests que sólo pasan `recub` no
  // cambian). Deriva h2/w2 en UN solo lugar para que estribo y traba compartan
  // EXACTAMENTE el mismo marco (misma altura, mismo ancho).
  function _marcoNucleo(host, anchor) {
    var recubV = anchor.recub != null ? anchor.recub : 3;
    var recubLat = anchor.recubLat != null ? anchor.recubLat : recubV;
    return {
      recubV: recubV,
      recubLat: recubLat,
      h2: host.alto / 2 - recubV,
      w2: host.ancho / 2 - recubLat
    };
  }

  // ---- ESTRIBO perimetral cerrado (plano YZ, a una X dada), gancho 135°.
  // dims: {A,B,C,D} = perímetro (alto/ancho − recubrimientos). host + anchor
  // (recubrimiento del núcleo). Encuadra el rectángulo COMPLETO (alto útil × ancho
  // útil): recorre las 4 esquinas y VUELVE a la esquina de inicio (rectángulo
  // cerrado), rematando con los 2 ganchos 135° que salen de esa esquina. Las
  // esquinas se redondean solas: el motor_geom mete un toro tangente en cada
  // vértice interior (radio de doblado de norma) → aquí basta con dar vértices
  // agudos separados.
  //
  //   FORMA DERIVADA DE LA FIGURA REAL (106A/104x = estribo cerrado con 2 ganchos):
  //   la figura del catálogo NO trae curvas (la curva del codo es efecto del
  //   render, motor_geom); su forma canónica es un RECTÁNGULO PERIMETRAL + 2
  //   ganchos internos 135° (ángulos guardados [45,45] = interno 45 = giro 135 en
  //   cada gancho; las 4 esquinas del rectángulo son 90° implícitas). En vez de
  //   copiar dimensiones ABSTRACTAS del catálogo, la forma se ANCLA al marco de
  //   hormigón (_marcoNucleo: h2=alto/2−recubV, w2=ancho/2−recubLat) → encuadra el
  //   núcleo real dentro del recubrimiento (criterio del usuario).
  //
  //   REGLA DE ORO DEL CIERRE (fix del bug "esquina sup no cierra / ganchos
  //   desfasados / un rectángulo por estribo"): el rectángulo perimetral es 100%
  //   PLANAR — sus 4 aristas viven en la MISMA X (=anchor.x) → los 4 dobleces de
  //   las esquinas salen con eje EXACTO (±1,0,0) (fillet en el plano YZ, esquina
  //   cierra limpio). El offset "/ /" (esp) del doble-gancho se aplica ÚNICAMENTE a
  //   la PUNTA LIBRE del 2º gancho (último punto), NUNCA a un vértice del
  //   rectángulo. Antes el offset tocaba el vértice sup-izq del cierre → convertía
  //   la arista superior en una RAMPA en X e inclinaba 2 fillets fuera de YZ, y en
  //   la sección aparecían 2 aristas con misma (z,y) y distinto x (doble-línea).
  //
  //   El eje de profundidad (donde vive el "/ /") es X para la viga (plano YZ).
  //   `anchor.ejeCierre` ('x'|'y'|'z') lo reorienta si algún elemento pusiera el
  //   estribo en otro plano de profundidad; ausente ⇒ X (comportamiento por
  //   defecto). El rectángulo en sí sigue en YZ (Y=vertical h2, Z=horizontal w2):
  //   el "volteo" de la pieza es asunto del proyector de vista (projV).
  // GANCHO con ARCO EXPLÍCITO (estándar BVBS): desde la esquina del rectángulo, una pata
  // recta corta → ARCO (radio de norma, puntos densos) → pata del gancho hacia el núcleo.
  // La curva es geometría PROPIA (no la deriva el motor recortando el codo, que para 135°
  // se comía la pata y colapsaba). Signos CALIBRADOS: perp=−1, sentido=+1 → la punta
  // apunta al núcleo y la cresta del arco toca el borde superior. Devuelve los puntos DEL
  // GANCHO desde la esquina hasta la punta.
  //   esquina : donde nace (una esquina del rectángulo, en x=xx).
  //   dirLado : dirección del lado que baja desde la esquina (unitaria, {y,z}).
  function _ganchoArco(esquina, dirLado, signPerp, sentido, diamCm, xx) {
    var Rc = 2 * diamCm + diamCm / 2;                 // radio del EJE (2φ interno + rTubo, norma)
    var largoPata = Math.max(6 * diamCm, 7.5);        // pata del gancho (norma)
    var angDobl = 135 * Math.PI / 180;
    var pataAntes = Math.max(0.1, diamCm * 0.3);      // tramo recto MÍNIMO antes del arco
                                                       // (antes = Rc = 2cm, se veía un borde recto largo)
    var pIni = { x: xx, y: esquina.y + dirLado.y * pataAntes, z: esquina.z + dirLado.z * pataAntes };
    // centro del arco: perpendicular a dirLado. signPerp + sentido se CALIBRAN por gancho
    // (según el lado por el que sale) para que la curva doble hacia el NÚCLEO.
    var perp = { y: signPerp * (-dirLado.z), z: signPerp * (dirLado.y) };
    var O = { x: xx, y: pIni.y + perp.y * Rc, z: pIni.z + perp.z * Rc };
    var ang0 = Math.atan2(pIni.z - O.z, pIni.y - O.y);
    var n = Math.max(8, Math.ceil(angDobl / (Math.PI / 18)));   // ~10°/punto (curva lisa)
    var arco = [];
    // arranca en k=1: k=0 daría EXACTAMENTE pIni (ya está en la lista) → punto duplicado
    // que el motor dibujaba como un tramo de largo 0 / barra superpuesta en el inicio.
    for (var k = 1; k <= n; k++) {
      var a = ang0 + sentido * angDobl * (k / n);
      arco.push({ x: xx, y: O.y + Rc * Math.cos(a), z: O.z + Rc * Math.sin(a) });
    }
    // pata del gancho: tangente al final del arco.
    var pFin = arco[arco.length - 1], pPrev = arco[arco.length - 2];
    var dl = Math.hypot(pFin.y - pPrev.y, pFin.z - pPrev.z) || 1;
    var punta = { x: xx, y: pFin.y + (pFin.y - pPrev.y) / dl * largoPata, z: pFin.z + (pFin.z - pPrev.z) / dl * largoPata };
    return [esquina, pIni].concat(arco).concat([punta]);
  }

  function _estriboPerimetral(figura, dims, host, anchor, diamCm) {
    var m = _marcoNucleo(host, anchor);
    var h2 = m.h2, w2 = m.w2;         // marco compartido con la traba (FIX: w2 usa recubLat)
    var xx = anchor.x || 0;
    var pSupIzq = { x: xx, y: h2, z: -w2 };           // esquina sup-izq (nacen los ganchos)

    // DOS ganchos con arco explícito, ambos nacen en la esquina sup-izq:
    //  · Gancho 1: baja por el lado IZQUIERDO (dir −Y) y dobla al núcleo.
    //  · Gancho 2: sale por el lado SUPERIOR (dir +Z) y dobla al núcleo.
    // Así son los 2 ganchos de un estribo real, abiertos hacia el núcleo desde la misma
    // esquina, sin superponerse. Cada uno con su curva (arco explícito).
    // signos CALIBRADOS por gancho (verificado numéricamente → punta al núcleo):
    //  · g1 baja por −Y  → perp=−1, sentido=+1
    //  · g2 sale por +Z  → perp=+1, sentido=−1
    var g1 = _ganchoArco(pSupIzq, { y: -1, z: 0 }, -1, +1, diamCm, xx);   // [esquina, pIni, arco..., punta]
    var g1Inv = g1.slice().reverse();                 // [punta1, ...arco, pIni, esquina]
    var g2 = _ganchoArco(pSupIzq, { y: 0, z: 1 }, +1, -1, diamCm, xx);    // sale por el lado superior

    // Rectángulo planar (cierra exacto). Sus 4 esquinas de 90° las redondea el motor.
    var rect = [
      { x: xx, y: -h2, z: -w2 },       // inf-izq
      { x: xx, y: -h2, z: w2 },        // inf-der
      { x: xx, y: h2, z: w2 },         // sup-der
      pSupIzq                          // CIERRE exacto sup-izq
    ];
    // Polilínea: punta_g1 → arco1 → esquina → rectángulo → cierre(esquina) → arco2 → punta_g2.
    // g1Inv termina en la esquina; el rect arranca en inf-izq y cierra en la esquina;
    // g2 arranca en la esquina (su [0]) → concateno g2 SIN su primer punto (la esquina,
    // ya presente por el cierre) para no duplicar.
    return g1Inv.concat(rect).concat(g2.slice(1));
  }

  // ---- TRABA vertical (101A típ.): cose las dos caras, gancho arriba/abajo.
  // Va a una X dada (anchor.x), a un Z dado (anchor.z), entre las barras sup/inf.
  // TERMINA donde termina el estribo: usa el MISMO marco (_marcoNucleo → mismo h2),
  // de modo que su vertical va de +h2 a −h2 exactamente como el estribo (antes
  // podía derivar un h2 distinto y no coincidir en altura).
  function _traba(figura, dims, host, anchor, diamCm) {
    var m = _marcoNucleo(host, anchor);
    var h2 = m.h2;                    // MISMO semialto que el estribo
    var xx = anchor.x || 0, zz = anchor.z || 0;
    var g = 0.7071 * (extGancho(diamCm) + diamCm);
    // gancho 135° arriba (diagonal hacia el núcleo) + gancho 90° abajo.
    return [
      V(xx, h2 - g, zz - g),   // punta gancho 135° arriba
      V(xx, h2, zz),           // doblez arriba (a la altura del estribo)
      V(xx, -h2, zz),          // baja al fondo (a la altura del estribo)
      V(xx, -h2, zz - extGancho(diamCm))   // pie gancho 90° abajo
    ];
  }

  // ---- Despachador principal -------------------------------------------------
  // rol: 'cabezal' | 'estribo' | 'traba' (viene de la tipología del componente).
  // Devuelve la polilínea [{x,y,z}] en coordenadas del host (cm).
  function figuraAPuntos(figura, dims, host, anchor, opts) {
    opts = opts || {};
    var diamCm = opts.diamCm != null ? opts.diamCm : 1.0;
    var rol = opts.rol || _rolPorFigura(figura, anchor);
    if (rol === 'estribo') return _estriboPerimetral(figura, dims, host, anchor, diamCm);
    if (rol === 'traba') return _traba(figura, dims, host, anchor, diamCm);
    return _cabezalLongitudinal(figura, dims, host, anchor, diamCm);
  }

  // Heurística de rol si la tipología no lo dice: figuras 104* cerradas = estribo.
  function _rolPorFigura(figura, anchor) {
    var f = (figura || '').toUpperCase();
    if (anchor && anchor.cara === 'lateral') return 'traba';
    if (f.charAt(0) === '1' && f.charAt(1) === '0' && f.charAt(2) === '4') return 'estribo';
    return 'cabezal';
  }

  var API = {
    figuraAPuntos: figuraAPuntos,
    extGancho: extGancho,
    // exportados para tests / reuso
    _cabezalLongitudinal: _cabezalLongitudinal,
    _estriboPerimetral: _estriboPerimetral,
    _traba: _traba
  };

  global.ModeladorFiguraPuntos = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
