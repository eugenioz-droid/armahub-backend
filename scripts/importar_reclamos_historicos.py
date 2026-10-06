"""
IMPORTAR LOS RECLAMOS HISTORICOS (2022-2025) A LA PLATAFORMA.

    python scripts/importar_reclamos_historicos.py            -> PRUEBA, no escribe nada
    python scripts/importar_reclamos_historicos.py --cargar    -> escribe en la base

QUE HACE. Lee las planillas de entrada/Reclamos y deja cada reclamo viejo como una fila
de `reclamos`, marcada como historica y cerrada. No pasa por ningun flujo de validacion:
esto ya ocurrio, no hay nada que aprobar. Lo que interesa es la estadistica, errores por
ano y por mes, separando por cubicador y por segmento.

2026 NO SE TOCA. Ese ano se esta llevando en la plataforma: de los 91 asuntos de la
planilla 2026, 87 ya estan cargados. Importarlo duplicaria el ano en curso. El tope esta
puesto a proposito y el script se niega si alguien agrega una hoja de 2026.

SE PUEDE CORRER DOS VECES. Cada fila lleva una `clave_import` unica; si una planilla se
corrige, se vuelve a correr y las filas se ACTUALIZAN en su lugar en vez de duplicarse.
Por eso vale la pena correrlo primero en prueba y mirar los numeros.

DE DONDE SALEN LOS KILOS MAL FABRICADOS. Una columna distinta por ano, confirmada una por
una por el usuario (la letra es la de la planilla):

    2022 -> P, 'KG'          2023 -> P, 'Kg Error'
    2024 -> U, 'KG'          2025 -> Q, 'KG'

En 2022 esa columna repite 184,13 en 136 de 156 filas. No es un arrastre: ese ano aSa
venia en implementacion y no se tenian todos los kilos, asi que se aplico un estandar
definido entonces. Es el valor oficial del ano y entra tal cual.

LO QUE NO SE INVENTA:

  · El Ishikawa. Empezo a existir despues, asi que la mayoria entra sin causa. Solo se
    carga lo que la planilla trae y calza con el catalogo por texto. El resto es la
    arqueologia que viene despues, a mano.
  · Los nombres de pila. 2023 en adelante dicen "Jose", y hay dos (Pantoja y Rodriguez).
    No se adivina: se resuelve cruzando contra la hoja "BD Consolidado", que trae el
    nombre completo de las mismas filas. Medido: en 2023 y 2024 "Jose" es SIEMPRE Jose
    Rodriguez; Pantoja solo aparece en 2022 y con nombre completo.
"""
import csv
import io
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, "scripts"))
from asa_ping import cargar_env  # noqa: E402

cargar_env()
os.environ.setdefault("JWT_SECRET", "import-local-no-sirve-en-produccion")

from armahub.db import get_conn  # noqa: E402

CARPETA = os.path.join(RAIZ, "entrada", "Reclamos")
CARGAR = "--cargar" in sys.argv
ANIO_TOPE = 2025          # 2026 lo lleva la plataforma; ver el encabezado
CREADO_POR = "importacion.historica"
TOPE_FILAS = 1500         # ninguna hoja real pasa de 750; la hoja 2022 declara un millon


