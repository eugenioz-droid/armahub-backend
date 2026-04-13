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

  if (!window.__armahubReclamosFeatureReady) {
    window.__armahubReclamosFeatureReady = new Promise(function(resolve, reject) {
      window.__armahubResolveReclamosFeatureReady = resolve;
      window.__armahubRejectReclamosFeatureReady = reject;
    });
  }

  function loadScript(selector, src, dataKey, dataValue, errorMessage) {
    return new Promise(function(resolve, reject) {
      var existing = document.querySelector(selector);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve(existing);
          return;
        }
        existing.addEventListener('load', function onLoad() {
          existing.dataset.loaded = 'true';
          resolve(existing);
        }, { once: true });
        existing.addEventListener('error', function onError() {
          reject(new Error(errorMessage));
        }, { once: true });
        return;
      }

      var script = document.createElement('script');
      script.src = src;
      script.dataset[dataKey] = dataValue;
      script.addEventListener('load', function() {
        script.dataset.loaded = 'true';
        resolve(script);
      }, { once: true });
      script.addEventListener('error', function() {
        console.error(errorMessage);
        reject(new Error(errorMessage));
      }, { once: true });
      parentNode.appendChild(script);
    });
  }

  var parentNode = currentScript && currentScript.parentNode ? currentScript.parentNode : (document.body || document.head);
  window.__armahubFeatureScriptsPromise = loadScript(
    'script[data-armahub-runtime="app"]',
    '/static/js/app.js' + suffix,
    'armahubRuntime',
    'app',
    '[ArmaHub] No se pudo cargar el runtime principal app.js'
  ).then(function() {
    return Promise.all([
      loadScript(
        'script[data-armahub-feature="reclamos"]',
        '/static/js/features/reclamos/index.js' + suffix,
        'armahubFeature',
        'reclamos',
        '[ArmaHub] No se pudo cargar el feature activo de Reclamos'
      ),
      loadScript(
        'script[data-armahub-feature="portal"]',
        '/static/js/features/portal/index.js' + suffix,
        'armahubFeature',
        'portal',
        '[ArmaHub] No se pudo cargar el feature Portal'
      )
    ]);
  }).catch(function(error) {
    if (typeof window.__armahubRejectReclamosFeatureReady === 'function') {
      window.__armahubRejectReclamosFeatureReady(error);
      window.__armahubResolveReclamosFeatureReady = null;
      window.__armahubRejectReclamosFeatureReady = null;
    }
    return Promise.reject(error);
  });
})();