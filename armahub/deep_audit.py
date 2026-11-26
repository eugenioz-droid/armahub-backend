# -*- coding: utf-8 -*-
"""
AUDITORÍAS › DEEP AUDIT (26-nov, SPECS §16) — fase 1: el motor.

Auditar una obra a fondo, cuando alguien lo decide: una foto de sus CC (estado, kilos, piso,
ciclo, sector, cubicador) y lo que encuentran las reglas. Cada corrida se guarda (deep_audit y
deep_audit_hallazgo) para estudiar la obra en el tiempo (usuario, 26-nov).

LAS REGLAS (SPECS §16.2):
  N1 nombre fuera de norma · N2 marcas fuera del modelo o del orden de A Detailer ·
  D1 CC duplicado · D2 doble pedido · E1 Open estancado · E2 cambios tras confirmar ·
  E3 CC borrado de aSa que ArmaHub sigue mostrando · O1 despacho fuera de secuencia ·
  F1 señales de la Revisión de barras · K1 peso fuera de rango · R1 reprocesos · Q1 reclamos.

EL ESTÁNDAR DEL NOMBRE es el que exporta ArmaHub (export.py): «SECTOR PISO CICLO» en mayúsculas,
con SECTOR = ELEV · LCIELO · VCIELO · FUND. La letra del ciclo la puede definir el cliente (en
OPERA es Z, de zona): lo que se reporta es usar dos letras en la misma obra (usuario, 26-nov:
«el cubicador partió el ciclo 1 como C1 en vez de Z1»).

LAS MARCAS siguen el modelo de A Detailer (lisp/tipologia.lsp) y SU ORDEN dentro de cada
elemento: en muros MH, MV, TR, EC, TC y CB al final (usuario, 26-nov).

Sin rutas ni fastapi. La lectura de aSa va aparte (`leer_obra`) para que las reglas sean puras.
"""
import json
import logging
import re
import threading
from datetime import date, datetime, timezone
from statistics import median
from typing import Optional

log = logging.getLogger("armahub.deep_audit")
VERSION_REGLAS = 2   # 2 (26-nov): O1 y el despacho desde aSa en vivo
SECTORES = ("ELEV", "LCIELO", "VCIELO", "FUND")
# Cómo se escriben los sectores fuera de norma (para decir cuál debió ser).
ABREVIADOS = {"LC": "LCIELO", "VC": "VCIELO", "ELEVACION": "ELEV", "ELEVACIONES": "ELEV",
              "FUNDACION": "FUND", "FUNDACIONES": "FUND", "LOSA": "LCIELO", "LOSAS": "LCIELO"}
REPROCESO = re.compile(r"^\s*(REP\b|REPOSICI|ADICIONAL)", re.I)
APARTE = re.compile(r"^\s*BARRAS STOCK", re.I)       # la obra «- BARRAS»: barra en punta
DIAS_ESTANCADO = 30
DIAS_RECIENTE = 21                                   # «despachado las últimas 3 semanas»

# El modelo de marcas de A Detailer (tipologia.lsp), en su orden. ArmaScanner agrega F+F' (1.10).
MODELO = {
    "ELEV": ("MH", "MV", "TR", "EC", "TC", "CB"),
    "LCIELO": ("Fi", "Fs", "F'i", "F's", "F", "F'", "SP", "Rp", "TRL"),
    "VCIELO": ("CBS", "CBSn", "CBI", "CBIn", "LT", "ES", "TRV"),
    "FUND": ("Fi", "Fs", "F'i", "F's", "SPF", "TRF"),
}
OTRAS = ("CB", "CBn", "TRC", "ESC", "F", "F'", "F+F'")   # columna y generales: valen en cualquier CC
VALIDAS = {m for lista in MODELO.values() for m in lista} | set(OTRAS)
POR_MINUSCULA = {m.lower(): m for m in VALIDAS}


def _h(regla, gravedad, cc, titulo, detalle=None, kg=None) -> dict:
    return {"regla": regla, "gravedad": gravedad, "cc": cc, "titulo": titulo, "detalle": detalle or {},
            "kg": round(kg, 1) if kg is not None else None}


# ---------------------------------------------------------------------------
# N1 · El nombre del CC
# ---------------------------------------------------------------------------
_RE_PISO = re.compile(r"^(P|S)(\d{1,2})$")
_RE_CICLO = re.compile(r"^([A-Z])(\d{1,2})$")


