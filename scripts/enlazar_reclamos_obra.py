"""
ENLAZAR CADA RECLAMO CON SU OBRA DE aSa.

    python scripts/enlazar_reclamos_obra.py            -> PRUEBA, no escribe nada
    python scripts/enlazar_reclamos_obra.py --cargar   -> escribe el enlace

POR QUE. El segmento de una obra no vive en el reclamo sino en la obra
(`asa_obra_atributos`), que es donde el usuario lo categoriza. Sin enlace, los tableros
muestran «(sin segmento)» aunque la obra este perfectamente clasificada.

LOS RECLAMOS LLEGAN A SU OBRA POR DOS CAMINOS DISTINTOS:

  · Los de la plataforma apuntan a un proyecto de ArmaHub, y el proyecto tiene nombre.
  · Los 511 historicos no tienen proyecto —esas obras no existen en ArmaHub—: su obra es
    el texto que alguien escribio en la planilla.

En los dos casos lo unico comun es el NOMBRE, y se escribe distinto en cada lado:
"EI - Edificio La Pastora" contra "EI - EDIF.LA PASTORA - BARRAS". Por eso el enlace se
hace por palabras y no por igualdad, unificando antes las abreviaturas que cambian.

LO QUE NO SE FUERZA. Si dos obras distintas calzan igual de bien Y dicen segmentos
distintos, no se enlaza ninguna: preferible un reclamo sin segmento que uno con el
segmento de otra obra. Esos casos se listan para resolverlos a mano.

Se puede correr las veces que haga falta: vuelve a calcular el enlace de cero.
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
os.environ.setdefault("JWT_SECRET", "enlace-local-no-sirve-en-produccion")

from armahub.db import get_conn  # noqa: E402

CARGAR = "--cargar" in sys.argv

# Las dos fuentes escriben la misma obra distinto. Sin unificar esto el enlace pierde
# tres de cada cuatro: medido, pasa de 1 de 28 a 24 de 28.
ABREVIA = {"edificio": "edif", "edificios": "edif", "edifico": "edif", "torre": "t",
           "etapa": "et", "ampliacion": "ampl", "proyecto": "", "condominio": "cond",
           "hospital": "hosp", "barras": ""}
# Palabras que no distinguen una obra de otra: razon social y conectores.
RUIDO = {"sa", "ltda", "spa", "eirl", "cia", "constructora", "ingenieria", "construccion",
         "construcciones", "y", "de", "del", "la", "el", "los", "las", ""}
# Cuanto tienen que compartir dos nombres para darlos por la misma obra. Se mide contra
# el mas corto, porque aSa suele agregar sufijos ("- BARRAS", "ET2") que ArmaHub no pone.
COBERTURA_MINIMA = 0.75
PALABRAS_MINIMAS = 2


def tokens(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    salida = set()
    for t in re.split(r"[^a-z0-9]+", s):
        t = ABREVIA.get(t, t)
        if t and t not in RUIDO and len(t) > 1:
            salida.add(t)
    return salida


def enlazar(nombre, obras):
    """La obra de aSa que corresponde a ese nombre, o None con el motivo.

    Devuelve (asa_job_id, nombre_obra, segmento) o (None, None, motivo).
    """
    tp = tokens(nombre)
    if not tp:
        return None, None, "el nombre no tiene palabras utiles"
    candidatos = []
    for job, onom, seg, ta in obras:
        comun = tp & ta
        if len(comun) < PALABRAS_MINIMAS:
            continue
        if len(comun) / max(1, min(len(tp), len(ta))) >= COBERTURA_MINIMA:
            candidatos.append((len(comun), job, onom, seg))
    if not candidatos:
        return None, None, "ninguna obra de aSa se le parece lo suficiente"
    candidatos.sort(reverse=True)
    tope = candidatos[0][0]
    cabeza = [c for c in candidatos if c[0] == tope]
    # EN aSa LA MISMA OBRA SUELE TENER DOS CODIGOS con el mismo nombre. Que empaten no es
    # ambiguedad; lo es solo si las candidatas dicen segmentos DISTINTOS.
    segs = {c[3] for c in cabeza if c[3]}
    if len(segs) > 1:
        return None, None, "dos obras calzan igual y con segmento distinto (%s)" % ", ".join(sorted(segs))
    return cabeza[0][1], cabeza[0][2], (list(segs)[0] if segs else None)


def main():
    print("MODO: %s\n" % ("CARGAR (escribe el enlace)" if CARGAR else "PRUEBA (no escribe nada)"))
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT o.asa_job_id, o.nombre, a.segmento
                             FROM asa_obras o
                             LEFT JOIN asa_obra_atributos a ON a.asa_job_id = o.asa_job_id
                            WHERE o.nombre IS NOT NULL""")
            obras = [(j, n, s, tokens(n)) for j, n, s in cur.fetchall()]
            print("obras en el espejo de aSa: %d" % len(obras))

            # El nombre de la obra de cada reclamo, venga del proyecto o del texto viejo.
            cur.execute("""SELECT r.id, COALESCE(p.nombre_proyecto, r.obra_texto), r.historico
                             FROM reclamos r
                             LEFT JOIN proyectos p ON p.id_proyecto = r.id_proyecto
                            WHERE COALESCE(p.nombre_proyecto, r.obra_texto) IS NOT NULL""")
            filas = cur.fetchall()
            print("reclamos con nombre de obra: %d\n" % len(filas))

            # Se resuelve por NOMBRE y no por reclamo: la misma obra aparece decenas de
            # veces y resolverla una vez es lo que hace que esto corra en segundos.
            nombres = sorted({f[1] for f in filas})
            resuelto, motivos = {}, Counter()
            for n in nombres:
                job, onom, seg = enlazar(n, obras)
                resuelto[n] = (job, onom, seg)
                if not job:
                    motivos[seg] += 1

            con, sin = [], []
            for n in nombres:
                (con if resuelto[n][0] else sin).append(n)
            print("OBRAS DISTINTAS: %d  ->  %d enlazadas, %d sin enlazar"
                  % (len(nombres), len(con), len(sin)))

            por_obra = Counter(f[1] for f in filas)
            rec_con = sum(por_obra[n] for n in con)
            print("RECLAMOS: %d quedan con obra de aSa, %d sin ella\n"
                  % (rec_con, len(filas) - rec_con))

            seg_cuenta = Counter(resuelto[n][2] or "(obra sin segmento)" for n in con)
            print("Segmento que tomarian: %s\n" % dict(seg_cuenta))

            if sin:
                print("SIN ENLAZAR (hay que mirarlas a mano):")
                for n in sin[:25]:
                    print("   %-46s %s" % (n[:46], resuelto[n][2]))
                if len(sin) > 25:
                    print("   ... y %d mas" % (len(sin) - 25))

            if not CARGAR:
                print("\nPrueba: no se escribio nada. Para enlazar, agrega --cargar")
                return 0

            # Se limpia y se vuelve a escribir entero: asi corregir un nombre y volver a
            # correr deshace un enlace que ya no corresponde, en vez de dejarlo pegado.
            cur.execute("UPDATE reclamos SET asa_job_id = NULL WHERE asa_job_id IS NOT NULL")
            for n in con:
                cur.execute("""UPDATE reclamos r SET asa_job_id = %s
                                 FROM (SELECT id FROM reclamos r2
                                        LEFT JOIN proyectos p ON p.id_proyecto = r2.id_proyecto
                                        WHERE COALESCE(p.nombre_proyecto, r2.obra_texto) = %s) x
                                WHERE r.id = x.id""", (resuelto[n][0], n))
            cur.execute("SELECT COUNT(*) FROM reclamos WHERE asa_job_id IS NOT NULL")
            print("\nENLAZADOS: %d reclamos quedaron con su obra de aSa." % cur.fetchone()[0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
