/* obras/index.js — la caluga Obras (21-nov, SPECS §5; programa §8.13 fila 7.1).
 *
 * Primero las obras, una tarjeta cada una (como ArmaScanner › Planos); elegida una, su panel:
 * encabezado con lo que el sistema ya sabe de ella (nombre, código y cliente de aSa) y sus
 * pestañas. Hoy la obra tiene una: Protocolo (protocolo.js). La pestaña Plantilla de la caluga
 * (plantilla.js) es del administrador.
 *
 *   GET /protocolo/obras    las obras con el estado de su protocolo
 *
 * Lo común a los tres archivos queda en window.ObrasPanel.
 */
(function (global) {
  'use strict';

  var est = { obras: [], filtro: '', obra: '', listo: false, sinRespuesta: false, hayPlantilla: true };

  var ESTADO = {
    borrador: { txt: 'Borrador', tag: 'arm-tag arm-tag--warning' },
    revisado: { txt: 'Revisado con el cliente', tag: 'arm-tag arm-tag--info' },
    cerrado: { txt: 'Cerrado', tag: 'arm-tag arm-tag--success' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function poner(id, txt) { var e = el(id); if (e) e.textContent = txt; }
  function entero(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function esAdmin() { return ['admin', 'admin_calidad'].indexOf(global.currentRole) !== -1; }
  function tagEstado(estado) {
    var e = ESTADO[estado] || { txt: estado, tag: 'arm-tag obr-tag-neutra' };
    return '<span class="' + e.tag + '">' + esc(e.txt) + '</span>';
  }

  // POST a la API. Devuelve los datos, o null tras avisar el motivo que da el servidor.
  async function enviar(ruta, cuerpo, esArchivo) {
    var res, cabeceras = global.authHeaders();
    if (!esArchivo) cabeceras['Content-Type'] = 'application/json';
    try {
      res = await fetch(global.apiUrl(ruta), { method: 'POST', headers: cabeceras,
                                               body: esArchivo ? cuerpo : JSON.stringify(cuerpo || {}) });
    } catch (e) {
      global.showToast('Sin conexión. Vuelve a intentar.', 'error');
      return null;
    }
    if (res.status === 401) { global.logout(); return null; }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      global.showToast(typeof data.detail === 'string' ? data.detail : 'Error ' + res.status, 'error');
      return null;
    }
    return data;
  }

  // ── Lista de obras ──
  function teja(o) {
    var p = o.protocolo, pct = p && p.total ? Math.round(100 * p.respondidos / p.total) : 0;
    return '<button type="button" class="obr-teja" data-obra="' + esc(o.id) + '">' +
      '<div class="obr-teja__tit">' + esc(o.nombre) + '</div>' +
      '<div class="obr-teja__fila"><span>' + esc(o.codigo) + '</span><span>' + esc(o.cliente) + '</span></div>' +
      (p ? '<div class="obr-teja__tags">' + tagEstado(p.estado) + '<span class="obr-linea">v' + esc(p.version) + '</span></div>' +
           '<div class="obr-teja__fila"><span>' + entero(p.respondidos) + ' / ' + entero(p.total) + ' criterios</span><span>' +
           pct + ' %</span></div><div class="obr-avance"><div style="width:' + pct + '%;"></div></div>'
         : '<div class="obr-teja__tags"><span class="arm-tag obr-tag-neutra">Sin protocolo</span></div>') +
      '</button>';
  }

  function pintarLista() {
    var q = (el('obrBuscar').value || '').trim().toLowerCase();
    var cuenta = { borrador: 0, revisado: 0, cerrado: 0 };
    est.obras.forEach(function (o) { if (o.protocolo) cuenta[o.protocolo.estado] = (cuenta[o.protocolo.estado] || 0) + 1; });
    var filas = est.obras.filter(function (o) {
      return (!est.filtro || (est.filtro === 'con') === !!o.protocolo) &&
        (!q || (o.nombre + ' ' + o.codigo + ' ' + o.cliente).toLowerCase().indexOf(q) !== -1);
    });
    el('obrTejas').innerHTML = filas.map(teja).join('');
    var vacio = el('obrListaVacia');
    vacio.style.display = filas.length ? 'none' : '';
    vacio.textContent = est.sinRespuesta ? 'No se pudieron leer las obras. Recarga la página.'
      : est.obras.length ? 'Sin obras con este filtro.' : 'Sin obras.';
    poner('obrKpiObras', entero(est.obras.length));
    poner('obrKpiBorrador', entero(cuenta.borrador));
    poner('obrKpiRevisado', entero(cuenta.revisado));
    poner('obrKpiCerrado', entero(cuenta.cerrado));
  }

  function mostrar(obra) {
    el('obrLista').style.display = obra ? 'none' : '';
    el('obrObra').style.display = obra ? '' : 'none';
    // La obra elegida va en la dirección: F5 vuelve a ella.
    if (global.__armahubUpdateNavHash) global.__armahubUpdateNavHash('obras', 'ob_obras', obra ? encodeURIComponent(obra) : null);
  }

  // El encabezado de la obra: lo que el sistema ya sabe (aSa) se muestra y no se pide.
  function cabeza(o) {
    poner('obrNombre', o ? o.nombre : '');
    poner('obrDatos', o ? [o.codigo, o.cliente].filter(Boolean).join(' · ') : '');
  }

  async function abrir(id) {
    est.obra = id;
    cabeza(est.obras.filter(function (o) { return o.id === id; })[0]);
    el('obrProtocolo').innerHTML = '';
    mostrar(id);
    await P.protocolo.cargar(id);
  }

  async function volver() {
    if (!P.protocolo.salir()) return;
    est.obra = '';
    mostrar('');
    await cargar();
  }

  function unaVez() {
    if (est.listo) return;
    est.listo = true;
    el('obrBuscar').addEventListener('input', pintarLista);
    el('obrTejas').addEventListener('click', function (ev) {
      var t = ev.target.closest('.obr-teja');
      if (t) abrir(t.getAttribute('data-obra'));
    });
    el('obrFiltro').addEventListener('click', function (ev) {
      var b = ev.target.closest('.arm-button');
      if (!b) return;
      est.filtro = b.getAttribute('data-f') || '';
      el('obrFiltro').querySelectorAll('.arm-button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      pintarLista();
    });
    el('obrVolver').addEventListener('click', volver);
  }

  async function cargar() {
    unaVez();
    var d = await global.apiGet('/protocolo/obras');
    est.obras = (d && d.obras) || [];
    est.sinRespuesta = !d;
    est.hayPlantilla = !d || d.hay_plantilla;
    pintarLista();
    // Tras F5 la dirección trae la obra (`sub`): se abre de nuevo. Se consume una vez.
    var pendiente = global.__armahubRecSubTabPendiente;
    if (pendiente && global.currentModule === 'obras') {
      global.__armahubRecSubTabPendiente = null;
      pendiente = decodeURIComponent(pendiente);
      if (est.obras.some(function (o) { return o.id === pendiente; })) { await abrir(pendiente); return; }
    }
    if (est.obra) {   // se vuelve a la pestaña con una obra abierta: sigue abierta, y al día si no hay nada sin guardar
      mostrar(est.obra);
      if (!P.protocolo.hayCambios()) await P.protocolo.cargar(est.obra);
    }
  }

  var P = global.ObrasPanel = {
    esc: esc, el: el, poner: poner, entero: entero, esAdmin: esAdmin, enviar: enviar, tagEstado: tagEstado,
    ESTADO: ESTADO, cabeza: cabeza, protocolo: null, plantilla: null
  };

  global.loadObrasModule = function () {};  // cada pestaña carga lo suyo (shell.js, tabLoaders)
  global.obrCargarObras = cargar;
})(window);
