/* armascanner/versiones.js — la pestaña Versiones (administración): publicar el ZIP de ArmaScanner, retirar
 * o reponer una versión y marcarla obligatoria.
 */
(function (global) {
  'use strict';
  var A = global.Asc;
  var esc = A.esc, fecha = A.fecha, quien = A.quien, mb = A.mb;

  // ── Versiones (administración) ──
  async function cambiarVersion(id, cambio) {
    var res = await fetch(global.apiUrl('/armascanner/versiones/' + id), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, global.authHeaders()),
      body: JSON.stringify(cambio)
    });
    if (res.status === 401) { global.logout(); return; }
    var data = await res.json().catch(function () { return {}; });
    if (!data.ok) { global.showToast('No se guardó: ' + (data.detail || 'error'), 'error'); return; }
    await cargarVersiones();
  }
  global.ascVersion = cambiarVersion;

  async function cargarVersiones() {
    var bp = document.getElementById('ascVerPublicar');
    if (!bp.dataset.listo) {
      bp.dataset.listo = '1';
      bp.addEventListener('click', publicar);
      document.getElementById('ascVerArchivo').addEventListener('change', function () {
        var f = this.files[0];
        var m = f && f.name.match(/(\d{4}-\d{2}-\d{2}(?:\.\d+)?)/);  // ArmaScanner-2026-11-19-instalar.exe
        if (m) document.getElementById('ascVerVersion').value = m[1];
      });
    }
    var d = await global.apiGet('/armascanner/versiones');
    var filas = (d && d.versiones) || [];
    document.getElementById('ascVersiones').innerHTML = filas.map(function (v) {
      var estado = !v.activa ? '<span class="arm-tag">Retirada</span>'
        : v.version === d.vigente ? '<span class="arm-tag arm-tag--success">Vigente</span>'
        : '<span class="arm-tag arm-tag--info">Activa</span>';
      if (v.obligatoria) estado += ' <span class="arm-tag arm-tag--warning">Obligatoria</span>';
      return '<tr><td>' + esc(v.version) + '</td>' +
        '<td>' + fecha(v.publicada_el) + '<div class="asc-linea">' + esc(quien(v.publicada_por)) + '</div></td>' +
        '<td class="num">' + mb(v.tamano) + '</td><td>' + esc(v.notas) + '</td><td>' + estado + '</td>' +
        '<td style="text-align:right; white-space:nowrap;">' +
          '<button class="arm-button" onclick="ascVersion(' + v.id + ', {obligatoria: ' + !v.obligatoria + '})">' +
            (v.obligatoria ? 'Opcional' : 'Obligatoria') + '</button> ' +
          (v.activa
            ? '<button class="arm-button arm-button--danger" onclick="ascVersion(' + v.id + ', {activa: false})">Retirar</button>'
            : '<button class="arm-button" onclick="ascVersion(' + v.id + ', {activa: true})">Reponer</button>') +
        '</td></tr>';
    }).join('');
    document.getElementById('ascVersionesVacio').style.display = filas.length ? 'none' : '';
  }

  function publicar() {
    var f = document.getElementById('ascVerArchivo').files[0];
    var version = document.getElementById('ascVerVersion').value.trim();
    var estado = document.getElementById('ascVerEstado');
    if (!f || !version) { global.showToast('Elige el instalador y escribe la versión.', 'warning'); return; }
    var form = new FormData();
    form.append('archivo', f);
    form.append('version', version);
    form.append('notas', document.getElementById('ascVerNotas').value);
    form.append('obligatoria', document.getElementById('ascVerOblig').checked ? 'true' : 'false');
    var xhr = new XMLHttpRequest();  // con XHR para ver el avance de la subida (decenas de MB)
    xhr.open('POST', global.apiUrl('/armascanner/versiones'));
    var cab = global.authHeaders();
    Object.keys(cab).forEach(function (k) { xhr.setRequestHeader(k, cab[k]); });
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) estado.textContent = 'Subiendo ' + Math.round(100 * e.loaded / e.total) + ' %';
    };
    xhr.onload = function () {
      var r = {};
      try { r = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status === 401) { global.logout(); return; }
      if (xhr.status >= 300 || !r.ok) { estado.textContent = ''; global.showToast('No se publicó: ' + (r.detail || xhr.status), 'error'); return; }
      estado.textContent = 'Publicada ' + r.version;
      ['ascVerArchivo', 'ascVerVersion', 'ascVerNotas'].forEach(function (id) { document.getElementById(id).value = ''; });
      document.getElementById('ascVerOblig').checked = false;
      cargarVersiones();
    };
    xhr.onerror = function () { estado.textContent = ''; global.showToast('Se cortó la subida. Vuelve a intentar.', 'error'); };
    estado.textContent = 'Subiendo 0 %';
    xhr.send(form);
  }

  A.cargarVersiones = cargarVersiones;
})(window);
