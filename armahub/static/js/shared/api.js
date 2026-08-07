(function(global) {
  var API = '/api/v1';

  function token() {
    return localStorage.getItem('armahub_token');
  }

  function authHeaders() {
    var currentToken = token();
    return currentToken ? { Authorization: 'Bearer ' + currentToken } : {};
  }

  function logout() {
    localStorage.removeItem('armahub_token');
    window.location.href = '/ui/login';
  }

  // M0.3 — Renovación silenciosa: el token vence a las 8h. Si le quedan menos de
  // 2h, se pide uno fresco en segundo plano (máx. 1 intento cada 10 min) para que
  // la sesión activa nunca se corte a mitad de trabajo.
  var _renovando = false, _ultimaRenovacion = 0;
  function _tokenExp() {
    var t = token();
    if (!t) return null;
    try {
      var p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return p.exp || null;
    } catch (_) { return null; }
  }
  function _renovarSiCorresponde() {
    var exp = _tokenExp();
    if (!exp) return;
    if (exp * 1000 - Date.now() > 2 * 3600 * 1000) return;
    var ahora = Date.now();
    if (_renovando || (ahora - _ultimaRenovacion) < 10 * 60 * 1000) return;
    _renovando = true; _ultimaRenovacion = ahora;
    fetch(API + '/auth/renew', { method: 'POST', headers: authHeaders() })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) { if (d && d.access_token) localStorage.setItem('armahub_token', d.access_token); })
      .catch(function() {})
      .finally(function() { _renovando = false; });
  }
  setInterval(_renovarSiCorresponde, 15 * 60 * 1000);
  setTimeout(_renovarSiCorresponde, 5000);

  async function setHttpErrorStatus(message) {
    if (typeof global.setGlobalStatus === 'function') {
      await global.setGlobalStatus(message, 'err');
    }
  }

  async function requestJson(url, options) {
    var response = await fetch(url, options || {});
    if (response.status === 401) {
      logout();
      return null;
    }

    var data = null;
    try {
      data = await response.json();
    } catch (error) {
      var rawText = '';
      try {
        rawText = await response.text();
      } catch (_) {}
      console.error('JSON parse error:', error, 'url:', url, 'status:', response.status, 'raw:', rawText ? rawText.slice(0, 300) : '(sin body)');
      await setHttpErrorStatus('Error: respuesta inválida');
      return null;
    }

    return { response: response, data: data };
  }

  async function apiGet(url) {
    var result = await requestJson(API + url, { headers: authHeaders(), cache: 'no-store' });
    if (!result) return null;
    if (!result.response.ok) {
      var msg = result.data && (result.data.detail || result.data.error) ? (result.data.detail || result.data.error) : ('HTTP ' + result.response.status);
      console.error('API Error:', msg, result.data);
      await setHttpErrorStatus('Error: ' + msg);
      return null;
    }
    return result.data;
  }

  async function apiPost(url, params) {
    var query = new URLSearchParams(params || {}).toString();
    var result = await requestJson(API + url + '?' + query, {
      method: 'POST',
      headers: authHeaders()
    });
    if (!result) return null;
    return { ok: result.response.ok, data: result.data };
  }

  async function apiPostFile(url, file) {
    var form = new FormData();
    form.append('file', file);
    var result = await requestJson(API + url, {
      method: 'POST',
      headers: authHeaders(),
      body: form
    });
    if (!result) return null;
    return result.data;
  }

  async function apiPostJson(url, body) {
    var headers = authHeaders();
    headers['Content-Type'] = 'application/json';
    var result = await requestJson(API + url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    if (!result) return null;
    return result.data;
  }

  async function apiDelete(url) {
    var result = await requestJson(API + url, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!result) return null;
    return result.data;
  }

  function apiUrl(path) {
    return API + path;
  }

  global.ArmaHubHttp = {
    token: token,
    authHeaders: authHeaders,
    logout: logout,
    apiGet: apiGet,
    apiPost: apiPost,
    apiPostFile: apiPostFile,
    apiPostJson: apiPostJson,
    apiDelete: apiDelete,
    apiUrl: apiUrl
  };

  global.token = token;
  global.authHeaders = authHeaders;
  global.logout = logout;
  global.apiGet = apiGet;
  global.apiPost = apiPost;
  global.apiPostFile = apiPostFile;
  global.apiPostJson = apiPostJson;
  global.apiDelete = apiDelete;
  global.apiUrl = apiUrl;
})(window);