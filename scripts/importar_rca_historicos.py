"""
IMPORTAR LOS ANALISIS CAUSA RAIZ QUE YA ESTAN HECHOS A MANO (2025).

    python scripts/importar_rca_historicos.py            -> PRUEBA, no escribe nada
    python scripts/importar_rca_historicos.py --cargar   -> escribe en la base

QUE HAY. Dos libros con el formato de registro y analisis de error, una hoja por
reclamo: el general y el de un cubicador. Cuatro fichas estan en los dos libros, y son
el MISMO reclamo (mismo ID, misma obra, mismo analista), asi que se cuentan una vez.

POR QUE IMPORTARLOS. Son analisis que ya existen y que el usuario tendria que volver a
tipear uno por uno. Cargados, la pantalla de analisis abre con ejemplos suyos adentro.

LA CAUSA SE MAPEA POR TEXTO, NO POR LA FILA. La ficha tiene una fila por cada M
(Metodo, Mano de obra, Maquina...) y el analista escribe la causa en una de ellas, pero
no siempre en la que corresponde: hay fichas con "Error de interpretacion o criterio
tecnico" escrito en la fila de Maquina, cuando en el catalogo esa causa es de Mano de
obra. El texto y el codigo son el dato; la fila es donde quedo escrito.

Se puede correr dos veces: vuelve a escribir los mismos campos y rehace las acciones que
creo esta importacion, sin tocar las que se hayan agregado a mano.
"""
import os
import re
import sys
import unicodedata
from collections import Counter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, "scripts"))
from asa_ping import cargar_env  # noqa: E402

cargar_env()
os.environ.setdefault("JWT_SECRET", "rca-local-no-sirve-en-produccion")

from armahub.db import get_conn  # noqa: E402

CARPETA = os.path.join(RAIZ, "entrada", "Reclamos")
LIBROS = ["2025 - RCA.xlsx", "2025 - RCA_Daniel venegas.xlsx"]
ANIO = 2025
CARGAR = "--cargar" in sys.argv
# Con esto se reconocen las acciones que creo esta importacion, para poder rehacerlas sin
# borrar las que alguien agregue despues desde la pantalla.
CREADO_POR = "importacion.rca"

# Donde esta cada dato en la ficha: (fila, columna), ambas empezando en 1. El formato es
# fijo —es una plantilla— y escribirlo aca es lo unico que permite revisarlo de un
# vistazo cuando un campo salga vacio.
CELDAS = {
    "id_reclamo": (2, 6), "correlativo": (3, 6), "obra": (4, 5),
    "deteccion": (5, 3), "detectado_por": (6, 3), "problema": (8, 2),
    "analista": (9, 6), "aplica": (10, 3), "area_aplica": (10, 5),
    "fecha_analisis": (11, 5), "explicacion": (12, 2),
}
FILAS_ISHIKAWA = range(14, 20)      # las seis M, una por fila
COL_CAUSA, COL_COD = 3, 7
FILA_ACCIONES = 22                  # la primera; siguen hacia abajo hasta que se acaban
FILA_OBSERVACIONES = 30
TIPOS_ACCION = {"inmediata": "inmediata", "correctiva": "correctiva", "preventiva": "preventiva"}


def seguro(s):
    """La consola de Windows es cp1252 y el simbolo con el que la planilla precede cada
    causa la revienta. Se cambia solo para IMPRIMIR; lo que se guarda va entero."""
    return str(s).encode("ascii", "replace").decode()


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().lower()


def solo_letras(s):
    return re.sub(r"[^a-z0-9]+", "", norm(s))


def texto(v):
    s = "" if v is None else str(v).replace("\n", " ").strip()
    return s or None


def fecha(v):
    s = str(v or "").strip()
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    return m.group(0) if m else None


def leer_ficha(ws):
    """Una hoja del formato, como diccionario. Devuelve None si no es una ficha."""
    filas = list(ws.iter_rows(min_row=1, max_row=40, values_only=True))

    def celda(f, c):
        if f - 1 >= len(filas):
            return None
        fila = filas[f - 1]
        return texto(fila[c - 1]) if c - 1 < len(fila) else None

    d = {k: celda(*pos) for k, pos in CELDAS.items()}
    if not d.get("id_reclamo") and not d.get("correlativo"):
        return None
    d["deteccion"] = fecha(d.get("deteccion"))
    d["fecha_analisis"] = fecha(d.get("fecha_analisis"))

    # La causa: se busca en las seis filas y se toma la que tenga texto.
    d["causa_texto"], d["causa_cod"] = None, None
    for f in FILAS_ISHIKAWA:
        t = celda(f, COL_CAUSA)
        if t:
            d["causa_texto"] = t
            d["causa_cod"] = celda(f, COL_COD)
            break

    acciones = []
    for f in range(FILA_ACCIONES, FILA_OBSERVACIONES):
        desc = celda(f, 3)
        if not desc:
            continue
        acciones.append({
            "tipo": TIPOS_ACCION.get(norm(celda(f, 2)), "inmediata"),
            "descripcion": desc,
            "responsable": celda(f, 4),
            "fecha_prevista": fecha(celda(f, 5)),
        })
    d["acciones"] = acciones
    obs = celda(FILA_OBSERVACIONES, 2)
    if obs and norm(obs).startswith("observaciones adicionales"):
        obs = texto(obs.split(":", 1)[1]) if ":" in obs else None
    d["observaciones"] = obs
    return d


