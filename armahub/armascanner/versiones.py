"""
Instalar y Versiones: mi licencia y mis equipos, la versión vigente y su descarga, la actualización que
pide ArmaScanner, y publicar o retirar versiones (mig 168).

Versiones: descargar, publicar y actualizar (mig 168)
La vigente es la activa más nueva. Las versiones se comparan por sus números (clave_version): AAAA-MM-DD (y
AAAA-MM-DD.N si sale más de una el mismo día), que es licencia.VERSION en ArmaScanner.
"""

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from ..auth import get_current_user, require_admin_or_admin_calidad
from ..db import audit, get_conn
from ..licencias import _bearer
from .acceso import PRODUCTO, _con_licencia_o_admin, _es_admin, _usuario
from .comun import DESCARGA_SEGUNDOS, _borrar

router = APIRouter()


@router.get("/armascanner/mi-licencia")
def mi_licencia(user=Depends(get_current_user)):
    """Instalar: mi licencia (vencimiento) y mis equipos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("""
                SELECT l.id, l.activa, l.vence, COALESCE(l.max_equipos, 2)
                  FROM licencias l JOIN users u ON u.id = l.user_id
                 WHERE u.email = %s AND l.producto = %s
            """, (user.get("email", ""), PRODUCTO))
            row = cur.fetchone()
            equipos = []
            if row:
                cur.execute("""SELECT equipo, ultimo_uso, version FROM licencia_equipos
                                WHERE licencia_id = %s ORDER BY primer_uso""", (row[0],))
                equipos = [{"equipo": e, "ultimo_uso": u.isoformat() if u else None, "version": v}
                           for e, u, v in cur.fetchall()]
    return {"activa": bool(row and row[1]), "vence": row[2].isoformat() if row and row[2] else None,
            "max_equipos": row[3] if row else 2, "equipos": equipos}


def clave_version(version: str) -> tuple:
    """«2026-11-20.10» → (2026, 11, 20, 10). Las versiones se comparan por sus números: como texto,
    «.10» queda antes que «.9» y la versión nueva no se ofrecería nunca."""
    import re
    return tuple(int(x) for x in re.findall(r"\d+", version or ""))


def _vigente(cur):
    """La versión activa más nueva (por número, no por texto)."""
    cur.execute("""SELECT id, version, archivo, tamano, notas, obligatoria, publicada_el
                     FROM armascanner_versiones WHERE activa""")
    filas = cur.fetchall()
    return max(filas, key=lambda f: clave_version(f[1])) if filas else None


def _nombre_instalador(version: str) -> str:
    """El ZIP que se publica: la aplicación en su carpeta; se instala sola al abrirla. No un
    instalador de un solo .exe: ése lo borra el antivirus de la empresa (Trend Micro, 19-nov)."""
    return f"ArmaScanner-{version}.zip"


def _enlace(fila) -> str:
    from .. import storage
    return storage.generate_presigned_url(fila[2], expires=DESCARGA_SEGUNDOS,
                                          descargar_como=_nombre_instalador(fila[1]))


def _version_dict(fila, con_enlace=False) -> dict:
    d = {"id": fila[0], "version": fila[1], "tamano": fila[3], "notas": fila[4] or "",
         "obligatoria": bool(fila[5]), "publicada_el": fila[6].isoformat() if fila[6] else None}
    if con_enlace:
        d["url"] = _enlace(fila)
    return d


@router.get("/armascanner/descarga")
def descarga(user=Depends(get_current_user)):
    """Instalar: la versión vigente y su enlace de descarga (vale DESCARGA_SEGUNDOS)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            fila = _vigente(cur)
    if not fila:
        return {"version": None}
    audit(user.get("email", "?"), "armascanner_descarga", fila[1], "armascanner", fila[1])
    return _version_dict(fila, con_enlace=True)


# Hasta la 2026-11-20.10 (empaquetada con Nuitka), «Actualizar» abre la versión nueva como «ArmaScanner.exe
# --instalar --esperar <pid>». Desde la .11, ArmaScanner.exe es el Python oficial (firmado), que rechaza esas
# opciones: la nueva no arranca, la vieja se cierra y, al abrirla, vuelve a pedir la misma actualización. Ese
# código está en el equipo del cubicador y no se puede cambiar desde aquí: a esas versiones se les dice, en
# las notas que su ventana de actualización muestra, cómo instalarla a mano (una sola vez; desde ahí se
# actualiza sola). [Usuario 23-nov: «siempre le pide actualizar la misma versión, es un bug»]
SIN_PUENTE = "2026-11-20.11"
INSTALAR_A_MANO = ("Tu versión no puede instalar ésta sola. Una sola vez: cierra ArmaScanner, entra a ArmaHub › "
                   "ArmaScanner › Instalar › «Descargar», extrae el ZIP y abre ArmaScanner.exe › «Instalar». "
                   "Desde ahí se actualiza solo.")


def notas_para(version: str, notas: str) -> str:
    """Las notas de la actualización que ve quien tiene `version`. Función pura."""
    return INSTALAR_A_MANO if clave_version(version) < clave_version(SIN_PUENTE) else notas


