// TEST DEL FRONT DE DEEP AUDIT (26-nov, SPECS §16) — ejecuta el archivo de verdad.
//
// Lo de la pantalla: el edificio (la torre arriba, la fundación al fondo, qué va fuera de la
// grilla), el color de cada ficha según «Color por», las familias de hallazgos (el filtro que
// apaga los CC que no tienen esa familia) y la ventana del CC.
//
// Correr con: node tests/test_deep_audit.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre);
  if (!cond) fallos++;
}

const sandbox = { console, document: { getElementById: () => null }, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'auditorias', 'deep_audit.js'), 'utf8'), sandbox);
const T = sandbox.__deepAuditTest;
check('el archivo carga y expone su API', !!T && typeof sandbox.loadDeepAudit === 'function');

const foto = [
  { cc: 'SU3O', descr: 'ELEV Z1 S1 P4', estado: 'Shipped', kg: 19913, sector: 'ELEV', piso: 'P4', ciclo: 'Z1', tipo: 'normal', cubicador: 'hmondaca' },
  { cc: 'SVIP', descr: 'ELEVACIONES PISO 1 Z1', estado: 'Open', kg: 14706, sector: 'ELEV', piso: 'P1', ciclo: 'Z1', tipo: 'normal', cubicador: 'nlopez' },
  { cc: 'SUWP', descr: 'ELEV S1 C1', estado: 'Open', kg: 14263, sector: 'ELEV', piso: 'S1', ciclo: 'C1', tipo: 'normal', cubicador: 'nlopez' },
  { cc: 'SUQC', descr: 'FUND C1', estado: 'Shipped', kg: 9292, sector: 'FUND', piso: null, ciclo: 'C1', tipo: 'normal', cubicador: 'nlopez', reciente: true },
  { cc: 'SVN9', descr: 'REP CB', estado: 'Shipped', kg: 90, sector: null, piso: null, ciclo: null, tipo: 'reproceso', cubicador: 'nlopez' }
];

console.log('El edificio');
const e = T.edificio(foto);
check('la torre arriba, los subterráneos abajo, la fundación al fondo', e.pisos.join() === 'P4,P1,S1,Fundación');
check('los ciclos en orden: C1 antes que Z1', e.ciclos.join() === 'C1,Z1');
check('los reprocesos van fuera de la grilla', e.fuera.map(c => c.cc).join() === 'SVN9');
check('una fundación va en su fila aunque no tenga piso', T.filaPiso(foto[3]) === 'Fundación' && T.enGrilla(foto[3]));

console.log('Los hallazgos');
const hs = [{ id: 1, regla: 'D2', gravedad: 'alta', cc: 'SVIP', titulo: 'x', estado: 'pendiente' },
            { id: 2, regla: 'N1', gravedad: 'aviso', cc: 'SVIP', titulo: 'y', estado: 'confirmado' },
            { id: 3, regla: 'N1', gravedad: 'aviso', cc: 'SUWP', titulo: 'z', estado: 'pendiente' },
            { id: 4, regla: 'K1', gravedad: 'aviso', cc: null, titulo: 'w', estado: 'pendiente' }];
const pc = T.porCc(hs);
check('por CC (los de la obra entera no tienen ficha)', pc.SVIP.length === 2 && pc.SUWP.length === 1 && !pc.null);
check('la gravedad que manda es la peor', T.peor(pc.SVIP) === 'alta' && T.peor([]) === 'ninguno');
const fam = T.familias(hs);
check('familias con su cantidad y lo ya revisado, en el orden del diseño',
      fam.map(f => f.regla).join() === 'N1,D2,K1' && fam[0].n === 2 && fam[0].pendientes === 1);

console.log('El color de la ficha');
const cubs = T.colorCubicador(foto);
check('un color estable por cubicador', !!cubs.hmondaca && !!cubs.nlopez && cubs.hmondaca !== cubs.nlopez);
check('por estado, y verde intenso si salió las últimas 3 semanas',
      T.colorDe(foto[1], 'estado', [], cubs) === T.ESTADO.Open && T.colorDe(foto[3], 'estado', [], cubs) === T.ESTADO.reciente);
check('por hallazgos: la peor gravedad', T.colorDe(foto[1], 'hallazgos', pc.SVIP, cubs) === T.GRAVEDAD.alta);
check('por cubicador', T.colorDe(foto[0], 'cubicador', [], cubs) === cubs.hmondaca);
T.DPA.color = 'estado'; T.DPA.familia = 'D2';
check('con una familia elegida, el CC sin ella se apaga y el que la tiene no',
      T.ficha(foto[2], pc, cubs).includes('apagada') && !T.ficha(foto[1], pc, cubs).includes('apagada'));
T.DPA.familia = '';
check('la ficha: código, descripción, kilos y la marca de hallazgos', T.ficha(foto[1], pc, cubs).includes('SVIP')
      && T.ficha(foto[1], pc, cubs).includes('14.706') && T.ficha(foto[1], pc, cubs).includes('⚠ 2'));

console.log('La ventana del CC');
check('un hallazgo pendiente: Confirmar y Descartar', T.filaHallazgo(hs[0]).includes('data-val="confirmado"')
      && T.filaHallazgo(hs[0]).includes('data-val="descartado"'));
const revisado = Object.assign({}, hs[1], { revisado_nombre: 'Ana' });
check('uno revisado: Reabrir y quién lo revisó', T.filaHallazgo(revisado).includes('data-val="pendiente"')
      && T.filaHallazgo(revisado).includes('Ana'));
const fb = T.filaBarra({ marca: '10mmA11', notas: 'TL', diam: '10mm', figura: 'T12', dims: { A: 120, B: 1060 }, largo: 1300,
                         cant: 30, kg: 24, eje_id: '29-G', marca_estado: 'fuera', ubicacion: 'ELEV P1 - 29-G' },
                       { '29-G': 'CB antes que TC' });
check('la barra marcada: marca fuera del modelo y su elemento fuera de orden', fb.attrs.includes('dpa-obs')
      && fb.propias[0].includes('Fuera del modelo') && fb.propias[0].includes('Elemento fuera de orden: CB antes que TC')
      && fb.barra.lados.B === 106 && fb.elemento === '29-G');

console.log('La lista de entrada');
const corrida = { id: 1, obra: 'PL - EDIFICIO OPERA', jobs: ['2013218', '2013218B'], creado_el: '2026-11-26T15:47:00+00:00',
                  creado_por: 'eugenio.z@x.cl', creado_nombre: null, ccs: 39, kg: 263425.6, hallazgos: 75, revisados: 0,
                  alta: 2, media: 36, aviso: 37 };
const fl = T.filaLista(corrida);
check('cada auditoría en una fila que la abre: número, obra, CC, kilos, hallazgos y revisados',
      fl.includes('data-corrida="1"') && fl.includes('data-job="2013218"') && fl.includes('DA-1') && fl.includes('PL - EDIFICIO OPERA')
      && fl.includes('263.426') && fl.includes('0/75'));
check('el estado de la revisión', T.estadoRevision(corrida)[1] === 'Por revisar'
      && T.estadoRevision(Object.assign({}, corrida, { revisados: 10 }))[1] === 'En revisión'
      && T.estadoRevision(Object.assign({}, corrida, { revisados: 75 }))[1] === 'Revisada');
check('la barrita de gravedad (alta, media, aviso)', T.barraGravedad(corrida).includes(T.GRAVEDAD.alta)
      && T.barraGravedad(corrida).includes('Alta 2'));

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTodo OK');
process.exit(fallos ? 1 : 0);
