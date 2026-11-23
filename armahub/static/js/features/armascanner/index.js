/* armascanner/index.js — la caluga ArmaScanner (19-nov, SPECS §13).
 *
 * [Usuario 19-nov: «Más que pedidos enviados debiera ver sus obras y ojalá una línea por cada
 * carga de elemento constructivo… Con su cantidad de Items, kilos y lo típico que usamos. La
 * licencia capaz la dejamos acá, aquí buscamos un usuario existente y lo agregamos»]
 * [Usuario 22-nov: «un listado de obras con datos mínimos y KPIs… al hacer clic en una obra se abre
 * un modal»; los planos van dentro de cada obra]
 *
 * Pestañas (templates/tabs/armascanner.html):
 *   Mis obras  GET /armascanner/obras-linea   las obras con sus KPIs (kg, m², kg/m², PPI, Ø prom,
 *              fundaciones) y su tabla por piso; una obra abre su ventana: Planos (GET
 *              /armascanner/planos-linea?obra=: ver PDF —visor.js—, descargar DWG, ver barras, responder
 *              un pedido de reemplazo, enviar pedido, eliminar), Por piso, aSa (GET
 *              /armascanner/obras-linea/asa?obra=), Protocolo y Terreno (por hacer).
 *              «Agregar obra» (GET /armascanner/obras-asa, POST /armascanner/obras-linea/agregar): la obra
 *              se agrega aquí primero y recién ahí ArmaScanner la muestra; Limpiar y Eliminar obra (POST
 *              /armascanner/obras-linea/quitar), del administrador. [Usuario 23-nov]
 *   Instalar   GET /armascanner/mi-licencia  mi licencia y mis equipos
 *   Licencias  GET /armascanner/licencias    (administración) dar, vencer, quitar, liberar equipos
 *   Uso        GET /armascanner/uso          (administración) KPIs y uso por usuario; los reportes de errores
 *              que mandan los cubicadores con «Enviar reporte» (GET /armascanner/reportes, su descarga en
 *              GET /armascanner/reportes/{id}/descarga)
 *   Desarrollo GET /armascanner/desarrollo   (administración, sólo lectura) un caso por plano que el lector
 *              no reconoce (por obra y plano), con sus envíos y su estado; el estado lo cambia el agente con
 *              la ficha (POST /armascanner/desarrollo-ficha), no esta pestaña. Las oficinas de cálculo con
 *              el lector que lee sus planos (POST /armascanner/oficinas). [Usuario 23-nov]
 *   Versiones  GET /armascanner/versiones    (administración) publicar, retirar, obligatoria
 * Los cambios de licencia usan las rutas de siempre: PUT /admin/users/{id}/licencias/armascanner
 * y POST …/liberar.
 *
 * Un archivo por pestaña (23-nov; PROTOCOLO_GENERAL_REP §10), cargados en este orden por app.html:
 *   comun.js      el estado y lo que comparten (global.Asc)
 *   obras.js      Mis obras: la lista, Agregar obra, Limpiar y Eliminar
 *   obra.js       la ventana de la obra: cabecera, Por piso, secciones, recarga
 *   planos.js     la sección Planos: lista, barras, PDF, DWG, reemplazos, pedido, eliminar
 *   asa.js        la sección aSa
 *   instalar.js · licencias.js · uso.js · desarrollo.js · versiones.js   las demás pestañas
 *   index.js      (éste, el último) lo que llama shell.js al abrir cada pestaña
 */
(function (global) {
  'use strict';
  var A = global.Asc;

  global.loadArmaScannerModule = function () {};  // cada pestaña carga lo suyo (shell.js, tabLoaders)
  global.ascCargarObras = A.cargarObras;
  global.ascCargarInstalar = A.cargarInstalar;
  global.ascCargarLicencias = A.cargarLicencias;
  global.ascCargarUso = A.cargarUso;
  global.ascCargarDesarrollo = A.cargarDesarrollo;
  global.ascCargarVersiones = A.cargarVersiones;
})(window);