def _token_piso(tokens: list, i: int) -> Optional[tuple]:
    """(piso, cuántos tokens usa) o None: «P2», «S1» o «PISO 1»."""
    t = tokens[i].upper().rstrip(".")
    m = _RE_PISO.match(t)
    if m:
        return m.group(1) + str(int(m.group(2))), 1
    if t == "PISO" and i + 1 < len(tokens) and tokens[i + 1].isdigit():
        return "P" + str(int(tokens[i + 1])), 2
    return None


def _recorrer(tokens: list) -> dict:
    """Los tokens después del sector: pisos, ciclo (letra y número), su orden y lo que sobra."""
    r = {"pisos": [], "ciclo": None, "letra": None, "orden": [], "extras": []}
    i = 1
    while i < len(tokens):
        p = _token_piso(tokens, i)
        m = _RE_CICLO.match(tokens[i].upper().rstrip("."))
        if p:
            r["pisos"].append(p[0])
            r["orden"].append("piso")
            i += p[1]
            continue
        if m and not r["ciclo"] and m.group(1) not in "PS":
            r["ciclo"], r["letra"] = m.group(1) + str(int(m.group(2))), m.group(1)
            r["orden"].append("ciclo")
        else:
            r["extras"].append(tokens[i])
        i += 1
    return r


def leer_nombre(descr: str) -> dict:
    """{sector, piso, ciclo, letra, problemas}. El sector es el primer token; piso y ciclo, donde
    estén. Lo que no es ninguno de los tres es un agregado."""
    tokens = str(descr or "").split()
    out = {"sector": None, "piso": None, "ciclo": None, "letra": None, "problemas": []}
    if not tokens:
        return out
    primero = tokens[0].upper().rstrip(".")
    out["sector"] = primero if primero in SECTORES else ABREVIADOS.get(primero)
    r = _recorrer(tokens)
    out["ciclo"], out["letra"] = r["ciclo"], r["letra"]
    # Con dos pisos («ELEV Z1 S1 P4») manda el de la torre, y se reporta.
    out["piso"] = next((x for x in r["pisos"] if x.startswith("P")), r["pisos"][0] if r["pisos"] else None)
    out["problemas"] = _problemas_nombre(descr, primero, out, r["orden"], r["extras"])
    if len(r["pisos"]) > 1:
        out["problemas"].append("dos pisos: %s" % " y ".join(r["pisos"]))
    return out


def _problemas_nombre(descr, primero, out, orden, extras) -> list:
    p = []
    if descr != descr.upper():
        p.append("minúsculas")
    if primero not in SECTORES:
        p.append("sector «%s»%s" % (primero, (" (debe ser %s)" % out["sector"]) if out["sector"] else " fuera de norma"))
    if not out["piso"] and out["sector"] != "FUND":
        p.append("sin piso")
    if not out["ciclo"]:
        p.append("sin ciclo")
    if orden[:2] == ["ciclo", "piso"]:
        p.append("el ciclo va antes que el piso")
    if extras:
        p.append("agregados: %s" % " ".join(extras))
    if descr.strip().endswith("."):
        p.append("termina en punto")
    return p


def regla_n1(ccs: list) -> list:
    """Nombre fuera de norma, y la letra de ciclo que no es la de la obra."""
    out = []
    letras = {}
    for c in ccs:
        if c.get("letra"):
            letras[c["letra"]] = letras.get(c["letra"], 0) + 1
    obra = max(letras, key=letras.get) if letras else None
    for c in ccs:
        if c["tipo"] != "normal":
            continue
        problemas = list(c["problemas_nombre"])
        if obra and c.get("letra") and c["letra"] != obra:
            problemas.append("usa %s donde la obra usa %s: mantener una sola nomenclatura hasta arriba"
                             % (c["ciclo"], obra + c["ciclo"][1:]))
        if problemas:
            out.append(_h("N1", "aviso", c["cc"], "Nombre fuera de norma: " + "; ".join(problemas),
                          {"descr": c["descr"], "problemas": problemas, "cubicador": c.get("cubicador")}))
    return out


# ---------------------------------------------------------------------------
# N2 · Las marcas: el modelo de A Detailer y su orden
# ---------------------------------------------------------------------------
def clasificar_marca(marca: str) -> str:
    """'ok' · 'mayusculas' (existe, mal escrita) · 'fuera' (no está en el modelo) · 'vacia'."""
    m = str(marca or "").strip()
    if not m:
        return "vacia"
    if m in VALIDAS:
        return "ok"
    return "mayusculas" if m.lower() in POR_MINUSCULA else "fuera"


