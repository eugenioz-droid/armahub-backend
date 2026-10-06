"""IMPORTAR LOS RECLAMOS DE 2022-2025 (5-oct).

Lo que se congela acá es lo que decide qué queda escrito en la base para siempre: de qué
columna salen los kilos de cada año, cómo se traduce el vocabulario de las planillas, y
—sobre todo— la llave que evita duplicar al reimportar. Esa llave YA FALLÓ una vez: sin
el ordinal, catorce reclamos distintos que comparten asunto y fecha se pisaban entre
ellos y cargaban 497 de 511.

Correr con: python tests/test_importar_historicos.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


SRC = open(os.path.join(ROOT, "scripts", "importar_reclamos_historicos.py"),
           encoding="utf-8").read()
MIG = open(os.path.join(ROOT, "armahub", "migrations", "124_reclamos_historicos.sql"),
           encoding="utf-8").read()

print("TEST: importación de los reclamos históricos")

print("\n1. 2026 no se toca: ese año lo lleva la plataforma")
check("hay un tope de año y es 2025", "ANIO_TOPE = 2025" in SRC)
check("...y se descarta por la FECHA de la fila, no por la hoja en que está",
      "if anio_real > ANIO_TOPE:" in SRC and 'anio_real = int(fecha[:4])' in SRC)
check("...diciendo por qué, en vez de perderla en silencio",
      "ese ano lo lleva la plataforma" in SRC)

print("\n2. Los kilos salen de UNA columna por año, declarada")
# El usuario las confirmó una por una, por letra de planilla: 2022 P, 2023 P, 2024 U,
# 2025 Q. Un cambio acá altera todos los indicadores de kilos, así que queda fijado.
for anio, col in ((2022, '"kilos": "KG"'), (2023, '"kilos": "Kg Error"'),
                  (2024, '"kilos": "KG"'), (2025, '"kilos": "KG"')):
    bloque = SRC.split('"anio": %d' % anio)[1][:900]
    check("%d toma %s" % (anio, col.split(": ")[1]), col in bloque)
check("el 184,13 repetido de 2022 se carga: es un estándar, no un arrastre",
      "se aplico un estandar definido entonces" in SRC)

print("\n3. La llave no duplica ni se come reclamos distintos")
check("la llave lleva año, hoja, asunto y fecha",
      'clave = "hist|%s|%s|%s" % (anio, cfg["hoja"], clave_cruce(asunto, fecha))' in SRC)
check("...más el ID de Icarus cuando viene", 'clave += "|" + id_icarus' in SRC)
check("...y un ordinal para los que comparten asunto y fecha",
      'r["clave_import"] += "#%d" % vistas[r["clave_import"]]' in SRC)
check("el ordinal se asigna en el orden de la HOJA, para que reimportar dé lo mismo",
      "antes de ordenar por fecha" in SRC)
check("la base impide el duplicado aunque el script se equivoque",
      "CREATE UNIQUE INDEX IF NOT EXISTS ux_reclamos_clave_import" in MIG)
check("...y reimportar ACTUALIZA en vez de fallar",
      "ON CONFLICT (clave_import)" in SRC and "DO UPDATE SET" in SRC)

print("\n4. El vocabulario de las planillas, al de la plataforma")
from importar_reclamos_historicos import TIPOS, APLICA, NOMBRES, NO_PERSONAS, norm  # noqa: E402
from armahub.reclamos import TIPOS_RECLAMO, APLICA_VALUES  # noqa: E402

check("todo tipo traducido existe en la plataforma",
      all(v in TIPOS_RECLAMO for v in TIPOS.values()))
check("...y todo valor de 'aplica' también", all(v in APLICA_VALUES for v in APLICA.values()))
check("las variantes de escritura caen en el mismo tipo",
      TIPOS["error de cubicacion"] == TIPOS["error en hc"] == "error"
      and TIPOS["faltante cubicacion"] == TIPOS["faltante de cubicacion"] == "faltante")
check("«No procede» es un no-aplica, no un tipo de reclamo", APLICA["no procede"] == "no")
check("«Revisar» queda pendiente, no se da por bueno", APLICA["revisar"] == "pendiente")

print("\n5. Quién es quién (hay DOS José)")
# Resuelto cruzando contra la hoja "BD Consolidado", que trae el nombre completo de las
# mismas filas: en 2023 y 2024 "Jose" es siempre Rodriguez; Pantoja sólo aparece en 2022.
check("«Jose» a secas es José Rodriguez, no Pantoja", NOMBRES["jose"] == "José Rodriguez")
check("...y Pantoja sólo entra cuando viene con apellido",
      NOMBRES["jose pantoja"] == "José Pantoja")
check("los nombres de pila se completan", NOMBRES["gerardo"] == "Gerardo Mendoza"
      and NOMBRES["mario"] == "Mario Puyo" and NOMBRES["carlos"] == "Carlos Santos")
check("lo que no es una persona no cuenta como cubicador",
      "na" in NO_PERSONAS and "" in NO_PERSONAS and "mapec" not in NO_PERSONAS)
# RMC es un proveedor externo de cubicacion, no basura: el usuario lo confirmo y en aSa
# detallo 703 codigos en 2024. Cuenta como un cubicador externo mas.
check("RMC y Mapec cuentan como cubicadores externos, no como dato perdido",
      NOMBRES.get("rmc") == "RMC" and NOMBRES.get("mapec") == "Mapec"
      and "rmc" not in NO_PERSONAS and "mapec" not in NO_PERSONAS)
check("recargar no pisa el aplica ni el tipo de lo ya analizado",
      "THEN EXCLUDED.aplica ELSE reclamos.aplica END" in SRC
      and "THEN EXCLUDED.tipo_reclamo ELSE reclamos.tipo_reclamo END" in SRC)
check("el cruce usa el nombre completo de BD Consolidado cuando existe",
      "completos.get(clave_cruce(asunto, fecha))" in SRC)

print("\n6. Entra como historia, no como trabajo pendiente")
check("nace cerrada y marcada como histórica", "'cerrado','media'" in SRC and "TRUE,%s,%s)" in SRC)
check("la marca existe en la base", "ADD COLUMN historico BOOLEAN NOT NULL DEFAULT FALSE" in MIG)
check("el segmento y el servicio tienen columna propia",
      "ADD COLUMN segmento TEXT" in MIG and "ADD COLUMN servicio TEXT" in MIG)
check("...y servicio NO se confunde con tipo_origen, que significa otra cosa",
      "esto NO es `tipo_origen`" in MIG)
check("la obra va como texto, porque no existe como proyecto",
      "ADD COLUMN obra_texto TEXT" in MIG and "llave foránea contra" in MIG)
check("cada fila dice de qué libro, hoja y fila salió",
      '"fuente": "%s · hoja %s · fila %d"' in SRC)

print("\n7. No se inventa lo que no hay")
check("la causa sólo se pone si el texto calza con el catálogo real",
      "def causa_de(" in SRC and "que es lo honesto" in SRC)
check("el catálogo se lee de la base, no se copia en el script",
      "FROM area_rca_subcausas s" in SRC)
check("por defecto no escribe nada: hay que pedirlo", 'CARGAR = "--cargar" in sys.argv' in SRC
      and "PRUEBA (no escribe nada)" in SRC)

print("\n8. Las fechas se entienden escritas de las dos formas")
from importar_reclamos_historicos import fecha_iso, clave_cruce  # noqa: E402
check("ISO con hora", fecha_iso("2023-01-09 00:00:00") == "2023-01-09")
check("día/mes/año", fecha_iso("9/1/2023") == "2023-01-09")
check("lo que no es fecha no se inventa", fecha_iso("") is None and fecha_iso("enero") is None)
check("el «RV:» del asunto no cambia la identidad del reclamo",
      clave_cruce("RV: Fierro faltante", "2022-01-11") == clave_cruce("Fierro faltante", "2022-01-11"))
check("...ni las tildes ni los signos",
      clave_cruce("Cubicación Estribos", "2022-01-13") == clave_cruce("cubicacion estribos!", "2022-01-13"))
check("dos asuntos distintos no comparten llave",
      clave_cruce("Fierro faltante", "2022-01-11") != clave_cruce("Fierro sobrante", "2022-01-11"))

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
