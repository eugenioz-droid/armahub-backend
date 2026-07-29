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
