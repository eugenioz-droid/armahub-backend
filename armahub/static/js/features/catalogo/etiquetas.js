// ArmaHub — Diseñador de figuras: REGISTRO DE TIPOS DE ETIQUETA (5M.8)
// Centraliza TODO lo específico de cada tipo de etiqueta manual (cota, radio,
// diámetro, cota de arco, letra, ángulo) en UN solo lugar. Antes esto estaba
// esparcido en ~15 cadenas `if (tipo === 'cota' || 'radio' || ...)` por todo el
// editor (render lienzo, render preview, guardar, cargar, arrastrar, click), y
// cada tipo nuevo obligaba a tocar todos esos sitios. Con el registro, agregar
// un tipo = una entrada aquí. Lo consumen el editor 2D, el motor de render
// (svgDesdePuntos) y —al homologar— el editor 3D.
//
// FORMAS DE DATO de una etiqueta (campo `tipo`):
//   - LÍNEA  (cota/radio/diametro): { tipo, x1,y1, x2,y2 }  → 2 clicks.
//   - ARCO   (arco):                { tipo, seg, lado }     → 1 click sobre curva.
//                                     (enganchada a un segmento; lado ±1 = guata)
//   - TEXTO  (letra/angulo):        { tipo, texto, x, y }   → 1 click; es PARÁMETRO.
//
// Las coords x/y (y x1/y1/x2/y2) viven en PÍXELES DEL LIENZO mientras se edita.
// Al guardar se normalizan al 1er punto (Y hacia arriba); al cargar se revierten.

