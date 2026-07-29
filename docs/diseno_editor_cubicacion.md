# Diseño del Editor de Cubicación (desde cero) — requerimientos de Eugenio

> Diseño en curso (2026-07-29). El editor anterior quedó ON-HOLD; se rediseña la interfaz
> ANTES de codear. NO mezclar con lo implementado hasta acordar el diseño. Anexo del bloque
> 5N del maestro. Los filtros de texto se van a estandarizar (deuda transversal, ver abajo).

## Principio
Siempre se trabaja POR ELEMENTO. Un elemento puede ser un MURO o una LOSA (u otros) → se
necesitan controles para ambos. Se crea por tipo de elemento → NO hay agrupaciones en la
grilla; solo hay que ORDENAR bien la data por PISO y por TIPOLOGÍA (orden definido, el de
ArmaDetailer).

## Orden de tipologías por estructura (confirmado, de catalogo.py `_TIPOLOGIAS_SEED`)
- **MURO** (6): MH, MV, TR, EC, TC, CB
- **LOSA** (9): Fi, Fs, F'i, F's, F, F', SP, Rp, TRL
- **VIGA** (9): CBS, CBS2, CBSn, CBI, CBI2, CBIn, LT, ES, TRV
- **COLUMNA** (5): CB, CB2, CBn, TRC, ESC
- **FUNDACION** (6): Fi, Fs, F'i, F's, SPF, TRF
- **GEN / GENERAL** (3): CB, F, F'
- **Sectores constructivos** (enum): FUND, ELEV, VCIELO, LCIELO

## Layout acordado (de arriba hacia abajo)
1. **Fila 1 — Contexto:** Obra + Eje (ya resuelto el tema de definir eje).
2. **Fila 2 — Selección rápida (3 secciones de botones):**
   - Sección A · SECTOR CONSTRUCTIVO: `FUND` `ELEV` `VCIELO` `LCIELO`
   - Sección B · ESTRUCTURA: `MURO` `LOSA` `VIGA` `COLUMNA` `FUNDACION` `GENERAL`
   - Sección C · TIPOLOGÍA (varía según la estructura elegida; ej. MURO = 6 botones)
   → con eso el editor ya sabe QUÉ barra se va a ingresar; el cubicador elige rapidísimo qué copiar.
3. **Fila 3 — Botones rápidos:** ej. "Ingresar una barra por piso" (con todo preseleccionado
   y obra/eje correctos ya ingresados). (Más botones vendrán.)
4. **Grilla de barras** (misma config visual que el Bar Manager plano; sin agrupación).

## Campo EJE (requerimiento específico)
- Celda con búsqueda / filtro de texto.
- Si se ingresa un valor NUEVO → aparece botón **"Crear Eje"**.
- Al presionar "Crear Eje" → se genera un **BLOQUEO que fija esta tanda** (queda "fija"
  mientras se cubica ese eje). [Aclarar exactamente qué bloquea.]

## Guardar / Descartar / Estados
- Botón **disquete** para guardar.
- Botón **X** para descartar todo.
- Diferenciar estado **"En edición"** vs **"Terminado"**: un **checkbox** (bajo "validación")
  que, al marcarse, **bloquea** la creación de barras del lote.
- El disquete **guarda distinto** según si el lote está Terminado o En avance.
- **Identificador de LOTE**: para que el cubicador pueda volver y seguir editando un lote en
  avance. (Ya existe `lote_id` en backend.)

## Configuración de PISOS MÚLTIPLES (pendiente de ubicar)
- Tiene que haber en algún lugar una configuración para pisos múltiples (replicar/estampar en
  varios pisos). Definir DÓNDE va (¿panel de config? ¿por barra? ¿por tanda?).

## DEUDA TRANSVERSAL — filtros de texto
Los filtros/inputs de texto (con datalist) NO funcionan bien en varios casos; cada vez que se
crean en estos editores fallan (ej. el readonly que rompía oninput; el datalist que no dispara
al elegir). **Estandarizar un componente de filtro-de-texto reutilizable** que funcione siempre,
para no reinventarlo mal cada vez. Trabajar DESPUÉS (deuda separada).

## Requerimientos nuevos (2026-07-29, tras ver la maqueta Etapa 1)

**Tipos de formulario según elemento/avance (tener en mente, no ahora):**
- Habrá diferencias pequeñas de cómo se trabaja según sea MURO / LOSA / o "por avance en
  planta". Idea futura: poder elegir entre 2 tipos de formulario. POR AHORA se trabajan igual;
  solo se agregan herramientas para pisos múltiples y acciones masivas. Mantenerlo presente al
  recibir más input.

