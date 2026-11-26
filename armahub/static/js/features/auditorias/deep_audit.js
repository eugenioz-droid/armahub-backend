// DEEP AUDIT (26-nov, SPECS §16) — la quinta línea del tab de Auditorías.
//
// La foto de una obra de un golpe de vista: EL EDIFICIO EN CORTE (la torre arriba, los
// subterráneos bajo la línea de terreno, la fundación al fondo; los ciclos en columnas), cada
// CC una ficha con su color. «Color por» cambia lo que dice el color: estado, cubicador o
// hallazgos. A la derecha, los hallazgos por familia: un clic ilumina los CC afectados y apaga
// los demás. Clic en un CC: su ventana, con sus hallazgos (confirmar o descartar, queda quién y
// cuándo) y sus barras (la hoja estándar, con las marcas contra el modelo de A Detailer).
//
// Cada «Auditar» es una corrida nueva y queda guardada: arriba se elige cuál mirar.
// El servidor: deep_audit.py (reglas) y las rutas /deep-audit en chequeos_api.py.
(function (global) {
  'use strict';

  var FAMILIAS = [['N1', 'Nombres'], ['N2', 'Marcas'], ['D1', 'Duplicados'], ['D2', 'Doble pedido'],
                  ['E1', 'Open estancados'], ['E2', 'Cambios tras confirmar'], ['E3', 'Borrados de aSa'],
                  ['F1', 'Figuras'], ['K1', 'Peso fuera de rango'], ['R1', 'Reprocesos'], ['Q1', 'Reclamos']];
  var ESTADO = { Open: '#9CA3AF', Processed: '#D97706', Shipped: '#7EBA27', reciente: '#2E7D0F' };
  var ESTADO_TXT = [['Open', 'Open'], ['Processed', 'Processed'], ['Shipped', 'Shipped'], ['reciente', 'Shipped últimas 3 semanas']];
  var GRAVEDAD = { alta: '#DC2626', media: '#D97706', aviso: '#687582', ninguno: '#D9DDE3' };
  var SERIES = ['#7EBA27', '#104F9E', '#FF8A00', '#8344AD', '#278E86', '#687582', '#DB3B3B'];
  var COLORES = [['estado', 'Estado'], ['cubicador', 'Cubicador'], ['hallazgos', 'Hallazgos']];
  var DPA = { obras: null, cb: null, job: '', obra: '', corridas: [], corrida: null, color: 'estado', familia: '',
              corriendo: false, sondeo: null, n0: 0, modal: null };
  var _listo = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function nom(login) { return global.nomCub ? global.nomCub(login) : (login || ''); }
  function dos(n) { return ('0' + n).slice(-2); }
  function fecha(iso) {
    var d = new Date(iso || '');
    if (isNaN(d)) return '';
    return dos(d.getDate()) + '-' + dos(d.getMonth() + 1) + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }
  function dia(iso) { return iso ? String(iso).slice(8, 10) + '-' + String(iso).slice(5, 7) : ''; }
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); }
  function ok(m) { if (global.showToast) global.showToast(m, 'success'); }

  // ── EL EDIFICIO (puro) ─────────────────────────────────────────────────────────
  function filaPiso(c) { return c.sector === 'FUND' ? 'Fundación' : (c.piso || ''); }
  function enGrilla(c) { return c.tipo === 'normal' && !!filaPiso(c) && !!c.ciclo; }

  // La torre arriba, los subterráneos abajo, la fundación al fondo.
  function ordenPiso(p) {
    var m = /^([PS])(\d+)$/.exec(p || '');
    if (!m) return [3, 0];
    return m[1] === 'P' ? [0, -Number(m[2])] : [1, Number(m[2])];
  }
  function cmpPiso(a, b) { var x = ordenPiso(a), y = ordenPiso(b); return x[0] - y[0] || x[1] - y[1]; }
  function cmpCiclo(a, b) { return a[0] === b[0] ? Number(a.slice(1)) - Number(b.slice(1)) : (a < b ? -1 : 1); }

  function edificio(foto) {
    var dentro = foto.filter(enGrilla), pisos = {}, ciclos = {};
    dentro.forEach(function (c) { pisos[filaPiso(c)] = 1; ciclos[c.ciclo] = 1; });
    return { pisos: Object.keys(pisos).sort(cmpPiso), ciclos: Object.keys(ciclos).sort(cmpCiclo), dentro: dentro,
             fuera: foto.filter(function (c) { return !enGrilla(c); }) };
  }

  // ── LOS HALLAZGOS (puro) ───────────────────────────────────────────────────────
  function porCc(hallazgos) {
    var out = {};
    hallazgos.forEach(function (h) { if (h.cc) (out[h.cc] = out[h.cc] || []).push(h); });
    return out;
  }

  function peor(lista) {
    var orden = ['alta', 'media', 'aviso'];
    for (var i = 0; i < orden.length; i++) {
      if ((lista || []).some(function (h) { return h.gravedad === orden[i]; })) return orden[i];
    }
    return 'ninguno';
  }

  function familias(hallazgos) {
    return FAMILIAS.map(function (f) {
      var de = hallazgos.filter(function (h) { return h.regla === f[0]; });
      return { regla: f[0], nombre: f[1], n: de.length,
               pendientes: de.filter(function (h) { return h.estado === 'pendiente'; }).length };
    }).filter(function (f) { return f.n; });
  }

  function colorCubicador(foto) {
    var nombres = {};
    foto.forEach(function (c) { nombres[c.cubicador || '—'] = 1; });
    var out = {};
    Object.keys(nombres).sort().forEach(function (n, i) { out[n] = SERIES[i % SERIES.length]; });
    return out;
  }

  // El color de una ficha según «Color por».
  function colorDe(c, modo, hs, cubs) {
    if (modo === 'cubicador') return cubs[c.cubicador || '—'];
    if (modo === 'hallazgos') return GRAVEDAD[peor(hs)];
    return c.reciente ? ESTADO.reciente : (ESTADO[c.estado] || '#D9DDE3');
  }

  function leyenda(modo, cubs) {
    var pares = modo === 'cubicador' ? Object.keys(cubs).map(function (n) { return [cubs[n], nom(n)]; })
      : modo === 'hallazgos' ? [[GRAVEDAD.alta, 'Alta'], [GRAVEDAD.media, 'Media'], [GRAVEDAD.aviso, 'Aviso'], [GRAVEDAD.ninguno, 'Sin hallazgos']]
      : ESTADO_TXT.map(function (e) { return [ESTADO[e[0]], e[1]]; });
    return pares.map(function (p) {
      return '<span class="dpa-ley"><i style="background:' + p[0] + '"></i>' + esc(p[1]) + '</span>';
    }).join('');
  }

  // ── PINTAR ─────────────────────────────────────────────────────────────────────
  function kpi(clase, valor, etiqueta, nota) {
    return '<div class="revkpi' + (clase ? ' ' + clase : '') + '"><b>' + valor + '</b><span>' + esc(etiqueta) + '</span>' +
           (nota ? '<em>' + esc(nota) + '</em>' : '') + '</div>';
  }

  function pintarKpis() {
    var k = DPA.corrida.kpis, e = k.kg_por_estado || {}, hs = DPA.corrida.hallazgos;
    var pend = hs.filter(function (h) { return h.estado === 'pendiente'; }).length;
    // De la foto: los CC borrados de aSa tienen hallazgo pero ya no son de la obra.
    var conH = DPA.corrida.foto.filter(function (c) { return (porCc(hs)[c.cc] || []).length; }).length;
    $('dpaKpis').innerHTML =
      kpi('', num(k.kg_total) + ' kg', 'Kilos de la obra', 'Open ' + num(e.Open) + ' · Processed ' + num(e.Processed) +
          ' · Shipped ' + num(e.Shipped)) +
      kpi(conH ? 'ocupa' : 'listo', conH + ' de ' + DPA.corrida.foto.length, 'CC con hallazgos', '') +
      kpi(pend ? 'urge' : 'listo', pend, 'Hallazgos por revisar', hs.length + ' en total') +
      kpi('', num(k.kg_reprocesos) + ' kg', 'Reprocesos y adicionales', k.pct_reprocesos + ' % de la obra');
  }

  function ficha(c, hs, cubs) {
    var lista = hs[c.cc] || [], apagada = DPA.familia && !lista.some(function (h) { return h.regla === DPA.familia; });
    var col = colorDe(c, DPA.color, lista, cubs);
    return '<button type="button" class="dpa-ficha' + (apagada ? ' apagada' : '') + '" data-cc="' + esc(c.cc) + '"' +
           ' style="border-left-color:' + col + ';background:' + col + '22" title="' + esc(c.descr) + '">' +
           '<b>' + esc(c.cc) + '</b>' + (lista.length ? '<span class="dpa-n dpa-' + peor(lista) + '">⚠ ' + lista.length + '</span>' : '') +
           '<small>' + esc(c.descr) + ' · ' + num(c.kg) + ' kg</small></button>';
  }

  function filaEdificio(p, e, hs, cubs) {
    var celdas = e.ciclos.map(function (z) {
      var de = e.dentro.filter(function (c) { return filaPiso(c) === p && c.ciclo === z; });
      return '<td>' + de.map(function (c) { return ficha(c, hs, cubs); }).join('') + '</td>';
    }).join('');
    var kg = e.dentro.filter(function (c) { return filaPiso(c) === p; }).reduce(function (s, c) { return s + c.kg; }, 0);
    return '<tr><th class="dpa-piso">' + esc(p) + '</th>' + celdas + '<td class="dpa-tot">' + num(kg) + '</td></tr>';
  }

  function pintarEdificio() {
    var foto = DPA.corrida.foto, e = edificio(foto), hs = porCc(DPA.corrida.hallazgos), cubs = colorCubicador(foto);
    var ultimoP = e.pisos.filter(function (p) { return p.charAt(0) === 'P'; }).pop();
    var filas = e.pisos.map(function (p) {
      var f = filaEdificio(p, e, hs, cubs);
      return p === ultimoP ? f + '<tr class="dpa-terreno"><td colspan="' + (e.ciclos.length + 2) + '">terreno</td></tr>' : f;
    }).join('');
    $('dpaMapa').innerHTML = '<table class="dpa-ed"><thead><tr><th></th>' + e.ciclos.map(function (z) {
      return '<th>' + esc(z) + '</th>'; }).join('') + '<th class="dpa-tot">kg</th></tr></thead><tbody>' + filas + '</tbody></table>';
    $('dpaFuera').innerHTML = e.fuera.length ? '<div class="dpa-sub">Fuera de la grilla</div><div class="dpa-fichas">' +
      e.fuera.map(function (c) { return ficha(c, hs, cubs); }).join('') + '</div>' : '';
    $('dpaLeyenda').innerHTML = leyenda(DPA.color, cubs);
    chips('dpaColor', COLORES, DPA.color, function (v) { DPA.color = v; pintarEdificio(); });
  }

  function pintarFamilias() {
    var fs = familias(DPA.corrida.hallazgos);
    $('dpaFamilias').innerHTML = '<button type="button" class="dpa-fam' + (DPA.familia ? '' : ' on') + '" data-fam="">Todas' +
      '<span>' + DPA.corrida.hallazgos.length + '</span></button>' + fs.map(function (f) {
        return '<button type="button" class="dpa-fam' + (DPA.familia === f.regla ? ' on' : '') + '" data-fam="' + f.regla + '">' +
               esc(f.nombre) + '<span>' + f.n + (f.pendientes < f.n ? ' · ' + (f.n - f.pendientes) + ' revisados' : '') + '</span></button>';
      }).join('');
    pintarSueltos();
  }

  // Los hallazgos de la familia elegida que no tienen ficha: de la obra entera (peso, reclamos)
  // o de CC que ya no están en aSa.
  function pintarSueltos() {
    var enFoto = {};
    DPA.corrida.foto.forEach(function (c) { enFoto[c.cc] = 1; });
    var lista = DPA.corrida.hallazgos.filter(function (h) {
      return (!h.cc || !enFoto[h.cc]) && (!DPA.familia || h.regla === DPA.familia);
    });
    $('dpaSueltos').innerHTML = lista.length ? '<div class="dpa-sub">De la obra</div>' + lista.map(function (h) {
      return '<div class="dpa-suelto"><span class="dpa-g dpa-' + h.gravedad + '">' + esc(h.gravedad) + '</span> ' +
             (h.cc ? '<b>' + esc(h.cc) + '</b> · ' : '') + esc(h.titulo) + '</div>';
    }).join('') : '';
  }

  function pintarCorridas() {
    var ops = DPA.corridas.slice(0, 6).map(function (c) { return [String(c.id), fecha(c.creado_el) + ' · ' + c.hallazgos]; });
    chips('dpaCorridas', ops, DPA.corrida ? String(DPA.corrida.id) : '', function (v) { cargarCorrida(v); });
  }

  function pintarTodo() {
    var hay = !!DPA.corrida;
    $('dpaVacio').style.display = hay ? 'none' : '';
    $('dpaCuerpo').style.display = hay ? '' : 'none';
    pintarCorridas();
    if (!hay) { $('dpaKpis').innerHTML = ''; return; }
    pintarKpis();
    pintarEdificio();
    pintarFamilias();
  }

  function chips(id, opciones, actual, alElegir) {
    var caja = $(id);
    caja.innerHTML = opciones.map(function (o) {
      return '<button type="button" data-v="' + esc(o[0]) + '"' + (String(o[0]) === String(actual) ? ' class="on"' : '') + '>' +
             esc(o[1]) + '</button>';
    }).join('');
    caja.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { alElegir(b.dataset.v); });
    });
  }

  function estadoCarga() {
    $('dpaAuditar').disabled = !DPA.job || DPA.corriendo;
    $('dpaAuditar').textContent = DPA.corriendo ? 'Auditando…' : 'Auditar';
    $('dpaCarga').textContent = DPA.corriendo ? 'Leyendo aSa: uno o dos minutos'
      : (DPA.corrida ? 'Corrida ' + DPA.corrida.id + ' · ' + fecha(DPA.corrida.creado_el) + ' · ' + nom(DPA.corrida.creado_nombre || DPA.corrida.creado_por) : '');
    $('dpaVacio').textContent = !DPA.job ? 'Elige una obra.'
      : DPA.corriendo ? 'Auditando la obra…' : 'Esta obra no tiene auditorías. «Auditar» corre la primera.';
  }

  // ── LA VENTANA DEL CC ──────────────────────────────────────────────────────────
  var NOMBRE_REGLA = {};
  FAMILIAS.forEach(function (f) { NOMBRE_REGLA[f[0]] = f[1]; });

  function filaHallazgo(h) {
    var quien = h.estado === 'pendiente' ? '' : ' · ' + esc(h.revisado_nombre || h.revisado_por || '') + ' ' + fecha(h.revisado_el);
    var bts = h.estado === 'pendiente'
      ? '<button type="button" class="dpa-bt" data-val="confirmado" data-h="' + h.id + '">Confirmar</button>' +
        '<button type="button" class="dpa-bt" data-val="descartado" data-h="' + h.id + '">Descartar</button>'
      : '<button type="button" class="dpa-bt" data-val="pendiente" data-h="' + h.id + '">Reabrir</button>';
    return '<div class="dpa-hall"><span class="dpa-g dpa-' + h.gravedad + '">' + esc(h.gravedad) + '</span>' +
           '<div class="dpa-hall__txt"><b>' + esc(NOMBRE_REGLA[h.regla] || h.regla) + '</b> ' + esc(h.titulo) +
           (h.kg ? ' · ' + num(h.kg) + ' kg' : '') +
           '<div class="dpa-quien">' + (h.estado === 'pendiente' ? 'Por revisar' : esc(h.estado)) + quien + '</div></div>' +
           '<div class="dpa-acc">' + bts + '</div></div>';
  }

  function dibujo(b) {
    if (!global.audCeldaFigura || !global.audBarraNormalizada) return '';
    return global.audCeldaFigura(global.audBarraNormalizada({ figura: b.figura, diam: b.diam, dims: b.dims || {}, eje: b.eje,
                                                              angulos: b.angulos || [], largo: b.largo }, 'asa'), true);
  }

  var MARCA = { ok: '', mayusculas: 'Mal escrita', fuera: 'Fuera del modelo', vacia: 'Sin marca' };

  // La barra para la hoja estándar: lados en cm, sin columnas de ángulos (el dibujo ya dice la forma).
  function barraHoja(b) {
    var cm = {};
    Object.keys(b.dims || {}).forEach(function (L) { cm[L] = Number(b.dims[L]) / 10; });
    return { marca: b.marca || '', notas: b.notas || '', diam: parseFloat(b.diam) || null, figura: b.figura || 'Recta',
             render: dibujo(b), lados: cm, angulos: [], largo: (Number(b.largo) || 0) / 10, cant: b.cant, peso: b.kg };
  }

  function filaBarra(b, desorden) {
    var obs = [MARCA[b.marca_estado], desorden[b.eje_id] ? 'Elemento fuera de orden: ' + desorden[b.eje_id] : '']
      .filter(Boolean).join(' · ');
    return { attrs: obs ? ' class="dpa-obs"' : '', elemento: b.eje_id || '', barra: barraHoja(b),
             propias: [esc(obs)], texto: esc(b.ubicacion || '') };
  }

  function pintarBarras(lista, hs) {
    var desorden = {};
    hs.filter(function (h) { return h.regla === 'N2'; }).forEach(function (h) {
      (h.detalle.desorden || []).forEach(function (d) { desorden[d[0]] = d[1]; });
    });
    if (!lista.length) return '<div class="dpa-vacio">Sin barras en aSa.</div>';
    return global.HojaBarras.tabla({ accion: null, propias: [{ titulo: 'Observación', ancho: 200 }],
                                     texto: { titulo: 'Dónde va' }, filas: lista.map(function (b) { return filaBarra(b, desorden); }) });
  }

  function pintarModal() {
    var m = DPA.modal, c = m.c, hs = porCc(DPA.corrida.hallazgos)[c.cc] || [];
    $('dpaModalTit').innerHTML = '<b>' + esc(c.cc) + '</b> · ' + esc(c.descr);
    $('dpaModalSub').textContent = [c.estado + (c.reciente ? ' (últimas 3 semanas)' : ''), nom(c.cubicador), num(c.kg) + ' kg',
                                    'creado ' + dia(c.fecha), c.envio ? 'envío ' + dia(c.envio) : ''].filter(Boolean).join(' · ');
    chips('dpaModalTabs', [['hall', 'Hallazgos (' + hs.length + ')'], ['barras', 'Barras']], m.tab, function (v) {
      m.tab = v; pintarModal(); if (v === 'barras' && !m.barras) cargarBarras(); });
    if (m.tab === 'hall') {
      $('dpaModalCuerpo').innerHTML = hs.length ? hs.map(filaHallazgo).join('') : '<div class="dpa-vacio">Sin hallazgos.</div>';
    } else {
      $('dpaModalCuerpo').innerHTML = m.barras ? '<div class="dpa-hoja">' + pintarBarras(m.barras, hs) + '</div>'
        : '<div class="dpa-vacio">Leyendo ' + esc(c.cc) + ' en aSa…</div>';
    }
  }

  function abrirCc(cc) {
    var c = DPA.corrida.foto.filter(function (x) { return x.cc === cc; })[0];
    if (!c) return;
    DPA.modal = { c: c, tab: 'hall', barras: null };
    $('dpaModal').style.display = '';
    pintarModal();
  }

  async function cargarBarras() {
    var cc = DPA.modal.c.cc, d = await global.apiGet('/deep-audit/cc/' + encodeURIComponent(cc) + '/barras');
    if (!DPA.modal || DPA.modal.c.cc !== cc) return;
    DPA.modal.barras = (d && d.barras) || [];
    pintarModal();
  }

  async function validar(id, estado) {
    var r = await global.apiPostJson('/deep-audit/hallazgos/' + id, { estado: estado });
    if (!r || r.detail) { aviso((r && r.detail) || 'No se pudo guardar.'); return; }
    ok(estado === 'pendiente' ? 'Hallazgo reabierto' : 'Hallazgo ' + estado);
    await cargarCorrida(DPA.corrida.id);
    if (DPA.modal) pintarModal();
  }

  // ── DATOS ──────────────────────────────────────────────────────────────────────
  async function cargarObras() {
    if (!DPA.obras) {
      var d = await global.apiGet('/deep-audit/obras');
      DPA.obras = (d && d.obras) || [];
    }
    if (!DPA.cb && global.Combobox) {
      DPA.cb = global.Combobox.crear($('dpaObra'), {
        placeholder: 'Buscar obra',
        items: function () { return DPA.obras.map(function (o) { return { id: o.id, label: o.nombre, sub: o.cliente }; }); },
        onSelect: function (it) { if (it) elegirObra(it); }
      });
    }
  }

  function elegirObra(it) {
    DPA.job = it.id;
    DPA.obra = it.label;
    DPA.corrida = null;
    DPA.familia = '';
    cargarCorridas();
  }

  async function cargarCorridas() {
    var d = await global.apiGet('/deep-audit/corridas?job=' + encodeURIComponent(DPA.job));
    DPA.corridas = (d && d.corridas) || [];
    DPA.corriendo = !!(d && d.corriendo);
    if (DPA.corridas.length && (!DPA.corrida || DPA.corridas[0].id !== DPA.corrida.id)) await cargarCorrida(DPA.corridas[0].id);
    else pintarTodo();
    estadoCarga();
    if (DPA.corriendo) sondear();
  }

  async function cargarCorrida(id) {
    var d = await global.apiGet('/deep-audit/corridas/' + id);
    if (!d) { aviso('No se pudo cargar la corrida.'); return; }
    DPA.corrida = d;
    pintarTodo();
    estadoCarga();
  }

  // Mientras audita, la lista de corridas se vuelve a pedir hasta que aparece la nueva.
  function sondear() {
    if (DPA.sondeo) return;
    DPA.sondeo = setTimeout(function () { DPA.sondeo = null; cargarCorridas(); }, 10000);
  }

  async function auditar() {
    var r = await global.apiPostJson('/deep-audit/auditar', { job: DPA.job });
    if (!r || r.detail) { aviso((r && r.detail) || 'No se pudo lanzar la auditoría.'); return; }
    if (!r.lanzada) { aviso(r.motivo || 'Ya hay una auditoría corriendo.'); return; }
    DPA.corriendo = true;
    estadoCarga();
    sondear();
  }

  // ── EVENTOS ────────────────────────────────────────────────────────────────────
  function clic(e) {
    var f = e.target.closest('[data-cc],[data-fam],[data-h]');
    if (!f) return;
    if (f.dataset.h) { validar(f.dataset.h, f.dataset.val); return; }
    if (f.dataset.fam != null && !f.dataset.cc) { DPA.familia = f.dataset.fam; pintarEdificio(); pintarFamilias(); return; }
    abrirCc(f.dataset.cc);
  }

  function cerrarModal() { $('dpaModal').style.display = 'none'; DPA.modal = null; }

  function enganchar() {
    $('audSubDeep').addEventListener('click', clic);
    $('dpaAuditar').addEventListener('click', auditar);
    $('dpaCerrar').addEventListener('click', cerrarModal);
    var m = $('dpaModal'), desde = null;
    m.addEventListener('mousedown', function (e) { desde = e.target; });
    m.addEventListener('click', function (e) { if (e.target === m && desde === m) cerrarModal(); });
  }

  global.loadDeepAudit = async function () {
    if (!$('audSubDeep')) return;
    if (!_listo) { _listo = true; enganchar(); }
    estadoCarga();
    await cargarObras();
    if (DPA.job) cargarCorridas();
  };

  global.__deepAuditTest = { DPA: DPA, filaPiso: filaPiso, enGrilla: enGrilla, cmpPiso: cmpPiso, cmpCiclo: cmpCiclo,
                             edificio: edificio, porCc: porCc, peor: peor, familias: familias, colorDe: colorDe,
                             colorCubicador: colorCubicador, ficha: ficha, filaHallazgo: filaHallazgo, filaBarra: filaBarra,
                             ESTADO: ESTADO, GRAVEDAD: GRAVEDAD, cargarCorridas: cargarCorridas, abrirCc: abrirCc };
})(window);