(function(global) {

  // Colores por tipo (compartidos entre lienzo y render).
  var COLORES = {
    cota: '#888', arco: '#888',
    radio: '#1565c0', diametro: '#1565c0',
    letra: '#00695c', angulo: '#c62828'
  };

  // Registro. Cada entrada declara la naturaleza del tipo; las funciones de dibujo
  // viven en render.js / disenador.js y consultan estas banderas.
  var TIPOS = {
    cota:     { forma: 'linea', arrastrable: true,  parametro: null,     clicks: 2, color: '#888'    },
    radio:    { forma: 'linea', arrastrable: true,  parametro: null,     clicks: 2, color: '#1565c0' },
    diametro: { forma: 'linea', arrastrable: true,  parametro: null,     clicks: 2, color: '#1565c0' },
    arco:     { forma: 'arco',  arrastrable: false, parametro: null,     clicks: 1, color: '#888'    },
    letra:    { forma: 'texto', arrastrable: true,  parametro: 'parcial', clicks: 1, color: '#00695c' },
    angulo:   { forma: 'texto', arrastrable: true,  parametro: 'angulo',  clicks: 1, color: '#c62828' }
  };

  function _def(tipo) { return TIPOS[tipo] || null; }

  // ---- Consultas de naturaleza (reemplazan las cadenas if tipo===) ----
  function esLinea(tipo)  { var d = _def(tipo); return !!d && d.forma === 'linea'; }
  function esArco(tipo)   { var d = _def(tipo); return !!d && d.forma === 'arco'; }
  function esTexto(tipo)  { var d = _def(tipo); return !!d && d.forma === 'texto'; }
  function esArrastrable(tipo) { var d = _def(tipo); return !!d && d.arrastrable; }
  function esParametro(tipo)   { var d = _def(tipo); return !!d && !!d.parametro; }
  function clicks(tipo)   { var d = _def(tipo); return d ? d.clicks : 1; }
  function color(tipo)    { var d = _def(tipo); return d ? d.color : '#333'; }

  // ---- Normalización para GUARDAR (coords lienzo → relativas a p0, Y arriba) ----
  // Devuelve el objeto que se persiste en geometria.etiquetas.
  function normalizar(e, p0) {
    if (esArco(e.tipo)) return { tipo: 'arco', seg: e.seg, lado: e.lado || 1 };
    if (esLinea(e.tipo)) return { tipo: e.tipo, x1: e.x1 - p0.x, y1: -(e.y1 - p0.y), x2: e.x2 - p0.x, y2: -(e.y2 - p0.y) };
    return { tipo: e.tipo, texto: e.texto, x: e.x - p0.x, y: -(e.y - p0.y) };   // texto
  }

  // ---- Desnormalización para CARGAR (persistido → coords lienzo con offsets) ----
  function desnormalizar(e, offX, offY) {
    if (esArco(e.tipo)) return { tipo: 'arco', seg: e.seg, lado: e.lado || 1 };
    if (esLinea(e.tipo)) return { tipo: e.tipo, x1: Math.round(e.x1) + offX, y1: offY - Math.round(e.y1), x2: Math.round(e.x2) + offX, y2: offY - Math.round(e.y2) };
    return { tipo: e.tipo, texto: e.texto, x: Math.round(e.x) + offX, y: offY - Math.round(e.y) };
  }

  // ---- Parámetros REALES derivados de las etiquetas manuales (modo etiqueta-manda) ----
  // parciales = etiquetas de letra (menos 'R'); angulos = etiquetas de ángulo.
  function parametros(etiquetas) {
    var parciales = [], angulos = [];
    (etiquetas || []).forEach(function(e) {
      var d = _def(e.tipo);
      if (!d || !d.parametro) return;
      if (d.parametro === 'parcial' && e.texto && e.texto !== 'R') parciales.push(String(e.texto));
      else if (d.parametro === 'angulo' && e.texto) angulos.push(String(e.texto));
    });
    return { parciales: parciales, angulos: angulos };
  }

  // ¿La figura debe considerarse "etiqueta-manda"? (hay al menos una etiqueta de
  // parámetro → al renderizarla no se dibujan letras/ángulos automáticos).
  function tieneParametros(etiquetas) {
    return (etiquetas || []).some(function(e) { return esParametro(e.tipo); });
  }

  function _escTxt(t) { return String(t == null ? '' : t).replace(/[<>&]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; }); }

  // ---- Funciones de DIBUJO por forma (un solo lugar; antes estaban duplicadas
  // inline en el lienzo 2D y en el render svgDesdePuntos). Reciben los puntos YA
  // resueltos en el espacio de destino y devuelven string SVG.
  // opt: { sw: ancho línea, tope: px del tope de cota, interactivo: bool, idx: k }.

  // Cota: línea gris con topes perpendiculares. p1/p2 = extremos.
  function dibujarCota(p1, p2, opt) {
    opt = opt || {}; var sw = opt.sw || 1.5, tope = opt.tope || 5;
    var dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.sqrt(dx*dx + dy*dy) || 1;
    var nx = -dy/len*tope, ny = dx/len*tope;
    var ia = opt.interactivo ? (' data-etiq="' + opt.idx + '" style="cursor:move;"') : '';
    return '<line x1="'+p1.x+'" y1="'+p1.y+'" x2="'+p2.x+'" y2="'+p2.y+'" stroke="#888" stroke-width="'+sw+'"'+ia+'/>' +
      '<line x1="'+(p1.x+nx)+'" y1="'+(p1.y+ny)+'" x2="'+(p1.x-nx)+'" y2="'+(p1.y-ny)+'" stroke="#888" stroke-width="'+sw+'"/>' +
      '<line x1="'+(p2.x+nx)+'" y1="'+(p2.y+ny)+'" x2="'+(p2.x-nx)+'" y2="'+(p2.y-ny)+'" stroke="#888" stroke-width="'+sw+'"/>';
  }
  // Radio (flecha →) / Diámetro (flecha ↔). Requiere markers disArrowStart/End en el SVG.
  function dibujarRadioDiam(tipo, p1, p2, opt) {
    opt = opt || {}; var sw = opt.sw || 1.5;
    var mk = tipo === 'diametro' ? ' marker-start="url(#disArrowStart)" marker-end="url(#disArrowEnd)"' : ' marker-end="url(#disArrowEnd)"';
    var ia = opt.interactivo ? (' data-etiq="' + opt.idx + '" style="cursor:move;"') : '';
    return '<line x1="'+p1.x+'" y1="'+p1.y+'" x2="'+p2.x+'" y2="'+p2.y+'" stroke="#1565c0" stroke-width="'+sw+'"'+ia+mk+'/>';
  }
  // Cota de arco: arco circular CONCÉNTRICO al de la barra, desplazado hacia afuera
  // `off` px. Sigue exactamente la misma curvatura y sentido que la curva real
  // (por eso queda paralela y pareja, no una Q genérica). a/b = extremos del
  // segmento; radioBarra = radio del arco de la barra (px); sweep 0/1 = sentido;
  // lado ±1 = guata (invierte hacia qué lado sale la cota).
  function dibujarArco(a, b, radioBarra, sweep, lado, off, opt) {
    opt = opt || {}; var w = opt.sw || 1.5, dash = opt.dash || '4,3';
    var ia = opt.interactivo ? (' data-etiq="' + opt.idx + '" style="cursor:pointer;"') : '';
    var dx = b.x - a.x, dy = b.y - a.y, cuerda = Math.sqrt(dx*dx + dy*dy) || 1;
    // Radio efectivo del arco de la barra (misma regla que _pathDesdePuntos).
    var r = Math.max(radioBarra || cuerda * 0.75, cuerda / 2 + 0.5);
    var sw = (sweep != null ? sweep : 1) ? 1 : 0;   // flag de barrido SVG (0/1)
    // Centro del arco de la barra: a un lado de la cuerda según sweep.
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var h = Math.sqrt(Math.max(0, r*r - (cuerda/2)*(cuerda/2)));
    var ux = dx/cuerda, uy = dy/cuerda;             // dir cuerda
    var nx = -uy, ny = ux;                          // normal a la cuerda
    // El flag sweep=1 (SVG) curva hacia un lado; el centro está al lado opuesto.
    var s = sw ? -1 : 1;
    var cx = mx + nx*h*s, cy = my + ny*h*s;         // centro del arco
    // Cota concéntrica: mismo centro, radio = r + off (o r - off para la otra guata).
    var lg = (lado || 1) >= 0 ? 1 : -1;
    var rc = r + off * lg;
    if (rc < 1) rc = 1;
    // Puntos de la cota sobre el círculo concéntrico (misma dirección desde el centro).
    var a0 = Math.atan2(a.y - cy, a.x - cx), a1 = Math.atan2(b.y - cy, b.x - cx);
    var pax = cx + rc*Math.cos(a0), pay = cy + rc*Math.sin(a0);
    var pbx = cx + rc*Math.cos(a1), pby = cy + rc*Math.sin(a1);
    return '<path d="M'+pax.toFixed(1)+','+pay.toFixed(1)+' A '+rc.toFixed(1)+' '+rc.toFixed(1)+' 0 0 '+sw+' '+pbx.toFixed(1)+','+pby.toFixed(1)+'" fill="none" stroke="#888" stroke-width="'+w+'" stroke-dasharray="'+dash+'"'+ia+'/>';
  }
  // Texto (letra/ángulo): halo blanco + color del tipo. p = posición.
  function dibujarTexto(tipo, texto, p, opt) {
    opt = opt || {}; var fs = opt.fs || 13, halo = opt.halo || 3, dy = opt.dy || 4;
    var col = color(tipo), t = _escTxt(texto);
    var ia = opt.interactivo ? (' data-etiq="' + opt.idx + '" style="cursor:move;"') : '';
    return '<text x="'+p.x+'" y="'+(p.y+dy)+'" text-anchor="middle" fill="#fff" stroke="#fff" stroke-width="'+halo+'" font-size="'+fs+'" font-weight="800"'+ia+'>'+t+'</text>' +
      '<text x="'+p.x+'" y="'+(p.y+dy)+'" text-anchor="middle" fill="'+col+'" font-size="'+fs+'" font-weight="800"'+ia+'>'+t+'</text>';
  }
  global.EtiquetasRegistro = {
    TIPOS: TIPOS, COLORES: COLORES,
    esLinea: esLinea, esArco: esArco, esTexto: esTexto,
    esArrastrable: esArrastrable, esParametro: esParametro,
    clicks: clicks, color: color,
    normalizar: normalizar, desnormalizar: desnormalizar,
    parametros: parametros, tieneParametros: tieneParametros,
    dibujarCota: dibujarCota, dibujarRadioDiam: dibujarRadioDiam,
    dibujarArco: dibujarArco, dibujarTexto: dibujarTexto
  };
})(window);
