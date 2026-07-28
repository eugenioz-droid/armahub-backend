# ANEXO de detalle: Multicatálogo e Interoperabilidad de Formatos

> **NO es un programa independiente.** Es el levantamiento de la visión multicatálogo referida
> en la caluga Catálogo Armacero (SPECS §4A) y en el maestro `docs/programa-versiones/
> programa_v1.00.md`. Cuando se planifique su implementación tendrá su propia fase en el maestro.

**Estado:** PLANIFICACIÓN (no implementar aún). Catálogo Armacero = catálogo OFICIAL/canónico.

**Fecha:** 2026-07-28 · Autor de la visión: Eugenio.

---

## 1. Visión (en palabras del usuario)

- Trabajar con **otros catálogos** además del Armacero (ej. importar barras en **BVBS**, o
  en el **formato chileno** en proceso de estandarización, parecido a BVBS).
- Hacer **match de parámetros**: mapear cada parámetro del formato externo a un parámetro
  de nuestras barras → **convertir** las barras importadas al Catálogo Armacero.
- **Importar** desde varios formatos y **exportar** en el nuestro (y a futuro exportar a
  formatos variados para alimentar otras plataformas).
- Posible: **catálogo por obra** (una obra puede requerir un catálogo distinto) y/o un
  **conversor multicatálogo** que asigne parámetro-a-parámetro entre formatos.

**Principio rector:** el Catálogo Armacero es la **verdad canónica**. Todo formato externo
se traduce HACIA/DESDE ese modelo canónico. Nunca se mezclan modelos crudos.

---

## 2. Conceptos y decisiones a tomar (ANTES de codear)

Estas son las preguntas de producto que hay que zanjar con el usuario en su momento. NO
asumir; se listan para el levantamiento:

1. **Alcance del "catálogo por obra":** ¿una obra tiene su propio catálogo independiente, o
   siempre trabaja sobre el Armacero con un mapeo/subconjunto? (inclina a: Armacero canónico
   + perfiles de importación por obra, no catálogos paralelos que se desincronizan).
2. **Formatos objetivo iniciales:** BVBS (Bundesvereinigung, estándar de doblado de fierro)
   y el estándar chileno en formación. ¿Alguno más (ABS, PXML, CSV propietarios de otros
   software)? Priorizar 1 para el piloto.
3. **Dirección primero:** ¿importar (traer barras externas → Armacero) o exportar (Armacero
   → formato externo)? Importar suele ser lo que da valor primero (poblar catálogo).
4. **Nivel de match:** ¿mapeo automático por reglas + revisión manual, o siempre manual la
   primera vez y luego se recuerda el mapeo (plantilla de mapeo reutilizable)?
5. **Qué pasa con lo que NO mapea:** un parámetro externo sin equivalente Armacero →
   ¿se descarta, se guarda como metadato, o bloquea la importación? (regla vigente del
   proyecto: NUNCA descartar data del usuario en silencio → guardar como metadato).
6. **Unidades y convenciones:** BVBS usa mm, ángulos y sentido de doblado propios; Armacero
   usa su grilla + convención aSa (90° implícito). El conversor debe normalizar unidades,
   ángulos y sentido de arco/guata. Definir la tabla de equivalencias.

---

## 3. Modelo de datos (dirección propuesta, sujeta a decisión)

- **Modelo canónico Armacero** = el actual (`geometria` JSONB: nodos/tramos/puntos/ángulos/
  cotas de arco/etiquetas). Es el pivote. Ver [[project-armahub-disenador-figuras]].
- **Catálogo (entidad):** hoy hay UN catálogo implícito. Introducir el concepto de
  `catalogo_id` (Armacero = catálogo oficial, id fijo). Las figuras cuelgan de un catálogo.
- **Perfil de formato (`formato_spec`):** describe un formato externo (BVBS, chileno):
  lista de campos, tipos, unidades, orden. Es DATA (no código) → se agregan formatos sin
  redeploy.
- **Mapa de conversión (`mapa_conversion`):** por cada par (formato externo ↔ Armacero),
  una tabla parámetro→parámetro + reglas de transformación (unidad, factor, ángulo, sentido).
  Reutilizable: se define una vez por formato y se aplica a todas las barras de ese formato.
