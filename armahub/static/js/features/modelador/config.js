// =============================================================================
// CONFIGURACIÓN DEL MODELADOR — CLIENTE (GET/PUT /modelador/config)
// -----------------------------------------------------------------------------
// Fuente única, en el navegador, de los valores con los que NACE una barra nueva:
// figura y φ de partida, @ sep, modo de colocación, figuras sugeridas del buscador
// y recubrimientos por elemento. Lo consumen DOS pantallas distintas:
//   · features/modelador/template_editor.js — los aplica al colocar.
//   · features/catalogo/config_modelador.js — los muestra y los guarda.
//
// REGLA CENTRAL — SIN CONFIG, EL EDITOR SIGUE FUNCIONANDO. Cada getter devuelve
// null cuando no hay config cargada (red caída, primera vez, sin sesión), y el
// llamador cae a SU constante de siempre (SEP_POR_TIPOLOGIA, TIPOLOGIA_MODO_DEFAULT,
// FIGURAS_POR_TIPOLOGIA, TPL_DIMS_POR_ELEMENTO). Por eso los getters NO traen
// defaults propios: un default acá sería una TERCERA tabla que se desincroniza, y
// además taparía que la config no llegó.
//
// LA CONFIG DECIDE CON QUÉ NACEN LAS COSAS NUEVAS, NO REESCRIBE LO GUARDADO. Un
// template ya guardado se abre con SUS valores; nada de acá lo toca.
//
// Se pide UNA vez por sesión de página (promesa memoizada). `invalidar()` la suelta
// para volver a pedirla — lo usa la pantalla de configuración después de guardar,
// para que el editor que se abra a continuación vea lo recién guardado.
// =============================================================================
(function (global) {
  'use strict';

  var _payload = null;    // respuesta completa del GET, o null si nunca llegó
  var _promesa = null;    // vuelo en curso / terminado (memoiza el pedido)
  var _error = null;      // motivo del último fallo (para poder DECIRLO, no tragarlo)

  // fetch/apiUrl/authHeaders se resuelven DENTRO de la función (los scripts cargan
  // en paralelo; capturarlos a nivel de módulo es el bug clásico de este repo).
  function _url() {
    return (typeof global.apiUrl === 'function') ? global.apiUrl('/modelador/config') : '/modelador/config';
  }
  function _headers() {
    return (typeof global.authHeaders === 'function') ? global.authHeaders() : {};
  }

  function _norm(s) { return String(s == null ? '' : s).trim().toUpperCase(); }

  // Clave 'ELEMENTO-TIPOLOGIA'. El apóstrofe de LOSA-F'i es parte del código de la
  // tipología, no ruido: se conserva (sólo se normaliza la caja).
  function _clave(elem, tip) { return _norm(elem) + '-' + _norm(tip); }

  // -------------------------------------------------------------------------
  // CARGA
  // -------------------------------------------------------------------------
  // Resuelve SIEMPRE (nunca rechaza): el llamador no tiene que envolver en try —
  // un fallo deja _payload en null y todos los getters devuelven null, que es
  // exactamente "usa tus constantes".
  function cargar() {
    if (_promesa) return _promesa;
    _promesa = fetch(_url(), { headers: _headers() })
      .then(function (r) {
        if (!r.ok) { _error = 'HTTP ' + r.status; return null; }
        return r.json();
      })
      .then(function (data) {
        if (data && data.config) { _payload = data; _error = null; }
        else if (!_error) { _error = 'respuesta sin configuración'; }
        return _payload;
      })
      .catch(function (e) {
        _error = (e && e.message) ? e.message : 'sin conexión';
        return null;
      });
    return _promesa;
  }

  // Suelta la promesa memoizada. NO borra _payload: si el próximo GET falla, se
  // sigue trabajando con lo último que sí llegó en vez de caer al fallback.
  function invalidar() { _promesa = null; }

  // Para tests y para la pantalla de configuración después de un PUT (la respuesta
  // del PUT ya trae la config completa: no hace falta un GET extra).
  function aplicar(data) {
    if (!data || !data.config) return false;
    _payload = data; _error = null; _promesa = Promise.resolve(_payload);
    return true;
  }

  function datos() { return _payload; }
  function cargada() { return !!_payload; }
  function error() { return _error; }

  // -------------------------------------------------------------------------
  // GETTERS — null = "no hay config, usa tu constante"
  // -------------------------------------------------------------------------
  function _cfg() { return _payload && _payload.config; }

  // Fila completa de una tipología: {figura, diam, sep, modo, figuras}.
  function tipologia(elem, tip) {
    var c = _cfg(); if (!c || !c.tipologias) return null;
    var k = _clave(elem, tip), key;
    if (Object.prototype.hasOwnProperty.call(c.tipologias, k)) return c.tipologias[k];
    // Las claves del backend vienen con la caja del catálogo (VIGA-CBSn, LOSA-F's):
    // se compara normalizado antes de rendirse.
    for (key in c.tipologias) {
      if (!Object.prototype.hasOwnProperty.call(c.tipologias, key)) continue;
      if (_norm(key) === k) return c.tipologias[key];
    }
    return null;
  }

  // @ sep de partida (cm) o null. `0` NO se acepta: una separación 0 no distribuye
  // nada y sería peor que el default.
  function sep(elem, tip) {
    var t = tipologia(elem, tip);
    var n = t ? Number(t.sep) : NaN;
    return (isFinite(n) && n > 0) ? n : null;
  }

  // Modo de colocación ('puntual'|'lineal'|'arreglo') o null.
  function modo(elem, tip) {
    var t = tipologia(elem, tip);
    var m = t && String(t.modo || '').toLowerCase();
    return (m === 'puntual' || m === 'lineal' || m === 'arreglo') ? m : null;
  }

  // Figuras SUGERIDAS del buscador, en el orden configurado. null = sin config;
  // [] es un dato distinto: "esta tipología no tiene sugeridas" (el buscador
  // muestra el catálogo completo, que es lo que ya hacía).
  function figuras(elem, tip) {
    var t = tipologia(elem, tip);
    if (!t || !Array.isArray(t.figuras)) return null;
    return t.figuras.map(_norm);
  }

  // Figura con la que se prellena el ribbon al elegir la tipología, o null si esa
  // tipología no tiene ninguna definida (no se inventa: el campo queda vacío como hoy).
  function figuraDefault(elem, tip) {
    var t = tipologia(elem, tip);
    var f = t && _norm(t.figura);
    return f || null;
  }

  // φ (mm) de partida del ribbon, o null.
  function diamDefault(elem, tip) {
    var t = tipologia(elem, tip);
    var n = t ? Number(t.diam) : NaN;
    return (isFinite(n) && n > 0) ? n : null;
  }

  // Recubrimientos por defecto del elemento: {recub_sup, recub_inf, recub_lat} o
  // {recub}, según lo que ESE elemento defina. null = sin config.
  function recubrimientos(elem) {
    var c = _cfg(); if (!c || !c.recubrimientos) return null;
    var k = _norm(elem);
    return Object.prototype.hasOwnProperty.call(c.recubrimientos, k) ? c.recubrimientos[k] : null;
  }

  // Pata del gancho CONFIGURADA {factor, min, fuente}. OJO: el motor NO la lee
  // todavía (ver `ganchoAplicadoAlMotor`); está para mostrarla y para el día que se
  // aplique. Devolverla no cambia ningún largo por sí sola.
  function ganchoConfigurado() {
    return (_payload && _payload.gancho_activo) || null;
  }
  // El gancho que el motor SÍ usa hoy (figura_puntos.extGancho), tal como lo declara
  // el backend. Sirve para que la pantalla pueda contrastar los dos sin adivinar.
  function ganchoMotor() {
    return (_payload && _payload.gancho_motor) || null;
  }
  function ganchoAplicadoAlMotor() {
    return !!(_payload && _payload.gancho_aplicado_al_motor);
  }

  var API = {
    cargar: cargar,
    invalidar: invalidar,
    aplicar: aplicar,
    datos: datos,
    cargada: cargada,
    error: error,
    tipologia: tipologia,
    sep: sep,
    modo: modo,
    figuras: figuras,
    figuraDefault: figuraDefault,
    diamDefault: diamDefault,
    recubrimientos: recubrimientos,
    ganchoConfigurado: ganchoConfigurado,
    ganchoMotor: ganchoMotor,
    ganchoAplicadoAlMotor: ganchoAplicadoAlMotor
  };

  global.ModeladorConfig = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