**Repositorio / histórico de lotes de la obra (nueva sección dentro del tab):**
- Sección (al final del tab) que muestre TODO lo ingresado para la obra seleccionada: histórico
  de lotes creados. Tipo librería/repositorio.
- Seleccionar un lote → CARGA todo en el formulario para seguir editando.
- Si el lote está TERMINADO, se carga BLOQUEADO. El usuario puede DESBLOQUEARLO con un WARNING,
  y ese desbloqueo debe quedar en AUDIT / trazabilidad.

**Ajustes a la maqueta (Etapa 1 → 1b):**
- Intercambiar "cantidad de barras por piso" ↔ "agregar barra" (el botón grande pasa a ser
  +barra; el de pisos como acción).
- Cada FILA con un botón chico `+` al final → agrega una barra debajo de esa. Al lado, botón de
  copia (⎘) para duplicar la fila.
- En la fila de botones rápidos: **toggle de orden** (por PISO en orden / por TIPOLOGÍA en
  orden).
- Botón **Acciones masivas**: al entrar, el sistema OBLIGA a mostrar el orden por TIPOLOGÍA
  (porque las acciones masivas suelen ser por tipología). Muestra un check por barra + al inicio
  de cada grupo de tipología un check "masivo" que marca todas las barras de ese grupo.
  → En la maqueta: mostrar los DISTINTOS diseños/vistas (normal, orden por piso, orden por
     tipología, modo acciones masivas) para elegir cómo se ordena a nivel de maqueta.

**Renderizado de figura en la tabla (2026-07-29):**
- Mostrar el render de la figura DENTRO de la tabla, al lado de la columna Figura, a un
  tamaño razonable (que se vea).
- **Toggle de 3 tamaños** de render (chico / mediano / grande).
- **Toggle mostrar/ocultar render** (para compactar la data cuando se quiere ver más filas).

**Decisiones de UX confirmadas:**
- Vistas (piso/tipología/masivas): un **toggle** que las alterna (más elegante), no apiladas.
- Botones `+` (agregar barra debajo) y `⎘` (duplicar) por fila: **siempre visibles** al final.

## Acuerdos APROBADOS (2026-07-29) — implementar en maqueta, volcar a SPECS al cerrar Etapa 1

**Render en tabla:** 3 tamaños. S = actual; M = intermedio; L = +50% sobre M. + toggle on/off.

**Tipología = SUBTABS de trabajo (no solo selector):**
- Cada tipología (MH, MV, TR, EC, TC, CB…) es un subtab. Estar en un subtab: (a) FILTRA la vista a
  esa tipología, (b) FIJA la tipología por defecto de las barras nuevas (nacen con ese tipo). En
  un subtab se OCULTA la columna Tipología (redundante) y el orden "por tipología" (solo hay uno).
- Subtab **TODOS**: muestra todas. La barra nueva NO tiene tipología fija → la columna Tipología
  aparece como **selector editable por fila**. Toggle de orden Piso/Tipología disponible.
- Una fila nueva SIN tipología elegida (en TODOS) NO se reordena por tipología hasta que se elija;
  queda donde se agregó y luego se reordena.
- La barra SIEMPRE guarda su tipología como dato; solo cambia de dónde sale (subtab vs selector).

**Bloqueo Sector + Estructura:** al elegirlos quedan bloqueados. Desbloqueo SOLO si el lote está
VACÍO (sin barras). Con barras → bloqueo DURO (no se puede: un sector no puede tener tipologías
ajenas). Botón "🔓 cambiar" solo activo con lote vacío.

**Validación de geometría (como Bar Manager):** al elegir figura, solo se piden/aceptan las dims
que esa figura usa; **la celda se pinta ROJA en vivo si es inválida** (sin depender del check),
reusando `validar_geometria` del catálogo (Etapa 3). Config de bloqueos por diámetro
(normativos/fabricación) + coeficientes de peso = TAB FUTURO (deuda, no ahora).

**Check "revisada" por FILA:** checkbox por barra = el cubicador la validó. Libre para llenar sin
marcarlo. Rollup muestra "X de Y revisadas". El botón "Terminar lote" (global) NO se puede activar
si hay data inconclusa/inválida (ni con filas sin revisar, a definir el rigor exacto).

