"""
reclamos.py
-----------
CRUD endpoints para sistema de reclamos y errores.
Incluye seguimientos (timeline), cambio de estado, y KPIs.
Categorías Ishikawa provisorias — se ajustarán con input del usuario.
"""

from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
from psycopg.rows import dict_row

from .notifications import crear_notificacion

from .auth import get_current_user, require_admin_or_admin2
from .db import get_conn, audit
from . import cache as _cache
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

# ========================= CONSTANTS =========================

ESTADOS_RECLAMO = ("abierto", "en_analisis", "validacion", "cerrado", "rechazado")
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
    kilos_mal_fabricados: Optional[float] = None
    tiempo_respuesta: Optional[int] = None
    tiempo_respuesta_unidad: Optional[str] = None
    tiempo_respuesta_actualizado_por: Optional[str] = None
    tiempo_respuesta_fecha_actualizacion: Optional[str] = None
    asignado_a: Optional[str] = None
    cubicador_asignado: Optional[str] = None


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
                elif role in ("cubicador", "externo"):
                    where += " AND (r.cubicador_asignado = %s OR r.respuesta_por = %s)"
                    params.extend([email, email])
                else:
                    # Safety: unknown role with solo_mios should still filter
                    where += " AND (r.creado_por = %s OR r.cubicador_asignado = %s)"
                    params.extend([email, email])
            if id_proyecto:
                where += " AND r.id_proyecto = %s"
                params.append(id_proyecto)
            if estado:
                where += " AND r.estado = %s"
                params.append(estado)
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
                       (SELECT COUNT(*) FROM reclamo_seguimientos s WHERE s.reclamo_id = r.id) AS seg_count,
                      r.aplica, r.sub_causa, r.cod_causa,
                       r.detectado_por, r.fecha_deteccion,
                       r.correlativo, r.id_calidad, r.tipo_reclamo, r.asignado_a,
                       r.cubicador_asignado, r.respuesta_por,
                       r.anio_calidad, r.numero_calidad
                FROM reclamos r
                LEFT JOIN proyectos p ON r.id_proyecto = p.id_proyecto
                {where}
                ORDER BY
                    CASE r.estado
                        WHEN 'abierto' THEN 1
                        WHEN 'en_analisis' THEN 2
                        WHEN 'validacion' THEN 3
                        WHEN 'rechazado' THEN 4
                        WHEN 'cerrado' THEN 5
                    END,
                    CASE r.prioridad
                        WHEN 'critica' THEN 1
                        WHEN 'alta' THEN 2
                        WHEN 'media' THEN 3
                        WHEN 'baja' THEN 4
                    END,
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
            }
            for r in rows
        ]
    }


@router.post("/reclamos")
def crear_reclamo(body: ReclamoCreate, user=Depends(get_current_user)):
    """Crear un nuevo reclamo."""
    email = user.get("email", "unknown")
    role = user.get("role", "usc")
    now = datetime.now(timezone.utc).isoformat()

    # Solo admin, admin2, usc pueden crear reclamos
    if role not in ("admin", "admin2", "usc"):
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
        elif role in ("admin", "admin2"):
            # Admin/admin2 puede dejar vacío para asignar después
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

            cur.execute("""
                INSERT INTO reclamos (id_proyecto, titulo, descripcion, prioridad, tipo_reclamo,
                    categoria_ishikawa, sub_causa, cod_causa, responsable,
                    detectado_por, fecha_deteccion, analista,
                    creado_por, fecha_creacion, correlativo, id_calidad, asignado_a,
                    cubicador_asignado, anio_calidad, numero_calidad)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (body.id_proyecto, body.titulo, body.descripcion,
                  body.prioridad or "alta", body.tipo_reclamo or "error",
                  body.categoria_ishikawa,
                  body.sub_causa, body.cod_causa, body.responsable,
                  body.detectado_por, body.fecha_deteccion, email,
                  email, now, correlativo, body.id_calidad, asignado_a,
                  body.cubicador_asignado, body.anio_calidad, body.numero_calidad))
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
def siguiente_numero_calidad(anio: int, user=Depends(get_current_user)):
    """Sugerir siguiente numero_calidad para un año dado."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT MAX(numero_calidad) FROM reclamos WHERE anio_calidad = %s",
                (anio,)
            )
            max_num = cur.fetchone()[0]
    return {"anio": anio, "siguiente": (max_num or 0) + 1}


