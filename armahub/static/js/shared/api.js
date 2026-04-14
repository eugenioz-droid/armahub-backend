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