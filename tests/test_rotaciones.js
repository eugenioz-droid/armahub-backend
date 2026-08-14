// =============================================================================
// GUARD DE ROTACIONES — el que faltaba.
//
// POR QUÉ EXISTE ESTE ARCHIVO. La pieza se gira con la tecla R (rotarPose90 sobre
// un eje del MUNDO) y ese giro re-deriva TODO: cara de anclaje, recubrimiento,
// pilas, permutación local→mundo y las dims en 'auto'. Es la cadena más larga del
// motor y no tenía ni un solo test que la recorriera ENTERA: test_pose verifica el
// GRUPO (las 24 poses, orden 4) y test_muro_auto verifica las DIMS de una pose
// quieta, pero nadie medía la barra RESULTANTE después de girar. Consecuencia: un
// giro mandó fierro fuera del hormigón y llegó al usuario con la suite en verde
// (reportado: el cabezal en cara 'extremo' asomando ~390 cm del muro).
//
// LA REGLA QUE CONGELA — la que el usuario exige, sin excepciones:
//   «después de CUALQUIER giro de 90°, NINGUNA pieza saca fierro del hormigón,
//    y R aplicada 4 veces devuelve la pose EXACTA de partida.»
//
// CÓMO SE MIDE (y por qué así):
//   · A LA CARA DEL FIERRO, no al eje: el placement es el EJE de la barra, así que
//     el acero ocupa eje ± φ/2. Medir el eje contra el borde deja φ/2 de barra
//     fuera del hormigón con el test en verde (es el defecto F2 que ya documenta
//     test_pose; acá se aplica la MISMA vara).
//   · contra los límites REALES del host (±largo/2, ±alto/2, ±ancho/2), no contra
//     el recubrimiento: esto no es un test de recubrimiento —eso lo cubren
//     test_muro_auto y P6 de test_pose— es el mínimo indiscutible: el fierro va
//     DENTRO del hormigón.
//   · sin tolerancia de conveniencia: 1e-6 es ruido de coma flotante, nada más.
//     Si una pieza no cabe, el número tiene que VERSE (dato honesto); acá se
//     imprime cuánto asoma, por qué cara y en qué paso del giro.
//
// LOS CUATRO BLOQUES:
//   R1 · rotarPose90 es CERRADA y BIYECTIVA en las 24 (la aritmética del giro);
//   R2 · la pieza SOLA girada: 2 hosts × 3 roles × 3 ejes × 4 pasos;
//   R3 · la pieza girada CON SU REPARTO — el rango que el giro deja apuntando al
//        eje que ahora es la NORMAL de su cara. Por ACÁ entró el defecto que llegó
//        al usuario, y R2 no lo tocaba: sin R3 este archivo pasaba en VERDE sobre
//        el árbol enfermo (verificado con `git archive HEAD`).
//   R4 · los casos reportados con su cifra congelada (390.6 · 115.4 · 3.9…16.8 cm),
//        más el caso que NO se puede romper arreglándolos (la traba recta).
//
// QUÉ SE GIRA: un componente por ROL —cabezal (103C), estribo (104D) y cadena de
// SECCIÓN (104B con tipología ES)— con TODAS las dims en 'auto', que es como nace
// una pieza desde el editor: el 'auto' es justamente lo que tiene que re-resolverse
// contra lo que la nueva pose CRUZA. Con dims fijas el usuario puede pedir medidas
// que no caben (y entonces asomar es lo correcto), así que ahí no hay regla que
// guardar. Dos hosts de proporciones opuestas —VIGA larga y chata, MURO alto y
// delgado— porque el defecto vive en confundir un eje con otro y en la viga los
// tres ejes son "grandes" en la dirección larga: el muro (espesor 20) es el que
// delata al que resuelve un 'auto' contra el eje equivocado.
//
// Correr con: node tests/test_rotaciones.js
// =============================================================================

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
const CAT = global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function r3(v) { return Math.round(v * 1e3) / 1e3; }
function lim(pl, e) {
  const v = pl.puntos.map(p => p[e]);
  return { lo: r3(Math.min(...v)), hi: r3(Math.max(...v)) };
}
function bbox(pl) {
  return 'x=[' + lim(pl, 'x').lo + ',' + lim(pl, 'x').hi + '] ' +
    'y=[' + lim(pl, 'y').lo + ',' + lim(pl, 'y').hi + '] ' +
    'z=[' + lim(pl, 'z').lo + ',' + lim(pl, 'z').hi + ']';
}
// Etiqueta corta de pose para los mensajes: cara±/rumbo (+ '*' si va espejada).
function poseTxt(p) {
  return p.cara + (p.lado < 0 ? '−' : '+') + '/' + p.rumbo + (p.espejo ? '*' : '');
}
const igualPose = (a, b) => a.cara === b.cara && a.lado === b.lado &&
  a.rumbo === b.rumbo && !!a.espejo === !!b.espejo;

