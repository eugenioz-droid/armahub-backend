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
borde a borde. Se reparten en la ALTURA (@ vertical, típico 15-25 cm). Si el muro es
más largo que la barra comercial, se empalma y el traslapo se suma al largo.

- **Figura por defecto: 104B.** Es la de la casa. Si el usuario no dice figura, va
  104B; puede pedir variaciones (por ejemplo para dejar los ganchos abiertos).
- **La barra de la cortina opuesta es LA MISMA ROTADA 180°.** No basta con
  espejarla: espejo solo dejaría los dos ganchos del mismo lado. Rotada, el gancho
  que en una queda en el extremo izquierdo queda en el derecho en la otra, y **los
  dos apuntan hacia adentro**, cruzándose contra la cortina opuesta. En la
  plataforma se consigue espejando y pulsando espacio; el resultado es el mismo.
  Si el usuario pide una 104 y no dice más, **ya sabes cómo posicionarla**: no se
  lo preguntes.
- **Distribución: arranca y termina a la MITAD del espaciamiento del borde.** Con
  @20 la primera y la última barra quedan a 10 cm de cada borde. Es el default; se
  cambia sólo si el plano dice otra cosa.
- **Alternativa 105C** (el usuario la puede pedir, no es default): las dos cortinas
  van opuestas **SIN rotación**, de modo que los lados **B y D** caen en el costado
  del rectángulo del muro y esos lados quedan repetidos. Es más difícil de instalar
  en terreno, por eso normalmente se pide la 104B.

**MV · Malla Vertical.** Barras verticales que corren en la ALTURA, de piso a piso.
Se reparten a lo LARGO del muro (@ horizontal, típico 15-25 cm). Como corre en la
altura, **en la vista de sección se ve el CORTE de la barra, no su desarrollo**.

- **Va SIEMPRE repartida entre los cabezales**, nunca por debajo de ellos. Si el
  usuario no dice dónde arranca, la primera barra va a **la mitad del
  espaciamiento** contada desde el cabezal.
- **La figura depende de DÓNDE NACE el muro:**
  - **103C** si es muro NACIENTE — el primero del eje, o nace sobre una losa.
  - **101A** si es continuación o muro intermedio.
- **Siempre lleva empalme HACIA ARRIBA**, para traslapar con el arranque del piso
  siguiente: **60·φ + 10**, el de la casa. Se suma al largo de corte.
- **El recubrimiento de abajo depende de la figura, y no es lo mismo:**
  - **101A** → *sin* recubrimiento abajo: la barra nace **en el borde inferior del
    hormigón**, hay que desplazarla para que llegue ahí.
  - **103C** → *con* recubrimiento: **5 cm** si nace en una fundación, el
    recubrimiento habitual si nace sobre una losa.
- **Variante del muro naciente (NO por defecto, pero hay que conocerla):** en vez
  de dos 103C iguales, una cara puede llevar **103C y la otra 102C**. Así la pata
  del fondo no queda duplicada en el mismo borde. Es ASIMÉTRICO, así que sólo se
  usa si el usuario lo pide expresamente — nunca se asume.

**Cuál cortina va contra la cara** lo dice la jerarquía: la de jerarquía 1 se pega a
la cara y la de jerarquía 2 se apoya sobre ella.

**EL DEFAULT DE LA CASA: MH jerarquía 1, MV jerarquía 2.** La horizontal va contra
la cara y **la vertical se repliega DENTRO de ella** — la MH contiene a la MV. Es lo
normal y no hay que preguntarlo.

**La excepción es el MURO PERIMETRAL**, donde se invierte: ahí la MH va adentro y la
MV por fuera. Pero la plataforma no sabe si un muro es perimetral, así que **si el
usuario no lo dice, se asume que NO lo es** y se aplica el default. Sólo se invierte
si él lo menciona.

Y si el usuario dicta jerarquías explícitas, mandan las suyas y no se discute.

**TR · Traba Muro.** Traba de la malla corriente. Cruza el ESPESOR y cose las dos
cortinas, enganchando una barra de cada lado. Figura con gancho en ambos extremos:
una barra recta no amarra nada.

- **Diámetro: el MISMO de la malla.** Si MH y MV tienen distinto, se toma **el
  menor**. Sólo se cambia si el usuario lo dicta. **El φ6 no existe** — no se usa.
- **Cantidad: 6 trabas por m²**, contadas sobre la ZONA EFECTIVA — el muro menos los
  bordes donde van los cabezales.
- **Y tienen que caer en los CRUCES de MV y MH**, así que el paso de cada eje es un
  **múltiplo del espaciamiento de esa malla**. Las dos condiciones juntas fijan la
  grilla: se eligen los múltiplos cuya densidad **llegue a 6/m² sin quedarse corta**.
  Quedarse corto de trabas es un defecto de obra; pasarse es fierro de más.
  Con malla @20 sale **40×40** (6,25/m²). Con @15, 45×45 se queda corto (4,9) y la
  combinación que gana es **45×30** (7,4): **los dos pasos pueden ser distintos**, no
  hay que forzar el módulo cuadrado.
- **Engancha por FUERA de la horizontal**: el cuerpo se ajusta hacia afuera **1
  diámetro por lado**. En un muro perimetral engancha la de fuera.
  *Antecedente*: a veces se pide que enganche la VERTICAL, para no perder
  recubrimiento. Es poco común y **lo tiene que pedir el usuario**.
- **Figura 103B** por defecto. A veces se pide **103C**, para rematar el lado recto
  en obra.
- **Los lados A y C son el gancho sísmico**, en este orden de preferencia:
  1. **NCh 211, tabla 7** (135°, desarrollo del gancho): **10,8 cm** para φ8,
     **12,1** para φ10, **13,5** para φ12, **17,7** para φ16.
  2. **10·φ** si el diámetro no está tabulado.
  3. La medida que dé el plano, si la da — ésa manda sobre las dos anteriores.
  (No confundir con la extensión recta después del doblez, que es 6·φ con mínimo
  7,5 cm: son medidas distintas y las dos son correctas.)
- **Se inserta en XY**, para que en esa cara se vea la figura.
- **Jerarquía 1.** El ajuste fino se hace con offset, no moviéndole la jerarquía.
- **Alineada en los cruces**: si calza en el eje, perfecto. No hay que forzarla con
  fórmulas raras — el desplazamiento físico real es menor que la lectura del dibujo.

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

**ORDEN DE ARMADO — y sirve para SUGERIR lo que falta.** El flujo natural es:

> **MH → cabezales → MV o confinamiento (indistinto) → TR**

Las dos primeras sí quieren ese orden: el cabezal se arma después de la MH porque se
apoya en ella. Y la **TR va al final**, cuando ya existen MV y MH — antes no hay nada
que coser.

Cuando el usuario ha pedido una parte, **cierra la respuesta ofreciendo el siguiente
paso de esa lista, en UNA línea y sin interrogar**. «Listo la MH. ¿Le pongo los
cabezales?» es ayuda; una lista de preguntas es un formulario. **No es regla dura**:
si el usuario salta el orden, se hace lo que pide y no se le corrige.

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
