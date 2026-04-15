// ========================= ADMIN — Roles y Permisos (PC.6) =========================
// Renderiza las tablas de ROLES_Y_PERMISOS.md como vista interactiva de solo lectura.

(function(global) {
  'use strict';

  var ROLES = ['admin', 'admin2', 'cubicador', 'usc', 'externo', 'cliente'];
  var ROLE_LABELS = {admin:'Admin', admin2:'Admin2', cubicador:'Cubicador', usc:'USC', externo:'Externo', cliente:'Cliente'};

  // ========================= DATA =========================
  // Cada tabla: { title, notes[], rows: [{action, perms:{role: symbol}}] }
  // Symbols: '✅'=allowed, '—'=no access, '✖'=forbidden, or text like '✅ propios'

  var TABLES = [
    // ---------- 1a ----------
    {
      id: '1a', section: 1,
      title: '1a. Acceso a módulos (calugas del Hub)',
      header: 'Módulo (caluga)',
      notes: ['Definido en registry.js → allowedRoles.'],
      rows: [
        {action:'Cubicación',      perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'✅'}},
        {action:'Reclamos',        perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Administración',  perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 1b ----------
    {
      id: '1b', section: 1,
      title: '1b. Acceso a tabs dentro de cada módulo',
      header: 'Módulo / Tab',
      notes: [
        'El rol cliente dentro de Cubicación solo ve los tabs Metrics (los demás se ocultan).',
        'En Reclamos, el tab Dashboards es solo para admin/admin2. Presentación excluye a usc.',
        'Los roles sin acceso al módulo (—) no ven ningún tab.'
      ],
      rows: [
        {action:'Cubicación / Inicio',      perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'✅'}},
        {action:'Cubicación / Obras',        perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Cubicación / Bar Manager',  perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Cubicación / Metrics',     perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'✅'}},
        {action:'Cubicación / Pedidos',      perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Cubicación / Exportación',  perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Reclamos / Reclamos',       perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Reclamos / Dashboards',     perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Reclamos / Presentación',   perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'✅',cliente:'—'}},
        {action:'Admin / Admin',             perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 2a ----------
    {
      id: '2a', section: 2,
      title: '2a. Landing (Hub principal)',
      header: 'Indicador',
      notes: [],
      rows: [
        {action:'Cubicado semanal (chart)',  perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Reclamos semana (chart)',    perms:{admin:'✅',admin2:'✅',cubicador:'✅ propios',usc:'✅ propios',externo:'✅ propios',cliente:'—'}},
        {action:'Alertas reclamos',          perms:{admin:'✅ todos',admin2:'✅ todos',cubicador:'✅ propios',usc:'✅ propios',externo:'✅ propios',cliente:'—'}},
      ]
    },
    // ---------- 2b ----------
    {
      id: '2b', section: 2,
      title: '2b. Reclamos — Vistas analíticas',
      header: 'Vista',
      notes: [
        '✖ = prohibido (403 en backend o sin acceso al módulo).',
        'cliente no tiene acceso al módulo Reclamos.',
        '"propios": externo ve reclamos donde es cubicador_asignado o respuesta_por; usc ve donde es creado_por o asignado_a.'
      ],
      rows: [
        {action:'Resumen General',      perms:{admin:'✅ global',admin2:'✅ global',cubicador:'✅ global',usc:'✅ propios',externo:'✅ propios',cliente:'✖'}},
        {action:'Tab Dashboards',        perms:{admin:'✅',admin2:'✅',cubicador:'✖',usc:'✖',externo:'✖',cliente:'✖'}},
        {action:'Presentaciones stats',  perms:{admin:'✅ todos',admin2:'✅ todos',cubicador:'✅ todos',usc:'✖',externo:'✅ propios',cliente:'✖'}},
      ]
    },
    // ---------- 2c ----------
    {
      id: '2c', section: 2,
      title: '2c. Cubicación — Vistas',
      header: 'Vista',
      notes: ['* Acceso API disponible pero sin card en el Hub.'],
      rows: [
        {action:'Stats generales',       perms:{admin:'✅',admin2:'✅*',cubicador:'✅',usc:'✅*',externo:'✅*',cliente:'✅'}},
        {action:'Timeline',              perms:{admin:'✅',admin2:'✅*',cubicador:'✅',usc:'✅*',externo:'✅*',cliente:'✅'}},
        {action:'Cubicadores',           perms:{admin:'✅',admin2:'✅*',cubicador:'✅',usc:'✅*',externo:'✅*',cliente:'✅'}},
        {action:'Mi Actividad',          perms:{admin:'✅',admin2:'✅*',cubicador:'✅',usc:'✅*',externo:'✅*',cliente:'✅'}},
        {action:'Dashboard cubicación',  perms:{admin:'✅',admin2:'✅*',cubicador:'✅',usc:'✅*',externo:'✅*',cliente:'✅'}},
      ]
    },
    // ---------- 3a ----------
    {
      id: '3a', section: 3,
      title: '3a. Autenticación y usuarios',
      header: 'Acción',
      notes: ['¹ admin2 no puede operar sobre usuarios con rol admin ni admin2.'],
      rows: [
        {action:'Login / cambiar password',    perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'✅'}},
        {action:'Registrar usuario',           perms:{admin:'✅ cualquier rol',admin2:'✅ parcial¹',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Listar usuarios (admin)',     perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Cambiar rol de usuario',      perms:{admin:'✅',admin2:'✅ parcial¹',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Activar/desactivar usuario',  perms:{admin:'✅',admin2:'✅ parcial¹',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Resetear password de otro',   perms:{admin:'✅',admin2:'✅ parcial¹',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Eliminar usuario',            perms:{admin:'✅',admin2:'✅ parcial¹',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 3b ----------
    {
      id: '3b', section: 3,
      title: '3b. Admin técnico',
      header: 'Acción',
      notes: [],
      rows: [
        {action:'Ver info DB',     perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Reset DB',        perms:{admin:'✅',admin2:'—',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Ver tablas',      perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Limpiar tabla',   perms:{admin:'✅',admin2:'—',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Ver auditoría',   perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 3c ----------
    {
      id: '3c', section: 3,
      title: '3c. Proyectos y barras (cubicación)',
      header: 'Acción',
      notes: [
        '† Requiere estar autorizado en proyecto_usuarios. Admin/admin2 siempre tienen acceso.',
        'USC, externo y cliente no tienen acceso al módulo Cubicación (excepto cliente en modo lectura).'
      ],
      rows: [
        {action:'Ver proyectos / barras',        perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Crear proyecto',                perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Editar proyecto',               perms:{admin:'✅',admin2:'✅',cubicador:'✅†',usc:'—',externo:'—',cliente:'—'}},
        {action:'Eliminar proyecto',             perms:{admin:'✅',admin2:'✅',cubicador:'✅† vacío',usc:'—',externo:'—',cliente:'—'}},
        {action:'Crear / duplicar barras',       perms:{admin:'—',admin2:'—',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Eliminar barras',               perms:{admin:'—',admin2:'—',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Cambiar sector',                perms:{admin:'—',admin2:'—',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Mover barras entre sectores',   perms:{admin:'—',admin2:'—',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Importar Excel',                perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Exportar proyecto',             perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Eliminar carga',                perms:{admin:'✅',admin2:'✅',cubicador:'✅† o propio',usc:'—',externo:'—',cliente:'—'}},
        {action:'Autorizar usuario en proyecto', perms:{admin:'✅',admin2:'✅',cubicador:'✅†',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 3d ----------
    {
      id: '3d', section: 3,
      title: '3d. Reclamos',
      header: 'Acción',
      notes: [
        '"Registro" = formulario básico (descripción, USC responsable, cubicador responsable, prioridad, id_calidad, observaciones, proyecto).',
        '"Análisis" = formulario cubicador (categoría Ishikawa, sub-causa, respuesta, área aplica, fecha análisis, kilos mal fabricados).',
        '"propios" para cubicador/externo = reclamos donde es cubicador_asignado o respuesta_por.',
        '"propios" para USC = reclamos donde es creado_por o asignado_a.',
        '"USC Responsable" = campo asignado_a. USC se auto-asigna (bloqueado); admin/admin2 eligen cualquier USC.',
        '"Cubicador Responsable" = campo cubicador_asignado. Asignable por admin/admin2/usc.',
        'Cubicador y externo no pueden crear reclamos; solo completan análisis causa raíz.',
        'Cliente no tiene acceso al módulo Reclamos.'
      ],
      rows: [
        {action:'Ver listado reclamos',               perms:{admin:'✅ todo',admin2:'✅ todo',cubicador:'✅ todo',usc:'✅ propios',externo:'✅ propios',cliente:'—'}},
        {action:'Crear reclamo',                      perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'✅ auto-asigna',externo:'—',cliente:'—'}},
        {action:'Asignar USC Responsable',            perms:{admin:'✅ libre',admin2:'✅ libre',cubicador:'—',usc:'✅ auto (bloq)',externo:'—',cliente:'—'}},
        {action:'Asignar Cubicador Responsable',      perms:{admin:'✅ libre',admin2:'✅ libre',cubicador:'—',usc:'✅ libre',externo:'—',cliente:'—'}},
        {action:'Editar registro (form básico)',       perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'✅ propios',externo:'—',cliente:'—'}},
        {action:'Editar análisis (form cubicador)',    perms:{admin:'✅',admin2:'✅',cubicador:'✅ propios',usc:'—',externo:'✅ propios',cliente:'—'}},
        {action:'Eliminar reclamo',                   perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'✅ propios',externo:'—',cliente:'—'}},
        {action:'Agregar historial de modificaciones', perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Agregar acción correctiva',           perms:{admin:'✅',admin2:'✅',cubicador:'✅ propios',usc:'—',externo:'✅ propios',cliente:'—'}},
        {action:'Subir imágenes registro',             perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'✅',externo:'—',cliente:'—'}},
        {action:'Subir imágenes análisis',             perms:{admin:'✅',admin2:'✅',cubicador:'✅',usc:'—',externo:'✅',cliente:'—'}},
        {action:'Presentar reclamo',                   perms:{admin:'✅',admin2:'✅',cubicador:'✅ propios',usc:'—',externo:'✅ propios',cliente:'—'}},
      ]
    },
    // ---------- 3e ----------
    {
      id: '3e', section: 3,
      title: '3e. Pedidos, calculistas, constructoras',
      header: 'Acción',
      notes: [],
      rows: [
        {action:'CRUD pedidos',        perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'CRUD calculistas',    perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'CRUD constructoras',  perms:{admin:'✅',admin2:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
  ];

  var SECURITY_NOTES = [
    'Reclamos protegidos en backend — los endpoints de mutación (PATCH, DELETE, POST acciones/imágenes/presentar) validan rol + propiedad. Los campos de registro y análisis están separados por rol.',
    'GET /reclamos/{id}/imagenes/{iid} no tiene auth — públicamente accesible con la URL.',
    'Pedidos, calculistas, constructoras — restringidos a admin/admin2 en backend.',
    'admin2 vs admin: admin2 no puede crear usuarios admin/admin2, no puede operar sobre usuarios admin/admin2, no puede reset DB ni limpiar tablas.',
    'Barras/cubicación — crear/duplicar/eliminar barras, cambiar sector y mover barras deshabilitados para todos (sistema cerrado).'
  ];

  var SECTION_TITLES = {
    1: '1. Módulos y Tabs × Rol',
    2: '2. Dashboards / Vistas × Rol',
    3: '3. Permisos (Acciones) × Rol'
  };

  // ========================= RENDER =========================

  function _permCell(val) {
    if (!val || val === '—') return '<span style="color:#bbb;">—</span>';
    if (val === '✖') return '<span style="color:#d32f2f; font-weight:600;">✖</span>';
    if (val === '✅') return '<span style="color:#2e7d32;">✅</span>';
    // Compound: "✅ propios", "✅ parcial¹", etc.
    if (val.indexOf('✅') === 0) {
      var extra = val.substring(1).trim();
      return '<span style="color:#2e7d32;">✅</span> <span style="font-size:10px; color:#666;">' + _esc(extra) + '</span>';
    }
    return _esc(val);
  }

  function _esc(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _renderTable(t) {
    var html = '<div style="margin-bottom:20px;">';
    html += '<h4 style="margin:0 0 8px 0; font-size:13px; color:#1a1a1a;">' + _esc(t.title) + '</h4>';
    html += '<div style="overflow-x:auto;">';
    html += '<table style="width:100%; font-size:12px; border-collapse:collapse; border:1px solid #e0e0e0;">';
    // Header
    html += '<thead><tr style="background:#f5f7fa;">';
    html += '<th style="text-align:left; padding:6px 10px; border:1px solid #e0e0e0; min-width:180px;">' + _esc(t.header) + '</th>';
    ROLES.forEach(function(r) {
      html += '<th style="text-align:center; padding:6px 6px; border:1px solid #e0e0e0; min-width:70px; font-weight:600;">' + _esc(ROLE_LABELS[r]) + '</th>';
    });
    html += '</tr></thead><tbody>';
    // Rows
    t.rows.forEach(function(row, idx) {
      var bg = idx % 2 === 0 ? '#fff' : '#fafbfc';
      html += '<tr style="background:' + bg + ';">';
      html += '<td style="padding:5px 10px; border:1px solid #e0e0e0; font-weight:500;">' + _esc(row.action) + '</td>';
      ROLES.forEach(function(r) {
        html += '<td style="text-align:center; padding:5px 4px; border:1px solid #e0e0e0;">' + _permCell(row.perms[r]) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    // Notes
    if (t.notes && t.notes.length) {
      html += '<div style="margin-top:6px;">';
      t.notes.forEach(function(n) {
        html += '<div style="font-size:11px; color:#777; line-height:1.5; padding-left:4px;">▸ ' + _esc(n) + '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function loadRolesPermisos() {
    var container = document.getElementById('rolesPermisosContainer');
    if (!container) return;

    var html = '';
    var currentSection = 0;

    TABLES.forEach(function(t) {
      if (t.section !== currentSection) {
        currentSection = t.section;
        html += '<div style="margin:24px 0 12px 0; padding-bottom:4px; border-bottom:2px solid #e0e0e0;">';
        html += '<h3 style="margin:0; font-size:15px; color:#333; font-weight:700;">' + _esc(SECTION_TITLES[currentSection]) + '</h3>';
        html += '</div>';
      }
      html += _renderTable(t);
    });

    // Security observations
    html += '<div style="margin:24px 0 12px 0; padding-bottom:4px; border-bottom:2px solid #e0e0e0;">';
    html += '<h3 style="margin:0; font-size:15px; color:#333; font-weight:700;">4. Observaciones de seguridad</h3>';
    html += '</div>';
    html += '<div style="background:#fff8e1; border:1px solid #ffe082; border-left:4px solid #ffa000; border-radius:6px; padding:12px 16px;">';
    SECURITY_NOTES.forEach(function(note, i) {
      html += '<div style="font-size:12px; color:#555; line-height:1.6; margin-bottom:' + (i < SECURITY_NOTES.length -1 ? '6' : '0') + 'px;">';
      html += '<strong>' + (i+1) + '.</strong> ' + _esc(note);
      html += '</div>';
    });
    html += '</div>';

    container.innerHTML = html;
  }

  // ========================= EXPORTS =========================
  global.loadRolesPermisos = loadRolesPermisos;

})(window);
