// ========================= CUBICACIÓN — Feature Entry Point (E.4) =========================
// Dispatcher que orquesta la carga de todos los submódulos de Cubicación.
// Las funciones individuales viven en archivos hermanos cargados antes de este.

async function loadCubicacionModule() {
  await loadInicio();
  await loadMiActividad();
  await loadProyectos();
  await loadClientes();
  await loadCalculistas();

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

// M1.2: pisoOrder vive en shared/orden_pisos.js (fuente única, espejo de orden.py).
