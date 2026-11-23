/* armascanner/uso.js — la pestaña Uso (administración): los KPIs y el uso por usuario de los últimos 30 días,
 * y los reportes de errores que mandan los cubicadores con «Enviar reporte».
 */
(function (global) {
  'use strict';
  var A = global.Asc;
  var esc = A.esc, entero = A.entero, fecha = A.fecha, quien = A.quien, poner = A.poner, botonDev = A.botonDev;

  // ── Reportes (administrador, pestaña Uso): los errores que mandan los cubicadores con «Enviar reporte» ──
  async function cargarReportes() {
    var data = await global.apiGet('/armascanner/reportes');
    var filas = (data && data.reportes) || [];
    document.getElementById('ascReportes').innerHTML = filas.map(function (r) {
      return '<tr><td>' + esc(r.el) + '</td><td>' + esc(r.usuario) + '<div class="asc-linea">' +
        esc([r.equipo, r.version].filter(Boolean).join(' · ')) + '</div></td>' +
        '<td>' + esc(r.obra) + (r.plano ? '<div class="asc-linea">' + esc(r.plano) + '</div>' : '') + '</td>' +
        '<td>' + esc(r.comentario) + '</td>' +
        '<td class="asc-acciones"><div>' + botonDev('Descargar', 'ascDescargarReporte(' + r.id + ')') + '</div></td></tr>';
    }).join('');
    var vacio = document.getElementById('ascReportesVacio');
    vacio.style.display = filas.length ? 'none' : '';
    vacio.textContent = data ? 'Sin reportes.' : 'No se pudieron leer los reportes. Recarga la página.';
  }

  global.ascDescargarReporte = async function (id) {
    var v = await global.apiGet('/armascanner/reportes/' + id + '/descarga');
    if (v && v.url) window.location.href = v.url;
  };

  // ── Uso (administración) ──
  async function cargarUso() {
    cargarReportes();
    var d = await global.apiGet('/armascanner/uso');
    if (!d) return;
    poner('ascUsoLic', entero(d.licencias_activas));
    poner('ascUsoPlanos', entero(d.planos));
    poner('ascUsoKg', entero(d.kg) + ' kg');
    poner('ascUsoAprob', String(d.aprobadas_pct).replace('.', ',') + ' %');
    var filas = d.por_usuario || [];
    document.getElementById('ascUso').innerHTML = filas.map(function (u) {
      return '<tr><td>' + esc(quien(u.usuario)) + '</td><td class="num">' + entero(u.planos) + '</td>' +
        '<td class="num">' + entero(u.items) + '</td><td class="num">' + entero(u.kg) + '</td>' +
        '<td class="num">' + String(u.aprobadas_pct).replace('.', ',') + ' %</td><td>' + fecha(u.ultima) + '</td></tr>';
    }).join('');
    document.getElementById('ascUsoVacio').style.display = filas.length ? 'none' : '';
  }

  A.cargarUso = cargarUso;
})(window);
