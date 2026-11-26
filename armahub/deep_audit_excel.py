# -*- coding: utf-8 -*-
"""
DEEP AUDIT › EL EXCEL DE UNA CORRIDA (26-nov, SPECS §16.4, fase 1).

Para trabajar con la auditoría mientras llega la pantalla. Sale de la misma corrida que se
guarda (deep_audit.auditar), así que no hay dos verdades:
  · Mapa: pisos en filas (la torre arriba, la fundación abajo), ciclos en columnas, un CC por
    celda con el color de su estado y la marca de sus hallazgos; el clic lleva a sus hallazgos.
  · Hallazgos: uno por fila, para filtrar y validar.
  · CC: un CC por fila (los totales del mapa son fórmulas sobre esta hoja).
  · Barras: una barra por fila, para filtrar por elemento, marca o cubicador.
  · Cubicadores: qué cubicó cada uno y qué tan prolijo (nombres y marcas).

Sin rutas ni fastapi.
"""
import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.hyperlink import Hyperlink

from .deep_audit import POR_MINUSCULA, clasificar_marca

F = "Arial"
_FINO = Side(style="thin", color="C9CDD3")
BORDE = Border(left=_FINO, right=_FINO, top=_FINO, bottom=_FINO)
CAB = PatternFill("solid", start_color="1F2937")
GRIS = PatternFill("solid", start_color="F3F4F6")
# Color por estado (usuario, 26-nov): Open gris · Processed ámbar · Shipped verde claro ·
# Shipped en las últimas 3 semanas verde intenso.
COLOR_ESTADO = {"Open": "E5E7EB", "Processed": "FBD38D", "Shipped": "D9EDC2", "reciente": "7EBA27"}
COLOR_GRAVEDAD = {"alta": "FDE2E2", "media": "FEF0D9", "aviso": "F3F4F6"}
REGLAS = {"N1": "Nombre", "N2": "Marcas", "D1": "Duplicado", "D2": "Doble pedido", "E1": "Open estancado",
          "E2": "Cambio tras confirmar", "E3": "Borrado de aSa", "F1": "Figuras", "K1": "Peso fuera de rango", "R1": "Reproceso",
          "Q1": "Reclamo"}
TON = '#,##0'


def _cel(ws, fila, col, valor, negrita=False, tam=10, fmt=None, relleno=None, envolver=False):
    x = ws.cell(row=fila, column=col, value=valor)
    x.font = Font(name=F, bold=negrita, size=tam)
    x.border = BORDE
    if fmt:
        x.number_format = fmt
    if relleno:
        x.fill = PatternFill("solid", start_color=relleno)
    if envolver:
        x.alignment = Alignment(wrap_text=True, vertical="top")
    return x


def _cabecera(ws, fila, titulos, anchos=None):
    for j, t in enumerate(titulos, 1):
        x = ws.cell(row=fila, column=j, value=t)
        x.font = Font(name=F, bold=True, color="FFFFFF", size=9)
        x.fill = CAB
        x.border = BORDE
        x.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for j, w in enumerate(anchos or [], 1):
        ws.column_dimensions[get_column_letter(j)].width = w


def color_de(c: dict) -> str:
    return COLOR_ESTADO["reciente"] if c.get("reciente") else COLOR_ESTADO.get(c["estado"], "FFFFFF")


def fila_piso(c: dict) -> str:
    return "Fundación" if c.get("sector") == "FUND" else (c.get("piso") or "")


def orden_piso(p: str) -> tuple:
    """La torre arriba, los subterráneos abajo, la fundación al fondo."""
    m = re.match(r"^([PS])(\d+)$", p or "")
    if not m:
        return (3, 0)
    return (0, -int(m.group(2))) if m.group(1) == "P" else (1, int(m.group(2)))


def orden_ciclo(c: str) -> tuple:
    return (c[0], int(c[1:])) if c and c[1:].isdigit() else ("~", 0)


def en_grilla(c: dict) -> bool:
    return c["tipo"] == "normal" and bool(fila_piso(c)) and bool(c.get("ciclo"))


