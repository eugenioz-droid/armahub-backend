# Conocimiento del Asistente IA de enfierrado (SPECS §12.8, capa 1)

DATA, no código: se inyecta al prompt en cada conversación. Catalogado POR TIPO DE
ELEMENTO. Es una guía de **cómo se ARMA** (qué barra va dónde, cómo corre, cómo se
reparte), NO de cálculo estructural: el asistente no diseña, traduce lo que el
cubicador le dicta. Los criterios de cálculo (cuantías, cuándo se exige
confinamiento, verificaciones normativas) quedan fuera a propósito — decisión del
usuario 31-ago: no aportaban al armado y estorbaban.

## GENERAL

- Unidades: dimensiones y separaciones en CENTÍMETROS; diámetros (φ) en MILÍMETROS.
- Glosario: «φ» o «fi» = diámetro · «@» o «a» = separación entre barras · «DM» =
  doble malla (una cortina por cara) · «trama» = la grilla · «cortina» = un plano de
  malla · «trabas» = barras cortas que cruzan el espesor y cosen las dos cortinas ·
  «cabezal» = barra longitudinal gruesa en la punta · «recubrimiento» = hormigón
  entre la barra y la cara.
- Diámetros comerciales: 8, 10, 12, 16, 18, 22, 25, 28, 32, 36 mm. Barra comercial
  = 12 m: más largo que eso obliga a empalmar.
- Muros se nombran «M + número» (M402 = muro del piso 4). Anotación típica en plano:
  «e=20, DM φ8@20» o «DM φ10@20 V / φ8@25 H».
- **Empalme**: el traslapo se resuelve ALARGANDO la barra — se suma al largo de
  corte. **El traslapo de la casa es 60·φ** (el editor tiene ese atajo), salvo que el
  plano diga otra cosa: φ22 → 132 cm. «Ponle 60 de empalme» a secas, en cambio, son
  60 cm al lado que corre. Si el usuario dicta en diámetros, convertir.
- Gancho sísmico donde el plano lo pida: 135°, extensión 6·φ mínimo 7,5 cm.
- Recubrimiento usual de muro: 2 a 3 cm (un solo valor para caras y bordes).

## MURO

Un muro se arma con seis tipologías. Cada una tiene una FORMA DE INSTALARSE fija:
por dónde corre la barra, sobre qué eje se reparte y contra qué se apoya. Eso es lo
que hay que respetar; los números los dicta el plano.

**Las dos cortinas son dos juegos independientes.** Un muro de doble malla lleva
MV+MH contra una cara y MV+MH contra la otra. No son «capas» de un mismo componente.

**MH · Malla Horizontal.** Barras horizontales que corren a lo LARGO del muro, de
borde a borde. Se reparten en la ALTURA (@ vertical, típico 15-25 cm). Figura recta
(101A) salvo que el plano pida patas en los extremos. Si el muro es más largo que la
barra comercial, se empalma y el traslapo se suma al largo.

**MV · Malla Vertical.** Barras verticales que corren en la ALTURA, de piso a piso.
Se reparten a lo LARGO del muro (@ horizontal, típico 15-25 cm). Figura recta. **Casi
siempre lleva empalme**: la barra sube y traslapa con el arranque del piso siguiente
(60·φ, el traslapo de la casa), y ese traslapo se suma al largo de corte — es lo que pide el cubicador
cuando dice «ponle 60 de empalme».

**Cuál cortina va contra la cara** lo decide el proyecto y el cubicador lo dicta con
la jerarquía: la de jerarquía 1 se pega a la cara y la de jerarquía 2 se apoya sobre
ella. En muros suele ir la vertical contra la cara por ser la armadura principal,
pero NO es regla: si el usuario dice «MH jerarquía 1 y MV jerarquía 2», se hace así
y no se discute.

**TR · Traba Muro.** Traba de la malla corriente. Cruza el ESPESOR y cose las dos
cortinas, enganchando una barra de cada lado. Se reparte en una grilla sobre la cara
(típico φ6-φ8 cada 40-50 cm en ambas direcciones). Va apoyada sobre las mallas, o sea
jerarquía 2. Figura con gancho en ambos extremos: una barra recta no amarra nada.

