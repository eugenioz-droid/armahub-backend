// =============================================================================
// Modelador 3D — GENERAR (F0 · T0.6)
// generarViga(receta) → expande TODOS los componentes con el motor de reglas →
// placements 3D → convierte cada placement a una BarraPayload (mismo shape que
// ac2Payload) para POST /lotes/{id}/barras.
//
// CONTRATO (del guion): el motor SOLO llena figura + dim_* + ang* + diam + cant
// + mult (+ origen/template_instancia_id). NO envía largo ni peso: el BACKEND
// los calcula (largo_desde_lados + peso.py + factor de obra). El kg del resumen
// (stats en vivo) se estima aquí con la MISMA fórmula (espejo de peso.py) pero
// NO se envía.
//
// Además, el payload debe llenar EXACTAMENTE los slots que la FIGURA usa (según
// sus parciales/ángulos del catálogo) y dejar el resto vacío, para pasar
// validar_geometria en el backend.
//
// Depende de ModeladorReglas (expandirComponente). No usa THREE → testeable.
// =============================================================================
(function (global) {
  'use strict';

  // Resolver la dependencia EN EL MOMENTO DE USARLA, no al cargar el módulo: en el
  // navegador los scripts se cargan en PARALELO y generar.js puede ejecutarse ANTES
  // que reglas.js → capturarlo aquí daba null para siempre (bug "0 barras").
  function _reglas() {
    return global.ModeladorReglas ||
      (typeof require !== 'undefined' ? require('./reglas.js') : null);
  }

  // CATÁLOGO DE FIGURAS — fuente ÚNICA de parciales/ángulos/radio.
  // ---------------------------------------------------------------------------
  // Antes acá vivía una tablita a mano con 5 figuras (las de la viga-semilla).
  // El catálogo real tiene 63: dibujar cualquier otra salía en el 3D pero el
  // payload iba con TODAS las dims en null → 0 kg y validar_geometria la
  // rechazaba, en silencio. Ahora se resuelve contra catalogo_figuras.js (espejo
  // generado desde armahub/catalogo.py), que la UI refresca con la data real del
  // GET /figuras-catalogo llamando a ModeladorCatalogoFiguras.actualizar(data).
  //
  // Resolución EN EL MOMENTO DE USAR (no al cargar el módulo): en el navegador
  // los scripts se cargan en PARALELO — capturarlo aquí daría null para siempre.
  function _cat() {
    return global.ModeladorCatalogoFiguras ||
      (typeof require !== 'undefined' ? require('./catalogo_figuras.js') : null);
  }

  // Spec de una figura, o null si NO está en el catálogo. NO se inventa un spec
  // vacío: una figura desconocida tiene que doler (aviso + sin payload), no
  // producir una barra con dims null y 0 kg.
  function specFigura(figura) {
    var c = _cat();
    return c ? c.get(figura) : null;
  }

  var LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

  // PESO espejo de peso.py: 7850·π·(φmm/2000)²·(largo cm/100). SOLO para stats.
  function pesoUnitarioEstimado(diamMm, largoCm) {
    if (diamMm == null || largoCm == null) return null;
    return 7850 * Math.PI * Math.pow(Number(diamMm) / 2000, 2) * (Number(largoCm) / 100);
  }

  // Largo estimado = suma de los lados (dims) que la figura USA (espejo de
  // largo_desde_lados; el radio no suma). SOLO para stats — el backend recalcula.
  function largoEstimado(figura, dimsLetras) {
    var spec = specFigura(figura);
    if (!spec) return null;
    var total = 0;
    for (var i = 0; i < spec.parciales.length; i++) {
      var v = dimsLetras[spec.parciales[i]];
      if (v == null || !isFinite(v)) return null;
      total += Number(v);
    }
    return total;
  }

  // Convierte un placement (dims por letra) a la BarraPayload del backend.
  // marca = tipología (+ el suf viaja aparte en suf_tipo, como en ac2Payload).
  // Llena SOLO los slots que la figura usa; el resto va null.
  //
  // FIGURA DESCONOCIDA → devuelve null (NO una barra con todo en null). El
  // llamador lo convierte en aviso visible. Antes se caía a un spec vacío y salía
  // un payload de 0 kg que el backend rechazaba sin que nadie supiera por qué.
  // UID ESTABLE DEL COMPONENTE. Cae al índice sólo cuando la receta no trae uid (el
  // camino de la biblioteca, que no necesita trazar nada): ahí nadie va a cruzar
  // generaciones, así que un identificador posicional alcanza.
  function _uidComp(comp, ci) {
    return (comp && comp.uid != null && String(comp.uid) !== '') ? String(comp.uid) : ('c' + ci);
  }

  function placementABarra(pl, ctx) {
    var spec = specFigura(pl.figura);
    if (!spec) return null;
    var diamMm = Math.round(pl.diam * 10);   // cm → mm (diámetro estándar)
    var b = {
      // Ubicación: del contexto del lote (AC2), no de la receta.
      sector: ctx.sector || null, ciclo: ctx.ciclo || null,
      piso: ctx.piso || null, eje: ctx.eje || null,
      nombre_plano: ctx.nombre_plano || null,
      diam: diamMm,
      figura: pl.figura,
      marca: pl.tipologia || null,
      cant: 1, mult: 1,
      radio: null,
      revisada: false,
      suf_tipo: (pl.suf_tipo || '').trim() || null,
      // origen/template — el backend los aceptará (T1.1). Default seguro.
      origen: 'template',
      template_instancia_id: (ctx.template_instancia_id != null ? ctx.template_instancia_id : null)
    };
    // Clave de TRABAJO (no viaja al backend: agruparBarras la consume y la borra).
    if (ctx.trazarOrigen) b._uid = (pl.meta && pl.meta.uid) || null;
    // dim_a..dim_i: solo los parciales de la figura.
    LETRAS.forEach(function (L) {
      var col = 'dim_' + L.toLowerCase();
      b[col] = (spec.parciales.indexOf(L) !== -1 && pl.dims[L] != null) ? Number(pl.dims[L]) : null;
    });
    // ang1..ang4: los ángulos EFECTIVOS de ESTA barra (convención del catálogo = el
    // GIRO del doblez). El catálogo SUGIERE y el componente decide: `pl.angulos` es
    // lo que la receta escribió y figura_puntos.angulosEfectivos aplica los que están
    // dentro del rango de su doblez (los demás quedan en el valor del catálogo).
    // Se resuelve ACÁ y no en el motor a propósito: es la MISMA función que consume
    // el trazador (derivarTramos), así que el ángulo que se factura y el que se
    // dibuja no pueden ser dos números distintos. Sin `pl.angulos` —o sin overrides
    // válidos— devuelve el catálogo tal cual y el payload queda byte-idéntico.
    var fpA = _fp();
    var angEf = (fpA && fpA.angulosEfectivos)
      ? fpA.angulosEfectivos(pl.figura, pl.angulos) : spec.angulos;
    for (var a = 0; a < 4; a++) {
      b['ang' + (a + 1)] = (a < angEf.length) ? Number(angEf[a]) : null;
    }
    return b;
  }

  // AGRUPACIÓN por item/etiqueta: barras IDÉNTICAS (misma figura/diam/dims/marca/
  // suf/ángulos) se colapsan a 1 fila con cant = N (lógica cant/mult de barras).
  // Espeja la regla de fabricación (§0-5ter): capas iguales → 1 etiqueta ×N.
  function _claveBarra(b) {
    return [b.figura, b.diam, b.marca, b.suf_tipo,
      b.dim_a, b.dim_b, b.dim_c, b.dim_d, b.dim_e, b.dim_f, b.dim_g, b.dim_h, b.dim_i,
      b.ang1, b.ang2, b.ang3, b.ang4].join('|');
  }

  // ---------------------------------------------------------------------------
  // AVISOS DE FIGURA (contrato del motor: lo que NO se puede hacer, se DICE)
  // ---------------------------------------------------------------------------
  // Mismo canal que usa reglas.js para las capas anidadas que no caben:
  // `comp._avisos` (no enumerable, para no ensuciar la receta que se guarda ni el
  // dirty-tracking del editor). La UI lo muestra en la barra de estado.
  function _avisarComp(comp, msg) {
    if (!comp || !msg) return;
    var a = comp._avisos;
    if (Object.prototype.toString.call(a) === '[object Array]') {
      if (a.indexOf(msg) < 0) a.push(msg);
      return;
    }
    try {
      Object.defineProperty(comp, '_avisos',
        { value: [msg], enumerable: false, writable: true, configurable: true });
    } catch (e) { comp._avisos = [msg]; }
  }

  function _fp() {
    return global.ModeladorFiguraPuntos ||
      (typeof require !== 'undefined' ? require('./figura_puntos.js') : null);
  }

  // Cuántos lados TRAZA de verdad el constructor de cada familia de dibujo.
  // 'cadena' (trazador genérico) no está en la tabla porque traza TODOS los lados
  // de la figura, sean 4 o 9: su cuota es n, no una constante (ver _revisarFiguraComp).
  // ('traba' salió: familiaDeDibujo ya no puede devolverla — Modelo A)
  var LADOS_TRAZADOS = { recta: 1, cabezal: 3, estribo: 4 };

  // Revisa la figura de un componente contra el catálogo y contra lo que el
  // editor sabe dibujar. Devuelve false cuando NO se debe generar payload.
  // Tres situaciones, tres avisos distintos (ninguna se tapa):
  //   1. la figura NO está en el catálogo → sin barra (sería un payload con todas
  //      las dims en null, 0 kg y rechazo del backend);
  //   2. está pero el editor no la sabe dibujar (espiral con radio, 5+ tramos) →
  //      la barra SÍ sale y sus dims/kg son correctos; el 3D es aproximado;
  //   3. la figura tiene más lados de los que traza el constructor de su rol
  //      (una figura de 4 lados colocada como cabezal) → se dice qué lados no se
  //      dibujan, y las dims igual viajan completas al payload.
  function _revisarFiguraComp(comp, rol) {
    var fig = (comp && comp.figura) || '';
    var spec = specFigura(fig);
    if (!spec) {
      _avisarComp(comp, 'Figura ' + (fig || '(vacía)') + ' no está en el catálogo: ' +
        'no se genera barra para este componente.');
      return false;
    }
    var fp = _fp();
    if (!fp || !fp.dibujabilidad) return true;
    var d = fp.dibujabilidad(fig);
    if (!d.dibujable) {
      // NO DIBUJABLE = SIN PAYLOAD (hallazgo del verificador D1/D2): dejarla pasar
      // generaba barras que el editor no puede garantizar — 201A salía con
      // radio:null (400 del backend) y una 105A con dims auto salía de 29.6 m y
      // 46.7 kg FANTASMA que validar_geometria aceptaba. La ficha dice "no se
      // dibuja ni pesa hasta corregirla": ahora el motor cumple esa promesa.
      _avisarComp(comp, 'Figura ' + fig + ': el editor no la soporta (' + d.motivo +
        ') — no se genera barra para este componente.');
      return false;
    }
    var fam = fp.familiaDeDibujo ? fp.familiaDeDibujo(fig, rol) : 'cabezal';
    var n = spec.parciales.length;
    var trazados = (fam === 'cadena') ? n : (LADOS_TRAZADOS[fam] || 3);
    // ESTRIBO CON GANCHOS DECLARADOS (106x, corrección 14-ago): sus 6 letras SÍ
    // se dibujan todas — 4 de cuerpo por el marco + 2 ganchos por los codos del
    // propio _estriboPerimetral. Y da igual el rol DECLARADO (una 106A puesta
    // como CBS): _baseDeComponente lo fuerza a estribo por topología, así que
    // avisar "colocada como cabezal: se dibujan 3 de 6" describiría un dibujo
    // que no existe.
    if (fp.esEstriboConGanchos && fp.esEstriboConGanchos(fig)) { fam = 'estribo'; trazados = n; }
    if (n > trazados) {
      var sinTrazar = spec.parciales.slice(trazados);
      _avisarComp(comp, 'Figura ' + fig + ' colocada como ' + (rol || 'cabezal') +
        ': se dibujan ' + trazados + ' de sus ' + n + ' lados (' + sinTrazar.join('/') +
        ' no se traza' + (sinTrazar.length > 1 ? 'n' : '') + '). Las dims viajan completas.');
    }
    // …Y EL OTRO SENTIDO (15-ago): el chequeo era unilateral. Una figura de 1-3
    // lados bajo rol ESTRIBO se dibuja como MARCO COMPLETO (familia estribo) y el
    // payload factura solo los lados que la figura declara — medido: 101A como ES
    // dibujaba 169 cm y facturaba 24, en silencio. El dibujo miente al revés:
    // ahora también se DICE.
    if (fam === 'estribo' && n < 4 && !(fp.esEstriboConGanchos && fp.esEstriboConGanchos(fig))) {
      _avisarComp(comp, 'Figura ' + fig + ' (' + n + ' lado' + (n > 1 ? 's' : '') +
        ') colocada como estribo: el 3D dibuja el MARCO completo pero el despiece ' +
        'factura solo lo que la figura declara (' + spec.parciales.join('/') +
        '). Usa una figura de marco (104x/106x) o revisa la tipología.');
    }
    return true;
  }

  // IDENTIFICADOR DE ORIGEN (`origen_ref`) — sólo con trazar=true (modo obra).
  // -----------------------------------------------------------------------------
  // Es la llave que cruza una generación con la siguiente: dice de QUÉ COMPONENTE y de
  // QUÉ POSICIÓN de su distribución nació cada item ('uid#ordinal'). Con ella, reabrir
  // una estructura y regenerarla ACTUALIZA la barra que ya existía (conserva su id, su
  // historia y su marca de revisión) en vez de borrarla y crear otra.
  //
  // Trazar CAMBIA LA AGRUPACIÓN a propósito: con traza, dos componentes distintos que
  // producen barras idénticas quedan en items SEPARADOS. Sin esa separación el item
  // resultante no tendría un origen único y el cruce sería ambiguo — y en un despiece
  // son dos posiciones distintas del elemento, no una. En la biblioteca (trazar=false)
  // la agrupación queda EXACTAMENTE como estaba: mismas claves, mismos items.
  //
  // LÍMITE MEDIDO: el ordinal es la posición del item DENTRO de su componente. Cambiar
  // una medida no lo mueve (el item sigue siendo el mismo, se actualiza); agregar o
  // quitar capas/tramos sí corre los ordinales de ese componente, y ahí el cruce trata
  // la diferencia como creación/borrado — que es lo correcto.
  function agruparBarras(barras, trazar) {
    var mapa = {}, orden = [];
    barras.forEach(function (b) {
      var k = (trazar ? ((b._uid || '?') + '\u0000') : '') + _claveBarra(b);
      if (!mapa[k]) { mapa[k] = Object.assign({}, b, { cant: 0 }); orden.push(k); }
      mapa[k].cant += 1;
    });
    var items = orden.map(function (k) { return mapa[k]; });
    var cont = {};
    items.forEach(function (b) {
      if (trazar) {
        var u = b._uid || 'c?';
        cont[u] = (cont[u] == null) ? 0 : (cont[u] + 1);
        b.origen_ref = u + '#' + cont[u];
      }
      delete b._uid;   // clave de trabajo: nunca sale del generador
    });
    return items;
  }

  // ---------------------------------------------------------------------------
  // RETRANQUEO / DEPENDENCIAS (§DISCOVERY-INTERACCIÓN-2.B/C)
  // ---------------------------------------------------------------------------
  // Modelo CORREGIDO del usuario (NO escalones): la barra se desplaza COMPLETA
  // hacia el núcleo. Si es recta (101A) sólo cambia de posición (largo IGUAL);
  // si tiene patas (103x) el tramo B se corre adentro y las patas A/C se ACORTAN
  // en el offset → el largo (suma de lados) baja → el peso sale bien.
  //
  // PRIORIDAD: número GLOBAL único por componente. El de MENOR número va más
  // AFUERA (al recubrimiento); el de MAYOR número se retranquea hacia el núcleo
  // una cantidad = diámetro de la barra prioritaria con la que cruza, en las
  // caras donde la cruza.
  //
  // MVP (límites documentados):
  //  - Grafo simple: cada componente con prioridad se compara con TODOS los de
  //    prioridad menor (más externos). El offset acumulado = suma de los φ de las
  //    prioritarias cuya ORIENTACIÓN es transversal (cruzan la barra).
  //  - "cara donde cruza": se aproxima por orientación. Un cabezal (corre en X)
  //    se retranquea en Y (hacia el núcleo) por cada estribo/traba prioritaria
  //    (corren en YZ). Un estribo/traba se retranquea si hay un cabezal más
  //    prioritario (raro). Si NINGUNA prioritaria cruza a la barra, NO se ajusta.
  //  - Simplificación explícita: se retranquea la barra COMPLETA (los 4 lados por
  //    igual) cuando depende de una prioritaria que va por fuera; NO se hace el
  //    análisis lado-por-lado fino (queda como límite del MVP → 'pendientes').

  // Orientación dominante de un placement: 'X' (longitudinal, corre en el largo)
  // o 'YZ' (transversal: estribo/traba en el plano de sección).
  function _orientacion(pl) {
    var pts = pl.puntos || [];
    if (pts.length < 2) return 'X';
    var dx = 0, dyz = 0;
    for (var i = 1; i < pts.length; i++) {
      dx += Math.abs(pts[i].x - pts[i - 1].x);
      dyz += Math.abs(pts[i].y - pts[i - 1].y) + Math.abs(pts[i].z - pts[i - 1].z);
    }
    return (dx >= dyz) ? 'X' : 'YZ';
  }

  // Desplaza TODOS los puntos de un placement por (dx,dy,dz).
  // PERF (F0·esArco): conserva el flag `esArco` del punto original. Ese flag lo pone
  // figura_puntos._arcoYZ en los puntos MUESTREADOS de un arco y motor_geom lo usa
  // para NO meter un fillet-toro redundante ahí. Recrear el punto sin él (esto era
  // un .map que sólo copiaba x/y/z) hacía que un estribo RETRANQUEADO por prioridad
  // perdiera la optimización y volviera a generar ~14 toros por codo. Es aditivo:
  // no cambia ninguna coordenada.
  function _trasladar(pts, dx, dy, dz) {
    return pts.map(function (p) {
      var q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (p.esArco) q.esArco = true;
      return q;
    });
  }

  // resolverDependencias(placements) → placements ajustados (in-place sobre copias).
  // Requiere que los placements traigan `prioridad` (del componente). Los que no
  // tienen prioridad se dejan intactos (funcionan como si no chocaran con nadie).
  function resolverDependencias(placements) {
    if (!placements || !placements.length) return placements;
    // Índice de placements por prioridad presente.
    var conPrio = placements.filter(function (p) { return p.prioridad != null; });
    if (conPrio.length < 2) return placements;   // nada que resolver

    // φ (cm) máximo por nivel de prioridad — el offset que impone una prioritaria.
    // Se agrupa por prioridad y orientación para poder decidir cruces.
    var porPrio = {};   // prioridad → { diam, orient, comp_id }
    conPrio.forEach(function (p) {
      var k = p.prioridad;
      if (!porPrio[k]) porPrio[k] = { diam: p.diam, orient: _orientacion(p) };
      else { porPrio[k].diam = Math.max(porPrio[k].diam, p.diam); }
    });
    var prios = Object.keys(porPrio).map(Number).sort(function (a, b) { return a - b; });

    placements.forEach(function (pl) {
      if (pl.prioridad == null) return;
      var miOrient = _orientacion(pl);
      // Suma de φ de TODAS las prioritarias MÁS EXTERNAS (prioridad menor) cuya
      // orientación es transversal a la mía (la cruzan).
      var offset = 0;
      prios.forEach(function (pr) {
        if (pr >= pl.prioridad) return;            // sólo las más externas
        var info = porPrio[pr];
        if (info.orient === miOrient) return;      // paralelas: no se cruzan
        offset += info.diam;                       // cruza → retranquea 1·φ
      });
      if (offset <= 0) return;
      pl._retranqueo = offset;
      if (miOrient === 'X') {
        // Cabezal: se corre en Y hacia el núcleo. Dirección: cara sup → -Y, inf → +Y.
        var cara = (pl.meta && pl.meta.cara) || (pl.puntos[1] && pl.puntos[1].y > 0 ? 'sup' : 'inf');
        var s = (cara === 'sup') ? -1 : 1;
        pl.puntos = _trasladar(pl.puntos, 0, s * offset, 0);
        // Patas A/C (103x) se ACORTAN en el offset (el tramo B se corrió adentro,
        // el extremo de la pata sigue anclado al recubrimiento externo).
        _acortarPatas(pl, offset);
      } else {
        // Estribo/traba transversal: se corre en Z hacia el núcleo (aprox por el
        // signo del primer punto). Límite MVP: sin lado-por-lado.
        var sz = (pl.puntos[0] && pl.puntos[0].z > 0) ? -1 : 1;
        pl.puntos = _trasladar(pl.puntos, 0, 0, sz * offset);
      }
    });
    return placements;
  }

  // Acorta las patas (A al inicio, C al final) de un placement retranqueado en
  // `off` cm y refleja el acortamiento en la polilínea. QUÉ EXTREMOS TIENEN PATA
  // lo dice el CATÁLOGO (parciales de la figura), no el prefijo del código: antes
  // era una lista '103x/104x' que dejaba fuera, por ejemplo, la 102x — que tiene
  // pata inicial y también hay que acortarla. Una recta (1 parcial) no tiene
  // ninguna y se sale sin tocar nada.
  function _acortarPatas(pl, off) {
    var fp = _fp();
    var patas = (fp && fp.patasDeFigura) ? fp.patasDeFigura(pl.figura) : null;
    if (!patas || (!patas.inicio && !patas.fin)) return;
    if (patas.inicio && pl.dims && pl.dims.A != null) pl.dims.A = Math.max(0, Number(pl.dims.A) - off);
    if (patas.fin && pl.dims && pl.dims.C != null) pl.dims.C = Math.max(0, Number(pl.dims.C) - off);
    // Polilínea: el punto de gancho (primero / último) se acerca `off` al tramo
    // en Y. Patrón del cabezal con dos patas = [pataA, x0, x1, pataC].
    var pts = pl.puntos;
    if (!pts || pts.length < 3) return;
    if (patas.inicio) {
      var first = pts[0], second = pts[1];
      // La pata va de `second` a `first` en Y; acortarla = mover `first` hacia `second`.
      first.y -= (Math.sign(first.y - second.y) || 0) * off;
    }
    if (patas.fin) {
      var last = pts[pts.length - 1], prev = pts[pts.length - 2];
      last.y -= (Math.sign(last.y - prev.y) || 0) * off;
    }
  }

  // generarViga(receta) → { placements, barras, resumen }
  // receta = { tipo:'viga', geometria:{largo,ancho,alto,recub_sup,recub_inf,recub_lat}, componentes:[...] }
  // ctx = { sector, ciclo, piso, eje, nombre_plano, template_instancia_id,
  //         trazarOrigen } (contexto del lote). trazarOrigen=true agrega `origen_ref` a
  // cada item y separa los items por componente — ver agruparBarras.
  function generarViga(receta, ctx) {
    ctx = ctx || {};
    var geo = receta.geometria || {};
    var host = {
      largo: Number(geo.largo), alto: Number(geo.alto), ancho: Number(geo.ancho),
      recub_sup: geo.recub_sup != null ? Number(geo.recub_sup) : 4,
      recub_inf: geo.recub_inf != null ? Number(geo.recub_inf) : 4,
      recub_lat: geo.recub_lat != null ? Number(geo.recub_lat) : 3
    };
    var REGLAS = _reglas();
    if (!REGLAS) { console.error('[generar] ModeladorReglas no disponible aún'); return { placements: [], barras: [], resumen: { items: 0, barras: 0, kg: 0 } }; }
    // -------------------------------------------------------------------------
    // PILAS DE OCUPACIÓN POR CARA (jerarquía volumétrica) — DOS PASADAS POR NIVEL
    // -------------------------------------------------------------------------
    // comp.jerarquia = 'no' | 1 | 2 | 3 | 4 (default por rol: estribo 1,
    // traba/cabezal 2).
    //   nivel 1 = pegado al recubrimiento Y aporta su φ a las caras que toca;
    //   nivel n = se apoya POR DENTRO de las pilas de las caras que toca;
    //   'no'    = pegado al recubrimiento y NO aporta φ (no empuja a nadie).
    //
    // host.jer_caras = { sup:[…], inf:[…], lat:[…], ext:[…] }, 1-BASED: el índice
    // k guarda el φ MÁXIMO que el nivel k dejó en esa cara (el índice 0 existe
    // pero vale 0: no hay nivel 0). profundidad(cara, n) = recub(cara) +
    // Σ jer_caras[cara][1..n−1] (reglas.profundidadCara / marcoUtilNivel).
    //
    // El proceso va POR NIVEL ASCENDENTE porque el nivel k necesita las pilas ya
    // cerradas de los niveles anteriores. Por cada nivel:
    //   1) se expanden sus componentes contra las pilas ACTUALES;
    //   2) de los placements FINALES (post-transform incluido) se DERIVAN los
    //      contactos (reglas.carasOcupadas — geométrico, sin casos por figura);
    //   3) se puebla jer_caras[cara][k] con el φ máximo que tocó esa cara.
    // Los componentes del MISMO nivel ven la MISMA pila: no se empujan entre sí
    // (límite documentado — el acomodo fino intra-nivel es del enfierrador).
    var comps = receta.componentes || [];
    var CARAS = REGLAS.CARAS || ['sup', 'inf', 'lat', 'ext'];
    var jerCaras = {};
    CARAS.forEach(function (F) { jerCaras[F] = [0]; });
    host.jer_caras = jerCaras;

    var plan = comps.map(function (comp, ci) {
      // EL ROL QUE MANDA (topología sobre tipología), el MISMO que usa el motor
      // al expandir. Con `rolDeTipologia` a secas, un 106A escrito bajo MH
      // planificaba su nivel como cabezal y se expandía como estribo: dos jerarquías
      // para la misma barra, y la pila de recubrimientos salía de la equivocada.
      var rol = (REGLAS.rolDeComponente ? REGLAS.rolDeComponente(comp)
        : (REGLAS.rolDeTipologia ? REGLAS.rolDeTipologia(comp.tipologia, comp.cara) : 'cabezal'));
      var nivel = REGLAS.nivelJerarquiaEfectivo
        ? REGLAS.nivelJerarquiaEfectivo(comp.jerarquia, rol)
        : (rol === 'estribo' ? 1 : 2);
      // 'no' = fuera de la cadena: se ancla al recubrimiento pelado (k 0) y no aporta.
      return { comp: comp, ci: ci, rol: rol, nivel: nivel, k: (nivel === 'no') ? 0 : Number(nivel) };
    });
    var niveles = [];
    plan.forEach(function (p) { if (niveles.indexOf(p.k) === -1) niveles.push(p.k); });
    niveles.sort(function (a, b) { return a - b; });

    // Los placements se guardan POR COMPONENTE: el orden de PROCESO es por nivel,
    // pero el orden de SALIDA sigue siendo el de receta.componentes (el etiquetado
    // por ci del Template Editor y el orden de los ítems dependen de eso).
    var porComp = new Array(comps.length);
    niveles.forEach(function (k) {
      var aporte = { sup: 0, inf: 0, lat: 0, ext: 0 };
      plan.forEach(function (p) {
        if (p.k !== k) return;
        var pls = REGLAS.expandirComponente(p.comp, host);
        pls.forEach(function (pl) {
          pl.meta = pl.meta || {};
          pl.meta.ci = p.ci;              // índice ORIGINAL (el etiquetado no rota)
          // UID DEL COMPONENTE — de qué barra de la receta nació este placement. Es la
          // mitad del identificador de origen (ver agruparBarras). El uid lo estampa el
          // editor EN LA RECETA y viaja con ella, así que sobrevive a guardar y reabrir;
          // el índice `ci` no sirve para eso (reordenar componentes lo cambia).
          pl.meta.uid = _uidComp(p.comp, p.ci);
          if (k < 1) return;              // 'no' no aporta a ninguna pila
          // El arrastre manual (pos_hint) se descuenta: mover una barra a mano no
          // la cambia de cara en la cadena (conserva el aporte de su cara natural).
          // Se descuenta el hint RESUELTO contra este host (anclaje por distancia al
          // borde): si se restara el valor guardado, la barra de un template abierto
          // en otra medida se descontaría un delta que el motor ya no aplicó.
          var phC = (REGLAS.posHintResuelto && p.comp)
            ? REGLAS.posHintResuelto(p.comp, host) : (p.comp && p.comp.pos_hint);
          var caras = REGLAS.carasOcupadas
            ? REGLAS.carasOcupadas(pl, host, k, phC) : [];
          caras.forEach(function (F) { if (pl.diam > aporte[F]) aporte[F] = pl.diam; });
        });
        porComp[p.ci] = pls;
      });
      if (k < 1) return;
      CARAS.forEach(function (F) {
        var arr = jerCaras[F];
        while (arr.length <= k) arr.push(0);
        arr[k] = aporte[F];
      });
    });
    var placements = [];
    porComp.forEach(function (pls) { if (pls && pls.length) placements = placements.concat(pls); });
    // ETAPA DE DEPENDENCIAS/RETRANQUEO — DESPUÉS de expandir. Aplica el offset al
    // anchor (traslada la barra completa hacia el núcleo) y acorta las patas que
    // la figura declare en el catálogo.
    // Sin prioridades = no-op → generarViga base queda IDÉNTICA.
    resolverDependencias(placements);
    // FIGURA vs CATÁLOGO — una revisión por COMPONENTE (no por barra: el aviso es
    // del componente y se repetiría 40 veces). Un componente con figura fuera del
    // catálogo NO aporta barras: se dibuja en el 3D (lo que el motor sepa) pero
    // no ensucia el despiece con un payload de 0 kg.
    var barrasSueltas = [];
    plan.forEach(function (p) {
      var pls = porComp[p.ci];
      if (!pls || !pls.length) return;
      if (!_revisarFiguraComp(p.comp, p.rol)) {
        pls.forEach(function (pl) { pl._sinPayload = true; });
        return;
      }
      pls.forEach(function (pl) {
        var b = placementABarra(pl, ctx);
        if (b) barrasSueltas.push(b); else pl._sinPayload = true;
      });
    });
    // Barras AGRUPADAS por item/etiqueta (cant = N) — lo que se carga al despiece.
    var barras = agruparBarras(barrasSueltas, !!ctx.trazarOrigen);

    // Resumen (stats en vivo) — kg estimado en el front (NO se envía).
    var totalBarrasFisicas = 0, totalKg = 0;
    barras.forEach(function (b) {
      var dimsLetras = {};
      LETRAS.forEach(function (L) { var v = b['dim_' + L.toLowerCase()]; if (v != null) dimsLetras[L] = v; });
      var largo = largoEstimado(b.figura, dimsLetras);
      var pu = pesoUnitarioEstimado(b.diam, largo);
      var cantTotal = (b.cant || 0) * (b.mult || 1);
      b._largoEstimado = largo;
      b._pesoEstimado = (pu != null) ? pu * cantTotal : null;
      totalBarrasFisicas += cantTotal;
      if (pu != null) totalKg += pu * cantTotal;
    });

    return {
      placements: placements,
      barras: barras,
      resumen: {
        items: barras.length,
        barras: totalBarrasFisicas,
        kg: Math.round(totalKg * 10) / 10
      }
    };
  }

  // El generador NO es de vigas: el host es una CAJA (largo/alto/ancho + recub por
  // cara) y todo lo específico del elemento vive en la receta (qué componentes, con
  // qué cara, orientación y distribución). Un MURO 400×250×20 entra tal cual —
  // largo→x, alto→y, espesor→ancho(z), recub_caras→recub_lat, recub_bordes→
  // recub_sup/inf — y sale con sus cortinas, su malla y sus trabas
  // (tests/test_muro_orientaciones.js). `generarElemento` es el MISMO generador con
  // el nombre honesto; `generarViga` se conserva porque lo llaman el editor y los
  // tests.
  var generarElemento = generarViga;

  var API = {
    // Spec de UNA figura del catálogo vigente (null si no existe). Es lo que hay
    // que usar; `FIGURAS` queda como acceso al mapa completo por compatibilidad
    // (lo lee panel_3d.js) y ahora son las 63 del catálogo, no 5 a mano.
    specFigura: specFigura,
    generarViga: generarViga,
    generarElemento: generarElemento,
    resolverDependencias: resolverDependencias,
    placementABarra: placementABarra,
    agruparBarras: agruparBarras,
    pesoUnitarioEstimado: pesoUnitarioEstimado,
    largoEstimado: largoEstimado
  };

  // FIGURAS: mapa completo del catálogo VIGENTE. Getter (no una copia) para que
  // siga siendo la verdad después de ModeladorCatalogoFiguras.actualizar(data) y
  // aunque catalogo_figuras.js cargue después que este archivo.
  try {
    Object.defineProperty(API, 'FIGURAS', {
      enumerable: true,
      get: function () { var c = _cat(); return c ? c.FIGURAS : {}; }
    });
  } catch (e) { API.FIGURAS = (_cat() || {}).FIGURAS || {}; }

  global.ModeladorGenerar = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
