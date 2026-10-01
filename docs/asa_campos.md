# Catálogo de campos de la API de aSa

Archivo de referencia. Cada endpoint que se documenta queda acá con **todos** sus campos,
marcados con lo que hacemos con cada uno. Así, cuando haga falta un dato nuevo, se mira
esta lista en vez de volver a pedir la documentación.

El diseño de la integración (credenciales, espejo diario, límites) está en
[integracion_asa.md](integracion_asa.md). Acá sólo viven los campos.

**Convención de las marcas:**

| | significado |
|---|---|
| ✔ | va en el `$select`. Lo usamos o lo vamos a usar |
| ○ | disponible y puede servir; hoy no se pide |
| ✖ | **no se pide nunca** — dato personal, o ruido |

Que un campo no esté en el `$select` significa que **nunca sale de aSa**. Ésa es la
protección real de datos personales: no es una política, es que no se pide.

---

## Host y forma de la consulta

```
GET https://matco.asa.studio/api/public/getScheduling?$select=CtrlCode,ProjShipDate,…

Accept:          application/json
Authorize:       api-key            ← el literal "api-key"
AsaStudioApiKey: <la clave>
```

- Host de producción: **`matco.asa.studio`** (el `qa254.asahq.com` de la doc es el QA).
- Ruta: `/api/public/<endpoint>`
- Autenticación: dos cabeceras. El detalle y por qué no era adivinable, en
  [integracion_asa.md](integracion_asa.md).

---

## `getOrderSummary` — el código de control

**Grano:** la doc dice *"grouped by CtrlCode, BarSizeID, ProductID, UnitMeasID"*. O sea
**NO es una fila por CC**: es una fila por (CC × diámetro × producto × unidad). Un CC con
8 diámetros son 8 filas. Para el peso total del CC **hay que sumar `TotalKgs`**.

| Campo | Tipo | | Para qué |
|---|---|:-:|---|
| `ControlCode` | String | ✔ | **el CC.** El ancla de todo |
| `JobID` | String | ✔ | la obra |
| `JobKey` | Int32 | ✔ | id numérico de la obra |
| `JobName` | String | ✔ | nombre de la obra |
| `Descr` | String | ✔ | **el sector.** En aSa no existen sectores: van como texto libre acá. Es la llave de cruce con nuestras tareas |
| `Order` | String | ✔ | id del pedido |
| `OrderKey` | Int32 | ✔ | id numérico del pedido |
| `OrderDate` | DateTime | ✔ | cuándo se pidió |
| `RequestedDate` | DateTime | ✔ | fecha solicitada — se cruza con nuestra fecha de despacho |
| `PromisedDeliveryDate` | DateTime | ✔ | fecha comprometida |
| `TotalKgs` | Decimal | ✔ | **los kilos.** Sumar por CC |
| `Status` / `StatusID` | String | ✔ | estado del pedido |
| `DetailPerson` | String | ✔ | **quién lo cubicó.** Cierra el cruce que pidió el usuario |
| `DetailLocation` | String | ✔ | dónde se cubicó. A ver si distingue ArmaHub / ADetailer / aSa directo |
| `LastModified` | DateTime | ✔ | **sync incremental** (`$filter=LastModified gt ...`) |
| `LastModifiedTime` | DateTimeOffset | ✔ | idem, con hora |
| `Hold` / `HoldReason` | Bool/String | ✔ | para excluir pedidos detenidos |
| `Inactive` | Boolean | ✔ | para excluir los inactivos |
| `Diameter` | String | ○ | el diámetro del grupo |
| `CustomerID` / `CustomerName` | String | ○ | cliente (empresa, no persona) |
| `BusPartnerKey` | Int32 | ○ | |
| `Reference` | String | ○ | **campo libre del pedido.** Si algún día el export de ArmaHub estampa acá el `lote_id`, el cruce deja de ser por nombre y pasa a ser exacto |
| `PONum` | String | ○ | número de OC del cliente |
| `ReleaseID` / `ReleaseSubNum` / `RevisionNum` | String | ○ | versionado del pedido |
| `OrderTypeID` / `OrderTypeDescr` | String | ○ | tipo de pedido |
| `BentKgs` / `StraightKgs` | Decimal | ○ | peso separado doblado/recto |
| `BentItems` / `StraightItems` / `TotalItems` | Int32 | ○ | |
| `BentPieces` / `StraightPieces` / `TotalPieces` | Decimal | ○ | |
| `BentLength` / `StraightLength` / `TotalLength` | Decimal | ○ | |
| `Grade` / `Coating` / `Texture` / `Material` | String | ○ | atributos del material |
| `Product*` (7 campos) | varios | ○ | producto, categoría, clase |
| `QtyUM` | String | ○ | unidad de medida |
| `FabLocation` / `SalesLocation` / `PlacingLocation` / `BillingLocation` | String | ○ | |
| `PlacerPerson` | String | ○ | |
| `Drawing` | String | ○ | el plano |
| `OrderComment` | String | ○ | |
| `AltCustomer` | String | ○ | |
| `OriginalQuote` | String | ○ | |
| `ShipMethodID` / `ShipMethodDescr` | String | ○ | |
| `DefaultReasonCodeID` / `DefaultReasonCodeDescr` | String | ○ | |
| `TotalSummaryPrice` / `SalesTax` / `FreightTotal` | Decimal | ✖ | **precios.** No los necesitamos y son sensibles comercialmente |
| `PromisedDeliveryTime` / `RequestedTime` | TimeSpan | ✖ | la hora no aporta al programa |
| `DomesticSteelOnly` / `SteelReqFrom` | String | ✖ | normativa US, no aplica |
| `IsCounterSale` / `CounterSalePmtCollected` | Bool | ✖ | venta de mesón, no aplica |
| `ShipContactFirstName` `…LastName` `…MiddleName` `…Title` `…Suffix` | String | ✖ | **nombre de una persona** |
| `ShipContactPhone*` (3) `…Email*` (3) `…Fax*` (3) `…Web*` (3) | String | ✖ | **teléfono, correo, fax de una persona** |
| `ShipAddrLine1..5` `…City` `…State` `…Country` `…PostalCode` | String | ✖ | dirección de despacho. No la necesitamos |

