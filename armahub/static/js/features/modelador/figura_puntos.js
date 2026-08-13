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
// Las figuras se resuelven de forma PARAMÉTRICA a partir de sus parciales/
// ángulos del CATÁLOGO (catalogo_figuras.js), no de la geometria JSON (que
// puede no existir). Son cuatro "constructores por familia" — recta / cabezal
// longitudinal con patas / estribo perimetral / traba — y la familia se DERIVA
// del rol de la tipología y del nº de lados de la figura (familiaDeDibujo), sin
// una lista de casos por código. Lo que estos constructores no saben trazar
// honestamente (espirales con radio, cadenas de 5+ tramos) se declara NO
// DIBUJABLE con motivo (dibujabilidad/noDibujables) en vez de aproximarse.
//
// NOTA de convención: los ángulos del catálogo (45/135) describen el gancho; el
// motor de render usa el giro real. Aquí se dibuja la forma con ganchos a 45°/90°
// coherentes con la maqueta rebar3d (estético; el cálculo de kilos lo hace el
// backend por suma de lados).
// =============================================================================
(function (global) {
  'use strict';

  function V(x, y, z) { return { x: x, y: y, z: z }; }

  // Resolver el CATÁLOGO en el momento de usarlo (scripts en paralelo en el
  // navegador: catalogo_figuras.js puede cargar DESPUÉS que este archivo). Misma
  // regla que _reglas() en generar.js y _fp() en reglas.js.
  function _cat() {
    return global.ModeladorCatalogoFiguras ||
      (typeof require !== 'undefined' ? require('./catalogo_figuras.js') : null);
  }

  // Spec del catálogo (parciales/ángulos/radio) o null si la figura NO existe.
  function _spec(figura) {
    var c = _cat();
    return c ? c.get(figura) : null;
  }

  // ---------------------------------------------------------------------------
  // QUÉ SABE DIBUJAR EL EDITOR — POR REGLA, NO POR LISTA (TANDA 2 · T7.3)
  // ---------------------------------------------------------------------------
  // Los constructores de este módulo trazan exactamente cuatro formas:
  //   · RECTA            — 1 lado (101x).
  //   · CABEZAL con patas— 2 o 3 lados: L (A+B) o U (A+B+C), patas hacia el núcleo.
  //   · ESTRIBO cerrado  — marco perimetral con ganchos sísmicos (4 lados A–D).
  //   · TRABA            — vertical que cose las dos caras, gancho arriba/abajo.
  // Todo lo que no entra ahí NO se dibuja: se EXCLUYE con motivo en vez de
  // pintar una mentira (una 105x de 5 tramos dibujada como U es una figura que
  // no existe, y el usuario no tiene cómo darse cuenta).
  //
  // La regla se evalúa contra el catálogo VIGENTE (espejo estático o data fresca
  // del backend), así que una figura nueva se clasifica sola: no hay lista negra
  // escrita a mano que se pueda quedar vieja.
  //
  // TRAZADOR GENÉRICO DE CADENAS (12-ago) — QUINTA FORMA, ADITIVA. Lo que no entra
  // en las cuatro de arriba YA NO se excluye si se puede describir como una CADENA
  // de tramos rectos: `_cadenaGenerica` la traza en el MISMO plano de trabajo del
  // cabezal (ver _planoTrabajo). Los cuatro constructores especializados NO se
  // tocan: una 101x/102x/103x sigue saliendo del cabezal y un estribo del marco
  // con sus arcos calibrados. El genérico entra SOLO donde antes no había dibujo
  // fiel (5+ tramos, y las 4 lados que no son marco cerrado — la 104B del usuario,
  // que se dibujaba como estribo siendo una cadena abierta con quiebres de 45°).
  var MAX_LADOS_DIBUJABLES = 4;

  // Ángulo con que el catálogo describe el GANCHO SÍSMICO (el doblez del estribo).
  // Es el único ángulo compatible con un marco CERRADO: cualquier otro valor
  // listado (45° = quiebre/pata inclinada) describe una cadena que NO cierra.
  var ANG_GANCHO = 135;

  // ¿La figura es un PERÍMETRO CERRADO (lo que dibuja _estriboPerimetral: un marco
  // de 4 lados con sus dos ganchos)? Tres fuentes, en orden de autoridad:
  //   1. GEOMETRÍA DIBUJADA en el diseñador (spec.geometria.puntos): manda el
  //      dibujo — cierra si su polilínea vuelve al punto de partida. Es un dato
  //      independiente de las dims, así que se puede consultar sin conocerlas.
  //   2. CATÁLOGO: 4 lados A–D, sin radio, y con TODOS sus ángulos listados = 135
  //      (ganchos) o ninguno (rectángulo puro). Ese es el marco que el constructor
  //      de estribo sabe trazar: 104A/104D/104O/104P siguen entrando por acá.
  //      Un 45° en la lista (104B/104C/104H…) NO es un marco: es una cadena
  //      abierta con quiebres, y dibujarla como estribo era pintar una mentira.
  //   3. Sin catálogo cargado: criterio histórico (prefijo '104').
  function _esPerimetro(spec, figura) {
    if (!spec) return (figura || '').toUpperCase().indexOf('104') === 0;
    var geo = spec.geometria;
    if (geo && geo.puntos && geo.puntos.length >= 3) return _puntosCierran(geo.puntos);
    if (spec.radio) return false;
    if (spec.parciales.length !== MAX_LADOS_DIBUJABLES) return false;
    var A = spec.angulos || [];
    for (var i = 0; i < A.length; i++) if (Number(A[i]) !== ANG_GANCHO) return false;
    return true;
  }

  // ¿Una polilínea vuelve a su punto de partida? (tolerancia relativa al recorrido,
  // así vale igual en cm que en px de la grilla del diseñador).
  function _puntosCierran(pts) {
    if (!pts || pts.length < 4) return false;   // menos de 3 lados no cierra contorno
    var L = 0, i;
    for (i = 1; i < pts.length; i++) {
      L += Math.hypot(Number(pts[i].x) - Number(pts[i - 1].x), Number(pts[i].y) - Number(pts[i - 1].y));
    }
    if (!(L > 0)) return false;
    var d = Math.hypot(Number(pts[pts.length - 1].x) - Number(pts[0].x),
      Number(pts[pts.length - 1].y) - Number(pts[0].y));
    return d <= Math.max(1e-9, 1e-6 * L);
  }

  // dibujabilidad(figura) → { dibujable, familia, lados, motivo }
  //   familia: 'recta' | 'cabezal' | 'estribo' (la de DIBUJO por defecto; con un
  //   rol declarado manda familiaDeDibujo). motivo: por qué se excluye.
  function dibujabilidad(figura) {
    var f = (figura || '').toUpperCase();
    var spec = _spec(f);
    if (!spec) {
      return { dibujable: false, familia: null, lados: 0,
        motivo: 'no está en el catálogo de figuras' };
    }
    var n = spec.parciales.length;
    if (spec.radio) {
      return { dibujable: false, familia: null, lados: n,
        motivo: 'usa radio (hélice/espiral): el editor sólo traza tramos rectos con codos' };
    }
    if (n === 0) {
      return { dibujable: false, familia: null, lados: 0,
        motivo: 'sin parciales en el catálogo: no hay lados que dibujar' };
    }
    // FAMILIA POR DEFECTO (sin rol declarado). Las cuatro de siempre salen igual
    // que antes; 'cadena' es la quinta, y es la que amplía la dibujabilidad.
    var fam = familiaDeDibujo(f, null);
    if (fam === 'cadena') {
      // La cadena existe por construcción: familiaDeDibujo sólo devuelve 'cadena'
      // cuando hay tramos (dibujados o derivados). Lo que sí queda por decidir es
      // si esos tramos son TRAZABLES: un arco no lo es.
      var tr = tramosDeFigura(f);
      if (tr.arco) {
        return { dibujable: false, familia: null, lados: n,
          motivo: 'tiene tramos en ARCO: el trazador genérico sólo une tramos rectos' };
      }
      return { dibujable: true, familia: 'cadena', lados: n, motivo: null, fuente: tr.fuente };
    }
    if (n > MAX_LADOS_DIBUJABLES) {
      return { dibujable: false, familia: null, lados: n,
        motivo: n + ' tramos: el editor traza hasta ' + MAX_LADOS_DIBUJABLES +
          ' (recta, L, U y marco cerrado)' };
    }
    return { dibujable: true, lados: n, motivo: null, familia: fam };
  }

  // Lista negra viva. DOS FORMAS, misma verdad (la UI usa las dos):
  //   noDibujables()        → { codigo: motivo } de todo el catálogo cargado.
  //   noDibujables(codigo)  → motivo (string) o null si esa figura SÍ se dibuja.
  function noDibujables(codigo) {
    if (codigo != null && String(codigo).trim() !== '') {
      var d1 = dibujabilidad(codigo);
      return d1.dibujable ? null : d1.motivo;
    }
    var c = _cat(), out = {};
    if (!c) return out;
    c.codigos().forEach(function (cod) {
      var d = dibujabilidad(cod);
      if (!d.dibujable) out[cod] = d.motivo;
    });
    return out;
  }

  // ¿Un solo lado? (barra recta). Sin catálogo cae al criterio histórico '101x'.
  function _esRecta(figura) {
    var f = (figura || '').toUpperCase();
    var spec = _spec(f);
    return spec ? (spec.parciales.length === 1) : (f.indexOf('101') === 0);
  }

  // FAMILIA DE DIBUJO efectiva = qué constructor traza esta barra.
  // 1) El ROL de la tipología MANDA: un componente ES/EC se dibuja como marco
  //    cerrado y un TR* como traba, sea cual sea su figura (es la PIEZA la que
  //    define la forma de colocación, no el código de figura). Un rol 'cabezal'
  //    también manda: se traza como longitudinal aunque la figura sea de 4 lados
  //    (esa discordancia la AVISA generar.js — dibujar un marco a media altura
  //    de la viga sería peor que avisar).
  // 2) SIN rol declarado, lo dice la figura: perímetro de 4 lados → estribo;
  //    1 lado → recta; 2–3 lados → cabezal con patas (A y/o C).
  // 3) 4+ lados que NO son MARCO CERRADO → 'cadena' (trazador genérico). Incluye
  //    el caso con rol 'cabezal': una cadena SE TRAZA COMO LONGITUDINAL (vive en
  //    el mismo plano de trabajo), sólo que con TODOS sus lados en vez de los 3
  //    que traza el cabezal. Por eso el rol cabezal ya no fuerza el constructor de
  //    3 lados sobre una 104B: antes dibujaba una U y avisaba "D no se traza";
  //    ahora sale entera y el aviso desaparece porque ya no hay deuda.
  //    EXCEPCIÓN DELIBERADA — el MARCO CERRADO DE 4 LADOS (104A/104D/104O/104P…)
  //    NO pasa por el genérico ni siquiera con rol 'cabezal': ese marco ya tiene
  //    constructor propio y calibrado, y con rol cabezal el comportamiento
  //    histórico (traza 3 lados y AVISA del cuarto) se conserva tal cual. El
  //    trazador genérico entra sólo donde hoy no hay dibujo fiel, no a rebarajar
  //    lo que ya funciona.
  //
  // FIX 305A (TANDA P) — LA FIGURA MANDA EL TRAZADO. El rol 'estribo' YA NO fuerza
  // el marco cerrado a cualquier figura: sólo cuando la figura ES un marco (4 lados
  // cerrables, _esPerimetro). Una CADENA de 4+ lados que no cierra —la 305A de 5
  // tramos, la 104B con sus quiebres de 45°— colocada con tipología ES se dibujaba
  // como un rectángulo con ganchos: una figura que NO EXISTE, y sin un solo aviso.
  // Ahora se traza como cadena, EN EL PLANO DE LA SECCIÓN (⊥ al rumbo), que es el
  // plano de trabajo que le corresponde a una pieza de sección: el ROL sigue
  // mandando el anclaje, el reparto y el preset — sólo deja de mandar el TRAZO.
  // Las figuras de 1–3 lados con rol estribo (103E/103H = MURO-EC / VIGA-ES del
  // catálogo) conservan su ruta histórica: el constructor de marco es el que las
  // dibuja desde siempre y no hay cadena de 4+ que las reemplace.
  function familiaDeDibujo(figura, rol) {
    var f = (figura || '').toUpperCase();
    var spec = _spec(f);
    var n = spec ? spec.parciales.length : 0;
    var esMarco = _esPerimetro(spec, f) && (!spec || n === MAX_LADOS_DIBUJABLES);
    var esCadena = (n >= MAX_LADOS_DIBUJABLES) && !!tramosDeFigura(f);
    if (rol === 'estribo') {
      if (esMarco) return 'estribo';
      if (esCadena) return 'cadena';
      return 'estribo';
    }
    if (rol === 'traba') return 'traba';
    if (esMarco) return rol ? 'cabezal' : 'estribo';
    if (_esRecta(f)) return 'recta';
    if (esCadena) return 'cadena';
    return 'cabezal';
  }

  // ¿ES UNA PIEZA DE SECCIÓN? — CONCEPTO ÚNICO (TANDA P · defecto F1).
  // ---------------------------------------------------------------------------
  // Una pieza de sección es la que vive en el plano ⊥ al rumbo y ENCUADRA el marco
  // de núcleo: las tres que despacha `figuraAPuntos` a `_estriboPerimetral`,
  // `_traba` y `_cadenaSeccion`. Es EXACTAMENTE el criterio del despacho (ver el
  // `if (rol === 'estribo' || rol === 'traba')` de `_cadenaGenerica`), escrito una
  // sola vez para que nadie tenga que reconstruirlo.
  //
  // POR QUÉ HACE FALTA (defecto F1): reglas.js decidía el ANIDADO preguntando
  // «¿se dibuja como marco CERRADO?» (`_dibujaMarcoCerrado`). Esa pregunta separa
  // el estribo de la cadena, pero la que gobierna el anidado es OTRA: «¿esta pieza
  // encuadra la sección?». Con la primera, una CADENA de sección respondía "no" →
  // no anidaba → el k·gap entero se iba a la POSICIÓN y la pieza se TRASLADABA por
  // la normal: capa 3 de una 305A φ10 con gap 3 salía 2 cm fuera del hormigón,
  // dims idénticas en las tres capas y sin un solo aviso. Es la misma causa raíz
  // que N1/N1b (coordenadas de cabezal aplicadas a una pieza que encuadra la
  // sección), ahora en el eje de la NORMAL.
  //
  // La FORMA (marco / cadena / traba) sigue decidiendo CÓMO encoge cada una — eso
  // vive en `anidarFigura` —; lo que se unifica acá es el SI: una pieza de sección
  // anida SIEMPRE, nunca se traslada.
  function esPiezaDeSeccion(figura, rol) {
    if (rol !== 'estribo' && rol !== 'traba') return false;
    var fam = familiaDeDibujo(figura, rol);
    return fam === 'estribo' || fam === 'traba' || fam === 'cadena';
  }

  // ---------------------------------------------------------------------------
  // LADO DOMINANTE — CASCADA DETERMINISTA (TANDA P · decisión del usuario)
  // ---------------------------------------------------------------------------
  // El lado dominante es el que SE ESTIRA (auto-largo) y el que recibe el EMPALME;
  // los demás son patas/retornos que cuelgan de él. Se decide así, en este orden:
  //   1º spec.lado_dominante — lo que declare el catálogo (o geometria.lado_dominante,
  //      que es el campo que va a poblar el Diseñador de figuras);
  //   2º 'B' si la figura declara ese parcial (la convención del catálogo: A = pata
  //      inicial, C = pata final, B = CUERPO);
  //   3º el PRIMER parcial (figuras de un solo lado, o series que no usan B).
  //
  // EL "MÁS LARGO MEDIDO" DESAPARECE COMO CRITERIO. Dependía de las dims DEL
  // MOMENTO: la misma figura cambiaba de lado dominante al editar una pata, y con
  // él cambiaban la dim que el auto estira y la que recibe el empalme — sin que
  // nada en la pantalla lo explicara. Ahora el lado dominante es una propiedad de
  // la FIGURA, no de sus medidas: es estable, es el mismo en el motor, en la ficha
  // del componente y en el listado, y el catálogo puede sobreescribirlo por figura.
  function ladoDominanteFigura(figura) {
    var spec = _spec(figura);
    if (!spec) return null;
    var P = spec.parciales || [];
    var decl = spec.lado_dominante ||
      (spec.geometria && spec.geometria.lado_dominante) || null;
    if (decl) {
      var d = String(decl).toUpperCase().trim();
      if (P.indexOf(d) >= 0) return d;
    }
    if (!P.length) return null;
    return (P.indexOf('B') >= 0) ? 'B' : P[0];
  }

  // ¿Qué EXTREMOS llevan pata (gancho)? Convención del catálogo: A = pata del
  // extremo inicial, C = pata del final, B = cuerpo. Derivado de los parciales
  // REALES (101x no tiene ninguna; 102x sólo la inicial; 103x/104x las dos).
  // Lo consume la UI (control "Patas" y los Δ de extremo libre).
  function patasDeFigura(figura) {
    var spec = _spec(figura);
    var P = spec ? spec.parciales : [];
    if (P.length < 2) return { inicio: false, fin: false };
    return { inicio: P.indexOf('A') >= 0, fin: P.indexOf('C') >= 0 };
  }

  // Extensión libre del gancho tras el doblez (norma aprox): 6φ, mínimo ~7.5 cm.
  function extGancho(diamCm) { return Math.max(6 * diamCm, 7.5); }

  // ---------------------------------------------------------------------------
  // PLANO DE TRABAJO DE LA PIEZA — FUENTE ÚNICA DEL ANCLAJE LONGITUDINAL
  // ---------------------------------------------------------------------------
  // (u, v) → 3D del host:
  //   u = eje LONGITUDINAL del host (X).
  //   v = NORMAL DE LA CARA hacia el NÚCLEO: Y en caras sup/inf, Z en cara lateral
  //       (cortina), con el signo que publica reglas._marcoCara.
  // Es EXACTAMENTE el mapeo que _cabezalLongitudinal tenía adentro — extraído sin
  // cambiar un signo — para que el trazador genérico entre al MISMO plano con el
  // MISMO anclaje. Consecuencia buscada: una cadena y un cabezal se posan igual, y
  // toda la maquinaria de arriba (pilas por cara, capas, volteo/de_pie/spin,
  // rangos, anidado) los trata igual sin enterarse de que hay un constructor nuevo.
  // ESPEJO (TANDA P) — `anchor.espejo` invierte el eje U del plano de trabajo, o
  // sea el eje EN EL PLANO DE LA FIGURA que NO es la normal de la cara. Es la
  // reflexión que cambia la QUIRALIDAD de la pieza sin tocar ni una dim y sin
  // moverla de sitio (el trazado ya está centrado en u = 0):
  //   · cadena / cabezal con patas → su plano es (L, N) y U = L: la figura se
  //     espeja de punta a punta (la pata que estaba al inicio queda al final).
  //   · estribo / traba            → su plano es (N, B) y U = B: los ganchos
  //     cambian de esquina.
  // EN EL MARCO (L, N, B) esto ES el "flip de la binormal" del modelo de pose: las
  // dos descripciones (invertir L o invertir B) se diferencian en un giro de 180°
  // en torno a N, que la pose NO distingue (mismo cara/lado/rumbo). Se elige, en
  // cada familia, la que refleja el TRAZO: la figura de una cadena es PLANA en B,
  // así que reflejarla en B la dejaría idéntica — sería un control muerto.
  function _planoTrabajo(host, anchor) {
    var y = (anchor.y != null && isFinite(anchor.y)) ? Number(anchor.y) : 0;
    var z = (anchor.z != null && isFinite(anchor.z)) ? Number(anchor.z) : 0;
    var ejeC = (anchor.ejeCara === 'z') ? 'z' : 'y';        // normal de la cara
    var s = (anchor.sentidoCara === 1 || anchor.sentidoCara === -1)
      ? anchor.sentidoCara
      : ((anchor.cara === 'sup') ? -1 : 1);                 // doblez hacia el núcleo
    var mu = anchor.espejo ? -1 : 1;                        // espejo = flip del eje U
    return {
      ejeCara: ejeC, sentido: s, espejo: (mu < 0),
      P: function (u, v) {
        var uu = mu * u;
        return (ejeC === 'z') ? V(uu, y, z + s * v) : V(uu, y + s * v, z);
      }
    };
  }

  // Empalme resuelto POR EXTREMO (cm que asoman fuera del hormigón, en u).
  // Δ INDEPENDIENTE POR EXTREMO: `ini`/`fin` traen los dos valores YA resueltos
  // (reglas._empalmePorExtremo). No son lo mismo ni tienen por qué serlo — una
  // barra empalma 40φ contra la columna de un lado y asoma 15 cm del otro —, así
  // que el asome de cada punta se lee de SU número. El shape antiguo
  // {extremo, valor} sigue funcionando idéntico (fallback de abajo).
  function _empalmeDeAnchor(anchor) {
    var emp = (anchor && anchor.empalme) || null;
    var eIni = 0, eFin = 0;
    if (emp && (emp.ini != null || emp.fin != null)) {
      eIni = Number(emp.ini) || 0;
      eFin = Number(emp.fin) || 0;
    } else if (emp && emp.valor > 0) {
      if (emp.extremo === 'inicio') eIni = emp.valor;
      else if (emp.extremo === 'fin') eFin = emp.valor;
      else if (emp.extremo === 'ambos') { eIni = emp.valor; eFin = emp.valor; }
    }
    return { ini: eIni, fin: eFin };
  }

  // ===========================================================================
  // CADENAS: TRAMOS → POLILÍNEA (TRAZADOR GENÉRICO)
  // ===========================================================================
  // LA CONVENCIÓN NO SE INVENTA ACÁ. Es la MISMA que ya consume la plataforma en
  // 2D (disenador.js::geometriaAPuntos, que usan el Diseñador de figuras, el
  // catálogo, Bar Manager y Agregar Cubicación 2):
  //
  //   tramos = [{ lado:'A', giro:0, sentido:null }, { lado:'B', giro:90, sentido:'izq' }, …]
  //   · lado    → la letra cuya dimensión (dim_a..dim_i) da el LARGO del tramo.
  //   · giro    → grados que gira el rumbo ANTES de trazar ese tramo (0 = seguir recto).
  //   · sentido → 'izq' (+) | 'der' (−) — el SIGNO del giro.
  //   El primer tramo NO gira: define el eje de la figura.
  //
  // Trazar la cadena aquí con otra regla habría creado una convención paralela: la
  // misma figura se vería de una forma en la caluga del catálogo y de otra en el
  // modelador. Por eso este trazado es línea por línea el de geometriaAPuntos, y
  // el (x,y) de allá es el (u,v) del plano de trabajo de acá.
  function _largoLado(dims, lado, fallback) {
    var v = (dims && lado != null) ? Number(dims[lado]) : NaN;
    return (isFinite(v) && v > 0) ? v : fallback;
  }

  // Traza la cadena en el plano (u,v) local. Devuelve puntos + largo de cada tramo.
  function _cadena2D(tramos, dims, fallbackLargo) {
    var pts = [{ u: 0, v: 0 }], largos = [], heading = 0;
    for (var i = 0; i < tramos.length; i++) {
      var t = tramos[i];
      if (i > 0) {
        var g = Number(t.giro) || 0;
        if (t.sentido === 'der') g = -g;        // convención: izq = +, der = −
        heading += g;
      }
      var L = _largoLado(dims, t.lado, fallbackLargo);
      largos.push(L);
      var rad = heading * Math.PI / 180;
      var last = pts[pts.length - 1];
      pts.push({ u: last.u + L * Math.cos(rad), v: last.v + L * Math.sin(rad) });
    }
    return { pts: pts, largos: largos };
  }

  function _cadenaCierra(pts) {
    return _puntosCierran(pts.map(function (p) { return { x: p.u, y: p.v }; }));
  }

  // ---------------------------------------------------------------------------
  // DERIVACIÓN DE TRAMOS — para las figuras del SEED (geometría vacía)
  // ---------------------------------------------------------------------------
  // Las 63 figuras sembradas por catalogo.py no traen `geometria`: sólo parciales
  // y ángulos. La cadena se DERIVA de esos dos datos con la convención de las
  // familias conocidas (la que ya usan recta/cabezal/estribo):
  //
  //   1 lado  → recta.
  //   2 lados → L: el único doblez lleva el ángulo listado (o 90 si no hay).
  //   3 lados → U: los ángulos listados van en los DOS dobleces (los dos son
  //             extremos), 90 si no hay.
  //   4+      → cadena: los ángulos LISTADOS van en los dobleces EXTREMOS
  //             (ang1 en el primero, ang2 en el último) y los INTERMEDIOS son 90.
  //             Es la generalización directa del corchete: los quiebres del medio
  //             son de escuadra y los especiales están en las puntas (105x/106x
  //             del catálogo aSa).
  //   Todos los dobleces giran para el MISMO lado (cadena coherente, como la U).
  //
  // EL ÁNGULO DEL CATÁLOGO ES EL GIRO (cuánto se desvía la barra de seguir recta),
  // no el ángulo interno: es la misma lectura con la que _estriboPerimetral traza
  // el gancho sísmico de 135° de las 104D/103E/103H, y la que hace que un 45°
  // listado sea una pata inclinada (doblez a 45°). Si una figura del seed resulta
  // no ser así, la salida NO es tocar esta regla: es DIBUJARLA en el Diseñador de
  // figuras — su `geometria` manda sobre la derivación (ver tramosDeFigura).
  function derivarTramos(figura) {
    var spec = _spec(figura);
    if (!spec) return null;
    var P = spec.parciales || [];
    if (!P.length) return null;
    var A = (spec.angulos || []).map(Number).filter(isFinite);
    var n = P.length, dobleces = n - 1, i;
    var giros = [];
    for (i = 0; i < dobleces; i++) giros.push(90);
    if (dobleces >= 1 && A.length >= 1) giros[0] = A[0];                      // extremo inicial
    if (dobleces >= 2 && A.length >= 2) giros[dobleces - 1] = A[1];           // extremo final
    // 3+ ángulos listados (ninguna figura del seed llega): se van colocando hacia
    // adentro desde el segundo doblez, en orden, sin pisar el extremo final.
    for (i = 2; i < A.length && (i - 1) < dobleces - 1; i++) giros[i - 1] = A[i];
    var tramos = [{ lado: P[0], giro: 0, sentido: null }];
    for (i = 1; i < n; i++) tramos.push({ lado: P[i], giro: giros[i - 1], sentido: 'izq' });
    return tramos;
  }

  // TRAMOS EFECTIVOS de una figura, con la PRIORIDAD DE FUENTES del diseño:
  //   1. `geometria.tramos` DIBUJADA en el Diseñador de figuras (llega por
  //      GET /figuras-catalogo → catalogo.actualizar): manda siempre, es lo que el
  //      usuario dibujó y lo que ya se ve en 2D en el catálogo y en Cubicación.
  //   2. DERIVACIÓN desde parciales + ángulos (las 63 del seed, sin geometría).
  //   3. null → la figura se EXCLUYE con motivo (dibujabilidad), no se aproxima.
  // Devuelve { tramos, fuente:'disenador'|'derivado', arco:bool }.
  function tramosDeFigura(figura) {
    var spec = _spec(figura);
    if (!spec) return null;
    var geo = spec.geometria;
    var t = (geo && geo.tramos && geo.tramos.length) ? geo.tramos : null;
    var fuente = 'disenador';
    if (!t) { t = derivarTramos(figura); fuente = 'derivado'; }
    if (!t || !t.length) return null;
    var arco = false;
    for (var i = 0; i < t.length; i++) {
      if (t[i] && (t[i].tipo === 'arco' || Number(t[i].radio) > 0)) { arco = true; break; }
    }
    return { tramos: t, fuente: fuente, arco: arco };
  }

  // Dims NUMÉRICAS de un mapa que puede venir resuelto ({A:30}) o sin resolver
  // ({A:{modo:'auto'}}): sólo pasan los números > 0.
  function _dimsNumericas(dims) {
    var out = {}, k, v;
    for (k in dims) {
      if (!Object.prototype.hasOwnProperty.call(dims, k)) continue;
      v = Number(dims[k]);
      if (isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // NORMALIZACIÓN: la cadena trazada → POSE en el plano de trabajo
  // ---------------------------------------------------------------------------
  // La cadena se traza en su propio sistema (arranca en el origen hacia +u). Para
  // que se pose como cualquier otra barra hay que decidir tres cosas, y las tres
  // salen de lo que YA hacen los constructores especializados:
  //   · QUÉ LADO va a lo largo de la pieza → el de MAYOR dimensión resuelta (en un
  //     cabezal es B, el tramo largo; en una recta es su único lado). Se rota la
  //     cadena para dejarlo sobre +u.
  //   · HACIA DÓNDE dobla → hacia el NÚCLEO (+v), igual que las patas del gancho:
  //     si la cadena quedó doblando hacia afuera se espeja sobre su lado
  //     longitudinal (la figura es la misma, colocada por el otro lado).
  //   · DÓNDE queda en u → el lado longitudinal CENTRADO, con el excedente de
  //     empalme asomando por el extremo que corresponda (idéntico al cabezal).
  // Una cadena CERRADA no se empalma ni se estira (como el estribo): su largo lo
  // fija el contorno.
  // ORIENTACIÓN de la cadena en su plano: deja el LADO DOMINANTE sobre +u y la
  // figura doblando hacia +v (el núcleo). Fuente ÚNICA para las dos poses de una
  // cadena (la longitudinal del cabezal y la de SECCIÓN del estribo).
  //
  // EL LADO QUE VA A LO LARGO ES EL DOMINANTE, NO EL MÁS LARGO (TANDA P): tiene que
  // ser EL MISMO que el que el auto-largo estira y el que recibe el empalme
  // (reglas._ladoLongitudinal → ladoLongitudinalCadena), o el dibujo pone a lo largo
  // de la pieza un lado distinto del que se está midiendo contra el hormigón.
  function _orientarCadena(c, tramos, ladoL) {
    var pts = c.pts, largos = c.largos, i;
    var iL = -1;
    if (ladoL && tramos) {
      for (i = 0; i < tramos.length && i < largos.length; i++) {
        if (tramos[i] && tramos[i].lado === ladoL) { iL = i; break; }
      }
    }
    if (iL < 0) {                       // sin lado dominante utilizable: el mayor
      iL = 0;
      for (i = 1; i < largos.length; i++) if (largos[i] > largos[iL] + 1e-9) iL = i;
    }
    var a = pts[iL], b = pts[iL + 1];
    var ang = Math.atan2(b.v - a.v, b.u - a.u);
    var co = Math.cos(-ang), si = Math.sin(-ang);
    var out = pts.map(function (p) {
      var du = p.u - a.u, dv = p.v - a.v;
      return { u: du * co - dv * si, v: du * si + dv * co };
    });
    var sv = 0;
    for (i = 0; i < out.length; i++) sv += out[i].v;
    if (sv < -1e-9) for (i = 0; i < out.length; i++) out[i].v = -out[i].v;
    return { pts: out, iLong: iL };
  }

  function _normalizarCadena(c, anchor, tramos, ladoL) {
    var i;
    var or = _orientarCadena(c, tramos, ladoL);
    var out = or.pts, iL = or.iLong;
    var cerrada = _cadenaCierra(out);
    var emp = cerrada ? { ini: 0, fin: 0 } : _empalmeDeAnchor(anchor);
    // CENTRADO POR BBOX, no por el tramo longitudinal: con puntas inclinadas los
    // SOBRES son asimétricos y centrar B dejaba la cadena corrida (la reserva del
    // auto-largo cerraba el ancho total pero el conjunto asomaba ini/2 por un
    // lado — la fuga residual del hallazgo del verificador). El empalme sigue
    // sesgando el conjunto hacia su extremo, como en el cabezal.
    var minU = Infinity, maxU = -Infinity;
    for (i = 0; i < out.length; i++) {
      if (out[i].u < minU) minU = out[i].u;
      if (out[i].u > maxU) maxU = out[i].u;
    }
    var anchoTotal = (maxU - minU) - emp.ini - emp.fin;
    var u0 = -anchoTotal / 2 - emp.ini - minU;  // el BBOX (sin empalmes) queda centrado
    for (i = 0; i < out.length; i++) out[i].u += u0;
    return { pts: out, cerrada: cerrada, iLong: iL, lado: null };
  }

  // ---- CADENA GENÉRICA: cualquier figura descrita por tramos rectos ----------
  // Produce puntos como cualquier otro constructor (misma firma, mismo plano,
  // mismas coordenadas de host) → pilas / capas / anidado / volteo / de_pie /
  // spin / rangos funcionan sin tocar nada de esa maquinaria.
  function _cadenaGenerica(figura, dims, host, anchor, diamCm, rol) {
    var tr = tramosDeFigura(figura);
    // Sin tramos no hay cadena: red de seguridad (dibujabilidad ya la excluyó),
    // nunca un dibujo inventado.
    if (!tr) return _cabezalLongitudinal(figura, dims, host, anchor, diamCm);
    // Un lado sin dimensión toma la extensión de gancho normativa (6φ, mín 7.5),
    // la MISMA que usa reglas.js para las patas en 'auto'.
    var c = _cadena2D(tr.tramos, dims, extGancho(diamCm));
    var ladoL = ladoDominanteFigura(figura);
    // PLANO DE TRABAJO SEGÚN EL ROL (fix 305A): una pieza de SECCIÓN (estribo /
    // traba) vive en el plano ⊥ al rumbo, no en el longitudinal. Es el mismo plano
    // (y,z) del marco de núcleo que ya usan _estriboPerimetral y _traba: la cadena
    // entra ahí sin inventar un sistema nuevo.
    if (rol === 'estribo' || rol === 'traba') {
      return _cadenaSeccion(c, host, anchor, diamCm);
    }
    var pw = _planoTrabajo(host, anchor);
    var nrm = _normalizarCadena(c, anchor, tr.tramos, ladoL);
    return nrm.pts.map(function (p) { return pw.P(p.u, p.v); });
  }

  // ---- CADENA EN LA SECCIÓN (rol estribo/traba) ------------------------------
  // La cadena se traza en el plano de la SECCIÓN del marco local — u = z (ancho),
  // v = y (alto) — a la x del anchor, y su bbox queda CENTRADO en el marco de
  // núcleo (el mismo que encuadran el estribo y la traba: recub + φ/2 + pilas).
  //
  // FRAME NATIVO — ACÁ NO SE LLAMA A _orientarCadena (fix del verificador · D1).
  // _orientarCadena existe para el plano LONGITUDINAL, donde hay UN eje con
  // significado (el largo del host) y hay que dejarle encima el lado que el
  // auto-largo estira y que recibe el empalme (el DOMINANTE). En la SECCIÓN hay
  // DOS ejes con significado —ancho y alto— y ninguno es "el longitudinal": girar
  // la cadena para poner el dominante sobre +u TRANSPONÍA la figura. El síntoma
  // medido: una 305A/105A con todo en 'auto' en viga 600×60×30 resolvía B = alto
  // útil = 52 y lo dibujaba contra el ANCHO (30) → 11 cm de fierro fuera del
  // hormigón; una 104B, 19.5 cm.
  //
  // El frame nativo de la cadena YA ES el del la sección: `_cadena2D` arranca en
  // el origen con el primer tramo hacia +u y gira desde ahí, o sea la MISMA
  // lectura con la que el catálogo dibuja la figura en 2D y con la que
  // `ejesCadenaSeccion` le dice a reglas.js contra qué mide cada lado (u = ancho,
  // v = alto). Una sola convención para MEDIR y para DIBUJAR: si se separan,
  // vuelven a divergir.
  //
  // Si con dims fijas la figura no cabe en su marco, asoma — dato honesto y
  // visible, sin clamps.
  // El ESPEJO invierte u (los ganchos cambian de esquina): mismo criterio que el
  // plano de trabajo longitudinal (ver _planoTrabajo) y que `_estriboPerimetral`.
  //
  // anchor.y / anchor.z SON COORDENADAS ABSOLUTAS DEL HOST (regresión N1). Una
  // versión anterior de esta función las sumaba como DESPLAZAMIENTOS respecto del
  // centro del marco, y eso es doble conteo: quien las escribe (reglas._marcoCara →
  // distribuidorLayered, el eje de un rango, distribuidorPoints) pone la coordenada
  // del host, no un delta. Medido: una 305A φ10 en la viga 600×60×30 con
  // distribución 'layered' recibía y = 25.5 (el ancla de la cara superior) y salía
  // dibujada en y ∈ [−0.5, 51.5] — 21.5 cm de fierro FUERA de una viga que llega a
  // y = 30. Con 'linear' el anchor no trae y/z, valen 0 y el bug era invisible.
  //
  // La convención es la MISMA que ya usan los otros dos constructores de sección —
  // la única que hay en el módulo:
  //   · `_traba`              → `zz = anchor.z`, la coordenada donde va la traba;
  //   · `_estriboPerimetral`  → sin y/z propios: su lugar lo fija el marco de núcleo.
  // O sea: si el anchor trae la coordenada, ESA es la posición del centro de la
  // pieza; si no la trae, la pieza se centra en su marco (la pose natural). Nada se
  // suma dos veces y un reparto real (rango en y/z, capas de un arreglo, points)
  // sigue moviendo la pieza, porque llega como coordenada y se respeta tal cual.
  function _cadenaSeccion(c, host, anchor, diamCm) {
    var m = _marcoNucleo(host, anchor, diamCm);
    var pts = c.pts, i;
    var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (i = 0; i < pts.length; i++) {
      if (pts[i].u < minU) minU = pts[i].u;
      if (pts[i].u > maxU) maxU = pts[i].u;
      if (pts[i].v < minV) minV = pts[i].v;
      if (pts[i].v > maxV) maxV = pts[i].v;
    }
    var cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
    var yc = (m.ySup + m.yInf) / 2;                 // centro del marco (no es 0: las
    var xx = (anchor && anchor.x) || 0;             // pilas sup/inf son independientes)
    var mu = (anchor && anchor.espejo) ? -1 : 1;
    // POSE NATURAL = centrada en el marco de núcleo (y = su centro · z = 0, que es
    // su centro por construcción: w2 es un semiancho). El anchor la SUSTITUYE, no la
    // corre.
    var cy = (anchor && anchor.y != null && isFinite(anchor.y)) ? Number(anchor.y) : yc;
    var cz = (anchor && anchor.z != null && isFinite(anchor.z)) ? Number(anchor.z) : 0;
    return pts.map(function (p) {
      return V(xx, cy + (p.v - cv), cz + mu * (p.u - cu));
    });
  }

  // EJES DE LOS LADOS DE UNA CADENA DE SECCIÓN — contra qué mide cada lado.
  // ---------------------------------------------------------------------------
  // Una pieza de sección se dibuja en el plano (u = ancho, v = alto) del marco de
  // núcleo. Cada tramo corre en una dirección FIJA de ese plano, que sale de los
  // giros de la figura (no de sus medidas): con ella se sabe contra qué mide.
  //   'u' → el tramo es HORIZONTAL en la sección  → su 'auto' es el ANCHO útil.
  //   'v' → el tramo es VERTICAL                  → su 'auto' es el ALTO útil.
  //   'd' → DIAGONAL: no mide ni el ancho ni el alto (es una pata/quiebre) → su
  //         'auto' es la extensión de gancho normativa, la misma de las patas del
  //         cabezal.
  //
  // POR QUÉ EXISTE (fix del verificador · D1): reglas.js repartía el 'auto' POR
  // LETRA (A/C = ancho, el resto = alto). Esa es la lectura del RECTÁNGULO de 4
  // lados y sólo coincide con el dibujo por casualidad. En una 305A de 5 tramos la
  // letra E caía en "el resto" y se resolvía al ALTO (52) siendo un tramo
  // HORIZONTAL: la figura salía 52 de ancho en una viga de 30. Medir y dibujar
  // tienen que leer la MISMA cosa, y esa cosa es el TRAZO.
  //
  // Devuelve null cuando la figura NO se dibuja como cadena con ese rol (un marco
  // 104D con rol estribo lo traza `_estriboPerimetral`, cuyo rectángulo SÍ es
  // A/C = ancho, B/D = alto): ahí la regla por letra es la correcta y sigue.
  function ejesCadenaSeccion(figura, rol) {
    var f = (figura || '').toUpperCase();
    if (familiaDeDibujo(f, rol || 'estribo') !== 'cadena') return null;
    var tr = tramosDeFigura(f);
    if (!tr) return null;
    var heading = 0, out = {}, i, t, g, a;
    for (i = 0; i < tr.tramos.length; i++) {
      t = tr.tramos[i];
      if (i > 0) {
        g = Number(t.giro) || 0;
        if (t.sentido === 'der') g = -g;      // misma convención que _cadena2D
        heading += g;
      }
      a = ((heading % 180) + 180) % 180;       // dirección, sin sentido (0..180)
      if (t.lado != null && out[t.lado] == null) {
        out[t.lado] = (Math.abs(a) < 1e-6 || Math.abs(a - 180) < 1e-6) ? 'u'
          : ((Math.abs(a - 90) < 1e-6) ? 'v' : 'd');
      }
    }
    return out;
  }

  // AUTO de una cadena de SECCIÓN: cuánto tiene que medir cada lado 'auto' para
  // que la figura ENTERA quepa en el marco útil. Es la contraparte, en el plano de
  // la sección, de lo que `sobresCadena` hace en el longitudinal: allá el
  // auto-largo RESERVA la proyección de las puntas inclinadas sobre el eje de la
  // pieza; acá se reserva la de los QUIEBRES sobre cada eje de la sección.
  // Sin esto una 104B resolvía sus DOS tramos horizontales al ancho útil completo
  // (24) y el quiebre de 45° asomaba 5.3 cm más: la figura se metía 2.65 cm en el
  // recubrimiento por lado — la misma fuga que el hallazgo de la Tanda F, en el
  // otro eje.
  //
  // CÓMO SE RESUELVE (y por qué NO con una recta de dos puntos — regresión N2).
  // Todos los lados 'auto' de un eje valen lo MISMO (t), y el rumbo de cada tramo
  // sale de los GIROS (no de las medidas), así que CADA PUNTO del trazo es AFÍN en
  // t:  c_k(t) = a_k + b_k·t,  con a_k = c_k(0) y b_k = c_k(1) − c_k(0).
  // Pero la EXTENSIÓN no es afín: extent(t) = máx_k c_k(t) − mín_k c_k(t) es un
  // máximo de rectas menos un mínimo de rectas — lineal A TROZOS y convexa. El
  // punto que fija cada extremo del bbox CAMBIA con t (una diagonal manda mientras
  // el lado auto es corto, y el lado auto manda después), y ahí la recta que pasa
  // por t = 0 y t = 1 deja de valer: medido con útil {u:24, v:52}, la 104C resolvía
  // u = 24 y dibujaba 29.30, la 105I dibujaba 42.70, la 106A 48.00 (el doble), y la
  // 105C fallaba también en v (resolvía 52, dibujaba 57.30). 16 de las 36 cadenas de
  // sección del catálogo rompían el marco útil por esta causa.
  //
  // Se resuelve EXACTO, sin muestreo ni iteración: "la figura cabe" es
  //     c_i(t) − c_j(t) ≤ útil   para TODO par (i, j)
  // o sea (b_i − b_j)·t ≤ útil − (a_i − a_j). Los pares con b_i > b_j son COTAS
  // SUPERIORES de t y el resultado es la más chica: el mayor t cuyo trazo entero
  // cabe en el marco. Con todos los b iguales no hay lados auto en ese eje (nadie
  // pregunta por su valor) → se devuelve el útil, como antes.
  // Si ni con t = 0 cabe (dims 'fija' que no entran en el marco), la cota sale
  // negativa y se devuelve negativa: la figura NO cabe y tiene que VERSE — el mismo
  // criterio que el resto del módulo (nada de clamps que escondan una receta
  // imposible; el backend además rechaza la dim).
  //   dimsBase = lados YA resueltos (los 'fija' y las diagonales, que son patas).
  //   ejes     = salida de ejesCadenaSeccion   ·   util = { u: ancho, v: alto }.
  function autosCadenaSeccion(figura, dimsBase, ejes, util) {
    var tr = tramosDeFigura((figura || '').toUpperCase());
    if (!tr || !ejes) return { u: util.u, v: util.v };
    // Coordenadas del trazo sobre `eje` con TODOS los lados auto de ese eje en t.
    // Los del otro eje quedan en 0: corren perpendicular y no mueven esta cuenta
    // (las diagonales, que sí mueven las dos, vienen resueltas en dimsBase).
    function coords(eje, t) {
      var d = {}, k;
      for (k in dimsBase) {
        if (Object.prototype.hasOwnProperty.call(dimsBase, k)) d[k] = dimsBase[k];
      }
      for (k in ejes) {
        if (Object.prototype.hasOwnProperty.call(ejes, k) && ejes[k] === eje && d[k] == null) d[k] = t;
      }
      var c = _cadena2D(tr.tramos, d, 0), out = [], i;
      for (i = 0; i < c.pts.length; i++) out.push((eje === 'u') ? c.pts[i].u : c.pts[i].v);
      return out;
    }
    function resolver(eje, ut) {
      var a = coords(eje, 0), c1 = coords(eje, 1), b = [], i;
      for (i = 0; i < a.length; i++) b.push(c1[i] - a[i]);
      var iv = _intervaloCabe(a, b, ut);
      // Sin cota superior no hay lados auto en ese eje (nadie pregunta por su
      // valor) → se devuelve el útil, como antes.
      return iv.acotaSup ? iv.hi : ut;
    }
    return { u: resolver('u', util.u), v: resolver('v', util.v) };
  }

  // INTERVALO EXACTO de un parámetro AFÍN que hace CABER un trazo — la cuenta que
  // comparten el 'auto' de la cadena de sección y su ANIDADO (defecto F1).
  // ---------------------------------------------------------------------------
  // Si cada punto del trazo es afín en un parámetro p —c_k(p) = a_k + b_k·p, que es
  // el caso siempre que los rumbos salgan de los GIROS y no de las medidas—,
  // entonces «el trazo cabe en `objetivo`» es
  //     c_i(p) − c_j(p) ≤ objetivo   para TODO par (i, j)
  // o sea (b_i − b_j)·p ≤ objetivo − (a_i − a_j): una SEMIRRECTA por par. La
  // intersección de semirrectas en 1D es un INTERVALO [lo, hi], y en sus dos
  // extremos la extensión vale EXACTAMENTE `objetivo` (el par que manda queda
  // tenso). Nada de muestreo ni iteración: los dos usos leen el extremo que les
  // toca.
  //   · el 'auto' quiere el trazo MÁS GRANDE que cabe   → hi (cota superior);
  //   · el anidado quiere el RETIRO MÍNIMO que lo hace  → lo (cota inferior).
  // acotaSup / acotaInf dicen si ese extremo existe: sin pares que lo acoten, el
  // parámetro NO mueve la extensión en ese eje (p.ej. un eje en el que la cadena
  // sólo tiene diagonales) y el llamador decide qué significa eso.
  function _intervaloCabe(a, b, objetivo) {
    var lo = -Infinity, hi = Infinity, acotaSup = false, acotaInf = false, i, j, db, c;
    for (i = 0; i < a.length; i++) {
      for (j = 0; j < a.length; j++) {
        db = b[i] - b[j];
        if (db > 1e-9) {
          acotaSup = true;
          c = (objetivo - (a[i] - a[j])) / db;
          if (c < hi) hi = c;
        } else if (db < -1e-9) {
          acotaInf = true;
          c = (objetivo - (a[i] - a[j])) / db;   // db < 0 → la desigualdad se da vuelta
          if (c > lo) lo = c;
        }
      }
    }
    return { lo: lo, hi: hi, acotaSup: acotaSup, acotaInf: acotaInf };
  }

  // ANIDADO DE UNA CADENA DE SECCIÓN — cuánto se ACORTA cada lado para que la
  // figura entre δ por lado (defecto F1).
  // ---------------------------------------------------------------------------
  // Anidar una pieza de sección es meterla en un marco de núcleo δ más chico por
  // lado. En el marco cerrado eso ya está resuelto y es trivial: sus esquinas son
  // de 90°, así que cada lado se acorta 2δ y el anillo queda concéntrico. En una
  // CADENA no: sus lados se cortan a 45°, hay diagonales que son PATAS (no miden
  // el marco) y hay puntas libres, así que «−2δ por lado encajonado» —el criterio
  // topológico de la figura ABIERTA— NO produce un anillo concéntrico. Medido
  // sobre las 36 cadenas del catálogo: las 36 fallaban, la extensión encogía 0,
  // 4.24 u 8.49 en vez de 6 y en 8 figuras (105A/105D/105E/305A…) CRECÍA 6 cm.
  //
  // LO QUE SÍ ES EL ANIDADO, con una sola regla: los lados que MIDEN un eje de la
  // sección ('u' = ancho, 'v' = alto) se retiran TODOS lo mismo —igual que los
  // cuatro lados del anillo— y las DIAGONALES (patas/ganchos, eje 'd') quedan
  // intactas, porque su largo es normativo y no mide el marco. Cuánto es ese
  // retiro no se supone: se RESUELVE, con la misma cuenta exacta del 'auto'
  // (_intervaloCabe), pidiendo que la extensión del trazo baje EXACTAMENTE 2δ.
  // Sobre un rectángulo de 4 lados la cuenta devuelve retiro = 2δ, o sea el
  // criterio del anillo es su caso particular: una sola regla, dos familias.
  //
  // Si un eje no tiene lados que lo midan (todo diagonales), su retiro es 0: esa
  // figura no puede encoger ahí. No es un clamp — la pieza sigue centrada en su
  // marco y se ve tal cual; lo que no se hace es inventarle un encogimiento.
  // Devuelve null si la figura no es una cadena de sección.
  function insetCadenaSeccion(figura, dims, delta, rol) {
    var f = (figura || '').toUpperCase();
    var tr = tramosDeFigura(f);
    var ejes = ejesCadenaSeccion(f, rol || 'estribo');
    if (!tr || !ejes) return null;
    var d = Number(delta) || 0, k;
    // Coordenadas del trazo sobre `eje` con TODOS sus lados retirados `s`.
    function coords(eje, s) {
      var dd = {}, kk;
      for (kk in dims) if (Object.prototype.hasOwnProperty.call(dims, kk)) dd[kk] = dims[kk];
      for (kk in ejes) {
        if (Object.prototype.hasOwnProperty.call(ejes, kk) && ejes[kk] === eje) {
          dd[kk] = Number(dims[kk]) - s;
        }
      }
      var c = _cadena2D(tr.tramos, dd, 0), out = [], i;
      for (i = 0; i < c.pts.length; i++) out.push((eje === 'u') ? c.pts[i].u : c.pts[i].v);
      return out;
    }
    function retiro(eje) {
      var a = coords(eje, 0), c1 = coords(eje, 1), b = [], i;
      var mx = -Infinity, mn = Infinity;
      for (i = 0; i < a.length; i++) {
        b.push(c1[i] - a[i]);
        if (a[i] > mx) mx = a[i];
        if (a[i] < mn) mn = a[i];
      }
      var iv = _intervaloCabe(a, b, (mx - mn) - 2 * d);
      // Sin cota inferior el retiro no achica este eje (sólo diagonales); y si el
      // intervalo es vacío, la extensión pedida no la alcanza NINGÚN retiro.
      if (!iv.acotaInf || !(iv.lo > 0) || iv.lo > iv.hi + 1e-9) return 0;
      return iv.lo;
    }
    var s = { u: retiro('u'), v: retiro('v') };
    var nd = {}, cabe = true, motivo = null;
    for (k in dims) if (Object.prototype.hasOwnProperty.call(dims, k)) nd[k] = dims[k];
    for (k in ejes) {
      if (!Object.prototype.hasOwnProperty.call(ejes, k)) continue;
      if (ejes[k] !== 'u' && ejes[k] !== 'v') continue;
      var nuevo = Number(dims[k]) - s[ejes[k]];
      nd[k] = nuevo;
      // SIN CLAMP (mismo criterio que la cerrada): si el retiro deja el lado en
      // cero o negativo, esa capa NO EXISTE y el llamador la omite con aviso.
      if (!(nuevo > 0) && cabe) {
        cabe = false;
        motivo = 'dim ' + k + ' = ' + (Math.round(nuevo * 100) / 100);
      }
    }
    return { dims: nd, retiro: s, cabe: cabe, motivo: motivo };
  }

  // EXTENSIÓN de una cadena de SECCIÓN en su propio plano, con las dims YA
  // resueltas: { u: ancho que ocupa, v: alto que ocupa }, en cm de eje a eje.
  // Es EL MISMO trazo que dibuja `_cadenaSeccion` (misma función, mismas dims,
  // mismo fallback de gancho), así que quien tenga que reservarle sitio mide lo que
  // se va a dibujar y no una aproximación. Lo consume el reparto de reglas.js: una
  // capa reparte EJES de barra sobre un rango que ya viene descontado el φ/2 de la
  // barra, y una cadena de sección no es un punto en ese eje — ocupa `u`.
  function extensionCadenaSeccion(figura, dims, diamCm) {
    var tr = tramosDeFigura((figura || '').toUpperCase());
    if (!tr) return null;
    var c = _cadena2D(tr.tramos, dims, extGancho(diamCm));
    var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, i;
    for (i = 0; i < c.pts.length; i++) {
      if (c.pts[i].u < minU) minU = c.pts[i].u;
      if (c.pts[i].u > maxU) maxU = c.pts[i].u;
      if (c.pts[i].v < minV) minV = c.pts[i].v;
      if (c.pts[i].v > maxV) maxV = c.pts[i].v;
    }
    return { u: maxU - minU, v: maxV - minV };
  }

  // LADO LONGITUDINAL de una cadena (el que corre a lo largo de la pieza y por lo
  // tanto recibe el auto-largo y el empalme). Contrato de 3 valores:
  //   undefined → la figura NO es cadena: que el llamador use su regla de siempre.
  //   null      → cadena CERRADA: no hay lado que estirar (como el estribo).
  //   'A'…'I'   → el LADO DOMINANTE de la figura (ladoDominanteFigura).
  //
  // CAMBIO TANDA P: antes devolvía el lado de MAYOR dimensión RESUELTA. Ese
  // criterio dependía de las dims del momento — editar una pata podía cambiar cuál
  // lado se estira con el auto y cuál recibe el empalme, en silencio. Ahora manda
  // la cascada determinista de la FIGURA (catálogo → 'B' → primer parcial).
  // Lo único que sigue dependiendo de las dims es si la cadena CIERRA (topología).
  function ladoLongitudinalCadena(figura, dims) {
    var f = (figura || '').toUpperCase();
    var spec = _spec(f);
    if (!spec || familiaDeDibujo(f, null) !== 'cadena') return undefined;
    var tr = tramosDeFigura(f);
    if (!tr) return undefined;
    // Con dims sin resolver el trazado es TOPOLÓGICO (todos los lados = 1): sirve
    // igual para saber si la cadena cierra, que es lo único que se decide sin dims.
    var c = _cadena2D(tr.tramos, _dimsNumericas(dims), 1);
    if (_cadenaCierra(c.pts)) return null;
    return ladoDominanteFigura(f);
  }

  // SOBRES de una cadena: cuánto ASOMAN los extremos MÁS ALLÁ del lado
  // longitudinal, medidos sobre el propio eje longitudinal (proyección
  // horizontal de las puntas inclinadas). Es lo que el auto-largo debe
  // RESERVAR — hallazgo del verificador de la Tanda F: 19 de las 36 cadenas
  // del catálogo (primer doblez ≠ 90°) salían del hormigón EXACTAMENTE
  // pata·cos(45°) − recub por lado, porque el auto resolvía el longitudinal a
  // la luz libre completa y lo centraba sin descontar esas proyecciones (el
  // cabezal de 90° nunca lo sufrió: su proyección horizontal es 0).
  // Devuelve { ini, fin } en cm (0/0 si no es cadena abierta con longitudinal).
  function sobresCadena(figura, dims, ladoLPref) {
    var f = (figura || '').toUpperCase();
    if (familiaDeDibujo(f, null) !== 'cadena') return { ini: 0, fin: 0 };
    var tr = tramosDeFigura(f);
    if (!tr) return { ini: 0, fin: 0 };
    // ladoLPref: el llamador (reglas) YA sabe cuál es el longitudinal — con las
    // dims a medio resolver, recalcularlo aquí elegiría una pata por ser "la
    // mayor resuelta".
    var ladoL = (ladoLPref !== undefined) ? ladoLPref : ladoLongitudinalCadena(f, dims);
    if (ladoL == null) return { ini: 0, fin: 0 };      // cerrada → sin auto-largo
    var num = _dimsNumericas(dims);
    num[ladoL] = 1000;                                  // placeholder: los sobres no dependen de él
    var c = _cadena2D(tr.tramos, num, 10);
    var iL = -1;
    for (var i = 0; i < tr.tramos.length; i++) {
      if (tr.tramos[i].lado === ladoL) { iL = i; break; }
    }
    if (iL < 0) return { ini: 0, fin: 0 };
    // marco girado: el longitudinal corre en +u
    var a = c.pts[iL], b = c.pts[iL + 1];
    var ang = Math.atan2(b.v - a.v, b.u - a.u);
    var cos = Math.cos(-ang), sin = Math.sin(-ang);
    function ux(p) { return (p.u - a.u) * cos - (p.v - a.v) * sin; }
    var minU = 0, maxU = ux(b);
    for (var k = 0; k < c.pts.length; k++) {
      var u = ux(c.pts[k]);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
    }
    return { ini: Math.max(0, -minU), fin: Math.max(0, maxU - ux(b)) };
  }

  // Radiografía de la cadena de una figura (para tests, avisos y la UI):
  // { fuente, tramos, giros, cerrada, ladoLong }.
  function cadenaInfo(figura, dims) {
    var tr = tramosDeFigura(figura);
    if (!tr) return null;
    var c = _cadena2D(tr.tramos, _dimsNumericas(dims), 1);
    return {
      fuente: tr.fuente, arco: tr.arco, tramos: tr.tramos,
      giros: tr.tramos.map(function (t) { return Number(t.giro) || 0; }),
      cerrada: _cadenaCierra(c.pts),
      ladoLong: ladoLongitudinalCadena(figura, dims)
    };
  }

  // ---- CABEZAL / longitudinal: barra a lo largo de X, con ganchos en extremos.
  // host: {largo, alto, ancho}. anchor: {cara:'sup'|'inf'|'lateral', y, z,
  // recubExtremo, ejeCara, sentidoCara}.
  // dims: {A, B, C} de la figura (A,C = patas del gancho; B = tramo largo). Si la
  // figura no usa gancho (101A = solo A recto) se dibuja recta.
  // CONVENCIÓN DE ANCHOR (la misma que _estriboPerimetral/_traba usan para `x`):
  // un eje ausente en el anchor = CENTRO del host en ese eje. Antes y/z se leían
  // crudos y un anchor sin `y` producía puntos con y:undefined (y NaN al sumarles
  // el pos_hint). El origen del dato está en reglas._baseDeComponente, que ahora
  // publica la POSE NATURAL del anclaje (y de la cara, z al centro); esto es sólo
  // la convención del módulo, coherente entre los tres constructores.
  //
  // EJE DE LA CARA (CARA CORTINA) — las patas del gancho salen SIEMPRE por la
  // NORMAL de la cara contra la que se apoya la barra, hacia el núcleo:
  //   · cara sup/inf → normal = Y (patas en ±Y, como siempre);
  //   · cara lateral → normal = Z (patas en ±Z: la barra es una cortina pegada a
  //     la cara Z± de un muro/viga y sus ganchos entran hacia adentro EN Z).
  // Antes el sentido era `(cara === 'sup') ? -1 : 1` SOBRE Y y punto: una barra
  // 'lateral' doblaba sus patas hacia arriba en Y, o sea contra una cara que no
  // es la suya. `anchor.ejeCara`/`anchor.sentidoCara` los publica
  // reglas._marcoCara (fuente única del anclaje por cara); si faltan se cae al
  // comportamiento histórico (Y, con el signo de sup/inf) → cero regresión.
  function _cabezalLongitudinal(figura, dims, host, anchor, diamCm) {
    // Punto del cabezal: x sobre el eje longitudinal; la pata (largo `p`) sale por
    // la normal de la cara. p = 0 → punto del tramo. El mapeo vive en
    // _planoTrabajo (FUENTE ÚNICA, compartida con el trazador de cadenas).
    var P = _planoTrabajo(host, anchor).P;
    var f = (figura || '').toUpperCase();
    // Empalme: cuánto asoma FUERA del hormigón y por qué extremo (dato de
    // trazabilidad; la dim ya viene alargada, aquí sólo se orienta el excedente
    // al extremo indicado en vez de repartirlo simétrico). eIni/eFin en X.
    var _e = _empalmeDeAnchor(anchor);
    var eIni = _e.ini, eFin = _e.fin;
    // UN SOLO LADO (101A y cualquier figura de 1 parcial): barra RECTA de largo A
    // — no hay patas de gancho. El criterio sale del catálogo (nº de parciales),
    // no del prefijo del código.
    if (_esRecta(f)) {
      var largoRecto = (dims.A != null) ? dims.A : (host.largo - 2 * (anchor.recubExtremo || 0));
      // El excedente de empalme (eIni+eFin) ya está DENTRO de largoRecto (dim
      // alargada). Se ubica el segmento asimétrico: la mitad "base" centrada y
      // el empalme sobresaliendo por su extremo.
      var lBase = largoRecto - eIni - eFin;
      var xi = -lBase / 2 - eIni, xf = lBase / 2 + eFin;
      return [P(xi, 0), P(xf, 0)];
    }
    var largoTramo = (dims.B != null) ? dims.B : (host.largo - 2 * (anchor.recubExtremo || 0));
    // El empalme del tramo largo se reparte al extremo indicado sobre B.
    var bBase = largoTramo - eIni - eFin;
    var x0 = -bBase / 2 - eIni, x1 = bBase / 2 + eFin;
    var A = (dims.A != null) ? dims.A : 0;
    var C = (dims.C != null) ? dims.C : 0;
    // 102x / recta sin patas → segmento simple.
    if (!A && !C) return [P(x0, 0), P(x1, 0)];
    // 103x: pata A (inicio) + tramo B + pata C (fin), ganchos hacia el núcleo (90°).
    var pts = [];
    if (A) pts.push(P(x0, A));
    pts.push(P(x0, 0));
    pts.push(P(x1, 0));
    if (C) pts.push(P(x1, C));
    return pts;
  }

  // ---- MARCO de recubrimiento del núcleo (compartido estribo/traba) ----------
  // El estribo y la traba encuadran el MISMO rectángulo útil dentro del hormigón:
  //   borde sup ySup = +alto/2 − recub SUPERIOR    (recub_sup, típ. 4 cm)
  //   borde inf yInf = −alto/2 + recub INFERIOR    (recub_inf, típ. 4 cm)
  //   semiancho  w2  =  ancho/2 − recub LATERAL    (recub_lat, típ. 3 cm)
  // El recub vertical y el lateral son DISTINTOS; usarlos cruzados dejaba un lado
  // corto (bug: el estribo no encuadraba el perímetro y la traba no coincidía con
  // el estribo). anchor.recub = recub vertical; anchor.recubLat = recub lateral
  // (lo pasa reglas.js _baseDeComponente). Si recubLat falta, cae a recub (así el
  // marco sigue siendo cuadrado-coherente y los tests que sólo pasan `recub` no
  // cambian). Deriva h2/w2 en UN solo lugar para que estribo y traba compartan
  // EXACTAMENTE el mismo marco (misma altura, mismo ancho).
  // JERARQUÍA (calculista): el recubrimiento es a la CARA EXTERIOR del fierro,
  // no a su eje. El marco devuelve la posición del EJE: recub + φ/2 desde la
  // cara de hormigón (así la superficie del estribo queda EXACTAMENTE al
  // recubrimiento, no metida en él).
  //
  // PILAS DE OCUPACIÓN POR CARA: el marco ya NO se encoge con UN inset escalar, y
  // TAMPOCO es un rectángulo simétrico respecto del centro del host. Cada cara
  // tiene su propia PILA (recub → φmax nivel 1 → φmax nivel 2 → …) y su propio
  // recubrimiento, así que las CUATRO fronteras se calculan por separado:
  //   · anchor.recubSup / anchor.recubInf → recub de cada cara vertical (si faltan
  //     caen a `anchor.recub`, que es lo que había: un solo recub vertical).
  //   · anchor.inset    → profundidad extra (sin recub) de la cara SUPERIOR.
  //   · anchor.insetInf → ídem cara INFERIOR (si falta cae a `inset`).
  //   · anchor.insetLat → ídem caras LATERALES (z±, pila simétrica; cae a `inset`).
  // Devuelve las fronteras del EJE del fierro: ySup / yInf (ya NO ±h2) y ±w2.
  // Un marco simétrico (mismo recub y misma pila arriba y abajo) da exactamente
  // ySup = −yInf = el h2 anterior → llamadas directas al motor sin cambios.
  //
  // POR QUÉ: `altoUtil` (la dim que se lista y se corta) vale
  // alto − prof(sup) − prof(inf), con las dos caras INDEPENDIENTES. Dibujar el
  // marco con un solo escalar vertical hacía que la figura midiera
  // alto − 2·prof(sup): el estribo/la traba se dibujaban con un desfase de
  // (pilaSup − pilaInf) respecto de la dim declarada, y la pieza no se apoyaba en
  // su propia pila inferior (largo de corte y kg equivocados, no un tema visual).
  function _marcoNucleo(host, anchor, diamCm) {
    var recubV = anchor.recub != null ? Number(anchor.recub) : 3;
    var recubSup = anchor.recubSup != null ? Number(anchor.recubSup) : recubV;
    var recubInf = anchor.recubInf != null ? Number(anchor.recubInf) : recubV;
    var recubLat = anchor.recubLat != null ? Number(anchor.recubLat) : recubV;
    var insetSup = (anchor.inset != null) ? Number(anchor.inset) : 0;
    var insetInf = (anchor.insetInf != null) ? Number(anchor.insetInf) : insetSup;
    var insetLat = (anchor.insetLat != null) ? Number(anchor.insetLat) : insetSup;
    var r = (diamCm || 0) / 2;      // recub = a la CARA del fierro → eje = +φ/2
    return {
      recubV: recubV,
      recubLat: recubLat,
      ySup: host.alto / 2 - recubSup - r - insetSup,
      yInf: -host.alto / 2 + recubInf + r + insetInf,
      w2: host.ancho / 2 - recubLat - r - insetLat
    };
  }

  // ¿CABE el marco de núcleo que produce este anchor? (hallazgo A del verificador)
  // Un anillo anidado se posiciona con insets crecientes (k·Sep en las TRES pilas):
  // pasado cierto k el marco se cruza consigo mismo y ySup ≤ yInf (o w2 ≤ 0), o sea
  // el estribo "interior" está FUERA del hormigón, con lados de largo negativo.
  // Devuelve las dos medidas del marco para que el llamador avise con números.
  //   alto = ySup − yInf   ·   ancho = 2·w2   ·   cabe = las dos > 0
  function marcoNucleoCabe(host, anchor, diamCm) {
    var m = _marcoNucleo(host, anchor || {}, diamCm);
    var alto = m.ySup - m.yInf, ancho = 2 * m.w2;
    return { cabe: (alto > 0 && ancho > 0), alto: alto, ancho: ancho };
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
    var m = _marcoNucleo(host, anchor, diamCm);   // eje = recub + φ/2 (+inset anidado)
    // Marco compartido con la traba. ySup/yInf son INDEPENDIENTES (pilas y recubs
    // distintos arriba y abajo): el marco no está centrado en y=0.
    var ySup = m.ySup, yInf = m.yInf, w2 = m.w2;
    var xx = anchor.x || 0;
    var Rc = 2 * diamCm + diamCm / 2;  // radio del EJE del codo (norma: interno 2φ + φ/2)
    var O = { x: xx, y: ySup - Rc, z: -w2 + Rc };  // centro común de ambos codos (esquina sup-izq)
    var D = Math.SQRT1_2;              // 0.7071 (diagonal unitaria)
    // Pata del gancho (norma 6φ mín 7.5cm), acotada al núcleo para no cruzar bordes.
    var largoPata = Math.min(Math.max(6 * diamCm, 7.5), Math.hypot(ySup - yInf, 2 * w2) * 0.28);
    var dirPata = { y: -D, z: D };     // diagonal hacia el núcleo (abajo-derecha) — COMÚN

    // GANCHO A (inicio del fierro): pata → codo [θ: 45° → −90°] → tangente al lado izq.
    var pA = { x: xx, y: O.y + Rc * D, z: O.z + Rc * D };            // punto del arco en θ=45°
    var puntaA = { x: xx, y: pA.y + dirPata.y * largoPata, z: pA.z + dirPata.z * largoPata };
    var codoA = _arcoYZ(O, Rc, Math.PI / 4, -Math.PI / 2, xx, true); // incluye θ=45°, termina θ=−90°

    // GANCHO B (fin del fierro): lado superior llega a T0 (θ=0) → codo [θ: 0 → −135°] → pata.
    var T0 = { x: xx, y: ySup, z: -w2 + Rc };                        // tangencia con lado superior
    var codoB = _arcoYZ(O, Rc, 0, -3 * Math.PI / 4, xx, false);      // excluye θ=0 (T0 ya en la lista)
    var pB = codoB[codoB.length - 1];                                // punto del arco en θ=−135°
    var puntaB = { x: xx, y: pB.y + dirPata.y * largoPata, z: pB.z + dirPata.z * largoPata };

    // POLILÍNEA continua (el codo A termina tangente en (h2−Rc,−w2) y sigue colineal
    // bajando el lado izq → el motor no mete fillet ahí; ídem lado superior → T0):
    var out = [puntaA]
      .concat(codoA)                        // codo A completo (135°)
      .concat([
        { x: xx, y: yInf, z: -w2 },         // esquina inf-izq (90°, fillet del motor)
        { x: xx, y: yInf, z: w2 },          // esquina inf-der (90°)
        { x: xx, y: ySup, z: w2 },          // esquina sup-der (90°)
        T0                                  // fin del lado superior = tangencia del codo B
      ])
      .concat(codoB)                        // codo B completo (135°)
      .concat([puntaB]);
    // ESPEJO (TANDA P): el marco es simétrico en Z salvo por los GANCHOS, que viven
    // en la esquina sup-IZQ. Invertir el eje U del plano de sección (= Z) los pasa a
    // la sup-DER. No cambia ni una dim: es la misma barra colocada al revés.
    return (anchor && anchor.espejo) ? _espejarEje(out, 'z', 0) : out;
  }

  // Reflexión de una polilínea sobre el plano `eje = c` (conserva `esArco`).
  function _espejarEje(pts, eje, c) {
    return pts.map(function (p) {
      var q = { x: p.x, y: p.y, z: p.z };
      q[eje] = 2 * c - p[eje];
      if (p.esArco) q.esArco = true;
      return q;
    });
  }

  // ---- TRABA vertical (101A típ.): cose las dos caras, gancho arriba/abajo.
  // Va a una X dada (anchor.x), a un Z dado (anchor.z), entre las barras sup/inf.
  // TERMINA donde termina el estribo: usa el MISMO marco (_marcoNucleo → mismo h2),
  // de modo que su vertical va de +h2 a −h2 exactamente como el estribo (antes
  // podía derivar un h2 distinto y no coincidir en altura).
  function _traba(figura, dims, host, anchor, diamCm) {
    var m = _marcoNucleo(host, anchor, diamCm);   // eje = recub + φ/2, como el estribo
    var ySup = m.ySup, yInf = m.yInf;  // MISMAS fronteras que el estribo (marco único)
    var xx = anchor.x || 0, zz = anchor.z || 0;
    var g = 0.7071 * (extGancho(diamCm) + diamCm);
    // gancho 135° arriba (diagonal hacia el núcleo) + gancho 90° abajo.
    var out = [
      V(xx, ySup - g, zz - g), // punta gancho 135° arriba
      V(xx, ySup, zz),         // doblez arriba (a la altura del estribo)
      V(xx, yInf, zz),         // baja al fondo (a la altura del estribo)
      V(xx, yInf, zz - extGancho(diamCm))   // pie gancho 90° abajo
    ];
    // ESPEJO: los dos ganchos salen hacia −Z; espejados salen hacia +Z. La
    // reflexión es sobre el PROPIO eje de la traba (zz), no sobre z = 0: la pieza
    // no se mueve, sólo cambia de mano.
    return (anchor && anchor.espejo) ? _espejarEje(out, 'z', zz) : out;
  }

  // ---------------------------------------------------------------------------
  // ANIDADO POR FIGURA — v3 (CORRECCIÓN CONCEPTUAL DEL USUARIO, 12-ago)
  // ---------------------------------------------------------------------------
  // «El espaciamiento se lo damos con este campo y debe mandar. Al ajustar capas
  //  anidadas no debe considerar esta altura: debe ajustar SOLO la medida de B.»
  //
  // De ahí salen DOS responsabilidades SEPARADAS, que antes estaban mezcladas:
  //
  //   POSICIÓN de la capa k → NO es asunto del anidado. La manda SIEMPRE el campo
  //     Sep (gap / sep_capas), eje a eje: k·gap hacia el núcleo, con o sin anidar.
  //     Por eso esta función YA NO devuelve `anchorDelta` (el corrimiento que
  //     metía en las figuras abiertas): el llamador posiciona.
  //     Ese corrimiento era justo el bug «el espaciamiento para CBI está fijo»:
  //     con anidar activo el campo del usuario no movía nada.
  //
  //   DIMS de la capa k → SÍ es asunto del anidado, y es puramente TOPOLÓGICO:
  //     un lado se achica 2δ si tiene DOS VECINOS PERPENDICULARES en la cadena;
  //     si tiene menos (una punta libre), queda INTACTO.
  //
  //       · CERRADA (104x, perímetro): la cadena CIERRA, así que TODO lado tiene
  //         2 vecinos → todos −2δ. Y la capa k es un ANILLO CONCÉNTRICO: su marco
  //         se encoge δ por lado (`inset: δ`), que es lo que además la posiciona.
  //         Aquí δ = k·gap: el campo Sep manda la separación ENTRE MARCOS.
  //       · ABIERTA (103x, U / corchete): los lados INTERIORES tienen 2 vecinos
  //         → −2δ; los lados EXTREMO (las patas, con punta libre) quedan
  //         INTACTOS. Aquí δ = k·φ_PROPIO: es una holgura LATERAL contra fierro,
  //         no una separación configurable.
  //       · RECTA (101x, un solo lado, 0 vecinos): sin cambio.
  //
  // POR QUÉ la regla de vecinos generaliza (lo pidió el usuario explícitamente):
  //   La capa de adentro es LA MISMA barra doblada igual, corrida hacia el núcleo.
  //   Un lado con 2 vecinos está encajonado: al viajar por dentro, sus DOS
  //   extremos entran en el corredor que ocupan los lados vecinos de la capa de
  //   AFUERA (que quedaron δ hacia afuera), así que tiene que retirarse δ en cada
  //   punta → −2δ. Un lado EXTREMO tiene una punta LIBRE: no hay nada delante que
  //   lo obligue a acortarse, y en su otra punta simplemente acompaña al vecino
  //   que ya se retiró (el retiro de esa esquina se contabiliza UNA vez, en el
  //   lado que sí está encajonado). En un 103 el interior es B; en otra figura
  //   será otra letra — y en una cerrada son todas, porque al cerrar la cadena
  //   ningún lado tiene punta libre. Nunca hay que mirar el NOMBRE de la figura.
  //   CORRECCIÓN PREVIA DEL USUARIO que esto conserva: «asumiste que las patas
  //   deben alinearse con las de la capa de afuera, y eso no es correcto».
  //
  // anidarFigura(figura, dims, delta, rol, opts) →
  //   { dims, delta, inset, criterio, vecinos, cabe, motivo }
  // NO muta `dims` (devuelve un clon cuando hay cambio).
  //   delta    : δ de DIMS de esta capa = k·φ_propio (lo usa la figura ABIERTA).
  //   opts.sep : δ del MARCO de esta capa = k·gap (lo usa la CERRADA). Ausente →
  //              cae a `delta` (llamadas directas de tests que no separan los dos).
  //   opts.cerrada: fuerza el criterio cerrado para figuras fuera de la serie 104.
  //
  // CABE (fix 12-ago, hallazgo A del verificador) — el inset k·Sep puede dejar la
  // capa SIN geometría: un estribo 24×52 con Sep 10 llega a la capa 3 con dims
  // 4/32, y con Sep 20 a 0/12 (dim_a = 0, que el backend RECHAZA), con el bbox ya
  // fuera del hormigón y TODO en silencio. Antes eso lo tapaba un
  // `Math.max(0, dim − 2·k·Sep)`: la dim se aplastaba a 0 y la barra imposible se
  // dibujaba y se mandaba igual. Ahora NO hay clamp: la resta se guarda tal cual
  // (puede salir negativa) y `cabe:false` + `motivo` le dicen al llamador que esa
  // capa NO existe → no se genera ni se lista, y se registra un aviso visible.
  //   · dim ≤ 0 en cualquier lado encajonado → no cabe.
  //   · el marco del ANILLO (cerrada) lo comprueba el llamador con
  //     `marcoNucleoCabe`, que necesita el host (aquí no se conoce).
  // Bbox fuera del hormigón con dims > 0 NO es "no cabe": eso se genera tal cual
  // (dato honesto y VISIBLE en el 3D; el usuario decide).
  var LADOS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

  // Lados REALES de la figura = las letras presentes en dims con valor > 0, en
  // orden de recorrido (A→B→C…). Es la misma fuente que usa el backend para el
  // largo (suma de lados), así que el ítem del listado no puede desincronizarse.
  function _ladosDeDims(dims) {
    var out = [];
    for (var i = 0; i < LADOS.length; i++) {
      var L = LADOS[i], v = dims ? Number(dims[L]) : NaN;
      if (dims && dims[L] != null && isFinite(v) && v > 0) out.push(L);
    }
    return out;
  }

  // ¿La cadena de lados CIERRA? Se deriva del catálogo (4 lados A–D sin radio =
  // perímetro), no del prefijo del código: una figura nueva de 4 lados anida como
  // anillo concéntrico sin tocar esta función. Sobre el catálogo actual da
  // exactamente la serie 104x, o sea lo mismo que el criterio anterior.
  function figuraCerrada(figura) {
    var f = (figura || '').toUpperCase();
    return _esPerimetro(_spec(f), f);
  }

  function anidarFigura(figura, dims, delta, rol, opts) {
    opts = opts || {};
    var dDim = Number(delta) || 0;                                   // δ de dims (k·φ)
    var dSep = (opts.sep != null && isFinite(opts.sep)) ? Number(opts.sep) : dDim;  // δ del marco (k·gap)
    var res = { dims: dims, delta: 0, inset: 0, criterio: 'recta', vecinos: {}, cabe: true, motivo: null };
    var lados = _ladosDeDims(dims);
    var f = (figura || '').toUpperCase();
    // CRITERIO: manda la FORMA QUE SE DIBUJA, no el código de la figura.
    // Un componente con rol 'estribo' se traza SIEMPRE como marco cerrado
    // (_estriboPerimetral) → su anidado es por inset de marco, aunque su figura
    // sea de 3 lados (103E/103H son estribos en el catálogo: MURO-EC, VIGA-ES).
    // Antes eso se decidía por el prefijo '103'/'104' del código y esos dos casos
    // se anidaban como corchete abierto mientras se dibujaban como anillo.
    // ABIERTA = cualquier cadena de 2+ lados que no cierra (L, U, poligonal).
    // TANDA P: el rol 'estribo' ya no implica marco cerrado por sí solo — con el fix
    // 305A una cadena colocada como ES se TRAZA como cadena, así que su anidado
    // tiene que ser el de una figura ABIERTA (ajusta dims) y no el de un anillo
    // concéntrico. La pregunta correcta sigue siendo la misma de siempre: ¿qué
    // FORMA se dibuja? → familiaDeDibujo, que es quien lo decide.
    // PIEZA DE SECCIÓN QUE SE TRAZA COMO CADENA (defecto F1) — anida como anillo,
    // no como corchete. Encuadra la sección igual que el estribo, así que su capa k
    // es un ANILLO CONCÉNTRICO: marco δ más chico por lado (`inset`) y lados
    // retirados lo que haga falta para que la figura entre ahí (insetCadenaSeccion,
    // que sobre un rectángulo devuelve el −2δ de la cerrada). δ = k·gap: el campo
    // Sep manda la separación entre marcos, igual que en la cerrada.
    // ANTES caía en la rama ABIERTA (o directamente en ninguna, porque el llamador
    // sólo anidaba lo que se dibuja como marco) y el corchete no le sirve: sus
    // puntas libres son patas de gancho y sus quiebres no son de 90°.
    if ((rol === 'estribo' || rol === 'traba') && familiaDeDibujo(f, rol) === 'cadena') {
      if (!(dSep > 0)) { res.delta = 0; return res; }   // δ nulo = marcos superpuestos
      var sec = insetCadenaSeccion(f, dims, dSep, rol);
      if (sec) {
        res.delta = dSep; res.inset = dSep; res.criterio = 'seccion';
        res.dims = sec.dims; res.cabe = sec.cabe; res.motivo = sec.motivo;
        return res;
      }
    }
    var cerrada = (opts.cerrada === true) || figuraCerrada(f) ||
      (rol === 'estribo' && familiaDeDibujo(f, 'estribo') === 'estribo');
    var abierta = !cerrada && lados.length >= 2;   // U / corchete / L
    // δ EFECTIVO: la cerrada se anida con la separación entre marcos (el campo del
    // usuario); la abierta, con su propio φ (holgura contra el fierro de afuera).
    var d = cerrada ? dSep : dDim;
    res.delta = d;
    if (!(d > 0) || (!cerrada && lados.length < 2)) {
      // recta (o δ nulo): no hay vecino perpendicular → nada que achicar. δ nulo
      // en una cerrada = marcos superpuestos: dato honesto, sin clamp (igual que
      // el gap 0 del apilado).
      res.delta = 0;
      return res;
    }
    if (cerrada && lados.length < 2) {
      // marco sin dims utilizables (el perímetro lo deriva _marcoNucleo): igual
      // hay que encogerlo δ, aunque no haya lados que ajustar.
      res.criterio = 'cerrada'; res.inset = d;
      return res;
    }
    var nd = {};
    for (var k in dims) if (dims.hasOwnProperty(k)) nd[k] = dims[k];
    for (var i = 0; i < lados.length; i++) {
      var L = lados[i];
      // VECINOS PERPENDICULARES del lado en la cadena. En una figura CERRADA la
      // cadena da la vuelta → todo lado tiene 2. En una ABIERTA los extremos
      // tienen 1 (su otra punta es libre) y el resto 2.
      var v = cerrada ? 2 : ((i > 0 ? 1 : 0) + (i < lados.length - 1 ? 1 : 0));
      res.vecinos[L] = v;
      // REGLA ÚNICA: encajonado (2 vecinos) → −2δ; con punta libre → INTACTO.
      // SIN CLAMP: si la resta deja ≤ 0, la capa NO CABE (el llamador la omite).
      if (v === 2) {
        var nuevo = Number(nd[L]) - 2 * d;
        nd[L] = nuevo;
        if (!(nuevo > 0) && res.cabe) {
          res.cabe = false;
          res.motivo = 'dim ' + L + ' = ' + (Math.round(nuevo * 100) / 100);
        }
      }
    }
    res.dims = nd;
    res.criterio = cerrada ? 'cerrada' : 'abierta';
    // Sólo la CERRADA posiciona: su marco se encoge δ por lado (anillo concéntrico).
    // La ABIERTA no mueve nada: la posición de la capa la manda el campo Sep.
    if (cerrada) res.inset = d;
    return res;
  }

  // ---- Despachador principal -------------------------------------------------
  // rol: 'cabezal' | 'estribo' | 'traba' (viene de la tipología del componente).
  // Devuelve la polilínea [{x,y,z}] en coordenadas del host (cm).
  function figuraAPuntos(figura, dims, host, anchor, opts) {
    opts = opts || {};
    var diamCm = opts.diamCm != null ? opts.diamCm : 1.0;
    var rol = opts.rol || _rolPorFigura(figura, anchor);
    var familia = familiaDeDibujo(figura, rol);
    if (familia === 'estribo') return _estriboPerimetral(figura, dims, host, anchor, diamCm);
    if (familia === 'traba') return _traba(figura, dims, host, anchor, diamCm);
    if (familia === 'cadena') return _cadenaGenerica(figura, dims, host, anchor, diamCm, rol);
    return _cabezalLongitudinal(figura, dims, host, anchor, diamCm);   // recta | cabezal
  }

  // Rol cuando la tipología no lo dice: cara lateral = traba; figura de perímetro
  // cerrado (4 lados del catálogo) = estribo; el resto longitudinal.
  function _rolPorFigura(figura, anchor) {
    if (anchor && anchor.cara === 'lateral') return 'traba';
    var f = (figura || '').toUpperCase();
    return _esPerimetro(_spec(f), f) ? 'estribo' : 'cabezal';
  }

  var API = {
    figuraAPuntos: figuraAPuntos,
    extGancho: extGancho,
    // CLASIFICACIÓN DE DIBUJO (fuente única; se evalúa contra el catálogo vigente).
    // La UI usa `noDibujables()` para EXCLUIR figuras del selector con su motivo,
    // y `familiaDeDibujo`/`patasDeFigura` para armar los controles del componente.
    dibujabilidad: dibujabilidad,
    noDibujables: noDibujables,
    familiaDeDibujo: familiaDeDibujo,
    // ¿La pieza ENCUADRA la sección? (estribo / traba / cadena de sección). Es el
    // criterio ÚNICO del anidado: una pieza de sección anida, nunca se traslada.
    esPiezaDeSeccion: esPiezaDeSeccion,
    patasDeFigura: patasDeFigura,
    MAX_LADOS_DIBUJABLES: MAX_LADOS_DIBUJABLES,
    // CADENAS (trazador genérico). La convención de tramos es la del Diseñador de
    // figuras (disenador.js): geometria dibujada > derivación > exclusión.
    derivarTramos: derivarTramos,
    tramosDeFigura: tramosDeFigura,
    cadenaInfo: cadenaInfo,
    // Lado longitudinal de una CADENA (undefined = no es cadena → regla del
    // llamador; null = cadena cerrada, sin auto-largo). Lo consulta reglas.js.
    ladoLongitudinalCadena: ladoLongitudinalCadena,
    // Eje contra el que mide cada lado de una cadena de SECCIÓN (u = ancho ·
    // v = alto · d = diagonal). Fuente ÚNICA del 'auto' de reglas._dimsEfectivas
    // y del trazo de _cadenaSeccion: las dos leen el mismo trazo.
    ejesCadenaSeccion: ejesCadenaSeccion,
    autosCadenaSeccion: autosCadenaSeccion,   // reserva de los quiebres (ver sobresCadena)
    // Cuánto OCUPA la cadena de sección ya dibujada (u = ancho · v = alto): lo que
    // el reparto de una capa tiene que descontar para colocar su CENTRO.
    extensionCadenaSeccion: extensionCadenaSeccion,
    // Retiro de los lados de una cadena de sección para anidarla δ por lado (el
    // −2δ del anillo, resuelto exacto para lados que no se cortan a 90°).
    insetCadenaSeccion: insetCadenaSeccion,
    // LADO DOMINANTE de una figura (cascada catálogo → 'B' → 1er parcial). Fuente
    // ÚNICA: la usan reglas._ladoLongitudinal, el trazador de cadenas y la ficha.
    ladoDominanteFigura: ladoDominanteFigura,
    sobresCadena: sobresCadena,   // reserva del auto-largo (puntas inclinadas)
    // ANIDADO: fuente ÚNICA del criterio "figura dentro de figura" (la usan
    // distribuidorLayered/distribuidorArreglo de reglas.js).
    anidarFigura: anidarFigura,
    figuraCerrada: figuraCerrada,
    // ¿el marco del anillo anidado sigue existiendo con estos insets? (lo consulta
    // reglas.js antes de generar una capa cerrada: si no cabe, la omite y avisa).
    marcoNucleoCabe: marcoNucleoCabe,
    // exportados para tests / reuso
    _cabezalLongitudinal: _cabezalLongitudinal,
    _estriboPerimetral: _estriboPerimetral,
    _traba: _traba,
    _cadenaGenerica: _cadenaGenerica
  };

  global.ModeladorFiguraPuntos = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
