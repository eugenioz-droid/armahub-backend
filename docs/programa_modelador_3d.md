# PROGRAMA — Sistema de Modelado 3D y Templates de Elementos

**Estado:** DISEÑO / DISCOVERY (08-ago-2026). Barrido completo de requerimientos. NO implementar hasta
cerrar decisiones abiertas (§13). Documento fuente para ejecución continua por agente.

Expande la fase **M7** de `docs/programa_maestro.md`. Reusa el render sólido validado en
`static/demo/rebar3d.html` (M7.0).

**Terminología acordada (usuario, 08-ago):**
- **Fabricator** = el editor/creador de despieces ACTUAL (hoy tab "Agregar Despiece"). Se renombrará.
- **3D Template** = el visor/generador 3D de un elemento (viga/muro/columna) a partir de un template.
  Se abre con un botón DENTRO del Fabricator; al "cargar" inyecta las barras al despiece activo.
- **Template Editor** = herramienta para CREAR/EDITAR los templates. Vive en la caluga de Catálogo,
  que pasa a ser el "Configurador de herramientas".
- **Editor de Figuras** = el diseñador de figuras del catálogo actual (2D + 3D). Distinto de lo anterior.

---

## 0. Alcance y filosofía

Cuatro piezas, DESACOPLADAS (se pueden construir en fases y por separado):
1. **Motor geométrico** — dada una figura + dimensiones → geometría 3D sólida (barra con curvas de
   doblado y tramos curvos reales). Base de TODO.
2. **3D Template (visor/generador)** — instancia un template con parámetros → conjunto de barras
   posicionadas en 3D → botón "cargar al despiece".
3. **Template Editor** — define los templates (componentes, reglas, figuras) sin programar.
4. **Impacto en el catálogo / render actual** — decidir si el render 2D pasa a mostrar curvas y si
   las figuras necesitan más parámetros (multi-radio).

Regla rectora: **el usuario describe, el motor deriva.** Se guarda la RECETA, no el resultado.
Escalabilidad es requisito explícito del usuario en TODAS las fases.

---

## 0bis. GIRO DE ARQUITECTURA (discovery viga, 08-ago) — CRÍTICO

El discovery de la viga reveló que **hardcodear templates NO es el camino**. Razones (del usuario):
- El recubrimiento varía por plano/cara (los 4 recubrimientos ajustables), y afecta distinto a cada
  barra. Tekla/Revit lo resuelven ingresando PUNTOS por pantalla para limitar la distribución.
- El cubicador ajusta manualmente largos de barra según la figura.
- El cubicador decide cómo SUBDIVIDE el elemento (una "viga" puede abarcar 2 tramos con espaciamientos
  distintos, según su criterio). No es un patrón fijo.
- Una viga tiene ~5 componentes; un muro ~7. Hardcodear cada variante = trabajo enorme y cobertura baja.

**Conclusión:** el corazón NO es "la viga tipo programada", sino un **EDITOR DE COMPOSICIÓN**: el
cubicador trabaja sobre una vista por plano/volumen, POSICIONA componentes con clicks, define
recubrimientos y restricciones, ajusta largos. Un "template" pasa a ser una **composición GUARDADA**
que el usuario creó y reutiliza — no algo que programamos. Esto es esencialmente el **Template Editor**
adelantado: se vuelve el núcleo, no una fase posterior.

**Implicación en fases (revisar §11):** no "F1 viga hardcodeada → F2 editor". Más bien: el editor de
composición ES el MVP. Un primer elemento (viga) sirve para acotar el alcance del editor, no para
codear una viga rígida. Se re-planifica en §11bis tras cerrar el discovery.

**Riesgo:** esto es MÁS ambicioso que un generador de templates fijos. Hay que dimensionarlo bien
(posicionamiento por clicks, restricciones, recubrimientos por cara/barra = trabajo de editor gráfico).
Alternativa intermedia a evaluar: un editor de composición SIMPLE (formulario + pocas reglas) para el
MVP, y el posicionamiento por clicks/volúmenes como evolución. DECISIÓN PENDIENTE (§13 D8).

## 0ter. DECISIÓN DE ALCANCE D8 — RESUELTA: "paramétrico por componentes con capas"

Tras el debate crítico (08-ago), el MVP NO es ni hardcodeo rígido ni editor gráfico por clicks. Es un
**motor paramétrico por componentes con posicionamiento por reglas**:

