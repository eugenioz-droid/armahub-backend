/* obras/protocolo.js — el Protocolo de cubicación de una obra (21-nov, programa §8.13 fila 8.2).
 *
 * Los criterios vienen de la plantilla de la empresa (nada fijo acá): cada uno se responde
 * según su tipo: una opción, varias, sí / no, número, texto o tabla. Las opciones con croquis
 * se eligen con un clic sobre el croquis.
 *
 *   GET  /protocolo/obra/{id}?version=n       la obra, sus versiones y el protocolo
 *   POST /protocolo/obra/{id}/crear           versión 1 desde la plantilla vigente
 *   POST …/guardar                            sólo los criterios cambiados
 *   POST …/estado                             borrador ⇄ revisado → cerrado
 *   POST …/nueva-version                      desde un cerrado
 *   POST …/actualizar-plantilla               el borrador pasa a la plantilla vigente
 *
 * Sólo el borrador de la última versión se edita, y sólo quien puede (el servidor lo dice en
 * `puede_editar` y lo valida igual).
 */
(function (global) {
  'use strict';

  var P = global.ObrasPanel, esc = P.esc, el = P.el;
  // cambios: {clave: {valor?, obs?}} sin guardar. tablas: filas en edición de cada criterio de tabla.
  var est = { obra: '', vista: null, cambios: {}, tablas: {}, obsAbiertas: {}, filtro: '', listo: false, ocupado: false };

  function caja() { return el('obrProtocolo'); }
  function prot() { return est.vista && est.vista.protocolo; }
  function ruta(fin) { return '/protocolo/obra/' + encodeURIComponent(est.obra) + (fin || ''); }
  function editable() {
    var p = prot();
    return !!(p && est.vista.puede_editar && p.estado === 'borrador' && p.ultima);
  }
  function hayCambios() { return Object.keys(est.cambios).length > 0; }

  function criterioDe(clave) {
    var hallado = null;
    prot().contenido.secciones.forEach(function (s) {
      s.criterios.forEach(function (c) { if (c.clave === clave) hallado = c; });
    });
    return hallado;
  }
  function valorDe(clave) {
    var c = est.cambios[clave], r = prot().respuestas[clave];
    return c && 'valor' in c ? c.valor : (r ? r.valor : null);
  }
  function obsDe(clave) {
    var c = est.cambios[clave], r = prot().respuestas[clave];
    return c && 'obs' in c ? c.obs : (r && r.obs) || '';
  }
  // Mismo criterio que el servidor (protocolo.avance): vacío no cuenta como respondido.
  function respondido(v) {
    if (v == null) return false;
    if (Array.isArray(v)) {
      return v.some(function (x) {
        if (typeof x === 'string') return !!x;
        return Object.keys(x || {}).some(function (k) { return k !== '_fila' && String(x[k] || '').trim(); });
      });
    }
    return String(v).trim() !== '';
  }
  function numero(v) {
    return typeof v === 'number' ? v.toLocaleString('es-CL', { maximumFractionDigits: 6 }) : (v == null ? '' : String(v));
  }

  // ── Dibujo ──
  function filasDe(c) {
    if (est.tablas[c.clave]) return est.tablas[c.clave];
    var v = valorDe(c.clave) || [], filas;
    if (c.filas && c.filas.length) {
      filas = c.filas.map(function (nombre) {
        return Object.assign({}, v.filter(function (x) { return x._fila === nombre; })[0], { _fila: nombre });
      });
    } else {
      filas = v.map(function (x) { return Object.assign({}, x); });
      if (!filas.length) filas.push({});
    }
    return (est.tablas[c.clave] = filas);
  }

  function tabla(c, ed) {
    var filas = filasDe(c), fijas = !!(c.filas && c.filas.length), dis = ed ? '' : ' disabled';
    var quitar = ed && !fijas;
    return '<table class="arm-table obr-tabla"><thead><tr>' + (fijas ? '<th></th>' : '') +
      c.columnas.map(function (k) {
        return '<th>' + esc(k.titulo) + (k.unidad ? ' <span class="obr-linea">' + esc(k.unidad) + '</span>' : '') + '</th>';
      }).join('') + (quitar ? '<th></th>' : '') + '</tr></thead><tbody>' +
      filas.map(function (f, i) {
        return '<tr>' + (fijas ? '<td class="obr-fija">' + esc(f._fila) + '</td>' : '') +
          c.columnas.map(function (k) {
            return '<td><input type="text" class="arm-input" data-campo="celda" data-fila="' + i + '" data-col="' + esc(k.id) +
              '" value="' + esc(f[k.id] || '') + '" aria-label="' + esc(k.titulo) + '"' + dis + '></td>';
          }).join('') +
          (quitar ? '<td><button type="button" class="arm-button obr-mini" data-accion="quitar-fila" data-fila="' + i +
            '">Quitar</button></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' +
      (quitar ? '<div><button type="button" class="arm-button obr-mini" data-accion="agregar-fila">Agregar fila</button></div>' : '');
  }

  function control(c, ed) {
    var v = valorDe(c.clave), dis = ed ? '' : ' disabled';
    if (c.tipo === 'opcion' || c.tipo === 'opciones') {
      var elegidas = Array.isArray(v) ? v : (v == null ? [] : [v]);
      var conCroquis = c.opciones.some(function (o) { return o.croquis_url; });
      return '<div class="' + (conCroquis ? 'obr-opciones' : 'obr-seg') + '">' + c.opciones.map(function (o) {
        var on = elegidas.indexOf(o.id) !== -1 ? ' is-on' : '';
        var atr = ' data-accion="opcion" data-op="' + esc(o.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + dis + '>';
        return conCroquis
          ? '<button type="button" class="obr-opcion' + on + '"' + atr +
            (o.croquis_url ? '<img src="' + esc(o.croquis_url) + '" alt="">' : '<span></span>') +
            '<span class="obr-opcion__texto">' + esc(o.texto) + '</span></button>'
          : '<button type="button" class="arm-button' + on + '"' + atr + esc(o.texto) + '</button>';
      }).join('') + '</div>';
    }
    if (c.tipo === 'si_no') {
      return '<div class="obr-seg">' + [['si', 'Sí'], ['no', 'No']].map(function (o) {
        return '<button type="button" class="arm-button' + (v === o[0] ? ' is-on' : '') + '" data-accion="opcion" data-op="' + o[0] +
          '" aria-pressed="' + (v === o[0] ? 'true' : 'false') + '"' + dis + '>' + o[1] + '</button>';
      }).join('') + '</div>';
    }
    if (c.tipo === 'numero') {
      return '<div class="obr-barra"><input type="text" inputmode="decimal" class="arm-input obr-num" data-campo="valor" value="' +
        esc(numero(v)) + '" aria-label="' + esc(c.texto) + '"' + dis + '>' +
        (c.unidad ? '<span class="obr-rotulo">' + esc(c.unidad) + '</span>' : '') + '</div>';
    }
    if (c.tipo === 'tabla') return tabla(c, ed);
    return '<textarea class="arm-input" rows="1" data-campo="valor" aria-label="' + esc(c.texto) + '"' + dis + '>' +
      esc(v == null ? '' : v) + '</textarea>';
  }

  // Respuesta corta (número, sí / no, pocas opciones sin croquis): va en la misma línea del criterio.
  function enLinea(c) {
    if (c.tipo === 'numero' || c.tipo === 'si_no') return true;
    if (c.tipo !== 'opcion' && c.tipo !== 'opciones') return false;
    return !c.opciones.some(function (o) { return o.croquis_url; }) &&
      c.opciones.map(function (o) { return o.texto; }).join('').length <= 40;
  }

  function criterio(c, n, ed) {
    var obs = obsDe(c.clave), abierta = !!(est.obsAbiertas[c.clave] || obs), linea = enLinea(c);
    return '<div class="obr-criterio' + (respondido(valorDe(c.clave)) ? ' is-ok' : '') + '" data-clave="' + esc(c.clave) + '" data-n="' + n + '">' +
      '<span class="obr-n">' + n + '</span>' +
      '<div class="obr-criterio__cuerpo">' +
        '<div class="obr-criterio__cabeza"><div class="obr-criterio__texto">' + esc(c.texto) + '</div>' +
          (linea ? control(c, ed) : '') +
          (ed && !abierta ? '<button type="button" class="arm-button obr-mini" data-accion="obs">Observación</button>' : '') + '</div>' +
        (c.ayuda ? '<div class="obr-ayuda">' + esc(c.ayuda) + '</div>' : '') +
        (c.croquis_url ? '<img class="obr-croquis" src="' + esc(c.croquis_url) + '" alt="">' : '') +
        (linea ? '' : control(c, ed)) +
        (ed ? (abierta ? '<div class="obr-obs"><span class="obr-rotulo">Observación</span>' +
                '<textarea class="arm-input" rows="1" aria-label="Observación" data-campo="obs">' + esc(obs) + '</textarea></div>' : '')
            : (obs ? '<div class="obr-obs"><span class="obr-rotulo">Observación</span><div>' + esc(obs) + '</div></div>' : '')) +
      '</div></div>';
  }

  function secciones() {
    var ed = editable(), html = '';
    prot().contenido.secciones.forEach(function (s, i) {
      var filas = '', ok = 0;
      s.criterios.forEach(function (c, j) {
        var r = respondido(valorDe(c.clave));
        if (r) ok += 1;
        if (est.filtro !== 'pendientes' || !r) filas += criterio(c, j + 1, ed);
      });
      if (filas) {
        html += '<div class="arm-card obr-seccion"><h3>' + esc(s.titulo) + '<span class="obr-linea" data-cuenta="' + i + '">' +
          ok + ' / ' + s.criterios.length + '</span></h3>' + filas + '</div>';
      }
    });
    return html || '<div class="arm-card obr-vacio">Sin criterios pendientes.</div>';
  }

  function botones() {
    var v = est.vista, p = prot(), h = '';
    if (!v.puede_editar) return '<span class="arm-tag obr-tag-neutra">Sólo lectura</span>';
    if (!p.ultima) return '';
    if (p.estado === 'borrador') {
      if (!p.plantilla_al_dia) {
        h += '<button type="button" class="arm-button" data-accion="actualizar-plantilla">Actualizar a plantilla v' +
          esc(v.plantilla_vigente) + '</button>';
      }
      h += (hayCambios() ? '<span class="arm-tag arm-tag--warning">Sin guardar</span>' : '') +
        '<button type="button" class="arm-button" data-accion="estado" data-estado="revisado">Marcar revisado</button>' +
        '<button type="button" class="arm-button arm-button--primary" data-accion="guardar"' + (hayCambios() ? '' : ' disabled') +
        '>Guardar</button>';
    } else if (p.estado === 'revisado') {
      h += '<button type="button" class="arm-button" data-accion="estado" data-estado="borrador">Volver a borrador</button>' +
        '<button type="button" class="arm-button arm-button--primary" data-accion="estado" data-estado="cerrado">Cerrar protocolo</button>';
    } else {
      h += '<button type="button" class="arm-button arm-button--primary" data-accion="nueva-version">Nueva versión</button>';
    }
    return h;
  }

  function barra() {
    var v = est.vista, p = prot();
    var sello = p.estado === 'cerrado' ? 'Cerrado ' + p.cerrado : p.estado === 'revisado' ? 'Revisado ' + p.revisado
      : p.guardado ? 'Guardado ' + p.guardado : 'Creado ' + p.creado;
    return '<div class="arm-card obr-acciones">' +
      '<span class="obr-grupo">' + P.tagEstado(p.estado) + '<strong>v' + esc(p.version) + '</strong>' +
        '<span class="obr-linea">Plantilla v' + esc(p.plantilla_version) + ' · ' + esc(sello) + '</span></span>' +
      (v.versiones.length > 1 ? '<span class="obr-grupo"><span class="obr-rotulo">Versión</span><span class="obr-seg">' +
        v.versiones.map(function (x) {
          return '<button type="button" class="arm-button' + (x.version === p.version ? ' is-on' : '') +
            '" data-accion="version" data-v="' + esc(x.version) + '">v' + esc(x.version) + '</button>';
        }).join('') + '</span></span>' : '') +
      '<span class="obr-grupo"><span class="obr-rotulo">Ver</span><span class="obr-seg">' +
        '<button type="button" class="arm-button' + (est.filtro ? '' : ' is-on') + '" data-accion="ver" data-ver="" id="obrVerTodos"></button>' +
        '<button type="button" class="arm-button' + (est.filtro ? ' is-on' : '') + '" data-accion="ver" data-ver="pendientes" id="obrVerPend"></button>' +
      '</span></span>' +
      '<span class="obr-derecha" id="obrBotones"></span></div>';
  }

  // Lo que cambia al responder: cuentas, KPIs y botones. Los campos no se vuelven a dibujar
  // (se perdería el cursor mientras se escribe).
  function cuentas() {
    var total = 0, ok = 0, conObs = 0;
    prot().contenido.secciones.forEach(function (s, i) {
      var n = 0;
      s.criterios.forEach(function (c) {
        total += 1;
        if (respondido(valorDe(c.clave))) { ok += 1; n += 1; }
        if (obsDe(c.clave)) conObs += 1;
      });
      var cuenta = caja().querySelector('[data-cuenta="' + i + '"]');
      if (cuenta) cuenta.textContent = n + ' / ' + s.criterios.length;
    });
    P.poner('obrKpiResp', ok + ' de ' + total + ' · ' + (total ? Math.round(100 * ok / total) : 0) + ' %');
    P.poner('obrKpiPend', String(total - ok));
    P.poner('obrKpiObs', String(conObs));
    P.poner('obrVerTodos', 'Todos ' + total);
    P.poner('obrVerPend', 'Pendientes ' + (total - ok));
    var b = el('obrBotones');
    if (b) b.innerHTML = botones();
    return { total: total, ok: ok };
  }

  function alto(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }

  function pintar() {
    var v = est.vista, c = caja();
    if (!v) { c.innerHTML = '<div class="arm-card obr-vacio">No se pudo leer el protocolo. Recarga la página.</div>'; return; }
    P.cabeza(v.obra);
    if (!v.protocolo) {
      c.innerHTML = '<div class="arm-card obr-vacio">' + (v.plantilla_vigente
        ? 'Sin protocolo.' + (v.puede_editar
            ? '<div><button type="button" class="arm-button arm-button--primary" data-accion="crear">Crear protocolo</button></div>' : '')
        : 'Sin plantilla publicada.' + (P.esAdmin()
            ? '<div><button type="button" class="arm-button" data-accion="ir-plantilla">Abrir Plantilla</button></div>' : '')) + '</div>';
      return;
    }
    c.innerHTML = '<div class="obr-kpis obr-kpis--3">' +
        '<div class="arm-kpi"><div class="arm-kpi__label">Respondidos</div><div class="arm-kpi__value" id="obrKpiResp"></div></div>' +
        '<div class="arm-kpi"><div class="arm-kpi__label">Pendientes</div><div class="arm-kpi__value" id="obrKpiPend"></div></div>' +
        '<div class="arm-kpi"><div class="arm-kpi__label">Con observación</div><div class="arm-kpi__value" id="obrKpiObs"></div></div>' +
      '</div>' + barra() + '<div id="obrSecciones" class="obr-vista">' + secciones() + '</div>';
    cuentas();
    c.querySelectorAll('textarea').forEach(alto);
  }

  function repintarCriterio(clave, foco) {
    var nodo = caja().querySelector('.obr-criterio[data-clave="' + clave + '"]');
    if (!nodo) return;
    var envoltorio = document.createElement('div');
    envoltorio.innerHTML = criterio(criterioDe(clave), nodo.getAttribute('data-n'), editable());
    var nuevo = envoltorio.firstChild;
    nodo.parentNode.replaceChild(nuevo, nodo);
    nuevo.querySelectorAll('textarea').forEach(alto);
    var f = foco && nuevo.querySelector(foco);
    if (f) f.focus();
  }

  function cambiar(clave, campo, valor) {
    (est.cambios[clave] = est.cambios[clave] || {})[campo] = valor;
    var nodo = caja().querySelector('.obr-criterio[data-clave="' + clave + '"]');
    if (nodo) nodo.classList.toggle('is-ok', respondido(valorDe(clave)));
    cuentas();
  }

  // ── Acciones ──
  function recibir(d) {
    est.vista = d;
    est.cambios = {}; est.tablas = {}; est.obsAbiertas = {};
    pintar();
  }

  async function cargar(obra, version) {
    unaVez();
    est.obra = obra;
    est.cambios = {}; est.tablas = {}; est.obsAbiertas = {};
    if (!version) est.filtro = '';
    caja().innerHTML = '<div class="arm-card obr-vacio">Cargando…</div>';
    est.vista = await global.apiGet(ruta(version ? '?version=' + encodeURIComponent(version) : ''));
    pintar();
  }

  async function guardar() {
    if (!hayCambios()) return true;
    if (est.ocupado) return false;
    est.ocupado = true;
    var d = await P.enviar(ruta('/guardar'), { version: prot().version, respuestas: est.cambios });
    est.ocupado = false;
    if (!d) return false;
    recibir(d);
    global.showToast('Protocolo guardado.', 'success');
    return true;
  }

  async function cambiarEstado(nuevo) {
    if (!(await guardar())) return;   // lo escrito se guarda antes de cambiar de estado
    var p = prot(), pend = cuentas(), faltan = pend.total - pend.ok;
    var texto = nuevo === 'revisado' ? '¿Marcar el protocolo v' + p.version + ' como revisado con el cliente?'
      : nuevo === 'cerrado' ? '¿Cerrar el protocolo v' + p.version + '?\n\nUn protocolo cerrado no se edita: un cambio posterior ' +
        'requiere una versión nueva.'
      : '¿Volver el protocolo v' + p.version + ' a borrador?';
    if (nuevo !== 'borrador' && faltan) texto += '\n\n' + faltan + (faltan === 1 ? ' criterio' : ' criterios') + ' sin responder.';
    if (!confirm(texto)) return;
    var d = await P.enviar(ruta('/estado'), { version: p.version, estado: nuevo });
    if (!d) return;
    recibir(d);
    global.showToast(nuevo === 'borrador' ? 'Protocolo en borrador.' : nuevo === 'revisado' ? 'Protocolo revisado con el cliente.'
      : 'Protocolo cerrado.', 'success');
  }

  async function nuevaVersion() {
    var p = prot();
    if (!confirm('¿Crear la versión v' + (p.version + 1) + '?\n\nHereda las respuestas de la v' + p.version + '.')) return;
    var d = await P.enviar(ruta('/nueva-version'));
    if (!d) return;
    recibir(d);
    global.showToast('Versión v' + d.protocolo.version + ' creada.' + (d.perdidas ? ' ' + d.perdidas +
      ' respuestas no aplican a la plantilla vigente.' : ''), d.perdidas ? 'warning' : 'success');
  }

  async function actualizarPlantilla() {
    if (!(await guardar())) return;
    if (!confirm('¿Actualizar a la plantilla v' + est.vista.plantilla_vigente + '?\n\nLas respuestas de criterios eliminados o ' +
                 'modificados se descartan.')) return;
    var d = await P.enviar(ruta('/actualizar-plantilla'));
    if (!d) return;
    recibir(d);
    global.showToast('Plantilla actualizada.' + (d.perdidas ? ' ' + d.perdidas + ' respuestas descartadas.' : ''),
                     d.perdidas ? 'warning' : 'success');
  }

  async function crear() {
    var d = await P.enviar(ruta('/crear'));
    if (d) recibir(d);
  }

  function elegir(boton) {
    var nodo = boton.closest('.obr-criterio'), clave = nodo.getAttribute('data-clave');
    var c = criterioDe(clave), op = boton.getAttribute('data-op'), v = valorDe(clave), nuevo;
    if (c.tipo === 'opciones') {
      var elegidas = Array.isArray(v) ? v.slice() : [];
      var i = elegidas.indexOf(op);
      if (i === -1) elegidas.push(op); else elegidas.splice(i, 1);
      nuevo = elegidas;
    } else {
      nuevo = v === op ? null : op;   // otro clic sobre la elegida la quita
    }
    var marcadas = Array.isArray(nuevo) ? nuevo : (nuevo == null ? [] : [nuevo]);
    nodo.querySelectorAll('[data-accion="opcion"]').forEach(function (b) {
      var on = marcadas.indexOf(b.getAttribute('data-op')) !== -1;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    cambiar(clave, 'valor', nuevo);
  }

  function alClic(ev) {
    var b = ev.target.closest('[data-accion]');
    if (!b || b.disabled) return;
    var accion = b.getAttribute('data-accion');
    var nodo = b.closest('.obr-criterio'), clave = nodo && nodo.getAttribute('data-clave');
    if (accion === 'opcion') elegir(b);
    else if (accion === 'obs') { est.obsAbiertas[clave] = true; repintarCriterio(clave, 'textarea[data-campo="obs"]'); }
    else if (accion === 'agregar-fila' || accion === 'quitar-fila') {
      var filas = filasDe(criterioDe(clave));
      if (accion === 'agregar-fila') filas.push({}); else filas.splice(Number(b.getAttribute('data-fila')), 1);
      if (!filas.length) filas.push({});
      cambiar(clave, 'valor', filas);
      repintarCriterio(clave, accion === 'agregar-fila' ? 'tbody tr:last-child input' : '');
    }
    else if (accion === 'guardar') guardar();
    else if (accion === 'estado') cambiarEstado(b.getAttribute('data-estado'));
    else if (accion === 'nueva-version') nuevaVersion();
    else if (accion === 'actualizar-plantilla') actualizarPlantilla();
    else if (accion === 'crear') crear();
    else if (accion === 'ir-plantilla') global.switchTab('ob_plantilla');
    else if (accion === 'version') { if (salir()) cargar(est.obra, b.getAttribute('data-v')); }
    else if (accion === 'ver') {
      est.filtro = b.getAttribute('data-ver') || '';
      el('obrVerTodos').classList.toggle('is-on', !est.filtro);
      el('obrVerPend').classList.toggle('is-on', !!est.filtro);
      el('obrSecciones').innerHTML = secciones();
      caja().querySelectorAll('textarea').forEach(alto);
    }
  }

  function alEscribir(ev) {
    var campo = ev.target.getAttribute && ev.target.getAttribute('data-campo');
    if (!campo) return;
    var clave = ev.target.closest('.obr-criterio').getAttribute('data-clave');
    if (ev.target.tagName === 'TEXTAREA') alto(ev.target);
    if (campo === 'celda') {
      var filas = filasDe(criterioDe(clave));
      filas[Number(ev.target.getAttribute('data-fila'))][ev.target.getAttribute('data-col')] = ev.target.value;
      cambiar(clave, 'valor', filas);
    } else {
      cambiar(clave, campo, ev.target.value);
    }
  }

  // Salir de la obra o cambiar de versión con cambios sin guardar: se pregunta.
  function salir() {
    if (hayCambios() && !confirm('Hay cambios sin guardar.\n\n¿Salir sin guardar?')) return false;
    est.cambios = {};
    return true;
  }

  function unaVez() {
    if (est.listo) return;
    est.listo = true;
    caja().addEventListener('click', alClic);
    caja().addEventListener('input', alEscribir);
    global.addEventListener('beforeunload', function (ev) {
      if (hayCambios()) { ev.preventDefault(); ev.returnValue = ''; }
    });
  }

  P.protocolo = { cargar: cargar, salir: salir, hayCambios: hayCambios };
})(window);