def desordenes(items: list, sector: Optional[str]) -> list:
    """Los elementos cuyas marcas no van en el orden del modelo de su sector: [(elemento, «TC antes que EC»)].
    El orden es el de las líneas del CC (LineNum, SeqNo) dentro de cada elemento."""
    lista = MODELO.get(sector or "")
    if not lista:
        return []
    por_elem = {}
    for it in sorted(items, key=lambda x: (x.get("LineNum") or 0, x.get("SeqNo") or 0)):
        m = str(it.get("Notes") or "").strip()
        if m in lista:
            por_elem.setdefault(it.get("ElementID") or "", []).append(m)
    out = []
    for elem, marcas in por_elem.items():
        for a, b in zip(marcas, marcas[1:]):
            if lista.index(b) < lista.index(a):
                out.append((elem, "%s antes que %s" % (a, b)))
                break
    return out


def _clases_de(its: list) -> dict:
    clases = {}
    for it in its:
        m = str(it.get("Notes") or "").strip()
        clases.setdefault(clasificar_marca(m), set()).add(m)
    return clases


def _partes_n2(clases: dict, orden: list) -> list:
    partes = []
    if clases.get("fuera"):
        partes.append("fuera del modelo: " + ", ".join(sorted(clases["fuera"])))
    if clases.get("mayusculas"):
        partes.append("mal escritas: " + ", ".join("%s (es %s)" % (m, POR_MINUSCULA[m.lower()])
                                                   for m in sorted(clases["mayusculas"])))
    if clases.get("vacia"):
        partes.append("barras sin marca")
    if orden:
        partes.append("orden: %d elemento(s), p. ej. %s: %s" % (len(orden), orden[0][0], orden[0][1]))
    return partes


def regla_n2(ccs: list, items: dict) -> list:
    out = []
    for c in ccs:
        its = items.get(c["cc"]) or []
        if c["tipo"] != "normal" or not its:
            continue
        clases, orden = _clases_de(its), desordenes(its, c["sector"])
        partes = _partes_n2(clases, orden)
        if partes:
            out.append(_h("N2", "media", c["cc"], "Marcas: " + "; ".join(partes),
                          {"fuera": sorted(clases.get("fuera", [])), "mayusculas": sorted(clases.get("mayusculas", [])),
                           "desorden": [list(x) for x in orden[:20]], "cubicador": c.get("cubicador")}))
    return out


# ---------------------------------------------------------------------------
# D1 / D2 · Duplicados y doble pedido
# ---------------------------------------------------------------------------
def _clave_barra(it: dict) -> tuple:
    return (it.get("BarSizeDescr"), it.get("ShpNameID") or "", it.get("LegAngle") or "", float(it.get("TotalQty") or 0))


def firma_cc(its: list) -> tuple:
    return tuple(sorted(_clave_barra(it) for it in its))


def regla_d1(ccs: list, items: dict) -> list:
    """El mismo contenido barra a barra en dos CC."""
    vistos, out = {}, []
    for c in sorted(ccs, key=lambda c: c.get("fecha") or ""):
        its = items.get(c["cc"]) or []
        if not its:
            continue
        f = firma_cc(its)
        if f in vistos:
            out.append(_h("D1", "alta", c["cc"], "Mismo contenido que %s (barra a barra)" % vistos[f],
                          {"igual_a": vistos[f], "barras": len(its)}, c["kg"]))
        else:
            vistos[f] = c["cc"]
    return out


def _clave_pedido(it: dict) -> tuple:
    return (str(it.get("ElementID") or "").strip().upper(), str(it.get("Notes") or "").strip().upper()) + _clave_barra(it)


def solapes(a: list, b: list) -> list:
    """Las barras de `b` que ya estaban en `a` (mismo elemento, marca, φ, figura, lados y cantidad)."""
    ya = {_clave_pedido(it) for it in a}
    return [it for it in b if _clave_pedido(it) in ya]


def _por_sector(ccs: list) -> list:
    """Los CC agrupados por sector, piso y ciclo, del más antiguo al más nuevo."""
    grupos = {}
    for c in sorted(ccs, key=lambda c: c.get("fecha") or ""):
        if c["tipo"] == "normal" and c["piso"] and c["ciclo"]:
            grupos.setdefault((c["sector"], c["piso"], c["ciclo"]), []).append(c)
    return list(grupos.values())


def _d2(a: dict, b: dict, items: dict) -> Optional[dict]:
    rep = solapes(items.get(a["cc"]) or [], items.get(b["cc"]) or [])
    if not rep:
        return None
    kg = sum(float(it.get("LineWeight") or 0) for it in rep)
    return _h("D2", "alta", b["cc"], "%d barra(s) ya pedidas en %s (mismo elemento y marca)" % (len(rep), a["cc"]),
              {"ya_en": a["cc"], "barras": [[it.get("ElementID"), it.get("Notes"), it.get("BarMark")] for it in rep[:30]]}, kg)


