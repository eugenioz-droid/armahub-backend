"""
modelador.py — Backend del Modelador 3D (F1 · T1.1 + CICLO DE VIDA DEL TEMPLATE).

Router de la biblioteca de templates y de la traza de instancias:
  POST   /templates                          -> crea un template en la biblioteca
  GET    /templates?tipo=&obra=&nombre=      -> lista LIVIANA (sin params) para elegir
  GET    /templates/{id}                     -> un template completo (con params)
  PUT    /templates/{id}                     -> edita nombre / tipo / params / obra
  DELETE /templates/{id}                     -> borra (409 si tiene instancias)
  POST   /elementos/instancia                -> guarda la RECETA instanciada (trazabilidad)
  PUT    /elementos/instancia/{id}           -> ACTUALIZA esa estructura (no la reemplaza)
  DELETE /elementos/instancia/{id}           -> borra una estructura VACÍA (409 si tiene barras)
  GET    /elementos/instancia/{id}           -> la estructura completa, para REABRIRLA
  GET    /lotes/{id}/elementos               -> estructuras de un despiece + KPIs (items/barras/kg/Ø)
  GET    /elementos/estructuras?proyecto=&elemento= -> estructuras BANDERADAS de una obra

IMPORTANTE: la INSERCIÓN de las barras generadas NO pasa por aquí — se reusa el
endpoint existente POST /lotes/{id}/barras (lotes.py, extendido en T1.1 con
origen/template_instancia_id). Este router SOLO persiste la definición del
template y la receta instanciada (elementos_template) para trazabilidad.
Y por eso mismo la PRIMERA carga de una estructura tampoco pasa por aquí: la fila de
elementos_template y sus barras se escriben en la MISMA transacción, desde ese POST,
llamando a insertar_instancia() (ver su docstring). Dos transacciones dejaban
estructuras vacías cuando las barras se caían.

Tablas: templates_catalogo, elementos_template (migración 104; migración 105
agrega schema_version / updated_at / editado_por, aditiva).

DOS CLIENTES, UNA TABLA (no romper ninguno):
  · Enfierrador MVP (panel_3d.js): guarda desde el Fabricator, con la obra del lote.
  · Template Editor (template_editor.js): vive en el CATÁLOGO, guarda templates
    generales (sin obra) y usa dims {modo, valor}.
El shape de params se identifica con schema_version (ver _deducir_schema_version):
se estampa al escribir y se deduce al leer para las filas viejas — la tabla NO se
reescribe.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import json

from .db import get_conn, audit
from .auth import get_current_user

router = APIRouter()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# PERMISOS — FUENTE ÚNICA (no repetir criterios sueltos por endpoint)
# ---------------------------------------------------------------------------
# El cruce que había: el Template Editor vive en el módulo CATÁLOGO (registry.js:
# allowedRoles = admin / admin_calidad / miembro) pero POST /templates exigía
# _puede_editar_barras (miembro del ÁREA 'cubicaciones'). Resultado: un miembro que
# abre el editor, diseña el template entero y recibe 403 al guardar.
#
# CRITERIO ELEGIDO (uno solo, reusado por POST/PUT/DELETE):
#   puede gestionar templates = quien puede ENTRAR al Catálogo donde vive el editor
#   (admin, admin_calidad, miembro)  ∪  quien YA podía guardar hoy
#   (_puede_editar_barras: área 'cubicaciones' — el Enfierrador)
#   ∪  los editores del catálogo de figuras (_puede_editar_catalogo).
# Es la UNIÓN con lo que ya existía: NADIE pierde un permiso que hoy tiene, y no
# entra ningún rol que hoy no pueda siquiera abrir alguna de las dos pantallas.
# Los roles 'cliente' y 'externo' quedan fuera (no acceden ni al Catálogo ni al
# Enfierrador).
_ROLES_MODULO_CATALOGO = ("admin", "admin_calidad", "miembro")

# LECTURA: antes la podía hacer CUALQUIER autenticado — incluido un 'cliente', que
# sí entra al módulo Cubicación y habría visto la biblioteca completa de todas las
# obras. Los templates son data interna de Armacero: se cierran a los roles que no
# son personal interno. Regla explícita, en un solo lugar.
_ROLES_SIN_LECTURA_TEMPLATES = ("cliente", "externo")


def _puede_gestionar_templates(cur, user) -> bool:
    """CRITERIO ÚNICO de ESCRITURA sobre la biblioteca (crear / editar / borrar)."""
    role = (user.get("role") or "").lower()
    if role in _ROLES_MODULO_CATALOGO:
        return True
    # Editores del catálogo de figuras (override por email de catalogo.py): si pueden
    # crear figuras, pueden crear templates hechos con esas figuras.
    from .catalogo import _puede_editar_catalogo
    if _puede_editar_catalogo(user):
        return True
    # Quien ya guardaba templates antes de esta tanda (área de Cubicaciones).
    from .barras import _puede_editar_barras
    return _puede_editar_barras(cur, user)


def _check_permiso_templates(cur, user):
    if not _puede_gestionar_templates(cur, user):
        raise HTTPException(
            status_code=403,
            detail="No tienes permiso para gestionar templates. Pídelo a un administrador.")


def _check_permiso_lectura(user):
    if (user.get("role") or "").lower() in _ROLES_SIN_LECTURA_TEMPLATES:
        raise HTTPException(status_code=403,
                            detail="La biblioteca de templates es interna de Armacero.")


def _puede_modificar_template(creado_por, user) -> bool:
    """Quién puede tocar ESTE template. templates_catalogo no tiene área ni obra
    obligatoria, así que se usa el criterio de propiedad que YA usa el proyecto para
    data creada por un usuario (constructoras._puede_modificar_cliente): lo modifica
    su AUTOR o un admin/admin_calidad. Las filas legacy sin creado_por solo las toca
    un admin (misma decisión que en constructoras)."""
    role = (user.get("role") or "").lower()
    if role in ("admin", "admin_calidad"):
        return True
    email = (user.get("email") or "").strip().lower()
    return bool(creado_por) and str(creado_por).strip().lower() == email and bool(email)


def _check_permiso_instancia(cur, user):
    """Las INSTANCIAS son traza de barras cargadas a un lote, no biblioteca: su
    permiso sigue siendo el de crear barras (sin cambios respecto de T1.1)."""
    from .barras import _puede_editar_barras
    if not _puede_editar_barras(cur, user):
        raise HTTPException(status_code=403,
                            detail="Solo un miembro del área de Cubicaciones puede cargar barras de un template.")


# ---------------------------------------------------------------------------
# SCHEMA DE params (shape de la receta)
# ---------------------------------------------------------------------------
SCHEMA_DIMS_PLANAS = 1   # Enfierrador MVP: dims numéricas planas  {"A": 30}
SCHEMA_DIMS_OBJETO = 2   # Template Editor: dims {modo, valor}     {"A": {"modo":"fija","valor":30}}
SCHEMA_ACTUAL = SCHEMA_DIMS_OBJETO


def _deducir_schema_version(dims_probe) -> int:
    """Deduce el shape mirando las dims de un componente. Se usa para las filas
    ESCRITAS ANTES de la migración 105 (schema_version NULL): se deduce AL LEER, la
    tabla no se reescribe. Si no hay con qué decidir, cae al shape actual (los dos
    clientes de hoy escriben {modo,valor})."""
    if isinstance(dims_probe, str):
        try:
            dims_probe = json.loads(dims_probe)
        except Exception:
            return SCHEMA_ACTUAL
    if not isinstance(dims_probe, dict) or not dims_probe:
        return SCHEMA_ACTUAL
    for v in dims_probe.values():
        if isinstance(v, dict):
            return SCHEMA_DIMS_OBJETO
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return SCHEMA_DIMS_PLANAS
    return SCHEMA_ACTUAL


def _dims_del_primer_componente(params) -> dict:
    """dims del componente 0 — la sonda con la que se deduce el shape al leer."""
    if not isinstance(params, dict):
        return {}
    comps = params.get("componentes")
    if not isinstance(comps, list) or not comps or not isinstance(comps[0], dict):
        return {}
    d = comps[0].get("dims")
    return d if isinstance(d, dict) else {}


def _schema_de_params(params) -> int:
    return _deducir_schema_version(_dims_del_primer_componente(params))


# ---------------------------------------------------------------------------
# VALIDACIÓN DE LA RECETA
# ---------------------------------------------------------------------------
# Hasta ahora se podía guardar un template que JAMÁS iba a generar barras (sin
# componentes, con figuras inexistentes, con lados sin medida): el error aparecía
# recién al cargar al despiece, cuando ya no se sabía qué faltaba.
#
# La validación es la MISMA para los dos shapes: mira el VALOR de cada dim y acepta
# tanto el número plano (Enfierrador) como el {modo, valor} (Template Editor). No hay
# rama por schema_version — así ninguno de los dos flujos queda fuera.
#
# QUÉ SE RECHAZA Y QUÉ NO (el criterio, en un solo lugar):
#   · se rechaza el HUECO: la dim declarada en «fija» SIN número, o con algo que no
#     es número. Ahí el motor no tiene qué dibujar y reglas.js se niega —a propósito—
#     a inventarle un 'auto' (el usuario pidió una medida concreta).
#   · se rechaza el imposible: una medida NEGATIVA, y una «fija» cuyo Δ la deja
#     negativa (las dos cifras están acá: se sabe AL GUARDAR, no al cargar).
#   · se rechaza el 0 en modo «fija» (cambio 15-ago): antes se aceptaba con la
#     teoría «0 = ese lado no se usa», pero el DESPIECE (catalogo._tiene_valor_real)
#     trata el 0 como slot faltante — el template guardaba con 200 y el lote entero
#     rebotaba con 400 al cargarlo. Los dos backends dicen ahora lo mismo.
#   · NO se rechaza el parcial que la receta no declara: ver la nota del bucle.
# Esta validación NIEGA UN GUARDADO, y un guardado negado es trabajo perdido: sólo
# frena lo que de verdad deja la receta ingenerable, nunca lo que está a medio
# escribir y el editor ya muestra en rojo.
_LETRAS_DIM = set("ABCDEFGHI")
_MAX_ERRORES_MOSTRADOS = 6


def _num(v):
    """float(v) o None si no es un número (no acepta bool: True no es una medida)."""
    if isinstance(v, bool) or v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _etiqueta_componente(i, comp) -> str:
    nombre = ""
    if isinstance(comp, dict):
        nombre = str(comp.get("comp_id") or comp.get("tipologia") or "").strip()
    return f"barra {i} «{nombre}»" if nombre else f"barra {i}"


def _validar_receta(cur, params) -> list:
    """Devuelve la lista de motivos por los que esta receta NO podría generar barras.
    Lista vacía = receta generable. Mensajes en castellano y accionables (dicen QUÉ
    falta y en qué barra)."""
    from .catalogo import cargar_figuras, get_figura

    if not isinstance(params, dict) or not params:
        return ["El template no trae receta."]

    errores = []
    geo = params.get("geometria")
    if not isinstance(geo, dict) or not geo:
        errores.append("El template no tiene las dimensiones del hormigón (largo, alto, ancho, recubrimientos).")

    comps = params.get("componentes")
    if not isinstance(comps, list) or not comps:
        errores.append("El template no tiene ninguna barra: agrega al menos un componente antes de guardar.")
        return errores

    # EL CATÁLOGO, UNA VEZ (antes: un SELECT a figuras_catalogo POR COMPONENTE, así que
    # guardar un template de 40 barras eran 40 round-trips a Supabase de las 44 consultas
    # del request; ahora 5). El conjunto sale de los MISMOS componentes que se recorren
    # abajo, así que no puede faltar ninguno. Ver catalogo.CatalogoFiguras.
    figuras = cargar_figuras(cur, {
        str(c.get("figura") or "").strip() for c in comps if isinstance(c, dict)
    })

    for i, comp in enumerate(comps, start=1):
        etq = _etiqueta_componente(i, comp)
        if not isinstance(comp, dict):
            errores.append(f"La {etq} no es un componente válido.")
            continue

        figura = str(comp.get("figura") or "").strip()
        if not figura:
            errores.append(f"La {etq} no tiene figura asignada.")
            continue
        fig = get_figura(figuras, figura)
        if fig is None:
            errores.append(f"La {etq} usa la figura «{figura}», que no existe en el catálogo de figuras.")
            continue

        diam = _num(comp.get("diam"))
        if diam is None or diam <= 0:
            errores.append(f"La {etq} no tiene diámetro.")

        dims = comp.get("dims")
        if not isinstance(dims, dict):
            dims = {}
        for letra in (fig.get("parciales") or []):
            L = str(letra).strip().upper()
            if L not in _LETRAS_DIM:
                continue  # letra sucia en el catálogo: la reporta el catálogo, no el template
            d = dims.get(L)
            if d is None:
                # UN PARCIAL NO DECLARADO NO ES UN ERROR: es 'auto'. Es el default
                # DOCUMENTADO de una dim y lo que el normalizador del front ya hace
                # (reglas.js _dimsCanon: los parciales del spec que la receta no trae
                # se rellenan con {modo:'auto'} y el motor los resuelve contra el
                # hormigón). Rechazarlos rompía el flujo REAL del Enfierrador: al
                # cambiar la figura de un componente desde el panel (panel_3d.js) las
                # dims no se reconcilian, así que una 101A que pasa a 104D queda con
                # sólo el lado A declarado — y hoy eso se guarda y genera barras bien.
                # Se valida SÓLO lo DECLARADO, que es donde el dato puede estar mal.
                continue
            if isinstance(d, dict):
                # Shape Template Editor. 'auto' lo resuelve el motor con el hormigón;
                # solo 'fija' obliga a traer la medida escrita por el usuario.
                # El Δ (delta) se valida en los dos modos: declarado pero ilegible es
                # un hueco, igual que una fija sin medida.
                delta = None
                if d.get("delta") not in (None, "", 0):
                    delta = _num(d.get("delta"))
                    if delta is None:
                        errores.append(
                            f"La {etq} tiene un Δ en el lado {L} que no es un número.")
                if str(d.get("modo") or "").strip().lower() == "fija":
                    v = _num(d.get("valor"))
                    if v is None:
                        errores.append(
                            f"La {etq} tiene el lado {L} en modo «fija» pero sin medida: "
                            f"escribe la medida o deja el lado en «auto».")
                    elif v < 0:
                        errores.append(f"La {etq} tiene el lado {L} en negativo ({v:g}).")
                    elif v == 0:
                        # (15-ago) El 0 se RECHAZA: este validador decía «0 = ese lado
                        # no se usa» mientras el despiece (catalogo._tiene_valor_real)
                        # trata 0 como SLOT FALTANTE — el template se guardaba con 200
                        # y al cargarlo el lote ENTERO rebotaba con 400. Los dos
                        # backends tienen que decir lo mismo, y la autoridad es el
                        # despiece (es quien factura). «Ese lado no se usa» se dice
                        # con la figura correcta, no con un 0.
                        errores.append(
                            f"La {etq} tiene el lado {L} en 0: el despiece trata el 0 "
                            f"como lado faltante y rechazaría el lote completo. Si ese "
                            f"lado no existe, usa la figura que corresponde.")
                    elif delta is not None and (v + delta) < 0:
                        # las DOS cifras son del usuario y están acá: si su suma es
                        # negativa la barra es imposible y se sabe AL GUARDAR.
                        errores.append(
                            f"La {etq} queda con el lado {L} en {v + delta:g} "
                            f"(medida {v:g} con Δ {delta:g}): una barra no puede "
                            f"tener un lado negativo.")
            else:
                # Shape Enfierrador: número plano. El 0 en un parcial USADO se
                # rechaza por lo mismo que en el shape del editor (ver arriba).
                v = _num(d)
                if v is None:
                    errores.append(f"La {etq} tiene el lado {L} sin medida.")
                elif v < 0:
                    errores.append(f"La {etq} tiene el lado {L} en negativo ({v:g}).")
                elif v == 0:
                    errores.append(
                        f"La {etq} tiene el lado {L} en 0: el despiece trata el 0 "
                        f"como lado faltante y rechazaría el lote completo.")

    return errores


def _raise_receta_invalida(errores):
    """422 con el detalle como TEXTO: los dos clientes muestran `detail` tal cual
    (un dict saldría como [object Object] en el editor)."""
    visibles = errores[:_MAX_ERRORES_MOSTRADOS]
    msg = " · ".join(visibles)
    resto = len(errores) - len(visibles)
    if resto > 0:
        msg += f" · (y {resto} problema(s) más)"
    raise HTTPException(status_code=422, detail="No se puede guardar el template: " + msg)


# ---------------------------------------------------------------------------
# OBRA
# ---------------------------------------------------------------------------
def _normalizar_obra(cur, obra):
    """La obra del template es un id_proyecto REAL (o None = template general, para
    todas las obras). Si viene algo, tiene que existir: un id inventado dejaba el
    template colgando de una obra que no está."""
    valor = (obra or "").strip() if isinstance(obra, str) else obra
    if not valor:
        return None
    cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (valor,))
    if not cur.fetchone():
        raise HTTPException(status_code=422, detail=f"La obra «{valor}» no existe.")
    return valor


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
class TemplateCrear(BaseModel):
    nombre: str
    tipo: str                      # 'viga' | 'muro' | 'columna' (MVP: viga, muro)
    params: dict                   # la RECETA (geometria + componentes)
    obra: Optional[str] = None     # id_proyecto de la obra (agrupa; None = general)


class TemplateActualizar(BaseModel):
    """PUT NO destructivo: solo se escriben los campos que VIENEN en el JSON
    (__fields_set__, mismo criterio que el PATCH de reclamos). Un campo ausente no
    se toca — así un cliente que solo renombra no borra la receta ni la obra."""
    nombre: Optional[str] = None
    tipo: Optional[str] = None
    params: Optional[dict] = None
    obra: Optional[str] = None


class InstanciaCrear(BaseModel):
    """La ESTRUCTURA que el editor cargó a un despiece. Los campos de traza son
    OPCIONALES a propósito: el Enfierrador MVP (panel_3d.js) manda sólo los tres de
    siempre y tiene que seguir funcionando igual."""
    lote_id: Optional[int] = None
    template_id: Optional[int] = None
    params: dict
    # TRAZA (migración 107). `nombre` viene DERIVADO del front (obra · ciclo · piso ·
    # eje): el usuario no escribe un nombre de estructura.
    nombre: Optional[str] = None
    elemento: Optional[str] = None
    piso: Optional[str] = None
    id_proyecto: Optional[str] = None
    sector: Optional[str] = None
    ciclo: Optional[str] = None
    eje: Optional[str] = None


class InstanciaActualizar(BaseModel):
    """PUT NO destructivo (mismo criterio que TemplateActualizar): sólo se escribe lo
    que VIENE en el JSON. Reabrir una estructura y regenerarla no puede borrar la traza
    que el llamador no mandó."""
    params: Optional[dict] = None
    nombre: Optional[str] = None
    elemento: Optional[str] = None
    piso: Optional[str] = None
    estado: Optional[str] = None
    template_id: Optional[int] = None


# ESTADO de una estructura instanciada. 'retirada' = se le borraron todas las barras;
# la fila NO se borra para que la traza (quién la creó, con qué receta) siga existiendo.
ESTADO_ACTIVA = "activa"
ESTADO_RETIRADA = "retirada"


def _texto(v):
    """Texto limpio o None. Vacío se guarda como NULL (no como cadena vacía): así
    "sin dato" es UNA sola cosa en la columna."""
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _params_dict(p):
    """params viene como dict (JSONB) o como texto según el driver/cursor."""
    if isinstance(p, str):
        try:
            return json.loads(p)
        except Exception:
            return {}
    return p if isinstance(p, dict) else {}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/templates")
def crear_template(body: TemplateCrear, user=Depends(get_current_user)):
    """Guarda un template (composición) en la biblioteca. Reutilizable: se lista
    por obra + otras obras (GET /templates)."""
    email = user.get("email", "?")
    nombre = (body.nombre or "").strip()
    tipo = (body.tipo or "").strip().lower()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre del template es obligatorio.")
    if not tipo:
        raise HTTPException(status_code=400, detail="El tipo de elemento es obligatorio.")
    if not isinstance(body.params, dict) or not body.params:
        raise HTTPException(status_code=400, detail="El template no tiene parámetros (receta) válidos.")
    schema_version = _schema_de_params(body.params)
    ahora = _now_iso()
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso_templates(cur, user)
            obra = _normalizar_obra(cur, body.obra)
            errores = _validar_receta(cur, body.params)
            if errores:
                _raise_receta_invalida(errores)
            cur.execute(
                """INSERT INTO templates_catalogo
                       (nombre, tipo, params, obra, creado_por, fecha, schema_version, updated_at, editado_por)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (nombre, tipo, json.dumps(body.params), obra, email, ahora, schema_version, ahora, email),
            )
            new_id = cur.fetchone()[0]
    audit(email, "crear_template", f"{nombre} ({tipo}) · obra {obra or '(general)'}", "template", str(new_id))
    return {"ok": True, "id": new_id, "schema_version": schema_version, "obra": obra}