# ─────────────────────────────────────────────────────────────────────────────
# DE QUE HOJA SALE CADA ANO, Y COMO SE LLAMA CADA COSA EN ELLA
#
# Cada ano se llevo distinto. En vez de una heuristica que adivine, se declara el mapa:
# es lo unico que se mira cuando un numero no cuadra. `kilos` es LA columna validada de
# ese ano (el usuario: "son solo los definidos en la columna original"); None = ese ano
# no tiene kilos confiables.
# ─────────────────────────────────────────────────────────────────────────────
HOJAS = [
    {"anio": 2022, "libro": "Consolidado Reclamos - 2022-2024.xlsx", "hoja": "2022", "cab": 1,
     "asunto": "Asunto", "obra": "Cliente", "fecha": "Fecha de informe", "causa": "Descripción Causa",
     "detalle": "Información Complementaria", "cubicador": "CUBICADOR", "aplica": "ESTADO",
     # Columna P. Repite 184,13 en 136 de 156 filas y eso NO es un error de arrastre: ese
     # ano no se tenian todos los kilos, asi que se aplico un estandar definido entonces.
     # Ese es el valor oficial del ano y entra tal cual.
     "segmento": "SEGMENTO", "servicio": "SERVICIO", "kilos": "KG", "id": "ID",
     "tecnico": "Técnico de servicios"},
    {"anio": 2023, "libro": "Consolidado Reclamos - 2022-2024.xlsx", "hoja": "2023", "cab": 3,
     "asunto": "Asunto", "obra": "Cliente", "fecha": "Fecha de informe", "causa": "Descripción Causa",
     "detalle": "Información Complementaria", "cubicador": "CUBICADOR", "aplica": "Tipo",
     "segmento": "SEGMENTO", "servicio": "SERVICIO", "kilos": "Kg Error", "id": "ID",
     "observaciones": "OBSERVACIONES"},
    {"anio": 2024, "libro": "Consolidado Reclamos - 2022-2024.xlsx", "hoja": "2024", "cab": 1,
     "asunto": "Asunto", "obra": "Cliente", "fecha": "Fecha", "causa": "Descripción Causa",
     "detalle": "Información Complementaria", "cubicador": "CUBICADOR", "aplica": "Meta",
     "segmento": "Tipo Obra", "servicio": "SERVICIO", "kilos": "KG", "id": "ID",
     "observaciones": "Observaciones", "ishikawa": "ISHIKAWA", "causa_texto": "CAUSA",
     "accion": "ACCION", "porques": "¿Por qué?"},
    {"anio": 2025, "libro": "2025 - Consolidado Reclamos.xlsx", "hoja": "Reclamos 2025", "cab": 1,
     "asunto": "Asunto", "obra": "Cliente", "fecha": "Fecha", "causa": "Descripción Causa",
     "detalle": "Información Complementaria", "cubicador": "CUBICADOR", "aplica": "META",
     "segmento": "Tipo Obra", "servicio": "SERVICIO", "kilos": "KG", "id": "ID",
     "observaciones": "Observaciones", "causa_texto": "CAUSA (ISHIKAWA)", "cod": "Cod"},
]

# La "Descripcion Causa" de las planillas, al vocabulario de la plataforma. Las variantes
# son de escritura (mayusculas, "de"), no de significado.
TIPOS = {
    "error de cubicacion": "error",
    "error en hc": "error",
    "faltante cubicacion": "faltante",
    "faltante de cubicacion": "faltante",
    "atraso de cubicacion": "atraso",
    "portal no actualizado": "actualizacion_portal",
    "actualizacion portal": "actualizacion_portal",
    "actualizacion cubicaciones": "actualizacion_portal",
    "diferencia de kg": "diferencia_kg",
    "incumplimiento procedimiento": "documentacion",
}
# Lo que dice la planilla sobre si el reclamo aplica al area.
APLICA = {"aplica": "si", "si": "si",
          "no aplica": "no", "no procede": "no", "no": "no",
          "revisar": "pendiente"}
# Quien es quien. Resuelto cruzando las hojas por ano contra "BD Consolidado"; los que no
# son personas (una empresa, un servicio externo) se marcan para que no ensucien el corte
# por cubicador.
NOMBRES = {
    "jose pantoja": "José Pantoja", "jose rodriguez": "José Rodriguez",
    "gerardo": "Gerardo Mendoza", "gerardo mendoza": "Gerardo Mendoza",
    "daniel": "Daniel Venegas", "daniel venegas": "Daniel Venegas",
    "mario": "Mario Puyo", "mario puyo": "Mario Puyo",
    "johnny": "Johnny Sanchez", "johnny sanchez": "Johnny Sanchez",
    "carlos": "Carlos Santos", "carlos santos": "Carlos Santos",
    "jose": "José Rodriguez",          # en 2023-2025 "Jose" es siempre Rodriguez
    "javier": "Javier Velasquez", "emilio": "Emilio Ramirez",
    "nicolas": "Nicolas Lopez", "hans": "Hans Mondaca",
    # RMC no es una persona: es un proveedor EXTERNO de cubicacion. Confirmado por el
    # usuario y por aSa, donde detallo 703 codigos en 2024 en las mismas obras de sus
    # reclamos. Cuenta como un cubicador externo mas; antes quedaba "sin asignar".
    "rmc": "RMC",
}
NO_PERSONAS = {"mapec", "na", ""}   # basura o un dato suelto: no son un cubicador


