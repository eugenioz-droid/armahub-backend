"""
reclamos.py
-----------
CRUD endpoints para sistema de reclamos y errores.
Incluye seguimientos (timeline), cambio de estado, y KPIs.
Categorías Ishikawa provisorias — se ajustarán con input del usuario.
"""

import json
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import Response, RedirectResponse
from pydantic import BaseModel
from psycopg.rows import dict_row

from .notifications import crear_notificacion

from .auth import get_current_user, require_admin_or_admin_calidad
from .db import get_conn, audit
from . import cache as _cache
from . import storage
from .reclamos_queries import (
    q_total, q_abiertos, q_por_estado, q_por_tipo,
    q_por_anio_mes, q_resueltos_no_resueltos, q_por_categoria, q_por_proyecto,
    build_role_filter,
)

router = APIRouter()

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_IMAGE_TYPES = ("image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp")

def _invalidate_reclamos_cache():
    _cache.invalidate("reclamos:", "landing:")


def _area_id_de_usuario(cur, email):
    """Infiere el area_id de un usuario por su email, vía area_usuarios.
    Si el usuario pertenece a varias áreas, prioriza donde es jefe_servicio;
    en empate, la primera por id. Devuelve None si no tiene área o no hay email."""
    if not email:
        return None
    cur.execute("""
        SELECT au.area_id
        FROM area_usuarios au
        JOIN users u ON u.id = au.user_id
        WHERE u.email = %s
        ORDER BY (au.rol_area = 'jefe_servicio') DESC, au.area_id
        LIMIT 1
    """, (email,))
    row = cur.fetchone()
    return row[0] if row else None


def _area_tiene_revision(cur, area_id, tipo_origen="externo"):
    """True si el área usa etapa de revisión para este tipo de reclamo."""
    if not area_id:
        return False
    col = "tiene_revision_interno" if tipo_origen == "interno" else "tiene_revision"
    cur.execute(f"SELECT {col} FROM areas WHERE id = %s", (area_id,))
    row = cur.fetchone()
    return bool(row[0]) if row else False


def _jefe_servicio_de_area(cur, area_id):
    """Email del Jefe de Servicio de un área: usuario con role='jefe_servicio'
    que pertenece al área. Si hay varios, el primero por id. None si no hay."""
    if not area_id:
        return None
    cur.execute("""
        SELECT u.email
        FROM area_usuarios au
        JOIN users u ON u.id = au.user_id
        WHERE au.area_id = %s AND u.role = 'jefe_servicio'
        ORDER BY au.id
        LIMIT 1
    """, (area_id,))
    row = cur.fetchone()
    return row[0] if row else None


def _role_puede(cur, role, accion):
    """Configurable: ¿el rol global tiene permiso para la acción dada?
    Consulta la tabla role_permisos. Sin fila de config → False."""
    if not role:
        return False
    cur.execute(
        "SELECT activo FROM role_permisos WHERE role = %s AND accion = %s",
        (role, accion),
    )
    row = cur.fetchone()
    return bool(row[0]) if row else False


def _rol_puede_crear(cur, accion, rol):
    """Configurable: ¿el rol puede levantar reclamos de este tipo ('externo'|'interno')?
    Si no hay fila de config, se cae a un default seguro (admin/admin_calidad/usc para
    externo). El admin SIEMPRE puede (no se puede dejar al sistema sin quién cree)."""
    if rol in ("admin", "admin_calidad"):
        return True
    cur.execute(
        "SELECT activo FROM reclamo_crear_config WHERE accion = %s AND rol = %s",
        (accion, rol),
    )
    row = cur.fetchone()
    if row is not None:
        return bool(row[0])
    # Sin config explícita: default conservador para externos.
    return accion == "externo" and rol == "usc"

# ========================= PERMISSION HELPERS =========================

REGISTRO_FIELDS = {
    "titulo", "descripcion", "prioridad", "tipo_reclamo", "responsable",
    "detectado_por", "fecha_deteccion", "observaciones", "id_calidad",
    "id_proyecto", "cubicador_asignado", "asignado_a",
}
ANALISIS_FIELDS = {
    "categoria_ishikawa", "sub_causa", "cod_causa", "explicacion_causa",
    "respuesta_texto", "area_aplica", "fecha_analisis", "kilos_mal_fabricados",
    "tiempo_respuesta", "tiempo_respuesta_unidad",
    "tiempo_respuesta_actualizado_por", "tiempo_respuesta_fecha_actualizacion",
}


def _es_propietario_usc(rec: dict, email: str) -> bool:
    """USC owns reclamo if creado_por or asignado_a."""
    return rec.get("creado_por") == email or rec.get("asignado_a") == email


def _es_propietario_cubicador(rec: dict, email: str) -> bool:
    """Cubicador/externo owns reclamo if cubicador_asignado or respuesta_por."""
    return rec.get("cubicador_asignado") == email or rec.get("respuesta_por") == email


def _puede_ver_reclamo(rec: dict, user: dict, cur=None) -> bool:
    """
    True si el usuario puede ver este reclamo.
    admin/admin_calidad/cubicador → todo. usc/externo → solo propios.
    jefe_servicio/miembro → reclamos del área a la que pertenecen (requiere cur).
    cliente → sin acceso.
    """
    role = user.get("role", "")
    email = user.get("email", "")
    if role in ("admin", "admin_calidad"):
        return True
    if role == "usc":
        return _es_propietario_usc(rec, email)
    if role == "externo":
        return _es_propietario_cubicador(rec, email)
    if role in ("jefe_servicio", "miembro"):
        reclamo_area = rec.get("area_id")
        if not reclamo_area or cur is None:
            return False
        cur.execute("""
            SELECT 1 FROM area_usuarios au
            JOIN users u ON u.id = au.user_id
            WHERE u.email = %s AND au.area_id = %s
            LIMIT 1
        """, (email, reclamo_area))
        return cur.fetchone() is not None
    return False


def _estado_bloquea_edicion_analisis(estado: str) -> bool:
    return estado in ("en_revision", "validacion", "cerrado", "rechazado")

# ========================= CONSTANTS =========================

ESTADOS_RECLAMO = ("abierto", "en_analisis", "en_revision", "validacion", "cerrado", "rechazado")
TIPOS_RECLAMO = ("error", "faltante", "atraso", "actualizacion_portal")
VALIDACION_RESULTADOS = ("aprobado", "rechazado", "corregido")
PRIORIDADES = ("baja", "media", "alta", "critica")
APLICA_VALUES = ("si", "no", "pendiente")
TIPOS_ACCION = ("inmediata", "correctiva", "preventiva")
CATEGORIAS_ISHIKAWA = (
    "mano_de_obra",
    "metodo",
    "material",
    "maquina",
    "medicion",
    "medio_ambiente",
)

ISHIKAWA_LABELS = {
    "mano_de_obra": "Personas (Mano de obra)",
    "metodo": "Método",
    "material": "Material",
    "maquina": "Máquina",
    "medicion": "Medida",
    "medio_ambiente": "Medio Ambiente (entorno)",
}

ISHIKAWA_SUBCAUSAS = {
    "medio_ambiente": [
        {"cod": "MA01", "texto": "Interrupciones constantes durante la jornada"},
        {"cod": "MA02", "texto": "Ruido ambiental o distracciones"},
        {"cod": "MA03", "texto": "Puesto de trabajo incómodo o con mala ergonomía"},
        {"cod": "MA04", "texto": "Falta de iluminación adecuada"},
        {"cod": "MA05", "texto": "Actividades no planificadas que interrumpen la cubicación"},
    ],
    "material": [
        {"cod": "MT01", "texto": "Falta de programa de obra (debe solicitar por escrito)"},
        {"cod": "MT02", "texto": "Falta de ciclos constructivos o modificación"},
        {"cod": "MT03", "texto": "Planos complejos o indefinidos"},
        {"cod": "MT04", "texto": "Plano de planta no muestra todos los elementos (como muros dilotados)"},
        {"cod": "MT05", "texto": "Medidas contradictorias entre planta y elevación"},
        {"cod": "MT06", "texto": "Formato de digitaciones poco legible"},
    ],
    "maquina": [
        {"cod": "MQ01", "texto": "Internet lento o inestable"},
        {"cod": "MQ02", "texto": "aSa Studio inestable genera recubicaciones"},
        {"cod": "MQ03", "texto": "Error de parámetros en planilla de importación - Cubicad"},
        {"cod": "MQ04", "texto": "Error al captar datos desde aSa Studio"},
    ],
    "medicion": [
        {"cod": "ME01", "texto": "Error en la medición o lectura de cotas referencia incorrecta en el plano"},
        {"cod": "ME02", "texto": "Diferencia entre cotas indicadas y cotas reales del in situ"},
        {"cod": "ME03", "texto": "Inconsistencia entre planta y elevación no detectada al cubicar"},
        {"cod": "ME04", "texto": "Inconsistencia no detectada entre Especificaciones técnicas y NCH 211"},
        {"cod": "ME05", "texto": "Plano en formato no medible (PDF entrega medida equivocada)"},
    ],
    "metodo": [
        {"cod": "MD01", "texto": "No se indica en procedimiento estandarizado"},
        {"cod": "MD02", "texto": "Criterios de cubicación no estandarizados entre proyectos"},
        {"cod": "MD03", "texto": "Falta información en protocolo (mejorar formulario)"},
    ],
    "mano_de_obra": [
        {"cod": "MO01", "texto": "No sigue procedimiento establecido"},
        {"cod": "MO02", "texto": "No revisa información ingresada post ticket de ingreso aSa"},
        {"cod": "MO03", "texto": "No considera correo o acuerdos con cliente"},
        {"cod": "MO04", "texto": "No aplica protocolo correctamente"},
        {"cod": "MO05", "texto": "Falta registro formal de información acordada"},
        {"cod": "MO06", "texto": "Error al digitar o transcribir datos"},
        {"cod": "MO07", "texto": "No consulta antecedentes incompletos mediante Bshark o RDI"},
        {"cod": "MO08", "texto": "Error de interpretación o criterio técnico"},
        {"cod": "MO09", "texto": "Sobrecarga laboral o plazos ajustados que reducen tiempo de revisión"},
    ],
}

ESTADO_LABELS = {
    "abierto": "Abierto",
    "en_analisis": "En análisis",
    "en_revision": "En revisión",
    "validacion": "En validación",
    "cerrado": "Cerrado",
    "rechazado": "Rechazado",
}

PRIORIDAD_LABELS = {
    "baja": "Baja",
    "media": "Media",
    "alta": "Alta",
    "critica": "Crítica",
}

APLICA_LABELS = {
    "si": "Sí aplica",
    "no": "No aplica",
    "pendiente": "Pendiente",
}

TIPO_ACCION_LABELS = {
    "inmediata": "Inmediata",
    "correctiva": "Correctiva",
    "preventiva": "Preventiva",
}


def _as_text(value):
    return str(value) if value is not None else None


# ========================= MODELS =========================

class ReclamoCreate(BaseModel):
    id_proyecto: Optional[str] = None
    titulo: str
    descripcion: Optional[str] = None
    prioridad: Optional[str] = "alta"
    tipo_reclamo: Optional[str] = "error"
    categoria_ishikawa: Optional[str] = None
    sub_causa: Optional[str] = None
    cod_causa: Optional[str] = None
    responsable: Optional[str] = None
    detectado_por: Optional[str] = None
    fecha_deteccion: Optional[str] = None
    id_calidad: Optional[str] = None
    anio_calidad: Optional[int] = None
    numero_calidad: Optional[int] = None
    asignado_a: Optional[str] = None
    cubicador_asignado: Optional[str] = None
    tipo_origen: Optional[str] = "externo"   # 'externo' | 'interno'
    area_id: Optional[int] = None            # interno: área destino (responsable)


class ReclamoUpdate(BaseModel):
    id_proyecto: Optional[str] = None
    titulo: Optional[str] = None
    descripcion: Optional[str] = None
    estado: Optional[str] = None
    prioridad: Optional[str] = None
    tipo_reclamo: Optional[str] = None
    categoria_ishikawa: Optional[str] = None
    sub_causa: Optional[str] = None
    cod_causa: Optional[str] = None
    responsable: Optional[str] = None
    aplica: Optional[str] = None
    detectado_por: Optional[str] = None
    fecha_deteccion: Optional[str] = None
    fecha_analisis: Optional[str] = None
    analista: Optional[str] = None
    area_aplica: Optional[str] = None
    explicacion_causa: Optional[str] = None
    accion_correctiva: Optional[str] = None
    accion_preventiva: Optional[str] = None
    resolucion: Optional[str] = None
    observaciones: Optional[str] = None
    id_calidad: Optional[str] = None
    anio_calidad: Optional[int] = None
    numero_calidad: Optional[int] = None
    respuesta_texto: Optional[str] = None
    validacion_resultado: Optional[str] = None
    validacion_observaciones: Optional[str] = None
    revision_observaciones: Optional[str] = None  # motivo al devolver desde revisión (solo para timeline)
    kilos_mal_fabricados: Optional[float] = None
    tiempo_respuesta: Optional[int] = None
    tiempo_respuesta_unidad: Optional[str] = None
    tiempo_respuesta_actualizado_por: Optional[str] = None
    tiempo_respuesta_fecha_actualizacion: Optional[str] = None
    asignado_a: Optional[str] = None
    cubicador_asignado: Optional[str] = None
    area_id: Optional[int] = None           # interno: reasignar área destino (recalcula jefe de servicio)
    metodo_rca: Optional[str] = None        # 'ishikawa' | '5_por_que'
    cinco_por_que: Optional[list] = None    # [{n:1, texto:"..."}, ...]


class SeguimientoCreate(BaseModel):
    comentario: str
    estado_nuevo: Optional[str] = None


class AccionCreate(BaseModel):
    tipo: str
    descripcion: str
    responsable: Optional[str] = None
    fecha_prevista: Optional[str] = None


class AccionUpdate(BaseModel):
    tipo: Optional[str] = None
    descripcion: Optional[str] = None
    responsable: Optional[str] = None
    fecha_prevista: Optional[str] = None
    estado: Optional[str] = None
    fecha_completada: Optional[str] = None


# ========================= RECLAMOS CRUD =========================

