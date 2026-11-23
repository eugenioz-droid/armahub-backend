"""
Los KPIs de un plano y de una obra, y el kg por piso (Mis obras, 22-nov): funciones puras.
"""


def resumen_de(barras, extra=None) -> dict:
    """{barras, aprobadas, consultas, pendientes, kg} de las barras a la vista (+ ciclos, etapa, la
    versión de ArmaScanner que lo manda: `version_app`, que el pedido deja registrada; el Ø promedio
    `diam_prom`; los m² de losa `m2` y `m2_ciclos` si ArmaScanner los manda, y los kg por piso y
    sector `por_piso` si las barras traen su piso). «consultas» = con duda. Función pura."""
    r = {"barras": len(barras), "aprobadas": sum(1 for b in barras if b.get("rev") == "aprobada"),
         "consultas": sum(1 for b in barras if b.get("rev") == "duda"),
         "kg": round(sum(float(b.get("kg") or 0) for b in barras), 1)}
    r["pendientes"] = r["barras"] - r["aprobadas"] - r["consultas"]
    extra = extra or {}
    r.update(_lo_enviado(extra))
    r.update(_lo_de_las_barras(barras, extra))
    return r


def _lo_enviado(extra) -> dict:
    """Lo que ArmaScanner manda del plano y el resumen guarda tal cual: ciclos, etapa, version_app."""
    r = {}
    if isinstance(extra.get("ciclos"), int):
        r["ciclos"] = extra["ciclos"]
    for k in ("etapa", "version_app"):
        if isinstance(extra.get(k), str) and extra[k].strip():
            r[k] = extra[k].strip()[:40]
    return r


def _lo_de_las_barras(barras, extra) -> dict:
    """Lo que se calcula de las barras: el Ø promedio, los m² de losa y los kg por piso."""
    r = {}
    d = diam_prom(barras)
    if d is not None:
        r["diam_prom"] = d
    losa = m2_enviados(extra)
    if losa:
        r["m2"], r["m2_ciclos"] = losa
    if any("piso" in b for b in barras):  # un ArmaScanner anterior al 22-nov no los manda
        r["por_piso"] = kg_por_piso(barras, elemento=extra.get("elemento"))
    return r


# ── Los KPIs de un plano y de una obra (Mis obras, 22-nov) ──
# Los mismos de toda la página de ArmaHub (Obras, barras.py; despieces, lotes.py):
#   PPI = Peso Promedio por Ítem = kg / ítems (entradas de la lista, no barras físicas)
#   Ø prom = ponderado por peso, Σ(φ·kg) / Σkg
# y los de la losa: m² = el área de losa que lee ArmaScanner en los planos de losa (LCIELO; las
# elevaciones no traen contornos de losa) y kg/m² = kg sin fundaciones / m² (el kg por piso, abajo).
def _numero(v):
    """El número de `v` si es uno finito (no un booleano), o None."""
    import math
    if isinstance(v, bool):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def diam_prom(barras):
    """Ø promedio ponderado por peso, Σ(φ·kg)/Σkg, de las barras a la vista que traen φ y kg (1
    decimal); None si ninguna los trae. Función pura."""
    suma = peso = 0.0
    for b in barras or []:
        d, kg = _numero(b.get("diam")), _numero(b.get("kg"))
        if d and kg and d > 0 and kg > 0:
            suma += d * kg
            peso += kg
    return round(suma / peso, 1) if peso else None


def m2_enviados(d):
    """(m², {ciclo: m²}) de losa que manda ArmaScanner al terminar un plano de losa; None si no los
    manda (las elevaciones no traen contornos de losa) o no son un área. Función pura."""
    m2 = _numero((d or {}).get("m2"))
    if not m2 or m2 <= 0:
        return None
    ciclos = d.get("m2_ciclos") if isinstance(d.get("m2_ciclos"), dict) else {}
    por = {}
    for k, v in list(ciclos.items())[:200]:
        n = _numero(v)
        if n is not None and n >= 0 and str(k).strip():
            por[str(k).strip()[:12]] = round(n, 1)
    return round(m2, 1), por


def es_losa(elemento) -> bool:
    """¿El plano es de losa (sus m² cuentan para la obra)? `elemento` como lo guarda ArmaHub
    («LCIELO», «LCIELO, VCIELO»). Función pura."""
    return "LCIELO" in [t.strip().upper() for t in str(elemento or "").split(",")]


