"""
reclamos.py
-----------
CRUD endpoints para sistema de reclamos y errores.
Incluye seguimientos (timeline), cambio de estado, y KPIs.
Categorías Ishikawa provisorias — se ajustarán con input del usuario.
"""

import base64
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_conn, audit

router = APIRouter()

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_IMAGE_TYPES = ("image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp")

# ========================= CONSTANTS =========================

ESTADOS_RECLAMO = ("abierto", "en_analisis", "accion_correctiva", "cerrado", "rechazado")
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
        {"cod": "MO05", "texto": "Error al digitar o transmitir datos"},
        {"cod": "MO06", "texto": "No consulta antecedentes incompletos mediante Bshark o RDI"},
        {"cod": "MO07", "texto": "Error de interpretación o criterio técnico"},
        {"cod": "MO08", "texto": "Sobrecarga laboral o plazos ajustados que reducen tiempo de revisión"},
    ],
}

ESTADO_LABELS = {
    "abierto": "Abierto",
    "en_analisis": "En análisis",
    "accion_correctiva": "Acción correctiva",
    "cerrado": "Cerrado",
    "rechazado": "Rechazado",
}

PRIORIDAD_LABELS = {
    "baja": "Baja",
    "media": "Media",
    "alta": "Alta",
    "critica": "Crítica",
}


# ========================= MODELS =========================

class ReclamoCreate(BaseModel):
    id_proyecto: Optional[str] = None
    titulo: str
    descripcion: Optional[str] = None
    prioridad: Optional[str] = "media"
    categoria_ishikawa: Optional[str] = None
    sub_causa: Optional[str] = None
    cod_causa: Optional[str] = None
    responsable: Optional[str] = None
    detectado_por: Optional[str] = None
    fecha_deteccion: Optional[str] = None
    id_calidad: Optional[str] = None


class ReclamoUpdate(BaseModel):
    titulo: Optional[str] = None
    descripcion: Optional[str] = None
    estado: Optional[str] = None
    prioridad: Optional[str] = None
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
    user=Depends(get_current_user),
):
    """Lista reclamos con filtros opcionales."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = "WHERE 1=1"
            params = []
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

            cur.execute(f"""
                SELECT r.id, r.id_proyecto, r.titulo, r.descripcion, r.estado,
                       r.prioridad, r.categoria_ishikawa, r.responsable,
                       r.creado_por, r.fecha_creacion, r.fecha_actualizacion, r.fecha_cierre,
                       COALESCE(p.nombre_proyecto, r.id_proyecto) AS nombre_proyecto,
                       (SELECT COUNT(*) FROM reclamo_seguimientos s WHERE s.reclamo_id = r.id) AS seg_count,
                       r.aplica, r.sub_causa, r.cod_causa, r.correlativo_calidad,
                       r.detectado_por, r.fecha_deteccion,
                       r.correlativo, r.id_calidad
                FROM reclamos r
                LEFT JOIN proyectos p ON r.id_proyecto = p.id_proyecto
                {where}
                ORDER BY
                    CASE r.estado
                        WHEN 'abierto' THEN 1
                        WHEN 'en_analisis' THEN 2
                        WHEN 'accion_correctiva' THEN 3
                        WHEN 'rechazado' THEN 4
                        WHEN 'cerrado' THEN 5
                    END,
                    CASE r.prioridad
                        WHEN 'critica' THEN 1
                        WHEN 'alta' THEN 2
                        WHEN 'media' THEN 3
                        WHEN 'baja' THEN 4
                    END,
                    r.id DESC
            """, params)
            rows = cur.fetchall()

    return {
        "reclamos": [
            {
                "id": r[0], "id_proyecto": r[1], "titulo": r[2], "descripcion": r[3],
                "estado": r[4], "prioridad": r[5], "categoria_ishikawa": r[6],
                "responsable": r[7], "creado_por": r[8], "fecha_creacion": r[9],
                "fecha_actualizacion": r[10], "fecha_cierre": r[11],
                "nombre_proyecto": r[12], "total_seguimientos": int(r[13]),
                "aplica": r[14], "sub_causa": r[15], "cod_causa": r[16],
                "correlativo_calidad": r[17], "detectado_por": r[18],
                "fecha_deteccion": r[19],
                "correlativo": r[20], "id_calidad": r[21],
            }
            for r in rows
        ]
    }


@router.post("/reclamos")
def crear_reclamo(body: ReclamoCreate, user=Depends(get_current_user)):
    """Crear un nuevo reclamo."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    if body.prioridad and body.prioridad not in PRIORIDADES:
        raise HTTPException(status_code=400, detail=f"Prioridad inválida. Válidas: {PRIORIDADES}")
    if body.categoria_ishikawa and body.categoria_ishikawa not in CATEGORIAS_ISHIKAWA:
        raise HTTPException(status_code=400, detail=f"Categoría inválida. Válidas: {CATEGORIAS_ISHIKAWA}")

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
                INSERT INTO reclamos (id_proyecto, titulo, descripcion, prioridad,
                    categoria_ishikawa, sub_causa, cod_causa, responsable,
                    detectado_por, fecha_deteccion, analista,
                    creado_por, fecha_creacion, correlativo, id_calidad)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (body.id_proyecto, body.titulo, body.descripcion,
                  body.prioridad or "media", body.categoria_ishikawa,
                  body.sub_causa, body.cod_causa, body.responsable,
                  body.detectado_por, body.fecha_deteccion, email,
                  email, now, correlativo, body.id_calidad))
            reclamo_id = cur.fetchone()[0]

            # Auto-create first seguimiento
            cur.execute("""
                INSERT INTO reclamo_seguimientos (reclamo_id, usuario, comentario, estado_nuevo, fecha)
                VALUES (%s, %s, %s, %s, %s)
            """, (reclamo_id, email, "Reclamo creado", "abierto", now))

    audit(email, "crear_reclamo", body.titulo, "reclamo", str(reclamo_id))
    return {"ok": True, "id": reclamo_id, "correlativo": correlativo}


