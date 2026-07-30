// ========================= CUBICACIÓN — Feature Entry Point (E.4) =========================
// Dispatcher que orquesta la carga de todos los submódulos de Cubicación.
// Las funciones individuales viven en archivos hermanos cargados antes de este.

async function loadCubicacionModule() {
  await loadInicio();
  await loadMiActividad();
  await loadProyectos();
  await loadClientes();
  await loadCalculistas();

  // Montar el combobox del filtro de Eje AQUÍ, GARANTIZADO y desacoplado de loadFilters:
  // si se montara solo dentro de loadFilters y apiGet('/filters') fallara (token, red),
  // el #eje quedaba crudo y Chrome lo trataba como campo de clave. Aquí #eje ya existe
  // (el tab es include estático) y Combobox ya cargó (script síncrono en app.html).
  if (typeof _initEjeCombobox === 'function') _initEjeCombobox();

  // 5M.9: al entrar/refrescar restauramos la OBRA seleccionada y los filtros de
  // nivel-barra (figura/tipología/diámetro), NO los de ubicación (evita
  // resultados "fantasma"). Si no hay obra guardada, arranque limpio.
  await loadFilters(null);
  await loadCargas();
  await loadPedidos();
  var restaurado = false;
  if (typeof restoreBarManagerState === 'function') {
    restaurado = await restoreBarManagerState();
  }
  if (!restaurado) await buscar(true);
}

// Reusable piso ordering function (building order: SM top, subterráneos bottom)
function pisoOrder(p) {
  const up = (p || '').toUpperCase().trim();
  if (up === 'SM' || up === 'SALA DE MAQUINAS' || up === 'PM') return 9999;
  const m = up.match(/^S(\d+)/);
  if (m) return -parseInt(m[1]);
  const m2 = up.match(/^P(\d+)/);
  if (m2) return parseInt(m2[1]);
  const m3 = up.match(/(\d+)/);
  if (m3) return parseInt(m3[1]);
  return 0;
}