**CB · Cabezal.** Barras longitudinales gruesas (φ16-φ25) concentradas en las PUNTAS
del muro, corriendo en la altura igual que la MV. Se describen por punta: cuántas
barras por capa (a lo ancho del espesor, normalmente 2, una por cara), cuántas capas
hacia adentro y la separación entre capas. Llevan el mismo empalme que la MV. Si se
pide con figura de pata (102A y similares), **hay que decir cuánto mide la pata**: el
cuerpo corre en la altura y la pata entra hacia el núcleo.

**EC · Estribo Confinamiento.** Marco CERRADO con ganchos (figura de la casa: 106A) que abraza el paquete
de cabezales en la punta. Corre en el plano de la sección y se reparte en la ALTURA,
apretado (típico @10-15 cm). No abarca el muro entero: se acota al largo confinado de
la punta (típico 40-80 cm).

**TC · Traba Confinamiento.** Traba corta dentro del elemento de borde, que amarra las
barras del cabezal que el estribo no toma. Cruza el espesor como la TR, pero con la
separación apretada del borde (la misma del EC), no la de la malla corriente.

**Dónde vive la traba de muro** (regla de la casa): solo en el tramo COMPRENDIDO
ENTRE los cabezales — el borde ya tiene su propio confinamiento y no se le
superpone malla ni traba. Y su cuerpo lleva **2 cm de sobrelargo**, porque tiene
que pasar por fuera del eje de las dos cortinas para engancharlas.

**TR y TC NO son lo mismo y no se intercambian**: la traba de muro (TR) cose la malla
corriente y su grilla cae en los cruces de MV y MH; la de confinamiento (TC) vive
dentro del borde y sigue la separación del estribo. Si el usuario dice «trabas» a
secas hablando del muro, es TR.

**Las dos cortinas van en ESPEJO.** Cuando la malla lleva ganchos (figura de más de
un tramo), la cortina del lado opuesto va reflejada — «rotada en torno al eje Z» —
para que los ganchos de una crucen contra los de la otra en el testero. La
plataforma lo hace sola al crear la doble malla; si el usuario pide «rótala en
torno a Z» o «en espejo» sobre una barra existente, es el campo `espejo` de
operar_barras (NUNCA `giro_patas`, que solo gira los ganchos sobre el eje de la
propia barra).

**La jerarquía SIEMPRE se escribe cuando el usuario la dicta.** «Cabezales con
jerarquía 2», «ponle jer 1 a la MH» → el campo `jerarquia` de esa armadura o del
cambio, y se repite el valor en la respuesta para que el usuario vea que quedó.

**Colores.** Cada tipología trae su color en la plataforma y es el que se usa por
defecto — no hay que pedirlo ni escribirlo: **MV verde · MH azul · TR (traba de muro)
fucsia · EC y TC (confinamiento) ámbar · CB (cabezal) rojo**. Solo se cambia si el
cubicador lo pide expresamente («pinta las trabas de rojo»).

**Orden de armado** (sirve para explicar y para ordenar los componentes): primero las
dos cortinas (MV y MH), después las trabas que las cosen, y al final el borde
(cabezales, su estribo y sus trabas).

## FIGURAS (cómo se nombran; el catálogo COMPLETO va aparte)

El cubicador puede pedir una figura por su código; va en la ficha (campo `figura`) y
también la `jerarquia`.

**La lista de códigos válidos NO está en este documento**: se inyecta aparte, leída de
la base de datos, y esa lista es la única autoridad. Acá va solo cómo leerla:

- El primer grupo dice cuántos TRAMOS tiene la barra: `101x` = recta (1 tramo),
  `102x` = 2 tramos, `103x` = 3 tramos, `104x` = marco de 4 tramos.
- La letra distingue la variante (ángulos de los dobleces). En la lista inyectada cada
  código viene como `codigo:lados:angulos`, por ejemplo `104D:4:135/135`.
- Defaults de la plataforma para muro: MV, MH y CB **101A** (recta); traba **103B**
  (cuerpo que cruza el espesor + dos ganchos); estribo de confinamiento **106A** (el de la casa).

Si el usuario no nombra figura, se usa el default. Nunca inventar un código: si no está
en la lista inyectada, no existe.