def sinacento(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c))


def norm(s):
    return re.sub(r"\s+", " ", sinacento(s).strip().lower())


def clave_cruce(asunto, fecha):
    a = re.sub(r"^(rv:|re:|rm:)\s*", "", norm(asunto))
    return re.sub(r"[^a-z0-9]+", "", a)[:40] + "|" + str(fecha)[:10]


def num(v):
    try:
        f = float(str(v).replace(",", "."))
        return f
    except (TypeError, ValueError):
        return None


def fecha_iso(v):
    s = str(v or "").strip()
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    m = re.match(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)
    if m:
        return "%s-%02d-%02d" % (m.group(3), int(m.group(2)), int(m.group(1)))
    return None


# ─────────────────────────────────────────────────────────────────────────────
# LEER LAS PLANILLAS
# ─────────────────────────────────────────────────────────────────────────────
def leer_hoja(libro, hoja, cab):
    """Las filas de una hoja, como lista de diccionarios. Se ACOTA el recorrido porque la
    hoja '2022' declara 1.048.429 filas aunque tiene 156, y recorrerlas tarda minutos."""
    import openpyxl
    wb = openpyxl.load_workbook(os.path.join(CARPETA, libro), data_only=True, read_only=True)
    ws = wb[hoja]
    filas, titulos, vacias = [], None, 0
    for f in ws.iter_rows(min_row=cab, max_row=cab + TOPE_FILAS, values_only=True):
        vals = ["" if c is None else str(c).strip() for c in f]
        if titulos is None:
            titulos = vals
            continue
        if not any(vals):
            vacias += 1
            if vacias >= 60:
                break
            continue
        vacias = 0
        filas.append(vals)
    wb.close()
    return titulos, filas


def columna(titulos, nombre):
    if not nombre:
        return None
    objetivo = norm(nombre)
    for j, t in enumerate(titulos):
        if norm(t) == objetivo:
            return j
    return None


def valor(titulos, fila, nombre):
    j = columna(titulos, nombre)
    if j is None or j >= len(fila):
        return ""
    return fila[j].strip()


def nombres_completos():
    """El diccionario fila -> nombre completo, de la hoja 'BD Consolidado'. Es lo que
    permite saber que 'Jose' de 2023 es Jose Rodriguez y no Jose Pantoja."""
    titulos, filas = leer_hoja("Consolidado Reclamos - 2022-2024.xlsx", "BD Consolidado", 2)
    salida = {}
    for f in filas:
        cub = valor(titulos, f, "Cubicador")
        if cub:
            salida[clave_cruce(valor(titulos, f, "Asunto"), valor(titulos, f, "Fecha"))] = cub
    return salida


def catalogo_ishikawa(cur):
    """El catalogo que ya vive en la plataforma, indexado por texto normalizado, para
    poder enganchar las causas que las planillas traen escritas."""
    cur.execute("""SELECT s.codigo, c.slug, s.descripcion
                     FROM area_rca_subcausas s
                     JOIN area_rca_categorias c ON c.id = s.categoria_id
                     JOIN areas a ON a.id = c.area_id
                    WHERE a.nombre = 'Cubicaciones'""")
    por_texto = {}
    for codigo, slug, desc in cur.fetchall():
        por_texto[re.sub(r"[^a-z0-9]+", "", norm(desc))] = (codigo, slug, desc)
    return por_texto


def causa_de(texto, catalogo):
    """Engancha el texto de la planilla con el catalogo. Solo si calza de verdad: si no,
    devuelve nada y el reclamo queda sin causa, que es lo honesto."""
    t = re.sub(r"[^a-z0-9]+", "", norm(texto or ""))
    if len(t) < 8:
        return None
    if t in catalogo:
        return catalogo[t]
    for clave, v in catalogo.items():
        if clave.startswith(t[:28]) or t.startswith(clave[:28]):
            return v
    return None