// HOLGURA A LA CARA DEL FIERRO. Devuelve el margen MÍNIMO entre la superficie de la
// barra (eje ± φ/2) y las seis caras del hormigón, y por cuál de ellas se da.
// holgura < 0 ⇒ ESO es fierro fuera del elemento, y su valor absoluto es cuánto.
function holguraAlHormigon(pl, host, diamCm) {
  const r = diamCm / 2;
  const L = { x: host.largo / 2, y: host.alto / 2, z: host.ancho / 2 };
  let min = Infinity, cara = '';
  ['x', 'y', 'z'].forEach(function (e) {
    const l = lim(pl, e);
    const d = [['+' + e, L[e] - (l.hi + r)], ['−' + e, (l.lo - r) + L[e]]];
    d.forEach(function (par) { if (par[1] < min) { min = par[1]; cara = par[0]; } });
  });
  return { holgura: r3(min), cara: cara };
}

// ===========================================================================
// LOS DOS HOSTS Y LOS TRES ROLES
// ===========================================================================
const HOSTS = [
  {
    nombre: 'VIGA', elemento: 'viga',
    host: { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 },
    // Tipologías con las que cada rol NACE en una viga (las que la tabla
    // POSES_DEFAULT conoce): de ahí sale la pose de partida del giro.
    tip: { cabezal: 'CBS', estribo: 'ES', cadena: 'ES' }
  },
  {
    nombre: 'MURO', elemento: 'muro',
    host: { largo: 400, alto: 250, ancho: 20, recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 },
    tip: { cabezal: 'CB', estribo: 'EC', cadena: 'ES' }
  }
];

// Un componente por ROL, TODO en 'auto'. Los tres cubren las tres rutas de dibujo
// distintas del motor: cabezal (plano (L,N), se ancla a una cara), estribo (marco
// cerrado en la sección) y cadena de sección (abierta, trazador genérico).
const COMPS = [
  {
    rol: 'cabezal', figura: '103C', angulos: [45, 45], diam: 16,
    // 1 barra y 1 capa: acá se mide la GEOMETRÍA de la pieza girada, aislada del
    // reparto. El REPARTO —que es por donde entró el defecto de 390.6 cm— lo mide
    // R3, con el rango puesto justo sobre el eje que el giro deja cruzado.
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
  },
  {
    rol: 'estribo', figura: '104D', angulos: null, diam: 8,
    distribucion: { modo: 'linear', rango: { from: 0, to: 0, sep: 20 } }
  },
  {
    rol: 'cadena de sección', figura: '104B', angulos: [45, 45], diam: 8, tipologiaFija: 'ES',
    distribucion: { modo: 'linear', rango: { from: 0, to: 0, sep: 20 } }
  }
];