- Una viga = **volumen de hormigón (caja)** + **lista de componentes**.
- Cada componente se define por: **tipología** (CBS/CBI/LT/ES/TRV…, cerrada), **figura** (libre),
  **φ**, **cara de anclaje** (sup/inf/lateral/perímetro), **recubrimiento/offset** desde esa cara,
  **índice de capa** (1ª/2ª/n → se apila hacia el núcleo automáticamente), **cantidad/distribución**,
  y para estribos **espaciamiento por tramos** (§ zonas confinadas/central).
- El **motor posiciona** cada componente aplicando esas reglas: la capa 2 se corre hacia el núcleo por
  su índice + φ; el recubrimiento define el offset desde la cara. RESUELVE el problema de las capas
  variables (CBS/CBS2/CBSn ya existen en el catálogo) que el hardcodeo rígido NO resolvía.
- El cubicador **agrega/quita/edita componentes** en un FORMULARIO (no dibuja). "Agregar 2ª capa de
  cabezal sup" = agregar componente con capa=2; el motor lo apila solo.
- Un **"template" = una composición de componentes guardada** ("Viga tipo Explora"). Se carga, se
  ajustan 2 cosas, se genera. Esto ES el flujo "20% + edición posterior = mitad de tiempo" que el
  usuario quiere, PERO sin el techo del hardcodeo (soporta capas, figuras libres, componentes N).

**Por qué este punto medio (opinión crítica registrada):**
- El hardcodeo rígido resuelve el 20% pero se ROMPE con capas variables (hueco que el usuario detectó).
- El editor gráfico por clicks es potente pero es un editor serio → tarda mucho antes de dar valor.
- Posicionar por reglas (cara + offset + capa) NO es difícil (el usuario tiene razón): no necesita
  Tekla, necesita anclaje-a-cara + apilado-por-capa. El click es comodidad futura, no prerrequisito.
- Ventaja: da valor rápido, soporta la realidad (capas/figuras libres), y evoluciona a clicks sin
  rehacer (el click solo cambia CÓMO se fija el offset, no el modelo de datos).

**Evolución natural (post-MVP):** posicionamiento fino por CLICKS/arrastre sobre el 3D (mover un
componente respecto a la cara con el mouse en vez del formulario) + restricciones visuales, estilo
Tekla-lite. El modelo de datos (componente = cara+offset+capa) ya lo soporta; solo cambia la UI de
edición del offset. Muros (7 componentes) usan el MISMO motor con más tipos de componente.

## 1. Correcciones de concepto (errores previos, ahora fijados)

- **R (radio) NO es el radio de doblado de los codos.** En ArmaHub, `radio` es un BOOLEAN por figura
  (tiene o no un TRAMO CURVO / desarrollo en arco) + el valor del radio de ESE arco. Es geometría del
  desarrollo de la barra, no del doblez de las esquinas.
- **El radio de DOBLADO de los codos** (la curva donde la barra gira en un ángulo) hoy NO se modela:
  el render 2D del catálogo muestra ángulos EN PUNTA por simplicidad. En el 3D Template SÍ importa
  (para visualizar congestión con el desarrollo real), pero es ESTÉTICO — no afecta cálculo de kilos.
- **Cálculo de kilos/largo (norma):** se usa el TRAMO EFECTIVO RECTO, sin considerar el desarrollo del
  doblado. Así trabaja la industria y así lo hace hoy el sistema. El radio de doblado 3D NO cambia esto.
  (Si algún día ArmaHub fabricara, el doblado real pasaría a ser relevante — no ahora.)
- **Multi-radio (futuro):** hoy el sistema acepta 1 radio por figura. En el futuro puede haber figuras
  con VARIOS tramos curvos, cada uno con sus parámetros reales (radio, cuerda, desarrollo). Además:
  un radio que aplica a 2 tramos como ESPEJO (R define ambos) vs. radios INDEPENDIENTES (Radio 1,
  Radio 2). Esto es del **Editor de Figuras**, no del Template Editor — pero la arquitectura de datos
  del motor geométrico debe dejar la puerta abierta (no asumir "1 radio").

---

## 2. SUB-SISTEMA A · Motor geométrico (la base)

Convierte (figura del catálogo + dimensiones A..I, ángulos, radio) → polilínea 3D → geometría sólida.

- **Entrada:** la geometría que ya existe en `figuras_catalogo.geometria` (JSON tramos {lado,giro,
  sentido}) + valores dim/ang/radio de la barra.
