/* armascanner/asa.js — la sección aSa de la ventana de la obra: por plano, qué parte de sus kilos tiene
 * código en aSa y cuáles son (cruce por sector, piso y ciclo con la descripción del código;
 * armascanner.cruce_asa).
 */
(function (global) {
  'use strict';
  var A = global.Asc;
  var est = A.est, esc = A.esc, entero = A.entero, poner = A.poner;

  var ESTADO_CC = { Open: 'arm-tag arm-tag--info', Processed: 'arm-tag arm-tag--success', Shipped: 'arm-tag' };

  function filaAsa(x) {
    var plano = celdaPlanoAsa(x);
    if (x.pedido === 'sin_enviar') {
      return '<tr>' + plano + '<td><span class="arm-tag">Sin enviar</span></td><td class="num">—</td><td>—</td><td></td><td></td></tr>';
    }
    return '<tr>' + plano +
      '<td>' + (x.pedido === 'enviado' ? '<span class="arm-tag arm-tag--success">Enviado</span>'
                                       : '<span class="arm-tag arm-tag--warning">Cambios sin enviar</span>') + '</td>' +
      celdasCruce(x) + '</tr>';
  }

  function celdaPlanoAsa(x) {
    var p = A.planoDe(est.obra, x.plano) || { plano: x.plano };
    return '<td><div class="asc-pl__num">' + esc(p.numero || p.plano) + '</div>' +
      '<div class="asc-linea asc-pl__tit" title="' + esc(p.titulo || p.plano) + '">' + esc(p.titulo || p.plano) + '</div></td>';
  }

  // Lo que el plano tiene en aSa: sus kilos, qué parte está en aSa, los códigos que calzan y lo que falta.
  function celdasCruce(x) {
    var pct = x.pct == null ? null : Math.max(0, Math.min(100, Number(x.pct)));
    var codigos = (x.codigos || []).map(function (c) {
      return '<div class="asc-cc"><b>' + esc(c.cc) + '</b><span>' + esc(c.descr) + '</span><span class="asc-linea">' +
        entero(c.kg) + ' kg</span>' + (c.estado ? '<span class="' + (ESTADO_CC[c.estado] || 'arm-tag') + '">' + esc(c.estado) +
        '</span>' : '') + '</div>';
    }).join('');
    var faltan = (x.faltan || []).map(function (f) { return '<div class="asc-linea">' + esc(f) + '</div>'; }).join('');
    return '<td class="num">' + (x.kg ? entero(x.kg) : '—') + '</td>' +
      '<td>' + (pct == null ? '—' : pct + ' %<div class="asc-avance"><div style="width:' + pct + '%;"></div></div>') + '</td>' +
      '<td>' + (codigos || '—') + '</td><td>' + faltan + '</td>';
  }

  function pintarAsa() {
    var a = est.asa, tabla = document.getElementById('ascAsaTabla'), vacio = document.getElementById('ascAsaVacio');
    var filas = filasAsa(a);
    poner('ascAsaLinea', lineaAsa(a));
    document.getElementById('ascAsa').innerHTML = filas.map(filaAsa).join('');
    tabla.style.display = filas.length ? '' : 'none';
    vacio.style.display = filas.length ? 'none' : '';
    vacio.textContent = est.cargandoObra ? 'Cargando…' : !a ? 'No se pudo leer lo de aSa. Recarga la página.'
      : !a.asa ? 'Obra sin código de aSa.' : 'Sin planos terminados.';
  }

  // Los planos con su cruce, sin los reemplazados por otro, por número.
  function filasAsa(a) {
    return a && a.asa ? (a.planos || []).filter(function (x) {
      var p = A.planoDe(est.obra, x.plano);
      return !(p && A.reemplazoDe(p));
    }).sort(function (x, y) { return A.porNumero(A.planoDe(est.obra, x.plano) || x, A.planoDe(est.obra, y.plano) || y); }) : [];
  }

  function lineaAsa(a) {
    return a && a.asa ? ['aSa ' + a.asa, entero(a.codigos) + (a.codigos === 1 ? ' código' : ' códigos'),
                         entero(a.kg) + ' kg', a.al ? 'datos al ' + a.al : ''].filter(Boolean).join(' · ') : '';
  }

  A.pintarAsa = pintarAsa;
})(window);
