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
    var y = (anchor.y != null && isFinite(anchor.y)) ? Number(anchor.y) : 0;
    var z = (anchor.z != null && isFinite(anchor.z)) ? Number(anchor.z) : 0;
    var ejeC = (anchor.ejeCara === 'z') ? 'z' : 'y';        // normal de la cara
    var s = (anchor.sentidoCara === 1 || anchor.sentidoCara === -1)
      ? anchor.sentidoCara
      : ((anchor.cara === 'sup') ? -1 : 1);                 // gancho hacia el núcleo
    // Punto del cabezal: x sobre el eje longitudinal; la pata (largo `p`) sale por
    // la normal de la cara. p = 0 → punto del tramo.
    function P(x, p) {
      return (ejeC === 'z') ? V(x, y, z + s * p) : V(x, y + s * p, z);
    }
    var f = (figura || '').toUpperCase();
    // Empalme: cuánto asoma FUERA del hormigón y por qué extremo (dato de
    // trazabilidad; la dim ya viene alargada, aquí sólo se orienta el excedente
    // al extremo indicado en vez de repartirlo simétrico). eIni/eFin en X.
    // Δ INDEPENDIENTE POR EXTREMO: `ini`/`fin` traen los dos valores YA resueltos
    // (reglas._empalmePorExtremo). No son lo mismo ni tienen por qué serlo — una
    // barra empalma 40φ contra la columna de un lado y asoma 15 cm del otro —, así
    // que el asome de cada punta se lee de SU número. El shape antiguo
    // {extremo, valor} sigue funcionando idéntico (fallback de abajo).
    var emp = anchor.empalme || null;
    var eIni = 0, eFin = 0;
    if (emp && (emp.ini != null || emp.fin != null)) {
      eIni = Number(emp.ini) || 0;
      eFin = Number(emp.fin) || 0;
    } else if (emp && emp.valor > 0) {
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
    return [puntaA]
      .concat(codoA)                        // codo A completo (135°)
      .concat([
        { x: xx, y: yInf, z: -w2 },         // esquina inf-izq (90°, fillet del motor)
        { x: xx, y: yInf, z: w2 },          // esquina inf-der (90°)
        { x: xx, y: ySup, z: w2 },          // esquina sup-der (90°)
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
    var m = _marcoNucleo(host, anchor, diamCm);   // eje = recub + φ/2, como el estribo
    var ySup = m.ySup, yInf = m.yInf;  // MISMAS fronteras que el estribo (marco único)
    var xx = anchor.x || 0, zz = anchor.z || 0;
    var g = 0.7071 * (extGancho(diamCm) + diamCm);
    // gancho 135° arriba (diagonal hacia el núcleo) + gancho 90° abajo.
    return [
      V(xx, ySup - g, zz - g), // punta gancho 135° arriba
      V(xx, ySup, zz),         // doblez arriba (a la altura del estribo)
      V(xx, yInf, zz),         // baja al fondo (a la altura del estribo)
      V(xx, yInf, zz - extGancho(diamCm))   // pie gancho 90° abajo
    ];
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

  function figuraCerrada(figura) {
    return (figura || '').toUpperCase().indexOf('104') === 0;
  }

  function anidarFigura(figura, dims, delta, rol, opts) {
    opts = opts || {};
    var dDim = Number(delta) || 0;                                   // δ de dims (k·φ)
    var dSep = (opts.sep != null && isFinite(opts.sep)) ? Number(opts.sep) : dDim;  // δ del marco (k·gap)
    var res = { dims: dims, delta: 0, inset: 0, criterio: 'recta', vecinos: {}, cabe: true, motivo: null };
    var lados = _ladosDeDims(dims);
    var f = (figura || '').toUpperCase();
    // El criterio lo manda la FIGURA; el rol sólo desempata cuando la figura no
    // dice nada: un componente con rol 'estribo' se dibuja SIEMPRE como marco
    // cerrado (_estriboPerimetral), así que su anidado es por inset de marco.
    var abierta = (f.indexOf('103') === 0) && lados.length >= 2;   // U / corchete / L
    var cerrada = !abierta && (opts.cerrada === true || figuraCerrada(f) || rol === 'estribo');
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
    _traba: _traba
  };

  global.ModeladorFiguraPuntos = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