@router.get("/reclamos/kpis")
def reclamos_kpis(user=Depends(get_current_user)):
    """KPIs de reclamos: por estado, aplica/no aplica, categoría, sub-causas top, tiempo resolución."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT estado, COUNT(*) FROM reclamos GROUP BY estado")
            por_estado = {r[0]: int(r[1]) for r in cur.fetchall()}

            cur.execute("SELECT prioridad, COUNT(*) FROM reclamos WHERE estado NOT IN ('cerrado','rechazado') GROUP BY prioridad")
            por_prioridad = {r[0]: int(r[1]) for r in cur.fetchall()}

            cur.execute("SELECT COALESCE(categoria_ishikawa,'sin_categoria'), COUNT(*) FROM reclamos GROUP BY categoria_ishikawa")
            por_categoria = {r[0]: int(r[1]) for r in cur.fetchall()}

            cur.execute("SELECT COALESCE(aplica,'pendiente'), COUNT(*) FROM reclamos GROUP BY aplica")
            por_aplica = {r[0]: int(r[1]) for r in cur.fetchall()}

            # Top 10 sub-causas más repetitivas
            cur.execute("""
                SELECT cod_causa, sub_causa, categoria_ishikawa, COUNT(*) as cnt
                FROM reclamos
                WHERE sub_causa IS NOT NULL AND sub_causa != ''
                GROUP BY cod_causa, sub_causa, categoria_ishikawa
                ORDER BY cnt DESC LIMIT 10
            """)
            top_causas = [{"cod": r[0], "sub_causa": r[1], "categoria": r[2], "count": int(r[3])} for r in cur.fetchall()]

            cur.execute("""
                SELECT AVG(
                    EXTRACT(EPOCH FROM (fecha_cierre::timestamp - fecha_creacion::timestamp)) / 86400.0
                ) FROM reclamos WHERE estado = 'cerrado' AND fecha_cierre IS NOT NULL
            """)
            avg_row = cur.fetchone()
            avg_dias_resolucion = round(float(avg_row[0]), 1) if avg_row and avg_row[0] else None

            cur.execute("SELECT COUNT(*) FROM reclamos")
            total = int(cur.fetchone()[0])

            abiertos = por_estado.get("abierto", 0) + por_estado.get("en_analisis", 0) + por_estado.get("accion_correctiva", 0)

    return {
        "total": total,
        "abiertos": abiertos,
        "por_estado": por_estado,
        "por_prioridad": por_prioridad,
        "por_categoria": por_categoria,
        "por_aplica": por_aplica,
        "top_causas": top_causas,
        "avg_dias_resolucion": avg_dias_resolucion,
    }


@router.get("/reclamos/dashboard")
def reclamos_dashboard(user=Depends(get_current_user)):
    """Datos agregados para el dashboard de reclamos: charts y matriz."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 1) Reclamos por mes (últimos 12 meses)
            cur.execute("""
                SELECT TO_CHAR(fecha_creacion::timestamp, 'YYYY-MM') AS mes, COUNT(*)
                FROM reclamos
                WHERE fecha_creacion::timestamp >= NOW() - INTERVAL '12 months'
                GROUP BY mes ORDER BY mes
            """)
            por_mes = [{"mes": r[0], "count": int(r[1])} for r in cur.fetchall()]

            # 2) Distribución por categoría Ishikawa
            cur.execute("""
                SELECT COALESCE(categoria_ishikawa, 'sin_categoria'), COUNT(*)
                FROM reclamos GROUP BY 1 ORDER BY 2 DESC
            """)
            por_categoria = [{"categoria": r[0], "count": int(r[1])} for r in cur.fetchall()]

            # 3) Top 10 obras con más reclamos
            cur.execute("""
                SELECT COALESCE(p.nombre_proyecto, r.id_proyecto, 'Sin obra') AS obra, COUNT(*)
                FROM reclamos r
                LEFT JOIN proyectos p ON p.id_proyecto = r.id_proyecto
                GROUP BY obra ORDER BY 2 DESC LIMIT 10
            """)
            por_obra = [{"obra": r[0], "count": int(r[1])} for r in cur.fetchall()]

            # 4) Por estado actual
            cur.execute("SELECT estado, COUNT(*) FROM reclamos GROUP BY estado ORDER BY 2 DESC")
            por_estado = [{"estado": r[0], "count": int(r[1])} for r in cur.fetchall()]

            # 5) Por responsable (top 10)
            cur.execute("""
                SELECT COALESCE(NULLIF(responsable,''), 'Sin asignar'), COUNT(*)
                FROM reclamos GROUP BY 1 ORDER BY 2 DESC LIMIT 10
            """)
            por_responsable = [{"responsable": r[0], "count": int(r[1])} for r in cur.fetchall()]

            # 6) Matriz obra × categoría (top 8 obras)
            cur.execute("""
                SELECT COALESCE(p.nombre_proyecto, r.id_proyecto, 'Sin obra') AS obra,
                       COALESCE(r.categoria_ishikawa, 'sin_categoria') AS cat,
                       COUNT(*)
                FROM reclamos r
                LEFT JOIN proyectos p ON p.id_proyecto = r.id_proyecto
                GROUP BY obra, cat
                ORDER BY obra, cat
            """)
            matriz_raw = cur.fetchall()

            # 7) Tiempo resolución por mes (últimos 12 meses)
            cur.execute("""
                SELECT TO_CHAR(fecha_cierre::timestamp, 'YYYY-MM') AS mes,
                       AVG(EXTRACT(EPOCH FROM (fecha_cierre::timestamp - fecha_creacion::timestamp)) / 86400.0)
                FROM reclamos
                WHERE estado = 'cerrado' AND fecha_cierre IS NOT NULL
                  AND fecha_cierre::timestamp >= NOW() - INTERVAL '12 months'
                GROUP BY mes ORDER BY mes
            """)
            resolucion_mes = [{"mes": r[0], "avg_dias": round(float(r[1]), 1)} for r in cur.fetchall()]

            # 8) Por creado_por (top 10)
            cur.execute("""
                SELECT COALESCE(creado_por, 'Desconocido'), COUNT(*)
                FROM reclamos GROUP BY 1 ORDER BY 2 DESC LIMIT 10
            """)
            por_creador = [{"creador": r[0], "count": int(r[1])} for r in cur.fetchall()]

    # Build matrix structure
    obras_set = {}
    cats_set = set()
    for obra, cat, cnt in matriz_raw:
        obras_set.setdefault(obra, {})[cat] = int(cnt)
        cats_set.add(cat)
    # Sort obras by total desc, take top 8
    obras_sorted = sorted(obras_set.items(), key=lambda x: sum(x[1].values()), reverse=True)[:8]
    cats_sorted = sorted(cats_set)
    matriz = {
        "obras": [o[0] for o in obras_sorted],
        "categorias": cats_sorted,
        "data": [[o[1].get(c, 0) for c in cats_sorted] for o in obras_sorted],
    }

    return {
        "por_mes": por_mes,
        "por_categoria": por_categoria,
        "por_obra": por_obra,
        "por_estado": por_estado,
        "por_responsable": por_responsable,
        "por_creador": por_creador,
        "resolucion_mes": resolucion_mes,
        "matriz": matriz,
    }


