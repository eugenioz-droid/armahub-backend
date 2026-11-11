# ARMACERO — Reglas obligatorias de diseño para agentes de IA

Versión 1.0 — 11 de noviembre de 2026

## Propósito y prioridad
Este sistema estandariza nuevas pantallas y mejoras puntuales, **no autoriza un rediseño general**.
Al editar una aplicación existente, prima **preservar el diseño y comportamiento de lo que no se solicitó cambiar**. Las cuatro láminas de `manuales/` son referencias visuales; los valores técnicos exactos están en `tokens.json` y `armacero-theme.css`, que prevalecen si las imágenes discrepan.

## Antes de editar
1. Inspeccionar los componentes y estilos existentes en la pantalla.
2. Identificar componentes reutilizables; no duplicarlos si ya existe una variante válida.
3. Delimitar los archivos y componentes afectados por el pedido.
4. Si el pedido no solicita rediseño, conservar layout, jerarquía, tablas, filtros, orden, navegación y estados presentes.
5. Si hay una contradicción entre los manuales y una pantalla existente que funciona, no cambiarla automáticamente; reportar la discrepancia y proponer migración separada.

## Paleta
- Identidad derivada de logos: **verde #7EBA27**, **azul #104F9E** (medidos en PNG).
- Interfaz: negro de header #171717, blanco #FFFFFF, fondo #F3F4F6, borde #D9DDE3, texto #292D32.
- Verde para acción primaria, selección, acentos y KPIs relevantes; negro/grises para estructura; azul para información, navegación secundaria o controles específicos preexistentes.
- Colores operativos de estado permitidos solo con significado claro: éxito #248447, advertencia #D97706, peligro #DC2626, información #1769C2 y validación #7E36B1.
- No asignar rojo, naranja o verde a series por mera decoración. En gráficos multiserie, usar paleta estable y leyenda clara.
- No inventar un nuevo color de marca, degradados decorativos ni sombras pronunciadas.
- Para texto pequeño, preferir tonos oscuros accesibles; **no usar el verde corporativo como texto pequeño sobre blanco** si no alcanza contraste. El verde oficial puede estar en fondos, líneas, iconos y acentos.

## Componentes
- Header negro con identidad gráfica y acento inferior verde cuando sea apropiado al proyecto.
- Tabs con indicador inferior verde para el activo; preservación de niveles de navegación ya existentes.
- Tarjetas blancas sobre fondo gris claro con bordes finos y radios modestos.
- Botón primario verde, secundario neutro, informativo azul solo cuando tenga función reconocible; peligro rojo para acciones destructivas.
- Estados de datos consistentes: terminado, edición, revisión, validación, abierto/cerrado según significado del sistema. No alterar valores ni lógica de negocio.
- Filtros alineados y agrupados; tablas compactas y legibles. Priorizar densidad funcional en pantallas técnicas como Bar Manager.
- No cambiar iconografía, lenguaje o nombres de tabs establecidos sin instrucción específica.

## Gráficos y dashboards
- Priorizar lectura rápida: título claro, unidad, periodo, etiquetas y totales donde correspondan.
- Paleta de series sugerida (no es identidad de marca): `#7EBA27`, `#104F9E`, `#FF8A00`, `#8344AD`, `#278E86`, `#687582`, `#DB3B3B`.
- **Una misma categoría debe conservar su color dentro del mismo dashboard y en distintos gráficos relacionados**. Mantener el mapeo categoría→color estable entre filtros y periodos; no depender de la posición en el arreglo.
- Verde para una serie prioritaria o valor seleccionado cuando no compita con la semántica del estado.
- Comparaciones: barras; tendencias: líneas; composición: apiladas; rankings: barras horizontales. Evitar 3D, exceso de series, leyendas redundantes y etiquetas amontonadas.
- Ejes y grillas sutiles; indicar kg/Tn, fechas, periodo y unidades con consistencia. Si existen muchos datos, adaptar etiquetas o visualización sin ocultar información de negocio.
- KPI: etiqueta breve + cifra legible + unidad; formato de números coherente con la aplicación.

## Layout
- En nuevas vistas, preferir estructura: header/contexto → tabs → título/filtros → contenido.
- Grilla de 12 columnas como guía, **no imposición retroactiva**. KPIs en grupos de 3–4; gráficos con ancho adecuado; tablas sin estrechar columnas críticas.
- Espaciado base 8/16/24 px, bordes 1 px, radio habitual 8 px; ajustar a la densidad de la herramienta.
- Priorizar accesibilidad, foco visible, teclado, responsividad y contraste.

## Implementación segura
1. Para páginas nuevas, usar la clase contenedora `.arm-ds` e importar `armacero-theme.css`, o adaptar tokens al sistema de estilos actual (React/CSS modules/Tailwind/etc.).
2. **No insertar `.arm-ds` en la raíz global de una aplicación existente** sin evaluar impacto.
3. No introducir CSS global para `body`, `button`, `table`, `input` o `*` que altere módulos existentes.
4. No reemplazar librerías de gráficos, componentes, CSS, ni layouts enteros solo para aplicar este manual.
5. Ante una mejora puntual, cambiar únicamente lo necesario; hacer revisión visual de estados, densidad y responsive.
6. Documentar nuevas excepciones de diseño antes de convertirlas en estándar.

## Plantilla para cada petición a Claude
> Aplica el Sistema de Diseño Digital Armacero. Antes de programar, revisa `DESIGN_RULES.md`, `tokens.json`, `armacero-theme.css` y las láminas relevantes. Trabaja solo sobre los componentes incluidos en mi solicitud. Preserva la estructura, estilos aprobados y funcionalidades existentes. No inventes colores, no rediseñes pantallas no solicitadas y no hagas cambios globales. Si encuentras una excepción, descríbela antes de modificarla. Al finalizar, enumera los archivos cambiados y qué se verificó.

## Notas de interpretación
- Los manuales son **guías visuales ilustrativas**, no especificaciones pixel-perfect ni el equivalente al código fuente de las pantallas.
- Los HEX dibujados dentro de las imágenes generadas pueden ser aproximados o inconsistentes. **Los archivos de tokens gobiernan los colores**.
- Los colores de estado se proponen para uniformidad y no deben reemplazar automáticamente los colores semánticos ya implementados.