**Estados e íconos (2 conceptos DISTINTOS, no confundir):**
- **Revisada** (por fila) = checkbox en la grilla.
- **Terminar lote** (global) = botón grande tipo **BANDERA que cambia ROJO (en edición) → VERDE
  (terminado)**, al lado del disquete. El **candado NO es botón**: es solo indicador visual del
  estado "bloqueado".

**Eliminar lote:** barra abajo con botón "Eliminar" que pide escribir **ELIMINAR** en pantalla para
confirmar. ES LA ÚNICA forma de borrar un lote. (Nombre "lote" aún no convence a Eugenio — buscar
alternativa.)

## REGLA TÉCNICA CRÍTICA — editar/eliminar un lote TERMINADO (aprobada, clave para consistencia)

El "lote" es un ÁTOMO de carga de datos (como el import CSV). Su trazabilidad (`lote_id`, quién/
cuándo) es INMUTABLE. "Terminado" = el cubicador cerró la tanda de ingreso; NO congela las barras
para siempre.

1. **Corregir una barra de un lote terminado → SÍ, desde BAR MANAGER.** Bar Manager ya valida
   geometría (`validar_geometria`) y preserva procedencia (`editar_barra` no toca origen/lote_id).
   Una edición bien hecha NO genera inconsistencia.
2. **Editar en Bar Manager NO re-abre el lote** en el editor de cubicación. El lote sigue
   'terminado'; solo cambió una barra (con su `editado_por/fecha`). Separación por herramienta:
   Bar Manager = corrección puntual; editor de cubicación = ingreso masivo. Una sola verdad por acción.
3. **Eliminar un lote → SÍ, incluso terminado.** Es un átomo → borrar el lote borra sus barras
   (confirmación ELIMINAR). Análogo a "eliminar carga CSV". No rompe el modelo (borra el conjunto
   completo + su registro).
4. **LÍNEA ROJA:** NO se re-abre/desbloquea un lote terminado EN EL EDITOR DE CUBICACIÓN para
   estampar/agregar masivo (podría cambiar sector/estructura de un lote con barras → rompe modelo).
   Terminado → editor en SOLO-LECTURA. Corregir barra = Bar Manager. Rehacer todo = eliminar lote
   y crear uno nuevo.

Resumen de la regla: **corregir barras = Bar Manager (valida, preserva procedencia, no re-abre);
rehacer/deshacer tanda = eliminar lote; editor terminado = solo-lectura, no se desbloquea con
barras dentro.**

## Feedback maqueta 1c → 1d (2026-07-29, pendiente de aplicar)
1. **Render S/M/L**: agrandar de verdad (se ven iguales) + poner un RENDER REAL de una barra
   (no placeholder) para apreciar el tamaño. Usar `disenadorMotor.dibujarFigura` con una
   geometría de ejemplo.
2. **Check doble → unificar**: hoy hay check de revisión (siempre) + check de masiva (en modo
   masivo) = confuso. El check de REVISIÓN va AL FINAL de la fila, antes de +/⎘, con texto
   "Rev". El check de masiva solo aparece en modo masivo (al inicio de fila).
3. **Botón `+` de fila COPIA la tipología** de esa fila (agregar en blanco = botón "+barra" de
   arriba).
4. **X de descartar (vuelve):** botón X junto al disquete para DESCARTAR un lote NO guardado
   (warning "se descartará todo"). Es DISTINTO de "Eliminar lote" (borra uno ya guardado).
   No es redundante.

## Requerimiento GRANDE — configuración de PISOS de la obra (pendiente de diseñar bien)
- La obra debe tener sus PISOS ingresados en algún lado (config).
- Al presionar "Pisos múltiples" → menú con TODOS los pisos CHECKEADOS; el cubicador deschequea
  los que no aplican → se ingresa una barra por piso seleccionado.
- **Problema a resolver:** que los nombres de piso NO se creen a mano inconsistentes (P1, p1,
  P 1…). Detailer lo tiene resuelto (el cubicador ingresa una vez). Aquí puede no haber data
  previa, o la cargada no cubre todos los pisos.
- **Idea:** preconfiguración de nombres de piso (ej. Subte-10 … P40, + SM, PF) + opción CUSTOM
  para niveles raros; luego, al detectar diferencias, instancia de HOMOLOGAR los pisos
  customizados (unificar Detailer ↔ manual). Objetivo: pisos unificados entre ambos canales.
  → Diseñar esto con más calma; es transversal (afecta también la coherencia con Detailer).
