/* armascanner/comun.js — lo que comparten las pestañas de la caluga ArmaScanner: el estado de la página,
 * el formato de números y fechas, y los pedidos a ArmaHub. Se carga primero; cada pestaña está en su
 * archivo y lo toma de global.Asc (lo que una pestaña usa de otra también pasa por ahí). Ver index.js.
 */
(function (global) {
  'use strict';

  var est = { obras: [], obra: null, sec: 'planos', planos: [], asa: null, usuarios: null, combo: null,
              usuarioElegido: null, licencias: [], plElemento: '', plBuscar: '', verBarras: null, listo: false,
              admin: false, asaObras: null, dev: null, devVer: 'abiertos', devEditando: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function entero(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function fecha(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : '';
  }
  function quien(email) { return String(email || '').split('@')[0]; }
  function poner(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }
  function decimal(n) { return (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('es-CL'); }
  // Un KPI con sus decimales fijos; sin dato, «—» (nunca 0: se leería «pesa cero»).
  function dec(n, d) {
    if (n == null || n === '' || !isFinite(Number(n))) return '—';
    return Number(n).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function enc(s) { return encodeURIComponent(s == null ? '' : s); }
  function sinTildes(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function mb(bytes) { return bytes ? (bytes / 1e6).toFixed(1).replace('.', ',') + ' MB' : ''; }

  // ── KPIs: los de toda la página (Obras, despieces) ──
  //   PPI = Peso Promedio por Ítem = kg / ítems · Ø prom = Σ(φ·kg)/Σkg · kg/m² = kg / m² de losa
  // Vienen calculados del servidor (armascanner.kpis_de); acá sólo se escriben, con el formato de Obras.
  function kpiKg(k) { return k && k.kg ? entero(k.kg) : '—'; }
  function kpiM2(k) { return k && k.m2 ? dec(k.m2, 1) : '—'; }

  async function postJson(ruta, cuerpo) {
    var res = await fetch(global.apiUrl(ruta), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, global.authHeaders()),
      body: JSON.stringify(cuerpo)
    });
    if (res.status === 401) { global.logout(); return null; }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) {
      var d = data.detail;
      global.showToast((d && d.mensaje) || (typeof d === 'string' && d) || 'Error ' + res.status, 'error');
      return null;
    }
    return data;
  }

  function botonDev(texto, accion) {
    return '<button type="button" class="arm-button" onclick="' + accion + '">' + texto + '</button>';
  }

  global.Asc = { est: est, esc: esc, entero: entero, fecha: fecha, quien: quien, poner: poner, decimal: decimal,
                 dec: dec, enc: enc, sinTildes: sinTildes, mb: mb, kpiKg: kpiKg, kpiM2: kpiM2, postJson: postJson,
                 botonDev: botonDev };
})(window);
