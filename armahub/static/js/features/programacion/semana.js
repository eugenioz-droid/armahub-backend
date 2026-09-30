// PROGRAMA SEMANAL — MAQUETA (30-sep). El flujo que aprobó el usuario:
//
//   1. ARMAR LA SEMANA, un cubicador a la vez —así se trabaja hoy—: se elige al
//      cubicador (sólo los activos, que lo dice aSa), aparecen SUS obras, se agregan las
//      que va a hacer y recién ahí se llenan las toneladas, que se pueden arrastrar de un
//      día a otro. Sólo obras que existen en aSa: lo que no está en aSa no se programa.
//   2. DURANTE LA SEMANA nadie escribe: el real llega solo de aSa (kg por cubicador, obra
//      y día, por fecha de pedido).
//   3. TABLERO: programado vs cubicado por cubicador, % y cumplimiento por día; por obra
//      al desplegar; lo cubicado fuera de programa aparte.
//   4. CIERRE: cumplimiento acumulado (después).
//
// La etapa 2 —que cada USC programe lo suyo— cambia QUIÉN llena esto, no la pantalla.
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
  var DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
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
  var SEL = null;              // el cubicador cuya semana se está armando
  var SOLO_ACTIVOS = true;     // aSa trae 45 personas y la mayoría ya no cubica
  var BUSCA_OBRA = '';

  function lunesDe(offset) {
    var d = new Date(); d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
    return d;
  }
  // El programa se guarda por semana. Sólo en este navegador: es la maqueta.
  function clave() { return 'prgSemana:' + DATA.lunes; }
  function leerPlan() { try { return JSON.parse(localStorage.getItem(clave()) || '{}'); } catch (e) { return {}; } }
  function guardarPlan() { try { localStorage.setItem(clave(), JSON.stringify(PLAN)); } catch (e) {} }

  // Quién aparece en el selector: los ACTIVOS según aSa (cubicó en los últimos meses).
  // Quien ya tiene programa se muestra siempre, aunque esté inactivo: si no, no habría
  // cómo verlo ni corregirlo.
  function personasVisibles() {
    return (DATA.personas || []).filter(function (p) {
      return !SOLO_ACTIVOS || p.activo || (PLAN[p.persona] && PLAN[p.persona].length);
    });
  }
  function dias() {
    var out = [], l = new Date(DATA.lunes + 'T12:00:00');
    for (var i = 0; i < 5; i++) { var d = new Date(l); d.setDate(l.getDate() + i); out.push(iso(d)); }
    return out;
  }

  global.loadPrgSemana = async function () {
    if (!$('prgPanelSemana')) return;
    global.prgSemanaBind();
    try {
      DATA = await req('/programacion/semana-real?desde=' + iso(lunesDe(SEM)));
      if (!DATA) return;
      PLAN = leerPlan();
      // Se abre en alguien: el primero con programa, o el primer activo.
      var vis = personasVisibles();
      if (!SEL || !vis.some(function (p) { return p.persona === SEL; })) {
        var conPlan = vis.filter(function (p) { return PLAN[p.persona] && PLAN[p.persona].length; });
        SEL = (conPlan[0] || vis[0] || {}).persona || null;
      }
      pintar();
    } catch (e) { aviso(e.message); }
  };
  global.prgSemanaMover = function (n) { SEM += n; global.loadPrgSemana(); };

  // ── Las reglas, puras (se prueban sin navegador) ───────────────────────────
  // Agregar una obra al programa de alguien. No se repite: si ya está, no hace nada.
  function agregarObra(plan, persona, obra, job) {
    if (!plan[persona]) plan[persona] = [];
    if (plan[persona].some(function (o) { return o.obra === obra; })) return plan;
    plan[persona].push({ obra: obra, job: job || null, dias: [0, 0, 0, 0, 0] });
    return plan;
  }
  function quitarObra(plan, persona, k) {
    if (!plan[persona]) return plan;
    plan[persona].splice(k, 1);
    if (!plan[persona].length) delete plan[persona];
    return plan;
  }
  // ARRASTRAR un bloque de toneladas de un día a otro, dentro de la misma obra. Si el día
  // de destino ya tenía algo, se suman: mover encima es juntar, no pisar.
  function moverDia(plan, persona, k, desde, hasta) {
    var o = (plan[persona] || [])[k];
    if (!o || desde === hasta) return plan;
    var v = Number(o.dias[desde]) || 0;
    if (!v) return plan;
    o.dias[hasta] = (Number(o.dias[hasta]) || 0) + v;
    o.dias[desde] = 0;
    return plan;
  }

  // plan + real → tablero. plan: {persona: [{obra, job, dias:[t×5]}]}.
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
    var ds = dias();
    $('prgSemTitulo').textContent = 'Semana ' + ddmm(DATA.lunes) + ' → ' + ddmm(DATA.viernes) + (SEM === 0 ? ' · esta semana' : '');
    pintarSelector();
    pintarSusObras();
    pintarSuSemana(ds);
    pintarTablero(ds);
  }

  // 1a · a quién le estoy armando la semana
  function pintarSelector() {
    var vis = personasVisibles();
    var html = vis.map(function (p) {
      var n = (PLAN[p.persona] || []).length;
      return '<button class="chip' + (p.persona === SEL ? ' on' : '') + '" data-p="' + esc(p.persona) + '"' +
        ' title="' + esc(p.persona) + (p.activo ? ' · activo' : ' · sin cubicar en los últimos ' + (DATA.meses_activo || 3) + ' meses') +
        (p.ultimo ? ' · último pedido ' + ddmm(p.ultimo) : '') + '">' +
        esc(p.persona) + (n ? ' <b>' + n + '</b>' : '') + '</button>';
    }).join('') || '<span class="muted">Nadie cubicó en los últimos meses.</span>';
    $('prgSemQuien').innerHTML = html;
    $('prgSemQuien').querySelectorAll('button.chip').forEach(function (b) {
      b.addEventListener('click', function () { SEL = b.dataset.p; BUSCA_OBRA = ''; pintar(); });
    });
    var ch = $('prgSemActivos');
    if (ch && ch.checked !== SOLO_ACTIVOS) ch.checked = SOLO_ACTIVOS;
  }

  // 1b · sus obras: las de aSa donde cubicó últimamente, y el buscador para el resto
  function pintarSusObras() {
    if (!SEL) { $('prgSemObras').innerHTML = '<span class="muted">Elige un cubicador arriba.</span>'; $('prgSemObrasN').textContent = ''; return; }
    var suyas = (DATA.obras_persona || {})[SEL] || [];
    var ya = {}; (PLAN[SEL] || []).forEach(function (o) { ya[o.obra] = 1; });
    var lista, fuente;
    if (BUSCA_OBRA) {
      // Con buscador se mira TODA aSa: así se agrega una obra nueva o inactiva.
      fuente = 'aSa completo';
      lista = (DATA.obras || []).filter(function (o) {
        return o.obra.toLowerCase().indexOf(BUSCA_OBRA) !== -1 || String(o.job || '').indexOf(BUSCA_OBRA) !== -1;
      }).slice(0, 60);
    } else {
      fuente = 'últimos ' + (DATA.meses_obras || 6) + ' meses';
      lista = suyas;
    }
    $('prgSemObrasN').textContent = '· ' + lista.length + ' · ' + fuente;
    $('prgSemObras').innerHTML = lista.map(function (o) {
      return '<div class="ob' + (ya[o.obra] ? ' ya' : '') + '" data-obra="' + esc(o.obra) + '" data-job="' + esc(o.job || '') + '"' +
        ' title="' + esc(o.obra) + (o.job ? ' · ' + esc(o.job) : '') + (ya[o.obra] ? ' · ya está en su semana' : ' · clic para agregar') + '">' +
        '<span class="n">' + esc(o.obra) + '</span>' +
        '<span class="k">' + t1(o.kg) + ' t</span>' +
        '<span class="v">' + (ya[o.obra] ? '✓' : '+') + '</span></div>';
    }).join('') || '<span class="muted">' + (BUSCA_OBRA ? 'Ninguna obra de aSa coincide.' : 'No cubicó nada en los últimos meses: búscala arriba.') + '</span>';
    $('prgSemObras').querySelectorAll('.ob').forEach(function (el) {
      el.addEventListener('click', function () {
        agregarObra(PLAN, SEL, el.dataset.obra, el.dataset.job);
        guardarPlan(); pintar();
      });
    });
  }

  // 1c · su semana: toneladas por día. Se escriben o se arrastran de un día a otro.
  function pintarSuSemana(ds) {
    if (!SEL) { $('prgSemArmar').innerHTML = ''; $('prgSemArmarN').textContent = ''; return; }
    var filas = PLAN[SEL] || [];
    var sub = [0, 0, 0, 0, 0];
    filas.forEach(function (o) { o.dias.forEach(function (t, i) { sub[i] += Number(t) || 0; }); });
    var total = sub.reduce(function (a, b) { return a + b; }, 0);
    $('prgSemArmarN').innerHTML = '· ' + filas.length + ' obra(s) · <b style="color:#33691e">' + total + ' t</b>';
    if (!filas.length) {
      $('prgSemArmar').innerHTML = '<span class="muted">Agrega obras desde la caja de la izquierda.</span>';
      return;
    }
    var html = '<table class="prgsem"><thead><tr><th class="ob">Obra</th>' +
      ds.map(function (d, i) { return '<th>' + DIAS[i] + ' <small>' + ddmm(d) + '</small></th>'; }).join('') +
      '<th>Sem</th><th></th></tr></thead><tbody>';
    filas.forEach(function (o, k) {
      html += '<tr><td class="ob" title="' + esc(o.obra) + (o.job ? ' · ' + esc(o.job) : '') + '">' + esc(o.obra) + '</td>' +
        o.dias.map(function (t, i) {
          var v = Number(t) || 0;
          return '<td class="num celda' + (v ? ' lleno' : '') + '" data-k="' + k + '" data-i="' + i + '"' +
                 (v ? ' draggable="true" title="Arrastra estas ' + v + ' t a otro día"' : '') + '>' +
                 '<input type="number" min="0" step="1" value="' + (v || '') + '" data-k="' + k + '" data-i="' + i + '" placeholder="–"></td>';
        }).join('') +
        '<td class="num"><b>' + (o.dias.reduce(function (a, t) { return a + (Number(t) || 0); }, 0) || '') + '</b></td>' +
        '<td><button class="q" data-k="' + k + '" title="Quitar del programa">✕</button></td></tr>';
    });
    html += '</tbody><tfoot><tr><td class="ob">Total (t)</td>' +
      sub.map(function (v) { return '<td class="num">' + (v || '') + '</td>'; }).join('') +
      '<td class="num">' + (total || '') + '</td><td></td></tr></tfoot></table>';
    $('prgSemArmar').innerHTML = html;

    // Las toneladas se guardan al escribir, sin botón.
    $('prgSemArmar').querySelectorAll('input[data-k]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        PLAN[SEL][inp.dataset.k].dias[inp.dataset.i] = inp.value === '' ? 0 : Number(inp.value);
        guardarPlan(); pintar();
      });
    });
    $('prgSemArmar').querySelectorAll('button.q').forEach(function (b) {
      b.addEventListener('click', function () { quitarObra(PLAN, SEL, Number(b.dataset.k)); guardarPlan(); pintar(); });
    });
    // ARRASTRAR de un día a otro: se mueve el bloque de toneladas de esa obra.
    $('prgSemArmar').querySelectorAll('td.celda').forEach(function (td) {
      td.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', td.dataset.k + ':' + td.dataset.i);
        ev.dataTransfer.effectAllowed = 'move';
        td.classList.add('arrastrando');
      });
      td.addEventListener('dragend', function () {
        td.classList.remove('arrastrando');
        $('prgSemArmar').querySelectorAll('td.sobre').forEach(function (x) { x.classList.remove('sobre'); });
      });
      td.addEventListener('dragover', function (ev) { ev.preventDefault(); td.classList.add('sobre'); });
      td.addEventListener('dragleave', function () { td.classList.remove('sobre'); });
      td.addEventListener('drop', function (ev) {
        ev.preventDefault();
        var p = String(ev.dataTransfer.getData('text/plain') || '').split(':');
        if (p.length !== 2) return;
        // Sólo dentro de la MISMA obra: mover kilos de una obra a otra sería inventar
        // trabajo que nadie programó.
        if (p[0] !== td.dataset.k) { aviso('Las toneladas se mueven entre días de la misma obra.'); return; }
        moverDia(PLAN, SEL, Number(p[0]), Number(p[1]), Number(td.dataset.i));
        guardarPlan(); pintar();
      });
    });
  }

  function pintarTablero(ds) {
    // El tablero muestra a TODOS los que se ven arriba, tengan programa o no.
    var personas = personasVisibles().map(function (p) { return p.persona; });
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
      html += '<tr class="per' + (r.persona === SEL ? ' sel' : '') + '" data-p="' + esc(r.persona) + '">' +
        '<td class="ob"><span class="tri">' + (abierto ? '▾' : '▸') + '</span> <b>' + esc(r.persona) + '</b></td>' +
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

  // Los controles fijos del panel (no se repintan).
  var _bound = false;
  global.prgSemanaBind = function () {
    if (_bound) return; _bound = true;
    var ch = $('prgSemActivos');
    if (ch) ch.addEventListener('change', function () { SOLO_ACTIVOS = ch.checked; pintar(); });
    var bq = $('prgSemBuscaObra');
    if (bq) bq.addEventListener('input', function () { BUSCA_OBRA = bq.value.trim().toLowerCase(); pintarSusObras(); });
  };

  // Expuesto para los tests: las reglas, sin DOM.
  global.__prgSemanaTest = { tablero: tablero, agregarObra: agregarObra, quitarObra: quitarObra,
                             moverDia: moverDia, TOLERANCIA: TOLERANCIA };

})(window);
