# -*- coding: utf-8 -*-
"""REVISIÓN DE ELEMENTOS: el código contra el mismo ciclo del piso anterior (4-nov).

La revisión de barras mira cada barra contra una regla. Esto mira otra cosa: el CÓDIGO
entero contra su gemelo del piso de abajo. Lo que más reclamos deja en Cubicaciones son
los faltantes —«eje 12 faltante nuevamente», «malla doble cubicada como simple»— y un
faltante no está en ninguna barra: está en la barra que NO está. Sólo se ve comparando.

QUÉ SE COMPARA. En edificación los códigos se nombran por sector, piso y ciclo —«ELEV P3
C7», «LOSAS C 10°P (CICLO 2)»— y el ciclo es DENTRO del piso (1 a 4), no el piso. Medido
sobre 1.873 códigos de 31 obras 2026: el par correcto es mismo sector, mismo ciclo, mismo
frente, piso N-1 → piso N. Losas y vigas de cielo repiten kilos casi exactos piso a piso
(mediana 1,00; el 80 por ciento entre 0,93 y 1,05); las elevaciones varían más porque los
muros adelgazan hacia arriba, así que en ELEV manda la cuenta de elementos y no los kilos.

QUÉ NO SE COMPARA. Los pisos 1 y 2 (fundación y primer piso rara vez son tipo), el último
piso conocido de la obra (suele ser distinto), y los códigos que cubren un RANGO o una
PARTE —«Vigas Cielo P6@P9 C1», «ELEV P3 C3 PARTE 2»—: compararlos piso a piso inventa
caídas. Si el nombre no trae sector, piso y ciclo, el código no entra: esto es para
edificación y lo dice.

DOS GRUPOS DE REGLAS, y la pantalla los separa: las que valen para TODAS las obras
(duplicado, disparado, mismo pedido con otro nombre) y las que sólo tienen sentido en
EDIFICACIÓN (faltan elementos).

EL MISMO PEDIDO CON OTRO NOMBRE (4-nov, lo pidió el usuario): el duplicado de arriba sólo
mira códigos que se LLAMAN igual, porque compara elementos sin el número de piso y dos pisos
tipo idénticos dispararían falso. Para el ciclo mandado dos veces con otro nombre se compara
el contenido EXACTO, barra por barra, entre códigos de la obra con los mismos kilos: la
tabla de pedidos filtra los candidatos sin ir a aSa, y sólo a esos se les leen las barras.
"""
import re
import hashlib
from typing import Optional

# ── Qué dice el nombre del código ─────────────────────────────────────────────────────
SECTOR = {"ELEV": "ELEV", "ELEVACIONES": "ELEV", "ELEVACION": "ELEV",
          "LC": "LC", "LOSA": "LC", "LOSAS": "LC",
          "VC": "VC", "VIGAS": "VC", "VIGA": "VC",
          "FUND": "FUND"}
SECTOR_NOMBRE = {"ELEV": "elevaciones", "LC": "losas", "VC": "vigas de cielo", "FUND": "fundaciones"}
PISO_TIPO_DESDE = 3        # el usuario: «usualmente el piso tipo parte del 3 hacia arriba»


def parsear_descr(descr: Optional[str]) -> Optional[dict]:
    """«ELEV P3 C7», «ELEV. 3°P (CICLO 7) FRENTE 1», «LOSAS C-2S (CICLO 6)» → sector, piso,
    ciclo, frente. None si no es un código de edificación nombrado así. `rango` marca los
    que cubren varios pisos o ciclos («P6@P9», «C1@C4») o un pedazo («PARTE 2»): existen,
    pero no se comparan piso a piso."""
    u = _descr_norm(descr)
    m = re.match(r"^(ELEVACIONES|ELEVACION|ELEV|LOSAS|LOSA|LC|VIGAS|VIGA|VC|FUND)\b", u)
    if not m:
        return None
    piso = ciclo = None
    mp = re.search(r"(\d+)\s*°\s*P", u) or re.search(r"\bPISO\s*(\d+)", u) or re.search(r"\bP\s*(\d+)\b", u)
    sub = re.search(r"(\d+)\s*S\b", u) or re.search(r"\bS\s*(\d+)\b", u)
    mc = re.search(r"CICLO\s*(\d+)", u) or re.search(r"\bC\s*(\d+)\b", u)
    if mp:
        piso = int(mp.group(1))
    elif sub:
        piso = -int(sub.group(1))
    if mc:
        ciclo = int(mc.group(1))
    if piso is None or ciclo is None:
        return None
    fr = re.search(r"FRENTE\s*(\d+)", u)
    return {"sector": SECTOR[m.group(1)], "piso": piso, "ciclo": ciclo,
            "frente": int(fr.group(1)) if fr else 0,
            "rango": bool(re.search(r"@|\bPARTE\b|\bPART\b", u))}