const autoDims = f => Object.fromEntries((CAT.get(f).parciales || []).map(L => [L, { modo: 'auto' }]));
function receta(H, C, pose) {
  return {
    tipologia: C.tipologiaFija || H.tip[C.rol], figura: C.figura, diam: C.diam,
    angulos: C.angulos, cara: 'lateral',        // campo viejo: sólo lo lee el fallback de pose
    pose: pose ? { cara: pose.cara, lado: pose.lado, rumbo: pose.rumbo, espejo: pose.espejo } : undefined,
    dims: autoDims(C.figura),
    distribucion: JSON.parse(JSON.stringify(C.distribucion))
  };
}

// ===========================================================================
// R1 · LAS 24 POSES — rotarPose90 CERRADA y BIYECTIVA en cada eje
// ===========================================================================
// Antes de medir fierro hay que saber que el giro es una PERMUTACIÓN del grupo: si
// dos poses distintas cayeran en la misma (no biyectiva), girar perdería estados y
// la vuelta con R⁴ sería casualidad. test_pose ya mide el ORDEN de las órbitas;
// acá se mide la otra mitad —cerrada + biyectiva por eje— que es lo que garantiza
// que el barrido de abajo recorre poses REALES y no inventadas.
console.log('R1 — las 24 orientaciones de una caja: giro cerrado y biyectivo:');
const POSES_24 = (function () {
  const m = new Map();
  R.CARAS_POSE.forEach(function (cara) {
    [1, -1].forEach(function (lado) {
      R.rumbosDeCara(cara).forEach(function (rumbo) {   // rumbo ⊥ normal, por construcción
        [false, true].forEach(function (espejo) {
          const p = R.normalizarPose({ cara: cara, lado: lado, rumbo: rumbo, espejo: espejo });
          m.set(JSON.stringify(p), p);
        });
      });
    });
  });
  return [...m.values()];
})();
ok(POSES_24.length === 24,
  'el enumerado da EXACTAMENTE 24 poses válidas (6 caras × 2 rumbos ⊥ × 2 espejo) (=' +
  POSES_24.length + ')');
(function () {
  const SET = new Set(POSES_24.map(p => JSON.stringify(p)));
  ['x', 'y', 'z'].forEach(function (eje) {
    const imgs = POSES_24.map(p => JSON.stringify(R.rotarPose90(p, eje)));
    const fuera = imgs.filter(k => !SET.has(k));
    const distintas = new Set(imgs).size;
    ok(fuera.length === 0 && distintas === 24,
      'giro en ' + eje + ': las 24 caen dentro de las 24 (' + fuera.length + ' fuera) y son ' +
      distintas + '/24 imágenes DISTINTAS (biyectiva)');
    const vuelven = POSES_24.filter(function (p0) {
      let p = p0;
      for (let i = 0; i < 4; i++) p = R.rotarPose90(p, eje);
      return igualPose(p, p0);
    }).length;
    ok(vuelven === 24, 'giro en ' + eje + ': R⁴ devuelve la pose IDÉNTICA en ' + vuelven + '/24');
  });
})();

