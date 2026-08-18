// =============================================================================
// Δ POR DIMENSIÓN + DOMINANTE ELEGIBLE — test headless (Node)
// =============================================================================
// Dos capacidades que entraron juntas porque se tocan en el mismo sitio (la dim
// resuelta de un lado) y porque las dos se rompen del mismo modo: dejando que el
// motor MIDA una cosa y DIBUJE otra.
//
//   Δ POR DIMENSIÓN — dims[L] = { modo, valor, delta, extremo }. El Δ (cm) se
//   suma DESPUÉS de resolver el modo, viaja al despiece dentro de la dim (o sea
//   al largo de corte y a los kg) y NO se clampa: un Δ negativo que deja el lado
//   en cero o menos se genera igual y se AVISA — dato honesto, regla del proyecto.
//   En una figura CERRADA los lados opuestos son la misma medida vista dos veces,
//   así que el Δ se REPLICA en el par espejo: sin eso el contorno deja de cerrar
//   y la barra no se puede doblar.
//
//   DOMINANTE ELEGIBLE — comp.lado_dominante lo lee el motor con prioridad máxima.
//   No puede ser dominante un GANCHO (tramo terminal) ni un lado DIAGONAL; un
//   valor inválido se ignora y se avisa, nunca se aproxima a algo parecido.
//
// QUÉ PROTEGE, en orden:
//   A. Δ AUSENTE = COMPORTAMIENTO DE HOY, byte por byte (la viga-semilla en
//      {items:4, barras:72, kg:140.1} y las dims de sus 4 ítems con toda su cola
//      de flotante).
//   B. El Δ suma al LARGO y a los KG, y lo hace por la dim (no por una rama
//      aparte en generar.js).
//   C. `extremo` decide POR QUÉ PUNTA se desarrolla el cambio: la barra crece
//      hacia +x con 'fin' y hacia −x con 'ini', y la punta contraria NO se mueve.
//   D. Δ NEGATIVO: acorta de verdad y avisa cuando deja el lado ≤ 0 (sin clamp).
//   E. PARES ESPEJO derivados de la geometría (no de una tabla por código):
//      106A B↔D / C↔E y 104D A↔C / B↔D, con el Δ replicado en las dims Y en el
//      largo.
//   F. comp.lado_dominante MANDA: cambia qué lado estira el 'auto' y qué lado
//      dibuja el trazador — EL MISMO en los dos (es el defecto que este bloque
//      existe para impedir).
//   G. Un GANCHO o una DIAGONAL como dominante se IGNORAN con aviso, y el
//      resultado queda idéntico al de no haber elegido nada.
//
// Correr con: node tests/test_delta_dominante.js

'use strict';
const path = require('path');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

