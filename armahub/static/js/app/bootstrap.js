(function bootstrapArmaHubApp() {
  if (window.__armahubBootstrapLoaded) {
    return;
  }
  window.__armahubBootstrapLoaded = true;

  var currentScript = document.currentScript;
  var currentSrc = currentScript && currentScript.src ? currentScript.src : '';
  var suffix = '';
  if (currentSrc) {
    var queryIndex = currentSrc.indexOf('?');
    suffix = queryIndex >= 0 ? currentSrc.substring(queryIndex) : '';
  }

  if (document.querySelector('script[data-armahub-runtime="app"]')) {
    return;
  }

  var runtimeScript = document.createElement('script');
  runtimeScript.src = '/static/js/app.js' + suffix;
  runtimeScript.dataset.armahubRuntime = 'app';
  runtimeScript.onerror = function() {
    console.error('[ArmaHub] No se pudo cargar el runtime principal app.js');
  };

  var parentNode = currentScript && currentScript.parentNode ? currentScript.parentNode : (document.body || document.head);
  parentNode.appendChild(runtimeScript);
})();