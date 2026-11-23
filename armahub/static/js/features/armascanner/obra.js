/* armascanner/obra.js — la ventana de la obra (Mis obras): su cabecera con los KPIs, la tabla Por piso,
 * las secciones y la recarga de sus planos y de aSa. Las secciones Planos y aSa están en planos.js y asa.js.
 */
(function (global) {
  'use strict';
  var A = global.Asc;
  var est = A.est, esc = A.esc, entero = A.entero, poner = A.poner, dec = A.dec, enc = A.enc, kpiM2 = A.kpiM2;

  // ── La ventana de la obra ──
  function obraActual() {
    return est.obras.filter(function (o) { return o.id === est.obra; })[0] || null;
  }

  function pintarCabeza() {
    var o = obraActual() || { nombre: est.obra, kpis: {} };
    poner('ascObraTitulo', o.nombre || est.obra);
    document.getElementById('ascObraLimpiar').style.display = est.admin ? '' : 'none';
    document.getElementById('ascObraEliminar').style.display = est.admin ? '' : 'none';
    poner('ascObraDatos', datosObra(o));
    pintarKpisObra(o.kpis || {});
    pintarPisos(o.por_piso);
  }

  function datosObra(o) {
    return [o.cliente ? 'Cliente ' + o.cliente : '', o.constructora ? 'Constructora ' + o.constructora : '',
            o.asa ? 'aSa ' + o.asa : 'Sin código aSa'].filter(Boolean).join(' · ');
  }

  function pintarKpisObra(k) {
    poner('ascObKg', k.kg ? entero(k.kg) + ' kg' : '—');
    poner('ascObM2', kpiM2(k));
    poner('ascObKgM2', dec(k.kg_m2, 1));
    poner('ascObPpi', k.ppi != null ? dec(k.ppi, 1) + ' kg' : '—');
    poner('ascObDiam', k.diam_prom != null ? dec(k.diam_prom, 1) + ' mm' : '—');
    // las fundaciones, aparte (no entran al kg/m²): su KPI sólo si la obra tiene
    document.getElementById('ascObFundKpi').style.display = k.kg_fund ? '' : 'none';
    document.getElementById('ascObKpis').classList.toggle('con-fund', !!k.kg_fund);
    poner('ascObFund', k.kg_fund ? entero(k.kg_fund) + ' kg' : '—');
  }

  // ── Por piso: el kg de cada piso según el piso de la etiqueta de cada barra, de todos los planos de la
  // obra; las fundaciones, aparte y sin m² (armascanner.tabla_por_piso) ──
  function kgCelda(n) { return n ? entero(n) : '—'; }

  function pintarPisos(t) {
    t = t || {};
    var filas = (t.pisos || []).map(function (x) {
      return '<tr><td>' + (x.piso ? esc(x.piso) : 'Sin piso') + '</td>' +
        '<td class="num">' + kgCelda(x.kg_losa) + '</td><td class="num">' + kgCelda(x.kg_viga) + '</td>' +
        '<td class="num">' + kgCelda(x.kg_elev) + '</td>' +
        '<td class="num">' + kgCelda(x.kg) + '</td><td class="num">' + dec(x.m2, 1) + '</td>' +
        '<td class="num">' + dec(x.kg_m2, 1) + '</td></tr>';
    });
    if (t.fund) {
      filas.push('<tr class="asc-pisos__fund"><td>Fundaciones</td><td></td><td></td><td></td><td class="num">' + entero(t.fund) +
                 '</td><td></td><td></td></tr>');
    }
    document.getElementById('ascPisos').innerHTML = filas.join('');
    document.getElementById('ascPisosTabla').style.display = filas.length ? '' : 'none';
    var vacio = document.getElementById('ascPisosVacio');
    vacio.style.display = filas.length ? 'none' : '';
    vacio.textContent = 'Sin planos terminados.';
  }

  function elegirSeccion(sec) {
    est.sec = sec;
    document.querySelectorAll('#ascObraTabs .arm-tab').forEach(function (b) {
      var on = b.getAttribute('data-sec') === sec;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#ascObraModal .asc-sec').forEach(function (s) {
      s.style.display = s.getAttribute('data-sec') === sec ? '' : 'none';
    });
  }

  async function abrirObra(id) {
    est.obra = id;
    est.planos = []; est.asa = null;
    est.plElemento = ''; est.plBuscar = '';
    document.getElementById('ascPlBuscar').value = '';
    document.querySelectorAll('#ascPlElemento .arm-button').forEach(function (x) { x.classList.toggle('is-on', !x.getAttribute('data-el')); });
    elegirSeccion('planos');
    pintarCabeza();
    est.cargandoObra = true;
    A.pintarPlanos(); A.pintarAsa();
    global.showModal('ascObraModal');
    document.getElementById('ascObraCerrar').focus();
    await recargarObra(false);
  }

  function cerrarObra() {
    est.obra = null;
    global.hideModal('ascObraModal');
  }

  // Los planos y lo de aSa de la obra abierta. Tras una acción (pedido, reemplazo, eliminar) se
  // recargan también los KPIs de la lista: `conLista`.
  async function recargarObra(conLista) {
    var id = est.obra;
    if (!id) return;
    var res = await Promise.all([global.apiGet('/armascanner/planos-linea?obra=' + enc(id)),
                                 global.apiGet('/armascanner/obras-linea/asa?obra=' + enc(id)),
                                 conLista ? A.cargarObras() : null]);
    if (est.obra !== id) return;  // se cerró, o se abrió otra obra, mientras se pedía
    est.cargandoObra = false;
    est.planos = (res[0] && res[0].planos) || [];
    est.plSinRespuesta = !res[0];
    est.asa = res[1];
    A.pintarPlanos();
    A.pintarAsa();
  }

  A.obraActual = obraActual;
  A.pintarCabeza = pintarCabeza;
  A.elegirSeccion = elegirSeccion;
  A.abrirObra = abrirObra;
  A.cerrarObra = cerrarObra;
  A.recargarObra = recargarObra;
})(window);
