// ArmaHub — Orden de PISOS: fuente única del frontend (M1.2).
// Espejo EXACTO de armahub/orden.py::piso_order — si cambia el criterio, cambiar AMBOS.
// Criterio (decisión de negocio 2026-08-05): FUND (fundación) al fondo < subterráneos
// (S2<S1) < P1..Pn < SM/PM (techumbre). Texto libre desconocido cae al medio (0).
(function(global) {
  function pisoOrder(p) {
    var up = (p || '').toUpperCase().trim();
    if (up === 'FUND' || up === 'FUNDACION' || up === 'FUNDACIÓN') return -1000000;
    if (up === 'SM' || up === 'PM' || up === 'SALA DE MAQUINAS') return 9999;
    var m = up.match(/^S(\d+)/);
    if (m) return -parseInt(m[1], 10);
    m = up.match(/^P(\d+)/);
    if (m) return parseInt(m[1], 10);
    m = up.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
    return 0;
  }
  global.pisoOrder = pisoOrder;
})(window);