def regla_d2(ccs: list, items: dict, duplicados: set) -> list:
    """La misma barra del mismo elemento pedida en dos CC del mismo sector, piso y ciclo."""
    out = []
    for lista in _por_sector(ccs):
        pares = [(a, b) for i, b in enumerate(lista) for a in lista[:i] if b["cc"] not in duplicados]
        out += [h for h in (_d2(a, b, items) for a, b in pares) if h]
    return out


# ---------------------------------------------------------------------------
# E1 / K1 / R1 · Estancados, peso fuera de rango, reprocesos
# ---------------------------------------------------------------------------
def regla_e1(ccs: list, hoy: date) -> list:
    out = []
    for c in ccs:
        f = c.get("fecha")
        if c["estado"] == "Open" and f and (hoy - date.fromisoformat(f[:10])).days > DIAS_ESTANCADO:
            dias = (hoy - date.fromisoformat(f[:10])).days
            out.append(_h("E1", "media", c["cc"], "Open hace %d días sin procesarse" % dias, {"dias": dias}, c["kg"]))
    return out


def kg_por_ciclo(ccs: list) -> dict:
    """{(sector, piso): {ciclo: kg}} de los CC con nombre completo."""
    grupos = {}
    for c in ccs:
        if c["tipo"] == "normal" and c["piso"] and c["ciclo"]:
            g = grupos.setdefault((c["sector"], c["piso"]), {})
            g[c["ciclo"]] = g.get(c["ciclo"], 0.0) + c["kg"]
    return grupos


def regla_k1(ccs: list) -> list:
    """Un ciclo muy distinto de los otros ciclos del mismo sector y piso (necesita 3 o más). Holgado:
    la torre se achica en altura y un ciclo puede ser chico (usuario, 26-nov: calibrar)."""
    out = []
    for (sector, piso), por_ciclo in kg_por_ciclo(ccs).items():
        med = median(por_ciclo.values()) if len(por_ciclo) >= 3 else 0
        for ciclo, kg in por_ciclo.items():
            if med and (kg < 0.4 * med or kg > 2.5 * med):
                out.append(_h("K1", "aviso", None, "%s %s %s pesa %s kg; la mediana del piso es %s kg"
                              % (sector, piso, ciclo, round(kg), round(med)),
                              {"sector": sector, "piso": piso, "ciclo": ciclo, "mediana": round(med)}, kg))
    return out


def nivel(c: dict) -> Optional[int]:
    """La altura del CC para comparar: P3 = 3, S1 = -1, fundación más abajo que todo."""
    if c.get("sector") == "FUND":
        return -99
    m = re.match(r"^([PS])(\d+)$", c.get("piso") or "")
    if not m:
        return None
    return int(m.group(2)) * (1 if m.group(1) == "P" else -1)


def _abajo_pendiente(c: dict, ccs: list) -> Optional[dict]:
    """Un CC del mismo sector y ciclo, más abajo, que todavía no sale (o salió después)."""
    for b in ccs:
        if (b["tipo"] == "normal" and b["sector"] == c["sector"] and b["ciclo"] == c["ciclo"]
                and nivel(b) is not None and nivel(b) < nivel(c)
                and (b["estado"] != "Shipped" or (b.get("envio") or "9999") > c["envio"])):
            return b
    return None


def regla_o1(ccs: list) -> list:
    """DESPACHO FUERA DE SECUENCIA (usuario, 26-nov: «veo códigos despachados que van en pisos más
    arriba»). Un piso alto despachado antes que el de abajo del mismo sector y ciclo: o se adelantó,
    o el nombre no dice el piso (en OPERA, «ELEV Z1 P2» salió el 20-oct y «ELEVACIONES PISO 1 Z1»
    seguía Open: la P era la parte del subterráneo)."""
    out = []
    for c in ccs:
        if c["tipo"] != "normal" or c["estado"] != "Shipped" or not c.get("envio") or nivel(c) is None:
            continue
        b = _abajo_pendiente(c, ccs)
        if b:
            out.append(_h("O1", "media", c["cc"], "Despachado el %s antes que %s %s (%s, %s): el nombre podría no decir el piso"
                          % (c["envio"][:10], b["cc"], b["piso"] or "fundación", b["descr"],
                             "despachado el " + b["envio"][:10] if b["estado"] == "Shipped" and b.get("envio") else b["estado"]),
                          {"despachado": c["envio"][:10], "abajo": b["cc"], "remitos": c.get("remitos")}))
    return out