// ===========================================================================
// R2 · EL BARRIDO — host × rol × eje, 4 pasos, midiendo la barra en cada uno
// ===========================================================================
// El paso 4 vuelve a la pose de partida, así que la pose INICIAL queda medida
// dentro del mismo bucle (no hace falta un caso aparte para ella).
console.log('\nR2 — 2 hosts × 3 roles × 3 ejes × 4 pasos: nada de fierro fuera del hormigón:');
let piezasMedidas = 0;
HOSTS.forEach(function (H) {
  COMPS.forEach(function (C) {
    const tip = C.tipologiaFija || H.tip[C.rol];
    // POSE DE PARTIDA = la que el motor le pone al nacer. Si la tabla no conoce el
    // par (elemento, tipología) —ES en MURO— se cae a poseDe(), que es exactamente
    // lo que hace el motor con esa receta: no se inventa una pose para el test.
    const pose0 = R.poseDefault(H.elemento, tip) || R.poseDe(receta(H, C, null));
    ['x', 'y', 'z'].forEach(function (eje) {
      let pose = pose0;
      const malos = [];          // pasos con fierro fuera
      let peor = { holgura: Infinity, txt: '' };
      let vacios = 0, avisos = [];
      let barra4 = null;
      const barra0 = JSON.stringify(R.expandirComponente(receta(H, C, pose0), H.host));
      for (let paso = 1; paso <= 4; paso++) {
        pose = R.rotarPose90(pose, eje);
        const comp = receta(H, C, pose);
        const pls = R.expandirComponente(comp, H.host) || [];
        if (paso === 4) barra4 = JSON.stringify(pls);
        // Una pose que no devuelve NINGUNA pieza también rompe la regla: girar no
        // puede hacer desaparecer la barra en silencio.
        if (!pls.length) { vacios++; avisos = avisos.concat(comp._avisos || []); }
        pls.forEach(function (pl) {
          piezasMedidas++;
          const g = holguraAlHormigon(pl, H.host, C.diam / 10);
          const txt = 'paso ' + paso + ' ' + poseTxt(pose) + ' · ' + g.cara + ' ' +
            (g.holgura < 0 ? 'SACA ' + r3(-g.holgura) : 'holgura ' + g.holgura) + ' cm · ' + bbox(pl);
          if (g.holgura < peor.holgura) peor = { holgura: g.holgura, txt: txt };
          if (g.holgura < -1e-6) malos.push(txt + ' · dims=' + JSON.stringify(pl.dims));
        });
      }
      const et = H.nombre + ' · ' + C.rol + ' ' + C.figura + ' (' + tip + ', todo auto) · giro en ' +
        eje + ' desde ' + poseTxt(pose0);
      ok(malos.length === 0 && vacios === 0,
        et + ': ' + (malos.length
          ? malos.length + '/4 pasos SACAN fierro del hormigón (host ±' + (H.host.largo / 2) + '/±' +
          (H.host.alto / 2) + '/±' + (H.host.ancho / 2) + ') — ' + malos.join(' | ')
          : (vacios ? vacios + '/4 pasos NO generaron pieza — ' + JSON.stringify(avisos)
            : '0 cm fuera en los 4 pasos · peor caso: ' + peor.txt)));
      // R⁴ = identidad, medido en la POSE…
      ok(igualPose(pose, pose0),
        et + ': R⁴ devuelve la pose EXACTA (' + poseTxt(pose0) + ' → ' + poseTxt(pose) + ')');
      // …y en la BARRA: la pose es el dato, pero lo que el usuario ve es el fierro.
      // Si el giro fuera cerrado en la pose y no en la geometría, la pieza volvería
      // "a su sitio" y estaría dibujada distinta.
      ok(barra4 === barra0,
        et + ': …y la barra vuelve BYTE-IDÉNTICA (' + (barra4 === barra0 ? 'igual' :
          'distinta: ' + barra0.length + ' vs ' + barra4.length + ' chars') + ')');
    });
  });
});
ok(piezasMedidas === 2 * 3 * 3 * 4,
  'se midieron las ' + (2 * 3 * 3 * 4) + ' piezas del barrido (=' + piezasMedidas + ')');

