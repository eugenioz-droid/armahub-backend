# -*- coding: utf-8 -*-
"""
CC CONFIRMADOS MODIFICADOS (24-nov) — la cuarta línea del tab de Auditorías.

QUÉ ATAJA. La planta confirma un código de control con sus kilos y lo agenda. Si después
alguien lo edita en aSa, los kilos programados ya no son los del pedido, y nadie se entera
hasta que el despacho no cuadra. El usuario: «cuando se confirma un CC, pero se le hace un
cambio posteriormente, genera problemas porque los kilos discrepan». Esto lista esos
códigos, Open y Processed, en cada turno del reloj de aSa.

QUÉ SE SABE Y QUÉ NO (medido 24-nov contra aSa real):
  · cuándo se confirmó: `SchedLastModified` (getScheduling), con hora exacta;
  · cuándo se modificó: `LastModifiedTime` (getOrderSummary), con hora exacta;
  · AL CONFIRMAR, LA PLANTA DEJA LA MISMA HORA EN EL PEDIDO. De 156 códigos Open, 134
    quedaron a menos de un minuto de su confirmación y 21 a más de diez: ninguno entre
    medio. Lo que cae dentro de TOLERANCIA es la confirmación misma, no un cambio;
  · QUIÉN EDITÓ: NO. aSa no lo entrega por la API (ni pedido, ni programación, ni barras).
    Se muestra el cubicador a cargo (`DetailPerson`), que es quien normalmente lo edita;
  · QUÉ BARRAS: al guardar un código, TODAS sus barras quedan con la misma hora, aunque se
    haya tocado una. Por eso se compara contra una FOTO propia, tomada al ver el código
    confirmado y todavía sin cambios;
  · LOS KILOS CONFIRMADOS: aSa no los guarda (la programación muestra los de hoy). Van en
    la foto. Un código que se confirmó y se editó entre dos turnos no alcanza a tener foto:
    sale igual, sin kilos al confirmar.

LO QUE CUESTA EN aSa. Dos consultas agregadas por turno, más una por cada foto y una por
cada código que se modificó. Las fotos tienen tope por turno (TOPE_FOTOS): la primera vez
hay unos mil códigos confirmados y aSa corta a las 1.000 llamadas por hora, con ArmaHub en
producción usando el mismo cupo. Se fotografían primero los Open y los más recientes; el
resto en los turnos siguientes.

Sin rutas ni fastapi: las rutas viven en chequeos_api.py, el reloj llama a `revisar`.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

from .db import get_conn

log = logging.getLogger("armahub.cc_confirmados")

# Los estados del pedido que se miran. Processed también: un cambio ahí es peor, porque el
# código ya se está fabricando (decisión del usuario, 24-nov).
ESTADOS = ("Open", "Processed")
# La confirmación deja la misma hora en el pedido (±1 min medido); 5 minutos dan holgura
# sin tapar un cambio real, que en lo medido nunca cayó a menos de diez.
TOLERANCIA = timedelta(minutes=5)
# La primera vez se mira hacia atrás esto; después, desde la última pasada buena con un día
# de solape (LastModified de aSa es sólo la fecha: ver asa_sync.SOLAPE_DIAS).
DIAS_PRIMERA_VEZ = 15
SOLAPE = timedelta(days=1)
TOPE_FOTOS = 100
TOPE_COMPARAR = 60
# getOrderItemView entrega hasta 500 por página (ver auditorias._items_de).
ITEMS_POR_PAGINA = 500
MAX_ITEMS = 5000
CAMPOS_FOTO = ["ElementDesc", "BarMark", "BarSizeDescr", "ShpNameID", "LengthCut",
               "TotalQty", "LineWeight"]
# Cuántas barras de cada lista se guardan; el total va aparte.
TOPE_LISTA = 300
# Diferencia de kilos que se considera cambio (redondeo de aSa).
KG_MINIMO = 0.5
BITACORA = "cc-confirmados"
# Una pasada sin fin más vieja que esto se cortó a la mitad (la primera tardó 6,5 min).
MINUTOS_EN_CURSO = 30

_corriendo = threading.Lock()


# ---------------------------------------------------------------------------
# Reglas (puras: se prueban sin base ni aSa)
# ---------------------------------------------------------------------------
_INSTANTE = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)?$")


def instante(valor) -> Optional[datetime]:
    """Una hora de aSa como datetime con zona. aSa manda siete decimales («.7556496»), que
    `fromisoformat` de Python 3.10 no acepta: los segundos alcanzan."""
    m = _INSTANTE.match(str(valor or "").strip())
    if not m:
        return None
    zona = m.group(2) or "+00:00"
    return datetime.fromisoformat(m.group(1) + ("+00:00" if zona == "Z" else zona))


def modificado_tras(confirmado: Optional[datetime], modificado: Optional[datetime]) -> bool:
    """¿Se editó DESPUÉS de confirmarse? Lo que cae dentro de la tolerancia es la
    confirmación misma, que deja su hora en el pedido."""
    return bool(confirmado and modificado and modificado > confirmado + TOLERANCIA)


def _txt(v) -> str:
    return str(v or "").strip()


def _num(v, decimales: int = 2) -> float:
    return round(float(v or 0), decimales)


def fila_foto(it: dict) -> list:
    """Una barra de aSa como fila de la foto: [elemento, marca, φ, figura, largo, cant, kg]."""
    return [_txt(it.get("ElementDesc")), _txt(it.get("BarMark")), _txt(it.get("BarSizeDescr")),
            _txt(it.get("ShpNameID")), _num(it.get("LengthCut"), 0), _num(it.get("TotalQty")),
            _num(it.get("LineWeight"))]


def _clave(el, marca, diam, fig, largo) -> str:
    """La barra se reconoce por su elemento y su marca. Sin marca (hay códigos enteros así)
    la reconoce lo que es: φ, figura y largo."""
    return "%s|%s" % (el, marca or "%s %s %s" % (diam, fig, largo))


def _por_clave(barras) -> dict:
    """La foto agrupada por barra. Una marca puede venir en varias líneas del mismo
    elemento: se suman cantidad y kilos."""
    out = {}
    for el, marca, diam, fig, largo, cant, kg in barras or []:
        b = out.setdefault(_clave(el, marca, diam, fig, largo),
                           {"elemento": el, "marca": marca, "diam": diam, "figura": fig,
                            "largo": largo, "cant": 0.0, "kg": 0.0})
        b["cant"] = round(b["cant"] + cant, 2)
        b["kg"] = round(b["kg"] + kg, 2)
    return out


def _medidas(b: dict) -> dict:
    return {"diam": b["diam"], "figura": b["figura"], "largo": b["largo"],
            "cant": b["cant"], "kg": b["kg"]}


def diferencias(antes, despues) -> dict:
    """Qué cambió entre la foto y lo de hoy, barra por barra: agregadas, quitadas y
    cambiadas (misma barra con otra cantidad, largo, figura o kilos)."""
    a, d = _por_clave(antes), _por_clave(despues)
    agregadas = [d[k] for k in sorted(d) if k not in a]
    quitadas = [a[k] for k in sorted(a) if k not in d]
    cambiadas = [{"elemento": d[k]["elemento"], "marca": d[k]["marca"],
                  "antes": _medidas(a[k]), "despues": _medidas(d[k])}
                 for k in sorted(d) if k in a and _medidas(a[k]) != _medidas(d[k])]
    return {"agregadas": agregadas[:TOPE_LISTA], "quitadas": quitadas[:TOPE_LISTA],
            "cambiadas": cambiadas[:TOPE_LISTA],
            "n": {"agregadas": len(agregadas), "quitadas": len(quitadas),
                  "cambiadas": len(cambiadas)}}


def hay_cambio(cambios: Optional[dict], kg_antes, kg_hoy) -> bool:
    """¿El cambio toca lo que se fabrica? Sin foto no se puede saber: cuenta. Con foto, un
    código re-guardado sin barras distintas ni kilos distintos (una fecha, un comentario)
    no es lo que se busca."""
    if cambios is None or kg_antes is None:
        return True
    n = cambios.get("n") or {}
    return any(n.values()) or abs(float(kg_hoy or 0) - float(kg_antes)) >= KG_MINIMO


def foto_vigente(previo: dict) -> bool:
    """¿La foto sigue siendo el estado de hoy? Importa cuando la planta vuelve a confirmar:
    si hubo cambios después de la foto, la confirmación nueva es de otra cosa. (Para comparar
    contra la confirmación de la foto, en cambio, la foto vale siempre.)"""
    foto, mod = previo.get("foto_el"), previo.get("mod_visto")
    return bool(foto) and not (mod and mod > foto)


# ---------------------------------------------------------------------------
# Lo que se lee de aSa
# ---------------------------------------------------------------------------
def _sumar_programacion(out: dict, f: dict):
    """Una fila de la programación. Un código trae varias (una por carga): los kilos se
    suman todos, y la confirmación es la más reciente de las filas confirmadas."""
    cc = _txt(f.get("CtrlCode"))
    if not cc:
        return
    c = out.setdefault(cc, {"estado": f.get("OrderStatus"), "conf": None, "kg": 0.0})
    c["kg"] = round(c["kg"] + float(f.get("Kgs") or 0), 2)
    conf = instante(f.get("SchedLastModified"))
    if f.get("SchedStatusDescr") == "Confirmed" and conf and (c["conf"] is None or conf > c["conf"]):
        c["conf"] = conf


def leer_confirmados() -> dict:
    """{cc: {estado, conf, kg}} de los códigos Open y Processed confirmados en planta. Los
    kilos son los del código entero, también de las cargas que no están confirmadas."""
    from . import asa
    filas = asa.consultar_agregado(
        "getScheduling", ["CtrlCode", "OrderStatus", "SchedStatusDescr", "SchedLastModified"],
        "TotalWeight", alias="Kgs",
        filtro=" or ".join("OrderStatus eq '%s'" % e for e in ESTADOS), carga=True)
    out = {}
    for f in filas:
        _sumar_programacion(out, f)
    return {cc: c for cc, c in out.items() if c["conf"] is not None}


def leer_modificaciones(desde: datetime) -> dict:
    """{cc: hora de la última modificación} de lo modificado desde `desde`."""
    from . import asa
    filas = asa.consultar_agregado(
        "getOrderSummary", ["ControlCode", "LastModifiedTime"], "TotalKgs", alias="Kgs",
        filtro="LastModified ge %s" % desde.strftime("%Y-%m-%dT00:00:00Z"), carga=True)
    out = {}
    for f in filas:
        cc, m = _txt(f.get("ControlCode")), instante(f.get("LastModifiedTime"))
        if cc and m and (cc not in out or m > out[cc]):
            out[cc] = m
    return out


def leer_barras(cc: str) -> list:
    """Las barras de un código, como filas de foto. Paginado: hay códigos de más de 500."""
    from . import asa
    filas, skip = [], 0
    while len(filas) < MAX_ITEMS:
        pagina = asa.consultar("getOrderItemView", select=CAMPOS_FOTO,
                               filtro="CtrlCode eq '%s'" % cc.replace("'", "''"),
                               top=ITEMS_POR_PAGINA, skip=skip, orderby="OrderItemKey")
        filas.extend(pagina)
        if len(pagina) < ITEMS_POR_PAGINA:
            break
        skip += len(pagina)
    return [fila_foto(f) for f in filas]


# ---------------------------------------------------------------------------
# La pasada
# ---------------------------------------------------------------------------
def _desde(cur) -> datetime:
    cur.execute("SELECT MAX(fin) FROM asa_sync WHERE ok AND endpoint = %s", (BITACORA,))
    ultima = cur.fetchone()[0]
    if ultima is None:
        return datetime.now(timezone.utc) - timedelta(days=DIAS_PRIMERA_VEZ)
    return ultima - SOLAPE


def _previos(cur) -> dict:
    cur.execute("""SELECT control_code, estado, confirmado_el, foto_el, kg_foto, mod_visto
                     FROM cc_confirmados""")
    return {r[0]: {"estado": r[1], "confirmado_el": r[2], "foto_el": r[3],
                   "kg_foto": float(r[4]) if r[4] is not None else None, "mod_visto": r[5]}
            for r in cur.fetchall()}


def _datos_pedidos(cur, ccs: list) -> dict:
    """La obra, la descripción y el cubicador a cargo, del espejo que el reloj acaba de
    refrescar."""
    cur.execute("""SELECT control_code, job_name, descr, detail_person
                     FROM asa_pedidos WHERE control_code = ANY(%s)""", (ccs,))
    return {r[0]: {"obra": r[1], "descr": r[2], "cubicador": r[3]} for r in cur.fetchall()}


def _orden(confirmados: dict) -> list:
    """Primero los Open, y dentro de cada estado lo confirmado más recién: si el tope de
    fotos corta, corta en lo que menos importa."""
    return sorted(confirmados, key=lambda cc: (confirmados[cc]["estado"] != "Open",
                                               -confirmados[cc]["conf"].timestamp()))


def _guardar_confirmado(cur, cc: str, c: dict, p: dict):
    cur.execute(
        """INSERT INTO cc_confirmados (control_code, estado, confirmado_el, foto_el, kg_foto,
                                       mod_visto, visto_el)
           VALUES (%s, %s, %s, %s, %s, %s, now())
           ON CONFLICT (control_code) DO UPDATE SET
               estado = EXCLUDED.estado, confirmado_el = EXCLUDED.confirmado_el,
               foto_el = EXCLUDED.foto_el, kg_foto = EXCLUDED.kg_foto,
               mod_visto = EXCLUDED.mod_visto, visto_el = now()""",
        (cc, c["estado"], c["conf"], p.get("foto_el"), p.get("kg_foto"), p.get("mod_visto")))


def _guardar_foto(cur, cc: str, c: dict, p: dict, barras: list):
    p.update(foto_el=datetime.now(timezone.utc), kg_foto=c["kg"])
    _guardar_confirmado(cur, cc, c, p)
    cur.execute("UPDATE cc_confirmados SET barras = %s WHERE control_code = %s",
                (json.dumps(barras, ensure_ascii=False), cc))


def _registrar(cur, cc: str, c: dict, mod: datetime, dato: dict, kg_conf, cambios):
    """El cambio, una fila por confirmación. Si ya estaba, se actualiza y se reabre: un
    cambio nuevo sobre algo dado por resuelto es una noticia nueva."""
    cur.execute(
        """INSERT INTO cc_modificados (control_code, confirmado_el, modificado_el, estado, obra,
                                       descr, cubicador, kg_confirmado, kg_actual, cambios)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (control_code, confirmado_el) DO UPDATE SET
               modificado_el = EXCLUDED.modificado_el, estado = EXCLUDED.estado,
               obra = EXCLUDED.obra, descr = EXCLUDED.descr, cubicador = EXCLUDED.cubicador,
               kg_actual = EXCLUDED.kg_actual, cambios = EXCLUDED.cambios,
               resuelto_por = NULL, resuelto_el = NULL""",
        (cc, c["conf"], mod, c["estado"], dato.get("obra"), dato.get("descr"),
         dato.get("cubicador"), kg_conf, c["kg"],
         json.dumps(cambios, ensure_ascii=False) if cambios is not None else None))


def _marcar_reprogramado(cur, cc: str, conf: datetime):
    """La planta volvió a tocar la programación después del cambio: queda anotado en lo
    detectado antes, que sigue en la lista hasta que alguien lo dé por resuelto."""
    cur.execute("""UPDATE cc_modificados SET reprogramado_el = %s
                    WHERE control_code = %s AND reprogramado_el IS NULL AND modificado_el < %s""",
                (conf, cc, conf))


class _Pasada:
    """Lo que dura una pasada: la conexión, lo ya sabido y el presupuesto de llamadas."""

    def __init__(self, conn, confirmados: dict, mods: dict):
        self.conn, self.confirmados, self.mods = conn, confirmados, mods
        self.cuenta = {"confirmados": len(confirmados), "detectados": 0, "fotos": 0,
                       "comparados": 0, "sin_foto": 0}

    def correr(self) -> dict:
        with self.conn.cursor() as cur:
            previos = _previos(cur)
            datos = _datos_pedidos(cur, list(self.confirmados))
        for cc in _orden(self.confirmados):
            llamadas = self.cuenta["fotos"] + self.cuenta["comparados"]
            with self.conn.cursor() as cur:
                self._uno(cur, cc, previos.get(cc), datos.get(cc, {}))
            # Lo que costó una llamada a aSa se guarda al tiro: si aSa corta a la mitad, lo
            # hecho queda. Lo demás va al final, de una vez.
            if self.cuenta["fotos"] + self.cuenta["comparados"] > llamadas:
                self.conn.commit()
        self.conn.commit()
        return self.cuenta

    def _uno(self, cur, cc: str, previo: Optional[dict], dato: dict):
        c, mod = self.confirmados[cc], self.mods.get(cc)
        tocado = modificado_tras(c["conf"], mod)
        p = self._al_dia(cur, cc, c, previo)
        if tocado and mod != p.get("mod_visto"):
            self._cambio(cur, cc, c, p, mod, dato)
        elif not tocado and not p.get("foto_el") and self.cuenta["fotos"] < TOPE_FOTOS:
            self._foto(cur, cc, c, p)
        elif p != previo:
            # Sin novedad no se escribe: son mil códigos por turno y casi todos siguen igual.
            _guardar_confirmado(cur, cc, c, p)

    def _al_dia(self, cur, cc: str, c: dict, previo: Optional[dict]) -> dict:
        """Lo sabido del código, puesto al día con esta confirmación. Un código nuevo, o
        uno que la planta volvió a confirmar con cambios encima de la foto, queda sin foto."""
        p = dict(previo or {}, estado=c["estado"])
        if previo is not None and previo["confirmado_el"] != c["conf"]:
            _marcar_reprogramado(cur, cc, c["conf"])
            if not foto_vigente(p):
                p.update(foto_el=None, kg_foto=None)
        p["confirmado_el"] = c["conf"]
        return p

    def _cambio(self, cur, cc: str, c: dict, p: dict, mod: datetime, dato: dict):
        """Lo modificado se compara SIEMPRE contra la foto de su confirmación, aunque se haya
        editado más de una vez: lo que importa es cuánto se alejó de lo que planta agendó."""
        con_foto = bool(p.get("foto_el"))
        if con_foto and self.cuenta["comparados"] >= TOPE_COMPARAR:
            _guardar_confirmado(cur, cc, c, p)   # se compara en el turno siguiente
            return
        cambios = self._comparar(cur, cc) if con_foto else None
        kg_conf = p.get("kg_foto") if con_foto else None
        p["mod_visto"] = mod
        _guardar_confirmado(cur, cc, c, p)
        if hay_cambio(cambios, kg_conf, c["kg"]):
            _registrar(cur, cc, c, mod, dato, kg_conf, cambios)
            self.cuenta["detectados"] += 1
            self.cuenta["sin_foto"] += cambios is None

    def _comparar(self, cur, cc: str) -> dict:
        cur.execute("SELECT barras FROM cc_confirmados WHERE control_code = %s", (cc,))
        fila = cur.fetchone()
        self.cuenta["comparados"] += 1
        return diferencias((fila[0] if fila else None) or [], leer_barras(cc))

    def _foto(self, cur, cc: str, c: dict, p: dict):
        # Con el tope alcanzado no se llega acá: el código queda registrado sin foto y se
        # fotografía en el turno siguiente (ver _uno).
        self.cuenta["fotos"] += 1
        _guardar_foto(cur, cc, c, p, leer_barras(cc))


def revisar(lanzado_por: str = "reloj") -> dict:
    """Una pasada completa. Nunca dos a la vez: el reloj y el botón comparten el candado."""
    if not _corriendo.acquire(blocking=False):
        return {"ok": False, "motivo": "Ya hay una revisión corriendo."}
    try:
        return _revisar(lanzado_por)
    finally:
        _corriendo.release()


def corriendo() -> bool:
    return _corriendo.locked()


def _revisar(lanzado_por: str) -> dict:
    from .asa_sync import _abrir_bitacora, _cerrar_bitacora
    with get_conn() as conn:
        with conn.cursor() as cur:
            desde = _desde(cur)
            sync_id = _abrir_bitacora(cur, BITACORA, lanzado_por)
    try:
        confirmados = leer_confirmados()
        mods = leer_modificaciones(desde)
        with get_conn() as conn:
            r = _Pasada(conn, confirmados, mods).correr()
    except Exception as e:
        _cerrar_bitacora(sync_id, False, detalle=str(e))
        raise
    _cerrar_bitacora(sync_id, True, r["confirmados"], r["detectados"])
    log.info("CC confirmados: %(confirmados)d confirmados, %(detectados)d modificados "
             "(%(sin_foto)d sin foto), %(fotos)d fotos, %(comparados)d comparados", r)
    return dict(r, ok=True)


# ---------------------------------------------------------------------------
# Lo que lee la pantalla
# ---------------------------------------------------------------------------
def _iso(v):
    return v.isoformat() if v else None


def _fila(r) -> dict:
    return {"id": r[0], "cc": r[1], "confirmado_el": _iso(r[2]), "modificado_el": _iso(r[3]),
            "estado": r[4], "obra": r[5], "descr": r[6], "cubicador": r[7],
            "kg_confirmado": float(r[8]) if r[8] is not None else None,
            "kg_actual": float(r[9]) if r[9] is not None else None,
            "cambios": r[10], "reprogramado_el": _iso(r[11]),
            "resuelto_por": r[12], "resuelto_el": _iso(r[13]), "resuelto_nombre": r[14],
            "estado_hoy": r[15]}


def listar(dias: int) -> dict:
    """Lo detectado en los últimos `dias` (0 = todo), lo más reciente arriba, con el estado de
    hoy del pedido y el nombre de quien lo dio por resuelto."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            d = listar_en(cur, dias)
    d["corriendo"] = corriendo() or bool(d["ultima"] and d["ultima"]["en_curso"])
    return d


