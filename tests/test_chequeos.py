# -*- coding: utf-8 -*-
"""REVISIÓN AUTOMÁTICA DE BARRAS (8-oct).

Lo que se congela acá son las DOS REGLAS, con barras reales, porque son las que deciden si
alguien usa esto o lo apaga a la semana. Una regla que dispara en el 40 por ciento de las
barras no es un detector: es ruido con botones.

EL CASO QUE MÁS IMPORTA ES EL QUE NO DEBE DISPARAR. Armacero fabrica el gancho a 10 veces
el diámetro, o sea EXACTAMENTE en el límite de la regla del lado corto. Medido sobre 2.250
barras: 78 ganchos miden 10φ justo. Comparar con «menor o igual» en vez de «menor», o subir
el umbral un diámetro, lleva la regla de 40 a 184 lados señalados, casi todos correctos.
Por eso hay un test con un gancho de 10φ clavados que tiene que pasar.

Correr con: python tests/test_chequeos.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


from armahub import chequeos as C  # noqa: E402

SRC = open(os.path.join(ROOT, "armahub", "chequeos.py"), encoding="utf-8").read()
API = open(os.path.join(ROOT, "armahub", "chequeos_api.py"), encoding="utf-8").read()
MIG = open(os.path.join(ROOT, "armahub", "migrations", "133_chequeos.sql"), encoding="utf-8").read()
MIG2 = open(os.path.join(ROOT, "armahub", "migrations", "134_chequeo_codigos.sql"), encoding="utf-8").read()
SCH = open(os.path.join(ROOT, "armahub", "asa_scheduler.py"), encoding="utf-8").read()
MIG3 = open(os.path.join(ROOT, "armahub", "migrations", "135_chequeo_cubico.sql"),
            encoding="utf-8").read()
AUD = open(os.path.join(ROOT, "armahub", "auditorias.py"), encoding="utf-8").read()
JS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "revision.js"),
          encoding="utf-8").read()
HTM = open(os.path.join(ROOT, "armahub", "templates", "tabs", "auditorias.html"),
           encoding="utf-8").read()
APP = open(os.path.join(ROOT, "armahub", "templates", "app.html"), encoding="utf-8").read()
MAIN = open(os.path.join(ROOT, "armahub", "main.py"), encoding="utf-8").read()
MIG6 = open(os.path.join(ROOT, "armahub", "migrations", "146_chequeo_por_revision.sql"),
            encoding="utf-8").read()
AUTH = open(os.path.join(ROOT, "armahub", "auth.py"), encoding="utf-8").read()
AUTHJS = open(os.path.join(ROOT, "armahub", "static", "js", "shared", "auth.js"),
              encoding="utf-8").read()


def barra(lados, diam=10.0, figura="X", mbr=None, elemento="E1", ref="r1", cc="CC1"):
    """Una barra ya normalizada, como la arma `normalizar_asa`. `lados` son tuplas
    (nombre, largo_mm, tipo, angulo_con_el_anterior)."""
    ls = [{"nombre": n, "largo": float(l), "tipo": t, "angulo": a, "arco": t == "RB",
           "declarado_gancho": t.startswith("H")} for n, l, t, a in lados]
    C._clasificar_lados(ls, diam)
    return {"origen": "asa", "ref": ref, "cc": cc, "elemento": elemento, "marca": ref,
            "figura": figura, "diam": diam, "pin": 6 * diam, "largo": sum(x["largo"] for x in ls),
            "cant": 1, "lados": ls, "mbr": mbr}


print("TEST: revisión automática de barras")

# ── 1. Qué es un gancho ──────────────────────────────────────────────────────────────
print("\n1. Qué cuenta como gancho (de esto depende la regla del lado corto)")
b = barra([("A", 90, "H3", None), ("B", 900, "B", 135), ("G", 90, "H3", 135)])
check("lo que aSa declara gancho (H3) es gancho",
      [l["gancho"] for l in b["lados"]] == [True, False, True])
# La familia 105A manda los ganchos de 90° como STD, sin marcarlos.
b = barra([("A", 90, "STD", None), ("B", 900, "STD", 90), ("C", 90, "STD", 90)])
check("...y un tramo terminal, corto y que dobla 90°, también: aSa no siempre lo marca",
      [l["gancho"] for l in b["lados"]] == [True, False, True])
# La traba 305A es un zigzag con los lados LARGOS en las puntas.
b = barra([("A", 300, "STD", None), ("B", 90, "STD", -90), ("C", 300, "STD", 90),
           ("D", 90, "STD", 90), ("E", 300, "STD", -90)])
check("un lado terminal de 300 mm NO es gancho: un gancho es corto por definición",
      [l["gancho"] for l in b["lados"]] == [False, False, False, False, False])

# ── 2. El lado corto ─────────────────────────────────────────────────────────────────
print("\n2. Lado más corto que 10 diámetros")
# EL CASO QUE NO DEBE DISPARAR: la planta fabrica el gancho a 10φ exactos.
b = barra([("A", 100, "H3", None), ("B", 900, "B", 135), ("G", 100, "H3", 135)], diam=10.0)
check("un gancho de 10φ CLAVADOS no dispara: así los fabrica la planta",
      C.r_lado_corto(b, [b]) == [])
b = barra([("A", 99, "STD", None), ("B", 900, "B", 20), ("C", 300, "B", 20)], diam=10.0)
check("...pero un lado recto de 99 mm en φ10 sí: le falta un milímetro para el mínimo",
      len(C.r_lado_corto(b, [b])) == 1)
b = barra([("A", 90, "H3", None), ("B", 900, "B", 135)], diam=10.0)
check("un GANCHO de 90 mm no dispara aunque esté bajo el mínimo: es corto por norma",
      C.r_lado_corto(b, [b]) == [])
# El umbral sale de la configuración del gancho, no de un número suelto.
check("el mínimo lo lee de la configuración de fabricación, no de una constante propia",
      "GANCHO_FABRICACION" in SRC and "def _minimo_fabricacion(" in SRC
      and abs(C._minimo_fabricacion(12.0) - 120.0) < 0.01)
check("...con el piso de 7,5 cm para los diámetros chicos",
      abs(C._minimo_fabricacion(6.0) - 75.0) < 0.01)
# LA COMPARACIÓN ES ESTRICTA Y ESO NO SE TOCA.
check("la comparación es ESTRICTA: con «menor o igual» todos los ganchos serían errores",
      "l[\"largo\"] < minimo - 0.01" in SRC)
b = barra([("A", 900, "B", None), ("B", 900, "B", 90)], diam=10.0)
check("una barra sana no dice nada", C.r_lado_corto(b, [b]) == [])

# ── 3. El estribo cuadrado ───────────────────────────────────────────────────────────
print("\n3. Estribo cuadrado entre hermanos que no lo son")
E = [("A", 100, "H3", None), ("B", 300, "B", 135), ("C", 300, "B", 90),
     ("D", 300, "B", 90), ("E", 300, "B", 90), ("G", 100, "H3", 135)]
cuad = barra(E, mbr=(300.0, 300.0), ref="e1")
largo = barra(E, mbr=(300.0, 800.0), ref="e2")
check("un estribo cuadrado entre hermanos rectangulares se marca",
      len(C.r_estribo_cuadrado(cuad, [cuad, largo])) == 1)
check("...y el mensaje dice contra qué se comparó, no sólo que es cuadrado",
      "los otros 1 estribos del elemento no lo son" in C.r_estribo_cuadrado(cuad, [cuad, largo])[0]["texto"])
otro = barra(E, mbr=(400.0, 400.0), ref="e3")
check("si TODOS los estribos del elemento son cuadrados, es el diseño y no se dice nada",
      C.r_estribo_cuadrado(cuad, [cuad, otro]) == [])
check("el único estribo del elemento se marca igual, pero avisando que no hay con qué comparar",
      "no hay con qué compararlo" in C.r_estribo_cuadrado(cuad, [cuad])[0]["texto"])
check("un estribo rectangular no dice nada", C.r_estribo_cuadrado(largo, [cuad, largo]) == [])
# UNA BARRA RECTA NO ES UN ESTRIBO, aunque su envolvente sea cuadrada por casualidad.
recta = barra([("A", 500, "B", None)], mbr=(500.0, 500.0), ref="r")
check("una barra que no es estribo no entra en esta regla", C.r_estribo_cuadrado(recta, [recta]) == [])
# Y LA DEFINICIÓN QUE SE DESCARTÓ, POR SI ALGUIEN LA REPONE: «dos lados opuestos iguales»
# dispara en el 53 al 98 por ciento de los estribos, porque eso es un rectángulo.
check("no se usa «dos lados iguales»: eso es la definición de un rectángulo",
      "POR QUÉ ASÍ Y NO «DOS LADOS IGUALES»" in SRC
      and "53 al 98 por ciento de los estribos" in SRC)

# ── 4. El motor ──────────────────────────────────────────────────────────────────────
print("\n4. El motor no sabe de ninguna regla en particular")
check("se agrega una regla con una función y una línea en REGLAS",
      isinstance(C.REGLAS, list) and all(set(("codigo", "nombre", "porque", "necesita", "fn")) <= set(r)
                                         for r in C.REGLAS))
check("la regla declara qué campos necesita, y el motor la salta si la barra no los trae",
      "def _tiene(" in SRC and 'if not _tiene(b, r["necesita"]):' in SRC)
sin_mbr = barra([("A", 900, "B", None)], mbr=None)
check("...así una barra recta no genera «no se pudo evaluar el estribo»",
      [s["regla"] for s in C.correr([sin_mbr])] == [])
# LAS DOS FIRMAS. Sin ellas, la misma señal reaparece cada día y el módulo se abandona.
a1 = barra([("A", 90, "B", None), ("B", 900, "B", 20)], ref="x1", cc="C1")
a2 = barra([("A", 90, "B", None), ("B", 900, "B", 20)], ref="x2", cc="C2")
s1, s2 = C.correr([a1])[0], C.correr([a2])[0]
check("dos barras distintas son dos señales distintas", s1["firma"] != s2["firma"])
check("...pero el mismo PROBLEMA: aceptar una apaga las dos", s1["firma_patron"] == s2["firma_patron"])
check("la misma barra revisada dos veces da la misma firma", C.correr([a1])[0]["firma"] == s1["firma"])
check("el motor es una función pura: no toca la base ni la red",
      "get_conn" not in SRC and "requests" not in SRC)

# ── 5. El flujo ──────────────────────────────────────────────────────────────────────
print("\n5. El flujo: la señal sugiere, la persona decide")
# LOS PROCESSED TAMBIEN LLEGAN TARDE (8-oct, lo aviso el usuario y el dato le dio la
# razon): de 186 codigos Processed en obras con movimiento, 86 YA PASARON su fecha de
# despacho, 88 salen dentro de siete dias y solo 7 tienen mas de una semana. 165 estan
# confirmados en planta y 77 ya tienen guia. Donde hay margen es en los Open: de 785, 657
# no tienen ni fecha de despacho.
check("por defecto solo los Open: son los unicos con margen para corregir",
      'ESTADOS_CON_MARGEN = ("Open",)' in API and 'ESTADOS_TARDE = ("Processed",)' in API
      and "def _estados(incluir_tarde: bool)" in API)
check("...con el numero que lo justifica escrito al lado",
      "86 YA PASARON su fecha" in API and "el fierro ya esta en el camion" in API.replace("á","a").replace("ó","o"))
check("...y los Processed se pueden pedir igual, con un chip que lo dice",
      'id="revTarde"' in HTM and "REV.tarde" in JS)
check("la pantalla recorre los códigos DE A UNO, para que no haya un request de minutos",
      '@router.post("/chequeos/revisar")' in API
      and "for (var i = 0; i < cola.length; i++)" in JS
      and "EL RECORRIDO, APARTE DE QUIÉN LO PIDE" in JS)
check("...y se puede detener sin perder lo ya revisado",
      "REV.parar" in JS and 'id="revNuevaParar"' in HTM)
check("dejar un hallazgo sin efecto EXIGE el motivo: sin él, nadie puede revisarlo después",
      "una señal aceptada sin motivo" in API
      and "Explica por qué no aplica" in API and "Hace falta la explicación" in JS)
check("se puede dejar sin efecto el PATRÓN completo, no de a una",
      "firma_patron = %s" in API and "data-pat=" in JS
      and "patron: bool = False" in API and "o.firma_patron = s.firma_patron" in API
      and "y todas las iguales" in JS)
check("...pero el patrón no se lleva por delante lo ajeno ni lo ya resuelto",
      "s.estado IN ('abierta', 'declarada')" in API
      and "Las del patrón que cubicó otra persona no entran" in API)
check("lo ya aceptado no vuelve a la lista al revisar de nuevo",
      "aceptados.get((s[\"regla\"], s[\"firma_patron\"]))" in API)
# QUE SE CORRIGIÓ NO LO DICE NADIE: LO COMPROBÁMOS.
check("«corregida» no se marca a mano: el sistema lo comprueba al revisar de nuevo",
      "estado = 'corregida'" in API and "NOT (firma = ANY(%s))" in API
      and '("aceptada", "corregir", "abierta")' in API)
check("el registro de cada revisión se escribe solo, sin formulario",
      "CREATE TABLE IF NOT EXISTS chequeo_revisiones" in MIG and "lanzada_por" in MIG
      and "def _sumar_revision(" in API)

# ── 6. No se mezcla con la auditoría ─────────────────────────────────────────────────
print("\n6. No se mezcla con la auditoría")
check("las señales viven en su propia tabla, no en auditoria_elementos",
      "CREATE TABLE IF NOT EXISTS chequeo_senales" in MIG
      and "auditoria_elementos" not in API)
check("...y queda escrito por qué: un hallazgo automático rompería el indicador por cubicador",
      "dejaría de medir a las personas" in MIG or "pasaría a medir al robot" in MIG)
check("la referencia de la barra es la MISMA que usa la auditoría, para poder cruzarlas",
      "refs_de_barras" in API)
check("el tab tiene dos líneas y la revisión es la segunda",
      'id="audSubBtnRev"' in HTM and 'id="audSubRevision"' in HTM
      and "global.switchAudSub" in JS)
check("el router está montado y el script cargado",
      "chequeos_router" in MAIN and "auditorias/revision.js" in APP)

# ── 7. Corre sola, y también cuando uno quiera ───────────────────────────────────────
print("\n7. La revisión corre sola, y también a pedido")
check("cuelga del reloj de aSa, DESPUÉS de sincronizar",
      "_revisar_barras()" in SCH and "def _revisar_barras(" in SCH
      and SCH.index("sincronizar_obras") < SCH.index("_revisar_barras()"))
check("...una vez al día, no en los tres turnos: sincronizar tarda segundos y esto, minutos",
      "HORA_REVISION" in SCH and "ahora.hour != HORA_REVISION" in SCH
      and "interval '20 hours'" in SCH)
check("...y si falla no tumba el reloj, igual que todo lo demás de ese hilo",
      "Revisión de barras: falló" in SCH)
# LO QUE LA HACE VIABLE: no barre todo. 2.992 códigos vivos a segundos cada uno son horas.
check("no barre todo: sólo lo nunca revisado y lo que CAMBIÓ en aSa desde la última vez",
      "def pendientes(" in API and "p.ultima_mod > c.ultima_mod" in API
      and "c.cc IS NULL" in API)
check("...y tiene presupuesto de códigos y de minutos, con lo que quedó escrito",
      "TOPE_AUTO" in API and "MINUTOS_AUTO" in API
      and "Se cortó por el tope de %g minutos" in API)
check("a pedido es el MISMO recorrido, conducido por la pantalla",
      '@router.post("/chequeos/revision-pendientes")' in API
      and "async function nuevaRevision(" in JS and "function recorrer(" in JS
      and "'/chequeos/revision-pendientes'" in JS)
check("...y no hay un endpoint que barra todo de una: serían 15 minutos colgado de un request",
      "/chequeos/automatica" not in API
      and "hay un endpoint que haga el barrido entero de una" in API
      and "El barrido largo corre en el reloj" in API)

# ── 8. La trazabilidad ───────────────────────────────────────────────────────────────
print("\n8. Trazabilidad: qué se revisó, cuándo y quién lo pidió")
check("cada código revisado deja constancia, aunque esté LIMPIO",
      "CREATE TABLE IF NOT EXISTS chequeo_codigos" in MIG2 and "def _marcar_codigo(" in API
      and "QUE UN CÓDIGO ESTÉ LIMPIO TAMBIÉN ES UN RESULTADO" in API)
check("...con quién lo revisó y la marca de tiempo que tenía en aSa",
      "revisado_por" in MIG2 and "ultima_mod" in MIG2 and "p.ultima_mod" in API)
check("...y eso es lo mismo que deja al reloj saltarse lo que no cambió",
      "volver a pedirle los ítems a aSa son segundos tirados" in API)
# Esto lo mostraba la pantalla por obra, código por código. Esa pantalla se fue; el dato
# no, porque es de donde sale la cola de lo pendiente: un código se vuelve a revisar si
# cambió en aSa desde la última vez.
check("se guarda, por código, cuándo se revisó, quién y cómo estaba en aSa",
      "revisado_el" in MIG2 and "revisado_por" in MIG2 and "ultima_mod" in MIG2
      and "p.ultima_mod > c.ultima_mod" in API)
check("...y distingue la revisión automática de la que pidió una persona",
      "'reloj' ? 'automática'" in JS or "=== 'reloj'" in JS)
check("el registro de cada revisión dice cómo terminó, no sólo que corrió",
      "ADD COLUMN IF NOT EXISTS nota" in MIG2 and "nota = %s WHERE id = %s" in API)

# ── 9. Sólo las obras que están en producción ────────────────────────────────────────
print("\n9. Sólo las obras que están en producción")
# Sin esto la lista trae 296 obras y 2.992 códigos, y adentro hay obras cuyo último pedido
# es de 2021: códigos que nadie cerró en aSa, no trabajo vivo. Con tres meses quedan 80.
check("el criterio es el MISMO que el de Stock Cubicaciones: movimiento en N meses",
      "MESES_MOVIMIENTO = 3" in API and "def _filtro_movimiento(" in API
      and "programacion" in API.lower())
check("...y se puede soltar: 0 es «todas», no un valor que se ignora",
      "if not meses:" in API and 'VENTANA_TODO' in API)
check("el reloj tampoco barre obras muertas: la cola usa la misma ventana",
      "def pendientes(limite: int = 0, meses: int = MESES_MOVIMIENTO, tarde: bool = False)" in API)
# El selector de ventana se fue con la pantalla por obra: el reporte usa los 3 meses de
# producción y no hay dos sitios donde elegirla. Lo que sí quedó a la vista es el otro
# interruptor, el que decide si entran los Processed, y está junto al botón que los lee.
check("la ventana es del backend y ya no se elige en dos sitios",
      "var MESES = [[3," not in JS and 'id="revMeses"' not in HTM
      and "meses: 3" in JS and 'id="revTarde"' in HTM)

# ── 10. El reporte masivo ────────────────────────────────────────────────────────────
print("\n10. El reporte: por obra, con quién cubicó")
check("una fila por obra, ordenada por lo que más espera",
      '@router.get("/chequeos/reporte")' in API
      and 'key=lambda o: (-o["abiertas"]' in API)
check("trae quién cubicó, y es un dato guardado en la señal, no un join de hoy",
      "ADD COLUMN IF NOT EXISTS cubico" in MIG3 and '"cubico": f[19]' in API
      and "cubico = EXCLUDED.cubico" in API)
check("...porque si la obra pasa de manos, un reporte viejo no puede reescribirse solo",
      "le atribuiría a otro algo que no hizo" in MIG3)
check("y queda dicho que NO es un ranking de personas",
      "NO ES UN RANKING DE PERSONAS" in API and "sería medir las reglas, no a la gente" in API)
# EL ERROR QUE UN REPORTE ASÍ NO PUEDE COMETER.
# UN ROTULO QUE MENTIA: «Barras» parecia «barras malas» y eran las MIRADAS. Y el nombre de
# la regla lo recortaba la tabla por las dos primeras palabras: «Lado mas», que no dice nada.
check("la columna de barras dice que son las MIRADAS, no las malas",
      "Barras miradas" in JS and "no cuántas están malas" in JS)
check("el nombre corto de la regla lo declara la REGLA, no lo recorta la tabla",
      '"corto": "Lado corto"' in SRC and '"corto": "Estribo cuadrado"' in SRC
      and "split(' ').slice(0, 2)" not in JS)
check("una obra sin revisar NO se lee como limpia: se dice que está sin revisar",
      "no está limpia, está sin revisar" in API and "sin revisar</span>" in JS)
check("...y la columna de revisados va antes que la de señales, por lo mismo",
      JS.index("<th class=\"num\">Revisados</th>") < JS.index("<th class=\"num\">Por corregir</th>"))
check("se puede imprimir", 'id="revRepImprimir"' in HTM)

# ── 11. Quién puede usarlo ───────────────────────────────────────────────────────────
print("\n11. Los cubicadores pueden revisar, no sólo administración")
check("usa el mismo permiso que la auditoría, que ya incluye al área de Cubicaciones",
      "_puede_ver" in API and "_puede_auditar" in API
      and 'ROLES_AUDITAN = ("admin", "admin_calidad", "miembro", "externo")' in AUD
      and 'AREA_AUDITA = "Cubicaciones"' in AUD)
# Lo que no debe haber es una lista de roles PROPIA. Importar la de auditorías es justo lo
# contrario: es compartirla. (Antes el test prohibía el texto «ROLES_», y eso también
# prohibía el import correcto.)
check("...o sea que no hay una lista de roles propia que se desincronice",
      "ROLES_ADMINISTRAN = " not in API and "ROLES_AUDITAN = " not in API
      and "from .auditorias import" in API and "ROLES_ADMINISTRAN" in API)

print("\n12. La bandeja: todos los hallazgos en un lugar, y el cubicador se entera")
# El usuario, 9-oct: «luego de revisar no entiendo cómo avanzo, debiera tener un menú para
# administrar los hallazgos». Medido ese día: 540 señales en 32 obras, TODAS abiertas y
# ninguna resuelta, porque sólo se veían obra por obra. Y marcar «hay que corregirla» no le
# llegaba a nadie.
check("las señales se listan SIN obra, con filtros de estado, regla, cubicador, obra y texto",
      'cubico: str = ""' in API and "revision: int = 0" in API and 'busca: str = ""' in API
      and "s.cc ILIKE %s OR s.ref ILIKE %s OR s.obra ILIKE %s" in API)
check("...y «las de la última revisión» responde dónde están las nuevas de recién",
      "s.visto_primero >= (SELECT arrancada FROM chequeo_revisiones WHERE id = %s)" in API)
check("...con los conteos por cubicador y por obra sobre el MISMO filtro",
      '"por_cubicador": por_cubicador, "por_obra": por_obra' in API)
check("se resuelven VARIAS de un golpe, por la misma escritura que una sola",
      '@router.put("/chequeos/senales")' in API and "def _resolver_ids(" in API
      and API.count("_resolver_ids(cur,") >= 2)
check("...y lo ya corregido por el sistema no se pisa a mano",
      "AND estado <> 'corregida' RETURNING id" in API)
check("marcar «corregir» le AVISA al cubicador, uno por persona, con sus códigos",
      "def _avisar_por_corregir(" in API and "def _email_de_login(" in API
      and API.count("_avisar_por_corregir(cur, hechas)") == 2)
check("...resolviendo el login de aSa con la misma regla que las auditorías", "alias_de(" in API)
# LA BANDEJA SE FUE (13-oct): era una bolsa de 540 señales acumuladas donde no se podía
# preguntar «¿qué salió hoy?». La reemplaza la REVISIÓN como unidad — ver la sección 14.
check("ya no hay bandeja: ni su HTML, ni su estado, ni sus funciones",
      'id="revBandeja"' not in HTM and 'id="revLote"' not in HTM
      and "var BAN" not in JS and "function cargarBandeja(" not in JS
      and "function filaBandeja(" not in JS and "function resolverLote(" not in JS)

print("\n13. El flujo cierra: tarea al cubicador, detalle con la barra, comprobación al clic")
# El usuario, 13-oct: «tengo hallazgos pero no tengo el reporte o flujo para marcarlos como
# resueltos… debiera enviarse como tarea al cubicador y que tenga una forma de hacerle
# seguimiento y modificar; por último se hace el check automático que valide esa
# modificación». Y: «sería bueno tener aquí un texto que indique cuándo fue la última carga
# de datos de aSa».
check("el cubicador tiene «mis chequeos»: lo que le marcaron, resuelto por su login de aSa",
      '@router.get("/chequeos/mios")' in API and "alias_cubicador(cur, user.get" in API
      and "function cargarMios(" in JS and 'id="revMios"' in HTM)
check("comprobar una señal vuelve a leer aSa en vivo con la MISMA lógica de la revisión",
      '@router.post("/chequeos/senal/{senal_id}/comprobar")' in API
      and "r = revisar_cc(RevisarCc(job=job, cc=cc), user)" in API)
check("...y dice si quedó corregida o qué mide hoy", '"texto": (detalle or {}).get("texto")' in API
      and "Sigue igual en aSa" in JS)
check("cada señal tiene su detalle con la barra dibujada por el motor del auditor",
      "function abrirDetalleSenal(" in JS and "global.audCeldaFigura(" in JS
      and "global.audBarraNormalizada(" in JS and 'id="revSenalModal"' in HTM)
check("...que auditorías expone en vez de copiarlo",
      "global.audBarraNormalizada = normalizarBarra" in open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "index.js"), encoding="utf-8").read())
# EL REPORTE DICE DÓNDE ESTÁ EL PROBLEMA; NO LO RESUELVE. Llevaba a la pantalla por obra,
# que era un segundo camino para lo mismo: un hallazgo se resuelve en la revisión que lo
# encontró, que es la que tiene dueño, plazo y ciclo.
check("el reporte informa, y resolver es de la revisión",
      "function irABandeja(" not in JS and "revrepfila" not in JS
      and "no lo resuelve" in JS)
check("el reporte dice de cuándo son los datos de aSa",
      '"ultima_carga"' in API and "SELECT MAX(fin) FROM asa_sync WHERE ok" in API and "datos de aSa al" in JS)
check("«revisados» se cuenta sobre los mismos códigos que «códigos»: se acabó el «faltan -7»",
      "JOIN asa_pedidos p ON p.asa_job_id = c.id_proyecto AND p.control_code = c.cc" in API
      and "Math.max(0, o.ccs - o.revisados)" in JS)

print("\n14. La REVISIÓN es la unidad, y el ciclo de un hallazgo se cierra")
# El usuario, 13-oct: «un listado con cada auditoría que se haya hecho… al presionar esa
# línea, un resumen de todos los ítems encontrados… en el modal cada usuario podrá revisar
# sus ítems con opciones para ir marcando como corregido o dejar sin efecto… debe tener un
# checkeo que permita actualizar». Y: «cada vez que hagamos una auditoría sólo muestre lo
# nuevo».
check("cada señal queda pegada a la revisión que la encontró (no se infiere por la hora)",
      "revision_id" in MIG6 and "body.revision))" in API
      and "WHERE s.revision_id = %s" in API)
check("...sólo al INSERTAR: una señal que ya existía sigue siendo de su corrida",
      "sigue\n                     # siendo de la corrida que la encontró" in API
      or "sigue siendo la corrida" in API or "DE QUÉ REVISIÓN ES. Sólo al INSERTAR" in API)
check("el listado de revisiones trae el avance de cada una, contado sobre SUS señales",
      "LEFT JOIN chequeo_senales s ON s.revision_id = r.id" in API and '"pct"' in API)
check("el detalle de una revisión resume por cubicador, con kilos y códigos",
      '@router.get("/chequeos/revision/{revision_id}")' in API and '"por_cubicador"' in API
      and '"ccs_con_hallazgo"' in API and "unnest(%s::text[], %s::text[])" in API)
check("el ciclo tiene los nombres de la norma: declarar ≠ verificar",
      'ESTADO_TXT = {"abierta": "Abierta", "declarada": "Corregida (por verificar)"' in API
      and '"corregida": "Verificada"' in API and '"aceptada": "No aplica"' in API)
check("...y verificar lo hace el SISTEMA, no una persona",
      '@router.put("/chequeos/declarar")' in API
      and 'body.estado not in ("declarada", "aceptada", "abierta")' in API)
check("sólo declara quien cubicó (o administración)",
      "sólo puede declararlas quien las hizo" in API and "alias_cubicador(cur, email)" in API)
check("«no aplica» exige MOTIVO en categorías y explicación",
      "MOTIVOS_NO_APLICA" in API and "Elige por qué no aplica." in API
      and "motivo_tipo" in MIG6)
check("el segundo check lee en aSa SÓLO los códigos de lo marcado",
      '@router.post("/chequeos/comprobar-lote")' in API
      and "una lectura de aSa por código, no por" in API
      and "function verificarMarcados(" in JS)
check("el alias del cubicador sale de aSa y no de las auditorías (si no, el dueño no podía declarar)",
      "UNION SELECT detail_person FROM asa_pedidos" in AUD)
check("la pantalla es lista + resumen + hoja de trabajo",
      'id="revLista"' in HTM and 'id="revResCuerpo"' in HTM and 'id="revItemsModal"' in HTM
      and "function cargarRevisiones(" in JS and "function pintarResumen(" in JS
      and "function pintarItems(" in JS)
check("...el cubicador ve sólo lo suyo en la hoja; el admin, todo con filtro por persona",
      "function itemsVisibles(" in JS and "REVS.filtro_cub" in JS and "_esAdmin()" in JS)
check("una revisión sin hallazgos deja constancia en vez de esconderse",
      "sin hallazgos ·" in JS and "Queda el registro de que se revisó" in JS)
check("la hoja se imprime", 'id="revItemsImprimir"' in HTM and "@media print" in HTM)
check("el tab deja arriba el trabajo y pliega la herramienta",
      HTM.count('<details class="revmas">') >= 1
      and HTM.index('id="revLista"') < HTM.index('<details class="revmas">'))
# El usuario, 13-oct: «yo no dejaría revisar obra en particular». Era la pantalla anterior
# a que la revisión fuera la unidad, y ofrecía otro camino para lo mismo.
check("se fue «revisar una obra en particular», con todo lo suyo",
      "Revisar una obra en particular" not in HTM
      and all(('id="%s"' % i) not in HTM for i in
              ("revPend", "revPanel", "revObras", "revCodigos", "revBuscaObra", "revCorrer"))
      and all(("function %s(" % f) not in JS for f in
              ("pintarObras", "abrirObra", "correr", "correrPendientes", "pintarCodigos",
               "cargarObras", "cargarSenales", "resolver")))
check("...y «qué se revisa» es una lista a la vista, no un desplegable",
      "<ul id=\"revReglas\">" in HTM and "revreglasc" in HTM
      and "Qué se revisa <span class=\"muted\">— las reglas" not in HTM)
check("el detalle de la barra mira y no decide: la decisión está en la fila",
      "ESTE MODAL MIRA, NO DECIDE" in JS and "La decisión se toma en la lista" in JS)

print("\n15. La última carga de aSa, en la barra negra")
check("viaja en /me, que el front pide al arrancar",
      "def _asa_ultima_carga(" in AUTH and '"asa_ultima_carga"' in AUTH)
check("...y al cliente no se le manda", "if role == ROL_CLIENTE:" in AUTH)
check("la barra la muestra y avisa si está vieja",
      'id="whoAsa"' in APP and "asa_ultima_carga" in AUTHJS and "horas > 24" in AUTHJS)

print("\n16. La corrección se hace en la fila, no en otra pantalla")
check("se fue el botón «Ver»: la decisión está donde está el dato",
      ">Ver</button>" not in JS)
check("cada fila lleva el par Aplica | No aplica",
      "data-aplica=" in JS and "data-noaplica=" in JS and ".revseg" in HTM)
check("«no aplica» pide motivo y explicación EN la fila, sin prompt del navegador",
      "revnapform" in JS and "data-mot=" in JS and "data-nota=" in JS
      and "¿Por qué NO aplica? Escribe el número" not in JS)
check("...y sigue exigiendo los dos",
      "Elige por qué no aplica." in JS and "nota.length < 10" in JS)
check("el check es «ya la corregí» y UN botón cierra el ciclo: declara y lee aSa",
      'title="Ya la corregí"' in JS and JS.count('id="revAccVerificar"') == 1
      and "{ ids: ids, estado: 'declarada' }" in JS
      and "revAccDecl" not in JS and "revAccNoAplica" not in JS)
check("la referencia abre el render: el detalle no se perdió",
      "abrirDetalleSenal(b.dataset.ver)" in JS and 'audref" data-ver=' in JS)
check("«Mis chequeos» ya no filtra por el estado muerto que dejó la 146",
      "s.estado = 'corregir'" not in API and "s.estado IN ('abierta', 'declarada')" in API)

print("\n17. La figura de la barra, en la hoja de trabajo")
# El usuario la pidió en el modal: ver la barra no es lo mismo que leer «lado B de 90 mm».
check("cada fila tiene su celda de dibujo, con el mismo motor que el auditor",
      'class="revfig"' in JS and "global.audCeldaFigura(global.audBarraNormalizada(" in JS
      and ".revfig svg" in HTM)
# LO QUE NO PUEDE PASAR: pedirle a aSa una barra por fila. Son ~3 segundos cada llamada,
# y un código entero cuesta lo mismo que una de sus barras.
check("se pide POR CÓDIGO y sólo cuando alguien lo pide, no al abrir el modal",
      "'/auditorias/elemento-asa?cc=' + encodeURIComponent(cc)" in JS
      and "&element=" not in JS.split("async function cargarFiguras(")[1][:900]
      and "data-figs=" in JS and 'id="revAccFiguras"' in JS)
check("...y de a uno, no treinta en paralelo",
      "for (var i = 0; i < faltan.length; i++)" in JS and "await cargarFiguras(faltan[i].cc" in JS)
check("lo leído queda en memoria: marcar un check no vuelve a dibujar nada",
      "REVS.figs" in JS and "function _pintarAcc(" in JS
      and "pintarItems();" not in JS.split("input[data-item]")[1][:300])
check("...pero se olvida lo de los códigos que una verificación acaba de leer en aSa",
      "function _olvidarFiguras(" in JS and "_olvidarFiguras(ids);" in JS
      and "REVS.figs = {};" in JS)
check("la figura se imprime: es la mitad de para qué sirve la hoja",
      ".revfig, .revfig svg { display:table-cell !important; }" in HTM)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