**`$select` propuesto:**

```
ControlCode,JobID,JobKey,JobName,Descr,Order,OrderKey,OrderDate,RequestedDate,
PromisedDeliveryDate,TotalKgs,Status,StatusID,DetailPerson,DetailLocation,
Hold,Inactive,LastModified
```

---

## `getScheduling` — fechas reales y despacho

Hoy el usuario lo consume con este `$select`:
`CtrlCode,LoadLastModified,ProjFabDate,ProjShipDate,SchedStatusDescr,SchedStatusID,ShipID,TotalWeight`

| Campo | Tipo | | Para qué |
|---|---|:-:|---|
| `CtrlCode` | String | ✔ | el CC — cruza con `getOrderSummary` |
| `JobID` / `JobName` | String | ✔ | la obra (el usuario hoy no los pide; los agregaría) |
| `Descr` | String | ✔ | el sector, otra vez como texto libre |
| `ProjShipDate` | DateTime | ✔ | **fecha proyectada de despacho.** Se compara con la que programó el USC |
| `ProjFabDate` | DateTime | ✔ | fecha proyectada de fabricación |
| `PromisedDeliveryDate` | DateTime | ✔ | fecha comprometida |
| `RequestedDate` | DateTime | ✔ | fecha solicitada |
| `SchedStatusID` / `SchedStatusDescr` | String | ✔ | **estado en la programación de producción de aSa** |
| `OrderStatus` / `OrderStatusID` | String | ✔ | estado del pedido |
| `ShipID` | String | ✔ | guía de despacho: existe = se despachó de verdad |
| `TotalWeight` | Decimal | ✔ | peso total |
| `LoadLastModified` | DateTimeOffset | ✔ | **sync incremental** |
| `OrderID` | String | ✔ | el pedido |
| `LoadID` | String | ○ | la carga/camión |
| `StopNum` | Int32 | ○ | parada dentro de la carga |
| `TrailerID` / `TrailerDescr` | String | ○ | |
| `ShippingMethod` | String | ○ | |
| `FabLocID` / `FabLocName` | String | ○ | |
| `SchedOrderKey` | Int32 | ○ | |
| `ReleaseID` / `ReleaseSubNum` / `RevisionNum` | String | ○ | |
| `Reference` / `PONum` | String | ○ | |
| `Customer` / `CustomerName` | String | ○ | |
| `BendTime` / `CutTime` | Decimal | ○ | tiempos de máquina. Interesante algún día para capacidad |
| `PromisedDeliveryTime` / `RequestedTime` | TimeSpan | ✖ | |
| `ShipContactFirstName` `…LastName` `…MiddleName` `…Phone` `…Email` | String | ✖ | **datos personales** |
| `ShipToAddress` `…Line1..5` `…City` `…State` `…Country` `…PostCode` | String | ✖ | dirección |

**`$select` propuesto:**

```
CtrlCode,JobID,JobName,Descr,OrderID,OrderStatus,OrderStatusID,ProjFabDate,ProjShipDate,
PromisedDeliveryDate,RequestedDate,SchedStatusID,SchedStatusDescr,ShipID,TotalWeight,
LoadLastModified
```

---

