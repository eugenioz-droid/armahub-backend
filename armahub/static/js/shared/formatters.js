(function(global) {
  function hasValue(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function normalizeDateText(value) {
    return String(value).replace('T', ' ');
  }

  function formatDateInput(value) {
    if (!hasValue(value)) return '';
    return normalizeDateText(value).substring(0, 10);
  }

  function formatDateShort(value, fallback) {
    if (!hasValue(value)) return fallback !== undefined ? fallback : '';
    return normalizeDateText(value).substring(0, 10);
  }

  function formatDateTime(value, fallback) {
    if (!hasValue(value)) return fallback !== undefined ? fallback : '—';
    return normalizeDateText(value).substring(0, 19);
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