def nombre_elemento(desc: Optional[str]) -> str:
    """«EJE L4/16 PL-338 Rev-C» → «EJE L4/#»: el mismo muro un piso más arriba cambia el
    número después de la barra y a veces el plano. Sirve para decir CUÁL falta; la cuenta
    la decide el ElementID, no esto."""
    s = re.sub(r"\s+", " ", (desc or "").strip().upper())
    s = re.sub(r"\s+PL\s*-?\s*\d+.*$", "", s)        # fuera el plano y lo que venga después
    s = re.sub(r"/\s*\d+[A-Z]?\b", "/#", s)           # el número de piso tras la barra
    return s.strip() or "(sin nombre)"


def huella(items: list) -> tuple:
    """El contenido exacto de un código, barra por barra y en orden fijo: nombre del
    elemento tal cual (con su número de piso), marca, diámetro, figura, dimensiones, largo
    y cantidad. Dos códigos con la misma huella son el mismo pedido, se llamen como se
    llamen."""
    def _n(v):
        return re.sub(r"\s+", " ", str(v if v is not None else "")).strip().upper()
    return tuple(sorted((_n(it.get("ElementDesc")), _n(it.get("BarMark")), _n(it.get("BarSizeDescr")),
                         _n(it.get("ShpNameID")), _n(it.get("ShapeDims")), _n(it.get("LengthCut")),
                         _n(it.get("TotalQty"))) for it in items))


def resumir(cc: str, items: list, kg: float, descr: str) -> dict:
    """Lo que de un código importa para comparar: sus elementos (por ElementID) con cuántas
    barras tiene cada uno, los kilos del pedido y la huella exacta de sus barras."""
    elems = {}
    for it in items:
        eid = str(it.get("ElementID") or "").strip() or "?"
        e = elems.setdefault(eid, {"id": eid, "desc": it.get("ElementDesc") or "", "barras": 0, "qty": 0})
        e["barras"] += 1
        try:
            e["qty"] += int(float(it.get("TotalQty") or 0))
        except (TypeError, ValueError):
            pass
    return {"cc": cc, "descr": descr or "", "kg": float(kg or 0), "elems": elems, "huella": huella(items)}


# ── Las reglas. Cada una recibe el código actual y el de comparación ────────────────────
def r_faltan_elementos(act: dict, ant: dict, p: dict) -> Optional[dict]:
    """ELEVACIONES: menos muros/ejes que el mismo ciclo del piso anterior. LOSAS Y VIGAS:
    menos elementos, o kilos muy por debajo (bajo 0,5 cuando lo normal es 1,00)."""
    na, nb = len(ant["elems"]), len(act["elems"])
    ratio = (act["kg"] / ant["kg"]) if ant["kg"] > 0 else None
    cae_kg = p["sector"] in ("LC", "VC") and ratio is not None and ratio < 0.5
    if nb >= na and not cae_kg:
        return None
    # Cuáles faltan, por nombre normalizado: informa, no decide.
    nom_act = {nombre_elemento(e["desc"]) for e in act["elems"].values()}
    faltan = sorted({nombre_elemento(e["desc"]) for e in ant["elems"].values()} - nom_act)
    partes = []
    if nb < na:
        partes.append("%d elemento(s) contra %d en el piso anterior" % (nb, na))
    if cae_kg:
        partes.append("%s kg contra %s (queda en ×%.2f)" % (_k(act["kg"]), _k(ant["kg"]), ratio))
    return {"texto": "En %s, el %s tiene %s: %s." % (SECTOR_NOMBRE.get(p["sector"], p["sector"]), act["cc"],
                                                      " y ".join(partes), act["descr"]),
            "medidas": [{"que": "Elementos", "encontrado": nb, "esperado": na},
                        {"que": "Kilos", "encontrado": round(act["kg"]), "esperado": round(ant["kg"])}],
            "diferencia": {"que": "Faltan", "valor": max(0, na - nb)} if nb < na
                          else {"que": "Queda en", "valor": "×%.2f" % ratio},
            "lista": [{"texto": x, "tipo": "falta"} for x in faltan[:12]]}


