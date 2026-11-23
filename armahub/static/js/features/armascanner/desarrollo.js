/* armascanner/desarrollo.js — la pestaña Desarrollo (administrador): los planos que el lector no reconoce,
 * con sus envíos y su estado, y las oficinas de cálculo con el lector que lee sus planos.
 */
(function (global) {
  'use strict';
  var A = global.Asc;
  var est = A.est, esc = A.esc, entero = A.entero, poner = A.poner, postJson = A.postJson, botonDev = A.botonDev;

  // ── Desarrollo (administrador): los planos que el lector no reconoce y los reportes, con su estado; y
  // las oficinas de cálculo, con el lector que lee sus planos. [Usuario 23-nov: «un flujo que no dependa
  // de estar enviando planos manualmente sin control ni trazabilidad»; «un pequeño apartado donde
  // listemos las oficinas de cálculo… así se va estableciendo una base de conocimiento»] ──
  // Sólo lectura: el caso es el plano que no se lee y sus envíos son el historial; los estados los
  // cambia el agente. [Usuario 23-nov: «es saber que ese plano ya se resolvió»; «esos botones son más
  // para ti… Esto apunta a resolver lecturas, no a resolver bugs»]
  var ESTADO_DEV = { nuevo: ['Nuevo', 'arm-tag--warning'], en_estudio: ['En estudio', 'arm-tag--info'],
                     resuelto: ['Resuelto', 'arm-tag--success'], descartado: ['Descartado', ''] };

  async function cargarDesarrollo() {
    if (!est.devListo) {
      est.devListo = true;
      document.getElementById('ascDevMostrar').addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-ver]');
        if (!b) return;
        est.devVer = b.getAttribute('data-ver');
        this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
        pintarCasos();
      });
      document.getElementById('ascDevAgregarOf').addEventListener('click', function () {
        var id = Number(document.getElementById('ascDevOtra').value);
        if (id) { est.devEditando = id; guardarOficina(id, '', ''); }
      });
    }
    var d = await global.apiGet('/armascanner/desarrollo');
    est.dev = d || { casos: [], oficinas: [], otras: [] };
    est.devSinRespuesta = !d;
    pintarCasos();
    pintarOficinas();
  }

  function abiertoDev(c) { return c.estado === 'nuevo' || c.estado === 'en_estudio'; }

  function estadoDev(c) {
    var e = ESTADO_DEV[c.estado] || [c.estado, ''];
    return '<td><span class="arm-tag ' + e[1] + '">' + e[0] + '</span>' +
      (c.estado === 'resuelto' && c.version_resuelto ? '<div class="asc-linea">' + esc(c.version_resuelto) + '</div>' : '') + '</td>';
  }

  function detalleDev(c) {
    return '<td><div class="asc-lector">' + esc([c.comentario, c.lector].filter(Boolean).join('\n')) + '</div>' +
      (c.nota ? '<div class="asc-linea">' + esc(c.nota) + '</div>' : '') + '</td>';
  }

  function pintarCasos() {
    var casos = est.dev.casos || [];
    var cuenta = function (e) { return casos.filter(function (c) { return c.estado === e; }).length; };
    poner('ascDevNuevos', entero(cuenta('nuevo')));
    poner('ascDevEstudio', entero(cuenta('en_estudio')));
    poner('ascDevResueltos', entero(cuenta('resuelto')));
    var filas = casos.filter(function (c) { return est.devVer === 'todos' || abiertoDev(c); });
    document.getElementById('ascDevCasos').innerHTML = filas.map(function (c) {
      var n = c.envios.length, abierto = est.devHistorial === c.id;
      var acciones = botonDev('Descargar', 'ascDescargarReporte(' + c.id + ')') +
        (n > 1 ? botonDev(abierto ? 'Ocultar historial' : 'Historial (' + n + ')', 'ascHistorial(' + c.id + ')') : '');
      var fila = '<tr>' + estadoDev(c) +
        '<td>' + esc(c.plano || 'Sin plano') + '<div class="asc-linea">' + esc([c.obra, c.oficina].filter(Boolean).join(' · ')) + '</div></td>' +
        '<td>' + esc(c.el) + '<div class="asc-linea">' + esc([c.usuario, c.version].filter(Boolean).join(' · ')) + '</div></td>' +
        detalleDev(c) + '<td class="asc-acciones"><div>' + acciones + '</div></td></tr>';
      if (!abierto) return fila;
      return fila + c.envios.map(function (e) {
        return '<tr class="asc-hist">' + estadoDev(e) + '<td>' + esc(e.equipo) + '</td>' +
          '<td>' + esc(e.el) + '<div class="asc-linea">' + esc([e.usuario, e.version].filter(Boolean).join(' · ')) + '</div></td>' +
          detalleDev(e) + '<td class="asc-acciones"><div>' + botonDev('Descargar', 'ascDescargarReporte(' + e.id + ')') + '</div></td></tr>';
      }).join('');
    }).join('');
    var vacio = document.getElementById('ascDevVacio');
    vacio.style.display = filas.length ? 'none' : '';
    vacio.textContent = est.devSinRespuesta ? 'No se pudieron leer los casos. Recarga la página.'
      : est.devVer === 'todos' ? 'Sin casos.' : 'Sin casos abiertos.';
  }

  global.ascHistorial = function (id) {
    est.devHistorial = est.devHistorial === id ? null : id;
    pintarCasos();
  };

  function pintarOficinas() {
    var of = est.dev.oficinas || [];
    poner('ascDevNumOf', entero(of.length));
    document.getElementById('ascDevOficinas').innerHTML = of.map(function (o) {
      if (est.devEditando === o.id) {
        return '<tr class="asc-of-edit"><td>' + esc(o.nombre) + '</td>' +
          '<td><input type="text" class="arm-input" id="ascOfLector" list="ascDevLectores" value="' + esc(o.lector) + '"></td>' +
          '<td>' + esc(o.obras.join(' · ')) + '</td><td class="num">' + entero(o.abiertos) + '</td>' +
          '<td><input type="text" class="arm-input" id="ascOfNotas" value="' + esc(o.notas) + '"></td>' +
          '<td class="asc-acciones"><div><button type="button" class="arm-button arm-button--primary" onclick="ascGuardarOficina(' + o.id + ')">Guardar</button>' +
          '<button type="button" class="arm-button" onclick="ascEditarOficina(0)">Cancelar</button></div></td></tr>';
      }
      return '<tr><td>' + esc(o.nombre) + '</td><td>' + (o.lector ? esc(o.lector) : '<span class="asc-linea">Sin lector</span>') + '</td>' +
        '<td>' + esc(o.obras.join(' · ')) + '</td><td class="num">' + (o.abiertos ? entero(o.abiertos) : '—') + '</td>' +
        '<td>' + esc(o.notas) + '</td>' +
        '<td class="asc-acciones"><div><button type="button" class="arm-button" onclick="ascEditarOficina(' + o.id + ')">Editar</button></div></td></tr>';
    }).join('');
    document.getElementById('ascDevOfVacio').style.display = of.length ? 'none' : '';
    document.getElementById('ascDevOtra').innerHTML = '<option value="">Elegir oficina…</option>' +
      (est.dev.otras || []).map(function (o) { return '<option value="' + o.id + '">' + esc(o.nombre) + '</option>'; }).join('');
  }

  global.ascEditarOficina = function (id) {
    est.devEditando = id || null;
    pintarOficinas();
    var e = document.getElementById('ascOfLector');
    if (e) e.focus();
  };

  global.ascGuardarOficina = function (id) {
    guardarOficina(id, document.getElementById('ascOfLector').value, document.getElementById('ascOfNotas').value);
  };

  async function guardarOficina(id, lector, notas) {
    var data = await postJson('/armascanner/oficinas', { calculista_id: id, lector: lector, notas: notas });
    if (!data) return;
    await cargarDesarrollo();
    global.ascEditarOficina(est.devEditando === id && !lector && !notas ? id : 0);
  }

  A.cargarDesarrollo = cargarDesarrollo;
})(window);