- **Salida:** malla 3D sólida (cilindros por tramo recto + toros por doblez, técnica de la maqueta).
- **Curvas de doblado (codos):** radio VISUAL automático por norma (2φ φ≤16, 3.5φ φ>16). No es
  parámetro del usuario. Solo estético.
- **Tramos curvos (R real de la figura):** cuando la figura usa `radio`, ese tramo se dibuja como arco
  real (no recto). Debe soportar 1 radio hoy, con estructura de datos preparada para N radios / espejo.
- **Ganchos:** ver §5 (superposición en el nodo).
- **Debe ser la ÚNICA fuente de geometría** (client-side, reutilizable por: 3D Template, render del
  catálogo, y a futuro el render 2D si se decide mostrar curvas).

**Decisión pendiente (§13-A):** ¿este motor REEMPLAZA el render actual del catálogo (que el 2D del
Bar Manager/Fabricator muestre curvas de doblado) o solo alimenta el 3D Template por ahora?

---

## 3. SUB-SISTEMA B · 3D Template (visor + generador + carga)

Se abre con un botón dentro del **Fabricator**. Flujo:
1. Elegir template (muro/viga/columna) + variante.
2. Ingresar parámetros del elemento (§4).
3. El motor de reglas del template genera la lista de componentes → barras (figura del catálogo + dims
   calculadas + posición 3D). Reusa el Sub-sistema A para dibujar cada barra sólida.
4. Ver en 3D: rotar, ocultar hormigón, verificar congestión. Ajustar parámetro → regenera al instante.
5. **"Cargar al despiece"** → las barras entran al despiece activo del Fabricator (origen='template',
   template_instancia_id), indexadas, con sus figuras del catálogo. Siguen el flujo normal.

**Guardado (arquitectura de datos, §7):** se guarda la RECETA (parámetros), no las barras como modelo
aparte. La posición se DERIVA al re-abrir. Ver §7 para el comportamiento de regenerar/editar/borrar.

## 4. Parámetros de elemento (base — se AMPLIARÁ en discovery)

Todo elemento de hormigón: **Largo, Ancho/Espesor** (según el elemento), **Altura**. Más:
- **Recubrimientos** — y CÓMO afecta cada recubrimiento a CADA barra (no es uno global). Esto puede
  hacer que barras se traslapen: algunas se resuelven al instalar (OK), otras NO pueden traslaparse
  (problema real de instalación). El motor debe distinguir/avisar. [Requiere reglas por componente.]
- Por componente: figura del catálogo elegible, φ, cantidad/distribución, espaciamiento.
- **Espaciamiento POR TRAMOS** (crítico para columnas): en diseño columna-fuerte/viga-débil el
  espaciamiento de estribos VARÍA a lo largo del elemento (confinamiento en extremos, más abierto al
  centro). El template debe permitir definir zonas con distinto espaciamiento. (Reemplaza la idea de
  "estribos alternados", que el usuario NO quiere.)
- Cada figura DEBE aportar TODOS sus parámetros necesarios para cargarse en el Fabricator.

*El usuario aportará muchos parámetros más por elemento en el discovery de cada template.*

## 5. Ganchos de estribo — superposición en el nodo (decisión del usuario)

- El "cierre desplazado" que propuse **NO sirve** (no representa la pieza real).
- Realidad: con el DESARROLLO DEL DOBLEZ EN CURVA, cada gancho queda a un offset natural del otro
  (por el radio de doblado), mostrándose como "/ /". Las curvas de doblado de cada lado deben
  **coincidir exactamente** para que se vea correcto (ver foto del usuario).
- Programas como Revit/Tekla "acomodan" el gancho; **acá NO es necesario hacerlo**.
- **MISIÓN (§13-D):** averiguar si el componente/lib de render (Three.js + nuestra técnica) YA resuelve
  bien el gancho con el desarrollo curvo. Si sí, usarlo. Si no, **mostrarlo traslapado tal cual** (es
  aceptable; no inventar offsets artificiales).

## 6. SUB-SISTEMA C · Template Editor (Configurador de herramientas)

Vive en la caluga de **Catálogo** (que se reposiciona como "Configurador de herramientas"). Permite
CREAR/EDITAR templates sin programar. Debe ser ESCALABLE (requisito explícito):
- **Fase 2 (editor de reglas por formulario):** el usuario define un template = elemento + lista de
  componentes; por componente elige figura del catálogo, define reglas de cantidad/espaciamiento/
  posición/recubrimiento. Guarda variantes ("Muro Explora tipo A", "Muro cruce"). NO modela.