def regla_r1(ccs: list) -> list:
    return [_h("R1", "aviso", c["cc"], "Reproceso o adicional: %s" % c["descr"], {"descr": c["descr"]}, c["kg"])
            for c in ccs if c["tipo"] == "reproceso"]


# ---------------------------------------------------------------------------
# E2 / F1 / Q1 · Lo que ya saben otras partes de ArmaHub
# ---------------------------------------------------------------------------
def _e2(cc, cuando, kg_a, kg_d, cambios) -> dict:
    fecha = cuando.isoformat()[:10] if cuando else ""
    if cambios is None:   # detectado antes de tener foto: se sabe que cambió, no qué (§14)
        return _h("E2", "media", cc, "Modificado después de confirmado en planta (%s); sin foto para saber qué cambió" % fecha,
                  {"modificado_el": fecha})
    n = cambios.get("n") or {}
    return _h("E2", "alta", cc, "Modificado después de confirmado en planta (%s): %d quitadas, %d agregadas, %d cambiadas"
              % (fecha, n.get("quitadas", 0), n.get("agregadas", 0), n.get("cambiadas", 0)),
              {"modificado_el": fecha, "kg_confirmado": float(kg_a or 0), "kg_actual": float(kg_d or 0)},
              abs(float(kg_d or 0) - float(kg_a or 0)))


def regla_e2(cur, ccs: list) -> list:
    cur.execute("""SELECT control_code, modificado_el, kg_confirmado, kg_actual, cambios FROM cc_modificados
                    WHERE control_code = ANY(%s) ORDER BY modificado_el""", ([c["cc"] for c in ccs],))
    return [_e2(*r) for r in cur.fetchall()]


def regla_e3(cur, jobs: list, ccs: list) -> list:
    """CC que el espejo de ArmaHub todavía tiene y aSa ya no (se borraron): el espejo no los saca
    solo (medido 26-nov: cinco CC Open de OPERA borrados ese día seguían en asa_pedidos)."""
    vivos = [c["cc"] for c in ccs]
    cur.execute("""SELECT control_code, descr, estado, kg FROM asa_pedidos
                    WHERE asa_job_id = ANY(%s) AND COALESCE(estado, '') <> 'Cancelled'
                      AND NOT (control_code = ANY(%s)) ORDER BY control_code""", (jobs, vivos))
    return [_h("E3", "aviso", cc, "Ya no está en aSa (se borró); ArmaHub lo sigue mostrando como %s" % (estado or "—"),
               {"descr": descr}, float(kg or 0)) for cc, descr, estado, kg in cur.fetchall()]


def regla_f1(cur, jobs: list) -> list:
    cur.execute("""SELECT cc, regla, COUNT(*) FROM chequeo_senales
                    WHERE id_proyecto = ANY(%s) AND estado IN ('abierta', 'corregir') AND cc IS NOT NULL
                    GROUP BY cc, regla ORDER BY cc""", (jobs,))
    por_cc = {}
    for cc, regla, n in cur.fetchall():
        por_cc.setdefault(cc, {})[regla] = n
    return [_h("F1", "media", cc, "Revisión de barras: %d señal(es) abiertas" % sum(r.values()), {"por_regla": r})
            for cc, r in por_cc.items()]


def regla_q1(cur, jobs: list, codigos: list) -> list:
    cur.execute("""SELECT correlativo, titulo, descripcion, estado, categoria_ishikawa, cubicador_asignado, fecha_creacion
                     FROM reclamos WHERE asa_job_id = ANY(%s) ORDER BY fecha_creacion""", (jobs,))
    out = []
    for corr, titulo, descr, estado, cat, cub, fecha in cur.fetchall():
        texto = " ".join(str(x or "") for x in (titulo, descr)).upper()
        cc = next((c for c in codigos if re.search(r"\b%s\b" % re.escape(c), texto)), None)
        out.append(_h("Q1", "media" if estado not in ("cerrado", "rechazado") else "aviso", cc,
                      "Reclamo %s: %s" % (corr or "", titulo or ""),
                      {"estado": estado, "categoria": cat, "cubicador": cub,
                       "fecha": str(fecha)[:10] if fecha else None}))
    return out


# ---------------------------------------------------------------------------
# La foto de la obra y la corrida
# ---------------------------------------------------------------------------
def tipo_de(descr: str) -> str:
    if APARTE.match(descr or ""):
        return "aparte"
    return "reproceso" if REPROCESO.match(descr or "") else "normal"