# ── El kg por piso (Mis obras, 22-nov) ──
# [Usuario 22-nov: «Se debe sumar todo lo de un piso. Las fundaciones las separamos eso sí… se considera
# desde donde nace ese fierro, así que es básicamente todo lo de la etiqueta… toca respetar el piso que
# se señala en cada barra para tener el peso total por piso»]
#   kg del piso  = Σ kg de las barras con ese piso en su etiqueta, de todos los planos (losa, elevación,
#                  vigas), salvo las de fundación (sector FUND), que van aparte
#   m² del piso  = los m² de losa de los planos de losa de ese piso (el piso del plano: el de más kg
#                  entre sus barras)
#   kg/m²        = kg del piso / m² del piso; el de la obra, Σ kg sin fundaciones / Σ m² de losa
# Por piso, además, los kg de losa (losas y vigas de cielo) y los de elevación, por el sector de cada barra.
def piso_normal(piso) -> str:
    """El piso como se agrupa: «P5», «S1», «FUND». ArmaScanner lo anota «P5» y, si no lo leyó, «P»;
    «5» → «P5», «P05» → «P5». "" si no se sabe. Función pura."""
    import re
    p = re.sub(r"\s+", "", str(piso or "")).upper().replace("?", "")
    if p.isdigit():
        p = "P" + p
    p = re.sub(r"^([A-Z]+)0+(\d)", r"\1\2", p)
    return "" if p in ("P", "S") else p[:20]


def clase_de(sector, piso="") -> str:
    """'fund' (fundación: sector o piso FUND), 'elev' (sector ELEV), 'viga' (vigas de cielo: VCIELO)
    o 'losa' (el resto). [Usuario 22-nov: «no, son kilos de vigas»] Función pura."""
    s = str(sector or "").strip().upper()
    if s.startswith("FUND") or piso_normal(piso).startswith("FUND"):
        return "fund"
    return "elev" if s.startswith("ELEV") else "viga" if s.startswith(("VCIELO", "VIGA")) else "losa"


def kg_por_piso(barras, elemento="") -> list:
    """[{piso, sector, kg}] de las barras a la vista de un plano, sumadas por su piso y su sector (los
    de su etiqueta). La barra que no los trae va sin piso ("") y con el sector del plano (`elemento`, el
    primero). Función pura."""
    propio = str(elemento or "").split(",")[0].strip().upper()
    suma = {}
    for b in barras or []:
        piso, sector = (b.get("piso"), b.get("sector") or propio) if "piso" in b else ("", propio)
        k = (piso_normal(piso), str(sector or "").strip().upper()[:20])
        suma[k] = suma.get(k, 0.0) + (_numero(b.get("kg")) or 0.0)
    return [{"piso": p, "sector": s, "kg": round(kg, 1)} for (p, s), kg in sorted(suma.items())]


def piso_del_plano(por_piso) -> str:
    """El piso de un plano (el de sus m² de losa): el de más kg entre sus barras que no son de
    fundación, prefiriendo uno conocido; "" si no hay. Función pura."""
    kg = {}
    for f in por_piso or []:
        if clase_de(f.get("sector"), f.get("piso")) != "fund":
            p = piso_normal(f.get("piso"))
            kg[p] = kg.get(p, 0.0) + float(f.get("kg") or 0)
    conocidos = sorted(p for p in kg if p) or sorted(kg)
    return max(conocidos, key=lambda p: kg[p]) if conocidos else ""


def tabla_por_piso(planos) -> dict:
    """La tabla «Por piso» de una obra: {"pisos": [{piso, kg_losa, kg_viga, kg_elev, kg, m2, kg_m2}], "fund": kg
    de fundaciones}. `planos`: los de plano_para_kpis (su `por_piso` y sus m² de losa). Los pisos en
    orden constructivo (orden.piso_order: S3, S2, S1, P1…) y el sin piso ("") al final. Sin dato va
    None (la pantalla muestra «—»). Función pura."""
    from ..orden import piso_order
    pisos, fund = _sumar_por_piso(planos)
    return {"pisos": [_fila_piso(p, pisos[p]) for p in sorted(pisos, key=lambda p: (p == "", piso_order(p), p))],
            "fund": round(fund, 1) or None}


def _sumar_por_piso(planos) -> tuple:
    """({piso: {kg_losa, kg_viga, kg_elev, m2}}, kg de fundaciones) de los planos (plano_para_kpis)."""
    pisos, fund = {}, 0.0
    for pl in planos:
        for f in pl.get("por_piso") or []:
            kg, clase = float(f.get("kg") or 0), clase_de(f.get("sector"), f.get("piso"))
            if clase == "fund":
                fund += kg
            else:
                _piso_en(pisos, piso_normal(f.get("piso")))["kg_" + clase] += kg
        m2 = _numero(pl.get("m2"))
        if m2 and m2 > 0:
            _piso_en(pisos, piso_del_plano(pl.get("por_piso")))["m2"] += m2
    return pisos, fund