def r_codigo_disparado(act: dict, ant: dict, p: dict) -> Optional[dict]:
    """Los kilos son tres veces los del piso anterior con la misma cantidad de elementos:
    un cero de más en una cantidad o en una distancia."""
    if ant["kg"] <= 0:
        return None
    ratio = act["kg"] / ant["kg"]
    if ratio < 3 or abs(len(act["elems"]) - len(ant["elems"])) > 1:
        return None
    return {"texto": "El %s pesa ×%.1f lo que el mismo ciclo del piso anterior, con %d elemento(s) contra %d: "
                     "¿un cero de más en una cantidad o en una distancia?"
                     % (act["cc"], ratio, len(act["elems"]), len(ant["elems"])),
            "medidas": [{"que": "Kilos", "encontrado": round(act["kg"]), "esperado": round(ant["kg"])},
                        {"que": "Elementos", "encontrado": len(act["elems"]), "esperado": len(ant["elems"])}],
            "diferencia": {"que": "Se dispara", "valor": "×%.1f" % ratio},
            "lista": _mas_pesados(act, ant)}


def r_codigo_duplicado(act: dict, otro: dict, p: dict) -> Optional[dict]:
    """Dos códigos del mismo sector, piso y ciclo con los mismos elementos y la misma
    cantidad de barras en cada uno: el ciclo mandado dos veces."""
    if not act["elems"] or len(act["elems"]) != len(otro["elems"]):
        return None
    fa = sorted((nombre_elemento(e["desc"]), e["barras"]) for e in act["elems"].values())
    fo = sorted((nombre_elemento(e["desc"]), e["barras"]) for e in otro["elems"].values())
    if fa != fo:
        return None
    if otro["kg"] > 0 and abs(act["kg"] - otro["kg"]) / otro["kg"] > 0.02:
        return None
    return {"texto": "El %s y el %s son el mismo código: %d elemento(s) iguales, barra por barra, y %s kg."
                     % (act["cc"], otro["cc"], len(act["elems"]), _k(act["kg"])),
            "medidas": [{"que": "Kilos", "encontrado": round(act["kg"]), "esperado": round(otro["kg"])},
                        {"que": "Elementos", "encontrado": len(act["elems"]), "esperado": len(otro["elems"])}],
            "diferencia": {"que": "Iguales", "valor": "="},
            "lista": [{"texto": nombre_elemento(e["desc"]), "tipo": "igual"} for e in list(act["elems"].values())[:12]]}


def r_mismo_pedido(act: dict, otro: dict, p) -> Optional[dict]:
    """Las mismas barras, una por una, en un código que se llama distinto: el pedido
    mandado dos veces con otro nombre. Los kilos ya son iguales (así se eligió el gemelo)."""
    if not act["huella"] or act["huella"] != otro["huella"]:
        return None
    return {"texto": "El %s y el %s tienen exactamente las mismas barras aunque se llamen distinto: «%s» y «%s»."
                     % (act["cc"], otro["cc"], act["descr"], otro["descr"]),
            "medidas": [{"que": "Barras", "encontrado": len(act["huella"]), "esperado": len(otro["huella"])},
                        {"que": "Elementos", "encontrado": len(act["elems"]), "esperado": len(otro["elems"])},
                        {"que": "Kilos", "encontrado": round(act["kg"]), "esperado": round(otro["kg"])}],
            "diferencia": {"que": "Idénticos", "valor": "="},
            "lista": [{"texto": e["desc"] or e["id"], "tipo": "igual"} for e in list(act["elems"].values())[:12]]}


