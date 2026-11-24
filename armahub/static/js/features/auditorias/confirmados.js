// CC CONFIRMADOS MODIFICADOS (24-nov) — la cuarta línea del tab de Auditorías.
//
// Los códigos que la planta confirmó y que alguien editó después en aSa: los kilos
// agendados dejan de ser los del pedido. El servidor los detecta solo en cada turno del
// reloj de aSa (cc_confirmados.py); acá se miran, se filtran y se dan por resueltos con un
// clic que deja quién y cuándo.
//
// QUIÉN EDITÓ NO SE SABE: aSa no lo entrega. La columna dice «Cubicador a cargo», que es
// quien normalmente edita el código, para no afirmar lo que aSa no dice.
(function (global) {
  'use strict';

  var PERIODOS = [['hoy', 'Hoy', 1], ['7', '7 días', 7], ['30', '30 días', 30], ['todo', 'Todo', 0]];
  var ESTADOS = [['pend', 'Por resolver'], ['res', 'Resueltos'], ['todos', 'Todos']];
  // El estado del pedido en aSa, con los colores de estado del manual.
  var EST = { Open: 'info', Processed: 'warn', Shipped: 'danger' };
  var CAMBIO = { Agregada: 'info', Cambiada: 'warn', Quitada: 'danger' };
  var DIA = 86400000;
  var CCM = { filas: [], periodo: '30', estado: 'pend', cub: '', buscar: '', abiertos: {},
              puedeRevisar: false, corriendo: false, ultima: null };
  var _listo = false, _sondeo = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function nom(login) { return global.nomCub ? global.nomCub(login) : (login || ''); }
  // «24-11 15:18», como el resto de Auditorías.
  function dos(n) { return ('0' + n).slice(-2); }
  function fecha(iso) {
    var d = new Date(iso || '');
    if (isNaN(d)) return '';
    return dos(d.getDate()) + '-' + dos(d.getMonth() + 1) + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); }
  function ok(m) { if (global.showToast) global.showToast(m, 'success'); }

  // ── LO QUE SE MUESTRA ──────────────────────────────────────────────────────────
  // La diferencia de kilos contra la foto; null si no hubo foto antes del cambio.
  function dif(f) {
    if (f.kg_confirmado == null || f.kg_actual == null) return null;
    return f.kg_actual - f.kg_confirmado;
  }

  // Desde cuándo mira el período elegido (0 = todo). «Hoy» es desde la medianoche.
  function desde(periodo, ahora) {
    var p = PERIODOS.filter(function (x) { return x[0] === periodo; })[0] || PERIODOS[2];
    if (!p[2]) return 0;
    if (p[0] === 'hoy') { var d = new Date(ahora); d.setHours(0, 0, 0, 0); return d.getTime(); }
    return ahora - p[2] * DIA;
  }

  function texto(f) { return [f.cc, f.obra, f.descr, nom(f.cubicador)].join(' ').toLowerCase(); }

  function enVista(f, t0) {
    if (t0 && new Date(f.modificado_el).getTime() < t0) return false;
    return !CCM.buscar || texto(f).indexOf(CCM.buscar) >= 0;
  }

  function porEstado(f) {
    if (CCM.estado === 'pend') return !f.resuelto_el;
    if (CCM.estado === 'res') return !!f.resuelto_el;
    return true;
  }

  // Lo que entra en los indicadores y en la tabla: período, búsqueda y cubicador. El
  // estado sólo filtra la tabla: los indicadores cuentan lo pendiente y lo resuelto.
  function filtrar(filas, ahora) {
    var t0 = desde(CCM.periodo, ahora);
    var vista = filas.filter(function (f) { return enVista(f, t0); });
    var deCub = vista.filter(function (f) { return !CCM.cub || f.cubicador === CCM.cub; });
    return { vista: vista, deCub: deCub, tabla: deCub.filter(porEstado) };
  }

  function resumenKpi(lista) {
    var pend = lista.filter(function (f) { return !f.resuelto_el; });
    var kg = 0, sin = 0;
    pend.forEach(function (f) {
      var d = dif(f);
      if (d == null) sin++; else kg += Math.abs(d);
    });
    return { pend: pend.length, kg: kg, sin: sin, res: lista.length - pend.length };
  }

  function kpi(clase, valor, etiqueta, nota) {
    return '<div class="revkpi' + (clase ? ' ' + clase : '') + '"><b>' + valor + '</b><span>' +
           esc(etiqueta) + '</span>' + (nota ? '<em>' + esc(nota) + '</em>' : '') + '</div>';
  }

  function pintarKpis(lista) {
    var r = resumenKpi(lista);
    $('ccmKpis').innerHTML =
      kpi('clave', r.pend, 'Por resolver', '') +
      kpi('', num(r.kg) + ' kg', 'Diferencia de kilos', r.sin ? r.sin + ' sin kilos al confirmar' : '') +
      kpi('', r.res, 'Resueltos', '');
  }

  // ── FILTROS ────────────────────────────────────────────────────────────────────
  function chips(id, opciones, actual, alElegir) {
    var caja = $(id);
    caja.innerHTML = opciones.map(function (o) {
      return '<button data-v="' + esc(o[0]) + '"' + (o[0] === actual ? ' class="on"' : '') + '>' +
             o[1] + '</button>';
    }).join('');
    caja.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { alElegir(b.dataset.v); pintar(); });
    });
  }

  // Un chip por cubicador con lo que tiene por resolver; «Todos» primero.
  function opcionesCub(vista) {
    var n = {};
    vista.forEach(function (f) {
      if (!f.cubicador) return;
      n[f.cubicador] = (n[f.cubicador] || 0) + (f.resuelto_el ? 0 : 1);
    });
    var quienes = Object.keys(n).sort(function (a, b) { return nom(a).localeCompare(nom(b), 'es'); });
    return [['', 'Todos']].concat(quienes.map(function (q) {
      return [q, esc(nom(q)) + (n[q] ? ' <i>' + n[q] + '</i>' : '')];
    }));
  }

  function pintarFiltros(vista) {
    chips('ccmPeriodo', PERIODOS.map(function (p) { return [p[0], esc(p[1])]; }), CCM.periodo,
          function (v) { CCM.periodo = v; });
    chips('ccmEstado', ESTADOS.map(function (p) { return [p[0], esc(p[1])]; }), CCM.estado,
          function (v) { CCM.estado = v; });
    chips('ccmCubs', opcionesCub(vista), CCM.cub, function (v) { CCM.cub = v; });
  }

  // ── LA TABLA ───────────────────────────────────────────────────────────────────
  var COLS = '<thead><tr><th>Modificado</th><th>CC</th><th>Obra</th><th>Descripción</th>' +
    '<th title="aSa no registra quién editó: es el cubicador a cargo del código.">Cubicador a cargo</th>' +
    '<th>Confirmado</th><th class="num">Kg al confirmar</th><th class="num">Kg hoy</th>' +
    '<th class="num">Diferencia</th><th>Barras</th><th>Estado</th><th>Resuelto</th></tr></thead>';
  var NCOLS = 12;

  function celdaKgConf(f) {
    if (f.kg_confirmado == null) {
      return '<td class="num muted" title="Se confirmó y se editó entre dos revisiones: no alcanzó a ' +
             'haber foto de cómo estaba.">—</td>';
    }
    return '<td class="num">' + num(f.kg_confirmado) + '</td>';
  }

  function celdaDif(d) {
    if (d == null) return '<td class="num muted">—</td>';
    if (Math.abs(d) < 0.5) return '<td class="num">0</td>';
    return '<td class="num ccmdif">' + (d > 0 ? '+' : '−') + num(Math.abs(d)) + '</td>';
  }

  function resumenBarras(n) {
    var partes = [];
    if (n.agregadas) partes.push('+' + n.agregadas);
    if (n.quitadas) partes.push('−' + n.quitadas);
    if (n.cambiadas) partes.push(n.cambiadas + ' cambiada' + (n.cambiadas > 1 ? 's' : ''));
    return partes.join(' · ');
  }

  function celdaBarras(f) {
    if (!f.cambios) {
      return '<td class="muted" title="Sin foto previa al cambio: no se puede decir qué barras cambiaron.">Sin foto</td>';
    }
    var r = resumenBarras(f.cambios.n || {});
    if (!r) return '<td class="muted">Sin cambios</td>';
    return '<td><button class="audmini' + (CCM.abiertos[f.id] ? ' ver' : '') + '" data-barras="' + f.id +
           '" title="Ver las barras">' + r + '</button></td>';
  }

  function celdaEstado(f) {
    var e = f.estado_hoy || f.estado || '';
    var h = '<span class="ccmest ' + (EST[e] || 'otro') + '">' + esc(e || '—') + '</span>';
    if (f.reprogramado_el) {
      h += '<span class="ccmest repro" title="La planta volvió a programar el código el ' +
           esc(fecha(f.reprogramado_el)) + ', después del cambio.">Reprogramado</span>';
    }
    return '<td>' + h + '</td>';
  }

  function celdaResuelto(f) {
    var quien = f.resuelto_el
      ? '<small>' + esc(f.resuelto_nombre || f.resuelto_por || '') + ' · ' + esc(fecha(f.resuelto_el)) + '</small>'
      : '';
    return '<td class="ccmres"><label><input type="checkbox" data-res="' + f.id + '"' +
           (f.resuelto_el ? ' checked' : '') + '>Resuelto</label>' + quien + '</td>';
  }

  function fila(f) {
    return '<tr' + (f.resuelto_el ? ' class="ccmhecho"' : '') + '>' +
      '<td>' + esc(fecha(f.modificado_el)) + '</td>' +
      '<td class="cc">' + esc(f.cc) + '</td>' +
      '<td class="audnom" title="' + esc(f.obra) + '">' + esc(f.obra) + '</td>' +
      '<td class="auddcc" title="' + esc(f.descr) + '">' + esc(f.descr) + '</td>' +
      '<td class="audnom">' + esc(nom(f.cubicador)) + '</td>' +
      '<td>' + esc(fecha(f.confirmado_el)) + '</td>' +
      celdaKgConf(f) + '<td class="num">' + num(f.kg_actual) + '</td>' + celdaDif(dif(f)) +
      celdaBarras(f) + celdaEstado(f) + celdaResuelto(f) + '</tr>' +
      (CCM.abiertos[f.id] ? detalle(f) : '');
  }

  // ── EL DETALLE: la hoja de barras estándar (hoja_barras.js) ───────────────────
  // Sin dibujo: la foto guarda lo que se compara, no la geometría de la figura.
  function hojaFila(b, cambio, antes) {
    return { barra: { marca: b.marca || '(sin marca)', diam: parseInt(b.diam, 10) || null,
                      figura: b.figura, render: '', largo: (Number(b.largo) || 0) / 10,
                      cant: b.cant, peso: b.kg },
             elemento: b.elemento,
             propias: ['<span class="ccmest ' + CAMBIO[cambio] + '">' + cambio + '</span>'],
             texto: antes };
  }

  // Lo que la barra cambiada tenía en la foto, sólo lo que cambió.
  function antesDe(a, d) {
    var p = [];
    if (a.cant !== d.cant) p.push('Cant ' + num(a.cant));
    if (a.largo !== d.largo) p.push('Largo ' + global.HojaBarras.cm(a.largo / 10));
    if (a.kg !== d.kg) p.push('Peso ' + num(a.kg));
    if (a.figura !== d.figura) p.push('Figura ' + a.figura);
    if (a.diam !== d.diam) p.push('φ ' + a.diam);
    return esc(p.join(' · '));
  }

  function filasDetalle(c) {
    return [].concat(
      (c.agregadas || []).map(function (b) { return hojaFila(b, 'Agregada', ''); }),
      (c.cambiadas || []).map(function (x) {
        var b = Object.assign({ elemento: x.elemento, marca: x.marca }, x.despues);
        return hojaFila(b, 'Cambiada', antesDe(x.antes, x.despues));
      }),
      (c.quitadas || []).map(function (b) { return hojaFila(b, 'Quitada', ''); }));
  }

  function detalle(f) {
    var c = f.cambios || {}, filas = filasDetalle(c), n = c.n || {};
    var total = (n.agregadas || 0) + (n.quitadas || 0) + (n.cambiadas || 0);
    var nota = total > filas.length
      ? '<div class="muted" style="font-size:10.5px; margin-top:4px;">Se muestran ' + filas.length +
        ' de ' + total + ' barras.</div>' : '';
    return '<tr class="ccmdet"><td colspan="' + NCOLS + '">' +
      global.HojaBarras.tabla({ accion: null, propias: [{ titulo: 'Cambio', ancho: 76 }],
                               texto: { titulo: 'Antes' }, filas: filas }) + nota + '</td></tr>';
  }

  function vacio() {
    return CCM.filas.length ? 'Nada con estos filtros.' : 'Sin códigos editados después de confirmar.';
  }

  function pintar() {
    var r = filtrar(CCM.filas, Date.now());
    pintarFiltros(r.vista);
    pintarKpis(r.deCub);
    $('ccmLista').innerHTML = r.tabla.length
      ? '<table class="audt">' + COLS + '<tbody>' + r.tabla.map(fila).join('') + '</tbody></table>'
      : '<div class="revvacio">' + vacio() + '</div>';
  }

  // ── CABECERA: cuándo se revisó y el botón de administración ───────────────────
  function textoCarga(u, corriendo) {
    if (corriendo) return 'Revisando en aSa…';
    if (!u) return 'Todavía sin revisar';
    if (!u.ok) return 'La última revisión falló' + (u.detalle ? ': ' + u.detalle : '');
    return 'Revisado ' + fecha(u.fin);
  }

  function cabecera() {
    var c = $('ccmCarga');
    c.textContent = textoCarga(CCM.ultima, CCM.corriendo);
    c.classList.toggle('ccmfallo', !CCM.corriendo && !!CCM.ultima && !CCM.ultima.ok);
    var b = $('ccmRevisar');
    b.style.display = CCM.puedeRevisar ? '' : 'none';
    b.disabled = CCM.corriendo;
    b.textContent = CCM.corriendo ? 'Revisando…' : 'Revisar ahora';
  }

  // ── LO QUE VA AL SERVIDOR ──────────────────────────────────────────────────────
  // Mientras corre una revisión, la lista se vuelve a pedir sola hasta que termine.
  function sondear() {
    if (_sondeo) return;
    _sondeo = setTimeout(function () { _sondeo = null; cargar(); }, 8000);
  }

  async function cargar() {
    var d = await global.apiGet('/cc-confirmados?dias=0');
    if (!d) { $('ccmLista').innerHTML = '<div class="revvacio">No se pudo cargar la lista.</div>'; return; }
    CCM.filas = d.filas || [];
    CCM.puedeRevisar = !!d.puede_revisar;
    CCM.corriendo = !!d.corriendo;
    CCM.ultima = d.ultima || null;
    cabecera();
    pintar();
    if (CCM.corriendo) sondear();
  }

  async function revisarAhora() {
    var r = await global.apiPostJson('/cc-confirmados/revisar', {});
    if (!r || r.detail) { aviso((r && r.detail) || 'No se pudo lanzar la revisión.'); return; }
    if (!r.lanzada && r.motivo) ok(r.motivo);
    CCM.corriendo = true;
    cabecera();
    sondear();
  }

  async function marcar(input) {
    var si = input.checked;
    input.disabled = true;
    var r = await global.apiPostJson('/cc-confirmados/' + input.dataset.res + '/resuelto', { resuelto: si });
    if (!r || r.detail) {
      input.checked = !si;
      input.disabled = false;
      aviso((r && r.detail) || 'No se pudo guardar.');
      return;
    }
    ok(si ? 'Marcado como resuelto' : 'Vuelve a por resolver');
    await cargar();
  }

  function enganchar() {
    $('ccmRevisar').addEventListener('click', revisarAhora);
    $('ccmBuscar').addEventListener('input', function () {
      CCM.buscar = this.value.trim().toLowerCase();
      pintar();
    });
    $('ccmLista').addEventListener('click', function (e) {
      var b = e.target.closest('[data-barras]');
      if (!b) return;
      CCM.abiertos[b.dataset.barras] = !CCM.abiertos[b.dataset.barras];
      pintar();
    });
    $('ccmLista').addEventListener('change', function (e) {
      if (e.target.matches('[data-res]')) marcar(e.target);
    });
  }

  global.loadCcConfirmados = async function () {
    if (!$('audSubConfirmados')) return;
    if (!_listo) { _listo = true; enganchar(); }
    await cargar();
  };

  global.__ccmTest = { CCM: CCM, dif: dif, desde: desde, filtrar: filtrar, resumenKpi: resumenKpi,
                       resumenBarras: resumenBarras, filasDetalle: filasDetalle, fila: fila,
                       textoCarga: textoCarga, fecha: fecha };

})(window);