# ─────────────────────────────────────────────────────────────────────────────
# ARMAR EL RECLAMO
# ─────────────────────────────────────────────────────────────────────────────
def armar(cfg, titulos, fila, n_fila, completos, catalogo, avisos):
    anio = cfg["anio"]
    asunto = valor(titulos, fila, cfg["asunto"])
    fecha = fecha_iso(valor(titulos, fila, cfg["fecha"]))
    if not asunto or not fecha:
        avisos["sin asunto o sin fecha"] += 1
        return None
    if not fecha.startswith(str(anio)):
        # Una fila de otro ano dentro de la hoja: puede ser un arrastre. Se avisa y se usa
        # el ano de la FECHA, que es el dato duro, no el de la hoja.
        avisos["fecha de otro ano (%s en hoja %s)" % (fecha[:4], anio)] += 1
    anio_real = int(fecha[:4])
    if anio_real > ANIO_TOPE:
        avisos["descartada por ser %d (ese ano lo lleva la plataforma)" % anio_real] += 1
        return None

    crudo = valor(titulos, fila, cfg["cubicador"])
    cub_nombre = None
    if norm(crudo) not in NO_PERSONAS:
        lleno = completos.get(clave_cruce(asunto, fecha))
        cub_nombre = NOMBRES.get(norm(lleno or crudo))
        if not cub_nombre:
            cub_nombre = (lleno or crudo).strip() or None
            if cub_nombre and num(cub_nombre) is not None:
                cub_nombre = None          # "0.3945..." no es un nombre
                avisos["cubicador ilegible"] += 1
    else:
        avisos["sin cubicador persona (%s)" % (crudo or "vacio")] += 1

    tipo = TIPOS.get(norm(valor(titulos, fila, cfg["causa"])))
    if not tipo:
        texto_causa = norm(valor(titulos, fila, cfg["causa"]))
        if texto_causa:
            avisos["tipo no mapeado: %s" % texto_causa[:32]] += 1
        tipo = "error"

    bruto_aplica = norm(valor(titulos, fila, cfg["aplica"]))
    aplica = APLICA.get(bruto_aplica)
    if aplica is None:
        # En 2023 y 2024 la columna 'Tipo' dice "Reclamo" salvo cuando no procede.
        aplica = "si" if bruto_aplica in ("reclamo", "") else "si"

    kilos = None
    if cfg["kilos"]:
        kilos = num(valor(titulos, fila, cfg["kilos"]))

    seg = valor(titulos, fila, cfg["segmento"]).strip()
    segmento = {"edificacion": "Edificación", "otro": "Otros", "otros": "Otros"}.get(norm(seg), seg or None)
    serv = norm(valor(titulos, fila, cfg["servicio"]))
    servicio = {"interno": "Interno", "externo": "Externo"}.get(serv)

    # La causa raiz, SOLO si la planilla la trae y calza con el catalogo.
    cat = cod = subcausa = None
    hit = causa_de(valor(titulos, fila, cfg.get("causa_texto")), catalogo)
    if hit:
        cod, cat, subcausa = hit

    # Los cinco porques, donde se llenaron (solo 2024).
    porques = []
    if cfg.get("porques"):
        for j, t in enumerate(titulos):
            if norm(t) == norm(cfg["porques"]) and j < len(fila) and fila[j].strip():
                porques.append(fila[j].strip())

    id_icarus = valor(titulos, fila, cfg.get("id")) or None
    if id_icarus and num(id_icarus) is not None:
        id_icarus = str(int(num(id_icarus)))

    # LA LLAVE. El ID de Icarus seria lo natural, pero falta seguido (en 2023 viene en 24
    # de 104 filas), asi que la base de la llave es ano + hoja + asunto + fecha. OJO: eso
    # NO basta. Hay 14 reclamos distintos que comparten asunto y fecha —la misma obra
    # reclama dos veces el mismo dia y el asunto se escribe igual—, y con la llave pelada
    # se pisaban entre ellos: cargaban 497 de 511. El ordinal los separa, y se saca del
    # orden de aparicion en la hoja, que no cambia al reimportar.
    clave = "hist|%s|%s|%s" % (anio, cfg["hoja"], clave_cruce(asunto, fecha))
    if id_icarus:
        clave += "|" + id_icarus

    return {
        "clave_import": clave,
        "fuente": "%s · hoja %s · fila %d" % (cfg["libro"], cfg["hoja"], n_fila),
        "anio": anio_real,
        "titulo": asunto[:400],
        "descripcion": valor(titulos, fila, cfg["detalle"]) or None,
        "observaciones": valor(titulos, fila, cfg.get("observaciones")) or None,
        "obra_texto": valor(titulos, fila, cfg["obra"]) or None,
        "fecha_deteccion": fecha,
        "tipo_reclamo": tipo,
        "aplica": aplica,
        "kilos": kilos,
        "segmento": segmento,
        "servicio": servicio,
        "cubicador": cub_nombre,
        "id_calidad": id_icarus,
        "categoria_ishikawa": cat,
        "cod_causa": cod,
        "sub_causa": subcausa,
        "cinco_por_que": porques or None,
        "analista": valor(titulos, fila, cfg.get("tecnico")) or None,
    }