@router.get("/armascanner/actualizacion")
def actualizacion(version: str = "", credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """ArmaScanner pregunta, con su ficha, si hay una versión más nueva que la suya. Si la hay,
    va con su enlace de descarga: el botón «Actualizar» la baja e instala."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _usuario(cur, credentials.credentials)
            fila = _vigente(cur)
    if not fila or not version or clave_version(fila[1]) <= clave_version(version):
        return {"hay": False, "version": fila[1] if fila else None}
    v = _version_dict(fila, con_enlace=True)
    return dict(v, hay=True, notas=notas_para(version, v["notas"]))


@router.get("/armascanner/versiones")
def versiones(admin=Depends(require_admin_or_admin_calidad)):
    """Versiones: todas, la más nueva primero."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, version, archivo, tamano, notas, obligatoria, publicada_el, activa, publicada_por
                             FROM armascanner_versiones""")
            filas = sorted(cur.fetchall(), key=lambda f: clave_version(f[1]), reverse=True)
            vig = _vigente(cur)
    return {"vigente": vig[1] if vig else None,
            "versiones": [dict(_version_dict(f), activa=f[7], publicada_por=f[8]) for f in filas]}


@router.post("/armascanner/versiones")
def publicar(archivo: UploadFile = File(...), version: str = Form(...), notas: str = Form(""),
                   obligatoria: bool = Form(False), admin=Depends(require_admin_or_admin_calidad)):
    """Publicar una versión: el ZIP (ArmaScanner/empaquetar/construir.py) va a R2 y queda vigente."""
    return _publicar(admin.get("email", ""), archivo, version, notas, obligatoria)


@router.post("/armascanner/versiones-ficha")
def publicar_con_ficha(archivo: UploadFile = File(...), version: str = Form(...), notas: str = Form(""),
                       obligatoria: bool = Form(False), retirar: str = Form(""),
                       credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Publicar con la ficha de ArmaScanner de un administrador (desde su equipo, sin la clave del
    portal), y retirar en el mismo paso las versiones de `retirar` (separadas por coma). Queda en la
    auditoría como cualquier publicación. [Usuario 20-nov: «no puedes publicar sin mí?» → «sí, dale»]"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
    if not _es_admin(user):
        raise HTTPException(status_code=403, detail="Publicar una versión es de administrador.")
    r = _publicar(user["email"], archivo, version, notas, obligatoria)
    viejas = [v.strip() for v in (retirar or "").split(",") if v.strip() and v.strip() != r["version"]]
    if viejas:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE armascanner_versiones SET activa = FALSE WHERE version = ANY(%s) RETURNING version",
                            (viejas,))
                r["retiradas"] = [f[0] for f in cur.fetchall()]
        if r["retiradas"]:
            audit(user["email"], "armascanner_version", f"retiradas: {', '.join(r['retiradas'])}", "armascanner",
                  r["version"])
    return r


def _publicar(email: str, archivo: UploadFile, version: str, notas: str, obligatoria: bool) -> dict:
    from .. import storage
    version = _version_nueva(version, archivo)
    # una key por subida (como clave_paquete): si la base no confirma, se borra sólo lo subido aquí, nunca
    # el archivo de otra publicación de la misma versión que se haya cruzado
    import uuid
    clave = f"armascanner/versiones/{version}/{uuid.uuid4().hex[:12]}/{_nombre_instalador(version)}"
    archivo.file.seek(0, 2)
    tamano = archivo.file.tell()
    archivo.file.seek(0)
    try:
        storage.upload_fileobj(clave, archivo.file, "application/zip")
    except Exception as e:
        _borrar(clave)
        raise HTTPException(status_code=502, detail=f"La versión no se pudo guardar en ArmaHub ({str(e)[:80]}).")
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""INSERT INTO armascanner_versiones (version, archivo, tamano, notas, obligatoria, publicada_por)
                               VALUES (%s, %s, %s, %s, %s, %s)""",
                            (version, clave, tamano, (notas or "").strip()[:2000] or None, obligatoria, email))
    except Exception:
        _borrar(clave)  # la base no confirmó (otra publicación de la misma versión ganó): lo subido no queda suelto
        raise
    audit(email or "?", "armascanner_publicar", f"{version} ({tamano / 1e6:.1f} MB)"
          + (" obligatoria" if obligatoria else ""), "armascanner", version)
    return {"ok": True, "version": version, "tamano": tamano}


def _version_nueva(version: str, archivo: UploadFile) -> str:
    """La versión a publicar, sin espacios: 400 si no va como AAAA-MM-DD(.N) o el archivo no es un ZIP, 409 si
    ya está publicada."""
    import re
    version = (version or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}(\.\d+)?", version):
        raise HTTPException(status_code=400, detail="La versión va como AAAA-MM-DD (o AAAA-MM-DD.2).")
    if not (archivo.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="El archivo debe ser el ZIP de ArmaScanner (.zip).")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM armascanner_versiones WHERE version = %s", (version,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail=f"La versión {version} ya está publicada.")
    return version


class CambioVersion(BaseModel):
    activa: Optional[bool] = None
    obligatoria: Optional[bool] = None
    notas: Optional[str] = None


@router.patch("/armascanner/versiones/{vid}")
def cambiar_version(vid: int, datos: CambioVersion, admin=Depends(require_admin_or_admin_calidad)):
    """Retirar (activa=false) o volver a poner una versión; marcarla obligatoria o no; corregir sus novedades."""
    sets, valores = [], []
    for campo in ("activa", "obligatoria", "notas"):
        v = getattr(datos, campo)
        if campo == "notas" and v is not None:
            v = v.strip()[:2000] or None
            sets.append("notas = %s")
            valores.append(v)
            continue
        if v is not None:
            sets.append(f"{campo} = %s")
            valores.append(v)
    if not sets:
        return {"ok": True}
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE armascanner_versiones SET {', '.join(sets)} WHERE id = %s RETURNING version",
                        valores + [vid])
            fila = cur.fetchone()
    if not fila:
        raise HTTPException(status_code=404, detail="Versión no encontrada.")
    audit(admin.get("email", "?"), "armascanner_version", f"{fila[0]}: {datos.model_dump(exclude_none=True)}",
          "armascanner", fila[0])
    return {"ok": True}
