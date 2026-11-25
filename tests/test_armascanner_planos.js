// Mis obras › Planos (armascanner/planos.js) con un DOM mínimo simulado: el plano en revisión, el estado de cada
// ciclo y su pedido (mig 183, 25-nov). Correr con: node tests/test_armascanner_planos.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'armascanner');
const elementos = {};
function elemento(id) {
  if (!elementos[id]) elementos[id] = { id, innerHTML: '', textContent: '', style: {}, classList: { toggle() {} } };
  return elementos[id];
}
const pedidos = [], toasts = [], confirmaciones = [];
const ventana = {
  document: { getElementById: elemento, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
  apiUrl: (r) => r, authHeaders: () => ({}), logout() {},
  showToast: (t, k) => toasts.push([t, k]), showModal() {},
  apiGet: async (ruta) => {
    pedidos.push(['GET', ruta]);
    return { grupo: 'C1', estado: 'cambios', version: 5, enviado: { version: 3, enviado_el: '25-11', enviado_por: 'Emilio' },
             diferencias: { nuevas: ['B-0010'], corregidas: [{ id: 'B-0004', campos: [['FIGURA', '104A', '104F']] }],
                            eliminadas: ['B-0007'] } };
  },
  confirm: (t) => { confirmaciones.push(t); return true; },
};
ventana.window = ventana;
ventana.fetch = async (ruta, op) => {
  pedidos.push(['POST', ruta, JSON.parse(op.body)]);
  return { status: 200, ok: true, json: async () => ({ ok: true, barras: 2, kilos: 10 }) };
};
const ctx = vm.createContext(Object.assign(ventana, { console }));
for (const f of ['comun.js', 'planos.js']) vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
const A = ctx.Asc;
A.recargarObra = async () => {};

let fallos = 0;
function check(nombre, cond, detalle) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre + (cond ? '' : '  -- ' + String(detalle).slice(0, 400)));
  if (!cond) fallos += 1;
}

const enRevision = {
  obra: 'PROY-1', plano: 'P1', numero: '301', titulo: 'LOSA', etapa: 'en_revision', version: 7, resumen: { barras: 3 },
  entrega: { version: 5, autor: 'Emilio' }, reemplazos: [], puede_enviar: false, puede_enviar_grupos: true, kpis: null,
  grupos: [{ grupo: 'C1', estado: 'cambios', barras: 2, enviado: { version: 3, enviado_el: '25-11', enviado_por: 'Emilio' } },
           { grupo: 'C2', estado: 'completo', barras: 1, enviado: null },
           { grupo: 'C3', estado: 'en_revision', barras: 4, enviado: null },
           { grupo: 'C4', estado: 'enviado', barras: 2, enviado: { version: 5, enviado_el: '25-11', enviado_por: 'Emilio' } }],
};
const antiguo = { obra: 'PROY-1', plano: 'P2', numero: '302', titulo: 'LOSA', etapa: 'terminado', version: 2,
                  resumen: { barras: 4 }, entrega: { version: 2 }, reemplazos: [], puede_enviar: true, grupos: [],
                  pedido: 'sin_enviar', kpis: null };
A.est.planos = [enRevision, antiguo];
A.pintarPlanos();
const html = elementos.ascPlanos.innerHTML;
check('el plano en revisión: «En revisión (v5)»', html.includes('arm-tag arm-tag--info">En revisión (v5)<'), html);
check('una etiqueta por ciclo con su estado',
      html.includes('C1 · Cambios sin enviar') && html.includes('C2 · Completo') && html.includes('C3 · En revisión')
      && html.includes('C4 · Enviado v5'), html);
check('lo enviado, a la vista al pasar: versión, cuándo y quién', html.includes('title="Enviado v3 · 25-11 · Emilio"'), html);
check('un botón por ciclo que se puede pedir: Reenviar C1 y Enviar C2; nada para C3 ni C4',
      html.includes(">Reenviar C1<") && html.includes(">Enviar C2<") && !html.includes('C3</button>') && !html.includes('C4</button>'), html);
check('con ciclos, sin «Enviar pedido» del plano entero', !html.split('302')[0].includes('>Enviar pedido<'), html);
check('sin ciclos (ArmaScanner anteriores): como siempre, «Enviar pedido» y «Sin enviar»',
      html.split('302')[1].includes('>Enviar pedido<') && html.split('302')[1].includes('Sin enviar'), html);
enRevision.puede_enviar_grupos = false;
A.pintarPlanos();
check('quien no puede enviar no ve los botones de los ciclos', !elementos.ascPlanos.innerHTML.includes('Reenviar C1'));
enRevision.puede_enviar_grupos = true;

(async () => {
  await ctx.ascEnviarGrupo(0, 'C1');
  const t = confirmaciones[confirmaciones.length - 1];
  check('Reenviar C1: antes de confirmar, lo que cambió desde lo enviado',
        t.startsWith('¿Reenviar C1 de 301 (v5)?') && t.includes('Desde lo enviado (v3)') && t.includes('1 nuevas: B-0010')
        && t.includes('1 corregidas: B-0004 (FIGURA 104A → 104F)') && t.includes('1 eliminadas: B-0007'), t);
  const post = pedidos.filter((x) => x[0] === 'POST').pop();
  check('y lo pide con su grupo', post[1] === '/armascanner/planos-linea/pedido' && post[2].grupo === 'C1' && post[2].plano === 'P1',
        JSON.stringify(post));
  await ctx.ascEnviarGrupo(0, 'C2');
  const t2 = confirmaciones[confirmaciones.length - 1];
  check('Enviar C2: sus barras y que reemplazan las de C2 del plano',
        t2.startsWith('¿Enviar pedido de C2 de 301?') && t2.includes('Sus 1 barras') && t2.includes('las de C2 de este plano'), t2);
  check('avisa lo enviado', toasts.some((x) => x[0].startsWith('C2 enviado: 2 barras') && x[1] === 'success'), JSON.stringify(toasts));
  console.log('\n' + (fallos ? 'FALLOS: ' + fallos : 'TODO OK'));
  process.exit(fallos ? 1 : 0);
})();