def correo_de(nombre, usuarios):
    """El email del cubicador si es usuario de la plataforma. Si no lo es (gente que ya no
    esta), queda el nombre: los tableros ya saben mostrar lo uno o lo otro."""
    return usuarios.get(norm(nombre or ""), nombre)


def main():
    if not os.path.isdir(CARPETA):
        print("No existe la carpeta %s" % CARPETA)
        return 1
    print("MODO: %s\n" % ("CARGAR (escribe en la base)" if CARGAR else "PRUEBA (no escribe nada)"))

    completos = nombres_completos()
    print("Nombres completos disponibles para cruzar: %d filas\n" % len(completos))

    with get_conn() as conn:
        with conn.cursor() as cur:
            catalogo = catalogo_ishikawa(cur)
            cur.execute("""SELECT email, TRIM(COALESCE(nombre,'') || ' ' || COALESCE(apellido,''))
                             FROM users WHERE COALESCE(activo, TRUE)""")
            usuarios = {norm(n): e for e, n in cur.fetchall() if n.strip()}

            todos, avisos = [], defaultdict(Counter)
            for cfg in HOJAS:
                if cfg["anio"] > ANIO_TOPE:
                    continue
                titulos, filas = leer_hoja(cfg["libro"], cfg["hoja"], cfg["cab"])
                av = avisos[cfg["anio"]]
                hoja, vistas = [], Counter()
                for i, f in enumerate(filas, start=cfg["cab"] + 1):
                    r = armar(cfg, titulos, f, i, completos, catalogo, av)
                    if not r:
                        continue
                    # El ordinal que separa a los repetidos. Se asigna EN EL ORDEN DE LA
                    # HOJA, antes de ordenar por fecha, para que reimportar de la misma
                    # planilla vuelva a dar exactamente la misma llave.
                    vistas[r["clave_import"]] += 1
                    if vistas[r["clave_import"]] > 1:
                        r["clave_import"] += "#%d" % vistas[r["clave_import"]]
                        av["mismo asunto y fecha, se separan con ordinal"] += 1
                    hoja.append(r)
                # El correlativo del ano, por fecha: el histórico queda ordenado como
                # ocurrió, no como quedó escrito en la planilla.
                hoja.sort(key=lambda r: (r["fecha_deteccion"], r["titulo"]))
                for n, r in enumerate(hoja, start=1):
                    r["correlativo"] = "H-%d-%03d" % (r["anio"], n)
                    r["numero"] = n
                todos.extend(hoja)
                con_kg = [r for r in hoja if r["kilos"]]
                print("%d: %d reclamos | %d con kilos (%s kg) | %d con causa | %d sin cubicador"
                      % (cfg["anio"], len(hoja), len(con_kg),
                         format(int(sum(r["kilos"] for r in con_kg)), ",d").replace(",", "."),
                         sum(1 for r in hoja if r["categoria_ishikawa"]),
                         sum(1 for r in hoja if not r["cubicador"])))
                for k, v in av.most_common():
                    print("      aviso: %s x%d" % (k, v))

            print("\nTOTAL: %d reclamos de 2022 a %d" % (len(todos), ANIO_TOPE))
            cub = Counter(r["cubicador"] or "(sin cubicador)" for r in todos)
            print("\nPor cubicador:")
            for k, v in cub.most_common():
                marca = "" if norm(k) in usuarios else "   <- no es usuario de la plataforma"
                print("   %-22s %3d%s" % (k, v, marca))
            print("\nPor segmento: %s" % dict(Counter(r["segmento"] or "(sin)" for r in todos)))
            print("Por tipo    : %s" % dict(Counter(r["tipo_reclamo"] for r in todos)))
            print("Aplica      : %s" % dict(Counter(r["aplica"] for r in todos)))

            if not CARGAR:
                print("\nPrueba: no se escribio nada. Para cargar, agrega --cargar")
                return 0

            for r in todos:
                cur.execute(
                    """INSERT INTO reclamos
                         (titulo, descripcion, estado, prioridad, tipo_reclamo, aplica,
                          observaciones, obra_texto, segmento, servicio, fecha_deteccion,
                          kilos_mal_fabricados, cubicador_asignado, id_calidad, analista,
                          categoria_ishikawa, cod_causa, sub_causa, cinco_por_que,
                          correlativo, correlativo_calidad, numero_calidad, anio_calidad,
                          creado_por, fecha_creacion, fecha_cierre, tipo_origen,
                          historico, clave_import, fuente)
                       VALUES (%s,%s,'cerrado','media',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                               %s::jsonb,%s,%s,%s,%s,%s,%s,%s,'externo',TRUE,%s,%s)
                       ON CONFLICT (clave_import) WHERE clave_import IS NOT NULL
                       DO UPDATE SET
                          titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion,
                          -- Lo que las fichas de RCA o el usuario ya corrigieron no se
                          -- pisa: la planilla es el punto de partida, no la ultima palabra.
                          tipo_reclamo = CASE WHEN reclamos.analista IS NULL AND reclamos.analisis_validado_el IS NULL
                                              THEN EXCLUDED.tipo_reclamo ELSE reclamos.tipo_reclamo END,
                          aplica = CASE WHEN reclamos.analista IS NULL AND reclamos.analisis_validado_el IS NULL
                                        THEN EXCLUDED.aplica ELSE reclamos.aplica END,
                          observaciones = EXCLUDED.observaciones, obra_texto = EXCLUDED.obra_texto,
                          segmento = EXCLUDED.segmento, servicio = EXCLUDED.servicio,
                          fecha_deteccion = EXCLUDED.fecha_deteccion,
                          kilos_mal_fabricados = EXCLUDED.kilos_mal_fabricados,
                          cubicador_asignado = EXCLUDED.cubicador_asignado,
                          id_calidad = EXCLUDED.id_calidad, fuente = EXCLUDED.fuente""",
                    (r["titulo"], r["descripcion"], r["tipo_reclamo"], r["aplica"],
                     r["observaciones"], r["obra_texto"], r["segmento"], r["servicio"],
                     r["fecha_deteccion"], r["kilos"], correo_de(r["cubicador"], usuarios),
                     r["id_calidad"], r["analista"], r["categoria_ishikawa"], r["cod_causa"],
                     r["sub_causa"],
                     __import__("json").dumps(r["cinco_por_que"]) if r["cinco_por_que"] else None,
                     r["correlativo"], r["numero"], r["numero"], r["anio"],
                     CREADO_POR, r["fecha_deteccion"], r["fecha_deteccion"],
                     r["clave_import"], r["fuente"]))
            cur.execute("SELECT COUNT(*) FROM reclamos WHERE historico")
            print("\nCARGADOS. La base tiene %d reclamos historicos." % cur.fetchone()[0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
