// ArmaHub Reclamos — Detail View: Permisos / visibilidad (Fase 2 del refactor)
// Decide qué secciones, botones y campos del modal de ficha se muestran o
// quedan read-only, según rol, estado del reclamo y contexto (listado vs
// sub-tab Validaciones). Genérico: una sola fuente de verdad de permisos.
//
// Reglas clave:
//  - El formulario de datos/análisis solo es editable en abierto/en_analisis.
//    Fuera de esa etapa, read-only para TODOS (admin incluido); hay que Reabrir.
//  - Las secciones de flujo ámbar/verde solo aparecen estando en el sub-tab
//    Validaciones (se deriva del DOM: recSubValidaciones visible), nunca en el
//    listado oficial.
//
// Dependencias (file-scope global): currentRole, currentUserEmail.

function _applyReclamoDetailPermissions(data) {
  var esCreador = data.creado_por && data.creado_por === currentUserEmail;
  var esPropioCub = data.cubicador_asignado === currentUserEmail || data.respuesta_por === currentUserEmail;
  var validado = !!data.validacion_resultado;
  var estadoPermiteAnalisis = data.estado === 'abierto' || data.estado === 'en_analisis';

  // Edición de datos del reclamo (sección 1: título, proyecto, etc.) solo en
  // análisis. Fuera de esa etapa, read-only para todos (hay que Reabrir).
  var puedeEditarSec1 = ((currentRole === 'admin' || currentRole === 'admin_calidad') || (currentRole === 'usc' && esCreador && data.estado === 'abierto')) && estadoPermiteAnalisis;
  var btnEditar = document.getElementById('btnEditarReclamo');
  if (btnEditar) btnEditar.style.display = puedeEditarSec1 ? '' : 'none';

  var selAplica = document.getElementById('recDetailAplica');
  var puedeCambiarAplica =
    (((currentRole === 'admin' || currentRole === 'admin_calidad') ||
    ((['externo','miembro','jefe_servicio'].includes(currentRole)) && esPropioCub))) && estadoPermiteAnalisis;
  if (selAplica) selAplica.disabled = !puedeCambiarAplica;

  var puedeEliminar = (currentRole === 'admin' || currentRole === 'admin_calidad') || (currentRole === 'usc' && esCreador);
  var btnElim = document.getElementById('btnEliminarReclamo');
  if (btnElim) btnElim.style.display = puedeEliminar ? '' : 'none';

  // --- Botones de flujo en el modal ---
  var esAsignado = (['externo','miembro','jefe_servicio'].includes(currentRole) && esPropioCub);
  var estadoEnTrabajo = (data.estado === 'abierto' || data.estado === 'en_analisis');
  var estadoEnRevision = (data.estado === 'en_revision');
  var estadoEnValidacion = (data.estado === 'validacion');
  var estaCerrado = (data.estado === 'cerrado' || data.estado === 'rechazado');
  var puedeAdmin = (currentRole === 'admin' || currentRole === 'admin_calidad');
  var puedeReabrir = estaCerrado && puedeAdmin;

  // 1) "Enviar a revisión/validación": responsable trabajando el reclamo
  var puedeEnviarARevision = esAsignado && estadoEnTrabajo;
  var cerrarCont = document.getElementById('recCerrarContainer');
  if (cerrarCont) cerrarCont.style.display = (puedeEnviarARevision || (puedeAdmin && estadoEnTrabajo) || puedeReabrir) ? '' : 'none';
  var btnCerrar = document.getElementById('btnCerrarReclamo');
  if (btnCerrar) {
    if (puedeAdmin && estadoEnTrabajo) {
      btnCerrar.style.display = '';
      btnCerrar.textContent = '📤 Enviar a validación';
    } else if (puedeEnviarARevision) {
      btnCerrar.style.display = '';
      btnCerrar.textContent = '📤 Enviar a revisión';
    } else {
      btnCerrar.style.display = 'none';
    }
  }
  var btnReabrir = document.getElementById('btnReabrirReclamo');
  if (btnReabrir) btnReabrir.style.display = puedeReabrir ? '' : 'none';

  // Las secciones de acción de flujo (ámbar/verde) SOLO se muestran cuando el modal
  // se abrió estando en el sub-tab Validaciones. En Reclamos Clientes (listado
  // oficial) NUNCA aparecen, en ningún estado: es solo lectura/registro.
  //
  // El contexto se deriva del DOM real (¿está visible el sub-tab Validaciones?),
  // NO de una variable de estado que se pueda quedar pegada entre aperturas. Si
  // recSubValidaciones está oculto, estás en otro sub-tab → sin secciones de flujo.
  var subVal = document.getElementById('recSubValidaciones');
  var enContextoValidaciones = !!(subVal && subVal.style.display !== 'none');

  // 2) Sección ÁMBAR (revisión): Jefe de Servicio (admin) con reclamo en en_revision
  var puedeRevisar = enContextoValidaciones && (currentRole === 'admin') && estadoEnRevision;
  var secRevision = document.getElementById('recSeccionRevision');
  if (secRevision) secRevision.style.display = puedeRevisar ? '' : 'none';

  // 3) Sección VERDE (validación): Calidad (admin/admin_calidad) con reclamo en validacion
  var puedeValidarCalidad = enContextoValidaciones && puedeAdmin && estadoEnValidacion;
  var secValidacion = document.getElementById('recSeccionValidacion');
  if (secValidacion) secValidacion.style.display = puedeValidarCalidad ? '' : 'none';

  var anioCalField = document.getElementById('recDetailAnioCalidad');
  if (anioCalField) anioCalField.disabled = !(currentRole === 'admin' || currentRole === 'admin_calidad');
  var numCalField = document.getElementById('recDetailNumeroCalidad');
  if (numCalField) numCalField.disabled = !puedeEditarSec1;

  // Obra en el header: SIEMPRE texto plano (nunca desplegable), igual que el
  // resto del header. Cambiar la obra se hace entrando a Editar, no desde aquí.
  var detProySel = document.getElementById('recDetailProyecto');
  var detProyDisplay = document.getElementById('recDetailProyectoDisplay');
  if (detProySel) detProySel.style.display = 'none';
  if (detProyDisplay) detProyDisplay.style.display = '';

  // Header del detalle — la reasignación (USC en externos, Área en internos) se
  // hace SIEMPRE entrando a Editar, no desde el header. Por eso el selector USC
  // del header se oculta. En internos se muestra el ÁREA como texto informativo.
  var esInternoDet = data.tipo_origen === 'interno';
  var detAsigWrap = document.getElementById('recDetailAsignadoAWrap');
  if (detAsigWrap) detAsigWrap.style.display = 'none';
  var detAreaWrapDisp = document.getElementById('recDetailAreaWrapDisplay');
  if (detAreaWrapDisp) detAreaWrapDisp.style.display = esInternoDet ? 'flex' : 'none';

  // El formulario de datos (análisis/respuesta) solo es editable mientras el
  // reclamo está EN ANÁLISIS (abierto/en_analisis). Una vez enviado a revisión
  // o validación, queda READ-ONLY PARA TODOS los roles, admin incluido: está en
  // otra etapa. Para volver a editar hay que Reabrir (vuelve a en_analisis).
  var puedeResponder = ['admin','admin_calidad','externo','miembro','jefe_servicio'].includes(currentRole);
  if ((['externo','miembro','jefe_servicio'].includes(currentRole)) && !esPropioCub) puedeResponder = false;
  if (!estadoPermiteAnalisis) puedeResponder = false;
  var sec2Fields = ['recDetailRespuestaTexto','recDetailCausaDisplay','recDetailAreaAplica','recDetailFechaAnalisis','recDetailKilosMal','recTiempoRespuestaAnalisis','recTiempoRespuestaUnidadAnalisis'];
  sec2Fields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeResponder; });
  // Bloquear selector de método RCA (Ishikawa / 5 por qué) y botón buscar Ishikawa.
  // El radio/botón de Ishikawa además se deshabilita si el área no tiene matriz
  // (lo decide _initRcaMetodoParaReclamo y lo deja en window._areaSinMatrizIshikawa).
  var sinMatrizIsh = (typeof window._areaSinMatrizIshikawa !== 'undefined') ? window._areaSinMatrizIshikawa : false;
  document.querySelectorAll('input[name="recMetodoRca"]').forEach(function(el) {
    var esIsh = el.value === 'ishikawa';
    el.disabled = !puedeResponder || (esIsh && sinMatrizIsh);
  });
  var btnIshikawa = document.getElementById('btnAbrirIshikawa');
  if (btnIshikawa) btnIshikawa.disabled = !puedeResponder || sinMatrizIsh;
  // Bloquear controles de 5 por qué
  var btn5PQ = document.getElementById('rec5PQAgregarBtn');
  if (btn5PQ) btn5PQ.disabled = !puedeResponder;
  document.querySelectorAll('#rec5PQItems input, #rec5PQItems textarea').forEach(function(el) { el.disabled = !puedeResponder; });
  var btnGuardarResp = document.getElementById('btnGuardarRespuesta');
  if (btnGuardarResp) btnGuardarResp.style.display = puedeResponder ? '' : 'none';
  var btnClearCausa = document.getElementById('recBtnClearCausa');
  if (btnClearCausa) btnClearCausa.style.display = puedeResponder ? '' : 'none';
  var respDropZone = document.getElementById('recRespDropZone');
  var respFileInput = document.getElementById('recRespFileInput');
  if (respDropZone) respDropZone.style.display = puedeResponder ? '' : 'none';
  if (respFileInput) respFileInput.disabled = !puedeResponder;

  // Acciones (medidas correctivas): mismo criterio que el formulario de datos —
  // solo editables en análisis. Fuera de esa etapa quedan read-only para todos.
  var puedeAccion = ['admin','admin_calidad','externo','miembro','jefe_servicio'].includes(currentRole);
  if ((['externo','miembro','jefe_servicio'].includes(currentRole)) && !esPropioCub) puedeAccion = false;
  if (!estadoPermiteAnalisis) puedeAccion = false;
  var accionFields = ['recNuevaAccionTipo','recNuevaAccionDesc','recNuevaAccionRespSearch','recNuevaAccionFecha'];
  accionFields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeAccion; });

  // Imágenes de registro: solo admin/admin_calidad/usc
  var puedeImgRegistro = ['admin','admin_calidad','usc'].includes(currentRole);
  var detDropZone = document.getElementById('recDetailDropZone');
  var detFileInput = document.getElementById('recDetailFileInput');
  if (detDropZone) detDropZone.style.display = puedeImgRegistro ? '' : 'none';
  if (detFileInput) detFileInput.disabled = !puedeImgRegistro;

  // PDF export: admin, admin_calidad, usc, y miembro (en reclamos propios)
  var puedePdf = ['admin','admin_calidad'].includes(currentRole) || (currentRole === 'usc') || (currentRole === 'miembro' && esPropioCub);
  var btnPdf = document.getElementById('btnPdfReclamo');
  if (btnPdf) btnPdf.style.display = puedePdf ? '' : 'none';

  // Enviar informe por correo: el envío se CENTRALIZA en Calidad → Mailing →
  // "Cierre Reclamos" (decisión 2026-06-17). El botón del detalle queda oculto.
  var btnEnviar = document.getElementById('btnEnviarReclamo');
  if (btnEnviar) btnEnviar.style.display = 'none';
}