// ===========================================================================
// R3 · EL RANGO QUE EL GIRO DEJA CRUZADO — por acá entró el defecto reportado
// ===========================================================================
// R2 gira la pieza SOLA (1 barra, 1 capa). El defecto que llegó al usuario no vivía
// ahí: entró por el REPARTO. Una pieza girada conserva el rango que ya tenía, y ese
// rango quedó apuntando al eje que, DESPUÉS del giro, es la NORMAL DE SU CARA — el
// único eje donde la posición de la barra NO es un dato libre, porque la fija el
// recubrimiento + las pilas. El distribuidor escribía esa coordenada igual y la
// barra salía volando fuera del hormigón, con la suite en verde.
//
// POR QUÉ ESTE ASSERT NO ES "UN RANGO QUE EL USUARIO PUEDE SACAR DEL ELEMENTO":
// el rango que se prueba es el que la UI misma genera (_rangoDefault), o sea de
// borde a borde MENOS el recubrimiento; nunca pide nada fuera del hormigón. Si con
// ESE rango sale fierro afuera, lo puso el motor, no la receta.
//
// SENSIBILIDAD VERIFICADA contra `git archive HEAD` (el árbol con el bug): los 24
// casos de este barrido FALLAN ahí, con 10.6 a 587.6 cm de fierro fuera —
// incluidos los 390.6 cm exactos que reportó el usuario en el muro (MURO/girox,
// pose extremo+/y, rango x −196…196 @20, 21 copias). Un guard que no falla sobre el
// árbol enfermo no guarda nada.
console.log('\nR3 — el rango sobre el eje que el giro convierte en NORMAL de la cara:');
// El rango que hereda la pieza: mismos números que _rangoDefault del Template
// Editor — de borde a borde de ESE eje, descontado el recubrimiento.
function rangoDeCara(pose, H, sep) {
  const eje = R.EJE_DE_CARA[pose.cara];
  const dim = { x: H.host.largo, y: H.host.alto, z: H.host.ancho }[eje];
  const rec = (eje === 'z') ? H.host.recub_lat : H.host.recub_sup;
  const h = dim / 2 - rec;
  return { from: -h, to: h, sep: sep, eje: eje };
}
let piezasR3 = 0;
HOSTS.forEach(function (H) {
  const C = COMPS[0];                     // el CABEZAL: es el único que se apoya en una cara
  const tip = H.tip[C.rol];
  const sep = (H.nombre === 'MURO') ? 20 : 50;
  const pose0 = R.poseDefault(H.elemento, tip) || R.poseDe(receta(H, C, null));
  ['x', 'y', 'z'].forEach(function (eje) {
    let pose = pose0;
    const malos = [], clonadas = [];
    let peor = { holgura: Infinity, txt: '' };
    for (let paso = 1; paso <= 4; paso++) {
      pose = R.rotarPose90(pose, eje);
      const comp = receta(H, C, pose);
      comp.distribucion = { modo: 'linear', sep: sep, activa: true, rango: rangoDeCara(pose, H, sep) };
      const pls = R.expandirComponente(comp, H.host) || [];
      const et = 'paso ' + paso + ' ' + poseTxt(pose) + ' rango ' + comp.distribucion.rango.eje +
        ' ' + comp.distribucion.rango.from + '…' + comp.distribucion.rango.to + '@' + sep;
      if (!pls.length) malos.push(et + ' · NO generó pieza');
      pls.forEach(function (pl) {
        piezasR3++;
        const g = holguraAlHormigon(pl, H.host, C.diam / 10);
        const txt = et + ' · ' + g.cara + ' ' +
          (g.holgura < 0 ? 'SACA ' + r3(-g.holgura) : 'holgura ' + g.holgura) + ' cm · ' + bbox(pl);
        if (g.holgura < peor.holgura) peor = { holgura: g.holgura, txt: txt };
        if (g.holgura < -1e-6) malos.push(txt);
      });
      // NI N BARRAS CLONADAS. Cuando el motor decide que el rango no aplica, tiene
      // que emitir UNA barra, no N encima de la misma coordenada: N copias idénticas
      // se ven como una sola en el 3D y se cobran como N en el listado — esconder el
      // dato, que es justo lo que este proyecto no hace. (MEDIDO en HEAD: 21
      // placements, 21 barras, 1 ítem de 21 en el listado, y en pantalla UNA.)
      const distintas = new Set(pls.map(p => JSON.stringify(p.puntos))).size;
      if (pls.length > distintas) {
        clonadas.push(et + ' · ' + pls.length + ' barras en ' + distintas + ' posición(es)');
      }
    }
    const cab = H.nombre + ' · cabezal ' + C.figura + ' (' + tip + ', todo auto) · giro en ' + eje;
    // Al fallar se imprimen los 3 PEORES y el conteo: la lista entera son cientos de
    // barras y el número que importa es cuánto asoma la peor.
    const peores = malos.slice().sort().slice(0, 3);
    ok(malos.length === 0, cab + ': ' + (malos.length
      ? malos.length + ' caso(s) SACAN fierro del hormigón (los 3 primeros) — ' + peores.join(' | ')
      : '0 cm fuera en los 4 pasos · peor caso: ' + peor.txt));
    ok(clonadas.length === 0, cab + ': ' + (clonadas.length
      ? 'barras CLONADAS (se ve 1, se cobran N) — ' + clonadas.join(' | ')
      : 'ninguna barra clonada: lo que se dibuja es lo que se factura'));
  });
});
ok(piezasR3 >= 2 * 3 * 4, 'R3 midió ' + piezasR3 + ' piezas (≥ ' + (2 * 3 * 4) + ', una por paso)');

