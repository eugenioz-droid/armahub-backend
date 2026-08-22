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
  //
  // ===========================================================================
  // NORMALIZADOR DE APERTURA — QUE UNA RECETA VIEJA ABRA COMPLETA
  // ===========================================================================
  // El motor fue GANANDO campos (pose, tramos del rango, modo de uso, niveles de
  // jerarquía 1-based, dims {modo,valor}) y las recetas guardadas hace semanas no
  // los traen. Hasta acá cada consumidor los derivaba SOBRE LA MARCHA y cada uno a
  // su manera: `_dimsEfectivas` leía `comp.dims` crudo (y una dim escrita como
  // NÚMERO PLANO —el shape del enfierrador— caía en la rama 'auto', o sea el valor
  // que el usuario había fijado se PERDÍA en silencio); `expandirComponente` leía
  // `comp.distribucion` crudo (sin `modo` no despacha a ningún distribuidor y el
  // componente sale con CERO barras, sin decir por qué); y la jerarquía la
  // recalculaba cada llamador con su propio default.
  //
  // Acá se cierra en UN punto: normalizarComponente es el normalizador COMPLETO.
  // Todo componente pasa por él (expandirComponente lo llama primero), así que
  // después de él el motor ve SIEMPRE el mismo shape, venga la receta de cuando
  // venga.
  //
  // TRES REGLAS, y ninguna se salta:
  //
  // 1) NO SE INVENTA NADA. Cada campo que falta se DERIVA de lo que la receta YA
  //    decía (la tipología, la figura, la cara vieja, la forma de la distribución)
  //    o no se deriva. Lo que no se puede derivar honestamente se DEJA COMO ESTÁ y
  //    se MARCA — nunca se rellena con un valor plausible (regla de oro del
  //    proyecto: una defensa que enmascara convierte un dato malo en un dibujo
  //    creíble y equivocado).
  //
  // 2) NO SE REESCRIBE LA RECETA. La vista canónica se PUBLICA en campos NO
  //    enumerables (`_dims`, `_dist`, `_jerarquia`, `_pose`, `_migracion`),
  //    recalculados en cada pasada. Tres motivos, los tres medidos:
  //      · el ENFIERRADOR MVP guarda en la MISMA tabla templates_catalogo con otro
  //        shape (dims numéricas planas). Convertirlas a {modo,valor} dentro de la
  //        receta haría que abrir su template en el Template Editor y guardarlo
  //        se lo rompiera. Entenderlo no obliga a reescribirlo;
  //      · la receta se serializa entera al guardar (params) y se compara con
  //        JSON.stringify para el dirty-tracking: un campo derivado la ensuciaría y
  //        el editor pediría guardar por algo que el usuario no tocó;
  //      · un campo derivado ESTAMPADO deja sordo al campo viejo del que salió (es
  //        la razón, ya documentada abajo, por la que `orientacion` y `pose`
  //        tampoco se estampan): al recalcularse en cada pasada, cambiar el campo
  //        viejo sigue teniendo efecto.
  //    Los ÚNICOS campos enumerables que se rellenan son los que ya se rellenaban
  //    antes de esta tanda (comp_id / prioridad / empalme / depende_de / modo /
  //    lado / plano_pieza / arreglo): son defaults INERTES y la UI y los tests
  //    dependen de que estén.
  //
  // 3) IDEMPOTENTE POR CONSTRUCCIÓN. La vista canónica no se lee de sí misma: se
  //    recalcula siempre desde la declaración enumerable, así que aplicarlo dos
  //    veces da exactamente lo mismo (lo verifica tests/test_normalizador.js
  //    comparando el JSON de la receta y el de los placements).
  //
  // TABLA — campo ausente → de dónde se deriva:
  //   comp_id/prioridad/empalme/depende_de → null (no participan)
  //   modo            → preset por TIPOLOGÍA (TIPOLOGIA_MODO_DEFAULT, o el rol)
  //   lado            → +1 (z+), y −1 sólo si el valor declarado es negativo
  //   plano_pieza     → { volteado:false }; `orientacion` NO se estampa
  //   arreglo         → { n_capas:1, sep_capas:20, rango:null }
  //   pose            → de CARA + ORIENTACIÓN viejas (poseDe: cara local +
  //                     permutación → cara del mundo). Publicada en `_pose`.
  //   jerarquia       → nivel DECLARADO canonizado (0-based viejo: 0 → 1) o, sin
  //                     declarar, el default del ROL (JER_DEFAULT_POR_ROL = 1 desde
  //                     el 13-ago). Publicada en `_jerarquia` {declarada,efectiva,rol}
  //   dims.X          → número plano (enfierrador) → {modo:'fija',valor}
  //                     {valor} sin modo            → {modo:'fija',valor}
  //                     parcial de la figura sin declarar → {modo:'auto'}
  //                     (sólo con la figura EN el catálogo: sin spec no hay de dónde)
  //   distribucion.modo → 'linear' si trae zonas · 'layered' si trae capas · si no,
  //                     el MODO DE USO del componente (puntual→layered,
  //                     lineal→linear, arreglo→arreglo), que es la misma
  //                     materialización que hace el panel
  //   rango.tramos    → NO se deriva: sin tramos el rango es de @ ÚNICO (rama A de
  //                     posicionesRango), que es lo que la receta vieja quería
  //   rango.eje       → NO se deriva: ausente significa "el eje que la pieza
  //                     recorre" (la x LOCAL) y eso ya lo resuelve la permutación
  //                     de la pose. Estamparlo como eje del MUNDO lo congelaría y
  //                     al girar la pieza el rango apuntaría al eje de antes.
  //
  // LO QUE NO SE PUEDE DERIVAR SE DICE (`_migracion.avisos` → `comp._avisos`, que
  // es el canal que la barra de estado del editor ya muestra en rojo):
  //   · figura que el catálogo vigente YA NO TIENE → marcada `figura_desconocida`;
  //     el motor no puede completar sus dims ni su lado dominante;
  //   · dim que dice 'fija' sin valor numérico, o que no es un número;
  //   · dim que la figura no usa (la receta cambió de figura y quedó huérfana);
  //   · componente sin distribución, o con una que no coloca ninguna barra;
  //   · orientación / rumbo escritos con un valor que no existe.
  // Lo RUTINARIO (un default que se aplica porque el campo nunca se declaró) NO va
  // por ahí: va a `_migracion.derivados`, que es trazabilidad, no una alarma.
  // ---------------------------------------------------------------------------

  // Publica un campo DERIVADO: no enumerable (no ensucia la receta que se guarda ni
  // el dirty-tracking) y reescribible (se recalcula en cada pasada).
  function _publicar(comp, nombre, valor) {
    try {
      Object.defineProperty(comp, nombre,
        { value: valor, enumerable: false, writable: true, configurable: true });
    } catch (e) {
      try { comp[nombre] = valor; } catch (e2) { /* objeto sellado: se usa el devuelto */ }
    }
    return valor;
  }

  function _migracionNueva() {
    return { derivados: [], avisos: [], figura_desconocida: false };
  }
  // Trazabilidad de una derivación RUTINARIA (no es un problema: es "de dónde salió").
  function _derivado(mig, campo, de) {
    if (!mig) return;
    var t = campo + ' ← ' + de;
    if (mig.derivados.indexOf(t) < 0) mig.derivados.push(t);
  }
  // Lo que NO se pudo derivar: viaja a comp._avisos y la UI lo muestra.
  function _problema(mig, msg) {
    if (!mig || !msg) return;
    if (mig.avisos.indexOf(msg) < 0) mig.avisos.push(msg);
  }

  function _numFinito(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // Spec de la figura del componente (null = no está en el catálogo vigente).
  function _specDe(comp) {
    var cat = _cat();
    return cat ? cat.get(comp && comp.figura) : null;
  }

  // UNA dim declarada → {modo:'fija',valor} | {modo:'auto'} | null (= no se puede
  // canonizar: se deja EXACTAMENTE como vino y el llamador ya avisó).
  //
  // Δ POR DIMENSIÓN (14-ago) — el shape crece a
  //   { modo, valor, delta:number|null, extremo:'ini'|'fin' }
  // y `_dimCanon` lo PRESERVA en la vista canónica en vez de recortarlo. Sin esto
  // el Δ moría acá: `_dimsEfectivas` lee la CANÓNICA, no `comp.dims` crudo, así
  // que un campo que no se copie simplemente no existe para el motor (es la misma
  // causa por la que un número plano del enfierrador se resolvía como 'auto').
  // delta ausente / null / 0 = no se escribe ningún campo → la dim canónica queda
  // BYTE-IDÉNTICA a la de antes de esta tanda.
  function _dimCanon(letra, decl, mig) {
    var res = _dimCanonModo(letra, decl, mig);
    if (!res || typeof res !== 'object') return res;
    res = _deltaCanon(letra, decl, res, mig);
    // EXTREMO DE UNA MEDIDA FIJA (21-ago). `_deltaCanon` sólo conserva `extremo`
    // cuando hay Δ, porque hasta hoy el extremo describía por dónde CRECÍA el Δ.
    // Ahora el tirador del marco escribe la medida como FIJA, y esa medida también
    // se carga a un borde (el estribo de confinamiento se achica y se pega a un
    // costado): sin este rescate el extremo moría en la vista canónica y el marco
    // volvía a crecer/achicar CENTRADO, deshaciendo el gesto.
    // Sólo en 'fija': en un lado 'auto' sin Δ el extremo no describe nada y
    // escribirlo cambiaría la canónica de recetas que hoy no lo usan.
    if (res.modo === 'fija' && res.extremo == null && decl && typeof decl === 'object') {
      var exF = String(decl.extremo == null ? '' : decl.extremo).toLowerCase().trim();
      if (exF === 'ini' || exF === 'inicio') res.extremo = 'ini';
      else if (exF === 'fin') res.extremo = 'fin';
      else if (exF === 'centro') res.extremo = 'centro';
    }
    return res;
  }

  // Δ de UNA dim → se agrega al objeto canónico `out` (y se devuelve `out`).
  // El Δ es INDEPENDIENTE del modo: se puede extender tanto un lado 'auto' (que el
  // motor resolvió contra el hormigón) como uno 'fija' (que escribió el usuario).
  // Un Δ ilegible NO se adivina ni se pone en 0 en silencio: se avisa y se ignora.
  function _deltaCanon(letra, decl, out, mig) {
    if (!decl || typeof decl !== 'object') return out;
    if (decl.delta == null || decl.delta === '') return out;
    var d = _numFinito(decl.delta);
    if (d == null) {
      _problema(mig, 'La dim ' + letra + ' trae Δ "' + decl.delta + '", que no es un ' +
        'número: se ignora (el lado queda con su medida resuelta).');
      return out;
    }
    if (d === 0) return out;              // Δ 0 = sin Δ: nada que escribir
    out.delta = d;
    // EXTREMO por el que se DESARROLLA el cambio. Default 'fin' porque es el
    // sentido natural del trazado: `_cadena2D` recorre la figura del primer tramo
    // al último, o sea alargar un lado empuja el vértice de LLEGADA y el resto de
    // la cadena lo acompaña. 'ini' es la lectura espejo (empuja el de SALIDA).
    var ex = String(decl.extremo == null ? '' : decl.extremo).toLowerCase().trim();
    // 'centro' es un valor de PRIMERA CLASE (15-ago): en un contorno CERRADO el Δ
    // crece simétrico salvo que el usuario lo cargue a un borde, así que hay tres
    // estados y no dos. En una figura abierta 'centro' no significa nada y el
    // consumidor lo lee como el default de siempre ('fin').
    out.extremo = (ex === 'ini' || ex === 'inicio') ? 'ini'
      : (ex === 'centro' ? 'centro' : 'fin');
    return out;
  }

  function _dimCanonModo(letra, decl, mig) {
    if (typeof decl === 'number' || typeof decl === 'string') {
      // SHAPE DEL ENFIERRADOR: la dim es el número pelado. Hasta acá caía en la
      // rama 'auto' de _dimsEfectivas (`decl.modo` no existe en un número) y el
      // valor que el usuario había fijado se perdía sin un solo aviso — medido:
      // un 103B con dims {A:30,B:500,C:30} resolvía A = C = 9.6 (el gancho
      // normativo) y B contra el largo útil.
      var n = _numFinito(decl);
      if (n != null) {
        _derivado(mig, 'dims.' + letra, 'número plano ' + n + ' → {modo:fija}');
        return { modo: 'fija', valor: n };
      }
      _problema(mig, 'La dim ' + letra + ' vale "' + decl + '", que no es un número: ' +
        'el motor no puede resolverla y la deja como está.');
      return null;
    }
    if (!decl || typeof decl !== 'object') return null;
    var modo = String(decl.modo == null ? '' : decl.modo).toLowerCase().trim();
    var val = _numFinito(decl.valor);
    if (modo === 'auto') return { modo: 'auto' };
    if (modo === 'fija') {
      if (val != null) return { modo: 'fija', valor: val };
      // 'fija' sin número NO se convierte a 'auto': el usuario pidió una medida
      // concreta y el motor no sabe cuál. Inventarle el auto sería dibujar una
      // barra que nadie pidió con un largo que nadie eligió.
      _problema(mig, 'La dim ' + letra + ' está en Fija pero no tiene valor: ' +
        'no se puede derivar (elige un valor o ponla en Auto).');
      return null;
    }
    if (val != null) {                       // {valor: 30} sin modo
      _derivado(mig, 'dims.' + letra, 'valor ' + val + ' sin modo → {modo:fija}');
      return { modo: 'fija', valor: val };
    }
    return { modo: 'auto' };                 // sin modo y sin valor = auto (lo de siempre)
  }

  // Mapa de dims CANÓNICO del componente. Lo consume _dimsEfectivas.
  function _dimsCanon(comp, mig) {
    var g = (comp && comp.dims && typeof comp.dims === 'object') ? comp.dims : {};
    var out = {}, k;
    for (k in g) {
      if (!Object.prototype.hasOwnProperty.call(g, k)) continue;
      // DIM DECLARADA EN NULL = dim NO declarada. No se copia a la vista canónica:
      // así cae en el default 'auto' del bucle de parciales de más abajo (con su
      // línea en `derivados`). Antes el null viajaba TAL CUAL y el lado salía
      // AUSENTE del placement — medido: una 103B con dims.B = null generaba la barra
      // con {A, C} y sin B, que es exactamente el payload que el despiece rechaza.
      if (g[k] == null) continue;
      var c = _dimCanon(k, g[k], mig);
      out[k] = (c != null) ? c : g[k];       // lo indescifrable viaja TAL CUAL
    }
    var spec = _specDe(comp);
    if (!spec) return out;                   // sin catálogo no hay de dónde derivar
    var i, L;
    // Parciales que la FIGURA usa y la receta no declara: sin ellos _dimsEfectivas
    // ni siquiera los recorre → el payload va con dim_x = null (el backend lo
    // rechaza) y el trazado se dibuja con el lado en NaN. 'auto' es el default
    // documentado de una dim y es lo que escribe el editor al elegir la figura.
    for (i = 0; i < spec.parciales.length; i++) {
      L = spec.parciales[i];
      if (Object.prototype.hasOwnProperty.call(out, L)) continue;
      out[L] = { modo: 'auto' };
      _derivado(mig, 'dims.' + L, 'parcial de ' + spec.codigo + ' sin declarar → {modo:auto}');
    }
    // …y al revés: dims que la figura NO usa (la receta cambió de figura y quedó la
    // letra huérfana). No se borran —son dato del usuario— pero se dicen: no se
    // dibujan ni viajan al despiece (generar.js sólo escribe los parciales del spec).
    for (k in out) {
      if (!Object.prototype.hasOwnProperty.call(out, k)) continue;
      if (spec.parciales.indexOf(k) < 0) {
        _problema(mig, 'La receta trae la dim ' + k + ', que la figura ' + spec.codigo +
          ' no usa: no se dibuja ni viaja al despiece.');
      }
    }
    return out;
  }

  // MODO DE USO → modo de DISTRIBUCIÓN. Es la misma materialización que hace el
  // panel (ver _despachar): 'puntual' se coloca en capas, 'lineal' se reparte a lo
  // largo, 'arreglo' es rango × capas.
  var MODO_A_DIST = { puntual: 'layered', lineal: 'linear', arreglo: 'arreglo' };
  var MODOS_DIST = ['linear', 'layered', 'arreglo', 'grid', 'perimeter', 'points'];

  // Distribución CANÓNICA. Devuelve el MISMO objeto cuando ya lo está (caso normal:
  // ni una copia por pasada); un clon superficial cuando hay que completar `modo`.
  function _distCanon(comp, mig) {
    var d = comp && comp.distribucion;
    if (!d || typeof d !== 'object') {
      _problema(mig, 'Este componente no declara distribución: el motor no sabe ' +
        'cuántas barras colocar ni dónde, así que no genera ninguna.');
      return {};
    }
    var modo = String(d.modo == null ? '' : d.modo).toLowerCase().trim();
    var conocido = (MODOS_DIST.indexOf(modo) >= 0);
    var out = d;
    if (!conocido || modo !== d.modo) {
      out = {};
      for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = d[k];
      if (conocido) {
        out.modo = modo;                     // 'LINEAR' / ' linear ' escritos a mano
        _derivado(mig, 'distribucion.modo', '"' + d.modo + '" normalizado a ' + modo);
      } else {
        // De la FORMA de la distribución (lo que la receta ya decía) y, si no dice
        // nada, del MODO DE USO del componente. Sin esto el switch de _despachar
        // cae en `default` y el componente sale con CERO barras, en silencio.
        var der = (d.zonas && d.zonas.length) ? 'linear'
          : ((d.n_capas != null || d.barras_capa != null) ? 'layered'
            : (MODO_A_DIST[comp.modo] || null));
        if (der) {
          out.modo = der;
          _derivado(mig, 'distribucion.modo', (d.modo == null ? 'ausente' : '"' + d.modo + '"') +
            ' → ' + der + ((d.zonas && d.zonas.length) ? ' (trae zonas)'
              : ((d.n_capas != null || d.barras_capa != null) ? ' (trae capas)'
                : ' (modo de uso ' + comp.modo + ')')));
        } else {
          _problema(mig, 'La distribución no dice de qué modo se coloca la barra ' +
            'y no hay de dónde deducirlo: este componente no genera barras.');
        }
      }
    }
    // Un reparto que no reparte NADA: se dice acá, en la apertura, en vez de dejar
    // al usuario contando cero barras sin motivo.
    if (out.modo === 'linear' && !(out.zonas && out.zonas.length)) {
      if (!out.rango) {
        _problema(mig, 'La distribución lineal no trae ni zonas ni rango: no coloca ' +
          'ninguna barra.');
      } else if (out.rango.from == null || out.rango.to == null) {
        _problema(mig, 'El rango no dice desde/hasta: no coloca ninguna barra.');
      }
    }
    return out;
  }

  // Jerarquía CANÓNICA: { declarada, efectiva, rol }. `declarada` es lo que gobierna
  // las dims 'auto' (sin declarar se siguen midiendo al recubrimiento) y `efectiva`
  // lo que gobierna el ANCLAJE — la MISMA distinción de siempre, ahora resuelta en
  // un solo sitio en vez de en cada llamador.
  function _jerarquiaCanon(comp, mig) {
    var rol = _rolDeTipologia(comp && comp.tipologia, comp && comp.cara);
    var decl = nivelJerarquia(comp && comp.jerarquia);
    var ef = nivelJerarquiaEfectivo(comp && comp.jerarquia, rol);
    if (decl == null) {
      // OJO — el default CAMBIÓ el 13-ago (traba/cabezal nacían en 2). Una receta
      // que no declara nivel se abre HOY en 1: es una decisión del usuario, no un
      // olvido, así que no se resucita el 2 viejo. Queda anotado de dónde salió.
      _derivado(mig, 'jerarquia', 'no declarada → nivel ' + ef + ' (default del rol ' + rol + ')');
    } else if (comp.jerarquia !== decl && decl !== 'no') {
      _derivado(mig, 'jerarquia', 'nivel ' + comp.jerarquia + ' (0-based viejo) → ' + decl);
    }
    return { declarada: decl, efectiva: ef, rol: rol };
  }

  // Vistas canónicas para los consumidores. Si el componente ya pasó por el
  // normalizador se usa lo publicado; si no, se calcula al vuelo (misma cuenta, sin
  // marcas) para que ninguna ruta dependa del ORDEN de las llamadas.
  function _dimsDecl(comp) {
    if (comp && comp._dims) return comp._dims;
    return _dimsCanon(comp, null);
  }
  function _distDe(comp) {
    if (comp && comp._dist) return comp._dist;
    return _distCanon(comp, null);
  }
  function jerarquiaDe(comp) {
    if (comp && comp._jerarquia) return comp._jerarquia;
    return _jerarquiaCanon(comp, null);
  }

  // ---------------------------------------------------------------------------
  // Δ POR DIMENSIÓN, EFECTIVOS — CON LOS PARES ESPEJO YA REPLICADOS
  // ---------------------------------------------------------------------------
  // Fuente ÚNICA del Δ de cada lado: la consultan _dimsEfectivas (que lo suma al
  // largo) y _baseDeComponente (que decide por qué punta asoma). La UI la lee para
  // pintar el par que se mueve junto.
  //
  // PARES ESPEJO: en una figura CERRADA los lados opuestos miden LO MISMO —el alto
  // de un estribo lo miden B y D—, así que un Δ en uno solo no da "un estribo más
  // alto": da un cuadrilátero que NO CIERRA, una barra que el taller no puede
  // doblar. Por eso el Δ se REPLICA en el par. Quién es el par de quién lo deriva
  // figura_puntos.paresEspejoFigura de la GEOMETRÍA del contorno, no una tabla por
  // código de figura (el catálogo es data del backend: una tabla se quedaría vieja
  // en cuanto entre una figura nueva).
  //
  // EL Δ EXPLÍCITO GANA. Si el usuario escribió Δ en los DOS lados del par, se
  // respetan los dos tal cual: la réplica es una AYUDA para el caso normal, no una
  // regla que pise lo que el usuario escribió a mano (aunque el resultado no
  // cierre — eso es dato honesto y se ve).
  // Devuelve { LETRA: { delta, extremo, origen:'propio'|'espejo', de } }.
  function _deltasEfectivos(comp) {
    var g = _dimsDecl(comp), out = {}, k, d;
    for (k in g) {
      if (!Object.prototype.hasOwnProperty.call(g, k)) continue;
      d = g[k];
      if (!d || typeof d !== 'object' || !d.delta) continue;
      out[k] = { delta: Number(d.delta), extremo: (d.extremo === 'ini') ? 'ini' : (d.extremo === 'centro' ? 'centro' : 'fin'),
        origen: 'propio', de: null };
    }
    var fp = _fp();
    var pares = (fp && fp.paresEspejoFigura) ? fp.paresEspejoFigura(comp && comp.figura) : null;
    if (!pares) return out;
    // Snapshot de las claves PROPIAS: la réplica no puede encadenarse (si B copia a
    // D, D no puede volver a copiar a B y duplicar el efecto).
    Object.keys(out).forEach(function (L) {
      var P = pares[L];
      if (!P || out[P]) return;          // sin par, o el par ya trae el SUYO
      out[P] = { delta: out[L].delta, extremo: out[L].extremo, origen: 'espejo', de: L };
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // MEDIDA FIJA DE UN LADO DEL MARCO, REPLICADA EN SU PAR ESPEJO
  // ---------------------------------------------------------------------------
  // La hermana de _deltasEfectivos para el número ESCRITO, y por la misma razón:
  // en un contorno CERRADO los lados opuestos son la MISMA medida vista dos veces
  // (el alto de un estribo lo miden B y D). Un Δ ya se replicaba; una medida fija
  // no, porque hasta hoy no llegaba al trazo (se listaba y se cortaba, y el marco
  // seguía saliendo del hormigón). Desde que el tirador del marco escribe MEDIDA
  // —«que mida esto», no «tanto menos de lo que dé el hormigón»— la fija sí manda
  // el marco, así que sin réplica el cuadrilátero dejaría de cerrar: el lado
  // dibujado mediría lo escrito y su opuesto seguiría listando el 'auto'.
  //
  // SÓLO LOS LADOS DEL MARCO de una pieza de SECCIÓN (ejesMarcoSeccion → 'u'/'v').
  // Es donde vive la obligación de cerrar y donde el marco deriva su forma; en una
  // cadena (305A) o en un longitudinal cada lado se dibuja de SU dim y replicar
  // inventaría una medida que el usuario no escribió.
  //
  // LO QUE SE REPLICA ES EL CRECIMIENTO, NO EL NÚMERO. En la 104D los dos lados
  // del par miden lo mismo en 'auto' y da igual, pero en la 106A no: el ancho lo
  // miden C y E y sus 'auto' valen 19 y 24 (uno está recortado por el gancho).
  // Copiando el NÚMERO, fijar C = 25 dejaba a E pidiendo un marco 6 cm más ancho y
  // a C pidiéndolo 1 cm más ancho — el propio motor lo cazaba con «Δ distintos en
  // los dos lados que miden el mismo ancho: el contorno no cierra». Copiando el
  // CRECIMIENTO los dos empujan el marco lo mismo y el contorno cierra, que es
  // exactamente lo que hace la réplica del Δ.
  //
  // EL NÚMERO EXPLÍCITO GANA, igual que en el Δ: si el usuario escribió medida en
  // los DOS lados del par se respetan las dos tal cual (y el marco avisa que no
  // cierra). Devuelve SÓLO los lados que RECIBEN la réplica → { LETRA: {de} }.
  function _fijasEspejo(comp) {
    var out = {};
    if (!comp || comp._rol !== 'estribo') return out;
    var fp = _fp();
    if (!fp || !fp.ejesMarcoSeccion || !fp.paresEspejoFigura) return out;
    var ejes = fp.ejesMarcoSeccion(comp.figura, comp._rol);
    if (!ejes) return out;
    var pares = fp.paresEspejoFigura(comp.figura);
    if (!pares) return out;
    var g = _dimsDecl(comp), k, d, P, dP;
    for (k in g) {
      if (!Object.prototype.hasOwnProperty.call(g, k)) continue;
      if (ejes[k] !== 'u' && ejes[k] !== 'v') continue;   // gancho: no mide el marco
      d = g[k];
      if (!d || d.modo !== 'fija' || !isFinite(Number(d.valor))) continue;
      P = pares[k];
      if (!P || ejes[P] !== ejes[k] || out[P]) continue;  // sin par, o par de otro eje
      dP = g[P];
      if (dP && dP.modo === 'fija') continue;             // el par trae la SUYA
      out[P] = { de: k };
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // ÁNGULO POR BARRA — comp.angulos MANDA sobre el catálogo
  // ---------------------------------------------------------------------------
  // `comp.angulos` es un campo que la receta YA traía (la viga-semilla lo escribe
  // desde su primera versión) y que hasta hoy NO LEÍA NADIE: el trazado derivaba los
  // giros de `spec.angulos` y generar.js escribía ang1..ang4 desde el spec también.
  // O sea que el ángulo del componente era decorativo — se guardaba y no llegaba ni
  // al dibujo ni al despiece.
  //
  // Devuelve el array EFECTIVO (catálogo + overrides válidos) SÓLO cuando cambia
  // algo, y null cuando no. Ese null es lo que garantiza la no-regresión: sin cambio
  // efectivo no se escribe el canal y todas las rutas quedan las de siempre, byte por
  // byte (la semilla declara exactamente los ángulos de su catálogo, así que sigue
  // valiendo null). El aviso de un override inválido lo emite _baseDeComponente una
  // sola vez por componente, no esta función — que se llama por cada capa y por cada
  // re-resolución de dims (mismo criterio que _domElegido).
  function _angOvr(comp) {
    var fp = _fp();
    if (!fp || !fp.angulosCambian || !comp) return null;
    if (!fp.angulosCambian(comp.figura, comp.angulos)) return null;
    return fp.angulosEfectivos(comp.figura, comp.angulos);
  }

  // LADO DOMINANTE ELEGIDO por el componente, YA VALIDADO (o null si no hay
  // elección o la que hay no sirve). Sin canal de avisos a propósito: el aviso lo
  // emite _baseDeComponente una sola vez por componente — si lo emitiera esta
  // función saldría repetido por cada capa y cada re-resolución de dims.
  function _domElegido(comp) {
    var v = comp && comp.lado_dominante;
    if (v == null || String(v).trim() === '') return null;
    var fp = _fp();
    if (!fp || !fp.validarLadoDominante) return null;
    var r = fp.validarLadoDominante(comp.figura, v);
    return r.ok ? r.lado : null;
  }

  function normalizarComponente(comp) {
    // MIGRACIÓN TRABAS (14-ago, Modelo A): el rol 'traba' murió en el motor — una
    // figura ABIERTA bajo TR/TC/TRV es un longitudinal y su dominante ESTIRA por
    // donde corre. Las recetas viejas no traen pose (rumbo x implícito): tal
    // cual, una TRV que cruzaba el alto pasaría a estirarse al LARGO (592 cm).
    // Se les escribe la pose que preserva su geometría de siempre: de_pie
    // (rumbo y, cruza el alto). Idempotente: solo sin pose ni orientación.
    if (comp && !comp.pose &&
        _rolDeTipologia(comp.tipologia, comp.cara) === 'traba') {
      var fpM = _fp();
      var cerradaM = !!(fpM && fpM.familiaDeDibujo &&
        fpM.familiaDeDibujo(comp.figura, null) === 'estribo');
      var oriM = comp.plano_pieza || {};
      if (!cerradaM && !oriM.volteado && comp.orientacion == null) {
        comp.pose = { cara: comp.cara || 'lateral', lado: (Number(comp.lado) < 0 ? -1 : 1),
          rumbo: 'y', espejo: !!comp.espejo };
        // …y sus ZONAS (que marchan por el x LOCAL, correcto para la pieza
        // acostada de antes) se convierten a RANGO con tramos en el eje MUNDO x:
        // mismo formato {long, sep}, mismas posiciones, pero pose-aware — sin
        // esto la traba de_pie repartía sus zonas contra el ALTO (medido:
        // semilla {4,59,133.5} en vez de {4,72,136.1}).
        var dz = comp.distribucion;
        // …un rango legado SIN eje marchaba por el x local: para la traba ahora
        // de_pie eso sería la ALTURA. Su intención era el largo del elemento.
        if (dz && dz.rango && !dz.rango.eje) dz.rango.eje = 'x';
        if (dz && (dz.modo === 'linear' || dz.modo === 'lineal') && dz.zonas && dz.zonas.length && !dz.rango) {
          var largoZ = 0;
          for (var zi2 = 0; zi2 < dz.zonas.length; zi2++) largoZ += Number(dz.zonas[zi2].long) || 0;
          var st2 = Number(dz.start_offset) || 0;
          var from2 = -largoZ / 2 + st2;
          var sep2 = Number(dz.zonas[0].sep) || 20;
          if (dz.zonas.length === 1) {
            // conversión EXACTA: las zonas colocan en from + k·sep MIENTRAS quepan
            // dentro del elemento (el borde capa); el rango cierra su intervalo.
            // `to` = la ÚLTIMA posición legada REAL, así salen las mismas barras.
            var topeZ = largoZ / 2 - st2;
            var nZ = Math.max(1, Math.floor((topeZ - from2) / sep2 + 1e-9) + 1);
            dz.rango = { eje: 'x', from: from2, to: from2 + (nZ - 1) * sep2, sep: sep2 };
          } else {
            dz.rango = { eje: 'x', from: from2, to: largoZ / 2 - st2, sep: sep2, tramos: dz.zonas };
          }
        }
      }
    }

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
    // Canal de MIGRACIÓN de esta pasada. Se crea de CERO cada vez (nunca se lee el
    // de la pasada anterior): por eso normalizar dos veces da lo mismo y por eso una
    // marca desaparece sola en cuanto el usuario arregla el dato.
    var mig = _migracionNueva();
    // FIGURA que el catálogo vigente ya no tiene. No explota —el componente se sigue
    // abriendo y dibujando lo que el motor sepa— pero queda MARCADO: sin spec no hay
    // parciales de dónde derivar dims ni lado dominante, y generar.js no emitirá
    // barra. Es exactamente el caso "la receta se guardó con una figura que después
    // se sacó del catálogo".
    if (_cat() && !_specDe(comp)) {
      mig.figura_desconocida = true;
      _problema(mig, 'Figura ' + (comp.figura ? comp.figura : '(vacía)') + ': no está en el ' +
        'catálogo vigente. La receta la conserva, pero el motor no puede completar ' +
        'sus dims ni su lado dominante y no se genera barra.');
    }
    // POSE CANÓNICA (TANDA P). Si el componente trae `pose` se NORMALIZA in place
    // (cara/rumbo válidos y ⊥); si no, se DERIVA de los campos viejos y se publica
    // en `comp._pose` — NO enumerable, recalculado en cada pasada, para que no
    // ensucie la receta que se guarda ni deje sorda a la UI vieja (ver poseDe).
    if (comp.pose && typeof comp.pose === 'object' &&
      (_caraCanon(comp.pose.cara) || _ejeCanon(comp.pose.rumbo))) {
      // SÓLO si la pose DICE algo. Antes se canonizaba cualquier objeto, y una
      // `pose:{}` (o una con basura) se rellenaba con el default sup/x — que
      // ENTIERRA los campos viejos: poseDe cae a `cara`/`orientacion` justo cuando
      // la pose no sirve, y a la pasada siguiente ya se encontraba una pose válida
      // inventada. Medido: {cara:'inf', pose:{}} abría en la cara SUPERIOR.
      var pn = normalizarPose(comp.pose);
      // AVISO DE RUMBO PARALELO — tiene que sobrevivir a NORMALIZAR DOS VECES.
      // La pose se canoniza IN PLACE (contrato viejo, ver más abajo), así que si el
      // aviso se calculara sólo comparando contra `comp.pose.rumbo` viviría UNA sola
      // pasada… y el editor normaliza DOS antes de leer los avisos
      // (normalizarReceta al abrir → _regenerar → expandirComponente → normalizar de
      // nuevo → recién ahí _avisarMigracion). Medido: el usuario NUNCA veía este
      // aviso, pero su receta SÍ quedaba reescrita (rumbo 'y' → 'x') en silencio.
      // Por eso el rumbo que el usuario DECLARÓ se RECUERDA en una marca no
      // enumerable sobre la propia pose: no viaja al JSON que se guarda (ni ensucia
      // el dirty-tracking) y se vuelve a decir en cada pasada mientras la pose siga
      // siendo la que se corrigió. Si la pose cambia (otra cara u otro rumbo), la
      // marca se borra: la corrección de antes ya no es cierta.
      var declarado = _ejeCanon(comp.pose.rumbo);
      var marca = comp.pose._rumboCorregido || null;
      if (declarado && declarado !== pn.rumbo) {
        marca = { de: comp.pose.rumbo, a: pn.rumbo, cara: pn.cara };   // 1ª pasada
        _publicar(comp.pose, '_rumboCorregido', marca);
      } else if (marca && (marca.a !== pn.rumbo || marca.cara !== pn.cara)) {
        marca = null;
        _publicar(comp.pose, '_rumboCorregido', null);
      }
      if (marca) {
        _problema(mig, 'La pose declara rumbo "' + marca.de + '", que es paralelo a la ' +
          'cara ' + marca.cara + ' (una pieza no corre en la dirección en la que se apoya): ' +
          'se usa el rumbo ' + marca.a + '.');
      }
      comp.pose.cara = pn.cara; comp.pose.lado = pn.lado;
      comp.pose.rumbo = pn.rumbo; comp.pose.espejo = pn.espejo;
    } else if (comp.pose && typeof comp.pose === 'object') {
      _derivado(mig, 'pose', 'la pose guardada no dice cara ni rumbo → se usan los ' +
        'campos viejos (cara/plano_pieza)');
    } else {
      _derivado(mig, 'pose', 'cara "' + (comp.cara || 'sup') + '" + orientación ' +
        _orientacionLegacy(comp));
    }
    // ORIENTACIÓN escrita con un valor que no existe: hoy cae en silencio al
    // `volteado` (o a 'acostada') y la pieza aparece en otro plano sin un error.
    var ppO = comp.plano_pieza && comp.plano_pieza.orientacion;
    if (ppO != null && !ORIENTACIONES.hasOwnProperty(String(ppO).toLowerCase().trim())) {
      _problema(mig, 'plano_pieza.orientacion "' + ppO + '" no existe (acostada | volteada | ' +
        'de_pie): se usa ' + _orientacionLegacy(comp) + '.');
    }
    var pEf = poseDe(comp);
    _publicar(comp, '_pose', pEf);
    // VISTAS CANÓNICAS — el shape que el motor de HOY espera, derivado de lo que la
    // receta ya decía. Se publican no enumerables (ver la nota de arriba: el
    // enfierrador guarda otro shape en la misma tabla y no se le toca la receta).
    _publicar(comp, '_jerarquia', _jerarquiaCanon(comp, mig));
    _publicar(comp, '_dims', _dimsCanon(comp, mig));
    _publicar(comp, '_dist', _distCanon(comp, mig));
    _publicar(comp, '_migracion', mig);
    return comp;
  }

  // Normaliza la receta ENTERA (lo que hace falta al ABRIR un template guardado).
  // Devuelve la MISMA receta (no clona: el editor trabaja sobre su objeto) para que
  // el llamador pueda encadenar. Los avisos de cada componente quedan en su
  // `_migracion` / `_avisos`.
  function normalizarReceta(receta) {
    if (!receta || typeof receta !== 'object') return receta;
    var comps = receta.componentes;
    if (Object.prototype.toString.call(comps) === '[object Array]') {
      for (var i = 0; i < comps.length; i++) normalizarComponente(comps[i]);
    }
    // ANCLAJE: la receta trae from/to (y pos_hint) en coordenadas absolutas. Se les
    // deriva su ancla contra la geometría CON LA QUE ABRE — nunca contra otra —, así
    // que el template no cambia ni de forma ni de kilos al abrirlo. Va DESPUÉS de
    // normalizarComponente porque ahí es donde una traba vieja convierte sus `zonas`
    // en el `rango` que hay que anclar.
    //
    // El `pos_ancla` no se toca acá: se identifica SOLO (ver `mide:'pos'` en la nota
    // del POS_HINT). Un ancla del 18-20 ago no lleva la marca, así que ningún lector
    // la acepta y el motor la re-deriva en la 1ª expansión — sin depender de que la
    // receta haya pasado por este normalizador.
    reanclarReceta(receta);
    return receta;
  }

  // Lo que el normalizador derivó y lo que no pudo, de un componente ya normalizado.
  function migracionDe(comp) {
    return (comp && comp._migracion) ? comp._migracion : null;
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
  // TODOS EN 1 (decisión del usuario 13-ago: "siempre deben venir en 1, el
  // usuario elige si las cambia"). Los defaults 2 de traba/cabezal eran una
  // suposición de viga (longitudinal dentro del estribo) que en el muro se veía
  // como un 2 inexplicable; las recetas que dependían de nacer en 2 (la
  // semilla-viga) lo declaran EXPLÍCITO y no se mueven.
  // MIGRACIÓN del viejo 0-based: cualquier número n ≥ 1 se lee como nivel
  // 1-based tal cual, y 0 (o negativo) se lee como 1 — que es exactamente lo que
  // significaba el viejo 0 ("pegado al recubrimiento y aporta φ").
  // (el nivel de partida es 1 para todos; la tabla por rol quedó constante y su
  // entrada 'traba' era resto del rol muerto — ver rolDeComponente)
  var JER_DEFAULT_POR_ROL = { estribo: 1, cabezal: 1 };

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
    return JER_DEFAULT_POR_ROL[rol || 'cabezal'] || 1;
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
      // TC/TR/TM cosen las dos CARAS del muro (z±): su cuerpo corre EN el
      // espesor, así que su plano tiene que CONTENER z — el plano de una pieza
      // de sección es ⊥ a su rumbo, o sea rumbo 'y' (sección horizontal, la
      // MISMA del EC al que acompañan) y se reparten en la altura, que es lo que
      // el rumbo también manda. La pose vieja {extremo, rumbo z} era imposible:
      // dejaba el plano de la pieza ⊥ al espesor que debía cruzar (medido: TC
      // 104B resolvía sus 4 dims al alto útil 244 y se dibujaba plana).
      TC: { cara: 'lateral', lado: 1, rumbo: 'y' },
      TR: { cara: 'lateral', lado: 1, rumbo: 'y' },
      TM: { cara: 'lateral', lado: 1, rumbo: 'y' },
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
  // ==========================================================================
  // EJE DE REPARTO = LA NORMAL DEL PLANO DE LA PIEZA — MEDIDA, no deducida.
  // ==========================================================================
  // REGLA (del usuario, una sola para todo): «la barra entra en el plano de la
  // vista donde clickeas y el reparto va por la NORMAL de ese plano» — nunca
  // dentro del plano, porque ahí las copias caerían una encima de otra.
  //
  // POR QUÉ SE MIDE Y NO SE DEDUCE (15-ago). El campo `rumbo` de la pose está
  // SOBRECARGADO: en una figura cerrada guarda la normal de su plano y en una
  // abierta la dirección en que la barra CORRE. Leer la regla desde ese campo
  // obliga a preguntar "¿cerrada o abierta?", y ese `if` ya mordió dos veces
  // (una 103C bajo TR pedía su rango sobre su propio eje → 1 sola barra). Acá se
  // TRAZA la pieza una vez y se mira en qué eje NO se desarrolla: ese es su plano
  // y esa es su normal. Sin topología, sin tipología, y vale igual para figuras
  // diagonales o ya rotadas — es geometría, no una tabla.
  //
  // BARRA RECTA: no tiene plano propio (dos ejes con desarrollo nulo). Ahí manda
  // el otro dato de su pose: la NORMAL DE SU CARA es por donde entran las capas,
  // así que el reparto va por el eje que queda. (Es el mismo resultado que daba
  // la regla del "tercer eje", ahora como consecuencia y no como caso aparte.)
  //
  // `host` es opcional sólo por compatibilidad de firma: sin él no se puede
  // trazar y se cae a la lectura del campo (lo que hacía antes).
  // Medición compartida por ejeDistribucion y normalDePieza: ejes LOCALES en los
  // que la pieza NO se desarrolla, trazándola en su marco local (que es donde el
  // trazador dibuja) con el host PERMUTADO; el llamador vuelve al MUNDO con
  // aMundo (la misma permutación involutiva de todo el motor — sin esa vuelta,
  // una cerrada de pie reportaba el eje de una acostada: 104D rumbo y → 'x').
  // "No se desarrolla" = menos del 2% de su propia extensión mayor (el φ y los
  // arcos dejan micro-espesor; un lado real nunca baja de ahí). null si no se
  // pudo trazar o la pieza no tiene extensión.
  function _ejesSinDesarrollo(comp, host) {
    if (!host || !comp || !comp.figura) return null;
    var P = _permDe(comp);
    var hostEf = P ? _hostPermutado(host, P) : host;   // sin permutación, el host va tal cual
    var base;
    try { base = _baseDeComponente(comp, hostEf); } catch (e) { return null; }
    var spans = {
      x: _spanEnEje(base, hostEf, 'x'),
      y: _spanEnEje(base, hostEf, 'y'),
      z: _spanEnEje(base, hostEf, 'z')
    };
    var mayor = Math.max(spans.x, spans.y, spans.z);
    if (!(mayor > 0)) return null;
    return {
      planos: ['x', 'y', 'z'].filter(function (e) { return spans[e] <= 0.02 * mayor; }),
      aMundo: function (ejeLocal) { return P ? P[ejeLocal] : ejeLocal; }
    };
  }

  function ejeDistribucion(comp, host) {
    var pose = poseDe(comp);
    var m = _ejesSinDesarrollo(comp, host);
    if (!m) return pose.rumbo;
    if (m.planos.length === 1) return m.aMundo(m.planos[0]);       // pieza plana: su normal
    if (m.planos.length === 2) {                                   // recta: manda su cara
      var caraLocal = derivarPose(pose).caraLocal;                 // 'sup'|'inf'|'lateral'
      var normalLocal = (caraLocal === 'lateral') ? 'z' : 'y';
      var libres = m.planos.filter(function (e) { return e !== normalLocal; });
      return m.aMundo(libres[0] || m.planos[0]);
    }
    return pose.rumbo;   // pieza que ocupa volumen en los 3 ejes: no hay plano que leer
  }

  // Normal del PLANO DE LA PIEZA en ejes del MUNDO (misma medición que
  // ejeDistribucion). Pieza plana → la normal medida de su plano; RECTA → la
  // normal de la CARA donde está apoyada; volumétrica → rumbo declarado.
  // La usa ESPACIO en el editor para girar la pieza EN SU PROPIO PLANO: antes
  // ESPACIO giraba con el eje de la VISTA ACTIVA y, con otra vista activa,
  // sacaba al estribo de su plano (reporte 17-ago).
  function normalDePieza(comp, host) {
    var pose = poseDe(comp);
    var m = _ejesSinDesarrollo(comp, host);
    if (!m) return pose.rumbo;
    if (m.planos.length === 1) return m.aMundo(m.planos[0]);
    if (m.planos.length === 2) {
      var caraLocal = derivarPose(pose).caraLocal;
      return m.aMundo(caraLocal === 'lateral' ? 'z' : 'y');
    }
    return pose.rumbo;
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
  // Recubrimiento de CADA lado de un eje (el sup y el inf pueden diferir). Es la
  // referencia del ancla de un rango: la zona util, no la caja de hormigon.
  function _recubLadosEje(host, e) {
    if (e === 'x') { var rx = _recubDeCara(host, 'ext'); return { min: rx, max: rx }; }
    if (e === 'z') { var rz = _recubDeCara(host, 'lat'); return { min: rz, max: rz }; }
    return { min: _recubDeCara(host, 'inf'), max: _recubDeCara(host, 'sup') };
  }

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
  // `rango2` (la 2ª línea de distribución del ARREGLO POR ÁREA) viaja por el MISMO
  // camino que `rango`: su `eje` también se declara en ejes del MUNDO y también hay
  // que traducirlo. Sin esto, un arreglo por área en una pieza volteada repartiría su
  // segunda línea sobre el eje de antes de girar — el mismo defecto que ya costó el
  // colapso de las N barras en un plano cuando `rango.eje` no se traducía.
  function _cfgLocal(dist, P) {
    if (!dist || !P) return dist;
    var tieneCapas = (dist.eje_capas != null);
    var tieneRango = !!(dist.rango && dist.rango.eje != null);
    var tieneRango2 = !!(dist.rango2 && dist.rango2.eje != null);
    if (!tieneCapas && !tieneRango && !tieneRango2) return dist;
    var c = {};
    for (var k in dist) if (dist.hasOwnProperty(k)) c[k] = dist[k];
    if (tieneCapas) c.eje_capas = P[String(dist.eje_capas)] || dist.eje_capas;
    if (tieneRango) c.rango = _rangoLocal(dist.rango, P);
    if (tieneRango2) c.rango2 = _rangoLocal(dist.rango2, P);
    return c;
  }

  // Clon de un rango con su `eje` traducido al marco local. CLON: la receta del
  // usuario no se muta nunca (el dirty-tracking del editor la compara entera).
  function _rangoLocal(rango, P) {
    var r = {};
    for (var j in rango) if (rango.hasOwnProperty(j)) r[j] = rango[j];
    r.eje = P[String(rango.eje)] || rango.eje;
    return r;
  }

  // ---------------------------------------------------------------------------
  // ANCLAJE POR DISTANCIA AL BORDE — la receta guarda la INTENCIÓN, no la coordenada
  // ---------------------------------------------------------------------------
  // POR QUÉ (medido 18-ago sobre un estribo recogido 40 cm de cada borde en una
  // viga de 600): al cambiar el hormigón, la distribución NO se movía.
  //   · viga 600 → 27 estribos, 40 cm de cada borde (lo dibujado);
  //   · viga 800 → 27 estribos, pero 140 cm de cada borde (el rango se quedó
  //     CONGELADO en ±260);
  //   · viga 400 → 27 estribos con 60 cm de fierro FUERA del hormigón por lado.
  // La causa: `rango.from/to` (y `pos_hint`) eran COORDENADAS ABSOLUTAS del host.
  // Las dims en `auto` sí seguían al hormigón porque declaran intención y el motor
  // las resuelve en cada generación; las posiciones nunca recibieron ese trato. Y un
  // template existe justamente para aplicarse a elementos de OTRAS medidas.
  //
  // LA REGLA (única, sin controles nuevos en el panel): la posición en la que está
  // el punto ES el ancla. Cada punto guarda su DISTANCIA AL BORDE MÁS CERCANO de su
  // eje y el motor resuelve la coordenada contra el host en cada generación.
  //
  // DOS REFERENCIAS: los dos bordes (−dim/2 y +dim/2). NADA MÁS.
  // Hubo una tercera —el CENTRO— entre el 18 y el 21-ago, y la retiró el usuario:
  // «veo que el ancla tome el centro como innecesario; cuando eso ocurra parecerá
  // más un error del programa que un ajuste pensado» · «no quiero que se ancle en el
  // centro. Definitivamente no queremos eso». Y tenía razón medida: un `to` en 140
  // sobre una viga de 600 caía a 140 del centro y a 160 del testero, así que al
  // pasar la viga a 800 el extremo se quedaba CLAVADO en 140 mientras el resto de la
  // distribución se estiraba — un punto que no sigue a nada visible. Con dos
  // referencias, ese mismo extremo declara 160 cm al testero y se va a 240: la
  // distancia que el usuario ve en pantalla es la que manda.
  // EMPATE (el punto justo en la mitad): manda `min`, el borde de origen del eje.
  //
  // SHAPE (persistido en la receta, una sola fuente de verdad):
  //   rango.ancla   = { ini:{ref:'min'|'max', d}, fin:{…} }   (d en cm)
  //   comp.pos_ancla = { x:{ref,d,mide:'pos'}, … }   (sólo los ejes con hint)
  // `from`/`to` y `pos_hint` SIGUEN existiendo y siguen siendo lo que el panel
  // muestra y edita, pero pasan a ser el valor DERIVADO: quien los escribe (arrastre
  // de handles, campos del rango, _syncN, _rangoDefault) re-deriva el ancla contra el
  // host actual por UN helper único (`anclarRango` / `anclarPosHint`), y quien los
  // lee para dibujar los recibe ya resueltos (`reanclarReceta`).
  //
  // MIGRACIÓN SIN MOVIMIENTO: una receta vieja no trae `ancla`. Se DERIVA de su
  // propio from/to contra el host CON EL QUE ABRE, así que resolverla devuelve
  // exactamente las mismas coordenadas → misma forma y mismos kilos. Es criterio de
  // aceptación, no un deseo (lo congela tests/test_anclaje_distribucion.js).
  // Un ancla vieja con ref 'centro' entra por esa MISMA puerta: `_anclaValida` ya no
  // la reconoce, así que se re-deriva de su propio from/to contra la geometría con
  // la que abre — cero movimiento al abrir, y desde ahí el punto sigue a su borde.
  var _EPS_ANCLA = 1e-6;

  // 6 decimales: el ida y vuelta coord → ancla → coord tiene que ser exacto a la
  // tolerancia con la que trabaja el reparto (_EPS_POS), no arrastrar ruido binario
  // que el dirty-tracking del editor leería como "cambió".
  function _r6(v) { return Math.round(Number(v) * 1e6) / 1e6; }

  // Dimensión del host sobre un eje (del marco en el que se está expandiendo).
  function _dimEje(host, eje) {
    if (!host) return NaN;
    if (eje === 'y') return Number(host.alto);
    if (eje === 'z') return Number(host.ancho);
    return Number(host.largo);
  }

  // Recubrimiento del BORDE 'min' (−dim/2) o 'max' (+dim/2) de un eje. Se pregunta a
  // `_recubDeCara`, que es la fuente única del recub por cara: en Y los dos bordes
  // son caras DISTINTAS (inf/sup) y pueden tener recubrimientos distintos.
  function _recubBordeEje(host, eje, ref) {
    if (eje === 'y') return _recubDeCara(host, (ref === 'min') ? 'inf' : 'sup');
    if (eje === 'z') return _recubDeCara(host, 'lat');
    return _recubDeCara(host, 'ext');
  }

  // COORDENADA → ANCLA. Devuelve { ref, d } con el BORDE más cercano.
  // `d` puede salir NEGATIVA y es un dato, no un error: un punto pasado del borde
  // declara cuánto asoma, y al cambiar el hormigón sigue asomando lo mismo (mentir
  // ahí sería moverle el fierro al usuario sin decírselo).
  // Sin dimensión de host NO se ancla (null): inventar una referencia sería guardar
  // una intención que nadie declaró. Quien llama ya sabe qué hacer con el null.
  // rMin/rMax (opcionales, 19-ago): recubrimiento de cada lado. Con ellos la distancia
  // se mide desde la LÍNEA DE RECUBRIMIENTO y no desde la cara del hormigón, que es lo
  // que el usuario espera de una distribución: «si modifico el recubrimiento no se me
  // ajusta el abanico; las dimensiones de la barra sí». El fierro vive en la zona útil,
  // así que su referencia es el borde de esa zona. Sin ellos (0) la cuenta es la de
  // antes, bit a bit — por eso el pos_hint, que se mide contra la cara, no cambia.
  function anclaDeCoord(coord, dim, rMin, rMax) {
    var c = Number(coord);
    if (!isFinite(c)) return null;
    var D = Number(dim);
    if (!isFinite(D) || D <= 0) return null;
    var a = -D / 2 + (Number(rMin) || 0), b = D / 2 - (Number(rMax) || 0);
    var dMin = Math.abs(c - a), dMax = Math.abs(b - c);
    if (dMax < dMin - _EPS_ANCLA) return { ref: 'max', d: _r6(b - c) };
    return { ref: 'min', d: _r6(c - a) };   // empate → el borde de origen
  }

  // ANCLA → COORDENADA contra un host de dimensión `dim`.
  function coordDeAncla(a, dim, rMin, rMax) {
    if (!a) return null;
    var D = Number(dim), d = Number(a.d) || 0;
    if (!isFinite(D)) return null;
    if (a.ref === 'min') return -D / 2 + (Number(rMin) || 0) + d;
    if (a.ref === 'max') return D / 2 - (Number(rMax) || 0) - d;
    return null;                                // ref desconocida (p.ej. un 'centro' viejo)
  }

  function _anclaValida(a) {
    return !!(a && (a.ref === 'min' || a.ref === 'max') && isFinite(Number(a.d)));
  }

  // ¿El rango ya declara su intención? (los dos extremos anclados)
  function _tieneAncla(rango) {
    var a = rango && rango.ancla;
    return !!(a && _anclaValida(a.ini) && _anclaValida(a.fin));
  }

  // ESCRITURA DEL ANCLA — helper ÚNICO. Todo el que escriba from/to pasa por acá: la
  // fórmula no se reparte en cinco sitios (arrastre de handles, campos del panel,
  // _syncN, _rangoDefault…). Idempotente; `forzar` re-deriva aunque ya hubiera ancla
  // (eso es lo que hace una edición del usuario: mueve la INTENCIÓN, no sólo el
  // número). MUTA el rango y devuelve el mismo objeto.
  function anclarRango(rango, host, eje, forzar) {
    if (!rango || rango.from == null || rango.to == null) return rango;
    if (!forzar && _tieneAncla(rango)) return rango;
    var D = _dimEje(host, eje || rango.eje || 'x');
    if (!isFinite(D) || D <= 0) return rango;
    var rl = _recubLadosEje(host, eje || rango.eje || 'x');
    var ini = anclaDeCoord(rango.from, D, rl.min, rl.max),
        fin = anclaDeCoord(rango.to, D, rl.min, rl.max);
    if (!ini || !fin) return rango;
    rango.ancla = { ini: ini, fin: fin };
    return rango;
  }

  // TRAMO ELÁSTICO — el del MEDIO absorbe el cambio de largo del elemento.
  // POR QUÉ: los tramos se encadenan desde `from` y la cola elástica quedaba AL
  // FINAL, así que en un @10/@20/@10 al alargar la viga el confinamiento del extremo
  // lejano se quedaba FLOTANDO en la mitad del vano. El confinamiento es un dato del
  // EXTREMO: sus centímetros van pegados a su punta y quien tiene que estirarse es el
  // tramo central. Con nº PAR de tramos (dos "del medio") la diferencia se reparte
  // entre esos dos. Con UN solo tramo no hay medio → queda el comportamiento de
  // siempre (la cola del @ que continúa hasta `to`).
  // Devuelve una lista NUEVA (no muta) o la misma cuando no hay nada que absorber.
  function _tramosElasticos(tramos, diff, avisos) {
    var n = (tramos && tramos.length) || 0;
    if (n < 2 || !isFinite(diff) || Math.abs(diff) <= _EPS_POS) return tramos;
    var out = tramos.map(function (t) { return { long: Number(t.long) || 0, sep: t.sep }; });
    var idx = (n % 2) ? [(n - 1) / 2] : [n / 2 - 1, n / 2];
    var cuota = diff / idx.length, sobra = 0, i, v;
    for (i = 0; i < idx.length; i++) {
      v = out[idx[i]].long + cuota;
      if (v < 0) { sobra += v; v = 0; }
      out[idx[i]].long = _r6(v);
    }
    if (sobra < -_EPS_POS && avisos) {
      avisos.push('El elemento se achicó ' + _num(-sobra) + ' cm más de lo que el tramo central ' +
        'puede absorber: los tramos del extremo se recortan contra el fin del rango.');
    }
    return out;
  }

  // RESOLUCIÓN DEL RANGO contra un host. NO muta el rango.
  //   → { from, to, tramos, clamp, avisos:[] }
  // Sin `ancla` devuelve el rango tal cual (recetas que nunca pasaron por el
  // normalizador y llamadas directas a posicionesRango: cero cambio de conducta).
  //
  // TOPE = EL BORDE DEL HORMIGÓN. Al achicar, las dos distancias pueden comerse el
  // elemento y CRUZARSE. Ahí manda el hormigón: cada extremo cae en SU borde útil
  // (borde ∓ recubrimiento del eje), nunca se cruzan ni asoman fuera. El tope NO
  // reescribe el ancla —los 40 cm declarados quedan intactos y reaparecen solos al
  // volver a agrandar—: el clampeo ocurre sólo AL RESOLVER, y SE AVISA con el número
  // que lo causó (mismo canal `_avisar`/`comp._avisos` que lee la barra de estado).
  function resolverRango(rango, host, eje) {
    var out = {
      from: Number(rango && rango.from), to: Number(rango && rango.to),
      tramos: (rango && rango.tramos && rango.tramos.length) ? rango.tramos : null,
      clamp: false, avisos: []
    };
    if (!_tieneAncla(rango)) return out;
    var ej = eje || rango.eje || 'x';
    var D = _dimEje(host, ej);
    if (!isFinite(D) || D <= 0) return out;
    var rlr = _recubLadosEje(host, ej);
    var fr = coordDeAncla(rango.ancla.ini, D, rlr.min, rlr.max),
        to = coordDeAncla(rango.ancla.fin, D, rlr.min, rlr.max);
    // Bordes: el del HORMIGÓN (±D/2) y el ÚTIL (±D/2 ∓ recub). Un elemento cuyo
    // recubrimiento se come el eje entero no tiene borde útil: ahí manda el hormigón.
    var loU = -D / 2 + _recubBordeEje(host, ej, 'min');
    var hiU = D / 2 - _recubBordeEje(host, ej, 'max');
    if (!(loU < hiU)) { loU = -D / 2; hiU = D / 2; }
    var sgn = (Number(rango.to) >= Number(rango.from)) ? 1 : -1;
    var bordeDe = function (a) { return (a.ref === 'min') ? loU : hiU; };
    if ((to - fr) * sgn < -_EPS_POS) {
      // COLISIÓN: las dos distancias no caben en el elemento. Cada extremo a SU borde.
      out.avisos.push('El elemento no da para las distancias a borde declaradas (' +
        _num(rango.ancla.ini.d) + ' y ' + _num(rango.ancla.fin.d) + ' cm sobre el eje ' + ej +
        ', que mide ' + _num(D) + ' cm): la distribución se topa en los bordes del hormigón. ' +
        'El anclaje NO se tocó — vuelve solo al agrandar el elemento.');
      fr = bordeDe(rango.ancla.ini); to = bordeDe(rango.ancla.fin);
      out.clamp = true;
    } else if (Math.abs(fr - Number(rango.from)) > _EPS_POS ||
               Math.abs(to - Number(rango.to)) > _EPS_POS) {
      // Un extremo que se pasa del HORMIGÓN sin llegar a cruzarse con el otro: cae en
      // su borde útil, y se dice con el número.
      // SÓLO SI EL ANCLAJE LO MOVIÓ (el `else if` de arriba). Un rango que el usuario
      // ya tenía fuera del hormigón a SU geometría es dato suyo y no se toca: taparlo
      // acá cambiaría de forma un template al abrirlo (medido: test_jerarquia J4
      // reparte de −100 a 100 en un ancho de 30 a propósito, y el aviso de "fierro
      // fuera del hormigón" ya dice lo que hay que decir). El tope es para lo que el
      // anclaje mueve, no para reescribir la receta de nadie.
      var fueraFr = (fr < -D / 2 - _EPS_POS || fr > D / 2 + _EPS_POS);
      var fueraTo = (to < -D / 2 - _EPS_POS || to > D / 2 + _EPS_POS);
      if (fueraFr || fueraTo) {
        out.avisos.push('La distribución pedía llegar a ' + _num(fueraFr ? fr : to) +
          ' cm sobre el eje ' + ej + ', fuera del hormigón (' + _num(D) +
          ' cm): ese extremo se topó en el borde útil. El anclaje NO se tocó.');
        if (fueraFr) fr = bordeDe(rango.ancla.ini);
        if (fueraTo) to = bordeDe(rango.ancla.fin);
        out.clamp = true;
      }
    }
    out.from = _r6(fr); out.to = _r6(to);
    // TRAMOS: la diferencia de largo respecto del span DECLARADO en la receta la
    // absorbe el tramo del medio. Cuando la receta ya viene resuelta contra este
    // mismo host (el caso normal en el editor, que reancla en cada regeneración) la
    // diferencia es 0 y los tramos no se tocan.
    var spanDecl = Math.abs(Number(rango.to) - Number(rango.from));
    var spanRes = Math.abs(out.to - out.from);
    if (out.tramos && isFinite(spanDecl)) {
      out.tramos = _tramosElasticos(out.tramos, spanRes - spanDecl, out.avisos);
    }
    return out;
  }

  // Rango LISTO PARA REPARTIR: el MISMO objeto cuando la resolución no cambió nada
  // (cero copias en el caso normal) y un clon superficial con from/to/tramos
  // resueltos cuando sí. La receta del usuario NUNCA se muta acá.
  function _rangoResuelto(rango, res) {
    var trOrig = (rango.tramos && rango.tramos.length) ? rango.tramos : null;
    if (!res || (res.from === Number(rango.from) && res.to === Number(rango.to) &&
                 res.tramos === trOrig)) return rango;
    var r = {};
    for (var k in rango) if (rango.hasOwnProperty(k)) r[k] = rango[k];
    r.from = res.from; r.to = res.to;
    if (res.tramos) r.tramos = res.tramos;
    return r;
  }

  // POS_HINT — el arrastre manual de una barra es UN PUNTO más, así que se ancla con
  // la MISMA regla. Medido: una barra arrastrada a 50 cm del testero en una viga de
  // 600 se quedaba en su x absoluta y aparecía a 150 cm del testero al pasar la viga
  // a 800.
  //
  // SE ANCLA LA POSICIÓN, NO EL DESPLAZAMIENTO (21-ago). `pos_hint` NO es dónde está
  // la barra: es una TRASLACIÓN que se suma a la geometría base, y hasta hoy se
  // anclaba ESA traslación. Para un estribo daba lo mismo (nace en x = 0, así que su
  // hint ES su posición) pero para todo lo demás guardaba un número que no describe
  // ningún fierro. MEDIDO con la 101A de la viga-semilla, 600×60:
  //     nace en y = 25.2 · con pos_hint.y = 20 queda en y = 45.2 (el hormigón
  //     llega a 30, o sea que asoma 15.2) · el ancla del delta decía {max, 10},
  //     «a 10 cm de la cara superior», que la pantalla desmiente
  // y al pasar la viga a 80 de alto ese ancla resolvía el delta a 30 → la barra se
  // iba a y = 65.2, o sea 25.2 fuera: el anclaje EMPUJABA la barra hacia afuera en
  // vez de mantenerla donde el usuario la dejó. Ahora se ancla `base + hint` (la
  // coordenada real del centro del bbox de la pieza) y el hint pasa a ser el valor
  // DERIVADO —el mismo trato que `rango.from/to`—: a 80 de alto el ancla resuelve
  // y = 55.2, que sigue siendo la misma barra 15.2 cm por encima de la cara.
  //
  // QUIÉN SABE LA BASE: sólo el motor, y sólo mientras expande (_aplicarPostTransform
  // tiene los placements ya girados y re-anclados, o sea la pieza SIN traslación).
  // Por eso `base` es un argumento y no un cálculo repetido: la UI que mueve la barra
  // llama SIN base y eso INVALIDA el ancla (el gesto manda), y el motor la vuelve a
  // estampar en la expansión siguiente. Un solo estampador.
  // La invalidación barre TODOS los ejes con hint, no sólo el que el gesto movió: la
  // UI entrega el componente, no la lista de ejes que tocó, y re-estampar un eje
  // quieto contra el mismo host devuelve el mismo ancla — no mueve nada.
  //
  // EL ANCLA DICE QUÉ MIDE (`mide:'pos'`) Y ESO ES LA MIGRACIÓN. Del 18 al 20-ago
  // este mismo campo guardó el ancla del DESPLAZAMIENTO, con las MISMAS refs
  // 'min'/'max' que ahora: un ancla vieja es INDISTINGUIBLE de una nueva a simple
  // vista y se leería como si fuera una posición. MEDIDO con la 101A de una viga
  // 600×60 y pos_hint.y = 20: guardada decía {max, 10} (el delta) y al reabrir el
  // template la barra saltaba de y = 45.2 a y = 20 —25.2 cm— en silencio. Con la
  // marca, un ancla sin ella no la acepta NINGÚN lector y el motor la re-deriva de
  // `pos_hint` + base contra la geometría que la receta trae: misma coordenada, cero
  // movimiento. Va en el ancla y no en el normalizador de apertura a propósito: hay
  // consumidores que generan sin pasar por él (el "Abrir template" del Enfierrador
  // arma la receta con los `params` crudos del backend y llama a generarViga), y la
  // migración no puede depender de por qué puerta entró la receta.
  //
  // NO se clampea (igual que hoy, ver la nota de _aplicarPostTransform): una barra
  // que asoma se VE y el aviso de "fierro fuera del hormigón" ya lo dice con sus
  // centímetros. Moverla sola sería mentir sobre dónde está el fierro.
  var _EJES_HINT = ['x', 'y', 'z'];

  // Marca del ancla de POSICIÓN. `_anclaValida` sola no basta: la comparten el rango
  // (que ancla un punto suelto) y el pos_hint (que ancla base + traslación).
  var _MIDE_POS = 'pos';
  function _posAnclaValida(a) { return _anclaValida(a) && a.mide === _MIDE_POS; }

  // ¿El componente declara traslación en algún eje? (lo mira _aplicarPostTransform
  // ANTES de girar, para saber si tiene que calcular la base).
  function _hayPosHint(comp) {
    var ph = comp && comp.pos_hint;
    if (!ph || typeof ph !== 'object') return false;
    for (var i = 0; i < _EJES_HINT.length; i++) {
      var e = _EJES_HINT[i];
      if (ph[e] != null && isFinite(Number(ph[e]))) return true;
    }
    return false;
  }

  function anclarPosHint(comp, host, forzar, base) {
    var ph = comp && comp.pos_hint;
    if (!ph || typeof ph !== 'object') return comp;
    var pa = (comp.pos_ancla && typeof comp.pos_ancla === 'object') ? comp.pos_ancla : null;
    for (var i = 0; i < _EJES_HINT.length; i++) {
      var e = _EJES_HINT[i];
      if (ph[e] == null || !isFinite(Number(ph[e]))) continue;
      if (!base) {
        // Sin base no se puede anclar la POSICIÓN (ver arriba): quien escribe el
        // hint sólo puede decir «esto que había ya no vale». Se BORRA en vez de
        // guardar una intención inventada, y el motor la estampa al expandir.
        if (forzar && pa) delete pa[e];
        continue;
      }
      if (!forzar && _posAnclaValida(pa && pa[e])) continue;
      var a = anclaDeCoord(Number(base[e]) + Number(ph[e]), _dimEje(host, e));
      if (!a) continue;
      a.mide = _MIDE_POS;               // esto ancla una POSICIÓN, no un desplazamiento
      if (!pa) pa = comp.pos_ancla = {};
      pa[e] = a;
    }
    return comp;
  }

  // TRASLACIÓN { x, y, z } ya resuelta contra el host (los ejes sin hint valen 0).
  // `_hay` = el componente tiene traslación (lo mira _aplicarPostTransform).
  // CON `base` resuelve el ancla (posición − base = traslación); SIN base devuelve el
  // `pos_hint` guardado tal cual — que es el valor ya derivado, porque el motor lo
  // reescribe en cada expansión. Ese es el caso de generar.js, que se lo descuenta a
  // los puntos para saber qué caras ocupa la barra ANTES de moverla a mano.
  function posHintResuelto(comp, host, base) {
    var ph = (comp && comp.pos_hint) || null;
    var pa = (comp && comp.pos_ancla) || null;
    var out = { x: 0, y: 0, z: 0, _hay: false };
    for (var i = 0; i < _EJES_HINT.length; i++) {
      var e = _EJES_HINT[i];
      if (!ph || ph[e] == null || !isFinite(Number(ph[e]))) continue;
      out._hay = true;
      var v = Number(ph[e]);
      if (base && pa && _posAnclaValida(pa[e])) {
        var c = coordDeAncla(pa[e], _dimEje(host, e));
        if (c != null && isFinite(c)) v = _r6(c - Number(base[e]));
      }
      out[e] = v;
    }
    return out;
  }

  // Host desde la `geometria` de una receta — MISMOS defaults que generar.js (que es
  // quien lo arma para generar de verdad). Lo usan reanclarReceta y el normalizador
  // de apertura, que trabajan con la RECETA y no con el host ya armado.
  function _hostDeGeometria(geo) {
    geo = geo || {};
    var h = {
      largo: Number(geo.largo), alto: Number(geo.alto), ancho: Number(geo.ancho),
      recub_sup: geo.recub_sup != null ? Number(geo.recub_sup) : 4,
      recub_inf: geo.recub_inf != null ? Number(geo.recub_inf) : 4,
      recub_lat: geo.recub_lat != null ? Number(geo.recub_lat) : 3
    };
    if (geo.recub_ext != null) h.recub_ext = Number(geo.recub_ext);
    return h;
  }

  // REANCLAR LA RECETA — (1) estampa el ancla que falte (derivada del from/to que la
  // receta ya traía, contra SU propia geometría: migración sin movimiento) y (2)
  // reescribe from/to/tramos con el valor DERIVADO del ancla, para que lo que el
  // panel muestra y lo que el motor reparte sean el MISMO número.
  // Idempotente: llamarla dos veces seguidas no mueve nada. El editor la llama en
  // cada regeneración, que es el único sitio por el que pasan todos los cambios.
  // ===========================================================================
  // ESPEJAR UN COMPONENTE contra el plano medio del elemento (24-ago)
  // ---------------------------------------------------------------------------
  // EL PEDIDO (palabras del usuario): «en muros el lado derecho será igual al
  // izquierdo, sería muy conveniente poder espejar cabezales, estribos y trabas de
  // confinamiento». Rehacer a mano el confinamiento del otro extremo es lento y se
  // presta a errores que recién aparecen en taller.
  //
  // QUÉ ES UN ESPEJO ACÁ: la reflexión contra el plano medio del elemento en un eje
  // del mundo. Se compone de dos cosas, y las dos ya tienen dónde vivir:
  //   · LA POSICIÓN — como se guarda por DISTANCIA A UNA CARA, espejar es cambiar
  //     de qué cara se mide dejando la distancia igual. Por eso la copia sigue
  //     anclada y aguanta el cambio de hormigón igual que el original.
  //   · LA ORIENTACIÓN — la pieza queda dada vuelta (los ganchos apuntan al otro
  //     lado). Eso es otra de las 24 poses; no hace falta un campo nuevo.
  // Las MEDIDAS no se tocan: un espejo no cambia largos.
  //
  // CÓMO SE SACA LA POSE — dos candidatas y el motor desempata.
  // Reflejar la normal y el longitudinal da una ROTACIÓN, no la reflexión: falta el
  // bit de quiralidad, y si ese bit sobra o falta depende de en qué plano vive la
  // figura —las cadenas y los cabezales viven en (L,N) y los estribos y las trabas
  // en (N,B)—. En vez de una tabla que habría que mantener figura por figura: se
  // reflejan N y L (eso fija la pose salvo la quiralidad), quedan DOS candidatas
  // que difieren sólo en ese bit, y se le pregunta al motor cuál reproduce la pieza
  // reflejada. Si ninguna se distingue de la otra, la figura es simétrica y da
  // igual cuál se tome.
  //
  // POR QUÉ NO SE BARREN LAS 24 (se intentó y estaba MAL): la forma de una barra
  // suelta no alcanza para identificar una pose. Un cabezal 101A es un palo recto y
  // el barrido encontraba una pose «que calzaba» mucho antes que la correcta —
  // MEDIDO: el espejo en x de un cabezal de borde salía con la normal en z y la
  // copia cruzaba el muro entero (593 cm de recorrido donde el original medía 10).
  // Derivar N y L primero deja el barrido sin nada que adivinar.
  //
  // EL REPARTO SE DA VUELTA CON ELLA: un abanico sobre el eje espejado invierte sus
  // dos puntas (y sus tramos), así que el @10/@20/@10 de un extremo llega al otro
  // leído desde el testero que corresponde.
  //
  // LO QUE ESTA FUNCIÓN NO PUEDE: si por ese eje la posición NO es una distancia a
  // una cara sino el sistema de capas (la altura de un cabezal), no hay dónde
  // escribirla y la copia se queda donde estaba, sólo dada vuelta. Se INFORMA en
  // vez de mentir: `posicionExacta:false`. (El usuario lo pidió así: si una pieza
  // simétrica queda encima de la original, se crea igual y él la mueve — «ahí
  // obligamos al usuario a ser cuidadoso».)
  // ===========================================================================
  // Reflejar un eje con signo: sólo cambia el signo del que ES el eje del espejo.
  function _reflejarEje(v, E) {
    if (!v) return v;
    return (v.eje === E) ? { eje: v.eje, s: -v.s } : v;
  }
  // Las DOS poses candidatas del espejo: N y L reflejados (eso ya fija la cara, el
  // lado y el rumbo) y las dos quiralidades.
  function _posesEspejo(pose, E) {
    var d = derivarPose(pose);
    var N2 = _reflejarEje(d.N, E), L2 = _reflejarEje(d.L, E);
    var cara2 = (N2.eje === 'y') ? ((N2.s > 0) ? 'sup' : 'inf')
      : ((N2.eje === 'z') ? 'lateral' : 'extremo');
    var esp = (L2.s < 0);
    return [
      normalizarPose({ cara: cara2, lado: N2.s, rumbo: L2.eje, espejo: esp }),
      normalizarPose({ cara: cara2, lado: N2.s, rumbo: L2.eje, espejo: !esp })
    ];
  }
  function _ptsDe(pls) { return (pls && pls[0] && pls[0].puntos) ? pls[0].puntos : null; }
  // FIRMA DE UNA FORMA, invariante a traslación: los puntos referidos a su propio
  // mínimo. El ORDEN se conserva a propósito — es lo que distingue una pieza de su
  // reflejo cuando las dos ocupan la misma caja.
  function _firmaForma(pts) {
    if (!pts || !pts.length) return null;
    var mn = { x: Infinity, y: Infinity, z: Infinity }, i, e;
    for (i = 0; i < pts.length; i++) {
      for (e in mn) { if (Number(pts[i][e]) < mn[e]) mn[e] = Number(pts[i][e]); }
    }
    var s = [];
    for (i = 0; i < pts.length; i++) {
      s.push(_r6(pts[i].x - mn.x) + ',' + _r6(pts[i].y - mn.y) + ',' + _r6(pts[i].z - mn.z));
    }
    return s.join(';');
  }
  // Centro de TODAS las copias sobre un eje. Se usa la unión y no la primera barra
  // porque al dar vuelta un abanico la primera copia pasa a ser la última.
  function _centroUnion(pls, eje) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < (pls || []).length; i++) {
      var pts = pls[i].puntos || [];
      for (var j = 0; j < pts.length; j++) {
        var v = Number(pts[j][eje]);
        if (!isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return isFinite(lo) ? (lo + hi) / 2 : NaN;
  }
  function _expandirClon(comp, host) {
    try { return expandirComponente(JSON.parse(JSON.stringify(comp)), host) || []; }
    catch (e) { return []; }
  }

  // Devuelve { comp, formaExacta, posicionExacta }. `comp` es SIEMPRE un objeto
  // nuevo: el original no se toca.
  function espejarComponente(comp, host, eje) {
    var e = _ejeCanon(eje);
    var copia = JSON.parse(JSON.stringify(comp || {}));
    var out = { comp: copia, formaExacta: false, posicionExacta: false };
    if (!e || !host || !comp) return out;

    var pls0 = _expandirClon(comp, host);
    var pts0 = _ptsDe(pls0);
    if (!pts0) return out;
    var centro0 = _centroUnion(pls0, e);

    // 1 · EL REPARTO SE DA VUELTA. `from` y `to` son coordenadas absolutas del
    // host: reflejarlas es negarlas, y al negarlas se intercambian (el `from`
    // reflejado queda a la derecha del `to` reflejado). Los tramos se leen desde
    // `from`, así que su lista también se invierte.
    var d = copia.distribucion;
    if (d && typeof d === 'object') {
      ['rango', 'rango2'].forEach(function (k) {
        var r = d[k];
        if (!r || r.from == null || r.to == null) return;
        var ejeR = r.eje || ((k === 'rango') ? 'x' : 'y');
        if (ejeR !== e) return;
        var f = Number(r.from), tt = Number(r.to);
        if (!isFinite(f) || !isFinite(tt)) return;
        r.from = -tt; r.to = -f;
        if (r.tramos && r.tramos.length) r.tramos = r.tramos.slice().reverse();
        delete r.ancla;                       // apuntaba al borde de enfrente
        anclarRango(r, host, ejeR, true);
      });
    }

    // 2 · LA POSE que reproduce el reflejo. Se le pregunta al motor.
    var objetivo = _firmaForma(pts0.map(function (q) {
      var w = { x: Number(q.x), y: Number(q.y), z: Number(q.z) };
      w[e] = -w[e];
      return w;
    }));
    var poses = _posesEspejo(poseDe(comp), e);
    copia.pose = poses[0];                     // la candidata sin desempatar
    for (var i = 0; i < poses.length; i++) {
      var prueba = JSON.parse(JSON.stringify(copia));
      prueba.pose = poses[i];
      var f = _firmaForma(_ptsDe(_expandirClon(prueba, host)));
      if (f && f === objetivo) { copia.pose = poses[i]; out.formaExacta = true; break; }
    }

    // 3 · LA POSICIÓN. Dónde cayó la copia contra dónde tendría que caer (el
    // reflejo del original). Si el reparto ya la llevó, la diferencia es 0 y no se
    // escribe nada: en el eje del abanico un hint no tendría a quién mandarle.
    var pls1 = _expandirClon(copia, host);
    var centro1 = _centroUnion(pls1, e);
    if (isFinite(centro0) && isFinite(centro1)) {
      var delta = (-centro0) - centro1;
      if (Math.abs(delta) <= 1e-6) out.posicionExacta = true;
      else {
        copia.pos_hint = copia.pos_hint || {};
        copia.pos_hint[e] = (Number(copia.pos_hint[e]) || 0) + delta;
        if (copia.pos_ancla) delete copia.pos_ancla[e];
        // VERIFICAR, no suponer: hay ejes donde la posición no es nuestra (las
        // capas de un cabezal). Ahí el hint se escribe y no pasa nada, y eso hay
        // que decirlo.
        var centro2 = _centroUnion(_expandirClon(copia, host), e);
        out.posicionExacta = isFinite(centro2) && Math.abs((-centro0) - centro2) <= 0.01;
      }
    }
    return out;
  }

  function reanclarReceta(receta) {
    if (!receta || typeof receta !== 'object') return receta;
    var comps = receta.componentes;
    if (Object.prototype.toString.call(comps) !== '[object Array]') return receta;
    var host = _hostDeGeometria(receta.geometria);
    if (!(host.largo > 0) || !(host.alto > 0) || !(host.ancho > 0)) return receta;
    for (var i = 0; i < comps.length; i++) {
      var c = comps[i];
      if (!c || typeof c !== 'object') continue;
      var d = c.distribucion;
      if (d && typeof d === 'object') {
        _reanclarUno(d.rango, host, 'x');
        _reanclarUno(d.rango2, host, 'y');
      }
      // `pos_hint` NO se toca acá: anclarlo pide la BASE de la pieza (dónde nace sin
      // traslación) y eso sólo lo sabe el motor mientras expande. Lo estampa y lo
      // re-deriva _aplicarPostTransform, que corre en la misma regeneración —
      // reanclarReceta va justo antes de generar.
    }
    return receta;
  }

  function _reanclarUno(rango, host, ejeDefault) {
    if (!rango || rango.from == null || rango.to == null) return;
    var eje = rango.eje || ejeDefault;
    anclarRango(rango, host, eje, false);
    var res = resolverRango(rango, host, eje);
    rango.from = res.from; rango.to = res.to;
    if (res.tramos && rango.tramos) rango.tramos = res.tramos;
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
      // …y `eje: null` + UNA sola posición cuando ese eje es el del ANCLAJE DE CARA
      // (ver _rangoReparto): ahí la coordenada no es un dato del rango sino el
      // recubrimiento, así que ni se escribe ni se replica la barra.
      var rr = _rangoReparto(base, cfg, host);
      var ejeR = rr.eje, posR = rr.pos;
      for (var ri = 0; ri < posR.length; ri++) {
        var xr = posR[ri];
        var extraR = {};
        if (ejeR) extraR[ejeR] = xr;   // sin eje libre → la única copia va EN el anclaje
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
    // ZONAS — SIN ANCLAJE, a propósito (18-ago). Se anclan el `rango` y el `rango2`,
    // no las zonas, y esto es una LIMITACIÓN CONOCIDA, no un olvido:
    //   · el editor de HOY no emite zonas de verdad para un componente nuevo: nacen
    //     con `zonas:[{long:0}]` de relleno y con `rango` (la rama de arriba, que
    //     corta antes de llegar acá). Zonas con largo real sólo quedan en la
    //     viga-semilla y en recetas guardadas de antes del rango;
    //   · y sus conteos NO se pueden conservar si se las reencuadra. Medido sobre la
    //     semilla (150@10 / 300@20 / 150@10, start 4) en su viga de 600:
    //       hoy                              → 47 estribos (el último en x = 294)
    //       con el tramo del medio elástico  → 48 estribos  ← cambia a geometría fija
    //       reencuadradas en proporción      → 47 pero el último en 288  ← también
    //     La causa es que las zonas avanzan con el @ NOMINAL y duplican la barra de
    //     unión (ver la nota de posicionesRango): cualquier cambio de sus largos
    //     mueve dónde corta el clamp del borde. Tocarlas rompería «a geometría fija,
    //     los conteos de la semilla no pueden cambiar».
    // Consecuencia a la vista: una receta que todavía reparta por zonas sigue pegada
    // al borde de partida (no sigue al hormigón). La salida es convertirla a
    // rango+tramos —que sí se anclan y ya tienen el tramo elástico—, y eso es una
    // decisión de producto (cambia conteos), no algo que se pueda hacer por detrás.
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
  // SE MIDE LA PIEZA, NO SE PREGUNTA SU FAMILIA (defecto grave medido 13-ago).
  // ---------------------------------------------------------------------------
  // Este bloque decía «el estribo (marco cerrado) y la traba NO pasan por acá: su
  // ruta de dibujo no lee este rango de la misma forma y su reparto queda igual
  // que siempre», y por eso salía por `return mc` para toda familia ≠ 'cadena'.
  // La premisa es FALSA para la traba: SÍ lee el rango y SÍ ocupa ancho. MEDIDO en
  // muro 400×250×20 rec 2.5, TC 101A φ16, layered barras_capa = 3: las 3 copias se
  // repartían en z de −6.7 a +6.7 (el marco EJE A EJE) mientras cada pieza ocupa
  // 14.75 en ese mismo eje → la copia del extremo llegaba a z = −21.45 contra un
  // hormigón que termina en −10: 12.01 cm de CARA de fierro fuera, sin un aviso.
  // La cura no es agregar 'traba' a la lista de familias —esa tabla se
  // desincroniza del trazado en cuanto alguien cambia una ruta de dibujo—: es
  // MEDIR la ocupación real de la pieza sobre el eje de reparto con `_spanEnEje`,
  // que traza la figura UNA vez en su pose natural. Una sola cuenta que vale para
  // 'traba', 'estribo', 'rombo' y 'cadena', y que por construcción no puede
  // discrepar del dibujo.
  // Los casos límite salen solos, sin un if: el estribo/rombo ocupan el marco
  // entero → el rango colapsa a su centro y las N copias caen donde el marco las
  // pone (exactamente lo que hacían antes, que ignoraban el reparto); una traba
  // angosta se reparte como siempre.
  function _repartoDePieza(base, mc, host) {
    if (base.rol === 'cabezal') return mc;
    if (!host || !mc.ejeReparto) return mc;
    var ext = _spanEnEje(base, host, mc.ejeReparto);
    if (!(ext > 0)) return mc;
    var h = ext / 2;        // el eje de reparto de una pieza de sección ES su eje u
    var lo = mc.lo + h, hi = mc.hi - h;
    // RANGO VACÍO = la pieza es MÁS ANCHA que el marco (dims fijas que no caben, o
    // un gancho normativo que el espesor no aguanta): no hay dónde repartirla, así
    // que las copias van todas al centro del marco. No es un clamp que tape nada
    // —la pieza sigue asomando lo suyo, que es su propio exceso de ancho— pero
    // ahora se DICE: era el otro silencio de este defecto (la traba φ16 en un muro
    // de 20 no cabe ni sola, y nada lo contaba). Lo que no se hace es INVENTAR un
    // reparto que las separaría aún más (con el rango dado vuelta las copias se
    // alejaban una de otra y salía MÁS fierro fuera que sin repartir).
    if (lo > hi) {
      // La pieza que ocupa EXACTAMENTE su marco (el caso normal de un estribo o de
      // una cadena que el 'auto' estiró al útil) cae acá por coma flotante: el
      // rango colapsa igual —al mismo centro— pero NO es un dato malo y no avisa.
      var exceso = ext - (mc.hi - mc.lo);
      lo = hi = (mc.lo + mc.hi) / 2;
      if (exceso > _EPS_POS) _avisar(base, 'La pieza ocupa ' + (Math.round(ext * 100) / 100) + ' cm en el eje ' +
        mc.ejeReparto + ' y el marco útil da ' + (Math.round((mc.hi - mc.lo) * 100) / 100) +
        ' cm: no cabe ni una vez, así que no hay reparto posible y las copias van ' +
        'todas al centro (el sobrante asoma, a la vista).');
    }
    return { eje: mc.eje, ancla: mc.ancla, sentido: mc.sentido, ejeReparto: mc.ejeReparto,
      lo: lo, hi: hi };
  }

  // ---------------------------------------------------------------------------
  // EJE DE UN RANGO — EL ANCLAJE DE CARA NO ES UNA COORDENADA LIBRE (13-ago)
  // ---------------------------------------------------------------------------
  // Un cabezal tiene TRES ejes en su marco local y NO son intercambiables:
  //   · LONGITUDINAL (su rumbo, la x local)  → lo recorre;
  //   · REPARTO      (mc.ejeReparto)         → ahí se reparten sus copias;
  //   · NORMAL DE SU CARA (mc.eje)           → ahí NO hay dato de posición: la
  //     coordenada la DERIVA _marcoCara del recubrimiento + las pilas, porque la
  //     pieza está PEGADA a esa cara.
  // Los distribuidores de rango escribían el eje declarado en la receta SIN
  // preguntar, y cuando ese eje es el de la cara la barra queda DESPEGADA de su
  // cara: el anclaje —que es geometría, no una preferencia— se pierde en silencio.
  //
  // MEDIDO (la repro del usuario, viva en producción): MV 103C φ8 todo auto en un
  // muro 400×250×20 rec 2.5, rotada +90 en la vista de sección → pose
  // {cara:'extremo', lado:+1, rumbo:'y'}, con el rango que ya traía de antes de
  // girar (eje x, −196…196 @20).
  //   · C auto = 394.2 = profundidad útil contra el LARGO (la regla del auto
  //     funcionando: la pata va de testero a testero, 400 − 2·2.5 − 0.8).
  //   · Anclada a SU testero (+X, x = 200 − 2.5 − 0.4 = 197.1) entra EXACTA:
  //     197.1 − 394.2 = −197.1, con la pata hacia el núcleo. 0 cm fuera.
  //   · Repartida en X, la copia de x = −196 dibujaba su pata hasta x = −590.2:
  //     390.2 cm de fierro FUERA del hormigón (el muro llega a ±200).
  // No es un caso de la cara 'extremo': el mismo rango sobre el eje de la cara
  // sacaba 219.2 cm en cara sup/inf (rango en y) y 14.2 cm en cara lateral de viga
  // (rango en z). La cara 'extremo' sólo lo destapó porque es la que hereda el
  // rango en X que el muro trae por defecto.
  //
  // QUÉ PREGUNTA DECIDE — Y POR QUÉ NO ES UN PORCENTAJE. Una barra está APOYADA en
  // su cara cuando NACE en ella y CRECE hacia el núcleo: eso es tener DESARROLLO
  // (una pata) sobre el eje de la normal. Es una pregunta de SÍ o NO —hay pata o no
  // la hay—, y se contesta MIDIENDO el trazado real de la pieza (_spanEnEje), no
  // deduciéndola de una tabla de figuras que se pueda desincronizar del dibujo:
  //   · 103C / 103B / 305A …  patas de 7.5 a 394.2 cm sobre ese eje  → APOYADA:
  //     su coordenada ahí ES el anclaje, y el rango no la escribe.
  //   · 101A recta (la traba TM que cose las dos cortinas del muro, y la malla MH/MV
  //     de cara): PLANA en la cara, span 0 sobre ese eje → no tiene pata que nazca
  //     de ninguna cara, su profundidad es un dato libre y el rango reparte como
  //     siempre (muro end-to-end: 3 posiciones × 2 filas = 6 trabas, sin mover un
  //     decimal). El "0" no es una tolerancia elegida: es la ausencia de geometría,
  //     y se compara con _EPS_POS, el MISMO epsilon con el que este archivo decide
  //     que dos coordenadas son la misma (_pushPos).
  //
  // ANTES ACÁ HABÍA UN 30 % Y ESE FUE EL DEFECTO. La primera versión comparaba el
  // span con UMBRAL_PUNTUAL (0.30 · dimensión del host). Eso era reusar una
  // CONSTANTE, no un criterio: UMBRAL_PUNTUAL contesta otra pregunta —si una pieza
  // volteada conserva su centro (_restituirCentroVolteo)— y el apoyo de una barra en
  // su cara no tiene ningún corte al 30 %. MEDIDO con el porcentaje puesto (MURO
  // 400×250×20 rec 2.5 · 103C φ8 · pose {extremo,+1,y} · A y B auto, C FIJA · rango
  // x −196…196 @98, 5 copias; fierro fuera medido A LA CARA de la barra):
  //     C=118 → 114.4 cm FUERA · C=119 → 115.4 cm FUERA   (119 < 0.30·400 = 120)
  //     C=120 → 0.0 cm                                    (120 ≥ 120 → sí anclaba)
  // El salto 115.4 → 0.0 lo ponía el umbral, no la geometría: por debajo del corte el
  // defecto sobrevivía ENTERO y encima sin aviso. Preguntando por la PATA, la serie
  // completa (C = 100…140 y C en 'auto') da 0.0 cm fuera.
  // Es el mismo 30 % el que dejaba viva la otra mitad del caso reportado: un 103B
  // TODO EN AUTO —la config con la que nace la pieza en el editor— tiene patas de
  // 7.5 cm (φ8) a 19.2 cm (φ32) sobre el eje de su cara, nunca llegaba al 30 % y
  // seguía sacando de 3.9 a 16.8 cm de fierro por el testero OPUESTO al de su pose,
  // en viga y en muro, sin emitir un solo aviso.
  //
  // Y EL RANGO QUE NO APLICA NO SE MULTIPLICA (ver _rangoReparto): se emite UNA
  // copia en el anclaje. Emitir las N coincidentes era facturar 21 barras dibujadas
  // exactamente una encima de otra —el 3D muestra una, el listado cobra 21—, que es
  // esconder el dato malo, justo lo contrario de lo que este motor hace.

  // Span que la pieza OCUPA sobre un eje del marco local, trazándola UNA sola vez en
  // su pose natural. Se mide la GEOMETRÍA REAL en vez de deducirla del catálogo:
  // vale igual para cabezal con patas, cadena o recta, y no crea una segunda tabla
  // que se pueda desincronizar del trazado.
  function _spanEnEje(base, host, eje) {
    var fp = _fp();
    if (!fp || !fp.figuraAPuntos) return 0;
    var pts = fp.figuraAPuntos(base.figura, base.dims, host,
      _mezclarAnchor(base.anchorBase, {}),
      { rol: base.rol || 'cabezal', diamCm: base.diam });
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; pts && i < pts.length; i++) {
      var v = Number(pts[i][eje]);
      if (!isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return (hi > lo) ? (hi - lo) : 0;
  }

  // Eje LOCAL sobre el que el rango puede repartir; null = es el eje de la NORMAL de
  // la cara en la que un cabezal SE APOYA (tiene pata), y esa coordenada no es un
  // dato libre: la fija el recubrimiento + las pilas (_marcoCara).
  // `campo` (4º arg) = 'rango' (default, lo de siempre) o 'rango2' (la 2ª línea de
  // distribución del arreglo por área). Es el MISMO criterio para las dos: el eje se
  // declara en la receta y sólo se rechaza cuando es el de la cara contra la que un
  // cabezal se apoya.
  function _ejeRangoReparto(base, cfg, host, campo) {
    var cual = campo || 'rango';
    var r = cfg && cfg[cual];
    var decl = r && r.eje;
    var eje = (decl === 'y' || decl === 'z') ? decl
      : ((cual === 'rango2' && decl !== 'x') ? _ejeLibreArreglo(base, cfg, host) : 'x');
    // Sólo un cabezal se apoya CONTRA una cara. Estribo/traba/cadena de sección
    // encuadran el marco de núcleo: no tienen eje de anclaje que proteger y su
    // reparto sigue exactamente como estaba.
    if (base.rol !== 'cabezal') return eje;
    // EJE DEL PROPIO DESARROLLO (local x): un rango ahí es legítimo cuando la
    // pieza es CORTA (suples repartidos a lo largo, con o sin traslapo). El caso
    // degenerado es la pieza que DESARROLLA prácticamente todo el eje (dominante
    // estirado al útil): cada copia cae encima de la anterior — medido 14-ago:
    // traba volteada legacy con rango sin eje → 3 barras idénticas encimadas en
    // silencio. Ahí: null → 1 barra + aviso, como el guard de la cara.
    if (eje === 'x') {
      var dimX = Number(host.largo);
      if (isFinite(dimX) && dimX > 0 && _spanEnEje(base, host, 'x') >= 0.9 * dimX) return '__propio';
      return eje;
    }
    if (eje !== _marcoCara(base, host).eje) return eje;   // otro eje: nada que decidir
    // LA 2ª LÍNEA DEL ARREGLO SÍ PUEDE REPARTIR POR EL EJE DE LA CARA (15-ago).
    // El guard de abajo protege la línea PRINCIPAL: ahí la coordenada contra la
    // cara la fija el recubrimiento y un rango la pelearía. Pero un ARREGLO POR
    // ÁREA declara DOS ejes a propósito, y como la barra ya corre por uno, de los
    // dos que quedan UNO ES SIEMPRE el de su cara: con el guard puesto, el área
    // no podía existir en ninguna figura abierta (medido: traba de muro pedía
    // 5×3 y entregaba 5 con "2º rango ignorado"). Cuando el usuario declara esa
    // 2ª línea está diciendo justamente "no te ancles ahí, repártete" — que es
    // lo mismo que hacían las CAPAS, sólo que con rango y arrastrable.
    if (cual === 'rango2') return eje;
    // ¿Tiene PATA sobre ese eje? Sin desarrollo la pieza es plana en la cara y su
    // profundidad sigue siendo un dato libre (101A de malla / traba recta).
    // (Se intentó un umbral relativo el 14-ago para el 2º rango en altura de una
    // traba que cruza con gancho — rompía el diseño W1 de test_rotaciones. La
    // salida correcta es la POSE: una pieza que cruza se reparte con cara
    // 'extremo', puntual en ambos ejes del reparto, y este guard ni se entera.)
    return (_spanEnEje(base, host, eje) > _EPS_POS) ? null : eje;
  }

  // EJE POR DEFECTO DE LA 2ª LÍNEA — «nunca el eje del desarrollo de la barra».
  // ---------------------------------------------------------------------------
  // La receta normalmente lo declara (el editor lo escribe al colocar la figura: «los
  // ejes deben salir de DONDE ingresamos la figura»). Cuando no viene, se ELIGE
  // MIDIENDO la pieza, no preguntándole su familia — el mismo criterio que
  // `_repartoDePieza` y `_ejeRangoReparto`: de los dos ejes que quedan libres tras el
  // primer rango, se toma aquel sobre el que la pieza MENOS se desarrolla, o sea el
  // que su cuerpo NO recorre. Repartir a lo largo del propio desarrollo de la barra
  // sería apilar copias una encima de otra, que es exactamente lo que este motor
  // aprendió a no hacer (ver la nota de `rango.eje` del cabezal).
  // Empate (una pieza que ocupa lo mismo en los dos): manda el orden x → y → z, que
  // es el mismo con el que el resto del archivo recorre los ejes.
  function _ejeLibreArreglo(base, cfg, host) {
    var eje1 = _ejeRangoReparto(base, cfg, host, 'rango');
    var cand = ['x', 'y', 'z'].filter(function (e) { return e !== eje1; });
    if (!cand.length) return 'z';
    var mejor = cand[0], mejorSpan = Infinity, i, s;
    for (i = 0; i < cand.length; i++) {
      s = _spanEnEje(base, host, cand[i]);
      if (s < mejorSpan - _EPS_POS) { mejorSpan = s; mejor = cand[i]; }
    }
    return mejor;
  }

  // POSICIONES QUE REPARTE UN RANGO — fuente ÚNICA de linear y arreglo.
  //   { eje: 'x'|'y'|'z', pos: [coords] } → reparto normal, como siempre;
  //   { eje: null,        pos: [null]   } → el rango NO aplica sobre esa pieza:
  //     UNA sola copia, en su anclaje, y el aviso escrito en el componente (la UI
  //     lo muestra en la barra de estado). Ni se dibuja fierro en el aire ni se
  //     cobran N barras que no existen: lo que se ve es lo que se factura.
  // El aviso apunta a los DOS controles que sí mueven una barra por el eje de su
  // cara sin despegarla: el LADO de la cara (testero/cortina opuesta) y las CAPAS,
  // que entran hacia el núcleo con el sentido que publica _marcoCara.
  // `campo` (4º arg) = 'rango' (default) o 'rango2' (2ª línea del arreglo por área).
  //
  // EL RANGO SE RESUELVE CONTRA EL HOST — ver «ANCLAJE POR DISTANCIA AL BORDE».
  // Acá, que es donde por fin se sabe sobre QUÉ EJE reparte de verdad, el rango:
  //   1) se ANCLA si todavía no lo estaba (receta vieja / llamada directa al motor):
  //      el ancla se deriva de su propio from/to contra ESTE host, así que resolverlo
  //      devuelve las mismas coordenadas y no se mueve ni un milímetro;
  //   2) se RESUELVE: from/to salen del ancla, el tramo del medio absorbe el cambio
  //      de largo y lo que no cabe se topa en el borde útil CON AVISO.
  // El clon lo hace `_rangoResuelto` sólo cuando algo cambió: la receta del usuario
  // no se muta y en el caso normal no se paga ni una copia.
  function _rangoContraHost(base, rango, host, eje) {
    if (!rango) return rango;
    anclarRango(rango, host, eje, false);
    var res = resolverRango(rango, host, eje);
    for (var i = 0; i < res.avisos.length; i++) _avisar(base, res.avisos[i]);
    return _rangoResuelto(rango, res);
  }

  function _rangoReparto(base, cfg, host, campo) {
    var cual = campo || 'rango';
    var eje = _ejeRangoReparto(base, cfg, host, cual);
    var etiq = (cual === 'rango2') ? '2º rango' : 'Rango';
    if (eje === '__propio') {
      _avisar(base, etiq + ' ignorado: pide repartir a lo largo de la PROPIA barra, y ahí las ' +
        'copias caerían una encima de otra. Se generó 1 barra: para repartirla, elige un rango ' +
        'en otro eje (o gira la pieza con ESPACIO para que corra por donde quieres repartir).');
      return { eje: null, pos: [null] };
    }
    if (!eje) {
      _avisar(base, etiq + ' ignorado: pide repartir por el eje de la CARA contra la que se ' +
        'ancla esta barra, y ahí la posición la fija el recubrimiento, no el rango. Se generó ' +
        '1 barra en su anclaje: para llevarla al otro lado usa el Lado de la cara, y para ' +
        'duplicarla hacia adentro usa las capas.');
      return { eje: null, pos: [null] };
    }
    if (cual === 'rango2') {
      // El @ del 2º rango es el SUYO (`rango2.sep`), nunca el `cfg.sep` del primero:
      // son dos líneas independientes y mezclarlos daría una malla con el paso de la
      // otra dirección sin que nada lo dijera.
      var pos2 = posicionesRango(_rangoContraHost(base, cfg.rango2, host, eje), undefined);
      if (pos2._tope) _avisar(base, _avisoTope(pos2._tope.sep));
      return { eje: eje, pos: pos2 };
    }
    // PASO REAL (no el nominal): el conteo ArmaPilot ceil(span/@)+1 CIERRA el
    // intervalo, así que las nR barras se reparten equiespaciadas entre from y to
    // con paso = span/(nR−1) ≤ @ ("cada @ o menos"). Avanzar con el @ NOMINAL hacía
    // que el recorrido no alcanzara `to` y el bucle cortara antes: prometía nR
    // barras y colocaba menos, dejando un hueco muerto en un extremo (span 24 @20 →
    // nR=3 pero colocaba 2 en −12 y +8, con 4 cm muertos).
    // Con rango.tramos el reparto es por TRAMOS (@10/@20/@10) — misma función.
    var pos = posicionesRango(_rangoContraHost(base, cfg.rango, host, eje), cfg.sep);
    // El reparto se capó (@ minúsculo o rango gigante): la barra de estado lo dice
    // con el número que lo causó. No se "corrige" el @ por detrás.
    if (pos._tope) _avisar(base, _avisoTope(pos._tope.sep));
    return { eje: eje, pos: pos };
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
    if (!fp || !fp.esPiezaDeSeccion) return base.rol === 'estribo';
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
    var mc = _repartoDePieza(base, _marcoCara(base, host), host);
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
    var bbCapaPrev = null;   // bbox de la última capa EMITIDA (comprobación del anidado)
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
      // EL 'AUTO' DE LA CAPA k SE RESUELVE CONTRA EL MARCO DE LA CAPA k
      // (defecto grave medido 13-ago). Una pieza LONGITUDINAL con lados en 'auto'
      // perpendiculares al dominante (los que cruzan la profundidad: el espesor de
      // un muro, el ancho de una viga) los resolvía SIEMPRE contra el marco de la
      // capa 1, y después la capa k se trasladaba k·gap hacia el núcleo con esas
      // mismas medidas: como el 'auto' ya la había estirado a la profundidad ÚTIL
      // COMPLETA, cualquier gap > 0 la sacaba por la cara opuesta. MEDIDO en muro
      // 400×250×20 rec 2.5, MH/CBS 105F φ16 todo auto, 3 capas gap 3: dims
      // IDÉNTICAS en las tres (C = E = 13.4 = el espesor útil entero) y la capa 3
      // con el eje 3.0 cm fuera del hormigón, sin un solo aviso.
      // Esa medida NO la fijó el usuario —la eligió el motor—, así que re-elegirla
      // desde donde la pieza REALMENTE está no es "acomodar" nada: es lo que
      // 'auto' significa. Un lado FIJO no se toca (sigue midiendo lo que dice la
      // ficha y asoma si no cabe, que es el dato honesto).
      // Las piezas de SECCIÓN no pasan por acá: no se trasladan (su k·gap va al
      // inset del marco) y su encogimiento lo resuelve anidarFigura.
      var dimsBase = base.dims;
      if (!seccion && offPos > 0 && base._comp) {
        var dRe = _dimsEfectivas(base._comp, host, base.jerarquia, offPos, base.avisos);
        if (dRe) dimsBase = dRe;
      }
      // δ de DIMS del anidado = k·φ_propio (holgura lateral contra el fierro de la
      // capa de afuera). En las CERRADAS manda el campo Sep (anillos concéntricos
      // separados k·gap), y por eso viaja aparte en opts.sep.
      var an = (c > 0 && (anidaSeccion || anidaFig))
        ? _fp().anidarFigura(base.figura, dimsBase, c * base.diam, base.rol,
          { sep: offPos, diamCm: base.diam, angulos: base.anchorBase && base.anchorBase.angulos })
        : null;
      var usaAn = !!(an && an.criterio !== 'recta');
      var dimsCapa = usaAn ? an.dims : dimsBase;
      var dimsPropias = usaAn || (dimsBase !== base.dims);
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
      // UN ANILLO ANIDADO NO PUEDE ENSANCHAR (defecto grave medido 13-ago).
      // El anidado encoge el MARCO de la capa k (inset k·gap en las tres pilas),
      // pero el desarrollo del gancho sísmico se mide desde el lado izquierdo del
      // marco: mientras la pata salía a su largo normativo pasara lo que pasara,
      // el trazo de la capa k+1 podía terminar MÁS ANCHO que el de la capa k —
      // o sea el anillo "interior" abrazando por fuera al de afuera. Medido en
      // muro 400×250×20 rec 2.5, EC 104D φ16, 3 capas gap 3: z ∈ [−6.70, 6.92] /
      // [−3.70, 9.92] / [−0.70, 12.92], span constante 13.62 y la capa 3 con el
      // eje 2.92 cm FUERA del hormigón, sin un solo aviso.
      // `_pataGancho` ya arregló la causa (la pata se mide contra el sitio que hay);
      // esto es la COMPROBACIÓN FÍSICA de que el resultado cumple lo que un anillo
      // anidado significa. Si la capa se sale del bbox de la anterior, esa capa NO
      // existe: se omite por el MISMO camino que las que no caben por dims/marco
      // (_avisoCapa), en vez de emitir un anillo desplazado en silencio.
      var pintadas = [];
      for (var i = 0; i < nBarras; i++) {
        // TECHO de barras del componente (capas × barras_capa). Acá no hay @:
        // el aviso sale sin cifra (el mismo texto, sin el "(x cm)").
        if (placements.length + pintadas.length >= TOPE_PLACEMENTS_COMP) {
          _avisar(base, _avisoTope(null));
          for (var t = 0; t < pintadas.length; t++) placements.push(pintadas[t]);
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
        if (dimsPropias) pl.dims = _clonDims(dimsCapa);   // ítem propio en el listado
        pintadas.push(pl);
      }
      if (anidaSeccion && c > 0 && bbCapaPrev && pintadas.length) {
        var bbAhora = _bboxLista(pintadas.map(function (p) { return p.puntos; }));
        if (bbAhora && !_bboxContenido(bbAhora, bbCapaPrev)) {
          _avisar(base, _avisoCapa(c, offPos, 'el anillo saldría MÁS ANCHO que la capa anterior'));
          continue;
        }
        bbCapaPrev = bbAhora;
      } else if (pintadas.length) {
        bbCapaPrev = _bboxLista(pintadas.map(function (p) { return p.puntos; })) || bbCapaPrev;
      }
      for (var j = 0; j < pintadas.length; j++) placements.push(pintadas[j]);
    }
    return placements;
  }

  // Media dimensión del hormigón en un eje: x = largo, y = alto, z = ancho.
  function _semiHost(host, eje) {
    if (!host) return 0;
    var d = (eje === 'x') ? host.largo : ((eje === 'y') ? host.alto : host.ancho);
    return (Number(d) || 0) / 2;
  }

  // ---------------------------------------------------------------------------
  // FIERRO FUERA DEL HORMIGÓN: SE DIBUJA, PERO SE DICE (13-ago)
  // ---------------------------------------------------------------------------
  // La regla del motor ya estaba escrita en `anidarFigura`: «bbox fuera del
  // hormigón con dims > 0 NO es "no cabe": eso se genera tal cual — dato honesto y
  // VISIBLE en el 3D; el usuario decide». Lo que faltaba era la otra mitad: que se
  // DIGA. Los seis defectos que trajo esta tanda tenían la misma coletilla —«cero
  // avisos»— y por eso llegaron a producción: la barra salía del elemento, se
  // facturaba al despiece y nada en pantalla lo contaba.
  // Esto NO clampa ni omite nada: mide los puntos FINALES (ya permutados,
  // restituidos y con el post-transform aplicado, o sea lo que se ve) contra la
  // caja del hormigón, tomando la CARA del fierro (eje ± φ/2), y deja UN aviso con
  // el peor número.
  // El EMPALME no es un defecto: asoma fuera del hormigón A PROPÓSITO y sólo por
  // el eje por el que corre la barra (su rumbo), así que ese eje lleva de holgura
  // exactamente lo que suman los dos Δ de empalme.
  //
  // …Y EL Δ DEL DOMINANTE TAMPOCO (23-ago, corrección de dominio del usuario):
  // «el empalme sí puede salirse del hormigón, eso es esperado; para eso es el
  // DELTA, para esos ajustes». Un arranque se proyecta fuera del elemento a
  // propósito porque continúa en la próxima etapa de hormigonado. Con los dos
  // casos —el desborde QUERIDO y el que sale de un 'auto' mal derivado— bajo el
  // mismo texto de «no construible», el aviso se vuelve ruido y se aprende a
  // ignorarlo, que es lo peor que le puede pasar a un aviso.
  // MEDIDO (muro 720×310×20 recub 2, CB 102A φ16 rumbo y, B auto + Δ 96): la barra
  // asomaba 94.8 cm por arriba y el motor la llamaba no construible; son 94.8 de
  // los 96 que el usuario ESCRIBIÓ, o sea exactamente lo que pidió.
  // La holgura es la del Δ del DOMINANTE —el lado que corre a lo largo, el único
  // que alarga la barra por su propio eje—, por el MISMO canal y con la misma
  // convención que el empalme (`anchorBase.delta`, que ya existe y dice cuánto y
  // por qué punta creció). Un Δ en una PATA no entra: eso no es un arranque, es
  // una figura que se sale de través, y ahí el aviso tiene que sonar. Y si el
  // desborde SUPERA lo que el Δ justifica, el aviso sale igual por la DIFERENCIA:
  // la resta la hace `lim`, no un `if` que apague el canal.
  function _avisarFueraDelHormigon(base, comp, placements, host) {
    if (!base || !host || !placements || !placements.length) return;
    var emp = (base.anchorBase && base.anchorBase.empalme) || null;
    var holgura = emp ? ((Number(emp.ini) || 0) + (Number(emp.fin) || 0)) : 0;
    var dlt = (base.anchorBase && base.anchorBase.delta) || null;
    if (dlt) holgura += Math.max(0, (Number(dlt.ini) || 0) + (Number(dlt.fin) || 0));
    var ejeRumbo = poseDe(comp).rumbo;
    var r = (Number(base.diam) || 0) / 2;
    var peor = 0, ejePeor = null, capaPeor = null, i, k, e, lim, bb, exc, ejes = ['x', 'y', 'z'];
    for (i = 0; i < placements.length; i++) {
      bb = _bboxPuntos(placements[i].puntos);
      if (!bb) continue;
      for (k = 0; k < 3; k++) {
        e = ejes[k];
        lim = _semiHost(host, e) + (e === ejeRumbo ? holgura : 0);
        if (!(lim > 0)) continue;
        exc = Math.max(bb.max[e] + r - lim, -lim - (bb.min[e] - r));
        if (exc > peor) {
          peor = exc; ejePeor = e;
          capaPeor = (placements[i].meta && placements[i].meta.capa) || null;
        }
      }
    }
    if (peor <= _EPS_POS || !ejePeor) return;
    _avisar(base, 'Fierro FUERA del hormigón: ' + (Math.round(peor * 100) / 100) +
      ' cm por el eje ' + ejePeor + (capaPeor > 1 ? ' (capa ' + capaPeor + ')' : '') +
      '. Se dibuja igual —el dato tiene que verse—, pero esa barra no es construible: ' +
      'revisa la figura, el diámetro (el gancho normativo es 10φ) o el Sep de las capas.');
  }

  // ¿El bbox `a` está CONTENIDO en `b`? (tolerancia de coma flotante; con gap 0 las
  // capas coinciden exactamente y eso SÍ es contención).
  function _bboxContenido(a, b) {
    var ejes = ['x', 'y', 'z'], e;
    for (var i = 0; i < ejes.length; i++) {
      e = ejes[i];
      if (a.min[e] < b.min[e] - _EPS_BBOX) return false;
      if (a.max[e] > b.max[e] + _EPS_BBOX) return false;
    }
    return true;
  }
  var _EPS_BBOX = 1e-6;

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
    // MISMA fuente que distribuidorLinear (eje libre + paso real + tramos + techo):
    // si el arreglo calculara sus X por su cuenta, la garantía "n_capas=1 == lineal
    // puro" se rompería en cuanto una de las dos ramas cambiara (p.ej. al aceptar
    // tramos), y el rango que pisa el anclaje de cara —el defecto de 390.6 cm—
    // volvería a entrar por ESTE camino, que es justo el que la UI usa en modo
    // Arreglo. Se resuelve UNA vez, fuera de los dos bucles: el aviso es del
    // componente, no de cada copia.
    var rrA = _rangoReparto(base, cfg, host);
    var ejeRA = rrA.eje, posA = rrA.pos;
    // ARREGLO POR ÁREA — la 2ª línea de distribución (ver _arregloPorArea). ADITIVO:
    // sólo entra si la receta trae `rango2` con from/to. Sin él, todo lo de abajo
    // queda EXACTAMENTE como estaba (es la garantía de compatibilidad: hay recetas
    // guardadas y tests que dependen de n_capas/sep_capas/eje_capas).
    if (cfg && cfg.rango2 && cfg.rango2.from != null && cfg.rango2.to != null) {
      var area = _arregloPorArea(base, cfg, host, rrA);
      if (area) return area;
    }
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
        ? _fp().anidarFigura(base.figura, base.dims, c * base.diam, base.rol,
          { sep: off, diamCm: base.diam, angulos: base.anchorBase && base.anchorBase.angulos })
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
        var extra = {};
        if (ejeRA) extra[ejeRA] = xr;   // sin eje libre → la única copia va EN el anclaje
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

  // ---------------------------------------------------------------------------
  // ARREGLO POR ÁREA — DOS LÍNEAS DE DISTRIBUCIÓN (definición del usuario, 14-ago)
  // ---------------------------------------------------------------------------
  // «Es casi como distribución pero aparece una segunda línea de distribución a lo
  //  largo del otro plano; los ejes deben salir de DONDE ingresamos la figura; misma
  //  lógica de snaps y con posibilidad de agregar tramos.»
  //
  // CONTRATO (lo que construye el editor):
  //   distribucion = { modo:'arreglo',
  //                    rango:  { eje, from, to, sep, tramos? },   // 1ª línea
  //                    rango2: { eje, from, to, sep, tramos? } }  // 2ª línea
  // Los dos `eje` se declaran en ejes del MUNDO y `_cfgLocal` los traduce al marco
  // local de la pose, igual que siempre. `from`/`to` son coordenadas absolutas del
  // host (cm) y `tramos` funciona en LAS DOS líneas, con el MISMO redondeo y el
  // MISMO criterio de paso real: las dos salen de `posicionesRango`, que es la única
  // función que sabe repartir un rango en este motor. No se reimplementa nada —
  // reimplementarlo era la vía por la que la garantía "n_capas=1 == lineal puro" se
  // rompió antes.
  //
  // CON QUÉ RESUELVE LOS TRES CASOS DEL USUARIO:
  //   · TRABA CLÁSICA DE MURO      → altura × largo (las dos líneas en el plano de la
  //     cortina; la barra cose el espesor, que es el eje que NO se reparte);
  //   · TRABA DE CONFINAMIENTO     → lo mismo, con tramos en la línea de la altura;
  //   · ESTRIBO DE CONFINAMIENTO   → 1-3 "columnas" cargadas a un costado: la 2ª
  //     línea con 2 o 3 posiciones juntas en un extremo de su rango, que es
  //     exactamente lo que hace el `from/to/@` cuando el tramo es corto.
  //
  // POR QUÉ NO ES "OTRA CAPA": las capas (n_capas/sep_capas) son una PROFUNDIDAD con
  // ANIDADO — la capa k es un anillo concéntrico que encoge. La 2ª línea NO encoge
  // nada: es la misma barra TRASLADADA a otra coordenada, como la 1ª. Por eso acá no
  // entra `anidarFigura` y por eso, si la receta trae las dos cosas, las capas se
  // IGNORAN con aviso en vez de multiplicarse en silencio (rango × rango2 × capas es
  // un volumen, no lo que el usuario pidió).
  //
  // LOS DOS EJES SON DISTINTOS, O NO HAY ÁREA. Si el 2º rango apunta al mismo eje
  // que el 1º, no hay segunda dirección: son dos repartos sobre la misma línea y el
  // resultado sería N×M barras superpuestas. Se ignora el 2º con aviso y el
  // componente sigue por la ruta clásica (n_capas/sep_capas), que es lo que la
  // receta también trae.
  //
  // FIERRO FUERA DEL HORMIGÓN: `from`/`to` son los CENTROS de las barras y la pieza
  // ocupa su propio ancho en cada eje. No se clampa ninguna posición —eso escondería
  // una receta imposible detrás de una barra de aspecto normal—: si la pieza asoma,
  // `_avisarFueraDelHormigon` lo dice con el eje y los centímetros, medido sobre los
  // puntos finales. Un solo canal, el de siempre.
  // Devuelve null cuando el 2º rango no aplica (el llamador sigue por la ruta clásica).
  function _arregloPorArea(base, cfg, host, rr1) {
    var rr2 = _rangoReparto(base, cfg, host, 'rango2');
    if (rr2.eje && rr1.eje && rr2.eje === rr1.eje) {
      _avisar(base, '2º rango ignorado: reparte por el MISMO eje (' + rr2.eje +
        ') que el primero, así que no hay una segunda dirección — serían barras una ' +
        'encima de otra. Elige el otro eje del plano.');
      return null;
    }
    var nCapasPed = (cfg && Number(cfg.n_capas)) || 1;
    if (nCapasPed > 1) {
      _avisar(base, 'Capas ignoradas: con un 2º rango la segunda línea de distribución ' +
        'ya es el arreglo por área (n_capas = ' + nCapasPed + ' describiría una tercera ' +
        'dirección). Se reparte rango × 2º rango.');
    }
    var placements = [], i, j;
    for (j = 0; j < rr2.pos.length; j++) {
      for (i = 0; i < rr1.pos.length; i++) {
        // MISMO techo que el resto del motor: el producto de las dos líneas explota
        // igual de rápido que rango × capas (un 400@10 por un 250@10 son 10 400
        // barras). Corta los DOS bucles y deja el porqué a la vista.
        if (placements.length >= TOPE_PLACEMENTS_COMP) {
          _avisar(base, _avisoTope((cfg.rango && cfg.rango.sep) || (cfg && cfg.sep)));
          return placements;
        }
        var extra = {};
        if (rr1.eje) extra[rr1.eje] = rr1.pos[i];
        if (rr2.eje) extra[rr2.eje] = rr2.pos[j];
        var anchor = _mezclarAnchor(base.anchorBase, extra);
        var puntos = _fp().figuraAPuntos(base.figura, base.dims, host, anchor,
          { rol: base.rol || 'estribo', diamCm: base.diam });
        // `fila` = la posición en la 2ª línea. NO se llama `capa` a propósito: una
        // capa implica anidado/profundidad y acá no hay ninguno de los dos.
        placements.push(_placement(base, puntos, { rango: i + 1, fila: j + 1 }));
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
    var tieneRot = orient && orient.deg && isFinite(orient.deg);
    var tieneSpin = orient && orient.spin && isFinite(orient.spin);
    // TRASLACIÓN ANCLADA (ver «ANCLAJE POR DISTANCIA AL BORDE»): el hint se ancla
    // contra ESTE host si todavía no lo estaba —derivado de la posición que la barra
    // tiene AHORA, así que una receta abierta con su geometría original no se mueve—
    // y se resuelve. Sin esto la barra arrastrada se quedaba en su x ABSOLUTA: 50 cm
    // del testero en una viga de 600 pasaban a ser 150 cm al llevarla a 800. El
    // anclaje ocurre más abajo, cuando ya está calculada la BASE (§2bis).
    var tieneTras = _hayPosHint(comp);
    if (!tieneRot && !tieneSpin && !tieneTras) return placements;
    var rad = tieneRot ? (Number(orient.deg) * Math.PI / 180) : 0;
    var radSpin = tieneSpin ? (Number(orient.spin) * Math.PI / 180) : 0;
    var eje = (orient && orient.eje) || 'x';
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
    // 2bis) LA BASE: dónde queda la pieza SIN traslación manual (ya girada y ya
    //    re-anclada), medida en el centro de su bbox. Es la referencia contra la que
    //    el hint deja de ser un delta suelto y pasa a describir una POSICIÓN: el
    //    ancla guarda `base + hint` y el hint se re-deriva de ella en cada
    //    generación. Se calcula acá y no antes porque antes NO EXISTE: los puntos
    //    todavía no están girados ni re-anclados.
    //    El bbox es el de TODAS las barras del componente: el hint mueve el
    //    componente entero como cuerpo rígido, así que su posición es la del grupo.
    var dx = 0, dy = 0, dz = 0;
    if (tieneTras) {
      var bbB = _bboxLista(giradas);
      var basePos = bbB
        ? { x: bbB.c.x + r.x, y: bbB.c.y + r.y, z: bbB.c.z + r.z } : null;
      anclarPosHint(comp, host, false, basePos);
      var phR = posHintResuelto(comp, host, basePos);
      dx = phR.x; dy = phR.y; dz = phR.z;
      // EL HINT GUARDADO ES EL DERIVADO (mismo trato que rango.from/to): así el
      // panel, el próximo arrastre —que parte del hint que hay— y generar.js
      // (que se lo descuenta para saber qué caras ocupa la barra) leen el número
      // que el motor acaba de aplicar, y no uno de una geometría anterior.
      var phG = comp.pos_hint;
      for (var iE = 0; iE < _EJES_HINT.length; iE++) {
        var eH = _EJES_HINT[iE];
        if (phG[eH] == null || !isFinite(Number(phG[eH]))) continue;
        if (Math.abs(phR[eH] - Number(phG[eH])) > _EPS_ANCLA) phG[eH] = phR[eH];
      }
    }
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
    normalizarComponente(comp);   // normalizador COMPLETO: deja la vista canónica
    // Distribución CANÓNICA (con el `modo` derivado cuando la receta vieja no lo
    // traía): sin esto el switch de _despachar cae en `default` → 0 barras mudas.
    var dist = _distDe(comp);
    // ORIENTACIÓN = permutación de ejes REAL: se expande contra el host permutado
    // y se devuelven los puntos al mundo. 'acostada' → ruta idéntica a la anterior.
    var P = _permDe(comp);
    if (!P) {
      var baseAc = _baseDeComponente(comp, host);
      var plsAc = _despachar(comp, baseAc, dist, host);
      var finAc = _aplicarPostTransform(plsAc, comp, host);
      // El chequeo va sobre los puntos FINALES (los que se ven), y ANTES de
      // cosechar: los avisos viajan al componente en un solo lugar.
      _avisarFueraDelHormigon(baseAc, comp, finAc, host);
      _cosecharAvisos(comp, baseAc);   // capas omitidas → visibles en la UI
      return finAc;
    }
    var hostEf = _hostPermutado(host, P);
    // recubExtremo = el recub de las caras del MUNDO que ahora cierran el eje
    // longitudinal local (volteada → las laterales; de pie → las de borde).
    var base = _baseDeComponente(comp, hostEf, { recubExtremo: _recubDeEje(host, P.x) });
    var placements = _despachar(comp, base, _cfgLocal(dist, P), hostEf);
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
    var ejeRango = (dist && dist.rango && dist.rango.eje) || null;   // eje MUNDO del reparto
    _restituirCentroVolteo(placements, ref, comp, host, ejeAncla, ejeRango);
    var fin = _aplicarPostTransform(placements, comp, host);
    // Los avisos SON los de la expansión REAL (la permutada), no los de `ref`:
    // la referencia acostada es un cálculo auxiliar que no se dibuja. Y el chequeo
    // de "fuera del hormigón" mide los puntos FINALES, ya devueltos al mundo.
    _avisarFueraDelHormigon(base, comp, fin, host);
    _cosecharAvisos(comp, base);
    return fin;
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

  function _restituirCentroVolteo(placements, ref, comp, host, ejeAncla, ejeRango) {
    if (!placements || !placements.length || !ref || !ref.length || !host) return placements;
    var bb = _bboxLista(placements.map(function (p) { return p.puntos; }));
    var bbRef = _bboxLista(ref.map(function (p) { return p.puntos; }));
    if (!bb || !bbRef) return placements;
    var dimHost = { x: Number(host.largo), y: Number(host.alto), z: Number(host.ancho) };
    // MÁS POSICIONES QUE SON UN DATO (17-ago), hermanas del eje del rango:
    //   · el eje de la 2ª LÍNEA del arreglo — su coordenada la puso el reparto;
    //   · los ejes donde el Δ del marco viene CARGADO A UN LADO (extremo
    //     fin/ini): el usuario dijo «achícalo y déjalo en ese costado». Un
    //     estribo así achicado quedaba «puntual» (span < 30% del host) y la
    //     restitución lo devolvía al medio deshaciendo el gesto (reporte:
    //     «si uso distribución me tira la barra al medio»). Con Δ centrado o
    //     sin Δ direccional nada cambia (byte-idéntico).
    var esDato = { x: false, y: false, z: false };
    var dist2 = comp && comp.distribucion;
    if (dist2 && dist2.rango2 && dist2.rango2.eje) esDato[dist2.rango2.eje] = true;
    var dlDir = _deltaMarcoSeccion(comp, [], host);
    if (dlDir && (dlDir.altoDir || dlDir.anchoDir)) {
      var PD = _permDe(comp);
      if (dlDir.altoDir) esDato[PD ? PD.y : 'y'] = true;
      if (dlDir.anchoDir) esDato[PD ? PD.z : 'z'] = true;
    }
    var d = { x: 0, y: 0, z: 0 }, restituye = false;
    ['x', 'y', 'z'].forEach(function (e) {
      if (!isFinite(dimHost[e]) || dimHost[e] <= 0) return;
      if (e === ejeAncla) return;                                           // se ANCLA (ver expandirComponente)
      // …y el eje del RANGO tampoco: ahí la posición es un DATO del reparto
      // (medido 14-ago: una traba de_pie repartida en x=100..200 aterrizaba en
      // −50..50 porque la restitución la devolvía al centro de la referencia).
      if (e === ejeRango) return;
      if (esDato[e]) return;                                                // posición = dato del usuario
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
  //   (el rol traba murió en el motor: una traba es un longitudinal más)
  // `nivel` (3er arg) = nivel DECLARADO; sin declarar, insetJ = 0 → idéntico a
  // medir contra el recubrimiento (comportamiento histórico de las recetas).
  // `profConsumida` (cm) = lo que la CAPA de esta copia ya se metió hacia el núcleo
  // por la normal de su cara. Sólo lo pasa distribuidorLayered para las capas k>0
  // de una pieza LONGITUDINAL; ver ahí el porqué (el 'auto' de un lado ⊥ mide
  // desde donde la pieza ESTÁ, y la capa k no está donde la capa 1).
  // `avisos` (5º arg, opcional) = lista donde escribir lo que el Δ deje imposible.
  // Es la MISMA lista de `base.avisos` que ya cosecha expandirComponente: el Δ no
  // estrena canal.
  function _dimsEfectivas(comp, host, nivel, profConsumida, avisos) {
    var dims = {};
    // DECLARACIÓN CANÓNICA, no `comp.dims` crudo: acá entran recetas del Template
    // Editor ({modo,valor}) y del ENFIERRADOR (número plano), y las dos tienen que
    // leerse igual. Antes un número plano no matcheaba `d.modo === 'fija'` y la dim
    // fijada por el usuario se resolvía como 'auto' — el valor se perdía en silencio.
    var g = _dimsDecl(comp);
    // Medidas fijas HEREDADAS del par espejo (ver _fijasEspejo): el lado opuesto de
    // un marco cerrado mide lo mismo, así que se resuelve con el número escrito en
    // su par y no con el 'auto' del hormigón. Vacío ({}) en todo lo que no sea un
    // lado del marco de una pieza de sección → el resto queda byte-idéntico.
    var fijEsp = _fijasEspejo(comp);
    var mk = marcoUtilNivel(null, host, (nivel !== undefined) ? nivel : null);
    // Lado LONGITUDINAL del cabezal (B en 10x con patas, A en 101/102): es el
    // ÚNICO que se estira al largo útil. Las PATAS en 'auto' toman la extensión
    // de gancho NORMATIVA (10φ, mín 7.5 más su doblez — la misma regla del motor), NO el largo
    // útil: antes una 105A/106A con todo en auto salía 592+592+… = 29.6 m y
    // 46.7 kg FANTASMA que validar_geometria aceptaba (hallazgo D2 del
    // verificador de la Tanda 2).
    // DOMINANTE ELEGIDO por el componente (validado). Se resuelve UNA vez y se pasa
    // a TODOS los caminos que preguntan por el dominante: el que estira el auto
    // (_ladoLongitudinal), el que clasifica u/v/d (ejesCadenaLong), el que resuelve
    // la profundidad (autoProfundidadLong) y el que dibuja (anchorBase.ladoDominante).
    // Si uno solo se lo saltara, la barra se mediría con un dominante y se dibujaría
    // con otro — que es exactamente el defecto D1 que ya costó 11 cm de fierro fuera
    // del hormigón cuando medir y dibujar leyeron dos trazos distintos.
    var domOvr = _domElegido(comp);
    // ÁNGULO POR BARRA — se resuelve UNA vez y va a TODAS las medidas que dependen
    // de la DIRECCIÓN de los tramos (la clasificación u/v/d, el 'auto' de sección,
    // la profundidad del longitudinal, los sobres) y al anchor que dibuja. El motivo
    // es el mismo que el del dominante elegido: si una sola de esas rutas leyera el
    // ángulo del catálogo mientras el resto usa el del componente, la barra se
    // mediría con una figura y se dibujaría con otra.
    var angOvr = _angOvr(comp);
    var ladoLong = _ladoLongitudinal(comp.figura, g, domOvr);
    var fpD = _fp();
    // -------------------------------------------------------------------------
    // DOS MARCOS DE MEDIDA, UNA SOLA VERDAD (20-ago)
    // -------------------------------------------------------------------------
    // Esta función resuelve los 'auto' contra el HORMIGÓN, y para eso trabaja en el
    // marco del TRAZO: la cadena de VÉRTICES, que es lo que miden marcoUtilNivel,
    // los solvers de sección/profundidad y sobresCadena. Pero la dim que se LISTA y
    // se CORTA es la de CRESTA (figura_puntos.sobresCresta: lado = tramo recto +
    // R + φ por doblez, definición del usuario). Así que todo el cuerpo de abajo
    // sigue en vértices —sin tocar una sola cuenta— y la conversión ocurre AL
    // FINAL, junto con el redondeo, ANTES de que las dims salgan a dibujar.
    // `dC(k)` = cuánto hay que sumarle al vértice para tener la cresta.
    var phiCm = Number(comp.diam) / 10;
    var sobCresta = (fpD && fpD.sobresCresta)
      ? fpD.sobresCresta(comp.figura, comp._rol, phiCm, angOvr) : {};
    function dC(k) { var v = Number(sobCresta[k]); return isFinite(v) ? v : 0; }
    // Lo que el usuario ESCRIBIÓ es una medida de cresta: a los solvers entra en
    // vértices, y al final vuelve a salir con el número exacto que escribió.
    function fijaVert(k, valor) { return Number(valor) - dC(k); }
    // La pata en 'auto' vale la extensión libre de norma MÁS su doblez (10φ + R + φ,
    // `A = L + R + φ`); en vértices es eso menos su propio sobre, que para un gancho
    // de más de 90° devuelve exactamente la extensión libre (trazo intacto) y para
    // uno de 90° la deja por fin completa (antes el fillet se comía el setback).
    var ganchoCresta = (fpD && fpD.ganchoAutoCresta) ? fpD.ganchoAutoCresta(phiCm)
      : Math.max(10 * phiCm, 7.5) + 3 * phiCm;
    function ganchoAutoDe(k) { return ganchoCresta - dC(k); }

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
    var ejesSec = (fpD && fpD.ejesCadenaSeccion && comp._rol === 'estribo')
      ? fpD.ejesCadenaSeccion(comp.figura, comp._rol, angOvr) : null;
    // Y el valor de ese 'auto' RESERVA los quiebres, igual que el auto-largo del
    // longitudinal reserva los sobres de las puntas (fpD.sobresCadena).
    var autoSec = null;
    if (ejesSec) {
      var baseSec = {};
      Object.keys(g).forEach(function (k) {
        var d = g[k];
        if (d && d.modo === 'fija') baseSec[k] = fijaVert(k, d.valor);
        else if (ejesSec[k] === 'd') baseSec[k] = ganchoAutoDe(k);   // diagonal = pata
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
        { u: mk.anchoUtil - phiSec, v: mk.altoUtil - phiSec }, phiSec, angOvr);
    }
    // AUTO UNIVERSAL DEL LONGITUDINAL (feedback de raíz 13-ago): el lado de un
    // cabezal que corre PERPENDICULAR al dominante cruza la PROFUNDIDAD de la
    // pieza (en un muro, el espesor): su 'auto' es la profundidad ÚTIL eje a
    // eje — la fórmula del estribo —, no el gancho. Diagonales y retornos
    // paralelos siguen al gancho normativo. Es la misma cuenta exacta del
    // 'auto' de sección (fpD.autoProfundidadLong reusa _intervaloCabe sobre el
    // trazo arqueado), medida en el marco del dominante.
    var ejesLong = null, autoProf = null;
    if (comp._rol === 'cabezal' && fpD && fpD.ejesCadenaLong) {
      ejesLong = fpD.ejesCadenaLong(comp.figura, domOvr, angOvr);
      var tieneV = false, kk;
      if (ejesLong) {
        for (kk in ejesLong) {
          if (Object.prototype.hasOwnProperty.call(ejesLong, kk) && ejesLong[kk] === 'v' &&
              g[kk] && g[kk].modo !== 'fija') { tieneV = true; break; }
        }
      }
      if (tieneV && fpD.autoProfundidadLong) {
        var baseLong = {};
        Object.keys(g).forEach(function (k2) {
          var d2 = g[k2];
          if (d2 && d2.modo === 'fija') baseLong[k2] = fijaVert(k2, d2.valor);
          else if (k2 === ladoLong) baseLong[k2] = 1000;         // placeholder: sólo mueve u
          else if (ejesLong[k2] !== 'v') baseLong[k2] = ganchoAutoDe(k2);
        });
        // Profundidad útil de la POSE: de la cara de anclaje a la opuesta, entre
        // pilas (marcoUtilNivel), eje a eje (−φ). caraLocal lateral = local z
        // (anchoUtil, p.ej. el espesor del muro); sup/inf = local y (altoUtil).
        var phiL = Number(comp.diam) / 10 || 0;
        var caraL = derivarPose(poseDe(comp)).caraLocal;
        // …MENOS LO QUE LA CAPA YA SE COMIÓ. La capa k de un longitudinal entra
        // k·gap hacia el núcleo: desde ahí a la cara opuesta hay k·gap menos, y el
        // 'auto' de un lado ⊥ es justo esa distancia. Sin esto la profundidad se
        // resolvía SIEMPRE contra el marco de la capa 1 y la capa k salía por el
        // otro lado — el usuario no fijó esa medida, la eligió el motor.
        var profUtil = ((caraL === 'lateral') ? mk.anchoUtil : mk.altoUtil) - phiL -
          (Number(profConsumida) || 0);
        autoProf = fpD.autoProfundidadLong(comp.figura, baseLong, profUtil, phiL, domOvr, angOvr);
      }
    }
    // ROMBO DE SECCIÓN (106A y familia, fix 13-ago): el MARCO manda la forma —
    // el trazado va pegado al recubrimiento (como el 104D) y las dims que se
    // LISTAN se derivan de esa geometría (medir = dibujar).
    var dimsRomboVals = (comp._rol === 'estribo' && fpD && fpD.esEstriboConGanchos &&
      fpD.esEstriboConGanchos(comp.figura) && fpD.dimsEstriboGanchos)
      ? fpD.dimsEstriboGanchos(comp.figura, mk.anchoUtil, mk.altoUtil, Number(comp.diam) / 10 || 0)
      : null;
    // HACIA DÓNDE REDONDEA CADA 'AUTO' (20-ago, decisión del usuario). El redondeo
    // al centímetro no puede ir siempre en la misma dirección: hay dos clases de
    // lado derivado y quieren cosas opuestas.
    //   'arriba' → MÍNIMO NORMATIVO (las patas de gancho): redondear hacia abajo
    //              las dejaría bajo la norma.
    //   'abajo'  → LIMITADO POR EL HORMIGÓN (lo que sale de la luz útil / del marco
    //              de núcleo): redondear hacia arriba metería la barra en el
    //              recubrimiento.
    // Se anota AQUÍ, donde se sabe de dónde salió el número; el redondeo se aplica
    // al final, sobre la medida de cresta.
    var dirRed = {};
    // Las patas DECLARADAS de un marco cerrado (106x A y F) son mínimo normativo
    // igual que cualquier otra pata; el resto de sus lados los fija el marco.
    var gTerm = (fpD && fpD.ganchosTerminales) ? fpD.ganchosTerminales(comp.figura, comp._rol) : null;
    function autoDeLado(k) {
      if (dimsRomboVals && dimsRomboVals[k] != null) {
        dirRed[k] = (gTerm && (gTerm.ini === k || gTerm.fin === k)) ? 'arriba' : 'abajo';
        return dimsRomboVals[k];
      }
      if (ejesSec) {
        var e = ejesSec[k];
        if (e === 'u') { dirRed[k] = 'abajo'; return autoSec.u; }
        if (e === 'v') { dirRed[k] = 'abajo'; return autoSec.v; }
        if (e === 'd') { dirRed[k] = 'arriba'; return ganchoAutoDe(k); }
      }
      dirRed[k] = 'abajo';
      if (comp._rol === 'estribo') return (k === 'A' || k === 'C') ? mk.anchoUtil : mk.altoUtil;
      return mk.altoUtil;   // (sin rol traba en el motor, acá solo llega el estribo)
    }
    // DOS PASADAS: el longitudinal se resuelve AL FINAL porque su reserva (los
    // SOBRES de las puntas inclinadas) depende de las dims de los DEMÁS lados
    // ya resueltos — en una sola pasada la B se calculaba antes que la C y la
    // reserva del extremo final salía con un largo placebo.
    Object.keys(g).forEach(function (k) {
      var d = g[k];
      if (d && d.modo === 'fija') { dims[k] = fijaVert(k, d.valor); return; }
      // ESPEJO: este lado sigue a su par. Lo que hereda es el CRECIMIENTO sobre el
      // 'auto' (ver _fijasEspejo), no el número: así los dos empujan el marco lo
      // mismo y el contorno cierra aunque sus 'auto' no coincidan (106A: 19 y 24).
      if (fijEsp[k]) {
        var Lo = fijEsp[k].de;
        dims[k] = autoDeLado(k) + (fijaVert(Lo, g[Lo].valor) - autoDeLado(Lo));
        return;
      }
      if (k === ladoLong) return;   // 2ª pasada
      // AUTO: deriva según la DIRECCIÓN del lado en la pose (regla universal);
      // sin clasificación (figura sin tramos), cae al gancho de siempre.
      if (comp._rol === 'cabezal') {
        var esProf = (ejesLong && ejesLong[k] === 'v' && autoProf != null);
        dirRed[k] = esProf ? 'abajo' : 'arriba';   // profundidad = hormigón · resto = pata
        dims[k] = esProf ? autoProf : ganchoAutoDe(k);
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
        var sob = (fpS && fpS.sobresCadena)
          ? fpS.sobresCadena(comp.figura, dims, ladoLong, Number(comp.diam) / 10 || 0, angOvr)
          : { ini: 0, fin: 0 };
        dirRed[ladoLong] = 'abajo';   // el largo lo fija la luz útil del hormigón
        dims[ladoLong] = mk.largoUtil - (sob.ini || 0) - (sob.fin || 0);
      } else {
        dims[ladoLong] = autoDeLado(ladoLong);
      }
    }
    // -------------------------------------------------------------------------
    // DE VÉRTICE A CRESTA, Y REDONDEO AL CENTÍMETRO — ANTES DE LA GEOMETRÍA
    // -------------------------------------------------------------------------
    // Hasta acá `dims` está en el marco del TRAZO (vértices). Lo que se lista y se
    // corta es la medida de CRESTA (lado = tramo recto + R + φ por doblez), así que
    // se convierte, y ENSEGUIDA se redondea al centímetro: el usuario lo pidió
    // explícito —«el redondeo ocurre ANTES de construir la geometría, no al
    // mostrar»—, porque figuraAPuntos va a trazar a partir de ESTE número y así la
    // barra dibujada representa la cota, sin descuadre entre el trazo y el rótulo.
    //
    // LO QUE EL USUARIO EXPRESÓ NO SE TOCA JAMÁS. Sólo se redondea el lado 'auto',
    // que lo resolvió el motor; una dim FIJA vuelve a salir con el número exacto
    // que se escribió (por eso se re-lee de `g`, en vez de deshacer la resta y
    // arrastrar el ruido del flotante). El Δ y el empalme se suman DESPUÉS, enteros
    // o no: son del usuario y tampoco se redondean.
    //
    // El lado del que no se sabe la procedencia (sin entrada en dirRed) NO se
    // redondea: preferimos un decimal a inventarle una dirección.
    //
    // Y ANTES DE CONVERTIR SE GUARDA LA CADENA DE VÉRTICES: es con ella —no con la de
    // cresta— con la que se decide TOPOLOGÍA más abajo (si la figura CIERRA). Sumarle
    // el sobre a cada lado puede hacer que un contorno cerrado deje de cerrar por unos
    // milímetros, y eso cambiaría qué lado es el longitudinal y quién recibe el empalme.
    var dimsVert = {}; Object.keys(dims).forEach(function (kv) { dimsVert[kv] = dims[kv]; });
    var _lados = Object.keys(dims), _i, _k, _dd, _v;
    for (_i = 0; _i < _lados.length; _i++) {
      _k = _lados[_i]; _dd = g[_k];
      if (_dd && _dd.modo === 'fija') { dims[_k] = Number(_dd.valor); continue; }
      _v = Number(dims[_k]) + dC(_k);
      if (!isFinite(_v)) { dims[_k] = _v; continue; }
      if (dirRed[_k] === 'arriba') _v = Math.ceil(_v - 1e-9);
      else if (dirRed[_k] === 'abajo') _v = Math.floor(_v + 1e-9);
      dims[_k] = _v;
    }
    // AVISO UNIVERSAL DEL LADO ≤ 0 (15-ago). El único aviso de "no construible"
    // vivía DENTRO del bucle del Δ: una fija negativa, o un AUTO que resuelve
    // negativo por la pose (medido: 103B girada en una viga angosta → B = −20.03),
    // llegaban MUDOS al payload — kg negativos sin una palabra. Acá se barre el
    // RESULTADO, venga de donde venga; si el Δ ya avisó de ese lado (su mensaje
    // nombra «lado X»), no se repite.
    if (avisos) {
      Object.keys(dims).forEach(function (kNeg) {
        var vNeg = Number(dims[kNeg]);
        if (!isFinite(vNeg) || vNeg > 0) return;
        var ya = avisos.some(function (a) { return String(a).indexOf('lado ' + kNeg) >= 0; });
        if (!ya) {
          avisos.push('El lado ' + kNeg + ' queda en ' + (Math.round(vNeg * 100) / 100) +
            ' cm: esa barra no es construible (revisa la medida, el Δ o la pose). ' +
            'El despiece la va a rechazar.');
        }
      });
    }
    // -------------------------------------------------------------------------
    // MEDIO DIÁMETRO CONTRA FIERRO — BLOQUE RETIRADO (13-ago), Y POR QUÉ
    // -------------------------------------------------------------------------
    // Historia: las dims de la familia CABEZAL son de EJE A EJE, pero el marco útil
    // devuelve la CARA de lo que hay al lado; contra FIERRO la pata de la capa de
    // adentro terminaba EXACTAMENTE en el eje del estribo, o sea METIDA φ_propio/2
    // dentro de él («el corchete muerde el estribo»). Este bloque restaba φ/2 por
    // cada extremo del tramo que termina en pata, pero SÓLO contra fierro.
    //
    // El feedback de raíz del 13-ago convirtió esa regla en UNIVERSAL —la CRESTA
    // del codo, no su eje, es la que queda en línea con el borde, contra fierro Y
    // contra hormigón— y la migración cabezal → trazador la puso donde
    // corresponde: `figura_puntos.sobresCadena` (su `rphi`) reserva ese mismo φ/2
    // sobre el TRAZO DIBUJADO. Los números vivos están en la sección G de
    // tests/test_pilas_caras.js (B = 18.8 con recub 4 y punta tangente al estribo a
    // 1.2 = φest/2 + φ/2; B = 590.4 contra hormigón pelado; 101A recta sin
    // descuento) y todos salen de sobresCadena.
    //
    // POR QUÉ SE RETIRA EN VEZ DE DEJARLO "por si acaso": el bloque estaba acotado
    // con `!esCadenaMD` y su comentario decía que quedaba vivo «sólo para el marco
    // cerrado de 4 lados colocado con rol cabezal». ESO ERA FALSO y se midió: un
    // marco cerrado NUNCA llega acá con rol cabezal, porque `_baseDeComponente`
    // re-deriva el rol por TOPOLOGÍA (familiaDeDibujo === 'estribo' → rol
    // 'estribo'). Barriendo las 62 figuras del catálogo, las que podían entrar al
    // bloque eran exactamente UNA —la 101A, familia 'recta'— y con nPatas = 0, o
    // sea sin restar nada: el bloque era código MUERTO con una historia que no se
    // cumplía. Un bloque muerto que además explicaba mal de dónde salen los
    // números es peor que no tenerlo: manda a leer una línea que no interviene.
    // (Con él o sin él, las 22 suites dan idénticas: se comprobó restaurándolo.)
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
    // Se re-consulta con las dims YA RESUELTAS (no con las declaradas): para una
    // cadena, `_ladoLongitudinal` decide con ellas si la figura CIERRA, y una
    // cerrada devuelve null = no hay lado que empalmar. Con las de VÉRTICE: son
    // las que trazan el contorno.
    var lado = _ladoLongitudinal((comp.figura || '').toUpperCase(), dimsVert, domOvr);
    if (comp._rol === 'cabezal') {
      var empTot = _empalmeTotalCm(comp, Number(comp.diam) / 10);
      if (empTot > 0 && dims[lado] != null) dims[lado] = Number(dims[lado]) + empTot;
    }
    // -------------------------------------------------------------------------
    // Δ POR DIMENSIÓN — SE APLICA AL FINAL, SOBRE EL LARGO YA RESUELTO
    // -------------------------------------------------------------------------
    // El Δ es lo ÚLTIMO que pasa, y es deliberado: es un ajuste sobre la medida —
    // «este lado, el que sea que te haya dado, 12 cm más» —, no una entrada del
    // solver. Si entrara antes, un +2 cm podría re-decidir TOPOLOGÍA (si la cadena
    // cierra, y por lo tanto qué lado es el longitudinal y cuál recibe el empalme)
    // y el usuario vería moverse cosas que no tocó. Después del empalme por la
    // misma razón: los dos son largo extra y se SUMAN, ninguno reemplaza al otro.
    //
    // EL Δ VIAJA AL DESPIECE POR CONSTRUCCIÓN. `dims` es lo que va al placement, y
    // generar.js copia `pl.dims[L]` a `dim_a..dim_i` tal cual y estima el largo
    // como suma de lados: no hace falta —ni se debe— agregarle una rama que sepa
    // del Δ. El largo de corte y los kg lo incluyen porque el Δ ES parte de la dim.
    //
    // SIN CLAMP (regla del proyecto). Un Δ negativo que deja el lado en 0 o menos
    // NO se aplasta a 0: se deja el número tal cual —para que se VEA en la ficha y
    // en el 3D— y se AVISA. Aplastarlo escondería una receta imposible detrás de
    // una barra de aspecto normal, que es exactamente el patrón que trajo los
    // defectos de las tandas anteriores.
    var deltas = _deltasEfectivos(comp), kD, antes;
    for (kD in deltas) {
      if (!Object.prototype.hasOwnProperty.call(deltas, kD)) continue;
      if (dims[kD] == null) continue;        // lado que esta figura no resuelve
      antes = Number(dims[kD]);
      dims[kD] = antes + deltas[kD].delta;
      if (!(dims[kD] > 0)) {
        _avisarEn(avisos, 'Δ ' + _num2(deltas[kD].delta) + ' cm en el lado ' + kD +
          (deltas[kD].origen === 'espejo' ? ' (espejo de ' + deltas[kD].de + ')' : '') +
          ': lo deja en ' + _num2(dims[kD]) + ' cm (medía ' + _num2(antes) + '). ' +
          'Se genera igual —el dato tiene que verse— pero esa barra no es construible.');
      }
    }
    // -------------------------------------------------------------------------
    // ¿Y CABE A LO LARGO? — EL LÍMITE QUE EL AUTO-LARGO NO ESTABA PONIENDO (21-ago)
    // -------------------------------------------------------------------------
    // El auto del lado longitudinal es `largoUtil − sobres`, y `sobresCadena` mide
    // esos sobres con el longitudinal en un placeholder de 1000 cm. Con esa mentira
    // la punta que se dobla HACIA ADELANTE (giro > 90°) cae siempre DENTRO del tramo
    // y no reserva nada: el auto se queda con el largo útil COMPLETO mientras el
    // trazo ocupa lo que mida esa punta. MEDIDO (muro 600×310×20 recub 2, MV 103C
    // φ8, rumbo z = el espesor, A = 11 auto + Δ 48 = 59): la pata alcanza 41.72 cm
    // sobre z, donde hay 16 útiles, y la barra salía de −20.3 a +20.3 (40.61 de
    // ancho en un muro de 20). Con rumbo x la misma barra cabe y no pasa nada: el
    // defecto sólo asoma cuando el rumbo es el eje CORTO.
    //
    // NO SE CLAMPA NADA: ese bloque es RÍGIDO (su extensión no depende del
    // longitudinal), así que ningún valor de B lo arregla — cambiar B para taparlo
    // sería mentir sobre una figura que no entra. Se mide sobre las dims FINALES
    // (Δ y empalme ya sumados, que es lo que se dibuja) y se DICE con el número que
    // lo causó: qué lado, cuánto ocupa y cuánto hay. El aviso genérico de «fierro
    // fuera del hormigón» sigue saliendo detrás; éste es el que nombra la causa.
    if (avisos && comp._rol === 'cabezal') {
      var fpC = _fp();
      var noCabe = (fpC && fpC.largoCadenaNoCabe)
        ? fpC.largoCadenaNoCabe(comp.figura, comp._rol, dims, lado,
            Number(comp.diam) / 10 || 0, mk.largoUtil, angOvr)
        : null;
      if (noCabe) {
        _avisarEn(avisos, 'El lado ' + noCabe.lados.join('+') + ' ocupa ' +
          _num2(noCabe.ocupa) + ' cm sobre el eje en que corre la pieza, y ahí hay ' +
          _num2(noCabe.util) + ' cm útiles: ningún largo del lado ' + lado +
          ' lo arregla. Se genera igual —el dato tiene que verse— pero hay que ' +
          'acortar ese lado o girar la pieza para que corra por donde sí cabe.');
      }
    }
    return dims;
  }

  // Número corto para los textos de aviso (2 decimales, sin ceros de relleno).
  function _num2(v) { return Math.round(Number(v) * 100) / 100; }

  // Δ del lado DOMINANTE de una pieza longitudinal → {ini, fin} en cm, o null.
  // `dims` son las dims YA RESUELTAS: con ellas _ladoLongitudinal sabe si la cadena
  // cierra (una cerrada devuelve null y no hay dominante que sesgar).
  function _deltaDelDominante(comp, dims, domOvr) {
    if (!comp || comp._rol !== 'cabezal') return null;
    var L = _ladoLongitudinal((comp.figura || '').toUpperCase(), dims, domOvr);
    if (L == null) return null;
    var d = _deltasEfectivos(comp)[L];
    if (!d || !d.delta) return null;
    return (d.extremo === 'ini') ? { ini: d.delta, fin: 0 } : { ini: 0, fin: d.delta };
  }

  // DIMS 'AUTO' PURAS DE LOS LADOS DEL MARCO — la línea base contra el hormigón
  // de AHORA. Se re-resuelve con un clon del componente cuyos lados del marco
  // están en 'auto' pelado (sin medida escrita y sin Δ): es la única forma de
  // saber cuánto se APARTA del hormigón la medida que el usuario fijó, y por lo
  // tanto cuánto tiene que crecer/achicar el marco para dibujarla.
  // El clon hereda por prototipo (`Object.create`) para no perder los campos NO
  // ENUMERABLES que el motor ya publicó en el componente (_rol, _pose, _dist…):
  // copiarlo con un for-in los dejaría fuera y el clon se resolvería con otro rol.
  // Sin `avisos`: lo que diga esta pasada auxiliar ya lo dice la real.
  function _dimsAutoMarco(comp, host, ejes) {
    if (!host) return null;
    var g = _dimsDecl(comp), lim = {}, k;
    for (k in g) {
      if (!Object.prototype.hasOwnProperty.call(g, k)) continue;
      lim[k] = (ejes[k] === 'u' || ejes[k] === 'v') ? { modo: 'auto' } : g[k];
    }
    var clon = Object.create(comp);
    _publicar(clon, '_dims', lim);
    try { return _dimsEfectivas(clon, host, nivelJerarquia(comp.jerarquia), undefined, null); }
    catch (e) { return null; }
  }

  // CRECIMIENTO DEL MARCO POR LADO → { LETRA: {delta, extremo, origen, de} }.
  // Reúne las DOS formas de pedirlo, que se SUMAN igual que se suman en la dim:
  //   · el Δ (relativo al hormigón, con su réplica en el par espejo) — lo de siempre;
  //   · la medida FIJA (absoluta), traducida a `medida − 'auto' de ahora`.
  // Se llama `delta` el campo porque es lo que consume el marco: un crecimiento.
  function _crecMarcoSeccion(comp, ejes, host) {
    var out = {}, deltas = _deltasEfectivos(comp), k;
    for (k in deltas) {
      if (!Object.prototype.hasOwnProperty.call(deltas, k)) continue;
      out[k] = { delta: deltas[k].delta, extremo: deltas[k].extremo,
        origen: deltas[k].origen, de: deltas[k].de };
    }
    var g = _dimsDecl(comp), fijEsp = _fijasEspejo(comp), propias = [];
    for (k in ejes) {
      if (ejes[k] !== 'u' && ejes[k] !== 'v') continue;   // gancho: no mide el marco
      if (g[k] && g[k].modo === 'fija' && isFinite(Number(g[k].valor))) propias.push(k);
    }
    if (!propias.length) return out;               // sin medida escrita: todo igual que antes
    var auto = _dimsAutoMarco(comp, host, ejes);
    if (!auto) return out;
    propias.forEach(function (L) {
      if (auto[L] == null || !isFinite(Number(auto[L]))) return;
      // El Δ se SUMA a la medida fija (es así como se suman en la dim), y el
      // extremo del Δ manda si lo hay — es la perilla que el usuario acaba de
      // tocar; si no, el de la fija, que el tirador escribe con el borde arrastrado.
      var yaD = out[L] ? Number(out[L].delta) : 0;
      var cr = Number(g[L].valor) - Number(auto[L]) + yaD;
      if (!cr) { delete out[L]; return; }          // mide justo el 'auto': nada que crecer
      out[L] = {
        delta: cr,
        extremo: (out[L] && out[L].extremo) ? out[L].extremo : _extremoDe(g[L]),
        origen: 'propio', de: null
      };
    });
    // EL ESPEJO COPIA EL CRECIMIENTO DE SU ORIGEN, TAL CUAL. Recalcularlo desde su
    // propio 'auto' lo dejaría a un redondeo de distancia del otro y el motor
    // cantaría «Δ distintos — el contorno no cierra» por medio centímetro.
    for (k in fijEsp) {
      if (!Object.prototype.hasOwnProperty.call(fijEsp, k)) continue;
      var src = out[fijEsp[k].de];
      if (!src) { delete out[k]; continue; }       // el origen no crece: el espejo tampoco
      out[k] = { delta: src.delta, extremo: src.extremo, origen: 'espejo', de: fijEsp[k].de };
    }
    return out;
  }

  function _extremoDe(d) {
    var e = d && d.extremo;
    return (e === 'ini') ? 'ini' : (e === 'fin' ? 'fin' : 'centro');
  }

  // Δ DE UNA PIEZA DE SECCIÓN → CUÁNTO CRECE SU MARCO ({alto, ancho} en cm, o null).
  // ---------------------------------------------------------------------------
  // Una pieza de sección CERRADA no se dibuja con sus dims: su forma la manda el
  // marco de núcleo y las dims se DERIVAN de él. Un Δ que sólo sumara a la dim
  // movía el largo de corte y los kg y dejaba el trazo 3D quieto — MEDIDO en la
  // viga-semilla: ES 104D con Δ +5 en B daba dims 52 → 57 y perímetro dibujado
  // 169.2137 en los dos casos. Traduciendo el Δ a crecimiento del MARCO, la dim
  // derivada y el trazo vuelven a salir del mismo número.
  //
  // CADA EJE CRECE UNA VEZ, NO UNA POR LADO. El alto de un estribo lo miden B y D
  // —el mismo alto visto dos veces—, así que un Δ de +5 replicado en el par es un
  // marco 5 cm más alto, no 10. Por eso se toma el Δ del eje, no la suma: sumarlos
  // doblaría el crecimiento y el perímetro dibujado dejaría de coincidir con el
  // largo de corte (que sí sube 10, porque son dos lados de 5 más cada uno).
  //
  // Y LA MEDIDA FIJA ENTRA POR ACÁ TAMBIÉN (21-ago). Hasta hoy sólo el Δ movía el
  // marco, así que el tirador escribía Δ: un ajuste RELATIVO al hormigón. El
  // usuario achicó un estribo de confinamiento a 600 de muro y al bajar el muro a
  // 200 el estribo se achicó DOS VECES (el 'auto' bajó y el Δ seguía montado
  // encima) — MEDIDO: Δ −30 sobre un lado cuyo auto valía 13 dejaba el lado en
  // −17 cm. Arrastrar el tirador significa «que mida esto», y una medida no puede
  // depender de lo que dé el hormigón. Ahora la fija llega al marco traducida al
  // crecimiento que le corresponde CONTRA EL HORMIGÓN DE AHORA (medida − 'auto'),
  // que es lo único que el trazo del marco sabe consumir: el marco mide lo escrito
  // con el muro en 600 y sigue midiéndolo con el muro en 200.
  function _deltaMarcoSeccion(comp, avisos, host) {
    if (!comp || comp._rol !== 'estribo') return null;
    var fp = _fp();
    if (!fp || !fp.ejesMarcoSeccion) return null;
    var ejes = fp.ejesMarcoSeccion(comp.figura, comp._rol);
    if (!ejes) return null;                       // se dibuja con sus dims: nada que crecer
    var deltas = _crecMarcoSeccion(comp, ejes, host), acc = { u: null, v: null }, k, e;
    // HACIA DÓNDE crece/acorta el marco (pedido 15-ago). Por defecto CENTRADO —el
    // contorno cerrado crecía siempre simétrico—, pero un estribo de confinamiento
    // se acorta y se CARGA A UN LADO. La dirección la da el `extremo` de la dim
    // que trae el Δ: 'ini' = hacia el borde negativo del eje · 'fin' = hacia el
    // positivo · cualquier otra cosa (o nada) = centrado, como antes.
    var dir = { u: 0, v: 0 };
    for (k in deltas) {
      if (!Object.prototype.hasOwnProperty.call(deltas, k)) continue;
      e = ejes[k];
      if (e !== 'u' && e !== 'v') continue;
      if (deltas[k].origen !== 'propio') continue;      // la réplica no vota
      dir[e] = (deltas[k].extremo === 'ini') ? -1 : (deltas[k].extremo === 'fin' ? 1 : 0);
    }
    for (k in deltas) {
      if (!Object.prototype.hasOwnProperty.call(deltas, k)) continue;
      e = ejes[k];
      if (e !== 'u' && e !== 'v') continue;       // gancho: no lleva medida del marco
      if (acc[e] == null) { acc[e] = deltas[k].delta; continue; }
      if (Math.abs(acc[e] - deltas[k].delta) > 1e-9) {
        // Los dos lados que miden LA MISMA medida del marco piden Δ distintos. El
        // trazo del marco es un rectángulo: no existe un rectángulo cuyos dos lados
        // opuestos midan cosas distintas, así que se dibuja el MAYOR (la envolvente
        // real de la barra) y se avisa. Las dims NO se tocan: cada una conserva el
        // número que escribió el usuario, que es lo que se corta.
        _avisarEn(avisos, 'Δ distintos en los dos lados que miden el mismo ' +
          (e === 'u' ? 'ancho' : 'alto') + ' (' + _num2(acc[e]) + ' y ' +
          _num2(deltas[k].delta) + ' cm): el contorno no cierra. Se dibuja el mayor; ' +
          'el largo de corte respeta cada lado tal como se escribió.');
        acc[e] = Math.max(acc[e], deltas[k].delta);
      }
    }
    if (acc.u == null && acc.v == null) return null;
    return { ancho: acc.u || 0, alto: acc.v || 0, anchoDir: dir.u, altoDir: dir.v };
  }

  // ---------------------------------------------------------------------------
  // LADOS CON MEDIDA EXPRESADA POR EL USUARIO → { LETRA: 'fija' | 'delta' }
  // ---------------------------------------------------------------------------
  // Un lado en 'auto' SIN Δ no lo escribió nadie: lo resolvió el motor contra el
  // hormigón, así que el trazo y la dim salen del mismo sitio por construcción y
  // no hay nada que avisar. Los otros dos casos SÍ son una petición del usuario y
  // por lo tanto sí pueden quedar mudos si el trazo no los lee:
  //   'fija'  = escribió el número (dims[L] = {modo:'fija', valor});
  //   'delta' = escribió un Δ sobre la medida que resolvió el motor (incluido el
  //             replicado en el par espejo — es el mismo movimiento del contorno).
  // Un lado con las dos cosas cuenta como 'fija': es la petición más fuerte y es
  // la que decide qué aviso corresponde (la del Δ ya está cubierta por la fija).
  function _ladosExpresados(comp) {
    var g = _dimsDecl(comp), out = {}, k, d;
    for (k in g) {
      if (!Object.prototype.hasOwnProperty.call(g, k)) continue;
      d = g[k];
      if (d && typeof d === 'object' && d.modo === 'fija') out[k] = 'fija';
    }
    var fEsp = _fijasEspejo(comp);      // la medida heredada del par también la expresó el usuario
    for (k in fEsp) {
      if (!Object.prototype.hasOwnProperty.call(fEsp, k)) continue;
      if (!out[k]) out[k] = 'fija';
    }
    var del = _deltasEfectivos(comp);
    for (k in del) {
      if (!Object.prototype.hasOwnProperty.call(del, k)) continue;
      if (!out[k]) out[k] = 'delta';
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // GANCHO DECLARADO DE UN MARCO CERRADO → SU LARGO DIBUJADO ({ini, fin}, o null)
  // ---------------------------------------------------------------------------
  // El estribo con ganchos DECLARADOS (106x: A y F son parciales con dim propia)
  // listaba esas dos dims y dibujaba la pata con la constante normativa calculada
  // aparte dentro de `_estriboPerimetral`. Coincidían mientras nadie las tocara;
  // en cuanto el usuario escribía una medida o un Δ, el corte y los kg subían y el
  // trazo se quedaba quieto. MEDIDO en la 106A rol estribo φ8 con Δ +5 en A:
  // dim_a 7.5 → 12.5, largo 167 → 172, kg 138.8 → 139.8 y el perímetro dibujado
  // 169.213659 → 169.213659, o sea 0.000000 de movimiento y 0 avisos. Es el mismo
  // agujero que `marcoDelta` tapó para los lados del rectángulo, en la otra mitad
  // de la figura.
  //
  // AHORA VIAJA SIEMPRE, EXPRESADA O NO (20-ago). Antes sólo se mandaba la pata que
  // el usuario había escrito: con la pata en 'auto' la dim derivada y la del trazo
  // eran el mismo `extGancho` salvo el último bit del flotante, así que callarla no
  // cambiaba nada. Con el REDONDEO al centímetro dejó de ser cierto — MEDIDO en la
  // 106A φ8: la dim 'auto' de cresta vale 10.4 y se lista 11, mientras el trazo
  // seguía con su 8.0, y un Δ +5 movía el corte 5.0 y el dibujo 5.6. Mandándola
  // siempre, el trazo sale del MISMO número redondeado que se corta, que es la
  // razón de ser del redondeo antes de la geometría.
  //
  // `acotarIni`/`acotarFin` conservan la única diferencia que sí importa: una pata
  // DERIVADA (la eligió el motor) se sigue acotando al sitio real del marco —el
  // clamp que impide que un anillo anidado ensanche—, y una que ESCRIBIÓ el usuario
  // no se recorta ni a la norma ni al marco: si no cabe, asoma y se ve.
  function _ganchoDimSeccion(comp, dims) {
    if (!comp || comp._rol !== 'estribo') return null;
    var fp = _fp();
    if (!fp || !fp.ganchosTerminales) return null;
    var g = fp.ganchosTerminales(comp.figura, comp._rol);
    if (!g) return null;
    var expr = _ladosExpresados(comp), out = null;
    if (dims[g.ini] != null) {
      out = out || {}; out.ini = Number(dims[g.ini]); out.acotarIni = !expr[g.ini];
    }
    if (dims[g.fin] != null) {
      out = out || {}; out.fin = Number(dims[g.fin]); out.acotarFin = !expr[g.fin];
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // MEDIDAS QUE NO MUEVEN EL TRAZO → SE AVISAN (nunca se callan)
  // ---------------------------------------------------------------------------
  // Cierra el hueco simétrico del que ya existía para el ángulo. Para el ángulo el
  // motor dice «la figura se dibuja desde el MARCO de la sección, así que el ángulo
  // viaja al despiece pero NO mueve el trazo 3D»; para la DIMENSIÓN no lo decía
  // nadie, y una medida escrita en un lado que el trazo no lee subía el largo de
  // corte y los kg en silencio (MEDIDO: 62 combinaciones figura × lado × rol del
  // catálogo, 0 avisos).
  //
  // NO SE TOCA EL DATO: la dim, el largo de corte y los kg ya son correctos —lo
  // que el usuario pidió es lo que se corta—. El que miente es el 3D, y lo que
  // faltaba es que lo dijera. Tampoco se "arregla" el trazo forzando el marco a la
  // dim: el marco lo fija el hormigón por decisión de producto («el marco manda la
  // forma»), y cambiarlo acá movería estribos que hoy encuadran bien.
  //
  // DOS SITUACIONES DISTINTAS, DOS AVISOS:
  //   · canal null   → esa dim no entra al dibujo por ninguna ruta. Es el caso de
  //     una figura ABIERTA a la que se le puso rol de sección (una 103B como ES):
  //     el trazo sale del marco entero y las dims nunca mandaron nada. Divergencia
  //     PREEXISTENTE —verificada idéntica antes de esta tanda: 103B-ES con dims
  //     fijas 80/80/80 dibuja el mismo perímetro 169.7671 que con las auto
  //     24/52/24— que ahora al menos se ve.
  //   · canal 'marco' + medida FIJA → el lado sí lleva una medida del marco, pero
  //     el marco no se fija con un número: se fija con el hormigón. El Δ sí lo
  //     mueve (crece el marco), y el aviso lo dice para que el usuario tenga a mano
  //     el control que sí funciona.
  //
  // UN AVISO POR SITUACIÓN, NO UNO POR LADO: un estribo con las 4 dims fijas tiene
  // UN problema (el marco no sale de las dims), no cuatro. Repetir el mismo texto
  // cuatro veces con otra letra entierra los avisos que sí son distintos —el de
  // fierro fuera del hormigón, el de la capa que no cabe— en la misma lista.
  function _avisarDimsMudas(comp, dims, avisos) {
    var fp = _fp();
    if (!fp || !fp.canalDelTrazo || !comp || !dims) return;
    var expr = _ladosExpresados(comp), k, canal;
    var mudos = [];
    // Orden ALFABÉTICO de las letras, no el de iteración del objeto: el mismo
    // componente tiene que dar el mismo texto siempre (el aviso se compara para
    // deduplicar y el usuario lo lee dos veces seguidas).
    var letras = Object.keys(expr).sort();
    for (var i = 0; i < letras.length; i++) {
      k = letras[i];
      if (dims[k] == null) continue;             // lado que esta figura no resuelve
      canal = fp.canalDelTrazo(comp.figura, comp._rol, k);
      // 'marco' YA NO ES MUDO (21-ago). Aquí salía «el marco lo fija el HORMIGÓN,
      // no esa dim; para mover el dibujo usa el Δ»: era cierto mientras la medida
      // fija se listaba sin llegar al trazo. Desde que `_crecMarcoSeccion` la
      // traduce a crecimiento del marco, las dos rutas —Δ y medida— mueven el
      // dibujo, y repetir aquel texto mandaría al usuario a la perilla equivocada.
      if (canal === 'dims' || canal === 'gancho' || canal === 'marco') continue;
      mudos.push(k + ' = ' + _num2(dims[k]));
    }
    if (mudos.length) {
      _avisarEn(avisos, _plural(mudos.length, 'Lado', 'Lados') + ' ' + mudos.join(' · ') +
        ' cm: la ' + comp.figura + ' con rol de sección se dibuja desde el MARCO de ' +
        'núcleo y ' + _plural(mudos.length, 'ese lado no lleva', 'esos lados no llevan') +
        ' ninguna medida suya, así que ' + _plural(mudos.length, 'viaja', 'viajan') +
        ' al despiece —largo de corte y kg— pero NO ' +
        _plural(mudos.length, 'mueve', 'mueven') + ' el trazo 3D.');
    }
  }

  function _plural(n, uno, varios) { return (n === 1) ? uno : varios; }

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
  // `domOvr` (3er arg, opcional) = el lado que ELIGIÓ el componente
  // (comp.lado_dominante), YA validado por _domElegido. Entra con prioridad máxima,
  // por delante del catálogo. Ausente (o inválido, que _domElegido convierte en
  // null) → la cascada de siempre, sin un solo cambio de resultado.
  function _ladoLongitudinal(figura, dims, domOvr) {
    // CADENAS (trazador genérico): contrato de 3 valores (ver figura_puntos):
    //   undefined = no es cadena → sigue la cascada de abajo;
    //   null      = cadena CERRADA → no hay lado que estirar (como el estribo):
    //               ni auto-largo ni empalme (dims[null] no existe y los dos
    //               bloques que la usan preguntan por != null).
    var fpL = _fp();
    if (fpL && fpL.ladoLongitudinalCadena) {
      var rL = fpL.ladoLongitudinalCadena(figura, dims, domOvr);
      if (rL !== undefined) return rL;
    }
    if (fpL && fpL.ladoDominanteFigura) {
      var rD = fpL.ladoDominanteFigura(figura, domOvr);
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
  // Con un COMPONENTE respeta su `lado_dominante` (validado); con un código de
  // figura suelto no hay componente del que leerlo y manda la cascada.
  function ladoDominante(comp) {
    if (!comp) return null;
    if (typeof comp === 'string') return _ladoLongitudinal(comp, null);
    return _ladoLongitudinal(comp.figura, comp.dims, _domElegido(comp));
  }

  // ==========================================================================
  // ROL DE UN COMPONENTE — FUENTE ÚNICA (consolidación 15-ago)
  // ==========================================================================
  // La tipología PROPONE y la TOPOLOGÍA de la figura MANDA:
  //   · figura CERRADA (marco 104x, 106x con ganchos) → 'estribo' (pieza de
  //     sección), venga el chip que venga. Un 106A escrito bajo MH entraba al
  //     pipeline de cortina y salía sin sentido.
  //   · 'traba' NO EXISTE (Modelo A, 14-ago): «toda figura entra con su forma de
  //     catálogo; el plano de entrada, el dominante y el borde dan control
  //     absoluto; si dejas reglas, el control se pierde». Una figura ABIERTA bajo
  //     TR/TC/TRV es un longitudinal más; el cruce se logra girando la pieza.
  //   · el resto → 'cabezal' (longitudinal).
  // Se RE-DERIVA en cada pasada (no se cachea): la figura puede cambiar en la
  // ficha y un rol pegado dibujaría la figura nueva con el tren de la vieja.
  //
  // ESTÁ EXPORTADA a propósito: la UI tenía su PROPIA tabla tipología→rol (con
  // 'traba' vivo) y de ahí salieron 4 defectos medidos el 15-ago — el clic que
  // desplazaba una TR 146 cm fuera del hormigón, el check "anidar" pintado sobre
  // un motor que ya no anida, y el empalme y las Patas ocultos en barras a las
  // que el motor SÍ se los aplica. Una sola tabla, un solo lugar.
  function rolDeComponente(comp) {
    if (!comp) return 'cabezal';
    var rol = _rolDeTipologia(comp.tipologia, comp.cara);
    if (rol === 'traba') rol = 'cabezal';
    if (rol === 'cabezal') {
      var fpR = _fp();
      if (fpR && ((fpR.esEstriboConGanchos && fpR.esEstriboConGanchos(comp.figura)) ||
        (fpR.familiaDeDibujo && fpR.familiaDeDibujo(comp.figura, null) === 'estribo'))) {
        rol = 'estribo';
      }
    }
    return rol;
  }

  // opts.recubExtremo: recubrimiento de las caras que cierran el eje LONGITUDINAL
  // local. Sin opts vale el recub vertical (comportamiento histórico); con la pieza
  // VOLTEADA el eje longitudinal local es la Z real, así que su recub es el lateral.
  function _baseDeComponente(comp, host, opts) {
    // ROL DE USO. La tipología lo propone… y la TOPOLOGÍA de la figura manda
    // (definición 13-ago): una figura CERRADA (marco 104x, rombo 106A) es una
    // pieza de SECCIÓN venga el chip que venga — encuadra el marco, no "corre".
    // Un 106A escrito estando en MH entraba al pipeline de CORTINA: defaults de
    // cabezal, su lado B tratado como longitudinal y un dibujo sin sentido.
    // Se RE-DERIVA en cada pasada (no se cachea): la figura puede cambiar en la
    // ficha y un rol pegado dibujaría la figura nueva con el tren de la vieja.
    var rolTip = rolDeComponente(comp);
    // NO ENUMERABLE (mismo criterio que _pose/_avisos/_dims): el rol es DERIVADO y
    // se re-deriva en cada pasada, pero con la asignación normal viajaba dentro de
    // `params` al guardar el template y ensuciaba el dirty-tracking del editor (que
    // compara la receta con JSON.stringify). Los lectores —el editor y los tests—
    // lo leen igual: la enumerabilidad no cambia el acceso.
    _publicar(comp, '_rol', rolTip);
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
    // AVISOS de esta pasada. Se crea ANTES del literal `base` porque las dims —que
    // se resuelven dentro del propio literal— ya pueden tener algo que decir (un Δ
    // que deja un lado en cero). Después es la misma lista de siempre: `base.avisos`
    // la apunta y expandirComponente la cosecha en comp._avisos.
    var avisosBase = [];
    // LADO DOMINANTE ELEGIDO POR EL USUARIO (comp.lado_dominante) — se valida UNA
    // vez acá y desde acá se reparte. Un valor que no sirve NO se aproxima ni se
    // corrige a algo parecido: se IGNORA (manda la figura) y se dice por qué, con
    // el motivo que da figura_puntos.validarLadoDominante.
    var fpDom = _fp();
    var domElegido = _domElegido(comp);
    if (comp.lado_dominante != null && String(comp.lado_dominante).trim() !== '' &&
        !domElegido && fpDom && fpDom.validarLadoDominante) {
      var vDom = fpDom.validarLadoDominante(comp.figura, comp.lado_dominante);
      _avisarEn(avisosBase, 'Lado dominante ' + String(comp.lado_dominante).toUpperCase() +
        ' ignorado: ' + vDom.motivo + '. Manda el de la figura (' +
        (fpDom.ladoDominanteFigura(comp.figura) || '—') + ').');
    }
    // ÁNGULO POR BARRA — se valida UNA vez acá (mismo sitio y mismo criterio que el
    // lado dominante) y desde acá viaja al trazado. Un valor fuera del rango de SU
    // doblez NO se recorta al tope ni se aproxima: se ignora —queda el del
    // catálogo— y se dice por qué, con el motivo que da figura_puntos.validarAngulo.
    var angEfectivos = _angOvr(comp);
    if (fpDom && fpDom.validarAngulo && comp.angulos && comp.angulos.length) {
      for (var iA = 0; iA < comp.angulos.length; iA++) {
        var vA = fpDom.validarAngulo(comp.figura, iA, comp.angulos[iA]);
        if (vA.ok || vA.vacio || !vA.motivo) continue;
        _avisarEn(avisosBase, 'Ángulo ' + (iA + 1) + ' ignorado: ' + vA.motivo +
          '. Manda el del catálogo' + (vA.base != null ? ' (' + vA.base + '°)' : '') + '.');
      }
    }
    // …y un override que el TRAZO no puede honrar tampoco se calla. El marco cerrado,
    // el rombo y la traba clásica derivan su forma del MARCO de núcleo (su gancho es
    // el arco sísmico calibrado), así que ahí el ángulo mueve el dato del despiece
    // pero NO la barra dibujada. Decirlo es la mitad que faltaba de "medir = dibujar".
    if (angEfectivos && fpDom && fpDom.trazoLeeAngulos &&
        !fpDom.trazoLeeAngulos(comp.figura, comp._rol)) {
      _avisarEn(avisosBase, 'Ángulo del componente: la figura ' + comp.figura +
        ' se dibuja desde el MARCO de la sección (su gancho es el arco de norma), ' +
        'así que el ángulo viaja al despiece pero NO mueve el trazo 3D.');
    }
    var base = {
      figura: comp.figura, diam: diamCm,
      // RECETA VIVA: el componente y el host contra los que se resolvieron las
      // dims. Los necesita distribuidorLayered para RE-RESOLVER el 'auto' de una
      // capa (ver ahí): el 'auto' es una respuesta a un marco, y cada capa tiene
      // el suyo. Van con `_` porque son referencia interna del motor, no dato del
      // placement (nada los serializa: `base` no viaja al backend).
      _comp: comp,
      tipologia: comp.tipologia, suf: comp.suf_tipo || '',
      comp_id: (comp.comp_id != null ? comp.comp_id : null),
      prioridad: comp.prioridad != null ? comp.prioridad : null,
      // Nivel DECLARADO ('no' | 1,2,3… | null = auto → default por rol). Gobierna
      // el anclaje (vía _profNivel, que le aplica el default) y el marco útil
      // de las dims 'auto' (sólo si está declarado).
      jerarquia: nivelJerarquia(comp.jerarquia),
      dims: _dimsEfectivas(comp, host, nivelJerarquia(comp.jerarquia), undefined, avisosBase),
      angulos: comp.angulos || null,
      rol: comp._rol,
      // Lo que el motor NO pudo generar (capas anidadas omitidas). Lo llena
      // _avisar desde los distribuidores; expandirComponente lo pasa al comp.
      avisos: avisosBase,
      anchorBase: {
        cara: pz.caraLocal, recub: recub,
        // DOMINANTE ELEGIDO → al TRAZADOR. Es el mismo valor con el que se acaban
        // de resolver las dims, así que dibujo y medida no pueden divergir.
        // undefined cuando no hay elección: el anchor queda como el de siempre.
        ladoDominante: domElegido || undefined,
        // ÁNGULOS EFECTIVOS → al TRAZADOR (y, desde acá, al anidado de las capas).
        // Sólo viaja cuando CAMBIA algo respecto del catálogo: sin override el
        // anchor queda byte-idéntico al de antes de esta tanda.
        angulos: angEfectivos || undefined,
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
    // -------------------------------------------------------------------------
    // Δ DEL DOMINANTE → POR QUÉ PUNTA ASOMA (anchorBase.delta)
    // -------------------------------------------------------------------------
    // La dim del lado dominante YA trae el Δ sumado, así que el trazo ya es más
    // largo. Lo que queda por decir es hacia dónde creció, y sólo hay un sitio del
    // motor donde una pieza NO se centra a ciegas: el sesgo por extremo del
    // longitudinal (figura_puntos._empalmeDeAnchor → _normalizarCadena /
    // _cabezalLongitudinal). Sin esto el Δ se repartiría mitad y mitad, que es
    // responder otra pregunta.
    //
    // SÓLO EL LONGITUDINAL Y SÓLO SU DOMINANTE, y no por pereza:
    //   · una pieza de SECCIÓN (estribo / traba / cadena de sección) se centra en
    //     su marco de núcleo por construcción y no lee este canal — pero es que
    //     además NO LO NECESITA: sus figuras son contornos CERRADOS, donde el Δ va
    //     siempre en PAREJA (B con D, C con E) y el crecimiento es simétrico por
    //     definición. Un 'extremo' ahí describiría un movimiento que no existe.
    //   · un Δ en una PATA desplaza la punta libre de esa pata; el resto de la
    //     cadena la acompaña y el bbox se re-centra igual que hoy. La punta se
    //     mueve — que es lo que el usuario pidió — pero el conjunto no se sesga.
    var dlDom = _deltaDelDominante(comp, base.dims, domElegido);
    if (dlDom) base.anchorBase.delta = dlDom;
    // …y el mismo Δ en una pieza de SECCIÓN crece su MARCO (que es lo que la
    // dibuja). Es el otro extremo del mismo problema que `anchorBase.delta`
    // resuelve para el longitudinal: allá el Δ ya estaba en el trazo y sólo
    // faltaba por qué punta asomaba; acá el trazo no viene de las dims, así que
    // el Δ tiene que entrar por el marco o el dibujo no se entera.
    var dlMarco = _deltaMarcoSeccion(comp, base.avisos, host);
    if (dlMarco) base.anchorBase.marcoDelta = dlMarco;
    // …y en la OTRA mitad de esa misma figura —los ganchos declarados de la 106x—
    // la medida llega entera, no como crecimiento: la pata es un largo, no un lado
    // del rectángulo. Sin este canal el gancho era la última dim del motor que
    // subía el corte y los kg sin mover un milímetro el dibujo.
    var gDim = _ganchoDimSeccion(comp, base.dims);
    if (gDim) base.anchorBase.ganchoDim = gDim;
    // Y lo que NINGÚN canal puede llevar al trazo se DICE. Es el simétrico del
    // aviso que este mismo bloque ya emite para el ángulo: el dato del despiece es
    // correcto, el que miente es el 3D, y callarlo es la clase de defecto que esta
    // tanda existe para cerrar.
    _avisarDimsMudas(comp, base.dims, base.avisos);
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
    if (base.rol === 'estribo') {
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
    _avisarEn(base.avisos || (base.avisos = []), msg);
  }

  // Mismo canal, pero contra la LISTA directa: lo usan los que se ejecutan antes de
  // que exista `base` (las dims se resuelven DENTRO del literal que lo construye).
  function _avisarEn(lista, msg) {
    if (!lista || !msg) return;
    if (lista.indexOf(msg) < 0) lista.push(msg);
  }

  function _cosecharAvisos(comp, base) {
    if (!comp) return;
    // Los avisos del NORMALIZADOR (lo que no se pudo derivar al abrir la receta)
    // salen PRIMERO: son la causa de lo que venga después. Van por el mismo canal
    // para no tener dos sitios donde mirar — la barra de estado del editor ya lee
    // comp._avisos, así que una receta vieja rota se explica sola sin tocar la UI.
    var lista = (comp._migracion && comp._migracion.avisos) ? comp._migracion.avisos.slice() : [];
    lista = lista.concat((base && base.avisos) ? base.avisos : []);
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

  // (el 2º parámetro `cara` se retiró el 15-ago: era el resto de la regla
  //  "cara lateral = traba", que murió con el rol. Los llamadores que lo
  //  pasaban quedan compatibles: JS ignora los argumentos extra.)
  function _rolDeTipologia(tip) {
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
    // NORMALIZADOR DE APERTURA — punto ÚNICO por el que pasa todo componente.
    // Deja la vista canónica en campos NO enumerables (_pose/_jerarquia/_dims/
    // _dist/_migracion) sin reescribir la receta guardada. Idempotente.
    normalizarComponente: normalizarComponente,
    normalizarReceta: normalizarReceta,    // la receta entera (al abrir un template)
    // -------------------------------------------------------------------------
    // ANCLAJE POR DISTANCIA AL BORDE — la posición es INTENCIÓN, no coordenada.
    // La UI escribe from/to y pos_hint SIEMPRE por acá (helper único: la fórmula
    // del "borde más cercano" no puede quedar repartida en cinco sitios) y lee la
    // coordenada ya resuelta contra el hormigón de HOY.
    // -------------------------------------------------------------------------
    anclaDeCoord: anclaDeCoord,        // coordenada → { ref:'min'|'max', d } (null sin dim)
    coordDeAncla: coordDeAncla,        // ancla + dimensión → coordenada
    anclarRango: anclarRango,          // (rango, host, eje, forzar) — escribe rango.ancla
    resolverRango: resolverRango,      // (rango, host, eje) → {from,to,tramos,clamp,avisos}
    // (comp, host, forzar, base) — escribe comp.pos_ancla con la POSICIÓN (base +
    // hint). SIN `base` sólo invalida el eje tocado: la posición la sabe el motor.
    anclarPosHint: anclarPosHint,
    posHintResuelto: posHintResuelto,  // (comp, host, base) → traslación {x,y,z}
    reanclarReceta: reanclarReceta,    // receta entera: ancla lo que falte + re-deriva
    tramosElasticos: _tramosElasticos, // (tramos, diff, avisos?) → el MEDIO absorbe
    migracionDe: migracionDe,              // { derivados, avisos, figura_desconocida }
    dimsDeclaradas: _dimsDecl,             // dims canónicas ({modo,valor} por letra)
    distribucionDe: _distDe,               // distribución canónica (modo resuelto)
    jerarquiaDe: jerarquiaDe,              // { declarada, efectiva, rol }
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
    normalDePieza: normalDePieza,   // normal del plano de la pieza (ESPACIO = girar en su plano)
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
    // ESPEJO contra el plano medio del elemento en un eje del mundo. Devuelve
    // { comp, formaExacta, posicionExacta } — ver su nota larga.
    espejarComponente: espejarComponente,
    POSES_DEFAULT: POSES_DEFAULT,      // tabla de DATOS elemento × tipología
    poseDefault: poseDefault,
    // Lado que se ESTIRA/ancla (elección del componente → cascada catálogo → 'B'
    // → 1er parcial). Con un comp respeta su `lado_dominante` si es válido.
    ladoDominante: ladoDominante,
    // Δ POR DIMENSIÓN, ya con los PARES ESPEJO replicados:
    //   { LETRA: { delta, extremo:'ini'|'fin', origen:'propio'|'espejo', de } }
    // Fuente única para el motor y para la UI (que pinta el par que se mueve junto).
    deltasDeComponente: _deltasEfectivos,
    // Medidas fijas HEREDADAS del par espejo (sólo las que RECIBEN la réplica). La
    // ficha del editor las pinta bloqueadas, igual que hace con el Δ replicado: si
    // no, el lado opuesto de un marco cerrado aparecería en 'auto' mintiendo.
    fijasEspejoDeComponente: _fijasEspejo,
    // Elección de dominante del componente, YA validada (null = no hay o no sirve).
    ladoDominanteElegido: _domElegido,
    rolDeTipologia: _rolDeTipologia,   // jerarquía: generar calcula host.jer_phi
    // ROL DE UN COMPONENTE — el que MANDA (topología sobre tipología). La UI y
    // generar.js consumen ESTE, no una tabla propia: ver su nota.
    rolDeComponente: rolDeComponente,
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