def ficha_cc(c: dict, hoy: date) -> dict:
    """Un CC como lo usan las reglas y la pantalla."""
    n = leer_nombre(c["descr"])
    envio = c.get("envio")
    reciente = c["estado"] == "Shipped" and bool(envio) and (hoy - date.fromisoformat(envio[:10])).days <= DIAS_RECIENTE
    return dict(c, sector=n["sector"], piso=n["piso"], ciclo=n["ciclo"], letra=n["letra"], tipo=tipo_de(c["descr"]),
                problemas_nombre=n["problemas"], reciente=reciente)


def hallazgos(cur, ccs: list, items: dict, jobs: list, hoy: date) -> list:
    d1 = regla_d1(ccs, items)
    return (regla_n1(ccs) + regla_n2(ccs, items) + d1 + regla_d2(ccs, items, {h["cc"] for h in d1})
            + regla_e1(ccs, hoy) + regla_e2(cur, ccs) + regla_e3(cur, jobs, ccs) + regla_o1(ccs) + regla_f1(cur, jobs) + regla_k1(ccs) + regla_r1(ccs)
            + regla_q1(cur, jobs, [c["cc"] for c in ccs]))


def por_cubicador(ccs: list, hs: list) -> dict:
    """Qué cubicó cada uno y en cuántos de sus CC hubo nombre (N1) o marcas (N2) observadas."""
    cub = {}
    for c in ccs:
        k = cub.setdefault(c.get("cubicador") or "—", {"cc": 0, "kg": 0.0, "nombre": 0, "marcas": 0})
        k["cc"] += 1
        k["kg"] = round(k["kg"] + c["kg"], 1)
    quien = {c["cc"]: c.get("cubicador") or "—" for c in ccs}
    for h in hs:
        if h["regla"] in ("N1", "N2") and h["cc"] in quien:
            cub[quien[h["cc"]]]["nombre" if h["regla"] == "N1" else "marcas"] += 1
    return cub


def kpis(ccs: list, hs: list) -> dict:
    por_estado = {}
    for c in ccs:
        por_estado[c["estado"]] = round(por_estado.get(c["estado"], 0) + c["kg"], 1)
    total = sum(c["kg"] for c in ccs) or 1
    rep = sum(c["kg"] for c in ccs if c["tipo"] == "reproceso")
    return {"kg_total": round(total, 1), "kg_por_estado": por_estado, "ccs": len(ccs),
            # Sólo los CC de la foto: los borrados de aSa (E3) no son de la obra de hoy.
            "ccs_con_hallazgos": len({h["cc"] for h in hs} & {c["cc"] for c in ccs}),
            "pct_reprocesos": round(100 * rep / total, 1),
            "kg_reprocesos": round(rep, 1), "reclamos": sum(1 for h in hs if h["regla"] == "Q1"),
            "por_regla": {r: sum(1 for h in hs if h["regla"] == r) for r in sorted({h["regla"] for h in hs})},
            "cubicadores": por_cubicador(ccs, hs)}


def guardar(cur, obra: str, jobs: list, email: str, ccs: list, hs: list) -> int:
    n_por_cc = {}
    for h in hs:
        n_por_cc[h["cc"]] = n_por_cc.get(h["cc"], 0) + 1
    foto = [{k: c.get(k) for k in ("cc", "descr", "estado", "kg", "fecha", "envio", "envio_plan", "remitos", "fab",
                                   "planta", "cubicador", "sector", "piso", "ciclo", "tipo", "reciente", "job")}
            for c in ccs]
    for f in foto:
        f["hallazgos"] = n_por_cc.get(f["cc"], 0)
    cur.execute("""INSERT INTO deep_audit (obra, jobs, creado_por, version, kpis, foto)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                (obra, jobs, email, VERSION_REGLAS, json.dumps(kpis(ccs, hs), ensure_ascii=False),
                 json.dumps(foto, ensure_ascii=False)))
    audit_id = cur.fetchone()[0]
    for h in hs:
        cur.execute("""INSERT INTO deep_audit_hallazgo (audit_id, regla, gravedad, cc, titulo, detalle, kg)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (audit_id, h["regla"], h["gravedad"], h["cc"], h["titulo"][:500],
                     json.dumps(h["detalle"], ensure_ascii=False, default=str), h["kg"]))
    return audit_id


# ---------------------------------------------------------------------------
# Lo que se lee de aSa y del espejo
# ---------------------------------------------------------------------------
CAMPOS_ITEM = ["CtrlCode", "LineNum", "SeqNo", "BarMark", "Notes", "ElementID", "ElementDesc", "BarSizeDescr",
               "GradeID", "ShpNameID", "LegAngle", "LengthTheor", "TotalQty", "LineWeight"]