@router.get("/reclamos")
def listar_reclamos(
    id_proyecto: Optional[str] = None,
    estado: Optional[str] = None,
    prioridad: Optional[str] = None,
    categoria: Optional[str] = None,
    aplica: Optional[str] = None,
    tipo_reclamo: Optional[str] = None,
    detectado_por: Optional[str] = None,
    responsable: Optional[str] = None,
    busqueda: Optional[str] = None,
    abierto_cerrado: Optional[str] = None,  # 'abiertos' | 'cerrados' (filtro macro)
    tipo_origen: Optional[str] = None,      # 'externo' | 'interno' (separa las dos listas)
    solo_mios: bool = False,
    user=Depends(get_current_user),
):
    """Lista reclamos con filtros opcionales. solo_mios filtra por rol."""
    email = user.get("email", "")
    role = user.get("role", "usc")
    with get_conn() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            where = "WHERE 1=1"
            params = []
            if solo_mios:
                if role == "usc":
                    where += " AND (r.creado_por = %s OR r.asignado_a = %s)"
                    params.extend([email, email])
                elif role in ("externo", "miembro", "jefe_servicio"):
                    where += " AND (r.cubicador_asignado = %s OR r.respuesta_por = %s)"
                    params.extend([email, email])
                else:
                    # Safety: unknown role with solo_mios should still filter
                    where += " AND (r.creado_por = %s OR r.cubicador_asignado = %s)"
                    params.extend([email, email])
            if id_proyecto:
                where += " AND r.id_proyecto = %s"
                params.append(id_proyecto)
            # Separa las dos listas: Reclamos Clientes (externo) vs Internos.
            # Si no se especifica, no filtra (compatibilidad: trae todo).
            if tipo_origen in ("externo", "interno"):
                where += " AND COALESCE(r.tipo_origen, 'externo') = %s"
                params.append(tipo_origen)
            if estado:
                where += " AND r.estado = %s"
                params.append(estado)
            # Filtro macro Abiertos/Cerrados: "abiertos" = todo lo que no está
            # cerrado ni rechazado; "cerrados" = cerrado o rechazado.
            if abierto_cerrado == "abiertos":
                where += " AND r.estado NOT IN ('cerrado','rechazado')"
            elif abierto_cerrado == "cerrados":
                where += " AND r.estado IN ('cerrado','rechazado')"
            if prioridad:
                where += " AND r.prioridad = %s"
                params.append(prioridad)
            if categoria:
                where += " AND r.categoria_ishikawa = %s"
                params.append(categoria)
            if aplica:
                where += " AND r.aplica = %s"
                params.append(aplica)
            if tipo_reclamo:
                where += " AND r.tipo_reclamo = %s"
                params.append(tipo_reclamo)
            if detectado_por:
                where += " AND r.detectado_por = %s"
                params.append(detectado_por)
            if responsable:
                where += " AND r.cubicador_asignado = %s"
                params.append(responsable)
            if busqueda:
                where += " AND (r.titulo ILIKE %s OR r.descripcion ILIKE %s OR r.correlativo ILIKE %s OR r.id_calidad ILIKE %s OR CAST(r.numero_calidad AS TEXT) ILIKE %s)"
                like = f"%{busqueda}%"
                params.extend([like, like, like, like, like])

            cur.execute(f"""
                SELECT r.id, r.id_proyecto, r.titulo, r.descripcion, r.estado,
                       r.prioridad, r.categoria_ishikawa, r.responsable,
                       r.creado_por, r.fecha_creacion, r.fecha_actualizacion, r.fecha_cierre,
                       COALESCE(p.nombre_proyecto, r.id_proyecto, 'Obra eliminada') AS nombre_proyecto,
                       COALESCE(seg.seg_count, 0) AS seg_count,
                       r.aplica, r.sub_causa, r.cod_causa,
                       r.detectado_por, r.fecha_deteccion,
                       r.correlativo, r.id_calidad, r.tipo_reclamo, r.asignado_a,
                       r.cubicador_asignado, r.respuesta_por,
                       r.anio_calidad, r.numero_calidad,
                       r.tipo_origen, r.area_id, ar.nombre AS area_nombre
                FROM reclamos r
                LEFT JOIN proyectos p ON r.id_proyecto = p.id_proyecto
                LEFT JOIN areas ar ON ar.id = r.area_id
                LEFT JOIN (
                    SELECT reclamo_id, COUNT(*) AS seg_count
                    FROM reclamo_seguimientos
                    GROUP BY reclamo_id
                ) seg ON seg.reclamo_id = r.id
                {where}
                ORDER BY
                    -- El reclamo más nuevo siempre arriba, sin importar el estado.
                    -- Se ordena por correlativo de calidad (año/número) descendente
                    -- y, como desempate/fallback, por id de creación descendente.
                    r.anio_calidad DESC NULLS LAST,
                    r.numero_calidad DESC NULLS LAST,
                    r.id DESC
            """, params)
            rows = cur.fetchall()

    return {
        "data": [
            {
                "id": r.get("id"), "id_proyecto": r.get("id_proyecto"), "titulo": r.get("titulo"), "descripcion": r.get("descripcion"),
                "estado": r.get("estado"), "prioridad": r.get("prioridad"), "categoria_ishikawa": r.get("categoria_ishikawa"),
                "responsable": r.get("responsable"), "creado_por": r.get("creado_por"), "fecha_creacion": _as_text(r.get("fecha_creacion")),
                "fecha_actualizacion": _as_text(r.get("fecha_actualizacion")), "fecha_cierre": _as_text(r.get("fecha_cierre")),
                "nombre_proyecto": r.get("nombre_proyecto"), "total_seguimientos": int(r.get("seg_count") or 0),
                "aplica": r.get("aplica"), "sub_causa": r.get("sub_causa"), "cod_causa": r.get("cod_causa"),
                "detectado_por": r.get("detectado_por"),
                "fecha_deteccion": _as_text(r.get("fecha_deteccion")),
                "correlativo": r.get("correlativo"), "id_calidad": r.get("id_calidad"),
                "tipo_reclamo": r.get("tipo_reclamo"), "asignado_a": r.get("asignado_a"),
                "cubicador_asignado": r.get("cubicador_asignado"), "respuesta_por": r.get("respuesta_por"),
                "anio_calidad": r.get("anio_calidad"), "numero_calidad": r.get("numero_calidad"),
                "tipo_origen": r.get("tipo_origen") or "externo",
                "area_id": r.get("area_id"), "area_nombre": r.get("area_nombre"),
            }
            for r in rows
        ]
    }


@router.get("/reclamos/puedo-crear")
def puedo_crear_reclamo(tipo: str = "externo", user=Depends(get_current_user)):
    """¿El usuario actual puede levantar reclamos de este tipo? Para el frontend
    (mostrar/ocultar el formulario de creación). Refleja la config configurable."""
    role = user.get("role", "usc")
    accion = tipo if tipo in ("externo", "interno") else "externo"
    with get_conn() as conn:
        with conn.cursor() as cur:
            puede = _rol_puede_crear(cur, accion, role)
    return {"puede": bool(puede)}


@router.post("/reclamos")
def crear_reclamo(body: ReclamoCreate, user=Depends(get_current_user)):
    """Crear un nuevo reclamo."""
    email = user.get("email", "unknown")
    role = user.get("role", "usc")
    now = datetime.now(timezone.utc).isoformat()

    # Tipo de reclamo: externo (cliente) o interno (área→área).
    tipo_origen = body.tipo_origen if body.tipo_origen in ("externo", "interno") else "externo"

    # Quién puede levantar reclamos es CONFIGURABLE por rol (tabla reclamo_crear_config),
    # separado por externo/interno. admin/admin_calidad siempre pueden.
    with get_conn() as _c0:
        with _c0.cursor() as _cur0:
            if not _rol_puede_crear(_cur0, tipo_origen, role):
                raise HTTPException(status_code=403, detail="No tiene permiso para crear reclamos")

    if body.prioridad and body.prioridad not in PRIORIDADES:
        raise HTTPException(status_code=400, detail=f"Prioridad inválida. Válidas: {PRIORIDADES}")
    if body.tipo_reclamo and body.tipo_reclamo not in TIPOS_RECLAMO:
        raise HTTPException(status_code=400, detail=f"Tipo inválido. Válidos: {TIPOS_RECLAMO}")
    if body.categoria_ishikawa and body.categoria_ishikawa not in CATEGORIAS_ISHIKAWA:
        raise HTTPException(status_code=400, detail=f"Categoría inválida. Válidas: {CATEGORIAS_ISHIKAWA}")

    # Lógica de asignación automática
    asignado_a = body.asignado_a
    if not asignado_a:
        if role == "usc":
            # USC se auto-asigna
            asignado_a = email
        elif role in ("admin", "admin_calidad"):
            # Admin/admin_calidad puede dejar vacío para asignar después
            asignado_a = None
        else:
            # Otros roles no deberían crear reclamos (validado en frontend)
            asignado_a = None

    with get_conn() as conn:
        with conn.cursor() as cur:
            if body.id_proyecto:
                cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (body.id_proyecto,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="Proyecto no encontrado")

            # Generar correlativo auto: REC-001, REC-002, ...
            cur.execute("SELECT MAX(CAST(REPLACE(correlativo, 'REC-', '') AS INTEGER)) FROM reclamos WHERE correlativo IS NOT NULL AND correlativo LIKE 'REC-%%'")
            max_seq = cur.fetchone()[0]
            next_seq = (max_seq or 0) + 1
            correlativo = f"REC-{next_seq:03d}"

            # Área y responsable según el tipo:
            #  - EXTERNO: el área se INFIERE del responsable (cubicador/asignado).
            #    Nunca se elige aparte (evita la incoherencia "cubicador de un área
            #    con área distinta").
            #  - INTERNO: se elige el ÁREA DESTINO (body.area_id) y el responsable es
            #    su Jefe de Servicio (no se elige usuario).
            cub_asignado = body.cubicador_asignado
            responsable_label = body.responsable
            if tipo_origen == "interno":
                area_id = body.area_id
                if not area_id:
                    raise HTTPException(status_code=400, detail="Debe indicar el área responsable del reclamo interno")
                jefe = _jefe_servicio_de_area(cur, area_id)
                # El responsable es el Jefe de Servicio del área destino (si existe).
                cub_asignado = jefe
                responsable_label = jefe
            else:
                area_id = _area_id_de_usuario(cur, body.cubicador_asignado) \
                    or _area_id_de_usuario(cur, asignado_a)

            cur.execute("""
                INSERT INTO reclamos (id_proyecto, titulo, descripcion, prioridad, tipo_reclamo,
                    categoria_ishikawa, sub_causa, cod_causa, responsable,
                    detectado_por, fecha_deteccion, analista,
                    creado_por, fecha_creacion, correlativo, id_calidad, asignado_a,
                    cubicador_asignado, anio_calidad, numero_calidad, area_id, tipo_origen)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (body.id_proyecto, body.titulo, body.descripcion,
                  body.prioridad or "alta", body.tipo_reclamo or "error",
                  body.categoria_ishikawa,
                  body.sub_causa, body.cod_causa, responsable_label,
                  body.detectado_por, body.fecha_deteccion, email,
                  email, now, correlativo, body.id_calidad, asignado_a,
                  cub_asignado, body.anio_calidad, body.numero_calidad, area_id, tipo_origen))
            reclamo_id = cur.fetchone()[0]

            # Auto-create first seguimiento
            cur.execute("""
                INSERT INTO reclamo_seguimientos (reclamo_id, usuario, comentario, estado_nuevo, fecha)
                VALUES (%s, %s, %s, %s, %s)
            """, (reclamo_id, email, "Reclamo creado", "abierto", now))

    audit(email, "crear_reclamo", body.titulo, "reclamo", str(reclamo_id))
    _invalidate_reclamos_cache()

    # Notificaciones
    try:
        extras = []
        if body.cubicador_asignado:
            extras.append(body.cubicador_asignado)
        crear_notificacion(
            "reclamo_creado", reclamo_id,
            f"{correlativo}: {body.titulo or 'Sin título'} — creado por {email}",
            destinatarios_extra=extras
        )
    except Exception:
        pass  # No bloquear creación por error en notificaciones

    return {"ok": True, "id": reclamo_id, "correlativo": correlativo}


@router.get("/reclamos/siguiente-numero-calidad")
def siguiente_numero_calidad(anio: int, tipo_origen: str = "externo", user=Depends(get_current_user)):
    """Sugerir siguiente numero_calidad para un año y tipo dado (externo/interno son series separadas)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT MAX(numero_calidad) FROM reclamos WHERE anio_calidad = %s AND tipo_origen = %s",
                (anio, tipo_origen)
            )
            max_num = cur.fetchone()[0]
    return {"anio": anio, "siguiente": (max_num or 0) + 1}


@router.get("/reclamos/mi-resumen")
def reclamos_mi_resumen(user=Depends(get_current_user)):
    """Landing page stats filtered by role.
    USC: own reclamos (creado_por or asignado_a).
    Cubicador/Externo: reclamos assigned to them (cubicador_asignado) or responded (respuesta_por).
    Admin/Admin Calidad: all reclamos."""
    email = user.get("email", "")
    role = user.get("role", "usc")

    with get_conn() as conn:
        with conn.cursor() as cur:
            role_filter, role_params = build_role_filter(user, cur)
            total = q_total(cur, role_filter, role_params)
            abiertos = q_abiertos(cur, role_filter, role_params)
            por_tipo = q_por_tipo(cur, role_filter, role_params)
            por_anio_mes = q_por_anio_mes(cur, fecha_col="fecha_deteccion", where=role_filter, params=role_params)
            resueltos_no_resueltos = q_resueltos_no_resueltos(cur, role_filter, role_params)

            # Pendientes: assigned to cubicador but not yet responded
            pendientes = 0
            if role in ("externo", "miembro", "jefe_servicio"):
                cur.execute("""
                    SELECT COUNT(*) FROM reclamos r
                    WHERE r.cubicador_asignado = %s
                      AND r.respuesta_texto IS NULL
                      AND r.estado NOT IN ('cerrado','rechazado')
                """, (email,))
                pendientes = int(cur.fetchone()[0])

            # Ishikawa breakdown (doughnut del landing del responsable)
            por_ishikawa = {}
            if role in ("externo", "miembro", "jefe_servicio", "admin", "admin_calidad"):
                por_ishikawa_list = q_por_categoria(cur, where=f" AND r.categoria_ishikawa IS NOT NULL{role_filter}", params=role_params)
                por_ishikawa = {item["categoria"]: item["count"] for item in por_ishikawa_list}

    return {
        "total": total,
        "abiertos": abiertos,
        "pendientes": pendientes,
        "por_tipo": por_tipo,
        "por_anio_mes": por_anio_mes,
        "por_ishikawa": por_ishikawa,
        "resueltos_no_resueltos": resueltos_no_resueltos,
    }


@router.get("/reclamos/admin-dashboards")
def reclamos_admin_dashboards(user=Depends(require_admin_or_admin_calidad)):
    """Detailed analytics for admin Dashboards tab.
    Returns per-USC and per-cubicador breakdowns."""

    cached = _cache.get("reclamos:admin-dash")
    if cached:
        return cached

    with get_conn() as conn:
        with conn.cursor() as cur:
            total = q_total(cur)
            abiertos = q_abiertos(cur)
            por_tipo = q_por_tipo(cur)
            resueltos_no_resueltos = q_resueltos_no_resueltos(cur)
            por_anio_mes = q_por_anio_mes(cur, fecha_col="fecha_deteccion")
            ishikawa_global = q_por_categoria(cur, where=" AND r.categoria_ishikawa IS NOT NULL")
            por_estado = q_por_estado(cur)

            # --- USC breakdown ---
            cur.execute("""
                SELECT COALESCE(r.asignado_a, r.creado_por, 'Desconocido') AS usc_user,
                       COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE r.tipo_reclamo = 'error') AS errores,
                       COUNT(*) FILTER (WHERE r.tipo_reclamo = 'faltante') AS faltantes,
                       COUNT(*) FILTER (WHERE r.tipo_reclamo = 'atraso') AS atrasos,
                       COUNT(*) FILTER (WHERE r.tipo_reclamo = 'actualizacion_portal') AS actualizaciones
                FROM reclamos r
                JOIN users u ON u.email = COALESCE(r.asignado_a, r.creado_por)
                WHERE u.role = 'usc'
                GROUP BY usc_user ORDER BY total DESC
            """)
            por_usc = [{"email": r[0], "total": int(r[1]), "errores": int(r[2]), "faltantes": int(r[3]), "atrasos": int(r[4]), "actualizaciones": int(r[5])} for r in cur.fetchall()]

            cur.execute("""
                SELECT COALESCE(r.asignado_a, r.creado_por) AS usc_user,
                       EXTRACT(YEAR FROM COALESCE(r.fecha_deteccion, r.fecha_creacion)::timestamp)::INTEGER AS anio,
                       EXTRACT(MONTH FROM COALESCE(r.fecha_deteccion, r.fecha_creacion)::timestamp)::INTEGER AS mes,
                       COUNT(*)
                FROM reclamos r
                JOIN users u ON u.email = COALESCE(r.asignado_a, r.creado_por)
                WHERE u.role = 'usc'
                GROUP BY usc_user, anio, mes ORDER BY usc_user, anio, mes
            """)
            usc_hist = [{"email": r[0], "anio": r[1], "mes": r[2], "count": int(r[3])} for r in cur.fetchall()]

            # --- Cubicador breakdown ---
            cur.execute("""
                SELECT COALESCE(
                    TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')),
                    r.cubicador_asignado,
                    'Sin asignar'
                ) AS cub, COUNT(*)
                FROM reclamos r
                LEFT JOIN users u ON u.email = r.cubicador_asignado
                GROUP BY cub ORDER BY 2 DESC
            """)
            por_cubicador_asignado = [{"cubicador": r[0], "count": int(r[1])} for r in cur.fetchall()]

            cur.execute("""
                SELECT COALESCE(NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), ''), r.respuesta_por) AS display,
                       COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE r.tipo_reclamo = 'error') AS errores,
                       COUNT(*) FILTER (WHERE r.tipo_reclamo = 'faltante') AS faltantes,
                       COUNT(*) FILTER (WHERE r.tipo_reclamo = 'atraso') AS atrasos,
                       COUNT(*) FILTER (WHERE r.tipo_reclamo = 'actualizacion_portal') AS actualizaciones
                FROM reclamos r
                JOIN users u ON u.email = r.respuesta_por
                WHERE r.respuesta_por IS NOT NULL
                GROUP BY display ORDER BY total DESC
            """)
            por_cubicador = [{"email": r[0], "total": int(r[1]), "errores": int(r[2]), "faltantes": int(r[3]), "atrasos": int(r[4]), "actualizaciones": int(r[5])} for r in cur.fetchall()]

            cur.execute("""
                SELECT COALESCE(
                    NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), ''),
                    r.cubicador_asignado,
                    'Sin asignar'
                ) AS cub,
                       COALESCE(SUM(r.kilos_mal_fabricados), 0) AS kilos
                FROM reclamos r
                LEFT JOIN users u ON u.email = r.cubicador_asignado
                WHERE r.kilos_mal_fabricados IS NOT NULL AND r.kilos_mal_fabricados > 0
                GROUP BY cub ORDER BY kilos DESC
            """)
            kilos_por_cubicador = [{"cubicador": r[0], "kilos": round(float(r[1]), 1)} for r in cur.fetchall()]

            cur.execute("""
                SELECT COALESCE(NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), ''), r.respuesta_por) AS display,
                       COALESCE(r.categoria_ishikawa, 'sin_categoria'),
                       COUNT(*)
                FROM reclamos r
                JOIN users u ON u.email = r.respuesta_por
                WHERE r.respuesta_por IS NOT NULL
                GROUP BY display, 2 ORDER BY display, 3 DESC
            """)
            ishikawa_per_cub = [{"email": r[0], "categoria": r[1], "count": int(r[2])} for r in cur.fetchall()]

            # --- Por Proyecto ---
            por_proyecto = []
            proyecto_por_mes = []
            try:
                por_proyecto = q_por_proyecto(cur)
            except Exception as e:
                print(f"[DASH] por_proyecto error: {e}")
                conn.rollback()

            try:
                cur.execute("""
                    SELECT COALESCE(p.nombre_proyecto, r.id_proyecto, 'Sin proyecto') AS proy,
                           TO_CHAR(COALESCE(r.fecha_deteccion, r.fecha_creacion, NOW()::TEXT)::timestamp, 'YYYY-MM') AS mes,
                           COUNT(*) AS total
                    FROM reclamos r
                    LEFT JOIN proyectos p ON p.id_proyecto = r.id_proyecto
                    WHERE COALESCE(r.fecha_deteccion, r.fecha_creacion, NOW()::TEXT)::timestamp >= NOW() - INTERVAL '12 months'
                    GROUP BY 1, 2 ORDER BY 1, 2
                """)
                proyecto_por_mes = [{"proyecto": str(r[0]), "mes": r[1], "count": int(r[2])} for r in cur.fetchall()]
            except Exception as e:
                print(f"[DASH] proyecto_por_mes error: {e}")
                conn.rollback()

    result = {
        "total": total,
        "abiertos": abiertos,
        "por_tipo": por_tipo,
        "resueltos_no_resueltos": resueltos_no_resueltos,
        "por_anio_mes": por_anio_mes,
        "por_usc": por_usc,
        "usc_hist": usc_hist,
        "ishikawa_global": ishikawa_global,
        "por_cubicador": por_cubicador,
        "por_cubicador_asignado": por_cubicador_asignado,
        "kilos_por_cubicador": kilos_por_cubicador,
        "ishikawa_per_cub": ishikawa_per_cub,
        "por_proyecto": por_proyecto,
        "proyecto_por_mes": proyecto_por_mes,
        "por_estado": por_estado,
    }
    _cache.put("reclamos:admin-dash", result, ttl=45)
    return result


