(function(global) {
  async function setGlobalStatus(text, kind) {
    var statusKind = kind || 'info';
    var el = document.getElementById('globalStatus');
    if (!el) return;
    el.className = statusKind === 'ok' ? 'status-ok' : statusKind === 'err' ? 'status-err' : statusKind === 'warn' ? 'status-warn' : 'muted';
    el.textContent = text || '';
  }

  class DOMHelper {
    constructor() {
      this.cache = new Map();
      this.missingElements = new Set();
      this.prefix = 'pres';
      this.elements = {
        reclamoSelect: 'presReclamoSelect',
        antecedentes: 'presAntecedentes',
        registroCard: 'presRegistroCard',
        yaPresentado: 'presYaPresentado',
        correlativo: 'presCorrelativo',
        proyecto: 'presProyecto',
        cubicador: 'presCubicador',
        estado: 'presEstado',
        aplica: 'presAplica',
        titulo: 'presTitulo',
        tipo: 'presTipo',
        detectado: 'presDetectado',
        fecha: 'presFecha',
        descripcion: 'presDescripcion',
        responsable: 'presResponsable',
        prioridad: 'presPrioridad',
        idCalidad: 'presIdCalidad',
        observaciones: 'presObservaciones',
        ishikawa: 'presIshikawa',
        area: 'presArea',
        respuesta: 'presRespuesta',
        fechaAnalisis: 'presFechaAnalisis',
        respondidoPor: 'presRespondidoPor',
        fechaRespuesta: 'presFechaRespuesta',
        imagenesReclamo: 'presImagenesReclamo',
        imagenesRespuesta: 'presImagenesRespuesta',
        yaFecha: 'presYaFecha',
        yaPor: 'presYaPor',
        yaAsistentes: 'presYaAsistentes',
        yaComentarios: 'presYaComentarios',
        asistentesCheckboxes: 'presAsistentesCheckboxes',
        comentarios: 'presComentarios',
        guardarBtn: 'presGuardarBtn',
        guardarMsg: 'presGuardarMsg',
        acciones: 'presAcciones'
      };
    }

    get(elementKey) {
      if (this.cache.has(elementKey)) {
        return this.cache.get(elementKey);
      }

      var elementId = this.elements[elementKey];
      if (!elementId) {
        console.warn('[DOMHelper] Elemento no definido:', elementKey);
        return null;
      }

      var element = document.getElementById(elementId);
      if (element) {
        this.cache.set(elementKey, element);
        return element;
      }

      if (!this.missingElements.has(elementKey)) {
        console.warn('[DOMHelper] Elemento no encontrado en DOM:', elementId);
        this.missingElements.add(elementKey);
      }
      return null;
    }

    show(elementKey, display) {
      var element = this.get(elementKey);
      if (element) {
        element.style.display = display || 'block';
      }
    }

    hide(elementKey) {
      var element = this.get(elementKey);
      if (element) {
        element.style.display = 'none';
      }
    }

    setText(elementKey, text) {
      var element = this.get(elementKey);
      if (element) {
        element.textContent = text;
      }
    }

    setValue(elementKey, value) {
      var element = this.get(elementKey);
      if (element) {
        element.value = value;
      }
    }

    getValue(elementKey) {
      var element = this.get(elementKey);
      return element ? element.value : null;
    }

    clearCache() {
      this.cache.clear();
      this.missingElements.clear();
      console.log('[DOMHelper] Cache limpiado');
    }

    debugCache() {
      console.log('[DOMHelper] Cache:', Array.from(this.cache.keys()));
      console.log('[DOMHelper] Elementos faltantes:', Array.from(this.missingElements));
    }
  }

  global.setGlobalStatus = setGlobalStatus;
  global.DOMHelper = DOMHelper;
  global.domHelper = new DOMHelper();
  global.ArmaHubDom = {
    setGlobalStatus: setGlobalStatus,
    DOMHelper: DOMHelper,
    domHelper: global.domHelper
  };
})(window);