def leer_asa(jobs: list) -> tuple:
    """(obra, [CC], {cc: [ítems]}) en vivo desde aSa: estado y kilos de hoy, sin los anulados.
    Va ANTES de abrir la base: son decenas de consultas y una transacción abierta tanto rato se
    corta (medido 26-nov)."""
    from . import asa
    ccs = {}
    for job in jobs:
        for x in asa.consultar_agregado("getOrderSummary", ["ControlCode", "Descr", "Status", "OrderDate", "DetailPerson",
                                                            "JobName"], "TotalKgs", alias="Kg",
                                        filtro="JobID eq '%s'" % job.replace("'", "''"), carga=True):
            if x["Status"] == "Cancelled":
                continue
            c = ccs.setdefault(x["ControlCode"], {"cc": x["ControlCode"], "descr": x["Descr"] or "", "estado": x["Status"],
                                                  "kg": 0.0, "fecha": x["OrderDate"], "cubicador": x["DetailPerson"],
                                                  "job": job, "obra": x["JobName"]})
            c["kg"] = round(c["kg"] + float(x["Kg"] or 0), 1)
    for job in jobs:
        _con_despacho(ccs, asa.consultar("getScheduling", select=["CtrlCode", "ProjShipDate", "ShipID", "ProjFabDate",
                                                                   "SchedStatusDescr"],
                                         filtro="JobID eq '%s'" % job.replace("'", "''"), top=500))
    items = {cc: asa.consultar("getOrderItemView", select=CAMPOS_ITEM, filtro="CtrlCode eq '%s'" % cc, top=500)
             for cc in ccs}
    obra = next((c["obra"] for c in ccs.values() if c["job"] == jobs[0]), jobs[0])
    return obra, list(ccs.values()), items


def _fecha10(v) -> Optional[str]:
    return (v or "")[:10] or None


def _despacho_de(c: dict, x: dict):
    """Una fila de planta sobre su CC: con remito suma el despacho; sin remito, lo programado."""
    c["planta"] = x.get("SchedStatusDescr")
    c["fab"] = c.get("fab") or _fecha10(x.get("ProjFabDate"))
    if x.get("ShipID"):
        c.setdefault("remitos", []).append(x["ShipID"])
        c["envio"] = max(c.get("envio") or "", _fecha10(x.get("ProjShipDate")) or "") or None
    elif not c.get("envio"):
        c["envio_plan"] = _fecha10(x.get("ProjShipDate"))


def _con_despacho(ccs: dict, filas: list):
    """EL DESPACHO, DE aSa EN VIVO (usuario, 26-nov: «corroborar con lo que está en aSa y no usar
    una foto de ArmaHub»): la fecha de despacho de cada CC con remito, sus remitos y lo que planta
    tiene programado."""
    for x in filas:
        c = ccs.get(x.get("CtrlCode"))
        if c:
            _despacho_de(c, x)


def auditar(cur, jobs: list, email: str, leido: tuple, hoy: Optional[date] = None) -> dict:
    """Una corrida completa sobre lo leído de aSa (leer_asa): aplica las reglas y guarda. Devuelve
    la corrida con sus ítems (para el Excel de la fase 1; la pantalla no los necesita guardados)."""
    hoy = hoy or datetime.now(timezone.utc).date()
    obra, crudos, items = leido
    ccs = [ficha_cc(c, hoy) for c in crudos]
    hs = hallazgos(cur, ccs, items, jobs, hoy)
    audit_id = guardar(cur, obra, jobs, email, ccs, hs)
    return {"id": audit_id, "obra": obra, "ccs": ccs, "hallazgos": hs, "items": items, "kpis": kpis(ccs, hs)}


# ---------------------------------------------------------------------------
# Lo que pide la pantalla (fase 2): corridas, una corrida, validar, correr
# ---------------------------------------------------------------------------
_corriendo = threading.Lock()
ESTADOS_VALIDACION = ("pendiente", "confirmado", "descartado")


def jobs_de(cur, job: str) -> list:
    """La obra y, si existe, su obra «- BARRAS» (job con B al final)."""
    cur.execute("SELECT asa_job_id FROM asa_obras WHERE asa_job_id = ANY(%s)", ([job, job + "B"],))
    hay = {r[0] for r in cur.fetchall()}
    return [j for j in (job, job + "B") if j in hay] or [job]


_CLAVES_CORRIDA = ("id", "obra", "jobs", "creado_el", "creado_por", "creado_nombre", "ccs", "kg", "hallazgos",
                   "revisados", "alta", "media", "aviso")