@router.get("/reclamos/options")
def reclamos_options(user=Depends(get_current_user)):
    """Devuelve opciones para dropdowns del formulario."""
    return {
        "estados": [{"value": k, "label": v} for k, v in ESTADO_LABELS.items()],
        "prioridades": [{"value": k, "label": v} for k, v in PRIORIDAD_LABELS.items()],
        "categorias_ishikawa": [{"value": k, "label": v} for k, v in ISHIKAWA_LABELS.items()],
        "aplica_values": [{"value": "si", "label": "Sí aplica"}, {"value": "no", "label": "No aplica"}, {"value": "pendiente", "label": "Pendiente"}],
        "tipos_accion": [{"value": "inmediata", "label": "Inmediata"}, {"value": "correctiva", "label": "Correctiva"}, {"value": "preventiva", "label": "Preventiva"}],
    }


@router.get("/reclamos/ishikawa")
def get_ishikawa(user=Depends(get_current_user)):
    """Devuelve el diagrama Ishikawa completo con categorías y sub-causas."""
    return {
        "categorias": [
            {
                "key": k,
                "label": ISHIKAWA_LABELS[k],
                "subcausas": ISHIKAWA_SUBCAUSAS[k],
            }
            for k in CATEGORIAS_ISHIKAWA
        ]
    }


