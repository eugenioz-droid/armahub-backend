// ArmaHub Reclamos — Constants & State
// Split from index.js (PC.17.1)

var _reclamoActual = null;
var _ishikawaData = null;
var _ishikawaTarget = 'create';
var _ishikawaSelection = { categoria: '', sub_causa: '', cod_causa: '' };
var _reclamosListaIds = [];

var _FECHA_OPERATIVA = '2026-04-16';

// LOS COLORES DE ESTADO (11-nov, Sistema de Diseño Armacero; ver SPECS §2.4). Abierto en
// NARANJA y no en rojo: un reclamo abierto pide atención pero no es un error; el rojo queda
// para lo que urge (prioridad alta, tipo error, atraso). El usuario aprobó la tabla. Es la
// misma que usan el informe PDF y el resumen del Hub: si se cambia acá, cambiarla allá.
var _recEstadoColors = {
  abierto: '#D97706', en_analisis: '#1769C2', en_revision: '#1769C2',
  validacion: '#7E36B1', cerrado: '#248447', rechazado: '#667085'
};
var _recEstadoLabels = {
  abierto: 'Abierto', en_analisis: 'En análisis', en_revision: 'En revisión',
  validacion: 'En validación', cerrado: 'Cerrado', rechazado: 'Rechazado'
};
var _recPrioridadColors = {
  baja: '#9E9E9E', media: '#ff9800', alta: '#e53935', critica: '#b71c1c'
};
var _recPrioridadLabels = {
  baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica'
};
var _recIshikawaLabels = {
  mano_de_obra: 'Personas (Mano de obra)', metodo: 'Método', material: 'Material',
  maquina: 'Máquina', medicion: 'Medida', medio_ambiente: 'Medio Ambiente'
};
var _recAplicaLabels = { si: 'Sí aplica', no: 'No aplica', pendiente: 'Pendiente' };
var _recAplicaColors = { si: '#e53935', no: '#4CAF50', pendiente: '#ff9800' };

// Categorías de reclamo (tipo_reclamo). Catálogo ampliable (5L.6).
var _recTipoReclamoLabels = {
  error: 'Error', faltante: 'Faltante', atraso: 'Atraso',
  actualizacion_portal: 'Actualización Portal', documentacion: 'Documentación',
  stock: 'Stock', programacion: 'Programación', diferencia_kg: 'Diferencia de Kilogramos'
};
var _recTipoReclamoColors = {
  error: '#e53935', faltante: '#ff9800', atraso: '#8e24aa',
  actualizacion_portal: '#1976d2', documentacion: '#00897b',
  stock: '#6d4c41', programacion: '#5e35b1', diferencia_kg: '#c62828'
};
function _recTipoLabel(t) { return _recTipoReclamoLabels[t] || t || 'Error'; }
function _recTipoColor(t) { return _recTipoReclamoColors[t] || '#e53935'; }
var _recAccionTipoColors = { inmediata: '#e53935', correctiva: '#2196F3', preventiva: '#4CAF50' };
var _ishikawaCatColors = {
  medio_ambiente: '#26A69A', material: '#5C6BC0', maquina: '#EF5350',
  medicion: '#AB47BC', metodo: '#FFA726', mano_de_obra: '#42A5F5'
};

var _recCatColors = {
  mano_de_obra: '#42A5F5', metodo: '#FFA726', material: '#66BB6A',
  maquina: '#EF5350', medicion: '#AB47BC', medio_ambiente: '#26A69A',
  sin_categoria: '#BDBDBD'
};
var _recCatLabels = {
  mano_de_obra: 'Personas', metodo: 'Método', material: 'Material',
  maquina: 'Máquina', medicion: 'Medida', medio_ambiente: 'Medio Amb.',
  sin_categoria: 'Sin cat.'
};