- **DEUDA relacionada ya anotada (SPECS §4.5):** el modelo 9 dims + 4 ángulos + radio es
  FIJO y se quedará corto. El multicatálogo AGRAVA esto (formatos externos traen más
  parámetros). Converge con la necesidad de **parámetros como lista extensible/JSONB**.
  Resolver el modelo extensible es PRERREQUISITO natural del multicatálogo.

---

## 4. Arquitectura propuesta (conversor multicatálogo)

Pipeline en 3 capas, todas traducen contra el canónico Armacero:

```
[Archivo formato X] --parser(X)--> [modelo intermedio X] --mapa(X→Armacero)--> [Armacero canónico] --> guardar en catálogo
[Armacero canónico] --mapa(Armacero→Y)--> [modelo intermedio Y] --serializer(Y)--> [Archivo formato Y]
```

- **Parsers/serializers por formato:** un módulo por formato (leer/escribir BVBS, chileno,
  etc.). Aislados; agregar un formato = agregar un módulo + su `formato_spec`.
- **Motor de mapeo genérico:** aplica un `mapa_conversion` (data) sobre el modelo intermedio.
  Un solo motor sirve para todos los formatos → no se duplica lógica por formato.
- **Validador de conversión:** verifica que la barra convertida sea válida en Armacero
  (dims coherentes, ángulos soportados, geometría cerrable). Lo que no valida → reporte al
  usuario (marcar, no descartar).

**Regla anti-frankenstein:** parser/serializer NUNCA conocen el otro formato; solo hablan
su formato ↔ modelo intermedio. El match vive SOLO en el `mapa_conversion` (data). Así no
se acoplan formatos entre sí.

---

## 5. UI mínima (a futuro)

- **Importar:** subir archivo → elegir formato → el sistema propone un mapeo (o se elige un
  mapa guardado) → pantalla de **match parámetro-a-parámetro** (dropdowns: cada campo
  externo → un parámetro Armacero) → preview de las barras convertidas → confirmar → entran
  al catálogo. El mapeo se guarda como plantilla reutilizable.
- **Exportar:** seleccionar barras del Catálogo Armacero → elegir formato destino → descargar.
- **Conversor multicatálogo** (la "pantalla de match"): editor visual del `mapa_conversion`
  entre dos formatos, reutilizable.

---

## 6. Tareas mínimas para el levantamiento (orden sugerido)

Fase 0 — **Levantamiento y decisiones** (sin código):
- [ ] Zanjar las 6 decisiones de §2 con el usuario.
- [ ] Conseguir specs reales de BVBS y del estándar chileno (campos, unidades, ejemplos).
- [ ] Tabla de equivalencias Armacero ↔ BVBS ↔ chileno (parámetro por parámetro, unidades,
      ángulos, sentido de arco). Este es el entregable clave del levantamiento.

Fase 1 — **Modelo extensible** (prerrequisito):
- [ ] Resolver parámetros extensibles (JSONB/lista) — cierra la DEUDA de SPECS §4.5.
- [ ] Introducir concepto de `catalogo_id` (Armacero = oficial).

Fase 2 — **Piloto de importación (1 formato)**:
- [ ] Parser del formato piloto → modelo intermedio.
- [ ] Motor de mapeo genérico + primer `mapa_conversion`.
- [ ] Validador de conversión + reporte de no-mapeados.
- [ ] UI de match parámetro-a-parámetro + preview + guardar plantilla de mapeo.

Fase 3 — **Exportación**:
- [ ] Serializer del formato Armacero (o BVBS) + UI de exportar.

Fase 4 — **Extensión**:
- [ ] Segundo formato (reusar motor de mapeo; solo parser/serializer + spec + mapa).
- [ ] Catálogo por obra (si la decisión de §2.1 lo confirma).

---

## 7. Notas de eficiencia (para no rehacer)

- **Un solo motor de mapeo** (data-driven) evita reescribir lógica por formato.
- **El canónico Armacero es el pivote** → N formatos requieren N parsers + N mapas, no N².
- **Mapas reutilizables** (plantilla por formato) → el usuario mapea una vez, no por barra.
- **No descartar data** no mapeada → guardar como metadato (regla del proyecto).
- Converge con la deuda del **modelo de parámetros extensible**: hacer ese refactor primero
  evita cablear el 9+4+1 en todo el pipeline multicatálogo.