@router.get("/reclamos/{reclamo_id}")
def get_reclamo(reclamo_id: int, user=Depends(get_current_user)):
    """Obtener detalle de un reclamo con timeline, acciones e imágenes."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT r.id, r.id_proyecto, r.titulo, r.descripcion, r.estado,
                       r.prioridad, r.categoria_ishikawa, r.responsable,
                       r.accion_correctiva, r.accion_preventiva, r.resolucion,
                       r.creado_por, r.fecha_creacion, r.fecha_actualizacion, r.fecha_cierre,
                       COALESCE(p.nombre_proyecto, r.id_proyecto) AS nombre_proyecto,
                       r.aplica, r.sub_causa, r.cod_causa, r.correlativo_calidad,
                       r.detectado_por, r.fecha_deteccion, r.fecha_analisis,
                       r.analista, r.area_aplica, r.explicacion_causa, r.observaciones,
                       r.correlativo, r.id_calidad
                FROM reclamos r
                LEFT JOIN proyectos p ON r.id_proyecto = p.id_proyecto
                WHERE r.id = %s
            """, (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")

            cur.execute("""
                SELECT id, usuario, comentario, estado_anterior, estado_nuevo, fecha
                FROM reclamo_seguimientos WHERE reclamo_id = %s
                ORDER BY fecha ASC, id ASC
            """, (reclamo_id,))
            seguimientos = cur.fetchall()

            cur.execute("""
                SELECT id, tipo, descripcion, responsable, fecha_prevista,
                       fecha_completada, estado, creado_por, fecha_creacion
                FROM reclamo_acciones WHERE reclamo_id = %s
                ORDER BY id ASC
            """, (reclamo_id,))
            acciones = cur.fetchall()

            cur.execute("""
                SELECT id, filename, content_type, descripcion, subido_por, fecha_subida
                FROM reclamo_imagenes WHERE reclamo_id = %s
                ORDER BY id ASC
            """, (reclamo_id,))
            imagenes = cur.fetchall()

    return {
        "id": row[0], "id_proyecto": row[1], "titulo": row[2], "descripcion": row[3],
        "estado": row[4], "prioridad": row[5], "categoria_ishikawa": row[6],
        "responsable": row[7], "accion_correctiva": row[8], "accion_preventiva": row[9],
        "resolucion": row[10], "creado_por": row[11], "fecha_creacion": row[12],
        "fecha_actualizacion": row[13], "fecha_cierre": row[14], "nombre_proyecto": row[15],
        "aplica": row[16], "sub_causa": row[17], "cod_causa": row[18],
        "correlativo_calidad": row[19], "detectado_por": row[20],
        "fecha_deteccion": row[21], "fecha_analisis": row[22], "analista": row[23],
        "area_aplica": row[24], "explicacion_causa": row[25], "observaciones": row[26],
        "correlativo": row[27], "id_calidad": row[28],
        "seguimientos": [
            {"id": s[0], "usuario": s[1], "comentario": s[2],
             "estado_anterior": s[3], "estado_nuevo": s[4], "fecha": s[5]}
            for s in seguimientos
        ],
        "acciones": [
            {"id": a[0], "tipo": a[1], "descripcion": a[2], "responsable": a[3],
             "fecha_prevista": a[4], "fecha_completada": a[5], "estado": a[6],
             "creado_por": a[7], "fecha_creacion": a[8]}
            for a in acciones
        ],
        "imagenes": [
            {"id": img[0], "filename": img[1], "content_type": img[2],
             "descripcion": img[3], "subido_por": img[4], "fecha_subida": img[5],
             "url": f"/reclamos/{reclamo_id}/imagenes/{img[0]}"}
            for img in imagenes
        ],
    }


@router.patch("/reclamos/{reclamo_id}")
def actualizar_reclamo(reclamo_id: int, body: ReclamoUpdate, user=Depends(get_current_user)):
    """Actualizar campos de un reclamo. Si cambia estado, crea seguimiento automático."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    if body.estado and body.estado not in ESTADOS_RECLAMO:
        raise HTTPException(status_code=400, detail=f"Estado inválido. Válidos: {list(ESTADOS_RECLAMO)}")
    if body.prioridad and body.prioridad not in PRIORIDADES:
        raise HTTPException(status_code=400, detail=f"Prioridad inválida. Válidas: {list(PRIORIDADES)}")
    if body.categoria_ishikawa and body.categoria_ishikawa not in CATEGORIAS_ISHIKAWA:
        raise HTTPException(status_code=400, detail=f"Categoría inválida. Válidas: {list(CATEGORIAS_ISHIKAWA)}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, estado FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            estado_anterior = row[1]

            sets = ["fecha_actualizacion = %s"]
            params = [now]

            updatable = [
                "titulo", "descripcion", "prioridad", "categoria_ishikawa",
                "sub_causa", "cod_causa", "responsable", "aplica",
                "detectado_por", "fecha_deteccion", "fecha_analisis",
                "analista", "area_aplica", "explicacion_causa",
                "accion_correctiva", "accion_preventiva", "resolucion", "observaciones",
                "id_calidad",
            ]
            # Fields where empty string should be stored as NULL
            nullable_fields = {"id_calidad", "sub_causa", "cod_causa", "responsable",
                               "detectado_por", "fecha_deteccion", "fecha_analisis",
                               "analista", "area_aplica", "explicacion_causa",
                               "accion_correctiva", "accion_preventiva", "resolucion", "observaciones"}
            for field in updatable:
                val = getattr(body, field)
                if val is not None:
                    sets.append(f"{field} = %s")
                    params.append(val if (val != "" or field not in nullable_fields) else None)

            estado_changed = False
            if body.estado and body.estado != estado_anterior:
                sets.append("estado = %s")
                params.append(body.estado)
                estado_changed = True

                # If closing, set fecha_cierre
                if body.estado in ("cerrado", "rechazado"):
                    sets.append("fecha_cierre = %s")
                    params.append(now)
                # If reopening, clear fecha_cierre
                elif estado_anterior in ("cerrado", "rechazado"):
                    sets.append("fecha_cierre = NULL")

            params.append(reclamo_id)
            cur.execute(f"UPDATE reclamos SET {', '.join(sets)} WHERE id = %s", params)

            # Auto-create seguimiento for state change
            if estado_changed:
                comment = f"Estado cambiado: {ESTADO_LABELS.get(estado_anterior, estado_anterior)} → {ESTADO_LABELS.get(body.estado, body.estado)}"
                cur.execute("""
                    INSERT INTO reclamo_seguimientos (reclamo_id, usuario, comentario, estado_anterior, estado_nuevo, fecha)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (reclamo_id, email, comment, estado_anterior, body.estado, now))

    campos = [s.split(" =")[0] for s in sets if s != "fecha_actualizacion = %s"]
    audit(email, "actualizar_reclamo", f"campos: {', '.join(campos)}", "reclamo", str(reclamo_id))
    return {"ok": True, "id": reclamo_id}