@router.get("/reclamos/mi-resumen")
def reclamos_mi_resumen(user=Depends(get_current_user)):
    """Landing page stats filtered by role.
    USC: own reclamos (creado_por or asignado_a).
    Cubicador/Externo: reclamos assigned to them (cubicador_asignado) or responded (respuesta_por).
    Admin/Admin2: all reclamos."""
    email = user.get("email", "")
    role = user.get("role", "usc")
    role_filter, role_params = build_role_filter(user)

    with get_conn() as conn:
        with conn.cursor() as cur:
            total = q_total(cur, role_filter, role_params)
            abiertos = q_abiertos(cur, role_filter, role_params)
            por_tipo = q_por_tipo(cur, role_filter, role_params)
            por_anio_mes = q_por_anio_mes(cur, fecha_col="fecha_deteccion", where=role_filter, params=role_params)
            resueltos_no_resueltos = q_resueltos_no_resueltos(cur, role_filter, role_params)

            # Pendientes: assigned to cubicador but not yet responded
            pendientes = 0
            if role in ("cubicador", "externo"):
                cur.execute("""
                    SELECT COUNT(*) FROM reclamos r
                    WHERE r.cubicador_asignado = %s
                      AND r.respuesta_texto IS NULL
                      AND r.estado NOT IN ('cerrado','rechazado')
                """, (email,))
                pendientes = int(cur.fetchone()[0])

            # Ishikawa breakdown (for cubicador landing doughnut)
            por_ishikawa = {}
            if role in ("cubicador", "externo", "admin", "admin2"):
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
def reclamos_admin_dashboards(user=Depends(require_admin_or_admin2)):
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
                WHERE u.role = 'cubicador' AND r.respuesta_por IS NOT NULL
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
                WHERE u.role = 'cubicador' AND r.respuesta_por IS NOT NULL
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
def get_ishikawa(user=Depends(get_current_user)):
    """Devuelve el diagrama Ishikawa completo con categorías y sub-causas."""
    return {
        "data": [
            {
                "key": k,
                "label": ISHIKAWA_LABELS[k],
                "subcausas": ISHIKAWA_SUBCAUSAS[k],
            }
            for k in CATEGORIAS_ISHIKAWA
        ]
    }


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


# ========================= PRESENTACIONES =========================
# NOTE: These routes MUST be declared before /reclamos/{reclamo_id}
# otherwise FastAPI matches "para-presentar" as {reclamo_id} → 422 error.