const CAT = require(path.join(BASE, 'catalogo_figuras.js'));
const FP = require(path.join(BASE, 'figura_puntos.js'));
const R = require(path.join(BASE, 'reglas.js'));
const G = require(path.join(BASE, 'generar.js'));
const S = require(path.join(BASE, 'semilla_viga.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function casi(a, b, tol, m) { ok(Math.abs(Number(a) - Number(b)) <= tol, m + ' (' + a + ' vs ' + b + ')'); }

const HOST = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// Componente de prueba con TODAS las dims en 'auto' (el caso donde el motor
// decide, que es donde un Δ o un dominante equivocado se notan).
function comp(fig, tip, extra) {
  const sp = CAT.get(fig) || {};
  const dims = {};
  (sp.parciales || []).forEach(p => { dims[p] = { modo: 'auto' }; });
  const esSeccion = (tip === 'ES' || tip === 'TRV');
  const c = {
    comp_id: 'X', jerarquia: esSeccion ? 1 : 2,
    tipologia: tip, figura: fig, diam: esSeccion ? 8 : 16, suf_tipo: '',
    cara: esSeccion ? 'lateral' : 'sup',
    recub_override: null, angulos: [], prioridad: null, empalme: null, depende_de: null,
    modo: esSeccion ? 'lineal' : 'puntual', plano_pieza: { volteado: false },
    arreglo: { n_capas: 1, sep_capas: 20, rango: null },
    dims: dims,
    distribucion: esSeccion
      ? { modo: 'linear', zonas: [{ long: 600, sep: 200 }], start_offset: 4 }
      : { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' }
  };
  for (const k in (extra || {})) c[k] = extra[k];
  return c;
}
function expandir(c) { return R.expandirComponente(c, HOST); }
// Largos de los SEGMENTOS de la polilínea, en orden.
function segmentos(pts) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    out.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
  }
  return out;
}
function rangoX(pts) {
  let lo = Infinity, hi = -Infinity;
  pts.forEach(p => { if (p.x < lo) lo = p.x; if (p.x > hi) hi = p.x; });
  return { lo: lo, hi: hi };
}
// Semilla con una mutación aplicada a su receta.
function semilla(mut) {
  const rec = S.semillaViga();
  if (mut) mut(rec);
  return { receta: rec, res: G.generarViga(rec, {}) };
}

// ============================================ A · Δ AUSENTE = HOY, BYTE A BYTE
console.log('A — sin Δ y sin elección, el motor da EXACTAMENTE lo de siempre');
{
  const { res } = semilla();
  ok(res.resumen.items === 4 && res.resumen.barras === 72 && res.resumen.kg === 140.1,
    'viga-semilla en {items:4, barras:72, kg:140.1} — la referencia viva');
  // Las dims completas (con su cola de flotante): si el Δ tocara algo cuando NO
  // está declarado, acá se vería aunque los kg redondeados no se movieran.
  // (14-ago, Modelo A) la TRV es un longitudinal de_pie: mismo 50.4, pero la
  // aritmética llega por resta directa del largo útil local — sin cola flotante.
  const firma = res.barras.map(b => [b.figura, b.cant, b.dim_a, b.dim_b, b.dim_c, b.dim_d].join('|')).join(' ; ');
  // 18-AGO · el ÚNICO número que se movió es el B del CBS: 547.9735931288072 → 590.4.
  // Con la CONVENCIÓN DE VÉRTICE (cerrada por el usuario) los 45° de la 103B son el
  // ángulo ENTRE la pata y el cuerpo, o sea patas REPLEGADAS en vez de abiertas: ya no
  // le roban largo al tramo B y su 'auto' sube. Las otras tres barras quedan
  // idénticas dígito a dígito, incluida la cola de flotante — que es justo lo que este
  // assert vigila.
  ok(firma === [
    '103B|6|30|590.4000000000001|30|', '101A|4|592|||',
    '104D|47|24|52|24|52', '101A|15|50.4|||'
  ].join(' ; '), 'las 4 barras salen con las MISMAS dims que antes de la tanda Δ');

  // Δ = 0 y Δ = null son "sin Δ": no basta con que el número no cambie, la dim
  // CANÓNICA no debe siquiera estrenar el campo (si lo estrenara, cualquier
  // lector que pregunte por `delta` cambiaría de rama sin que nada lo pida).
  const c0 = comp('103A', 'CBS');
  c0.dims.B.delta = 0;
  const cNull = comp('103A', 'CBS');
  cNull.dims.B.delta = null;
  const cSin = comp('103A', 'CBS');
  ok(JSON.stringify(R.deltasDeComponente(c0)) === '{}', 'Δ 0 → sin Δ efectivo');
  ok(JSON.stringify(R.deltasDeComponente(cNull)) === '{}', 'Δ null → sin Δ efectivo');
  ok(JSON.stringify(expandir(c0)[0].dims) === JSON.stringify(expandir(cSin)[0].dims),
    'Δ 0 resuelve las mismas dims que no declarar Δ');
  ok(JSON.stringify(expandir(cNull)[0].puntos) === JSON.stringify(expandir(cSin)[0].puntos),
    'Δ null dibuja los mismos puntos que no declarar Δ');
}

// ==================================================== B · Δ → LARGO Y KG
console.log('\nB — el Δ viaja al despiece dentro de la dim (largo de corte y kg)');
{
  const base = semilla();
  const conD = semilla(r => { r.componentes[0].dims.B.delta = 12; });
  const b0 = base.res.barras[0], b1 = conD.res.barras[0];
  casi(b1.dim_b, b0.dim_b + 12, 1e-9, 'CBS 103B: dim_b sube exactamente el Δ (+12)');
  casi(b1._largoEstimado, b0._largoEstimado + 12, 1e-9, 'el largo de corte sube 12 cm');
  // 6 barras φ16 × 12 cm = 6 · 7850 · π · (16/2000)² · 0.12 = 1.1355 kg.
  // 18-AGO: la base pasó de 136.1 a 140.1 (convención de vértice, ver bloque A), así que
  // el total con Δ pasa de 137.2 a 141.2. Lo que este assert mide —el INCREMENTO de
  // 1.1355 kg— no se mueve.
  casi(conD.res.resumen.kg, 141.2, 0.05, 'los kg suben lo que pesan 6 barras φ16 × 12 cm');
  ok(b1.dim_a === b0.dim_a && b1.dim_c === b0.dim_c,
    'las patas A y C no se mueven: el Δ es de UN lado, no un escalado');
  // Un Δ en una PATA también viaja (no es un privilegio del dominante).
  const enPata = semilla(r => { r.componentes[0].dims.A.delta = 7; });
  casi(enPata.res.barras[0].dim_a, b0.dim_a + 7, 1e-9, 'Δ en la pata A: dim_a sube 7');
  casi(enPata.res.barras[0]._largoEstimado, b0._largoEstimado + 7, 1e-9, '…y el largo también');
}

// ============================================ C · `extremo`: por qué punta crece
console.log('\nC — `extremo` dice por qué punta se desarrolla el cambio');
{
  // El trazador recorre la cadena del primer tramo al último, así que el vértice
  // de LLEGADA del lado es su 'fin' y el de SALIDA su 'ini'. En una pieza
  // longitudinal eso se ve como el extremo por el que la barra se alarga: la
  // punta contraria queda EXACTAMENTE donde estaba.
  const r0 = rangoX(semilla().res.placements[0].puntos);
  const rFin = rangoX(semilla(r => {
    r.componentes[0].dims.B.delta = 12; r.componentes[0].dims.B.extremo = 'fin';
  }).res.placements[0].puntos);
  const rIni = rangoX(semilla(r => {
    r.componentes[0].dims.B.delta = 12; r.componentes[0].dims.B.extremo = 'ini';
  }).res.placements[0].puntos);
  casi(rFin.lo, r0.lo, 1e-6, "extremo 'fin': la punta de INICIO no se mueve");
  casi(rFin.hi, r0.hi + 12, 1e-6, "extremo 'fin': la barra crece 12 cm por el FINAL");
  casi(rIni.hi, r0.hi, 1e-6, "extremo 'ini': la punta FINAL no se mueve");
  casi(rIni.lo, r0.lo - 12, 1e-6, "extremo 'ini': la barra crece 12 cm por el INICIO");
  // Sin `extremo` declarado manda el default 'fin' (el sentido del trazado).
  const rDef = rangoX(semilla(r => { r.componentes[0].dims.B.delta = 12; }).res.placements[0].puntos);
  casi(rDef.hi, rFin.hi, 1e-9, "sin `extremo` declarado se comporta como 'fin'");
}

// ================================================= D · Δ NEGATIVO, SIN CLAMP
console.log('\nD — el Δ negativo acorta de verdad, y si deja el lado ≤ 0 se avisa');
{
  const base = semilla();
  const corto = semilla(r => { r.componentes[0].dims.A.delta = -10; });
  casi(corto.res.barras[0].dim_a, base.res.barras[0].dim_a - 10, 1e-9, 'Δ −10 en A: la pata mide 10 cm menos');
  casi(corto.res.barras[0]._largoEstimado, base.res.barras[0]._largoEstimado - 10, 1e-9, '…y el largo baja 10');
  ok(!(corto.receta.componentes[0]._avisos || []).some(a => /Δ/.test(a)),
    'mientras el lado siga siendo positivo NO hay aviso (acortar es legítimo)');

  // La pata A de la semilla mide 30: un Δ de −40 la deja en −10. NO se aplasta a
  // 0 — el número imposible tiene que VERSE en la ficha, en el 3D y en el listado.
  const imposible = semilla(r => { r.componentes[0].dims.A.delta = -40; });
  const dimA = imposible.res.barras[0].dim_a;
  casi(dimA, -10, 1e-9, 'Δ −40 sobre una pata de 30 deja −10: el dato se genera TAL CUAL (sin clamp a 0)');
  const av = imposible.receta.componentes[0]._avisos || [];
  ok(av.some(a => a.indexOf('Δ -40') >= 0 && a.indexOf('lado A') >= 0 && a.indexOf('-10') >= 0),
    'y queda un aviso con el Δ, el lado y la medida resultante: ' + JSON.stringify(av[0] || null));
}

// ==================================================== E · PARES ESPEJO
console.log('\nE — pares espejo derivados de la geometría del contorno cerrado');
{
  ok(JSON.stringify(FP.paresEspejoFigura('106A')) === JSON.stringify({ B: 'D', D: 'B', C: 'E', E: 'C' }),
    '106A (estribo con ganchos declarados): cuerpo B/C/D/E → B↔D (alto) y C↔E (ancho)');
  ok(JSON.stringify(FP.paresEspejoFigura('104D')) === JSON.stringify({ A: 'C', C: 'A', B: 'D', D: 'B' }),
    '104D (marco de 4 lados): A↔C (ancho) y B↔D (alto)');
  ok(JSON.stringify(FP.paresEspejoFigura('103A')) === '{}',
    '103A es una cadena ABIERTA: no hay contorno que romper, así que no hay pares');
  ok(JSON.stringify(FP.paresEspejoFigura('104B')) === '{}',
    '104B tampoco cierra (quiebres de 45°): sin pares, el Δ actúa solo en su lado');

  // El par se mueve JUNTO en las dims resueltas y en el largo.
  [['106A', 'B', 'D', 'C', 'E'], ['104D', 'B', 'D', 'A', 'C']].forEach(([fig, l1, p1, l2, p2]) => {
    const sinD = expandir(comp(fig, 'ES'))[0].dims;
    const c = comp(fig, 'ES'); c.dims[l1].delta = 5;
    const conD = expandir(c)[0].dims;
    casi(conD[l1], sinD[l1] + 5, 1e-9, fig + ': Δ +5 en ' + l1 + ' → ' + l1 + ' sube 5');
    casi(conD[p1], sinD[p1] + 5, 1e-9, fig + ': …y su par ' + p1 + ' sube 5 SOLO (el contorno sigue cerrando)');
    ok(conD[l2] === sinD[l2] && conD[p2] === sinD[p2],
      fig + ': el otro par (' + l2 + '/' + p2 + ') no se toca');
    // El Δ replicado es un Δ de verdad: lo dice deltasDeComponente y lo paga el largo.
    const d = R.deltasDeComponente(c);
    ok(d[p1] && d[p1].origen === 'espejo' && d[p1].de === l1,
      fig + ': el Δ de ' + p1 + ' se declara como ESPEJO de ' + l1 + ' (no como propio)');
  });

  // Δ EXPLÍCITO EN LOS DOS LADOS DEL PAR: manda lo que escribió el usuario, no la
  // réplica (la réplica es una ayuda para el caso normal, no una regla que pise).
  {
    const c = comp('104D', 'ES');
    c.dims.B.delta = 5; c.dims.D.delta = 2;
    const d = R.deltasDeComponente(c);
    ok(d.B.delta === 5 && d.B.origen === 'propio' && d.D.delta === 2 && d.D.origen === 'propio',
      '104D con Δ propio en B y en D: se respetan los dos (5 y 2), la réplica no pisa');
  }

  // Y el largo del estribo sube por los DOS lados: 152 → 162 con Δ +5 en B.
  {
    const { res } = semilla(r => { r.componentes[2].dims.B.delta = 5; });
    const es = res.barras.find(b => b.figura === '104D');
    ok(es.dim_b === 57 && es.dim_d === 57 && es.dim_a === 24 && es.dim_c === 24,
      'ES 104D de la semilla: B y D pasan de 52 a 57, A y C siguen en 24');
    casi(es._largoEstimado, 162, 1e-9, 'el largo del estribo sube 10 (5 por cada lado del par)');
  }
}

// ============================================== F · comp.lado_dominante MANDA
console.log('\nF — comp.lado_dominante manda, y dibujo y medida usan EL MISMO');
{
  ok(JSON.stringify(FP.ladosDominantesElegibles('105A')) === JSON.stringify(['B', 'C', 'D']),
    '105A: elegibles B/C/D (A y E son los ganchos terminales)');
  ok(JSON.stringify(FP.ladosDominantesElegibles('104B')) === JSON.stringify(['B', 'C']),
    '104B: elegibles B/C');
  // ASSERTS INVERTIDOS (15-ago) POR CORRECCIÓN DEL USUARIO: «lo de que la figura
  // cerrada no tiene dominante no lo definí yo. Puede perfectamente tener un
  // dominante y eso regiría la posición de los ganchos». Y se comprobó midiendo
  // que ninguna otra vía lo controla: cambiar cara/lado de la pose deja el marco
  // y la punta del gancho IDÉNTICOS, y el espejo sólo alcanza 2 de las 4
  // esquinas. Así que en una cerrada los lados del CUERPO son elegibles; los
  // ganchos DECLARADOS (106x: A y F) no.
  ok(JSON.stringify(FP.ladosDominantesElegibles('104D')) === JSON.stringify(['A', 'B', 'C', 'D']),
    '104D (cerrado sin ganchos declarados): sus 4 lados son elegibles');
  ok(JSON.stringify(FP.ladosDominantesElegibles('106A')) === JSON.stringify(['B', 'C', 'D', 'E']),
    '106A: elegibles los 4 del cuerpo; A y F son los ganchos declarados');

  // 105A tiene 5 tramos rectos sin gancho >90°, o sea la polilínea tiene un
  // segmento por tramo: el segmento i ES el lado i. Eso permite comparar lo que
  // se DIBUJA contra lo que se MIDE sin ninguna heurística.
  const TRAMOS_105A = FP.tramosDeFigura('105A').tramos.map(t => t.lado);
  ['B', 'C', 'D'].forEach(elec => {
    const c = comp('105A', 'CBS', { lado_dominante: elec });
    const pl = expandir(c)[0];
    ok(R.ladoDominante(c) === elec, '105A con lado_dominante ' + elec + ': el motor resuelve ' + elec);
    const segs = segmentos(pl.puntos);
    ok(segs.length === TRAMOS_105A.length,
      '105A: un segmento por tramo (' + segs.length + ') — el mapeo lado↔segmento es directo');
    const i = TRAMOS_105A.indexOf(elec);
    casi(segs[i], pl.dims[elec], 0.01,
      '105A/' + elec + ': el segmento DIBUJADO del lado ' + elec + ' mide su dim RESUELTA');
    // …y es el largo de la pieza, no una pata: el dominante es el que se estira
    // contra el hormigón (largo útil 600 − 2·4 = 592, menos los sobres).
    ok(pl.dims[elec] > 500,
      '105A/' + elec + ': el lado elegido es el que el auto estira al largo útil (' +
      pl.dims[elec].toFixed(1) + ' cm)');
    (c._avisos || []).forEach(a => ok(a.indexOf('Lado dominante') < 0,
      '105A/' + elec + ': elección válida → sin aviso de dominante'));
  });

  // Elegir OTRO dominante cambia de verdad el reparto de medidas: el lado que
  // antes era el largo pasa a ser un lado corto y viceversa.
  {
    const cB = expandir(comp('105A', 'CBS'))[0].dims;
    const cD = expandir(comp('105A', 'CBS', { lado_dominante: 'D' }))[0].dims;
    ok(cB.B > 500 && cB.D < 100 && cD.D > 500 && cD.B < 100,
      '105A: con B manda B (590) y D es corto; con D manda D (590) y B es corto');
  }
}

// ====================================== G · GANCHO / DIAGONAL: ignorados con aviso
console.log('\nG — un gancho o una diagonal como dominante se ignoran con aviso');
{
  // GANCHO — A y E son los tramos terminales de la 105A.
  ['A', 'E'].forEach(malo => {
    const c = comp('105A', 'CBS', { lado_dominante: malo });
    const pl = expandir(c)[0];
    const ref = expandir(comp('105A', 'CBS'))[0];
    ok(R.ladoDominante(c) === 'B', '105A con dominante ' + malo + ' (gancho) → cae a la cascada (B)');
    ok(JSON.stringify(pl.dims) === JSON.stringify(ref.dims), '…y las dims quedan idénticas a no elegir nada');
    ok(JSON.stringify(pl.puntos) === JSON.stringify(ref.puntos), '…y los puntos también');
    const av = (c._avisos || []).filter(a => a.indexOf('Lado dominante') === 0);
    ok(av.length === 1 && av[0].indexOf('GANCHO') > 0,
      '…y queda UN aviso que dice que es un gancho: ' + JSON.stringify(av[0] || null));
  });

  // CONTORNO CERRADO — ahora SÍ acepta dominante (ver arriba): no debe avisar.
  {
    const c = comp('104D', 'ES', { lado_dominante: 'B' });
    expandir(c);
    const av = (c._avisos || []).filter(a => a.indexOf('Lado dominante') === 0);
    ok(av.length === 0,
      '104D con dominante B: se acepta, sin aviso (' + JSON.stringify(av) + ')');
  }

  // DIAGONAL — el catálogo de hoy no tiene ninguna figura con un lado INTERIOR
  // diagonal (barrido completo: todas sus diagonales son ganchos terminales, que
  // ya los para la regla anterior). Para no dejar la regla sin guard se registra
  // una figura de prueba con la geometría exacta que hace falta y se retira al
  // salir: A(0°) → B(90°) → C(45°) → D(90°). Con B de dominante, C queda a 45°
  // de él —diagonal— y NO es terminal, así que sólo puede rechazarla esta regla.
  // Los `angulos` van [90,45] y no vacíos A PROPÓSITO: una figura de 4 parciales
  // SIN ángulos listados es, para _esPerimetro, un rectángulo puro (marco
  // cerrado), y entonces la pararía la regla del CONTORNO CERRADO en vez de la de
  // la diagonal — el guard estaría probando otra cosa (comprobado: con [] el
  // motivo que sale es "es un contorno CERRADO").
  {
    const COD = 'ZZDIAG';
    CAT.FIGURAS[COD] = {
      codigo: COD, parciales: ['A', 'B', 'C', 'D'], angulos: [90, 45], radio: false,
      descripcion: 'fixture de test: cadena con un lado INTERIOR diagonal', geometria: {
        tramos: [
          { lado: 'A', giro: 0, sentido: null }, { lado: 'B', giro: 90, sentido: 'izq' },
          { lado: 'C', giro: 45, sentido: 'izq' }, { lado: 'D', giro: 90, sentido: 'izq' }
        ]
      }
    };
    try {
      const ejes = FP.ejesCadenaLong(COD);
      ok(ejes && ejes.C === 'd', 'fixture: con B de dominante, el lado C sale clasificado DIAGONAL');
      const v = FP.validarLadoDominante(COD, 'C');
      ok(!v.ok && v.motivo.indexOf('DIAGONAL') > 0,
        'C (interior pero diagonal) NO es elegible: ' + JSON.stringify(v.motivo));
      ok(JSON.stringify(FP.ladosDominantesElegibles(COD)) === JSON.stringify(['B']),
        'sus elegibles son sólo B (A y D son terminales, C es diagonal)');
      const c = comp(COD, 'CBS', { lado_dominante: 'C' });
      const pl = expandir(c);
      ok(R.ladoDominante(c) === 'B', 'el motor lo ignora y resuelve B');
      const av = (c._avisos || []).filter(a => a.indexOf('Lado dominante') === 0);
      ok(av.length === 1 && av[0].indexOf('DIAGONAL') > 0,
        '…con el aviso de diagonal: ' + JSON.stringify(av[0] || null));
      ok(pl.length > 0, 'y la barra se genera igual (ignorar no es dejar de dibujar)');
    } finally {
      delete CAT.FIGURAS[COD];
    }
  }

  // Un lado que la figura NO tiene tampoco se inventa.
  {
    const c = comp('103A', 'CBS', { lado_dominante: 'Z' });
    expandir(c);
    ok(R.ladoDominante(c) === 'B', '103A con dominante Z (no existe) → B');
    ok((c._avisos || []).some(a => a.indexOf('no tiene el lado Z') > 0),
      '…con el aviso de que la figura no tiene ese lado');
  }
}

// ============ H · EN UNA PIEZA DE SECCIÓN, EL Δ TIENE QUE MOVER EL DIBUJO
console.log('\nH — pieza de sección: el Δ mueve la dim Y el trazo, en la misma medida');
{
  // POR QUÉ ESTE BLOQUE EXISTE (defecto real, medido y corregido en esta tanda).
  // Una pieza de sección CERRADA no se dibuja con sus dims: su forma la manda el
  // MARCO de núcleo ("el marco manda la forma") y las dims se DERIVAN de él. El Δ
  // se aplicaba sólo sobre la dim, así que movía el largo de corte y los kg y
  // dejaba el trazo 3D EXACTAMENTE donde estaba: ES 104D de la semilla con Δ +5
  // en B daba dims B/D 52 → 57 y perímetro dibujado 169.2137 en los dos casos —
  // 0.0000 de diferencia. Los bloques D y E de arriba no lo veían porque miran
  // dims y kg, que eran correctos: medir y dibujar habían divergido en silencio,
  // que es la única forma en que este motor se rompe de verdad.
  //
  // El guard es GEOMÉTRICO y no un número congelado: para CADA figura cerrada del
  // catálogo y CADA lado de su cuerpo, el bbox DIBUJADO tiene que crecer lo mismo
  // que la dim, y en el eje que le toca. Si alguien vuelve a tocar el marco, las
  // dims o el mapeo lado↔eje y los dos dejan de ir juntos, esto falla.
  const HOST_ES = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
  function compES(fig, dl) {
    const sp = CAT.get(fig) || {};
    const dims = {};
    (sp.parciales || []).forEach(p => { dims[p] = { modo: 'auto' }; });
    if (dl) dims[dl.L].delta = dl.d;
    return {
      comp_id: 'X', jerarquia: 1, tipologia: 'ES', figura: fig, diam: 8, suf_tipo: '',
      cara: 'lateral', recub_override: null, angulos: [], prioridad: null, empalme: null,
      depende_de: null, modo: 'lineal', plano_pieza: { volteado: false },
      arreglo: { n_capas: 1, sep_capas: 20, rango: null }, dims: dims,
      distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 200 }], start_offset: 4 }
    };
  }
  const span = (pts, a) => Math.max(...pts.map(p => p[a])) - Math.min(...pts.map(p => p[a]));

  const cerradas = Object.keys(CAT.FIGURAS)
    .filter(k => Object.keys(FP.paresEspejoFigura(k)).length).sort();
  ok(cerradas.length === 14,
    'el catálogo tiene 14 figuras cerradas con pares (10 de la familia 104 + 4 de la 106): ' + cerradas.length);

  let revisados = 0, mudos = 0, cruzados = 0;
  cerradas.forEach(f => {
    const ejes = FP.ejesMarcoSeccion(f, 'estribo');
    if (!ejes) { ok(false, f + ': sin mapeo lado↔eje del marco'); return; }
    Object.keys(ejes).forEach(L => {
      const a = R.expandirComponente(compES(f), HOST_ES)[0];
      const b = R.expandirComponente(compES(f, { L: L, d: 5 }), HOST_ES)[0];
      if (!a || !b) return;
      revisados++;
      // 'v' = alto → crece el eje Y del trazo; 'u' = ancho → crece el Z.
      const ejeCrece = (ejes[L] === 'v') ? 'y' : 'z';
      const ejeQuieto = (ejes[L] === 'v') ? 'z' : 'y';
      const dDim = b.dims[L] - a.dims[L];
      const dTrazo = span(b.puntos, ejeCrece) - span(a.puntos, ejeCrece);
      const dOtro = span(b.puntos, ejeQuieto) - span(a.puntos, ejeQuieto);
      if (Math.abs(dTrazo - 5) > 1e-6) mudos++;
      if (Math.abs(dOtro) > 1e-6) cruzados++;
      if (Math.abs(dDim - 5) > 1e-9 || Math.abs(dTrazo - 5) > 1e-6 || Math.abs(dOtro) > 1e-6) {
        ok(false, f + '/' + L + ' (' + ejes[L] + '): dim +' + dDim.toFixed(3) +
          ', trazo ' + ejeCrece + ' +' + dTrazo.toFixed(3) + ', ' + ejeQuieto + ' +' + dOtro.toFixed(3));
      }
    });
  });
  ok(revisados === 56, 'se revisaron los 56 lados de cuerpo de las 14 figuras cerradas: ' + revisados);
  ok(mudos === 0, 'ninguno mueve la dim sin mover el trazo (era el defecto: ' + mudos + ' mudos)');
  ok(cruzados === 0, 'ninguno deforma el eje que no le toca: ' + cruzados);

  // Y el caso concreto de la semilla, con el número que lo delató.
  {
    const per = pl => { let L = 0; for (let i = 1; i < pl.length; i++)
      L += Math.hypot(pl[i].x - pl[i-1].x, pl[i].y - pl[i-1].y, pl[i].z - pl[i-1].z); return L; };
    const p0 = semilla().res.placements.filter(p => p.figura === '104D')[0];
    const p1 = semilla(r => { r.componentes[2].dims.B.delta = 5; }).res.placements
      .filter(p => p.figura === '104D')[0];
    casi(per(p1.puntos) - per(p0.puntos), 10, 1e-6,
      'ES 104D de la semilla: el perímetro DIBUJADO sube 10, igual que el largo de corte');
  }

  // LA TRABA es la otra pieza que se dibuja DEL MARCO (su vertical va de ySup a
  // yInf, el mismo marco del estribo), así que sufría el mismo defecto: TRV 101A
  // de la semilla con Δ +6 daba dim 50.4 → 56.4 y el trazo clavado en 49.6.
  {
    const trv = res => res.placements.filter(p => p.tipologia === 'TRV')[0];
    const a = trv(semilla().res);
    const b = trv(semilla(r => { r.componentes[3].dims.A.delta = 6; }).res);
    casi(b.dims.A - a.dims.A, 6, 1e-9, 'TRV 101A: Δ +6 sube la dim 6');
    casi(span(b.puntos, 'y') - span(a.puntos, 'y'), 6, 1e-6, '…y el trazo crece 6 de alto (era 0)');
    casi(span(b.puntos, 'z'), span(a.puntos, 'z'), 1e-6, '…sin deformar el ancho');
  }

  // Un Δ en un GANCHO del 106A no agranda el marco: el gancho es extensión
  // normativa, no una medida del rectángulo. La dim sí sube (es su lado).
  {
    const ejes106 = FP.ejesMarcoSeccion('106A', 'estribo');
    ok(ejes106.A === undefined && ejes106.F === undefined,
      '106A: los ganchos A y F no llevan ninguna medida del marco');
    const a = R.expandirComponente(compES('106A'), HOST_ES)[0];
    const b = R.expandirComponente(compES('106A', { L: 'A', d: 5 }), HOST_ES)[0];
    casi(b.dims.A - a.dims.A, 5, 1e-9, '106A: Δ +5 en el gancho A sube su dim');
    casi(span(b.puntos, 'y'), span(a.puntos, 'y'), 1e-6, '…y el alto del marco NO se mueve');
    casi(span(b.puntos, 'z'), span(a.puntos, 'z'), 1e-6, '…ni el ancho');
  }
}