# [ELIMINADOS] /reclamos/kpis y /reclamos/dashboard — endpoints huérfanos sin consumo frontend.


@router.get("/reclamos/ishikawa")
def get_ishikawa(area_id: Optional[int] = None, user=Depends(get_current_user)):
    """Devuelve la matriz Ishikawa del área indicada (desde BD).
    Si el área no tiene matriz propia, devuelve lista vacía para que el front ofrezca 5 Por Qué."""
    if area_id:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT arc.id, arc.slug, arc.nombre, arc.orden
                    FROM area_rca_categorias arc
                    WHERE arc.area_id = %s
                    ORDER BY arc.orden, arc.id
                """, (area_id,))
                cats = cur.fetchall()
                if cats:
                    cat_ids = [c[0] for c in cats]
                    cur.execute("""
                        SELECT categoria_id, codigo, descripcion
                        FROM area_rca_subcausas
                        WHERE categoria_id = ANY(%s) AND activo = TRUE
                        ORDER BY orden, id
                    """, (cat_ids,))
                    subs_by_cat = {}
                    for row in cur.fetchall():
                        subs_by_cat.setdefault(row[0], []).append({"cod": row[1], "texto": row[2]})
                    return {
                        "data": [
                            {"key": c[1], "label": c[2], "subcausas": subs_by_cat.get(c[0], [])}
                            for c in cats
                        ]
                    }
        # Área sin matriz → devuelve vacío (el front activa 5 Por Qué por defecto)
        return {"data": []}
    # Sin area_id: fallback al dict hardcodeado (compatibilidad con reclamos sin área)
    return {
        "data": [
            {"key": k, "label": ISHIKAWA_LABELS[k], "subcausas": ISHIKAWA_SUBCAUSAS[k]}
            for k in CATEGORIAS_ISHIKAWA
        ]
    }


@router.get("/reclamos/areas")
def get_areas_para_selector(user=Depends(get_current_user)):
    """Lista ligera de áreas activas (id + nombre) para poblar selectores.
    Accesible a cualquier usuario autenticado: un miembro necesita las áreas
    para crear un reclamo interno (elegir área destino), sin requerir el panel
    admin de áreas (/admin/areas, que trae conteos/usuarios/config y es admin-only)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, nombre FROM areas
                WHERE activo = TRUE
                ORDER BY nombre
            """)
            rows = cur.fetchall()
    return [{"id": r[0], "nombre": r[1], "activo": True} for r in rows]


@router.get("/reclamos/usuarios-usc")
def get_usuarios_usc(user=Depends(get_current_user)):
    """Lista de usuarios con rol USC para dropdown de asignación."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT email, nombre, apellido 
                FROM users 
                WHERE role = 'usc' AND activo = TRUE 
                ORDER BY nombre, apellido, email
            """)
            rows = cur.fetchall()
    return {
        "data": [
            {"email": r[0], "nombre": r[1], "apellido": r[2],
             "display": ((r[1] or '') + ' ' + (r[2] or '')).strip() or r[0]}
            for r in rows
        ]
    }


# ========================= VALIDACIÓN — KPIs =========================
# NOTE: debe declararse antes de /reclamos/{reclamo_id}

@router.get("/reclamos/validacion-kpis")
def reclamos_validacion_kpis(user=Depends(get_current_user)):
    """KPIs para el sub-tab Validaciones.
    - en_revision: reclamos esperando revisión del Jefe de Servicio
    - pendientes: reclamos en estado 'validacion' (esperando a Calidad)
    - abiertos: reclamos no cerrados ni rechazados
    - cerrados: reclamos cerrados
    Devueltos y tiempo promedio quedan para la sección de reportes (5.40).
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM reclamos WHERE estado = 'en_revision'")
            en_revision = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM reclamos WHERE estado = 'validacion'")
            pendientes = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM reclamos WHERE estado NOT IN ('cerrado','rechazado')")
            abiertos = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM reclamos WHERE estado = 'cerrado'")
            cerrados = int(cur.fetchone()[0])
    return {"en_revision": en_revision, "pendientes": pendientes, "abiertos": abiertos, "cerrados": cerrados}


# ========================= PRESENTACIONES =========================
# NOTE: These routes MUST be declared before /reclamos/{reclamo_id}
# otherwise FastAPI matches "para-presentar" as {reclamo_id} → 422 error.