# ---------------------------------------------------------------------------
# Hojas planas: CC, Hallazgos, Barras, Cubicadores
# ---------------------------------------------------------------------------
def hoja_cc(wb, ccs: list):
    ws = wb.create_sheet("CC")
    _cabecera(ws, 1, ["CC", "Descripción", "Sector", "Piso", "Ciclo", "Estado", "Kg", "Fecha", "Envío", "Cubicador",
                      "Hallazgos", "En el mapa"], [8, 34, 9, 10, 7, 11, 10, 11, 11, 14, 10, 10])
    for i, c in enumerate(sorted(ccs, key=lambda c: c.get("fecha") or ""), 2):
        vals = [c["cc"], c["descr"], c.get("sector"), fila_piso(c), c.get("ciclo"), c["estado"], c["kg"],
                (c.get("fecha") or "")[:10], (c.get("envio") or "")[:10], c.get("cubicador"), c.get("n_hallazgos", 0),
                "sí" if en_grilla(c) else "no"]
        for j, v in enumerate(vals, 1):
            _cel(ws, i, j, v, fmt=TON if j == 7 else None, relleno=color_de(c) if j == 6 else None)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:L%d" % (len(ccs) + 1)
    return len(ccs) + 1


def hoja_hallazgos(wb, ccs: list, hs: list) -> dict:
    """Devuelve {cc: fila} de su primer hallazgo, para los enlaces del mapa."""
    ws = wb.create_sheet("Hallazgos")
    por = {c["cc"]: c for c in ccs}
    _cabecera(ws, 1, ["CC", "Piso", "Ciclo", "Descripción", "Estado", "Cubicador", "Regla", "Gravedad", "Hallazgo",
                      "Kg", "Validación", "Nota"], [8, 9, 7, 26, 10, 14, 18, 9, 70, 9, 12, 30])
    primera = {}
    orden = sorted(hs, key=lambda h: (h["cc"] is None, h["cc"] or "", ["alta", "media", "aviso"].index(h["gravedad"])))
    for i, h in enumerate(orden, 2):
        c = por.get(h["cc"]) or {}
        primera.setdefault(h["cc"], i)
        vals = [h["cc"], fila_piso(c) if c else None, c.get("ciclo"), c.get("descr"), c.get("estado"), c.get("cubicador"),
                "%s %s" % (h["regla"], REGLAS.get(h["regla"], "")), h["gravedad"], h["titulo"], h["kg"], None, None]
        for j, v in enumerate(vals, 1):
            _cel(ws, i, j, v, fmt=TON if j == 10 else None, envolver=(j == 9),
                 relleno=COLOR_GRAVEDAD.get(h["gravedad"]) if j == 8 else None)
    dv = DataValidation(type="list", formula1='"confirmado,descartado"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add("K2:K%d" % (len(hs) + 1))
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:L%d" % (len(hs) + 1)
    return primera


def _fila_barra(c: dict, it: dict) -> list:
    marca = str(it.get("Notes") or "").strip()
    estado = {"ok": "ok", "mayusculas": "mal escrita (es %s)" % POR_MINUSCULA.get(marca.lower(), ""),
              "fuera": "fuera del modelo", "vacia": "sin marca"}[clasificar_marca(marca)]
    return [c["cc"], fila_piso(c), c.get("ciclo"), c.get("sector"), c["estado"], c.get("cubicador"), it.get("ElementID"),
            it.get("LineNum"), it.get("BarMark"), marca, estado, it.get("BarSizeDescr"), it.get("ShpNameID") or "Recta",
            round(float(it.get("LengthTheor") or 0) / 10, 1), float(it.get("TotalQty") or 0),
            round(float(it.get("LineWeight") or 0), 1)]


def hoja_barras(wb, ccs: list, items: dict):
    ws = wb.create_sheet("Barras")
    _cabecera(ws, 1, ["CC", "Piso", "Ciclo", "Sector", "Estado CC", "Cubicador", "Elemento", "Línea", "Marca aSa",
                      "Marca", "Marca: modelo", "φ", "Figura", "Largo (cm)", "Cant", "Kg"],
              [8, 9, 7, 8, 10, 14, 14, 6, 11, 8, 20, 7, 8, 10, 8, 9])
    i = 1
    for c in sorted(ccs, key=lambda c: c.get("fecha") or ""):
        for it in sorted(items.get(c["cc"]) or [], key=lambda x: (x.get("ElementID") or "", x.get("LineNum") or 0)):
            i += 1
            for j, v in enumerate(_fila_barra(c, it), 1):
                x = ws.cell(row=i, column=j, value=v)
                x.font = Font(name=F, size=9)
            if ws.cell(row=i, column=11).value != "ok":
                ws.cell(row=i, column=11).fill = PatternFill("solid", start_color=COLOR_GRAVEDAD["media"])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:P%d" % i


def hoja_cubicadores(wb, kp: dict):
    ws = wb.create_sheet("Cubicadores")
    _cabecera(ws, 1, ["Cubicador", "CC", "Kg", "CC con nombre fuera de norma", "% nombres", "CC con marcas observadas",
                      "% marcas"], [18, 8, 12, 16, 11, 16, 11])
    for i, (nombre, k) in enumerate(sorted(kp["cubicadores"].items(), key=lambda x: -x[1]["kg"]), 2):
        for j, v in enumerate([nombre, k["cc"], k["kg"], k["nombre"], "=D%d/B%d" % (i, i), k["marcas"],
                               "=F%d/B%d" % (i, i)], 1):
            _cel(ws, i, j, v, fmt=TON if j == 3 else ("0%" if j in (5, 7) else None))


# ---------------------------------------------------------------------------
# El mapa
# ---------------------------------------------------------------------------
def _leyenda(ws, fila):
    ws.cell(row=fila, column=1, value="Estado:").font = Font(name=F, size=9, bold=True)
    for j, (texto, clave) in enumerate((("Open", "Open"), ("Processed", "Processed"), ("Shipped", "Shipped"),
                                        ("Shipped últimas 3 semanas", "reciente")), 2):
        x = _cel(ws, fila, j, texto, tam=9, relleno=COLOR_ESTADO[clave])
        x.alignment = Alignment(horizontal="center")
    ws.cell(row=fila, column=7, value="⚠ n = hallazgos del CC (clic para verlos)").font = Font(name=F, size=9, color="667085")


def _kpis(ws, fila, kp):
    porest = kp["kg_por_estado"]
    textos = ["Kilos: %s" % _n(kp["kg_total"]), "Open %s · Processed %s · Shipped %s" % (
        _n(porest.get("Open", 0)), _n(porest.get("Processed", 0)), _n(porest.get("Shipped", 0))),
        "CC con hallazgos: %d de %d" % (kp["ccs_con_hallazgos"], kp["ccs"]),
        "Reprocesos: %s kg (%s %%)" % (_n(kp["kg_reprocesos"]), kp["pct_reprocesos"]), "Reclamos: %d" % kp["reclamos"]]
    ws.cell(row=fila, column=1, value="   ·   ".join(textos)).font = Font(name=F, size=10, bold=True)


def _n(v) -> str:
    return "{:,.0f}".format(v or 0).replace(",", ".")


def _texto_cc(c) -> str:
    return "%s · %s · %s kg%s" % (c["cc"], c["descr"], _n(c["kg"]), ("  ⚠%d" % c["n_hallazgos"]) if c.get("n_hallazgos") else "")


def _celda_cc(ws, fila, col, c, enlaces):
    x = _cel(ws, fila, col, _texto_cc(c), tam=9, relleno=color_de(c))
    if c["cc"] in enlaces:
        x.hyperlink = Hyperlink(ref=x.coordinate, location="'Hallazgos'!A%d" % enlaces[c["cc"]])
        x.font = Font(name=F, size=9, bold=True, underline="single")


def _bloque_piso(ws, fila, p, celdas, ciclos, enlaces, n_cc) -> int:
    """Un piso: tantas filas como CC tenga su ciclo más cargado. Devuelve cuántas usó."""
    alto = max(len(v) for v in celdas.values())
    _cel(ws, fila, 1, p, negrita=True, relleno="F3F4F6").alignment = Alignment(horizontal="center", vertical="center")
    for k in range(alto):
        for j, z in enumerate(ciclos, 2):
            if k < len(celdas[z]):
                _celda_cc(ws, fila + k, j, celdas[z][k], enlaces)
            else:
                _cel(ws, fila + k, j, None)
    total = _cel(ws, fila, len(ciclos) + 2, "=SUMIFS(CC!$G$2:$G$%d,CC!$D$2:$D$%d,\"%s\",CC!$L$2:$L$%d,\"sí\")"
                 % (n_cc, n_cc, p, n_cc), negrita=True, fmt=TON)
    total.alignment = Alignment(vertical="center")
    if alto > 1:
        ws.merge_cells(start_row=fila, start_column=1, end_row=fila + alto - 1, end_column=1)
        ws.merge_cells(start_row=fila, start_column=len(ciclos) + 2, end_row=fila + alto - 1, end_column=len(ciclos) + 2)
    return alto


def _grilla(ws, fila, ccs, enlaces, n_cc):
    dentro = [c for c in ccs if en_grilla(c)]
    pisos = sorted({fila_piso(c) for c in dentro}, key=orden_piso)
    ciclos = sorted({c["ciclo"] for c in dentro}, key=orden_ciclo)
    ultimo_p = ([p for p in pisos if p.startswith("P")] or [None])[-1]
    _cabecera(ws, fila, ["Piso"] + ciclos + ["Total (kg)"])
    fila += 1
    for p in pisos:
        celdas = {z: [c for c in dentro if fila_piso(c) == p and c["ciclo"] == z] for z in ciclos}
        fila += _bloque_piso(ws, fila, p, celdas, ciclos, enlaces, n_cc)
        if p == ultimo_p:   # la línea de terreno, bajo el piso más bajo de la torre
            ws.cell(row=fila, column=1, value="— terreno —").font = Font(name=F, size=8, italic=True, color="667085")
            fila += 1
    for j in range(2, len(ciclos) + 2):
        ws.column_dimensions[get_column_letter(j)].width = 34
    return fila


def _fuera(ws, fila, ccs, enlaces):
    fuera = [c for c in ccs if not en_grilla(c)]
    if not fuera:
        return fila
    ws.cell(row=fila, column=1, value="Fuera de la grilla (reprocesos, adicionales y CC sin piso o ciclo)").font = Font(name=F, bold=True)
    for k, c in enumerate(sorted(fuera, key=lambda c: c.get("fecha") or ""), 1):
        _celda_cc(ws, fila + k, 2, c, enlaces)
    return fila + len(fuera) + 1


def hoja_mapa(ws, corrida: dict, enlaces: dict, n_cc: int):
    ws.title = "Mapa"
    ws["A1"] = "Deep Audit · %s · corrida %s" % (corrida["obra"], corrida["id"])
    ws["A1"].font = Font(name=F, bold=True, size=14)
    ws["A2"] = "Fuente: aSa en vivo y ArmaHub. Cada celda: CC · descripción · kg. Los totales suman la hoja «CC»."
    ws["A2"].font = Font(name=F, italic=True, size=9, color="667085")
    _kpis(ws, 3, corrida["kpis"])
    _leyenda(ws, 4)
    fila = _grilla(ws, 6, corrida["ccs"], enlaces, n_cc)
    _fuera(ws, fila + 1, corrida["ccs"], enlaces)
    ws.column_dimensions["A"].width = 11
    ws.freeze_panes = "B7"


def libro(corrida: dict) -> Workbook:
    """El Excel de una corrida (lo que devuelve deep_audit.auditar)."""
    por_cc = {}
    for h in corrida["hallazgos"]:
        por_cc[h["cc"]] = por_cc.get(h["cc"], 0) + 1
    for c in corrida["ccs"]:
        c["n_hallazgos"] = por_cc.get(c["cc"], 0)
    wb = Workbook()
    mapa = wb.active
    n_cc = hoja_cc(wb, corrida["ccs"])
    enlaces = hoja_hallazgos(wb, corrida["ccs"], corrida["hallazgos"])
    hoja_mapa(mapa, corrida, enlaces, n_cc)
    hoja_barras(wb, corrida["ccs"], corrida["items"])
    hoja_cubicadores(wb, corrida["kpis"])
    wb.move_sheet("Hallazgos", offset=-1)
    return wb