def catalogo(cur):
    cur.execute("""SELECT s.codigo, c.slug, s.descripcion
                     FROM area_rca_subcausas s
                     JOIN area_rca_categorias c ON c.id = s.categoria_id
                     JOIN areas a ON a.id = c.area_id
                    WHERE a.nombre = 'Cubicaciones'""")
    return {solo_letras(d): (cod, slug, d) for cod, slug, d in cur.fetchall()}


def palabras(s):
    return {p for p in re.split(r"[^a-z0-9]+", norm(s)) if len(p) > 2}


def causa_de(txt, cat):
    """Engancha el texto escrito en la ficha con el catalogo de la plataforma.

    POR PALABRAS Y NO POR PREFIJO. La misma causa esta escrita distinto en los dos
    lados: la planilla dice "Sobrecarga laboral ALTA o plazos ajustados..." y el
    catalogo "Sobrecarga laboral o plazos ajustados...", y "Falta DE registro formal"
    contra "Falta registro formal". Una palabra de diferencia rompia el prefijo y
    dejaba sin causa a cuatro de seis fichas que si la tenian.

    Lo que NO calza con nada se deja sin causa a proposito: hay fichas donde el analista
    escribio su propia frase ("Error de cubicacion F7"), y eso no es una causa del
    catalogo. Ese texto se guarda como explicacion y la causa la elige el usuario.
    """
    t = solo_letras(txt)
    if len(t) < 8:
        return None
    if t in cat:
        return cat[t]
    pt = palabras(txt)
    if len(pt) < 2:
        return None
    mejor, mejor_n = None, 0
    for k, v in cat.items():
        pc = palabras(v[2])
        comun = pt & pc
        if len(comun) < 2:
            continue
        if len(comun) / max(1, min(len(pt), len(pc))) >= 0.8 and len(comun) > mejor_n:
            mejor, mejor_n = v, len(comun)
    return mejor