## Endpoints descartados

| Endpoint | Por qué |
|---|---|
| `getWBSData` | **En aSa no existen los sectores constructivos.** Van como texto libre en `Descr`. El WBS no trae nada que sirva (confirmado por el usuario, 28-sep) |
| `getOrderItemView` | Grano de línea (`BarMark`, `BarSizeDescr`): cientos de miles de filas. No se espeja. Útil sólo para una consulta puntual de un CC |
| `getBusPartnerData`, todo lo `*Contact*` | Ahí viven nombres, correos y teléfonos de personas |
| Todos los `create*`, `update*`, `approveOrder` | **ArmaHub sólo lee.** Nunca se llaman |

---

## `getJobData` — las obras (documentado 28-sep)

**131 campos**, uno por obra. Entre ellos van `PrimaryContactFirstName`,
`PrimaryPhoneDetail`, `PrimaryEmailDetail` y nueve líneas de dirección: por eso el
`$select` acotado no es una optimización, es lo que impide que esos datos salgan de aSa.

**Volumen medido:** entre 600 y 1.400 jobs en total; **376 abiertos**
(`JobStatusID eq 'O'`), que se traen en **3,4 segundos** con el `$select` de abajo. Una
obra cerrada no se programa, así que el espejo sólo guarda las abiertas.

| Campo | Ejemplo real | | Para qué |
|---|---|:-:|---|
| `JobID` | `1023495B` | ✔ | la clave de la obra en aSa → `proyectos.asa_job_id` |
| `JobKey` | `510` | ✔ | id numérico |
| `JobName` | `PROMINCO - BARRAS` | ✔ | el nombre que se busca |
| `CustomerName` | `PROMINCO` | ✔ | cliente (empresa, no persona) |
| `JobStatusID` / `JobStatusDescr` | `O` / `Open` | ✔ | el filtro: sólo `O` |
| `DetailingLocName` | `Santiago` | ✔ | dónde se cubica |
| `LastModified` | `2025-10-09T19:50:04Z` | ✔ | para la sync incremental |
| `CustomerID`, `BillToID`, `BusPartnerKey` | `1023495` | ○ | |
| `CompanyID` / `CompanyName` | `MAT` / `Armacero Matco S.A.` | ○ | |
| `RegionID` / `RegionName` | `METRO` / `Metropolitana…` | ○ | útil si algún día se filtra por zona |
| `SalesLocID`, `BillingLocID`, `DetailingLocID` | `SCL` | ○ | |
| `Detailer` / `DetailerName` | (vacío en la muestra) | ○ | el cubicador asignado en aSa |
| `Created` / `CreatedBy` / `LastModifiedBy` | `HMONDACA` | ○ | |
| `WeightStandard` / `WeightCalcID` | `Kgs` / `T` | ○ | |
| `BldgCodeID` / `BldgCodeDescr` | `ACI` | ○ | |
| `JobCustomFieldsUsed` | lista | ○ | **campos personalizados del job.** Candidato a guardar la Key de ArmaHub |
| `ProjStartDate` / `ProjEndDate` | null | ○ | |
| `CurrencyID`, `CreditLimit`, `RetntPct`, `TaxOnCost`… | | ✖ | condiciones comerciales |
| `PrimaryContact*`, `PrimaryPhone*`, `PrimaryEmail*` | | ✖ | **datos de una persona** |
| `PrimaryAddr*`, `ShipAddr*`, `PrimaryJobAddr`, `ShipToID` | | ✖ | direcciones |

**`$select` en uso** (el que aplica `programacion.py`):

```
JobID,JobKey,JobName,CustomerName,JobStatusID,JobStatusDescr,DetailingLocName,LastModified
```

Ocho columnas de 131, **ninguna personal** — verificado por el test.

### Los custom fields del job (`JobCustomFieldsUsed`, medido 29-sep)

Es una **lista anidada** de `{CustomFieldDescr, Value, DfltValue, Req}` por obra, y
**sólo viene cuando NO se usa `$select`** (con `$select=…,JobCustomFieldsUsed` llega
`null`). Sobre las 376 obras abiertas:

| Campo | Con valor | Valores vistos | Comentario |
|---|:-:|---|---|
| `USC` | 207 | `AT` 50 · `OO` 50 · `DI` 47 · `GM` 44 · `CM` 7 · `00` 7 · `OA`, `HM` 1 | **El USC de la obra ya está en aSa** (iniciales). Default `00`. Candidato a reemplazar la asignación manual del tab de Obras. |
| `Correo_USC` | 87 | constanza.retamal 24 · oscar.ortega 18 · german.maldonado 17 · angela.toledo 16 · dadiolet.inostroza 12 | Correo del USC. Dato personal: no espejar. |
| `Tipo_Obra` | 13 | `EDIFICACION` 5 · `INFRAESTRUCTURA` 4 · `YPS` 4 | Casi sin uso. |
| `Ton_Proyecto` | 43 | `10`, `200`, `1000`, `704`… | Toneladas estimadas del proyecto (texto). |
| `Calculista` | 1 | `NO SE SABE` | Sin uso. |

