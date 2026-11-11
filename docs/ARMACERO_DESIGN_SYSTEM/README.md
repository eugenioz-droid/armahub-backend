# Sistema de Diseño Digital Armacero — v1.0

Incluye 4 manuales visuales aprobados como referencia, logos de origen, `tokens.json`, CSS **opt-in** y `DESIGN_RULES.md` para Claude/otros agentes de código.

## Empezar en un proyecto
1. Copiar `DESIGN_RULES.md`, `tokens.json` y `armacero-theme.css` a una carpeta de diseño accesible al agente (p. ej. `design-system/`).
2. Adjuntar las 4 imágenes de `manuales/` o indicar su ruta cuando se diseñen interfaces.
3. Dar a Claude la instrucción de leer `DESIGN_RULES.md` **antes de tocar código**; se puede reflejar el mismo criterio en `CLAUDE.md` del repositorio.
4. Solo en **nuevas vistas** importar el CSS y aplicar la clase contenedora `arm-ds` para activar los estilos. No aplicar globalmente en Arma Hub sin revisión.
5. Probar los cambios visualmente. No es un paquete instalado ni una migración automática.

## Fuente de verdad
- **Verde oficial tomado de logo:** `#7EBA27` (RGB 126,186,39).
- **Azul oficial tomado de logo:** `#104F9E` (RGB 16,79,158).
- Negro, neutros, paleta de datos y estados: valores **propuestos para sistemas digitales**, no extraídos de un manual de marca oficial.
- Las láminas visuales se generaron como ejemplos y pueden mostrar códigos hex distintos. En caso de conflicto, aplicar `tokens.json` / CSS.

## Alcance
Este sistema no redefine layouts aprobados ni obliga a reescribir interfaces existentes. Sirve para componentes nuevos, coherencia futura y homologaciones solicitadas explícitamente.
