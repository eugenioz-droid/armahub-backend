// ArmaHub — Colores de ROL: fuente única del frontend (M1.3).
// Antes había 2 paletas divergentes (admin usaba la extendida de 8 roles; obras y
// proyectos una vieja de 5). Se estandariza la extendida en toda la plataforma.
(function(global) {
  var ROL_COLORES = {
    admin: '#b42318',
    admin_calidad: '#1565C0',
    jefe_servicio: '#5e35b1',
    miembro: '#00897b',
    cliente: '#7B1FA2',
    cubicador: '#2e7d32',
    usc: '#ff9800',
    externo: '#795548'
  };
  global.ROL_COLORES = ROL_COLORES;
  global.rolColor = function(rol) { return ROL_COLORES[rol] || '#666'; };
})(window);
