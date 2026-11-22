# -*- coding: utf-8 -*-
"""Genera la CARGA INICIAL de la plantilla del Protocolo de cubicación desde el Excel
«Protocolo 2025» (hoja «Protocolo 2024», versión 3.0, «ACTA DE INICIO DE CUBICACIONES»).

    python scripts/generar_protocolo_inicial.py "C:/ruta/20250326 - Protocolo 2025.xlsx"

Deja dos cosas, que son DATOS y no código (programa §8.13 fila 8.1):
    armahub/data/protocolo_2025.json            secciones → criterios → opciones
    armahub/data/protocolo_2025/croquis/*.png   los croquis del Excel, uno por opción

El botón «Cargar plantilla inicial» (pestaña Plantilla de la caluga Obras, sólo administrador)
lee ese JSON, sube los croquis a R2 y deja la plantilla en la base como versión 1. Desde ahí se
edita en pantalla: este script no vuelve a hacer falta salvo que cambie el Excel.

QUÉ SALE DEL EXCEL Y QUÉ ES LECTURA. Los textos de cada criterio y de cada opción se leen de la
celda que se indica, y el script se detiene si la celda ya no dice lo esperado (el Excel cambió).
Lo que el Excel no dice, porque es una hoja para llenar a mano, es el TIPO de respuesta de cada
criterio: eso es la lectura de más abajo (`PLANTILLA`), y se corrige en pantalla.
"""
import json
import os
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO_JSON = os.path.join(RAIZ, "armahub", "data", "protocolo_2025.json")
DESTINO_CROQUIS = os.path.join(RAIZ, "armahub", "data", "protocolo_2025", "croquis")
HOJA = "Protocolo 2024"

