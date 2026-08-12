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
  //   plano_pieza: { volteado:false } — plano de trabajo propio de la pieza (rotar
  //                90° después). Default volteado:false = comportamiento IDÉNTICO.
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
  // VOLTEO DEL PLANO DE LA PIEZA (§INTERACCIÓN-2.0 · G3/B3) — GEOMETRÍA REAL.
  // ---------------------------------------------------------------------------
  // `comp.plano_pieza.volteado` NO es un truco de proyección: es una PERMUTACIÓN
  // DE EJES del componente. Los distribuidores y figura_puntos trabajan siempre en
  // un marco LOCAL canónico (x = eje de distribución/longitudinal, y = alto,
  // z = profundidad de capas). Voltear = intercambiar ese eje longitudinal con el
  // de profundidad:
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
  // Con volteado=false la ruta es IDÉNTICA a la anterior (ni un objeto extra).
  // ---------------------------------------------------------------------------
  var _EJE_FLIP = { x: 'z', y: 'y', z: 'x' };

  function estaVolteado(comp) {
    return !!(comp && comp.plano_pieza && comp.plano_pieza.volteado);
  }

  // Eje del MUNDO a lo largo del cual REPARTE este componente (rango/zonas). Los
  // distribuidores reparten sobre su x local; volteado, esa x local es la Z del
  // mundo. Lo consume la UI (flecha de rango, arrastre del rango) para operar
  // sobre el eje real y no siempre sobre X.
  function ejeDistribucion(comp) {
    return estaVolteado(comp) ? 'z' : 'x';
  }

  // Eje del MUNDO en el que se apilan las capas (layered/arreglo), dado el eje
  // LOCAL declarado en la distribución (default 'z').
  function ejeCapas(comp, ejeLocal) {
    var e = (ejeLocal === 'x' || ejeLocal === 'y' || ejeLocal === 'z') ? ejeLocal : 'z';
    return estaVolteado(comp) ? _EJE_FLIP[e] : e;
  }

  // Host con dims y recubrimientos permutados (marco local de la pieza volteada).
  //   largo_local = ancho real   (la pieza corre a lo ancho)
  //   ancho_local = largo real   (las capas entran a lo largo)
  //   RECUBRIMIENTOS: se permutan igual que las dims, cara por cara.
  //     recub_lat_local = recub de las caras EXTREMAS reales (= host.recub_ext, y
  //       sin él la convención recub_sup);
  //     recub_ext_local = recub de las caras LATERALES reales (= host.recub_lat).
  //     Permutar sólo uno de los dos dejaba las dims del eje longitudinal local
  //     midiéndose contra el recubrimiento de otra cara.
  //   PILAS: se permutan CON los ejes. Lo que en el mundo real ocupa los
  //     EXTREMOS (x±) pasa a ser la cara lateral del marco local (que ahora corre
  //     en Z) y viceversa: jer_caras_ef = { sup, inf, lat: ext, ext: lat }. Sin
  //     esto, una pieza volteada se anclaba contra la pila equivocada (p.ej. un
  //     corchete volteado se acortaba por el φ del estribo en unos extremos donde
  //     el estribo no está).
  function _hostVolteado(host) {
    var rSup = (host.recub_sup != null) ? Number(host.recub_sup) : 4;
    var rExt = (host.recub_ext != null) ? Number(host.recub_ext) : rSup;
    var h = {
      largo: Number(host.ancho), alto: Number(host.alto), ancho: Number(host.largo),
      recub_sup: rSup,
      recub_inf: (host.recub_inf != null) ? Number(host.recub_inf) : 4,
      recub_lat: rExt,
      recub_ext: (host.recub_lat != null) ? Number(host.recub_lat) : 3
    };
    var jc = host.jer_caras;
    if (jc) h.jer_caras = { sup: jc.sup, inf: jc.inf, lat: jc.ext, ext: jc.lat };
    else if (host.jer_phi) h.jer_phi = host.jer_phi;   // compat: pila única legacy
    if (host.phi_est != null) h.phi_est = host.phi_est;
    return h;
  }

  // Punto del marco LOCAL → mundo (y viceversa: la permutación es involutiva).
  // Conserva el flag `esArco` (perf del motor geométrico: no re-filetear arcos).
  function _voltearPunto(p) {
    var q = { x: p.z, y: p.y, z: p.x };
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
  function _cfgLocal(dist) {
    if (!dist) return dist;
    var tieneCapas = (dist.eje_capas != null);
    var tieneRango = !!(dist.rango && dist.rango.eje != null);
    if (!tieneCapas && !tieneRango) return dist;
    var c = {};
    for (var k in dist) if (dist.hasOwnProperty(k)) c[k] = dist[k];
    if (tieneCapas) c.eje_capas = _EJE_FLIP[String(dist.eje_capas)] || dist.eje_capas;
    if (tieneRango) {
      var r = {};
      for (var j in dist.rango) if (dist.rango.hasOwnProperty(j)) r[j] = dist.rango[j];
      r.eje = _EJE_FLIP[String(dist.rango.eje)] || dist.rango.eje;
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

  function _pushPos(arr, x) {
    if (arr.length && Math.abs(arr[arr.length - 1] - x) <= _EPS_POS) return;  // unión: 1 sola barra
    arr.push(x);
  }

  // n barras equiespaciadas en [a, b] con paso real ≤ sep, clampeadas a `tope`.
  function _repartirTramo(arr, a, b, sep, tope) {
    var span = b - a;
    var n = redondeoCantidadZona(span, sep);
    var paso = (n > 1) ? span / (n - 1) : 0;
    for (var i = 0; i < n; i++) {
      var x = a + i * paso;
      if (x > tope + _EPS_POS) break;
      _pushPos(arr, x);
    }
  }

  function posicionesRango(rango, sepDefault) {
    var rf = Math.min(Number(rango.from), Number(rango.to));
    var rt = Math.max(Number(rango.from), Number(rango.to));
    var sep = Number(sepDefault || rango.sep || 20) || 20;
    var tramos = (rango.tramos && rango.tramos.length) ? rango.tramos : null;
    var pos = [];
    if (!tramos) {                       // A) @ único — comportamiento histórico
      _repartirTramo(pos, rf, rt, sep, rt);
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
    for (var t = 0; t < tramos.length && cur < rt - _EPS_POS; t++) {
      var tr = tramos[t] || {};
      var lt = Number(tr.long) || 0;
      var st = Number(tr.sep) || 0;
      if (st > 0) ultSep = st;
      if (lt <= 0) continue;             // tramo sin largo = no consume nada
      var fin = Math.min(cur + lt, rt);  // CLAMP al rango
      _repartirTramo(pos, cur, fin, ultSep, rt);
      cur = fin;
    }
    // COLA: los tramos no cubrieron el rango → el último @ sigue hasta `to`.
    if (cur < rt - _EPS_POS) _repartirTramo(pos, cur, rt, ultSep, rt);
    // Caso borde: tramos = [{long:0}] y nada colocado → al menos la barra de `from`.
    if (!pos.length) _pushPos(pos, rf);
    // Reflejo para el rango invertido: el 1er tramo queda pegado al `from` real.
    if (invertido) {
      var cen = (rf + rt) / 2;
      pos = pos.map(function (p) { return 2 * cen - p; }).reverse();
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
  // (lo permuta _hostVolteado) y sólo se cae a recub_sup cuando no viene.
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

  // Cara VERTICAL de referencia de un anclaje. Tiene que coincidir con el
  // recubrimiento que ya elige _baseDeComponente para anchorBase.recub
  // (recub_inf SÓLO para cara 'inf'; recub_sup para todo lo demás, incluida la
  // cara 'lateral' de estribos y trabas), para que el recub y la pila salgan
  // siempre de la MISMA cara.
  function _caraVertical(cara) { return (cara === 'inf') ? 'inf' : 'sup'; }

  // Borde del eje de un longitudinal en Y según su cara, contra la PILA de esa
  // cara (no contra un inset global): prof(cara, nivel) + φ/2.
  function _yBordeCabezal(base, host) {
    var cara = (base.anchorBase && base.anchorBase.cara) || 'sup';
    var recub = (base.anchorBase && base.anchorBase.recub != null) ? base.anchorBase.recub : 4;
    var prof = profundidadCara(host, _caraVertical(cara), _nivelDeBase(base), recub);
    return (cara === 'sup') ? (host.alto / 2 - prof - base.diam / 2)
                            : (-host.alto / 2 + prof + base.diam / 2);
  }

  function distribuidorLayered(base, cfg, host) {
    var placements = [];
    var nCapas = Math.max(1, (cfg && cfg.n_capas) || 1);
    var nBarras = Math.max(1, (cfg && cfg.barras_capa) || 1);
    var gap = (cfg && cfg.gap != null) ? cfg.gap : 0;
    var recubLat = (base.anchorBase && base.anchorBase.recubLat != null) ? base.anchorBase.recubLat : 3;
    // El reparto a lo ancho se mide contra la PILA de la cara LATERAL de su nivel.
    var zHalf = host.ancho / 2 - profundidadCara(host, 'lat', _nivelDeBase(base), recubLat) - base.diam / 2;
    var cara = (base.anchorBase && base.anchorBase.cara) || 'sup';
    var s = (cara === 'sup') ? -1 : 1;   // hacia el núcleo
    var yBorde = _yBordeCabezal(base, host);
    // EJE DE LA CARA contra la que se anida: sup/inf entran en Y; una cara
    // lateral entra en Z (antes el corrimiento del anidado iba SIEMPRE en Y).
    var ejeAnid = (cara === 'lateral' || cara === 'lat') ? 'z' : 'y';
    // CAPAS ANIDADAS/AJUSTADAS (cfg.anidar !== false, toggle de la UI):
    // el CRITERIO (qué lados se achican, y si la capa se posiciona por inset de
    // marco o corriendo la polilínea) lo decide UNA sola función, por FIGURA:
    // figura_puntos.anidarFigura — "la capa k es la MISMA figura corrida δ_k =
    // k·φ hacia el núcleo". Aquí sólo se decide CUÁNDO aplica:
    //   · estribo/figura cerrada → por DEFAULT (anidar !== false);
    //   · figura abierta con patas (103x) → OPT-IN (anidar === true), porque
    //     cambiaría dims/kg de recetas existentes si fuera default (la viga-semilla
    //     quedaría con 5 ítems en vez de 4).
    // Al anidar NO se aplica ADEMÁS el corrimiento de capa en Y (el inset / el
    // anchorDelta de anidarFigura ya posicionan: evitar el doble desplazamiento).
    var anidaMarco = (!cfg || cfg.anidar !== false) && (base.rol === 'estribo');
    var anidaFig = (cfg && cfg.anidar === true) && (base.rol !== 'estribo') &&
      ((base.dims && Number(base.dims.A) > 0) || (base.dims && Number(base.dims.C) > 0));
    for (var c = 0; c < nCapas; c++) {
      // DOS δ DISTINTOS, y no es lo mismo (corrección del usuario probando en
      // pantalla: con φ+gap «los ajustes fueron mucho más que la medida correcta»):
      //   · ANIDADO   → δ = k·φ_propio, SIN gap: la capa de adentro va FIERRO
      //     CONTRA FIERRO con la de afuera (tangente). El gap no pinta aquí.
      //   · APILADO sin anidar → δ = k·gap.
      //
      // SEPARACIÓN DE CAPAS = DISTANCIA EJE A EJE (decisión del usuario, 12-ago).
      // Antes el apilado usaba δ = k·(φ+gap), o sea el gap era la LUZ LIBRE entre
      // superficies y el motor le sumaba el diámetro por su cuenta: «al poner 1
      // está sumando esa magnitud adicional» — el usuario escribía 1 y las capas
      // se separaban 1+φ. Ahora el número que se configura ES la separación de
      // EJES, que es como se acota en el plano y como el usuario lo lee:
      //   gap = 0  → los dos ejes SUPERPUESTOS (las barras se pisan). NO se
      //   clampea a φ ni a nada: es un dato honesto y el usuario lo VE en el 3D y
      //   decide. Un clamp escondería que la receta pide algo imposible.
      // El ANIDADO no cambia (δ = k·φ ya era correcto: fierro contra fierro).
      var offApil = c * gap;                        // δ del APILADO (eje a eje)
      var offAnid = c * base.diam;                  // δ del ANIDADO (φ propio)
      var an = (c > 0 && (anidaMarco || anidaFig))
        ? _fp().anidarFigura(base.figura, base.dims, offAnid, base.rol, { sentido: s, eje: ejeAnid })
        : null;
      var usaAn = !!(an && an.criterio !== 'recta');
      var dimsCapa = usaAn ? an.dims : base.dims;
      // Sin anidado: retranqueo de capa clásico. Con anidado: lo posiciona anidarFigura.
      var y = usaAn ? (yBorde + an.anchorDelta.y) : (yBorde + s * offApil);
      for (var i = 0; i < nBarras; i++) {
        var z = (nBarras > 1) ? (-zHalf + (2 * zHalf) * (i / (nBarras - 1))) : 0;
        // Anidado contra una cara LATERAL: el núcleo está a un lado o al otro
        // según de qué lado esté ESTA barra, así que el signo es por barra.
        if (usaAn && ejeAnid === 'z') z += (z >= 0 ? -1 : 1) * (an.delta || 0);
        var extra = { y: y, z: z, cara: cara };
        if (usaAn && an.inset) {
          // Una figura CERRADA anidada se encoge δ por los cuatro lados: el δ
          // entra en las tres pilas del marco (sup, inf y lat).
          var ins = _insetsAnidados(base.anchorBase, an.inset);
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
    var nCapas = Math.max(1, (cfg && Number(cfg.n_capas)) || 1);
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
    // 1 capa = distribución lineal pura: NO se toca el eje de profundidad, así el
    // anchor queda BYTE-A-BYTE igual al de distribuidorLinear (garantía de cero
    // regresión). Con ≥2 capas SÍ se fija el plano de profundidad en TODAS las
    // capas (capa 1 en baseEje, no 'ausente') para que el arreglo sea consistente.
    var unaCapa = (nCapas === 1);
    // ANIDADO (estribos/corchetes): las capas se achican hacia adentro en vez de
    // desplazarse por eje_capas. cfg.anidar === false lo desactiva.
    var anidaA = (base.rol === 'estribo') && (!cfg || cfg.anidar !== false);
    for (var c = 0; c < nCapas; c++) {
      // δ del APILADO = k·sep_capas, EJE A EJE (misma semántica que el `gap` de
      // layered: el número configurado ES la distancia entre ejes, sin sumarle φ).
      var off = c * sepCapas;
      // δ de la capa ANIDADA = k·φ_propio, SIN sep_capas (misma corrección que en
      // layered: anidar = fierro contra fierro; sep_capas es la separación del
      // apilado que NO anida). El CRITERIO (qué lados se achican, si la posición
      // la da el inset o un corrimiento) lo decide anidarFigura.
      var caraA = (base.anchorBase && base.anchorBase.cara) || 'sup';
      var ejeAnidA = (caraA === 'lateral' || caraA === 'lat') ? 'z' : 'y';
      var an = (anidaA && !unaCapa && c > 0)
        ? _fp().anidarFigura(base.figura, base.dims, c * base.diam, base.rol,
          { sentido: (caraA === 'inf') ? 1 : -1, eje: ejeAnidA })
        : null;
      var usaAn = !!(an && an.criterio !== 'recta');
      var dimsCapaA = usaAn ? an.dims : base.dims;
      for (var ri = 0; ri < posA.length; ri++) {
        var xr = posA[ri];
        // EJE DEL RANGO respetado (hallazgo del verificador: aquí se hardcodeaba
        // {x: xr} — un cabezal en modo Arreglo con rango.eje 'z', que es lo que
        // escribe la UI, superponía TODAS las barras en un punto). Mismo criterio
        // que distribuidorLinear; el cabezal recibe además su Y de cara.
        var ejeRA = (cfg && cfg.rango && (cfg.rango.eje === 'y' || cfg.rango.eje === 'z')) ? cfg.rango.eje : 'x';
        var extra = {}; extra[ejeRA] = xr;
        if ((base.rol || '') === 'cabezal' && extra.y == null) extra.y = _yBordeCabezal(base, host);
        if (!unaCapa) {
          if (usaAn) {
            if (an.inset) {
              var insA = _insetsAnidados(base.anchorBase, an.inset);
              extra.inset = insA.inset; extra.insetInf = insA.insetInf; extra.insetLat = insA.insetLat;
            }
            // El corrimiento del anidado va por el EJE DE LA CARA (y para
            // sup/inf, z para lateral), no siempre en Y.
            if (an.anchorDelta[an.eje]) {
              extra[an.eje] = ((base.anchorBase && base.anchorBase[an.eje]) || 0) + an.anchorDelta[an.eje];
            }
          } else if (!anidaA) {
            extra[eje] = baseEje + off;
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
    // VOLTEO = permutación de ejes REAL: se expande contra el host permutado y se
    // devuelven los puntos al mundo. volteado=false → ruta idéntica a la anterior.
    var flip = estaVolteado(comp);
    if (!flip) return _aplicarPostTransform(_despachar(comp, _baseDeComponente(comp, host), dist, host), comp, host);
    var hostEf = _hostVolteado(host);
    var base = _baseDeComponente(comp, hostEf,
      { recubExtremo: (host.recub_lat != null ? Number(host.recub_lat) : 3) });
    var placements = _despachar(comp, base, _cfgLocal(dist), hostEf);
    // REFERENCIA para restituir el centro: LA MISMA PIEZA SIN VOLTEAR, o sea lo
    // que el usuario tenía en pantalla justo antes de apretar el botón. Se expande
    // en crudo (sin post-transform: orient/pos_hint se aplican después e igual a
    // las dos). Sólo se paga en componentes volteados.
    var ref = _despachar(comp, _baseDeComponente(comp, host), dist, host);
    _voltearPlacements(placements);
    _restituirCentroVolteo(placements, ref, comp, host);
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

  function _restituirCentroVolteo(placements, ref, comp, host) {
    if (!placements || !placements.length || !ref || !ref.length || !host) return placements;
    var bb = _bboxLista(placements.map(function (p) { return p.puntos; }));
    var bbRef = _bboxLista(ref.map(function (p) { return p.puntos; }));
    if (!bb || !bbRef) return placements;
    var dimHost = { x: Number(host.largo), y: Number(host.alto), z: Number(host.ancho) };
    var d = { x: 0, y: 0, z: 0 }, restituye = false;
    ['x', 'y', 'z'].forEach(function (e) {
      if (!isFinite(dimHost[e]) || dimHost[e] <= 0) return;
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
  // volteado (permutación x↔z). Marca meta.volteado para trazabilidad.
  function _voltearPlacements(placements) {
    (placements || []).forEach(function (pl) {
      pl.puntos = (pl.puntos || []).map(_voltearPunto);
      pl.meta = _mezclarAnchor(pl.meta || {}, { volteado: true });
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
    Object.keys(g).forEach(function (k) {
      var d = g[k];
      if (d && d.modo === 'fija') { dims[k] = Number(d.valor); return; }
      // AUTO: deriva según rol + letra, contra el marco útil del NIVEL.
      if (comp._rol === 'cabezal') {
        // B = largo útil − 2·recub extremo (patas van fuera del tramo B)
        dims[k] = mk.largoUtil;
      } else if (comp._rol === 'estribo') {
        dims[k] = (k === 'A' || k === 'C') ? mk.anchoUtil : mk.altoUtil;
      } else {
        dims[k] = mk.altoUtil;
      }
    });
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
    var empTot = _empalmeTotalCm(comp, Number(comp.diam) / 10);
    if (empTot > 0) {
      if (dims[lado] != null) dims[lado] = Number(dims[lado]) + empTot;
    }
    return dims;
  }

  // Lado LONGITUDINAL de una figura: el que corre a lo largo del eje de
  // colocación. En 101x es A (barra recta); en 10x con tramo (102/103/104) es B.
  // Fuente única del empalme y del medio-diámetro contra fierro.
  function _ladoLongitudinal(figura, dims) {
    var f = (figura || '').toUpperCase();
    return (f.indexOf('101') === 0) ? 'A' : (dims && dims.B != null ? 'B' : 'A');
  }

  // opts.recubExtremo: recubrimiento de las caras que cierran el eje LONGITUDINAL
  // local. Sin opts vale el recub vertical (comportamiento histórico); con la pieza
  // VOLTEADA el eje longitudinal local es la Z real, así que su recub es el lateral.
  function _baseDeComponente(comp, host, opts) {
    comp._rol = comp._rol || _rolDeTipologia(comp.tipologia, comp.cara);
    var rSup = _recubDeCara(host, 'sup');
    var rInf = _recubDeCara(host, 'inf');
    var ovr = (comp.recub_override != null) ? Number(comp.recub_override) : null;
    var recub = (ovr != null) ? ovr : (comp.cara === 'inf' ? rInf : rSup);
    var diamCm = Number(comp.diam) / 10;   // mm → cm
    // Empalme resuelto (cm POR EXTREMO, independientes) para que figura_puntos
    // asome la barra fuera del hormigón lo suyo en cada punta (dato geométrico; el
    // largo/peso ya los cubre la dim alargada en _dimsEfectivas).
    var empEx = _empalmePorExtremo(comp, diamCm);
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
      anchorBase: {
        cara: comp.cara, recub: recub,
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
    // Un longitudinal vive a la ALTURA de su cara y, por defecto, al centro del
    // ancho. Estribo/traba derivan su pose del marco (no leen anchor.y/z).
    if (base.rol === 'cabezal') {
      base.anchorBase.y = _yBordeCabezal(base, host);
      base.anchorBase.z = 0;
    }
    // JERARQUÍA: los roles con marco (estribo/traba) reciben su profundidad de
    // nivel por el anchor (el marco la suma a recub + φ/2). Son TRES pilas, una
    // por frontera del marco — sup, inf y lat — porque las tres son
    // INDEPENDIENTES: un nivel 2 con φ16 arriba y φ18 abajo deja huecos distintos.
    // (Antes se mandaba una sola pila vertical, la de la cara del anchor, para
    // arriba Y abajo: la figura se dibujaba con un desfase de pilaSup − pilaInf
    // respecto de su propia dim declarada.) Los cabezales lo resuelven en
    // _yBordeCabezal/zHalf (no usan marco).
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
    evalEmpalme: evalEmpalme,
    expandirComponente: expandirComponente,
    // VOLTEO (permutación de ejes real) — lo consulta la UI para saber sobre qué
    // eje del MUNDO opera el rango/las capas de un componente.
    estaVolteado: estaVolteado,
    ejeDistribucion: ejeDistribucion,
    ejeCapas: ejeCapas,
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
