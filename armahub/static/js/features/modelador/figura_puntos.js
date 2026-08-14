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
      // ESTRIBO CON GANCHOS DECLARADOS (106x, corrección 14-ago): 6 letras pero
      // el mismo marco de siempre — lo dibuja _estriboPerimetral, no el trazador.
      // Sin esta rama, re-clasificarlas como 'estribo' las dejaba EXCLUIDAS por
      // el umbral de lados (generaban 0 kg) siendo perfectamente dibujables.
      if (fam === 'estribo') {
        return { dibujable: true, familia: 'estribo', lados: n, motivo: null };
      }
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
  //    1 lado → recta; 2+ lados → 'cadena' (el cabezal con patas dejó de ser la
  //    ruta normal — ver MIGRACIÓN CABEZAL → TRAZADOR más abajo).
  // 3) 2+ lados que NO son MARCO CERRADO → 'cadena' (trazador genérico). Incluye
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
  //
  // MIGRACIÓN CABEZAL → TRAZADOR (tanda de hoy): el umbral de la cadena
  // LONGITUDINAL baja a 2 lados. `_cabezalLongitudinal` dibuja las patas a 90°
  // FIJAS y no lee los ángulos del catálogo: una 103C (ang 45/90) salía IDÉNTICA
  // a una 103A (90/90) — la misma polilínea, byte por byte —, o sea el editor
  // pintaba una figura que no es la que dice el código. El trazador genérico sí
  // los honra (derivarTramos lee spec.angulos), y para las figuras que el cabezal
  // sí dibujaba bien (ángulos rectos) produce EXACTAMENTE los mismos puntos: eso
  // es lo que fija el piloto de convención de tests/test_trazador_generico.js
  // (101A/102A/103A byte-idénticas por las dos rutas). Así que migrar no es
  // "otro dibujo": es el MISMO dibujo donde ya era correcto, y el correcto donde
  // el cabezal mentía.
  // Lo que NO cambia: 1 lado (recta, sin dobleces que honrar) y el MARCO CERRADO
  // de 4 lados (constructor propio calibrado, con sus arcos de gancho sísmico).
  var MIN_LADOS_CADENA_LONG = 2;
  function familiaDeDibujo(figura, rol) {
    var f = (figura || '').toUpperCase();
    var spec = _spec(f);
    var n = spec ? spec.parciales.length : 0;
    var esMarco = _esPerimetro(spec, f) && (!spec || n === MAX_LADOS_DIBUJABLES);
    var tieneTramos = !!tramosDeFigura(f);
    // DOS UMBRALES, DOS PLANOS DE TRABAJO. La cadena de SECCIÓN (rol estribo)
    // sigue pidiendo 4+ lados: ahí el constructor de marco no "miente" con las
    // 1–3 lados (103E/103H son ganchos de 135° que el marco traza con su arco
    // calibrado), y bajarle el umbral cambiaría el ANCLAJE de esas piezas, no
    // sólo su trazo. La cadena LONGITUDINAL (rol cabezal / sin rol) entra desde
    // 2 lados, que es donde aparece el primer doblez con ángulo de catálogo.
    var esCadenaSeccion = (n >= MAX_LADOS_DIBUJABLES) && tieneTramos;
    var esCadenaLong = (n >= MIN_LADOS_CADENA_LONG) && tieneTramos;
    if (rol === 'estribo') {
      if (esMarco) return 'estribo';
      // 106A y familia (correccion 14-ago): estribo rectangular con sus GANCHOS
      // declarados como parciales -> el MARCO manda, como el 104D y como era
      // antes de la Tanda P ("el estribo estaba bien en vigas").
      if (esEstriboConGanchos(f)) return 'estribo';
      if (esRomboSeccion(f)) return 'rombo';   // hoy: ninguna figura (ver stub)
      if (esCadenaSeccion) return 'cadena';
      return 'estribo';
    }
    // TRABA CON FIGURA DE 3+ LADOS → CADENA DE SECCIÓN (feedback 13-ago, mismo
    // criterio que el fix 305A del estribo): `_traba` dibuja UNA forma fija
    // (vertical + gancho 135/90) que aproxima bien las 101x/102x — con una
    // 103A/104A/104B la IGNORABA por completo y encima el 'auto' mandaba TODAS
    // las dims al alto útil (medido: una TC 104B en el muro resolvía 244×4 y se
    // dibujaba plana). Como cadena entra por ejesCadenaSeccion/autos, contra el
    // marco de SU pose, igual que el estribo-cadena.
    if (rol === 'traba') {
      if (esMarco || esEstriboConGanchos(f)) return 'estribo';   // marco cerrado (con o sin ganchos declarados) se dibuja como marco
      if (n >= 3 && tieneTramos) return 'cadena';
      return 'traba';                  // 101x/102x: la forma clásica les calza
    }
    if (esMarco || esEstriboConGanchos(f)) return rol ? 'cabezal' : 'estribo';
    if (_esRecta(f)) return 'recta';
    if (esCadenaLong) return 'cadena';
    // Sólo queda lo que NO tiene tramos trazables (figura fuera del catálogo, o
    // con `geometria` en arco): el cabezal clásico es la red de seguridad, nunca
    // la ruta normal. Ver la nota de MIGRACIÓN arriba.
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
    return fam === 'estribo' || fam === 'rombo' || fam === 'traba' || fam === 'cadena';
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
  //
  // 0º — OVERRIDE POR COMPONENTE (2º parámetro, `comp.lado_dominante`), TANDA Δ.
  // ---------------------------------------------------------------------------
  // Hasta hoy la cascada sólo miraba el CATÁLOGO: el campo `comp.lado_dominante`
  // que la ficha del Template Editor ya escribía NO LO LEÍA NADIE (evidencia
  // medida el 14-ago: un 103A con lado_dominante:'C' resolvía las mismas dims y
  // dibujaba los mismos puntos, byte por byte). O sea que el usuario podía elegir
  // el lado y la elección no llegaba al motor. Ahora manda, con MÁXIMA prioridad
  // y una validación que no se puede saltar (validarLadoDominante):
  //   · un GANCHO (tramo TERMINAL de la cadena) no puede ser dominante — es la
  //     pata que cuelga, no el cuerpo que se ancla contra el hormigón;
  //   · un lado DIAGONAL tampoco — ponerlo a lo largo saca la pieza de su plano
  //     de trabajo, que es geometría que el editor hoy no aborda;
  //   · un CONTORNO CERRADO no tiene dominante que elegir (su largo lo fija el
  //     marco, no un lado).
  // Un override inválido se IGNORA y cae a la cascada de siempre (nunca se
  // "acomoda" a algo parecido). El AVISO lo emite quien conoce el componente
  // —reglas._baseDeComponente—, porque acá no hay canal de avisos.
  //
  // El override es OPCIONAL en la firma a propósito: `ladoDominanteFigura(fig)`
  // sigue devolviendo exactamente lo de antes, así que ninguna de las rutas que
  // no lo conocen cambia de resultado.
  function ladoDominanteFigura(figura, override) {
    var spec = _spec(figura);
    if (!spec) return null;
    var P = spec.parciales || [];
    if (override != null && String(override).trim() !== '') {
      var v = validarLadoDominante(figura, override);
      if (v.ok) return v.lado;
    }
    var decl = spec.lado_dominante ||
      (spec.geometria && spec.geometria.lado_dominante) || null;
    if (decl) {
      var d = String(decl).toUpperCase().trim();
      if (P.indexOf(d) >= 0) return d;
    }
    if (!P.length) return null;
    return (P.indexOf('B') >= 0) ? 'B' : P[0];
  }

  // ¿La figura es un CONTORNO CERRADO? Los tres criterios ya viven en el módulo y
  // acá se leen JUNTOS porque para el lado dominante significan lo mismo: no hay
  // ningún lado que corra "a lo largo" de la pieza — el largo lo fija el marco.
  //   · marco de 4 lados (_esPerimetro: 104A/104D/104O/104P…);
  //   · estribo con sus GANCHOS declarados (esEstriboConGanchos: 106A y familia);
  //   · cualquier cadena cuyo trazo TOPOLÓGICO (todos los lados = 1) vuelve al
  //     punto de partida — el mismo test que usa ladoLongitudinalCadena para
  //     devolver null.
  function _figuraEsContornoCerrado(figura) {
    var f = (figura || '').toUpperCase();
    var spec = _spec(f);
    if (!spec) return false;
    if (esEstriboConGanchos(f)) return true;
    if (_esPerimetro(spec, f) && spec.parciales.length === MAX_LADOS_DIBUJABLES) return true;
    var tr = tramosDeFigura(f);
    if (!tr) return false;
    return _cadenaCierra(_cadena2D(tr.tramos, {}, 1).pts);
  }

  // ¿Puede el lado `letra` ser el DOMINANTE de esta figura?
  // → { ok, lado, motivo }. `motivo` es texto de usuario (va al aviso tal cual).
  // La referencia para clasificar DIAGONAL es la cascada SIN override
  // (ejesCadenaLong → ladoDominanteFigura(f) pelado): así no hay recursión y la
  // pregunta «¿este lado es una diagonal?» tiene una respuesta estable, la misma
  // que ya usa el 'auto' universal por dirección-en-pose.
  function validarLadoDominante(figura, letra) {
    var f = (figura || '').toUpperCase();
    var spec = _spec(f);
    var d = String(letra == null ? '' : letra).toUpperCase().trim();
    if (!spec) {
      return { ok: false, lado: null, motivo: 'la figura no está en el catálogo' };
    }
    if (!d || (spec.parciales || []).indexOf(d) < 0) {
      return { ok: false, lado: null,
        motivo: 'la figura ' + spec.codigo + ' no tiene el lado ' + (d || '(vacío)') };
    }
    if (_figuraEsContornoCerrado(f)) {
      return { ok: false, lado: null,
        motivo: 'la figura ' + spec.codigo + ' es un contorno CERRADO y no tiene lado dominante' };
    }
    var tr = tramosDeFigura(f);
    if (!tr) {
      return { ok: false, lado: null,
        motivo: 'la figura ' + spec.codigo + ' no se describe como cadena de tramos' };
    }
    var n = tr.tramos.length, i, iL = -1;
    for (i = 0; i < n; i++) if (tr.tramos[i] && tr.tramos[i].lado === d) { iL = i; break; }
    if (iL < 0) {
      return { ok: false, lado: null,
        motivo: 'el lado ' + d + ' no aparece en el trazo de ' + spec.codigo };
    }
    // GANCHO = tramo TERMINAL de la cadena (la pata que cuelga del cuerpo).
    // DOS EXCEPCIONES, las dos por la misma razón —que no quede la figura sin
    // ningún lado— y las dos ya escritas en el módulo:
    //   · n === 1 (101x recta): su único lado ES la barra, no un gancho.
    //   · n === 2 (102x: gancho + cuerpo): los DOS tramos son terminales, así que
    //     "terminal" no distingue nada. La respuesta del módulo para este caso ya
    //     existe y está medida — ver la nota de _conGanchosRadio (iCuerpo): con un
    //     solo doblez el CUERPO es el DOMINANTE y el otro es la pata. Se lee de
    //     ahí en vez de inventar un segundo criterio que se pueda desincronizar
    //     del trazado (si divergen, la barra se dibuja despegada de su anclaje:
    //     ese bug costó φ32 → 4 cm fuera del hormigón).
    if (n === 2) {
      if (d !== ladoDominanteFigura(f)) {
        return { ok: false, lado: null,
          motivo: 'el lado ' + d + ' es el GANCHO de ' + spec.codigo + ' (el cuerpo es el otro tramo)' };
      }
    } else if (n > 2 && (iL === 0 || iL === n - 1)) {
      return { ok: false, lado: null,
        motivo: 'el lado ' + d + ' es un GANCHO (tramo terminal de la cadena)' };
    }
    var ejes = ejesCadenaLong(f);
    if (ejes && ejes[d] === 'd') {
      return { ok: false, lado: null,
        motivo: 'el lado ' + d + ' es DIAGONAL: ponerlo a lo largo sacaría la pieza de su plano' };
    }
    return { ok: true, lado: d, motivo: null };
  }

  // Qué lados PUEDE elegir el usuario como dominante (la UI hace un botón por
  // letra y deshabilita las que no están acá). Lista vacía = esta figura no
  // admite elección (contorno cerrado, o todos sus lados son ganchos/diagonales).
  function ladosDominantesElegibles(figura) {
    var spec = _spec(figura);
    if (!spec) return [];
    var P = spec.parciales || [], out = [];
    for (var i = 0; i < P.length; i++) {
      if (validarLadoDominante(figura, P[i]).ok) out.push(P[i]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // PARES ESPEJO — LOS LADOS SIMÉTRICOS SE MUEVEN EN BLOQUE (definición del usuario)
  // ---------------------------------------------------------------------------
  // En una figura CERRADA los lados opuestos son LA MISMA MEDIDA vista dos veces:
  // el alto de un estribo lo miden B y D, el ancho lo miden C y E. Estirar uno solo
  // no produce "un estribo un poco más alto": produce una figura que NO CIERRA —
  // un cuadrilátero abierto que el taller no puede doblar. Por eso un Δ en un lado
  // se REPLICA en su par: es la única forma de que el contorno siga existiendo.
  //
  // SE DERIVA DE LA GEOMETRÍA, NO DE UNA TABLA POR CÓDIGO. Una tabla '106A → B/D'
  // se queda vieja en cuanto el catálogo incorpora una figura nueva (y el catálogo
  // es data del backend, no código). Acá el par sale del TRAZO CERRADO: en un
  // contorno de n lados, el lado i y el lado i+n/2 son los opuestos, y se emparejan
  // si además corren ANTIPARALELOS (heading a 180°), que es lo que significa
  // "lados simétricos" en un polígono cerrado.
  //
  // TRES CONTORNOS, UNA REGLA (y por qué el cuerpo se recorta en cada uno):
  //   · MARCO de 4 lados (_esPerimetro: 104A/104D/104O/104P…): el rectángulo lo
  //     CERTIFICA _esPerimetro y lo dibuja _estriboPerimetral, que lista A/C =
  //     ancho y B/D = alto. Acá NO se miran headings: el catálogo describe la
  //     104D listando sólo los ángulos de sus GANCHOS (135/135), así que su cadena
  //     DERIVADA no es el rectángulo que se dibuja — preguntarle a esa cadena daría
  //     una respuesta sobre una figura que no existe. La autoridad es _esPerimetro.
  //   · ESTRIBO CON GANCHOS DECLARADOS (106A): el cuerpo son los tramos INTERIORES
  //     (se descartan el primero y el último, que son los ganchos) y sus headings sí
  //     describen el rectángulo — leídos RELATIVOS A SÍ MISMOS, exactamente como los
  //     lee esEstriboConGanchos (el gancho inicial de 45° inclina el heading
  //     absoluto y haría ver "diagonales" los lados del rectángulo).
  //   · CADENA CERRADA genérica: todos sus lados son cuerpo.
  // Una figura ABIERTA (103x, 104B, 105x…) no tiene pares: su Δ actúa solo en su
  // lado, que es lo correcto — ahí no hay contorno que romper.
  //
  // Devuelve { lado: par } en los DOS sentidos ({B:'D', D:'B'}), o {} si no hay.
  function paresEspejoFigura(figura) {
    var f = (figura || '').toUpperCase();
    var spec = _spec(f);
    if (!spec) return {};
    var P = spec.parciales || [];
    var cuerpo = null, hs = null, certificado = false, tr;
    if (_esPerimetro(spec, f) && P.length === MAX_LADOS_DIBUJABLES) {
      cuerpo = P.slice();                      // rectángulo certificado (ver arriba)
      certificado = true;
    } else if (esEstriboConGanchos(f)) {
      tr = tramosDeFigura(f);
      if (!tr) return {};
      cuerpo = tr.tramos.slice(1, -1).map(function (t) { return t && t.lado; });
      hs = _headingsTramos(tr.tramos, 1, tr.tramos.length - 1);
    } else {
      tr = tramosDeFigura(f);
      if (!tr) return {};
      if (!_cadenaCierra(_cadena2D(tr.tramos, {}, 1).pts)) return {};   // abierta: sin pares
      cuerpo = tr.tramos.map(function (t) { return t && t.lado; });
      hs = _headingsTramos(tr.tramos, 0, tr.tramos.length);
    }
    var n = cuerpo.length;
    if (n < 4 || n % 2 !== 0) return {};        // sin lados opuestos que emparejar
    var m = n / 2, pares = {}, j, a, b, da;
    for (j = 0; j < m; j++) {
      a = cuerpo[j]; b = cuerpo[j + m];
      if (a == null || b == null || a === b) continue;
      if (!certificado) {
        da = (((hs[j + m] - hs[j]) % 360) + 360) % 360;
        if (Math.abs(da - 180) > 1e-6) continue;   // no corre antiparalelo: no es su par
      }
      pares[a] = b; pares[b] = a;
    }
    return pares;
  }

  // ---------------------------------------------------------------------------
  // QUÉ MEDIDA DEL MARCO LLEVA CADA LADO — sólo piezas de sección DIBUJADAS DEL MARCO
  // ---------------------------------------------------------------------------
  // → { LETRA: 'u'|'v' }  ('u' = ancho, 'v' = alto), o null si esta figura no se
  // dibuja del marco. Lo consume reglas para convertir un Δ por dimensión en el
  // crecimiento del marco (ver _marcoNucleo): sin esto el Δ movería la dim y no
  // el trazo.
  //
  // NO ES UNA TABLA NUEVA: se le PREGUNTA a la misma autoridad que produce las
  // dims, para que no pueda desincronizarse de ellas.
  //   · CADENA DE SECCIÓN (305A, 104B) → null y no por olvido: esas se dibujan
  //     CON SUS DIMS (_cadenaSeccion), así que el Δ ya les llega por el trazo y
  //     crecerles el marco lo contaría dos veces.
  //   · ESTRIBO CON GANCHOS DECLARADOS (106x) → se PERTURBA `dimsEstriboGanchos`
  //     (+10 en ancho y +10 en alto por separado) y se mira qué lado se movió con
  //     cuál. Es exactamente la función que reglas usa para listar esas dims, así
  //     que la respuesta es la suya, no una copia. MEDIDO: B/D siguen al alto y
  //     C/E al ancho, y los ganchos A/F no siguen a ninguno (son la extensión
  //     normativa) → un Δ en un gancho no agranda el marco, que es lo correcto.
  //   · RECTÁNGULO DE 4 LADOS (104x) → A/C = ancho, B/D = alto. Es la MISMA
  //     lectura que hace reglas._dimsEfectivas (`autoDeLado`) y la que dibuja
  //     _estriboPerimetral; si una de las dos cambiara, el test de coherencia
  //     (dim crece == trazo crece) lo caza.
  function ejesMarcoSeccion(figura, rol) {
    var f = (figura || '').toUpperCase();
    var spec = _spec(f);
    if (!spec) return null;
    var fam = familiaDeDibujo(f, rol || 'estribo');
    var P = spec.parciales || [], out = {}, i;
    // TRABA: su vertical va de ySup a yInf, o sea TODA ella mide el ALTO del marco
    // (ver _traba: «usa el MISMO marco que el estribo»). Coincide con lo que hace
    // reglas._dimsEfectivas, que para una traba devuelve mk.altoUtil en todos sus
    // lados. MEDIDO antes de esta corrección: TRV 101A de la semilla con Δ +6 daba
    // dim A 50.4 → 56.4 y el trazo clavado en 49.6 de alto — el mismo defecto del
    // estribo, en la otra pieza que se dibuja del marco.
    if (fam === 'traba') {
      for (i = 0; i < P.length; i++) out[P[i]] = 'v';
      return out;
    }
    if (fam !== 'estribo') return null;
    if (esEstriboConGanchos(f)) {
      var b = dimsEstriboGanchos(f, 24, 52, 0.8);
      var du = dimsEstriboGanchos(f, 34, 52, 0.8);
      var dv = dimsEstriboGanchos(f, 24, 62, 0.8);
      if (!b || !du || !dv) return null;
      for (i = 0; i < P.length; i++) {
        var L = P[i];
        if (b[L] == null) continue;
        if (Math.abs(du[L] - b[L]) > 1e-9) out[L] = 'u';
        else if (Math.abs(dv[L] - b[L]) > 1e-9) out[L] = 'v';
      }
      return out;
    }
    if (_esPerimetro(spec, f) && P.length === MAX_LADOS_DIBUJABLES) {
      out.A = 'u'; out.C = 'u'; out.B = 'v'; out.D = 'v';
      return out;
    }
    return null;
  }

  // Headings acumulados de los tramos [i0, i1), con el PRIMERO del rango como 0°
  // (lectura relativa al propio cuerpo). Misma convención de giro/sentido que
  // _cadena2D — una sola forma de recorrer la cadena en todo el módulo.
  function _headingsTramos(tramos, i0, i1) {
    var h = 0, out = [], i, g;
    for (i = i0; i < i1; i++) {
      if (i > i0) {
        g = Number(tramos[i].giro) || 0;
        if (tramos[i].sentido === 'der') g = -g;
        h += g;
      }
      out.push(h);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // GANCHOS TERMINALES DE UN MARCO CERRADO — QUÉ LETRA DIBUJA CADA PATA
  // ---------------------------------------------------------------------------
  // → { ini: LETRA, fin: LETRA } de los dos ganchos que `_estriboPerimetral`
  // traza (el del INICIO del fierro y el del FIN), o null si esta figura no los
  // declara como parciales.
  //
  // POR QUÉ EXISTE (defecto medido 14-ago). El estribo con ganchos DECLARADOS
  // (106A y familia: A y F son los ganchos, B–E el rectángulo) listaba dim A =
  // dim F = extGancho() y dibujaba la pata con la MISMA constante calculada
  // aparte dentro de `_estriboPerimetral`. Mientras nadie tocara esas dims las
  // dos cuentas coincidían por casualidad; en cuanto el usuario escribía una
  // medida (o un Δ) el corte crecía y el trazo no se movía: MEDIDO en la 106A
  // rol estribo φ8, dim_a 7.5 → 12.5, largo 167 → 172, kg 138.8 → 139.8, y el
  // perímetro dibujado 169.213659 → 169.213659 (0.000000 de diferencia). Con esta
  // función `_estriboPerimetral` puede leer el largo que el usuario PIDIÓ para
  // cada pata, así que medir y dibujar vuelven a salir del mismo número.
  //
  // `ini`/`fin` siguen el orden de los TRAMOS (el primero y el último), que es el
  // mismo con el que el trazador recorre la figura: gancho A = inicio del fierro,
  // gancho B del trazo = último parcial. El espejo de la pose invierte el eje U
  // de la sección DESPUÉS, así que no cambia quién es quién.
  function ganchosTerminales(figura, rol) {
    var f = (figura || '').toUpperCase();
    if (familiaDeDibujo(f, rol || 'estribo') !== 'estribo') return null;
    if (!esEstriboConGanchos(f)) return null;     // 104x: ganchos IMPLÍCITOS, sin dim propia
    var tr = tramosDeFigura(f);
    if (!tr || tr.tramos.length < 5) return null;
    var a = tr.tramos[0], b = tr.tramos[tr.tramos.length - 1];
    if (!a || !b || a.lado == null || b.lado == null) return null;
    return { ini: a.lado, fin: b.lado };
  }

  // ---------------------------------------------------------------------------
  // ¿POR DÓNDE LLEGA AL TRAZO LA MEDIDA DE ESTE LADO? — el simétrico del ángulo
  // ---------------------------------------------------------------------------
  // → 'dims' | 'marco' | 'gancho' | null.
  //
  // El motor ya declaraba, para el ÁNGULO, en qué figuras el control mueve el
  // dibujo y en cuáles es mudo (`trazoLeeAngulos`), y reglas.js lo AVISA. Para la
  // DIMENSIÓN ese simétrico no existía, y por eso una medida escrita en un lado
  // que el trazo no lee subía el largo de corte y los kg sin mover la polilínea ni
  // decir una palabra: MEDIDO sobre las 63 figuras × sus lados × roles ES/CBS, 62
  // de 518 combinaciones con Δ quedaban MUDAS —el corte subía 5.00 y el dibujo
  // 0.000— con 0 avisos.
  //
  // NO ES UN BOOLEANO, y eso no es una complicación gratuita: la dim tiene TRES
  // rutas distintas hacia el dibujo y cada una acepta cosas distintas.
  //   · 'dims'   → cadena / recta / cabezal: la polilínea se construye TRAMO A
  //     TRAMO con las dims, así que CUALQUIER medida de ese lado la mueve.
  //   · 'gancho' → pata terminal DECLARADA de un marco cerrado (106x A y F): llega
  //     entera por `anchor.ganchoDim`, o sea también acepta cualquier medida.
  //   · 'marco'  → lado que lleva una medida del MARCO DE NÚCLEO (104x A/C/B/D,
  //     106x B..E, todos los de la traba). El marco NO sale de las dims: lo fija el
  //     hormigón (recubrimiento + pilas) — «el marco manda la forma», fix 13-ago.
  //     Ahí sólo entra el Δ (por `anchor.marcoDelta`, que es un CRECIMIENTO); una
  //     medida FIJA se lista y se corta, pero el trazo sigue saliendo del hormigón.
  //   · null     → ninguna ruta: esa dim no toca el dibujo de ninguna forma.
  // Quién puede usar cada ruta lo decide reglas.js, que es quien sabe si el usuario
  // escribió una medida fija o un Δ.
  function canalDelTrazo(figura, rol, lado) {
    var f = (figura || '').toUpperCase();
    var L = String(lado == null ? '' : lado).toUpperCase();
    var fam = familiaDeDibujo(f, rol || null);
    if (fam !== 'estribo' && fam !== 'traba' && fam !== 'rombo') return 'dims';
    var g = ganchosTerminales(f, rol);
    if (g && (g.ini === L || g.fin === L)) return 'gancho';
    var ejes = ejesMarcoSeccion(f, rol);
    if (ejes && (ejes[L] === 'u' || ejes[L] === 'v')) return 'marco';
    return null;
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
    // Δ POR DIMENSIÓN, EXTREMO DEL DESARROLLO (`anchor.delta = {ini, fin}`).
    // -------------------------------------------------------------------------
    // El Δ del lado DOMINANTE ya viene sumado a la dim (o sea el trazo YA es más
    // largo): lo que falta decidir es POR QUÉ PUNTA creció. Sin esto el centrado
    // reparte el Δ mitad y mitad — que es la respuesta a una pregunta que el
    // usuario no hizo: él dijo "extiende ESTE extremo", no "ensancha la barra
    // simétricamente".
    // Va por el MISMO canal que el empalme y no por uno nuevo a propósito: el
    // empalme es exactamente el mismo problema (largo extra que asoma por una
    // punta concreta) y su sesgo está calibrado desde hace tandas
    // (_normalizarCadena centra el bbox MENOS ini/fin, _cabezalLongitudinal hace
    // lo propio). Un segundo mecanismo paralelo se desincronizaría del primero.
    // Se suman en vez de sustituirse: una barra puede empalmar Y llevar Δ.
    // Lo que NO comparten es el aviso: reglas._avisarFueraDelHormigon sigue dando
    // holgura sólo por `empalme` — un Δ que saca la barra del hormigón TIENE que
    // avisar, porque no es un asome normativo sino una medida que el usuario
    // escribió y puede haberse pasado.
    var dl = (anchor && anchor.delta) || null;
    if (dl) { eIni += Number(dl.ini) || 0; eFin += Number(dl.fin) || 0; }
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
  // GANCHOS CON RADIO — la receta del estribo, GENERALIZADA (Tanda V)
  // ---------------------------------------------------------------------------
  // Un doblez TERMINAL de más de 90° (el gancho sísmico de 135°, o cualquier
  // retorno) no puede dibujarlo el fillet del motor: su tangencia
  // t = R·tan(g/2) supera el largo de la pata y el motor COLAPSA el radio (la
  // misma causa raíz que costó 3 días en el estribo). La solución probada del
  // estribo se aplica acá a CUALQUIER cadena abierta:
  //   · el arco es tangente al CUERPO con retranqueo R desde el vértice → su
  //     CRESTA toca EXACTO la línea del vértice y nunca la pasa («regla de la
  //     cresta»: el dibujo queda DENTRO de la envolvente de vértices, así que
  //     autos / extensiones / sobres —que miden la cadena de vértices— siguen
  //     siendo cotas válidas y ninguna receta se mueve);
  //   · la PATA cuelga COMPLETA, tangente a la salida del arco (no se come,
  //     que es lo otro que hace el fillet inscrito cuando no cabe).
  // Aplica SOLO a los dobleces de los EXTREMOS de una cadena ABIERTA (los
  // ganchos). Los interiores y los ≤ 90° quedan como están: el fillet inscrito
  // del motor los redondea bien y con los mismos endpoints. R = 2φ + φ/2, el
  // MISMO radio de eje del estribo (norma: mandril interno 2φ).
  // SOLO CAPA VISUAL: largo/peso salen de las dims en el backend, nunca de acá.
  function _ganchoFinal2D(pts, R0, sinClamp) {
    var n = pts.length;
    if (n < 3 || !(R0 > 0)) return pts;
    var i = n - 2;                                   // último vértice interior
    var A = pts[i - 1], V0 = pts[i], B = pts[i + 1];
    var d1u = V0.u - A.u, d1v = V0.v - A.v;
    var L1 = Math.hypot(d1u, d1v);
    var d2u = B.u - V0.u, d2v = B.v - V0.v;
    var L2 = Math.hypot(d2u, d2v);
    if (!(L1 > 1e-9) || !(L2 > 1e-9)) return pts;
    d1u /= L1; d1v /= L1; d2u /= L2; d2v /= L2;
    var dot = Math.max(-1, Math.min(1, d1u * d2u + d1v * d2v));
    var giro = Math.acos(dot);                       // 0..π (cuánto se desvía)
    if (giro <= Math.PI / 2 + 0.009) return pts;     // ≤ 90°: fillet del motor
    var s = (d1u * d2v - d1v * d2u) >= 0 ? 1 : -1;   // hacia dónde dobla
    // `sinClamp` = radio de NORMA constante, lo usa la capa de MEDICIÓN: con R
    // dependiente del largo del cuerpo la cuenta afín de los solvers dejaría de
    // ser afín. El dibujo sí clampa (un cuerpo más corto que R no se come).
    var R = sinClamp ? R0 : Math.min(R0, 0.49 * L1);
    // Tangencia en el cuerpo, retranqueo R desde el vértice (regla de la cresta).
    var T1 = { u: V0.u - d1u * R, v: V0.v - d1v * R };
    var O = { u: T1.u - d1v * s * R, v: T1.v + d1u * s * R };  // centro del arco
    var th0 = Math.atan2(T1.v - O.v, T1.u - O.u);
    var out = pts.slice(0, i);                       // el cuerpo, hasta A
    // Muestreo ~10°/punto en DOS tramos: [0°, 90°] y [90°, giro]. El punto de
    // barrido 90° es LA CRESTA (donde el arco toca la línea del vértice, o sea
    // donde la pieza SE APOYA en su marco/pila): tiene que estar EXACTO en la
    // lista, no aproximado por el muestreo — la jerarquía de caras mide ahí.
    var g1 = Math.PI / 2, g2 = giro - g1;
    var n1 = Math.max(4, Math.ceil(g1 / (Math.PI / 18)));
    var n2 = Math.max(4, Math.ceil(g2 / (Math.PI / 18)));
    var k;
    for (k = 0; k <= n1; k++) {
      var a1 = th0 + s * g1 * (k / n1);
      out.push({ u: O.u + R * Math.cos(a1), v: O.v + R * Math.sin(a1), esArco: true });
    }
    for (k = 1; k <= n2; k++) {
      var a2 = th0 + s * (g1 + g2 * (k / n2));
      out.push({ u: O.u + R * Math.cos(a2), v: O.v + R * Math.sin(a2), esArco: true });
    }
    // La pata, ÍNTEGRA, tangente a la salida (la salida del arco ES d2: girar d1
    // en s·giro devuelve exactamente la dirección del trazo de vértices).
    var q = out[out.length - 1];
    out.push({ u: q.u + d2u * L2, v: q.v + d2v * L2 });
    return out;
  }
  function _rev2D(pts) { return pts.slice().reverse(); }
  // `iCuerpo` = índice del TRAMO que hace de CUERPO cuando la cadena tiene UN SOLO
  // doblez (3 puntos). Ver el porqué justo abajo; el resto de los casos lo ignora.
  //
  // CUERPO vs PATA CON UN SOLO DOBLEZ (defecto bloqueante medido 13-ago).
  // ---------------------------------------------------------------------------
  // `_ganchoFinal2D` NO es simétrico y no puede serlo: retranquea R sobre el
  // CUERPO (que se queda donde está) y cuelga la PATA COMPLETA desde la salida
  // del arco (que por lo tanto se DESPLAZA R respecto de la cadena de vértices).
  // Con 4+ puntos la elección es obvia y la hacen los dos pases: el directo toma
  // como cuerpo el tramo INTERIOR del extremo final y el inverso el del inicial.
  // Con exactamente 3 puntos (2 tramos) NO HAY tramo interior: los dos lados son
  // terminales y el único doblez lo consume el primer pase que llegue — el
  // directo, que se queda con el PRIMER tramo como cuerpo. Cuando el lado
  // DOMINANTE es el segundo (una 102B: A = gancho de 135°, B = cuerpo), el
  // dominante pasaba a ser "la pata" y salía desplazado R = 2φ + φ/2 respecto de
  // su anclaje: el eje de la barra larga quedaba 2.5·φ POR ENCIMA del
  // recubrimiento. MEDIDO en viga 600×60×30 rec 4, CBS 102B todo auto, pose
  // default: ancla y = 25.2 y la barra dibujada en y = 29.2 (φ16, 4.0 = 2.5·φ)
  // → la CARA del fierro justo en y = 30, o sea recubrimiento CERO; con φ32,
  // 4.0 cm FUERA del hormigón, y en el muro de 20 hasta 5.5 cm fuera, sin un
  // solo aviso y facturando la barra.
  // El cuerpo tiene que ser el DOMINANTE: es el lado que se ancla contra la cara,
  // el que el auto-largo estira y el que recibe el empalme — o sea el que NO
  // puede moverse. Lo sabe el llamador (que acaba de orientar la cadena), no esta
  // función: por eso viaja como parámetro y no se adivina por largos.
  function _conGanchosRadio(pts, diamCm, cerrada, sinClamp, iCuerpo) {
    if (!pts || pts.length < 3 || cerrada) return pts;
    var R = 2 * diamCm + diamCm / 2;   // radio del EJE del codo (= estribo)
    if (!(R > 0)) return pts;
    // UN SOLO DOBLEZ con el dominante al FINAL → sólo el pase INVERSO (ahí el
    // cuerpo es el 2º tramo y la pata el 1º). El pase directo posterior sería un
    // no-op (el último vértice interior ya es un punto de arco, giro ≈ 10°), así
    // que se omite en vez de dejarlo por simetría.
    if (pts.length === 3 && iCuerpo === 1) {
      return _rev2D(_ganchoFinal2D(_rev2D(pts), R, sinClamp));
    }
    // Extremo final directo; extremo inicial procesado en REVERSA, para que el
    // "cuerpo" del algoritmo sea siempre el lado interior y la pata la que
    // cuelga (en el gancho inicial la pata es el PRIMER tramo).
    return _rev2D(_ganchoFinal2D(_rev2D(_ganchoFinal2D(pts, R, sinClamp)), R, sinClamp));
  }

  // ===========================================================================
  // ÁNGULO POR BARRA — EL CATÁLOGO SUGIERE, EL COMPONENTE DECIDE
  // ===========================================================================
  // Definición del usuario, textual: «el catálogo define un ángulo SUGERIDO; cuando
  // creamos algo, ese ángulo viene por defecto; si lo modificamos, ESE es el nuevo
  // valor. No debo girar el ángulo, sólo desplazarme entre los rangos (0-90 /
  // 90-180). No hay ángulo negativo — ahí ya es otra figura. Sólo debo ver variar la
  // POSICIÓN del gancho. El largo total debe seguir siendo el mismo.»
  //
  // De ahí salen las tres reglas de este bloque, y ninguna es una interpretación:
  //
  //  1. EL LARGO NO SE TOCA. El ángulo entra como GIRO en `_cadena2D`, que decide la
  //     DIRECCIÓN del tramo; el LARGO de cada tramo lo sigue dando su dim. Por
  //     construcción, mover un ángulo no puede cambiar ni un lado ni el largo de
  //     corte ni los kg: mueve la punta, no la barra. (Con dims 'auto' sí cambian,
  //     y debe ser así: el 'auto' es una respuesta al hormigón y la figura cambió de
  //     forma. Lo que se conserva siempre es que dims y trazo salgan del MISMO
  //     número — que es lo único que este motor no puede permitirse romper.)
  //
  //  2. EL RANGO ES EL DE SU PROPIO DOBLEZ. El valor del catálogo es el que MANDA el
  //     rango: si nace ≤ 90° se mueve en (0, 90]; si nace > 90° se mueve en [90,
  //     180). Fuera de ahí NO se aproxima ni se recorta: se IGNORA (queda el del
  //     catálogo) y se AVISA, porque cruzar el rango es otra figura — un gancho de
  //     135° convertido en un quiebre de 45° deja de cerrar el estribo, y eso no es
  //     "el mismo fierro un poco distinto".
  //     Los extremos abiertos (0 y 180) tampoco entran: 0 = el tramo sigue recto (no
  //     hay doblez) y 180 = la pata se pliega sobre el cuerpo. Los dos describen una
  //     figura que no existe en el catálogo.
  //
  //  3. QUÉ ÁNGULO ES EL 1/2/3/4 LO DICE EL CATÁLOGO, NO ESTE MÓDULO. El mapa
  //     slot → doblez se LEE de la misma fuente que produjo la lista de ángulos:
  //       · figura del SEED (sin geometría) → la colocación de `derivarTramos`
  //         (α1 en el primer doblez, α2 en el último, el resto hacia adentro);
  //       · figura DIBUJADA en el Diseñador → el mismo filtro con que el diseñador
  //         escribió la lista (los dobleces ESPECIALES, ≠90 y ≠0, en orden de
  //         trazado).
  //     Inventar un orden acá pondría el α del gancho sobre una esquina de 90°.
  //
  // LA IDENTIDAD DE LA FIGURA NO LA MUEVE EL ÁNGULO POR BARRA — y es deliberado.
  // ---------------------------------------------------------------------------
  // Quién dibuja la figura (`familiaDeDibujo`), si es un contorno CERRADO
  // (`_esPerimetro`, `esEstriboConGanchos`), cuáles son sus pares espejo y qué lados
  // son elegibles como dominante SE SIGUEN LEYENDO DEL CATÁLOGO, con los ángulos del
  // catálogo. El override sólo entra donde se produce GEOMETRÍA (el trazo y todo lo
  // que se mide sobre él). Por eso las funciones de identidad llaman a
  // `tramosDeFigura(f)` pelado y las de geometría le pasan el override.
  // El motivo es el enunciado del propio usuario: mientras el ángulo se mueva DENTRO
  // de su rango sigue siendo LA MISMA figura. Si la identidad siguiera al override,
  // bajar un gancho de 135° a 130° convertiría un estribo en una cadena abierta —
  // otro constructor, otro anclaje, otro reparto— por mover un control fino.
  //
  // DÓNDE NO MUEVE NADA (y hay que decirlo): el marco cerrado (`_estriboPerimetral`),
  // el rombo y la traba clásica NO leen ángulos — su forma la manda el MARCO de
  // núcleo y su gancho es el arco sísmico calibrado. Un override ahí es mudo, así que
  // `trazoLeeAngulos` lo declara y reglas.js lo AVISA en vez de dejar al usuario
  // moviendo un número que no mueve la barra.
  function angulosCatalogo(figura) {
    var spec = _spec(figura);
    if (!spec) return null;
    return (spec.angulos || []).map(Number);
  }

  // Mapa slot de ángulo → índice de DOBLEZ (0 = el primer doblez de la cadena), o
  // -1 si ese slot no cae en ningún doblez. Lo consume la UI para decir "α2 es este
  // vértice" y lo consume `_aplicarAngDibujo` para colocar el override.
  //
  // COLOCACIÓN DEL SEED: es EXACTAMENTE la de `derivarTramos` (α1 en el primer
  // doblez, α2 en el último, α3+ hacia adentro desde el segundo). Se escribe una
  // sola vez acá y derivarTramos ya no la duplica: si alguna vez cambia, cambian las
  // dos a la vez o ninguna.
  function _mapaAngSeed(dobleces, nAng) {
    var m = [], i;
    for (i = 0; i < nAng; i++) m.push(-1);
    if (dobleces >= 1 && nAng >= 1) m[0] = 0;
    if (dobleces >= 2 && nAng >= 2) m[1] = dobleces - 1;
    for (i = 2; i < nAng && (i - 1) < dobleces - 1; i++) m[i] = i - 1;
    return m;
  }

  // COLOCACIÓN DE UNA FIGURA DIBUJADA: el diseñador guarda en `angulos` sólo los
  // dobleces ESPECIALES (giro ≠ 90 y ≠ 0), en orden de trazado — ver
  // disenador.js::_guardarFigura. Se lee el mismo filtro para saber a qué vértice
  // corresponde cada α.
  function _mapaAngDibujo(tramos, nAng) {
    var m = [], i, g;
    for (i = 1; i < tramos.length; i++) {
      g = Math.abs(Number(tramos[i] && tramos[i].giro) || 0);
      if (g !== 90 && g !== 0) m.push(i - 1);
    }
    while (m.length < nAng) m.push(-1);
    return m.slice(0, Math.max(nAng, 0));
  }

  function mapaAngulosFigura(figura) {
    var spec = _spec(figura);
    if (!spec) return null;
    var nAng = (spec.angulos || []).length;
    var geo = spec.geometria;
    var t = (geo && geo.tramos && geo.tramos.length) ? geo.tramos : null;
    if (t) return _mapaAngDibujo(t, nAng);
    return _mapaAngSeed((spec.parciales || []).length - 1, nAng);
  }

  // Rango en el que puede moverse el ángulo `i` de esta figura → {lo, hi} o null.
  // Lo fija el valor del CATÁLOGO (el sugerido): es SU doblez el que tiene rango.
  function rangoAngulo(figura, i) {
    var cat = angulosCatalogo(figura);
    if (!cat) return null;
    var k = Number(i);
    if (!(k >= 0) || k >= cat.length) return null;
    var base = Number(cat[k]);
    if (!(base > 0) || !(base < 180)) return null;
    return (base <= 90) ? { lo: 0, hi: 90 } : { lo: 90, hi: 180 };
  }

  // ¿Puede el ángulo `i` de esta figura valer `valor`?
  //   { ok, valor, base, motivo, vacio }
  // `vacio` = el slot no trae override (null / '' ) → NO es un error y NO avisa:
  // es el caso normal de una receta que sólo toca uno de sus ángulos.
  // `motivo` es texto de usuario: reglas.js lo pega tal cual en el aviso.
  function validarAngulo(figura, i, valor) {
    var spec = _spec(figura);
    var vacio = (valor == null || valor === '');
    var k = Number(i);
    if (!spec) {
      return { ok: false, valor: null, base: null, vacio: vacio,
        motivo: vacio ? null : 'la figura no está en el catálogo' };
    }
    var cat = angulosCatalogo(figura) || [];
    var base = (k >= 0 && k < cat.length) ? Number(cat[k]) : null;
    if (vacio) return { ok: false, valor: null, base: base, vacio: true, motivo: null };
    if (base == null) {
      return { ok: false, valor: null, base: null, vacio: false,
        motivo: 'la figura ' + spec.codigo + ' declara ' + cat.length + ' ángulo' +
          (cat.length === 1 ? '' : 's') + ': no existe el ' + (k + 1) };
    }
    var v = Number(valor);
    if (!isFinite(v)) {
      return { ok: false, valor: null, base: base, vacio: false,
        motivo: '"' + valor + '" no es un número' };
    }
    var r = rangoAngulo(figura, k);
    if (!r) {
      return { ok: false, valor: null, base: base, vacio: false,
        motivo: 'el ángulo ' + (k + 1) + ' del catálogo vale ' + base + '°, que no ' +
          'describe un doblez: no hay rango en el que moverlo' };
    }
    // Extremos ABIERTOS: 0 = sin doblez, 180 = la pata plegada sobre el cuerpo.
    // El 90 es la frontera y pertenece a los dos rangos (es un doblez legítimo en
    // cualquiera de ellos).
    var dentro = (r.lo === 0) ? (v > 0 && v <= 90) : (v >= 90 && v < 180);
    if (!dentro) {
      return { ok: false, valor: null, base: base, vacio: false,
        motivo: v + '° se sale del rango de su doblez (' + r.lo + '–' + r.hi +
          '°, el que le da su ángulo de catálogo ' + base + '°): cambiar de rango ' +
          'sería otra figura' };
    }
    return { ok: true, valor: v, base: base, vacio: false, motivo: null };
  }

  // Ángulos EFECTIVOS de una barra = los del catálogo con los overrides VÁLIDOS
  // aplicados. Siempre devuelve un array del LARGO DEL CATÁLOGO: es lo que viaja a
  // ang1..ang4 del despiece y lo que consume la derivación de tramos, así que no
  // puede tener más ni menos slots que la figura.
  // Sin override (null, [] o todo vacío) devuelve el catálogo tal cual → todo lo que
  // dependa de esto queda BYTE-IDÉNTICO a antes de esta tanda.
  function angulosEfectivos(figura, ovr) {
    var cat = angulosCatalogo(figura);
    if (!cat) return [];
    var out = cat.slice();
    if (!ovr || !ovr.length) return out;
    for (var i = 0; i < ovr.length && i < out.length; i++) {
      var v = validarAngulo(figura, i, ovr[i]);
      if (v.ok) out[i] = v.valor;
    }
    return out;
  }

  // ¿Hay algún override que CAMBIE algo respecto del catálogo? Fuente única para
  // que reglas.js decida si el anchor/las medidas estrenan el canal del override:
  // sin cambio efectivo, ni se escribe (y la ruta queda la de siempre).
  function angulosCambian(figura, ovr) {
    var cat = angulosCatalogo(figura);
    if (!cat || !ovr || !ovr.length) return false;
    var ef = angulosEfectivos(figura, ovr);
    for (var i = 0; i < cat.length; i++) if (Number(ef[i]) !== Number(cat[i])) return true;
    return false;
  }

  // ¿El TRAZO de esta figura lee los ángulos? Sólo la cadena genérica los honra: el
  // marco cerrado, el rombo y la traba clásica derivan su forma del MARCO de núcleo
  // y su gancho es el arco sísmico calibrado. Un override en esas familias mueve la
  // dim (si el usuario también toca la dim) pero NO el dibujo, y eso hay que decirlo
  // — es exactamente la clase de defecto (medir ≠ dibujar) que este motor persigue.
  function trazoLeeAngulos(figura, rol) {
    return familiaDeDibujo(figura, rol || null) === 'cadena';
  }

  // Aplica el override sobre unos tramos DIBUJADOS (los del Diseñador): clona y
  // reescribe el `giro` del doblez que le toca a cada slot, conservando el
  // `sentido` (el override mueve la MAGNITUD del doblez, no la mano de la figura).
  function _aplicarAngDibujo(figura, tramos, ovr) {
    var mapa = mapaAngulosFigura(figura);
    if (!mapa || !mapa.length) return tramos;
    var out = null, i, d, v;
    for (i = 0; i < ovr.length && i < mapa.length; i++) {
      d = mapa[i];
      if (!(d >= 0) || (d + 1) >= tramos.length) continue;
      v = validarAngulo(figura, i, ovr[i]);
      if (!v.ok) continue;
      if (!out) out = tramos.map(function (t) {
        return { lado: t.lado, giro: t.giro, sentido: t.sentido, tipo: t.tipo, radio: t.radio };
      });
      out[d + 1].giro = v.valor;
    }
    return out || tramos;
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
  // `angOvr` (2º arg, opcional) = los ángulos POR BARRA del componente. Entra por el
  // mismo sitio que los del catálogo —la lista `A`— y no por una rama aparte: así el
  // mapa slot → doblez es literalmente el mismo (_mapaAngSeed lo describe), y un
  // override sin cambios efectivos produce la MISMA cadena, tramo por tramo.
  function derivarTramos(figura, angOvr) {
    var spec = _spec(figura);
    if (!spec) return null;
    var P = spec.parciales || [];
    if (!P.length) return null;
    var A = angulosEfectivos(figura, angOvr).filter(isFinite);
    var n = P.length, dobleces = n - 1, i;
    var giros = [];
    for (i = 0; i < dobleces; i++) giros.push(90);
    var mapa = _mapaAngSeed(dobleces, A.length);
    for (i = 0; i < A.length; i++) if (mapa[i] >= 0) giros[mapa[i]] = A[i];
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
  // `angOvr` (2º arg, opcional) = los ángulos POR BARRA. Se aplica en las DOS rutas
  // y por eso está acá y no dentro de `derivarTramos`: una figura DIBUJADA en el
  // Diseñador manda con sus tramos, y sin este paso el ángulo del componente sería
  // mudo justo en las figuras que el usuario dibujó a mano (que son las que más va a
  // querer ajustar). El mapa slot → doblez de esa ruta lo da `mapaAngulosFigura`,
  // leído del mismo filtro con el que el diseñador escribió la lista.
  function tramosDeFigura(figura, angOvr) {
    var spec = _spec(figura);
    if (!spec) return null;
    var geo = spec.geometria;
    var t = (geo && geo.tramos && geo.tramos.length) ? geo.tramos : null;
    var fuente = 'disenador';
    if (!t) { t = derivarTramos(figura, angOvr); fuente = 'derivado'; }
    else if (angOvr && angOvr.length) t = _aplicarAngDibujo(figura, t, angOvr);
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

  function _normalizarCadena(c, anchor, tramos, ladoL, diamCm) {
    var i;
    var or = _orientarCadena(c, tramos, ladoL);
    var out = or.pts, iL = or.iLong;
    var cerrada = _cadenaCierra(out);
    // GANCHOS CON RADIO (Tanda V) — ANTES de centrar: la pata de un gancho >90°
    // cuelga del arco desplazada, así que el bbox REAL de la pieza es el del
    // trazo arqueado. Centrar el de vértices y arquear después dejaba la pieza
    // corrida (la reserva de sobres —que ya mide con arcos— y el centrado leían
    // dos bboxes distintos). La orientación sí corre antes: necesita el índice
    // tramo↔punto, que el pase de ganchos rompe.
    // iL = índice del tramo DOMINANTE (el que _orientarCadena acaba de dejar sobre
    // +u y en v = 0): con un solo doblez es el que tiene que hacer de CUERPO para
    // no despegarse de su anclaje (ver la nota de _conGanchosRadio).
    out = _conGanchosRadio(out, diamCm, cerrada, false, iL);
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
    // ÁNGULO POR BARRA: viaja en el anchor (`anchor.angulos`), igual que el lado
    // dominante elegido y por la misma razón — reglas.js lo escribe YA VALIDADO y
    // es el MISMO valor con el que acaba de resolver las dims, así que el dibujo y
    // la medida no pueden divergir. Ausente = catálogo, ruta idéntica a la de antes.
    var tr = tramosDeFigura(figura, anchor && anchor.angulos);
    // Sin tramos no hay cadena: red de seguridad (dibujabilidad ya la excluyó),
    // nunca un dibujo inventado.
    if (!tr) return _cabezalLongitudinal(figura, dims, host, anchor, diamCm);
    // Un lado sin dimensión toma la extensión de gancho normativa (6φ, mín 7.5),
    // la MISMA que usa reglas.js para las patas en 'auto'.
    var c = _cadena2D(tr.tramos, dims, extGancho(diamCm));
    // DIBUJO Y MEDIDA, EL MISMO DOMINANTE. El override del componente viaja en el
    // anchor (reglas._baseDeComponente lo escribe YA VALIDADO): si el trazador
    // leyera la cascada pelada mientras reglas._dimsEfectivas estira el lado
    // elegido, la barra se dibujaría con un dominante y se mediría con otro.
    var ladoL = ladoDominanteFigura(figura, anchor && anchor.ladoDominante);
    // PLANO DE TRABAJO SEGÚN EL ROL (fix 305A): una pieza de SECCIÓN (estribo /
    // traba) vive en el plano ⊥ al rumbo, no en el longitudinal. Es el mismo plano
    // (y,z) del marco de núcleo que ya usan _estriboPerimetral y _traba: la cadena
    // entra ahí sin inventar un sistema nuevo.
    if (rol === 'estribo' || rol === 'traba') {
      return _cadenaSeccion(c, host, anchor, diamCm);
    }
    var pw = _planoTrabajo(host, anchor);
    // Los ganchos con radio entran DENTRO de la normalización (tras orientar,
    // antes de centrar): el bbox que se centra es el del trazo arqueado.
    var nrm = _normalizarCadena(c, anchor, tr.tramos, ladoL, diamCm);
    return nrm.pts.map(function (p) {
      var q = pw.P(p.u, p.v);
      if (p.esArco) q.esArco = true;
      return q;
    });
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
    // GANCHOS CON RADIO (Tanda V), ANTES del centrado: el 'auto', la extensión y
    // el anidado ya miden el trazo ARQUEADO (la pata del gancho >90° cuelga del
    // arco desplazada), así que el bbox que se centra en el marco tiene que ser
    // ese mismo — centrar el de vértices dejaba la pieza corrida ~R y la punta
    // invadía el recubrimiento que el solver acababa de prometer.
    var pts = _conGanchosRadio(c.pts, diamCm, _cadenaCierra(c.pts)), i;
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
      var q = V(xx, cy + (p.v - cv), cz + mu * (p.u - cu));
      if (p.esArco) q.esArco = true;
      return q;
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
  // `angOvr` (3er arg, opcional): la dirección de cada tramo sale de los GIROS, así
  // que si el componente movió un ángulo esta clasificación TIENE que moverse con
  // él — si no, el 'auto' mediría contra la dimensión equivocada del hormigón (el
  // defecto D1, 11 cm de fierro fuera). `familiaDeDibujo` sigue leyendo el catálogo:
  // QUIÉN dibuja la figura es identidad, no geometría.
  function ejesCadenaSeccion(figura, rol, angOvr) {
    var f = (figura || '').toUpperCase();
    if (familiaDeDibujo(f, rol || 'estribo') !== 'cadena') return null;
    var tr = tramosDeFigura(f, angOvr);
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
  function autosCadenaSeccion(figura, dimsBase, ejes, util, diamCm, angOvr) {
    var tr = tramosDeFigura((figura || '').toUpperCase(), angOvr);
    if (!tr || !ejes) return { u: util.u, v: util.v };
    // Coordenadas del trazo sobre `eje` con TODOS los lados auto de ese eje en t.
    // Los del otro eje quedan en 0: corren perpendicular y no mueven esta cuenta
    // (las diagonales, que sí mueven las dos, vienen resueltas en dimsBase).
    // CON GANCHOS DE RADIO (Tanda V): el trazo que se hace caber es el DIBUJADO
    // (arcos incluidos). Sigue siendo afín en t: las direcciones salen de los
    // GIROS y el radio es constante (sin clamp), así que cada punto del arco es
    // el vértice (afín) más un desplazamiento fijo.
    function coords(eje, t) {
      var d = {}, k;
      for (k in dimsBase) {
        if (Object.prototype.hasOwnProperty.call(dimsBase, k)) d[k] = dimsBase[k];
      }
      for (k in ejes) {
        if (!Object.prototype.hasOwnProperty.call(ejes, k) || d[k] != null) continue;
        // Los autos del eje MEDIDO valen t. Los del OTRO eje valen 1, NO 0: sobre
        // esta coordenada no mueven nada (corren perpendicular), pero con largo 0
        // degeneran su tramo y el pase de ganchos NO vería ese doblez — el arco
        // aparecería en el dibujo real y no en este modelo (medido: el auto
        // resolvía 24 y el trazo real ocupaba 25.99, un radio entero más).
        d[k] = (ejes[k] === eje) ? t : 1;
      }
      var c = _cadena2D(tr.tramos, d, 0);
      var pts = _conGanchosRadio(c.pts, diamCm || 0, _cadenaCierra(c.pts), true);
      var out = [], i;
      for (i = 0; i < pts.length; i++) out.push((eje === 'u') ? pts[i].u : pts[i].v);
      return out;
    }
    function resolver(eje, ut) {
      // Se muestrea en t = 1 y t = 2 (NUNCA en t = 0: un lado auto de largo 0
      // degenera su tramo y el pase de ganchos no vería el doblez en esa muestra
      // — las dos listas quedarían desalineadas). a se reconstruye por afinidad.
      var c1 = coords(eje, 1), c2 = coords(eje, 2), a = [], b = [], i;
      for (i = 0; i < c1.length; i++) { b.push(c2[i] - c1[i]); a.push(c1[i] - b[i]); }
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
  function insetCadenaSeccion(figura, dims, delta, rol, diamCm, angOvr) {
    var f = (figura || '').toUpperCase();
    var tr = tramosDeFigura(f, angOvr);
    var ejes = ejesCadenaSeccion(f, rol || 'estribo', angOvr);
    if (!tr || !ejes) return null;
    var d = Number(delta) || 0, k;
    // Coordenadas del trazo sobre `eje` con TODOS sus lados retirados `s`.
    // CON GANCHOS DE RADIO (Tanda V): misma regla que el 'auto' — la extensión
    // que se encoge 2δ es la del trazo DIBUJADO (arcos incluidos, radio sin
    // clamp). Afín en s por la misma razón (direcciones de los giros, R fijo).
    function coords(eje, s) {
      var dd = {}, kk;
      for (kk in dims) if (Object.prototype.hasOwnProperty.call(dims, kk)) dd[kk] = dims[kk];
      for (kk in ejes) {
        if (Object.prototype.hasOwnProperty.call(ejes, kk) && ejes[kk] === eje) {
          dd[kk] = Number(dims[kk]) - s;
        }
      }
      var c = _cadena2D(tr.tramos, dd, 0);
      var pts = _conGanchosRadio(c.pts, diamCm || 0, _cadenaCierra(c.pts), true);
      var out = [], i;
      for (i = 0; i < pts.length; i++) out.push((eje === 'u') ? pts[i].u : pts[i].v);
      return out;
    }
    function retiro(eje) {
      // Muestras en s = 0 (dims reales, tramos vivos) y s = −1 (los lados CRECEN:
      // jamás degeneran un tramo, cosa que s = +1 sí puede hacer con un lado de
      // 1 cm — y un tramo degenerado saltaría el gancho en UNA de las muestras).
      var a = coords(eje, 0), cm1 = coords(eje, -1), b = [], i;
      var mx = -Infinity, mn = Infinity;
      for (i = 0; i < a.length; i++) {
        b.push(a[i] - cm1[i]);
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
  function extensionCadenaSeccion(figura, dims, diamCm, angOvr) {
    var tr = tramosDeFigura((figura || '').toUpperCase(), angOvr);
    if (!tr) return null;
    var c = _cadena2D(tr.tramos, dims, extGancho(diamCm));
    // CON GANCHOS DE RADIO (Tanda V): se mide lo que se DIBUJA. La pata de un
    // gancho >90° cuelga del arco desplazada hacia el lado del giro — medir la
    // cadena de vértices reservaba de menos y la punta invadía el recubrimiento.
    // Radio SIN clamp: cota ≥ que el dibujo (que sí clampa en cuerpos cortos).
    var pts = _conGanchosRadio(c.pts, diamCm, _cadenaCierra(c.pts), true);
    var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, i;
    for (i = 0; i < pts.length; i++) {
      if (pts[i].u < minU) minU = pts[i].u;
      if (pts[i].u > maxU) maxU = pts[i].u;
      if (pts[i].v < minV) minV = pts[i].v;
      if (pts[i].v > maxV) maxV = pts[i].v;
    }
    return { u: maxU - minU, v: maxV - minV };
  }

  // ==========================================================================
  // AUTO UNIVERSAL POR DIRECCIÓN-EN-POSE (feedback de raíz 13-ago)
  // ==========================================================================
  // El 'auto' de un lado NO depende de la letra ni del rol: depende de QUÉ CRUZA
  // su dirección en la pose actual. Para las piezas de sección eso ya existe
  // (ejesCadenaSeccion). Esto es el ESPEJO para la pieza LONGITUDINAL (rol
  // cabezal): los lados se clasifican RELATIVO AL DOMINANTE (que el dibujo pone
  // a lo largo, +u):
  //   'u' → corre a lo largo (el dominante; un retorno paralelo NO mide nada)
  //   'v' → PERPENDICULAR al largo: cruza la PROFUNDIDAD hacia el núcleo (en un
  //         muro, el espesor). Su 'auto' es la profundidad útil — la fórmula
  //         universal del estribo (espesor − recubs, eje a eje), no el gancho.
  //   'd' → diagonal: pata/gancho inclinado → extensión de gancho normativa.
  // Antes TODO lado no-longitudinal caía al gancho: en la viga coincide (patas
  // cortas), en el muro no — la pata que cruza el espesor quedaba 9.6 fija o
  // se pasaba de largo, y "cambiar todo a auto no cambiaba nada" (medido:
  // MH 104B φ16 en muro de 20: profundidad dibujada 16.4 en un núcleo de 14.2).
  // `ladoDomOvr` (opcional) = el dominante ELEGIDO por el componente. La
  // clasificación u/v/d es RELATIVA al dominante, así que si el usuario cambia el
  // dominante cambian los ejes de todos los demás lados: leerla con la cascada
  // pelada mientras el resto del motor usa el elegido daría un 'auto' medido
  // contra la dimensión equivocada del hormigón.
  function ejesCadenaLong(figura, ladoDomOvr, angOvr) {
    var f = (figura || '').toUpperCase();
    var tr = tramosDeFigura(f, angOvr);
    if (!tr) return null;
    var ladoDom = ladoDominanteFigura(f, ladoDomOvr);
    var heading = 0, hDom = null, i, t, g;
    var hs = [];
    for (i = 0; i < tr.tramos.length; i++) {
      t = tr.tramos[i];
      if (i > 0) {
        g = Number(t.giro) || 0;
        if (t.sentido === 'der') g = -g;      // misma convención que _cadena2D
        heading += g;
      }
      hs.push(heading);
      if (t.lado === ladoDom && hDom == null) hDom = heading;
    }
    if (hDom == null) hDom = hs[0] || 0;
    var out = {};
    for (i = 0; i < tr.tramos.length; i++) {
      t = tr.tramos[i];
      if (t.lado == null || out[t.lado] != null) continue;
      var a = (((hs[i] - hDom) % 180) + 180) % 180;   // dirección relativa, sin sentido
      out[t.lado] = (a < 1e-6 || Math.abs(a - 180) < 1e-6) ? 'u'
        : (Math.abs(a - 90) < 1e-6 ? 'v' : 'd');
    }
    return out;
  }

  // Cuánto debe medir cada lado 'v' en auto para que la PROFUNDIDAD del trazo
  // (⊥ al dominante) quepa EXACTO en `utilV` (eje a eje). La misma cuenta exacta
  // del 'auto' de sección (_intervaloCabe sobre el trazo ARQUEADO, afín en t),
  // medida en el marco del DOMINANTE: se rota el trazo para dejarlo sobre +u —
  // que es lo que hace el dibujo (_orientarCadena) — y se acota la extensión v.
  function autoProfundidadLong(figura, dimsBase, utilV, diamCm, ladoDomOvr, angOvr) {
    var f = (figura || '').toUpperCase();
    var tr = tramosDeFigura(f, angOvr);
    var ejes = ejesCadenaLong(f, ladoDomOvr, angOvr);
    if (!tr || !ejes) return null;
    var ladoDom = ladoDominanteFigura(f, ladoDomOvr);
    var iL = -1, i;
    for (i = 0; i < tr.tramos.length; i++) {
      if (tr.tramos[i].lado === ladoDom) { iL = i; break; }
    }
    if (iL < 0) return null;
    function coordsV(t) {
      var d = {}, k;
      for (k in dimsBase) if (Object.prototype.hasOwnProperty.call(dimsBase, k)) d[k] = dimsBase[k];
      for (k in ejes) {
        if (!Object.prototype.hasOwnProperty.call(ejes, k) || d[k] != null) continue;
        d[k] = (ejes[k] === 'v') ? t : 1;   // 1 > 0: un tramo degenerado saltaría su gancho
      }
      var c = _cadena2D(tr.tramos, d, 0);
      var a2 = c.pts[iL], b2 = c.pts[iL + 1];
      var ang = Math.atan2(b2.v - a2.v, b2.u - a2.u);
      var co = Math.cos(-ang), si = Math.sin(-ang);
      var rot = c.pts.map(function (p) {
        return { u: (p.u - a2.u) * co - (p.v - a2.v) * si, v: (p.u - a2.u) * si + (p.v - a2.v) * co };
      });
      var pts = _conGanchosRadio(rot, diamCm || 0, _cadenaCierra(rot), true, iL);
      var out = [];
      for (var j = 0; j < pts.length; j++) out.push(pts[j].v);
      return out;
    }
    var c1 = coordsV(1), c2 = coordsV(2), a = [], b = [];
    for (i = 0; i < c1.length; i++) { b.push(c2[i] - c1[i]); a.push(c1[i] - b[i]); }
    var iv = _intervaloCabe(a, b, utilV);
    return iv.acotaSup ? iv.hi : utilV;
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
  // `ladoDomOvr` (opcional) = el dominante ELEGIDO por el componente. Sólo puede
  // cambiar la RESPUESTA 'A'…'I': una cadena CERRADA sigue devolviendo null aunque
  // la receta traiga un override (no hay lado que estirar, y el override ya lo
  // rechaza validarLadoDominante por contorno cerrado).
  function ladoLongitudinalCadena(figura, dims, ladoDomOvr) {
    var f = (figura || '').toUpperCase();
    var spec = _spec(f);
    if (!spec || familiaDeDibujo(f, null) !== 'cadena') return undefined;
    var tr = tramosDeFigura(f);
    if (!tr) return undefined;
    // Con dims sin resolver el trazado es TOPOLÓGICO (todos los lados = 1): sirve
    // igual para saber si la cadena cierra, que es lo único que se decide sin dims.
    var c = _cadena2D(tr.tramos, _dimsNumericas(dims), 1);
    if (_cadenaCierra(c.pts)) return null;
    return ladoDominanteFigura(f, ladoDomOvr);
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
  function sobresCadena(figura, dims, ladoLPref, diamCm, angOvr) {
    var f = (figura || '').toUpperCase();
    if (familiaDeDibujo(f, null) !== 'cadena') return { ini: 0, fin: 0 };
    var tr = tramosDeFigura(f, angOvr);
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
    // marco girado: el longitudinal corre en +u. El marco (a, ang, extremo b) se
    // toma de la cadena de VÉRTICES (los índices tramo↔punto valen ahí)…
    var a = c.pts[iL], b = c.pts[iL + 1];
    var ang = Math.atan2(b.v - a.v, b.u - a.u);
    var cos = Math.cos(-ang), sin = Math.sin(-ang);
    function ux(p) { return (p.u - a.u) * cos - (p.v - a.v) * sin; }
    // …y lo que asoma se mide sobre el trazo DIBUJADO (ganchos con radio, Tanda
    // V): la punta de un gancho >90° cuelga del arco desplazada, y reservar los
    // sobres de la cadena de vértices dejaba esa punta fuera de la reserva.
    var pts = _conGanchosRadio(c.pts, diamCm || 0, _cadenaCierra(c.pts), true, iL);
    var minU = 0, maxU = ux(b);
    for (var k = 0; k < pts.length; k++) {
      var u = ux(pts[k]);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
    }
    // MEDIO DIÁMETRO EN EL EXTREMO CON DOBLEZ (feedback de raíz 13-ago). El eje
    // del doblez llegaba JUSTO al recub de extremo y la SUPERFICIE del codo lo
    // pasaba φ/2 ("hiciste llegar el eje al recubrimiento"): la cresta del
    // gancho debe quedar EN LÍNEA con el recub, o sea el eje a recub + φ/2 — la
    // misma regla del estribo. Una punta RECTA no descuenta nada: la barra
    // termina plana y su cara axial ES la punta (101A intacta).
    var rphi = (diamCm || 0) / 2;
    return {
      ini: Math.max(0, -minU) + (iL > 0 ? rphi : 0),
      fin: Math.max(0, maxU - ux(b)) + (iL < tr.tramos.length - 1 ? rphi : 0)
    };
  }

  // Radiografía de la cadena de una figura (para tests, avisos y la UI):
  // { fuente, tramos, giros, cerrada, ladoLong }.
  function cadenaInfo(figura, dims, angOvr) {
    var tr = tramosDeFigura(figura, angOvr);
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
    // Δ POR DIMENSIÓN EN UNA PIEZA DE SECCIÓN (`anchor.marcoDelta = {alto,ancho}`).
    // -------------------------------------------------------------------------
    // Una pieza de sección CERRADA (104x, 106x) NO se dibuja con sus dims: su forma
    // la manda el MARCO ("el marco manda la forma", fix 13-ago) y las dims que se
    // listan se DERIVAN de él. Por eso un Δ que sólo sumara a la dim movía el largo
    // de corte y los kg y dejaba el trazo 3D EXACTAMENTE donde estaba — MEDIDO en
    // la viga-semilla: ES 104D con Δ +5 en B daba dims B/D 52 → 57 y perímetro
    // dibujado 169.2137 en los dos casos (0.0000 de diferencia). Eso es medir una
    // cosa y dibujar otra, que es el defecto que esta tanda existe para impedir.
    // Ahora el Δ CRECE EL MARCO, así que la dim derivada y el trazo salen del mismo
    // número por construcción y no pueden divergir.
    //
    // CRECE SIMÉTRICO (mitad por lado) y no es una elección estética: en un contorno
    // cerrado el Δ va siempre en PAREJA (B con D miden los dos el alto), o sea el
    // lado que mide `alto` pasa a medir `alto+Δ` — el marco entero se agranda Δ y
    // sigue centrado en su eje. Por eso mismo un contorno cerrado no lee `extremo`:
    // ahí no hay una punta por la que crecer.
    //
    // SIN TOPE CONTRA EL HORMIGÓN (regla del proyecto). Si el Δ saca el estribo del
    // elemento, el marco sale del elemento y SE VE: el aviso lo da quien compara la
    // pieza con el hormigón, no un clamp acá que dibujaría un estribo que cabe
    // mintiendo sobre la barra que se va a cortar.
    var dM = anchor.marcoDelta || null;
    var dAlto = dM ? (Number(dM.alto) || 0) / 2 : 0;
    var dAncho = dM ? (Number(dM.ancho) || 0) / 2 : 0;
    return {
      recubV: recubV,
      recubLat: recubLat,
      ySup: host.alto / 2 - recubSup - r - insetSup + dAlto,
      yInf: -host.alto / 2 + recubInf + r + insetInf - dAlto,
      w2: host.ancho / 2 - recubLat - r - insetLat + dAncho
    };
  }

  // CUÁNTO PUEDE MEDIR LA PATA DEL GANCHO SÍSMICO EN ESTE MARCO.
  // ---------------------------------------------------------------------------
  // El gancho de 135° del estribo entra en DIAGONAL (45°) al núcleo desde la
  // esquina sup-izq. Antes de la pata, el CODO ya consume Rc·(1+√2/2) sobre el eje
  // Z y Rc·(1−√2/2) sobre el Y (ver `_estriboPerimetral`: el arco es tangente al
  // lado superior y al izquierdo, así que su barrido gasta esas dos cantidades
  // medidas desde la esquina). Lo que queda es el sitio REAL que tiene la pata, y
  // como viaja a 45° gasta largoPata·√2/2 en cada eje.
  //
  // POR QUÉ NO SIRVE EL CRITERIO ANTERIOR (defecto grave medido 13-ago). La pata
  // se acotaba con `hypot(alto, ancho)·0.28`, o sea contra la DIAGONAL del marco.
  // La diagonal la domina el lado LARGO, así que en un marco alto y angosto no
  // acotaba nada: la pata salía entera y la punta cruzaba el marco por el lado
  // opuesto. Como el desarrollo del gancho es una constante (Rc(1+D) + pata·D) y
  // arranca en −w2, el anillo ANIDADO —cuyo w2 encoge k·gap por capa— iba
  // ENSANCHÁNDOSE hacia afuera capa a capa: MEDIDO en muro 400×250×20 rec 2.5,
  // EC 104D φ16, 3 capas gap 3 → z ∈ [−6.70, 6.92] / [−3.70, 9.92] / [−0.70,
  // 12.92]: mismo span (13.62) en las tres, dims A 15 → 9 → 3, y la capa 3 con el
  // eje 2.92 cm FUERA del hormigón. Y en viga 600×60×30 con 4 capas el span en z
  // hacía 22.4 → 16.4 → 13.62 → 13.30: dejaba de encoger y el anillo ni siquiera
  // quedaba centrado. Un anillo anidado NO PUEDE ensanchar: acotando la pata
  // contra el sitio que realmente hay, la punta toca como mucho el lado opuesto y
  // el bbox de la capa k+1 queda contenido en el de la capa k, por construcción.
  //
  // Esto NO es un clamp que tape un dato del usuario: `largoPata` es geometría
  // DERIVADA (norma 6φ mín 7.5) y sólo visual — el largo y los kg salen de las
  // dims A–D en el backend. Cuando ni el CODO cabe (room ≤ 0) no hay pata que
  // dibujar y el anillo deja de ser un estribo: eso lo detecta el llamador
  // comparando el bbox de la capa con el de la anterior (reglas.distribuidorLayered),
  // que es el dato físico —«un anillo anidado no puede ensanchar»— y no una
  // tolerancia inventada acá.
  var _D45 = Math.SQRT1_2;
  function _pataGancho(m, diamCm) {
    var Rc = 2 * diamCm + diamCm / 2;
    var roomZ = 2 * m.w2 - Rc * (1 + _D45);            // de la salida del codo al lado opuesto
    var roomY = (m.ySup - m.yInf) - Rc * (1 - _D45);
    var sitio = Math.min(roomZ, roomY) / _D45;         // la pata viaja a 45°
    return { max: sitio, norma: Math.max(6 * diamCm, 7.5) };
  }

  // ¿CABE el marco de núcleo que produce este anchor? (hallazgo A del verificador)
  // Un anillo anidado se posiciona con insets crecientes (k·Sep en las TRES pilas):
  // pasado cierto k el marco se cruza consigo mismo y ySup ≤ yInf (o w2 ≤ 0), o sea
  // el estribo "interior" está FUERA del hormigón, con lados de largo negativo.
  // Devuelve las dos medidas del marco para que el llamador avise con números.
  //   alto = ySup − yInf   ·   ancho = 2·w2   ·   cabe = las dos > 0
  // `pataMax`/`pataNorma` viajan como INFORMACIÓN (cuánto sitio deja el marco para
  // la pata del gancho vs. cuánto pide la norma); NO entran en `cabe`: un marco
  // estrecho todavía es un anillo real mientras no ensanche al de afuera, y eso lo
  // decide el llamador con los bboxes.
  function marcoNucleoCabe(host, anchor, diamCm) {
    var m = _marcoNucleo(host, anchor || {}, diamCm);
    var alto = m.ySup - m.yInf, ancho = 2 * m.w2;
    var p = _pataGancho(m, diamCm || 0);
    return { cabe: (alto > 0 && ancho > 0), alto: alto, ancho: ancho,
      pataMax: p.max, pataNorma: p.norma };
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
    // Pata del gancho (norma 6φ mín 7.5cm), acotada al SITIO REAL que deja el marco
    // después del codo (ver _pataGancho): la pata viaja a 45° hacia el núcleo, así
    // que su tope lo fija el lado del marco que primero se le acaba, no la diagonal.
    var pg = _pataGancho(m, diamCm);
    var largoPata = Math.max(0, Math.min(pg.norma, pg.max));
    // LARGO QUE EL USUARIO PIDIÓ PARA CADA PATA (`anchor.ganchoDim = {ini, fin}`).
    // -------------------------------------------------------------------------
    // El largo de arriba es geometría DERIVADA: la norma (6φ mín 7.5) acotada al
    // sitio real del marco. Vale mientras nadie declare esa pata — y en el estribo
    // con ganchos DECLARADOS (106x: A y F son parciales con su propia dim) el
    // usuario SÍ puede declararla, escribiendo una medida fija o un Δ. Hasta acá
    // esa medida iba al despiece y el dibujo seguía con la constante: MEDIDO en la
    // 106A rol estribo φ8 con Δ +5 en A → dim_a 7.5 → 12.5, largo de corte 167 →
    // 172, kg 138.8 → 139.8 y el perímetro dibujado 169.213659 → 169.213659, o sea
    // 0.000000 de movimiento. Ahora la pata declarada manda sobre la derivada.
    //
    // SIN TOPE (regla del proyecto). El `pg.max` acota la pata NORMATIVA porque es
    // un número que eligió el motor y porque un anillo anidado no puede ensanchar;
    // una medida que escribió el usuario NO se recorta ni a la norma ni al marco:
    // si no cabe, la barra asoma y se ve, y lo dicen los canales de siempre (el
    // aviso de fierro fuera del hormigón, medido sobre estos mismos puntos, y el
    // control de bbox del anidado en reglas.distribuidorLayered). Recortarla acá
    // dibujaría un estribo que cabe mintiendo sobre la barra que se va a cortar.
    // Ausente (el caso normal) → `largoPata` tal cual, trazo byte-idéntico.
    var gd = anchor.ganchoDim || null;
    var pataA = (gd && gd.ini != null) ? Math.max(0, Number(gd.ini)) : largoPata;
    var pataB = (gd && gd.fin != null) ? Math.max(0, Number(gd.fin)) : largoPata;
    var dirPata = { y: -D, z: D };     // diagonal hacia el núcleo (abajo-derecha) — COMÚN

    // GANCHO A (inicio del fierro): pata → codo [θ: 45° → −90°] → tangente al lado izq.
    var pA = { x: xx, y: O.y + Rc * D, z: O.z + Rc * D };            // punto del arco en θ=45°
    var puntaA = { x: xx, y: pA.y + dirPata.y * pataA, z: pA.z + dirPata.z * pataA };
    var codoA = _arcoYZ(O, Rc, Math.PI / 4, -Math.PI / 2, xx, true); // incluye θ=45°, termina θ=−90°

    // GANCHO B (fin del fierro): lado superior llega a T0 (θ=0) → codo [θ: 0 → −135°] → pata.
    var T0 = { x: xx, y: ySup, z: -w2 + Rc };                        // tangencia con lado superior
    var codoB = _arcoYZ(O, Rc, 0, -3 * Math.PI / 4, xx, false);      // excluye θ=0 (T0 ya en la lista)
    var pB = codoB[codoB.length - 1];                                // punto del arco en θ=−135°
    var puntaB = { x: xx, y: pB.y + dirPata.y * pataB, z: pB.z + dirPata.z * pataB };

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

  // ---------------------------------------------------------------------------
  // ROMBO DE SECCIÓN (106A y familia) — EL MARCO MANDA LA FORMA (fix 13-ago)
  // ---------------------------------------------------------------------------
  // Un estribo rombo con "tomar contorno" se ajusta al recubrimiento igual que
  // el 104D: sus 4 PUNTAS van a los puntos MEDIOS de los 4 lados del marco de
  // núcleo (tocando recub arriba, abajo y en los dos costados) y las dims/largo
  // SE DERIVAN de esa geometría — la figura no le pregunta a las dims dónde
  // dibujarse, exactamente la filosofía de _estriboPerimetral.
  //
  // POR QUÉ EXISTE: como cadena genérica el rombo quedaba a la deriva — todo su
  // cuerpo es DIAGONAL y la regla "diagonal en auto = gancho normativo" (correcta
  // para patas) lo dejaba como un mini-rombo de 9.6 por lado flotando al centro
  // (reporte del usuario 13-ago: "destruiste al estribo"). Con ángulos FIJOS del
  // catálogo (45°) además es IMPOSIBLE inscribirlo a un marco no cuadrado: los
  // ángulos reales del rombo salen del marco (aSa hace lo mismo).
  //
  // ¿QUÉ FIGURA ES UN ROMBO? Criterio topológico, sin lista por código: cadena
  // ABIERTA cuyos lados INTERIORES son todos DIAGONALES y cuyo trazo con lados
  // iguales CIERRA (los giros suman la vuelta completa). 106A: A/F ganchos
  // terminales + B..E el cuerpo cerrado ✓. Un zigzag 105x no cierra → NO entra.
  // ESTRIBO CON GANCHOS DECLARADOS (la 106A y familia) — CORRECCIÓN 14-ago.
  // ---------------------------------------------------------------------------
  // Una figura de 5+ lados cuyo CUERPO INTERIOR es un RECTÁNGULO (todos los
  // giros interiores de 90°, 4 lados de cuerpo) con los lados TERMINALES como
  // ganchos ES el estribo de siempre: 104D lo describe con 4 letras (los ganchos
  // implícitos) y 106A con 6 (ganchos A y F declarados como parciales). Se
  // dibuja con _estriboPerimetral — el marco manda — igual que antes de la
  // Tanda P, que es como el usuario lo validó.
  // AYER esta figura se clasificó mal como "rombo": su trazado derivado parte
  // con el gancho de 45°, eso INCLINA todo el cuerpo en el sistema del trazo y
  // los lados del rectángulo salían "diagonales". Se inventó una figura que el
  // catálogo no tiene ("la 106A nunca fue un rombo" — el usuario). El cuerpo se
  // clasifica ahora RELATIVO A SÍ MISMO (sus giros), no al heading absoluto.
  function esEstriboConGanchos(figura) {
    var f = (figura || '').toUpperCase();
    var tr = tramosDeFigura(f);
    if (!tr || tr.tramos.length < 5) return false;
    var n = tr.tramos.length, i, t, g;
    if (n - 2 !== 4) return false;               // cuerpo de 4 lados exactos
    for (i = 1; i < n - 1; i++) {
      t = tr.tramos[i];
      if (!t || t.lado == null) return false;
      if (i > 1) {                                // giros INTERNOS del cuerpo
        g = Math.abs(Number(t.giro) || 0);
        if (Math.abs(g - 90) > 1e-6) return false;   // rectángulo: todos 90°
      }
    }
    return true;
  }

  // (Sin uso hoy: quedó de la clasificación equivocada del 14-ago. Se conserva
  // la función por si el catálogo incorpora algún día un rombo REAL, pero
  // ninguna figura actual la activa.)
  function esRomboSeccion(figura) {
    return false;
  }

  // Traza el rombo pegado al marco. Ganchos: dos patas que salen de la punta
  // SUPERIOR hacia el interior, tangentes a sus codos (>90° → arco explícito de
  // _conGanchosRadio, cuya cresta queda DESPLAZADA AL INTERIOR: nada asoma).
  function _romboPerimetral(figura, dims, host, anchor, diamCm) {
    var m = _marcoNucleo(host, anchor, diamCm);
    var xx = anchor.x || 0;
    var yMid = (m.ySup + m.yInf) / 2;
    // vértices = puntos medios de los 4 lados del marco (eje del fierro AL marco:
    // la superficie del codo queda exactamente al recubrimiento, como el 104D).
    var pTop = { u: 0, v: m.ySup }, pDer = { u: m.w2, v: yMid };
    var pInf = { u: 0, v: m.yInf }, pIzq = { u: -m.w2, v: yMid };
    var g = extGancho(diamCm);
    // patas del gancho: cuelgan de la punta superior siguiendo los lados
    // (prolongación hacia adentro) — el pase de ganchos las curva con radio.
    var dIn1 = _unit2(pIzq.u - pTop.u, pIzq.v - pTop.v);   // hacia abajo-izq
    var dIn2 = _unit2(pDer.u - pTop.u, pDer.v - pTop.v);   // hacia abajo-der
    // VÉRTICES TEÓRICOS EN EL MARCO — la convención del 104D: la polilínea (el
    // dato) toca el marco EXACTO en las 4 puntas y las dims se listan a vértice
    // teórico (como aSa); el redondeo del doblez lo pone el motor al dibujar
    // (una barra doblada nunca alcanza el vértice teórico — eso no es un bug,
    // es la física del doblado, igual que en las esquinas del 104D).
    // Cada pata ENVUELVE la punta superior: llega por un lado y cuelga
    // prolongando el otro hacia el interior.
    var cadena = [
      { u: pTop.u + dIn1.u * g, v: pTop.v + dIn1.v * g },  // punta gancho A (interior)
      pTop, pDer, pInf, pIzq, { u: pTop.u, v: pTop.v },    // el contorno completo
      { u: pTop.u + dIn2.u * g, v: pTop.v + dIn2.v * g }   // punta gancho B (interior)
    ];
    var out = cadena.map(function (p) { return V(xx, p.v, p.u); });
    return (anchor && anchor.espejo) ? _espejarEje(out, 'z', 0) : out;
  }
  function _unit2(u, v) { var L = Math.hypot(u, v) || 1; return { u: u / L, v: v / L }; }

  // Dims REALES del rombo, derivadas del marco EXTERIOR (mismo criterio que el
  // 104D, que lista anchoUtil/altoUtil): lado = hipotenusa de las semidiagonales
  // exteriores; ganchos terminales = extensión normativa. Lo consume reglas
  // (_dimsEfectivas) para que el LISTADO diga lo que se dibuja.
  function dimsRombo(figura, anchoUtilExt, altoUtilExt, diamCm) {
    var f = (figura || '').toUpperCase();
    var tr = tramosDeFigura(f);
    if (!tr) return null;
    var lado = Math.hypot(anchoUtilExt / 2, altoUtilExt / 2);
    var g = extGancho(diamCm);
    var out = {}, i, t;
    for (i = 0; i < tr.tramos.length; i++) {
      t = tr.tramos[i];
      if (t.lado == null) continue;
      out[t.lado] = (i === 0 || i === tr.tramos.length - 1)
        ? Math.round(g * 10) / 10
        : Math.round(lado * 10) / 10;
    }
    return out;
  }

  // Dims REALES de un estribo CON GANCHOS DECLARADOS (106A y familia), derivadas
  // del marco EXTERIOR — el listado dice lo que _estriboPerimetral dibuja. El
  // recorrido del marco es: gancho A → baja el lado IZQUIERDO (alto) → inferior
  // (ancho) → sube el derecho (alto) → superior (ancho) → gancho F. O sea:
  //   primer y último parcial = gancho normativo (6φ, mín 7.5)
  //   lados del cuerpo, EN ORDEN: alto, ancho, alto, ancho.
  function dimsEstriboGanchos(figura, anchoUtilExt, altoUtilExt, diamCm) {
    var f = (figura || '').toUpperCase();
    var tr = tramosDeFigura(f);
    if (!tr) return null;
    var g = Math.round(extGancho(diamCm) * 10) / 10;
    var n = tr.tramos.length, out = {}, i, t, kCuerpo = 0;
    for (i = 0; i < n; i++) {
      t = tr.tramos[i];
      if (t.lado == null) continue;
      if (i === 0 || i === n - 1) { out[t.lado] = g; continue; }
      out[t.lado] = (kCuerpo % 2 === 0)
        ? Math.round(altoUtilExt * 100) / 100
        : Math.round(anchoUtilExt * 100) / 100;
      kCuerpo++;
    }
    return out;
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
  //
  // anchor.z ES EL CENTRO DE LA PIEZA, NO EL EJE DE SU VERTICAL (defecto
  // bloqueante medido 13-ago). La traba se armaba con la vertical EN zz y TODO su
  // desarrollo hacia −u: los dos ganchos (135° arriba con su arco, 90° abajo)
  // colgaban de ahí, así que la pieza ocupaba [zz − 14.75, zz] con φ16 — un ancho
  // que NO dependía del host (idéntico en viga de 30, viga de 60 y muro de 20) y
  // que arrancaba pegado a su coordenada de reparto en vez de estar encuadrado.
  // MEDIDO: muro 400×250×20 rec 2.5, TC 101A φ16 con su pose default y 1 barra
  // (zz = 0, el centro del núcleo) → el trazo iba de z = 0 a z = −14.748, o sea el
  // EJE 4.748 cm más allá de la cara del hormigón (z = −10) y la CARA del fierro
  // 5.548 cm. En la viga 600×60×30 el mismo trazo sobrevivía por 0.25 cm de
  // margen, no por diseño.
  // La convención del módulo ya estaba escrita en `_cadenaSeccion`: «si el anchor
  // trae la coordenada, ESA es la posición del CENTRO de la pieza; si no la trae,
  // la pieza se centra en su marco». La traba es la tercera pieza de sección y
  // tiene que leerla igual — si no, el reparto (que sí mueve el centro) y el
  // dibujo hablan de dos puntos distintos.
  // NO se acorta el gancho para que quepa: 6φ (mín 7.5) es NORMATIVO. Si la pieza
  // resulta más ancha que su marco, asoma centrada —dato honesto y simétrico— y el
  // aviso lo emite quien conoce el marco (reglas._repartoDePieza).
  function _traba(figura, dims, host, anchor, diamCm) {
    var m = _marcoNucleo(host, anchor, diamCm);   // eje = recub + φ/2, como el estribo
    // EJE LOCAL QUE CRUZA (fix 14-ago): 'y' = el alto del marco (comportamiento de
    // siempre: la traba de la viga cose sup↔inf) o 'z' = el ancho del marco (la
    // traba del muro en la sección horizontal cose las dos cortinas del espesor).
    // Lo decide reglas (_cruceLocalTraba, desde la pose) y viaja en el anchor:
    // este constructor no conoce poses. Sin el dato → 'y', byte-idéntico a antes.
    // El trazo es UNO SOLO, armado en (a = coordenada del cruce, b = transversal):
    // gancho 135° arriba (diagonal hacia el núcleo) + gancho 90° abajo, con
    // GANCHOS CON RADIO (el 135° es doblez terminal: cresta toca aSup EXACTO y la
    // punta cuelga tangente; el pie de 90° queda en punta, fillet motor). Se arma
    // en b = 0 y se CENTRA después sobre el bbox ARQUEADO — mismo criterio que
    // _cadenaSeccion.
    var cruce = (anchor && anchor.cruceLocal === 'z') ? 'z' : 'y';
    var aSup = (cruce === 'y') ? m.ySup : m.w2;
    var aInf = (cruce === 'y') ? m.yInf : -m.w2;
    var xx = anchor.x || 0;
    // transversal: el eje del plano que NO cruza (z si cruza y — el caso viga —,
    // y si cruza z). Su coordenada viene del anchor (reparto/clic); la del cruce
    // NO se lee: la traba va de cara a cara por definición.
    var tt = (cruce === 'y') ? (anchor.z || 0) : (anchor.y || 0);
    var g = 0.7071 * (extGancho(diamCm) + diamCm);
    var pts2 = _conGanchosRadio([
      { u: -g, v: aSup - g },                  // punta gancho 135° arriba
      { u: 0, v: aSup },                       // doblez arriba (cara a cara)
      { u: 0, v: aInf },                       // baja a la otra cara
      { u: -extGancho(diamCm), v: aInf }       // pie gancho 90° abajo
    ], diamCm, false);
    var minU = Infinity, maxU = -Infinity, i;
    for (i = 0; i < pts2.length; i++) {
      if (pts2[i].u < minU) minU = pts2[i].u;
      if (pts2[i].u > maxU) maxU = pts2[i].u;
    }
    var du = tt - (minU + maxU) / 2;             // el CENTRO del bbox va a la transversal
    var out = pts2.map(function (p) {
      // (a,b) → (v,u) locales: cruzando 'y' es la identidad de siempre; cruzando
      // 'z' el MISMO trazo gira 90° en su plano (v del trazo pasa a u local).
      var q = (cruce === 'y') ? V(xx, p.v, p.u + du) : V(xx, p.u + du, p.v);
      if (p.esArco) q.esArco = true;
      return q;
    });
    // ESPEJO: reflexión sobre el PROPIO eje transversal de la traba (la pieza no
    // se mueve, cambia de mano) — el eje depende de qué cruza.
    return (anchor && anchor.espejo)
      ? _espejarEje(out, (cruce === 'y') ? 'z' : 'y', tt) : out;
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
      // opts.angulos = el ángulo POR BARRA del componente: el retiro se resuelve
      // sobre el MISMO trazo que se va a dibujar (si leyera el del catálogo, la capa
      // anidada encogería según una figura que no es la que está en pantalla).
      var sec = insetCadenaSeccion(f, dims, dSep, rol, opts.diamCm, opts.angulos);
      if (sec) {
        res.delta = dSep; res.inset = dSep; res.criterio = 'seccion';
        res.dims = sec.dims; res.cabe = sec.cabe; res.motivo = sec.motivo;
        return res;
      }
    }
    var famEst = (rol === 'estribo') ? familiaDeDibujo(f, 'estribo') : null;
    var cerrada = (opts.cerrada === true) || figuraCerrada(f) ||
      famEst === 'estribo' || famEst === 'rombo';   // el rombo anida como anillo
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
    if (familia === 'rombo') return _romboPerimetral(figura, dims, host, anchor, diamCm);
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
    // LADO DOMINANTE de una figura (override del componente → cascada catálogo →
    // 'B' → 1er parcial). Fuente ÚNICA: la usan reglas._ladoLongitudinal, el
    // trazador de cadenas y la ficha.
    ladoDominanteFigura: ladoDominanteFigura,
    // ¿Puede este lado ser el dominante? → {ok, lado, motivo}. El motivo es texto
    // de usuario: reglas lo pega tal cual en el aviso cuando ignora un override.
    validarLadoDominante: validarLadoDominante,
    // Letras que la UI puede ofrecer como dominante (las demás van deshabilitadas).
    ladosDominantesElegibles: ladosDominantesElegibles,
    // PARES ESPEJO: { lado: su par } derivado del contorno CERRADO. Un Δ en un lado
    // se replica en su par o la figura deja de cerrar. La UI lo usa para mostrar
    // que los dos se mueven juntos.
    paresEspejoFigura: paresEspejoFigura,
    // { LETRA:'u'|'v' } para las piezas de sección que se dibujan DEL MARCO: qué
    // medida del marco lleva cada lado. reglas lo usa para que un Δ crezca el marco
    // (si sólo creciera la dim, el trazo 3D se quedaría quieto).
    ejesMarcoSeccion: ejesMarcoSeccion,
    // { ini, fin } = las LETRAS de las dos patas que dibuja el marco cerrado con
    // ganchos declarados (106x). reglas manda su medida por `anchor.ganchoDim`,
    // que es lo que hace que una pata escrita a mano mueva el trazo y no sólo el
    // largo de corte. null = esta figura no declara sus ganchos (104x, 105x…).
    ganchosTerminales: ganchosTerminales,
    // ¿Por dónde llega la medida de ESTE lado al dibujo? 'dims' | 'marco' |
    // 'gancho' | null. Simétrico de `trazoLeeAngulos`: null (y 'marco' con una
    // medida fija) = el trazo lo manda el marco de núcleo y la dim sólo viaja al
    // despiece — reglas lo AVISA en vez de dejar que el 3D mienta en silencio.
    canalDelTrazo: canalDelTrazo,
    sobresCadena: sobresCadena,   // reserva del auto-largo (puntas inclinadas)
    // ÁNGULO POR BARRA (el catálogo sugiere, el componente decide). La UI arma el
    // control con esto: `rangoAngulo` le da los topes del slider, `mapaAngulosFigura`
    // le dice qué vértice mueve cada α, `validarAngulo` le da el motivo listo para
    // mostrar y `trazoLeeAngulos` si en esta figura el control mueve el dibujo.
    angulosCatalogo: angulosCatalogo,     // los SUGERIDOS (el default de la ficha)
    angulosEfectivos: angulosEfectivos,   // catálogo + overrides VÁLIDOS (→ ang1..ang4)
    angulosCambian: angulosCambian,       // ¿el override cambia algo? (si no, ruta de siempre)
    mapaAngulosFigura: mapaAngulosFigura, // slot α → índice de doblez (−1 = ninguno)
    rangoAngulo: rangoAngulo,             // { lo, hi } del doblez de ese α
    validarAngulo: validarAngulo,         // { ok, valor, base, motivo, vacio }
    trazoLeeAngulos: trazoLeeAngulos,     // false = el marco manda la forma (α mudo)
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
    _conGanchosRadio: _conGanchosRadio,   // ganchos terminales >90° con radio (tests)
    ejesCadenaLong: ejesCadenaLong,           // clasificación u/v/d relativa al dominante
    autoProfundidadLong: autoProfundidadLong, // 'v' en auto → profundidad útil exacta
    esEstriboConGanchos: esEstriboConGanchos, // 106A: marco + ganchos declarados
    dimsEstriboGanchos: dimsEstriboGanchos,   // sus dims listadas = lo que se dibuja
    esRomboSeccion: esRomboSeccion,           // ¿cuerpo diagonal que cierra? (106A)
    dimsRombo: dimsRombo,                     // dims derivadas del marco (listado)
    _traba: _traba,
    _cadenaGenerica: _cadenaGenerica
  };

  global.ModeladorFiguraPuntos = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
