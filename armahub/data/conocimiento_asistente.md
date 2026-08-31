# Conocimiento del Asistente IA de enfierrado (SPECS §12.8, capa 1)

Este archivo es DATA, no código: se inyecta al prompt del asistente en cada
conversación. Se edita a mano para enseñarle prácticas de la casa. Catalogado POR
TIPO DE ELEMENTO desde el día uno (decisión del usuario 30-ago-2026). Son
RECOMENDACIONES y ejemplos de lo usual en Chile — no restricciones normativas
(decisión del usuario 31-ago). Fuentes: Manual de Detallamiento ICH 2019, DS60/
DS61 (2011), guía Innova/UV de muros, estadística U. de Chile, AZA/NCh211.

## GENERAL

- Unidades: dimensiones y separaciones en CENTÍMETROS; diámetros (φ) en MILÍMETROS.
- Glosario chileno: «φ» o «fi» = diámetro; «@» o «a» = separación («φ10@20» =
  barras de 10 mm cada 20 cm); «DM» = doble malla (una cortina por cara); «trama»
  = la grilla de la malla; «trabas» = ganchos cortos que cruzan el espesor y cosen
  las mallas; «recubrimiento» = hormigón entre barra y cara.
- Diámetros comerciales chilenos: 8, 10, 12, 16, 18, 22, 25, 28, 32, 36 mm.
  Acero A630-420H (ex A63-42H) en prácticamente todos los planos.
- Los planos suelen dar espesores en cm (15, 20, 25, 30) — un «espesor 200» casi
  seguro está en mm (= 20 cm). Separaciones en cm.
- Muros se nombran «M + número»: el primer dígito suele ser el piso (M402 = muro
  del piso 4). Ejemplo real de plano: «M404: e=25, DM φ10@20 V / φ10@15 H».
- Indicaciones genéricas típicas («armadura mínima», «según nota», «trama según
  detalle»): si no hay dato concreto, PREGUNTAR, nunca inventar.
- Empalme que usan los cubicadores (NCh353): armadura vertical de muros se cubica
  empalmada en el piso superior con 40·φ de la barra mayor, salvo que el plano
  diga otra cosa. Rango práctico de traslapos: 40·φ a 60·φ.

## MURO

- Muro chileno típico de edificación: espesor 20 cm (lo más común, también 25),
  DOBLE malla, hormigón H30. Simple malla solo en muros menores/secundarios o
  espesores chicos (≤ 12-15 cm) — ante la duda, preguntar.
- Cuantía mínima usual: 0,25% por dirección, separación máxima usual 45 cm (en la
  práctica real casi nunca sobre 25 cm). Referencia de lo usual por espesor (con
  doble malla): e15 ≈ φ8@20-25 · e20 ≈ φ8@20 · e25 ≈ φ10@20 · e30 ≈ φ10@20 o
  φ12@20. Son órdenes de magnitud para chequeo, no reemplazan el plano.
- Malla vertical (MV): barras corren en la ALTURA; malla horizontal (MH): en el
  LARGO. En «V φ10@20 / H φ8@25» la V es vertical. La vertical suele ser ≥ que la
  horizontal.
- Recubrimiento usual de muro interior: 2 cm (φ≥16) a 1,5 cm (φ≤12); expuesto a
  suelo/intemperie 2,5-3 cm. Default de la plataforma: 2,5 cm.
- Trabas de malla (muro corriente): φ6-φ8 cosiendo las dos mallas, grilla usual
  @50×50 (≥4 por m²); la plataforma usa φ8@40×40 como default.
- CONFINAMIENTO DE BORDE (lo nuevo post-terremoto 2010, DS60/DS61): en las
  CABEZAS (extremos) del muro los planos concentran barras verticales más gruesas
  (paquetes tipo 4φ16, 4φ18, 6φ22) amarradas con estribos cerrados y trabas a
  poco espaciamiento. Números usuales del elemento de borde: estribo/traba φ10
  mínimo, espaciamiento ≤ 6·φ de la barra vertical y ≤ ½ espesor del muro (φ16 →
  ~@10 cm en muro de 20); largo confinado típico ≥ 40 cm desde la punta; trabas
  con ganchos sísmicos 135° en AMBOS extremos (extensión 6·φ, mínimo 7,5 cm).
  Los planos lo llaman «elemento de borde», «refuerzo de borde» o «confinamiento».
  La ficha del asistente SÍ arma bordes: cabezales por punta (φ, barras por capa,
  capas) + estribo de confinamiento (φ, @, largo confinado).
- Gancho sísmico (donde el plano lo pida): doblez 135°, extensión 6·φ mínimo
  7,5 cm (φ8→7,5 · φ10→7,5 · φ12→7,5 · φ16→9,6 · φ18→10,8 · φ22→13,2 cm).

## FIGURAS (códigos del catálogo, para cuando el usuario los dicta)

El cubicador puede pedir una figura por su código; va en la ficha (campo `figura`)
y también la `jerarquia` (1 = pegada a la cara, 2 = se apoya sobre la de nivel 1).
Familias del catálogo Armacero:

- **101A** — barra RECTA, sin dobleces. Es el default de malla vertical, malla
  horizontal y cabezal de muro.
- **102A/102B/102C** — 2 tramos (una pata): 102A codo 90°, 102B gancho 135°
  (sísmico), 102C gancho 45°.
- **103A/103G** — 3 tramos con codos 90° (grapa/U). **103B** — 3 tramos con dos
  patas a 45°: es el default de traba de muro (cuerpo que cruza el espesor + dos
  ganchos). **103E/103H** — 3 tramos con ganchos 135° en ambos extremos.
- **104A** — marco de 4 tramos sin ganchos. **104D** — estribo cerrado con ganchos
  135° en ambos extremos: es el default del estribo de confinamiento de borde.

Si el usuario no nombra figura, se usa el default; no hay que inventar códigos.
Una figura que no exista en el catálogo la rechaza la validación.
