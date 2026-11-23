/* armascanner/index.js — la caluga ArmaScanner (19-nov, SPECS §13).
 *
 * [Usuario 19-nov: «Más que pedidos enviados debiera ver sus obras y ojalá una línea por cada
 * carga de elemento constructivo… Con su cantidad de Items, kilos y lo típico que usamos. La
 * licencia capaz la dejamos acá, aquí buscamos un usuario existente y lo agregamos»]
 * [Usuario 22-nov: «un listado de obras con datos mínimos y KPIs… al hacer clic en una obra se abre
 * un modal»; los planos van dentro de cada obra]
 *
 * Pestañas (templates/tabs/armascanner.html):
 *   Mis obras  GET /armascanner/obras-linea   las obras con sus KPIs (kg, m², kg/m², PPI, Ø prom,
 *              fundaciones) y su tabla por piso; una obra abre su ventana: Planos (GET
 *              /armascanner/planos-linea?obra=: ver PDF —visor.js—, descargar DWG, ver barras, responder
 *              un pedido de reemplazo, enviar pedido, eliminar), Por piso, aSa (GET
 *              /armascanner/obras-linea/asa?obra=), Protocolo y Terreno (por hacer).
 *              «Agregar obra» (GET /armascanner/obras-asa, POST /armascanner/obras-linea/agregar): la obra
 *              se agrega aquí primero y recién ahí ArmaScanner la muestra; Limpiar y Eliminar obra (POST
 *              /armascanner/obras-linea/quitar), del administrador. [Usuario 23-nov]
 *   Instalar   GET /armascanner/mi-licencia  mi licencia y mis equipos
 *   Licencias  GET /armascanner/licencias    (administración) dar, vencer, quitar, liberar equipos
 *   Uso        GET /armascanner/uso          (administración) KPIs y uso por usuario
 *   Desarrollo GET /armascanner/desarrollo   (administración) los planos que el lector no reconoce y los
 *              reportes, con su estado (POST /armascanner/desarrollo/{id}); las oficinas de cálculo con el
 *              lector que lee sus planos (POST /armascanner/oficinas). [Usuario 23-nov]
 *   Versiones  GET /armascanner/versiones    (administración) publicar, retirar, obligatoria
 * Los cambios de licencia usan las rutas de siempre: PUT /admin/users/{id}/licencias/armascanner
 * y POST …/liberar.
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
  function sinTildes(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  // ── KPIs: los de toda la página (Obras, despieces) ──
  //   PPI = Peso Promedio por Ítem = kg / ítems · Ø prom = Σ(φ·kg)/Σkg · kg/m² = kg / m² de losa
  // Vienen calculados del servidor (armascanner.kpis_de); acá sólo se escriben, con el formato de Obras.
  function kpiKg(k) { return k && k.kg ? entero(k.kg) : '—'; }
  function kpiM2(k) { return k && k.m2 ? dec(k.m2, 1) : '—'; }

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
      if (tr) abrirObra(tr.getAttribute('data-obra'));
    });
    document.getElementById('ascObraCerrar').addEventListener('click', cerrarObra);
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
      if (ev.target === this) cerrarObra();
    });
    document.getElementById('ascObraTabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('.arm-tab');
      if (b) elegirSeccion(b.getAttribute('data-sec'));
    });
    document.getElementById('ascPlBuscar').addEventListener('input', function () { est.plBuscar = this.value; pintarPlanos(); });
    document.getElementById('ascBarrasCerrar').addEventListener('click', cerrarBarras);
    document.getElementById('ascBarrasModal').addEventListener('click', function (ev) {
      if (ev.target === this) cerrarBarras();
    });
    // Esc cierra lo de más arriba: las barras y, si no, la obra (el PDF lo cierra visor.js, que va encima)
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !global.isModalOpen || global.isModalOpen('ascVisorModal')) return;
      if (global.isModalOpen('ascBarrasModal')) cerrarBarras();
      else if (global.isModalOpen('ascAgregarModal')) cerrarAgregar();
      else if (global.isModalOpen('ascObraModal')) cerrarObra();
    });
  }

  async function cargarObras() {
    prepararPantalla();
    var d = await global.apiGet('/armascanner/obras-linea');
    est.obras = (d && d.obras) || [];
    est.admin = !!(d && d.admin);
    est.sinRespuesta = !d;
    pintarObras();
    if (est.obra) pintarCabeza();
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
    var o = obraActual();
    if (!o) return;
    var palabra = eliminar ? 'ELIMINAR' : 'LIMPIAR';
    var txt = prompt('⚠ ' + (eliminar ? 'Eliminar' : 'Limpiar') + ' «' + o.nombre + '»\n\n' +
      'Se borran de ArmaHub sus ' + entero(o.planos) + ' planos, con sus archivos y las barras que mandaron a los despieces. ' +
      (eliminar ? 'La obra sale de Mis obras y de ArmaScanner. ' : 'La obra sigue en Mis obras. ') +
      'No se puede deshacer; en aSa no se toca nada.\n\nEscribe ' + palabra + ' para confirmar:');
    if (txt == null) return;
    if (txt.trim().toUpperCase() !== palabra) {
      global.showToast('No se hizo nada: hay que escribir ' + palabra + '.', 'error');
      return;
    }
    var data = await postJson('/armascanner/obras-linea/quitar', { obra: o.id, eliminar: eliminar });
    if (!data) return;
    global.showToast((eliminar ? 'Obra eliminada' : 'Obra limpia') + ' · ' + entero(data.planos) + ' planos' +
      (data.barras_eliminadas ? ' · ' + entero(data.barras_eliminadas) + ' barras' : '') + '.', 'success');
    if (eliminar) {
      est.asaObras = null;  // vuelve a «Agregar»
      cerrarObra();
      await cargarObras();
    } else {
      await recargarObra(true);
    }
  }

  // ── La ventana de la obra ──
  function obraActual() {
    return est.obras.filter(function (o) { return o.id === est.obra; })[0] || null;
  }

  function pintarCabeza() {
    var o = obraActual() || { nombre: est.obra, kpis: {} };
    var k = o.kpis || {};
    poner('ascObraTitulo', o.nombre || est.obra);
    document.getElementById('ascObraLimpiar').style.display = est.admin ? '' : 'none';
    document.getElementById('ascObraEliminar').style.display = est.admin ? '' : 'none';
    poner('ascObraDatos', [o.cliente ? 'Cliente ' + o.cliente : '', o.constructora ? 'Constructora ' + o.constructora : '',
                           o.asa ? 'aSa ' + o.asa : 'Sin código aSa'].filter(Boolean).join(' · '));
    poner('ascObKg', k.kg ? entero(k.kg) + ' kg' : '—');
    poner('ascObM2', kpiM2(k));
    poner('ascObKgM2', dec(k.kg_m2, 1));
    poner('ascObPpi', k.ppi != null ? dec(k.ppi, 1) + ' kg' : '—');
    poner('ascObDiam', k.diam_prom != null ? dec(k.diam_prom, 1) + ' mm' : '—');
    // las fundaciones, aparte (no entran al kg/m²): su KPI sólo si la obra tiene
    document.getElementById('ascObFundKpi').style.display = k.kg_fund ? '' : 'none';
    document.getElementById('ascObKpis').classList.toggle('con-fund', !!k.kg_fund);
    poner('ascObFund', k.kg_fund ? entero(k.kg_fund) + ' kg' : '—');
    pintarPisos(o.por_piso);
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
    pintarPlanos(); pintarAsa();
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
                                 conLista ? cargarObras() : null]);
    if (est.obra !== id) return;  // se cerró, o se abrió otra obra, mientras se pedía
    est.cargandoObra = false;
    est.planos = (res[0] && res[0].planos) || [];
    est.plSinRespuesta = !res[0];
    est.asa = res[1];
    pintarPlanos();
    pintarAsa();
  }

  // ── Planos de la obra (sin bloqueo desde el 21-nov) ──
  // Nadie toma un plano: el cubicador lo sube al terminarlo, y hay una sola versión por plano. Otro
  // cubicador que también lo terminó pide el reemplazo; el autor lo acepta o rechaza (o, si no está,
  // el administrador responde por él). [Usuario 22-nov: «así se coordinan y evitamos duplicar data»]
  async function postPlano(ruta, p, extra) {
    return postJson(ruta, Object.assign({ obra: p.obra, plano: p.plano }, extra || {}));
  }

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
                 ['en_trabajo', 'En trabajo (anterior al cambio)', 'arm-tag arm-tag--warning'],
                 ['cargado', 'Cargado', 'arm-tag'],
                 ['reemplazado', 'Reemplazado', 'arm-tag']];
  function estadoDe(p) {
    if (reemplazoDe(p)) return 'reemplazado';
    return p.etapa === 'terminado' || p.etapa === 'cargado' ? p.etapa : 'en_trabajo';
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
    var total = Number(r.barras) || 0, ok = Number(r.aprobadas) || 0, cons = Number(r.consultas) || 0;
    var tags = (p.reemplazos || []).map(function (x) {
        return x.estado === 'aceptado'
          ? '<span class="arm-tag arm-tag--info">Reemplazo aceptado: espera la versión de ' + esc(x.solicitante) + '</span>'
          : '<span class="arm-tag arm-tag--warning">Reemplazo pedido por ' + esc(x.solicitante) + '</span>';
      }).join('') +
      (cons ? '<span class="arm-tag arm-tag--warning">' + entero(cons) + ' con consulta</span>' : '') +
      (p.relacion ? '<span class="arm-tag arm-tag--info">' + (p.relacion === 'reemplaza' ? 'Reemplaza a ' : 'Complementa a ') +
        esc(revDeTexto(planoDe(p.obra, p.relacion_de), p.relacion_de)) + '</span>' : '') +
      (reemplazoDe(p) ? '<span class="arm-tag">Por ' + esc(revDeTexto(reemplazoDe(p))) + '</span>' : '');
    // el trabajo anterior al cambio, a medias: su avance
    var avance = e[0] === 'en_trabajo' && total
      ? '<div class="asc-linea">' + entero(ok) + ' de ' + entero(total) + ' aprobadas</div>' +
        '<div class="asc-avance"><div style="width:' + Math.round(100 * ok / total) + '%;"></div></div>' : '';
    return '<div class="asc-tags"><span class="' + e[2] + '">' + e[1] + '</span></div>' +
      (tags ? '<div class="asc-tags">' + tags + '</div>' : '') + avance;
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
    var i = est.planos.indexOf(p), r = p.resumen || {}, k = p.kpis;
    var total = Number(r.barras) || 0;
    var pendiente = pendientesDe(p)[0];
    // Con un reemplazo pedido, lo que destaca es responderlo (el autor o el administrador). Con uno
    // aceptado el plano está por cambiar: el pedido espera la versión nueva (puede_enviar viene en false).
    // «Ver PDF» siempre a la vista: sin PDF va apagado (nace al «Terminar» en ArmaScanner)
    var acciones = (p.pdf ? '<button type="button" class="arm-button" onclick="ascVerPlanoDe(' + i + ')">Ver PDF</button>'
      : '<button type="button" class="arm-button" disabled title="Se genera al terminar el plano en ArmaScanner">Ver PDF</button>') +
      '<button type="button" class="arm-button" onclick="ascDescargarDwg(' + i + ', this)">Descargar DWG</button>' +
      (total > 0 ? '<button type="button" class="arm-button" onclick="ascVerBarras(' + i + ')">Ver barras</button>' : '') +
      (pendiente && p.puede_responder
        ? '<button type="button" class="arm-button arm-button--primary" onclick="ascResponderReemplazo(' + i + ', true)">Aceptar reemplazo</button>' +
          '<button type="button" class="arm-button" onclick="ascResponderReemplazo(' + i + ', false)">Rechazar</button>' : '') +
      (p.puede_enviar && total > 0
        ? '<button type="button" class="arm-button arm-button--primary" onclick="ascEnviarPedido(' + i + ')">Enviar pedido</button>' : '') +
      (p.puede_eliminar ? '<button type="button" class="arm-button arm-button--danger" onclick="ascEliminarPlano(' + i + ')">Eliminar</button>' : '');
    return '<tr>' +
      '<td><div class="asc-pl__num">' + esc(p.numero || p.plano) +
        (p.revision ? ' <span class="asc-linea">Rev. ' + esc(p.revision) + '</span>' : '') + '</div>' +
        '<div class="asc-linea asc-pl__tit" title="' + esc(p.titulo || p.plano) + '">' + esc(p.titulo || p.plano) + '</div></td>' +
      '<td>' + (p.elemento ? '<span class="arm-tag">' + esc(p.elemento) + '</span>' : '') + '</td>' +
      '<td>' + celdaEstado(p, r) + '</td>' +
      '<td class="num">' + (k ? entero(k.items) : '—') + '</td>' +
      '<td class="num">' + (k ? kpiKg(k) : '—') + '</td>' +
      '<td class="num">' + (k ? dec(k.ppi, 1) : '—') + '</td>' +
      '<td class="num">' + (k ? kpiM2(k) : '—') + '</td>' +
      '<td>' + esc(quien(p.guardado_por)) + '<div class="asc-linea">' + esc(p.guardado_el) + '</div></td>' +
      '<td>' + celdaPedido(p) + '</td>' +
      '<td class="asc-acciones"><div>' + acciones + '</div></td></tr>';
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

  // ── aSa: por plano, qué parte de sus kilos tiene código en aSa y cuáles son (cruce por sector, piso y
  // ciclo con la descripción del código; armascanner.cruce_asa) ──
  var ESTADO_CC = { Open: 'arm-tag arm-tag--info', Processed: 'arm-tag arm-tag--success', Shipped: 'arm-tag' };

  function filaAsa(x) {
    var p = planoDe(est.obra, x.plano) || { plano: x.plano };
    var plano = '<td><div class="asc-pl__num">' + esc(p.numero || p.plano) + '</div>' +
      '<div class="asc-linea asc-pl__tit" title="' + esc(p.titulo || p.plano) + '">' + esc(p.titulo || p.plano) + '</div></td>';
    if (x.pedido === 'sin_enviar') {
      return '<tr>' + plano + '<td><span class="arm-tag">Sin enviar</span></td><td class="num">—</td><td>—</td><td></td><td></td></tr>';
    }
    var pct = x.pct == null ? null : Math.max(0, Math.min(100, Number(x.pct)));
    var codigos = (x.codigos || []).map(function (c) {
      return '<div class="asc-cc"><b>' + esc(c.cc) + '</b><span>' + esc(c.descr) + '</span><span class="asc-linea">' +
        entero(c.kg) + ' kg</span>' + (c.estado ? '<span class="' + (ESTADO_CC[c.estado] || 'arm-tag') + '">' + esc(c.estado) +
        '</span>' : '') + '</div>';
    }).join('');
    var faltan = (x.faltan || []).map(function (f) { return '<div class="asc-linea">' + esc(f) + '</div>'; }).join('');
    return '<tr>' + plano +
      '<td>' + (x.pedido === 'enviado' ? '<span class="arm-tag arm-tag--success">Enviado</span>'
                                       : '<span class="arm-tag arm-tag--warning">Cambios sin enviar</span>') + '</td>' +
      '<td class="num">' + (x.kg ? entero(x.kg) : '—') + '</td>' +
      '<td>' + (pct == null ? '—' : pct + ' %<div class="asc-avance"><div style="width:' + pct + '%;"></div></div>') + '</td>' +
      '<td>' + (codigos || '—') + '</td><td>' + faltan + '</td></tr>';
  }

  function pintarAsa() {
    var a = est.asa, tabla = document.getElementById('ascAsaTabla'), vacio = document.getElementById('ascAsaVacio');
    var filas = a && a.asa ? (a.planos || []).filter(function (x) {
      var p = planoDe(est.obra, x.plano);
      return !(p && reemplazoDe(p));
    }).sort(function (x, y) { return porNumero(planoDe(est.obra, x.plano) || x, planoDe(est.obra, y.plano) || y); }) : [];
    poner('ascAsaLinea', a && a.asa ? ['aSa ' + a.asa, entero(a.codigos) + (a.codigos === 1 ? ' código' : ' códigos'),
                                      entero(a.kg) + ' kg', a.al ? 'datos al ' + a.al : ''].filter(Boolean).join(' · ') : '');
    document.getElementById('ascAsa').innerHTML = filas.map(filaAsa).join('');
    tabla.style.display = filas.length ? '' : 'none';
    vacio.style.display = filas.length ? 'none' : '';
    vacio.textContent = est.cargandoObra ? 'Cargando…' : !a ? 'No se pudo leer lo de aSa. Recarga la página.'
      : !a.asa ? 'Obra sin código de aSa.' : 'Sin planos terminados.';
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
    global.ascVerPlano(p.obra, p.plano, '', (p.numero || p.plano) + ' — ' + (p.obra_nombre || p.obra));
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
      if (!res.ok) {
        var d = await res.json().catch(function () { return {}; });
        global.showToast((typeof d.detail === 'string' && d.detail) || 'No se pudo descargar el DWG.', 'error');
        return;
      }
      var url = URL.createObjectURL(await res.blob());
      var a = document.createElement('a');
      a.href = url;
      a.download = nombreDescarga(res.headers.get('Content-Disposition')) || (p.plano + '.dwg');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      global.showToast('No se pudo descargar el DWG.', 'error');
    } finally {
      if (boton) { boton.disabled = false; boton.textContent = texto; }
    }
  };

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
    await recargarObra(true);
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
    await recargarObra(true);
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
    await recargarObra(true);
  };

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

  function botonDev(texto, accion) {
    return '<button type="button" class="arm-button" onclick="' + accion + '">' + texto + '</button>';
  }

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

  // ── Instalar ──
  function mb(bytes) { return bytes ? (bytes / 1e6).toFixed(1).replace('.', ',') + ' MB' : ''; }

  async function descargar() {
    var v = await global.apiGet('/armascanner/descarga');  // el enlace vale unos minutos: se pide al apretar
    if (v && v.url) global.location.href = v.url;
  }

  async function cargarInstalar() {
    var b = document.getElementById('ascDescargar');
    if (!b.dataset.listo) { b.addEventListener('click', descargar); b.dataset.listo = '1'; }
    var v = await global.apiGet('/armascanner/descarga');
    b.disabled = !(v && v.version);
    // Un ZIP: se descomprime y se abre ArmaScanner.exe, que se instala solo (instalacion.py).
    document.getElementById('ascDescargaLinea').textContent = v && v.version
      ? 'Versión ' + v.version + ' · ' + mb(v.tamano) + ' · Descomprime y abre ArmaScanner.exe'
      : ['admin', 'admin_calidad'].indexOf(global.currentRole) !== -1
        ? 'Sin versión publicada. Se publica en la pestaña Versiones.' : 'Sin versión publicada.';
    var d = await global.apiGet('/armascanner/mi-licencia');
    if (!d) return;
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

  // ── Licencias (administración) ──
  async function guardarLicencia(userId, activa, vence) {
    var res = await fetch(global.apiUrl('/admin/users/' + userId + '/licencias/armascanner'), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, global.authHeaders()),
      body: JSON.stringify({ activa: activa, vence: activa && vence ? vence : null })
    });
    if (res.status === 401) { global.logout(); return false; }
    var data = await res.json().catch(function () { return {}; });
    if (!data.ok) { global.showToast('No se guardó: ' + (data.detail || 'error'), 'error'); return false; }
    return true;
  }

  function pintarLicencias() {
    var hoy = new Date().toISOString().slice(0, 10);
    var html = est.licencias.map(function (l, i) {
      var vencida = l.activa && l.vence && l.vence < hoy;
      var estado = !l.activa ? '<span class="arm-tag">Retirada</span>'
        : vencida ? '<span class="arm-tag arm-tag--danger">Vencida</span>'
        : '<span class="arm-tag arm-tag--success">Activa</span>';
      var equipos = (l.equipos || []).map(function (e, k) {
        return '<div style="display:flex; align-items:center; gap:6px; margin:2px 0;">' + esc(e.equipo) +
          ' <button class="arm-button" style="min-height:24px; padding:0 8px; font-size:12px;"' +
          ' onclick="ascLiberar(' + i + ',' + k + ')">Liberar</button></div>';
      }).join('') || '<span class="asc-linea">—</span>';
      return '<tr>' +
        '<td><div>' + esc(l.nombre) + '</div><div class="asc-linea">' + esc(l.email) + '</div></td>' +
        '<td>' + estado + '</td>' +
        '<td><input type="date" class="arm-input" value="' + esc(l.vence || '') + '"' + (l.activa ? '' : ' disabled') +
          ' onchange="ascVencimiento(' + i + ', this.value)" style="min-height:30px;"></td>' +
        '<td>' + equipos + '<div class="asc-linea">' + (l.equipos || []).length + ' de ' + (l.max_equipos || 2) + '</div></td>' +
        '<td>' + fecha(l.ultimo_uso) + '</td>' +
        '<td style="text-align:right;">' + (l.activa
          ? '<button class="arm-button arm-button--danger" onclick="ascQuitar(' + i + ')">Quitar</button>'
          : '<button class="arm-button" onclick="ascDarDeNuevo(' + i + ')">Activar</button>') + '</td></tr>';
    }).join('');
    document.getElementById('ascLicencias').innerHTML = html;
    document.getElementById('ascLicenciasVacio').style.display = est.licencias.length ? 'none' : '';
  }

  async function cargarLicencias() {
    if (!est.combo && global.Combobox) {
      est.combo = global.Combobox.crear(document.getElementById('ascUsuarioInput'), {
        items: function () { return est.usuarios || []; },
        getLabel: function (u) { return u.label; },
        getSub: function (u) { return u.sub; },
        onSelect: function (u) { est.usuarioElegido = u; },
        placeholder: 'Buscar usuario'
      });
      document.getElementById('ascAgregar').addEventListener('click', agregar);
    }
    var res = await Promise.all([global.apiGet('/armascanner/licencias'),
                                 est.usuarios ? null : global.apiGet('/admin/users')]);
    est.licencias = (res[0] && res[0].licencias) || [];
    if (res[1] && res[1].users) {
      est.usuarios = res[1].users.filter(function (u) { return u.activo !== false; }).map(function (u) {
        var nombre = ((u.nombre || '') + ' ' + (u.apellido || '')).trim();
        return { id: u.id, label: nombre || u.email, sub: u.email };
      });
    }
    pintarLicencias();
  }

  async function agregar() {
    var u = est.usuarioElegido;
    if (!u) { global.showToast('Elige un usuario de la lista.', 'warning'); return; }
    if (await guardarLicencia(u.id, true, document.getElementById('ascVence').value)) {
      global.showToast('Licencia activa: ' + u.label, 'success');
      est.combo.limpiar();
      est.usuarioElegido = null;
      document.getElementById('ascVence').value = '';
      await cargarLicencias();
    }
  }

  global.ascVencimiento = async function (i, vence) {
    var l = est.licencias[i];
    if (l && await guardarLicencia(l.user_id, true, vence)) await cargarLicencias();
  };
  global.ascQuitar = async function (i) {
    var l = est.licencias[i];
    if (!l || !confirm('¿Quitar la licencia de ' + l.nombre + '? ArmaScanner deja de abrir en sus equipos.')) return;
    if (await guardarLicencia(l.user_id, false, null)) await cargarLicencias();
  };
  global.ascDarDeNuevo = async function (i) {
    var l = est.licencias[i];
    if (l && await guardarLicencia(l.user_id, true, null)) await cargarLicencias();
  };
  global.ascLiberar = async function (i, k) {
    var l = est.licencias[i];
    var e = l && (l.equipos || [])[k];
    if (!e || !confirm('¿Liberar el equipo «' + e.equipo + '»? Su cupo queda libre.')) return;
    var res = await fetch(global.apiUrl('/admin/users/' + l.user_id + '/licencias/armascanner/liberar'), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, global.authHeaders()),
      body: JSON.stringify({ equipo: e.equipo })
    });
    if (res.status === 401) { global.logout(); return; }
    var data = await res.json().catch(function () { return {}; });
    if (!data.ok) { global.showToast('No se liberó: ' + (data.detail || 'error'), 'error'); return; }
    await cargarLicencias();
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

  global.loadArmaScannerModule = function () {};  // cada pestaña carga lo suyo (shell.js, tabLoaders)
  global.ascCargarObras = cargarObras;
  global.ascCargarInstalar = cargarInstalar;
  global.ascCargarLicencias = cargarLicencias;
  global.ascCargarUso = cargarUso;
  global.ascCargarDesarrollo = cargarDesarrollo;
  global.ascCargarVersiones = cargarVersiones;
})(window);