// ============================================================================
// DIRECCIÓN DEL Δ EN UN CONTORNO CERRADO (15-ago) — estribo de confinamiento
// ----------------------------------------------------------------------------
// Un contorno cerrado crecía SIEMPRE simétrico. Para un estribo de confinamiento
// hay que acortarlo y CARGARLO a un costado, así que `extremo` gana un tercer
// valor: 'centro' (default, lo de siempre) · 'fin' (al borde +) · 'ini' (al −).
// El largo de corte es el MISMO en los tres: lo que cambia es dónde queda.
(function () {
  console.log('\nI — Δ del marco cerrado: centro / fin / ini');
  const MURO = { largo: 400, alto: 250, ancho: 20, recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 };
  function corrida(ext) {
    const dims = {};
    (CAT.get('106A').parciales || []).forEach(L => { dims[L] = { modo: 'auto' }; });
    if (ext) dims.B = { modo: 'auto', delta: -100, extremo: ext };
    const c = { comp_id: 'X', tipologia: 'EC', figura: '106A', diam: 8, dims: dims,
      pose: { cara: 'lateral', lado: 1, rumbo: 'y' },
      distribucion: { modo: 'linear', rango: { eje: 'y', from: 0, to: 0, sep: 50 } } };
    const pls = R.expandirComponente(c, MURO);
    let lo = Infinity, hi = -Infinity;
    ((pls[0] || {}).puntos || []).forEach(q => { lo = Math.min(lo, q.x); hi = Math.max(hi, q.x); });
    return { lo: Math.round(lo * 10) / 10, hi: Math.round(hi * 10) / 10,
      largo: Math.round((hi - lo) * 10) / 10, dimB: pls[0] && pls[0].dims.B };
  }
  const base = corrida(null), cen = corrida('centro'), fin = corrida('fin'), ini = corrida('ini');
  ok(base.largo > 390, 'sin Δ el marco llena el largo útil (' + base.largo + ')');
  ok(cen.largo === fin.largo && fin.largo === ini.largo && cen.largo < base.largo - 90,
    'los tres acortan LO MISMO (' + cen.largo + ' vs ' + base.largo + ')');
  ok(Math.abs(cen.lo + cen.hi) < 1, 'centro: simétrico (' + cen.lo + '…' + cen.hi + ')');
  ok(fin.lo === base.lo && fin.hi < base.hi, 'fin: se come el borde + (' + fin.lo + '…' + fin.hi + ')');
  ok(ini.hi === base.hi && ini.lo > base.lo, 'ini: se come el borde − (' + ini.lo + '…' + ini.hi + ')');
  ok(cen.dimB === fin.dimB && fin.dimB === ini.dimB,
    'y la dim que se corta es la misma en los tres (' + cen.dimB + ')');
})();

