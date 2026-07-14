(function(global) {
  var CHILE_TZ = 'America/Santiago';

  function hasValue(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function normalizeDateText(value) {
    return String(value).replace('T', ' ');
  }

  // Detecta un valor que es SOLO fecha (YYYY-MM-DD, sin hora). Esas son fechas
  // "puras" ingresadas por el usuario (fecha_deteccion, fecha_analisis) — NO son
  // timestamps UTC, así que NO deben convertirse de zona (convertir restaría un día).
  function _esFechaPura(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
  }

  // Convierte un ISO guardado en UTC a un Date. Los timestamps del backend vienen
  // en 3 formatos (5L.2): con offset '+00:00', con 'Z', o naive sin marcador
  // (defaults SQL). Si no trae marcador de zona, se asume UTC y se le agrega 'Z'
  // para que new Date() no lo interprete como hora local del navegador.
  function _toDateUTC(value) {
    var s = String(value).trim().replace(' ', 'T');
    var tieneZona = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
    if (!tieneZona) s = s + 'Z';
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // Partes de fecha/hora en zona Chile. Devuelve {fecha:'YYYY-MM-DD', hora:'HH:MM:SS'}
  // o null si no parseable. Usa Intl para respetar el horario de verano de Chile.
  function _partesChile(value) {
    var d = _toDateUTC(value);
    if (!d) return null;
    try {
      var fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: CHILE_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
      var p = {};
      fmt.formatToParts(d).forEach(function(x) { p[x.type] = x.value; });
      var hora = p.hour === '24' ? '00' : p.hour; // en-CA a veces emite '24'
      return {
        fecha: p.year + '-' + p.month + '-' + p.day,
        hora: hora + ':' + p.minute + ':' + p.second
      };
    } catch (e) {
      return null; // Intl/zona no disponible → caller cae al texto crudo
    }
  }

  function formatDateInput(value) {
    if (!hasValue(value)) return '';
    if (_esFechaPura(value)) return String(value).trim();
    var p = _partesChile(value);
    return p ? p.fecha : normalizeDateText(value).substring(0, 10);
  }

  function formatDateShort(value, fallback) {
    if (!hasValue(value)) return fallback !== undefined ? fallback : '';
    if (_esFechaPura(value)) return String(value).trim();
    var p = _partesChile(value);
    return p ? p.fecha : normalizeDateText(value).substring(0, 10);
  }

  function formatDateTime(value, fallback) {
    if (!hasValue(value)) return fallback !== undefined ? fallback : '—';
    if (_esFechaPura(value)) return String(value).trim();
    var p = _partesChile(value);
    return p ? (p.fecha + ' ' + p.hora) : normalizeDateText(value).substring(0, 19);
  }

  function formatInteger(value, fallback, locale) {
    if (!hasValue(value) && value !== 0) return fallback !== undefined ? fallback : '0';
    return Math.round(Number(value) || 0).toLocaleString(locale || 'es-CL');
  }

  function formatDecimal(value, decimals, fallback, locale) {
    if (!hasValue(value) && value !== 0) return fallback !== undefined ? fallback : '—';
    return Number(value).toLocaleString(locale || 'es-CL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatKilos(value, decimals, fallback) {
    if (!hasValue(value) && value !== 0) return fallback !== undefined ? fallback : '—';
    var precision = decimals !== undefined ? decimals : 0;
    return formatDecimal(value, precision, fallback !== undefined ? fallback : '0') + ' kg';
  }

  function formatFileSizeKb(bytes, decimals, fallback) {
    if (!hasValue(bytes) && bytes !== 0) return fallback !== undefined ? fallback : '0 KB';
    var precision = decimals !== undefined ? decimals : 1;
    return formatDecimal((Number(bytes) || 0) / 1024, precision, '0') + ' KB';
  }

  global.formatDateInput = formatDateInput;
  global.formatDateShort = formatDateShort;
  global.formatDateTime = formatDateTime;
  global.formatInteger = formatInteger;
  global.formatDecimal = formatDecimal;
  global.formatKilos = formatKilos;
  global.formatFileSizeKb = formatFileSizeKb;
  global.ArmaHubFormatters = {
    formatDateInput: formatDateInput,
    formatDateShort: formatDateShort,
    formatDateTime: formatDateTime,
    formatInteger: formatInteger,
    formatDecimal: formatDecimal,
    formatKilos: formatKilos,
    formatFileSizeKb: formatFileSizeKb
  };
})(window);