// =============================================================================
// GENERADO — no editar a mano; regenerar con python tests/gen_catalogo_figuras.py
// =============================================================================
// Modelador 3D — ESPEJO ESTÁTICO DEL CATÁLOGO DE FIGURAS (TANDA 2 · T7.1)
//
// FUENTE ÚNICA de parciales/ángulos/radio para el motor (generar.js,
// figura_puntos.js, reglas.js) y para los tests headless. Espejo 1:1 de
// armahub/catalogo.py (_FIGURAS_SEED + tipologías), o sea de lo mismo que el
// backend siembra en figuras_catalogo y sirve por GET /figuras-catalogo.
//
// POR QUÉ EXISTE: antes cada consumidor llevaba su propia tablita a mano
// (generar.js conocía 5 figuras, el editor 8, el catálogo real tiene 63) y
// además con datos EQUIVOCADOS (106A: 4 parciales con ángulos 135/135 cuando el
// catálogo dice 6 parciales A–F con 45/45). Consecuencia: dibujar una figura
// fuera de la lista salía en el 3D pero el payload iba con dims null → 0 kg y
// el backend la rechazaba. Una sola tabla, generada, no se puede desincronizar.
//
// EN EL NAVEGADOR: la UI hace GET /figuras-catalogo al abrir el editor y llama
// `ModeladorCatalogoFiguras.actualizar(data)`. La data fresca PISA el espejo en
// memoria (mismo objeto FIGURAS, mutado in place). El espejo estático es el
// fallback siempre disponible: sin red / sin sesión el motor sigue calculando
// bien. `esFresco()` dice cuál de las dos está activa.
//
// LA CLASIFICACIÓN DE DIBUJO NO VIVE ACÁ: qué figura sabe dibujar el editor y
// con qué constructor (recta / cabezal con patas / estribo / traba) lo decide
// figura_puntos.js (`dibujabilidad`, `familiaDeDibujo`), que es el módulo que
// dibuja. Acá sólo se re-expone `noDibujables()` por comodidad del llamador.
// =============================================================================
(function (global) {
  'use strict';

  var VERSION = '2026-08-26';   // fecha en que se generó el espejo
  var SHA = '9754897b8c4d';           // huella de la data del seed (detecta desfases)
  var FUENTE = 'armahub/catalogo.py::_FIGURAS_SEED';

  // ---------------------------------------------------------------------------
  // DATA GENERADA — INICIO (no editar)
  // ---------------------------------------------------------------------------
  // codigo → { codigo, parciales:[letras A..I], angulos:[grados], radio, descripcion }
  // `parciales` = los lados/slots dim_x que la figura USA (el backend valida que
  // estén EXACTAMENTE esos y el largo es su suma). `angulos` = los N ángulos que
  // la figura declara (van a ang1..angN; el resto queda vacío).
  var FIGURAS = {
    '101A': { codigo: '101A', parciales: ['A'], angulos: [], radio: false, descripcion: null },
    '102A': { codigo: '102A', parciales: ['A', 'B'], angulos: [], radio: false, descripcion: null },
    '102B': { codigo: '102B', parciales: ['A', 'B'], angulos: [135], radio: false, descripcion: null },
    '102C': { codigo: '102C', parciales: ['A', 'B'], angulos: [45], radio: false, descripcion: null },
    '103A': { codigo: '103A', parciales: ['A', 'B', 'C'], angulos: [], radio: false, descripcion: null },
    '103B': { codigo: '103B', parciales: ['A', 'B', 'C'], angulos: [45, 45], radio: false, descripcion: null },
    '103C': { codigo: '103C', parciales: ['A', 'B', 'C'], angulos: [45], radio: false, descripcion: null },
    '103D': { codigo: '103D', parciales: ['A', 'B', 'C'], angulos: [135], radio: false, descripcion: null },
    '103E': { codigo: '103E', parciales: ['A', 'B', 'C'], angulos: [135, 135], radio: false, descripcion: null },
    '103F': { codigo: '103F', parciales: ['A', 'B', 'C'], angulos: [135, 45], radio: false, descripcion: null },
    '103G': { codigo: '103G', parciales: ['A', 'B', 'C'], angulos: [], radio: false, descripcion: null },
    '103H': { codigo: '103H', parciales: ['A', 'B', 'C'], angulos: [135, 135], radio: false, descripcion: null },
    '103I': { codigo: '103I', parciales: ['A', 'B', 'C'], angulos: [135], radio: false, descripcion: null },
    '103J': { codigo: '103J', parciales: ['A', 'B', 'C'], angulos: [135, 45], radio: false, descripcion: null },
    '103K': { codigo: '103K', parciales: ['A', 'B', 'C'], angulos: [45], radio: false, descripcion: null },
    '103L': { codigo: '103L', parciales: ['A', 'B', 'C'], angulos: [45, 45], radio: false, descripcion: null },
    '104A': { codigo: '104A', parciales: ['A', 'B', 'C', 'D'], angulos: [], radio: false, descripcion: null },
    '104B': { codigo: '104B', parciales: ['A', 'B', 'C', 'D'], angulos: [45, 45], radio: false, descripcion: null },
    '104C': { codigo: '104C', parciales: ['A', 'B', 'C', 'D'], angulos: [45], radio: false, descripcion: null },
    '104D': { codigo: '104D', parciales: ['A', 'B', 'C', 'D'], angulos: [135, 135], radio: false, descripcion: null },
    '104E': { codigo: '104E', parciales: ['A', 'B', 'C', 'D'], angulos: [135], radio: false, descripcion: null },
    '104F': { codigo: '104F', parciales: ['A', 'B', 'C', 'D'], angulos: [135], radio: false, descripcion: null },
    '104G': { codigo: '104G', parciales: ['A', 'B', 'C', 'D'], angulos: [], radio: false, descripcion: null },
    '104H': { codigo: '104H', parciales: ['A', 'B', 'C', 'D'], angulos: [135, 45], radio: false, descripcion: null },
    '104I': { codigo: '104I', parciales: ['A', 'B', 'C', 'D'], angulos: [135, 45], radio: false, descripcion: null },
    '104J': { codigo: '104J', parciales: ['A', 'B', 'C', 'D'], angulos: [45], radio: false, descripcion: null },
    '104K': { codigo: '104K', parciales: ['A', 'B', 'C', 'D'], angulos: [45], radio: false, descripcion: null },
    '104L': { codigo: '104L', parciales: ['A', 'B', 'C', 'D'], angulos: [45, 45], radio: false, descripcion: null },
    '104M': { codigo: '104M', parciales: ['A', 'B', 'C', 'D'], angulos: [135], radio: false, descripcion: null },
    '104N': { codigo: '104N', parciales: ['A', 'B', 'C', 'D'], angulos: [], radio: false, descripcion: null },
    '104O': { codigo: '104O', parciales: ['A', 'B', 'C', 'D'], angulos: [135, 135], radio: false, descripcion: null },
    '104P': { codigo: '104P', parciales: ['A', 'B', 'C', 'D'], angulos: [135, 135], radio: false, descripcion: null },
    '104Q': { codigo: '104Q', parciales: ['A', 'B', 'C', 'D'], angulos: [135], radio: false, descripcion: null },
    '104R': { codigo: '104R', parciales: ['A', 'B', 'C', 'D'], angulos: [45, 135], radio: false, descripcion: null },
    '104S': { codigo: '104S', parciales: ['A', 'B', 'C', 'D'], angulos: [45, 135], radio: false, descripcion: null },
    '104T': { codigo: '104T', parciales: ['A', 'B', 'C', 'D'], angulos: [45], radio: false, descripcion: null },
    '104U': { codigo: '104U', parciales: ['A', 'B', 'C', 'D'], angulos: [45, 45], radio: false, descripcion: null },
    '105A': { codigo: '105A', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [], radio: false, descripcion: null },
    '105B': { codigo: '105B', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [45], radio: false, descripcion: null },
    '105C': { codigo: '105C', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [45, 45], radio: false, descripcion: null },
    '105D': { codigo: '105D', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [], radio: false, descripcion: null },
    '105E': { codigo: '105E', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [], radio: false, descripcion: null },
    '105F': { codigo: '105F', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [135], radio: false, descripcion: null },
    '105G': { codigo: '105G', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [135], radio: false, descripcion: null },
    '105H': { codigo: '105H', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [45], radio: false, descripcion: null },
    '105I': { codigo: '105I', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [135, 45], radio: false, descripcion: null },
    '105J': { codigo: '105J', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [135, 45], radio: false, descripcion: null },
    '105K': { codigo: '105K', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [45], radio: false, descripcion: null },
    '105L': { codigo: '105L', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [135, 135], radio: false, descripcion: null },
    '105M': { codigo: '105M', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [45, 45], radio: false, descripcion: null },
    '105N': { codigo: '105N', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [135, 135], radio: false, descripcion: null },
    '105O': { codigo: '105O', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [135], radio: false, descripcion: null },
    '105P': { codigo: '105P', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [45, 135], radio: false, descripcion: null },
    '105Q': { codigo: '105Q', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [135, 135], radio: false, descripcion: null },
    '105R': { codigo: '105R', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [135], radio: false, descripcion: null },
    '105S': { codigo: '105S', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [45, 135], radio: false, descripcion: null },
    '105T': { codigo: '105T', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [45], radio: false, descripcion: null },
    '106A': { codigo: '106A', parciales: ['A', 'B', 'C', 'D', 'E', 'F'], angulos: [45, 45], radio: false, descripcion: null },
    '106B': { codigo: '106B', parciales: ['A', 'B', 'C', 'D', 'E', 'F'], angulos: [45], radio: false, descripcion: null },
    '106C': { codigo: '106C', parciales: ['A', 'B', 'C', 'D', 'E', 'F'], angulos: [], radio: false, descripcion: null },
    '106D': { codigo: '106D', parciales: ['A', 'B', 'C', 'D', 'E', 'F'], angulos: [], radio: false, descripcion: null },
    '201A': { codigo: '201A', parciales: ['B', 'G', 'H'], angulos: [], radio: true, descripcion: null },
    '305A': { codigo: '305A', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [], radio: false, descripcion: null },
  };

  // estructura → [{ codigo, nombre }]
  var TIPOLOGIAS = {
    'MURO': [{ codigo: 'MH', nombre: 'Malla Horizontal' }, { codigo: 'MV', nombre: 'Malla Vertical' }, { codigo: 'TR', nombre: 'Traba Muro' }, { codigo: 'EC', nombre: 'Estribo Confinamiento' }, { codigo: 'TC', nombre: 'Traba Confinamiento' }, { codigo: 'CB', nombre: 'Cabezal' }],
    'LOSA': [{ codigo: 'Fi', nombre: 'Malla Inferior i' }, { codigo: 'Fs', nombre: 'Malla Inferior s' }, { codigo: 'F\'i', nombre: 'Malla Superior i' }, { codigo: 'F\'s', nombre: 'Malla Superior s' }, { codigo: 'F', nombre: 'Refuerzo o Suple Inferior' }, { codigo: 'F\'', nombre: 'Refuerzo o Suple Superior' }, { codigo: 'SP', nombre: 'Soporte Losa' }, { codigo: 'Rp', nombre: 'Reparticion' }, { codigo: 'TRL', nombre: 'Traba Losa' }],
    'VIGA': [{ codigo: 'CBS', nombre: 'Cabezal Superior primera capa' }, { codigo: 'CBS2', nombre: 'Cabezal Superior segunda capa' }, { codigo: 'CBSn', nombre: 'Cabezal Superior n capa' }, { codigo: 'CBI', nombre: 'Cabezal Inferior primera capa' }, { codigo: 'CBI2', nombre: 'Cabezal Inferior segunda capa' }, { codigo: 'CBIn', nombre: 'Cabezal Inferior n capa' }, { codigo: 'LT', nombre: 'Lateral' }, { codigo: 'ES', nombre: 'Estribo' }, { codigo: 'TRV', nombre: 'Traba Viga' }],
    'COLUMNA': [{ codigo: 'CB', nombre: 'Cabezal' }, { codigo: 'CB2', nombre: 'Cabezal 2' }, { codigo: 'CBn', nombre: 'Cabezal n' }, { codigo: 'TRC', nombre: 'Traba Columna' }, { codigo: 'ESC', nombre: 'Estribo Columna' }],
    'FUNDACION': [{ codigo: 'Fi', nombre: 'Malla Inferior i' }, { codigo: 'Fs', nombre: 'Malla Inferior s' }, { codigo: 'F\'i', nombre: 'Malla Superior i' }, { codigo: 'F\'s', nombre: 'Malla Superior s' }, { codigo: 'SPF', nombre: 'Soporte Fundacion' }, { codigo: 'TRF', nombre: 'Traba Fundacion' }],
    'GEN': [{ codigo: 'CB', nombre: 'Cabezal' }, { codigo: 'F', nombre: 'Refuerzo o Suple Inferior' }, { codigo: 'F\'', nombre: 'Refuerzo o Suple Superior' }],
  };

  // 'ESTRUCTURA-CODIGO' → [figuras aplicables]
  var FIGURAS_POR_TIPOLOGIA = {
    'MURO-MH': ['101A', '102A', '102B', '102C', '103A', '103G'],
    'MURO-MV': ['101A', '102A', '102B', '102C', '103A', '103G'],
    'MURO-TR': ['101A', '102A', '103A', '104A'],
    'MURO-EC': ['103H', '103E', '104D', '104O', '104P'],
    'MURO-TC': ['101A', '102A', '102B', '102C'],
    'MURO-CB': ['101A', '102A', '102B', '102C', '103A', '103B'],
    'LOSA-Fi': ['101A', '102A', '103A', '104A', '105A'],
    'LOSA-Fs': ['101A', '102A', '103A', '104A', '105A'],
    'LOSA-F\'i': ['101A', '102A', '103A', '104A', '105A'],
    'LOSA-F\'s': ['101A', '102A', '103A', '104A', '105A'],
    'LOSA-F': ['101A', '102A', '103A'],
    'LOSA-F\'': ['101A', '102A', '103A'],
    'LOSA-SP': ['101A'],
    'LOSA-Rp': ['101A', '102A'],
    'LOSA-TRL': ['101A', '102A', '103A', '104A'],
    'VIGA-CBS': ['101A', '102A', '102B', '102C', '103A', '103B', '103C', '103D'],
    'VIGA-CBS2': ['101A', '102A', '102B', '102C', '103A'],
    'VIGA-CBSn': ['101A', '102A', '102B', '102C', '103A'],
    'VIGA-CBI': ['101A', '102A', '102B', '102C', '103A', '103B', '103C', '103D'],
    'VIGA-CBI2': ['101A', '102A', '102B', '102C', '103A'],
    'VIGA-CBIn': ['101A', '102A', '102B', '102C', '103A'],
    'VIGA-LT': ['101A', '102A', '103A'],
    'VIGA-ES': ['103H', '103E', '104D', '104O', '104P'],
    'VIGA-TRV': ['101A', '102A'],
    'COLUMNA-CB': ['101A', '102A', '102B', '102C', '103A', '103B'],
    'COLUMNA-CB2': ['101A', '102A', '102B', '102C'],
    'COLUMNA-CBn': ['101A', '102A', '102B', '102C'],
    'COLUMNA-TRC': ['101A', '102A'],
    'COLUMNA-ESC': ['103H', '103E', '104D', '104O'],
    'FUNDACION-Fi': ['101A', '102A', '103A', '104A', '105A'],
    'FUNDACION-Fs': ['101A', '102A', '103A', '104A', '105A'],
    'FUNDACION-F\'i': ['101A', '102A', '103A', '104A', '105A'],
    'FUNDACION-F\'s': ['101A', '102A', '103A', '104A', '105A'],
    'FUNDACION-SPF': ['101A'],
    'FUNDACION-TRF': ['101A', '102A', '103A', '104A'],
    'GEN-CB': ['101A', '102A', '102B', '102C', '103A', '103B'],
    'GEN-F': ['101A', '102A', '103A'],
    'GEN-F\'': ['101A', '102A', '103A'],
  };
  // ---------------------------------------------------------------------------
  // DATA GENERADA — FIN
  // ---------------------------------------------------------------------------

  var _fresco = false;   // ¿la data en memoria vino del backend?

  function _norm(codigo) {
    return String(codigo == null ? '' : codigo).trim().toUpperCase();
  }

  // Spec de una figura, o null si NO está en el catálogo. Null es un dato: el
  // motor NO inventa un spec vacío (eso era lo que producía payloads con dims
  // null y 0 kg en silencio).
  function get(codigo) {
    var k = _norm(codigo);
    return (k && Object.prototype.hasOwnProperty.call(FIGURAS, k)) ? FIGURAS[k] : null;
  }

  function existe(codigo) { return get(codigo) !== null; }

  // Códigos en el orden del catálogo (orden de inserción del seed).
  function codigos() { return Object.keys(FIGURAS); }

  // Tipologías donde aplica una figura ('VIGA-ES', 'MURO-MH', …).
  function tipologiasDeFigura(codigo) {
    var k = _norm(codigo), out = [];
    for (var t in FIGURAS_POR_TIPOLOGIA) {
      if (!Object.prototype.hasOwnProperty.call(FIGURAS_POR_TIPOLOGIA, t)) continue;
      if (FIGURAS_POR_TIPOLOGIA[t].indexOf(k) >= 0) out.push(t);
    }
    return out;
  }

  // Figuras que el catálogo asocia a una tipología. `estructura` opcional:
  // figurasDeTipologia('VIGA','ES') o figurasDeTipologia('VIGA-ES').
  function figurasDeTipologia(estructura, codigo) {
    var clave = (codigo != null) ? (String(estructura) + '-' + String(codigo)) : String(estructura || '');
    var lista = FIGURAS_POR_TIPOLOGIA[clave.toUpperCase()] || FIGURAS_POR_TIPOLOGIA[clave] || [];
    return lista.slice();
  }

  // ---------------------------------------------------------------------------
  // DATA FRESCA DEL BACKEND
  // ---------------------------------------------------------------------------
  // `data` = la respuesta de GET /figuras-catalogo ({figuras:[…]}) o el array.
  // Reemplaza el contenido de FIGURAS IN PLACE (mismo objeto) para que cualquiera
  // que lo haya capturado siga viendo la verdad. Una respuesta VACÍA o inválida
  // NO pisa nada: mejor el espejo estático que un catálogo en blanco (que dejaría
  // toda figura como "desconocida").
  function _specDesde(f) {
    var cod = _norm(f && (f.codigo || f.code));
    if (!cod) return null;
    var par = [], ang = [], i;
    var pIn = (f && f.parciales) || [];
    for (i = 0; i < pIn.length; i++) { var L = _norm(pIn[i]); if (L) par.push(L); }
    var aIn = (f && f.angulos) || [];
    for (i = 0; i < aIn.length; i++) { var n = Number(aIn[i]); if (isFinite(n)) ang.push(n); }
    return {
      codigo: cod, parciales: par, angulos: ang, radio: !!(f && f.radio),
      descripcion: (f && f.descripcion != null) ? f.descripcion : null,
      geometria: (f && f.geometria != null) ? f.geometria : null,
      // RETIRADA DEL CATALOGO (26-ago, soft erase). Una figura obsoleta SIGUE
      // RESOLVIENDO -- hay recetas repuntadas a ella que tienen que poder dibujarse
      // y generar barras -- pero NO se ofrece en los selectores. Por eso el dato
      // viaja hasta aca en vez de filtrarse en el servidor: quien RESUELVE y quien
      // OFRECE son dos preguntas distintas, y este catalogo contesta las dos.
      // `activo` por defecto TRUE: el espejo estatico no trae el campo y todas sus
      // figuras estan vivas; leerlo como undefined las habria escondido a todas.
      activo: (f && f.activo != null) ? !!f.activo : true,
      obsoleta_de: (f && f.obsoleta_de != null) ? f.obsoleta_de : null
    };
  }

  function actualizar(data) {
    var lista = Array.isArray(data) ? data : ((data && data.figuras) || null);
    if (!lista || !lista.length) {
      return { ok: false, n: codigos().length, motivo: 'respuesta vacía: se conserva el espejo estático' };
    }
    var nuevo = {}, n = 0, k;
    for (var i = 0; i < lista.length; i++) {
      var s = _specDesde(lista[i]);
      if (s) { nuevo[s.codigo] = s; n++; }
    }
    if (!n) return { ok: false, n: codigos().length, motivo: 'ninguna figura utilizable en la respuesta' };
    var antes = codigos();
    for (k in FIGURAS) if (Object.prototype.hasOwnProperty.call(FIGURAS, k)) delete FIGURAS[k];
    for (k in nuevo) if (Object.prototype.hasOwnProperty.call(nuevo, k)) FIGURAS[k] = nuevo[k];
    _fresco = true;
    var perdidas = antes.filter(function (c) { return !Object.prototype.hasOwnProperty.call(FIGURAS, c); });
    return { ok: true, n: n, fuente: 'GET /figuras-catalogo', ya_no_estan: perdidas };
  }

  function esFresco() { return _fresco; }

  // ---------------------------------------------------------------------------
  // DIBUJABILIDAD — la decide figura_puntos.js (el módulo que dibuja). Acá sólo
  // se re-expone la lista negra ya resuelta contra el catálogo VIGENTE (o sea
  // que se recalcula sola cuando entra data fresca).
  // ---------------------------------------------------------------------------
  function _fp() {
    return global.ModeladorFiguraPuntos ||
      (typeof require !== 'undefined' ? require('./figura_puntos.js') : null);
  }

  // noDibujables()       → { codigo: motivo } de todo el catálogo vigente.
  // noDibujables(codigo) → motivo (string) o null si esa figura SÍ se dibuja.
  function noDibujables(codigo) {
    var fp = _fp();
    if (!fp || !fp.noDibujables) return (codigo != null) ? null : {};
    return fp.noDibujables(codigo);
  }

  // LO QUE SE PUEDE OFRECER. Fuera las RETIRADAS: siguen en FIGURAS para que las
  // recetas repuntadas resuelvan, pero elegir una figura obsoleta para una barra
  // NUEVA no tiene sentido -- se retiro justamente para dejar de usarse.
  // Este es el UNICO sitio donde se aplica el filtro: `get` y `FIGURAS` las
  // devuelven igual, y eso es lo que hace que el motor no se entere de nada.
  function dibujables() {
    var fp = _fp();
    var vivos = codigos().filter(function (c) {
      var f = FIGURAS[c];
      return !(f && (f.activo === false || f.obsoleta_de));
    });
    if (!fp || !fp.dibujabilidad) return vivos;
    return vivos.filter(function (c) { return fp.dibujabilidad(c).dibujable; });
  }

  // Las retiradas, para la pantalla que las lista ("visitarlas").
  function obsoletas() {
    return codigos().filter(function (c) {
      var f = FIGURAS[c];
      return !!(f && (f.obsoleta_de || f.activo === false));
    });
  }

  var API = {
    version: VERSION,
    sha: SHA,
    fuente: FUENTE,
    FIGURAS: FIGURAS,
    TIPOLOGIAS: TIPOLOGIAS,
    FIGURAS_POR_TIPOLOGIA: FIGURAS_POR_TIPOLOGIA,
    obsoletas: obsoletas,
    get: get,
    existe: existe,
    codigos: codigos,
    tipologiasDeFigura: tipologiasDeFigura,
    figurasDeTipologia: figurasDeTipologia,
    actualizar: actualizar,
    esFresco: esFresco,
    noDibujables: noDibujables,
    dibujables: dibujables
  };

  global.ModeladorCatalogoFiguras = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
