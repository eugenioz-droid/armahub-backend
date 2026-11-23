"""
Los pedidos de reemplazo: hay una entrega por plano, y otro cubicador que también lo terminó le pide
al autor que acepte el reemplazo (desde ArmaScanner, o un administrador por él en el portal).
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from ..auth import get_current_user
from ..db import audit, get_conn
from ..licencias import _bearer
from .acceso import _con_licencia_o_admin, _es_admin, _usuario
from .comun import PlanoEnLinea, _avisar, _cuando, _nombres
from .datos import _entrega, _fila_base, _rotulo

router = APIRouter()


# ── Pedidos de reemplazo: el plano lo tiene otro cubicador y yo también lo terminé ──
# Lo pido; su autor acepta (o rechaza) desde ArmaScanner, o un administrador responde por él en el
# portal. Aceptar no borra nada: su entrega sigue vigente hasta que yo termine el plano, y entonces la
# mía la reemplaza. Estados: pendiente · aceptado · rechazado · cumplido · anulado.
@router.post("/armascanner/planos/reemplazo/pedir")
def pedir_reemplazo(datos: PlanoEnLinea, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Pide al autor de la entrega del plano que acepte el reemplazo y le avisa en la campana. Si ya
    hay un pedido mío pendiente o aceptado, responde su estado (no pide dos veces)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            email = user["email"]
            _fila_base(cur, datos.obra, datos.plano, exclusiva=True)
            entrega = _entrega(cur, datos.obra, datos.plano)
            if not entrega or entrega["autor"] == email:
                raise HTTPException(status_code=409, detail="Este plano no tiene la versión de otro cubicador: "
                                                            "puedes terminarlo.")
            # un pedido mío sobre la entrega de otro autor (ya no está) deja de correr
            cur.execute("""UPDATE planos_obra_reemplazos SET estado = 'anulado', respondido_el = NOW()
                            WHERE id_proyecto = %s AND plano = %s AND solicitante = %s AND autor <> %s
                              AND estado IN ('pendiente', 'aceptado')""", (datos.obra, datos.plano, email, entrega["autor"]))
            cur.execute("""SELECT estado FROM planos_obra_reemplazos
                            WHERE id_proyecto = %s AND plano = %s AND solicitante = %s
                              AND estado IN ('pendiente', 'aceptado')""", (datos.obra, datos.plano, email))
            ya = cur.fetchone()
            if ya:
                return {"ok": True, "estado": ya[0]}
            cur.execute("""INSERT INTO planos_obra_reemplazos (id_proyecto, plano, solicitante, autor, estado)
                           VALUES (%s, %s, %s, %s, 'pendiente')""", (datos.obra, datos.plano, email, entrega["autor"]))
            aviso = f"{_nombres(cur, [email]).get(email, email)} pide reemplazar tu versión de " \
                    f"{_rotulo(cur, datos.obra, datos.plano)}."
    _avisar([entrega["autor"]], aviso)
    audit(email, "armascanner_reemplazo", f"{datos.plano}: pide reemplazar la de {entrega['autor']}", "proyecto", datos.obra)
    return {"ok": True, "estado": "pendiente"}


@router.get("/armascanner/planos/reemplazos")
def mis_reemplazos(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """`para_mi`: los pedidos pendientes sobre mis entregas (para aceptar o rechazar). `mios`: mis
    pedidos que siguen corriendo o que me rechazaron (el último por plano)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            yo = user["email"]
            # sólo los pedidos sobre la entrega que está (la de su autor de hoy)
            cur.execute("""SELECT r.id_proyecto, r.plano, r.solicitante, r.autor, r.estado, r.creado_el, r.respondido_el
                             FROM planos_obra_reemplazos r
                             JOIN planos_obra_entregas e
                               ON e.id_proyecto = r.id_proyecto AND e.plano = r.plano AND e.autor = r.autor
                            WHERE (r.autor = %s AND r.estado = 'pendiente') OR r.solicitante = %s
                            ORDER BY r.id""", (yo, yo))
            filas = cur.fetchall()
            claves = sorted({f[0] for f in filas})
            rotulos = {}
            if claves:
                cur.execute("""SELECT p.id_proyecto, p.plano, p.numero, COALESCE(pr.nombre_proyecto, p.id_proyecto)
                                 FROM planos_obra p LEFT JOIN proyectos pr ON pr.id_proyecto = p.id_proyecto
                                WHERE p.id_proyecto = ANY(%s)""", (claves,))
                rotulos = {(f[0], f[1]): (f[2] or "", f[3]) for f in cur.fetchall()}
            nombres = _nombres(cur, [f[2] for f in filas] + [f[3] for f in filas])
    para_mi, mios = [], {}
    for obra, plano, solicitante, autor, estado, creado, respondido in filas:
        numero, obra_nombre = rotulos.get((obra, plano), ("", obra))
        base = {"obra": obra, "obra_nombre": obra_nombre, "plano": plano, "numero": numero, "creado_el": _cuando(creado)}
        if autor == yo and estado == "pendiente":
            para_mi.append(dict(base, solicitante=nombres.get(solicitante, solicitante), solicitante_email=solicitante))
        if solicitante == yo:  # el último por plano (uno anulado no deja ver un rechazo anterior)
            mios[(obra, plano)] = dict(base, autor=nombres.get(autor, autor), autor_email=autor, estado=estado,
                                       respondido_el=_cuando(respondido))
    return {"para_mi": para_mi,
            "mios": [x for x in mios.values() if x["estado"] in ("pendiente", "aceptado", "rechazado")]}


