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
    ((currentRole === 'cubicador' || currentRole === 'externo') && esPropioCub))) && estadoPermiteAnalisis;
  if (selAplica) selAplica.disabled = !puedeCambiarAplica;

  var puedeEliminar = (currentRole === 'admin' || currentRole === 'admin_calidad') || (currentRole === 'usc' && esCreador);
  var btnElim = document.getElementById('btnEliminarReclamo');
  if (btnElim) btnElim.style.display = puedeEliminar ? '' : 'none';

  // --- Botones de flujo en el modal ---
  var esAsignado = (['cubicador','externo'].includes(currentRole) && esPropioCub);
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

  var detProySel = document.getElementById('recDetailProyecto');
  if (detProySel) detProySel.disabled = !puedeEditarSec1;

  var detAsigSel = document.getElementById('recDetailAsignadoA');
  if (detAsigSel) detAsigSel.disabled = !(currentRole === 'admin' || currentRole === 'admin_calidad');

  // El formulario de datos (análisis/respuesta) solo es editable mientras el
  // reclamo está EN ANÁLISIS (abierto/en_analisis). Una vez enviado a revisión
  // o validación, queda READ-ONLY PARA TODOS los roles, admin incluido: está en
  // otra etapa. Para volver a editar hay que Reabrir (vuelve a en_analisis).
  var puedeResponder = ['admin','admin_calidad','cubicador','externo'].includes(currentRole);
  if ((['cubicador','externo'].includes(currentRole)) && !esPropioCub) puedeResponder = false;
  if (!estadoPermiteAnalisis) puedeResponder = false;
  var sec2Fields = ['recDetailRespuestaTexto','recDetailCausaDisplay','recDetailAreaAplica','recDetailFechaAnalisis','recDetailKilosMal','recTiempoRespuestaAnalisis','recTiempoRespuestaUnidadAnalisis'];
  sec2Fields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeResponder; });
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
  var puedeAccion = ['admin','admin_calidad','cubicador','externo'].includes(currentRole);
  if ((['cubicador','externo'].includes(currentRole)) && !esPropioCub) puedeAccion = false;
  if (!estadoPermiteAnalisis) puedeAccion = false;
  var accionFields = ['recNuevaAccionTipo','recNuevaAccionDesc','recNuevaAccionRespSearch','recNuevaAccionFecha'];
  accionFields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeAccion; });

  // Imágenes de registro: solo admin/admin_calidad/usc
  var puedeImgRegistro = ['admin','admin_calidad','usc'].includes(currentRole);
  var detDropZone = document.getElementById('recDetailDropZone');
  var detFileInput = document.getElementById('recDetailFileInput');
  if (detDropZone) detDropZone.style.display = puedeImgRegistro ? '' : 'none';
  if (detFileInput) detFileInput.disabled = !puedeImgRegistro;

  // PDF export: admin, admin_calidad, cubicador (propios), usc
  var puedePdf = ['admin','admin_calidad'].includes(currentRole) || (currentRole === 'usc') || (currentRole === 'cubicador' && esPropioCub);
  var btnPdf = document.getElementById('btnPdfReclamo');
  if (btnPdf) btnPdf.style.display = puedePdf ? '' : 'none';

  // Email placeholder: admin, admin_calidad only
  var btnEnviar = document.getElementById('btnEnviarReclamo');
  if (btnEnviar) btnEnviar.style.display = ['admin','admin_calidad'].includes(currentRole) ? '' : 'none';
}
