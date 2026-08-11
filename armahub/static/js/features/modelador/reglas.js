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

  // Devuelve el largo (cm) que aporta el empalme TOTAL de un componente (suma de
  // extremos alargados) para poder sumarlo a la dim longitudinal.
  function _empalmeTotalCm(comp, diamCm) {
    var e = comp && comp.empalme;
    if (!e || !e.extremo) return 0;
    var v = evalEmpalme(e.valor, diamCm);
    if (v <= 0) return 0;
    return (e.extremo === 'ambos') ? 2 * v : v;
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
  //   recub_lat_local = recubrimiento de las caras EXTREMAS reales. El motor no
  //     tiene un `recub_ext` propio: usa el recub vertical como recub de extremo
  //     (ver anchorBase.recubExtremo), así que se hereda ese mismo valor.
  function _hostVolteado(host) {
    var rSup = (host.recub_sup != null) ? Number(host.recub_sup) : 4;
    return {
      largo: Number(host.ancho), alto: Number(host.alto), ancho: Number(host.largo),
      recub_sup: rSup,
      recub_inf: (host.recub_inf != null) ? Number(host.recub_inf) : 4,
      recub_lat: rSup
    };
  }

  // Punto del marco LOCAL → mundo (y viceversa: la permutación es involutiva).
  // Conserva el flag `esArco` (perf del motor geométrico: no re-filetear arcos).
  function _voltearPunto(p) {
    var q = { x: p.z, y: p.y, z: p.x };
    if (p.esArco) q.esArco = true;
    return q;
  }

  // cfg de distribución traducida al marco local: sólo el eje de capas (que el
  // panel escribe en ejes del MUNDO) necesita permutarse. El rango vive en el eje
  // de distribución del componente, que ES la x local por definición.
  function _cfgLocal(dist) {
    if (!dist || dist.eje_capas == null) return dist;
    var c = {};
    for (var k in dist) if (dist.hasOwnProperty(k)) c[k] = dist[k];
    c.eje_capas = _EJE_FLIP[String(dist.eje_capas)] || dist.eje_capas;
    return c;
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
      var rf = Math.min(Number(cfg.rango.from), Number(cfg.rango.to));
      var rt = Math.max(Number(cfg.rango.from), Number(cfg.rango.to));
      var sep = Number(cfg.sep || cfg.rango.sep || 20) || 20;
      // Eje del reparto: 'x' (default, estribos a lo largo) o el que declare el
      // rango — un CABEZAL corre en x, así que su rango reparte copias en 'z'
      // (a lo ancho); repartirlo en x lo apilaría sobre sí mismo.
      var ejeR = (cfg.rango.eje === 'y' || cfg.rango.eje === 'z') ? cfg.rango.eje : 'x';
      var nR = redondeoCantidadZona(rt - rf, sep);
      for (var ri = 0; ri < nR; ri++) {
        var xr = rf + ri * sep;
        if (xr > rt + 1e-6) break;
        var extraR = {}; extraR[ejeR] = xr;
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
  // retranquea hacia el núcleo por su índice (offset = capa_idx*(diam+gap)).
  // cfg: { n_capas, barras_capa, gap, sentido:'nucleo' }
  function distribuidorLayered(base, cfg, host) {
    var placements = [];
    var nCapas = Math.max(1, (cfg && cfg.n_capas) || 1);
    var nBarras = Math.max(1, (cfg && cfg.barras_capa) || 1);
    var gap = (cfg && cfg.gap != null) ? cfg.gap : 0;
    var recubLat = (base.anchorBase && base.anchorBase.recubLat != null) ? base.anchorBase.recubLat : 3;
    var zHalf = host.ancho / 2 - recubLat - base.diam / 2;
    var cara = (base.anchorBase && base.anchorBase.cara) || 'sup';
    var s = (cara === 'sup') ? -1 : 1;   // hacia el núcleo
    var yBorde = (cara === 'sup')
      ? (host.alto / 2 - (base.anchorBase.recub || 4) - base.diam / 2)
      : (-host.alto / 2 + (base.anchorBase.recub || 4) + base.diam / 2);
    for (var c = 0; c < nCapas; c++) {
      var y = yBorde + s * c * (base.diam + gap);   // retranqueo por capa
      for (var i = 0; i < nBarras; i++) {
        var z = (nBarras > 1) ? (-zHalf + (2 * zHalf) * (i / (nBarras - 1))) : 0;
        var anchor = _mezclarAnchor(base.anchorBase, { y: y, z: z, cara: cara });
        var puntos = _fp().figuraAPuntos(base.figura, base.dims, host, anchor,
          { rol: base.rol || 'cabezal', diamCm: base.diam });
        placements.push(_placement(base, puntos, { capa: c + 1, cara: cara }));
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
  //   rango: {from, to, sep},   // igual que distribuidorLinear (X absolutas, cm host)
  //   sep,                      // @ del rango (alias de rango.sep)
  //   n_capas,                  // nº de filas paralelas (default 1)
  //   sep_capas,                // separación entre capas, cm (default 0)
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
    var rf = Math.min(Number(rango.from), Number(rango.to));
    var rt = Math.max(Number(rango.from), Number(rango.to));
    var sep = Number((cfg && cfg.sep) || rango.sep || 20) || 20;
    var nCapas = Math.max(1, (cfg && Number(cfg.n_capas)) || 1);
    var sepCapas = (cfg && cfg.sep_capas != null) ? Number(cfg.sep_capas) : 0;
    var eje = (cfg && cfg.eje_capas) || 'z';
    if (eje !== 'x' && eje !== 'y' && eje !== 'z') eje = 'z';
    // Coordenada base del eje de profundidad en el anchor (para offsetear las capas
    // RESPECTO de donde ya está anclada la barra; ausente = 0, como el lineal).
    var baseEje = (base.anchorBase && base.anchorBase[eje] != null) ? Number(base.anchorBase[eje]) : 0;
    var nR = redondeoCantidadZona(rt - rf, sep);
    // 1 capa = distribución lineal pura: NO se toca el eje de profundidad, así el
    // anchor queda BYTE-A-BYTE igual al de distribuidorLinear (garantía de cero
    // regresión). Con ≥2 capas SÍ se fija el plano de profundidad en TODAS las
    // capas (capa 1 en baseEje, no 'ausente') para que el arreglo sea consistente.
    var unaCapa = (nCapas === 1);
    for (var c = 0; c < nCapas; c++) {
      var off = c * sepCapas;
      for (var ri = 0; ri < nR; ri++) {
        var xr = rf + ri * sep;
        if (xr > rt + 1e-6) break;
        var extra = { x: xr };
        if (!unaCapa) extra[eje] = baseEje + off;
        var anchorA = _mezclarAnchor(base.anchorBase, extra);
        var puntosA = _fp().figuraAPuntos(base.figura, base.dims, host, anchorA,
          { rol: base.rol || 'estribo', diamCm: base.diam });
        placements.push(_placement(base, puntosA, unaCapa ? { rango: 1 } : { rango: 1, capa: c + 1 }));
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
  //      del hormigón, vuelve DENTRO (clamp por eje). Así la rotación "sigue
  //      reconociendo los boundaries" en vez de despegar la pieza del recub.
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

  // MARCO ÚTIL del hormigón (dentro del recubrimiento), por eje del mundo.
  function _marcoUtil(host) {
    if (!host) return null;
    var rS = (host.recub_sup != null) ? Number(host.recub_sup) : 4;
    var rI = (host.recub_inf != null) ? Number(host.recub_inf) : 4;
    var rL = (host.recub_lat != null) ? Number(host.recub_lat) : 3;
    var L = Number(host.largo), A = Number(host.alto), W = Number(host.ancho);
    if (!isFinite(L) || !isFinite(A) || !isFinite(W)) return null;
    return {
      x: { lo: -L / 2 + rS, hi: L / 2 - rS },     // extremos: el motor usa el recub vertical
      y: { lo: -A / 2 + rI, hi: A / 2 - rS },
      z: { lo: -W / 2 + rL, hi: W / 2 - rL }
    };
  }

  // Delta que devuelve la pieza DENTRO del marco útil (0 si ya cabe donde está).
  // Si en un eje la pieza es MÁS LARGA que el marco (p.ej. un estribo girado 90°
  // en una viga angosta) no hay clamp posible → se CENTRA en ese eje.
  function _deltaReanclaje(bb, marco) {
    var d = { x: 0, y: 0, z: 0 };
    if (!bb || !marco) return d;
    ['x', 'y', 'z'].forEach(function (e) {
      var f = marco[e], lo = bb.min[e], hi = bb.max[e];
      if (!f || !(f.hi > f.lo)) return;
      if ((hi - lo) > (f.hi - f.lo)) { d[e] = (f.lo + f.hi) / 2 - (lo + hi) / 2; return; }
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
    var marco = ((tieneRot || tieneSpin) && (!orient || orient.pivot !== 'host')) ? _marcoUtil(host) : null;
    placements.forEach(function (pl) {
      var piv = tieneRot ? _pivoteDeRotacion(pl, orient) : null;
      var pts = (pl.puntos || []).map(function (p) {
        if (!tieneRot) return { x: p.x, y: p.y, z: p.z, esArco: p.esArco };
        var q = _rotarPunto({ x: p.x - piv.x, y: p.y - piv.y, z: p.z - piv.z }, eje, rad);
        return { x: q.x + piv.x, y: q.y + piv.y, z: q.z + piv.z, esArco: p.esArco };
      });
      if (tieneSpin) pts = _girarSobreEjeBarra(pts, radSpin);
      // RE-ANCLAJE al recubrimiento (boundaries) + traslación del pos_hint.
      var r = marco ? _deltaReanclaje(_bboxPuntos(pts), marco) : { x: 0, y: 0, z: 0 };
      pl.puntos = pts.map(function (q) {
        var o = { x: q.x + r.x + dx, y: q.y + r.y + dy, z: q.z + r.z + dz };
        if (q.esArco) o.esArco = true;
        return o;
      });
      if (tieneRot) pl.meta = _mezclarAnchor(pl.meta || {}, { orient_deg: Number(orient.deg), orient_eje: eje });
    });
    return placements;
  }

  // ---------------------------------------------------------------------------
  // EXPANSOR: despacha por comp.distribucion.modo
  // ---------------------------------------------------------------------------
  function expandirComponente(comp, host) {
    normalizarComponente(comp);   // rellena campos aditivos ausentes (defaults null)
    var dist = comp.distribucion || {};
    // VOLTEO = permutación de ejes REAL: se expande contra el host permutado y se
    // devuelven los puntos al mundo. volteado=false → ruta idéntica a la anterior.
    var flip = estaVolteado(comp);
    var hostEf = flip ? _hostVolteado(host) : host;
    var base = flip
      ? _baseDeComponente(comp, hostEf, { recubExtremo: (host.recub_lat != null ? Number(host.recub_lat) : 3) })
      : _baseDeComponente(comp, host);
    if (flip) dist = _cfgLocal(dist);
    var placements;
    // MODO DE USO del Template Editor (§0-11ter / §INTERACCIÓN-2.0): comp.modo =
    // 'puntual'|'lineal'|'arreglo' es el selector de ALTO NIVEL de los 3 botones
    // del panel. Solo 'arreglo' necesita despacho propio (rango × capas);
    // 'puntual'/'lineal' se materializan en dist.modo ('layered'/'linear') por el
    // panel y caen al switch de abajo. IMPRESCINDIBLE: solo se ramifica con el
    // valor EXPLÍCITO 'arreglo'. El preset por tipología de la viga-semilla es
    // 'puntual'/'lineal' (nunca 'arreglo'), así que el switch queda intacto para
    // ella (cero regresión: 72 placements / 140.3 kg / 4 items).
    if (comp.modo === 'arreglo' || dist.modo === 'arreglo') {
      placements = distribuidorArreglo(base, dist, hostEf);
      if (flip) _voltearPlacements(placements);
      return _aplicarPostTransform(placements, comp, host);
    }
    switch (dist.modo) {
      case 'linear': placements = distribuidorLinear(base, dist, hostEf); break;
      case 'layered': placements = distribuidorLayered(base, dist, hostEf); break;
      case 'arreglo': placements = distribuidorArreglo(base, dist, hostEf); break;
      case 'grid': placements = distribuidorGrid(base, dist, hostEf); break;
      case 'perimeter': placements = distribuidorPerimeter(base, dist, hostEf); break;
      case 'points': placements = distribuidorPoints(base, dist, hostEf); break;
      default: placements = [];
    }
    if (flip) _voltearPlacements(placements);
    return _aplicarPostTransform(placements, comp, host);
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
  // host; 'fija' toma su valor. Para el MVP: en cabezal, B(auto)=largo−2·recub;
  // en estribo, los lados del perímetro (auto)=alto/ancho−2·recub.
  function _dimsEfectivas(comp, host) {
    var dims = {};
    var g = comp.dims || {};
    var recub = (host.recub_sup != null ? host.recub_sup : 4);
    var recubLat = (host.recub_lat != null ? host.recub_lat : 3);
    Object.keys(g).forEach(function (k) {
      var d = g[k];
      if (d && d.modo === 'fija') { dims[k] = Number(d.valor); return; }
      // AUTO: deriva según rol + letra.
      if (comp._rol === 'cabezal') {
        // B = largo − 2·recub extremo (patas van fuera del tramo B)
        dims[k] = host.largo - 2 * recub;
      } else if (comp._rol === 'estribo') {
        // perímetro: A/C = alto útil; B/D = ancho útil (aprox — el backend recalcula largo)
        var altoUtil = host.alto - 2 * recub;
        var anchoUtil = host.ancho - 2 * recubLat;
        dims[k] = (k === 'A' || k === 'C') ? anchoUtil : altoUtil;
      } else {
        dims[k] = host.alto - 2 * recub;
      }
    });
    // EMPALME: alarga la dim LONGITUDINAL. La longitudinal es la que corre a lo
    // largo del eje de colocación: en 101A es A (barra recta); en 10x con tramo
    // (102/103/104) es B (tramo largo). Se aplica DESPUÉS del auto/fija para que
    // el override numérico del usuario también reciba el empalme.
    var empTot = _empalmeTotalCm(comp, Number(comp.diam) / 10);
    if (empTot > 0) {
      var f = (comp.figura || '').toUpperCase();
      var lado = (f.indexOf('101') === 0) ? 'A' : (dims.B != null ? 'B' : 'A');
      if (dims[lado] != null) dims[lado] = Number(dims[lado]) + empTot;
    }
    return dims;
  }

  // opts.recubExtremo: recubrimiento de las caras que cierran el eje LONGITUDINAL
  // local. Sin opts vale el recub vertical (comportamiento histórico); con la pieza
  // VOLTEADA el eje longitudinal local es la Z real, así que su recub es el lateral.
  function _baseDeComponente(comp, host, opts) {
    comp._rol = comp._rol || _rolDeTipologia(comp.tipologia, comp.cara);
    var recub = (comp.recub_override != null) ? comp.recub_override
      : (comp.cara === 'inf' ? (host.recub_inf != null ? host.recub_inf : 4)
                             : (host.recub_sup != null ? host.recub_sup : 4));
    var diamCm = Number(comp.diam) / 10;   // mm → cm
    // Empalme resuelto (cm por extremo) para que figura_puntos asome la barra
    // fuera del hormigón en el lado indicado (dato geométrico; el largo/peso ya
    // los cubre la dim alargada en _dimsEfectivas).
    var empExtremo = (comp.empalme && comp.empalme.extremo) || null;
    var empValor = empExtremo ? evalEmpalme(comp.empalme.valor, diamCm) : 0;
    return {
      figura: comp.figura, diam: diamCm,
      tipologia: comp.tipologia, suf: comp.suf_tipo || '',
      comp_id: (comp.comp_id != null ? comp.comp_id : null),
      prioridad: comp.prioridad != null ? comp.prioridad : null,
      dims: _dimsEfectivas(comp, host),
      angulos: comp.angulos || null,
      rol: comp._rol,
      anchorBase: {
        cara: comp.cara, recub: recub,
        recubLat: (host.recub_lat != null ? host.recub_lat : 3),
        recubExtremo: (opts && opts.recubExtremo != null) ? Number(opts.recubExtremo) : recub,
        empalme: (empExtremo && empValor > 0) ? { extremo: empExtremo, valor: empValor } : null
      }
    };
  }

  function _rolDeTipologia(tip, cara) {
    var t = (tip || '').toUpperCase();
    if (t === 'ES' || t === 'ESC' || t === 'EC') return 'estribo';
    if (t === 'TRV' || t === 'TR' || t === 'TC' || t === 'TRC' || t === 'TRL' || t === 'TRF') return 'traba';
    return 'cabezal';   // CBS/CBI/CB/LT/… longitudinales
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
    evalEmpalme: evalEmpalme,
    expandirComponente: expandirComponente,
    // VOLTEO (permutación de ejes real) — lo consulta la UI para saber sobre qué
    // eje del MUNDO opera el rango/las capas de un componente.
    estaVolteado: estaVolteado,
    ejeDistribucion: ejeDistribucion,
    ejeCapas: ejeCapas,
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