@router.get("/reclamos/para-presentar")
def reclamos_para_presentar(user=Depends(get_current_user)):
    """Lista de reclamos elegibles para presentación.
    Requisito: estado = 'cerrado'.
    Cubicadores solo ven sus reclamos asignados; admin/admin2 ven todos.
    """
    email = user.get("email", "")
    role = user.get("role", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            role_filter = ""
            params = []
            if role not in ("admin", "admin2"):
                role_filter = "AND r.cubicador_asignado = %s"
                params.append(email)

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

            # Also fetch cubicadores list for the asistentes selector
            cur.execute("""
                SELECT email, COALESCE(nombre, '') AS nombre, COALESCE(apellido, '') AS apellido
                FROM users WHERE role = 'cubicador' AND activo = TRUE
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
            if role not in ("admin", "admin2", "cubicador"):
                role_filter = "AND r.cubicador_asignado = %s"
                params.append(email)

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

    if role not in ("admin", "admin2", "cubicador", "externo"):
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

            if role in ("cubicador", "externo"):
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
    
    cache_key = _get_cache_key(reclamo_id, include_images, include_seguimientos, include_acciones)
    
    # Verificar cache primero
    if _is_cache_valid(cache_key):
        return _get_from_cache(cache_key)
    
    try:
        with get_conn() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                # Query principal optimizado con LEFT JOINs
                cur.execute("""
                    SELECT 
                        r.*, 
                        COALESCE(p.nombre_proyecto, r.id_proyecto, 'Obra eliminada') AS nombre_proyecto,
                        p.nombre_proyecto AS nombre_proyecto_lookup
                    FROM reclamos r
                    LEFT JOIN proyectos p ON r.id_proyecto = p.id_proyecto
                    WHERE r.id = %s
                """, (reclamo_id,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Reclamo no encontrado")

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
                    "nombre_proyecto": row.get("nombre_proyecto") or row.get("nombre_proyecto_lookup") or row.get("id_proyecto") or "Obra eliminada",
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
                        cur.execute(f"""
                            SELECT id, filename, content_type, descripcion, subido_por,
                                   {fecha_expr} AS fecha_ref,
                                   {tipo_expr} AS tipo_ref
                            FROM reclamo_imagenes WHERE reclamo_id = %s
                            ORDER BY id ASC
                        """, (reclamo_id,))
                        imagenes = cur.fetchall()
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
                                "url": f"/reclamos/{reclamo_id}/imagenes/{img.get('id')}",
                                "size_preview": "thumbnail"
                            }
                            for img in imagenes
                        ]

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

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, estado, creado_por, asignado_a, cubicador_asignado, respuesta_por FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            estado_anterior = row[1]
            rec = {"creado_por": row[2], "asignado_a": row[3], "cubicador_asignado": row[4], "respuesta_por": row[5]}

            # Filtrar campos según rol
            submitted_fields = {f for f in body.__fields_set__ if getattr(body, f) is not None}
            if role in ("admin", "admin2"):
                pass  # sin restricción
            elif role == "usc":
                if not _es_propietario_usc(rec, email):
                    raise HTTPException(status_code=403, detail="Solo puede editar reclamos propios")
                blocked = submitted_fields & ANALISIS_FIELDS
                if blocked:
                    raise HTTPException(status_code=403, detail=f"No tiene permiso para editar campos de análisis: {', '.join(blocked)}")
            elif role in ("cubicador", "externo"):
                if not _es_propietario_cubicador(rec, email):
                    raise HTTPException(status_code=403, detail="Solo puede editar reclamos propios")
                blocked = submitted_fields & REGISTRO_FIELDS
                if blocked:
                    raise HTTPException(status_code=403, detail=f"No tiene permiso para editar campos de registro: {', '.join(blocked)}")
            else:
                raise HTTPException(status_code=403, detail="No tiene permiso para editar reclamos")

            sets = ["fecha_actualizacion = %s"]
            params = [now]

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
            ]
            # Fields where empty string should be stored as NULL
            nullable_fields = {"id_proyecto", "id_calidad", "sub_causa", "cod_causa", "responsable",
                               "detectado_por", "fecha_deteccion", "fecha_analisis",
                               "analista", "area_aplica", "explicacion_causa",
                               "accion_correctiva", "accion_preventiva", "resolucion", "observaciones",
                               "respuesta_texto", "validacion_resultado", "validacion_observaciones",
                               "tiempo_respuesta_unidad", "tiempo_respuesta_actualizado_por",
                               "tiempo_respuesta_fecha_actualizacion", "asignado_a", "cubicador_asignado"}
            # Detect rejection early so the updatable loop can skip validation fields
            is_rejection = body.validacion_resultado == "rechazado"
            skip_on_rejection = {"validacion_resultado", "validacion_observaciones"}

            for field in updatable:
                val = getattr(body, field)
                if val is not None:
                    if is_rejection and field in skip_on_rejection:
                        continue  # PA.5: these will be set to NULL below
                    # anio_calidad solo editable por admin/admin2
                    if field == "anio_calidad" and role not in ("admin", "admin2"):
                        continue
                    sets.append(f"{field} = %s")
                    params.append(val if (val != "" or field not in nullable_fields) else None)

            # Auto-set respuesta metadata when respuesta_texto is provided
            if body.respuesta_texto and body.respuesta_texto.strip():
                sets.append("respuesta_fecha = %s")
                params.append(now)
                # Admin/admin2: attribute response to cubicador_asignado if set
                if role in ("admin", "admin2"):
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

                # Helper: check if column already in sets to avoid duplicate assignment
                def _col_in_sets(col):
                    return any(s.startswith(col + " =") or s.startswith(col + " =") for s in sets)

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

    return {"ok": True, "id": reclamo_id}


@router.delete("/reclamos/{reclamo_id}")
def eliminar_reclamo(reclamo_id: int, user=Depends(get_current_user)):
    """Eliminar un reclamo y todos sus datos asociados."""
    email = user.get("email", "unknown")
    role = user.get("role", "usc")

    if role not in ("admin", "admin2", "usc"):
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

    if role not in ("admin", "admin2", "cubicador", "externo"):
        raise HTTPException(status_code=403, detail="No tiene permiso para agregar acciones")

    if body.tipo not in TIPOS_ACCION:
        raise HTTPException(status_code=400, detail=f"Tipo inválido. Válidos: {list(TIPOS_ACCION)}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, cubicador_asignado, respuesta_por FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")

            if role in ("cubicador", "externo"):
                rec = {"cubicador_asignado": row[1], "respuesta_por": row[2]}
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
    with get_conn() as conn:
        with conn.cursor() as cur:
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
    if img_tipo == "ImagenesRegistro" and role in ("cubicador", "externo"):
        raise HTTPException(status_code=403, detail="Solo USC o admin pueden subir imágenes de registro")
    if img_tipo == "ImagenesAnalisis" and role == "usc":
        raise HTTPException(status_code=403, detail="Solo cubicador, externo o admin pueden subir imágenes de análisis")

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

                cur.execute(f"""
                    INSERT INTO reclamo_imagenes (reclamo_id, filename, content_type, data, descripcion, subido_por, {fecha_col}, tipo)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (reclamo_id, file.filename, file.content_type, data, descripcion, email, now, img_tipo))
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
def ver_imagen(reclamo_id: int, imagen_id: int):
    """Servir una imagen directamente (inline) para verla en el navegador sin descargar."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT data, content_type, filename
                FROM reclamo_imagenes
                WHERE id = %s AND reclamo_id = %s
            """, (imagen_id, reclamo_id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Imagen no encontrada")

    return Response(
        content=bytes(row[0]),
        media_type=row[1],
        headers={"Content-Disposition": f"inline; filename=\"{row[2]}\""}
    )


@router.delete("/reclamos/{reclamo_id}/imagenes/{imagen_id}")
def eliminar_imagen(reclamo_id: int, imagen_id: int, user=Depends(get_current_user)):
    """Eliminar una imagen de un reclamo."""
    email = user.get("email", "unknown")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM reclamo_imagenes WHERE id = %s AND reclamo_id = %s", (imagen_id, reclamo_id))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Imagen no encontrada")
    _invalidate_reclamo_cache(reclamo_id)
    audit(email, "eliminar_imagen_reclamo", str(imagen_id), "reclamo", str(reclamo_id))
    return {"ok": True, "id": imagen_id}


# ========================= PDF EXPORT =========================

ESTADO_COLORS_RGB = {
    "abierto": (255, 152, 0),
    "en_analisis": (25, 118, 210),
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
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(*rgb)
        pdf.set_text_color(255, 255, 255)
        estado_label = self._s(ESTADO_LABELS.get(estado, estado))
        pdf.cell(pdf.get_string_width(estado_label) + 8, 6, estado_label, fill=True, new_x="END")
        pdf.set_text_color(100, 100, 100)
        pdf.set_font("Helvetica", "", 8)
        aplica_label = self._s(APLICA_LABELS.get(rec.get("aplica"), ""))
        extra = f"   Aplica: {aplica_label}" if aplica_label else ""
        fecha_informe = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        pdf.cell(0, 6, f"{extra}      Generado: {fecha_informe}", new_x="LMARGIN", new_y="NEXT")

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

    # ── Antecedentes ──
    def _antecedentes_section(self):
        rec = self.rec
        self._section_title("Antecedentes del Reclamo", (198, 40, 40))

        tipo_label = {"error": "Error", "faltante": "Faltante", "atraso": "Atraso"}.get(
            rec.get("tipo_reclamo"), rec.get("tipo_reclamo") or "-"
        )
        self._field_row("Título:", rec.get("titulo"))
        self._field_row("Tipo:", tipo_label)
        self._field_row("Proyecto / Obra:", rec.get("nombre_proyecto"))
        self._field_row("Detectado por:", rec.get("detectado_por"))
        self._field_row("Fecha detección:", _as_text(rec.get("fecha_deteccion")))
        self._field_row("Creado por:", rec.get("creado_por"))
        self._field_row("Fecha creación:", _as_text(rec.get("fecha_creacion")))
        self._field_row("Cub. Responsable:", rec.get("responsable"))
        self._field_row("USC Responsable:", rec.get("asignado_a"))
        if rec.get("kilos_mal_fabricados") is not None:
            self._field_row("Kilos mal fabricados:", f"{rec['kilos_mal_fabricados']} kg", bold_value=True)

        if rec.get("descripcion"):
            self.pdf.ln(2)
            self.pdf.set_font("Helvetica", "B", 9)
            self.pdf.set_text_color(85, 85, 85)
            self.pdf.cell(0, 5, "Descripcion:", new_x="LMARGIN", new_y="NEXT")
            self.pdf.set_font("Helvetica", "", 9)
            self.pdf.set_text_color(34, 34, 34)
            self.pdf.multi_cell(self._w_usable, 4.5, self._s(rec["descripcion"]), new_x="LMARGIN", new_y="NEXT")

        self.pdf.ln(4)

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

        for img_data in imagenes:
            raw = img_data.get("raw_bytes")
            fname = img_data.get("filename", "imagen")
            if not raw:
                continue

            # New page check: if not enough space for an image row
            if row_y + img_max_h > 270:
                pdf.add_page()
                row_y = pdf.get_y()
                col = 0

            x = 15 + col * (img_w + gap)
            try:
                img_buf = io.BytesIO(raw)
                pdf.image(img_buf, x=x, y=row_y, w=img_w)
            except Exception:
                pdf.set_xy(x, row_y)
                pdf.set_font("Helvetica", "I", 8)
                pdf.cell(img_w, 4, self._s(f"[No se pudo incluir: {fname}]"))

            col += 1
            if col >= 2:
                col = 0
                row_y += img_max_h + 4
                pdf.set_y(row_y)

        # If we ended on col 1, advance past the row
        if col > 0:
            row_y += img_max_h + 4
            pdf.set_y(row_y)

        pdf.ln(2)

    # ── Análisis ──
    def _analisis_section(self):
        rec = self.rec
        self._section_title("Análisis y Respuesta", (21, 101, 192))

        cat_label = ISHIKAWA_LABELS.get(rec.get("categoria_ishikawa"), rec.get("categoria_ishikawa"))
        self._field_row("Causa Ishikawa:", cat_label)
        self._field_row("Sub-causa:", rec.get("sub_causa"))
        self._field_row("Código causa:", rec.get("cod_causa"))
        self._field_row("Área que aplica:", rec.get("area_aplica"))
        self._field_row("Respondido por:", rec.get("respuesta_por"))
        self._field_row("Fecha respuesta:", _as_text(rec.get("respuesta_fecha")))
        if rec.get("tiempo_respuesta"):
            unidad = rec.get("tiempo_respuesta_unidad") or "horas"
            self._field_row("Tiempo respuesta:", f"{rec['tiempo_respuesta']} {unidad}")

        if rec.get("respuesta_texto"):
            self.pdf.ln(2)
            self.pdf.set_font("Helvetica", "B", 9)
            self.pdf.set_text_color(85, 85, 85)
            self.pdf.cell(0, 5, "Respuesta del cubicador:", new_x="LMARGIN", new_y="NEXT")
            self.pdf.set_font("Helvetica", "", 9)
            self.pdf.set_text_color(34, 34, 34)
            self.pdf.multi_cell(self._w_usable, 4.5, self._s(rec["respuesta_texto"]), new_x="LMARGIN", new_y="NEXT")

        self.pdf.ln(4)

    # ── Acciones ──
    def _acciones_section(self):
        if not self.acciones:
            return
        self._section_title("Acciones Correctivas / Preventivas", (230, 81, 0))

        pdf = self.pdf
        col_widths = [25, 65, 30, 22, 22, 16]
        headers = ["Tipo", "Descripción", "Responsable", "F.Prevista", "F.Complet.", "Estado"]

        # Header row
        pdf.set_font("Helvetica", "B", 7)
        pdf.set_fill_color(245, 245, 245)
        pdf.set_text_color(34, 34, 34)
        for i, h in enumerate(headers):
            pdf.cell(col_widths[i], 5, h, border=1, fill=True, new_x="END")
        pdf.ln()

        # Data rows
        pdf.set_font("Helvetica", "", 7)
        for a in self.acciones:
            vals = [
                self._s(a.get("tipo_label") or "-"),
                self._s((a.get("descripcion") or "-")[:80]),
                self._s((a.get("responsable") or "-")[:25]),
                self._s(a.get("fecha_prevista") or "-"),
                self._s(a.get("fecha_completada") or "-"),
                self._s(a.get("estado_label") or "-"),
            ]
            max_h = 5
            for i, v in enumerate(vals):
                pdf.cell(col_widths[i], max_h, v, border=1, new_x="END")
            pdf.ln()

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


@router.get("/reclamos/{reclamo_id}/pdf")
def exportar_reclamo_pdf(reclamo_id: int, user=Depends(get_current_user)):
    """Generar PDF del informe de reclamo."""
    import io

    role = user.get("role")
    email = user.get("email", "")
    if role not in ("admin", "admin2", "cubicador", "usc"):
        raise HTTPException(status_code=403, detail="Sin permisos para generar PDF")

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

            if role == "cubicador" and not _es_propietario_cubicador(rec, email):
                raise HTTPException(status_code=403, detail="Solo puedes exportar tus propios reclamos")
            if role == "usc" and not _es_propietario_usc(rec, email):
                raise HTTPException(status_code=403, detail="Solo puedes exportar tus propios reclamos")

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

            # Imágenes → raw bytes para fpdf2
            cur.execute("""
                SELECT id, filename, content_type, data, tipo
                FROM reclamo_imagenes WHERE reclamo_id = %s ORDER BY id ASC
            """, (reclamo_id,))
            imagenes_registro = []
            imagenes_analisis = []
            for img in cur.fetchall():
                ct = img.get("content_type") or ""
                if not ct.startswith("image/"):
                    continue
                entry = {"raw_bytes": bytes(img["data"]), "filename": img.get("filename")}
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

    audit(email, "exportar_pdf_reclamo", str(reclamo_id), "reclamo", str(reclamo_id))
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