def corridas(cur, job: Optional[str] = None) -> list:
    """Las corridas, la más nueva primero: todas (la lista de entrada de la pestaña) o las de
    una obra. Con lo que dice la fila: CC, kilos, hallazgos por gravedad y cuántos revisados."""
    from .material import nombre_de
    cur.execute("""SELECT d.id, d.obra, d.jobs, d.creado_el, d.creado_por, %s, d.kpis->'ccs', d.kpis->'kg_total',
                          COUNT(h.id), COUNT(h.id) FILTER (WHERE h.estado <> 'pendiente'),
                          COUNT(h.id) FILTER (WHERE h.gravedad = 'alta'), COUNT(h.id) FILTER (WHERE h.gravedad = 'media'),
                          COUNT(h.id) FILTER (WHERE h.gravedad = 'aviso')
                     FROM deep_audit d LEFT JOIN deep_audit_hallazgo h ON h.audit_id = d.id
                    WHERE %%s::text IS NULL OR %%s = ANY(d.jobs)
                    GROUP BY d.id ORDER BY d.creado_el DESC""" % nombre_de("d.creado_por"), (job, job))
    out = []
    for r in cur.fetchall():
        c = dict(zip(_CLAVES_CORRIDA, r))
        c["creado_el"] = c["creado_el"].isoformat()
        out.append(c)
    return out


def _hallazgo(r, nombres) -> dict:
    claves = ("id", "regla", "gravedad", "cc", "titulo", "detalle", "kg", "estado", "revisado_por", "revisado_el", "nota")
    h = dict(zip(claves, r))
    h["kg"] = float(h["kg"]) if h["kg"] is not None else None
    h["revisado_el"] = h["revisado_el"].isoformat() if h["revisado_el"] else None
    h["revisado_nombre"] = nombres.get(h["revisado_por"])
    return h


def corrida(cur, audit_id: int) -> Optional[dict]:
    from .material import nombre_de
    cur.execute("SELECT id, obra, jobs, creado_el, creado_por, %s, version, kpis, foto FROM deep_audit d WHERE id = %%s"
                % nombre_de("d.creado_por"), (audit_id,))
    r = cur.fetchone()
    if not r:
        return None
    cur.execute("""SELECT h.id, h.regla, h.gravedad, h.cc, h.titulo, h.detalle, h.kg, h.estado, h.revisado_por,
                          h.revisado_el, h.nota, %s FROM deep_audit_hallazgo h WHERE h.audit_id = %%s ORDER BY h.id"""
                % nombre_de("h.revisado_por"), (audit_id,))
    filas = cur.fetchall()
    nombres = {f[8]: f[11] for f in filas if f[8]}
    return {"id": r[0], "obra": r[1], "jobs": r[2], "creado_el": r[3].isoformat(), "creado_por": r[4],
            "creado_nombre": r[5], "version": r[6], "kpis": r[7], "foto": r[8],
            "hallazgos": [_hallazgo(f[:11], nombres) for f in filas]}


def validar(cur, hallazgo_id: int, estado: str, nota: Optional[str], email: str) -> Optional[dict]:
    """Confirmar o descartar un hallazgo (o volverlo a pendiente). Queda quién y cuándo."""
    if estado not in ESTADOS_VALIDACION:
        raise ValueError("Estado no válido.")
    pendiente = estado == "pendiente"
    cur.execute("""UPDATE deep_audit_hallazgo SET estado = %s, nota = COALESCE(%s, nota), revisado_por = %s,
                          revisado_el = %s WHERE id = %s RETURNING audit_id""",
                (estado, (nota or "").strip()[:400] or None, None if pendiente else email,
                 None if pendiente else datetime.now(timezone.utc), hallazgo_id))
    r = cur.fetchone()
    return {"ok": True, "audit_id": r[0]} if r else None


def barras_de_cc(cur, cc: str) -> list:
    """Las barras de un CC (aSa en vivo, la hoja estándar) con su marca contra el modelo."""
    from .material import items_de_cc
    out = items_de_cc(cur, cc)
    for b in out:
        b["marca_estado"] = clasificar_marca(b.get("notas"))
    return out


def corriendo() -> bool:
    return _corriendo.locked()


def correr(job: str, email: str) -> Optional[int]:
    """Una corrida completa, en segundo plano: aSa primero, la base después, por poco rato."""
    from .db import get_conn
    if not _corriendo.acquire(blocking=False):
        return None
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                jobs = jobs_de(cur, job)
        leido = leer_asa(jobs)
        with get_conn() as conn:
            with conn.cursor() as cur:
                return auditar(cur, jobs, email, leido)["id"]
    except Exception as e:
        log.error("Deep Audit: falló la corrida de %s pedida por %s (%s)", job, email, e)
        return None
    finally:
        _corriendo.release()