class RespuestaReemplazo(BaseModel):
    obra: str
    plano: str
    solicitante: str      # su correo o su nombre
    acepta: bool


def _responder(email: str, admin: bool, datos: RespuestaReemplazo) -> dict:
    """Acepta o rechaza un pedido de reemplazo: el autor de la entrega o, en su lugar, un
    administrador. Aceptar no borra nada. Avisa al solicitante."""
    nuevo = "aceptado" if datos.acepta else "rechazado"
    with get_conn() as conn:
        with conn.cursor() as cur:
            _fila_base(cur, datos.obra, datos.plano, exclusiva=True)
            entrega = _entrega(cur, datos.obra, datos.plano)
            if not entrega:
                raise HTTPException(status_code=404, detail="Este plano no tiene una versión que reemplazar.")
            if entrega["autor"] != email and not admin:
                raise HTTPException(status_code=403, detail="Responde el pedido quien subió el plano o un administrador.")
            pedido, nombres = _pedido_de(cur, datos, entrega["autor"], email)
            if pedido[2] == nuevo:  # ya estaba así (la respuesta llegó dos veces)
                return {"ok": True, "estado": nuevo}
            if pedido[2] != "pendiente":
                raise HTTPException(status_code=409, detail="Ese pedido de reemplazo ya fue respondido.")
            cur.execute("""UPDATE planos_obra_reemplazos SET estado = %s, respondido_por = %s, respondido_el = NOW()
                            WHERE id = %s""", (nuevo, email, pedido[0]))
            aviso = f"{nombres.get(email, email)} {'aceptó' if datos.acepta else 'rechazó'} que reemplaces " \
                    f"{_rotulo(cur, datos.obra, datos.plano)}."
    _avisar([pedido[1]], aviso)
    audit(email, "armascanner_reemplazo", f"{datos.plano}: {nuevo} el pedido de {pedido[1]}"
          + (f" (en lugar de {entrega['autor']})" if email != entrega["autor"] else ""), "proyecto", datos.obra)
    return {"ok": True, "estado": nuevo}


def _pedido_de(cur, datos: RespuestaReemplazo, autor: str, email: str) -> tuple:
    """((id, solicitante, estado) del último pedido de `datos.solicitante` —su correo o su nombre— sobre la
    entrega de `autor`, {correo: nombre}). 404 si no está."""
    cur.execute("""SELECT id, solicitante, estado FROM planos_obra_reemplazos
                    WHERE id_proyecto = %s AND plano = %s AND autor = %s
                      AND estado IN ('pendiente', 'aceptado', 'rechazado')
                    ORDER BY id DESC""", (datos.obra, datos.plano, autor))
    pedidos = cur.fetchall()
    nombres = _nombres(cur, [f[1] for f in pedidos] + [email])
    quien = datos.solicitante.strip()
    pedido = next((f for f in pedidos if quien and quien in (f[1], nombres.get(f[1]))), None)
    if not pedido:
        raise HTTPException(status_code=404, detail="Ese pedido de reemplazo no está en ArmaHub.")
    return pedido, nombres


@router.post("/armascanner/planos/reemplazo/responder")
def responder_reemplazo(datos: RespuestaReemplazo, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Desde ArmaScanner: el autor de la entrega acepta o rechaza el pedido."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
    return _responder(user["email"], False, datos)


@router.post("/armascanner/planos-linea/reemplazo/responder")
def responder_reemplazo_portal(datos: RespuestaReemplazo, user=Depends(get_current_user)):
    """Desde el portal: el autor de la entrega o, en su lugar, un administrador (si el primer
    cubicador no está) acepta o rechaza el pedido. Queda en la auditoría."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
    return _responder(user.get("email", ""), _es_admin(user), datos)
