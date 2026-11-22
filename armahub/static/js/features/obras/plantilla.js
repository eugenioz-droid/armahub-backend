/* obras/plantilla.js — la plantilla del Protocolo de cubicación (21-nov, programa §8.13 fila 8.1).
 *
 * Sólo administrador. Secciones → criterios → opciones con su croquis: agregar, editar, quitar
 * y reordenar. Se trabaja sobre una copia en la pantalla; «Guardar» la deja como borrador (las
 * obras no la ven) y «Publicar» la deja vigente.
 *
 *   GET  /protocolo/plantilla             el borrador si hay uno; si no, la vigente
 *   POST /protocolo/plantilla             guarda el borrador {contenido, revision}
 *   POST /protocolo/plantilla/publicar    el borrador pasa a vigente
 *   POST /protocolo/plantilla/descartar   borra el borrador
 *   POST /protocolo/plantilla/inicial     carga inicial (sólo si no hay ninguna plantilla)
 *   POST /protocolo/plantilla/croquis     sube un croquis (multipart: archivo)
 */
(function (global) {
  'use strict';

  var P = global.ObrasPanel, esc = P.esc, el = P.el;
  // cont: la copia en edición. abierto: «sección-criterio» del criterio con el editor abierto.
  var est = { datos: null, cont: null, sucio: false, abierto: '', destino: null, listo: false, ocupado: false };

  var TIPOS = [['opcion', 'Una opción'], ['opciones', 'Varias opciones'], ['si_no', 'Sí / No'], ['numero', 'Número'],
               ['texto', 'Texto'], ['tabla', 'Tabla']];

  function caja() { return el('obrPlantilla'); }
  function copia(x) { return JSON.parse(JSON.stringify(x)); }
  function conOpciones(c) { return c.tipo === 'opcion' || c.tipo === 'opciones'; }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  // ── Dibujo ──
  function mover(que, i, n) {
    return '<button type="button" class="arm-button obr-mini" data-accion="subir-' + que + '"' + (i === 0 ? ' disabled' : '') +
      '>↑ Subir</button><button type="button" class="arm-button obr-mini" data-accion="bajar-' + que + '"' +
      (i === n - 1 ? ' disabled' : '') + '>↓ Bajar</button>';
  }
  function quitar(accion, texto) {   // en rojo sólo la sección entera: con una por línea, la pantalla quedaba roja
    return '<button type="button" class="arm-button obr-mini' + (accion === 'quitar-seccion' ? ' arm-button--danger' : '') +
      '" data-accion="' + accion + '">' + texto + '</button>';
  }
  function campo(rotulo, cuerpo) { return '<div class="obr-campo"><span>' + rotulo + '</span>' + cuerpo + '</div>'; }

  function miniatura(item) {
    return item.croquis_url ? '<img class="obr-miniatura" src="' + esc(item.croquis_url) + '" alt="">'
      : '<span class="obr-miniatura obr-miniatura--vacia">' + (item.croquis ? 'Croquis' : 'Sin croquis') + '</span>';
  }
  function botonesCroquis(item) {
    return '<button type="button" class="arm-button obr-mini" data-accion="croquis">' + (item.croquis ? 'Cambiar croquis' : 'Elegir croquis') +
      '</button>' + (item.croquis ? '<button type="button" class="arm-button obr-mini" data-accion="quitar-croquis">Quitar croquis</button>' : '');
  }

  function editor(c, j) {
    var h = '<div class="obr-editor" data-c="' + j + '">' +
      campo('Texto', '<textarea class="arm-input" rows="2" data-campo="texto">' + esc(c.texto) + '</textarea>') +
      campo('Tipo de respuesta', '<span class="obr-seg">' + TIPOS.map(function (t) {
        return '<button type="button" class="arm-button' + (c.tipo === t[0] ? ' is-on' : '') + '" data-accion="tipo" data-tipo="' + t[0] +
          '">' + t[1] + '</button>';
      }).join('') + '</span>');
    if (c.tipo === 'numero') {
      h += campo('Unidad', '<input type="text" class="arm-input" data-campo="unidad" value="' + esc(c.unidad) + '" style="width:140px;">');
    }
    if (conOpciones(c)) {
      h += campo('Opciones', c.opciones.map(function (o, k) {
        return '<div class="obr-fila" data-lista="opciones" data-o="' + k + '">' + miniatura(o) +
          '<input type="text" class="arm-input" data-campo="item-texto" value="' + esc(o.texto) + '" placeholder="Opción">' +
          botonesCroquis(o) + mover('item', k, c.opciones.length) + quitar('quitar-item', 'Quitar') + '</div>';
      }).join('') + '<div><button type="button" class="arm-button obr-mini" data-accion="agregar-item" data-lista="opciones">Agregar opción</button></div>');
    }
    if (c.tipo === 'tabla') {
      h += campo('Columnas', c.columnas.map(function (k, n) {
        return '<div class="obr-fila" data-lista="columnas" data-o="' + n + '">' +
          '<input type="text" class="arm-input" data-campo="item-titulo" value="' + esc(k.titulo) + '" placeholder="Columna">' +
          '<input type="text" class="arm-input obr-corto" data-campo="item-unidad" value="' + esc(k.unidad) + '" placeholder="Unidad">' +
          mover('item', n, c.columnas.length) + quitar('quitar-item', 'Quitar') + '</div>';
      }).join('') + '<div><button type="button" class="arm-button obr-mini" data-accion="agregar-item" data-lista="columnas">Agregar columna</button></div>') +
      campo('Filas fijas', c.filas.map(function (f, n) {
        return '<div class="obr-fila" data-lista="filas" data-o="' + n + '">' +
          '<input type="text" class="arm-input" data-campo="item-fila" value="' + esc(f) + '" placeholder="Fila">' +
          mover('item', n, c.filas.length) + quitar('quitar-item', 'Quitar') + '</div>';
      }).join('') + '<div><button type="button" class="arm-button obr-mini" data-accion="agregar-item" data-lista="filas">Agregar fila fija</button></div>');
    }
    return h + campo('Ayuda', '<input type="text" class="arm-input" data-campo="ayuda" value="' + esc(c.ayuda) + '" style="max-width:760px;">') +
      campo('Croquis del criterio', '<div class="obr-fila" data-lista="criterio">' + miniatura(c) + botonesCroquis(c) + '</div>') + '</div>';
  }

  function resumen(c) {
    var nombre = TIPOS.filter(function (t) { return t[0] === c.tipo; })[0];
    return (nombre ? nombre[1] : c.tipo) +
      (conOpciones(c) ? ' · ' + plural(c.opciones.length, 'opción', 'opciones') : '') +
      (c.tipo === 'tabla' ? ' · ' + plural(c.columnas.length, 'columna', 'columnas') : '') +
      (c.tipo === 'numero' && c.unidad ? ' · ' + c.unidad : '');
  }

  function fila(c, i, j, n) {
    var abierto = est.abierto === i + '-' + j;
    return '<div class="obr-pl-criterio" data-c="' + j + '">' +
      '<span class="obr-n">' + (j + 1) + '</span>' +
      '<span class="obr-pl-criterio__texto' + (c.texto ? '' : ' is-vacio') + '">' + esc(c.texto || 'Sin texto') + '</span>' +
      '<span class="arm-tag obr-tag-neutra">' + esc(resumen(c)) + '</span>' +
      '<button type="button" class="arm-button obr-mini' + (abierto ? ' is-on' : '') + '" data-accion="editar">' +
        (abierto ? 'Cerrar' : 'Editar') + '</button>' +
      mover('criterio', j, n) + quitar('quitar-criterio', 'Quitar') + '</div>' + (abierto ? editor(c, j) : '');
  }

  function seccion(s, i) {
    var n = est.cont.secciones.length;
    return '<div class="arm-card" data-s="' + i + '">' +
      '<div class="obr-barra" style="padding-bottom:8px;">' +
        '<input type="text" class="arm-input obr-pl-titulo" data-campo="titulo" value="' + esc(s.titulo) +
          '" placeholder="Título de la sección" aria-label="Título de la sección">' +
        '<span class="obr-linea">' + plural(s.criterios.length, 'criterio', 'criterios') + '</span>' +
        '<span class="obr-derecha">' + mover('seccion', i, n) + quitar('quitar-seccion', 'Quitar sección') + '</span>' +
      '</div>' +
      s.criterios.map(function (c, j) { return fila(c, i, j, s.criterios.length); }).join('') +
      '<div style="padding-top:8px; border-top:1px solid var(--arm-border);">' +
        '<button type="button" class="arm-button obr-mini" data-accion="agregar-criterio">Agregar criterio</button></div></div>';
  }

  function botones() {
    var p = est.datos.plantilla, borrador = !!p && p.estado === 'borrador';
    return (est.sucio ? '<span class="arm-tag arm-tag--warning">Sin guardar</span>' : '') +
      (borrador ? '<button type="button" class="arm-button arm-button--danger" data-accion="descartar">Descartar borrador</button>' : '') +
      '<button type="button" class="arm-button' + (est.sucio ? ' arm-button--primary' : '') + '" data-accion="guardar"' +
        (est.sucio ? '' : ' disabled') + '>Guardar</button>' +
      '<button type="button" class="arm-button' + (borrador && !est.sucio ? ' arm-button--primary' : '') + '" data-accion="publicar"' +
        (borrador || est.sucio ? '' : ' disabled') + '>Publicar</button>';
  }

  function barra() {
    var d = est.datos, p = d.plantilla, borrador = !p || p.estado === 'borrador';
    var linea = borrador
      ? (d.vigente ? 'Vigente: v' + d.vigente : 'Sin publicar') + (p && p.guardada ? ' · Guardada ' + p.guardada : '')
      : 'Publicada ' + p.publicada;
    return '<div class="arm-card obr-acciones">' +
      '<span class="obr-grupo">' + (borrador ? '<span class="arm-tag arm-tag--warning">Borrador</span>'
                                             : '<span class="arm-tag arm-tag--success">Vigente</span>') +
        (p ? '<strong>v' + esc(p.version) + '</strong>' : '') + '<span class="obr-linea">' + esc(linea) + '</span></span>' +
      '<span class="obr-grupo"><span class="obr-rotulo">Nombre</span><input type="text" class="arm-input" data-campo="nombre" value="' +
        esc(est.cont.nombre || '') + '" aria-label="Nombre de la plantilla" style="width:220px;"></span>' +
      '<span class="obr-derecha" id="obrPlBotones">' + botones() + '</span></div>';
  }

  function pintar() {
    var d = est.datos, c = caja();
    if (!d) { c.innerHTML = '<div class="arm-card obr-vacio">No se pudo leer la plantilla. Recarga la página.</div>'; return; }
    if (!est.cont) {
      c.innerHTML = '<div class="arm-card obr-vacio">Sin plantilla.<div>' +
        (d.hay_inicial ? '<button type="button" class="arm-button arm-button--primary" data-accion="cargar-inicial">Cargar plantilla inicial</button>' : '') +
        '<button type="button" class="arm-button" data-accion="crear-plantilla">Crear plantilla</button></div></div>';
      return;
    }
    c.innerHTML = barra() + est.cont.secciones.map(seccion).join('') +
      '<div><button type="button" class="arm-button" data-accion="agregar-seccion">Agregar sección</button></div>';
  }

  function marcar() {
    est.sucio = true;
    var b = el('obrPlBotones');
    if (b) b.innerHTML = botones();
  }

  // ── Acciones ──
  function recibir(d) {
    est.datos = d;
    est.cont = d && d.plantilla ? copia(d.plantilla.contenido) : null;
    est.sucio = false;
    pintar();
  }

  async function cargar() {
    unaVez();
    if (est.sucio) return;   // volver a la pestaña no pisa lo que se está editando
    est.abierto = '';
    recibir(await global.apiGet('/protocolo/plantilla'));
  }

  async function guardar() {
    if (!est.sucio) return true;
    if (est.ocupado) return false;
    est.ocupado = true;
    var p = est.datos.plantilla;
    var d = await P.enviar('/protocolo/plantilla', { contenido: est.cont, revision: p && p.estado === 'borrador' ? p.revision : null });
    est.ocupado = false;
    if (!d) return false;
    recibir(d);
    global.showToast('Plantilla guardada.', 'success');
    return true;
  }

  async function publicar() {
    if (!(await guardar())) return;
    var p = est.datos.plantilla;
    if (!p || p.estado !== 'borrador') return;
    if (!confirm('¿Publicar la plantilla v' + p.version + '?\n\nLos protocolos nuevos nacen con esta versión. Los existentes ' +
                 'conservan la suya.')) return;
    var d = await P.enviar('/protocolo/plantilla/publicar');
    if (!d) return;
    recibir(d);
    global.showToast('Plantilla v' + d.plantilla.version + ' publicada.', 'success');
  }

  async function descartar() {
    var p = est.datos.plantilla;
    if (!confirm('¿Descartar el borrador v' + p.version + '?\n\nSe pierden los cambios sin publicar.')) return;
    var d = await P.enviar('/protocolo/plantilla/descartar');
    if (!d) return;
    est.abierto = '';
    recibir(d);
  }

  async function cargarInicial(boton) {
    boton.disabled = true;
    boton.textContent = 'Cargando…';
    var d = await P.enviar('/protocolo/plantilla/inicial');
    if (!d) { boton.disabled = false; boton.textContent = 'Cargar plantilla inicial'; return; }
    recibir(d);
    global.showToast('Plantilla v1 cargada.', 'success');
  }

  async function subirCroquis(archivo) {
    var t = est.destino;
    est.destino = null;
    if (!archivo || !t) return;
    var form = new FormData();
    form.append('archivo', archivo);
    var d = await P.enviar('/protocolo/plantilla/croquis', form, true);
    if (!d) return;
    t.croquis = d.croquis;
    t.croquis_url = d.croquis_url;
    marcar();
    pintar();
  }

  function cambiarDeLugar(lista, i, paso) {
    var otro = i + paso;
    if (otro < 0 || otro >= lista.length) return false;
    var x = lista[i];
    lista[i] = lista[otro];
    lista[otro] = x;
    return true;
  }

  function alClic(ev) {
    var b = ev.target.closest('[data-accion]');
    if (!b || b.disabled) return;
    var a = b.getAttribute('data-accion');
    if (a === 'cargar-inicial') { cargarInicial(b); return; }
    if (a === 'crear-plantilla') {
      est.cont = { nombre: '', secciones: [{ titulo: '', criterios: [] }] };
      marcar(); pintar(); return;
    }
    if (a === 'guardar') { guardar(); return; }
    if (a === 'publicar') { publicar(); return; }
    if (a === 'descartar') { descartar(); return; }

    var S = est.cont.secciones;
    var ns = b.closest('[data-s]'), nc = b.closest('[data-c]'), nl = b.closest('[data-lista]');
    var i = ns ? Number(ns.getAttribute('data-s')) : -1, j = nc ? Number(nc.getAttribute('data-c')) : -1;
    var s = S[i], c = s && s.criterios[j];
    var nombreLista = nl ? nl.getAttribute('data-lista') : '', k = nl ? Number(nl.getAttribute('data-o')) : -1;
    var paso = a.indexOf('subir-') === 0 ? -1 : 1;

    if (a === 'agregar-seccion') S.push({ titulo: '', criterios: [] });
    else if (a === 'quitar-seccion') {
      if (s.criterios.length && !confirm('¿Quitar la sección «' + (s.titulo || 'sin título') + '» y sus ' +
                                         plural(s.criterios.length, 'criterio', 'criterios') + '?')) return;
      S.splice(i, 1); est.abierto = '';
    }
    else if (a === 'subir-seccion' || a === 'bajar-seccion') { cambiarDeLugar(S, i, paso); est.abierto = ''; }
    else if (a === 'agregar-criterio') {
      s.criterios.push({ clave: '', texto: '', tipo: 'texto', unidad: '', ayuda: '', croquis: '', croquis_url: '',
                         opciones: [], columnas: [], filas: [] });
      est.abierto = i + '-' + (s.criterios.length - 1);
    }
    else if (a === 'quitar-criterio') {
      if (c.texto && !confirm('¿Quitar el criterio «' + c.texto.slice(0, 80) + '»?')) return;
      s.criterios.splice(j, 1); est.abierto = '';
    }
    else if (a === 'subir-criterio' || a === 'bajar-criterio') {
      var eraAbierto = est.abierto === i + '-' + j;
      cambiarDeLugar(s.criterios, j, paso);
      est.abierto = eraAbierto ? i + '-' + (j + paso) : '';
    }
    else if (a === 'editar') { est.abierto = est.abierto === i + '-' + j ? '' : i + '-' + j; pintar(); return; }
    else if (a === 'tipo') {
      c.tipo = b.getAttribute('data-tipo');
      while (conOpciones(c) && c.opciones.length < 2) c.opciones.push({ id: '', texto: '', croquis: '', croquis_url: '' });
      if (c.tipo === 'tabla' && !c.columnas.length) c.columnas.push({ id: '', titulo: '', unidad: '' });
    }
    else if (a === 'agregar-item') {
      var lista = b.getAttribute('data-lista');
      c[lista].push(lista === 'opciones' ? { id: '', texto: '', croquis: '', croquis_url: '' }
        : lista === 'columnas' ? { id: '', titulo: '', unidad: '' } : '');
    }
    else if (a === 'quitar-item') c[nombreLista].splice(k, 1);
    else if (a === 'subir-item' || a === 'bajar-item') cambiarDeLugar(c[nombreLista], k, paso);
    else if (a === 'croquis') {
      est.destino = nombreLista === 'criterio' ? c : c.opciones[k];
      el('obrCroquisArchivo').click();
      return;
    }
    else if (a === 'quitar-croquis') {
      var item = nombreLista === 'criterio' ? c : c.opciones[k];
      item.croquis = ''; item.croquis_url = '';
    }
    else return;
    marcar();
    pintar();
  }

  function alEscribir(ev) {
    var campoDe = ev.target.getAttribute && ev.target.getAttribute('data-campo');
    if (!campoDe || !est.cont) return;
    var v = ev.target.value;
    if (campoDe === 'nombre') { est.cont.nombre = v; marcar(); return; }
    var ns = ev.target.closest('[data-s]'), nc = ev.target.closest('[data-c]'), nl = ev.target.closest('[data-lista]');
    var s = est.cont.secciones[Number(ns.getAttribute('data-s'))];
    var c = nc ? s.criterios[Number(nc.getAttribute('data-c'))] : null;
    var k = nl ? Number(nl.getAttribute('data-o')) : -1;
    if (campoDe === 'titulo') s.titulo = v;
    else if (campoDe === 'item-texto') c.opciones[k].texto = v;
    else if (campoDe === 'item-titulo') c.columnas[k].titulo = v;
    else if (campoDe === 'item-unidad') c.columnas[k].unidad = v;
    else if (campoDe === 'item-fila') c.filas[k] = v;
    else c[campoDe] = v;   // texto, unidad, ayuda
    if (campoDe === 'texto') {   // la línea del criterio sigue a lo que se escribe
      var linea = nc.previousElementSibling && nc.previousElementSibling.querySelector('.obr-pl-criterio__texto');
      if (linea) { linea.textContent = v || 'Sin texto'; linea.classList.toggle('is-vacio', !v); }
    }
    marcar();
  }

  function unaVez() {
    if (est.listo) return;
    est.listo = true;
    caja().addEventListener('click', alClic);
    caja().addEventListener('input', alEscribir);
    el('obrCroquisArchivo').addEventListener('change', function () {
      var archivo = this.files[0];
      this.value = '';
      subirCroquis(archivo);
    });
    global.addEventListener('beforeunload', function (ev) {
      if (est.sucio) { ev.preventDefault(); ev.returnValue = ''; }
    });
  }

  P.plantilla = { cargar: cargar };
  global.obrCargarPlantilla = cargar;
})(window);