// ===========================================================================
// R4 · LOS TRES CASOS EXACTOS QUE REPORTÓ EL VERIFICADOR (números congelados)
// ===========================================================================
// R3 barre; R4 clava los casos concretos con sus cifras, para que si vuelven se
// reconozcan de inmediato por el número.
console.log('\nR4 — los casos reportados, con su cifra:');
const MURO_H = HOSTS[1], VIGA_H = HOSTS[0];
function mideCaso(H, receta_, sep, ejeRango, from, to) {
  receta_.distribucion = { modo: 'linear', sep: sep, activa: true,
    rango: { from: from, to: to, sep: sep, eje: ejeRango } };
  const pls = R.expandirComponente(receta_, H.host) || [];
  let peor = Infinity, cara = '';
  pls.forEach(function (pl) {
    const g = holguraAlHormigon(pl, H.host, Number(receta_.diam) / 10);
    if (g.holgura < peor) { peor = g.holgura; cara = g.cara; }
  });
  return { n: pls.length, fuera: pls.length ? r3(Math.max(0, -peor)) : NaN, cara: cara, pls: pls };
}
function recCabezal(H, fig, diam, pose, tip) {
  return {
    tipologia: tip, figura: fig, diam: diam, angulos: CAT.get(fig).angulos,
    cara: 'lateral',                            // campo viejo: sólo lo lee el fallback de pose
    pose: { cara: pose.cara, lado: pose.lado, rumbo: pose.rumbo, espejo: !!pose.espejo },
    dims: autoDims(fig)
  };
}
const POSE_TESTERO = { cara: 'extremo', lado: 1, rumbo: 'y', espejo: false };

// (a) LA REPRO DEL USUARIO — 390.6 cm fuera en HEAD, 0 con el fix.
(function () {
  const c = recCabezal(MURO_H, '103C', 8, POSE_TESTERO, 'MV');
  const m = mideCaso(MURO_H, c, 20, 'x', -196, 196);
  ok(m.fuera === 0 && m.n === 1,
    'MURO · MV 103C φ8 todo auto · {extremo+,y} · rango x −196…196@20: ' + m.n + ' barra(s), ' +
    m.fuera + ' cm fuera (HEAD: 21 barras, 390.6 cm por −x)');
  ok((c._avisos || []).length > 0,
    'y el motor lo DICE (aviso del componente, no un descarte mudo): ' + JSON.stringify(c._avisos));
})();

// (b) EL SALTO DEL UMBRAL DEL 30 % — la serie tiene que ser PLANA en 0.
// C = 119 caía justo debajo de 0.30·400 = 120 y el rango mandaba: 115.4 cm fuera.
// Si vuelve un porcentaje acá, este assert lo delata en el borde exacto.
(function () {
  const malos = [];
  [100, 118, 119, 120, 121, 140].forEach(function (Cval) {
    const c = recCabezal(MURO_H, '103C', 8, POSE_TESTERO, 'MV');
    c.dims.C = { modo: 'fija', valor: Cval };
    const m = mideCaso(MURO_H, c, 98, 'x', -196, 196);
    if (m.fuera !== 0 || m.n !== 1) malos.push('C=' + Cval + ' → ' + m.n + ' barras, ' + m.fuera + ' cm fuera');
  });
  ok(malos.length === 0, 'MURO · 103C φ8, C FIJA de 100 a 140 (el umbral viejo cortaba en 120): ' +
    (malos.length ? malos.join(' | ') : 'la serie completa da 1 barra y 0.00 cm fuera — sin escalón'));
})();