def _piso_en(pisos, p) -> dict:
    return pisos.setdefault(p, {"kg_losa": 0.0, "kg_viga": 0.0, "kg_elev": 0.0, "m2": 0.0})


def _fila_piso(p, x) -> dict:
    """La fila de un piso en la tabla «Por piso»; sin dato, None."""
    kg, m2 = round(x["kg_losa"] + x["kg_viga"] + x["kg_elev"], 1), round(x["m2"], 1) or None
    return {"piso": p, "kg_losa": round(x["kg_losa"], 1) or None, "kg_viga": round(x["kg_viga"], 1) or None,
            "kg_elev": round(x["kg_elev"], 1) or None, "kg": kg or None, "m2": m2,
            "kg_m2": round(kg / m2, 1) if m2 and kg else None}


def plano_para_kpis(resumen, elemento) -> dict:
    """Lo que un plano aporta a los KPIs: {items, kg, diam_prom, m2, por_piso, kg_fund}, de su resumen.
    Los m² sólo si es de losa. Sin kg por piso (sus barras no traen el piso), todo el plano va sin piso y
    con su sector. (Hasta el 23-nov, el Ø y el kg por piso de un resumen anterior al 22-nov se calculaban
    aparte en cada lectura; en la base ya no queda ninguno.)"""
    r = resumen or {}
    kg = float(r.get("kg") or 0)
    por_piso = r["por_piso"] if isinstance(r.get("por_piso"), list) else \
        kg_por_piso([{"kg": kg}] if kg else [], elemento=elemento)
    return {"items": int(r.get("barras") or 0), "kg": kg, "diam_prom": r.get("diam_prom"),
            "m2": r.get("m2") if es_losa(elemento) else None, "por_piso": por_piso, "kg_fund": _kg_fund(por_piso)}


def _kg_fund(por_piso) -> float:
    """Los kg de fundaciones de un kg por piso."""
    return round(sum(float(f.get("kg") or 0) for f in por_piso
                     if clase_de(f.get("sector"), f.get("piso")) == "fund"), 1)


def kpis_de(planos) -> dict:
    """{items, kg, ppi, diam_prom, m2, kg_m2, kg_fund} de uno o varios planos (plano_para_kpis). `kg`
    es todo; `kg_fund`, lo de fundaciones. kg/m² = Σ kg de los pisos que tienen m² de losa / Σ esos m²
    (tabla_por_piso): un piso sin su losa escaneada no entra, y las fundaciones nunca. [Usuario 22-nov:
    «tenemos totales por piso que se dividen por el área del piso… se muestra cuando haya m²»] Sin
    dato va None (la pantalla muestra «—», nunca 0). Función pura."""
    items = sum(int(p.get("items") or 0) for p in planos)
    kg = round(sum(float(p.get("kg") or 0) for p in planos), 1)
    fund = round(sum(float(p.get("kg_fund") or 0) for p in planos), 1)
    m2s = [float(p["m2"]) for p in planos if _numero(p.get("m2"))]
    m2 = round(sum(m2s), 1) if m2s else None
    return {"items": items, "kg": kg, "ppi": round(kg / items, 2) if items else None,
            "diam_prom": _diam_ponderado(planos), "m2": m2, "kg_m2": _kg_m2(planos, kg, fund, m2),
            "kg_fund": fund or None}


def _diam_ponderado(planos):
    """El Ø promedio de varios planos, ponderado por sus kg; None si ninguno lo trae."""
    con_d = [(float(p["diam_prom"]), float(p.get("kg") or 0)) for p in planos if _numero(p.get("diam_prom"))]
    peso_d = sum(k for _, k in con_d)
    return round(sum(d * k for d, k in con_d) / peso_d, 1) if peso_d else None


def _kg_m2(planos, kg, fund, m2):
    """kg/m² = Σ kg de los pisos con m² de losa / Σ esos m² (tabla_por_piso); sin el kg por piso (planos
    sin datos de piso), kg sin fundaciones / m² de losa. None si no hay con qué."""
    if any(p.get("por_piso") for p in planos):
        con_m2 = [f for f in tabla_por_piso(planos)["pisos"] if f["m2"] and f["kg"]]
        m2_pisos = sum(f["m2"] for f in con_m2)
        return round(sum(f["kg"] for f in con_m2) / m2_pisos, 1) if m2_pisos else None
    return round((kg - fund) / m2, 1) if m2 and kg - fund > 0 else None