def listar_en(cur, dias: int) -> dict:
    cur.execute(
        """SELECT m.id, m.control_code, m.confirmado_el, m.modificado_el, m.estado, m.obra,
                  m.descr, m.cubicador, m.kg_confirmado, m.kg_actual, m.cambios,
                  m.reprogramado_el, m.resuelto_por, m.resuelto_el,
                  NULLIF(TRIM(CONCAT(u.nombre, ' ', u.apellido)), ''), p.estado
             FROM cc_modificados m
             LEFT JOIN users u ON LOWER(u.email) = LOWER(m.resuelto_por)
             LEFT JOIN asa_pedidos p ON p.control_code = m.control_code
            WHERE %s = 0 OR m.modificado_el >= now() - make_interval(days => %s)
            ORDER BY m.modificado_el DESC""", (dias, dias))
    filas = [_fila(r) for r in cur.fetchall()]
    cur.execute("""SELECT fin, ok, detalle, inicio > now() - make_interval(mins => %s)
                     FROM asa_sync WHERE endpoint = %s ORDER BY id DESC LIMIT 1""",
                (MINUTOS_EN_CURSO, BITACORA))
    return {"filas": filas, "ultima": ultima(cur.fetchone())}


def ultima(u) -> Optional[dict]:
    """La última pasada, de la fila (fin, ok, detalle, reciente) de la bitácora. Sin `fin` y
    reciente está CORRIENDO, quizás en otro proceso (el candado es por proceso): mostrarla
    como fallida confundió el 24-nov, con la primera pasada a medio camino. Sin `fin` y
    vieja, se cortó a la mitad: eso sí es una falla."""
    if not u:
        return None
    return {"fin": _iso(u[0]), "ok": bool(u[1]), "detalle": u[2], "en_curso": u[0] is None and bool(u[3])}


def marcar_resuelto(fila_id: int, resuelto: bool, email: str) -> Optional[dict]:
    """Da por resuelto (o reabre) un cambio. Queda quién y cuándo. None si no existe."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            return marcar_en(cur, fila_id, resuelto, email)


def marcar_en(cur, fila_id: int, resuelto: bool, email: str) -> Optional[dict]:
    cur.execute(
        """UPDATE cc_modificados
              SET resuelto_por = %s, resuelto_el = CASE WHEN %s THEN now() END
            WHERE id = %s RETURNING control_code, resuelto_por, resuelto_el""",
        (email if resuelto else None, resuelto, fila_id))
    r = cur.fetchone()
    return {"cc": r[0], "resuelto_por": r[1], "resuelto_el": _iso(r[2])} if r else None
