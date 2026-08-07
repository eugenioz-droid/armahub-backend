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
      // Reclamos submodules (PC.17) — constants & helpers first, then parallel, then orchestrator
      loadScript(
        'script[data-armahub-feature="reclamos-constants"]',
        '/static/js/features/reclamos/constants.js' + suffix,
        'armahubFeature',
        'reclamos-constants',
        '[ArmaHub] No se pudo cargar reclamos/constants.js'
      ).then(function() {
        return loadScript(
          'script[data-armahub-feature="reclamos-helpers"]',
          '/static/js/features/reclamos/helpers.js' + suffix,
          'armahubFeature',
          'reclamos-helpers',
          '[ArmaHub] No se pudo cargar reclamos/helpers.js'
        );
      }).then(function() {
        return Promise.all([
          loadScript(
            'script[data-armahub-feature="reclamos-presentaciones"]',
            '/static/js/features/reclamos/presentaciones.js' + suffix,
            'armahubFeature',
            'reclamos-presentaciones',
            '[ArmaHub] No se pudo cargar reclamos/presentaciones.js'
          ),
          loadScript(
            'script[data-armahub-feature="reclamos-dashboards"]',
            '/static/js/features/reclamos/dashboards.js' + suffix,
            'armahubFeature',
            'reclamos-dashboards',
            '[ArmaHub] No se pudo cargar reclamos/dashboards.js'
          ),
          loadScript(
            'script[data-armahub-feature="reclamos-list"]',
            '/static/js/features/reclamos/list.js' + suffix,
            'armahubFeature',
            'reclamos-list',
            '[ArmaHub] No se pudo cargar reclamos/list.js'
          ),
          loadScript(
            'script[data-armahub-feature="reclamos-form"]',
            '/static/js/features/reclamos/form.js' + suffix,
            'armahubFeature',
            'reclamos-form',
            '[ArmaHub] No se pudo cargar reclamos/form.js'
          ),
          loadScript(
            'script[data-armahub-feature="reclamos-detail-edit"]',
            '/static/js/features/reclamos/detail-edit.js' + suffix,
            'armahubFeature',
            'reclamos-detail-edit',
            '[ArmaHub] No se pudo cargar reclamos/detail-edit.js'
          ),
          loadScript(
            'script[data-armahub-feature="reclamos-detail-render"]',
            '/static/js/features/reclamos/detail-render.js' + suffix,
            'armahubFeature',
            'reclamos-detail-render',
            '[ArmaHub] No se pudo cargar reclamos/detail-render.js'
          ),
          loadScript(
            'script[data-armahub-feature="reclamos-detail-permissions"]',
            '/static/js/features/reclamos/detail-permissions.js' + suffix,
            'armahubFeature',
            'reclamos-detail-permissions',
            '[ArmaHub] No se pudo cargar reclamos/detail-permissions.js'
          ),
          loadScript(
            'script[data-armahub-feature="reclamos-detail-flow"]',
            '/static/js/features/reclamos/detail-flow.js' + suffix,
            'armahubFeature',
            'reclamos-detail-flow',
            '[ArmaHub] No se pudo cargar reclamos/detail-flow.js'
          ),
          loadScript(
            'script[data-armahub-feature="reclamos-internos"]',
            '/static/js/features/reclamos/internos.js' + suffix,
            'armahubFeature',
            'reclamos-internos',
            '[ArmaHub] No se pudo cargar reclamos/internos.js'
          ),
          loadScript(
            'script[data-armahub-feature="reclamos-acciones"]',
            '/static/js/features/reclamos/acciones.js' + suffix,
            'armahubFeature',
            'reclamos-acciones',
            '[ArmaHub] No se pudo cargar reclamos/acciones.js'
          )
        ]);
      }).then(function() {
        return loadScript(
          'script[data-armahub-feature="reclamos"]',
          '/static/js/features/reclamos/index.js' + suffix,
          'armahubFeature',
          'reclamos',
          '[ArmaHub] No se pudo cargar reclamos/index.js'
        );
      }),
      loadScript(
        'script[data-armahub-feature="portal"]',
        '/static/js/features/portal/index.js' + suffix,
        'armahubFeature',
        'portal',
        '[ArmaHub] No se pudo cargar el feature Portal'
      ),
      loadScript(
        'script[data-armahub-feature="reclamos-settings"]',
        '/static/js/features/reclamos/settings.js' + suffix,
        'armahubFeature',
        'reclamos-settings',
        '[ArmaHub] No se pudo cargar reclamos/settings.js'
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
        'script[data-armahub-feature="cubicacion-barmanager-edit"]',
        '/static/js/features/cubicacion/barmanager_edit.js' + suffix,
        'armahubFeature',
        'cubicacion-barmanager-edit',
        '[ArmaHub] No se pudo cargar cubicacion/barmanager_edit.js'
      ),
      loadScript(
        'script[data-armahub-feature="cubicacion-exportacion"]',
        '/static/js/features/cubicacion/exportacion.js' + suffix,
        'armahubFeature',
        'cubicacion-exportacion',
        '[ArmaHub] No se pudo cargar cubicacion/exportacion.js'
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
      // 5N.20: creador de lotes v2 (maqueta + contexto real Obra·Ciclo·Eje).
      loadScript(
        'script[data-armahub-feature="cubicacion-agregar2"]',
        '/static/js/features/cubicacion/agregar_cubicacion2.js' + suffix,
        'armahubFeature',
        'cubicacion-agregar2',
        '[ArmaHub] No se pudo cargar cubicacion/agregar_cubicacion2.js'
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
        'script[data-armahub-feature="admin-areas"]',
        '/static/js/features/admin/areas.js' + suffix,
        'armahubFeature',
        'admin-areas',
        '[ArmaHub] No se pudo cargar admin/areas.js'
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
      ),
      loadScript(
        'script[data-armahub-feature="clientes"]',
        '/static/js/features/clientes/index.js' + suffix,
        'armahubFeature',
        'clientes',
        '[ArmaHub] No se pudo cargar clientes/index.js'
      ),
      loadScript(
        'script[data-armahub-feature="catalogo-etiquetas"]',
        '/static/js/features/catalogo/etiquetas.js' + suffix,
        'armahubFeature',
        'catalogo-etiquetas',
        '[ArmaHub] No se pudo cargar catalogo/etiquetas.js'
      ),
      loadScript(
        'script[data-armahub-feature="catalogo-disenador"]',
        '/static/js/features/catalogo/disenador.js' + suffix,
        'armahubFeature',
        'catalogo-disenador',
        '[ArmaHub] No se pudo cargar catalogo/disenador.js'
      ),
      loadScript(
        'script[data-armahub-feature="catalogo-disenador3d"]',
        '/static/js/features/catalogo/disenador3d.js' + suffix,
        'armahubFeature',
        'catalogo-disenador3d',
        '[ArmaHub] No se pudo cargar catalogo/disenador3d.js'
      ),
      loadScript(
        'script[data-armahub-feature="catalogo"]',
        '/static/js/features/catalogo/index.js' + suffix,
        'armahubFeature',
        'catalogo',
        '[ArmaHub] No se pudo cargar catalogo/index.js'
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