"""
armascanner/
------------
Lo que ArmaScanner hace en ArmaHub con la ficha de su licencia (licencias.py): elegir la obra,
cargar los planos del calculista, subir cada plano cuando lo terminó y enviar su pedido.
[Usuario 19-nov, programa §8.13 paso 1; modelo sin bloqueo, 21-nov, mig 174]

    GET  /armascanner/obras                   las obras agregadas en ArmaHub › Mis obras (sólo ésas)
    GET  /armascanner/planos                  los planos de las obras, con su entrega y sus pedidos de reemplazo
    POST /armascanner/planos/terminar         el plano terminado: la entrega del plano (paquete y PDF), sólo
                                              en una obra de Mis obras (si no, 409); si la entrega es de otro,
                                              sólo con su reemplazo aceptado (si no, 409 «ocupado»)
    POST /armascanner/planos/avance           la versión actual SIN terminar («Subir a ArmaHub», mig 183): la entrega
                                              en revisión, sin PDF, con el estado de cada ciclo; mismas reglas
    POST /armascanner/planos/descargar        enlace para bajar la entrega o el antecedente
    POST /armascanner/planos/reemplazo/pedir · responder   pedir al autor que acepte el reemplazo
    GET  /armascanner/planos/reemplazos       los pedidos para mí y los míos
    POST /armascanner/planos/pedido           «Enviar pedido»: las barras de la entrega pasan a los despieces
                                              de la obra; con «grupo» (mig 183), sólo las de un ciclo completo,
                                              que reemplazan las de ese ciclo del plano
    POST /armascanner/reportes                un caso de Desarrollo («plano», que no se lee) o un reporte
    POST /armascanner/planos/guardar          cargar el antecedente: EN PAUSA (CARGA_ANTECEDENTES), responde 410
    POST /armascanner/planos/tomar · soltar   ya no hay bloqueo: sólo para un ArmaScanner hasta la 2026-11-20.10
                                              (tomar responde 404 y ése abre el plano en local; soltar, ok)
    GET/POST /armascanner/planos-linea…       los planos de una obra en el portal (avance, barras, PDF, DWG,
                                              responder un reemplazo, pedido —del plano o de un ciclo—, eliminar)
    GET  /armascanner/planos-linea/grupo      un ciclo antes de reenviarlo: lo enviado y qué cambió desde entonces

Y lo que muestra la caluga ArmaScanner del portal (sesión del portal; SPECS §13) [Usuario 19-nov:
«Más que pedidos enviados debiera ver sus obras y ojalá una línea por cada carga de elemento
constructivo… Con su cantidad de Items, kilos y lo típico que usamos. La licencia capaz la
dejamos acá, aquí buscamos un usuario existente y lo agregamos»]:

    GET  /armascanner/obras-linea      Mis obras: las obras con planos, con sus KPIs (kg, m², kg/m², PPI, Ø,
                                       fundaciones) y su tabla por piso
    GET  /armascanner/obras-linea/asa  la ventana de la obra, sección aSa: qué parte de cada plano está en aSa
                                       y con qué códigos (CC)
    GET  /armascanner/planos-linea/dwg el DWG del plano (la copia de trabajo o el del calculista)
    GET  /armascanner/mi-licencia    Instalar: mi licencia y mis equipos
    GET  /armascanner/licencias      Licencias (administración): quién la tiene
    GET  /armascanner/uso            Uso (administración): KPIs y uso por usuario
    GET  /armascanner/descarga       Instalar: la versión vigente y su enlace de descarga
    GET  /armascanner/actualizacion  (ficha) ¿hay una versión más nueva? → «Actualizar» en ArmaScanner
    GET/POST/PATCH /armascanner/versiones   Versiones (administración): publicar, retirar, obligatoria

ENVIAR EL PEDIDO de un plano es la importación de A Detailer de siempre
(importer.import_armadetailer), con tres reglas propias:
  - Reemplaza sólo las barras de ESE plano (por su PLANO_CODE, estable por plano). Nunca toca
    otro plano, ni A Detailer, ni lo ingresado a mano (la importación sólo tiene autoridad
    sobre origen 'csv').
  - Suben todas las barras con su estado de revisión (aprobada · duda · pendiente) en
    `barras.revision`; lo que no está aprobado queda contado por SECTOR|PISO|CICLO en
    `imports.pendientes`, incluidas las barras que no pudieron subir por datos incompletos.
  - Mientras una carga vigente tenga pendientes en una combinación, esa combinación no se
    exporta (export.py, `combinaciones_bloqueadas`).

Quién puede: el mismo que puede importar en el portal (cualquier usuario interno; el cliente
no), con licencia vigente.

Un módulo por tema, con la lógica aparte de las rutas (23-nov; PROTOCOLO_GENERAL_REP §10):
    obras.py        Mis obras y la lista de obras de ArmaScanner; la sección aSa de la obra
    planos.py       cargar, terminar y descargar un plano; los planos de una obra en el portal
    reemplazos.py   los pedidos de reemplazo (una entrega por plano)
    pedido.py       «Enviar pedido»: las barras de la entrega pasan a los despieces de la obra
    desarrollo.py   los planos que el lector no reconoce, los reportes y las oficinas de cálculo
    versiones.py    Instalar (mi licencia, la descarga), la actualización y las versiones
    uso.py          Licencias y Uso (administración)
y lo que comparten, sin rutas:
    acceso.py       quién puede: la ficha de la licencia, la licencia vigente, el administrador
    comun.py        nombres y fechas para mostrar, borrar en R2, los avisos de la campana
    datos.py        la base de los planos: su entrega, sus pedidos de reemplazo, su fila
    reglas.py       las reglas del plano, su entrega y su pedido (puras)
    kpis.py         los KPIs y el kg por piso (puros)
"""

from fastapi import APIRouter

from . import desarrollo, obras, pedido, planos, reemplazos, uso, versiones

# Un solo router con las rutas de todos los módulos, como cuando era un solo archivo (main.py lo monta dos veces:
# sin prefijo y en /api/v1). Sus rutas se juntan tal cual: include_router las dejaría anidadas.
router = APIRouter()
for _modulo in (obras, planos, reemplazos, pedido, desarrollo, versiones, uso):
    router.routes.extend(_modulo.router.routes)
