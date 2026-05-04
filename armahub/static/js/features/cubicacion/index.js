// ========================= CUBICACIÓN — Feature Entry Point (E.4) =========================
// Dispatcher que orquesta la carga de todos los submódulos de Cubicación.
// Las funciones individuales viven en archivos hermanos cargados antes de este.

async function loadCubicacionModule() {
  await loadInicio();
  await loadMiActividad();
  await loadProyectos();
  await loadClientes();
  await loadCalculistas();

  // Filtros del Bar Manager: NO restauramos selección previa al re-entrar.
  // Al volver al tab queremos vista limpia (sin proyecto seleccionado),
  // tal como pidió el usuario para evitar resultados “fantasma”.
  try { localStorage.removeItem(FILTER_STORAGE_KEY); } catch (e) {}
  await loadFilters(null);

  await loadCargas();
  await loadPedidos();
  await buscar(true);
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
