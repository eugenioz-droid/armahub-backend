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

  // ---- ESTRIBO perimetral cerrado (plano YZ, a una X dada), gancho 135°.
  // dims: {A,B,C,D} = perímetro (alto/ancho − recubrimientos). host + anchor
  // (recubrimiento del núcleo). El offset del cierre "/ /" se separa en X (espesor).
  function _estriboPerimetral(figura, dims, host, anchor, diamCm) {
    var recub = anchor.recub != null ? anchor.recub : 3;
    // semialto / semiancho del EJE del estribo (dentro del recubrimiento).
    var h2 = host.alto / 2 - recub;
    var w2 = host.ancho / 2 - recub;
    var xx = anchor.x || 0;
    var esp = diamCm * 1.05;         // offset del cierre, en X (por el espesor) → "/ /"
    var g = 0.7071 * (extGancho(diamCm) + diamCm);   // proyección diagonal del gancho 135°
    return [
      V(xx, h2 - g, -w2 + g),     // punta gancho 1 (hacia el núcleo, 45°)
      V(xx, h2, -w2),             // esquina sup-izq (doblez 135°)
      V(xx, -h2, -w2),            // baja
      V(xx, -h2, w2),             // cruza abajo
      V(xx, h2, w2),              // sube der
      V(xx + esp, h2, -w2),       // pasada de cierre (misma esquina, +esp en X)
      V(xx + esp, h2 - g, -w2 + g)  // punta gancho 2 (paralela, offset en X)
    ];
  }

  // ---- TRABA vertical (101A típ.): cose las dos caras, gancho arriba/abajo.
  // Va a una X dada (anchor.x), a un Z dado (anchor.z), entre las barras sup/inf.
  function _traba(figura, dims, host, anchor, diamCm) {
    var recub = anchor.recub != null ? anchor.recub : 3;
    var h2 = host.alto / 2 - recub;
    var xx = anchor.x || 0, zz = anchor.z || 0;
    var g = 0.7071 * (extGancho(diamCm) + diamCm);
    // gancho 135° arriba (diagonal hacia el núcleo) + gancho 90° abajo.
    return [
      V(xx, h2 - g, zz - g),   // punta gancho 135° arriba
      V(xx, h2, zz),           // doblez arriba
      V(xx, -h2, zz),          // baja al fondo
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