def _mas_pesados(act, ant):
    """Qué elementos subieron de barras: ahí suele estar el cero de más."""
    por_ant = {nombre_elemento(e["desc"]): e for e in ant["elems"].values()}
    out = []
    for e in act["elems"].values():
        a = por_ant.get(nombre_elemento(e["desc"]))
        if a and e["qty"] >= 3 * max(1, a["qty"]):
            out.append({"texto": "%s: %d unidades (antes %d)" % (nombre_elemento(e["desc"]), e["qty"], a["qty"]), "tipo": "sube"})
    return out[:12]


def _k(x):
    return "{:,.0f}".format(x).replace(",", ".")


REGLAS_ELEMENTO = [
    {"codigo": "codigo_duplicado", "grupo": "todas", "corto": "Duplicado",
     "nombre": "Código duplicado",
     "porque": "Dos códigos del mismo sector, piso y ciclo con los mismos elementos y las mismas barras: "
               "el ciclo mandado dos veces.",
     "umbral": "mismos elementos, barra por barra, y mismos kilos (±2%)",
     "contra": "duplicado", "fn": r_codigo_duplicado},
    {"codigo": "mismo_pedido", "grupo": "todas", "corto": "Mismo pedido",
     "nombre": "Mismo pedido con otro nombre",
     "porque": "Otro código de la misma obra con exactamente las mismas barras —elemento, marca, diámetro, "
               "figura, largo y cantidad— pero con otro nombre: el pedido mandado dos veces sin que se note.",
     "umbral": "mismos kilos al centavo y las mismas barras, una por una · otro nombre que no sea sólo otro piso de lo mismo",
     "contra": "gemelo", "fn": r_mismo_pedido},
    {"codigo": "codigo_disparado", "grupo": "todas", "corto": "Disparado",
     "nombre": "Código disparado",
     "porque": "Pesa tres veces lo que el mismo ciclo del piso anterior con los mismos elementos: "
               "un cero de más en una cantidad o en una distancia.",
     "umbral": "≥ 3× los kilos · misma cantidad de elementos (±1)",
     "contra": "anterior", "fn": r_codigo_disparado},
    {"codigo": "faltan_elementos", "grupo": "edificacion", "corto": "Faltan elementos",
     "nombre": "Faltan elementos respecto del piso anterior",
     "porque": "Elevaciones: menos muros o ejes que el mismo ciclo del piso de abajo. Losas y vigas "
               "de cielo: menos elementos, o kilos muy por debajo cuando lo normal es repetirse.",
     "umbral": "ELEV: menos elementos · LC/VC: menos elementos o kilos < 0,5×",
     "contra": "anterior", "fn": r_faltan_elementos},
]
# ── El emparejador: con quién se compara cada código ──────────────────────────────────
def pares_de_obra(pedidos: list) -> dict:
    """`pedidos`: filas (cc, descr, kg) de UNA obra. Devuelve, por código, contra quién se
    compara: {"anterior": (cc, descr, kg) | None, "duplicados": [(cc, descr, kg)...],
    "p": lo parseado, "ultimo": True si es el piso más alto que se conoce}."""
    cod = {}
    for cc, descr, kg in pedidos:
        p = parsear_descr(descr)
        if p:
            cod[cc] = {"cc": cc, "descr": descr, "kg": float(kg or 0), "p": p}
    grupos = {}
    for x in cod.values():
        if x["p"]["rango"]:
            continue
        k = (x["p"]["sector"], x["p"]["ciclo"], x["p"]["frente"])
        grupos.setdefault(k, {}).setdefault(x["p"]["piso"], []).append(x)
    out = {}
    for x in cod.values():
        p = x["p"]
        r = {"p": p, "anterior": None, "duplicados": [], "ultimo": False}
        out[x["cc"]] = r
        if p["rango"]:
            continue
        pisos = grupos.get((p["sector"], p["ciclo"], p["frente"]), {})
        r["duplicados"] = [(y["cc"], y["descr"], y["kg"]) for y in pisos.get(p["piso"], []) if y["cc"] != x["cc"]]
        r["ultimo"] = bool(pisos) and p["piso"] == max(pisos)
        if p["piso"] >= PISO_TIPO_DESDE and (p["piso"] - 1) in pisos:
            a = max(pisos[p["piso"] - 1], key=lambda y: y["kg"])
            r["anterior"] = (a["cc"], a["descr"], a["kg"])
    return out


