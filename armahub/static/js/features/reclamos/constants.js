// ArmaHub Reclamos — Constants & State
// Split from index.js (PC.17.1)

var _reclamoActual = null;
var _ishikawaData = null;
var _ishikawaTarget = 'create';
var _ishikawaSelection = { categoria: '', sub_causa: '', cod_causa: '' };
var _reclamosListaIds = [];

var _FECHA_OPERATIVA = '2026-04-16';

var _recEstadoColors = {
  abierto: '#e53935', en_analisis: '#ff9800', en_revision: '#1976d2',
  validacion: '#7B1FA2', cerrado: '#4CAF50', rechazado: '#9E9E9E'
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