- **Múltiples templates por tipo de elemento** SÍ soportado (el usuario lo quiere para muros: un cruce
  de muro cambia varias cosas → template propio). La arquitectura NO debe asumir "1 template por
  elemento".
- **Fase 3 (volúmenes + posicionamiento con restricciones):** el usuario define VOLÚMENES de hormigón
  y posiciona figuras dentro con restricciones claras (NO modelado libre CAD). Debe ser una evolución
  natural del editor de reglas, no un rehacer. Diseñar Fase 2 con esto en mente.

## 7. Arquitectura de datos (decidida)

- **`templates_catalogo`**: definición de cada template (tipo elemento, componentes, reglas, figuras).
  Editable por el Template Editor. Varios templates por tipo de elemento permitidos.
- **`elementos_template`**: instancias creadas = RECETA (template_id, params JSONB, ubicación/posición
  del elemento, obra, autor, fecha). NO guarda barras. ~1 KB por instancia.
- **`barras`** gana: `template_instancia_id` (FK nullable) + `origen` acepta 'template'. Las barras
  generadas son barras normales del despiece.
- **La posición espacial NO se almacena barra por barra** — se DERIVA del motor desde la receta al
  re-abrir el 3D. Cero duplicación.

**Comportamiento (responde las dudas del usuario):**
- **Borrar el cabezal (o una barra) en el Fabricator:** la barra desaparece del despiece. Al RE-ABRIR
  el 3D Template hay dos modos posibles (decisión §13-B): (b1) "estado original" = re-deriva de la
  receta y el cabezal reaparece; (b2) "reflejar la edición" = el 3D lee las barras ACTUALES del
  despiece (con el cabezal ya borrado) y no lo muestra. El usuario quiere que si eliminó el cabezal,
  el modelo lo reconozca y no aparezca → esto apunta a (b2) o a un "regenerar" explícito que respete
  ediciones. CERRAR en §13-B.
- **Modificar una barra:** la edición vive en la barra (fuente de verdad, como CSV vs Bar Manager).
  La receta es el estado inicial. NUNCA se sobreescribe la barra editada al re-abrir sin que el usuario
  pida "regenerar". → SIN clash, SIN sobreescritura silenciosa (preocupación del usuario resuelta).
- **Regla anti-clash:** el 3D Template en modo lectura NUNCA reescribe barras del despiece. Solo el
  botón explícito "Cargar/Regenerar" escribe, y avisa qué hará (crea nuevas / reemplaza las del
  template_instancia_id / respeta ediciones manuales).

## 7bis. HALLAZGOS DE INVESTIGACIÓN TÉCNICA (subagente, 08-ago) — impactan el diseño

**Gancho "/ /" (P1):** la maqueta rebar3d.js separa los dos ganchos con un offset ARTIFICIAL
`dx = 1.15·φ` en el eje de la viga (rebar3d.js:156-171, el comentario lo admite). Los codos SÍ son
toros reales y el LARGO del gancho deriva de la tangencia real del doblez 135°; lo inventado es solo
la SEPARACIÓN lateral. Conceptualmente incorrecto: el "/ /" real nace del ESPESOR de la barra (un
gancho pasa por delante/detrás del otro, offset ≈1·φ PERPENDICULAR al plano del estribo), no a lo
largo de la viga. → Para producto: parametrizar el offset (dirección perpendicular al plano + magnitud
= f(φ)) y elegir qué gancho va por dentro. NO es un número mágico en X. (Cierra parte de decisión D.)

**Tramos curvos / arcos (P2) — CORRIGE un supuesto:** el arco de desarrollo YA ESTÁ RESUELTO, pero en
el editor de figuras (disenador3d.js), NO en la maqueta sólida. disenador3d.js:277-302 `_puntosArco3d`
genera arcos 3D reales (centro/cuerda/sagita/sweep, 16 pts) y los renderiza con CatmullRomCurve3 +
TubeGeometry (L413-414), y calcula sus cotas (desarrollo/radio/horiz/vert, L309-376). La maqueta
rebar3d.js solo hace rectos+codos. → Integrar arcos sólidos al motor NO es rediseño: ruta recomendada
= TubeGeometry con radio=φ/2 sobre la polilínea de arco ya existente, o toro parcial reusando el
patrón de codos (rebar3d.js:137-139 makeBasis). El código de arco YA existe y es reutilizable.

