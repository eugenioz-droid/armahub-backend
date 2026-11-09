// ══════ LA HOJA DE BARRAS: UNA SOLA TABLA PARA LAS TRES PANTALLAS (6-nov) ══════
//
// La planilla del auditor (OK / Hallazgo), el Resumen Hallazgos (Resuelto en CC / en
// nuevo CC / No aplica) y la revisión de barras (Resuelto / No aplica) eran tres tablas
// hechas por separado: cada una ponía el nombre de la figura a su manera, se movía al
// abrir un campo y achicaba el dibujo. El usuario: «has implementado cada cosa en forma
// diferente en vez de tener un tipo de formulario estándar que sirva para todo». El
// modelo es la planilla del auditor:
//
//   [marcar] · [acción] · Marca · Notes · φ · Figura · Render · A… · α… · R · Largo · Cant ·
//   Peso · Elemento · [lo propio de la pantalla] · el texto de la línea
//
//   · CADA COLUMNA TIENE SU ANCHO FIJO, la del dibujo según el S/M/L: marcar, abrir un
//     campo o llegar las figuras no mueve la tabla ni achica el dibujo. Lo que sobra va
//     al texto de la línea, que es la única columna que lo necesita.
//   · UNA COLUMNA SIN NINGÚN DATO EN TODA LA TABLA NO SALE: la R en aSa (lo de aSa es el
//     mandril, otra cosa); largo, cantidad y peso en la revisión, cuya señal no los guarda.
//     No se inventa lo que no hay.
//   · LA MARCA Y SU NOTES, CADA UNA EN SU COLUMNA (9-nov): juntas, la Notes se cortaba.
//   · EL ELEMENTO VA SÓLO DONDE LA TABLA JUNTA VARIOS: el Resumen y la revisión agrupan
//     por código. La planilla del auditor es de un elemento y lo dice su cabecera; el
//     usuario: «consume un montón de espacio… basta que esté ahí» (9-nov).
//   · LO QUE NO ES UNA BARRA —el comentario del elemento— va en la misma tabla, con su
//     texto a lo ancho de las columnas de la barra.
//
// Cada pantalla pone lo suyo (los botones, sus columnas, el texto) y engancha sus
// eventos por atributos data-*: la tabla no sabe qué hace cada botón. Las medidas llegan
// en cm, como se ven en toda la plataforma.
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function hay(v) { return v != null && v !== '' && !isNaN(Number(v)) && Number(v) !== 0; }
  // Los cm como en el resto de la plataforma: entero si es entero, si no un decimal con coma.
  function cm(v) {
    if (!hay(v)) return '';
    var r = Math.round(Number(v) * 10) / 10;
    return (Math.abs(r - Math.round(r)) < 0.05 ? String(Math.round(r)) : r.toFixed(1)).replace('.', ',');
  }
  function ent(v) { return hay(v) ? String(Math.round(Math.abs(Number(v)))) : ''; }
  function kg(v) { return hay(v) ? Math.round(Number(v)).toLocaleString('es-CL') : ''; }

  var ANCHO = { check: 26, marca: 96, diam: 40, figura: 60, lado: 46, ang: 40, radio: 40,
                largo: 54, cant: 48, peso: 56, elemento: 130, texto: 240 };

  // El dibujo mide lo del S/M/L elegido; la celda le deja aire para el aviso (⚠, 3D, aSa).
  function anchoRender() {
    var t = global.audFigTam ? global.audFigTam() : 's';
    var m = global._bmTam ? global._bmTam(t) : null;
    return ((m && m.w) || 70) + 40;
  }

  // La Notes mide lo que la más larga de la tabla; si es muy larga, se parte en dos líneas.
  function anchoNotas(n) { return Math.min(150, Math.max(48, Math.round(n * 6.5) + 24)); }

  // Qué columnas de barra lleva la tabla, según lo que traen sus filas.
  function columnas(filas) {
    var letras = {}, c = { nAng: 0, notas: 0, diam: false, radio: false, largo: false, cant: false,
                           peso: false, elemento: false };
    filas.forEach(function (f) {
      if (f.elemento) c.elemento = true;
      var b = f.barra;
      if (!b) return;
      Object.keys(b.lados || {}).forEach(function (L) { if (hay(b.lados[L])) letras[L] = 1; });
      c.nAng = Math.max(c.nAng, (b.angulos || []).length);
      if (b.notas) c.notas = Math.max(c.notas, String(b.notas).length);
      ['diam', 'radio', 'largo', 'cant', 'peso'].forEach(function (k) { if (hay(b[k])) c[k] = true; });
    });
    c.letras = Object.keys(letras).sort();
    return c;
  }

  // La tabla por dentro (colgroup, encabezado y filas) y el ancho mínimo que necesita.
  //   cfg.check   {titulo}            columna de marcar, para las pantallas con lote
  //   cfg.accion  {titulo, ancho, title}
  //   cfg.propias [{titulo, ancho, clase, title}]
  //   cfg.texto   {titulo, title}
  //   cfg.celda   fn(fila, campo, valorHtml, clase) → '<td…>': la celda que se puede
  //               corregir (la usa el auditor para escribir lo que debería decir)
  //   cfg.titulos {lado(L), largo, render}: las ayudas de los encabezados
  //   cfg.filas   [{attrs, check, accion, barra, sinBarra, elemento, elementoTitle,
  //                 propias: [html], texto}]
  //   fila.barra  {marca, marcaAttrs, marcaTitle, notas, diam (mm), figura, render,
  //                renderAttrs, lados {L: cm}, malos {L: 1}, angulos [°], radio (cm),
  //                largo (cm), largoTitle, cant, peso (kg)}
  function partes(cfg) {
    var filas = cfg.filas || [], c = columnas(filas), tit = cfg.titulos || {};
    var anchos = [], th = [];
    function col(w, titulo, clase, title) {
      anchos.push(w);
      th.push('<th' + (clase ? ' class="' + clase + '"' : '') + (title ? ' title="' + esc(title) + '"' : '') +
              '>' + titulo + '</th>');
    }
    if (cfg.check) col(ANCHO.check, cfg.check.titulo || '', 'hojachk');
    col(cfg.accion.ancho, cfg.accion.titulo || '', 'hojaacc', cfg.accion.title);
    col(ANCHO.marca, 'Marca');
    if (c.notas) col(anchoNotas(c.notas), 'Notes', '', 'El nombre que le puso a la marca quien cubicó (Notes en aSa)');
    if (c.diam) col(ANCHO.diam, 'φ', 'hojac');
    col(ANCHO.figura, 'Figura', 'hojac');
    col(anchoRender(), 'Render', '', tit.render);
    c.letras.forEach(function (L) { col(ANCHO.lado, esc(L), 'num g', tit.lado ? tit.lado(L) : ''); });
    for (var k = 0; k < c.nAng; k++) col(ANCHO.ang, 'α' + (k + 1), 'num g');
    if (c.radio) col(ANCHO.radio, 'R', 'num g');
    if (c.largo) col(ANCHO.largo, 'Largo', 'num', tit.largo);
    if (c.cant) col(ANCHO.cant, 'Cant', 'num');
    if (c.peso) col(ANCHO.peso, 'Peso', 'num');
    if (c.elemento) col(ANCHO.elemento, 'Elemento');
    // Las columnas de la barra, para el comentario que las cruza a lo ancho.
    var nBarra = anchos.length - (cfg.check ? 2 : 1) - (c.elemento ? 1 : 0);
    (cfg.propias || []).forEach(function (p) { col(p.ancho, p.titulo, p.clase, p.title); });
    var suma = anchos.reduce(function (s, w) { return s + w; }, 0);
    var html = '<colgroup>' + anchos.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') +
      '<col></colgroup><thead><tr>' + th.join('') +
      '<th class="hojatxt"' + (cfg.texto.title ? ' title="' + esc(cfg.texto.title) + '"' : '') + '>' +
        cfg.texto.titulo + '</th></tr></thead><tbody>' +
      filas.map(function (f) { return fila(f, c, nBarra, cfg); }).join('') + '</tbody>';
    return { html: html, ancho: suma + ANCHO.texto, cols: c };
  }

  function fila(f, c, nBarra, cfg) {
    var b = f.barra;
    var td = (cfg.celda && b)
      ? function (campo, valor, clase) { return cfg.celda(f, campo, valor, clase); }
      : function (campo, valor, clase) { return '<td class="' + clase + '">' + valor + '</td>'; };
    var h = '<tr' + (f.attrs || '') + '>';
    if (cfg.check) h += '<td class="hojachk">' + (f.check || '') + '</td>';
    h += '<td class="hojaacc">' + (f.accion || '') + '</td>';
    if (!b) {
      h += '<td class="hojasin" colspan="' + nBarra + '">' + (f.sinBarra || '') + '</td>';
    } else {
      h += '<td class="hojamarca" title="' + esc(b.marcaTitle || b.marca || '') + '"><span class="audref"' +
             (b.marcaAttrs || '') + '>' + esc(b.marca || '') + '</span></td>';
      if (c.notas) h += '<td class="hojanotas">' + (b.notas ? '<span class="audnotas">' + esc(b.notas) + '</span>' : '') + '</td>';
      if (c.diam) h += td('diam', ent(b.diam), 'hojac');
      h += td('figura', esc(b.figura || ''), 'hojafig hojac');
      h += '<td class="audfigcel"' + (b.renderAttrs || '') + '>' + (b.render || '') + '</td>';
      c.letras.forEach(function (L) {
        h += td('lado:' + L, cm((b.lados || {})[L]), 'num g' + ((b.malos || {})[L] ? ' mal' : ''));
      });
      for (var k = 0; k < c.nAng; k++) h += '<td class="num g">' + ent((b.angulos || [])[k]) + '</td>';
      if (c.radio) h += '<td class="num g">' + cm(b.radio) + '</td>';
      if (c.largo) h += '<td class="num"' + (b.largoTitle ? ' title="' + esc(b.largoTitle) + '"' : '') + '>' +
                        cm(b.largo) + '</td>';
      if (c.cant) h += td('cant', ent(b.cant), 'num');
      if (c.peso) h += '<td class="num">' + kg(b.peso) + '</td>';
    }
    if (c.elemento) {
      h += '<td class="hojael" title="' + esc(f.elementoTitle || f.elemento || '') + '">' + esc(f.elemento || '') + '</td>';
    }
    (cfg.propias || []).forEach(function (p, i) {
      h += '<td' + (p.clase ? ' class="' + p.clase + '"' : '') + '>' + ((f.propias || [])[i] || '') + '</td>';
    });
    return h + '<td class="hojatxt">' + (f.texto || '') + '</td></tr>';
  }

  // La tabla entera, con su caja que scrollea de lado cuando la pantalla no alcanza.
  function tabla(cfg, attrs) {
    var p = partes(cfg);
    return '<div class="hojatbl"><table class="audt hojab' + (cfg.check ? ' conchk' : '') + '"' +
           (attrs || '') + ' style="min-width:' +
           p.ancho + 'px">' + p.html + '</table></div>';
  }

  global.HojaBarras = { partes: partes, tabla: tabla, columnas: columnas, cm: cm, ANCHO: ANCHO };
})(window);
