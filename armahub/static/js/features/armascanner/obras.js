/* armascanner/obras.js — la pestaña Mis obras: la lista de obras con sus KPIs, «Agregar obra» (de la
 * lista de aSa) y Limpiar / Eliminar obra (administrador). La ventana de la obra está en obra.js.
 */
(function (global) {
  'use strict';
  var A = global.Asc;
  var est = A.est, esc = A.esc, entero = A.entero, poner = A.poner, dec = A.dec, sinTildes = A.sinTildes,
      kpiKg = A.kpiKg, kpiM2 = A.kpiM2, postJson = A.postJson;

  // ── Mis obras: la lista ──
  function obrasFiltradas() {
    var q = (document.getElementById('ascObraBuscar').value || '').trim().toLowerCase();
    return est.obras.filter(function (o) {
      return !q || (o.nombre + ' ' + o.cliente + ' ' + o.constructora + ' ' + o.asa).toLowerCase().indexOf(q) !== -1;
    });
  }

  function pendientesObra(o) {
    return (o.reemplazos ? '<span class="arm-tag arm-tag--warning">' + entero(o.reemplazos) +
        (o.reemplazos === 1 ? ' reemplazo pedido' : ' reemplazos pedidos') + '</span>' : '') +
      (o.consultas ? '<span class="arm-tag arm-tag--warning">' + entero(o.consultas) + ' con consulta</span>' : '') +
      (o.sin_enviar ? '<span class="arm-tag">' + entero(o.sin_enviar) +
        (o.sin_enviar === 1 ? ' pedido sin enviar' : ' pedidos sin enviar') + '</span>' : '');
  }

  function pintarObras() {
    var filas = obrasFiltradas();
    var t = { terminados: 0, kg: 0, m2: 0 };
    document.getElementById('ascObras').innerHTML = filas.map(function (o) {
      var k = o.kpis || {};
      t.terminados += o.terminados; t.kg += Number(k.kg) || 0; t.m2 += Number(k.m2) || 0;
      var sub = [o.cliente, o.asa ? 'aSa ' + o.asa : ''].filter(Boolean).join(' · ');
      return '<tr data-obra="' + esc(o.id) + '">' +
        '<td class="asc-obra__nom">' + esc(o.nombre) + (sub ? '<div class="asc-linea">' + esc(sub) + '</div>' : '') + '</td>' +
        '<td class="num">' + entero(o.terminados) + ' de ' + entero(o.planos) + '</td>' +
        '<td class="num">' + kpiKg(k) + '</td>' +
        '<td class="num">' + kpiM2(k) + '</td>' +
        '<td class="num">' + dec(k.kg_m2, 1) + '</td>' +
        '<td class="num">' + dec(k.ppi, 1) + '</td>' +
        '<td class="num">' + dec(k.diam_prom, 1) + '</td>' +
        '<td><div class="asc-tags">' + pendientesObra(o) + '</div></td>' +
        '<td class="asc-acciones"><div><button type="button" class="arm-button">Abrir</button></div></td>' +
        '</tr>';
    }).join('');
    var vacio = document.getElementById('ascObrasVacio');
    vacio.style.display = filas.length ? 'none' : '';
    // Si ArmaHub no contestó, se dice: la lista vacía haría creer que no hay nada subido.
    vacio.textContent = est.sinRespuesta ? 'No se pudieron leer las obras. Recarga la página.'
      : est.obras.length ? 'Sin obras con ese nombre.' : 'Sin obras agregadas.';
    poner('ascKpiObras', entero(filas.length));
    poner('ascKpiTerminados', entero(t.terminados));
    poner('ascKpiKg', entero(t.kg) + ' kg');
    poner('ascKpiM2', t.m2 ? dec(t.m2, 1) : '—');
  }

  function prepararPantalla() {
    if (est.listo) return;
    est.listo = true;
    document.getElementById('ascObraBuscar').addEventListener('input', pintarObras);
    document.getElementById('ascObras').addEventListener('click', function (ev) {
      var tr = ev.target.closest('tr[data-obra]');
      if (tr) A.abrirObra(tr.getAttribute('data-obra'));
    });
    document.getElementById('ascObraCerrar').addEventListener('click', A.cerrarObra);
    document.getElementById('ascObraLimpiar').addEventListener('click', function () { quitarObra(false); });
    document.getElementById('ascObraEliminar').addEventListener('click', function () { quitarObra(true); });
    document.getElementById('ascAgregarObra').addEventListener('click', abrirAgregar);
    document.getElementById('ascAgregarCerrar').addEventListener('click', cerrarAgregar);
    document.getElementById('ascAgregarModal').addEventListener('click', function (ev) {
      if (ev.target === this) cerrarAgregar();
    });
    document.getElementById('ascAgregarBuscar').addEventListener('input', pintarAgregar);
    document.getElementById('ascAgregarLista').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-asa]');
      if (b) agregarObra(b.getAttribute('data-asa'), b);
    });
    document.getElementById('ascObraModal').addEventListener('click', function (ev) {
      if (ev.target === this) A.cerrarObra();
    });
    document.getElementById('ascObraTabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('.arm-tab');
      if (b) A.elegirSeccion(b.getAttribute('data-sec'));
    });
    document.getElementById('ascPlBuscar').addEventListener('input', function () { est.plBuscar = this.value; A.pintarPlanos(); });
    document.getElementById('ascBarrasCerrar').addEventListener('click', A.cerrarBarras);
    document.getElementById('ascBarrasModal').addEventListener('click', function (ev) {
      if (ev.target === this) A.cerrarBarras();
    });
    // Esc cierra lo de más arriba: las barras y, si no, la obra (el PDF lo cierra visor.js, que va encima)
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !global.isModalOpen || global.isModalOpen('ascVisorModal')) return;
      if (global.isModalOpen('ascBarrasModal')) A.cerrarBarras();
      else if (global.isModalOpen('ascAgregarModal')) cerrarAgregar();
      else if (global.isModalOpen('ascObraModal')) A.cerrarObra();
    });
  }

  async function cargarObras() {
    prepararPantalla();
    var d = await global.apiGet('/armascanner/obras-linea');
    est.obras = (d && d.obras) || [];
    est.admin = !!(d && d.admin);
    est.sinRespuesta = !d;
    pintarObras();
    if (est.obra) A.pintarCabeza();
  }

  // ── Agregar obra: la obra se agrega aquí primero, de la lista de aSa Studio, y recién ahí ArmaScanner
  // la muestra (cualquier cubicador; la ven todos). [Usuario 23-nov: «en el menú mis obras debiéramos
  // tener un botón de Agregar Obra, ahí buscar de las de aSa Studio»] ──
  var MAX_AGREGAR = 60;  // la lista de aSa es larga: se ven las primeras y se afina con el filtro

  async function abrirAgregar() {
    document.getElementById('ascAgregarBuscar').value = '';
    global.showModal('ascAgregarModal');
    document.getElementById('ascAgregarBuscar').focus();
    if (!est.asaObras) {
      document.getElementById('ascAgregarLista').innerHTML = '';
      poner('ascAgregarVacio', 'Cargando obras de aSa…');
      document.getElementById('ascAgregarVacio').style.display = '';
      var d = await global.apiGet('/armascanner/obras-asa');
      est.asaObras = (d && d.obras) || null;
    }
    pintarAgregar();
  }

  function cerrarAgregar() { global.hideModal('ascAgregarModal'); }

  function pintarAgregar() {
    var vacio = document.getElementById('ascAgregarVacio');
    var palabras = sinTildes(document.getElementById('ascAgregarBuscar').value).split(/\s+/).filter(Boolean);
    var filas = (est.asaObras || []).filter(function (o) {
      var t = sinTildes(o.nombre + ' ' + o.cliente + ' ' + o.asa);
      return palabras.every(function (w) { return t.indexOf(w) !== -1; });
    });
    document.getElementById('ascAgregarLista').innerHTML = filas.slice(0, MAX_AGREGAR).map(function (o) {
      return '<tr><td>' + esc(o.nombre) + '</td><td>' + esc(o.cliente) + '</td><td>' + esc(o.asa) + '</td>' +
        '<td class="asc-acciones"><div>' + (o.agregada ? '<span class="arm-tag">Agregada</span>'
          : '<button type="button" class="arm-button arm-button--primary" data-asa="' + esc(o.asa) + '">Agregar</button>') +
        '</div></td></tr>';
    }).join('');
    vacio.style.display = filas.length > MAX_AGREGAR || !filas.length ? '' : 'none';
    vacio.textContent = !est.asaObras ? 'No se pudieron leer las obras de aSa. Cierra y vuelve a abrir.'
      : !filas.length ? 'Sin obras con ese nombre.'
      : entero(filas.length - MAX_AGREGAR) + ' obras más: afina la búsqueda.';
  }

  async function agregarObra(asa, boton) {
    boton.disabled = true;
    var data = await postJson('/armascanner/obras-linea/agregar', { asa: asa });
    if (!data) { boton.disabled = false; return; }
    est.asaObras.forEach(function (o) { if (o.asa === asa) o.agregada = true; });
    pintarAgregar();
    global.showToast(data.ya_estaba ? 'La obra ya estaba agregada.' : 'Obra agregada: ya aparece en ArmaScanner.', 'success');
    await cargarObras();
  }

  // Limpiar (sus planos, con sus archivos y las barras que mandaron a los despieces) o eliminar la obra
  // (además sale de Mis obras y de ArmaScanner): administrador, escribiendo la palabra. [Usuario 23-nov:
  // «lo importante es que yo pueda eliminarlas y/o limpiarlas con algún warning»]
  async function quitarObra(eliminar) {
    var o = A.obraActual();
    if (!o) return;
    var palabra = eliminar ? 'ELIMINAR' : 'LIMPIAR';
    var txt = prompt(textoQuitar(o, eliminar, palabra));
    if (txt == null) return;
    if (txt.trim().toUpperCase() !== palabra) {
      global.showToast('No se hizo nada: hay que escribir ' + palabra + '.', 'error');
      return;
    }
    var data = await postJson('/armascanner/obras-linea/quitar', { obra: o.id, eliminar: eliminar });
    if (!data) return;
    global.showToast(avisoQuitada(eliminar, data), 'success');
    if (eliminar) {
      est.asaObras = null;  // vuelve a «Agregar»
      A.cerrarObra();
      await cargarObras();
    } else {
      await A.recargarObra(true);
    }
  }

  function textoQuitar(o, eliminar, palabra) {
    return '⚠ ' + (eliminar ? 'Eliminar' : 'Limpiar') + ' «' + o.nombre + '»\n\n' +
      'Se borran de ArmaHub sus ' + entero(o.planos) + ' planos, con sus archivos y las barras que mandaron a los despieces. ' +
      (eliminar ? 'La obra sale de Mis obras y de ArmaScanner. ' : 'La obra sigue en Mis obras. ') +
      'No se puede deshacer; en aSa no se toca nada.\n\nEscribe ' + palabra + ' para confirmar:';
  }

  function avisoQuitada(eliminar, data) {
    return (eliminar ? 'Obra eliminada' : 'Obra limpia') + ' · ' + entero(data.planos) + ' planos' +
      (data.barras_eliminadas ? ' · ' + entero(data.barras_eliminadas) + ' barras' : '') + '.';
  }

  A.cargarObras = cargarObras;
})(window);