**Multi-radio / estructura de datos (P3) — HALLAZGO CLAVE:** el JSON `geometria.tramos[]` YA es
por-segmento y YA soporta N arcos, cada uno con radio/plano/sweep propios (disenador3d.js:733-735:
`{lado,largo,tipo:'recto'|'arco',radio,plano,sweep}`). La FORMA escala. Lo que está ATADO A 1 es:
(a) el flag `radio BOOLEAN` de figuras_catalogo (082:11) y (b) los VALORES por barra: columnas fijas
`dim_a..dim_i` + `ang1..ang4` + UN `radio` escalar en la tabla `barras`. Una figura con 2 arcos de
radios distintos NO tiene dónde poner el 2º valor.
→ Recomendaciones del agente para el modelo de datos:
  1. `radio BOOLEAN` del catálogo → DERIVARLO (= existe algún tramo tipo 'arco', o `n_radios` contado
     del JSON). No mantener un booleano manual desincronizable.
  2. Consolidar `tramos[]` como modelo canónico; cada arco con `{radio,cuerda,desarrollo,sweep,plano}`
     (2 grados de libertad fuente, 3º derivado) + `grupo_radio`/`ref_espejo` opcional para modelar
     "radio espejo (1 R → 2 tramos)" vs "R1/R2 independientes". Campo ADITIVO, no rompe nada.
  3. El cuello real = valores por barra en columnas fijas. Para N arcos, migrar los VALORES a un JSON
     por-tramo (`valores_tramo`) en vez de dim_*/ang*/radio fijos. (Diseño mayor — planificar, no
     bloquear F0/F1 que usan figuras de ≤1 radio.)
  4. "Radio 1/Radio 2" = etiqueta derivada del orden de arcos en tramos[]. Sin esquema nuevo.

## 8. SUB-SISTEMA D · Impacto en catálogo y render actual (a decidir)

- ¿El render 2D del catálogo/Bar Manager/Fabricator pasa a mostrar CURVAS (doblado + tramos curvos) o
  se mantiene en punta por ahora? (§13-A). Recomendación inicial: mantener 2D simple; el 3D Template
  usa el motor nuevo. Evaluar unificar después.
- **Multi-radio en figuras** (§1): el Editor de Figuras deberá soportar N radios / espejo / independientes
  a futuro. El motor geométrico (Sub-sistema A) debe modelar el radio como una LISTA, no un escalar,
  aunque hoy se use 1. [Diseño ahora, implementación cuando se necesite.]
- **Barras con curvas (tramos curvos):** probablemente NO aparecen en los elementos estándar iniciales
  del 3D Template, pero el motor DEBE saber dibujarlas (una figura con `radio` real). Verificar que la
  técnica de la maqueta (toros/arcos) las cubra. [Checkear en §13-C.]

## 8bis. Aclaraciones del usuario sobre los hallazgos (08-ago)
- **Gancho (P1):** la solución correcta = espaciar en el sentido PERPENDICULAR (por el espesor). Si
  resulta muy complejo, es aceptable NO espaciar (no complica nada constructivo). Preferible hacerlo.
- **Multi-parámetro / letras (P2):** los valores extra por barra (más allá de dim_a..i, ang1..4, 1
  radio) hoy NO están parametrizados en la barra. El usuario resolverá cómo aSa Studio reconoce esos
  parámetros (en aSa puede asignar distintas letras) → el diseño solo debe dar FLEXIBILIDAD para que
  esos valores existan y se puedan mapear. No resolver el lado aSa aquí.
- **Multi-radio (P3):** igual — el usuario verá cómo lo resuelve con aSa Studio. Nuestro trabajo:
  estructura de datos flexible que soporte N radios; el mapeo a aSa lo define él después.

## 9. UX / diseño del módulo — POR DEFINIR (falta barrido de tabs/flujos/botones)

*Reconocido con el usuario (08-ago): NO se ha visto el diseño de cada tab, flujos, botones, colores.
La maqueta rebar3d.html sirve como APROXIMACIÓN visual del 3D Template, PERO hay un riesgo real
histórico: maquetas que a la hora de implementar no quedaban iguales. Mitigación acordada abajo.*

**Método anti-desviación (para que la implementación quede IGUAL a lo aprobado):**
- Antes de codear cada superficie (3D Template, Template Editor), se hace una MAQUETA VISUAL sin
  lógica, se aprueba, y el código parte DE esa maqueta (no se rehace). Método ya usado en el proyecto.
