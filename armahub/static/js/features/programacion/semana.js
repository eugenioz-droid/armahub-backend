// PROGRAMA SEMANAL — MAQUETA (30-sep). El flujo que aprobó el usuario:
//
//   1. ARMAR LA SEMANA: por cubicador, obras con toneladas por día (L–V). Sólo obras que
//      existen en aSa. Entrada mínima: obra + toneladas.
//   2. DURANTE LA SEMANA nadie escribe: el real llega solo de aSa (kg por cubicador, obra
//      y día, por fecha de pedido).
//   3. TABLERO: programado vs cubicado por cubicador, % y cumplimiento por día; por obra
//      al desplegar; lo cubicado fuera de programa aparte.
//   4. CIERRE: cumplimiento acumulado (después).
//
// ES MAQUETA: el programa se guarda en ESTE navegador (localStorage), no en la base. El
// lado real sí es de verdad (endpoint /programacion/semana-real). Cuando el formato esté
// aprobado, el programa pasa a una tabla y el resto queda igual.
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function t1(kg) { return (Math.round((Number(kg) || 0) / 100) / 10).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function ddmm(s) { var p = s.split('-'); return p[2] + '/' + p[1]; }
  var DIAS = ['L', 'M', 'M', 'J', 'V'];
  // Cumple el día si cubicó al menos el 90% de lo programado: un 10% de holgura para que
  // un pedido chico que se corrió no pinte rojo la semana.
  var TOLERANCIA = 0.9;

  async function req(url) {
    var res = await fetch(global.apiUrl(url), { headers: global.authHeaders() });
    if (res.status === 401) { global.logout(); return null; }
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.detail) || ('Error ' + res.status));
    return data;
  }
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); else alert(m); }

  var SEM = 0, DATA = null, PLAN = {}, ABIERTO = {};

  function lunesDe(offset) {
    var d = new Date(); d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
    return d;
  }
  // El programa se guarda por semana. Sólo en este navegador: es la maqueta.
  function clave() { return 'prgSemana:' + DATA.lunes; }
  function leerPlan() { try { return JSON.parse(localStorage.getItem(clave()) || '{}'); } catch (e) { return {}; } }
  function guardarPlan() { try { localStorage.setItem(clave(), JSON.stringify(PLAN)); } catch (e) {} }
  // Los cubicadores que se muestran: los que el usuario eligió en aSa Data («Mi equipo»),
  // y si no eligió, todos los que aparecen en aSa.
  function equipo() {
    var det = [];
    try { det = JSON.parse(localStorage.getItem('prgDshDetailers') || '[]'); } catch (e) {}
    var todos = DATA.personas || [];
    var lista = det.length ? todos.filter(function (p) { return det.indexOf(p) !== -1; }) : todos;
    Object.keys(PLAN).forEach(function (p) { if (lista.indexOf(p) === -1) lista.push(p); });
    return lista;
  }
  function dias() {
    var out = [], l = new Date(DATA.lunes + 'T12:00:00');
    for (var i = 0; i < 5; i++) { var d = new Date(l); d.setDate(l.getDate() + i); out.push(iso(d)); }
    return out;
  }

  global.loadPrgSemana = async function () {
    try {
      DATA = await req('/programacion/semana-real?desde=' + iso(lunesDe(SEM)));
      if (!DATA) return;
      PLAN = leerPlan();
      pintar();
    } catch (e) { aviso(e.message); }
  };
  global.prgSemanaMover = function (n) { SEM += n; global.loadPrgSemana(); };

  // ── El cálculo, puro: plan + real → tablero ─────────────────────────────────
  // plan: {persona: [{obra, job, dias:[t,t,t,t,t]}]}; real: filas del endpoint.
  function tablero(plan, real, ds, personas) {
    var porDia = {};   // persona|obra|dia → kg
    var porPO = {};    // persona|obra → kg
    var porPD = {};    // persona|dia → kg, con TODO lo que cubicó ese día (programado o no)
    real.forEach(function (r) {
      porDia[r.persona + '|' + r.obra + '|' + r.dia] = (porDia[r.persona + '|' + r.obra + '|' + r.dia] || 0) + r.kg;
      porPO[r.persona + '|' + r.obra] = (porPO[r.persona + '|' + r.obra] || 0) + r.kg;
      porPD[r.persona + '|' + r.dia] = (porPD[r.persona + '|' + r.dia] || 0) + r.kg;
    });
    return personas.map(function (p) {
      var filas = (plan[p] || []).map(function (o) {
        var prog = o.dias.map(function (t) { return (Number(t) || 0) * 1000; });
        var cub = ds.map(function (d) { return porDia[p + '|' + o.obra + '|' + d] || 0; });
        return { obra: o.obra, job: o.job, prog: prog, cub: cub,
                 progT: prog.reduce(function (a, b) { return a + b; }, 0),
                 cubT: cub.reduce(function (a, b) { return a + b; }, 0) };
      });
      var progDia = ds.map(function (_, i) { return filas.reduce(function (a, f) { return a + f.prog[i]; }, 0); });
      var cubDia = ds.map(function (_, i) { return filas.reduce(function (a, f) { return a + f.cub[i]; }, 0); });
      var enPlan = {}; filas.forEach(function (f) { enPlan[f.obra] = 1; });
      // Lo cubicado en obras que NO estaban en el programa: se muestra aparte, no suma
      // al cumplimiento (cumplir es hacer lo programado).
      var fuera = [];
      Object.keys(porPO).forEach(function (k) {
        var s = k.split('|');
        if (s[0] === p && !enPlan[s[1]]) fuera.push({ obra: s[1], kg: porPO[k] });
      });
      fuera.sort(function (a, b) { return b.kg - a.kg; });
      var progT = progDia.reduce(function (a, b) { return a + b; }, 0);
      var cubT = cubDia.reduce(function (a, b) { return a + b; }, 0);
      // Todo lo cubicado en el día, esté o no en el programa: es lo que se muestra en la
      // celda, y lo que decide «+» (cubicó sin tener nada programado).
      var totDia = ds.map(function (d) { return porPD[p + '|' + d] || 0; });
      return { persona: p, filas: filas, progDia: progDia, cubDia: cubDia, totDia: totDia,
               progT: progT, cubT: cubT, pct: progT ? cubT / progT : null,
               estadoDia: ds.map(function (_, i) {
                 if (!progDia[i]) return totDia[i] ? 'extra' : 'nada';
                 return cubDia[i] >= progDia[i] * TOLERANCIA ? 'ok' : 'no';
               }),
               fuera: fuera, fueraT: fuera.reduce(function (a, f) { return a + f.kg; }, 0) };
    });
  }

  // ── Pintar ─────────────────────────────────────────────────────────────────
  function pintar() {
    var ds = dias(), personas = equipo();
    $('prgSemTitulo').textContent = 'Semana ' + ddmm(DATA.lunes) + ' → ' + ddmm(DATA.viernes) + (SEM === 0 ? ' · esta semana' : '');
    pintarArmar(ds, personas);
    pintarTablero(ds, personas);
  }

  function pintarArmar(ds, personas) {
    var html = '<table class="prgsem"><thead><tr><th class="ob">Cubicador · obra</th>' +
      ds.map(function (d, i) { return '<th>' + DIAS[i] + ' <small>' + ddmm(d) + '</small></th>'; }).join('') +
      '<th>Sem</th><th></th></tr></thead><tbody>';
    var totDia = [0, 0, 0, 0, 0], tot = 0;
    personas.forEach(function (p) {
      var filas = PLAN[p] || [];
      var sub = [0, 0, 0, 0, 0];
      html += '<tr class="per"><td class="ob"><b>' + esc(p) + '</b> <button class="mas" data-p="' + esc(p) + '" title="Agregar una obra de aSa al programa de ' + esc(p) + '">+ obra</button></td>';
      filas.forEach(function (o) { o.dias.forEach(function (t, i) { sub[i] += Number(t) || 0; }); });
      html += sub.map(function (v) { return '<td class="num sub">' + (v ? v : '') + '</td>'; }).join('') +
        '<td class="num sub"><b>' + (sub.reduce(function (a, b) { return a + b; }, 0) || '') + '</b></td><td></td></tr>';
      filas.forEach(function (o, k) {
        html += '<tr><td class="ob" title="' + esc(o.obra) + (o.job ? ' · ' + esc(o.job) : '') + '">' + esc(o.obra) + '</td>' +
          o.dias.map(function (t, i) {
            return '<td class="num"><input type="number" min="0" step="1" value="' + (t || '') + '" data-p="' + esc(p) + '" data-k="' + k + '" data-i="' + i + '" placeholder="–"></td>';
          }).join('') +
          '<td class="num"><b>' + (o.dias.reduce(function (a, t) { return a + (Number(t) || 0); }, 0) || '') + '</b></td>' +
          '<td><button class="q" data-p="' + esc(p) + '" data-k="' + k + '" title="Quitar del programa">✕</button></td></tr>';
      });
      sub.forEach(function (v, i) { totDia[i] += v; tot += v; });
    });
    html += '</tbody><tfoot><tr><td class="ob">Total programado (t)</td>' +
      totDia.map(function (v) { return '<td class="num">' + (v || '') + '</td>'; }).join('') +
      '<td class="num">' + (tot || '') + '</td><td></td></tr></tfoot></table>';
    $('prgSemArmar').innerHTML = html;

    // Toneladas por día: se guardan al escribir, sin botón.
    $('prgSemArmar').querySelectorAll('input[data-p]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        PLAN[inp.dataset.p][inp.dataset.k].dias[inp.dataset.i] = inp.value === '' ? 0 : Number(inp.value);
        guardarPlan(); pintar();
      });
    });
    $('prgSemArmar').querySelectorAll('button.q').forEach(function (b) {
      b.addEventListener('click', function () {
        PLAN[b.dataset.p].splice(Number(b.dataset.k), 1);
        if (!PLAN[b.dataset.p].length) delete PLAN[b.dataset.p];
        guardarPlan(); pintar();
      });
    });
    $('prgSemArmar').querySelectorAll('button.mas').forEach(function (b) {
      b.addEventListener('click', function () { elegirObra(b.dataset.p, b); });
    });
  }

  // El selector de obra: SÓLO obras de aSa (las activas del último año), con buscador.
  function elegirObra(persona, boton) {
    var viejo = $('prgSemPick'); if (viejo) viejo.remove();
    var caja = document.createElement('div');
    caja.id = 'prgSemPick'; caja.className = 'prgpick';
    caja.innerHTML = '<input type="text" placeholder="Buscar obra de aSa…" autofocus><div class="lista"></div>';
    boton.parentNode.appendChild(caja);
    var inp = caja.querySelector('input'), lista = caja.querySelector('.lista');
    var ya = (PLAN[persona] || []).map(function (o) { return o.obra; });
    var pintarLista = function () {
      var q = inp.value.trim().toLowerCase();
      var cands = (DATA.obras || []).filter(function (o) {
        return ya.indexOf(o.obra) === -1 && (!q || o.obra.toLowerCase().indexOf(q) !== -1 || String(o.job || '').indexOf(q) !== -1);
      }).slice(0, 40);
      lista.innerHTML = cands.map(function (o) {
        return '<div data-obra="' + esc(o.obra) + '" data-job="' + esc(o.job || '') + '"><b>' + esc(o.obra) + '</b><small>' + esc(o.job || '') + ' · ' + t1(o.kg) + ' t en 12 m</small></div>';
      }).join('') || '<div class="muted" style="padding:6px">Ninguna obra de aSa coincide</div>';
      lista.querySelectorAll('div[data-obra]').forEach(function (el) {
        el.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          if (!PLAN[persona]) PLAN[persona] = [];
          PLAN[persona].push({ obra: el.dataset.obra, job: el.dataset.job, dias: [0, 0, 0, 0, 0] });
          guardarPlan(); caja.remove(); pintar();
        });
      });
    };
    inp.addEventListener('input', pintarLista);
    inp.addEventListener('blur', function () { setTimeout(function () { caja.remove(); }, 150); });
    inp.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') caja.remove(); });
    pintarLista(); inp.focus();
  }

  function pintarTablero(ds, personas) {
    var T = tablero(PLAN, DATA.real || [], ds, personas);
    var conPlan = T.filter(function (r) { return r.filas.length; });
    var progT = T.reduce(function (a, r) { return a + r.progT; }, 0);
    var cubT = T.reduce(function (a, r) { return a + r.cubT; }, 0);
    $('prgSemTabN').innerHTML = conPlan.length
      ? '· programado <b>' + t1(progT) + ' t</b> · cubicado <b style="color:#33691e">' + t1(cubT) + ' t</b>' +
        (progT ? ' · <b>' + Math.round(cubT / progT * 100) + '%</b>' : '')
      : '· sin programa esta semana: arma la semana arriba';
    var html = '<table class="prgsem tab"><thead><tr><th class="ob">Cubicador</th><th>Programado</th><th>Cubicado</th><th>%</th>' +
      DIAS.map(function (d, i) { return '<th>' + d + ' <small>' + ddmm(ds[i]) + '</small></th>'; }).join('') +
      '<th>Fuera de programa</th></tr></thead><tbody>';
    var icono = { ok: '<span class="ok">✔</span>', no: '<span class="no">✘</span>', extra: '<span class="ex">+</span>', nada: '<span class="nd">–</span>' };
    T.forEach(function (r) {
      var abierto = !!ABIERTO[r.persona];
      html += '<tr class="per" data-p="' + esc(r.persona) + '"><td class="ob"><span class="tri">' + (abierto ? '▾' : '▸') + '</span> <b>' + esc(r.persona) + '</b></td>' +
        '<td class="num">' + (r.progT ? t1(r.progT) : '–') + '</td>' +
        '<td class="num"><b>' + t1(r.cubT + r.fueraT) + '</b></td>' +
        '<td class="num pct ' + (r.pct == null ? '' : r.pct >= TOLERANCIA ? 'ok' : 'no') + '">' + (r.pct == null ? '–' : Math.round(r.pct * 100) + '%') + '</td>' +
        r.estadoDia.map(function (e, i) {
          return '<td class="dia" title="programado ' + t1(r.progDia[i]) + ' t · cubicado en lo programado ' + t1(r.cubDia[i]) +
                 ' t · cubicado total ' + t1(r.totDia[i]) + ' t">' + icono[e] +
                 (r.totDia[i] ? '<small>' + t1(r.totDia[i]) + '</small>' : '') + '</td>';
        }).join('') +
        '<td class="num muted" title="' + esc(r.fuera.map(function (f) { return f.obra + ': ' + t1(f.kg) + ' t'; }).join('\n')) + '">' + (r.fueraT ? t1(r.fueraT) + ' t · ' + r.fuera.length + ' obra(s)' : '') + '</td></tr>';
      if (abierto) {
        r.filas.forEach(function (f) {
          html += '<tr class="det"><td class="ob">' + esc(f.obra) + '</td><td class="num">' + (f.progT ? t1(f.progT) : '–') + '</td>' +
            '<td class="num">' + t1(f.cubT) + '</td><td class="num">' + (f.progT ? Math.round(f.cubT / f.progT * 100) + '%' : '–') + '</td>' +
            f.prog.map(function (pv, i) {
              return '<td class="dia"><small>' + (pv ? t1(pv) : '–') + ' / ' + (f.cub[i] ? t1(f.cub[i]) : '–') + '</small></td>';
            }).join('') + '<td></td></tr>';
        });
        r.fuera.forEach(function (f) {
          html += '<tr class="det ex"><td class="ob">' + esc(f.obra) + ' <small>(fuera de programa)</small></td><td class="num">–</td>' +
            '<td class="num">' + t1(f.kg) + '</td><td></td><td colspan="5"></td><td></td></tr>';
        });
      }
    });
    $('prgSemTablero').innerHTML = html + '</tbody></table>';
    $('prgSemTablero').querySelectorAll('tr.per').forEach(function (tr) {
      tr.addEventListener('click', function () { ABIERTO[tr.dataset.p] = !ABIERTO[tr.dataset.p]; pintar(); });
    });
  }

  // Expuesto para los tests: la regla del tablero, sin DOM.
  global.__prgSemanaTest = { tablero: tablero, TOLERANCIA: TOLERANCIA };

})(window);
