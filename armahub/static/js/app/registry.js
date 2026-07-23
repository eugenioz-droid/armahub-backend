(function initArmaHubRegistry() {
  if (window.ArmaHubRegistry) {
    return;
  }

  var modules = {};
  var requiredKeys = ['id', 'title', 'css', 'defaultTab', 'allowedRoles', 'hubCardId'];

  function cloneModule(definition) {
    return {
      id: definition.id,
      title: definition.title,
      css: definition.css,
      defaultTab: definition.defaultTab,
      allowedRoles: definition.allowedRoles.slice(),
      loaderFunction: definition.loaderFunction || '',
      hubCardId: definition.hubCardId,
      hubOrder: definition.hubOrder || 0,
      hubDescription: definition.hubDescription || '',
      hubAccent: definition.hubAccent || '',
      hubIcon: definition.hubIcon || '🧩'
    };
  }

  function validateModule(definition) {
    requiredKeys.forEach(function(key) {
      if (!definition[key]) {
        throw new Error('[ArmaHubRegistry] Falta la propiedad obligatoria "' + key + '" en el modulo');
      }
    });
    if (!Array.isArray(definition.allowedRoles) || definition.allowedRoles.length === 0) {
      throw new Error('[ArmaHubRegistry] allowedRoles debe ser un arreglo no vacio');
    }
  }

  function registerModule(definition) {
    validateModule(definition);
    modules[definition.id] = cloneModule(definition);
    return modules[definition.id];
  }

  function getModule(id) {
    return modules[id] ? cloneModule(modules[id]) : null;
  }

  function getModules() {
    return Object.keys(modules).map(function(id) {
      return cloneModule(modules[id]);
    }).sort(function(left, right) {
      return left.hubOrder - right.hubOrder;
    });
  }

  function canAccessModule(id, role) {
    var definition = modules[id];
    if (!definition) {
      return false;
    }
    return definition.allowedRoles.indexOf(role) !== -1;
  }

  window.ArmaHubRegistry = {
    registerModule: registerModule,
    getModule: getModule,
    getModules: getModules,
    canAccessModule: canAccessModule,
    requiredKeys: requiredKeys.slice()
  };

  registerModule({
    id: 'cubicacion',
    title: 'Cubicacion',
    css: 'mod-cubicacion',
    defaultTab: 'obras',
    allowedRoles: ['admin', 'admin_calidad', 'miembro', 'cliente'],
    loaderFunction: 'loadCubicacionModule',
    hubCardId: 'hubCardCubicacion',
    hubOrder: 10,
    hubDescription: 'Obras, metricas, barras, pedidos y exportacion.',
    hubAccent: '#4285f4',
    hubIcon: '🏗️'
  });

  registerModule({
    id: 'reclamos',
    title: 'Calidad / Reclamos',
    css: 'mod-reclamos',
    defaultTab: 'reclamos',
    allowedRoles: ['admin', 'admin_calidad', 'jefe_servicio', 'miembro', 'usc', 'externo'],
    loaderFunction: 'loadReclamosModule',
    hubCardId: 'hubCardReclamos',
    hubOrder: 20,
    hubDescription: 'Reclamos de clientes, reclamos internos, matrices RCA y procedimientos de calidad.',
    hubAccent: '#e53935',
    hubIcon: '🎯'
  });

  registerModule({
    id: 'clientes',
    title: 'Clientes',
    css: 'mod-clientes',
    defaultTab: 'clientes',
    allowedRoles: ['admin', 'admin_calidad', 'usc'],
    loaderFunction: 'loadClientesModule',
    hubCardId: 'hubCardClientes',
    hubOrder: 25,
    hubDescription: 'Obras/tiendas y empresas: completar data, empresa asignada, kilos y reclamos.',
    hubAccent: '#00897b',
    hubIcon: '🏢'
  });

  registerModule({
    id: 'catalogo',
    title: 'Catálogo Armacero',
    css: 'mod-catalogo',
    defaultTab: 'catalogo',
    allowedRoles: ['admin', 'admin_calidad', 'miembro'],
    loaderFunction: 'loadCatalogoModule',
    hubCardId: 'hubCardCatalogo',
    hubOrder: 15,
    hubDescription: 'Catálogo de figuras y tipologías de fierro (data maestra Armacero).',
    hubAccent: '#5d4037',
    hubIcon: '🔧'
  });

  registerModule({
    id: 'admin',
    title: 'Administracion',
    css: 'mod-admin',
    defaultTab: 'admin',
    allowedRoles: ['admin', 'admin_calidad'],
    loaderFunction: 'loadAdminModule',
    hubCardId: 'hubCardAdmin',
    hubOrder: 30,
    hubDescription: 'Usuarios, proyectos, datos y auditoria.',
    hubAccent: '#8b5cf6',
    hubIcon: '⚙️'
  });
})();