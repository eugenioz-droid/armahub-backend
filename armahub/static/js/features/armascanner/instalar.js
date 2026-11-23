/* armascanner/instalar.js — la pestaña Instalar: la versión vigente y su descarga, mi licencia y mis equipos.
 */
(function (global) {
  'use strict';
  var A = global.Asc;
  var esc = A.esc, fecha = A.fecha, mb = A.mb;

  async function descargar() {
    var v = await global.apiGet('/armascanner/descarga');  // el enlace vale unos minutos: se pide al apretar
    if (v && v.url) global.location.href = v.url;
  }

  async function cargarInstalar() {
    var b = document.getElementById('ascDescargar');
    if (!b.dataset.listo) { b.addEventListener('click', descargar); b.dataset.listo = '1'; }
    var v = await global.apiGet('/armascanner/descarga');
    b.disabled = !(v && v.version);
    pintarDescarga(v);
    var d = await global.apiGet('/armascanner/mi-licencia');
    if (!d) return;
    pintarMiLicencia(d);
  }

  // Un ZIP: se descomprime y se abre ArmaScanner.exe, que se instala solo (instalacion.py).
  function pintarDescarga(v) {
    document.getElementById('ascDescargaLinea').textContent = v && v.version
      ? 'Versión ' + v.version + ' · ' + mb(v.tamano) + ' · Descomprime y abre ArmaScanner.exe'
      : ['admin', 'admin_calidad'].indexOf(global.currentRole) !== -1
        ? 'Sin versión publicada. Se publica en la pestaña Versiones.' : 'Sin versión publicada.';
  }

  function pintarMiLicencia(d) {
    document.getElementById('ascMiEstado').innerHTML = d.activa
      ? '<span class="arm-tag arm-tag--success">Activa' + (d.vence ? ' hasta ' + fecha(d.vence) : '') + '</span>'
      : '<span class="arm-tag arm-tag--danger">Sin licencia</span>';
    var eq = d.equipos || [];
    document.getElementById('ascMisEquipos').innerHTML = eq.length
      ? eq.map(function (e) {
          return '<tr><td>' + esc(e.equipo) + '</td><td>' + fecha(e.ultimo_uso) + '</td><td>' + esc(e.version || '') + '</td></tr>';
        }).join('')
      : '<tr><td colspan="3" class="asc-vacio">Sin equipos. Se registran al abrir ArmaScanner.</td></tr>';
  }

  A.cargarInstalar = cargarInstalar;
})(window);
