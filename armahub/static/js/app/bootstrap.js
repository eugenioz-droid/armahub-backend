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
    'script[data-armahub-compat="legacy"]',
    '/static/js/legacy/compat.js' + suffix,
    'armahubCompat',
    'legacy',
    '[ArmaHub] No se pudo cargar legacy/compat.js'
  ).then(function() {
    return loadScript(
      'script[data-armahub-runtime="app"]',
      '/static/js/app.js' + suffix,
      'armahubRuntime',
      'app',
      '[ArmaHub] No se pudo cargar el runtime principal app.js'
    );
  }).then(function() {
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
      ),
      // Cubicación submodules (E.4) — all loaded in parallel, globals available before module activation
      loadScript(
        'script[data-armahub-feature="cubicacion-helpers"]',
        '/static/js/features/cubicacion/helpers.js' + suffix,
        'armahubFeature',
        'cubicacion-helpers',
        '[ArmaHub] No se pudo cargar cubicacion/helpers.js'
      ),
      loadScript(
        'script[data-armahub-feature="cubicacion-obras"]',
        '/static/js/features/cubicacion/obras.js' + suffix,
        'armahubFeature',
        'cubicacion-obras',
        '[ArmaHub] No se pudo cargar cubicacion/obras.js'
      ),
      loadScript(
        'script[data-armahub-feature="cubicacion-filtros"]',
        '/static/js/features/cubicacion/filtros.js' + suffix,
        'armahubFeature',
        'cubicacion-filtros',
        '[ArmaHub] No se pudo cargar cubicacion/filtros.js'
      ),
      loadScript(
        'script[data-armahub-feature="cubicacion-import"]',
        '/static/js/features/cubicacion/import.js' + suffix,
        'armahubFeature',
        'cubicacion-import',
        '[ArmaHub] No se pudo cargar cubicacion/import.js'
      ),
      loadScript(
        'script[data-armahub-feature="cubicacion-barmanager"]',
        '/static/js/features/cubicacion/barmanager.js' + suffix,
        'armahubFeature',
        'cubicacion-barmanager',
        '[ArmaHub] No se pudo cargar cubicacion/barmanager.js'
      ),
      loadScript(
        'script[data-armahub-feature="cubicacion-exportacion"]',
        '/static/js/features/cubicacion/exportacion.js' + suffix,
        'armahubFeature',
        'cubicacion-exportacion',
        '[ArmaHub] No se pudo cargar cubicacion/exportacion.js'
      ),
      loadScript(
        'script[data-armahub-feature="cubicacion-dashboards"]',
        '/static/js/features/cubicacion/dashboards.js' + suffix,
        'armahubFeature',
        'cubicacion-dashboards',
        '[ArmaHub] No se pudo cargar cubicacion/dashboards.js'
      ),
      loadScript(
        'script[data-armahub-feature="cubicacion-pedidos"]',
        '/static/js/features/cubicacion/pedidos.js' + suffix,
        'armahubFeature',
        'cubicacion-pedidos',
        '[ArmaHub] No se pudo cargar cubicacion/pedidos.js'
      ),
      loadScript(
        'script[data-armahub-feature="cubicacion-index"]',
        '/static/js/features/cubicacion/index.js' + suffix,
        'armahubFeature',
        'cubicacion-index',
        '[ArmaHub] No se pudo cargar cubicacion/index.js'
      ),
      // Admin submodules (E.5) — entidades must load before proyectos and index
      loadScript(
        'script[data-armahub-feature="admin-entidades"]',
        '/static/js/features/admin/entidades.js' + suffix,
        'armahubFeature',
        'admin-entidades',
        '[ArmaHub] No se pudo cargar admin/entidades.js'
      ),
      loadScript(
        'script[data-armahub-feature="admin-proyectos"]',
        '/static/js/features/admin/proyectos.js' + suffix,
        'armahubFeature',
        'admin-proyectos',
        '[ArmaHub] No se pudo cargar admin/proyectos.js'
      ),
      loadScript(
        'script[data-armahub-feature="admin-roles-permisos"]',
        '/static/js/features/admin/roles_permisos.js' + suffix,
        'armahubFeature',
        'admin-roles-permisos',
        '[ArmaHub] No se pudo cargar admin/roles_permisos.js'
      ),
      loadScript(
        'script[data-armahub-feature="admin-index"]',
        '/static/js/features/admin/index.js' + suffix,
        'armahubFeature',
        'admin-index',
        '[ArmaHub] No se pudo cargar admin/index.js'
      ),
      loadScript(
        'script[data-armahub-feature="notifications"]',
        '/static/js/features/notifications/index.js' + suffix,
        'armahubFeature',
        'notifications',
        '[ArmaHub] No se pudo cargar notifications/index.js'
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