- La maqueta aprobada se conserva en el repo como referencia; la implementación debe calzar pixel a
  pixel con ella (mismos IDs, mismo layout, mismos textos). Si algo cambia, se cambia la maqueta primero.
- Se implementa por ETAPAS separadas (maqueta → cableado → datos reales), no todo junto.

**Superficies a diseñar (cada una necesita su maqueta aprobada):**
1. **Botón "3D Template" en el Fabricator:** dónde va, qué dice, ícono. Abre el visor (¿modal a pantalla
   completa? ¿panel lateral? ¿pestaña?).
2. **Visor 3D Template:** layout = panel de parámetros + canvas 3D + barra de acciones. Definir:
   - Zona de parámetros: agrupación (elemento / componentes / recubrimientos / espaciamiento por tramos).
   - Canvas: controles de vista (rotar/zoom/reset), toggle hormigón, ejes/grilla.
   - Acciones: "Cargar al despiece", "Regenerar", "Cerrar". Contadores en vivo (barras, kg).
   - Estados: vacío, generando, WebGL ausente (mensaje claro), error.
3. **Template Editor (en Catálogo/Configurador):** cómo se lista/crea/edita un template; cómo se define
   un componente (elegir figura, reglas). Maqueta propia.
4. **Colores/estética:** paleta (acero metálico, hormigón semitransparente, grilla, ejes, acento verde
   Armacero). Consistente con la identidad ArmaHub.

## 9-ORIG. UX técnica (referencia)

- **Dónde se activa:** botón "3D Template" dentro del Fabricator (abre visor); "Template Editor" como
  sub-sección del Catálogo/Configurador.
- **Layout del 3D Template:** panel de parámetros (izq) + canvas 3D (centro/der) + acciones (cargar,
  ocultar hormigón, resetear). Contadores en vivo (barras, kg).
- **Colores/estética:** definir paleta (acero metálico, hormigón semitransparente, grilla, ejes).
  Homologar con la identidad ArmaHub (verde Armacero). [Definir con el usuario.]
- **Estados vacíos, validaciones, mensajes** (incl. WebGL ausente → mensaje claro, no pantalla blanca).
- **Responsivo / rendimiento** (InstancedMesh; probado ~1M triángulos a 60fps).

## 10. Compatibilidad y no-romper
- Export a aSa: las barras del template son figuras del catálogo normales → export idéntico. NO tocar
  export.py.
- Sistema de tipologías FIJO intacto (las barras generadas llevan su marca/tipología del catálogo).
- Flujo del Fabricator intacto: el 3D Template solo AÑADE barras al despiece activo.

## 11. Fases (desacopladas)
- **F0 — Motor geométrico** (Sub-sistema A): barra sólida con curvas, desde la geometría del catálogo.
  Independiente; testeable solo. Es prerequisito de todo.
- **F1 — 3D Template MVP** (Sub-sistema B): UN elemento (muro o viga, §13-E), generación + 3D + cargar
  al despiece. Templates codificados por nosotros.
- **F2 — Template Editor** (Sub-sistema C): crear/editar templates por formulario; múltiples por tipo.
- **F3 — Volúmenes + posicionamiento con restricciones** (evolución de F2).
- **Transversal — Catálogo/render 2D** (Sub-sistema D): según §13-A.

## 12. Lista de tareas (se detalla al cerrar §13; borrador por sub-sistema)
*(Cada tarea llevará: archivos, criterio de aceptación, test. No ejecutar aún.)*

**F0 Motor geométrico:**
- Extraer/generalizar el generador de la maqueta a `modelador/motor_geom.js` (input: geometria del
  catálogo + dims; output: malla). Soporte de: tramos rectos, codos con radio de doblado visual,
  tramos curvos (radio real, estructura lista para N radios), ganchos.
- Test headless (node): geometrías conocidas → sin NaN, largos coherentes, conteos correctos.
- Investigación gancho (§5): ¿la técnica actual muestra bien "/ /"? Documentar hallazgo.

**F1 3D Template:**
- Migración: `templates_catalogo`, `elementos_template`, columnas en barras.
- Reglas del elemento elegido (§13-E) incl. espaciamiento por tramos, recubrimientos por barra.
- Panel UI + canvas + acciones + contadores + estados/validaciones/WebGL.
- Backend: crear/leer/regenerar instancia; "cargar al despiece" (respeta ediciones, anti-clash §7).
- Mapear figuras del catálogo del elemento.
- Tests: generar → N barras correctas; cargar; regenerar; borrar barra sin romper receta.

