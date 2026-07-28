# ANEXO de detalle: Pedidos de Cliente (portal externo)

> **NO es un programa independiente.** Es el detalle de la visión de pedidos referida en SPECS
> §4.7 y en el bloque 5N del maestro `docs/programa-versiones/programa_v1.00.md`. Cuando se
> planifique su implementación tendrá su propia sub-fase en el maestro. Por ahora es fundamento.

**Estado:** PLANIFICACIÓN — NO implementar aún. Se construye después de "Agregar Cubicación".
Condiciona el diseño de HOY solo en que las barras llevan `origen` + `estado` + `lote`.

---

## 1. Visión

Un cliente (constructora) sube un **pedido específico** de barras a su obra. El motor de creación
(el mismo de "Agregar Cubicación") se RECICLA — solo cambia el canal (`origen='pedido'`), el
etiquetado y el flujo de aprobación. El cliente NO ve la operación interna.

Flujo ideal (confirmado con el usuario):
```
Cliente sube pedido (portal) → bandeja de pedidos (estado='pendiente')
  → USC valida y hace FORWARD (coordina con cliente; el USC es el cliente interno del cubicador)
  → Cubicador revisa/ajusta → valida
  → sube lo exportado a aSa Studio
  → USC sigue su flujo (programar). Al cliente se le AVISA "validado" (sin fecha).
```
Beneficio adicional: medir tiempos de respuesta. (Flujo directo-al-cubicador se evalúa después.)

---

## 2. Decisión de arquitectura (razonada como desarrollo profesional)

**El cliente externo NO comparte la superficie de aplicación interna.** No por el rol (un rol RO
"funciona"), sino por arquitectura que debe escalar a mucho cliente/data:

1. **Aislamiento de seguridad (blast radius):** un externo autenticando contra la misma app que
   los cubicadores es un vector. Un bug de autorización expondría data de otras obras/
   constructoras. El tenant externo se aísla (idealmente row-level security por tenant).
2. **Evolución independiente:** la vista del cliente y la interna evolucionan a ritmos distintos.
   Acoplarlas obliga a versionar todo junto.
3. **Escala y branding:** a futuro el portal del cliente puede requerir dominio/branding por
   constructora. Separación desde el diseño.

**Arquitectura propuesta:**
- **Un solo backend + una sola base de datos** (fuente de verdad única, no duplicar data).
- **Multi-tenant con obra/constructora como partición**; autorización estricta en backend por
  tenant (nunca confiar en el frontend).
- **Dos superficies de frontend:**
  - Interna (ArmaHub actual): cubicadores, USC, admin.
  - **Portal de cliente** separado (build/entrada distinta) que consume la MISMA API con scope
    acotado y datos filtrados por su obra.
- **Router de entrada** en el URL raíz: segrega por tipo de usuario hacia la superficie que
  corresponde (interno → app interna; cliente → portal). El usuario lo pidió así.
- El pedido entra por el portal → API → **bandeja de pedidos** (`origen='pedido'`,
  `estado='pendiente'`) → flujo interno.

**Conversa con** la caluga **Programa de Obra** (F8, hoy en discovery) — módulo de gestión de la
obra donde el cliente tendrá su acceso acotado. NO duplicar auth ahí; reusar el modelo de roles
por obra (`proyecto_usuarios`, rol `cliente`).

---

## 3. Reúso del motor (clave: no duplicar el editor)

El formulario de creación de barras es el MISMO núcleo. Lo que cambia entre canal interno y
pedido de cliente:
- `origen`: `manual` (cubicador) vs `pedido` (cliente).
- `estado` / flujo: la manual del cubicador nace directa; el pedido pasa por
  `pendiente → validado_usc → revisado_cubicador → aprobado`.
- **Envoltorio de flujo** (bandeja, validaciones, notificaciones, forward) — eso sí es nuevo.

Se duplica el **traje**, no el motor. Por eso el motor se diseña con `origen`/`estado`/`lote`
parametrizables desde ahora.

---

## 4. Estados del pedido (borrador)

`pendiente` (cliente lo envió) · `en_revision_usc` · `forward_hecho` · `en_cubicacion` ·
`aprobado` (cubicador validó → a aSa Studio) · `rechazado`/`observado` (vuelve al cliente).
Cada transición con actor + timestamp (para medir tiempos de respuesta).

---

## 5. Decisiones pendientes (para el discovery de esta fase)

- ¿El cliente ve el estado de su pedido en tiempo real, o solo recibe aviso al validarse?
- ¿El USC forward es obligatorio siempre, o configurable por obra?
- ¿Rechazo/observación devuelve el pedido editable al cliente, o se cierra y reabre?
- ¿Notificaciones por correo (Resend, ya hay infra) al cliente en cada hito, o solo al aprobar?
- ¿El portal del cliente es sub-app del mismo repo o repo separado? (define pipeline de deploy).
- Multi-constructora: ¿un cliente ve solo su obra, o una constructora con varias obras las ve
  todas?

---

## 6. Qué condiciona HOY (mínimo)

Solo esto, para no refactorizar después:
- `barras.origen` soporta `'pedido'` (ya está en el enum de valores).
- `barras.estado` existe (se agrega en "Agregar Cubicación").
- `lote_id` / entidad de lote puede representar también un pedido (o entidad hermana `pedidos`).
- El motor de creación no asume "cubicador" hardcodeado: recibe origen/estado como parámetros.

Todo lo demás (portal, bandeja, flujo, notificaciones) es F futura.