def _descr_norm(d) -> str:
    return re.sub(r"\s+", " ", (d or "").upper().replace("-", " ").replace(".", " ").replace("_", " ")).strip()


def _sin_numeros(d) -> str:
    return re.sub(r"[^A-Z]+", " ", (d or "").upper()).strip()


def _otro_piso_de_lo_mismo(a_descr, b_descr) -> bool:
    """La misma cosa en otro piso o en otra posición NO es un gemelo: en piso tipo lo normal
    es que las losas del 11 y del 12 sean idénticas barra por barra (medido 4-nov: «LC P12
    C6» = «LC P11 C6», «VIGAS C 14° PISO» = «VIGAS C 12° PISO»). Se reconoce de dos formas:
    los nombres quedan iguales al quitarles los números («PR - PILOTE - P25» / «P20»), o
    los dos se leen como el mismo sector, ciclo y frente en pisos distintos («VIGAS C 7°P
    (CICLO 3)» / «Vigas Cielo P6 C3»)."""
    if _sin_numeros(a_descr) == _sin_numeros(b_descr):
        return True
    a, b = parsear_descr(a_descr), parsear_descr(b_descr)
    return bool(a and b and (a["sector"], a["ciclo"], a["frente"]) == (b["sector"], b["ciclo"], b["frente"])
                and a["piso"] != b["piso"])


def gemelos_de(pedidos: list, cc: str) -> list:
    """Los códigos de la obra con los MISMOS KILOS que `cc` (al centavo: el mismo pedido pesa
    lo mismo) y OTRO NOMBRE que no sea sólo otro piso de lo mismo: candidatos a ser el mismo
    pedido. `pedidos`: filas (cc, descr, kg) o (cc, descr, kg, fecha). La señal va en el
    código más nuevo —por fecha, y a igual fecha por código— para que el par salga una vez
    y no una en cada lado. Devuelve [(cc, descr, kg)...], los más viejos que `cc`.
    Medido sobre 6.006 códigos de 2026: 514 pares candidatos; sin estas exclusiones, 4.866."""
    def _f(row):
        return row[3] if len(row) > 3 and row[3] is not None else ""
    mio = next((r for r in pedidos if r[0] == cc), None)
    if not mio or float(mio[2] or 0) <= 0:
        return []
    kg, nombre, clave = float(mio[2]), _descr_norm(mio[1]), (str(_f(mio)), str(cc))
    out = []
    for r in pedidos:
        if r[0] == cc or float(r[2] or 0) <= 0 or _descr_norm(r[1]) == nombre:
            continue
        if abs(float(r[2]) - kg) >= 0.01 or _otro_piso_de_lo_mismo(mio[1], r[1]):
            continue
        if (str(_f(r)), str(r[0])) < clave:
            out.append((r[0], r[1], float(r[2])))
    return out


def firma_elemento(regla: str, job: str, cc: str, contra: str) -> str:
    return hashlib.sha1("|".join(("elemento", regla, str(job), str(cc), str(contra))).encode("utf-8")).hexdigest()


def correr_elemento(act: dict, p: Optional[dict], anterior: Optional[dict], duplicados: list, reglas=None,
                    gemelos=None) -> list:
    """Corre las reglas de elemento sobre un código ya resumido. Devuelve las señales. `p`
    es None cuando el nombre no es de edificación: entonces sólo corren las reglas que no
    necesitan piso ni ciclo (el gemelo con otro nombre)."""
    donde = {"sector": p["sector"], "piso": p["piso"], "ciclo": p["ciclo"]} if p else {}
    # Contra quién corre cada regla: una lista por tipo de comparación, y una sola forma de
    # armar la señal para las tres.
    contra = {"anterior": [anterior] if anterior else [], "duplicado": duplicados or [], "gemelo": gemelos or []}
    out = []
    for r in (reglas or REGLAS_ELEMENTO):
        for o in contra.get(r["contra"], []):
            d = r["fn"](act, o, p)
            if d:
                out.append({"regla": r["codigo"], "contra": o["cc"], "detalle": dict(
                    d, grupo=r["grupo"], contra={"cc": o["cc"], "descr": o["descr"], "kg": round(o["kg"])},
                    actual={"cc": act["cc"], "descr": act["descr"], "kg": round(act["kg"])}, **donde)})
    return out
