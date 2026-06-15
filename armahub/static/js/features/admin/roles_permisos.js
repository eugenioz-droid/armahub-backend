// ========================= ADMIN — Roles y Permisos (PC.6) =========================
// Renderiza las tablas de ROLES_Y_PERMISOS.md como vista interactiva de solo lectura.

(function(global) {
  'use strict';

  var ROLES = ['admin', 'admin_calidad', 'cubicador', 'usc', 'externo', 'cliente'];
  var ROLE_LABELS = {admin:'Admin', admin_calidad:'Admin Calidad', cubicador:'Cubicador', usc:'USC', externo:'Externo', cliente:'Cliente'};

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
        {action:'Cubicación',      perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'✅'}},
        {action:'Reclamos',        perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Administración',  perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 1b ----------
    {
      id: '1b', section: 1,
      title: '1b. Tabs por módulo',
      header: 'Módulo / Tab',
      notes: [
        'El rol cliente dentro de Cubicación solo ve el tab Metrics (los demás se ocultan en frontend).',
        'Tab Obras es el default al entrar a Cubicación.',
        'Los roles sin acceso al módulo (—) no ven ningún tab de ese módulo.'
      ],
      rows: [
        {action:'Cubicación / Obras',        perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Cubicación / Metrics',      perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'✅'}},
        {action:'Cubicación / Bar Manager',  perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Cubicación / Pedidos',      perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Cubicación / Exportación',  perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Reclamos / Reclamos',       perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Admin / Admin',             perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 2a ----------
    {
      id: '2a', section: 2,
      title: '2a. Landing (Hub principal)',
      header: 'Indicador',
      notes: [],
      rows: [
        {action:'Cubicado semanal (chart)',     perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Reclamos semana (chart)',       perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅ propios',usc:'✅ propios',externo:'✅ propios',cliente:'—'}},
        {action:'Alertas reclamos',             perms:{admin:'✅ todos',admin_calidad:'✅ todos',cubicador:'✅ propios',usc:'✅ propios',externo:'✅ propios',cliente:'—'}},
        {action:'Resumen reclamos (mi-resumen)',perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅ propios',usc:'✅ propios',externo:'✅ propios',cliente:'—'}},
      ]
    },
    // ---------- 2b ----------
    {
      id: '2b', section: 2,
      title: '2b. Metrics (tab Cubicación)',
      header: 'Vista',
      notes: ['* Acceso API disponible pero sin card en el Hub.'],
      rows: [
        {action:'KPIs generales',            perms:{admin:'✅',admin_calidad:'✅*',cubicador:'✅',usc:'✅*',externo:'✅*',cliente:'✅'}},
        {action:'Top 15 proyectos (chart)',   perms:{admin:'✅',admin_calidad:'✅*',cubicador:'✅',usc:'✅*',externo:'✅*',cliente:'✅'}},
        {action:'Cubicadores (chart)',        perms:{admin:'✅',admin_calidad:'✅*',cubicador:'✅',usc:'✅*',externo:'✅*',cliente:'✅'}},
        {action:'Cubicación mensual (chart)', perms:{admin:'✅',admin_calidad:'✅*',cubicador:'✅',usc:'✅*',externo:'✅*',cliente:'✅'}},
      ]
    },
    // ---------- 2c ----------
    {
      id: '2c', section: 2,
      title: '2c. Reclamos — Vistas analíticas',
      header: 'Vista',
      notes: [
        '✖ = prohibido (403 en backend o sin acceso al módulo).',
        '"propios": externo ve reclamos donde es cubicador_asignado o respuesta_por; usc ve donde es creado_por o asignado_a. Admin y admin_calidad ven todo (global).',
        '*cubicador y usc: por defecto ven propios; toggle "Todos" permite ver listado completo (read-only sobre ajenos). Externo siempre ve solo propios, sin toggle.'
      ],
      rows: [
        {action:'Resumen General',      perms:{admin:'✅ global',admin_calidad:'✅ global',cubicador:'✅ propios*',usc:'✅ propios*',externo:'✅ propios',cliente:'✖'}},
        {action:'Dashboards admin',     perms:{admin:'✅',admin_calidad:'✅',cubicador:'✖',usc:'✖',externo:'✖',cliente:'✖'}},
        {action:'Presentaciones stats', perms:{admin:'✅ todos',admin_calidad:'✅ todos',cubicador:'✅ todos',usc:'✖',externo:'✅ propios',cliente:'✖'}},
      ]
    },
    // ---------- 3a ----------
    {
      id: '3a', section: 3,
      title: '3a. Autenticación y usuarios',
      header: 'Acción',
      notes: ['¹ admin_calidad no puede operar sobre usuarios con rol admin ni admin_calidad.'],
      rows: [
        {action:'Login / cambiar password',    perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'✅'}},
        {action:'Registrar usuario',           perms:{admin:'✅ cualquier rol',admin_calidad:'✅ parcial¹',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Listar usuarios (admin)',     perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Cambiar rol de usuario',      perms:{admin:'✅',admin_calidad:'✅ parcial¹',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Activar/desactivar usuario',  perms:{admin:'✅',admin_calidad:'✅ parcial¹',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Resetear password de otro',   perms:{admin:'✅',admin_calidad:'✅ parcial¹',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Eliminar usuario',            perms:{admin:'✅',admin_calidad:'✅ parcial¹',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 3b ----------
    {
      id: '3b', section: 3,
      title: '3b. Admin técnico',
      header: 'Acción',
      notes: [],
      rows: [
        {action:'Ver info DB',     perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Reset DB',        perms:{admin:'✅',admin_calidad:'—',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Ver tablas',      perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Limpiar tabla',   perms:{admin:'✅',admin_calidad:'—',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Ver auditoría',   perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 3c ----------
    {
      id: '3c', section: 3,
      title: '3c. Proyectos y cargas (cubicación)',
      header: 'Acción',
      notes: [
        '† Requiere estar autorizado en proyecto_usuarios. Admin/admin_calidad siempre tienen acceso.',
        'Reimportar CSV: ejecuta DELETE de barras del mismo plano_code antes del UPSERT, eliminando barras huérfanas.',
        'USC, externo no tienen acceso al módulo Cubicación. Cliente solo lectura (Metrics + ver proyectos filtrados).'
      ],
      rows: [
        {action:'Ver proyectos / barras',        perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'✅†'}},
        {action:'Crear proyecto',                perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Editar proyecto',               perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅†',usc:'—',externo:'—',cliente:'—'}},
        {action:'Eliminar proyecto (vacío)',      perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅†',usc:'—',externo:'—',cliente:'—'}},
        {action:'Importar CSV',                  perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Reimportar CSV (reemplaza carga)',perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Exportar proyecto',             perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'—'}},
        {action:'Eliminar carga',                perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅† o propio',usc:'—',externo:'—',cliente:'—'}},
        {action:'Eliminar cargas (bulk)',         perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅† o propio',usc:'—',externo:'—',cliente:'—'}},
        {action:'Mover cargas entre proyectos',  perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅† o propio',usc:'—',externo:'—',cliente:'—'}},
        {action:'Autorizar usuario en proyecto', perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅†',usc:'—',externo:'—',cliente:'—'}},
        {action:'Ver cargas recientes',          perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'✅'}},
        {action:'Navegación sectores/pisos',     perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'—',cliente:'✅'}},
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
        '*cubicador y usc: por defecto ven propios; toggle "Todos" permite ver listado completo (read-only, sin permisos de edición sobre ajenos). Externo siempre ve solo propios, sin toggle.',
        'Año calidad (anio_calidad) solo editable por admin/admin_calidad (bloqueado inline en PATCH).',
        'Editar/Eliminar acción correctiva e imágenes — actualmente sin validación de propiedad en backend.',
        'Enviar informe por correo: al enviar se registra un seguimiento automático indicando quién envió el PDF y a qué destinatario(s). Solo admin, admin_calidad, o el USC propietario pueden enviar.'
      ],
      rows: [
        {action:'Ver listado reclamos',               perms:{admin:'✅ todo',admin_calidad:'✅ todo',cubicador:'✅ propios*',usc:'✅ propios*',externo:'✅ propios',cliente:'—'}},
        {action:'Crear reclamo',                      perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'✅ auto-asigna',externo:'—',cliente:'—'}},
        {action:'Asignar USC Responsable',            perms:{admin:'✅ libre',admin_calidad:'✅ libre',cubicador:'—',usc:'✅ auto (bloq)',externo:'—',cliente:'—'}},
        {action:'Asignar Cubicador Responsable',      perms:{admin:'✅ libre',admin_calidad:'✅ libre',cubicador:'—',usc:'✅ libre',externo:'—',cliente:'—'}},
        {action:'Editar registro (form básico)',       perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'✅ propios',externo:'—',cliente:'—'}},
        {action:'Editar análisis (form cubicador)',    perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅ propios',usc:'—',externo:'✅ propios',cliente:'—'}},
        {action:'Editar año calidad',                 perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Editar número calidad',              perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Validación resultado/observaciones', perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Campos tiempo respuesta',            perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅ propios',usc:'—',externo:'✅ propios',cliente:'—'}},
        {action:'Eliminar reclamo',                   perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'✅ propios',externo:'—',cliente:'—'}},
        {action:'Agregar historial de modificaciones', perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Agregar acción correctiva',           perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅ propios',usc:'—',externo:'✅ propios',cliente:'—'}},
        {action:'Editar acción correctiva',            perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Eliminar acción correctiva',          perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Subir imágenes registro',             perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'✅',externo:'—',cliente:'—'}},
        {action:'Subir imágenes análisis',             perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'—',externo:'✅',cliente:'—'}},
        {action:'Eliminar imágenes',                   perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Presentar reclamo',                   perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅ propios',usc:'—',externo:'✅ propios',cliente:'—'}},
        {action:'Siguiente número calidad',            perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'—'}},
        {action:'Exportar PDF',                          perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅ propios',usc:'✅ propios',externo:'—',cliente:'—'}},
        {action:'Enviar informe por correo',             perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'✅ propios',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 3e ----------
    {
      id: '3e', section: 3,
      title: '3e. Pedidos, calculistas, constructoras',
      header: 'Acción',
      notes: [],
      rows: [
        {action:'CRUD pedidos',        perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'CRUD calculistas',    perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'CRUD constructoras',  perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
    // ---------- 3f ----------
    {
      id: '3f', section: 3,
      title: '3f. Notificaciones',
      header: 'Acción',
      notes: [],
      rows: [
        {action:'Ver notificaciones propias',   perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'✅'}},
        {action:'Contar no leídas',             perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'✅'}},
        {action:'Marcar leída / todas leídas',  perms:{admin:'✅',admin_calidad:'✅',cubicador:'✅',usc:'✅',externo:'✅',cliente:'✅'}},
        {action:'Ver config notificaciones',    perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
        {action:'Editar config notificaciones', perms:{admin:'✅',admin_calidad:'✅',cubicador:'—',usc:'—',externo:'—',cliente:'—'}},
      ]
    },
  ];

  var SECURITY_NOTES = [
    'Reclamos protegidos en backend — los endpoints de mutación (PATCH, DELETE, POST acciones/imágenes/presentar) validan rol + propiedad. Los campos de registro y análisis están separados por rol.',
    'GET /reclamos/{id}/imagenes/{iid} no tiene auth — públicamente accesible con la URL.',
    'Pedidos, calculistas, constructoras — restringidos a admin/admin_calidad en backend.',
    'admin_calidad vs admin: admin_calidad no puede crear usuarios admin/admin_calidad, no puede operar sobre usuarios admin/admin_calidad, no puede reset DB ni limpiar tablas.',
    'Acciones correctivas e imágenes — PATCH/DELETE /reclamos/{id}/acciones/{aid} y DELETE /reclamos/{id}/imagenes/{iid} no validan propiedad. Cualquier usuario autenticado puede operar sobre cualquier reclamo. Pendiente de hardening.',
    'numero_calidad — no está restringido a REGISTRO_FIELDS ni ANALISIS_FIELDS, lo que permite su edición por cualquier rol autenticado (excepto cliente). Evaluar si debería restringirse.',
    'Enviar informe por correo genera un seguimiento automático con el texto "Informe PDF enviado por correo a {destinatarios}" bajo el usuario que ejecuta la acción.'
  ];

  var SECTION_TITLES = {
    1: '1. Acceso a Módulos y Tabs',
    2: '2. Indicadores y Vistas Analíticas',
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

// ========================= Permisos configurables por rol_area =========================

var _AREA_ROL_ACCION_LABELS = {
  levantar_externo:  'Levantar reclamos de clientes',
  levantar_interno:  'Levantar reclamos internos',
  responder_externo: 'Responder/analizar reclamos de clientes',
  responder_interno: 'Responder/analizar reclamos internos',
  aprobar_revision:  'Aprobar/devolver en etapa de revisión'
};
var _AREA_ROL_LABELS = { miembro: 'Miembro', jefe_servicio: 'Jefe de Servicio' };
var _AREA_ROLES = ['miembro', 'jefe_servicio'];
var _AREA_ACCIONES = Object.keys(_AREA_ROL_ACCION_LABELS);

async function loadAreaRolPermisos() {
  var container = document.getElementById('areaRolPermisosConfig');
  if (!container) return;
  var data = await apiGet('/admin/area-rol-permisos');
  if (!data) { container.innerHTML = '<div class="muted">Error al cargar.</div>'; return; }

  // Construir mapa {rol_area: {accion: activo}}
  var mapa = {};
  _AREA_ROLES.forEach(function(r) { mapa[r] = {}; });
  data.forEach(function(row) {
    if (mapa[row.rol_area]) mapa[row.rol_area][row.accion] = row.activo;
  });

  var html = '<table style="width:100%; font-size:12px; border-collapse:collapse;">';
  html += '<tr style="background:#f5f5f5; text-align:left;">';
  html += '<th style="padding:6px 8px;">Permiso</th>';
  _AREA_ROLES.forEach(function(r) {
    html += '<th style="padding:6px 8px; text-align:center;">' + (_AREA_ROL_LABELS[r] || r) + '</th>';
  });
  html += '</tr>';

  _AREA_ACCIONES.forEach(function(accion) {
    html += '<tr style="border-bottom:1px solid #eee;">';
    html += '<td style="padding:6px 8px;">' + (_AREA_ROL_ACCION_LABELS[accion] || accion) + '</td>';
    _AREA_ROLES.forEach(function(rol) {
      var activo = !!(mapa[rol] && mapa[rol][accion]);
      html += '<td style="padding:6px 8px; text-align:center;">' +
        '<input type="checkbox"' + (activo ? ' checked' : '') +
        ' onchange="toggleAreaRolPermiso(\'' + rol + '\',\'' + accion + '\',this.checked)"' +
        (currentRole !== 'admin' ? ' disabled' : '') + ' /></td>';
    });
    html += '</tr>';
  });
  html += '</table>';
  html += '<div class="muted" style="font-size:11px; margin-top:6px;">Solo Admin puede modificar esta matriz.</div>';
  container.innerHTML = html;
}

async function toggleAreaRolPermiso(rolArea, accion, activo) {
  var res = await fetch(apiUrl('/admin/area-rol-permisos'), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rol_area: rolArea, accion: accion, activo: activo })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (!data.ok) { alert('Error: ' + (data.detail || 'desconocido')); await loadAreaRolPermisos(); }
}