@router.delete("/reclamos/{reclamo_id}")
def eliminar_reclamo(reclamo_id: int, user=Depends(get_current_user)):
    """Eliminar un reclamo y todos sus datos asociados."""
    email = user.get("email", "unknown")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, titulo FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            titulo = row[1]
            cur.execute("DELETE FROM reclamo_imagenes WHERE reclamo_id = %s", (reclamo_id,))
            cur.execute("DELETE FROM reclamo_acciones WHERE reclamo_id = %s", (reclamo_id,))
            cur.execute("DELETE FROM reclamo_seguimientos WHERE reclamo_id = %s", (reclamo_id,))
            cur.execute("DELETE FROM reclamos WHERE id = %s", (reclamo_id,))

    audit(email, "eliminar_reclamo", titulo, "reclamo", str(reclamo_id))
    return {"ok": True, "id": reclamo_id}


# ========================= SEGUIMIENTOS =========================

@router.post("/reclamos/{reclamo_id}/seguimientos")
def crear_seguimiento(reclamo_id: int, body: SeguimientoCreate, user=Depends(get_current_user)):
    """Agregar un seguimiento (comentario) a un reclamo. Opcionalmente cambia estado."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

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

    audit(email, "seguimiento_reclamo", body.comentario[:100] if body.comentario else "", "reclamo", str(reclamo_id))
    return {"ok": True, "id": seg_id}


# ========================= ACCIONES =========================

@router.post("/reclamos/{reclamo_id}/acciones")
def crear_accion(reclamo_id: int, body: AccionCreate, user=Depends(get_current_user)):
    """Agregar una acción (inmediata/correctiva/preventiva) a un reclamo."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    if body.tipo not in TIPOS_ACCION:
        raise HTTPException(status_code=400, detail=f"Tipo inválido. Válidos: {list(TIPOS_ACCION)}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM reclamos WHERE id = %s", (reclamo_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")

            cur.execute("""
                INSERT INTO reclamo_acciones (reclamo_id, tipo, descripcion, responsable, fecha_prevista, creado_por, fecha_creacion)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (reclamo_id, body.tipo, body.descripcion, body.responsable, body.fecha_prevista, email, now))
            accion_id = cur.fetchone()[0]

            cur.execute("UPDATE reclamos SET fecha_actualizacion = %s WHERE id = %s", (now, reclamo_id))

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
    audit(email, "eliminar_accion_reclamo", str(accion_id), "reclamo", str(reclamo_id))
    return {"ok": True}


# ========================= IMAGENES =========================

@router.post("/reclamos/{reclamo_id}/imagenes")
async def subir_imagen(
    reclamo_id: int,
    file: UploadFile = File(...),
    descripcion: Optional[str] = Form(None),
    user=Depends(get_current_user),
):
    """Subir una imagen/evidencia a un reclamo. Se almacena en BD como BYTEA."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail=f"Tipo de archivo no permitido. Permitidos: {ALLOWED_IMAGE_TYPES}")

    data = await file.read()
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail=f"Imagen demasiado grande. Máximo: {MAX_IMAGE_SIZE // (1024*1024)} MB")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM reclamos WHERE id = %s", (reclamo_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")

            cur.execute("""
                INSERT INTO reclamo_imagenes (reclamo_id, filename, content_type, data, descripcion, subido_por, fecha_subida)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (reclamo_id, file.filename, file.content_type, data, descripcion, email, now))
            img_id = cur.fetchone()[0]

            cur.execute("UPDATE reclamos SET fecha_actualizacion = %s WHERE id = %s", (now, reclamo_id))

    audit(email, "subir_imagen_reclamo", file.filename, "reclamo", str(reclamo_id))
    return {"ok": True, "id": img_id, "filename": file.filename}


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
    audit(email, "eliminar_imagen_reclamo", str(imagen_id), "reclamo", str(reclamo_id))
    return {"ok": True}