def main():
    import openpyxl
    print("MODO: %s\n" % ("CARGAR (escribe en la base)" if CARGAR else "PRUEBA (no escribe nada)"))

    fichas, repetidas = {}, 0
    for libro in LIBROS:
        ruta = os.path.join(CARPETA, libro)
        if not os.path.exists(ruta):
            print("falta el libro %s; se omite" % libro)
            continue
        wb = openpyxl.load_workbook(ruta, data_only=True, read_only=True)
        n = 0
        for hoja in wb.sheetnames:
            if not hoja.strip().isdigit():
                continue
            d = leer_ficha(wb[hoja])
            if not d:
                continue
            d["libro"], d["hoja"] = libro, hoja
            clave = d.get("id_reclamo") or ("corr-" + str(d.get("correlativo")))
            if clave in fichas:
                repetidas += 1
                continue
            fichas[clave] = d
            n += 1
        wb.close()
        print("%-34s %d fichas" % (libro, n))
    print("\nFICHAS UNICAS: %d  (%d venian repetidas en los dos libros)\n"
          % (len(fichas), repetidas))

    with get_conn() as conn:
        with conn.cursor() as cur:
            cat = catalogo(cur)
            # El reclamo al que corresponde cada ficha: primero por el ID de Icarus, que
            # es el unico identificador comun; si no esta, por el correlativo del año.
            cur.execute("""SELECT id, id_calidad, numero_calidad, titulo
                             FROM reclamos WHERE anio_calidad = %s""", (ANIO,))
            por_id, por_num = {}, {}
            for rid, idc, num, tit in cur.fetchall():
                if idc:
                    por_id[str(idc).strip()] = (rid, tit)
                if num:
                    por_num[int(num)] = (rid, tit)

            listos, sin_reclamo, sin_causa = [], [], []
            for clave, d in sorted(fichas.items(), key=lambda x: int(x[1].get("correlativo") or 0)):
                destino = por_id.get(str(d.get("id_reclamo") or "").strip())
                via = "id"
                if not destino and str(d.get("correlativo") or "").isdigit():
                    destino = por_num.get(int(d["correlativo"]))
                    via = "correlativo"
                if not destino:
                    sin_reclamo.append(d)
                    continue
                hit = causa_de(d.get("causa_texto"), cat)
                if d.get("causa_texto") and not hit:
                    sin_causa.append((d, d["causa_texto"]))
                d["_reclamo_id"], d["_titulo"], d["_via"] = destino[0], destino[1], via
                d["_causa"] = hit
                listos.append(d)

            print("CALZAN con un reclamo de %d: %d  (por id: %d, por correlativo: %d)"
                  % (ANIO, len(listos),
                     sum(1 for d in listos if d["_via"] == "id"),
                     sum(1 for d in listos if d["_via"] == "correlativo")))
            print("CON CAUSA reconocida del catalogo: %d" % sum(1 for d in listos if d["_causa"]))
            print("CON ACCIONES: %d (total %d acciones)"
                  % (sum(1 for d in listos if d["acciones"]),
                     sum(len(d["acciones"]) for d in listos)))
            print("APLICA: %s" % dict(Counter(norm(d.get("aplica")) or "(vacio)" for d in listos)))

            if sin_reclamo:
                print("\nSIN RECLAMO QUE LES CORRESPONDA (%d):" % len(sin_reclamo))
                for d in sin_reclamo:
                    print("   corr=%-4s id=%-8s %s" % (d.get("correlativo"), d.get("id_reclamo"),
                                                       seguro((d.get("obra") or "")[:40])))
            if sin_causa:
                print("\nCAUSA ESCRITA QUE NO CALZA CON EL CATALOGO (%d):" % len(sin_causa))
                for d, t in sin_causa:
                    print("   corr=%-4s %s" % (d.get("correlativo"), seguro(t[:62])))

            if not CARGAR:
                print("\nPrueba: no se escribio nada. Para cargar, agrega --cargar")
                return 0

            for d in listos:
                cod = slug = sub = None
                if d["_causa"]:
                    cod, slug, sub = d["_causa"]
                # LO QUE EL ANALISTA ESCRIBIO NO SE PIERDE. Cuando lo que puso en la fila
                # del Ishikawa no es una causa del catalogo sino una frase suya
                # ("Interpretacion incompleta del plano de elevacion y fundacion"), esa
                # frase dice algo del caso y se SUMA a la explicacion en vez de perderse.
                # No reemplaza: las dos fichas donde pasa tienen ademas su explicacion
                # propia, que es mas completa. La causa queda vacia a proposito, para que
                # el usuario la elija.
                explicacion = d.get("explicacion")
                if not d["_causa"] and d.get("causa_texto"):
                    suelto = d["causa_texto"].lstrip("◦ ").strip()
                    explicacion = " · ".join(x for x in (explicacion, suelto) if x)
                aplica = {"si aplica": "si", "no aplica": "no"}.get(norm(d.get("aplica")))
                cur.execute(
                    """UPDATE reclamos SET
                         analista = COALESCE(%s, analista),
                         aplica = COALESCE(%s, aplica),
                         area_aplica = COALESCE(%s, area_aplica),
                         explicacion_causa = COALESCE(%s, explicacion_causa),
                         fecha_analisis = COALESCE(%s, fecha_analisis),
                         fecha_deteccion = COALESCE(fecha_deteccion, %s),
                         detectado_por = COALESCE(%s, detectado_por),
                         categoria_ishikawa = COALESCE(%s, categoria_ishikawa),
                         cod_causa = COALESCE(%s, cod_causa),
                         sub_causa = COALESCE(%s, sub_causa),
                         observaciones = COALESCE(observaciones, %s),
                         metodo_rca = 'ishikawa'
                         -- NO SE PISA LO QUE EL USUARIO YA VALIDO. Esta carga siembra; una
                     -- vez que el analisis se reviso en la pantalla, volver a correr
                     -- esto no puede deshacerlo.
                   WHERE id = %s AND analisis_validado_el IS NULL""",
                    (d.get("analista"), aplica,
                     None if norm(d.get("area_aplica")) in ("na", "") else d.get("area_aplica"),
                     explicacion, d.get("fecha_analisis"), d.get("deteccion"),
                     d.get("detectado_por"), slug, cod, sub, d.get("observaciones"),
                     d["_reclamo_id"]))
                # Las acciones se rehacen enteras, pero SOLO las de esta importacion: las
                # que alguien agregue despues desde la pantalla no se tocan.
                cur.execute("DELETE FROM reclamo_acciones WHERE reclamo_id = %s AND creado_por = %s",
                            (d["_reclamo_id"], CREADO_POR))
                for a in d["acciones"]:
                    cur.execute(
                        """INSERT INTO reclamo_acciones
                             (reclamo_id, tipo, descripcion, responsable, fecha_prevista,
                              estado, creado_por, fecha_creacion)
                           VALUES (%s,%s,%s,%s,%s,'pendiente',%s, now()::text)""",
                        (d["_reclamo_id"], a["tipo"], a["descripcion"], a["responsable"],
                         a["fecha_prevista"], CREADO_POR))
            cur.execute("""SELECT COUNT(*) FROM reclamos
                            WHERE anio_calidad = %s AND categoria_ishikawa IS NOT NULL""", (ANIO,))
            print("\nCARGADO. %d reclamos de %d quedaron con causa." % (cur.fetchone()[0], ANIO))
    return 0


if __name__ == "__main__":
    sys.exit(main())
