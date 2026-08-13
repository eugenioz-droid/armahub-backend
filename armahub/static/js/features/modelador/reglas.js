// =============================================================================
// Modelador 3D — REGLAS / EXPANSOR GENÉRICO DE DISTRIBUCIÓN (F0 · T0.4)
// El corazón del motor: un componente = figura base + una CADENA de
// "distribuidores" (operadores). expandirComponente() despacha por modo y
// devuelve una lista de Placements (poses de barra). Un solo mecanismo sirve a
// viga/muro/columna (§0-11ter del diseño).
//
// Placement = {
//   puntos: [{x,y,z}],   // polilínea 3D de ESA barra (host coords, cm)
//   diam,                // cm
//   tipologia, figura, suf_tipo,
//   dims: {A,B,C,D,...}, // dims efectivas de la barra (para el payload/estimación)
//   angulos: [..],       // ángulos de la figura (persistir con la convención catálogo)
//   meta: { cara, capa, zona }   // trazabilidad (no se persiste, sí agrupa)
// }
//
// MVP: LINEAR (estribos por zonas) + LAYERED (cabezales en capas). Grid /
// Perimeter / Points = stubs que devuelven [] (2ª entrega: muro/columna).
//
// Depende de ModeladorFiguraPuntos (figuraAPuntos). No usa THREE → testeable.
// =============================================================================
(function (global) {
  'use strict';

  // Resolver EN EL MOMENTO DE USAR (no al cargar): scripts en paralelo en el
  // navegador → figura_puntos.js puede cargar DESPUÉS que reglas.js.
  function _fp() {
    return global.ModeladorFiguraPuntos ||
      (typeof require !== 'undefined' ? require('./figura_puntos.js') : null);
  }

  // Catálogo de figuras (parciales/ángulos/radio) — misma regla de resolución
  // tardía. Es la fuente de qué lado es el longitudinal de cada figura.
  function _cat() {
    return global.ModeladorCatalogoFiguras ||
      (typeof require !== 'undefined' ? require('./catalogo_figuras.js') : null);
  }

  // ---------------------------------------------------------------------------
  // MODO DE USO DE LA BARRA (§INTERACCIÓN-2.0 · PRINCIPIO RECTOR)
  // ---------------------------------------------------------------------------
  // El MODO es INDEPENDIENTE de la tipología. 3 modos de uso:
  //   'puntual' | 'lineal' | 'arreglo'.
  // Cada tipología trae un modo PRESETEADO por default (editable por el usuario
  // con botoncitos en otra tarea). Espejo del INPUT_METHOD_MAP del ADetailer
  // (typology_catalog.py), pero aquí el modo es un CAMPO editable, no fijo por
  // tipo. Este mapa solo define el DEFAULT al crear/normalizar un componente.
  //   cabezal/CB (longitudinales) -> 'puntual'
  //   estribo/traba              -> 'lineal'
  //   malla/traba-muro           -> 'arreglo'
  var TIPOLOGIA_MODO_DEFAULT = {
    // Longitudinales / cabezales → PUNTUAL
    CB: 'puntual', CBS: 'puntual', CBI: 'puntual', CBS2: 'puntual', CBI2: 'puntual',
    CBSN: 'puntual', CBIN: 'puntual', LT: 'puntual', L: 'puntual',
    // Estribos / trabas de confinamiento → LINEAL
    ES: 'lineal', ESC: 'lineal', EC: 'lineal',
    TRV: 'lineal', TR: 'lineal', TC: 'lineal', TRC: 'lineal', TRL: 'lineal', TRF: 'lineal',
    // MALLAS DE MURO (MH = Malla Horizontal, MV = Malla Vertical — los códigos
    // REALES del catálogo, TIPOLOGIAS.MURO) → LINEAL, no 'arreglo'. Decisión
    // explícita del usuario: una malla de muro se coloca como DISTRIBUCIÓN (una
    // barra repetida @sep a lo largo de un rango), que es lo que el calculista
    // dicta ("MH φ8 @20"); el 'arreglo' (rango × N capas) es otro caso de uso.
    // Sin esta línea caían al fallback por rol → 'puntual' (una barra suelta).
    MH: 'lineal', MV: 'lineal',
    // Mallas / trabas de muro → ARREGLO (rango + N capas)
    MA: 'arreglo', MALLA: 'arreglo', TM: 'arreglo', TRM: 'arreglo'
  };

  // Modo default para una tipología. Fallback por ROL (para tipologías no listadas):
  // estribo/traba -> 'lineal'; el resto (longitudinales) -> 'puntual'.
  function modoDefaultDeTipologia(tip) {
    var t = (tip || '').toUpperCase();
    if (TIPOLOGIA_MODO_DEFAULT.hasOwnProperty(t)) return TIPOLOGIA_MODO_DEFAULT[t];
    var rol = _rolDeTipologia(t, null);
    return (rol === 'estribo' || rol === 'traba') ? 'lineal' : 'puntual';
  }

  // ---------------------------------------------------------------------------
  // MODELO ADITIVO DEL COMPONENTE (§DISCOVERY-INTERACCIÓN-2 · §INTERACCIÓN-2.0)
  // ---------------------------------------------------------------------------
  // SHAPE canónico del componente. Campos OPCIONALES que HOY no alteran nada
  // (defaults inertes → comportamiento IDÉNTICO) pero son el DATO sobre el que se
  // construirán empalmes / prioridad / dependencias / interacción en otra tarea:
  //   comp_id    : id estable (string) — referenciado por depende_de/prioridad.
  //   prioridad  : nº global único | null (1 = más afuera). null = no participa.
  //   empalme    : { extremo:'inicio'|'fin'|null, valor:string|number } | null.
  //   depende_de : [{ comp_id, holgura }] | null.
  //   modo       : 'puntual'|'lineal'|'arreglo' — MODO DE USO, independiente de la
  //                tipología. Default = preset de la tipología. Solo DATO: NO cambia
  //                el despacho actual (expandirComponente sigue usando distribucion.modo).
  //   plano_pieza: { volteado:false } — plano de trabajo propio de la pieza.
  //                Default volteado:false = comportamiento IDÉNTICO. Admite además
  //                `orientacion: 'acostada'|'volteada'|'de_pie'` (ver
  //                orientacionPieza): si viene, GANA sobre `volteado`. NO se
  //                rellena por default a propósito — estampar 'acostada' dejaría
  //                sordo al toggle `volteado` del Template Editor.
  //   lado       : 1 | −1 — LADO de la cara CORTINA (z+ / z−) de un longitudinal
  //                lateral. Default 1. Es un dato PROPIO (lo escribe el clic al
  //                colocar y el toggle del panel), NUNCA se deduce de pos_hint:
  //                mezclarlos hacía saltar la barra al cruzar z = 0 arrastrando.
  //   arreglo    : { n_capas:1, sep_capas:20, rango:null } — params del modo arreglo
  //                (rango en un sentido + N capas con espaciamiento). Default
  //                n_capas:1 = una sola fila = igual que hoy. Solo DATO: la lógica de
  //                arreglo/rotación NO está implementada aún (otras tareas).
  // normalizarComponente NO clona ni pisa lo que ya venga: solo RELLENA lo ausente
  // con su default, para que todo consumidor vea el mismo shape. Idempotente.
  function normalizarComponente(comp) {
    if (!comp || typeof comp !== 'object') return comp;
    if (!('comp_id' in comp)) comp.comp_id = null;
    if (!('prioridad' in comp)) comp.prioridad = null;
    if (!('empalme' in comp)) comp.empalme = null;
    if (!('depende_de' in comp)) comp.depende_de = null;
    // Modo de uso (preset por tipología; editable en otra tarea).
    if (comp.modo == null) comp.modo = modoDefaultDeTipologia(comp.tipologia);
    // LADO de la cara CORTINA (z+ = 1 / z− = −1). Es un DATO PROPIO del componente,
    // no algo que se deduzca del arrastre: ver _baseDeComponente.
    if (comp.lado !== 1 && comp.lado !== -1) comp.lado = (Number(comp.lado) < 0) ? -1 : 1;
    // Plano de trabajo de la pieza. Rellena idempotente sin pisar `volteado`.
    if (!comp.plano_pieza || typeof comp.plano_pieza !== 'object') {
      comp.plano_pieza = { volteado: false };
    } else if (!('volteado' in comp.plano_pieza)) {
      comp.plano_pieza.volteado = false;
    }
    // Params del modo arreglo (inertes: n_capas:1 = una fila = igual que hoy).
    if (!comp.arreglo || typeof comp.arreglo !== 'object') {
      comp.arreglo = { n_capas: 1, sep_capas: 20, rango: null };
    } else {
      if (!('n_capas' in comp.arreglo)) comp.arreglo.n_capas = 1;
      if (!('sep_capas' in comp.arreglo)) comp.arreglo.sep_capas = 20;
      if (!('rango' in comp.arreglo)) comp.arreglo.rango = null;
    }
    // POSE CANÓNICA (TANDA P). Si el componente trae `pose` se NORMALIZA in place
    // (cara/rumbo válidos y ⊥); si no, se DERIVA de los campos viejos y se publica
    // en `comp._pose` — NO enumerable, recalculado en cada pasada, para que no
    // ensucie la receta que se guarda ni deje sorda a la UI vieja (ver poseDe).
    if (comp.pose && typeof comp.pose === 'object') {
      var pn = normalizarPose(comp.pose);
      comp.pose.cara = pn.cara; comp.pose.lado = pn.lado;
      comp.pose.rumbo = pn.rumbo; comp.pose.espejo = pn.espejo;
    }
    var pEf = poseDe(comp);
    try {
      Object.defineProperty(comp, '_pose',
        { value: pEf, enumerable: false, writable: true, configurable: true });
    } catch (e) { /* objeto sellado: poseDe(comp) sigue dando la misma pose */ }
    return comp;
  }

  // ---------------------------------------------------------------------------
  // JERARQUÍA DE BARRAS — NIVELES 1-BASED (+ 'no')
  // ---------------------------------------------------------------------------
  // comp.jerarquia = 'no' | 1 | 2 | 3 | 4
  //   'no' → SIN jerarquía: la barra se pega al recubrimiento (inset 0) y NO
  //          aporta su φ a la cadena (no empuja a nadie hacia adentro).
  //   1    → nivel más EXTERNO: pegado al recubrimiento Y aporta su φ.
  //   2    → se apoya por DENTRO del nivel 1 (inset = Σφ del nivel 1). Etc.
  // Defaults por rol cuando el componente no declara nivel (campo ausente):
  //   estribo → 1, traba → 2, cabezal → 2.
  // MIGRACIÓN del viejo 0-based: cualquier número n ≥ 1 se lee como nivel
  // 1-based tal cual, y 0 (o negativo) se lee como 1 — que es exactamente lo que
  // significaba el viejo 0 ("pegado al recubrimiento y aporta φ").
  var JER_DEFAULT_POR_ROL = { estribo: 1, traba: 2, cabezal: 2 };

  // Nivel DECLARADO por el componente: 'no' | entero ≥ 1 | null (= no declara).
  function nivelJerarquia(valor) {
    if (valor === 'no' || valor === 'NO' || valor === false) return 'no';
    if (valor == null || valor === '') return null;
    var n = Number(valor);
    if (!isFinite(n)) return null;
    return (n < 1) ? 1 : Math.round(n);     // 0-based viejo: 0 → 1
  }

  // Nivel EFECTIVO (el que gobierna el ANCLAJE): declarado, o default por rol.
  function nivelJerarquiaEfectivo(valor, rol) {
    var n = nivelJerarquia(valor);
    if (n != null) return n;
    return JER_DEFAULT_POR_ROL[rol || 'cabezal'] || 2;
  }

  // ---------------------------------------------------------------------------
  // T0.5 — REDONDEO DE CANTIDAD (longitud ÷ @ → nº de barras)
  // ---------------------------------------------------------------------------
  // REDONDEO DE ESTRIBOS — ESPEJO EXACTO de ArmaPilot (verificado 08-ago contra el
  // código real: bar_model.py::calc_line_count y LISP ARM-FLUJOS-CALC-LINE-COUNT):
  //     count = ceil(dist_util / esp) + 1    ("cerrando el intervalo útil")
  //     garantiza que la separación REAL nunca exceda `esp` ("cada @ o menos").
  //     edge: esp<=0 o dist<=0 → 1.
  // OJO (uniones de zona): si una zona TERMINA donde otra ARRANCA, el estribo del
  // punto de unión NO se duplica. Lo maneja distribuidorLinear al encadenar zonas
  // (última posición de una zona = primera de la siguiente → se cuenta 1 sola vez).
  // Esta función = conteo de UNA zona aislada (con sus 2 extremos); el encadenado
  // descuenta la frontera compartida.
  function redondeoCantidadZona(longitud, sep) {
    var s = Number(sep) || 0, d = Number(longitud) || 0;
    if (s <= 0 || d <= 0) return 1;
    return Math.ceil(d / s) + 1;
  }

  // ---------------------------------------------------------------------------
  // EMPALMES (§DISCOVERY-INTERACCIÓN-2.A)
  // ---------------------------------------------------------------------------
  // Un componente con empalme={extremo,valor} ALARGA ese extremo FUERA del
  // hormigón esa cantidad. `valor` puede ser número (cm) o fórmula '60*phi+1'
  // (phi = diámetro en cm; el término se interpreta en cm). El alargue se suma a
  // la dim LONGITUDINAL de la barra (A en 101A; B — el tramo largo — en 10x con
  // patas) → el largo se recalcula por suma de lados → el peso sale bien.
  //   extremo: 'inicio' | 'fin' | 'ambos' | null.  null / sin empalme = no-op.
  // NOTA: el efecto sobre las dims es idéntico para 'inicio'/'fin'/'ambos' salvo
  // el multiplicador (ambos = 2×); el LADO geométrico donde asoma lo resuelve
  // figura_puntos con anchor.empalme (dato de trazabilidad, no cambia el peso).
  // ADEMÁS acepta el shape { inicio, fin } con un Δ INDEPENDIENTE por extremo
  // (ver _empalmePorExtremo): la dim longitudinal suma LOS DOS y cada punta asoma
  // lo suyo.
  function evalEmpalme(valor, diamCm) {
    if (valor == null) return 0;
    if (typeof valor === 'number') return isFinite(valor) ? valor : 0;
    var s = String(valor).trim();
    if (s === '') return 0;
    // fórmula tipo '60*phi+1' — phi en cm. Parser acotado y seguro (sin eval):
    // soporta   k*phi (+|-) c   /   k*phi   /   c   (k, c números; phi = diamCm).
    var num = Number(s);
    if (isFinite(num)) return num;
    var m = s.replace(/\s+/g, '').toLowerCase()
      .match(/^([0-9]*\.?[0-9]+)\*phi([+-][0-9]*\.?[0-9]+)?$/);
    if (m) {
      var k = Number(m[1]);
      var c = m[2] != null ? Number(m[2]) : 0;
      return k * (Number(diamCm) || 0) + c;
    }
    // fórmula que sólo es 'phi' o 'phi+c'
    var m2 = s.replace(/\s+/g, '').toLowerCase()
      .match(/^phi([+-][0-9]*\.?[0-9]+)?$/);
    if (m2) return (Number(diamCm) || 0) + (m2[1] != null ? Number(m2[1]) : 0);
    return 0;   // no se pudo interpretar → sin empalme (documentado)
  }

  // Δ POR EXTREMO — fuente ÚNICA del empalme resuelto (cm) de cada punta.
  // ---------------------------------------------------------------------------
  // DOS SHAPES, mismo resultado (el nuevo es ADITIVO; el viejo no se toca):
  //   · VIEJO: { extremo:'inicio'|'fin'|'ambos', valor }  — un solo valor, y
  //     'ambos' lo aplica IGUAL a las dos puntas.
  //   · NUEVO: { inicio: v1, fin: v2 }  — Δ INDEPENDIENTE por extremo, porque en
  //     obra casi nunca son iguales: una barra empalma 40φ contra la columna de un
  //     lado y asoma 15 cm de arranque del otro. Con el shape viejo había que
  //     elegir entre 'ambos' (mentira simétrica) o partir el componente en dos.
  //     Cada valor es número (cm) o fórmula ('40*phi', '60*phi+1'), y los dos se
  //     evalúan con el MISMO parser (evalEmpalme).
  // Se distingue por presencia de las claves inicio/fin, no por un flag de versión:
  // una receta vieja no las tiene y cae exacto en la rama de siempre.
  // Devuelve {ini, fin} en cm (0 = ese extremo no se alarga).
  function _empalmePorExtremo(comp, diamCm) {
    var e = comp && comp.empalme;
    if (!e) return { ini: 0, fin: 0 };
    if (e.inicio != null || e.fin != null) {          // shape NUEVO (por extremo)
      var vi = evalEmpalme(e.inicio, diamCm);
      var vf = evalEmpalme(e.fin, diamCm);
      return { ini: vi > 0 ? vi : 0, fin: vf > 0 ? vf : 0 };
    }
    if (!e.extremo) return { ini: 0, fin: 0 };        // shape VIEJO
    var v = evalEmpalme(e.valor, diamCm);
    if (v <= 0) return { ini: 0, fin: 0 };
    if (e.extremo === 'inicio') return { ini: v, fin: 0 };
    if (e.extremo === 'fin') return { ini: 0, fin: v };
    if (e.extremo === 'ambos') return { ini: v, fin: v };
    return { ini: 0, fin: 0 };
  }

  // Devuelve el largo (cm) que aporta el empalme TOTAL de un componente (suma de
  // extremos alargados) para poder sumarlo a la dim longitudinal.
  function _empalmeTotalCm(comp, diamCm) {
    var e = _empalmePorExtremo(comp, diamCm);
    return e.ini + e.fin;
  }

  // ---------------------------------------------------------------------------
  // ORIENTACIÓN DE LA PIEZA (§INTERACCIÓN-2.0 · G3/B3) — GEOMETRÍA REAL.
  // ---------------------------------------------------------------------------
  // `comp.plano_pieza.orientacion` NO es un truco de proyección: es una
  // PERMUTACIÓN DE EJES del componente. Los distribuidores y figura_puntos
  // trabajan siempre en un marco LOCAL canónico (x = eje de distribución/
  // longitudinal, y = alto, z = profundidad de capas) y la orientación dice cómo
  // se monta ese marco local sobre el mundo:
  //
  //   'acostada' (default) → identidad. La pieza corre a lo LARGO (x).
  //   'volteada'           → x_local ↔ z_mundo (y_local = y). La pieza corre a lo
  //                          ANCHO: estribos de canto, corchetes en sección.
  //   'de_pie'             → x_local ↔ y_mundo (z_local = z). La pieza corre en
  //                          VERTICAL: longitudinales de muro/columna, mallas de
  //                          cortina. Es la que faltaba para el muro (TANDA 1).
  //
  // Las tres son TRANSPOSICIONES (involutivas): la misma tabla traduce local→mundo
  // y mundo→local, así que no hay una segunda tabla que se pueda desincronizar.
  // Todo lo que sigue está parametrizado por esa tabla — host (dims), recubrimientos,
  // pilas jer_caras, rango.eje/eje_capas, puntos, y la restitución del centro — para
  // que agregar una orientación sea agregar UNA fila, no duplicar el mecanismo.
  //
  // Ejemplo de la permutación x↔z ('volteada'):
  //
  //     x_local ↔ z_mundo     y_local = y_mundo     z_local ↔ x_mundo
  //
  //   · un ESTRIBO con figura en (z,y) repartido en x pasa a figura en (x,y)
  //     repartido en z;
  //   · un CABEZAL que corre en x y se reparte a lo ancho (z) pasa a correr en z
  //     y repartirse a lo largo (x);
  //   · una TRABA (vertical, cose las dos caras) sigue el mismo intercambio: su
  //     posición a lo largo (x) pasa a ser a lo ancho (z) y viceversa.
  //
  // La receta para conseguirlo SIN duplicar distribuidores ni tocar figura_puntos:
  // expandir el componente contra un HOST PERMUTADO (largo↔ancho, y con los
  // recubrimientos que le corresponden a cada cara nueva) y devolver los puntos al
  // mundo con la misma permutación. Consecuencias:
  //   · las dims 'auto' se resuelven contra las dims del NUEVO plano
  //     (estribo volteado: su lado horizontal = largo − 2·recub de extremo);
  //   · el anchor se calcula contra el recubrimiento de las caras nuevas → EL
  //     RECUBRIMIENTO SE MANTIENE POR CONSTRUCCIÓN (era el bug "se pierde el fix
  //     al recubrimiento" al rotar);
  //   · todas las vistas (que son renders 3D) lo muestran girado sin trucos.
  // Con 'acostada' la ruta es IDÉNTICA a la anterior (ni un objeto extra).
  // ---------------------------------------------------------------------------
  // Tabla: eje LOCAL → eje del MUNDO (y, por ser transposición, también al revés).
  var ORIENTACIONES = {
    acostada: null,                             // identidad (sin permutación)
    volteada: { x: 'z', y: 'y', z: 'x' },       // x↔z
    de_pie: { x: 'y', y: 'x', z: 'z' }          // x↔y
  };

  // ORIENTACIÓN EFECTIVA del componente.
  // COMPAT: `plano_pieza.volteado:true` ≡ 'volteada' (es lo que sigue escribiendo
  // el botón de voltear del Template Editor). `orientacion` explícita GANA cuando
  // está presente. normalizarComponente NO la estampa a propósito: si rellenara
  // 'acostada' por default, un toggle posterior de `volteado` quedaría ignorado.
  // CONTRATO DEL VALOR (fix 12-ago, hallazgo C): el motor NORMALIZA lo que lee
  // (minúsculas + trim) en vez de comparar el literal. La UI escribe con
  // toLowerCase, pero una receta que llegue de un JSON externo con 'DE_PIE' o
  // ' volteada' caía silenciosamente en 'acostada' — la pieza salía en otro plano
  // sin un solo error. Las claves de ORIENTACIONES son la fuente única.
  function _orientacionLegacy(comp) {
    var pp = comp && comp.plano_pieza;
    if (!pp) return 'acostada';
    var o = pp.orientacion;
    if (o != null) {
      var k = String(o).toLowerCase().trim();
      if (ORIENTACIONES.hasOwnProperty(k)) return k;
    }
    return pp.volteado ? 'volteada' : 'acostada';
  }

  // ===========================================================================
  // POSE — MODELO ÚNICO DE ORIENTACIÓN (TANDA P)
  // ===========================================================================
  // Hasta acá la POSE de una pieza vivía repartida en CUATRO mecanismos que no se
  // hablaban entre sí:
  //   (1) `cara` sup/inf/lateral      — contra qué cara se apoya;
  //   (2) `lado` ±1                   — de qué lado, sólo para la cara cortina;
  //   (3) `plano_pieza.orientacion`   — acostada / volteada / de_pie (permutación);
  //   (4) `orient.deg` + un EJE_ROT por vista en la UI.
  // Cada elemento nuevo obligaba a un caso especial más (derivaciones por rol,
  // fallbacks, tablas por vista), porque la MISMA información —cómo está parada la
  // pieza— se expresaba de tres formas distintas según quién preguntara.
  //
  // La POSE las unifica en UN dato:
  //
  //     pose = { cara, lado, rumbo, espejo }
  //
  //   cara   : 'sup' | 'inf' | 'lateral' | 'extremo'  → el EJE de la normal:
  //            sup/inf = y · lateral = z (cortinas) · extremo = x (los testeros).
  //   lado   : 1 | −1 → el SIGNO de esa normal. En sup/inf es inerte (la cara ya
  //            trae el signo); manda en 'lateral' y en 'extremo'.
  //   rumbo  : 'x'|'y'|'z' → el eje LONGITUDINAL de la pieza, OBLIGATORIAMENTE ⊥ a
  //            la normal (los 2 ejes que quedan). Si llega uno paralelo se
  //            NORMALIZA al default de esa cara en vez de aceptarlo (no existe una
  //            pieza que corra en la dirección en que se apoya).
  //   espejo : bool → la reflexión que cambia la QUIRALIDAD sin tocar dims.
  //
  // 6 caras × 2 rumbos × 2 espejo = 24 = las orientaciones de una caja.
  //
  // DE LA POSE SE DERIVA TODO (derivarPose, una sola función):
  //   N = normal (cara+lado) · L = longitudinal (rumbo) · B = L×N (binormal, marco
  //   dextrógiro) · P = permutación LOCAL→MUNDO · caraLocal/ladoLocal.
  //
  // POR QUÉ LA PERMUTACIÓN SÓLO DEPENDE DEL RUMBO — y la cara viaja aparte:
  // el marco LOCAL en el que trabajan los distribuidores y los constructores es
  // (x = eje que la pieza recorre o a lo largo del cual se repite, y = alto,
  // z = ancho). La CARA no elige ese marco: elige, DENTRO de él, cuál de los dos
  // ejes de la sección es la normal (y± = sup/inf, z± = lateral) — que es
  // exactamente el "roll" de las 24. Por eso P = transposición (x ↔ rumbo), las
  // MISMAS tres tablas de siempre (acostada/volteada/de_pie), y toda la maquinaria
  // dura que ya permuta host, recubrimientos, PILAS por cara, rango.eje, eje_capas
  // y puntos se REUSA tal cual: generalizar de 3 permutaciones a las 24 poses no
  // agrega un solo caso especial, sólo cambia de dónde salen `caraLocal` y `P`.
  //
  // CARA 'extremo' SALE GRATIS de ahí: pose { cara:'extremo', lado:+1, rumbo:'y' }
  // → P = x↔y y caraLocal = 'sup', o sea la pieza se ancla contra la cara local
  // superior de un host cuyo "alto" local es el LARGO real y cuyo recubrimiento
  // local superior es `recub_ext` (con su pila `jer_caras.ext`). Un cabezal de
  // borde de muro —corre en Y, pegado al testero— es esa pose y nada más.
  //
  // COMPATIBILIDAD: los campos viejos se siguen aceptando PARA SIEMPRE. `poseDe`
  // los traduce (cara LOCAL + orientación → cara del MUNDO) y la traducción es
  // EXACTA: para cualquier receta existente el `P` y el `caraLocal` derivados son
  // los mismos de antes, así que los placements salen BYTE-IDÉNTICOS.
  // ---------------------------------------------------------------------------
  var CARAS_POSE = ['sup', 'inf', 'lateral', 'extremo'];
  var EJES_MUNDO = ['x', 'y', 'z'];
  // Eje del MUNDO al que mira cada cara (el eje de su normal).
  var EJE_DE_CARA = { sup: 'y', inf: 'y', lateral: 'z', extremo: 'x' };
  // rumbo ↔ etiqueta de orientación vieja. Es la MISMA permutación: la etiqueta
  // sobrevive porque la escriben las recetas guardadas y la lee la UI.
  var RUMBO_A_ORIENT = { x: 'acostada', z: 'volteada', y: 'de_pie' };
  var ORIENT_A_RUMBO = { acostada: 'x', volteada: 'z', de_pie: 'y' };
  // Permutación LOCAL→MUNDO por rumbo = transposición (x ↔ rumbo). Involutiva:
  // la misma tabla traduce en los dos sentidos (por eso no hay una 2ª tabla que
  // se pueda desincronizar). null = identidad → ruta sin permutar.
  var PERM_POR_RUMBO = { x: null, z: ORIENTACIONES.volteada, y: ORIENTACIONES.de_pie };

  function _caraCanon(c) {
    var k = String(c == null ? '' : c).toLowerCase().trim();
    if (k === 'lat') k = 'lateral';
    if (k === 'ext') k = 'extremo';
    return (CARAS_POSE.indexOf(k) >= 0) ? k : null;
  }
  function _ejeCanon(e) {
    var k = String(e == null ? '' : e).toLowerCase().trim();
    return (EJES_MUNDO.indexOf(k) >= 0) ? k : null;
  }
  // Los DOS ejes ⊥ a la normal de una cara = los rumbos POSIBLES de esa cara.
  function rumbosDeCara(cara) {
    var n = EJE_DE_CARA[_caraCanon(cara) || 'sup'];
    return EJES_MUNDO.filter(function (e) { return e !== n; });
  }
  // Rumbo por defecto: el LARGO (x) si es ⊥ a la cara; si no, el primero que quede
  // (cara 'extremo' → 'y': un cabezal de borde corre en alto, que es lo natural).
  function _rumboDefaultDeCara(cara) {
    var r = rumbosDeCara(cara);
    return (r.indexOf('x') >= 0) ? 'x' : r[0];
  }
  // SIGNO de la normal. En sup/inf lo trae la cara; en lateral/extremo, `lado`.
  function _signoCara(cara, lado) {
    if (cara === 'sup') return 1;
    if (cara === 'inf') return -1;
    return (Number(lado) < 0) ? -1 : 1;
  }

  // Pose CANÓNICA (siempre un objeto nuevo, nunca una referencia al componente).
  // CANÓNICA de verdad: `lado` se fuerza al signo que la cara YA implica en sup/inf
  // (+1 / −1). Aceptar `{cara:'inf', lado:1}` dejaba DOS representaciones del mismo
  // estado, y con dos representaciones el giro de 90° dejaba de ser una operación
  // cerrada (girar 4 veces devolvía la pose equivalente pero no la MISMA). En
  // 'lateral' y 'extremo' el lado sí es el dato que elige la cara del par.
  function normalizarPose(pose) {
    var p = pose || {};
    var cara = _caraCanon(p.cara) || 'sup';
    var lado = _signoCara(cara, p.lado);
    var rumbo = _ejeCanon(p.rumbo);
    if (!rumbo || rumbosDeCara(cara).indexOf(rumbo) < 0) rumbo = _rumboDefaultDeCara(cara);
    return { cara: cara, lado: lado, rumbo: rumbo, espejo: !!p.espejo };
  }

  // Producto vectorial de dos ejes unitarios con signo → { eje, s }.
  var _CROSS = { xy: 'z', yz: 'x', zx: 'y' };
  function _cruz(a, b) {
    if (!a || !b || a.eje === b.eje) return null;
    var e = _CROSS[a.eje + b.eje];
    if (e) return { eje: e, s: a.s * b.s };
    return { eje: _CROSS[b.eje + a.eje], s: -a.s * b.s };
  }

  // EL SIGNO DEL LONGITUDINAL LO LLEVA `espejo` (defecto D4 del verificador).
  // ---------------------------------------------------------------------------
  // Las orientaciones de una caja son 24 = 6 normales × 4 longitudinales ⊥ a ella
  // CON SIGNO. El rumbo es un eje SIN signo, así que cara+lado+rumbo sólo enumera
  // 6 × 2 = 12: falta exactamente el bit del SENTIDO de L. Ese bit ya existe y se
  // llama `espejo`.
  //
  // POR QUÉ SON LA MISMA COSA — y no dos controles distintos. Girar la pieza 180°
  // en torno a su NORMAL manda L → −L y B → −B, dejando N quieta. Las piezas que
  // este motor dibuja son PLANAS:
  //   · cadena / cabezal con patas → su plano es (L, N). El giro de 180° le
  //     invierte L y le deja N: dentro de su propio plano eso es exactamente
  //     u → −u, que es lo que hace `anchor.espejo` en _planoTrabajo.
  //   · estribo / traba            → su plano es (N, B). El mismo giro le invierte
  //     B: otra vez u → −u, lo que hace `anchor.espejo` en _cadenaSeccion /
  //     _estriboPerimetral (los ganchos cambian de esquina).
  // En una figura plana el "reflejo" y el "medio giro" NO son distinguibles, así
  // que UN bit alcanza y sobra para cerrar el grupo: 6 caras × 2 rumbos × 2 =
  // las 24 orientaciones, sin agregar un campo nuevo a la receta.
  //
  // CONSECUENCIA MEDIDA de no hacerlo (lo que corrige este cambio): con L siempre
  // en +1, girar 90° en torno a la propia normal sólo alternaba DOS estados (el
  // giro de 180° era indistinguible de la identidad) → 24 de las 72 órbitas de
  // rotarPose90 tenían orden 2 y la tecla R nunca alcanzaba media vuelta; y
  // derivarPose publicaba L (y con ella B = L×N) con el signo cambiado en 12 de
  // los 36 giros.
  //
  // NO MUEVE UNA SOLA RECETA: `espejo` false ⇒ L.s = +1, que es lo que valía antes,
  // y las recetas viejas no traen espejo. El resto del motor tampoco cambia, porque
  // la permutación P y la caraLocal dependen del EJE del rumbo, no de su signo.
  function _signoLong(p) { return p.espejo ? -1 : 1; }

  // LA función: de la pose sale todo lo demás.
  //   N/L/B      : ejes del MUNDO con signo (marco dextrógiro (L, N, B), B = L×N —
  //                el orden que reproduce la identidad: cara sup + rumbo x → +z).
  //   P          : permutación local→mundo (null = identidad).
  //   caraLocal  : 'sup'|'inf'|'lateral' — la cara EN EL MARCO LOCAL, que es lo que
  //                consumen _marcoCara / figura_puntos (ahí no cambió nada).
  //   ladoLocal  : signo de esa cara local.
  //   orientacion: la etiqueta vieja equivalente (trazabilidad y compat de la UI).
  function derivarPose(pose) {
    var p = normalizarPose(pose);
    var ejeN = EJE_DE_CARA[p.cara];
    var sN = _signoCara(p.cara, p.lado);
    var N = { eje: ejeN, s: sN };
    var L = { eje: p.rumbo, s: _signoLong(p) };
    var P = PERM_POR_RUMBO[p.rumbo] || null;
    var ejeLocalY = P ? P.y : 'y';
    var caraLocal = (ejeN === ejeLocalY) ? ((sN > 0) ? 'sup' : 'inf') : 'lateral';
    return {
      pose: p, N: N, L: L, B: _cruz(L, N), P: P,
      caraLocal: caraLocal, ladoLocal: sN,
      orientacion: RUMBO_A_ORIENT[p.rumbo] || 'acostada'
    };
  }

  // POSE DE UN COMPONENTE. `comp.pose` MANDA cuando está; si no, se DERIVA de los
  // campos viejos — y esa derivación es el contrato de compatibilidad:
  //   cara LOCAL (sup/inf = local y± · lateral = local z±) + permutación de la
  //   orientación → cara del MUNDO. Ejemplos, que son los que ya usan las recetas:
  //     cara sup     + acostada → sup       (identidad)
  //     cara lateral + acostada → lateral   (identidad)
  //     cara sup     + volteada → sup       (x↔z: la cara local y sigue siendo y)
  //     cara lateral + volteada → extremo   (x↔z: la cara local z pasa a ser x)
  //     cara sup     + de_pie   → extremo   (x↔y: la cara local y pasa a ser x)
  //     cara lateral + de_pie   → lateral   (x↔y: la cara local z sigue siendo z)
  // NO se estampa la pose derivada dentro de `comp` como campo enumerable A
  // PROPÓSITO — es la misma razón ya documentada para `orientacion`: si se
  // rellenara, un cambio posterior de `cara`/`volteado` quedaría ignorado (el dato
  // viejo dejaría de tener efecto sin que nada lo diga). Se publica en `comp._pose`
  // (NO enumerable: no ensucia la receta que se guarda ni el dirty-tracking) y se
  // recalcula en cada normalizarComponente, así que nunca queda vieja.
  function poseDe(comp) {
    var p = comp && comp.pose;
    if (p && typeof p === 'object' && (_caraCanon(p.cara) || _ejeCanon(p.rumbo))) {
      return normalizarPose(p);
    }
    var ori = _orientacionLegacy(comp);
    var caraDecl = _caraCanon(comp && comp.cara);
    var rumbo = ORIENT_A_RUMBO[ori] || 'x';
    // 'extremo' NO existe en el vocabulario viejo: si aparece en `comp.cara` es
    // vocabulario de POSE escrito en el campo viejo (lo hace el editor al espejar
    // la pose), y ahí `cara` YA es del mundo.
    if (caraDecl === 'extremo') {
      return normalizarPose({ cara: 'extremo', lado: comp.lado, rumbo: rumbo, espejo: comp.espejo });
    }
    var P = ORIENTACIONES[ori] || null;
    var ejeLocal = (caraDecl === 'lateral') ? 'z' : 'y';
    var sLocal = (caraDecl === 'inf') ? -1
      : ((caraDecl === 'lateral') ? ((Number(comp && comp.lado) < 0) ? -1 : 1) : 1);
    var ejeMundo = P ? P[ejeLocal] : ejeLocal;
    var cara = (ejeMundo === 'y') ? ((sLocal > 0) ? 'sup' : 'inf')
      : ((ejeMundo === 'z') ? 'lateral' : 'extremo');
    return normalizarPose({ cara: cara, lado: sLocal, rumbo: rumbo, espejo: comp && comp.espejo });
  }

  // ---------------------------------------------------------------------------
  // ROTAR-EN-VISTA — la operación que faltaba (TANDA P · §4)
  // ---------------------------------------------------------------------------
  // rotarPose90(pose, ejeMundo) = la pieza gira 90° alrededor de un eje del MUNDO
  // (el de profundidad de la vista en la que el usuario está mirando: "gírala según
  // lo que veo"). Es una operación CERRADA en el grupo de las 24 —gira N y L, que
  // siguen siendo ejes con signo y siguen siendo ⊥— y aplicarla 4 veces devuelve la
  // pose EXACTA de partida.
  // Caras, pilas, recubrimientos y eje de reparto NO se tocan: se RE-DERIVAN solos,
  // porque todos salen de la pose. `orient.deg` queda para los ángulos finos.
  //
  // EL SIGNO DE L SE ESCRIBE DE VUELTA EN `espejo` (defecto D4 del verificador; el
  // porqué está arriba, en _signoLong). Antes se giraba L y se TIRABA su signo,
  // conservando el `espejo` de entrada: el giro dejaba de ser una rotación y pasaba
  // a ser una proyección sobre 12 estados. Cuatro giros seguían "volviendo al
  // origen" —por eso el test no lo veía— pero en 24 de las 72 órbitas volvían en
  // DOS pasos: girar en torno a la propia normal alternaba dos poses y la media
  // vuelta era inalcanzable con la tecla R.
  var _ROT90 = {
    x: { x: { eje: 'x', s: 1 }, y: { eje: 'z', s: 1 }, z: { eje: 'y', s: -1 } },
    y: { y: { eje: 'y', s: 1 }, z: { eje: 'x', s: 1 }, x: { eje: 'z', s: -1 } },
    z: { z: { eje: 'z', s: 1 }, x: { eje: 'y', s: 1 }, y: { eje: 'x', s: -1 } }
  };
  function _rotarEje(v, ejeVista) {
    var t = _ROT90[ejeVista];
    if (!t || !v) return v;
    var r = t[v.eje];
    return { eje: r.eje, s: v.s * r.s };
  }
  function rotarPose90(pose, ejeVista) {
    var d = derivarPose(pose);
    var e = _ejeCanon(ejeVista);
    if (!e) return d.pose;
    var N2 = _rotarEje(d.N, e);
    var L2 = _rotarEje(d.L, e);
    var cara2 = (N2.eje === 'y') ? ((N2.s > 0) ? 'sup' : 'inf')
      : ((N2.eje === 'z') ? 'lateral' : 'extremo');
    return normalizarPose({ cara: cara2, lado: N2.s, rumbo: L2.eje, espejo: (L2.s < 0) });
  }

  // ---------------------------------------------------------------------------
  // POSES POR DEFECTO — TABLA DE DATOS (elemento × tipología), no código.
  // ---------------------------------------------------------------------------
  // Es lo que se coloca al crear un componente: la pose que un enfierrador daría
  // por obvia. Que sea DATO importa: agregar un elemento o una tipología nueva es
  // agregar una fila, y la UI la consume tal cual (no re-implementa defaults).
  //   VIGA  → exactamente lo de hoy (cara sup/inf/lateral, todo corriendo en X).
  //   MURO  → largo = x · alto = y · espesor = z:
  //           · MH  malla horizontal, cortina que corre a lo LARGO      → lateral, x
  //           · MV  malla vertical, la misma cortina DE PIE             → lateral, y
  //           · EC  estribo/amarra: su MARCO va en el plano HORIZONTAL
  //                 (x,z) repartido en altura → rumbo Y. Es la pose de_pie
  //                 del estribo; con la default vieja (rumbo x) el marco salía
  //                 VERTICAL, que es el bug reportado.
  //           · TC/TR trabas que COSEN las dos cortinas: corren en el espesor → z.
  //           · CB  cabezal de borde: corre en alto, pegado al TESTERO  → extremo, y
  var POSES_DEFAULT = {
    VIGA: {
      CBS: { cara: 'sup', lado: 1, rumbo: 'x' },
      CBS2: { cara: 'sup', lado: 1, rumbo: 'x' },
      CBSN: { cara: 'sup', lado: 1, rumbo: 'x' },
      CBI: { cara: 'inf', lado: -1, rumbo: 'x' },
      CBI2: { cara: 'inf', lado: -1, rumbo: 'x' },
      CBIN: { cara: 'inf', lado: -1, rumbo: 'x' },
      LT: { cara: 'lateral', lado: 1, rumbo: 'x' },
      ES: { cara: 'lateral', lado: 1, rumbo: 'x' },
      TRV: { cara: 'lateral', lado: 1, rumbo: 'x' }
    },
    MURO: {
      MH: { cara: 'lateral', lado: 1, rumbo: 'x' },
      MV: { cara: 'lateral', lado: 1, rumbo: 'y' },
      MA: { cara: 'lateral', lado: 1, rumbo: 'x' },
      EC: { cara: 'lateral', lado: 1, rumbo: 'y' },
      TC: { cara: 'extremo', lado: 1, rumbo: 'z' },
      TR: { cara: 'extremo', lado: 1, rumbo: 'z' },
      TM: { cara: 'extremo', lado: 1, rumbo: 'z' },
      CB: { cara: 'extremo', lado: 1, rumbo: 'y' }
    },
    COLUMNA: {
      CB: { cara: 'lateral', lado: 1, rumbo: 'y' },
      CB2: { cara: 'lateral', lado: 1, rumbo: 'y' },
      CBN: { cara: 'lateral', lado: 1, rumbo: 'y' },
      ESC: { cara: 'lateral', lado: 1, rumbo: 'y' },
      TRC: { cara: 'extremo', lado: 1, rumbo: 'z' }
    },
    LOSA: {
      FI: { cara: 'inf', lado: -1, rumbo: 'x' },
      FS: { cara: 'inf', lado: -1, rumbo: 'z' },
      "F'I": { cara: 'sup', lado: 1, rumbo: 'x' },
      "F'S": { cara: 'sup', lado: 1, rumbo: 'z' },
      F: { cara: 'inf', lado: -1, rumbo: 'x' },
      "F'": { cara: 'sup', lado: 1, rumbo: 'x' },
      RP: { cara: 'inf', lado: -1, rumbo: 'z' },
      SP: { cara: 'inf', lado: -1, rumbo: 'x' },
      TRL: { cara: 'lateral', lado: 1, rumbo: 'x' }
    }
  };

  // Pose default de (elemento, tipología) — null si la tabla no la conoce (el
  // llamador cae a sus defaults de siempre; no se inventa una pose).
  function poseDefault(elemento, tipologia) {
    var e = String(elemento == null ? '' : elemento).toUpperCase().trim();
    var t = String(tipologia == null ? '' : tipologia).toUpperCase().trim();
    var tabla = POSES_DEFAULT[e];
    if (!tabla || !Object.prototype.hasOwnProperty.call(tabla, t)) return null;
    return normalizarPose(tabla[t]);
  }

  // Permutación (tabla) de un componente. null = identidad (ruta sin permutar).
  function _permDe(comp) {
    return derivarPose(poseDe(comp)).P;
  }

  // Etiqueta de orientación del componente ('acostada'|'volteada'|'de_pie'). Sale
  // de la POSE (fuente única), así que un componente con pose nueva y otro con los
  // campos viejos equivalentes reportan lo mismo.
  function orientacionPieza(comp) {
    return derivarPose(poseDe(comp)).orientacion;
  }

  function estaVolteado(comp) {
    return orientacionPieza(comp) === 'volteada';
  }

  // Eje del MUNDO a lo largo del cual REPARTE este componente (rango/zonas) = el
  // RUMBO de su pose. Los distribuidores reparten sobre su x local y la permutación
  // dice qué eje del mundo es esa x local. Lo consume la UI (flecha de rango,
  // arrastre del rango) para operar sobre el eje real y no siempre sobre X.
  function ejeDistribucion(comp) {
    return poseDe(comp).rumbo;
  }

  // Eje del MUNDO en el que se apilan las capas (layered/arreglo), dado el eje
  // LOCAL declarado en la distribución (default 'z').
  function ejeCapas(comp, ejeLocal) {
    var e = (ejeLocal === 'x' || ejeLocal === 'y' || ejeLocal === 'z') ? ejeLocal : 'z';
    var P = _permDe(comp);
    return P ? P[e] : e;
  }

  // --- Host PERMUTADO (marco local de la pieza) ------------------------------
  // Cada eje del mundo tiene sus caras: x → 'ext' (par simétrico), y → 'sup'/'inf'
  // (INDEPENDIENTES), z → 'lat' (par simétrico). Permutar el host es reescribir
  // dims, recubrimientos y PILAS cara por cara siguiendo la tabla de la orientación.
  // Sin esto la pieza se anclaba contra la pila/recub equivocados (p.ej. un
  // corchete volteado se acortaba por el φ de un estribo que NO ocupa los extremos).
  function _dimDeEje(host, e) {
    return Number(e === 'x' ? host.largo : (e === 'y' ? host.alto : host.ancho));
  }

  // Recubrimiento SIMÉTRICO de un eje del mundo (el que cierra ese eje por los dos
  // lados). El eje Y es el único con dos caras distintas: cuando pasa a ser un eje
  // simétrico del marco local (orientación 'de_pie') se toma el MAYOR de sup/inf —
  // la barra no puede violar ninguno de los dos recubrimientos. Documentado como
  // límite: con recub_sup ≠ recub_inf una pieza de pie queda centrada contra el
  // recubrimiento más exigente (para el muro típico son iguales).
  function _recubDeEje(host, e) {
    if (e === 'x') return _recubDeCara(host, 'ext');
    if (e === 'z') return _recubDeCara(host, 'lat');
    return Math.max(_recubDeCara(host, 'sup'), _recubDeCara(host, 'inf'));
  }

  // Pila (φmax por nivel) de un eje del mundo, con el mismo criterio simétrico.
  function _pilaDeEje(jc, e) {
    if (!jc) return null;
    if (e === 'x') return jc.ext;
    if (e === 'z') return jc.lat;
    var a = jc.sup || [], b = jc.inf || [], out = [];
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      out.push(Math.max(Number(a[i]) || 0, Number(b[i]) || 0));
    }
    return out;
  }

  function _hostPermutado(host, P) {
    var h = {
      largo: _dimDeEje(host, P.x), alto: _dimDeEje(host, P.y), ancho: _dimDeEje(host, P.z),
      // Las caras verticales LOCALES (sup/inf) sólo siguen siendo independientes
      // si el eje y del mundo sigue siendo el y local; si no, heredan el par
      // simétrico del eje que ocupa ese lugar.
      recub_sup: (P.y === 'y') ? _recubDeCara(host, 'sup') : _recubDeEje(host, P.y),
      recub_inf: (P.y === 'y') ? _recubDeCara(host, 'inf') : _recubDeEje(host, P.y),
      recub_lat: _recubDeEje(host, P.z),
      recub_ext: _recubDeEje(host, P.x)
    };
    var jc = host.jer_caras;
    if (jc) {
      h.jer_caras = {
        sup: (P.y === 'y') ? jc.sup : _pilaDeEje(jc, P.y),
        inf: (P.y === 'y') ? jc.inf : _pilaDeEje(jc, P.y),
        lat: _pilaDeEje(jc, P.z),
        ext: _pilaDeEje(jc, P.x)
      };
    } else if (host.jer_phi) h.jer_phi = host.jer_phi;   // compat: pila única legacy
    if (host.phi_est != null) h.phi_est = host.phi_est;
    return h;
  }

  // Punto del marco LOCAL → mundo (y viceversa: la permutación es involutiva).
  // Conserva el flag `esArco` (perf del motor geométrico: no re-filetear arcos).
  function _permPunto(p, P) {
    var q = { x: p[P.x], y: p[P.y], z: p[P.z] };
    if (p.esArco) q.esArco = true;
    return q;
  }

  // cfg de distribución traducida al marco local. TODO campo que nombre un EJE
  // viaja en ejes del MUNDO (los escribe el panel: `_rangoDefault` estampa
  // rango.eje = 'z' para un estribo volteado y 'x' para un cabezal volteado) y hay
  // que traducirlo, no sólo `eje_capas`:
  //   · eje_capas → eje de apilado de las capas;
  //   · rango.eje → eje sobre el que REPARTE el distribuidor lineal/arreglo.
  // Los VALORES (from/to) no cambian: la permutación intercambia las etiquetas de
  // los ejes, no las coordenadas (x_local = z_mundo, mismo número).
  // Sin traducir rango.eje, un estribo volteado repartía sobre un eje local que
  // _estriboPerimetral ignora → las N barras quedaban TODAS en el mismo plano
  // (colapso), y un cabezal volteado se repartía sobre su propio eje longitudinal
  // dejando además su coordenada local sin definir.
  function _cfgLocal(dist, P) {
    if (!dist || !P) return dist;
    var tieneCapas = (dist.eje_capas != null);
    var tieneRango = !!(dist.rango && dist.rango.eje != null);
    if (!tieneCapas && !tieneRango) return dist;
    var c = {};
    for (var k in dist) if (dist.hasOwnProperty(k)) c[k] = dist[k];
    if (tieneCapas) c.eje_capas = P[String(dist.eje_capas)] || dist.eje_capas;
    if (tieneRango) {
      var r = {};
      for (var j in dist.rango) if (dist.rango.hasOwnProperty(j)) r[j] = dist.rango[j];
      r.eje = P[String(dist.rango.eje)] || dist.rango.eje;
      c.rango = r;                      // clon: NO se muta el rango de la receta
    }
    return c;
  }

  // ---------------------------------------------------------------------------
  // POSICIONES DE UN RANGO  (fuente ÚNICA para linear y arreglo)
  // ---------------------------------------------------------------------------
  // Un RANGO reparte entre dos coordenadas absolutas del host (from/to, cm) y
  // admite DOS formas:
  //
  //  A) @ ÚNICO  (rango.sep / cfg.sep) — lo de siempre. nR = ceil(span/@)+1 barras
  //     equiespaciadas con PASO REAL span/(nR−1) ≤ @ ("cada @ o menos"): el
  //     recorrido CIERRA en `to` (avanzar con el @ nominal dejaba un hueco muerto
  //     en un extremo, ver historia abajo).
  //
  //  B) TRAMOS  (rango.tramos = [{long, sep}, …]) — un solo componente con varias
  //     separaciones: el caso real del calculista es UN estribo @10 / @20 / @10.
  //     Antes había que declarar TRES componentes (o usar `zonas`, que arranca
  //     del recubrimiento y no del rango que el usuario arrastró en pantalla).
  //     Se consume tramo a tramo DESDE `from`:
  //       · cada tramo cuenta con el MISMO criterio que las zonas —
  //         redondeoCantidadZona(long, sep) = ceil(long/sep)+1 — y coloca esas n
  //         barras equiespaciadas dentro de SU tramo, con paso real ≤ su @;
  //       · la barra de UNIÓN no se duplica: la última de un tramo cae EXACTAMENTE
  //         donde la primera del siguiente (por construcción, porque cada tramo
  //         cierra su propio intervalo) y se emite UNA sola vez. (Ojo: `zonas`
  //         SÍ duplica esa barra desde siempre — avanza con el @ nominal —, y eso
  //         NO se toca acá: la viga-semilla depende de ese conteo.)
  //       · todo se CLAMPEA a `to`: un tramo que se pasa se corta ahí y los
  //         siguientes no se colocan;
  //       · si los tramos NO cubren el rango, el ÚLTIMO @ CONTINÚA hasta `to`
  //         (el usuario declara la zona de confinamiento y el resto se rellena).
  //     Sin `tramos` la rama A queda idéntica → cero regresión.
  //
  // Devuelve un array de coordenadas (cm, sobre el eje que reparte), ordenado y
  // sin duplicados.
  var _EPS_POS = 1e-6;

  // ---------------------------------------------------------------------------
  // CAPEO ANTES DE GENERAR — freno de mano, NO una defensa que enmascara
  // ---------------------------------------------------------------------------
  // El motor acepta cualquier @ y cualquier n_capas: un @ 0.1 en un rango de 600
  // pedía 6001 placements (× nº de capas) y el navegador se congelaba ANTES de
  // que el warning anti-colapso — que se emite DESPUÉS de generar — llegara a
  // verse. Con esto el distribuidor DEJA DE EMITIR al llegar al techo y escribe
  // el porqué en comp._avisos (el mismo canal no enumerable de las capas
  // omitidas): el dato NO se esconde ni se "arregla" solo — queda a la vista,
  // con el número que lo causó, para que el usuario corrija el @ o el rango.
  //
  // Los topes son POR COMPONENTE (un template con 10 componentes normales no los
  // roza ni de lejos: la viga-semilla entera son 72 barras) y valen para las tres
  // fuentes de explosión: posiciones de un rango/tramos, zonas encadenadas y el
  // producto rango × capas de layered/arreglo.
  var TOPE_PLACEMENTS_COMP = 2000;   // barras emitidas por UN componente
  var TOPE_CAPAS_COMP = 200;         // n_capas de layered/arreglo

  // Marca de truncado que viaja con el array de posiciones (NO enumerable: las
  // posiciones se serializan/copian y una marca derivada no puede ensuciarlas).
  // La lee el distribuidor, que es quien tiene el `base` donde vive el aviso.
  function _marcarTope(arr, sep) {
    var info = { n: arr.length, sep: Number(sep) };
    try {
      Object.defineProperty(arr, '_tope',
        { value: info, enumerable: false, writable: true, configurable: true });
    } catch (e) { /* array sellado: el tope igual frenó el bucle */ }
    return arr;
  }

  function _num(x) {
    var n = Number(x);
    return isFinite(n) ? (Math.round(n * 1000) / 1000) : null;
  }

  // Texto ÚNICO del tope de barras (lo emiten linear, arreglo y layered).
  function _avisoTope(sep) {
    var s = _num(sep);
    return 'distribución truncada en ' + TOPE_PLACEMENTS_COMP + ' barras: revisa el @' +
      (s != null && s > 0 ? ' (' + s + ' cm)' : '') + ' o el rango';
  }

  // Texto ÚNICO del tope de capas (layered y arreglo).
  function _avisoTopeCapas(pedidas) {
    return 'capas truncadas en ' + TOPE_CAPAS_COMP + ' (la receta pide ' +
      (_num(pedidas) != null ? _num(pedidas) : '?') + '): revisa el nº de capas';
  }

  // n_capas efectivo + aviso si la receta pedía más que el techo duro.
  function _capasCapeadas(base, nPedidas) {
    var n = Math.max(1, Number(nPedidas) || 1);
    if (n <= TOPE_CAPAS_COMP) return n;
    _avisar(base, _avisoTopeCapas(nPedidas));
    return TOPE_CAPAS_COMP;
  }

  function _pushPos(arr, x) {
    if (arr.length && Math.abs(arr[arr.length - 1] - x) <= _EPS_POS) return;  // unión: 1 sola barra
    arr.push(x);
  }

  // n barras equiespaciadas en [a, b] con paso real ≤ sep, clampeadas a `tope`.
  // Devuelve false si se alcanzó TOPE_PLACEMENTS_COMP (y deja la marca en `arr`):
  // el llamador debe dejar de repartir tramos.
  function _repartirTramo(arr, a, b, sep, tope) {
    var span = b - a;
    var n = redondeoCantidadZona(span, sep);
    var paso = (n > 1) ? span / (n - 1) : 0;
    for (var i = 0; i < n; i++) {
      // TECHO: se comprueba ANTES de calcular la posición, así un @ de 0.1 (o de
      // 1e-9) no llega nunca a iterar sus 6001 — ni sus 6e11 — vueltas.
      if (arr.length >= TOPE_PLACEMENTS_COMP) { _marcarTope(arr, sep); return false; }
      var x = a + i * paso;
      if (x > tope + _EPS_POS) break;
      _pushPos(arr, x);
    }
    return true;
  }

  function posicionesRango(rango, sepDefault) {
    var rf = Math.min(Number(rango.from), Number(rango.to));
    var rt = Math.max(Number(rango.from), Number(rango.to));
    var sep = Number(sepDefault || rango.sep || 20) || 20;
    var tramos = (rango.tramos && rango.tramos.length) ? rango.tramos : null;
    var pos = [];
    if (!tramos) {                       // A) @ único — comportamiento histórico
      _repartirTramo(pos, rf, rt, sep, rt);   // (puede marcar pos._tope y frenar)
      return pos;
    }
    // B) tramos encadenados desde `from`. DIRECCIÓN: los tramos se anclan en el
    // `from` REAL del usuario (hallazgo del verificador: normalizar con min/max
    // ponía el 1er tramo siempre a la izquierda — un arrastre derecha→izquierda
    // dejaba el @10 en el extremo equivocado, en silencio). Si from > to se
    // reparte en el espejo y se reflejan las posiciones al final.
    var invertido = Number(rango.from) > Number(rango.to);
    var cur = rf;
    var ultSep = sep;                    // el @ que CONTINÚA si los tramos no llegan
    var truncado = false;
    for (var t = 0; t < tramos.length && cur < rt - _EPS_POS; t++) {
      var tr = tramos[t] || {};
      var lt = Number(tr.long) || 0;
      var st = Number(tr.sep) || 0;
      if (st > 0) ultSep = st;
      if (lt <= 0) continue;             // tramo sin largo = no consume nada
      var fin = Math.min(cur + lt, rt);  // CLAMP al rango
      // Un tramo con @ imposible frena TODA la cadena: los siguientes no se
      // colocan (el reparto ya no representa la receta y hay que corregirla).
      if (!_repartirTramo(pos, cur, fin, ultSep, rt)) { truncado = true; break; }
      cur = fin;
    }
    // COLA: los tramos no cubrieron el rango → el último @ sigue hasta `to`.
    if (!truncado && cur < rt - _EPS_POS && !_repartirTramo(pos, cur, rt, ultSep, rt)) truncado = true;
    // Caso borde: tramos = [{long:0}] y nada colocado → al menos la barra de `from`.
    if (!pos.length) _pushPos(pos, rf);
    // Reflejo para el rango invertido: el 1er tramo queda pegado al `from` real.
    if (invertido) {
      var cen = (rf + rt) / 2;
      var marca = pos._tope;             // map+reverse hacen array NUEVO: la marca no viaja sola
      pos = pos.map(function (p) { return 2 * cen - p; }).reverse();
      if (marca) _marcarTope(pos, marca.sep);
    }
    return pos;
  }

  // ---------------------------------------------------------------------------
  // DISTRIBUIDORES
  // ---------------------------------------------------------------------------

  // LINEAR — a lo largo del eje X (largo). cfg.zonas = [{long, sep}] (cm). Por
  // cada zona: n = redondeoCantidadZona(long, sep); posiciona n placements
  // repartidos por la zona. Usado por estribos (con confinamiento por zonas).
  // base: { figura, diam, tipologia, suf, dims, angulos, host, anchorBase, rol }
  function distribuidorLinear(base, cfg, host) {
    var placements = [];
    // RANGO (Template Editor): distribución @sep entre 2 X absolutas (from/to en
    // cm host), en vez de zonas. ADITIVO: solo si cfg.rango está presente.
    if (cfg && cfg.rango && cfg.rango.from != null && cfg.rango.to != null) {
      // Eje del reparto: 'x' (default, estribos a lo largo) o el que declare el
      // rango — un CABEZAL corre en x, así que su rango reparte copias en 'z'
      // (a lo ancho); repartirlo en x lo apilaría sobre sí mismo.
      var ejeR = (cfg.rango.eje === 'y' || cfg.rango.eje === 'z') ? cfg.rango.eje : 'x';
      // PASO REAL (no el nominal): el conteo ArmaPilot ceil(span/@)+1 CIERRA el
      // intervalo, así que las nR barras se reparten equiespaciadas entre from y
      // to con paso = span/(nR−1) ≤ @ ("cada @ o menos"). Avanzar con el @ NOMINAL
      // hacía que el recorrido no alcanzara `to` y el bucle cortara antes:
      // prometía nR barras y colocaba menos, dejando un hueco muerto en un extremo
      // (span 24 @20 → nR=3 pero colocaba 2 en −12 y +8, con 4 cm muertos).
      // Con rango.tramos el reparto es por TRAMOS (@10/@20/@10) — misma función.
      var posR = posicionesRango(cfg.rango, cfg.sep);
      // El reparto se capó (@ minúsculo o rango gigante): la barra de estado lo
      // dice con el número que lo causó. No se "corrige" el @ por detrás.
      if (posR._tope) _avisar(base, _avisoTope(posR._tope.sep));
      for (var ri = 0; ri < posR.length; ri++) {
        var xr = posR[ri];
        var extraR = {}; extraR[ejeR] = xr;
        // El distribuidor sólo fija el EJE QUE REPARTE; el resto de la pose sale
        // del anchor base (que ya trae la Y de cara y la Z del cabezal). Antes se
        // parcheaba aquí sólo la Y y sólo en este distribuidor: los otros dos
        // (arreglo/points) seguían emitiendo puntos con coordenadas undefined.
        var anchorR = _mezclarAnchor(base.anchorBase, extraR);
        var puntosR = _fp().figuraAPuntos(base.figura, base.dims, host, anchorR,
          { rol: base.rol || 'estribo', diamCm: base.diam });
        placements.push(_placement(base, puntosR, { rango: 1 }));
      }
      return placements;
    }
    var zonas = (cfg && cfg.zonas) || [];
    var start = (cfg && cfg.start_offset) || (base.anchorBase && base.anchorBase.recubExtremo) || 0;
    var xcur = -host.largo / 2 + start;   // arranca tras el recubrimiento
    var x1 = host.largo / 2 - start;
    for (var zi = 0; zi < zonas.length; zi++) {
      var z = zonas[zi];
      var n = redondeoCantidadZona(z.long, z.sep);
      for (var k = 0; k < n; k++) {
        // MISMO techo que el rango: una zona con @ 0.1 pedía miles de estribos.
        if (placements.length >= TOPE_PLACEMENTS_COMP) {
          _avisar(base, _avisoTope(z.sep));
          return placements;
        }
        var xx = xcur + k * (Number(z.sep) || 0);
        if (xx > x1 + 1e-6) break;
        var anchor = _mezclarAnchor(base.anchorBase, { x: xx });
        var puntos = _fp().figuraAPuntos(base.figura, base.dims, host, anchor,
          { rol: base.rol || 'estribo', diamCm: base.diam });
        placements.push(_placement(base, puntos, { zona: zi + 1 }));
      }
      xcur += Number(z.long) || 0;
    }
    return placements;
  }

  // LAYERED — n_capas × barras_capa, apiladas hacia el núcleo con gap. Usado por
  // cabezales (cara sup/inf). Reparte barras_capa a lo ancho (Z); cada capa se
  // retranquea hacia el núcleo por su índice (offset = capa_idx*gap, EJE A EJE).
  // cfg: { n_capas, barras_capa, gap, sentido:'nucleo' }
  // ---------------------------------------------------------------------------
  // PILAS DE OCUPACIÓN POR CARA (jerarquía VOLUMÉTRICA)
  // ---------------------------------------------------------------------------
  // Modelo mental del calculista: cada CARA del hormigón tiene una PILA de
  // ocupación —  recubrimiento → φmax del nivel 1 → φmax del nivel 2 → … — y una
  // barra se ancla contra la PROFUNDIDAD ACTUAL de las pilas de las caras QUE
  // TOCA. Es un problema 1D por cara: nada de colisiones 3D.
  //
  //   host.jer_caras = { sup:[…], inf:[…], lat:[…], ext:[…] }
  //     φmax POR NIVEL y POR CARA (cm), índice 1-BASED (jer_caras.sup[1] = φmax
  //     del nivel 1 que ocupa la cara superior). Lo construye generar.js con dos
  //     pasadas por nivel ascendente (expandir → derivar contactos → poblar).
  //
  //   profundidad(cara, nivel) = recub(cara) + Σ_{k<nivel} jer_caras[cara][k]
  //
  // CARAS: 'sup' (y+), 'inf' (y−), 'lat' (z±, pila SIMÉTRICA), 'ext' (x±, los
  // extremos, pila SIMÉTRICA). Antes había UN inset escalar igual para las cuatro
  // → un cabezal de nivel 2 se acortaba en los extremos por el φ de un estribo
  // que NO ocupa los extremos (ver R7 del reporte).
  //
  // El recub de 'ext' (los extremos x±): el usuario no lo declara, así que por
  // convención vale el recub VERTICAL (mismo criterio que anchorBase.recubExtremo
  // y que _marcoUtilMundo). PERO es un valor POR CARA como los otros tres, no una
  // constante: con la pieza VOLTEADA los extremos LOCALES son las caras laterales
  // REALES, cuyo recub es recub_lat. Por eso el host lleva `recub_ext` explícito
  // (lo permuta _hostPermutado) y sólo se cae a recub_sup cuando no viene.
  // Sin él, un corchete volteado se medía con recub_sup en unas caras que están a
  // recub_lat: su dim quedaba 2·(recub_sup − recub_lat) corta y la punta NO era
  // tangente al estribo lateral.
  function _recubDeCara(host, cara) {
    if (cara === 'inf') return (host && host.recub_inf != null) ? Number(host.recub_inf) : 4;
    if (cara === 'lat') return (host && host.recub_lat != null) ? Number(host.recub_lat) : 3;
    if (cara === 'ext' && host && host.recub_ext != null) return Number(host.recub_ext);
    return (host && host.recub_sup != null) ? Number(host.recub_sup) : 4;   // 'sup' y 'ext'
  }

  // Σ de los φmax que las capas ANTERIORES a `nivel` dejaron en la cara `cara`
  // (SIN el recubrimiento). Nivel 1 y 'no' → 0 (pegados al recubrimiento).
  //   · host.jer_caras → pilas por cara (el dato nuevo, lo pone generar.js).
  //   · COMPAT: sin jer_caras, host.jer_phi es la pila ÚNICA legacy (la misma
  //     para las 4 caras) y host.phi_est el φ del nivel 1. Lo usan las llamadas
  //     directas al motor (Template Editor / tests) que nunca tuvieron el dato
  //     por cara: para ellas el comportamiento no cambia.
  function _sumaPila(host, cara, nivel) {
    if (nivel === 'no' || nivel == null) return 0;
    var n = Number(nivel);
    if (!isFinite(n) || n <= 1) return 0;
    var s = 0, i;
    var jc = host && host.jer_caras;
    if (jc) {
      var arr = jc[cara] || [];
      for (i = 1; i < n && i < arr.length; i++) s += Number(arr[i]) || 0;
      return s;
    }
    var phis = host && host.jer_phi;
    if (phis && phis.length) {
      for (i = 1; i < n && i < phis.length; i++) s += Number(phis[i]) || 0;
      return s;
    }
    return (host && host.phi_est) ? Number(host.phi_est) : 0;
  }

  // Profundidad ocupada en `cara` justo ANTES de `nivel` (recub incluido).
  // `recubBase` permite forzar el recubrimiento de esa cara (recub_override del
  // componente); ausente → el del host.
  function profundidadCara(host, cara, nivel, recubBase) {
    var r = (recubBase != null) ? Number(recubBase) : _recubDeCara(host, cara);
    return r + _sumaPila(host, cara, nivel);
  }

  // MARCO ÚTIL DEL NIVEL — FUENTE ÚNICA para (a) las dims 'auto' y (b) los
  // anclajes. Una barra de nivel n no se mide contra el hormigón sino contra el
  // hueco que le dejan las PILAS de las caras que cruza:
  //     largoUtil = largo − 2·prof(ext)      (dim que cruza los extremos)
  //     altoUtil  = alto − prof(sup) − prof(inf)
  //     anchoUtil = ancho − 2·prof(lat)
  //
  // `nivelOverride` permite pedir el marco de otro nivel. Los dos consumidores:
  //   · _dimsEfectivas  → nivel DECLARADO por el componente (sin declaración la
  //     dim se sigue midiendo al recubrimiento: el default por rol gobierna el
  //     ANCLAJE, no el largo de corte de recetas que nunca declararon nivel);
  //   · _profNivel      → nivel EFECTIVO (declarado o default por rol).
  // `prof` es el shape nuevo; `insetJ` se conserva (= profundidad extra de la
  // cara superior) porque es el escalar que publicaba la API anterior.
  function marcoUtilNivel(base, host, nivelOverride) {
    var nivel = (nivelOverride !== undefined) ? nivelOverride
      : ((base && base.jerarquia !== undefined) ? base.jerarquia : null);
    var prof = {
      sup: profundidadCara(host, 'sup', nivel),
      inf: profundidadCara(host, 'inf', nivel),
      lat: profundidadCara(host, 'lat', nivel),
      ext: profundidadCara(host, 'ext', nivel)
    };
    var recub = _recubDeCara(host, 'sup');
    var recubLat = _recubDeCara(host, 'lat');
    return {
      nivel: nivel, prof: prof,
      insetJ: prof.sup - recub, recub: recub, recubLat: recubLat,
      largoUtil: Number(host.largo) - 2 * prof.ext,
      altoUtil: Number(host.alto) - prof.sup - prof.inf,
      anchoUtil: Number(host.ancho) - 2 * prof.lat
    };
  }

  // Nivel EFECTIVO de una base (declarado o default por rol).
  function _nivelDeBase(base) {
    return nivelJerarquiaEfectivo(
      (base && base.jerarquia !== undefined) ? base.jerarquia : null,
      (base && base.rol) || 'cabezal');
  }

  // Profundidades POR CARA del nivel EFECTIVO de la pieza (recub incluido).
  function _profNivel(base, host) {
    return marcoUtilNivel(base, host, _nivelDeBase(base)).prof;
  }

  // CARA DEL HORMIGÓN contra la que se apoya un longitudinal, según la `cara`
  // declarada por el componente. 'lateral' (o 'lat') = cara CORTINA (z±): es una
  // cara de primera clase, no un alias de 'sup'.
  // OJO: estribo/traba también declaran cara 'lateral' por convención de la
  // receta, pero derivan su pose del MARCO (no de esta función): sólo la usan los
  // cabezales (ver _marcoCara / _baseDeComponente).
  function _caraAncla(cara) {
    if (cara === 'inf') return 'inf';
    if (cara === 'lateral' || cara === 'lat') return 'lat';
    return 'sup';
  }

  // ---------------------------------------------------------------------------
  // MARCO DE CARA — FUENTE ÚNICA del anclaje de un longitudinal (§TANDA 1).
  // ---------------------------------------------------------------------------
  // Un cabezal se PEGA a una cara y REPARTE su capa a lo ancho de esa cara. Las
  // dos cosas salen del mismo marco, y son el ESPEJO exacto entre sí con los ejes
  // intercambiados:
  //
  //     cara sup/inf → se pega en Y (±alto/2 ∓ prof(sup|inf) ∓ φ/2)
  //                    reparte en Z (entre las pilas laterales)
  //     cara lateral → se pega en Z (±ancho/2 ∓ prof(lat)   ∓ φ/2)   ← CORTINA
  //                    reparte en Y (entre las pilas sup e inf)
  //
  // Antes esto era _yBordeCabezal, que sólo distinguía sup/inf: una barra
  // 'lateral' caía en la rama de abajo y ATERRIZABA EN LA CARA INFERIOR (bug
  // reportado 12-ago) — y el muro no tenía cómo anclar sus cortinas.
  //
  // Devuelve:
  //   eje        : eje de la NORMAL de la cara ('y' o 'z') — donde se pega y por
  //                donde entran las capas.
  //   ancla      : coordenada del EJE de la barra en ese eje (recub + pila + φ/2).
  //   sentido    : ±1 hacia el NÚCLEO (por donde se apilan las capas).
  //   ejeReparto : eje sobre el que se reparten las barras de la capa.
  //   lo / hi    : extremos ÚTILES del reparto (ejes de la 1ª y la última barra).
  //                Es un RANGO, no un semiancho: las pilas sup e inf son
  //                independientes, así que el reparto en Y no está centrado en 0.
  //
  // El LADO de la cara lateral (z+ o z−) lo decide `base.ladoCara`, que sale de
  // `comp.lado` (1 | −1, default 1) — NO del arrastre. El `sentido` devuelto es
  // −lado, o sea la normal hacia el núcleo: con eso figura_puntos espeja las patas
  // del gancho sin un solo `if` de lado.
  function _marcoCara(base, host) {
    var cara = _caraAncla(base.anchorBase && base.anchorBase.cara);
    // SÓLO UN LONGITUDINAL se apoya en una cara CORTINA. Estribo, traba y cadena de
    // sección declaran cara 'lateral' por convención de la receta pero encuadran el
    // marco de núcleo, así que para ellos la cara lateral se lee como la vertical de
    // siempre → su reparto sigue yendo a lo ancho (Z), como antes de que la cortina
    // existiera.
    if (base.rol !== 'cabezal' && cara === 'lat') cara = 'sup';
    var nivel = _nivelDeBase(base);
    var r = (Number(base.diam) || 0) / 2;
    var ab = base.anchorBase || {};
    // El recub del anchor (recub_override incluido) manda SOBRE SU PROPIA cara.
    var rAnc = (ab.recub != null) ? Number(ab.recub) : null;
    var rLat = (cara === 'lat') ? rAnc : ((ab.recubLat != null) ? Number(ab.recubLat) : null);
    var pSup = profundidadCara(host, 'sup', nivel, (cara === 'sup') ? rAnc : null);
    var pInf = profundidadCara(host, 'inf', nivel, (cara === 'inf') ? rAnc : null);
    var pLat = profundidadCara(host, 'lat', nivel, rLat);
    var yHi = Number(host.alto) / 2 - pSup - r;
    var yLo = -Number(host.alto) / 2 + pInf + r;
    var zHi = Number(host.ancho) / 2 - pLat - r;
    if (cara === 'lat') {
      var lado = (base.ladoCara === -1) ? -1 : 1;
      return { eje: 'z', ancla: lado * zHi, sentido: -lado, ejeReparto: 'y', lo: yLo, hi: yHi };
    }
    // ANCLA DE UNA PIEZA DE SECCIÓN = EL CENTRO DE SU MARCO, NO EL BORDE DE UNA CARA
    // (regresión N1). Un cabezal se PEGA a la cara y por eso su ancla es el borde;
    // un estribo/traba/cadena de sección ENCUADRA el marco de núcleo, así que su
    // pose natural en el eje vertical es el CENTRO de ese marco. Publicar el borde
    // era inocuo mientras los únicos lectores lo ignoraban (_estriboPerimetral y
    // _traba derivan todo del marco), pero es un dato FALSO: la cadena de sección lo
    // leyó —como debía, es la coordenada del anchor— y se dibujó pegada al borde
    // superior, medio metro de fierro fuera del hormigón en los casos volteados.
    // (yLo + yHi)/2 ES el centro del marco de núcleo por construcción: las dos
    // fronteras salen de profundidadCara = recub + Σpilas, exactamente lo que
    // figura_puntos._marcoNucleo suma como recub + inset. Una sola cuenta, dos
    // lecturas que no pueden divergir.
    var yC = (yLo + yHi) / 2;
    if (cara === 'inf') {
      return { eje: 'y', ancla: (base.rol === 'cabezal') ? yLo : yC, sentido: 1, ejeReparto: 'z', lo: -zHi, hi: zHi };
    }
    return { eje: 'y', ancla: (base.rol === 'cabezal') ? yHi : yC, sentido: -1, ejeReparto: 'z', lo: -zHi, hi: zHi };
  }

  // Coordenada de la barra i de una capa de n sobre el eje de reparto del marco.
  // n = 1 → CENTRO del rango útil (con pilas simétricas es exactamente 0, o sea
  // lo mismo que hacía el `z = 0` de antes).
  function _posReparto(mc, i, n) {
    return (n > 1) ? (mc.lo + (mc.hi - mc.lo) * (i / (n - 1))) : ((mc.lo + mc.hi) / 2);
  }

  // RANGO DE REPARTO DE UNA PIEZA QUE NO ES UN PUNTO EN ESE EJE.
  // ---------------------------------------------------------------------------
  // `_marcoCara` devuelve lo/hi para el EJE DE UNA BARRA: por eso ya viene con el
  // φ/2 descontado (una barra ocupa φ y su eje no puede pegarse al recub). Una
  // CADENA DE SECCIÓN ocupa un ANCHO entero en ese mismo eje, así que la regla es
  // la misma con su propia medida: el rango de su CENTRO es lo/hi descontado su
  // semiancho. Las dos rutas de referencia salen como casos límite, sin un solo if
  // de familia:
  //   · cadena que ocupa el marco entero (el 'auto' la estira hasta el útil) → el
  //     rango colapsa al centro y las N copias caen en el mismo sitio: es
  //     EXACTAMENTE lo que hace el estribo perimetral, que no lee el reparto;
  //   · cadena angosta (dims fijas chicas) → se reparte como las trabas.
  // SIN ESTO, con `barras_capa` ≥ 2 una cadena de sección de ancho completo se
  // colocaba centrada en lo/hi (los bordes del marco) y salía media pieza fuera del
  // hormigón: 8.4 cm en la viga 600×60×30 acostada y 291.4 cm volteada (donde el
  // "ancho" del marco local es el LARGO de la viga). Es la misma causa raíz que el
  // ancla de cara: coordenadas pensadas para un cabezal aplicadas a una pieza que
  // encuadra la sección.
  // El estribo (marco cerrado) y la traba NO pasan por acá: su ruta de dibujo no
  // lee este rango de la misma forma y su reparto queda igual que siempre.
  function _repartoDePieza(base, mc) {
    if (base.rol === 'cabezal') return mc;
    var fp = _fp();
    if (!fp || !fp.extensionCadenaSeccion || !fp.familiaDeDibujo) return mc;
    if (fp.familiaDeDibujo(base.figura, base.rol) !== 'cadena') return mc;
    var ext = fp.extensionCadenaSeccion(base.figura, base.dims, base.diam);
    if (!ext || !(ext.u > 0)) return mc;
    var h = ext.u / 2;      // el eje de reparto de una pieza de sección ES su eje u
    var lo = mc.lo + h, hi = mc.hi - h;
    // RANGO VACÍO = la pieza es MÁS ANCHA que el marco (dims fijas que no caben):
    // no hay dónde repartirla, así que las copias van todas al centro del marco.
    // No es un clamp que tape nada — la pieza sigue asomando lo suyo, que es su
    // propio exceso de ancho; lo que no se hace es INVENTAR un reparto que las
    // separaría aún más (con el rango dado vuelta las copias se alejaban una de
    // otra y salía MÁS fierro fuera que sin repartir).
    if (lo > hi) { lo = hi = (mc.lo + mc.hi) / 2; }
    return { eje: mc.eje, ancla: mc.ancla, sentido: mc.sentido, ejeReparto: mc.ejeReparto,
      lo: lo, hi: hi };
  }

  // ¿ESTA pieza se DIBUJA como marco cerrado? Es la pregunta que gobierna el
  // anidado (anillo concéntrico vs. ajuste de dims), y la responde el módulo que
  // dibuja — no el rol. Antes bastaba con `rol === 'estribo'` porque el rol forzaba
  // el marco SIEMPRE; con el fix 305A ya no (una cadena colocada como ES se traza
  // como cadena), así que preguntar por el rol daría un anidado que no corresponde
  // al dibujo. Sin figura_puntos cargado se cae al criterio histórico.
  function _dibujaMarcoCerrado(base) {
    var fp = _fp();
    if (!fp || !fp.familiaDeDibujo) return base.rol === 'estribo';
    return fp.familiaDeDibujo(base.figura, base.rol) === 'estribo';
  }

  // ¿Esta pieza ENCUADRA LA SECCIÓN? — la pregunta que gobierna el anidado de las
  // capas (defecto F1). NO es la misma que `_dibujaMarcoCerrado`: esa separa el
  // estribo de la cadena (y sirve para decidir CÓMO se traza), pero el estribo, la
  // traba y la cadena de sección son las TRES la misma clase de pieza —encuadran el
  // marco de núcleo— y las tres tienen que anidar sus capas hacia adentro en vez de
  // trasladarse por la normal. Fuente única en figura_puntos (esPiezaDeSeccion), que
  // es donde vive el despacho de los tres constructores.
  function _esPiezaDeSeccion(base) {
    var fp = _fp();
    if (!fp || !fp.esPiezaDeSeccion) return base.rol === 'estribo' || base.rol === 'traba';
    return fp.esPiezaDeSeccion(base.figura, base.rol);
  }

  function distribuidorLayered(base, cfg, host) {
    var placements = [];
    // TECHO DURO de capas (200) y, más abajo, de placements (2000): un
    // n_capas de 10000 × barras_capa congelaba el navegador antes de dibujar.
    var nCapas = _capasCapeadas(base, (cfg && cfg.n_capas) || 1);
    var nBarras = Math.max(1, (cfg && cfg.barras_capa) || 1);
    var gap = (cfg && cfg.gap != null) ? Number(cfg.gap) : 0;
    var cara = (base.anchorBase && base.anchorBase.cara) || 'sup';
    // MARCO DE CARA: dónde se pega (eje/ancla/sentido) y por dónde reparte la capa.
    // Vale igual para sup, inf y LATERAL (cortina): una sola función, sin ramas.
    // …y el rango del reparto descuenta lo que OCUPA la pieza en ese eje (ver
    // _repartoDePieza): para un cabezal es el φ/2 de siempre, para una cadena de
    // sección su ancho entero.
    var mc = _repartoDePieza(base, _marcoCara(base, host));
    // CAPAS ANIDADAS (cfg.anidar !== false, toggle de la UI). El anidado v3 SOLO
    // ajusta DIMS (y, en las cerradas, encoge el marco): la POSICIÓN es siempre
    // k·gap. Aquí sólo se decide CUÁNDO aplica:
    //   · estribo/figura cerrada → por DEFAULT (anidar !== false);
    //   · figura abierta con patas (103x) → OPT-IN (anidar === true), porque
    //     cambiaría dims/kg de recetas existentes si fuera default (la viga-semilla
    //     quedaría con 5 ítems en vez de 4).
    // QUIÉN ANIDA: la PIEZA DE SECCIÓN (defecto F1), no "el que se dibuja como marco
    // cerrado". Estribo, traba y cadena de sección encuadran el mismo marco de
    // núcleo y las tres anidan por DEFAULT; cómo encoge cada una es asunto de
    // anidarFigura (anillo −2δ / retiro resuelto de la cadena). Una figura ABIERTA
    // LONGITUDINAL (103x en un cabezal) sigue siendo OPT-IN, porque cambiaría
    // dims/kg de recetas existentes si fuera default (la viga-semilla quedaría con
    // 5 ítems en vez de 4).
    // ANTES la pregunta era `_dibujaMarcoCerrado` y la cadena de sección contestaba
    // "no": no anidaba, y el k·gap entero se iba a la POSICIÓN (más abajo), o sea la
    // pieza se TRASLADABA por la normal hasta salirse del hormigón.
    var seccion = _esPiezaDeSeccion(base);
    var anidaSeccion = (!cfg || cfg.anidar !== false) && seccion;
    var anidaFig = (cfg && cfg.anidar === true) && !seccion &&
      ((base.dims && Number(base.dims.A) > 0) || (base.dims && Number(base.dims.C) > 0));
    for (var c = 0; c < nCapas; c++) {
      // POSICIÓN DE LA CAPA = k·gap, EJE A EJE, SIEMPRE (con o sin anidar).
      // CORRECCIÓN DEL USUARIO (12-ago): «el espaciamiento se lo damos con este
      // campo y debe mandar; al ajustar capas anidadas no debe considerar esta
      // altura, debe ajustar SOLO la medida de B». Antes, con anidar activo, la
      // posición la imponía el anidado (k·φ) y el campo del usuario no movía nada
      // — ese era el bug «el espaciamiento para CBI está fijo».
      //   gap = 0 → ejes SUPERPUESTOS, sin clamp: dato honesto, el usuario lo ve
      //   en el 3D y decide. Un clamp escondería que la receta pide algo imposible.
      var offPos = c * gap;                         // separación EJE A EJE
      // δ de DIMS del anidado = k·φ_propio (holgura lateral contra el fierro de la
      // capa de afuera). En las CERRADAS manda el campo Sep (anillos concéntricos
      // separados k·gap), y por eso viaja aparte en opts.sep.
      var an = (c > 0 && (anidaSeccion || anidaFig))
        ? _fp().anidarFigura(base.figura, base.dims, c * base.diam, base.rol, { sep: offPos })
        : null;
      var usaAn = !!(an && an.criterio !== 'recta');
      var dimsCapa = usaAn ? an.dims : base.dims;
      // CAPA QUE NO CABE → NO SE GENERA (hallazgo A). El inset k·gap dejó alguna
      // dim ≤ 0: dibujarla (o mandarla con dim_a = 0, que el backend rechaza) sería
      // inventar una barra imposible. Se omite y queda el aviso a la vista.
      if (usaAn && an.cabe === false) {
        _avisar(base, _avisoCapa(c, offPos, an.motivo));
        continue;
      }
      // Una figura CERRADA anidada se encoge δ por los cuatro lados: el δ entra en
      // las tres pilas del marco (sup, inf y lat). Es POR CAPA (no por barra).
      var ins = (usaAn && an.inset) ? _insetsAnidados(base.anchorBase, an.inset) : null;
      if (ins) {
        // …y con insets suficientemente grandes el marco se cruza consigo mismo
        // (ySup ≤ yInf o w2 ≤ 0): tampoco existe esa capa.
        var mrc = _fp().marcoNucleoCabe(host, _mezclarAnchor(base.anchorBase,
          { inset: ins.inset, insetInf: ins.insetInf, insetLat: ins.insetLat }), base.diam);
        if (!mrc.cabe) {
          _avisar(base, _avisoCapa(c, offPos, 'marco ' +
            (Math.round(mrc.alto * 100) / 100) + '×' + (Math.round(mrc.ancho * 100) / 100)));
          continue;
        }
      }
      // La capa de un LONGITUDINAL entra hacia el núcleo por la NORMAL de su cara
      // (Y en sup/inf, Z en lateral): ahí el k·gap ES la posición.
      //
      // UNA PIEZA DE SECCIÓN NO SE MUEVE POR LA NORMAL (defecto F1): su capa k es un
      // anillo concéntrico y su k·gap ya viajó al INSET del marco (arriba). Sumarlo
      // TAMBIÉN acá es doble conteo — y era doble conteo silencioso mientras los
      // únicos lectores lo ignoraban (_estriboPerimetral y _traba derivan su pose
      // del marco): la cadena de sección lo leyó —como debía, es la coordenada de su
      // centro— y se fue trasladando gap a gap fuera del hormigón. Misma lección que
      // N1: una coordenada FALSA no es inocua porque hoy nadie la mire.
      // Con `anidar:false` la pieza de sección tampoco se mueve — sus capas quedan
      // superpuestas, exactamente lo que ya hacía el estribo en ese caso.
      var coordCara = mc.ancla + mc.sentido * (seccion ? 0 : offPos);
      for (var i = 0; i < nBarras; i++) {
        // TECHO de barras del componente (capas × barras_capa). Acá no hay @:
        // el aviso sale sin cifra (el mismo texto, sin el "(x cm)").
        if (placements.length >= TOPE_PLACEMENTS_COMP) {
          _avisar(base, _avisoTope(null));
          return placements;
        }
        var extra = { cara: cara };
        extra[mc.eje] = coordCara;
        extra[mc.ejeReparto] = _posReparto(mc, i, nBarras);
        if (ins) {
          extra.inset = ins.inset; extra.insetInf = ins.insetInf; extra.insetLat = ins.insetLat;
        }
        var anchor = _mezclarAnchor(base.anchorBase, extra);
        var puntos = _fp().figuraAPuntos(base.figura, dimsCapa, host, anchor,
          { rol: base.rol || 'cabezal', diamCm: base.diam });
        var pl = _placement(base, puntos, { capa: c + 1, cara: cara });
        if (usaAn) pl.dims = _clonDims(dimsCapa);   // ítem propio en el listado
        placements.push(pl);
      }
    }
    return placements;
  }

  // ARREGLO — el distribuidor LINEAL de un rango, REPLICADO en N_capas separadas
  // por `sep_capas` a lo largo de un eje de PROFUNDIDAD. Es un arreglo 2D:
  //   (rango a lo largo del eje longitudinal)  ×  (capas en profundidad).
  // Cubre malla/trabas sin necesitar el distribuidorGrid stub (§0-11ter: "Grid").
  //
  // cfg: {
  //   rango: {from, to, sep, tramos?},  // igual que distribuidorLinear (X absolutas,
  //                             //   cm host); `tramos` = [{long,sep}] opcional
  //   sep,                      // @ del rango (alias de rango.sep)
  //   n_capas,                  // nº de filas paralelas (default 1)
  //   sep_capas,                // separación EJE A EJE entre capas, cm (default 0;
  //                             //   0 = ejes superpuestos, sin clamp — igual que el
  //                             //   `gap` de layered, ver ahí el porqué)
  //   eje_capas                 // 'x'|'y'|'z' — profundidad de las capas. Lo fija el
  //                             //   PLANO DE TRABAJO (si trabajas en XY → 'z'). Default
  //                             //   'z' (ancho de la viga: la 2ª cortina "hacia dentro").
  // }
  //
  // CLAVE (no regresión): con n_capas=1 (y sep_capas ignorada) genera EXACTAMENTE
  // lo mismo que distribuidorLinear(rango) — misma X, mismo anchor (offset 0 → no
  // se toca el eje de profundidad), mismos puntos. Solo cambia la meta (capa).
  // Las capas se apilan en el sentido POSITIVO del eje (0, +sep, +2·sep, …) para
  // que la 1ª capa coincida con la que daría el lineal puro.
  function distribuidorArreglo(base, cfg, host) {
    var placements = [];
    var rango = cfg && cfg.rango;
    // Sin rango válido no hay a lo largo qué distribuir → [] (coherente con el
    // resto de distribuidores cuando su cfg no aplica; el llamador ya validó modo).
    if (!rango || rango.from == null || rango.to == null) return placements;
    // TECHO DURO de capas (200) — mismo criterio que layered.
    var nCapas = _capasCapeadas(base, (cfg && Number(cfg.n_capas)) || 1);
    var sepCapas = (cfg && cfg.sep_capas != null) ? Number(cfg.sep_capas) : 0;
    var eje = (cfg && cfg.eje_capas) || 'z';
    if (eje !== 'x' && eje !== 'y' && eje !== 'z') eje = 'z';
    // Coordenada base del eje de profundidad en el anchor (para offsetear las capas
    // RESPECTO de donde ya está anclada la barra; ausente = 0, como el lineal).
    var baseEje = (base.anchorBase && base.anchorBase[eje] != null) ? Number(base.anchorBase[eje]) : 0;
    // MISMA fuente que distribuidorLinear (paso real + tramos): si el arreglo
    // calculara sus X por su cuenta, la garantía "n_capas=1 == lineal puro" se
    // rompería en cuanto una de las dos ramas cambiara (p.ej. al aceptar tramos).
    var posA = posicionesRango(rango, cfg && cfg.sep);
    // El reparto a lo largo ya viene capado por posicionesRango (misma fuente que
    // el lineal): sólo hay que decirlo. Las capas suman encima → el techo de
    // placements de más abajo corta el producto rango × capas.
    if (posA._tope) _avisar(base, _avisoTope(posA._tope.sep));
    // 1 capa = distribución lineal pura: NO se toca el eje de profundidad, así el
    // anchor queda BYTE-A-BYTE igual al de distribuidorLinear (garantía de cero
    // regresión). Con ≥2 capas SÍ se fija el plano de profundidad en TODAS las
    // capas (capa 1 en baseEje, no 'ausente') para que el arreglo sea consistente.
    var unaCapa = (nCapas === 1);
    // ANIDADO — MISMO criterio que en layered (una sola regla para los dos
    // distribuidores; antes el arreglo sólo anidaba figuras cerradas y una malla
    // de corchetes en 2 cortinas salía con las dos capas del mismo largo):
    //   · CERRADA (estribo) → por default: anillos concéntricos separados
    //     k·sep_capas (cfg.anidar === false lo desactiva);
    //   · ABIERTA con patas → OPT-IN (cfg.anidar === true): ajusta SOLO dims.
    var marcoA = _dibujaMarcoCerrado(base);          // (fix 305A: manda el DIBUJO)
    var anidaCerr = marcoA && (!cfg || cfg.anidar !== false);
    var anidaAb = (cfg && cfg.anidar === true) && !marcoA &&
      ((base.dims && Number(base.dims.A) > 0) || (base.dims && Number(base.dims.C) > 0));
    // SENTIDO del apilado: si las capas entran por la NORMAL de la cara del
    // longitudinal (p.ej. las 2 cortinas de un muro, eje_capas 'z' con la barra
    // pegada a la cara z+), van hacia el NÚCLEO; si no, en el sentido positivo del
    // eje, como siempre (una viga con capas en 'z' y la barra en cara sup).
    //
    // CAMBIO DE COMPORTAMIENTO DOCUMENTADO (verificador, Tanda 1) — INTENCIONAL:
    // un cabezal en cara SUP con eje_capas 'y' antes apilaba en +Y (sentido
    // positivo del eje) y las capas 2, 3… salían HACIA ARRIBA, atravesando el
    // recubrimiento superior. Ahora, como 'y' ES el eje de su marco de cara,
    // toma mcA.sentido = −1 y las capas bajan HACIA EL NÚCLEO, que es lo que hace
    // un fierro real (la cara sup ya está ocupada por la capa 1). Lo mismo, en
    // espejo, en cara INF (+1) y en la cortina lateral (−lado).
    // Cuando eje_capas NO es el eje de la cara (p.ej. cara sup con capas en 'z'),
    // se conserva el sentido positivo de siempre → esos casos no cambian.
    var mcA = (base.rol === 'cabezal') ? _marcoCara(base, host) : null;
    var sentCapas = (mcA && eje === mcA.eje) ? mcA.sentido : 1;
    for (var c = 0; c < nCapas; c++) {
      // δ del APILADO = k·sep_capas, EJE A EJE (misma semántica que el `gap` de
      // layered: el número configurado ES la distancia entre ejes, sin sumarle φ).
      var off = c * sepCapas;
      // δ de DIMS del anidado = k·φ_propio; la separación entre MARCOS (anillos
      // concéntricos) la manda sep_capas → viaja en opts.sep (v3: el campo del
      // usuario manda la posición también con anidar activo).
      var an = ((anidaCerr || anidaAb) && !unaCapa && c > 0)
        ? _fp().anidarFigura(base.figura, base.dims, c * base.diam, base.rol, { sep: off })
        : null;
      var usaAn = !!(an && an.criterio !== 'recta');
      var dimsCapaA = usaAn ? an.dims : base.dims;
      // MISMO criterio que layered (hallazgo A): la capa cuyo inset deja dims ≤ 0
      // — o cruza el marco del anillo — NO se genera; se omite con aviso.
      if (usaAn && an.cabe === false) {
        _avisar(base, _avisoCapa(c, off, an.motivo));
        continue;
      }
      var insA = (usaAn && an.inset) ? _insetsAnidados(base.anchorBase, an.inset) : null;
      if (insA) {
        var mrcA = _fp().marcoNucleoCabe(host, _mezclarAnchor(base.anchorBase,
          { inset: insA.inset, insetInf: insA.insetInf, insetLat: insA.insetLat }), base.diam);
        if (!mrcA.cabe) {
          _avisar(base, _avisoCapa(c, off, 'marco ' +
            (Math.round(mrcA.alto * 100) / 100) + '×' + (Math.round(mrcA.ancho * 100) / 100)));
          continue;
        }
      }
      for (var ri = 0; ri < posA.length; ri++) {
        // TECHO del producto rango × capas (un rango de 200 con 50 capas son
        // 10 000 barras). Corta los DOS bucles: nada más se emite.
        if (placements.length >= TOPE_PLACEMENTS_COMP) {
          _avisar(base, _avisoTope((cfg && cfg.sep) || (rango && rango.sep)));
          return placements;
        }
        var xr = posA[ri];
        // EJE DEL RANGO respetado (hallazgo del verificador: aquí se hardcodeaba
        // {x: xr} — un cabezal en modo Arreglo con rango.eje 'z', que es lo que
        // escribe la UI, superponía TODAS las barras en un punto). Mismo criterio
        // que distribuidorLinear; el resto de la pose (cara/reparto) ya viene en
        // anchorBase (la POSE NATURAL que publica _baseDeComponente).
        var ejeRA = (cfg && cfg.rango && (cfg.rango.eje === 'y' || cfg.rango.eje === 'z')) ? cfg.rango.eje : 'x';
        var extra = {}; extra[ejeRA] = xr;
        if (!unaCapa) {
          if (insA) {
            // CERRADA: el inset (= k·sep_capas) ES la posición del anillo (ya
            // calculado y VERIFICADO arriba, una vez por capa).
            extra.inset = insA.inset; extra.insetInf = insA.insetInf; extra.insetLat = insA.insetLat;
          } else if (!anidaCerr) {
            // TODO LO DEMÁS (incluida la figura ABIERTA anidada, que sólo ajusta
            // dims): la posición la manda sep_capas, eje a eje.
            extra[eje] = baseEje + sentCapas * off;
          }
        }
        var anchorA = _mezclarAnchor(base.anchorBase, extra);
        var puntosA = _fp().figuraAPuntos(base.figura, dimsCapaA, host, anchorA,
          { rol: base.rol || 'estribo', diamCm: base.diam });
        var plA = _placement(base, puntosA, unaCapa ? { rango: 1 } : { rango: 1, capa: c + 1 });
        if (usaAn) plA.dims = _clonDims(dimsCapaA);   // ítem propio (dims reales de corte)
        placements.push(plA);
      }
    }
    return placements;
  }

  // GRID / PERIMETER — STUBS (2ª entrega: muro/columna).
  // TODO(2ª entrega): implementar malla 2D (muro), perímetro (columna).
  function distribuidorGrid(base, cfg, host) { return []; /* TODO malla 2D muro */ }
  function distribuidorPerimeter(base, cfg, host) { return []; /* TODO longitudinales columna */ }

  // POINTS — barras individuales en posiciones explícitas (bastones / colocación
  // puntual del Template Editor). cfg.positions = [{x?,y?,z?}] (host cm; los ejes
  // ausentes usan el anchor base). Sin positions → [] (compatibilidad: el stub
  // original devolvía [] y así lo esperan los tests con cfg vacío).
  function distribuidorPoints(base, cfg, host) {
    var pos = (cfg && cfg.positions) || [];
    if (!pos.length) return [];
    var placements = [];
    for (var i = 0; i < pos.length; i++) {
      var anchor = _mezclarAnchor(base.anchorBase, pos[i]);
      var puntos = _fp().figuraAPuntos(base.figura, base.dims, host, anchor,
        { rol: base.rol || 'cabezal', diamCm: base.diam });
      placements.push(_placement(base, puntos, { punto: i + 1 }));
    }
    return placements;
  }

  // ---------------------------------------------------------------------------
  // POST-TRANSFORM (interacción del Template Editor) — OPCIONAL y ADITIVO.
  // Aplica a CADA placement, tras expandir, en este orden:
  //   1) rotación comp.orient = {eje:'x'|'y'|'z', deg} SOBRE EL PROPIO CENTRO de
  //      la pieza (§DISCOVERY-INTER 2: "se ve girar de frente ___| → |___").
  //   2) RE-ANCLAJE al recubrimiento: si al girar la pieza se salió del marco útil
  //      del hormigón, vuelve DENTRO (clamp por eje, RÍGIDO sobre el componente
  //      completo). Así la rotación "sigue reconociendo los boundaries" en vez de
  //      despegar la pieza del recub, y sin deformar el reparto de sus barras.
  //      SOLO con `orient.deg`: un `orient.spin` suelto (patas direccionales) NO
  //      re-ancla nada — la barra queda clavada (ver _aplicarPostTransform).
  //   3) traslación comp.pos_hint = {x?,y?,z?} (delta en cm; ejes ausentes = 0).
  //
  // PIVOTE (B3-raíz) — antes se rotaba EN TORNO AL ORIGEN DEL HOST, lo que
  // TRASLADABA la pieza a otro punto del volumen y le hacía perder el anclaje al
  // recubrimiento (bug reportado por el usuario). Ahora el pivote por defecto es
  // el CENTRO DEL PROPIO PLACEMENT. `orient.pivot` permite pedir otro:
  //   · 'propio' (o ausente) → centro del bounding box del placement (default);
  //   · 'host'               → origen del host (comportamiento histórico, explícito);
  //   · {x,y,z}              → punto fijo en coords del host.
  // Sin orient ni pos_hint los placements salen IDÉNTICOS → cero regresión.
  // ---------------------------------------------------------------------------
  function _rotarPunto(p, eje, rad) {
    var c = Math.cos(rad), s = Math.sin(rad);
    if (eje === 'x') return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
    if (eje === 'y') return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };   // 'z'
  }

  // Bounding box que ENVUELVE varias polilíneas (el componente entero).
  function _bboxLista(lista) {
    var mn = { x: Infinity, y: Infinity, z: Infinity };
    var mx = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (var i = 0; i < (lista || []).length; i++) {
      var pts = lista[i] || [];
      for (var k = 0; k < pts.length; k++) {
        var p = pts[k];
        if (p.x < mn.x) mn.x = p.x; if (p.x > mx.x) mx.x = p.x;
        if (p.y < mn.y) mn.y = p.y; if (p.y > mx.y) mx.y = p.y;
        if (p.z < mn.z) mn.z = p.z; if (p.z > mx.z) mx.z = p.z;
      }
    }
    if (!isFinite(mn.x) || !isFinite(mn.y) || !isFinite(mn.z)) return null;
    return { min: mn, max: mx, c: { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 } };
  }

  // Bounding box de una polilínea: {min,max,c} por eje (null si no hay puntos).
  function _bboxPuntos(pts) {
    if (!pts || !pts.length) return null;
    var mn = { x: Infinity, y: Infinity, z: Infinity };
    var mx = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.x < mn.x) mn.x = p.x; if (p.x > mx.x) mx.x = p.x;
      if (p.y < mn.y) mn.y = p.y; if (p.y > mx.y) mx.y = p.y;
      if (p.z < mn.z) mn.z = p.z; if (p.z > mx.z) mx.z = p.z;
    }
    if (!isFinite(mn.x) || !isFinite(mn.y) || !isFinite(mn.z)) return null;
    return { min: mn, max: mx, c: { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 } };
  }

  // MARCO ÚTIL DEL NIVEL, por eje del MUNDO — el hueco que le dejan a esta pieza
  // las pilas de cada cara. Es el marco al que vuelve una pieza que se salió al
  // ROTAR: una barra de nivel 2 vuelve a SU hueco, no al hormigón pelado (antes
  // el re-anclaje la devolvía siempre al recubrimiento y la sacaba de su capa).
  // Con nivel null/1 (o sin pilas) es EXACTAMENTE el marco de recubrimiento
  // anterior.
  function _marcoUtilMundo(host, nivel) {
    if (!host) return null;
    var L = Number(host.largo), A = Number(host.alto), W = Number(host.ancho);
    if (!isFinite(L) || !isFinite(A) || !isFinite(W)) return null;
    var pS = profundidadCara(host, 'sup', nivel);
    var pI = profundidadCara(host, 'inf', nivel);
    var pL = profundidadCara(host, 'lat', nivel);
    var pE = profundidadCara(host, 'ext', nivel);
    return {
      x: { lo: -L / 2 + pE, hi: L / 2 - pE },     // extremos: el motor usa el recub vertical
      y: { lo: -A / 2 + pI, hi: A / 2 - pS },
      z: { lo: -W / 2 + pL, hi: W / 2 - pL }
    };
  }

  // CAJA del hormigón pelado (sin recubrimiento) por eje del mundo. Es el último
  // límite físico: una barra puede quedar fuera de su capa, pero no del elemento.
  function _cajaHost(host) {
    if (!host) return null;
    var L = Number(host.largo), A = Number(host.alto), W = Number(host.ancho);
    if (!isFinite(L) || !isFinite(A) || !isFinite(W)) return null;
    return {
      x: { lo: -L / 2, hi: L / 2 },
      y: { lo: -A / 2, hi: A / 2 },
      z: { lo: -W / 2, hi: W / 2 }
    };
  }

  // CASCADA DE MARCOS del re-anclaje, del más fino al más grueso:
  //   1) el hueco de SU nivel (pilas incluidas) — donde debería estar;
  //   2) el marco de RECUBRIMIENTO (nivel 1: sin pilas) — si la pieza girada ya no
  //      cabe en su capa pero sí dentro del recubrimiento;
  //   3) el HORMIGÓN pelado — último recurso para no dejarla fuera del elemento.
  function _marcosReanclaje(host, nivel) {
    var out = [];
    var m = _marcoUtilMundo(host, nivel); if (m) out.push(m);
    var r = _marcoUtilMundo(host, 1);     if (r) out.push(r);
    var c = _cajaHost(host);              if (c) out.push(c);
    return out.length ? out : null;
  }

  // Delta que devuelve la pieza DENTRO del primer marco de la cascada donde QUEPA
  // (0 si ya cabe donde está). Si no cabe en NINGUNO — una pieza más grande que el
  // elemento — se CENTRA en el marco de su nivel: no hay traslación que la meta
  // entera, así que la que menos miente es la que reparte el excedente por igual
  // a los dos lados.
  //
  // `bb` es el bbox del COMPONENTE ENTERO y el delta se aplica a todas sus barras
  // (ver _aplicarPostTransform): el clamp barra-a-barra era la causa raíz del
  // colapso — dos barras distintas que se pasaban del mismo lado aterrizaban
  // PEGADAS a la misma pared, y centrarlas por separado las mandaba TODAS al
  // mismo punto (una capa de 3 barras girada 90° se volvía una sola, con el
  // resumen diciendo 3). Como traslación RÍGIDA, ninguna de las dos ramas puede
  // fusionar barras.
  function _deltaReanclaje(bb, marcos) {
    var d = { x: 0, y: 0, z: 0 };
    if (!bb || !marcos || !marcos.length) return d;
    ['x', 'y', 'z'].forEach(function (e) {
      var lo = bb.min[e], hi = bb.max[e], len = hi - lo;
      var f = null;
      for (var i = 0; i < marcos.length && !f; i++) {
        var g = marcos[i] && marcos[i][e];
        if (g && g.hi > g.lo && len <= (g.hi - g.lo)) f = g;
      }
      if (!f) return;                       // no cabe en ninguno → se DEJA
      if (lo < f.lo) d[e] = f.lo - lo;
      else if (hi > f.hi) d[e] = f.hi - hi;
    });
    return d;
  }

  function _pivoteDeRotacion(pl, orient) {
    var pv = orient && orient.pivot;
    if (pv === 'host') return { x: 0, y: 0, z: 0 };
    if (pv && typeof pv === 'object') {
      return { x: Number(pv.x) || 0, y: Number(pv.y) || 0, z: Number(pv.z) || 0 };
    }
    var bb = _bboxPuntos(pl.puntos);
    return bb ? bb.c : { x: 0, y: 0, z: 0 };
  }

  // GIRO AXIAL ("spin"): rota los puntos alrededor del EJE LONGITUDINAL de la
  // propia barra (la dirección de su segmento más largo, anclada en su punto
  // medio). El cuerpo de la barra queda donde estaba; las PATAS/ganchos giran a
  // su alrededor (pata hacia abajo → hacia adentro → hacia arriba…). Rodrigues.
  function _girarSobreEjeBarra(pts, rad) {
    var mejor = 0, ia = -1;
    for (var i = 1; i < pts.length; i++) {
      var sx = pts[i].x - pts[i - 1].x, sy = pts[i].y - pts[i - 1].y, sz = pts[i].z - pts[i - 1].z;
      var L2 = sx * sx + sy * sy + sz * sz;
      if (L2 > mejor) { mejor = L2; ia = i; }
    }
    if (ia < 0 || !mejor) return pts;
    var a = pts[ia - 1], b = pts[ia], m = Math.sqrt(mejor);
    var ux = (b.x - a.x) / m, uy = (b.y - a.y) / m, uz = (b.z - a.z) / m;
    var c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    var cos = Math.cos(rad), sen = Math.sin(rad);
    return pts.map(function (p) {
      var vx = p.x - c.x, vy = p.y - c.y, vz = p.z - c.z;
      var kd = ux * vx + uy * vy + uz * vz;
      var wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
      var o = {
        x: c.x + vx * cos + wx * sen + ux * kd * (1 - cos),
        y: c.y + vy * cos + wy * sen + uy * kd * (1 - cos),
        z: c.z + vz * cos + wz * sen + uz * kd * (1 - cos)
      };
      if (p.esArco) o.esArco = true;
      return o;
    });
  }

  function _aplicarPostTransform(placements, comp, host) {
    var orient = comp.orient;
    var ph = comp.pos_hint;
    var tieneRot = orient && orient.deg && isFinite(orient.deg);
    var tieneSpin = orient && orient.spin && isFinite(orient.spin);
    var tieneTras = ph && (ph.x != null || ph.y != null || ph.z != null);
    if (!tieneRot && !tieneSpin && !tieneTras) return placements;
    var rad = tieneRot ? (Number(orient.deg) * Math.PI / 180) : 0;
    var radSpin = tieneSpin ? (Number(orient.spin) * Math.PI / 180) : 0;
    var eje = (orient && orient.eje) || 'x';
    var dx = (ph && ph.x != null) ? Number(ph.x) : 0;
    var dy = (ph && ph.y != null) ? Number(ph.y) : 0;
    var dz = (ph && ph.z != null) ? Number(ph.z) : 0;
    // El re-anclaje sólo tiene sentido tras GIRAR y con un host conocido; el
    // arrastre (pos_hint) NO se clampea aquí (el clamp de la UI ya lo gobierna).
    // El marco es EL DE SU NIVEL (con las pilas del host REAL: los placements ya
    // volvieron al mundo, así que un componente volteado también se re-ancla
    // contra las caras reales).
    //
    // SPIN SOLO (sin `deg`) → CERO RE-ANCLAJE (decisión del usuario, 12-ago).
    // El spin es una herramienta de PATAS DIRECCIONALES: "quiero el gancho hacia
    // adentro / hacia arriba", con la barra QUIETA donde está. Girar las patas
    // agranda el bbox por el lado al que ahora apuntan, y el re-anclaje leía ese
    // bbox más ancho como "se salió" y TRASLADABA la barra entera → «igual mueve
    // de posición el segmento C». Mover la barra por cambiarle la dirección de una
    // pata es justo lo que el usuario NO pidió.
    //   · Sin `deg`: la barra queda CLAVADA. Si la pata asoma del recubrimiento,
    //     asoma: es un dato honesto, se ve en el 3D y el usuario decide (acortar
    //     la pata, mover la barra a mano o dejarla). Esconderlo con una traslación
    //     automática era mentirle sobre dónde está el fierro.
    //   · Con `deg` (rotación real de la pieza, con o sin spin): el flujo NO
    //     cambia — ahí sí el usuario reorientó la PIEZA y el marco manda.
    var nivelPT = nivelJerarquiaEfectivo(
      (comp && comp.jerarquia !== undefined) ? nivelJerarquia(comp.jerarquia) : null,
      (comp && comp._rol) || _rolDeTipologia(comp && comp.tipologia, comp && comp.cara));
    var marcos = (tieneRot && (!orient || orient.pivot !== 'host'))
      ? _marcosReanclaje(host, nivelPT) : null;
    // 1) GIRO de cada barra (rotación sobre su pivote + spin sobre su propio eje).
    var giradas = placements.map(function (pl) {
      var piv = tieneRot ? _pivoteDeRotacion(pl, orient) : null;
      var pts = (pl.puntos || []).map(function (p) {
        if (!tieneRot) return { x: p.x, y: p.y, z: p.z, esArco: p.esArco };
        var q = _rotarPunto({ x: p.x - piv.x, y: p.y - piv.y, z: p.z - piv.z }, eje, rad);
        return { x: q.x + piv.x, y: q.y + piv.y, z: q.z + piv.z, esArco: p.esArco };
      });
      return tieneSpin ? _girarSobreEjeBarra(pts, radSpin) : pts;
    });
    // 2) RE-ANCLAJE (boundaries): UN SOLO delta para TODO el componente, medido
    //    sobre el bbox que envuelve a TODAS sus barras. El componente es un
    //    CUERPO RÍGIDO: el usuario gira la pieza entera, así que volver adentro
    //    tiene que ser una traslación rígida que conserva el reparto interno.
    //    Clampeando barra por barra, dos barras distintas que se pasaban del
    //    mismo lado aterrizaban PEGADAS a la misma pared → se superponían (una
    //    capa de 3 barras con spin quedaba en 2). Una traslación rígida no puede
    //    fusionar barras distintas: el defecto desaparece por construcción, no
    //    por un caso especial. La cascada de marcos (nivel → recubrimiento →
    //    hormigón) vale igual para rotación y para spin.
    var r = marcos ? _deltaReanclaje(_bboxLista(giradas), marcos) : { x: 0, y: 0, z: 0 };
    // 3) traslación final (re-anclaje + pos_hint).
    placements.forEach(function (pl, i) {
      pl.puntos = giradas[i].map(function (q) {
        var o = { x: q.x + r.x + dx, y: q.y + r.y + dy, z: q.z + r.z + dz };
        if (q.esArco) o.esArco = true;
        return o;
      });
      if (tieneRot) pl.meta = _mezclarAnchor(pl.meta || {}, { orient_deg: Number(orient.deg), orient_eje: eje });
    });
    return placements;
  }

  // ---------------------------------------------------------------------------
  // DERIVACIÓN DE CONTACTO — qué CARAS ocupa una barra (geométrica y general)
  // ---------------------------------------------------------------------------
  // Se DERIVA, no se declara: una barra ocupa la cara F si su bbox llega a la
  // FRONTERA ACTUAL de la pila de F (la profundidad que hay ocupada en ese nivel)
  // dentro de una tolerancia ε = φ/2 + 0.75 cm — φ/2 porque los puntos son el EJE
  // de la barra y su superficie está φ/2 más afuera, + 0.75 cm de holgura de
  // colocación. Una barra al centro no toca ninguna cara → no empuja a nadie.
  //
  // CARAS PAREADAS ('lat' = z±, 'ext' = x±): su pila es SIMÉTRICA (anchoUtil =
  // ancho − 2·prof(lat)), así que sólo aporta la barra que bloquea LOS DOS lados.
  // De ahí sale, sin un solo `if (figura === …)`, el comportamiento que pedía el
  // calculista:
  //   · un ESTRIBO (plano YZ a una X) toca UN solo extremo → NO ocupa 'ext': los
  //     longitudinales pasan POR DENTRO del estribo, no se topan con él a lo
  //     largo. Sí ocupa sup/inf/lat (encuadra las cuatro caras de la sección).
  //   · un LONGITUDINAL que va de extremo a extremo SÍ ocupa 'ext' (los dos), y
  //     ocupa la cara contra la que se apoya (sup o inf).
  //   · un estribo VOLTEADO ocupa sup/inf/EXT y no 'lat' — sale solo, porque los
  //     contactos se derivan en coordenadas del MUNDO, con los puntos ya
  //     devueltos por la permutación.
  // `posHint` (opcional) = el arrastre MANUAL {x,y,z} del componente. Se DESCUENTA
  // antes de medir: una barra que el usuario arrastró conserva el aporte de su
  // cara NATURAL (la del anclaje sin pos_hint). Decisión de producto: mover una
  // barra a mano no la cambia de cara en la cadena. La ROTACIÓN sí cuenta (es una
  // reorientación real de la pieza, no un ajuste de posición).
  // Devuelve la lista de caras ocupadas ([] si no toca ninguna).
  function carasOcupadas(pl, host, nivel, posHint) {
    var bb = _bboxPuntos(pl && pl.puntos);
    if (!bb || !host) return [];
    if (posHint) {
      var dx = (posHint.x != null) ? Number(posHint.x) : 0;
      var dy = (posHint.y != null) ? Number(posHint.y) : 0;
      var dz = (posHint.z != null) ? Number(posHint.z) : 0;
      bb = {
        min: { x: bb.min.x - dx, y: bb.min.y - dy, z: bb.min.z - dz },
        max: { x: bb.max.x - dx, y: bb.max.y - dy, z: bb.max.z - dz }
      };
    }
    var eps = (Number(pl.diam) || 0) / 2 + 0.75;
    var fSup = Number(host.alto) / 2 - profundidadCara(host, 'sup', nivel);
    var fInf = -Number(host.alto) / 2 + profundidadCara(host, 'inf', nivel);
    var fLat = Number(host.ancho) / 2 - profundidadCara(host, 'lat', nivel);
    var fExt = Number(host.largo) / 2 - profundidadCara(host, 'ext', nivel);
    var out = [];
    if (Math.abs(bb.max.y - fSup) <= eps) out.push('sup');
    if (Math.abs(bb.min.y - fInf) <= eps) out.push('inf');
    if (Math.abs(bb.max.z - fLat) <= eps && Math.abs(bb.min.z + fLat) <= eps) out.push('lat');
    if (Math.abs(bb.max.x - fExt) <= eps && Math.abs(bb.min.x + fExt) <= eps) out.push('ext');
    return out;
  }

  // ---------------------------------------------------------------------------
  // EXPANSOR: despacha por comp.distribucion.modo
  // ---------------------------------------------------------------------------
  // Despacho puro (sin volteo ni post-transform): comp/base/cfg/host YA vienen en
  // el marco en el que hay que expandir. Único lugar donde se elige distribuidor.
  //
  // MODO DE USO del Template Editor (§0-11ter / §INTERACCIÓN-2.0): comp.modo =
  // 'puntual'|'lineal'|'arreglo' es el selector de ALTO NIVEL de los 3 botones
  // del panel. Solo 'arreglo' necesita despacho propio (rango × capas);
  // 'puntual'/'lineal' se materializan en dist.modo ('layered'/'linear') por el
  // panel y caen al switch de abajo. IMPRESCINDIBLE: solo se ramifica con el
  // valor EXPLÍCITO 'arreglo'. El preset por tipología de la viga-semilla es
  // 'puntual'/'lineal' (nunca 'arreglo'), así que el switch queda intacto para
  // ella (cero regresión: 72 placements / 140.3 kg / 4 items).
  function _despachar(comp, base, dist, host) {
    if (comp.modo === 'arreglo' || dist.modo === 'arreglo') return distribuidorArreglo(base, dist, host);
    switch (dist.modo) {
      case 'linear': return distribuidorLinear(base, dist, host);
      case 'layered': return distribuidorLayered(base, dist, host);
      case 'arreglo': return distribuidorArreglo(base, dist, host);
      case 'grid': return distribuidorGrid(base, dist, host);
      case 'perimeter': return distribuidorPerimeter(base, dist, host);
      case 'points': return distribuidorPoints(base, dist, host);
      default: return [];
    }
  }

  function expandirComponente(comp, host) {
    normalizarComponente(comp);   // rellena campos aditivos ausentes (defaults null)
    var dist = comp.distribucion || {};
    // ORIENTACIÓN = permutación de ejes REAL: se expande contra el host permutado
    // y se devuelven los puntos al mundo. 'acostada' → ruta idéntica a la anterior.
    var P = _permDe(comp);
    if (!P) {
      var baseAc = _baseDeComponente(comp, host);
      var plsAc = _despachar(comp, baseAc, dist, host);
      _cosecharAvisos(comp, baseAc);   // capas omitidas → visibles en la UI
      return _aplicarPostTransform(plsAc, comp, host);
    }
    var hostEf = _hostPermutado(host, P);
    // recubExtremo = el recub de las caras del MUNDO que ahora cierran el eje
    // longitudinal local (volteada → las laterales; de pie → las de borde).
    var base = _baseDeComponente(comp, hostEf, { recubExtremo: _recubDeEje(host, P.x) });
    var placements = _despachar(comp, base, _cfgLocal(dist, P), hostEf);
    // Los avisos SON los de la expansión REAL (la permutada), no los de `ref`:
    // la referencia acostada es un cálculo auxiliar que no se dibuja.
    _cosecharAvisos(comp, base);
    // REFERENCIA para restituir el centro: LA MISMA PIEZA ACOSTADA, o sea lo que
    // el usuario tenía en pantalla justo antes de apretar el botón. Se expande
    // en crudo (sin post-transform: orient/pos_hint se aplican después e igual a
    // las dos). Sólo se paga en componentes reorientados.
    var ref = _despachar(comp, _baseDeComponente(comp, host), dist, host);
    _permutarPlacements(placements, P, orientacionPieza(comp));
    // EJE DE ANCLAJE: el de la NORMAL de la cara, y SÓLO cuando la pieza se apoya
    // de verdad contra una cara (rol cabezal: su coordenada en ese eje la DERIVA
    // _marcoCara del recubrimiento + las pilas). Ahí la posición no es un dato
    // libre que haya que conservar al girar: es el anclaje, y restituirlo al centro
    // lo destruía — un cabezal de borde (cara 'extremo') salía pegado al testero y
    // la restitución lo devolvía al medio del elemento. Estribo/traba NO tienen eje
    // de anclaje (encuadran el marco de núcleo, no una cara), así que para ellos la
    // restitución sigue exactamente como estaba.
    var ejeAncla = (base.rol === 'cabezal') ? derivarPose(poseDe(comp)).N.eje : null;
    _restituirCentroVolteo(placements, ref, comp, host, ejeAncla);
    return _aplicarPostTransform(placements, comp, host);
  }

  // ---------------------------------------------------------------------------
  // VOLTEO — RESTITUCIÓN DEL CENTRO ("al rotar la pieza se va al centro")
  // ---------------------------------------------------------------------------
  // La permutación x↔z no sólo reorienta la pieza: también le cambia la POSICIÓN,
  // porque su coordenada a lo largo pasa a salir de su coordenada a lo ancho (y al
  // revés). Una traba/estribo que estaba en x = 150 aparecía en x ≈ 0, o sea en
  // MITAD del elemento, y una que estaba centrada se iba fuera del hormigón. El
  // usuario lo reportó como "al rotar la pieza se va al centro".
  //
  // Criterio (del usuario): la pieza volteada conserva su CENTRO en cada eje del
  // mundo DONDE AHORA ES PUNTUAL — donde no se extiende, o sea donde su posición
  // es un dato y no un recorrido. "Puntual" = span < 30% de la dimensión del host
  // en ese eje. Los ejes donde la pieza AHORA SE EXTIENDE no se restituyen: ahí la
  // pieza ya no "está en un punto", su lugar lo define su propia geometría (el
  // ejemplo del usuario: el x de un estribo volteado que ahora envuelve el largo).
  //
  // Va en el MOTOR y no en la UI a propósito: es geometría determinista, la ven
  // igual el 3D, el 2D, el listado y los tests. Y es una traslación RÍGIDA del
  // componente entero (mismo criterio que el re-anclaje tras rotar): no puede
  // deformar el reparto interno ni fusionar barras.
  //
  // Después de restituir se CLAMPEA al marco de su nivel (cascada nivel →
  // recubrimiento → hormigón, la misma de la rotación) y sólo en los ejes
  // restituidos: los otros quedan exactamente como los dejó la permutación.
  var UMBRAL_PUNTUAL = 0.30;

  function _restituirCentroVolteo(placements, ref, comp, host, ejeAncla) {
    if (!placements || !placements.length || !ref || !ref.length || !host) return placements;
    var bb = _bboxLista(placements.map(function (p) { return p.puntos; }));
    var bbRef = _bboxLista(ref.map(function (p) { return p.puntos; }));
    if (!bb || !bbRef) return placements;
    var dimHost = { x: Number(host.largo), y: Number(host.alto), z: Number(host.ancho) };
    var d = { x: 0, y: 0, z: 0 }, restituye = false;
    ['x', 'y', 'z'].forEach(function (e) {
      if (!isFinite(dimHost[e]) || dimHost[e] <= 0) return;
      if (e === ejeAncla) return;                                           // se ANCLA (ver expandirComponente)
      if ((bb.max[e] - bb.min[e]) >= UMBRAL_PUNTUAL * dimHost[e]) return;   // se EXTIENDE
      d[e] = bbRef.c[e] - bb.c[e];
      if (d[e]) restituye = true;
    });
    if (!restituye) return placements;
    // Clamp al marco de SU nivel, sobre el bbox YA restituido y sólo en los ejes
    // que se movieron (los demás no se tocan: no es un re-anclaje general).
    var nivel = nivelJerarquiaEfectivo(
      (comp && comp.jerarquia !== undefined) ? nivelJerarquia(comp.jerarquia) : null,
      (comp && comp._rol) || _rolDeTipologia(comp && comp.tipologia, comp && comp.cara));
    var movido = {
      min: { x: bb.min.x + d.x, y: bb.min.y + d.y, z: bb.min.z + d.z },
      max: { x: bb.max.x + d.x, y: bb.max.y + d.y, z: bb.max.z + d.z }
    };
    var cl = _deltaReanclaje(movido, _marcosReanclaje(host, nivel));
    ['x', 'y', 'z'].forEach(function (e) { if (d[e]) d[e] += cl[e]; });
    placements.forEach(function (pl) {
      pl.puntos = (pl.puntos || []).map(function (p) {
        var q = { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z };
        if (p.esArco) q.esArco = true;
        return q;
      });
      pl.meta = _mezclarAnchor(pl.meta || {}, { volteo_centro: true });
    });
    return placements;
  }

  // Devuelve al MUNDO los puntos de placements expandidos en el marco local
  // permutado. Marca meta.orientacion (y meta.volteado cuando es la x↔z, que es
  // lo que ya leían la UI y los tests) para trazabilidad.
  function _permutarPlacements(placements, P, nombre) {
    (placements || []).forEach(function (pl) {
      pl.puntos = (pl.puntos || []).map(function (p) { return _permPunto(p, P); });
      var m = { orientacion: nombre };
      if (nombre === 'volteada') m.volteado = true;
      pl.meta = _mezclarAnchor(pl.meta || {}, m);
    });
    return placements;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  // Resuelve las dims EFECTIVAS de un componente: cada dim 'auto' se deriva del
  // MARCO ÚTIL DE SU NIVEL (marcoUtilNivel: host − 2·(recub + Σφ de los niveles
  // anteriores)), no del hormigón pelado; 'fija' toma su valor.
  //   cabezal → largoUtil (corre a lo largo del eje longitudinal local)
  //   estribo → A/C = anchoUtil, B/D = altoUtil (el backend recalcula el largo)
  //   traba   → altoUtil
  // `nivel` (3er arg) = nivel DECLARADO; sin declarar, insetJ = 0 → idéntico a
  // medir contra el recubrimiento (comportamiento histórico de las recetas).
  function _dimsEfectivas(comp, host, nivel) {
    var dims = {};
    var g = comp.dims || {};
    var mk = marcoUtilNivel(null, host, (nivel !== undefined) ? nivel : null);
    // Lado LONGITUDINAL del cabezal (B en 10x con patas, A en 101/102): es el
    // ÚNICO que se estira al largo útil. Las PATAS en 'auto' toman la extensión
    // de gancho NORMATIVA (6φ, mín 7.5 — la misma regla del motor), NO el largo
    // útil: antes una 105A/106A con todo en auto salía 592+592+… = 29.6 m y
    // 46.7 kg FANTASMA que validar_geometria aceptaba (hallazgo D2 del
    // verificador de la Tanda 2).
    var ladoLong = _ladoLongitudinal(comp.figura, g);
    var fpD = _fp();
    var ganchoAuto = (fpD && fpD.extGancho) ? fpD.extGancho(Number(comp.diam) / 10)
      : Math.max(6 * Number(comp.diam) / 10, 7.5);
    // EL 'AUTO' DE UNA PIEZA DE SECCIÓN LO DECIDE EL TRAZO, NO LA LETRA.
    // A/C = ancho, B/D = alto es la lectura del RECTÁNGULO de 4 lados y vale para
    // las figuras que dibuja `_estriboPerimetral`. Para las que se trazan como
    // CADENA (305A de 5 tramos, 104B con quiebres de 45°) la letra no dice nada:
    // `ejesCadenaSeccion` devuelve, tramo por tramo, si corre en el ANCHO ('u'),
    // en el ALTO ('v') o en diagonal ('d' → pata, extensión de gancho). Es el
    // MISMO trazo que dibuja figura_puntos._cadenaSeccion — medir y dibujar no
    // pueden leer dos cosas distintas (hallazgo D1 del verificador: la 305A se
    // medía contra el alto y se dibujaba contra el ancho, 11 cm fuera del
    // hormigón). null = no es cadena de sección → sigue la regla por letra.
    var ejesSec = (fpD && fpD.ejesCadenaSeccion &&
      (comp._rol === 'estribo' || comp._rol === 'traba'))
      ? fpD.ejesCadenaSeccion(comp.figura, comp._rol) : null;
    // Y el valor de ese 'auto' RESERVA los quiebres, igual que el auto-largo del
    // longitudinal reserva los sobres de las puntas (fpD.sobresCadena).
    var autoSec = null;
    if (ejesSec) {
      var baseSec = {};
      Object.keys(g).forEach(function (k) {
        var d = g[k];
        if (d && d.modo === 'fija') baseSec[k] = Number(d.valor);
        else if (ejesSec[k] === 'd') baseSec[k] = ganchoAuto;   // diagonal = pata
      });
      // …CONTRA EL MARCO DE NÚCLEO, NO CONTRA LA LUZ LIBRE (defecto F2).
      // El recubrimiento se mide a la CARA del fierro: por eso el eje de una pieza
      // de sección va a recub + φ/2, que es exactamente lo que hace el estribo
      // (figura_puntos._marcoNucleo descuenta φ/2 en las tres fronteras) y lo que el
      // usuario validó cuando se calibró el estribo. La cadena de sección resolvía
      // su 'auto' contra la medida LIBRE (anchoUtil × altoUtil) y después se DIBUJA
      // como EJE: su cara quedaba φ/2 metida en el recubrimiento y dos piezas de
      // sección vecinas daban recubrimientos distintos — medido en la viga
      // 600×60×30 (4/4/3): φ8 cadena 3.60/2.60 vs estribo 4.00/3.00; φ32 cadena
      // 2.40/1.40 vs estribo 4.00/3.00.
      // El marco de núcleo eje-a-eje es (anchoUtil − φ) × (altoUtil − φ): la MISMA
      // cuenta que _marcoNucleo (2·w2 y ySup−yInf), leída desde acá. Medir y dibujar
      // siguen siendo lo mismo — el 'auto' resuelve el EJE y el eje es lo que se
      // traza —, y ahora las dos piezas de sección tienen un solo recubrimiento.
      var phiSec = Number(comp.diam) / 10 || 0;
      autoSec = fpD.autosCadenaSeccion(comp.figura, baseSec, ejesSec,
        { u: mk.anchoUtil - phiSec, v: mk.altoUtil - phiSec });
    }
    function autoDeLado(k) {
      if (ejesSec) {
        var e = ejesSec[k];
        if (e === 'u') return autoSec.u;
        if (e === 'v') return autoSec.v;
        if (e === 'd') return ganchoAuto;
      }
      if (comp._rol === 'estribo') return (k === 'A' || k === 'C') ? mk.anchoUtil : mk.altoUtil;
      return mk.altoUtil;
    }
    // DOS PASADAS: el longitudinal se resuelve AL FINAL porque su reserva (los
    // SOBRES de las puntas inclinadas) depende de las dims de los DEMÁS lados
    // ya resueltos — en una sola pasada la B se calculaba antes que la C y la
    // reserva del extremo final salía con un largo placebo.
    Object.keys(g).forEach(function (k) {
      var d = g[k];
      if (d && d.modo === 'fija') { dims[k] = Number(d.valor); return; }
      if (k === ladoLong) return;   // 2ª pasada
      // AUTO: deriva según rol + letra, contra el marco útil del NIVEL.
      if (comp._rol === 'cabezal') {
        dims[k] = ganchoAuto;
      } else {
        dims[k] = autoDeLado(k);
      }
    });
    if (ladoLong != null && g[ladoLong] && g[ladoLong].modo !== 'fija' && dims[ladoLong] == null) {
      if (comp._rol === 'cabezal') {
        // El LONGITUDINAL de una CADENA reserva los SOBRES de sus extremos
        // (proyección horizontal de las puntas inclinadas — hallazgo del
        // verificador de la Tanda F: 19/36 cadenas con doblez de 45° salían del
        // hormigón pata·cos45 − recub por lado). Si la reserva deja el largo
        // ≤ 0, el valor va tal cual (dato honesto: la figura no cabe y se VE;
        // el backend además la rechaza) — nada de clamps.
        var fpS = _fp();
        var sob = (fpS && fpS.sobresCadena) ? fpS.sobresCadena(comp.figura, dims, ladoLong) : { ini: 0, fin: 0 };
        dims[ladoLong] = mk.largoUtil - (sob.ini || 0) - (sob.fin || 0);
      } else {
        dims[ladoLong] = autoDeLado(ladoLong);
      }
    }
    // -------------------------------------------------------------------------
    // MEDIO DIÁMETRO CONTRA FIERRO ("el corchete muerde el estribo")
    // -------------------------------------------------------------------------
    // Las dims de la familia CABEZAL son de EJE A EJE (la polilínea que dibuja
    // _cabezalLongitudinal es el EJE de la barra), pero el marco útil del nivel
    // devuelve la CARA de lo que hay al lado. Contra hormigón la cuenta cierra:
    // el recubrimiento se mide a la cara del fierro y el doblez de la pata cae
    // justo ahí. Contra FIERRO no: la pata de la capa de adentro terminaba
    // EXACTAMENTE en el eje del estribo, o sea METIDA φ_propio/2 dentro de él
    // ("el corchete muerde el estribo").
    //
    // Regla: si la dim 'auto' se resuelve contra una cara CUYA PILA TIENE BARRAS
    // (Σφ de los niveles anteriores > 0 → hay fierro, no hormigón pelado), se
    // resta ADEMÁS φ_propio/2 por cada EXTREMO DEL TRAMO QUE TERMINA EN PATA
    // (A > 0 / C > 0). Un extremo recto (101A, o un 102A sin su pata) no dobla
    // contra nada: no resta.
    //
    // Deja los ejes TANGENTES, que es la condición física: separación de ejes =
    // φ_vecino/2 + φ_propio/2. Caso del usuario (viga 600×60×30, recub 4/4/3,
    // estribo φ8 nivel 1 + corchete-U φ16 nivel 2 en sección):
    //     B = 30 − 2·(3 + 0.8) − 2·(1.6/2) = 22.4 − 1.6 = 20.8
    //     punta del corchete z = ±10.4 · eje de la pierna del estribo z = ±11.6
    //     separación = 1.2 = φest/2 + φ/2  → TANGENTE, ya no lo muerde.
    // CONTRA HORMIGÓN PELADO NO RESTA NADA: la pila de los extremos de una viga
    // está vacía (el estribo es un plano YZ, no ocupa 'ext'), así que la
    // viga-semilla no se mueve ni un decimal (140.3 kg / 72 barras / 4 ítems).
    var f = (comp.figura || '').toUpperCase();
    var lado = _ladoLongitudinal(f, dims);
    if (comp._rol === 'cabezal') {
      var decl = g[lado];
      var esAuto = !!(decl && decl.modo !== 'fija');
      // La dim longitudinal de un cabezal se mide entre los EXTREMOS (cara 'ext'):
      // esa es la pila que hay que mirar.
      var hayFierro = _sumaPila(host, 'ext', (nivel !== undefined) ? nivel : null) > 0;
      if (esAuto && hayFierro && dims[lado] != null) {
        var nPatas = ((lado !== 'A' && Number(dims.A) > 0) ? 1 : 0) +
          ((lado !== 'C' && Number(dims.C) > 0) ? 1 : 0);
        if (nPatas) {
          dims[lado] = Math.max(0, Number(dims[lado]) - nPatas * (Number(comp.diam) / 10) / 2);
        }
      }
    }
    // EMPALME: alarga la dim LONGITUDINAL. La longitudinal es la que corre a lo
    // largo del eje de colocación: en 101A es A (barra recta); en 10x con tramo
    // (102/103/104) es B (tramo largo). Se aplica DESPUÉS del auto/fija para que
    // el override numérico del usuario también reciba el empalme.
    //
    // SÓLO EN ROL CABEZAL (TANDA 2 · T7.4). Un estribo o una traba no se empalman:
    // son piezas cerradas/cosidas cuyo largo lo fija el marco del hormigón. Con el
    // campo activo igual sumaban centímetros a su dim longitudinal — kg FANTASMA:
    // el dibujo no se movía ni un milímetro (los constructores de estribo/traba no
    // leen anchor.empalme) pero el listado pesaba de más. Se IGNORA y se avisa
    // (_baseDeComponente), en vez de sumar en silencio.
    if (comp._rol === 'cabezal') {
      var empTot = _empalmeTotalCm(comp, Number(comp.diam) / 10);
      if (empTot > 0 && dims[lado] != null) dims[lado] = Number(dims[lado]) + empTot;
    }
    return dims;
  }

  // LADO DOMINANTE / LONGITUDINAL de una figura: el que corre a lo largo del eje de
  // colocación, o sea el que el 'auto' estira contra el hormigón y el que recibe el
  // EMPALME. Los demás son patas/retornos que cuelgan de él.
  //
  // CASCADA DETERMINISTA (TANDA P · decisión del usuario) — la resuelve
  // figura_puntos.ladoDominanteFigura, que es fuente ÚNICA para el motor, el
  // trazador de cadenas y la ficha del componente:
  //   1º spec.lado_dominante del catálogo (lo poblará el Diseñador de figuras)
  //   2º 'B' si la figura declara ese parcial
  //   3º el primer parcial
  // El "lado más largo MEDIDO" DESAPARECE como criterio (era lo que usaban las
  // cadenas): dependía de las dims del momento, así que editar una pata podía
  // mover en silencio la dim que se estira y la que se empalma.
  function _ladoLongitudinal(figura, dims) {
    // CADENAS (trazador genérico): contrato de 3 valores (ver figura_puntos):
    //   undefined = no es cadena → sigue la cascada de abajo;
    //   null      = cadena CERRADA → no hay lado que estirar (como el estribo):
    //               ni auto-largo ni empalme (dims[null] no existe y los dos
    //               bloques que la usan preguntan por != null).
    var fpL = _fp();
    if (fpL && fpL.ladoLongitudinalCadena) {
      var rL = fpL.ladoLongitudinalCadena(figura, dims);
      if (rL !== undefined) return rL;
    }
    if (fpL && fpL.ladoDominanteFigura) {
      var rD = fpL.ladoDominanteFigura(figura);
      if (rD) return rD;
    }
    var cat = _cat();
    var spec = cat ? cat.get(figura) : null;
    if (spec && spec.parciales.length) {
      return (spec.parciales.indexOf('B') >= 0) ? 'B' : spec.parciales[0];
    }
    var f = (figura || '').toUpperCase();   // sin catálogo: criterio histórico
    return (f.indexOf('101') === 0) ? 'A' : (dims && dims.B != null ? 'B' : 'A');
  }

  // LADO DOMINANTE de un componente (o de un código de figura suelto) — lo que la
  // ficha del Template Editor MARCA para que se vea cuál dim se estira al girar la
  // pieza. Devuelve la letra, o null si la figura no tiene lado que estirar (cadena
  // CERRADA) o no está en el catálogo.
  function ladoDominante(comp) {
    if (!comp) return null;
    if (typeof comp === 'string') return _ladoLongitudinal(comp, null);
    return _ladoLongitudinal(comp.figura, comp.dims);
  }

  // opts.recubExtremo: recubrimiento de las caras que cierran el eje LONGITUDINAL
  // local. Sin opts vale el recub vertical (comportamiento histórico); con la pieza
  // VOLTEADA el eje longitudinal local es la Z real, así que su recub es el lateral.
  function _baseDeComponente(comp, host, opts) {
    comp._rol = comp._rol || _rolDeTipologia(comp.tipologia, comp.cara);
    // POSE → cara/lado EN EL MARCO LOCAL. Es el ÚNICO punto donde la pose entra al
    // resto del motor: de acá para abajo todo sigue siendo exactamente lo que era
    // (marco de cara, pilas, plano de trabajo), sólo que la cara local ya no se lee
    // cruda del componente sino que se DERIVA de la pose (que para una receta vieja
    // devuelve el mismo valor que tenía el campo).
    var pz = derivarPose(poseDe(comp));
    var rSup = _recubDeCara(host, 'sup');
    var rInf = _recubDeCara(host, 'inf');
    var rLat = _recubDeCara(host, 'lat');
    var ovr = (comp.recub_override != null) ? Number(comp.recub_override) : null;
    // RECUB DE LA CARA DEL ANCLAJE. Un longitudinal de cara LATERAL (cortina) se
    // mide contra recub_lat, no contra el vertical. Estribo/traba declaran cara
    // 'lateral' por convención de la receta pero encuadran el marco entero (y
    // reciben recubSup/recubInf/recubLat por separado): para ellos no cambia nada.
    var caraAnc = _caraAncla(pz.caraLocal);
    var recub = (ovr != null) ? ovr
      : ((comp._rol === 'cabezal' && caraAnc === 'lat') ? rLat
        : (caraAnc === 'inf' ? rInf : rSup));
    var diamCm = Number(comp.diam) / 10;   // mm → cm
    // Empalme resuelto (cm POR EXTREMO, independientes) para que figura_puntos
    // asome la barra fuera del hormigón lo suyo en cada punta (dato geométrico; el
    // largo/peso ya los cubre la dim alargada en _dimsEfectivas).
    var empEx = _empalmePorExtremo(comp, diamCm);
    // EMPALME SÓLO DONDE ES REAL (T7.4): el rol cabezal (longitudinal) es el
    // único que empalma. En estribo/traba el campo sumaba largo al listado sin
    // mover el dibujo — kg fantasma. Acá se anula el dato geométrico; la dim ya
    // no lo suma (_dimsEfectivas) y el aviso queda escrito abajo.
    var empIgnorado = (comp._rol !== 'cabezal') && (empEx.ini > 0 || empEx.fin > 0);
    if (empIgnorado) empEx = { ini: 0, fin: 0 };
    var empHay = (empEx.ini > 0 || empEx.fin > 0);
    // `extremo` se DERIVA de los dos Δ (trazabilidad y compat con lectores viejos
    // del anchor); los números que manda figura_puntos son ini/fin.
    var empExtremo = !empHay ? null
      : (empEx.ini > 0 ? (empEx.fin > 0 ? 'ambos' : 'inicio') : 'fin');
    var base = {
      figura: comp.figura, diam: diamCm,
      tipologia: comp.tipologia, suf: comp.suf_tipo || '',
      comp_id: (comp.comp_id != null ? comp.comp_id : null),
      prioridad: comp.prioridad != null ? comp.prioridad : null,
      // Nivel DECLARADO ('no' | 1,2,3… | null = auto → default por rol). Gobierna
      // el anclaje (vía _profNivel, que le aplica el default) y el marco útil
      // de las dims 'auto' (sólo si está declarado).
      jerarquia: nivelJerarquia(comp.jerarquia),
      dims: _dimsEfectivas(comp, host, nivelJerarquia(comp.jerarquia)),
      angulos: comp.angulos || null,
      rol: comp._rol,
      // Lo que el motor NO pudo generar (capas anidadas omitidas). Lo llena
      // _avisar desde los distribuidores; expandirComponente lo pasa al comp.
      avisos: [],
      anchorBase: {
        cara: pz.caraLocal, recub: recub,
        // ESPEJO de la pose: lo consume figura_puntos invirtiendo el eje U del
        // plano de trabajo de la figura (ver _planoTrabajo). Sólo viaja cuando es
        // true → el anchor de una receta sin espejo queda idéntico al de siempre.
        espejo: pz.pose.espejo || undefined,
        // El marco de estribo/traba abarca las DOS caras verticales, así que
        // necesita el recub de CADA una: usar el de la cara del anchor arriba Y
        // abajo dibujaba la pieza fuera del recub inferior cuando recub_sup ≠
        // recub_inf (y carasOcupadas dejaba de detectar 'inf').
        recubSup: (ovr != null) ? ovr : rSup,
        recubInf: (ovr != null) ? ovr : rInf,
        recubLat: _recubDeCara(host, 'lat'),
        recubExtremo: (opts && opts.recubExtremo != null) ? Number(opts.recubExtremo)
          : (ovr != null ? ovr : _recubDeCara(host, 'ext')),
        // POSE NATURAL del anclaje (el distribuidor sólo OVERRIDEA los ejes que
        // reparte). Sin ella, un distribuidor que no fija un eje dejaba el anchor
        // incompleto y la polilínea salía con coordenadas undefined → NaN al
        // sumarle el pos_hint (rompía 3D/2D/hit-testing).
        x: 0,
        empalme: empHay
          ? { extremo: empExtremo, valor: Math.max(empEx.ini, empEx.fin), ini: empEx.ini, fin: empEx.fin }
          : null
      }
    };
    if (empIgnorado) {
      _avisar(base, 'Empalme ignorado en ' + (comp.tipologia || base.rol) +
        ': un ' + base.rol + ' no se empalma (sumaba kg sin mover el dibujo).');
    }
    // Un longitudinal vive PEGADO A SU CARA y, por defecto, al centro del reparto
    // de esa cara. Las dos coordenadas salen del MARCO DE CARA (fuente única, vale
    // igual para sup/inf y para la cara CORTINA lateral).
    // Una pieza de SECCIÓN no se pega a ninguna cara: su pose natural es el CENTRO
    // de su marco de núcleo, y por eso el anchorBase no le escribe y/z — sin
    // coordenada, cada constructor de sección se centra en su marco
    // (figura_puntos._estriboPerimetral / _traba / _cadenaSeccion). Lo que sí le
    // escriben los distribuidores es la coordenada del REPARTO, y ésa la respetan
    // los tres tal cual: son coordenadas del host, nunca desplazamientos.
    if (base.rol === 'cabezal') {
      // LADO de la cara lateral (z+ / z−) = DATO PROPIO del componente (`comp.lado`,
      // 1 | −1, default 1). Sólo pinta en cara lateral; las patas se espejan solas
      // porque _marcoCara devuelve `sentido = −lado` (la normal hacia el núcleo).
      //
      // ANTES lo elegía el SIGNO de pos_hint.z, y eso era un doble movimiento: el
      // pos_hint decidía el lado Y ADEMÁS se sumaba entero en _aplicarPostTransform.
      // Como la UI escribe pos_hint como delta ACUMULADO del arrastre, al cruzar
      // z = 0 arrastrando la barra SALTABA 2·zHi (22.4 cm en una viga de 30 con
      // recub 3 y φ16) porque el ancla se iba al otro lado a mitad del gesto.
      // Ahora pos_hint es TRASLACIÓN PURA y continua: no participa en la elección.
      // TANDA P: el lado sale de la POSE (pose.lado → signo de la normal), que para
      // una receta vieja es exactamente `comp.lado`.
      base.ladoCara = pz.ladoLocal;
      var mc = _marcoCara(base, host);
      base.anchorBase[mc.eje] = mc.ancla;
      base.anchorBase[mc.ejeReparto] = _posReparto(mc, 0, 1);
      // NORMAL de la cara: por ahí salen las patas del gancho (figura_puntos).
      base.anchorBase.ejeCara = mc.eje;
      base.anchorBase.sentidoCara = mc.sentido;
    }
    // JERARQUÍA: los roles con marco (estribo/traba) reciben su profundidad de
    // nivel por el anchor (el marco la suma a recub + φ/2). Son TRES pilas, una
    // por frontera del marco — sup, inf y lat — porque las tres son
    // INDEPENDIENTES: un nivel 2 con φ16 arriba y φ18 abajo deja huecos distintos.
    // (Antes se mandaba una sola pila vertical, la de la cara del anchor, para
    // arriba Y abajo: la figura se dibujaba con un desfase de pilaSup − pilaInf
    // respecto de su propia dim declarada.) Los cabezales lo resuelven en
    // _marcoCara (no usan marco de núcleo).
    // Se escriben LAS TRES o NINGUNA: _marcoNucleo cae de insetInf/insetLat a
    // inset cuando faltan, así que dejar una sola daría un marco equivocado.
    if (base.rol === 'estribo' || base.rol === 'traba') {
      var nivelEf = _nivelDeBase(base);
      var insetS = _sumaPila(host, 'sup', nivelEf);
      var insetI = _sumaPila(host, 'inf', nivelEf);
      var insetL = _sumaPila(host, 'lat', nivelEf);
      if (insetS > 0 || insetI > 0 || insetL > 0) {
        base.anchorBase.inset = insetS;
        base.anchorBase.insetInf = insetI;
        base.anchorBase.insetLat = insetL;
      }
    }
    return base;
  }

  // Insets de una CAPA ANIDADA: la figura cerrada se encoge δ por los CUATRO
  // lados, así que δ entra en las tres pilas del marco (sup, inf, lat) partiendo
  // de las del anchor base. Fuente única para layered y arreglo.
  // ---------------------------------------------------------------------------
  // AVISOS DEL COMPONENTE — lo que el motor decidió NO generar, y por qué.
  // ---------------------------------------------------------------------------
  // Regla del proyecto: nada de defensas que enmascaren un dato imposible. Cuando
  // una capa anidada no cabe (dims ≤ 0 o marco cruzado) NO se dibuja ni se manda
  // con ceros: se OMITE y queda escrita aquí, y la UI la muestra en la barra de
  // estado. Se acumulan en `base.avisos` (el distribuidor no ve el comp) y
  // expandirComponente los cosecha en `comp._avisos`.
  //
  // NO ENUMERABLE a propósito: `comp` se serializa entero al guardar el template
  // (params) y se compara con JSON.stringify para el dirty-tracking del editor.
  // Un campo derivado y volátil no puede ensuciar la receta ni viajar al backend.
  function _avisar(base, msg) {
    if (!base || !msg) return;
    var a = base.avisos || (base.avisos = []);
    if (a.indexOf(msg) < 0) a.push(msg);
  }

  function _cosecharAvisos(comp, base) {
    if (!comp) return;
    var lista = (base && base.avisos) ? base.avisos.slice() : [];
    try {
      Object.defineProperty(comp, '_avisos',
        { value: lista, enumerable: false, writable: true, configurable: true });
    } catch (e) { comp._avisos = lista; }
  }

  // Texto del aviso de una capa omitida. Formato ÚNICO (layered y arreglo):
  //   "Capa 3 anidada no cabe (Sep 20): omitida — dim A = -6"
  function _avisoCapa(c, sep, motivo) {
    return 'Capa ' + (c + 1) + ' anidada no cabe (Sep ' + (Math.round(Number(sep) * 100) / 100) +
      '): omitida' + (motivo ? ' — ' + motivo : '');
  }

  function _insetsAnidados(anchorBase, d) {
    var i0 = Number(anchorBase.inset) || 0;
    var iI = (anchorBase.insetInf != null) ? Number(anchorBase.insetInf) : i0;
    var iL = (anchorBase.insetLat != null) ? Number(anchorBase.insetLat) : i0;
    return { inset: i0 + d, insetInf: iI + d, insetLat: iL + d };
  }

  function _rolDeTipologia(tip, cara) {
    var t = (tip || '').toUpperCase();
    if (t === 'ES' || t === 'ESC' || t === 'EC') return 'estribo';
    if (t === 'TRV' || t === 'TR' || t === 'TC' || t === 'TRC' || t === 'TRL' || t === 'TRF') return 'traba';
    return 'cabezal';   // CBS/CBI/CB/LT/… longitudinales
  }

  // Clon plano de un mapa de dims (cada placement lleva las SUYAS: resolverDependencias
  // acorta patas por barra y no puede contaminar a las hermanas de la misma capa).
  function _clonDims(dims) {
    var o = {};
    for (var k in dims) if (dims.hasOwnProperty(k)) o[k] = dims[k];
    return o;
  }

  function _mezclarAnchor(baseAnchor, extra) {
    var a = {};
    for (var k in baseAnchor) if (baseAnchor.hasOwnProperty(k)) a[k] = baseAnchor[k];
    for (var j in extra) if (extra.hasOwnProperty(j)) a[j] = extra[j];
    return a;
  }

  function _placement(base, puntos, meta) {
    var m = meta || {};
    if (base.comp_id != null && !('comp_id' in m)) m.comp_id = base.comp_id;
    // dims por-placement (clon) para que resolverDependencias pueda ACORTAR
    // patas de una barra sin afectar a las hermanas del mismo componente.
    var dimsClon = {};
    for (var k in base.dims) if (base.dims.hasOwnProperty(k)) dimsClon[k] = base.dims[k];
    return {
      puntos: puntos, diam: base.diam,
      tipologia: base.tipologia, figura: base.figura, suf_tipo: base.suf,
      comp_id: (base.comp_id != null ? base.comp_id : null),
      prioridad: (base.prioridad != null ? base.prioridad : null),
      dims: dimsClon, angulos: base.angulos,
      meta: m
    };
  }

  var API = {
    normalizarComponente: normalizarComponente,
    modoDefaultDeTipologia: modoDefaultDeTipologia,
    TIPOLOGIA_MODO_DEFAULT: TIPOLOGIA_MODO_DEFAULT,
    redondeoCantidadZona: redondeoCantidadZona,
    // Posiciones (cm) que un RANGO genera — con @ único o con tramos [{long,sep}].
    // Es la MISMA función que usan linear y arreglo: la UI puede previsualizar el
    // conteo sin re-implementar el redondeo (y sin poder desincronizarse de él).
    posicionesRango: posicionesRango,
    // TECHOS DE GENERACIÓN (por componente). Expuestos para que la UI pueda
    // advertir con el MISMO número que aplica el motor (nunca uno propio).
    TOPE_PLACEMENTS_COMP: TOPE_PLACEMENTS_COMP,
    TOPE_CAPAS_COMP: TOPE_CAPAS_COMP,
    evalEmpalme: evalEmpalme,
    expandirComponente: expandirComponente,
    // ORIENTACIÓN DE LA PIEZA (permutación de ejes real) — lo consulta la UI para
    // saber sobre qué eje del MUNDO opera el rango/las capas de un componente.
    // 'acostada' | 'volteada' (x↔z) | 'de_pie' (x↔y); `volteado:true` = 'volteada'.
    estaVolteado: estaVolteado,
    orientacionPieza: orientacionPieza,
    ORIENTACIONES: Object.keys(ORIENTACIONES),
    ejeDistribucion: ejeDistribucion,
    ejeCapas: ejeCapas,
    // -------------------------------------------------------------------------
    // POSE (TANDA P) — modelo ÚNICO de orientación. La UI (Template Editor) opera
    // SOBRE ESTO: lee la pose de un componente, la gira con rotarPose90 y la
    // escribe; caras/pilas/reparto/dims se re-derivan solos.
    // -------------------------------------------------------------------------
    CARAS_POSE: CARAS_POSE,
    EJES_MUNDO: EJES_MUNDO,
    EJE_DE_CARA: EJE_DE_CARA,
    rumbosDeCara: rumbosDeCara,        // los 2 rumbos posibles de una cara (⊥ N)
    normalizarPose: normalizarPose,    // pose canónica (cara/lado/rumbo/espejo)
    derivarPose: derivarPose,          // → { N, L, B, P, caraLocal, ladoLocal, orientacion }
    poseDe: poseDe,                    // pose EFECTIVA de un comp (pose > campos viejos)
    rotarPose90: rotarPose90,          // giro de 90° en un eje del MUNDO (cerrado en las 24)
    POSES_DEFAULT: POSES_DEFAULT,      // tabla de DATOS elemento × tipología
    poseDefault: poseDefault,
    // Lado que se ESTIRA/ancla (cascada catálogo → 'B' → 1er parcial).
    ladoDominante: ladoDominante,
    rolDeTipologia: _rolDeTipologia,   // jerarquía: generar calcula host.jer_phi
    // JERARQUÍA 1-BASED ('no' | 1..n) — generar.js arma host.jer_phi con esto.
    nivelJerarquia: nivelJerarquia,
    nivelJerarquiaEfectivo: nivelJerarquiaEfectivo,
    JER_DEFAULT_POR_ROL: JER_DEFAULT_POR_ROL,
    marcoUtilNivel: marcoUtilNivel,
    // PILAS DE OCUPACIÓN POR CARA — generar.js las construye con esto.
    CARAS: ['sup', 'inf', 'lat', 'ext'],
    profundidadCara: profundidadCara,
    carasOcupadas: carasOcupadas,

    distribuidorLinear: distribuidorLinear,
    distribuidorLayered: distribuidorLayered,
    distribuidorArreglo: distribuidorArreglo,
    distribuidorGrid: distribuidorGrid,
    distribuidorPerimeter: distribuidorPerimeter,
    distribuidorPoints: distribuidorPoints
  };

  global.ModeladorReglas = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