**F2 Template Editor:** (se detalla tras F1)
**F3 Volúmenes:** (se detalla tras F2)

---

## 12bis. DECISIONES CERRADAS POR EL USUARIO (08-ago) — firme

- **D1 · Elemento de partida = VIGA.** El usuario acepta partir por viga (validar el motor completo de
  punta a punta) y luego atacar muro sin riesgo de quedar a medias.
- **D2 · Render 2D actual = SE MANTIENE SIMPLE POR AHORA**, con la CONDICIÓN (confirmada) de que el
  motor nuevo tome bien las barras actuales del catálogo y permita HOMOLOGAR después el render de la
  plataforma (que hoy se ve "producto": estribos sin codo, gancho como un solo segmento). El motor es
  ÚNICO y sirve para ambos → homologar el 2D/wireframe a codos+ganchos reales es una fase corta
  posterior, no un rehacer. Prioridad: motor bien hecho una vez.
- **D3 · Re-apertura del 3D = LEE LAS BARRAS ACTUALES del despiece** (si borraste el cabezal, no
  aparece) + botón explícito "Regenerar" que vuelve al original avisando. FLUJO A DEFINIR (§9): el
  usuario propone que sea "una visualización POR ELEMENTO adicional a las que ya existen" (junto a las
  vistas actuales del Bar Manager/Fabricator). Se maqueta.
- **D4 · Activación = MODAL** (no salir de la sección actual). Confirmar que el modal a pantalla
  ~completa no complica el canvas 3D (verificar en la maqueta; probablemente OK).
- **D6 · Estética:** acero metálico + hormigón semitransparente + acento verde Armacero. ABRE temas
  nuevos a definir (ver §9ter): color del canvas/fondo, cómo se diferencia el hormigón y otros datos
  (cotas), y HERRAMIENTAS de inspección: medir distancias, HOVER que muestre cantidad de elementos y/o
  detalle de una barra/grupo. → El 3D Template no es solo "ver", también "inspeccionar".
- **D7 · Renombrar "Agregar Despiece" → "Fabricator"** en toda la plataforma. CONFIRMADO. Nota: en el
  Fabricator SE SIGUEN CREANDO despieces (no es incongruente); el nombre abarca crear + generar 3D.

## 8ter. Catálogo de VIGA (real, de catalogo.py) + regla figura-libre

**Tipologías de VIGA (cerradas por tipo de elemento, catalogo.py:105-108):**
- CBS (Cabezal Superior 1ª capa), CBS2 (2ª capa), CBSn (n capas)
- CBI (Cabezal Inferior), CBI2, CBIn
- LT (Lateral), ES (Estribo), TRV (Traba Viga)
- *(faltaría alguno según el usuario — confirmar en discovery)*

**Figuras sugeridas por tipología** (catalogo.py:134-142), ej. VIGA-ES: 103H/103E/104D/104O/104P;
VIGA-CBS: 101A/102A/102B/…/103D. PERO son SUGERENCIAS, no restricción.

**REGLA CLAVE (usuario, 08-ago): la TIPOLOGÍA es lo cerrado por tipo de elemento; la FIGURA es LIBRE.**
Ej.: EC es la tipología "estribo de confinamiento de muro", pero el usuario puede elegir la figura
106A/106B/106C para ese estribo, o usar esas mismas figuras en una viga tradicional. No se puede
restringir la figura por tipología (infinitas posibilidades). El sistema propone figuras frecuentes,
pero permite cualquiera. El **sufijo (suf_tipo)** define el rol fino (cabezal sup/inf, primera/segunda
capa, etc.) — ya existe en el sistema.

## 8-4ter. Homologación del render de plataforma (tarea D2, POSTERIOR al motor)
Una vez existe el motor geométrico (F0), homologar el render 2D/wireframe actual (Bar Manager/Fabricator/
catálogo) para que muestre codos y ganchos reales (hoy los estribos se ven "producto": gancho como un
solo segmento sin codo). Es fase CORTA porque reusa el mismo motor. NO se hace ahora; queda como tarea
planificada. Mantener el 2D simple hasta entonces.

## 9ter. Herramientas de inspección del 3D Template (D6 — nuevas, a diseñar)
- **Cotas:** mostrar medidas del elemento y/o de barras (largo, espaciamiento, recubrimiento) sobre el
  canvas. Definir cuáles por defecto y cuáles on-demand.