**No existe** ningún campo de Cubicación/Digitación ni de segmento: ésos viven en
ArmaHub (`asa_obra_atributos`, migración 115).

---

## `getOrderItemView` — la barra, y **el elemento** (documentado 1-oct)

**154 campos**, grano **una fila por barra** (ítem del pedido). Es el único endpoint que
baja del código de control al detalle.

**SE ATORA SIN FILTRO.** `?$top=3` a secas da timeout: aSa arma la vista entera antes de
recortar. Hay que acotar siempre por `CtrlCode` (`$filter=CtrlCode eq 'SUQ1'`), que
responde en un par de segundos con sus 150 ítems. Ojo: la clave es **`CtrlCode`**, no
`ControlCode` — ese nombre da HTTP 400.

### El hallazgo: el ELEMENTO existe en aSa

El usuario dijo que dentro del CC hay un campo que agrupa barras y nombra el elemento.
Es **`ElementID` + `ElementDesc`**, y viene en el **100%** de los ítems medidos.

| Campo | Ejemplo real | Qué es |
|---|---|---|
| `ElementID` | `K(12-18)`, `11(F-H)`, `G(17)` · `01`, `02` · `TRAMO 1 Y 2` | **El elemento.** En muros es el EJE, con la misma nomenclatura que ArmaHub; en losas y fundaciones, un correlativo |
| `ElementDesc` | `316-2 e=20, e=50 C.Malla` · `LOSA 201@206 PL-14E` · `1 MODULO (4.0 x 5.3 m)` | **La descripción del elemento** (espesor, malla, plano de origen) |
| `ElementKey` / `ElementQty` | | id interno y cuántos elementos iguales |

Casos medidos: `ELEV- P2 C2` de EBCO = 151 barras repartidas en **22 elementos**
(`K(12-18)` 18 barras 1.021 kg, `11(F-H)` 4 barras 326 kg…); `LOSAS C-4 SUBT.` de TECNIA
= 31 barras en 3 losas con su plano (`LOSA 207@212 PL-14E`).

**Consecuencia para auditoría:** no hay que adivinar el elemento parseando el `Descr` del
CC —medido: el eje aparece sólo en el 2% de las descripciones—. Se pide a `getOrderItemView`
y viene el elemento real con sus barras. Una obra que no está en ArmaHub se puede auditar
con la misma profundidad.

### Los campos de la barra que sirven para auditar

| Campo | Ejemplo | |
|---|---|:-:|
| `BarMark` | `10mmA110` | ✔ la marca |
| `BarSizeDescr` / `GradeID` / `MaterialDescr` | `10mm` / `Carbon` | ✔ diámetro y material |
| `TotalQty` / `Qty` / `Mult1` / `Mult2` | | ✔ cantidades |
| `LengthCut` / `LengthPay` / `LengthTheor` | | ✔ largo de corte, de pago y teórico |
| `ShapeTypeID` / `ShapeDims` / `_ShapeDims` / `PatternDescr` | | ✔ **la figura y sus dimensiones** |
| `PinDiam` / `BCD` / `LegAngle` | | ○ radio de doblado y ángulos |
| `LineWeight` | | ✔ peso de la línea |
| `SeqNo` / `LineNum` / `OrderItemKey` | | ○ orden dentro del pedido |
| `Notes` / `ShopMessage` / `FieldMessage` | | ○ notas al taller |
| `PlacingCodeDescr` / `FabClassDescr` | | ○ |
| `OrderDescr` | `ELEVACIONES ET-D PERIMETRAL` | ✔ es el `Descr` del CC, repetido en cada ítem |
| `Section` / `LevelID` / `Plan` / `WBSPath` / `WBSFullPath` | vacíos | ✖ no se usan en Matco |
| `*Price` / `*EP*` (≈30 campos) | | ✖ precios y preparación de extremos |

**Pendiente de medir:** si se puede filtrar por `JobID` o por fecha para traer una obra
entera (hoy sólo se probó CC a CC). De eso depende si los elementos se pueden espejar o
hay que pedirlos a demanda al abrir la auditoría.

---

## Pendientes de documentar

- `getShippingTickets` — si `ShipID` de Scheduling no basta.
- `JobCustomFieldsUsed` — ver qué campos personalizados existen; podría ser el lugar
  natural para estampar la Key de ArmaHub en el job.