// (c) 103B TODO EN AUTO — la config con la que NACE la pieza en el editor. Sus
// patas miden 7.5 cm (φ8) a 19.2 (φ32) sobre el eje de la cara: nunca llegaban al
// 30 % y sacaban de 3.9 a 16.8 cm por el testero OPUESTO al de su pose.
(function () {
  const malos = [];
  [8, 16, 25, 32].forEach(function (phi) {
    const c = recCabezal(VIGA_H, '103B', phi, POSE_TESTERO, 'CBS');
    const m = mideCaso(VIGA_H, c, 100, 'x', -296, 296);
    if (m.fuera !== 0 || m.n !== 1) malos.push('VIGA φ' + phi + ' → ' + m.n + ' barras, ' + m.fuera + ' cm fuera ' + m.cara);
  });
  [1, -1].forEach(function (lado) {
    const c = recCabezal(MURO_H, '103B', 8, { cara: 'extremo', lado: lado, rumbo: 'y' }, 'CB');
    const m = mideCaso(MURO_H, c, 98, 'x', -196, 196);
    if (m.fuera !== 0 || m.n !== 1) malos.push('MURO lado ' + lado + ' → ' + m.n + ' barras, ' + m.fuera + ' cm fuera ' + m.cara);
  });
  ok(malos.length === 0, 'cabezal 103B TODO AUTO en el testero (φ8/16/25/32 en viga, ±lado en muro): ' +
    (malos.length ? malos.join(' | ') : '1 barra y 0.00 cm fuera en los 6 casos (HEAD: 3.9 · 6.4 · 12.25 · 16.8 cm)'));
})();

// (d) LO QUE NO SE PUEDE ROMPER ARREGLANDO LO DE ARRIBA: una pieza PLANA en su cara
// (101A recto, la malla y la traba que cosen las cortinas) no tiene pata que nazca
// de ninguna cara, así que su profundidad SÍ es un dato libre y su rango tiene que
// seguir repartiendo. Es el caso que distingue "hay pata" de "no la hay": sin él,
// la regla se podría escribir como "el rango nunca toca el eje de la cara" y el
// muro end-to-end perdería sus trabas (medido: 6 → 2).
(function () {
  // La TRABA TM del muro end-to-end: 101A recta que cose las dos cortinas. Su pose
  // la deja con la cara en el TESTERO (normal x) y su rango va justamente en x —
  // el MISMO cruce que en el 103C sacaba 390.6 cm—, pero su span sobre ese eje es 0
  // (no tiene pata que nazca del testero), así que el rango es un dato legítimo.
  const c = {
    tipologia: 'TM', figura: '101A', diam: 8, cara: 'lateral', jerarquia: 2,
    plano_pieza: { volteado: true }, dims: { A: { modo: 'auto' } }
  };
  const m = mideCaso(MURO_H, c, 100, 'x', -100, 100);
  const xs = [...new Set(m.pls.map(p => r3(p.puntos[0].x)))].sort((a, b) => a - b);
  ok(m.n === 3 && m.fuera === 0 && xs.length === 3,
    'MURO · traba TM 101A φ8 (PLANA en su cara: span 0 en el eje del testero) · rango x −100…100@100: ' +
    'sigue repartiendo ' + m.n + ' barras en ' + xs.length + ' posiciones ' + JSON.stringify(xs) +
    ' y 0 cm fuera');
})();

console.log(fallos === 0
  ? '\nOK — ningún giro de 90° saca fierro del hormigón, ni con el rango cruzado, y R⁴ es la identidad.'
  : '\nFALLARON ' + fallos + ' aserciones');
process.exit(fallos ? 1 : 0);