@router.get("/templates")
def listar_templates(tipo: Optional[str] = None, obra: Optional[str] = None,
                     nombre: Optional[str] = None, user=Depends(get_current_user)):
    """Lista LIVIANA para ELEGIR un template: id, nombre, tipo, obra, fecha, autor y
    cuántos componentes tiene. NO trae `params`: la receta completa puede pesar
    cientos de KB por template y la lista solo sirve para escoger — se pide con
    GET /templates/{id} al abrir. Filtros: tipo, obra (prioriza esa obra pero incluye
    los generales/de otras) y nombre (contiene, sin distinguir mayúsculas)."""
    _check_permiso_lectura(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = []
            params = []
            if tipo:
                where.append("t.tipo = %s")
                params.append(tipo.strip().lower())
            if nombre and nombre.strip():
                where.append("t.nombre ILIKE %s")
                params.append("%" + nombre.strip() + "%")
            sql = """
                SELECT t.id, t.nombre, t.tipo, t.obra, t.creado_por, t.fecha,
                       t.schema_version, t.updated_at, t.editado_por,
                       CASE WHEN jsonb_typeof(t.params->'componentes') = 'array'
                            THEN jsonb_array_length(t.params->'componentes') ELSE 0 END,
                       t.params->'componentes'->0->'dims',
                       p.nombre_proyecto
                FROM templates_catalogo t
                LEFT JOIN proyectos p ON p.id_proyecto = t.obra
            """
            if where:
                sql += " WHERE " + " AND ".join(where)
            # Ordena: los de la obra pedida primero, luego el resto; recientes arriba.
            # IS NOT DISTINCT FROM y no `=`: con `=` los templates GENERALES (obra
            # NULL) daban NULL y, en un DESC, NULLS FIRST los ponía ARRIBA de los de
            # la obra pedida — justo al revés de lo que dice hacer.
            if obra:
                sql += " ORDER BY (t.obra IS NOT DISTINCT FROM %s) DESC, t.id DESC"
                params.append(obra)
            else:
                sql += " ORDER BY t.id DESC"
            cur.execute(sql, tuple(params))
            rows = cur.fetchall()
    templates = []
    for r in rows:
        templates.append({
            "id": r[0], "nombre": r[1], "tipo": r[2], "obra": r[3],
            "creado_por": r[4], "fecha": r[5],
            # Filas anteriores a la migración 105: schema_version NULL → se DEDUCE de
            # las dims del primer componente (no se reescribe la tabla).
            "schema_version": r[6] if r[6] is not None else _deducir_schema_version(r[10]),
            "updated_at": r[7], "editado_por": r[8],
            "n_componentes": int(r[9] or 0),
            "obra_nombre": r[11],
            # Igual que en constructoras: el front muestra editar/eliminar con esto,
            # sin recalcular el criterio de permiso por su cuenta.
            "puede_modificar": _puede_modificar_template(r[4], user),
        })
    return {"ok": True, "templates": templates}


@router.get("/templates/{template_id}")
def ver_template(template_id: int, user=Depends(get_current_user)):
    """Un template por id, CON su receta (para cargarla al panel/editor)."""
    _check_permiso_lectura(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, nombre, tipo, params, obra, creado_por, fecha,
                          schema_version, updated_at, editado_por
                   FROM templates_catalogo WHERE id = %s""",
                (template_id,))
            r = cur.fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Template no encontrado.")
    p = _params_dict(r[3])
    comps = p.get("componentes")
    return {"ok": True, "id": r[0], "nombre": r[1], "tipo": r[2], "params": p, "obra": r[4],
            "creado_por": r[5], "fecha": r[6],
            "schema_version": r[7] if r[7] is not None else _schema_de_params(p),
            "updated_at": r[8], "editado_por": r[9],
            "n_componentes": len(comps) if isinstance(comps, list) else 0,
            "puede_modificar": _puede_modificar_template(r[5], user)}


@router.put("/templates/{template_id}")
def actualizar_template(template_id: int, body: TemplateActualizar, user=Depends(get_current_user)):
    """Edita un template EXISTENTE (antes solo se podía guardar copias: la biblioteca
    crecía con el mismo nombre y no había forma de corregir nada).
    Permiso: el MISMO de crear (_puede_gestionar_templates) + poder tocar ESTE
    template (_puede_modificar_template: su autor o un admin)."""
    email = user.get("email", "?")
    enviados = set(getattr(body, "__fields_set__", None) or getattr(body, "model_fields_set", set()))
    if not enviados:
        raise HTTPException(status_code=400, detail="No se envió ningún cambio.")

    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso_templates(cur, user)
            cur.execute(
                "SELECT id, nombre, tipo, params, obra, creado_por, schema_version FROM templates_catalogo WHERE id = %s",
                (template_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Template no encontrado.")
            creado_por = r[5]
            if not _puede_modificar_template(creado_por, user):
                raise HTTPException(
                    status_code=403,
                    detail=("Este template lo creó " + (str(creado_por) if creado_por else "otro usuario") +
                            ". Solo su autor (o un administrador) puede editarlo."))

            sets, valores, cambios = [], [], []

            if "nombre" in enviados:
                nombre = (body.nombre or "").strip()
                if not nombre:
                    raise HTTPException(status_code=400, detail="El nombre del template es obligatorio.")
                sets.append("nombre = %s"); valores.append(nombre)
                if nombre != r[1]:
                    cambios.append(f"nombre: {r[1]}→{nombre}")

            if "tipo" in enviados:
                tipo = (body.tipo or "").strip().lower()
                if not tipo:
                    raise HTTPException(status_code=400, detail="El tipo de elemento es obligatorio.")
                sets.append("tipo = %s"); valores.append(tipo)
                if tipo != r[2]:
                    cambios.append(f"tipo: {r[2]}→{tipo}")

            if "obra" in enviados:
                obra = _normalizar_obra(cur, body.obra)
                sets.append("obra = %s"); valores.append(obra)
                if obra != r[4]:
                    cambios.append(f"obra: {r[4] or '(general)'}→{obra or '(general)'}")

            if "params" in enviados:
                if not isinstance(body.params, dict) or not body.params:
                    raise HTTPException(status_code=400, detail="El template no tiene parámetros (receta) válidos.")
                errores = _validar_receta(cur, body.params)
                if errores:
                    _raise_receta_invalida(errores)
                sets.append("params = %s"); valores.append(json.dumps(body.params))
                # El shape se re-estampa desde lo que se acaba de escribir.
                sets.append("schema_version = %s"); valores.append(_schema_de_params(body.params))
                cambios.append("receta")
            elif r[6] is None:
                # Fila anterior a la migración 105: se aprovecha esta escritura para
                # estampar el shape DEDUCIDO de su propia receta (no se toca la receta).
                sets.append("schema_version = %s"); valores.append(_schema_de_params(_params_dict(r[3])))

            sets.append("updated_at = %s"); valores.append(_now_iso())
            sets.append("editado_por = %s"); valores.append(email)
            valores.append(template_id)
            cur.execute("UPDATE templates_catalogo SET " + ", ".join(sets) + " WHERE id = %s", tuple(valores))

    audit(email, "editar_template", ", ".join(cambios) or "(sin cambios de contenido)",
          "template", str(template_id))
    return {"ok": True, "id": template_id, "cambios": cambios}


@router.delete("/templates/{template_id}")
def eliminar_template(template_id: int, user=Depends(get_current_user)):
    """Borra un template de la biblioteca. Borrado REAL (mismo criterio que el resto
    del catálogo — figuras_catalogo: data maestra que el editor puede volver a crear;
    templates_catalogo no tiene columna `activo`, así que un soft-delete sería un
    patrón nuevo).
    Si el template está REFERENCIADO por instancias (elementos_template.template_id)
    NO se borra en silencio: 409 con cuántas lo usan (misma regla que eliminar una
    constructora con obras)."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso_templates(cur, user)
            cur.execute("SELECT id, nombre, creado_por FROM templates_catalogo WHERE id = %s", (template_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Template no encontrado.")
            nombre, creado_por = r[1], r[2]
            if not _puede_modificar_template(creado_por, user):
                raise HTTPException(
                    status_code=403,
                    detail=("Este template lo creó " + (str(creado_por) if creado_por else "otro usuario") +
                            ". Solo su autor (o un administrador) puede eliminarlo."))
            cur.execute("SELECT COUNT(*) FROM elementos_template WHERE template_id = %s", (template_id,))
            n_inst = int(cur.fetchone()[0] or 0)
            if n_inst > 0:
                raise HTTPException(
                    status_code=409,
                    detail=(f"No se puede eliminar «{nombre}»: {n_inst} elemento(s) ya generado(s) "
                            f"lo usan como origen. Borrar el template dejaría esas barras sin trazabilidad."))
            cur.execute("DELETE FROM templates_catalogo WHERE id = %s", (template_id,))
    audit(email, "eliminar_template", nombre, "template", str(template_id))
    return {"ok": True, "id": template_id}


def insertar_instancia(cur, email, lote_id, params, template_id=None, nombre=None,
                       elemento=None, piso=None, id_proyecto=None, sector=None,
                       ciclo=None, eje=None) -> int:
    """El INSERT de una estructura, SOBRE UN CURSOR QUE YA EXISTE. Vive suelto (y no
    dentro del endpoint) porque hay DOS transacciones que lo necesitan y la fila tiene
    que escribirse igual en las dos:
      · POST /elementos/instancia — la traza suelta (Enfierrador MVP de panel_3d.js).
      · POST /lotes/{id}/barras con `instancia` — la estructura y SUS barras naciendo
        JUNTAS. Ese es el caso que obliga a compartir el cursor: si el INSERT viviera
        en su propio endpoint serían dos transacciones, y una carga que falla en las
        barras dejaría la estructura vacía colgando en el despiece (el bug de las
        estructuras huérfanas con 0 barras).
    La tabla la sigue conociendo SOLO este módulo: lotes.py llama a esta función, no
    escribe el SQL por su cuenta."""
    if not isinstance(params, dict) or not params:
        raise HTTPException(status_code=400, detail="La instancia no tiene parámetros (receta) válidos.")
    ahora = _now_iso()
    cur.execute(
        """INSERT INTO elementos_template
             (template_id, lote_id, params, creado_por, fecha,
              nombre, elemento, piso, estado, id_proyecto, sector, ciclo, eje,
              updated_at, editado_por)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           RETURNING id""",
        (template_id, lote_id, json.dumps(params), email, ahora,
         _texto(nombre), _texto(elemento), _texto(piso), ESTADO_ACTIVA,
         _texto(id_proyecto), _texto(sector), _texto(ciclo), _texto(eje),
         ahora, email),
    )
    return cur.fetchone()[0]


@router.post("/elementos/instancia")
def crear_instancia(body: InstanciaCrear, user=Depends(get_current_user)):
    """Guarda la RECETA instanciada en elementos_template (trazabilidad). Devuelve
    su id, que puede viajar como template_instancia_id de las barras generadas
    (POST /lotes/{id}/barras). Opcional en el MVP: el flujo funciona sin él.

    OJO: crear la estructura por AQUÍ y cargarle las barras después son DOS
    transacciones — si las barras fallan, la estructura queda vacía. El editor 3D ya
    no entra por esta puerta en su primera carga (manda `instancia` dentro del POST
    de barras, que las escribe juntas); esto queda para el cliente MVP y para quien
    de verdad quiera guardar sólo la receta."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso_instancia(cur, user)
            new_id = insertar_instancia(
                cur, email, body.lote_id, body.params, template_id=body.template_id,
                nombre=body.nombre, elemento=body.elemento, piso=body.piso,
                id_proyecto=body.id_proyecto, sector=body.sector, ciclo=body.ciclo, eje=body.eje)
    audit(email, "crear_instancia_template", f"lote {body.lote_id} · template {body.template_id}",
          "elemento_template", str(new_id))
    return {"ok": True, "id": new_id}


@router.put("/elementos/instancia/{instancia_id}")
def actualizar_instancia(instancia_id: int, body: InstanciaActualizar, user=Depends(get_current_user)):
    """Reabrir una estructura y volver a generarla la ACTUALIZA — no la reemplaza. La
    fila conserva su id, y con él las barras que ya apuntan a ella
    (barras.template_instancia_id): por eso el sync puede cruzar generaciones."""
    campos = body.model_dump(exclude_unset=True)
    if not campos:
        return {"ok": True, "id": instancia_id, "cambios": []}
    email = user.get("email", "?")
    sets, params, cambios = [], [], []
    if "params" in campos:
        if not isinstance(body.params, dict) or not body.params:
            raise HTTPException(status_code=400, detail="La instancia no tiene parámetros (receta) válidos.")
        sets.append("params = %s"); params.append(json.dumps(body.params)); cambios.append("receta")
    for campo, valor in (("nombre", body.nombre), ("elemento", body.elemento),
                         ("piso", body.piso), ("template_id", body.template_id)):
        if campo in campos:
            sets.append(f"{campo} = %s"); params.append(_texto(valor) if campo != "template_id" else valor)
            cambios.append(campo)
    if "estado" in campos:
        est = (body.estado or "").strip().lower()
        if est not in (ESTADO_ACTIVA, ESTADO_RETIRADA):
            raise HTTPException(status_code=400, detail="Estado de estructura desconocido.")
        sets.append("estado = %s"); params.append(est); cambios.append("estado")
    sets.append("updated_at = %s"); params.append(_now_iso())
    sets.append("editado_por = %s"); params.append(email)
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso_instancia(cur, user)
            cur.execute("SELECT id FROM elementos_template WHERE id = %s", (instancia_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Esa estructura ya no existe.")
            cur.execute("UPDATE elementos_template SET " + ", ".join(sets) + " WHERE id = %s",
                        tuple(params) + (instancia_id,))
    audit(email, "actualizar_instancia_template", ", ".join(cambios) or "sin cambios",
          "elemento_template", str(instancia_id))
    return {"ok": True, "id": instancia_id, "cambios": cambios}


@router.get("/lotes/{lote_id}/elementos")
def listar_instancias_lote(lote_id: int, user=Depends(get_current_user)):
    """Estructuras cargadas a un despiece, con los MISMOS KPIs que el repositorio de
    despieces (GET /lotes): items, barras físicas, kg y Ø promedio ponderado por peso.
    Es lo que necesita el creador de despieces para ofrecer "reabrir", y es la misma
    consulta sobre la que se apoyará el element manager cuando exista.

    NOMENCLATURA (la misma de listar_lotes, para que las dos tablas se lean igual):
      n_items  = ENTRADAS/filas de la estructura (COUNT).
      n_barras = BARRAS FÍSICAS = Σ cant_total.  ← antes esta clave traía el COUNT;
                 se corrigió para que "Barras" signifique lo mismo en las dos tablas
                 y para que PPB (kg/barra) y PPI (kg/item) se puedan derivar de aquí.
    Los cuatro salen de UNA sola pasada (LEFT JOIN + GROUP BY, como
    listar_estructuras_obra): pedirlos por estructura serían N consultas para pintar
    una tabla de N filas.

    ciclo/eje/id_proyecto caen al dato del LOTE cuando la instancia no los trae (filas
    pre-107): mismo criterio que listar_estructuras_obra — no se inventa nada, el lote
    ES el contexto donde se creó la estructura. El front arma con ellos la etiqueta que
    se ve (obra · ciclo · piso · eje); `nombre` sigue siendo la traza persistida."""
    _check_permiso_lectura(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT e.id, e.nombre, e.elemento, e.piso, e.estado, e.template_id,
                          e.creado_por, e.fecha, e.updated_at,
                          COALESCE(SUM(b.cant_total), 0) AS n_barras,
                          COUNT(b.id) AS n_items,
                          COALESCE(SUM(b.peso_total), 0) AS kg,
                          -- Ø PROMEDIO PONDERADO POR PESO: Σ(φ·kg)/Σkg. Mismo criterio
                          -- (y misma fórmula) que el KPI del repositorio de despieces.
                          COALESCE(ROUND(CAST(SUM(b.diam * b.peso_total) /
                                   NULLIF(SUM(b.peso_total), 0) AS NUMERIC), 1), 0) AS diam_prom,
                          COALESCE(e.id_proyecto, l.id_proyecto) AS id_proyecto,
                          COALESCE(e.ciclo, l.ciclo) AS ciclo,
                          COALESCE(e.eje,   l.eje)   AS eje
                     FROM elementos_template e
                     JOIN lotes l ON l.id = e.lote_id
                     LEFT JOIN barras b ON b.template_instancia_id = e.id
                    WHERE e.lote_id = %s
                    GROUP BY e.id, e.nombre, e.elemento, e.piso, e.estado, e.template_id,
                             e.creado_por, e.fecha, e.updated_at,
                             e.id_proyecto, l.id_proyecto, e.ciclo, l.ciclo, e.eje, l.eje
                    ORDER BY e.id""",
                (lote_id,),
            )
            filas = cur.fetchall()
    campos = ["id", "nombre", "elemento", "piso", "estado", "template_id",
              "creado_por", "fecha", "updated_at", "n_barras", "n_items", "kg",
              "diam_prom", "id_proyecto", "ciclo", "eje"]
    elementos = []
    for f in filas:
        d = dict(zip(campos, f))
        # kg como float con 1 decimal: peso_total es NUMERIC en la BD (Decimal en
        # Python) y el JSON debe salir plano para que el front lo muestre tal cual.
        d["kg"] = round(float(d["kg"] or 0), 1)
        d["n_barras"] = float(d["n_barras"] or 0)   # cant_total puede ser fraccionario
        d["n_items"] = int(d["n_items"] or 0)
        d["diam_prom"] = float(d["diam_prom"] or 0)
        elementos.append(d)
    return {"ok": True, "lote_id": lote_id, "elementos": elementos}


@router.delete("/elementos/instancia/{instancia_id}")
def eliminar_instancia(instancia_id: int, user=Depends(get_current_user)):
    """Borra una estructura VACÍA (cero barras) del despiece.

    POR QUÉ EXISTE: hasta hoy la primera carga escribía la estructura y sus barras en
    dos transacciones, así que una carga que fallaba a mitad (el 400 por ubicación
    faltante, p. ej.) dejaba la fila colgando — 0 barras, 0 kg, y el nombre a medias.
    Eso ya no puede volver a pasar (las dos cosas nacen juntas), pero las que quedaron
    de antes son datos del usuario y las borra ÉL desde el listado, no una migración a
    su espalda.

    LA GUARDA ES EL CERO, no el estado del lote: mientras la estructura no tenga barras
    no hay cubicación que perder — borrarla no cambia ni un kilo del despiece. Con
    barras se responde 409 y se dice por dónde (reabrir la estructura, que es donde el
    sync sabe borrarlas de verdad). Un despiece ELIMINADO sí se respeta entero: es una
    lápida, su contenido no se toca."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso_instancia(cur, user)
            cur.execute(
                """SELECT e.nombre, e.lote_id, l.estado,
                          (SELECT COUNT(*) FROM barras b WHERE b.template_instancia_id = e.id)
                     FROM elementos_template e
                     LEFT JOIN lotes l ON l.id = e.lote_id
                    WHERE e.id = %s""",
                (instancia_id,),
            )
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Esa estructura ya no existe.")
            nombre, lote_id, estado_lote, n_barras = r[0], r[1], r[2], int(r[3] or 0)
            if estado_lote == "eliminado":
                raise HTTPException(status_code=409,
                                    detail="Ese despiece está eliminado: su contenido es histórico y no se toca.")
            if n_barras:
                raise HTTPException(status_code=409, detail={
                    "msg": (f"«{nombre or instancia_id}» tiene {n_barras} barra(s) en el despiece. "
                            "Se quitan reabriéndola en el Enfierrador; sólo se puede borrar vacía."),
                    "n_barras": n_barras,
                })
            cur.execute("DELETE FROM elementos_template WHERE id = %s", (instancia_id,))
    audit(email, "eliminar_instancia_vacia", f"{nombre or ''} · lote {lote_id}",
          "elemento_template", str(instancia_id))
    return {"ok": True, "id": instancia_id, "lote_id": lote_id}


@router.get("/elementos/estructuras")
def listar_estructuras_obra(proyecto: str, elemento: Optional[str] = None,
                            user=Depends(get_current_user)):
    """Estructuras CONSOLIDADAS de una obra (el tab Muros y sus pares futuros).
    Solo instancias vivas cuyo despiece ya fue banderado (lotes.estado='terminada'):
    antes de la bandera la estructura es material de trabajo del despiece — recién
    al terminar el lote pasa a ser un dato de la obra (misma regla con la que el
    Bar Manager excluye borradores). El path es literal, así que no colisiona con
    /elementos/instancia/{id}.

    OJO con n_barras: aquí sigue siendo el COUNT de filas (lo que el tab Muros muestra
    hoy bajo esa etiqueta), mientras que en /lotes/{id}/elementos pasó a ser Σ
    cant_total —barras FÍSICAS— para hablar el mismo idioma que el repositorio de
    despieces. Homologar este endpoint implica cambiar también lo que dice la columna
    del tab Muros, así que se deja ANOTADO en vez de cambiarlo a medias."""
    _check_permiso_lectura(user)
    # La obra se resuelve por el LOTE (l.id_proyecto), no por e.id_proyecto: las
    # instancias pre-107 tienen la traza NULL y el lote es la fuente que nunca falta.
    # Por lo mismo, sector/ciclo/eje caen al dato del lote cuando la instancia no
    # los trae (no se inventa data: el lote ES el contexto donde se creó).
    sql = """SELECT e.id, e.nombre, e.elemento, e.piso, e.lote_id, l.num_obra,
                    COALESCE(e.sector, l.sector) AS sector,
                    COALESCE(e.ciclo,  l.ciclo)  AS ciclo,
                    COALESCE(e.eje,    l.eje)    AS eje,
                    COUNT(b.id) AS n_barras,
                    COALESCE(SUM(b.peso_total), 0) AS kg,
                    e.creado_por, e.fecha, e.updated_at
               FROM elementos_template e
               JOIN lotes l ON l.id = e.lote_id
               LEFT JOIN barras b ON b.template_instancia_id = e.id
              WHERE l.id_proyecto = %s
                AND l.estado = 'terminada'
                AND COALESCE(e.estado, %s) = %s"""
    # COALESCE en el estado: las filas pre-107 lo tienen NULL y siguen vivas.
    args = [proyecto, ESTADO_ACTIVA, ESTADO_ACTIVA]
    if elemento:
        # Filtro de LISTADO, jamás del motor: la tipología no decide nada en
        # generación — aquí solo acota qué se muestra en el tab.
        sql += " AND LOWER(e.elemento) = LOWER(%s)"
        args.append(elemento)
    sql += """ GROUP BY e.id, e.nombre, e.elemento, e.piso, e.lote_id, l.num_obra,
                        e.sector, l.sector, e.ciclo, l.ciclo, e.eje, l.eje,
                        e.creado_por, e.fecha, e.updated_at
               ORDER BY e.piso, e.nombre"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(args))
            filas = cur.fetchall()
    campos = ["id", "nombre", "elemento", "piso", "lote_id", "num_obra",
              "sector", "ciclo", "eje", "n_barras", "kg",
              "creado_por", "fecha", "updated_at"]
    estructuras = []
    for f in filas:
        d = dict(zip(campos, f))
        # Mismo trato que en el listado por lote: NUMERIC → float plano, 1 decimal.
        d["kg"] = round(float(d["kg"] or 0), 1)
        d["n_barras"] = int(d["n_barras"] or 0)
        estructuras.append(d)
    # Obra sin resultados = lista vacía con 200 (no es un error: simplemente aún
    # no hay estructuras banderadas ahí).
    return {"ok": True, "proyecto": proyecto, "estructuras": estructuras}


@router.get("/elementos/instancia/{instancia_id}")
def ver_instancia(instancia_id: int, user=Depends(get_current_user)):
    """La estructura COMPLETA (con su receta) para volver a abrirla en el editor."""
    _check_permiso_lectura(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, template_id, lote_id, params, nombre, elemento, piso, estado,
                          id_proyecto, sector, ciclo, eje, creado_por, fecha, updated_at, editado_por
                     FROM elementos_template WHERE id = %s""",
                (instancia_id,),
            )
            r = cur.fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Esa estructura ya no existe.")
    params = _params_dict(r[3])
    return {
        "ok": True, "id": r[0], "template_id": r[1], "lote_id": r[2], "params": params,
        # Mismo trato que los templates: el shape se DEDUCE al leer para las filas
        # escritas antes de que existiera la columna (no se reescribe la tabla).
        "schema_version": _schema_de_params(params),
        "nombre": r[4], "elemento": r[5], "piso": r[6], "estado": r[7] or ESTADO_ACTIVA,
        "id_proyecto": r[8], "sector": r[9], "ciclo": r[10], "eje": r[11],
        "creado_por": r[12], "fecha": r[13], "updated_at": r[14], "editado_por": r[15],
    }
