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

  // ---- ESTRIBO perimetral cerrado (plano YZ, a una X dada), ganchos sísmicos 135°.
  //
  // GEOMETRÍA DEL FIERRO REAL (la que resuelve "ganchos PARALELOS *y* codos de 135°",
  // que parecía contradictorio pero no lo es — el error previo era la dirección de
  // ENTRADA del 2º gancho):
  //
  //   El fierro es UNA barra continua. Su recorrido:
  //     punta gancho A → codo 135° → baja el lado IZQUIERDO → esquina inf-izq (90°)
  //     → lado inferior → esquina inf-der (90°) → sube lado derecho → esquina
  //     sup-der (90°) → lado SUPERIOR viajando hacia la IZQUIERDA (−Z) → codo 135°
  //     → punta gancho B.
  //
  //   · El gancho A entra al codo viajando en diagonal (−45°: desde el núcleo hacia
  //     la esquina) y sale bajando (−Y): giro de 135° exacto.
  //   · El gancho B entra al codo viajando por el lado superior (−Z) y sale en la
  //     diagonal al núcleo (135°): giro de 135° exacto.
  //   · Ambas patas viven en la MISMA dirección de recta (la diagonal ±45° de la
  //     esquina) → PARALELAS exactas (0.0°), con sentidos de viaje opuestos.
  //
  //   Los DOS codos comparten el CENTRO de la esquina redondeada estándar:
  //     O = (h2−Rc, −w2+Rc), con Rc = radio del EJE = 2φ (radio interno de norma,
  //     mandril 4φ de diámetro) + φ/2. Consecuencias automáticas:
  //     · codo B tangente al lado SUPERIOR → su cresta (eje) toca y=h2 EXACTO, y el
  //       borde exterior del codo coincide con el borde exterior del lado E (la
  //       "regla de la cresta" del usuario, sin fórmula extra);
  //     · codo A tangente al lado IZQUIERDO → toca z=−w2 exacto (simétrico);
  //     · el vértice (h2,−w2) NO existe como punto: la esquina ES los dos codos
  //       superpuestos, como en el estribo físico (el offset en profundidad para el
  //       cruce real se hará en una etapa posterior).
  //
  //   Los codos son ARCOS EXPLÍCITOS (estándar BVBS "arch" para dobleces >90°):
  //   se muestrean densos (~10°/punto) y el motor los dibuja liso; NO se deja que
  //   el motor derive el fillet (para 135° su tangencia t=Rc·tan(67.5°) no cabe y
  //   colapsaba el radio — causa raíz de 3 días de bugs). Las 3 esquinas de 90°
  //   restantes sí van en punta: el fillet del motor las redondea bien (90° cabe).
  //
  //   SOLO CAPA VISUAL: el largo/peso sale de las DIMS en el backend
  //   (largo_desde_lados + peso.py), jamás de estos puntos.
  //
  // Convención del arco: punto(θ) = O + Rc·(cosθ·Ŷ + sinθ·Ẑ), planar en x=xx.
  //   θ=0 → +Y (arriba) · θ=−90° → −Z (izquierda). Viajando con θ DECRECIENTE la
  //   tangente es (sinθ, −cosθ).
  // PERF (F0·esArco): cada punto del arco se marca con `esArco:true`. El motor
  // geométrico (motor_geom.analizarBarra) NO le mete fillet-toro a un vértice que
  // ya viene de un arco MUESTREADO: la curva ya está descrita por los puntos, así
  // que basta unirlos con CUERDAS (cilindros). Antes, cada uno de los ~14 puntos
  // por codo generaba además un toro de 8 segmentos → ~60% de los triángulos del
  // estribo eran redundantes. La FORMA VISIBLE no cambia (el muestreo es de ~10°,
  // la cuerda y el arco coinciden a menos de 0.4% del radio).
  // Es un flag ADITIVO en el punto: si se pierde por el camino (algún .map que
  // recree los puntos), el motor cae al comportamiento anterior — más lento pero
  // idéntico visualmente. NUNCA cambia el largo/peso (los pone el backend por dims).
  function _arcoYZ(O, Rc, thetaIni, thetaFin, xx, incluirInicio) {
    var barrido = thetaFin - thetaIni;
    var n = Math.max(8, Math.ceil(Math.abs(barrido) / (Math.PI / 18)));   // ~10°/punto
    var out = [];
    for (var k = (incluirInicio ? 0 : 1); k <= n; k++) {
      var a = thetaIni + barrido * (k / n);
      out.push({ x: xx, y: O.y + Rc * Math.cos(a), z: O.z + Rc * Math.sin(a), esArco: true });
    }
    return out;
  }

  function _estriboPerimetral(figura, dims, host, anchor, diamCm) {
    var m = _marcoNucleo(host, anchor);
    var h2 = m.h2, w2 = m.w2;          // marco compartido con la traba
    var xx = anchor.x || 0;
    var Rc = 2 * diamCm + diamCm / 2;  // radio del EJE del codo (norma: interno 2φ + φ/2)
    var O = { x: xx, y: h2 - Rc, z: -w2 + Rc };   // centro común de ambos codos (esquina sup-izq)
    var D = Math.SQRT1_2;              // 0.7071 (diagonal unitaria)
    // Pata del gancho (norma 6φ mín 7.5cm), acotada al núcleo para no cruzar bordes.
    var largoPata = Math.min(Math.max(6 * diamCm, 7.5), Math.hypot(2 * h2, 2 * w2) * 0.28);
    var dirPata = { y: -D, z: D };     // diagonal hacia el núcleo (abajo-derecha) — COMÚN

    // GANCHO A (inicio del fierro): pata → codo [θ: 45° → −90°] → tangente al lado izq.
    var pA = { x: xx, y: O.y + Rc * D, z: O.z + Rc * D };            // punto del arco en θ=45°
    var puntaA = { x: xx, y: pA.y + dirPata.y * largoPata, z: pA.z + dirPata.z * largoPata };
    var codoA = _arcoYZ(O, Rc, Math.PI / 4, -Math.PI / 2, xx, true); // incluye θ=45°, termina θ=−90°

    // GANCHO B (fin del fierro): lado superior llega a T0 (θ=0) → codo [θ: 0 → −135°] → pata.
    var T0 = { x: xx, y: h2, z: -w2 + Rc };                          // tangencia con lado superior
    var codoB = _arcoYZ(O, Rc, 0, -3 * Math.PI / 4, xx, false);      // excluye θ=0 (T0 ya en la lista)
    var pB = codoB[codoB.length - 1];                                // punto del arco en θ=−135°
    var puntaB = { x: xx, y: pB.y + dirPata.y * largoPata, z: pB.z + dirPata.z * largoPata };

    // POLILÍNEA continua (el codo A termina tangente en (h2−Rc,−w2) y sigue colineal
    // bajando el lado izq → el motor no mete fillet ahí; ídem lado superior → T0):
    return [puntaA]
      .concat(codoA)                        // codo A completo (135°)
      .concat([
        { x: xx, y: -h2, z: -w2 },          // esquina inf-izq (90°, fillet del motor)
        { x: xx, y: -h2, z: w2 },           // esquina inf-der (90°)
        { x: xx, y: h2, z: w2 },            // esquina sup-der (90°)
        T0                                  // fin del lado superior = tangencia del codo B
      ])
      .concat(codoB)                        // codo B completo (135°)
      .concat([puntaB]);
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
