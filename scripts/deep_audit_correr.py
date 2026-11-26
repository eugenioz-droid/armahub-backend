# -*- coding: utf-8 -*-
"""DEEP AUDIT: correr la auditoría de una obra y sacar su Excel (fase 1, SPECS §16.4).

    python scripts/deep_audit_correr.py <job> [<job> ...] [--probar]

Con --probar todo va en una transacción que se deshace (no queda la corrida); sin él, la
corrida queda guardada en deep_audit. El Excel va a entrada/deep_audit/ (no se sube al repo).
"""
import os
import sys
from datetime import date

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, "scripts"))


def main(args):
    import asa_ping
    asa_ping.cargar_env()
    os.environ.setdefault("JWT_SECRET", "local-deep-audit")
    import psycopg
    from armahub.db import get_database_url
    from armahub import deep_audit, deep_audit_excel
    probar = "--probar" in args
    jobs = [a for a in args if not a.startswith("--")]
    leido = deep_audit.leer_asa(jobs)   # aSa primero: la base se abre después, por poco rato
    print("leído de aSa:", len(leido[1]), "CC")
    conn = psycopg.connect(get_database_url(), autocommit=False)
    try:
        with conn.cursor() as cur:
            if probar:
                cur.execute(open(os.path.join(RAIZ, "armahub", "migrations", "186_deep_audit.sql"), encoding="utf-8").read())
            corrida = deep_audit.auditar(cur, jobs, os.environ.get("DEEP_AUDIT_POR", "deep-audit@local"), leido)
        conn.rollback() if probar else conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    # Con el número de la corrida: no choca con el Excel de otra corrida abierto en pantalla.
    nombre = "Deep Audit %s %s DA-%s%s.xlsx" % (corrida["obra"].replace("/", "-"), date.today().isoformat(), corrida["id"],
                                                 " (prueba)" if probar else "")
    destino = os.path.join(RAIZ, "entrada", "deep_audit", nombre)
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    deep_audit_excel.libro(corrida).save(destino)
    print("corrida", corrida["id"], "·", len(corrida["ccs"]), "CC ·", len(corrida["hallazgos"]), "hallazgos ·",
          corrida["kpis"]["por_regla"])
    print(destino)


if __name__ == "__main__":
    main(sys.argv[1:])