@router.get("/reclamos/para-presentar")
def reclamos_para_presentar(user=Depends(get_current_user)):
    """Lista de reclamos elegibles para presentación.
    Requisito: estado = 'cerrado'.
    Cubicadores solo ven sus reclamos asignados; admin/admin_calidad ven todos.
    """
    email = user.get("email", "")
    role = user.get("role", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            role_filter = ""
            params = []
            if role in ("externo", "miembro", "jefe_servicio"):
                role_filter = "AND (r.cubicador_asignado = %s OR r.respuesta_por = %s)"
                params.extend([email, email])
            elif role not in ("admin", "admin_calidad"):
                role_filter, params = build_role_filter(user, cur)

            cur.execute(f"""
                SELECT r.id, r.correlativo, r.titulo, r.descripcion, r.estado,
                       r.tipo_reclamo, r.aplica,
                       r.cubicador_asignado,
                       COALESCE(uc.nombre, '') AS cub_nombre,
                       COALESCE(uc.apellido, '') AS cub_apellido,
                       r.respuesta_texto,
                       r.categoria_ishikawa, r.sub_causa, r.cod_causa,
                       r.fecha_deteccion,
                       COALESCE(p.nombre_proyecto, r.id_proyecto, '') AS nombre_proyecto,
                       r.presentacion_realizada,
                       r.presentacion_fecha,
                       r.presentacion_por,
                       r.presentacion_asistentes,
                       r.presentacion_comentarios,
                       r.detectado_por, r.area_aplica,
                       r.kilos_mal_fabricados
                FROM reclamos r
                LEFT JOIN users uc ON uc.email = r.cubicador_asignado
                LEFT JOIN proyectos p ON p.id_proyecto = r.id_proyecto
                WHERE r.estado = 'cerrado'
                  {role_filter}
                ORDER BY r.presentacion_realizada ASC NULLS FIRST, r.id DESC
            """, params)
            rows = cur.fetchall()

            # Lista para el selector de asistentes: miembros del área Cubicaciones
            # (antes filtraba role='cubicador', rol ya migrado a miembro → quedaba
            # vacío). Se identifican por pertenencia al área cuyo slug/nombre es
            # Cubicaciones, vía area_usuarios.
            cur.execute("""
                SELECT u.email, COALESCE(u.nombre, '') AS nombre, COALESCE(u.apellido, '') AS apellido
                FROM users u
                JOIN area_usuarios au ON au.user_id = u.id
                JOIN areas a ON a.id = au.area_id
                WHERE u.activo = TRUE
                  AND (a.slug ILIKE 'cubica%' OR a.nombre ILIKE 'cubica%')
                ORDER BY nombre, apellido
            """)
            cubicadores = cur.fetchall()

    return {
        "data": [
            {
                "id": r[0], "correlativo": r[1], "titulo": r[2], "descripcion": r[3],
                "estado": r[4], "tipo_reclamo": r[5], "aplica": r[6],
                "cubicador_asignado": r[7],
                "cubicador_nombre": ((r[8] or "") + " " + (r[9] or "")).strip() or r[7],
                "respuesta_texto": r[10],
                "categoria_ishikawa": r[11], "sub_causa": r[12], "cod_causa": r[13],
                "fecha_deteccion": r[14], "nombre_proyecto": r[15],
                "presentacion_realizada": r[16] or False,
                "presentacion_fecha": r[17], "presentacion_por": r[18],
                "presentacion_asistentes": r[19], "presentacion_comentarios": r[20],
                "detectado_por": r[21], "area_aplica": r[22],
                "kilos_mal_fabricados": r[23],
            }
            for r in rows
        ],
        "cubicadores": [
            {"email": c[0], "nombre": ((c[1] or "") + " " + (c[2] or "")).strip() or c[0]}
            for c in cubicadores
        ],
    }


@router.get("/reclamos/presentaciones-stats")
def presentaciones_stats(user=Depends(get_current_user)):
    """Stats para dashboards del tab de presentaciones."""
    email = user.get("email", "")
    role = user.get("role", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            role_filter = ""
            params = []
            if role in ("externo", "miembro", "jefe_servicio"):
                role_filter = "AND (r.cubicador_asignado = %s OR r.respuesta_por = %s)"
                params.extend([email, email])
            elif role not in ("admin", "admin_calidad"):
                role_filter, params = build_role_filter(user, cur)

            base = f"""
                FROM reclamos r
                LEFT JOIN users uc ON uc.email = r.cubicador_asignado
                WHERE r.estado = 'cerrado'
                  {role_filter}
            """

            # Presentados por cubicador
            cur.execute(f"""
                SELECT r.cubicador_asignado,
                       COALESCE(uc.nombre, '') || ' ' || COALESCE(uc.apellido, '') AS nombre,
                       COUNT(*) AS total
                {base}
                  AND r.presentacion_realizada = TRUE
                GROUP BY r.cubicador_asignado, uc.nombre, uc.apellido
                ORDER BY total DESC
            """, params)
            presentados_por_cub = [
                {"email": r[0], "nombre": r[1].strip() or r[0], "total": int(r[2])}
                for r in cur.fetchall()
            ]

            # Por presentar por cubicador
            cur.execute(f"""
                SELECT r.cubicador_asignado,
                       COALESCE(uc.nombre, '') || ' ' || COALESCE(uc.apellido, '') AS nombre,
                       COUNT(*) AS total
                {base}
                  AND (r.presentacion_realizada = FALSE OR r.presentacion_realizada IS NULL)
                GROUP BY r.cubicador_asignado, uc.nombre, uc.apellido
                ORDER BY total DESC
            """, params)
            por_presentar_por_cub = [
                {"email": r[0], "nombre": r[1].strip() or r[0], "total": int(r[2])}
                for r in cur.fetchall()
            ]

            # Totals
            cur.execute(f"""
                SELECT
                    COUNT(*) FILTER (WHERE r.presentacion_realizada = TRUE) AS presentados,
                    COUNT(*) FILTER (WHERE r.presentacion_realizada = FALSE OR r.presentacion_realizada IS NULL) AS por_presentar
                {base}
            """, params)
            totals = cur.fetchone()

    return {
        "presentados": int(totals[0]),
        "por_presentar": int(totals[1]),
        "presentados_por_cubicador": presentados_por_cub,
        "por_presentar_por_cubicador": por_presentar_por_cub,
    }


class PresentarReclamoRequest(BaseModel):
    asistentes: List[str]
    comentarios: str


# ========================= RECLAMO DETAIL (parameterized routes below) =========================

@router.post("/reclamos/{reclamo_id}/presentar")
def presentar_reclamo(reclamo_id: int, body: PresentarReclamoRequest, user=Depends(get_current_user)):
    """Marcar un reclamo como presentado."""
    email = user.get("email", "unknown")
    role = user.get("role", "usc")
    now = datetime.now(timezone.utc).isoformat()

    if role not in ("admin", "admin_calidad", "externo", "miembro", "jefe_servicio"):
        raise HTTPException(status_code=403, detail="No tiene permiso para presentar reclamos")

    if not body.asistentes:
        raise HTTPException(status_code=400, detail="Debe seleccionar al menos un asistente")
    if not body.comentarios or not body.comentarios.strip():
        raise HTTPException(status_code=400, detail="Debe ingresar comentarios de la presentación")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, cubicador_asignado, respuesta_texto, presentacion_realizada, respuesta_por
                FROM reclamos WHERE id = %s
            """, (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            if not row[1] or not row[2]:
                raise HTTPException(status_code=400, detail="El reclamo no tiene cubicador asignado o respuesta")

            if role in ("externo", "miembro", "jefe_servicio"):
                rec = {"cubicador_asignado": row[1], "respuesta_por": row[4]}
                if not _es_propietario_cubicador(rec, email):
                    raise HTTPException(status_code=403, detail="Solo puede presentar reclamos propios")

            asistentes_str = ",".join(body.asistentes)
            cur.execute("""
                UPDATE reclamos SET
                    presentacion_realizada = TRUE,
                    presentacion_fecha = %s,
                    presentacion_por = %s,
                    presentacion_asistentes = %s,
                    presentacion_comentarios = %s
                WHERE id = %s
            """, (now, email, asistentes_str, body.comentarios.strip(), reclamo_id))

    _invalidate_reclamo_cache(reclamo_id)
    audit(email, "presentar_reclamo", f"Reclamo #{reclamo_id} presentado", "reclamo", str(reclamo_id))
    return {"ok": True, "id": reclamo_id}


# ========================= CACHE EN MEMORIA (FASE 8.2.1) =========================

# Cache simple en memoria para datos frecuentes
_reclamos_cache = {}
_cache_timeout = 300  # 5 minutos
_schema_columns_cache = {}

def _get_cache_key(
    reclamo_id: int,
    include_images: bool = True,
    include_seguimientos: bool = True,
    include_acciones: bool = True,
) -> str:
    return (
        f"reclamo_{reclamo_id}"
        f"_imgs_{include_images}"
        f"_seg_{include_seguimientos}"
        f"_acc_{include_acciones}"
    )

def _is_cache_valid(cache_key: str) -> bool:
    if cache_key not in _reclamos_cache:
        return False
    timestamp = _reclamos_cache[cache_key]["timestamp"]
    return (datetime.now(timezone.utc).timestamp() - timestamp) < _cache_timeout

def _get_from_cache(cache_key: str):
    return _reclamos_cache[cache_key]["data"]

def _set_cache(cache_key: str, data):
    _reclamos_cache[cache_key] = {
        "data": data,
        "timestamp": datetime.now(timezone.utc).timestamp()
    }

def _invalidate_reclamo_cache(reclamo_id: int):
    prefix = f"reclamo_{reclamo_id}"
    for key in list(_reclamos_cache.keys()):
        if key.startswith(prefix):
            _reclamos_cache.pop(key, None)
    _invalidate_reclamos_cache()


def _get_table_columns(cur, table_name: str):
    cache_key = table_name.lower()
    if cache_key in _schema_columns_cache:
        return _schema_columns_cache[cache_key]

    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (cache_key,),
    )
    columns = {row.get("column_name") for row in cur.fetchall() if row.get("column_name")}
    _schema_columns_cache[cache_key] = columns
    return columns

# Lista de reclamos CERRADOS con estado de envío (Mailing → Cierre Reclamos).
# DEBE ir antes de /reclamos/{reclamo_id} para que FastAPI no matchee
# "cerrados-envio" como un id (mismo motivo que /reclamos/para-presentar).
@router.get("/reclamos/cerrados-envio")
def reclamos_cerrados_envio(user=Depends(get_current_user)):
    """Reclamos EXTERNOS cerrados + su estado de envío de informe. Solo admin/admin_calidad.
    Internos no se incluyen: esos usuarios ya tienen acceso al sistema y no requieren
    el envío del informe por correo (decisión 2026-06-17)."""
    if user.get("role") not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo Calidad puede ver esta lista")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT r.id,
                       COALESCE(r.correlativo, '#' || r.id) AS correlativo,
                       r.titulo,
                       COALESCE(p.nombre_proyecto, r.id_proyecto, '') AS proyecto,
                       -- Año: usa anio_calidad; si no, los 4 primeros chars de
                       -- fecha_creacion (TEXT ISO 'YYYY-...'), solo si son 4 dígitos.
                       -- Inmune al formato: nada de ::timestamp ni ::int sobre texto
                       -- arbitrario (eso tumbaba la query con reclamos legacy → lista vacía).
                       COALESCE(
                           r.anio_calidad,
                           CASE WHEN LEFT(COALESCE(r.fecha_creacion,''), 4) ~ '^[0-9]{4}$'
                                THEN LEFT(r.fecha_creacion, 4)::int END
                       ) AS anio,
                       r.tipo_origen,
                       (SELECT COUNT(*) FROM reclamo_envios e
                        WHERE e.reclamo_id = r.id AND e.estado = 'enviado') AS envios_ok,
                       (SELECT MAX(e.fecha) FROM reclamo_envios e
                        WHERE e.reclamo_id = r.id AND e.estado = 'enviado') AS ultimo_envio
                FROM reclamos r
                LEFT JOIN proyectos p ON p.id_proyecto = r.id_proyecto
                WHERE r.estado = 'cerrado'
                  AND COALESCE(r.tipo_origen, 'externo') = 'externo'
                ORDER BY anio DESC NULLS LAST, r.id DESC
            """)
            rows = cur.fetchall()
    return [
        {"id": r[0], "correlativo": r[1], "titulo": r[2], "proyecto": r[3],
         "anio": int(r[4]) if r[4] else None, "tipo_origen": r[5],
         "envios_ok": int(r[6] or 0), "ultimo_envio": _as_text(r[7])}
        for r in rows
    ]


# ========================= ENDPOINTS OPTIMIZADOS (FASE 8.2.1) =========================

@router.get("/reclamos/{reclamo_id}")
def get_reclamo_optimizado(
    reclamo_id: int, 
    user=Depends(get_current_user),
    include_images: bool = Query(True, description="Incluir imágenes (payload grande)"),
    include_seguimientos: bool = Query(True, description="Incluir seguimientos"),
    include_acciones: bool = Query(True, description="Incluir acciones")
):
    """Obtener detalle de un reclamo optimizado con cache y queries eficientes."""
    
    role = user.get("role", "")

    # Cache solo para roles globales (admin/admin_calidad ven todo sin restricción).
    # Los demás (usc/externo/miembro/jefe_servicio) tienen scope restringido por
    # propiedad o por área — no cachear para evitar que lean reclamos ajenos.
    use_cache = role in ("admin", "admin_calidad")
    cache_key = _get_cache_key(reclamo_id, include_images, include_seguimientos, include_acciones)

    if use_cache and _is_cache_valid(cache_key):
        return _get_from_cache(cache_key)

    try:
        with get_conn() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("""
                    SELECT
                        r.*,
                        CASE
                            WHEN r.id_proyecto IS NULL AND r.tipo_origen = 'interno' THEN 'Armacero'
                            WHEN r.id_proyecto IS NULL THEN 'Obra eliminada'
                            ELSE COALESCE(p.nombre_proyecto, 'Obra eliminada')
                        END AS nombre_proyecto,
                        p.nombre_proyecto AS nombre_proyecto_lookup,
                        ar.nombre AS area_nombre,
                        ar.tiene_revision AS area_tiene_revision,
                        ar.tiene_revision_interno AS area_tiene_revision_interno
                    FROM reclamos r
                    LEFT JOIN proyectos p ON r.id_proyecto = p.id_proyecto
                    LEFT JOIN areas ar ON ar.id = r.area_id
                    WHERE r.id = %s
                """, (reclamo_id,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Reclamo no encontrado")

                # H2: validar ownership para roles con scope restringido (cierra IDOR)
                if not _puede_ver_reclamo(row, user, cur):
                    raise HTTPException(status_code=403, detail="No tiene permiso para ver este reclamo")

                response = {
                    "id": row.get("id"),
                    "id_proyecto": row.get("id_proyecto"),
                    "titulo": row.get("titulo"),
                    "descripcion": row.get("descripcion"),
                    "estado": row.get("estado"),
                    "prioridad": row.get("prioridad"),
                    "categoria_ishikawa": row.get("categoria_ishikawa"),
                    "responsable": row.get("responsable"),
                    "creado_por": row.get("creado_por"),
                    "fecha_creacion": _as_text(row.get("fecha_creacion")),
                    "fecha_actualizacion": _as_text(row.get("fecha_actualizacion")),
                    "fecha_cierre": _as_text(row.get("fecha_cierre")),
                    "nombre_proyecto": row.get("nombre_proyecto") or "",
                    "tipo_origen": row.get("tipo_origen") or "externo",
                    "aplica": row.get("aplica"),
                    "sub_causa": row.get("sub_causa"),
                    "cod_causa": row.get("cod_causa"),
                    "detectado_por": row.get("detectado_por"),
                    "fecha_deteccion": _as_text(row.get("fecha_deteccion")),
                    "analista": row.get("analista"),
                    "explicacion_causa": row.get("explicacion_causa"),
                    "accion_correctiva": row.get("accion_correctiva"),
                    "accion_preventiva": row.get("accion_preventiva"),
                    "resolucion": row.get("resolucion"),
                    "observaciones": row.get("observaciones"),
                    "correlativo": row.get("correlativo"),
                    "id_calidad": row.get("id_calidad"),
                    "anio_calidad": row.get("anio_calidad"),
                    "numero_calidad": row.get("numero_calidad"),
                    "tipo_reclamo": row.get("tipo_reclamo"),
                    "respuesta_texto": row.get("respuesta_texto"),
                    "respuesta_fecha": _as_text(row.get("respuesta_fecha")),
                    "respuesta_por": row.get("respuesta_por"),
                    "area_aplica": row.get("area_aplica"),
                    "area_id": row.get("area_id"),
                    "area_nombre": row.get("area_nombre"),
                    "area_tiene_revision": row.get("area_tiene_revision"),
                    "area_tiene_revision_interno": row.get("area_tiene_revision_interno"),
                    "fecha_analisis": _as_text(row.get("fecha_analisis")),
                    "validacion_resultado": row.get("validacion_resultado"),
                    "validacion_observaciones": row.get("validacion_observaciones"),
                    "validacion_fecha": _as_text(row.get("validacion_fecha")),
                    "validacion_por": row.get("validacion_por"),
                    "kilos_mal_fabricados": row.get("kilos_mal_fabricados"),
                    "tiempo_respuesta": row.get("tiempo_respuesta"),
                    "tiempo_respuesta_unidad": row.get("tiempo_respuesta_unidad"),
                    "tiempo_respuesta_actualizado_por": row.get("tiempo_respuesta_actualizado_por"),
                    "tiempo_respuesta_fecha_actualizacion": _as_text(row.get("tiempo_respuesta_fecha_actualizacion")),
                    "asignado_a": row.get("asignado_a"),
                    "cubicador_asignado": row.get("cubicador_asignado"),
                    "presentacion_realizada": row.get("presentacion_realizada"),
                    "presentacion_fecha": _as_text(row.get("presentacion_fecha")),
                    "presentacion_por": row.get("presentacion_por"),
                    "presentacion_asistentes": row.get("presentacion_asistentes"),
                    "presentacion_comentarios": row.get("presentacion_comentarios"),
                    "metodo_rca": row.get("metodo_rca") or "ishikawa",
                    "cinco_por_que": row.get("cinco_por_que") or [],
                }

                response["seguimientos"] = []
                response["acciones"] = []
                response["imagenes"] = []

                if include_seguimientos:
                    seg_columns = _get_table_columns(cur, "reclamo_seguimientos")
                    if seg_columns:
                        seg_select = [
                            "id",
                            "usuario" if "usuario" in seg_columns else "NULL AS usuario",
                            "comentario" if "comentario" in seg_columns else "NULL AS comentario",
                            "estado_anterior" if "estado_anterior" in seg_columns else "NULL AS estado_anterior",
                            "estado_nuevo" if "estado_nuevo" in seg_columns else "NULL AS estado_nuevo",
                            ("fecha" if "fecha" in seg_columns else "NULL") + " AS fecha_ref",
                        ]
                        seg_order = "fecha ASC, id ASC" if "fecha" in seg_columns else "id ASC"
                        cur.execute(f"""
                            SELECT {", ".join(seg_select)}
                            FROM reclamo_seguimientos WHERE reclamo_id = %s
                            ORDER BY {seg_order}
                        """, (reclamo_id,))
                        seguimientos = cur.fetchall()
                        response["seguimientos"] = [
                            {
                                "id": s.get("id"),
                                "usuario": s.get("usuario"),
                                "comentario": s.get("comentario"),
                                "estado_anterior": s.get("estado_anterior"),
                                "estado_nuevo": s.get("estado_nuevo"),
                                "fecha": _as_text(s.get("fecha_ref")),
                            }
                            for s in seguimientos
                        ]

                if include_acciones:
                    acciones_columns = _get_table_columns(cur, "reclamo_acciones")
                    if acciones_columns:
                        acciones_select = [
                            "id",
                            "tipo" if "tipo" in acciones_columns else "NULL AS tipo",
                            "descripcion" if "descripcion" in acciones_columns else "NULL AS descripcion",
                            "responsable" if "responsable" in acciones_columns else "NULL AS responsable",
                            ("fecha_prevista" if "fecha_prevista" in acciones_columns else "NULL") + " AS fecha_prevista_ref",
                            ("fecha_completada" if "fecha_completada" in acciones_columns else "NULL") + " AS fecha_completada_ref",
                            "estado" if "estado" in acciones_columns else "NULL AS estado",
                            "creado_por" if "creado_por" in acciones_columns else "NULL AS creado_por",
                            ("fecha_creacion" if "fecha_creacion" in acciones_columns else "NULL") + " AS fecha_creacion_ref",
                        ]
                        cur.execute(f"""
                            SELECT {", ".join(acciones_select)}
                            FROM reclamo_acciones
                            WHERE reclamo_id = %s
                            ORDER BY id ASC
                        """, (reclamo_id,))
                        acciones = cur.fetchall()
                        response["acciones"] = [
                            {
                                "id": a.get("id"),
                                "tipo": a.get("tipo"),
                                "descripcion": a.get("descripcion"),
                                "responsable": a.get("responsable"),
                                "fecha_prevista": _as_text(a.get("fecha_prevista_ref")),
                                "fecha_completada": _as_text(a.get("fecha_completada_ref")),
                                "estado": a.get("estado"),
                                "creado_por": a.get("creado_por"),
                                "fecha_creacion": _as_text(a.get("fecha_creacion_ref")),
                            }
                            for a in acciones
                        ]

                if include_images:
                    imagenes_columns = _get_table_columns(cur, "reclamo_imagenes")
                    if imagenes_columns:
                        fecha_expr = "fecha" if "fecha" in imagenes_columns else (
                            "fecha_subida" if "fecha_subida" in imagenes_columns else "NULL"
                        )
                        tipo_expr = "tipo" if "tipo" in imagenes_columns else "NULL"
                        sk_expr = "storage_key" if "storage_key" in imagenes_columns else "NULL"
                        cur.execute(f"""
                            SELECT id, filename, content_type, descripcion, subido_por,
                                   {fecha_expr} AS fecha_ref,
                                   {tipo_expr} AS tipo_ref,
                                   {sk_expr} AS storage_key
                            FROM reclamo_imagenes WHERE reclamo_id = %s
                            ORDER BY id ASC
                        """, (reclamo_id,))
                        imagenes = cur.fetchall()

                        def _img_url(img):
                            # Si está en R2: presigned URL temporal (carga directo en <img>,
                            # ya autorizada; este detalle ya validó acceso al reclamo).
                            sk = img.get("storage_key")
                            if sk and storage.is_configured():
                                try:
                                    return storage.generate_presigned_url(
                                        sk, expires=3600,
                                        content_type=img.get("content_type")
                                    )
                                except Exception:
                                    pass
                            # Fallback (BYTEA o R2 no disponible): endpoint protegido.
                            return f"/reclamos/{reclamo_id}/imagenes/{img.get('id')}"

                        response["imagenes"] = [
                            {
                                "id": img.get("id"),
                                "filename": img.get("filename"),
                                "content_type": img.get("content_type"),
                                "descripcion": img.get("descripcion"),
                                "subido_por": img.get("subido_por"),
                                "fecha": _as_text(img.get("fecha_ref")),
                                "fecha_subida": _as_text(img.get("fecha_ref")),
                                "tipo": img.get("tipo_ref") or "ImagenesRegistro",
                                "url": _img_url(img),
                                "size_preview": "thumbnail"
                            }
                            for img in imagenes
                        ]

        if use_cache:
            _set_cache(cache_key, response)
        return response
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error cargando detalle del reclamo: {exc}")


@router.patch("/reclamos/{reclamo_id}")
def actualizar_reclamo(reclamo_id: int, body: ReclamoUpdate, user=Depends(get_current_user)):
    """Actualizar campos de un reclamo. Si cambia estado, crea seguimiento automático."""
    email = user.get("email", "unknown")
    role = user.get("role", "usc")
    now = datetime.now(timezone.utc).isoformat()

    if role == "cliente":
        raise HTTPException(status_code=403, detail="No tiene permiso para editar reclamos")

    if body.estado and body.estado not in ESTADOS_RECLAMO:
        raise HTTPException(status_code=400, detail=f"Estado inválido. Válidos: {list(ESTADOS_RECLAMO)}")
    if body.prioridad and body.prioridad not in PRIORIDADES:
        raise HTTPException(status_code=400, detail=f"Prioridad inválida. Válidas: {list(PRIORIDADES)}")
    if body.categoria_ishikawa and body.categoria_ishikawa not in CATEGORIAS_ISHIKAWA:
        raise HTTPException(status_code=400, detail=f"Categoría inválida. Válidas: {list(CATEGORIAS_ISHIKAWA)}")
    if body.tipo_reclamo and body.tipo_reclamo not in TIPOS_RECLAMO:
        raise HTTPException(status_code=400, detail=f"Tipo inválido. Válidos: {list(TIPOS_RECLAMO)}")
    if body.aplica and body.aplica not in APLICA_VALUES:
        raise HTTPException(status_code=400, detail=f"Aplica inválido. Válidos: {list(APLICA_VALUES)}")
    if body.validacion_resultado and body.validacion_resultado not in VALIDACION_RESULTADOS:
        raise HTTPException(status_code=400, detail=f"Resultado validación inválido. Válidos: {list(VALIDACION_RESULTADOS)}")
    if body.tiempo_respuesta_unidad and body.tiempo_respuesta_unidad not in ("minutos", "horas", "dias"):
        raise HTTPException(status_code=400, detail="Unidad de tiempo inválida. Válidas: ['minutos', 'horas', 'dias']")

    _area_cambio_por_responsable = False  # 5L.4: se activa si el cambio de responsable movió el área

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, estado, creado_por, asignado_a, cubicador_asignado, respuesta_por, aplica, respuesta_texto, tipo_origen, area_id
                FROM reclamos WHERE id = %s
                """,
                (reclamo_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            estado_anterior = row[1]
            rec = {"creado_por": row[2], "asignado_a": row[3], "cubicador_asignado": row[4], "respuesta_por": row[5], "tipo_origen": row[8], "area_id": row[9]}
            aplica_actual = row[6]
            respuesta_actual = row[7]

            # Filtrar campos según rol
            submitted_fields = {f for f in body.__fields_set__ if getattr(body, f) is not None}
            if role in ("admin", "admin_calidad"):
                pass  # sin restricción
            elif role == "usc":
                if not _es_propietario_usc(rec, email):
                    raise HTTPException(status_code=403, detail="Solo puede editar reclamos propios")
                if submitted_fields and estado_anterior != "abierto":
                    raise HTTPException(status_code=403, detail="No puede editar el reclamo cuando ya está en análisis o etapas posteriores")
                blocked = submitted_fields & ANALISIS_FIELDS
                if blocked:
                    raise HTTPException(status_code=403, detail=f"No tiene permiso para editar campos de análisis: {', '.join(blocked)}")
            elif role in ("externo", "miembro", "jefe_servicio"):
                if not _es_propietario_cubicador(rec, email):
                    raise HTTPException(status_code=403, detail="Solo puede editar reclamos propios")
                if submitted_fields and _estado_bloquea_edicion_analisis(estado_anterior):
                    raise HTTPException(status_code=403, detail="No puede editar el reclamo luego de enviar a validación")
                blocked = submitted_fields & REGISTRO_FIELDS
                if blocked:
                    raise HTTPException(status_code=403, detail=f"No tiene permiso para editar campos de registro: {', '.join(blocked)}")
            else:
                raise HTTPException(status_code=403, detail="No tiene permiso para editar reclamos")

            # Validaciones de completitud del análisis: aplican al PRIMER envío hacia
            # adelante (desde abierto/en_analisis), sea a en_revision (Flujo A) o a
            # validacion (Flujo B). Cuando un reclamo en revisión es APROBADO por el Jefe
            # de Servicio (en_revision → validacion), NO se re-exige: ya se validó al enviar.
            _primer_envio = (
                estado_anterior in ("abierto", "en_analisis")
                and body.estado in ("en_revision", "validacion")
            )
            if _primer_envio:
                # FASE C — el destino del primer envío lo decide el BACKEND según el
                # flag tiene_revision del área del reclamo, NO la heurística del front:
                #  - área con revisión  → en_revision (paso previo del Jefe de Servicio)
                #  - área sin revisión  → validacion (directo a Calidad)
                # Esto reemplaza el "es Cubicación por el texto" y no se puede falsear
                # desde el cliente.
                cur.execute("SELECT area_id, tipo_origen FROM reclamos WHERE id = %s", (reclamo_id,))
                _arow = cur.fetchone()
                _area_id_rec = _arow[0] if _arow else None
                _tipo_origen_rec = (_arow[1] if _arow else None) or "externo"
                body.estado = "en_revision" if _area_tiene_revision(cur, _area_id_rec, _tipo_origen_rec) else "validacion"
                _destino_label = "revisión" if body.estado == "en_revision" else "validación"
                aplica_efectiva = body.aplica if body.aplica is not None else aplica_actual
                if aplica_efectiva not in ("si", "no"):
                    raise HTTPException(status_code=400, detail=f"Debe marcar si el reclamo aplica o no aplica antes de enviar a {_destino_label}")

                respuesta_efectiva = body.respuesta_texto if body.respuesta_texto is not None else respuesta_actual
                if not (respuesta_efectiva and str(respuesta_efectiva).strip()):
                    raise HTTPException(status_code=400, detail=f"Debe ingresar la explicación/justificación antes de enviar a {_destino_label}")

                cur.execute("SELECT COUNT(*) FROM reclamo_acciones WHERE reclamo_id = %s", (reclamo_id,))
                acciones_count = int(cur.fetchone()[0] or 0)
                if acciones_count <= 0:
                    raise HTTPException(status_code=400, detail=f"Debe registrar al menos una acción antes de enviar a {_destino_label}")

            sets = ["fecha_actualizacion = %s"]
            params = [now]

            def _col_in_sets(col: str) -> bool:
                return any(s.startswith(f"{col} =") or s == f"{col} = NULL" for s in sets)

            updatable = [
                "id_proyecto", "titulo", "descripcion", "prioridad", "tipo_reclamo",
                "categoria_ishikawa",
                "sub_causa", "cod_causa", "responsable", "aplica",
                "detectado_por", "fecha_deteccion", "fecha_analisis",
                "analista", "area_aplica", "explicacion_causa",
                "accion_correctiva", "accion_preventiva", "resolucion", "observaciones",
                "id_calidad", "respuesta_texto", "validacion_resultado",
                "validacion_observaciones", "kilos_mal_fabricados", "tiempo_respuesta",
                "tiempo_respuesta_unidad", "tiempo_respuesta_actualizado_por",
                "tiempo_respuesta_fecha_actualizacion", "asignado_a",
                "cubicador_asignado", "anio_calidad", "numero_calidad",
                "metodo_rca", "cinco_por_que",
            ]
            # Fields where empty string should be stored as NULL
            nullable_fields = {"id_proyecto", "id_calidad", "sub_causa", "cod_causa", "responsable",
                               "detectado_por", "fecha_deteccion", "fecha_analisis",
                               "analista", "area_aplica", "explicacion_causa",
                               "accion_correctiva", "accion_preventiva", "resolucion", "observaciones",
                               "respuesta_texto", "validacion_resultado", "validacion_observaciones",
                               "tiempo_respuesta_unidad", "tiempo_respuesta_actualizado_por",
                               "tiempo_respuesta_fecha_actualizacion", "asignado_a", "cubicador_asignado"}
            ishikawa_fields = {"categoria_ishikawa", "sub_causa", "cod_causa", "explicacion_causa"}
            # Detect rejection early so the updatable loop can skip validation fields
            is_rejection = body.validacion_resultado == "rechazado"
            skip_on_rejection = {"validacion_resultado", "validacion_observaciones"}

            # ¿El usuario está cambiando 'aplica' a "no" en ESTA petición?
            # Solo en ese caso se borra el Ishikawa (acción explícita). Si 'aplica' no
            # vino en el JSON, no se evalúa: nunca se borra como efecto colateral.
            cambia_aplica_a_no = (
                "aplica" in body.__fields_set__
                and body.aplica == "no"
                and aplica_actual != "no"
            )

            # PATCH NO DESTRUCTIVO: solo se escriben los campos que vinieron en el JSON
            # (body.__fields_set__). Un campo ausente NUNCA se toca. Esto evita que el
            # formulario, al reenviar campos vacíos, borre datos que el usuario no editó.
            for field in updatable:
                if field not in body.__fields_set__:
                    continue  # no vino en la petición → no se toca
                val = getattr(body, field)
                if is_rejection and field in skip_on_rejection:
                    continue  # PA.5: estos se ponen a NULL abajo
                if cambia_aplica_a_no and field in ishikawa_fields:
                    continue  # se nulificarán abajo por la transición a "no aplica"
                # anio_calidad solo editable por admin/admin_calidad
                if field == "anio_calidad" and role not in ("admin", "admin_calidad"):
                    continue
                # cinco_por_que es JSONB: serializar lista → string JSON para psycopg
                if field == "cinco_por_que":
                    sets.append(f"{field} = %s::jsonb")
                    params.append(json.dumps(val) if val is not None else None)
                    continue
                sets.append(f"{field} = %s")
                # "" → NULL solo para campos nullable enviados explícitamente vacíos
                params.append(val if (val != "" or field not in nullable_fields) else None)

            # Borrado de Ishikawa solo en la transición explícita a "no aplica"
            if cambia_aplica_a_no:
                for ishikawa_field in ishikawa_fields:
                    if not _col_in_sets(ishikawa_field):
                        sets.append(f"{ishikawa_field} = NULL")

            # Si en esta petición cambió el responsable, recalcular el area_id
            # (el área SIEMPRE se infiere del responsable, nunca se elige aparte).
            # 5L.4: el Ishikawa responde al ÁREA. Si el área CAMBIA de valor, la causa
            # raíz elegida ya no pertenece a la matriz vigente → se limpia (y se avisa).
            # Si el área se mantiene, el Ishikawa NO se toca (antes se perdía siempre).
            if "cubicador_asignado" in body.__fields_set__ or "asignado_a" in body.__fields_set__:
                _nuevo_resp = None
                if "cubicador_asignado" in body.__fields_set__ and body.cubicador_asignado:
                    _nuevo_resp = body.cubicador_asignado
                elif "asignado_a" in body.__fields_set__ and body.asignado_a:
                    _nuevo_resp = body.asignado_a
                _nuevo_area = _area_id_de_usuario(cur, _nuevo_resp) if _nuevo_resp else None
                if _nuevo_area is not None and not _col_in_sets("area_id"):
                    if _nuevo_area != rec.get("area_id"):
                        _area_cambio_por_responsable = True
                    sets.append("area_id = %s")
                    params.append(_nuevo_area)

            # INTERNO: el admin reasigna por ÁREA (no por usuario). Si vino area_id
            # y el reclamo es interno, se actualiza el área y se recalcula el Jefe
            # de Servicio responsable (cubicador_asignado + responsable). area_id no
            # está en 'updatable' a propósito: solo se toca por esta vía controlada.
            if "area_id" in body.__fields_set__ and body.area_id and rec.get("tipo_origen") == "interno":
                if role not in ("admin", "admin_calidad"):
                    raise HTTPException(status_code=403, detail="Solo Calidad puede reasignar el área de un reclamo interno")
                _nueva_area = body.area_id
                if _nueva_area != rec.get("area_id"):
                    _area_cambio_por_responsable = True  # 5L.4: mismo criterio para internos
                _jefe = _jefe_servicio_de_area(cur, _nueva_area)
                if not _col_in_sets("area_id"):
                    sets.append("area_id = %s")
                    params.append(_nueva_area)
                if not _col_in_sets("cubicador_asignado"):
                    sets.append("cubicador_asignado = %s")
                    params.append(_jefe)
                if not _col_in_sets("responsable"):
                    sets.append("responsable = %s")
                    params.append(_jefe)

            # 5L.4: limpiar Ishikawa si el área cambió (por responsable en externos, o
            # por reasignación directa en internos) y el usuario no envió causa nueva.
            if _area_cambio_por_responsable:
                for ishikawa_field in ishikawa_fields:
                    if not _col_in_sets(ishikawa_field):
                        sets.append(f"{ishikawa_field} = NULL")

            # Auto-set respuesta metadata when respuesta_texto is provided
            if body.respuesta_texto and body.respuesta_texto.strip():
                sets.append("respuesta_fecha = %s")
                params.append(now)
                # Admin/admin_calidad: attribute response to cubicador_asignado if set
                if role in ("admin", "admin_calidad"):
                    # Use cubicador_asignado from body (if just assigned) or from existing reclamo
                    cub_email = body.cubicador_asignado
                    if not cub_email:
                        cur.execute("SELECT cubicador_asignado FROM reclamos WHERE id = %s", (reclamo_id,))
                        cub_row = cur.fetchone()
                        cub_email = cub_row[0] if cub_row and cub_row[0] else None
                    sets.append("respuesta_por = %s")
                    params.append(cub_email or email)
                else:
                    sets.append("respuesta_por = %s")
                    params.append(email)

            # Auto-set validacion metadata when validacion_resultado is provided
            # (skip if rechazado — PA.5 will clear these fields below)
            if body.validacion_resultado and body.validacion_resultado.strip() and not is_rejection:
                sets.append("validacion_fecha = %s")
                params.append(now)
                sets.append("validacion_por = %s")
                params.append(email)
                # Auto-transition: validation approved/corrected → estado "cerrado"
                if body.validacion_resultado in ("aprobado", "corregido") and estado_anterior != "cerrado":
                    body.estado = "cerrado"

            # PA.5 — Auto-reopen on rejection: revert to en_analisis so cubicador can fix
            if is_rejection and estado_anterior != "en_analisis":
                body.estado = "en_analisis"
                # Override: store rejection info temporarily for the seguimiento,
                # but clear the fields in DB so cubicador sees a clean slate
                sets.append("validacion_resultado = NULL")
                sets.append("validacion_observaciones = NULL")
                sets.append("validacion_fecha = NULL")
                sets.append("validacion_por = NULL")
                sets.append("fecha_cierre = NULL")

            estado_changed = False
            if body.estado and body.estado != estado_anterior:
                sets.append("estado = %s")
                params.append(body.estado)
                estado_changed = True

                # If closing/validating, set fecha_cierre (unless already set)
                if body.estado in ("cerrado", "rechazado"):
                    if not _col_in_sets("fecha_cierre"):
                        sets.append("fecha_cierre = %s")
                        params.append(now)
                # If reopening, clear fecha_cierre and validacion metadata
                elif estado_anterior in ("cerrado", "rechazado"):
                    if not _col_in_sets("fecha_cierre"):
                        sets.append("fecha_cierre = NULL")
                    if not _col_in_sets("validacion_fecha"):
                        sets.append("validacion_fecha = NULL")
                    if not _col_in_sets("validacion_por"):
                        sets.append("validacion_por = NULL")

            params.append(reclamo_id)
            cur.execute(f"UPDATE reclamos SET {', '.join(sets)} WHERE id = %s", params)

            # Auto-create seguimiento for state change
            if estado_changed:
                comment = f"Estado cambiado: {ESTADO_LABELS.get(estado_anterior, estado_anterior)} → {ESTADO_LABELS.get(body.estado, body.estado)}"
                # Include rejection observations in timeline
                if body.validacion_resultado == "rechazado" and body.validacion_observaciones:
                    comment += f" — Motivo rechazo: {body.validacion_observaciones}"
                # Devolución desde revisión (Jefe de Servicio → cubicador)
                if estado_anterior == "en_revision" and body.estado == "en_analisis" and body.revision_observaciones:
                    comment += f" — Devuelto por revisión: {body.revision_observaciones}"
                # Aprobación desde revisión con explicación del Jefe de Servicio
                if estado_anterior == "en_revision" and body.estado == "validacion" and body.revision_observaciones:
                    comment += f" — Revisión aprobada: {body.revision_observaciones}"
                # Devolución desde validación (Calidad → revisión del Jefe de Servicio)
                if estado_anterior == "validacion" and body.estado == "en_revision" and body.revision_observaciones:
                    comment += f" — Devuelto por Calidad: {body.revision_observaciones}"
                # Aprobación en validación con explicación de Calidad (cierra el reclamo)
                if estado_anterior == "validacion" and body.estado == "cerrado" and body.validacion_observaciones:
                    comment += f" — Validación aprobada: {body.validacion_observaciones}"
                cur.execute("""
                    INSERT INTO reclamo_seguimientos (reclamo_id, usuario, comentario, estado_anterior, estado_nuevo, fecha)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (reclamo_id, email, comment, estado_anterior, body.estado, now))

    _invalidate_reclamo_cache(reclamo_id)
    campos = [s.split(" =")[0] for s in sets if s != "fecha_actualizacion = %s"]
    audit(email, "actualizar_reclamo", f"campos: {', '.join(campos)}", "reclamo", str(reclamo_id))

    # Notificaciones por cambio de estado
    try:
        if estado_changed:
            # Obtener correlativo para el mensaje
            with get_conn() as conn2:
                with conn2.cursor() as cur2:
                    cur2.execute("SELECT correlativo, titulo, creado_por, asignado_a, cubicador_asignado FROM reclamos WHERE id = %s", (reclamo_id,))
                    rinfo = cur2.fetchone()
            corr = rinfo[0] if rinfo else f"#{reclamo_id}"
            titulo_rec = rinfo[1] if rinfo else ""
            creado_por = rinfo[2] if rinfo else ""
            asignado_a_rec = rinfo[3] if rinfo else ""
            cub_asignado = rinfo[4] if rinfo else ""
            extras = [e for e in [creado_por, asignado_a_rec, cub_asignado] if e and e != email]

            estado_label = ESTADO_LABELS.get(body.estado, body.estado)
            msg = f"{corr}: {titulo_rec} — estado → {estado_label}"

            if body.estado == "cerrado":
                crear_notificacion("reclamo_cerrado", reclamo_id, msg, destinatarios_extra=extras)
            elif body.estado == "en_analisis" and is_rejection:
                crear_notificacion("reclamo_reabierto", reclamo_id, msg + " (rechazado)", destinatarios_extra=extras)
            elif body.estado == "en_revision":
                crear_notificacion("enviado_a_revision", reclamo_id, msg, destinatarios_extra=extras)
            elif body.estado == "validacion":
                crear_notificacion("enviado_a_validacion", reclamo_id, msg, destinatarios_extra=extras)
            else:
                crear_notificacion("cambio_estado", reclamo_id, msg, destinatarios_extra=extras)

        # Notificación por asignación
        if body.cubicador_asignado and body.cubicador_asignado != rec.get("cubicador_asignado"):
            with get_conn() as conn3:
                with conn3.cursor() as cur3:
                    cur3.execute("SELECT correlativo, titulo FROM reclamos WHERE id = %s", (reclamo_id,))
                    ri = cur3.fetchone()
            corr2 = ri[0] if ri else f"#{reclamo_id}"
            titulo2 = ri[1] if ri else ""
            crear_notificacion(
                "reclamo_asignado", reclamo_id,
                f"{corr2}: {titulo2} — asignado a {body.cubicador_asignado}",
                destinatarios_extra=[body.cubicador_asignado]
            )
    except Exception:
        pass  # No bloquear actualización por error en notificaciones

    return {"ok": True, "id": reclamo_id, "ishikawa_limpiado_por_area": _area_cambio_por_responsable}


@router.delete("/reclamos/{reclamo_id}")
def eliminar_reclamo(reclamo_id: int, user=Depends(get_current_user)):
    """Eliminar un reclamo y todos sus datos asociados."""
    email = user.get("email", "unknown")
    role = user.get("role", "usc")

    if role not in ("admin", "admin_calidad", "usc"):
        raise HTTPException(status_code=403, detail="No tiene permiso para eliminar reclamos")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, titulo, creado_por, asignado_a FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            titulo = row[1]

            if role == "usc":
                rec = {"creado_por": row[2], "asignado_a": row[3]}
                if not _es_propietario_usc(rec, email):
                    raise HTTPException(status_code=403, detail="Solo puede eliminar reclamos propios")

            cur.execute("DELETE FROM reclamo_imagenes WHERE reclamo_id = %s", (reclamo_id,))
            cur.execute("DELETE FROM reclamo_acciones WHERE reclamo_id = %s", (reclamo_id,))
            cur.execute("DELETE FROM reclamo_seguimientos WHERE reclamo_id = %s", (reclamo_id,))
            cur.execute("DELETE FROM reclamos WHERE id = %s", (reclamo_id,))

            _invalidate_reclamo_cache(reclamo_id)
    audit(email, "eliminar_reclamo", titulo, "reclamo", str(reclamo_id))
    return {"ok": True, "id": reclamo_id}


# ========================= SEGUIMIENTOS =========================

@router.post("/reclamos/{reclamo_id}/seguimientos")
def crear_seguimiento(reclamo_id: int, body: SeguimientoCreate, user=Depends(get_current_user)):
    """Agregar un seguimiento (comentario) a un reclamo. Opcionalmente cambia estado."""
    email = user.get("email", "unknown")
    role = user.get("role", "usc")
    now = datetime.now(timezone.utc).isoformat()

    if role == "cliente":
        raise HTTPException(status_code=403, detail="No tiene permiso para agregar seguimientos")

    if body.estado_nuevo and body.estado_nuevo not in ESTADOS_RECLAMO:
        raise HTTPException(status_code=400, detail=f"Estado inválido. Válidos: {list(ESTADOS_RECLAMO)}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, estado FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            estado_anterior = row[1]

            estado_nuevo = body.estado_nuevo
            if estado_nuevo and estado_nuevo == estado_anterior:
                estado_nuevo = None  # no real change

            cur.execute("""
                INSERT INTO reclamo_seguimientos (reclamo_id, usuario, comentario, estado_anterior, estado_nuevo, fecha)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (reclamo_id, email, body.comentario,
                  estado_anterior if estado_nuevo else None,
                  estado_nuevo, now))
            seg_id = cur.fetchone()[0]

            # Update reclamo if state changed
            if estado_nuevo:
                sets = ["estado = %s", "fecha_actualizacion = %s"]
                params = [estado_nuevo, now]
                if estado_nuevo in ("cerrado", "rechazado"):
                    sets.append("fecha_cierre = %s")
                    params.append(now)
                elif estado_anterior in ("cerrado", "rechazado"):
                    sets.append("fecha_cierre = NULL")
                params.append(reclamo_id)
                cur.execute(f"UPDATE reclamos SET {', '.join(sets)} WHERE id = %s", params)
            else:
                cur.execute("UPDATE reclamos SET fecha_actualizacion = %s WHERE id = %s", (now, reclamo_id))

    _invalidate_reclamo_cache(reclamo_id)
    audit(email, "seguimiento_reclamo", body.comentario[:100] if body.comentario else "", "reclamo", str(reclamo_id))
    return {"ok": True, "id": seg_id}


# ========================= ACCIONES =========================

@router.post("/reclamos/{reclamo_id}/acciones")
def crear_accion(reclamo_id: int, body: AccionCreate, user=Depends(get_current_user)):
    """Agregar una acción (inmediata/correctiva/preventiva) a un reclamo."""
    email = user.get("email", "unknown")
    role = user.get("role", "usc")
    now = datetime.now(timezone.utc).isoformat()

    if role not in ("admin", "admin_calidad", "externo", "miembro", "jefe_servicio"):
        raise HTTPException(status_code=403, detail="No tiene permiso para agregar acciones")

    if body.tipo not in TIPOS_ACCION:
        raise HTTPException(status_code=400, detail=f"Tipo inválido. Válidos: {list(TIPOS_ACCION)}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, estado, cubicador_asignado, respuesta_por FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")

            estado_reclamo = row[1]
            if role not in ("admin", "admin_calidad") and _estado_bloquea_edicion_analisis(estado_reclamo):
                raise HTTPException(status_code=403, detail="No se pueden editar acciones luego de enviar a validación")

            if role in ("externo", "miembro", "jefe_servicio"):
                rec = {"cubicador_asignado": row[2], "respuesta_por": row[3]}
                if not _es_propietario_cubicador(rec, email):
                    raise HTTPException(status_code=403, detail="Solo puede agregar acciones en reclamos propios")

            cur.execute("""
                INSERT INTO reclamo_acciones (reclamo_id, tipo, descripcion, responsable, fecha_prevista, creado_por, fecha_creacion)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (reclamo_id, body.tipo, body.descripcion, body.responsable, body.fecha_prevista, email, now))
            accion_id = cur.fetchone()[0]

            cur.execute("UPDATE reclamos SET fecha_actualizacion = %s WHERE id = %s", (now, reclamo_id))

            _invalidate_reclamo_cache(reclamo_id)
    audit(email, "crear_accion_reclamo", f"{body.tipo}: {body.descripcion[:80]}", "reclamo", str(reclamo_id))
    return {"ok": True, "id": accion_id}


@router.patch("/reclamos/{reclamo_id}/acciones/{accion_id}")
def actualizar_accion(reclamo_id: int, accion_id: int, body: AccionUpdate, user=Depends(get_current_user)):
    """Actualizar una acción de un reclamo."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM reclamo_acciones WHERE id = %s AND reclamo_id = %s", (accion_id, reclamo_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Acción no encontrada")

            sets = []
            params = []
            for field in ["tipo", "descripcion", "responsable", "fecha_prevista", "estado", "fecha_completada"]:
                val = getattr(body, field)
                if val is not None:
                    sets.append(f"{field} = %s")
                    params.append(val)

            if not sets:
                return {"ok": True, "id": accion_id}

            params.append(accion_id)
            cur.execute(f"UPDATE reclamo_acciones SET {', '.join(sets)} WHERE id = %s", params)
            cur.execute("UPDATE reclamos SET fecha_actualizacion = %s WHERE id = %s", (now, reclamo_id))

            _invalidate_reclamo_cache(reclamo_id)
    return {"ok": True, "id": accion_id}


@router.delete("/reclamos/{reclamo_id}/acciones/{accion_id}")
def eliminar_accion(reclamo_id: int, accion_id: int, user=Depends(get_current_user)):
    """Eliminar una acción de un reclamo."""
    email = user.get("email", "unknown")
    role = user.get("role", "usc")

    if role not in ("admin", "admin_calidad", "externo", "usc", "miembro", "jefe_servicio"):
        raise HTTPException(status_code=403, detail="No tiene permiso para eliminar acciones")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT estado, cubicador_asignado, respuesta_por, creado_por, asignado_a FROM reclamos WHERE id = %s",
                (reclamo_id,),
            )
            rec_row = cur.fetchone()
            if not rec_row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")

            if role not in ("admin", "admin_calidad") and _estado_bloquea_edicion_analisis(rec_row[0]):
                raise HTTPException(status_code=403, detail="No se pueden editar acciones luego de enviar a validación")

            rec = {
                "cubicador_asignado": rec_row[1],
                "respuesta_por": rec_row[2],
                "creado_por": rec_row[3],
                "asignado_a": rec_row[4],
            }
            if role in ("externo", "miembro", "jefe_servicio") and not _es_propietario_cubicador(rec, email):
                raise HTTPException(status_code=403, detail="Solo puede eliminar acciones en reclamos propios")
            if role == "usc" and not _es_propietario_usc(rec, email):
                raise HTTPException(status_code=403, detail="Solo puede eliminar acciones en reclamos propios")

            cur.execute("DELETE FROM reclamo_acciones WHERE id = %s AND reclamo_id = %s", (accion_id, reclamo_id))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Acción no encontrada")
    _invalidate_reclamo_cache(reclamo_id)
    audit(email, "eliminar_accion_reclamo", str(accion_id), "reclamo", str(reclamo_id))
    return {"ok": True, "id": accion_id}


# ========================= IMAGENES =========================

@router.post("/reclamos/{reclamo_id}/imagenes")
async def subir_imagen(
    reclamo_id: int,
    file: UploadFile = File(...),
    descripcion: Optional[str] = Form(None),
    tipo: Optional[str] = Form("antecedente"),
    user=Depends(get_current_user),
):
    """Subir una imagen/evidencia a un reclamo aceptando nomenclatura legacy y canónica."""
    email = user.get("email", "unknown")
    role = user.get("role", "usc")
    now = datetime.now(timezone.utc).isoformat()
    tipo_map = {
        "antecedente": "ImagenesRegistro",
        "respuesta": "ImagenesAnalisis",
        "ImagenesRegistro": "ImagenesRegistro",
        "ImagenesAnalisis": "ImagenesAnalisis",
    }
    img_tipo = tipo_map.get(tipo or "antecedente", "ImagenesRegistro")

    # Permisos por tipo de imagen
    if role == "cliente":
        raise HTTPException(status_code=403, detail="No tiene permiso para subir imágenes")
    if img_tipo == "ImagenesRegistro" and role in ("externo", "miembro", "jefe_servicio"):
        raise HTTPException(status_code=403, detail="Solo USC o admin pueden subir imágenes de registro")
    if img_tipo == "ImagenesAnalisis" and role == "usc":
        raise HTTPException(status_code=403, detail="Solo cubicador, externo, miembro o admin pueden subir imágenes de análisis")

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail=f"Tipo de archivo no permitido. Permitidos: {ALLOWED_IMAGE_TYPES}")

    data = await file.read()
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail=f"Imagen demasiado grande. Máximo: {MAX_IMAGE_SIZE // (1024*1024)} MB")

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM reclamos WHERE id = %s", (reclamo_id,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="Reclamo no encontrado")

                # Detectar nombre de columna fecha (fecha vs fecha_subida)
                img_columns = _get_table_columns(cur, "reclamo_imagenes")
                fecha_col = "fecha" if "fecha" in img_columns else "fecha_subida"

                if not storage.is_configured():
                    raise HTTPException(status_code=503, detail="Storage R2 no configurado")
                subcarpeta = "analisis" if img_tipo == "ImagenesAnalisis" else "registro"
                storage_key = storage.build_key(
                    "reclamos", subcarpeta, str(reclamo_id), filename=file.filename
                )
                storage.upload_file(storage_key, data, file.content_type or "application/octet-stream")

                cur.execute(f"""
                    INSERT INTO reclamo_imagenes (reclamo_id, filename, content_type, storage_key, descripcion, subido_por, {fecha_col}, tipo)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (reclamo_id, file.filename, file.content_type, storage_key, descripcion, email, now, img_tipo))
                img_id = cur.fetchone()[0]

                cur.execute("UPDATE reclamos SET fecha_actualizacion = %s WHERE id = %s", (now, reclamo_id))

                _invalidate_reclamo_cache(reclamo_id)
        audit(email, "subir_imagen_reclamo", f"{file.filename} ({img_tipo})", "reclamo", str(reclamo_id))
        return {"ok": True, "id": img_id, "filename": file.filename, "tipo": img_tipo}
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error al guardar imagen: {exc}")


@router.get("/reclamos/{reclamo_id}/imagenes/{imagen_id}")
def ver_imagen(reclamo_id: int, imagen_id: int, user=Depends(get_current_user)):
    """
    Servir una imagen inline. Requiere autenticación y permiso sobre el reclamo
    (cierra H1: antes era público; cierra IDOR: valida ownership).
    Sirve desde R2 (storage_key) si existe, o desde BYTEA (data) para imágenes
    aún no migradas.
    """
    with get_conn() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            # 1) Validar permiso de ver ESTE reclamo
            cur.execute("""
                SELECT creado_por, asignado_a, cubicador_asignado, respuesta_por
                FROM reclamos WHERE id = %s
            """, (reclamo_id,))
            rec = cur.fetchone()
            if not rec:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            if not _puede_ver_reclamo(rec, user, cur):
                raise HTTPException(status_code=403, detail="No tiene permiso para ver esta imagen")

            # 2) Cargar metadata de la imagen
            cur.execute("""
                SELECT content_type, filename, storage_key
                FROM reclamo_imagenes
                WHERE id = %s AND reclamo_id = %s
            """, (imagen_id, reclamo_id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Imagen no encontrada")

    content_type = row.get("content_type") or "application/octet-stream"
    filename = row.get("filename") or "imagen"
    storage_key = row.get("storage_key")

    if not storage_key or not storage.is_configured():
        raise HTTPException(status_code=404, detail="Imagen sin contenido")

    url = storage.generate_presigned_url(storage_key, expires=3600, content_type=content_type)
    return RedirectResponse(url, status_code=307)


@router.delete("/reclamos/{reclamo_id}/imagenes/{imagen_id}")
def eliminar_imagen(reclamo_id: int, imagen_id: int, user=Depends(get_current_user)):
    """Eliminar una imagen de un reclamo (también del storage R2). Valida ownership (cierra H3)."""
    email = user.get("email", "unknown")
    role = user.get("role", "")

    if role == "cliente":
        raise HTTPException(status_code=403, detail="No tiene permiso para eliminar imágenes")

    storage_key = None
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Validar ownership del reclamo para cubicador/externo/usc
            if role not in ("admin", "admin_calidad"):
                cur.execute(
                    "SELECT cubicador_asignado, respuesta_por, creado_por, asignado_a FROM reclamos WHERE id = %s",
                    (reclamo_id,),
                )
                rec_row = cur.fetchone()
                if not rec_row:
                    raise HTTPException(status_code=404, detail="Reclamo no encontrado")
                rec = {
                    "cubicador_asignado": rec_row[0],
                    "respuesta_por": rec_row[1],
                    "creado_por": rec_row[2],
                    "asignado_a": rec_row[3],
                }
                if role in ("externo", "miembro", "jefe_servicio") and not _es_propietario_cubicador(rec, email):
                    raise HTTPException(status_code=403, detail="Solo puede eliminar imágenes en reclamos propios")
                if role == "usc" and not _es_propietario_usc(rec, email):
                    raise HTTPException(status_code=403, detail="Solo puede eliminar imágenes en reclamos propios")

            cur.execute(
                "SELECT storage_key FROM reclamo_imagenes WHERE id = %s AND reclamo_id = %s",
                (imagen_id, reclamo_id),
            )
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Imagen no encontrada")
            storage_key = r[0]

            cur.execute("DELETE FROM reclamo_imagenes WHERE id = %s AND reclamo_id = %s", (imagen_id, reclamo_id))

    if storage_key and storage.is_configured():
        try:
            storage.delete_file(storage_key)
        except Exception:
            pass
    _invalidate_reclamo_cache(reclamo_id)
    audit(email, "eliminar_imagen_reclamo", str(imagen_id), "reclamo", str(reclamo_id))
    return {"ok": True, "id": imagen_id}


# ========================= PDF EXPORT =========================

ESTADO_COLORS_RGB = {
    "abierto": (255, 152, 0),
    "en_analisis": (25, 118, 210),
    "en_revision": (2, 136, 209),
    "validacion": (123, 31, 162),
    "cerrado": (56, 142, 60),
    "rechazado": (198, 40, 40),
}

class _ReclamoPDF:
    """Genera un PDF profesional de informe de reclamo usando fpdf2."""

    def __init__(self, rec, acciones, seguimientos, imagenes_registro, imagenes_analisis):
        import io
        from fpdf import FPDF

        self.rec = rec
        self.acciones = acciones
        self.seguimientos = seguimientos
        self.imagenes_registro = imagenes_registro
        self.imagenes_analisis = imagenes_analisis

        self.pdf = FPDF(orientation="P", unit="mm", format="A4")
        self.pdf.set_auto_page_break(auto=True, margin=20)
        self.pdf.add_page()
        self.pdf.set_margins(15, 15, 15)
        self._w_usable = 180  # 210 - 15 - 15

        # Build correlativo
        corr_cal = ""
        if rec.get("anio_calidad") and rec.get("numero_calidad"):
            corr_cal = f"{rec['anio_calidad']}-{str(rec['numero_calidad']).zfill(3)}"
        self.correlativo = corr_cal or rec.get("id_calidad") or rec.get("correlativo") or f"#{rec['id']}"

    @staticmethod
    def _s(text):
        """Sanitize text for Latin-1 PDF output (built-in fonts)."""
        if text is None:
            return ""
        text = str(text)
        text = text.replace("\u2192", "->")   # →
        text = text.replace("\u2190", "<-")   # ←
        text = text.replace("\u2014", "-")    # —
        text = text.replace("\u2013", "-")    # –
        text = text.replace("\u2018", "'")    # '
        text = text.replace("\u2019", "'")    # '
        text = text.replace("\u201c", '"')    # "
        text = text.replace("\u201d", '"')    # "
        text = text.replace("\u2026", "...")  # …
        return text.encode("latin-1", "replace").decode("latin-1")

    def build(self) -> bytes:
        import io
        self._header_section()
        self._antecedentes_section()
        self._imagenes_section("Imágenes de Antecedentes", self.imagenes_registro, (255, 235, 238))
        self._analisis_section()
        self._imagenes_section("Imágenes de Análisis", self.imagenes_analisis, (227, 242, 253))
        self._acciones_section()
        self._validacion_section()
        self._seguimientos_section()
        self._footer()
        buf = io.BytesIO()
        self.pdf.output(buf)
        buf.seek(0)
        return buf.read()

    # ── Header ──
    def _header_section(self):
        pdf = self.pdf
        rec = self.rec
        estado = rec.get("estado") or "abierto"
        rgb = ESTADO_COLORS_RGB.get(estado, (100, 100, 100))

        pdf.set_font("Helvetica", "B", 16)
        pdf.set_text_color(26, 35, 126)
        pdf.cell(0, 8, self._s(f"Informe de Reclamo {self.correlativo}"), new_x="LMARGIN", new_y="NEXT")

        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(0, 5, self._s(rec.get("titulo") or ""), new_x="LMARGIN", new_y="NEXT")

        # Estado badge + fecha informe
        pdf.ln(2)
        y_badge = pdf.get_y()
        # Badge
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(*rgb)
        pdf.set_text_color(255, 255, 255)
        estado_label = self._s(ESTADO_LABELS.get(estado, estado))
        badge_w = pdf.get_string_width(estado_label) + 8
        pdf.cell(badge_w, 6, estado_label, fill=True)
        # Text after badge — position explicitly past the badge
        text_x = 15 + badge_w + 6
        pdf.set_xy(text_x, y_badge)
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(100, 100, 100)
        aplica_label = self._s(APLICA_LABELS.get(rec.get("aplica"), ""))
        aplica_part = f"{aplica_label}      " if aplica_label else ""
        fecha_informe = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        pdf.cell(0, 6, f"{aplica_part}Generado: {fecha_informe}", new_x="LMARGIN", new_y="NEXT")

        # Separator line
        pdf.ln(2)
        pdf.set_draw_color(26, 35, 126)
        pdf.set_line_width(0.5)
        pdf.line(15, pdf.get_y(), 195, pdf.get_y())
        pdf.ln(4)

    # ── Section title helper ──
    def _section_title(self, title, bg_rgb, text_rgb=(255, 255, 255)):
        pdf = self.pdf
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_fill_color(*bg_rgb)
        pdf.set_text_color(*text_rgb)
        pdf.cell(0, 7, self._s(f"  {title}"), fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(34, 34, 34)
        pdf.ln(2)

    # ── Field-value row helper ──
    def _field_row(self, label, value, bold_value=False):
        if not value:
            return
        pdf = self.pdf
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(85, 85, 85)
        pdf.cell(45, 5, self._s(label), new_x="END")
        pdf.set_font("Helvetica", "B" if bold_value else "", 9)
        pdf.set_text_color(34, 34, 34)
        pdf.multi_cell(self._w_usable - 45, 5, self._s(value), new_x="LMARGIN", new_y="NEXT")

    # ── Colored text box helper (description / respuesta) ──
    def _text_box(self, label, text, fill_rgb, border_rgb):
        pdf = self.pdf
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(85, 85, 85)
        pdf.cell(0, 5, self._s(label), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
        # Draw filled rounded rect with border
        x = pdf.get_x()
        y = pdf.get_y()
        pdf.set_fill_color(*fill_rgb)
        pdf.set_draw_color(*border_rgb)
        pdf.set_line_width(0.3)
        # Calculate text height first
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(34, 34, 34)
        inner_w = self._w_usable - 12  # padding 6mm each side
        # Measure height with a dry run
        n_lines = pdf.multi_cell(inner_w, 4.5, self._s(text), dry_run=True, output="LINES")
        text_h = len(n_lines) * 4.5 + 8  # 4mm padding top + 4mm bottom
        pdf.rect(x, y, self._w_usable, text_h, style="DF")
        pdf.set_xy(x + 6, y + 4)
        pdf.multi_cell(inner_w, 4.5, self._s(text), new_x="LMARGIN", new_y="NEXT")
        pdf.set_y(y + text_h + 1)

    # ── Antecedentes ──
    def _antecedentes_section(self):
        rec = self.rec
        self._section_title("Antecedentes del Reclamo", (198, 40, 40))

        tipo_label = {"error": "Error", "faltante": "Faltante", "atraso": "Atraso"}.get(
            rec.get("tipo_reclamo"), rec.get("tipo_reclamo") or "-"
        )
        self._field_row("Proyecto / Obra:", rec.get("nombre_proyecto"))
        self._field_row("Título:", rec.get("titulo"))
        self._field_row("Tipo:", tipo_label)
        self._field_row("Detectado por:", rec.get("detectado_por"))
        self._field_row("Fecha detección:", _as_text(rec.get("fecha_deteccion")))
        self._field_row("Creado por:", rec.get("creado_por"))
        self._field_row("Fecha creación:", _as_text(rec.get("fecha_creacion")))
        self._field_row("Cub. Responsable:", rec.get("responsable"))
        self._field_row("USC Responsable:", rec.get("asignado_a"))
        if rec.get("kilos_mal_fabricados") is not None:
            self._field_row("Kilos mal fabricados:", f"{rec['kilos_mal_fabricados']} kg", bold_value=True)

        if rec.get("descripcion"):
            self._text_box("Descripcion:", rec["descripcion"], (255, 235, 238), (255, 205, 210))

        self.pdf.ln(4)

    @staticmethod
    def _img_rendered_h(raw: bytes, w_mm: float, max_h_mm: float) -> float:
        """Calcula la altura en mm que ocupará la imagen al renderizarse con ancho w_mm."""
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(raw))
            px_w, px_h = img.size
            if px_w == 0:
                return max_h_mm
            h = w_mm * px_h / px_w
            return min(h, max_h_mm)
        except Exception:
            return max_h_mm

    # ── Imagenes helper (2 per row grid) ──
    def _imagenes_section(self, title, imagenes, bg_rgb):
        if not imagenes:
            return
        import io
        pdf = self.pdf
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(85, 85, 85)
        pdf.cell(0, 5, self._s(title), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)

        img_w = 85       # width per image (2 fit in 180mm usable)
        img_max_h = 65   # max height per image slot
        gap = 10         # horizontal gap between columns
        col = 0          # current column (0 or 1)
        row_y = pdf.get_y()
        row_actual_h = 0  # altura real de la fila actual (max de ambas columnas)

        for img_data in imagenes:
            raw = img_data.get("raw_bytes")
            fname = img_data.get("filename", "imagen")
            if not raw:
                continue

            img_h = self._img_rendered_h(raw, img_w, img_max_h)

            # Salto de página si no cabe la imagen
            if row_y + img_h > 270:
                if col > 0:
                    # cerrar fila parcial antes de saltar
                    row_y += row_actual_h + 4
                pdf.add_page()
                row_y = pdf.get_y()
                col = 0
                row_actual_h = 0
                img_h = self._img_rendered_h(raw, img_w, img_max_h)

            row_actual_h = max(row_actual_h, img_h)
            x = 15 + col * (img_w + gap)
            try:
                img_buf = io.BytesIO(raw)
                pdf.image(img_buf, x=x, y=row_y, w=img_w, h=img_h)
            except Exception:
                pdf.set_xy(x, row_y)
                pdf.set_font("Helvetica", "I", 8)
                pdf.cell(img_w, 4, self._s(f"[No se pudo incluir: {fname}]"))

            col += 1
            if col >= 2:
                col = 0
                row_y += row_actual_h + 4
                row_actual_h = 0

        # Avanzar cursor al final de la última fila
        pdf.set_y(row_y + row_actual_h + 4)
        pdf.ln(2)

    # ── Análisis ──
    def _analisis_section(self):
        rec = self.rec
        self._section_title("Análisis y Respuesta", (21, 101, 192))

        cat_label = ISHIKAWA_LABELS.get(rec.get("categoria_ishikawa"), rec.get("categoria_ishikawa"))
        tiene_analisis = any([
            cat_label, rec.get("sub_causa"), rec.get("cod_causa"),
            rec.get("area_aplica"), rec.get("respuesta_por"), rec.get("respuesta_texto"),
        ])

        if not tiene_analisis:
            self.pdf.set_font("Helvetica", "I", 9)
            self.pdf.set_text_color(150, 150, 150)
            self.pdf.cell(0, 5, "Sin analisis registrado", new_x="LMARGIN", new_y="NEXT")
            self.pdf.set_text_color(34, 34, 34)
        else:
            self._field_row("Causa Ishikawa:", cat_label)
            self._field_row("Sub-causa:", rec.get("sub_causa"))
            self._field_row("Código causa:", rec.get("cod_causa"))
            self._field_row("Área que aplica:", rec.get("area_aplica"))
            self._field_row("Respondido por:", rec.get("respuesta_por"))
            self._field_row("Fecha respuesta:", _as_text(rec.get("respuesta_fecha")))

            if rec.get("respuesta_texto"):
                self._text_box("Respuesta del cubicador:", rec["respuesta_texto"], (227, 242, 253), (187, 222, 251))

        self.pdf.ln(4)

    # ── Acciones ──
    def _acciones_section(self):
        if not self.acciones:
            return
        self._section_title("Acciones Correctivas / Preventivas", (230, 81, 0))

        pdf = self.pdf
        col_widths = [25, 65, 30, 22, 22, 16]
        headers = ["Tipo", "Descripción", "Responsable", "F.Prevista", "F.Complet.", "Estado"]
        row_h = 4.5

        # Header row
        pdf.set_font("Helvetica", "B", 7)
        pdf.set_fill_color(245, 245, 245)
        pdf.set_text_color(34, 34, 34)
        for i, h in enumerate(headers):
            pdf.cell(col_widths[i], 5, h, border=1, fill=True, new_x="END")
        pdf.ln()

        # Data rows — height expands to fit wrapped text
        pdf.set_font("Helvetica", "", 7)
        pdf.set_text_color(34, 34, 34)
        for a in self.acciones:
            vals = [
                self._s(a.get("tipo_label") or "-"),
                self._s(a.get("descripcion") or "-"),
                self._s(a.get("responsable") or "-"),
                self._s(a.get("fecha_prevista") or "-"),
                self._s(a.get("fecha_completada") or "-"),
                self._s(a.get("estado_label") or "-"),
            ]
            # Measure max height across all cells
            cell_h = row_h
            for i, v in enumerate(vals):
                lines = pdf.multi_cell(col_widths[i], row_h, v, dry_run=True, output="LINES")
                cell_h = max(cell_h, len(lines) * row_h)

            # Salto de página si no cabe la fila completa
            if pdf.get_y() + cell_h > 272:
                pdf.add_page()

            x0 = pdf.get_x()
            y0 = pdf.get_y()
            for i, v in enumerate(vals):
                pdf.set_xy(x0, y0)
                pdf.multi_cell(col_widths[i], cell_h, v, border=1, new_x="END", new_y="TOP", max_line_height=row_h)
                x0 += col_widths[i]
            pdf.set_xy(15, y0 + cell_h)

        pdf.ln(4)

    # ── Validación ──
    def _validacion_section(self):
        rec = self.rec
        self._section_title("Validación", (46, 125, 50))

        if rec.get("validacion_resultado"):
            val_label = {"aprobado": "Aprobado", "rechazado": "Rechazado", "corregido": "Corregido"}.get(
                rec["validacion_resultado"], rec["validacion_resultado"]
            )
            self._field_row("Resultado:", val_label, bold_value=True)
            self._field_row("Validado por:", rec.get("validacion_por"))
            self._field_row("Fecha validación:", _as_text(rec.get("validacion_fecha")))
            self._field_row("Observaciones:", rec.get("validacion_observaciones"))
        else:
            self.pdf.set_font("Helvetica", "I", 9)
            self.pdf.set_text_color(150, 150, 150)
            self.pdf.cell(0, 5, "Pendiente de validacion", new_x="LMARGIN", new_y="NEXT")
            self.pdf.set_text_color(34, 34, 34)

        self.pdf.ln(4)

    # ── Seguimientos ──
    def _seguimientos_section(self):
        if not self.seguimientos:
            return
        self._section_title("Seguimientos", (66, 66, 66))

        pdf = self.pdf
        for s in self.seguimientos:
            fecha = self._s(s.get("fecha") or "-")
            usuario = self._s(s.get("usuario") or "Sistema")
            estado_change = ""
            if s.get("estado_anterior") and s.get("estado_nuevo"):
                estado_change = self._s(f" cambio estado: {s['estado_anterior']} -> {s['estado_nuevo']}")

            pdf.set_font("Helvetica", "", 7)
            pdf.set_text_color(136, 136, 136)
            pdf.cell(30, 4, fecha, new_x="END")
            pdf.set_font("Helvetica", "B", 7)
            pdf.set_text_color(51, 51, 51)
            pdf.cell(35, 4, usuario, new_x="END")
            if estado_change:
                pdf.set_font("Helvetica", "I", 7)
                pdf.set_text_color(136, 136, 136)
                pdf.cell(0, 4, estado_change, new_x="LMARGIN", new_y="NEXT")
            else:
                pdf.ln()

            if s.get("comentario"):
                pdf.set_font("Helvetica", "", 7)
                pdf.set_text_color(34, 34, 34)
                pdf.multi_cell(self._w_usable, 3.5, self._s(s["comentario"]), new_x="LMARGIN", new_y="NEXT")

            pdf.set_draw_color(224, 224, 224)
            pdf.line(15, pdf.get_y(), 195, pdf.get_y())
            pdf.ln(1)

    # ── Footer ──
    def _footer(self):
        pdf = self.pdf
        pdf.ln(6)
        pdf.set_draw_color(200, 200, 200)
        pdf.line(15, pdf.get_y(), 195, pdf.get_y())
        pdf.ln(2)
        pdf.set_font("Helvetica", "I", 7)
        pdf.set_text_color(150, 150, 150)
        fecha = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        pdf.cell(0, 4, self._s(f"ArmaHub - Informe generado el {fecha} - {self.correlativo}"), align="C")


def _generar_pdf_reclamo(reclamo_id: int):
    """Genera el PDF del informe de un reclamo. Reutilizable por el endpoint de
    descarga y por el envío de informe por correo (5B). Devuelve
    (pdf_bytes, filename, rec). Lanza HTTPException 404 si el reclamo no existe.
    NO valida permisos: el caller (endpoint) es responsable de eso."""
    with get_conn() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("""
                SELECT r.*, COALESCE(p.nombre_proyecto, r.id_proyecto, 'Obra eliminada') AS nombre_proyecto
                FROM reclamos r
                LEFT JOIN proyectos p ON r.id_proyecto = p.id_proyecto
                WHERE r.id = %s
            """, (reclamo_id,))
            rec = cur.fetchone()
            if not rec:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")

            # Seguimientos
            cur.execute("""
                SELECT id, usuario, comentario, estado_anterior, estado_nuevo, fecha
                FROM reclamo_seguimientos WHERE reclamo_id = %s ORDER BY fecha ASC, id ASC
            """, (reclamo_id,))
            seguimientos = [
                {**s, "fecha": _as_text(s.get("fecha"))}
                for s in cur.fetchall()
            ]

            # Acciones
            cur.execute("""
                SELECT id, tipo, descripcion, responsable, fecha_prevista, fecha_completada, estado
                FROM reclamo_acciones WHERE reclamo_id = %s ORDER BY id ASC
            """, (reclamo_id,))
            acciones = [
                {
                    "tipo_label": TIPO_ACCION_LABELS.get(a.get("tipo"), a.get("tipo") or "—"),
                    "descripcion": a.get("descripcion"),
                    "responsable": a.get("responsable"),
                    "fecha_prevista": _as_text(a.get("fecha_prevista")),
                    "fecha_completada": _as_text(a.get("fecha_completada")),
                    "estado_label": "Completada" if a.get("estado") == "completada" else "En proceso" if a.get("estado") == "en_proceso" else "—",
                }
                for a in cur.fetchall()
            ]

            # Imágenes → raw bytes para fpdf2 (desde R2)
            cur.execute("""
                SELECT id, filename, content_type, storage_key, tipo
                FROM reclamo_imagenes WHERE reclamo_id = %s ORDER BY id ASC
            """, (reclamo_id,))
            imagenes_registro = []
            imagenes_analisis = []
            for img in cur.fetchall():
                ct = img.get("content_type") or ""
                if not ct.startswith("image/"):
                    continue
                sk = img.get("storage_key")
                raw = None
                if sk and storage.is_configured():
                    try:
                        raw = storage.download_file(sk)
                    except Exception:
                        raw = None
                if raw is None:
                    continue  # imagen sin storage_key o error al descargar, se omite del PDF
                entry = {"raw_bytes": raw, "filename": img.get("filename")}
                tipo = img.get("tipo") or "ImagenesRegistro"
                if tipo == "ImagenesAnalisis":
                    imagenes_analisis.append(entry)
                else:
                    imagenes_registro.append(entry)

    # Generate PDF
    gen = _ReclamoPDF(rec, acciones, seguimientos, imagenes_registro, imagenes_analisis)
    pdf_bytes = gen.build()

    corr_cal = ""
    if rec.get("anio_calidad") and rec.get("numero_calidad"):
        corr_cal = f"{rec['anio_calidad']}-{str(rec['numero_calidad']).zfill(3)}"
    correlativo = corr_cal or rec.get("id_calidad") or rec.get("correlativo") or f"#{rec['id']}"
    filename = f"Reclamo_{correlativo.replace('#', '').replace('/', '-')}.pdf"

    return pdf_bytes, filename, rec


@router.get("/reclamos/{reclamo_id}/pdf")
def exportar_reclamo_pdf(reclamo_id: int, user=Depends(get_current_user)):
    """Generar PDF del informe de reclamo (descarga inline)."""
    role = user.get("role")
    email = user.get("email", "")
    if role not in ("admin", "admin_calidad", "usc", "miembro", "jefe_servicio"):
        raise HTTPException(status_code=403, detail="Sin permisos para generar PDF")

    pdf_bytes, filename, rec = _generar_pdf_reclamo(reclamo_id)

    # Ownership para roles de scope restringido
    if role in ("externo", "miembro", "jefe_servicio") and not _es_propietario_cubicador(rec, email):
        raise HTTPException(status_code=403, detail="Solo puedes exportar tus propios reclamos")
    if role == "usc" and not _es_propietario_usc(rec, email):
        raise HTTPException(status_code=403, detail="Solo puedes exportar tus propios reclamos")

    audit(email, "exportar_pdf_reclamo", str(reclamo_id), "reclamo", str(reclamo_id))
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# ========================= ENVÍO DE INFORME POR CORREO (5B) =========================

def _render_template_vars(texto: str, rec: dict) -> str:
    """Reemplaza variables {{clave}} en asunto/cuerpo de plantilla con datos del reclamo."""
    if not texto:
        return ""
    corr_cal = ""
    if rec.get("anio_calidad") and rec.get("numero_calidad"):
        corr_cal = f"{rec['anio_calidad']}-{str(rec['numero_calidad']).zfill(3)}"
    correlativo = corr_cal or rec.get("id_calidad") or rec.get("correlativo") or f"#{rec.get('id')}"
    valores = {
        "correlativo": correlativo,
        "titulo": rec.get("titulo") or "",
        "proyecto": rec.get("nombre_proyecto") or "",
        "cliente": rec.get("nombre_proyecto") or "",
        "estado": rec.get("estado") or "",
        "responsable": rec.get("responsable") or rec.get("cubicador_asignado") or "",
        "fecha_cierre": _as_text(rec.get("fecha_actualizacion")) or "",
    }
    out = texto
    for k, v in valores.items():
        out = out.replace("{{" + k + "}}", str(v))
    return out


class EnviarInformeIn(BaseModel):
    destinatarios: List[str]
    asunto: Optional[str] = None
    cuerpo: Optional[str] = None
    template_clave: Optional[str] = "informe_validado"


@router.get("/reclamos/{reclamo_id}/involucrados")
def get_involucrados_reclamo(reclamo_id: int, user=Depends(get_current_user)):
    """Correos sugeridos para enviar el informe: usuarios del proyecto del reclamo
    (proyecto_usuarios). Para pre-cargar el modal de envío (todos tildados)."""
    if user.get("role") not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo Calidad puede consultar involucrados")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            id_proyecto = row[0]
            if not id_proyecto:
                return {"data": []}
            cur.execute("""
                SELECT u.email,
                       COALESCE(NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), ''), u.email) AS display,
                       pu.rol
                FROM proyecto_usuarios pu
                JOIN users u ON u.id = pu.user_id
                WHERE pu.id_proyecto = %s AND u.activo = TRUE
                ORDER BY display
            """, (id_proyecto,))
            rows = cur.fetchall()
    return {"data": [{"email": r[0], "display": r[1], "rol": r[2]} for r in rows]}


@router.get("/reclamos/{reclamo_id}/envios")
def get_envios_reclamo(reclamo_id: int, user=Depends(get_current_user)):
    """Historial de envíos de informe de un reclamo (trazabilidad)."""
    if user.get("role") not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo Calidad puede ver el historial de envíos")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, enviado_por, destinatarios, asunto, estado, error, fecha
                FROM reclamo_envios WHERE reclamo_id = %s ORDER BY fecha DESC, id DESC
            """, (reclamo_id,))
            rows = cur.fetchall()
    return {"data": [
        {"id": r[0], "enviado_por": r[1], "destinatarios": r[2], "asunto": r[3],
         "estado": r[4], "error": r[5], "fecha": _as_text(r[6])}
        for r in rows
    ]}


@router.post("/reclamos/{reclamo_id}/enviar-informe")
def enviar_informe_reclamo(reclamo_id: int, body: EnviarInformeIn, user=Depends(get_current_user)):
    """Envía el informe del reclamo (PDF adjunto) por correo a los destinatarios.
    Solo admin/admin_calidad, y solo reclamos en estado 'cerrado'. Registra el
    envío en reclamo_envios (trazabilidad)."""
    role = user.get("role")
    email = user.get("email", "")
    if role not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo Calidad puede enviar el informe")

    destinatarios = [d.strip() for d in (body.destinatarios or []) if d and d.strip()]
    if not destinatarios:
        raise HTTPException(status_code=400, detail="Debe indicar al menos un destinatario")

    # Generar PDF + obtener datos del reclamo (valida existencia)
    pdf_bytes, filename, rec = _generar_pdf_reclamo(reclamo_id)

    if rec.get("estado") != "cerrado":
        raise HTTPException(status_code=400, detail="Solo se puede enviar el informe de reclamos cerrados")

    # Asunto/cuerpo: usa lo que mande el front (cuerpo editado) o la plantilla por clave
    asunto = body.asunto
    cuerpo = body.cuerpo
    if not asunto or not cuerpo:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT asunto, cuerpo FROM correo_templates WHERE clave = %s",
                            (body.template_clave or "informe_validado",))
                trow = cur.fetchone()
        if trow:
            asunto = asunto or trow[0]
            cuerpo = cuerpo or trow[1]
    asunto = _render_template_vars(asunto or "Informe de reclamo", rec)
    cuerpo = _render_template_vars(cuerpo or "<p>Adjuntamos el informe del reclamo.</p>", rec)

    estado_envio = "enviado"
    error_txt = None
    message_id = None
    try:
        from .mailer import send_email
        resp = send_email(
            to=destinatarios,
            subject=asunto,
            html=cuerpo,
            reply_to=email,
            attachments=[{"filename": filename, "content": pdf_bytes}],
        )
        message_id = resp.get("id") if isinstance(resp, dict) else None
    except Exception as exc:
        estado_envio = "fallido"
        error_txt = str(exc)

    # Registrar trazabilidad (siempre, éxito o fallo)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO reclamo_envios (reclamo_id, enviado_por, destinatarios, asunto, estado, message_id, error)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (reclamo_id, email, ", ".join(destinatarios), asunto, estado_envio, message_id, error_txt))
        conn.commit()

    audit(email, "enviar_informe_reclamo", str(reclamo_id), "reclamo", ", ".join(destinatarios))

    if estado_envio == "fallido":
        raise HTTPException(status_code=502, detail=f"No se pudo enviar el correo: {error_txt}")
    return {"ok": True, "message_id": message_id, "destinatarios": destinatarios}


# ===== Motor de avisos automáticos (Parte 1, sin disparo aún) =====

def _emails_jefa_calidad(cur) -> list:
    """Correos de usuarios con rol admin_calidad (la 'Jefa de Calidad')."""
    cur.execute("SELECT email FROM users WHERE role = 'admin_calidad' AND activo = TRUE")
    return [r[0] for r in cur.fetchall() if r[0]]


def _destinatarios_aviso_reclamo(cur, rec: dict) -> dict:
    """Calcula los destinatarios del aviso automático de un reclamo según su tipo.
    Devuelve {'asignado':..., 'creador':..., 'jefa_calidad':[...]} con emails (o None).
    - EXTERNO: responsable asignado (cubicador_asignado) + jefa calidad + USC creador.
    - INTERNO: jefe del área destino + jefa calidad + creador.
    Roles relativos al reclamo, no genéricos."""
    es_interno = (rec.get("tipo_origen") == "interno")
    if es_interno:
        asignado = _jefe_servicio_de_area(cur, rec.get("area_id"))
    else:
        asignado = rec.get("cubicador_asignado")
    return {
        "asignado": asignado,
        "creador": rec.get("creado_por"),
        "jefa_calidad": _emails_jefa_calidad(cur),
    }


def _enviar_aviso_reclamo(reclamo_id: int, enviado_por: str = "sistema",
                          incluir: dict = None) -> dict:
    """Envía el aviso automático de un reclamo (sin PDF). Calcula destinatarios por
    tipo, usa la plantilla del evento y registra en trazabilidad con el evento.
    `incluir` permite (Parte 2) destildar roles: {'asignado':bool,'creador':bool,
    'jefa_calidad':bool}; por defecto todos True. Devuelve {ok, destinatarios}.
    NO se dispara solo todavía — lo llamará la Parte 3 (creación + warning)."""
    incluir = incluir or {"asignado": True, "creador": True, "jefa_calidad": True}
    with get_conn() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("""
                SELECT r.*, COALESCE(p.nombre_proyecto, r.id_proyecto, '') AS nombre_proyecto
                FROM reclamos r LEFT JOIN proyectos p ON p.id_proyecto = r.id_proyecto
                WHERE r.id = %s
            """, (reclamo_id,))
            rec = cur.fetchone()
            if not rec:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")

            es_interno = (rec.get("tipo_origen") == "interno")
            evento = "aviso_reclamo_interno" if es_interno else "aviso_reclamo_externo"

            dest_map = _destinatarios_aviso_reclamo(cur, rec)
            destinatarios = []
            if incluir.get("asignado") and dest_map["asignado"]:
                destinatarios.append(dest_map["asignado"])
            if incluir.get("creador") and dest_map["creador"]:
                destinatarios.append(dest_map["creador"])
            if incluir.get("jefa_calidad"):
                destinatarios.extend(dest_map["jefa_calidad"])
            # Únicos, sin vacíos
            destinatarios = [d for i, d in enumerate(destinatarios) if d and d not in destinatarios[:i]]

            # Plantilla del evento
            cur.execute("SELECT asunto, cuerpo FROM correo_templates WHERE clave = %s", (evento,))
            trow = cur.fetchone()
            asunto = _render_template_vars((trow["asunto"] if trow else "Aviso de reclamo {{correlativo}}"), rec)
            cuerpo = _render_template_vars((trow["cuerpo"] if trow else "<p>Se registró un reclamo.</p>"), rec)

    if not destinatarios:
        # Sin destinatarios válidos: no se envía (decisión de fallback pendiente).
        return {"ok": False, "destinatarios": [], "motivo": "sin_destinatarios"}

    estado_envio = "enviado"
    error_txt = None
    message_id = None
    try:
        from .mailer import send_email
        resp = send_email(to=destinatarios, subject=asunto, html=cuerpo)
        message_id = resp.get("id") if isinstance(resp, dict) else None
    except Exception as exc:
        estado_envio = "fallido"
        error_txt = str(exc)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO reclamo_envios (reclamo_id, enviado_por, destinatarios, asunto, estado, message_id, error, evento)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (reclamo_id, enviado_por, ", ".join(destinatarios), asunto, estado_envio, message_id, error_txt, evento))
        conn.commit()

    return {"ok": estado_envio == "enviado", "destinatarios": destinatarios,
            "estado": estado_envio, "error": error_txt}


@router.post("/reclamos/{reclamo_id}/aviso-automatico")
def disparar_aviso_reclamo(reclamo_id: int, user=Depends(get_current_user)):
    """Dispara MANUALMENTE el aviso automático de un reclamo (para probar el motor
    mientras no esté el disparo en la creación, Parte 3). Solo admin/admin_calidad."""
    if user.get("role") not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo Calidad puede disparar avisos")
    res = _enviar_aviso_reclamo(reclamo_id, enviado_por=user.get("email", "sistema"))
    audit(user.get("email", ""), "aviso_automatico_reclamo", str(reclamo_id), "reclamo",
          ", ".join(res.get("destinatarios", [])))
    return res