NS = {"xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
      "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}


def slug(texto):
    t = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


# ── La lectura del Excel ────────────────────────────────────────────────────────────────────
# Cada texto: (celda, lo que dice el Excel, cómo se muestra). El tercero puede faltar: se
# muestra tal cual. Cada croquis: (fila, columna) del ancla de la imagen en la hoja.

def T(celda, excel, pantalla=None):
    return {"celda": celda, "excel": excel, "pantalla": pantalla or excel}


def tipos(n, anclas):
    """Opciones «Tipo 1…n» de un detalle, cada una con el croquis de su ancla."""
    return [{"texto": "Tipo %d" % (i + 1), "ancla": anclas[i]} for i in range(n)]


PLANTILLA = [
    ("Datos de la obra", T("A5", "DATOS OBRA"), [
        {"clave": "ubicacion", "texto": T("A7", "Ubicación"), "tipo": "texto"},
        {"clave": "administrador_obra", "texto": T("A9", "Adm Obra", "Administrador de obra"), "tipo": "texto"},
        {"clave": "profesional_terreno", "texto": T("A10", "Profesional de Terreno", "Profesional de terreno"), "tipo": "texto"},
        {"clave": "jefe_oficina_tecnica", "texto": T("A11", "Jefe de Oficina Técnica", "Jefe de oficina técnica"), "tipo": "texto"},
        {"clave": "subterraneos", "texto": T("G8", "Subterráneos"), "tipo": "numero", "unidad": T("I8", "UN", "un")},
        {"clave": "pisos_torre", "texto": T("G9", "Pisos Torre", "Pisos torre"), "tipo": "numero", "unidad": T("I9", "UN", "un")},
        {"clave": "metros_construidos", "texto": T("G10", "Metros Construidos", "Metros construidos"), "tipo": "numero",
         "unidad": T("I10", "M2", "m²")},
        {"clave": "toneladas_proyectadas", "texto": T("G11", "Toneladas Proyectadas", "Toneladas proyectadas"), "tipo": "numero",
         "unidad": T("I11", "TON", "t")},
        # Cada línea del Excel trae una casilla y una fecha de entrega.
        {"clave": "ciclos_subterraneo", "texto": T("A13", "Ciclos constructivos Subt", "Ciclos constructivos subterráneo"),
         "tipo": "si_no"},
        {"clave": "ciclos_subterraneo_entrega", "texto": T("B13", "Fecha Entrega", "Ciclos constructivos subterráneo: fecha de entrega"),
         "tipo": "texto"},
        {"clave": "ciclos_torre", "texto": T("A14", "Ciclos constructivos Torre", "Ciclos constructivos torre"), "tipo": "si_no"},
        {"clave": "ciclos_torre_entrega", "texto": T("B14", "Fecha Entrega", "Ciclos constructivos torre: fecha de entrega"),
         "tipo": "texto"},
    ]),
    ("Losas", T("A16", "DETALLES CONSTRUCTIVOS LOSASLOSAS"), [
        {"clave": "trabas_muro_cantidad", "texto": T("A18", "TRABAS DE MURO", "Trabas de muro: cantidad"), "tipo": "numero",
         "unidad": T("A20", "UN/m2", "un/m²")},
        {"clave": "trabas_muro", "texto": T("A18", "TRABAS DE MURO", "Trabas de muro: parámetros por espesor"), "tipo": "tabla",
         "ayuda": T("C18", "*Abrazan al horizontal o al vertical", "Abrazan al horizontal o al vertical"),
         "croquis": (19, 1, "ultima"),  # dos imágenes en la misma celda: se ve la de encima (con la cota b)
         "columnas": [("espesor", T("C19", "espesor", "Espesor")), ("diametro", "φ"), ("alfa", "α"), ("beta", "β"), ("b", "b")],
         "columnas_de": T("D20", "φ:___α:___ β:___ b:___")},
        {"clave": "reparticiones_diametro", "texto": T("H18", "REPARTICIONES", "Reparticiones: φ"), "tipo": "numero",
         "unidad": "mm", "de": T("I21", "φ:____________")},
        {"clave": "reparticiones", "texto": T("H18", "REPARTICIONES", "Reparticiones"), "tipo": "opcion",
         "opciones": [{"texto": T("J23", "Según geometría")}, {"texto": T("J24", "Barras en 12 mts")}]},
        {"clave": "soportes_losa_cantidad", "texto": T("A26", "SOPORTES LOSAS", "Soportes de losa: cantidad"), "tipo": "numero",
         "unidad": T("A32", "UN/m2", "un/m²")},
        {"clave": "soportes_losa", "texto": T("A26", "SOPORTES LOSAS", "Soportes de losa: parámetros por piso y espesor"),
         "tipo": "tabla", "croquis": (27, 1),
         "columnas": [("piso", T("B27", "Piso:", "Piso")), ("espesor", T("C27", "espesor", "Espesor")), ("a", "a"), ("b", "b"),
                      ("c", "c")],
         "columnas_de": T("D28", "a:___ b:___ c:___")},
    ]),
    ("Muros", T("A35", "DETALLES CONSTRUCTIVOS MUROS"), [
        {"clave": "mh_muro_simple", "texto": T("A36", "MALLAS HORIZONTALES - MURO SIMPLE", "Mallas horizontales: muro simple"),
         "tipo": "opcion", "opciones": tipos(2, [(38, 1), (43, 1)])},
        {"clave": "mh_gancho_alfa", "texto": T("I38", "Angulos Ganchos", "Ángulos de ganchos: α"), "tipo": "numero",
         "unidad": "°", "de": T("I39", "α:")},
        {"clave": "mh_gancho_beta", "texto": T("I38", "Angulos Ganchos", "Ángulos de ganchos: β"), "tipo": "numero",
         "unidad": "°", "de": T("I40", "β:")},
        {"clave": "mh_encuentro_l",
         "texto": T("A47", "MALLAS HORIZONTALES - ENCUENTRO DE MUROS EN L", "Mallas horizontales: encuentro de muros en L"),
         "tipo": "opcion", "opciones": tipos(4, [(49, 1), (49, 7), (63, 1), (63, 7)])},
        {"clave": "mh_encuentro_t",
         "texto": T("A77", "MALLAS HORIZONTALES - ENCUENTRO DE MUROS EN T", "Mallas horizontales: encuentro de muros en T"),
         "tipo": "opcion", "opciones": tipos(4, [(78, 1), (79, 7), (92, 1), (92, 7)])},
        # El cuarto croquis de este bloque dice «ENCUENTRO EN T - TIPO 4» en el Excel: es el
        # Tipo 4 de los remates superiores (está en su bloque y es el cuarto), con el rótulo copiado.
        {"clave": "mv_remate_superior",
         "texto": T("A109", "REMATES SUPERIORES MALLAS VERTICALES", "Remates superiores de mallas verticales"),
         "tipo": "opcion", "opciones": tipos(4, [(111, 1), (111, 7), (127, 1), (127, 7)])},
        {"clave": "mv_remate_inferior_perimetral",
         "texto": T("A144", "REMATES INFERIORES MALLAS VERTICALES - MUROS PERIMETRALES",
                    "Remates inferiores de mallas verticales: muros perimetrales"),
         "tipo": "opcion", "opciones": tipos(3, [(146, 1), (145, 7), (162, 1)])},
        {"clave": "mv_remate_inferior_interior",
         "texto": T("A178", "REMATES INFERIORES MALLAS VERTICALES - MUROS INTERIORES",
                    "Remates inferiores de mallas verticales: muros interiores"),
         "tipo": "opcion", "opciones": tipos(3, [(180, 1), (179, 6), (196, 1)])},
        {"clave": "muro_espesor_concentrico",
         "texto": T("A214", "DISMINUCIÓN DE ESPESOR MURO CONCENTRICO", "Disminución de espesor de muro concéntrico"),
         "tipo": "opcion", "opciones": tipos(3, [(215, 1), (215, 7), (231, 1)])},
        {"clave": "muro_espesor_excentrico",
         "texto": T("A248", "DISMINUCIÓN DE ESPESOR MURO EXCENTRICO", "Disminución de espesor de muro excéntrico"),
         "tipo": "opcion", "opciones": tipos(3, [(249, 1), (249, 7), (265, 1)])},
    ]),
    # Las 15 líneas de la lista de chequeo: el texto es el del Excel sin su número; las opciones
    # son las alternativas que nombra la propia línea.
    ("Lista de chequeo", T("A285", "Check List Obra"), [
        {"clave": "escalas", "texto": T("B286", "1 - Criterio de escalas (In situ o prefabricadas)."), "tipo": "opcion",
         "opciones": ["In situ", "Prefabricadas"]},
        {"clave": "empalmes_vigas", "tipo": "texto",
         "texto": T("B287", "2 - Definición de criterios para empalmes en laterales de vigas y vigas de fundación, "
                            "así como largo de pata y ubicación.")},
        {"clave": "elementos_adicionales", "tipo": "opciones",
         "texto": T("B288", "3 - Existen planos de elementos adicionales (Piscina, Vigas ornamentales o de segunda etapa, "
                            "PEAS, Estanques especiales u otros)."),
         "opciones": ["Piscina", "Vigas ornamentales o de segunda etapa", "PEAS", "Estanques especiales", "Otros"]},
        {"clave": "recubrimientos", "tipo": "tabla",
         "texto": T("B289", "4 - Confirmar criterios de recubrimientos (Muros perimetrales, losas, fundaciones, muros "
                            "interiores, pilares, vigas)."),
         "columnas": [("recubrimiento", "Recubrimiento")],
         "filas": ["Muros perimetrales", "Losas", "Fundaciones", "Muros interiores", "Pilares", "Vigas"]},
        {"clave": "estribos_verticales", "tipo": "opcion",
         "texto": T("B290", "5 - Estribos de elementos verticales (Criterio piso a piso, doble altura o alturas "
                            "determinadas por cliente)."),
         "opciones": ["Piso a piso", "Doble altura", "Alturas determinadas por cliente"]},
        {"clave": "lado_minimo", "tipo": "opcion",
         "texto": T("B291", "6 - Lados menores a 10 veces el diámetro o no definidos, se ajustarán a 10 veces el diámetro, "
                            "salvo que se aplique algún cuadro de NCh 211 o criterio de cliente."),
         "opciones": ["10 veces el diámetro", "Cuadro de NCh 211", "Criterio de cliente"]},
        {"clave": "detalle_especifico", "tipo": "si_no",
         "texto": T("B292", "7 - Para dimensiones de cabezales u otros elementos, prevalece siempre el detalle específico "
                            "por sobre las indicaciones generales.")},
        {"clave": "empalme_mallas", "tipo": "opcion",
         "texto": T("B293", "8 - Empalmes de mallas horizontales y verticales (considerar 60 veces el diámetro + 10 o se "
                            "define criterio distinto)"),
         "opciones": ["60 veces el diámetro + 10", "Criterio distinto"]},
        {"clave": "verticales_nacientes", "tipo": "si_no",
         "texto": T("B294", "9 - Elementos verticales nacientes en losas")},
        {"clave": "postensado", "tipo": "texto",
         "texto": T("B295", "10 - Planos de postensado - Definir soportes de cables, sillas de refuerzo u anclajes de "
                            "cables activos/pasivos, otros)")},
        {"clave": "refuerzos_shaft_nervios", "tipo": "si_no",
         "texto": T("B296", "11 - Refuerzos de shaft y nervios en losas (refuerzos vanos)")},
        {"clave": "trabas_diametro", "tipo": "opcion",
         "texto": T("B297", "12 - Trabas de acuerdo a diámetro de malla del muro o siempre 8mm."),
         "opciones": ["Diámetro de malla del muro", "Siempre 8 mm"]},
        {"clave": "trabas_abrazan", "tipo": "opcion",
         "texto": T("B298", "13 - Trabas abrazan al horizontal y vertical o sólo al vertical para evitar problemas de "
                            "recubrimiento"),
         "opciones": ["Horizontal y vertical", "Sólo vertical"]},
        {"clave": "barras_variables", "tipo": "texto",
         "texto": T("B299", "14 - Barras variables. Revisar criterio de ajuste para que no queden en milímetros")},
        {"clave": "empalme_cambio_diametro", "tipo": "si_no",
         "texto": T("B300", "15 - ¿La longitud de empalme traslapos con cambio de diámetro debe ser la correspondiente a "
                            "la barra de menor diámetro?")},
    ]),
    ("Notas", T("A301", "NOTAS Y OBSERVACIONES"), [
        {"clave": "notas", "texto": T("A301", "NOTAS Y OBSERVACIONES", "Notas y observaciones"), "tipo": "texto"},
    ]),
    ("Firmas", T("A344", "OBRA"), [
        {"clave": "firma_obra_nombre", "texto": T("A345", "Nombre", "Obra: nombre"), "tipo": "texto"},
        {"clave": "firma_obra_cargo", "texto": T("A346", "Cargo", "Obra: cargo"), "tipo": "texto"},
        {"clave": "firma_cubicador_nombre", "texto": T("E345", "Nombre", "Cubicador: nombre"), "tipo": "texto",
         "de": T("E344", "CUBICADOR")},
        {"clave": "firma_usc_nombre", "texto": T("I345", "Nombre", "USC: nombre"), "tipo": "texto", "de": T("I344", "USC")},
    ]),
]


def leer_croquis(z, hoja_xml):
    """{(fila, columna): [archivo de xl/media, …]} de la hoja, en el orden del dibujo (el último se ve encima)."""
    carpeta, nombre = hoja_xml.rsplit("/", 1)
    rels = ET.fromstring(z.read("%s/_rels/%s.rels" % (carpeta, nombre)))
    dibujo = [r.get("Target") for r in rels if r.get("Type", "").endswith("/drawing")][0]
    dibujo = os.path.normpath(os.path.join(carpeta, dibujo)).replace(os.sep, "/")
    dcarp, dnom = dibujo.rsplit("/", 1)
    drels = ET.fromstring(z.read("%s/_rels/%s.rels" % (dcarp, dnom)))
    destino = {r.get("Id"): os.path.normpath(os.path.join(dcarp, r.get("Target"))).replace(os.sep, "/") for r in drels}
    por_ancla = {}
    for ancla in ET.fromstring(z.read(dibujo)):
        desde = ancla.find("xdr:from", NS)
        if desde is None:
            continue
        pos = (int(desde.find("xdr:row", NS).text) + 1, int(desde.find("xdr:col", NS).text) + 1)
        for pic in ancla.iter("{%s}pic" % NS["xdr"]):
            blip = pic.find(".//a:blip", NS)
            por_ancla.setdefault(pos, []).append(destino[blip.get("{%s}embed" % NS["r"])])
    return por_ancla


def main(ruta):
    import openpyxl
    wb = openpyxl.load_workbook(ruta)
    ws = wb[HOJA]
    z = zipfile.ZipFile(ruta)
    libro = ET.fromstring(z.read("xl/workbook.xml"))
    rid = [h.get("{%s}id" % NS["r"]) for h in libro.find("m:sheets", NS) if h.get("name") == HOJA][0]
    lrels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    hoja_xml = "xl/" + [r.get("Target") for r in lrels if r.get("Id") == rid][0].lstrip("/").replace("xl/", "", 1)
    croquis = leer_croquis(z, hoja_xml)
    usados = set()

    def texto(t):
        """El texto en pantalla, comprobando antes que la celda del Excel dice lo esperado."""
        if isinstance(t, str):
            return t
        hay = str(ws[t["celda"]].value or "").strip()
        if hay != t["excel"].strip():
            raise SystemExit("El Excel cambió: %s dice «%s» y se esperaba «%s»." % (t["celda"], hay, t["excel"]))
        return re.sub(r"^\d+\s*-\s*", "", t["pantalla"]).strip()

    os.makedirs(DESTINO_CROQUIS, exist_ok=True)
    for viejo in os.listdir(DESTINO_CROQUIS):
        os.remove(os.path.join(DESTINO_CROQUIS, viejo))

    def guardar_croquis(ancla, nombre):
        fila, col = ancla[0], ancla[1]
        archivos = croquis.get((fila, col)) or []
        if not archivos:
            raise SystemExit("Sin imagen en la fila %d, columna %d del Excel (%s)." % (fila, col, nombre))
        if len(archivos) > 1 and len(ancla) < 3:
            raise SystemExit("Más de una imagen en la fila %d, columna %d (%s)." % (fila, col, nombre))
        origen = archivos[-1]
        usados.add(origen)
        archivo = nombre + os.path.splitext(origen)[1].lower()
        with open(os.path.join(DESTINO_CROQUIS, archivo), "wb") as f:
            f.write(z.read(origen))
        return archivo

    secciones = []
    for titulo, origen, criterios in PLANTILLA:
        texto(origen)  # la sección existe en el Excel
        lista = []
        for c in criterios:
            for extra in ("de", "columnas_de"):
                if c.get(extra):
                    texto(c[extra])
            crit = {"clave": c["clave"], "texto": texto(c["texto"]), "tipo": c["tipo"],
                    "unidad": texto(c.get("unidad", "")), "ayuda": texto(c.get("ayuda", "")), "croquis": "",
                    "opciones": [], "columnas": [], "filas": []}
            if c.get("croquis"):
                crit["croquis"] = guardar_croquis(c["croquis"], c["clave"])
            for o in c.get("opciones", []):
                if isinstance(o, str):
                    # Una opción escrita acá tiene que estar nombrada en la línea del Excel.
                    linea = slug(ws[c["texto"]["celda"]].value)
                    if not all(p in linea for p in slug(o).split("_") if len(p) > 3):
                        raise SystemExit("La opción «%s» no está en el texto de %s." % (o, c["texto"]["celda"]))
                    o = {"texto": o}
                opcion = {"id": slug(texto(o["texto"])), "texto": texto(o["texto"]), "croquis": ""}
                if o.get("ancla"):
                    opcion["croquis"] = guardar_croquis(o["ancla"], "%s__%s" % (c["clave"], opcion["id"]))
                crit["opciones"].append(opcion)
            for cid, col in c.get("columnas", []):
                crit["columnas"].append({"id": cid, "titulo": texto(col), "unidad": ""})
            crit["filas"] = list(c.get("filas", []))
            lista.append(crit)
        secciones.append({"titulo": titulo, "criterios": lista})

    datos = {"nombre": "Protocolo 2025",
             "origen": "%s · hoja «%s» · versión 3.0" % (os.path.basename(ruta), HOJA),
             "croquis": "protocolo_2025/croquis",
             "secciones": secciones}
    with open(DESTINO_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(datos, f, ensure_ascii=False, indent=1)
        f.write("\n")

    sin_usar = sorted(a for lista in croquis.values() for a in lista if a not in usados)
    n_crit = sum(len(s["criterios"]) for s in secciones)
    n_croq = len(os.listdir(DESTINO_CROQUIS))
    print("Secciones: %d · criterios: %d · croquis: %d" % (len(secciones), n_crit, n_croq))
    print("Imágenes del Excel que no son croquis de un criterio:", ", ".join(sin_usar) or "ninguna")
    print(DESTINO_JSON)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
