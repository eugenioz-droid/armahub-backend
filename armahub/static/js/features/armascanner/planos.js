/* armascanner/planos.js — la sección Planos de la ventana de la obra: la lista con su estado, sus KPIs y su
 * pedido; ver PDF, descargar DWG, ver barras, responder un pedido de reemplazo, enviar pedido, eliminar.
 */
(function (global) {
  'use strict';
  var A = global.Asc;
  var est = A.est, esc = A.esc, entero = A.entero, quien = A.quien, decimal = A.decimal, dec = A.dec, enc = A.enc,
      kpiKg = A.kpiKg, kpiM2 = A.kpiM2, postJson = A.postJson;

  // ── Planos de la obra (sin bloqueo desde el 21-nov) ──
  // Nadie toma un plano: el cubicador lo sube al terminarlo, y hay una sola versión por plano. Otro
  // cubicador que también lo terminó pide el reemplazo; el autor lo acepta o rechaza (o, si no está,
  // el administrador responde por él). [Usuario 22-nov: «así se coordinan y evitamos duplicar data»]
  async function postPlano(ruta, p, extra) {
    return postJson(ruta, Object.assign({ obra: p.obra, plano: p.plano }, extra || {}));
  }

  function porNumero(a, b) {
    return String(a.numero || a.plano).localeCompare(String(b.numero || b.plano), 'es', { numeric: true });
  }

  // Revisiones (programa 4.12): el cubicador indica al cargar si la nueva reemplaza a la anterior o la
  // complementa; la reemplazada queda aparte, como antecedente.
  function planoDe(obra, plano) {
    return est.planos.filter(function (q) { return q.obra === obra && q.plano === plano; })[0];
  }
  function reemplazoDe(p) {
    return est.planos.filter(function (q) { return q.obra === p.obra && q.relacion === 'reemplaza' && q.relacion_de === p.plano; })[0];
  }
  function revDeTexto(q, plano) { return q ? (q.numero || q.plano) + (q.revision ? ' rev. ' + q.revision : '') : plano; }

  // Los pedidos de reemplazo que corren sobre la versión del plano: pendientes y aceptados.
  function pendientesDe(p) {
    return (p.reemplazos || []).filter(function (x) { return x.estado === 'pendiente'; });
  }

  // El estado del plano, en el orden en que se listan.
  var ESTADOS = [['terminado', 'Terminado', 'arm-tag arm-tag--success'],
                 ['cargado', 'Cargado', 'arm-tag'],
                 ['reemplazado', 'Reemplazado', 'arm-tag']];
  function estadoDe(p) {
    if (reemplazoDe(p)) return 'reemplazado';
    return p.etapa === 'cargado' ? 'cargado' : 'terminado';
  }
  function ordenEstado(p) {
    var e = estadoDe(p);
    return ESTADOS.map(function (x) { return x[0]; }).indexOf(e);
  }

  function planosFiltrados() {
    var q = (est.plBuscar || '').trim().toLowerCase();
    return est.planos.filter(function (p) {
      return (!est.plElemento || (p.elemento || '').split(', ').indexOf(est.plElemento) !== -1)
        && (!q || (p.numero + ' ' + p.plano + ' ' + p.titulo).toLowerCase().indexOf(q) !== -1);
    }).sort(function (a, b) { return ordenEstado(a) - ordenEstado(b) || porNumero(a, b); });
  }

  function celdaEstado(p, r) {
    var e = ESTADOS.filter(function (x) { return x[0] === estadoDe(p); })[0];
    var cons = Number(r.consultas) || 0;
    var tags = (p.reemplazos || []).map(function (x) {
        return x.estado === 'aceptado'
          ? '<span class="arm-tag arm-tag--info">Reemplazo aceptado: espera la versión de ' + esc(x.solicitante) + '</span>'
          : '<span class="arm-tag arm-tag--warning">Reemplazo pedido por ' + esc(x.solicitante) + '</span>';
      }).join('') +
      (cons ? '<span class="arm-tag arm-tag--warning">' + entero(cons) + ' con consulta</span>' : '') +
      (p.relacion ? '<span class="arm-tag arm-tag--info">' + (p.relacion === 'reemplaza' ? 'Reemplaza a ' : 'Complementa a ') +
        esc(revDeTexto(planoDe(p.obra, p.relacion_de), p.relacion_de)) + '</span>' : '') +
      (reemplazoDe(p) ? '<span class="arm-tag">Por ' + esc(revDeTexto(reemplazoDe(p))) + '</span>' : '');
    return '<div class="asc-tags"><span class="' + e[2] + '">' + e[1] + '</span></div>' +
      (tags ? '<div class="asc-tags">' + tags + '</div>' : '');
  }

  function celdaPedido(p) {
    if (p.etapa === 'cargado') return '';
    if (p.pedido === 'enviado') {
      return '<span class="arm-tag arm-tag--success" title="' + esc([p.pedido_el, p.pedido_version ? 'v' + p.pedido_version : '',
        p.pedido_por].filter(Boolean).join(' · ')) + '">Enviado</span>';
    }
    return p.pedido === 'cambios' ? '<span class="arm-tag arm-tag--warning">Cambios sin enviar</span>'
      : '<span class="arm-tag">Sin enviar</span>';
  }

  function filaPlano(p) {
    var i = est.planos.indexOf(p), r = p.resumen || {};
    var total = Number(r.barras) || 0;
    return '<tr>' +
      '<td><div class="asc-pl__num">' + esc(p.numero || p.plano) +
        (p.revision ? ' <span class="asc-linea">Rev. ' + esc(p.revision) + '</span>' : '') + '</div>' +
        '<div class="asc-linea asc-pl__tit" title="' + esc(p.titulo || p.plano) + '">' + esc(p.titulo || p.plano) + '</div></td>' +
      '<td>' + (p.elemento ? '<span class="arm-tag">' + esc(p.elemento) + '</span>' : '') + '</td>' +
      '<td>' + celdaEstado(p, r) + '</td>' +
      celdasKpi(p.kpis) +
      '<td>' + esc(quien(p.guardado_por)) + '<div class="asc-linea">' + esc(p.guardado_el) + '</div></td>' +
      '<td>' + celdaPedido(p) + '</td>' +
      '<td class="asc-acciones"><div>' + accionesPlano(p, i, total) + '</div></td></tr>';
  }

  // Los KPIs del plano (sin KPIs, un plano sólo cargado): ítems, kg, PPI, m².
  function celdasKpi(k) {
    return '<td class="num">' + (k ? entero(k.items) : '—') + '</td>' +
      '<td class="num">' + (k ? kpiKg(k) : '—') + '</td>' +
      '<td class="num">' + (k ? dec(k.ppi, 1) : '—') + '</td>' +
      '<td class="num">' + (k ? kpiM2(k) : '—') + '</td>';
  }

  function accionesPlano(p, i, total) {
    var pendiente = pendientesDe(p)[0];
    // Con un reemplazo pedido, lo que destaca es responderlo (el autor o el administrador). Con uno
    // aceptado el plano está por cambiar: el pedido espera la versión nueva (puede_enviar viene en false).
    // «Ver PDF» siempre a la vista: sin PDF va apagado (nace al «Terminar» en ArmaScanner)
    return (p.pdf ? '<button type="button" class="arm-button" onclick="ascVerPlanoDe(' + i + ')">Ver PDF</button>'
      : '<button type="button" class="arm-button" disabled title="Se genera al terminar el plano en ArmaScanner">Ver PDF</button>') +
      '<button type="button" class="arm-button" onclick="ascDescargarDwg(' + i + ', this)">Descargar DWG</button>' +
      (total > 0 ? '<button type="button" class="arm-button" onclick="ascVerBarras(' + i + ')">Ver barras</button>' : '') +
      (pendiente && p.puede_responder
        ? '<button type="button" class="arm-button arm-button--primary" onclick="ascResponderReemplazo(' + i + ', true)">Aceptar reemplazo</button>' +
          '<button type="button" class="arm-button" onclick="ascResponderReemplazo(' + i + ', false)">Rechazar</button>' : '') +
      (p.puede_enviar && total > 0
        ? '<button type="button" class="arm-button arm-button--primary" onclick="ascEnviarPedido(' + i + ')">Enviar pedido</button>' : '') +
      (p.puede_eliminar ? '<button type="button" class="arm-button arm-button--danger" onclick="ascEliminarPlano(' + i + ')">Eliminar</button>' : '');
  }

  function pintarPlanos() {
    var filas = planosFiltrados();
    document.getElementById('ascPlanos').innerHTML = filas.map(filaPlano).join('');
    var vacio = document.getElementById('ascPlanosVacio');
    vacio.style.display = filas.length ? 'none' : '';
    vacio.textContent = est.cargandoObra ? 'Cargando…' : est.plSinRespuesta ? 'No se pudieron leer los planos. Recarga la página.'
      : est.planos.length ? 'Sin planos con este filtro.' : 'Sin planos en esta obra.';
    var cuenta = { '': 0 };
    est.planos.forEach(function (p) {
      cuenta[''] += 1;
      (p.elemento || '').split(', ').forEach(function (el) { cuenta[el] = (cuenta[el] || 0) + 1; });
    });
    document.querySelectorAll('#ascPlElemento .arm-button').forEach(function (b) {
      var el = b.getAttribute('data-el') || '';
      b.textContent = (el || 'Todos') + ' ' + (cuenta[el] || 0);
    });
    var tab = document.querySelector('#ascObraTabs .arm-tab[data-sec="planos"]');
    if (tab) tab.textContent = 'Planos ' + entero(est.planos.length);
  }

  // Ver barras: ventana con la lista del plano; abre en «Con consulta» si hay alguna (se manda
  // por correo como pantallazo: título y tabla sin controles).
  var REV = {
    aprobada: { txt: 'Aprobada', tag: 'arm-tag arm-tag--success' },
    duda: { txt: 'Con consulta', tag: 'arm-tag arm-tag--warning' },
    pendiente: { txt: 'Por aprobar', tag: 'arm-tag' }
  };
  var FILTROS_REV = [['', 'Todas'], ['duda', 'Con consulta'], ['pendiente', 'Por aprobar'], ['aprobada', 'Aprobadas']];

  function revDe(b) { return REV[b.rev] ? b.rev : 'pendiente'; }

  function pintarBarras() {
    var v = est.verBarras;
    if (!v) return;
    var cuenta = { '': v.barras.length, aprobada: 0, duda: 0, pendiente: 0 };
    v.barras.forEach(function (b) { cuenta[revDe(b)] += 1; });
    document.getElementById('ascBarrasFiltro').innerHTML = FILTROS_REV.map(function (f) {
      return '<button type="button" class="arm-button' + (f[0] === v.filtro ? ' is-on' : '') + '" data-rev="' + f[0] + '">' +
        f[1] + ' ' + entero(cuenta[f[0]]) + '</button>';
    }).join('');
    var filas = v.barras.filter(function (b) { return !v.filtro || revDe(b) === v.filtro; });
    var nombreFiltro = FILTROS_REV.filter(function (f) { return f[0] === v.filtro; })[0][1];
    document.getElementById('ascBarrasTitulo').textContent =
      (v.plano.numero || v.plano.plano) + ' — ' + (v.plano.obra_nombre || v.plano.obra) +
      (v.version ? ' · v' + v.version : '') + ' · ' + nombreFiltro;
    document.getElementById('ascBarras').innerHTML = filas.map(function (b) {
      var r = REV[revDe(b)];
      return '<tr><td>' + esc(b.id) + '</td><td>' + esc(b.marca) + '</td>' +
        '<td class="num">' + esc(b.diam) + '</td><td class="num">' + (b.cant == null ? '' : entero(b.cant)) + '</td>' +
        '<td class="num">' + (b.largo == null ? '' : entero(b.largo)) + '</td>' +
        '<td class="num">' + (b.kg == null ? '' : decimal(b.kg)) + '</td>' +
        '<td>' + esc(b.ciclo) + '</td><td>' + esc(b.eje) + '</td>' +
        '<td><span class="' + r.tag + '">' + r.txt + '</span></td><td>' + esc(b.motivo) + '</td></tr>';
    }).join('');
    var vacio = document.getElementById('ascBarrasVacio');
    vacio.style.display = filas.length ? 'none' : '';
    vacio.textContent = v.barras.length ? 'Sin barras con este filtro.' : 'Sin barras en esta versión.';
  }

  function cerrarBarras() {
    est.verBarras = null;
    global.hideModal('ascBarrasModal');
  }

  global.ascVerBarras = async function (i) {
    var p = est.planos[i];
    if (!p) return;
    var d = await global.apiGet('/armascanner/planos-linea/barras?obra=' + enc(p.obra) + '&plano=' + enc(p.plano));
    if (!d) { global.showToast('No se pudieron leer las barras del plano.', 'error'); return; }
    var barras = d.barras || [];
    est.verBarras = { plano: p, version: d.version, barras: barras,
                      filtro: barras.some(function (b) { return b.rev === 'duda'; }) ? 'duda' : '' };
    pintarBarras();
    global.showModal('ascBarrasModal');
  };

  // Ver PDF: el PDF que ArmaScanner subió con el plano. La ventana es de visor.js (ascVerPlano).
  global.ascVerPlanoDe = function (i) {
    var p = est.planos[i];
    if (!p || !global.ascVerPlano) return;
    global.ascVerPlano(p.obra, p.plano, (p.numero || p.plano) + ' — ' + (p.obra_nombre || p.obra));
  };

  // Descargar DWG: ArmaHub lo saca del paquete del plano (la copia de trabajo o el del calculista).
  function nombreDescarga(cd) {
    var m = /filename\*=UTF-8''([^;]+)/i.exec(cd || '');
    if (m) { try { return decodeURIComponent(m[1]); } catch (_) { /* va el simple */ } }
    m = /filename="([^"]+)"/i.exec(cd || '');
    return m ? m[1] : '';
  }

  global.ascDescargarDwg = async function (i, boton) {
    var p = est.planos[i];
    if (!p) return;
    var texto = boton ? boton.textContent : '';
    if (boton) { boton.disabled = true; boton.textContent = 'Descargando…'; }
    try {
      var res = await fetch(global.apiUrl('/armascanner/planos-linea/dwg?obra=' + enc(p.obra) + '&plano=' + enc(p.plano)),
                            { headers: global.authHeaders() });
      if (res.status === 401) { global.logout(); return; }
      if (!res.ok) { await avisarErrorDwg(res); return; }
      await guardarDwg(res, p);
    } catch (e) {
      global.showToast('No se pudo descargar el DWG.', 'error');
    } finally {
      if (boton) { boton.disabled = false; boton.textContent = texto; }
    }
  };

  async function avisarErrorDwg(res) {
    var d = await res.json().catch(function () { return {}; });
    global.showToast((typeof d.detail === 'string' && d.detail) || 'No se pudo descargar el DWG.', 'error');
  }

  async function guardarDwg(res, p) {
    var url = URL.createObjectURL(await res.blob());
    var a = document.createElement('a');
    a.href = url;
    a.download = nombreDescarga(res.headers.get('Content-Disposition')) || (p.plano + '.dwg');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // Aceptar o rechazar el reemplazo pedido (el más antiguo, si hay más de uno): el autor de la
  // versión o, en su lugar, el administrador. Aceptar no borra nada: la versión sigue hasta que el
  // solicitante suba la suya. ArmaHub le avisa la respuesta.
  global.ascResponderReemplazo = async function (i, acepta) {
    var p = est.planos[i];
    var x = p && pendientesDe(p)[0];
    if (!x) return;
    var autor = p.entrega ? p.entrega.autor : p.guardado_por;
    var texto = acepta
      ? '¿Aceptar que ' + x.solicitante + ' reemplace la versión de ' + autor + ' de ' + (p.numero || p.plano) + '?\n\n' +
        'La versión actual sigue hasta que ' + x.solicitante + ' suba la suya.'
      : '¿Rechazar el reemplazo de ' + (p.numero || p.plano) + ' que pidió ' + x.solicitante + '?';
    if (!confirm(texto)) return;
    if (!await postPlano('/armascanner/planos-linea/reemplazo/responder', p,
                         { solicitante: x.solicitante_email, acepta: !!acepta })) return;
    global.showToast(acepta ? 'Reemplazo aceptado.' : 'Reemplazo rechazado.', 'success');
    await A.recargarObra(true);
  };

  global.ascEnviarPedido = async function (i) {
    var p = est.planos[i];
    if (!p) return;
    var r = p.resumen || {};
    var sin = (Number(r.pendientes) || 0) + (Number(r.consultas) || 0);
    var texto = '¿Enviar pedido de ' + (p.numero || p.plano) + '?\n\nSus barras pasan a los despieces de la obra. ' +
      'Reemplazan las de este plano.' +
      (sin > 0 ? '\n\n' + entero(sin) + ' barras sin aprobar: esas combinaciones no se exportan.' : '');
    if (!confirm(texto)) return;
    var data = await postPlano('/armascanner/planos-linea/pedido', p);
    if (!data) return;
    global.showToast('Pedido enviado: ' + entero(data.barras) + ' barras · ' + entero(data.kilos) + ' kg', 'success');
    await A.recargarObra(true);
  };

  global.ascEliminarPlano = async function (i) {
    var p = est.planos[i];
    if (!p) return;
    var texto = '¿Eliminar ' + (p.numero || p.plano) + ' de ArmaHub?\n\nSe eliminan su registro y sus archivos' +
      (p.entrega ? ', con la versión terminada de ' + p.entrega.autor : '') + '.';
    if (!confirm(texto)) return;
    var conBarras = p.pedido !== 'sin_enviar' && confirm('Este plano envió un pedido. ¿Eliminar también sus barras de los ' +
      'despieces de la obra?\n\nAceptar: se eliminan. Cancelar: las barras se conservan.');
    // (con cuerpo JSON: la ruta no lee la consulta; antes se avisaba «eliminado» sin que se eliminara)
    var data = await postPlano('/armascanner/planos-linea/eliminar', p, { con_barras: conBarras });
    if (!data) return;
    global.showToast('Plano eliminado' + (data.barras_eliminadas ? ' · ' + entero(data.barras_eliminadas) + ' barras' : '') + '.', 'success');
    await A.recargarObra(true);
  };

  // Los filtros con botones (pocas opciones, skill armacero-ui), uno encendido: el elemento de los
  // planos de la obra y la revisión de la ventana de barras.
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#ascPlElemento .arm-button');
    if (b) {
      est.plElemento = b.getAttribute('data-el') || '';
      document.querySelectorAll('#ascPlElemento .arm-button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      pintarPlanos();
      return;
    }
    var f = ev.target.closest && ev.target.closest('#ascBarrasFiltro .arm-button');
    if (f && est.verBarras) {
      est.verBarras.filtro = f.getAttribute('data-rev') || '';
      pintarBarras();
    }
  });

  A.porNumero = porNumero;
  A.planoDe = planoDe;
  A.reemplazoDe = reemplazoDe;
  A.pintarPlanos = pintarPlanos;
  A.cerrarBarras = cerrarBarras;
})(window);
