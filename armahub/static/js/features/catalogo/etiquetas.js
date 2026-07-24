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

  global.EtiquetasRegistro = {
    TIPOS: TIPOS, COLORES: COLORES,
    esLinea: esLinea, esArco: esArco, esTexto: esTexto,
    esArrastrable: esArrastrable, esParametro: esParametro,
    clicks: clicks, color: color,
    normalizar: normalizar, desnormalizar: desnormalizar,
    parametros: parametros, tieneParametros: tieneParametros
  };
})(window);
