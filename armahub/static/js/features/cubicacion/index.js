// ========================= CUBICACIÓN — Feature Entry Point (E.4) =========================
// Dispatcher que orquesta la carga de todos los submódulos de Cubicación.
// Las funciones individuales viven en archivos hermanos cargados antes de este.

async function loadCubicacionModule() {
  await loadInicio();
  await loadMiActividad();
  await loadProyectos();
  await loadClientes();
  await loadCalculistas();

  var saved = typeof restoreFiltersFromStorage === 'function' ? restoreFiltersFromStorage() : null;
  var dep = {};
  if (saved && saved.proyecto) {
    dep.proyecto = saved.proyecto;
  }
  await loadFilters(Object.keys(dep).length ? dep : null);

  if (saved) {
    ['proyecto', 'plano', 'sector', 'piso', 'ciclo'].forEach(function(field) {
      var element = document.getElementById(field);
      if (element && saved[field]) {
        element.value = saved[field];
      }
    });
    if (saved.proyecto) {
      await loadCargasDropdown(saved.proyecto);
    }
    if (saved.filtroCarga) {
      var filtroCarga = document.getElementById('filtroCarga');
      if (filtroCarga) {
        filtroCarga.value = saved.filtroCarga;
      }
    }
  }

  await loadCargas();
  await loadDashboard('sector');
  await loadSectores();
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