- **Hover:** al pasar el cursor sobre una barra/grupo → tooltip con detalle (tipología, φ, cantidad,
  largo) y/o "cantidad de elementos" del grupo señalado.
- **Medición:** herramienta para medir distancias entre puntos (verificar separaciones, congestión).
- **Diferenciación visual:** hormigón semitransparente vs. acero; posible resalte por tipología/φ.
- Todo esto son CAPAS sobre el canvas; se especifica en la maqueta del visor (§9).

## 13. DECISIONES QUE NECESITO DEL USUARIO (cerrar antes de codear)

**Ya resueltas (no requieren al usuario):**
- Gancho: offset perpendicular (por espesor); si es complejo, sin espaciar (aceptable). Usuario OK.
- Curvas/arcos: el motor las dibujará reusando `disenador3d.js` (código ya existe).
- Multi-radio: estructura de datos flexible (JSON por-tramo); el mapeo a aSa lo resuelve el usuario aparte.

**PENDIENTES (el usuario decide):**

- **D8. ¿MVP = editor de composición completo (posicionar por clicks + recubrimientos por cara +
  restricciones) o versión intermedia (formulario + pocas reglas)?** Es LA decisión de alcance tras el
  giro de arquitectura (§0bis). El editor por clicks es potente pero es un editor gráfico serio; el
  intermedio arranca antes pero cubre menos. Recomendación: MVP intermedio que YA guarde composiciones,
  con el posicionamiento por clicks como evolución — pero validar con el usuario cuánto necesita de
  entrada.
- **D3-flujo. Botón "3D Template":** el usuario ACLARA (08-ago) que el botón para CREAR barras con el
  3D Template va en el **Fabricator** (formulario de edición/creación de despieces), NO en el Bar
  Manager. El Bar Manager es para revisar la obra global, editar masivo, administrar data. IDEA
  ACEPTADA a futuro: cuando se depure el Bar Manager (mejores filtros, más info), PODRÍA incorporarse
  una visualización 3D por elemento AHÍ también — pero eso es posterior, no el MVP. El MVP: botón en
  el Fabricator.
- **D1. Elemento de partida:** ¿MURO (más productividad, más complejo) o VIGA (más simple, menos riesgo
  de quedar a medias)? El usuario prefiere muro pero teme que quede incompleto. Se dimensiona con D5.
- **D2. Render 2D actual:** ¿el render 2D del catálogo/Bar Manager/Fabricator pasa a mostrar curvas
  (doblado + arcos) reusando el motor nuevo, o se mantiene en punta por ahora y el motor solo alimenta
  el 3D Template? (Recom: mantener 2D simple ahora, evaluar unificar después.)
- **D3. Modo de re-apertura del 3D tras editar/borrar barras:** al re-abrir el 3D de un elemento ya
  cargado, ¿el visor LEE las barras actuales del despiece (si borraste el cabezal, no aparece) o
  muestra el ESTADO ORIGINAL de la receta (cabezal reaparece)? El usuario quiere que reconozca un
  cabezal borrado → apunta a "leer barras actuales" + un botón explícito "Regenerar" (que sí vuelve al
  original, avisando). Confirmar la mecánica exacta.
- **D4. Ubicación/activación de las superficies:** confirmar (a) el botón "3D Template" dentro del
  Fabricator (¿modal pantalla completa / panel lateral / pestaña?); (b) "Template Editor" como
  sub-sección del Catálogo (que se renombra a "Configurador de herramientas"). ¿OK?
- **D5. Parámetros completos del elemento elegido (D1):** lista exhaustiva (largo/ancho/alto,
  recubrimiento por-barra, componentes, φ, espaciamiento por tramos, confinamiento, figuras elegibles…).
  Discovery dedicado del elemento. ESTO ES LO MÁS GRANDE y define el alcance real.
- **D6. Colores/estética del módulo** (§9): paleta del 3D y del Template Editor.
- **D7. Nombre nuevo del Fabricator:** confirmar que el tab "Agregar Despiece" se renombra a
  "Fabricator" en toda la plataforma.

**MÉTODO:** cerrar D1-D7 → MAQUETA VISUAL aprobada de cada superficie (anti-desviación, §9) → detallar
§12 tarea por tarea → agente ejecuta F0(motor)→F1(3D Template) de corrido. Barrido COMPLETO antes de
tocar un elemento (prioridad del usuario).