// ---------------------------------------------------------------------------
// J) EL DOMINANTE DE UN MARCO CERRADO MUEVE LA ESQUINA DE LOS GANCHOS (17-ago)
// ---------------------------------------------------------------------------
// La caja no se toca (mismo bbox, mismas dims -> mismo corte); lo unico que
// cambia es en que esquina cierran los ganchos. Sin eleccion = primer lado de
// la cadena, byte-identico a lo de siempre.
console.log('— J) dominante en marco cerrado = esquina de los ganchos —');
(function () {
  var VIGA_J = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
  function mkJ(dom) {
    var spec = global.ModeladorCatalogoFiguras.get('104D'), dims = {};
    (spec.parciales || []).forEach(function (L) { dims[L] = { modo: 'auto' }; });
    var c = { comp_id: 'J', tipologia: 'ES', figura: '104D', diam: 1.0,
      pose: { postura: 'de_pie', rumbo: 'x' }, dims: dims, angulos: (spec.angulos || []).slice(),
      distribucion: { modo: 'linear', rango: { from: -50, to: 50, sep: 25 } } };
    if (dom) c.lado_dominante = dom;
    c.distribucion.rango.eje = R.ejeDistribucion(c, VIGA_J);
    return c;
  }
  function ptsJ(dom) {
    var pls = R.expandirComponente(mkJ(dom), VIGA_J) || [];
    return (pls[0] && pls[0].puntos) || [];
  }
  function bbJ(pts) {
    var b = { y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    pts.forEach(function (q) {
      if (q.y < b.y0) b.y0 = q.y; if (q.y > b.y1) b.y1 = q.y;
      if (q.z < b.z0) b.z0 = q.z; if (q.z > b.z1) b.z1 = q.z;
    });
    return b;
  }
  var orden = global.ModeladorFiguraPuntos.ladosMarcoOrdenados('104D', 'estribo');
  ok(JSON.stringify(orden) === JSON.stringify(['A', 'B', 'C', 'D']),
    'ladosMarcoOrdenados(104D) = [A,B,C,D]: ' + JSON.stringify(orden));
  var sinDom = ptsJ(null), conPrimero = ptsJ(orden[0]);
  ok(JSON.stringify(sinDom) === JSON.stringify(conPrimero),
    'sin eleccion == primer lado (byte-identico, cero regresion)');
  var b0 = bbJ(sinDom), esquinas = {}, todasIguales = true;
  orden.forEach(function (L) {
    var pts = ptsJ(L), b = bbJ(pts);
    ['y0', 'y1', 'z0', 'z1'].forEach(function (k) {
      if (Math.abs(b[k] - b0[k]) > 1e-9) todasIguales = false;
    });
    var punta = pts[0];   // puntaA: la punta del gancho de inicio
    esquinas[L] = Math.round(punta.y * 100) / 100 + ',' + Math.round(punta.z * 100) / 100;
  });
  ok(todasIguales, 'las 4 elecciones dejan LA MISMA caja (bbox identico)');
  var distintas = {};
  Object.keys(esquinas).forEach(function (L) { distintas[esquinas[L]] = 1; });
  ok(Object.keys(distintas).length === 4,
    'la punta del gancho visita 4 esquinas distintas: ' + JSON.stringify(esquinas));
})();

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exitCode = fallos ? 1 : 0;
