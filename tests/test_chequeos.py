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

Lo que NO hay que hacer es sacar los ganchos de la regla para arreglar eso, que es lo que
se hizo primero: el usuario lo corrigió el 13-oct —«ningún lado se excluye, el cubicador
siempre puede condorearse y digitar algo mal»— y los números le dan la razón. Con «menor»
estricto, incluirlos pasa de 140 a 161 barras; el salto a 319 lo causaba el «menor o
igual», que es otra cosa.

Correr con: python tests/test_chequeos.py
"""
import math
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
DIS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "catalogo", "disenador.js"),
           encoding="utf-8").read()
BM = open(os.path.join(ROOT, "armahub", "static", "js", "features", "cubicacion", "barmanager.js"),
          encoding="utf-8").read()
AUDJS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "index.js"),
             encoding="utf-8").read()
# LA HOJA DE BARRAS (6-nov): la tabla común de la revisión, la planilla del auditor y el
# Resumen Hallazgos.
HOJA = open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "hoja_barras.js"),
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
# NINGÚN LADO SE EXCLUYE, TAMPOCO LOS GANCHOS. Lo corrigió el usuario (13-oct): «el
# cubicador siempre puede condorearse y digitar algo mal». Antes quedaban fuera por una
# precaución mal leída: lo que disparaba de más era el «menor o igual», no incluirlos.
b = barra([("A", 90, "H3", None), ("B", 900, "B", 135)], diam=10.0)
g = C.r_lado_corto(b, [b])
check("un GANCHO de 90 mm en φ10 SÍ dispara: nadie está exento de una digitación",
      len(g) == 1 and "el gancho A mide 90" in g[0]["texto"])
# PERO LA COMPARACIÓN SIGUE SIENDO ESTRICTA, y de eso depende todo: la planta fabrica el
# gancho a 10φ EXACTOS. Con «menor o igual» serían 319 barras en vez de 161.
b10 = barra([("A", 100, "H3", None), ("B", 900, "B", 135), ("G", 100, "H3", 135)], diam=10.0)
check("...pero un gancho de 10φ CLAVADOS no, que es como los fabrica la planta",
      C.r_lado_corto(b10, [b10]) == [])
# El umbral sale de la configuración del gancho, no de un número suelto.
check("el mínimo lo lee de la configuración de fabricación, no de una constante propia",
      "GANCHO_FABRICACION" in SRC and "def _minimo_fabricacion(" in SRC
      and abs(C._minimo_fabricacion(12.0) - 120.0) < 0.01)
check("...con el piso de 7,5 cm para los diámetros chicos",
      abs(C._minimo_fabricacion(6.0) - 75.0) < 0.01)
# LA COMPARACIÓN ES ESTRICTA Y ESO NO SE TOCA.
check("la comparación es ESTRICTA: con «menor o igual» todos los ganchos serían errores",
      'l["largo"] < minimo - 0.01' in SRC
      # (11-nov) y la regla de los soportes de losa compara igual de estricto.
      and '0 < l["largo"] < minimo - 0.01' in SRC)
b = barra([("A", 900, "B", None), ("B", 900, "B", 90)], diam=10.0)
check("una barra sana no dice nada", C.r_lado_corto(b, [b]) == [])

# ── 3. Los lados opuestos del estribo ────────────────────────────────────────────────
print("\n3. Lados opuestos del estribo con medidas distintas")
# LOS TRES CASOS QUE TRAJO EL USUARIO (13-oct), que la regla ANTERIOR marcaba y están
# BIEN: estribos cuadrados de 560, 710 y 160 por lado (SUSW 10mmA26, SUSW 10mmA29 y
# SUQ8 8mmA51, figura T1). Un pilar cuadrado existe; lo que importa no es que sea
# cuadrado, es que los dos lados que se miran de frente midan igual.
def estribo(l1, l2, l3, l4, g=100):
    return barra([("G1", g, "H3", None), ("A", l1, "B", 135), ("B", l2, "B", 90),
                  ("C", l3, "B", 90), ("D", l4, "B", 90), ("G2", g, "H3", 135)],
                 mbr=(max(l1, l3), max(l2, l4)), ref="e1")
for lado in (560, 710, 160):
    check("un estribo cuadrado de %d está BIEN y no se marca" % lado,
          C.r_lados_opuestos(estribo(lado, lado, lado, lado), []) == [])
check("un estribo rectangular coherente tampoco", C.r_lados_opuestos(estribo(300, 800, 300, 800), []) == [])
# EL CASO QUE SÍ: medido en producción, SUL0 12mmA103 con 1.520 contra 1.530.
mal = C.r_lados_opuestos(estribo(1520, 310, 1530, 310), [])
check("dos lados que se miran de frente con medidas distintas SÍ se marcan", len(mal) == 1)
check("...y el mensaje dice cuáles son y cuánto difieren",
      "se miran de frente" in mal[0]["texto"] and "1520" in mal[0]["texto"]
      and "1530" in mal[0]["texto"] and "10 de diferencia" in mal[0]["texto"])
check("la diferencia va con su esperado, para poder comprobarla después",
      mal[0]["valor"] == 1520 and mal[0]["esperado"] == 1530)
# LO QUE SEPARA UN ESTRIBO DE UNA C, Y ES TODO EL PROBLEMA DE LA REGLA ANTERIOR. Una
# 105A o una J71 gira 90° tres veces igual que un estribo y sus patas SON paralelas al
# tramo largo: compararlas marcaba la barra entera siendo correcta (25 de 146 casos).
ce = barra([("A", 100, "B", None), ("B", 120, "B", 90), ("C", 3350, "B", 90),
            ("D", 120, "B", 90), ("E", 420, "B", 90)], ref="c1")
check("una C de tramo largo con dos patas desiguales NO es un estribo: no se marca",
      C.r_lados_opuestos(ce, []) == [] and C._marco(ce) == [])
check("...y lo que las separa es EL GANCHO EN LOS DOS EXTREMOS, no la lista de figuras",
      "EL GANCHO EN LOS DOS EXTREMOS" in SRC
      and 'not ls[0]["gancho"] or not ls[-1]["gancho"]' in SRC
      and "T1" not in SRC.split("def _marco(")[1].split("def ")[0].split('"""')[2])
# SE PROBÓ CON «EL CONTORNO CIERRA» Y NO ALCANZABA, y queda escrito para no repetirlo:
# una C de 950 y 700 cierra con un hueco del 26% del lado mayor.
check("queda dicho por qué no basta con que el contorno cierre",
      "un hueco del 26 por ciento del lado mayor" in SRC)
check("la tolerancia de los opuestos es CERO: deben ser idénticos",
      C.TOLERANCIA_OPUESTOS == 0.0)
check("...y una diferencia de 1 mm se marca", len(C.r_lados_opuestos(estribo(300, 800, 301, 800), [])) == 1)
zeta = barra([("A", 300, "B", None), ("B", 300, "B", 90), ("C", 300, "B", -90),
              ("D", 300, "B", 90)], ref="z1")
check("una Z gira para los dos lados y tampoco es un marco", C._marco(zeta) == [])
# LA 106A TAMBIÉN ES UN ESTRIBO, lo avisó el usuario (13-oct). Y de hecho eran sus nombres
# de lado los que tenía en la cabeza al explicar la regla: «B=D y C=E, A y F menor a 10
# veces el diámetro». Se congela con una barra REAL (SUSH 8mmA37, φ8, ganchos de 80): sus
# ganchos llegan como STD y no como H3, así que lo único que los reconoce es que son
# terminales, cortos y dan la vuelta. Si alguien toca esa clasificación, la 106A se cae
# de la regla sin hacer ruido.
a106 = barra([("A", 80, "STD", None), ("B", 150, "STD", 135), ("C", 370, "STD", 90),
              ("D", 150, "STD", 90), ("E", 370, "STD", 90), ("F", 80, "STD", 135)], diam=8.0)
check("una 106A entra en la regla, aunque aSa no declare sus ganchos como H3",
      [l["nombre"] for l in C._marco(a106)] == ["B", "C", "D", "E"])
check("...y si está bien, no se marca", C.r_lados_opuestos(a106, []) == [])
# EL CASO REAL QUE ENCONTRÓ: SUVI 8mmA100, una 106A con C=350 y E=360.
mala106 = barra([("A", 100, "STD", None), ("B", 150, "STD", 135), ("C", 350, "STD", 90),
                 ("D", 150, "STD", 90), ("E", 360, "STD", 90), ("F", 100, "STD", 135)], diam=8.0)
m106 = C.r_lados_opuestos(mala106, [])
check("...y una 106A con 350 contra 360 SÍ: es el hallazgo real de SUVI 8mmA100",
      len(m106) == 1 and "350" in m106[0]["texto"] and "360" in m106[0]["texto"])
recta = barra([("A", 500, "B", None)], mbr=(500.0, 500.0), ref="r")
check("una barra recta no entra en esta regla", C.r_lados_opuestos(recta, []) == [])
# LA DEFINICIÓN QUE SE RETIRÓ, POR SI ALGUIEN LA REPONE.
check("ya no se marca «el estribo es cuadrado»: eso marcaba 43 barras correctas",
      not hasattr(C, "r_estribo_cuadrado")
      and "56 × 56 es un pilar cuadrado y está bien" in SRC
      and "estribo_cuadrado" not in [r["codigo"] for r in C.REGLAS])

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
check("el PATRÓN sigue en el backend; la pantalla ya no lo ofrece por fila (2-nov: confundía)",
      "firma_patron = %s" in API and "patron: bool = False" in API
      and "o.firma_patron = s.firma_patron" in API
      and "data-pat=" not in JS and "y todas las iguales" not in JS)
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
      "if not meses:" in API and 'VENTANA_TODO' not in API)
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
      all(r.get("corto") and len(r["corto"]) <= 20 for r in C.REGLAS)
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
      "def _avisar_por_corregir(" in API and "def _email_de_login(" not in API
      and API.count("_avisar_por_corregir(cur, hechas)") == 2)
check("...resolviendo el login de aSa con la misma regla que las auditorías",
      "correo_de_login(cur, login)" in API)
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
check("«mis chequeos» ya no es una pantalla aparte: el endpoint queda, el formulario es el modal (28-oct)",
      '@router.get("/chequeos/mios")' in API and "alias_cubicador(cur, user.get" in API
      and "function cargarMios(" not in JS and 'id="revMios"' not in HTM)
check("comprobar una señal vuelve a leer aSa en vivo con la MISMA lógica de la revisión",
      '@router.post("/chequeos/senal/{senal_id}/comprobar")' in API
      and "r = revisar_cc(RevisarCc(job=job, cc=cc), user)" in API)
# La comprobación por fila se fue con la tarjeta (28-oct): lo que aSa dice se mira al CERRAR,
# y lo que sigue igual se avisa con su lista, sin bloquear.
check("...y dice si quedó corregida o qué mide hoy", '"texto": (detalle or {}).get("texto")' in API
      and "function _avisoCierreRev(" in JS and "Sigue igual en aSa" not in JS)
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
      and "s.revision_id = %s" in API)
# CON id 0 SON TODAS. El estado de la pantalla paso a ser global —se mira el total y se
# filtra eligiendo una revision—, asi que «abrir los hallazgos» sin ninguna elegida tiene
# que poder abrirlos todos. Es la misma consulta sin el filtro, no otra pantalla.
check("...y el detalle sabe devolver TODAS, para el bloque global de arriba",
      "todas = revision_id == 0" in API
      and "(%s AND s.revision_id IS NOT NULL) OR s.revision_id = %s" in API)
check("...sólo al INSERTAR: una señal que ya existía sigue siendo de su corrida",
      "sigue\n                     # siendo de la corrida que la encontró" in API
      or "sigue siendo la corrida" in API or "DE QUÉ REVISIÓN ES. Sólo al INSERTAR" in API)
check("el listado de revisiones trae el avance de cada una, contado sobre SUS señales",
      "LEFT JOIN chequeo_senales s ON s.revision_id = r.id" in API and '"pct"' in API)
check("el detalle de una revisión resume por cubicador, con kilos y códigos",
      '@router.get("/chequeos/revision/{revision_id}")' in API and '"por_cubicador"' in API
      and '"ccs_con_hallazgo"' in API and "unnest(%s::text[], %s::text[])" in API)
# TODO LO RESUELTO DICE «RESUELTO» (20-oct), como en la auditoría: lo que dijo quien lo
# hizo. Que aSa lo confirme al cerrar se agrega al texto, no es otro estado de avance.
check("declarar y que aSa confirme siguen siendo dos hechos, pero los dos dicen «Resuelto»",
      'ESTADO_TXT = {"abierta": "Abierta", "declarada": "Resuelto"' in API
      and '"corregida": "Resuelto · aSa lo confirmó"' in API and '"aceptada": "No aplica"' in API
      and "declarada: 'Resuelto'" in JS)
check("...y verificar lo hace el SISTEMA, no una persona",
      '@router.put("/chequeos/declarar")' in API
      and 'body.estado not in ("declarada", "aceptada", "abierta")' in API)
check("declara cualquier cubicador; al dueño le llega aviso si lo hizo otro (21-oct)",
      "sólo puede declararlas quien las hizo" not in API and "alias_cubicador(cur, email)" in API
      and '"marcó resueltas"' in API)
check("«no aplica» exige la explicación; la categoría quedó opcional (29-oct: «basta el comentario»)",
      "body.motivo_tipo and body.motivo_tipo not in MOTIVOS_NO_APLICA" in API
      and "Explica por qué no aplica" in API and "motivo_tipo" in MIG6)
# LA LECTURA DE aSa CORRE AL CERRAR (20-oct), no en un botón aparte: comprobar-lote queda
# como la pieza que lee, y la llama el cierre.
check("la lectura de aSa sigue siendo por código, y la dispara el cierre",
      '@router.post("/chequeos/comprobar-lote")' in API
      and "una lectura de aSa por código, no por" in API
      and "r = comprobar_lote(ComprobarLoteBody(ids=ids, tope_ccs=0), user)" in API
      and "function verificarMarcados(" not in JS and 'id="revAccVerificar"' not in JS)
check("el alias del cubicador sale de aSa y no de las auditorías (si no, el dueño no podía declarar)",
      "UNION SELECT detail_person FROM asa_pedidos" in AUD)
# EL ESTADO VA ARRIBA Y ES GLOBAL (14-oct). Era un segundo cuadro debajo que repetia lo
# de UNA revision, y los chips de cubicador solo valian para esa: no se podia preguntar
# «cuanto le queda a Nlopez en total».
check("el bloque de estado va ARRIBA de la matriz y mira TODAS las revisiones",
      HTM.index('id="revResumen"') < HTM.index('id="revListaCard"')
      and "var T = REVS.total || {}, F = REVS.filtro_cub || null;" in JS and "Todas las revisiones" in JS)
check("...y al elegir una revision se filtra, con un boton para volver al total",
      'id="revTodo"' in JS and "REVS.sel = null; REVS.detalle = null;" in JS)
check("...el total lo calcula el backend, no se suma fila a fila",
      '"revisiones": revs, "total": total' in API
      and "obra que aparece en dos revisiones es UNA obra" in API)
check("la pantalla es lista + resumen + hoja de trabajo",
      'id="revLista"' in HTM and 'id="revResCuerpo"' in HTM and 'id="revItemsModal"' in HTM
      and "function cargarRevisiones(" in JS and "function pintarResumen(" in JS
      and "function pintarItems(" in JS)
check("...el cubicador ve sólo lo suyo en la hoja; el admin, todo con filtro por persona",
      "function itemsVisibles(" in JS and "REVS.filtro_cub" in JS and "_esAdmin()" in JS)
# Una revisión sin hallazgos ENTRA IGUAL en la matriz: es la constancia de que se miró,
# que es distinto de no haber mirado. La lista no filtra por tener hallazgos.
check("una revisión sin hallazgos deja constancia en vez de esconderse",
      "'<span class=\"revsuave\">sin hallazgos</span>'" in JS
      and "Queda el registro de que se revisó" in JS
      and "function _visibles(" in JS and "r.items > 0" not in JS.split("function _visibles(")[1][:400])
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
check("cada fila abierta lleva Resuelto · No aplica; el «Aplica» se fue (sólo servía para deshacer)",
      "data-aplica=" not in JS and "data-noaplica=" in JS and 'class="audbres" data-resuelto=' in JS)
check("«no aplica» pide la explicación EN la fila, sin prompt del navegador ni desplegable de causa",
      "revnapform" not in JS and "data-mot=" not in JS and "_opcionesMotivo" not in JS
      and 'class="revnapin" data-nota=' in JS
      and "¿Por qué NO aplica? Escribe el número" not in JS)
check("...y la exige",
      "Elige por qué no aplica." not in JS and "nota.length < 10" in JS)
# EL MISMO FLUJO QUE LA AUDITORÍA (20-oct). El usuario pidió armonizarlos: «Resuelto» por
# fila —verde cuando está marcado, se vuelve a apretar para deshacerlo—; con los checks,
# los tres verbos de a muchas («muchas veces el hallazgo es el mismo para más de un
# ítem»); y CERRAR va a aSa, avisa lo que sigue igual y no bloquea.
check("«Resuelto» por fila, verde; lo decidido lleva un solo «Deshacer»",
      'class="audbres" data-resuelto=' in JS and 'data-deshacer="\' + i.id + \'" title="\' + t.deshacer + \'">Deshacer' in JS
      and "deshacer: 'Vuelve a dejarla abierta'" in JS
      and "declararUno(b.dataset.resuelto, 'declarada'" in JS
      and "declararUno(b.dataset.deshacer, 'abierta'" in JS and 'title="Ya la corregí"' not in JS)
check("con los checks, los tres verbos de a muchas van EN LA FILA (4-nov: la barra ya no los repite)",
      'data-lote=' not in JS and "async function loteMarcadas(estado, boton)" in JS
      and "function _enLote(estado, boton) {" in JS and "{ ids: ids, estado: estado }" in JS)
check("cerrar lo resuelto le pregunta a aSa y devuelve qué cumple, qué sigue igual y qué no se pudo leer",
      '@router.post("/chequeos/cerrar-resueltas")' in API and 'class CerrarResueltasBody' in API
      and '"cumplen": cumplen, "siguen_igual": siguen, "sin_leer": sin_leer' in API)
check("...si algo sigue igual, 409 con la lista y SIN tocar nada",
      "status_code=409" in API.split("def cerrar_resueltas(")[1][:4000]
      and '"motivo": "sigue_igual"' in API.split("def cerrar_resueltas(")[1][:4000]
      and "if siguen and not body.confirmar:" in API)
check("...y si quien cierra confirma, queda su firma en la señal",
      "cierre_confirmado_por = %s, cierre_confirmado_el = now()" in API
      and "cierre_confirmado_por" in open(os.path.join(ROOT, "armahub", "migrations",
                                                        "158_revision_cierre_confirmado.sql"),
                                           encoding="utf-8").read())
check("...cierra cualquiera lo resuelto; al dueño le llega aviso",
      "cierra lo suyo quien lo hizo" not in API and "cerró %d barra(s) tuyas" in API)
check("la pantalla tiene el botón de cerrar, muestra el aviso con dos salidas y reintenta confirmando",
      'id="revAccCerrar"' in HTM and "async function cerrarResueltos(confirmar, soloIds)" in JS
      and "function _avisoCierreRev(" in JS and "Cerrar igual" in JS
      and "confirmar: !!confirmar" in JS and "e.status === 409" in JS and "err.detalle = det;" in JS)
check("resuelto es lo que dijo quien lo hizo: la declarada cuenta como resuelta en los contadores",
      API.count("s.estado IN ('corregida', 'declarada', 'corregir')") == 3
      and 'c["declaradas"] += 1; c["resueltas"] += 1' in API)
# «NO APLICA» DE A MUCHAS VOLVIO, con una razon nueva: la regla del cabezal marca 70
# barras de las que la mayoria son correctas. El usuario: «con los check que pusiste, el
# usuario pueda ponerle No aplica masivamente, marca checks, contesta y eso se hace
# multiple para cada barra seleccionada». Cien barras correctas no pueden ser cien
# explicaciones iguales: lo que pasa entonces es que nadie explica nada.
check("...y las marcadas se pueden dejar sin efecto de a muchas, con UNA explicacion, desde la fila",
      'id="revAccNoAplica"' not in JS and "noAplicaMarcadas" not in JS
      and "estado: 'aceptada', nota: nota" in JS and "function abrirNoAplica(id) {" in JS)
check("...que exige la explicacion, igual que una barra suelta",
      "Elige por qué no aplican." not in JS and "nota.length < 10" in JS)
# EL BOTON TIENE QUE DECIR QUE LO APRETASTE (19-oct). El usuario: «al presionar el boton
# de no aplica en el formulario de las revisiones, no me actualiza los colores de los
# botones». «No aplica» sólo desplegaba el campo de abajo y el par quedaba igual que
# antes del clic, asi que parecia que el clic no habia entrado.
check("«No aplica» se marca mientras se escribe el motivo, en la fila y en el lote",
      "b.na.classList.add('eligiendo')" in JS and "na.classList.add('eligiendo')" in JS
      and ".eligiendo{" in HTM)
check("...y vuelve a como estaba si se cancela: nada se decidio",
      "b.na.classList.remove('eligiendo')" in JS
      and "na.classList.remove('eligiendo')" in JS)
# Y LO DECIDIDO SE PINTA AL TIRO, sin esperar el refresco: son dos viajes al servidor y
# el refresco no corre en todos los caminos (el modal abierto sin revision elegida).
check("al guardar, la fila queda como quedo aunque el refresco no corra",
      "i.estado = estado;" in JS
      and "if (hojaAbierta()) pintarItems();" in JS)
check("...y mientras el servidor responde, el boton lo dice",
      "x.classList.add('audwait')" in JS.split("async function declararUno(")[1][:1400])
check("la referencia abre el render: el detalle no se perdió",
      "abrirDetalleSenal(b.dataset.ver)" in JS and "marcaAttrs: ' data-ver=\"' + i.id + '\"'" in JS
      and "(b.marcaAttrs || '') + '>' + esc(b.marca || '') + '</span></td>'" in HOJA)
check("«Mis chequeos» ya no filtra por el estado muerto que dejó la 146",
      "s.estado = 'corregir'" not in API and "s.estado IN ('abierta', 'declarada')" in API)

print("\n17. La figura de la barra, en la hoja de trabajo")
# El usuario la pidió en el modal: ver la barra no es lo mismo que leer «lado B de 90 mm».
check("cada fila tiene su celda de dibujo, con el mismo motor que el auditor y sin el nombre al lado",
      "renderAttrs: ' data-fig=\"" in JS and "global.audCeldaFigura(global.audBarraNormalizada(b, 'asa'), true)" in JS
      and ".audt.hojab td.audfigcel svg{max-width:none !important;}" in HTM)
# LO QUE NO PUEDE PASAR: pedirle a aSa una barra por fila. Son ~3 segundos cada llamada,
# y un código entero cuesta lo mismo que una de sus barras.
check("se pide POR CÓDIGO y sólo cuando alguien lo pide, no al abrir el modal",
      "'/auditorias/elemento-asa?cc=' + encodeURIComponent(cc)" in JS
      and "&element=" not in JS.split("async function cargarFiguras(")[1][:900]
      and "data-figs=" in JS and 'id="revAccFiguras"' in HTM)
check("...y de a uno, no treinta en paralelo",
      "for (var i = 0; i < faltan.length; i++)" in JS and "await cargarFiguras(faltan[i].cc" in JS)
check("lo leído queda en memoria: marcar un check no vuelve a dibujar nada",
      "REVS.figs" in JS and "function _pintarAcc(" in JS
      and "pintarItems();" not in JS.split("input[data-item]")[1][:300])
check("...pero se olvida lo de los códigos que una verificación acaba de leer en aSa",
      "function _olvidarFiguras(" in JS and "_olvidarFiguras(ids);" in JS
      and "REVS.figs = {};" in JS)
check("la figura se imprime: es la mitad de para qué sirve la hoja",
      ".revcc2 td.audfigcel svg { display:inline-block !important; }" in HTM
      # Con anchos fijos, esconder la celda correría las columnas: se esconden los botones.
      and ".revcc2 input[type=checkbox], .revcc2 td.hojaacc .revaccs { display:none !important; }" in HTM)

print("\n17b. El cabezal con diametro chico")
# «Revisar si tenemos cabezales con diametros 8, 10 o 12... podria aplicar a vigas, muros
# y elementos en general que tengan el texto CB en la tipologia».
def _cab(diam, nota="Cb"):
    b = barra([("A", 900, "B", None), ("B", 900, "B", 90)], diam=diam)
    b["tipologia"] = nota
    return b
# «Los cabezales de 12 son super comunes, mejor que el hallazgo se enfoque en los de 10 y
# 8» (28-oct). Medido: 163 señales de phi12 contra 21 de phi8 y phi10.
check("un cabezal de phi10 se marca, y uno de phi8 tambien",
      len(C.r_cabezal_delgado(_cab(10.0), [])) == 1 and len(C.r_cabezal_delgado(_cab(8.0), [])) == 1)
check("...pero phi12 ya no: es lo habitual (y phi16 tampoco)",
      C.r_cabezal_delgado(_cab(12.0), []) == [] and C.r_cabezal_delgado(_cab(16.0), []) == []
      and "CABEZAL_DIAM_MINIMO = 12.0" in SRC)
check("la tipologia se lee con diccionario, porque la escribe una persona",
      C.tipologia_de("Cb") == "cabezal" and C.tipologia_de("CAB SUP") == "cabezal"
      and C.tipologia_de("MH") == "horizontal" and C.tipologia_de("HORIZ") == "horizontal"
      and C.tipologia_de("TRABA MURO") == "traba" and C.tipologia_de("MV VAR") == "vertical")
# LO QUE NO DEBE HACER: tragarse cualquier texto que contenga esas letras. Se busca la
# PALABRA completa, no el trozo.
check("...y no se traga lo que no es", C.tipologia_de("CAPITEL") is None
      and C.tipologia_de("TC") is None and C.tipologia_de("F=F'") is None
      and C.tipologia_de("") is None and C.tipologia_de(None) is None)
check("una barra sin tipologia de cabezal no entra en la regla",
      C.r_cabezal_delgado(_cab(12.0, "MH"), []) == []
      and C.r_cabezal_delgado(_cab(12.0, None), []) == [])
# NO AFIRMA QUE ESTE MAL: 117 de 475 cabezales son phi12, demasiado para ser todo error.
check("la regla dice que hay que mirarlo, no que este mal",
      "no afirma que esté mal" in SRC and "de a muchos" in SRC)
check("la tipologia llega desde aSa en `Notes`", '"tipologia": (item.get("Notes")' in SRC)

print("\n18. La fila muestra la barra, no la describe")
# El usuario (13-oct): «demasiado texto. Debe indicar hallazgo, mostrar barra renderizada
# y los lados que tiene la figura, resaltar en rojo el que no cumple. Eso es mejor que
# todo ese texto. Además así el usuario verifica acá sin tener que ir a aSa».
check("los lados de la figura están en la fila, con el que falla en rojo",
      "lados: porL, malos: malos" in JS and "(b.malos || {})[L] ? ' mal' : ''" in HOJA
      and ".audt.hojab tbody tr td.mal{background:#ffebee; color:#c62828;" in HTM)
# DESDE LA SEÑAL, NO DESDE aSa (21-oct): todos los lados se guardan al detectar, en su
# orden y con su ángulo, y la hoja los pinta sin leer nada. La figura sólo dibuja.
check("...y salen de la señal misma, guardados al detectar: no cuesta leer aSa",
      '"lados_all": [[l["nombre"], l["largo"], l.get("angulo")]' in SRC and "det.lados_all" in JS)
check("...y una señal de antes de hoy (sin todos los lados) muestra al menos el del hallazgo",
      "porL[L] = Number(det.valor) / 10" in JS)
check("el esperado se rotula según lo que significa en cada regla, no «debería» siempre",
      "i.regla === 'lado_corto' ? 'mín ' : ''" in JS and "title: 'Lo que la regla pide" in JS)
check("el hallazgo va como etiqueta corta, no como párrafo",
      "r.corto || r.nombre" in JS and 'class="revreg"' in JS
      and "esc(det.texto || '') + firma" not in JS)
check("...y el texto entero no se pierde: queda en el title de la celda",
      'class="revreg" title="\' + esc(det.texto' in JS)
check("el cubicador se dice una vez por código, no en cada fila",
      "revquien" in JS and "revquien" in HTM)
# El usuario, viendo la columna vacia: «falto el renderizado». Una columna vacia no se
# lee como «apreta aca»: se lee como que esta rota.
check("las figuras se piden solas cuando el codigo entra en pantalla",
      # (3-nov) El observador de scroll se fue: cargaba aSa al bajar y la hoja se arrastraba.
      "_observarFiguras" not in JS and "IntersectionObserver" not in JS
      and "data-grupocc=" in JS and "data-figs=" in JS and 'id="revAccFiguras"' in HTM)
check("...y «ver las figuras» de arriba las pide de a una, en serie: treinta en paralelo tumban la sesión de aSa",
      "for (var i = 0; i < faltan.length; i++) {" in JS
      and "await cargarFiguras(faltan[i].cc, faltan[i].job);" in JS)
check("...y nada las pide solo: ni al abrir la hoja ni al bajar por ella (3-nov)",
      "_mirando" not in JS and "cola.shift()" not in JS)
# EL CHURRO SE FUE: iba en un renglon, en orden de recorrido, con los angulos
# intercalados en chico y con signo. El usuario: «la forma de presentar esto esta media
# sucia... por que no los pones claros, A = 15, B = XX, con encabezados».
# UN SOLO ENCABEZADO POR CÓDIGO (21-oct). El usuario: «estamos repitiendo A, B y C muchas
# veces. Haz 1 solo encabezado para todo: Marca | Figura | A | B | C | … | Ang1 | Ang2».
# LA TABLA COMÚN (6-nov): la de la planilla del auditor, con lo propio de la revisión.
check("un solo encabezado por código, el de la tabla común: Acción · Marca · φ · Figura · Render · A B C… · α… · Elemento · Esperado · Regla · Estado · Explicación",
      "function _tablaGrupo(" in JS and "global.HojaBarras.tabla({" in JS.split("function _tablaGrupo(")[1][:300]
      and "col(ANCHO.marca, 'Marca');" in HOJA and "'α' + (k + 1)" in HOJA and "revang" not in JS
      and "{ titulo: 'Regla', ancho: 120 }" in JS and "texto: { titulo: 'Explicación'" in JS)
check("...y sin Largo, Cant ni Peso: la señal no los guarda y una columna sin datos no sale",
      "if (c.largo) col(" in HOJA and "if (hay(b[k])) c[k] = true;" in HOJA
      and "cant:" not in JS.split("function filaItem(i) {")[1][:2500])
check("...y la grilla por fila se fue de acá: la auditoría conserva la suya en index.js",
      "function _ladosCelda(" not in JS and "audGrillaLados" not in JS and "audGrillaLados" in AUDJS)
# El usuario: «establecer un color especifico para las figuras que vienen de aSa».
check("las barras de aSa se dibujan con su propia tinta",
      "TINTA_ASA" in DIS and "#4a148c" in DIS and "TINTA_ASA: TINTA_ASA" in DIS
      and "b.de_asa" in BM and "de_asa: origen === 'asa'" in AUDJS)
check("...y la decide quien llama, no el dibujante",
      "M.TINTA_ASA || M.TINTA" in BM)


print("\nTODOS VEN TODO Y CUALQUIERA RESUELVE, CON AVISO (21-oct)")
# Armonizado con la auditoría, como pidió el usuario: «no quiero que no puedan ver las
# observaciones de los otros» y «cualquier cubicador puede resolver pero debe dar aviso».
check("declarar ya no rechaza lo ajeno: avisa al dueño, con cuántas y en qué códigos",
      "sólo puede declararlas quien las hizo." not in API and '"marcó resueltas"' in API
      and "barra(s) tuyas" in API)
check("...y cerrar lo resuelto tampoco: avisa al dueño qué confirmó aSa",
      "cierra lo suyo quien lo hizo." not in API and "cerró %d barra(s) tuyas" in API)
check("el login de aSa se resuelve a correo con UNA función, la de las auditorías",
      "_email_de_login" not in API and API.count("correo_de_login(cur, ") >= 3)
check("en la hoja todos ven todo; el chip filtra y el cubicador entra con el propio puesto",
      "function _miChip(" in JS and "_esAdmin() ? null : (_miChip() || null)" in JS
      and "'Tus ' + items.length" not in JS
      and "if (!_esAdmin()) { cubs.innerHTML = ''; }" not in JS)


print("\nLA HOJA, ARMONIZADA CON LA AUDITORÍA (21-oct)")
check("Resuelto va en línea, a continuación de No aplica, con una separación chica",
      'class="revaccs"' in JS and ".revaccs{display:inline-flex" in HTM and ".revaccs .audbres{margin-left:0;}" in HTM)
# «No aplica» CIERRA pero no es resuelto (vocabulario del 2-nov): la fila queda verde al
# guardar, sin otro clic, y el texto del boton ya no dice «queda resuelta».
check("«no aplica» cierra la fila al guardar, sin otro clic, y no se llama resuelta",
      ".revcc2 tr.hecho td, .revcc2 tr.nap td{background:#f1f8e9;}" in HTM and "Queda resuelta." not in JS)
check("al cerrar un codigo se suelta lo marcado (4-nov: el siguiente Deshacer actuaba en lote sobre lo recien cerrado)",
      "REVS.sel_items = {};\n      // Lo marcado resuelto se comprueba en aSa" in JS)
check("lo escrito y no guardado sobrevive al repintado de la hoja (4-nov)",
      "var notas = _notasAbiertas();" in JS and "_bindItems();\n    _reabrirNotas(notas);" in JS
      and "function _notasAbiertas() {" in JS and "if (!i || i.estado !== EST.ABIERTA) return;" in JS)
check("el nombre de la figura se ve siempre, en su columna, haya dibujo o no (4-nov, 6-nov)",
      "figura: i.figura || ''" in JS and "function _nombreFig(" not in JS
      and "h += td('figura', esc(b.figura || ''), 'hojafig hojac');" in HOJA
      and "if (!c) return '';" in JS.split("function _celda(cc, ref, sen) {")[1][:200]
      and "render: _celda(i.cc || '', i.ref, i.id)" in JS)
check("la fila resuelta va verde aunque aSa no la haya confirmado todavia (4-nov: en blanco parecia pendiente)",
      "function _resuelta(i) { return _confirmada(i) || _declarada(i); }" in JS
      and JS.count("var hecho = _resuelta(i), nap = _noAplica(i);") == 2
      and "var hecho = _confirmada(i)" not in JS)
# «¿Por que el render muestra ganchos de 10 y los parametros A y G muestran 8?» Porque la
# columna es la medida de cuando salto y el dibujo es aSa de ahora: medido en SU2N, la
# señal guarda A=80/G=80 del 29-oct y aSa hoy devuelve A=100/G=100. Ya esta corregida.
check("la cabecera dice que las medidas son del momento del hallazgo, no de ahora",
      "'Medida del lado ' + L + ' cuando se detectó el hallazgo." in JS
      and "es que la barra ya se corrigió." in JS)
check("la figura, cuando llega, sólo dibuja: los lados ya están en la fila",
      "td.innerHTML = _celda(td.dataset.cc, td.dataset.fig, td.dataset.sen);" in JS
      and "lad.innerHTML = _ladosCelda" not in JS)


print("\nLA HOJA PARTE POR LOS CÓDIGOS (21-oct)")
# «Mejor separar: un listado con los CC y cantidad de hallazgos; luego click y se abre el
# modal con las barras de ese CC».
# TODOS LOS CODIGOS A LA VISTA (2-nov). Hubo un paso intermedio —lista de códigos y un
# clic para entrar a cada uno— que venia de cuando la hoja era una tira sin agrupar. Con
# el codigo agrupado, su cabecera y su boton de cerrar, ese paso sobra: el usuario «en vez
# de entrar a cada CC en el modal, creo que quedaria mejor que tengamos cada CC agrupado».
check("la hoja trae TODOS los codigos agrupados, sin lista intermedia ni «abrir»",
      "cc_abierto" not in JS and "revlista" not in JS and "data-abrircc" not in JS
      and "data-volvercc" not in JS and "revccfila" not in HTM
      and "orden.map(function (k) {" in JS and 'data-grupocc="' in JS)
check("...y cada uno lleva su cabecera, sus barras y su pie; el que esta cerrado se reconoce",
      "_tablaGrupo(g) + _pieGrupo(g) + '</div>';" in JS
      and "(ok >= g.items.length ? ' listo' : '')" in JS and ".revcc2.listo h5{" in HTM)
check("cerrada, para los contadores de la hoja, es la que paso por el cierre",
      "var RES = {" not in JS and "function _cerrada(i) {" in JS
      and "function _cerrada(i) { return _noAplica(i) || _confirmada(i) || (_declarada(i) && !!i.cerrada_el); }" in JS)
check("la que se cerro igual ya no esta por cerrar: el boton de arriba no la cuenta ni la vuelve a mandar (4-nov)",
      "function _porCerrar(i) { return _declarada(i) && !i.cerrada_el; }" in JS
      and "itemsVisibles().filter(_porCerrar).length" in JS
      and "i.cerrada_el ? ' · cerrada igual' : ''" in JS)


print("\nUN SOLO FORMULARIO PARA TODOS, Y EL CABEZAL EN φ8 Y φ10 (28-oct)")
# El cubicador externo entro a ver sus correcciones y le salio «Mis chequeos por corregir»
# —una lista plana del flujo viejo con «Ya la corregi: comprobar»— encima del panel; al
# admin nunca, porque no tiene hallazgos propios. El usuario: «no tiene nada que ver con
# como lo veo yo. El formulario correcto es este [el modal]».
check("la tarjeta «Mis chequeos por corregir» se fue: el formulario es el modal, para todos",
      "cargarMios" not in JS and "Mis chequeos por corregir" not in JS
      and "Ya la corregí: comprobar" not in JS and 'id="revMios"' not in HTM)
check("...y el cubicador llega con su chip puesto; el admin, sin filtro",
      "REVS.filtro_cub = _esAdmin() ? null : (_miChip() || null)" in JS)
# El umbral del cabezal vive en una constante con su historia, no en un numero suelto.
check("el umbral del cabezal es 12, y esta escrito por que",
      "CABEZAL_DIAM_MINIMO = 12.0" in SRC and "los cabezales de 12 son" in SRC)


print("\nUN RETOQUE DEL MISMO DIA NO SE PIERDE (29-oct)")
# aSa marca `LastModified` SOLO con la fecha (medido: todas las horas son 00:00). La cola
# preguntaba «la marca de aSa es mayor que la que yo tenia», asi que un codigo revisado a
# las 06:00 y retocado esa tarde conservaba la misma marca y no volvia a mirarse nunca.
# Medido el 29-oct: 15 codigos en esa situacion.
check("la cola toma lo que avanzo de marca Y lo que aSa marco el mismo dia de la revision",
      "p.ultima_mod > c.ultima_mod\n                                    OR p.ultima_mod::date >= c.revisado_el::date" in API)
check("...y la pantalla de la obra dice lo mismo que la cola, no otra cosa",
      API.count("OR p.ultima_mod::date >= c.revisado_el::date") == 2)
# POR QUE NO SE QUEDA PEGADO: al re-revisarlo, `revisado_el` pasa a ser mas nuevo que
# `ultima_mod`, asi que entra UNA vez mas y despues sale solo.
check("...y entra una sola vez mas: no se queda dando vueltas",
      "entra una vez más al día siguiente" in API and "sale solo" in API)


print("\nEL PANEL: LOS CUBICADORES FILTRAN, ABRIR ENTRA (29-oct)")
# «Los botones de abrir estan con los totales y se descuadran. Eliminalos. Los cubicadores
# deben ser filtros no botones: si se presiona uno debe actualizarse todo, la matriz, y al
# abrir mostrarle solo lo de el. Asi los KPI cards tambien se actualizan, y le damos el
# enfasis al boton abrir.»
check("«Abrir» a secas en cada fila y uno solo arriba; el numero ya no va al lado",
      'data-abrir="\' + r.id + \'">Abrir</button>' in JS and "'Abrir ' + r.aplican" not in JS
      and 'id="revAbrir"' in JS and "abrirItems(true); });" in JS)
check("...y el chip lleva SOLO el nombre, arriba y en la hoja: los numeros van en tarjetas y matriz",
      "esc(nomCub(c.q)) + '</button>'" in JS and "'\">Todos</button>'" in JS
      and "esc(c.cubico) + ' ' + c.n" not in JS and "'<small>de ' + c.n" not in JS)
check("los chips de cubicador son FILTROS: repintan tarjetas y matriz, no abren nada",
      "data-filtro-cub=" in JS and "data-abrir-cub" not in JS
      and "REVS.filtro_cub = (REVS.filtro_cub === x.dataset.filtroCub) ? null : x.dataset.filtroCub;" in JS
      and "pintarResumen(); pintarRevisiones();" in JS)
check("...y el filtro es UNO, global: la hoja abre con el que este puesto y al volver se repinta arriba",
      "REVS.filtro_cub = _miChip();" not in JS
      and "// El chip del modal y el de arriba son el MISMO filtro: al volver, arriba se repinta.\n    pintarResumen(); pintarRevisiones();" in JS.split("function cerrarItems")[1][:900])
# «Se siguen moviendo los nombres de los cubicadores y se genera ese espacio en blanco.
# Todo debe quedar tal cual, simplemente deben actualizarse los valores.» Dejar sólo la
# columna del filtrado recolocaba la tabla entera: ahora las columnas son fijas.
check("la tabla NO cambia de estructura al filtrar: las columnas son siempre las mismas",
      "_cuentaDe(r, F)" in JS and "cols = _columnas(vis)" in JS and "cols = F ? [F]" not in JS
      and "var tot = (REVS.total || {}).por_cubicador || {};" in JS
      and "nomCub(a).localeCompare(nomCub(b), 'es')" in JS
      and "' dim'" not in JS and "td.dim" not in HTM)
check("...y lo que cambia son los valores: con filtro sólo esa columna lleva número, y Estado y Hallazgos son los suyos",
      "var apagada = !t.n;" in JS and "' apagada' : ''" in JS
      and "if (F && F !== q) return '<td class=\"' + cls + '\">' + PUNTO + '</td>';" in JS)
check("la celda por cubicador dice «cerradas de cuántas», y se pinta VERDE si ya no le queda nada",
      "var cerr = c.cerrados != null ? c.cerrados : (c.no_aplica || 0) + (c.resueltos || 0);" in JS
      and "(falta <= 0 ? ' listo' : '')" in JS and "revtick" not in JS and "✓</i>" not in JS
      # «Cerradas de cuántas» también en la matriz: el total solo no decía si alguien lo miraba.
      and "'<b>' + cerr + '</b><span class=\"revde\">/' + c.n + '</span></td>'" in JS
      and ".revmat .revde{color:#263238; font-weight:700;}" in HTM
      and "'<div class=\"l2\">de ' + c.n" not in JS)
check("...y la matriz va en tres secciones con su raya: quiénes · detectados/no aplican/aplican · resueltos/por resolver/avance",
      '<th class="num est sec"' in JS and ">Resueltos</th>" in JS and ">Por resolver</th>" in JS
      and ".revmat th.sec, .revmat td.sec{box-shadow:inset 2px 0 0" in HTM)
# «Dejaste numeros de distintos tamaños. Armoniza el display» (2-nov): un solo tamaño, dos
# filas de encabezado, el vacio siempre igual, el ✓ siempre en el mismo sitio.
check("la matriz tiene UN tamaño de numero: la jerarquia va por peso y color, no por tamaño",
      "font-size:15px" not in HTM.split(".revmat{font-size:12px;}")[1].split("/* EL FILTRO POR CUBICADOR")[0]
      and "class=\"revh\"" not in JS)
check("...dos filas de encabezado: la seccion arriba y la columna abajo, con la raya en la primera de cada una",
      '<tr class="revsecs"><th></th>' in JS and '" class="sec">Cubicadores</th>' in JS
      and '" class="sec curioso">Hallazgos</th>' in JS and '" class="sec">Estado</th>' in JS
      and JS.index('class="sec">Estado</th>') < JS.index('class="sec curioso">Hallazgos</th>')
      # Los dos encabezados fijos: la segunda fila se pega bajo la primera, cuyo alto mide el JS.
      and ".revmat thead th{position:sticky; z-index:4;" in HTM
      and ".revmat thead tr:nth-child(2) th{top:var(--revsec, 24px);" in HTM
      and "el.style.setProperty('--revsec', secs.offsetHeight + 'px');" in JS)
check("...el vacio es siempre el mismo punto, y el avance tiene barra de ancho fijo y porcentaje alineado",
      "var PUNTO = '<span class=\"revvacio2\">·</span>';" in JS and ".revmat .revav .revbar2{width:84px" in HTM
      and ".revmat .revav span{width:38px" in HTM)
check("arriba parte en «Todas las revisiones», grande; una fila elegida lo dice y tiene su ✕",
      "Todas las revisiones</span>" in JS and 'class="revtit"' in JS and ".revtit{font-size:16px" in HTM
      and "✕ Ver todas" in JS)
check("«cerrado» se mide contra los detectados: corregir y descartar son las dos salidas",
      "var pend = Math.max(0, apl - v.res), cerr = v.nap + v.res;" in JS and "pcent(cerr)" in JS)
check("«barras miradas» sale; entra lo que envejece: abiertas hace mas de 7 dias",
      "'barras miradas'" not in JS and "'abiertas hace más de 7 días'" in JS
      and "s.visto_primero < now() - interval '7 days'" in API and '"viejas": t[6]' in API)
check("...y el detalle de UNA revision trae los mismos nombres que la lista, por persona y en total",
      '"detectados": len(items),' in API and '"viejas": sum(c["viejas"] for c in por_cub.values()),' in API
      and 'c["obras"].add(i.get("job"))' in API and '"ccs": ccs_q, "obras": obras_q' in API)
# «Dejaste las columnas seleccionables, pero al presionar se genera un movimiento raro y se
# aplica el filtro del cubicador de esa columna. No quedo bien.» La celda solo informa.
check("la celda NO es clicable: la fila elige la revision, el chip filtra la persona, el boton entra",
      "revcel" not in JS and "revcel" not in HTM and "td.dataset.cub" not in JS
      and "await abrirRevision(Number(b.dataset.abrir));\n        REVS.antes = antes;\n        abrirItems(true);" in JS)


print("\nEL LOTE, LIMPIO (29-oct)")
# «Tienes una barra arriba pero otro check en la misma linea. ¿Como deberia ser para que sea
# limpio?» Sin marcas no hay barra; lo permanente va al encabezado; el check «todas» va en su
# columna; con marcas, la fila se apaga.
check("sin marcas no hay barra: aparece con la primera, dentro de la cabecera anclada (4-nov)",
      "acc.style.display = n ? '' : 'none';" in JS and ".revcab{position:sticky; top:0; z-index:6;" in HTM
      and "Marca con el check para resolver varias" not in JS)
check("ver figuras y cerrar lo resuelto viven en el encabezado de la hoja, siempre en el mismo lugar",
      'id="revAccCerrar" disabled' in HTM and 'id="revAccFiguras"' in HTM
      and "cz.textContent = 'Cerrar lo resuelto'" in JS)
check("el check «todas» va en la cabecera de la tabla, no en el titulo del codigo",
      '<th style="width:22px"><input type="checkbox" data-grupo="' in JS
      and "<h5>' +\n              '<input type=\"checkbox\" data-grupo=" not in JS)
check("con marcas, los botones de la fila NO cambian de aspecto: hacen lo mismo sobre todas; «Quitar seleccion» desmarca",
      "cuerpo.classList.toggle('lote', n > 0)" in JS and "#revItemsCuerpo.lote .revcc2 td.revacc button{" not in HTM
      and "function quitarSeleccion(" in JS and 'id="revAccQuitar"' in JS)
check("los botones de lote ya no llevan la cuenta: esta en «n barra(s) marcada(s)»",
      "'Aplica' + (n ?" not in JS and "'Resuelto' + (n ?" not in JS)


print("\nLA MATRIZ: VERDE = CERRADO, CENTRADA, Y LOS HALLAZGOS AL FINAL (2-nov)")
# «Vamos con celda verde, centra los numeros y encabezados, ajusta los tamaños para que haya
# simetria. Los tickets se van. La seccion de hallazgos va al final y separada: es un dato
# casi curioso; aca nos interesa que hallazgos tiene quien, que tiene pendiente y el avance.»
check("celda verde para quien ya resolvio todo lo suyo y para el avance al 100%; sin ✓",
      ".revmat td.listo{background:#e8f5e9" in HTM and "(lleno || (t.n && !t.apl) ? ' listo' : '')" in JS
      and "revtick" not in HTM and "✓" not in JS.split("function pintarRevisiones(")[1].split("function pintarResumen(")[0])
check("numeros y encabezados centrados, con anchos fijos por seccion",
      "text-align:center; font-variant-numeric:tabular-nums" in HTM and ".revmat th.cub, .revmat td.cub{width:" in HTM
      and ".revmat th.est, .revmat td.est{width:" in HTM and ".revmat th.cur, .revmat td.cur{width:" in HTM)
# El cubicador veia VERDES celdas con pendientes: la columna filtrada se resaltaba con el
# mismo verde que «cerrado». Ahora el filtro es azul; el verde es solo cerrado.
check("la columna del cubicador filtrado se resalta en azul, no en el verde de cerrado",
      "td.sel" not in HTM and "' sel'" not in JS)
check("Aplican, en la seccion de hallazgos, va en rojo",
      'class="num cur curioso aplican"' in JS and ".revmat td.curioso.aplican span{color:#c62828" in HTM)
check("el CSS no arrastra clases que ya nadie pinta",
      all(("." + c + "{") not in HTM and ("." + c + " ") not in HTM
          for c in ("revfila", "revobra", "revlados", "revtot", "revlote", "revmio", "revrepfila", "revccs")))
check("el orden es el del trabajo: cubicadores · estado · hallazgos, y los hallazgos van atenuados",
      ".revmat th.curioso, .revmat td.curioso{color:#90a4ae" in HTM
      and JS.index(">Por resolver</th>") < JS.index(">Detectados</th>"))


print("\nUNA FILA, UNA DECISION, DOS SALIDAS (2-nov)")
# «Si presiono No aplica igual puedo presionar Resuelto, ¿entonces como cierro? Cancelar no
# me suma. Guardar me confunde: ¿guardamos por barra o el formulario completo?» Todo es por
# barra y al instante: No aplica cierra con Enter, Resuelto con Resuelto. Sin Guardar ni
# Cancelar ni «y todas las iguales».
check("el campo del «no aplica» va AL LADO, corto, y se guarda con Enter; Esc lo deja",
      'class="revnapin" data-nota=' in JS and "if (e.key === 'Enter') guardarNoAplica(c.dataset.nota);" in JS
      and "if (e.key === 'Escape') cerrarNoAplica(c.dataset.nota);" in JS and ".revnapin{width:240px" in HTM)
check("...sin Guardar, sin Cancelar, sin fila adicional, sin «y todas las iguales»",
      "data-napok" not in JS and "data-napno" not in JS and "revnapform" not in JS and "data-pat" not in JS
      and ">Guardar</button>" not in JS and ">Cancelar</button>" not in JS)
check("la barra de marcadas dice cuantas hay y donde se actua, y la cabecera entera queda anclada (4-nov)",
      "revAccNapNota" not in JS and "revAccNapOk" not in JS and "revAccNapForm" not in JS
      and "actúa sobre todas.</span>" in JS and 'id="revAccQuitar"' in JS
      and '<div class="revcab" id="revCab">' in HTM and ".revcab{position:sticky; top:0;" in HTM
      and "position:sticky" not in HTM.split(".revcubacc{")[1].split("}")[0])
check("la hoja no deja huella: «Abrir» desde la fila elige para abrir, y al cerrar vuelve lo que habia",
      "var antes = { sel: REVS.sel, detalle: REVS.detalle };" in JS and "REVS.antes = antes;" in JS
      and "if (REVS.antes) { REVS.sel = REVS.antes.sel; REVS.detalle = REVS.antes.detalle; REVS.antes = null; }" in JS)


print("\nEL NOMBRE DEL CUBICADOR EN LA REVISION, Y LOS CHIPS SIN VERDE (2-nov)")
# «Aca hay 2 filtros pintados en verde»: el verde era «ya resolvio todo lo suyo» y se leia
# como «filtro puesto». El unico color de un chip es el azul del que esta activo.
check("los chips de cubicador no se pintan de verde: el color es solo del filtro puesto",
      "revcubs button.listo" not in HTM
      and "(falta <= 0 ? 'listo' : '')" not in JS and "(c.pct === 100 ? 'listo' : '')" not in JS)
check("los chips, la matriz y la hoja escriben el NOMBRE, no el login de aSa",
      "esc(nomCub(c.q))" in JS and "esc(nomCub(q)) +\n               '<div class=\"revsum\">'" in JS
      and "esc(nomCub(c.cubico))" in JS and "nomCub(REVS.filtro_cub)" in JS
      and "Object.keys(quienes).map(nomCub)" in JS)
check("...y el mapa se pide antes de pintar; el valor que filtra sigue siendo el login",
      "await global.cargarNomCub();" in JS and 'data-filtro-cub="\' + esc(c.q) + \'"' in JS
      and 'data-cub="\' + esc(c.cubico) + \'"' in JS)
PRGJS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "programacion",
                          "dashboards.js"), encoding="utf-8").read()
check("en los dashboards de programacion, los chips de persona tambien",
      "}, nomCub);" in PRGJS and "esc(nomCub(p))" in PRGJS and "await global.cargarNomCub();" in PRGJS)


print("\nLAS TARJETAS: EL DENOMINADOR NO SE MUEVE (2-nov)")
# «166 / 277 resueltos de los que aplican» se veia sucio y era movil: al marcar un «no
# aplica» bajaba el denominador y el % subia solo, sin que nadie corrigiera nada.
check("el denominador es DETECTADOS, que ya no cambia; «no aplica» no cuenta como corregido",
      "var pcent = function (x) { return v.det ? Math.round(x / v.det * 100) : 0; };" in JS
      and "'resueltos de los que aplican'" not in JS
      and "v.res + ' resueltos · ' + v.nap + ' no aplican'" in JS)
check("cuatro tarjetas: lo que falta, lo que envejece, lo cerrado y lo que no aplica",
      "'por resolver'" in JS and "'abiertas hace más de 7 días'" in JS
      and "'cerrado'" in JS and "'no aplican'" in JS)
check("...lo accionable se ve: ambar lo que falta, rojo lo que lleva mas de una semana",
      ".revkpi.ocupa b{color:#e65100;}" in HTM and ".revkpi.urge b{color:#c62828;}" in HTM
      and ".revkbar i{display:block" in HTM)
check("el contexto —obras, codigos, kilos— baja a una linea: con eso no se decide nada",
      "var ctx = [v.obras" in JS and "' kg en juego'" in JS.replace("'kg en juego'", "' kg en juego'")
      and ".revctx{font-size:10.5px" in HTM)


print("\nEL MENU NO SE MUEVE, Y LA FILA NO SE QUEDA MUDA (2-nov)")
# «Al filtrar se modifica visualmente el menu, debe ser estatico, solo editas data.»
check("los chips salen siempre del total y van en orden alfabetico: el menu no cambia",
      "var cubs = Object.keys(T.por_cubicador || {}).map(" in JS
      and "nomCub(a.q).localeCompare(nomCub(b.q), 'es')" in JS
      and "LA LISTA DE CHIPS SALE SIEMPRE DEL TOTAL" in JS)
check("...y los numeros de la persona filtrada salen de la revision abierta, si hay una",
      "var enSel = {};" in JS and "(sel ? enSel[F] : cubs.filter(" in JS)
# «No puedo corregir masivamente»: los botones de la fila quedaban apagados Y MUDOS, asi
# que apretarlos no hacia nada y parecia que el masivo no existia.
check("con barras marcadas, el boton de la fila actua sobre TODAS, confirmando antes (3-nov)",
      "function _enLote(estado, boton) {" in JS and "loteMarcadas(estado, boton);" in JS
      and "if (_enLote('declarada', b)) return;" in JS and "if (_enLote('abierta', b)) return;" in JS
      and "b.addEventListener('click', function () { abrirNoAplica(b.dataset.noaplica); });" in JS
      and "las ' + n + ' barra(s) marcada(s)?'" in JS
      # «No aplica» con marcas: el campo se abre EN CADA FILA MARCADA, lo escrito se espeja y vale para todas.
      and "_enLote('aceptada'" not in JS
      and "function _idsNoAplica(id) {" in JS and "b.nota.dataset.espejo = n > 1 ? '1' : '';" in JS
      and "if (o !== c) o.value = c.value;" in JS
      and "if (ids.indexOf(Number(id)) === -1) ids.push(Number(id));" in JS
      and "barra(s) marcada(s) con esta explicación?'" in JS
      and "#revItemsCuerpo.lote .revcc2 td.revacc button{opacity" not in HTM
      and "pointer-events:none" not in HTM.split(".audt.hojab{")[1][:3000])


print("\nUNA PALABRA POR CONCEPTO (2-nov)")
# «¿Habiamos definido que los No Aplican se manejaban como resueltos o no? Falta afinar la
# terminologia.» Resuelta = se corrigio en aSa. Cerrada = resuelta o no aplica: ya no pide
# nada. La hoja contaba las dos juntas y las llamaba «resueltos», y la matriz no.
check("en la hoja se cuentan CERRADAS, que es lo que incluye los «no aplica»",
      "' cerradas</span>'" in JS and "' resueltos</span>'" not in JS
      # El avance de cada código, compacto en su cabecera: «3/10».
      and "><b>' + ok + '</b>/' + g.items.length + '</span></h5>'" in JS
      and ".revcuenta b{font-size:13px" in HTM
      and "' de ' + g.items.length + ' cerradas</span>'" in JS)
check("...y «resueltos» queda solo para lo que se corrigio: el boton, la matriz y el desglose",
      ">Resueltos</th>" in JS and "v.res + ' resueltos · ' + v.nap + ' no aplican'" in JS
      and "' corregidos" not in JS and "' descartados" not in JS)


print("\nCERRAR EL CODIGO: EL FINAL DEL FLUJO (2-nov)")
# «Presiono no aplica y escribo el texto... el boton guardar al final si nos servia, pero lo
# llamaria cerrar CC y que sea uno para todas las observaciones del CC. Si no esta todo
# marcado como resuelto o No aplica con su explicacion, no te debe dejar cerrar.»
check("cada codigo tiene su pie con UN boton que lo cierra entero",
      "function _pieGrupo(g) {" in JS and 'data-cerrarcc="' in JS
      and "_tablaGrupo(g) + _pieGrupo(g)" in JS and ".revccpie{display:flex" in HTM
      and "async function cerrarCC(cc, boton)" in JS and "function _grupoDe(cc)" in JS)
check("...que no deja cerrar mientras quede algo sin decidir, y dice cuanto falta",
      "'Faltan ' + e.faltan + ' ' + cosa + ' por decidir'" in JS
      and "(e.faltan || !(e.porGuardar || e.porCerrar) ? ' disabled' : '')" in JS
      and "function _marcarPendientes(" in JS and ".revcc2 tr.falta td{" in HTM)
check("...guarda de una vez las explicaciones escritas, agrupando las iguales",
      "var porNota = {};" in JS and "estado: 'aceptada', nota: nota });" in JS
      and "(porNota[n] = porNota[n] || []).push(Number(i.id));" in JS)
check("...y lleva a aSa SOLO lo marcado resuelto de ese codigo",
      "await cerrarResueltos(false, decl);" in JS
      and "async function cerrarResueltos(confirmar, soloIds)" in JS
      and "var ids = soloIds || (confirmar && _ultimoCierre) ||" in JS)
check("una explicacion a medio escribir ya cuenta como decidida: el pie de ESE codigo se entera al teclear",
      "function _notaDe(id) {" in JS and "Object.keys(pies).forEach(_repintarPie);" in JS
      and "function _repintarPie(cc) {" in JS)


print("\nLA FILA: LA FIGURA PEGADA A LA MARCA Y LA FIRMA AL FINAL (2-nov)")
# «Esa observacion que se guardo debajo de la marca deberia ir al final, en un texto
# pequeño, y debieramos pegar figura a marca para aprovechar ese espacio.»
check("la firma va al final de la fila, con la decision que explica, y no bajo la marca",
      "texto: _firmaDe(i) + _campoNota(i)" in JS and "accion: _accionesDe(i, TXT_BARRA)" in JS
      and 'class="revfirma"' in JS and ".revfirma{display:inline-block" in HTM
      and "marca: i.ref," in JS)
check("...y la marca y su figura quedan juntas: Marca · φ · Figura · Render, cada una con su ancho",
      "col(ANCHO.marca, 'Marca');" in HOJA and "col(ANCHO.figura, 'Figura', 'hojac');" in HOJA
      and "col(anchoRender(), 'Render', '', tit.render);" in HOJA)


print("\nUNA REVISION CON TODO DESCARTADO ESTA CERRADA, NO VACIA (2-nov)")
# La #14 tenia 6 hallazgos y los 6 no aplicaban: «aplican» quedaba en 0, la fila decia
# «sin hallazgos» y no salia el boton de abrir. El usuario: «no me aparece el boton de
# abrir para esta revision».
check("se puede abrir cualquier revision que haya encontrado algo, aplique o no",
      "'<td class=\"revacc\">' + (t.n" in JS
      and "(v.det ? '<button class=\"audbtn\" id=\"revAbrir\"" in JS)
check("...y «sin hallazgos» queda solo para la que no encontro nada: si todo se descarto, va al 100%",
      "(lleno || (t.n && !t.apl) ? ' listo' : '')" in JS and "(t.apl ? (t.pct || 0) : 100)" in JS)


print("\nEL ESTADO DE CADA CUBICADOR, BAJO SU NOMBRE (2-nov)")
# «Podrias ademas abajo del nombre del cubicador agregar una linea adicional que entregue
# la suma. Con esto tengo inmediatamente el estado por cubicador.»
check("el encabezado de cada cubicador lleva su suma sobre lo que esta a la vista",
      "var suma = {};" in JS and "suma[q].cerr += c.cerrados != null ? c.cerrados" in JS
      and "'<div class=\"revsum\">'" in JS and ".revmat th .revsum{" in HTM)
check("...y con filtro puesto, solo esa persona muestra su suma",
      "var t = suma[q] || { n: 0, cerr: 0 }, mio = !F || F === q;" in JS and "(mio && t.n" in JS)
# «El numero de la derecha deberia ser mas notorio; dejalos iguales.»
check("los dos numeros de «3/118» pesan igual",
      ".revmat .revde{color:#263238; font-weight:700;}" in HTM
      and ".revmat .revde{color:#b0bec5" not in HTM)


print("\nCERRADA ES LA QUE PASO POR EL CIERRE (2-nov)")
# El usuario, viendo «25/25» en una revision con barras sin cerrar: «aca hay algunos
# codigos que no estan marcados como cerrados... creo que el cerrado es el que actualiza
# estos puntos». «Declarada» es alguien diciendo «ya la corregi»: nadie lo confirmo.
check("el backend cuenta aparte lo cerrado: no aplica, lo que aSa confirmo, y lo cerrado bajo firma",
      "s.estado = 'aceptada' OR s.estado = 'corregida'" in API
      and "AND s.cierre_confirmado_el IS NOT NULL))" in API
      and '"cerrados": cerr}' in API and '"cerradas": t[7],' in API)
check("...y la fila de la lista trae su total de cerradas",
      'cerradas = sum(c.get("cerrados", 0) for c in porcub.get(f[0], {}).values())' in API
      and '"viejas": viejas, "cerradas": cerradas,' in API)
check("la celda de la matriz y la suma del encabezado usan ese dato, no la suma de resueltos",
      "var cerr = c.cerrados != null ? c.cerrados :" in JS
      and "suma[q].cerr += c.cerrados != null ? c.cerrados :" in JS)
check("en la hoja, la barra sabe si paso por el cierre: el item trae `cerrada_el`",
      '"cerrada_el": f[23].isoformat() if f[23] else None' in API
      and "s.cierre_confirmado_el\n                     FROM chequeo_senales s" in API)


print("\nLO RECIEN DESPACHADO TAMBIEN SE MIRA (3-nov)")
# Llego un correo de produccion con una barra mal cubicada —un gancho de 9 cm en φ10, que
# la regla del lado corto marca— y la revision nunca la vio: su codigo ya estaba Shipped.
# Medido: de 170 codigos Shipped nacidos desde que esto existe, 160 nunca se revisaron.
# El usuario: «¿tenemos como incluir los CC que se hayan despachado hace 2 o 3 semanas?».
check("la cola incluye lo despachado hace poco, con una ventana corta y su porque",
      'ESTADOS_RECIEN_IDO = ("Processed", "Shipped")' in API and "DIAS_RECIEN_IDO = 21" in API
      and "539" in API and "tarde para corregirlo" in API)
check("...y la consulta lo filtra por la fecha de despacho, no por el estado a secas",
      "COALESCE(p.proj_ship_date, p.ultima_mod::date, p.order_date)" in API
      and ">= CURRENT_DATE - %s))" in API
      and "list(ESTADOS_RECIEN_IDO), DIAS_RECIEN_IDO," in API)
check("el codigo que ya salio se dice en la hoja: lo que se encuentre es registro, no tarea",
      'i["cc_ido"] = i["cc_estado"] in ESTADOS_RECIEN_IDO' in API
      and "g.items[0].cc_ido" in JS and ">ya despachado</span>" in JS and ".revido{" in HTM)


print("\nLA QUE SE DIJO RESUELTA Y YA NO SALTA, SE CIERRA SOLA (3-nov)")
# El auto-cierre («ya no aparece al revisar de nuevo, luego alguien lo arreglo») miraba
# solo las `abierta`: una barra marcada Resuelto quedaba fuera, y al cerrar se le decia
# «sigue como estaba» a algo ya corregido. De 63 cerradas, 48 se cerraron a la fuerza.
check("el auto-cierre incluye lo declarado, no solo lo abierto",
      'SE_CIERRAN_SOLAS = ABIERTAS + ("declarada",)' in API
      and "list(SE_CIERRAN_SOLAS), vivas))" in API
      and "se cerraron a la fuerza" in API)
check("...y no toca lo que no aplica: eso lo decidio una persona, no aSa",
      "aceptada" not in API.split("SE_CIERRAN_SOLAS = ")[1][:160])


print("\nEL SELLO «CORREGIDO» BAJO LA FIGURA (3-nov)")
# «¿Por que el render muestra ganchos de 10 y A y G muestran 8?» La columna es la medida
# de cuando salto; el dibujo es aSa de ahora. «Tal vez ayudaria que bajo la figura diga
# corregido en verde. Asi ademas veo claramente que se resolvio.»
check("la celda de la figura sabe de que señal es, y compara el lado marcado con lo que aSa devuelve hoy",
      '" data-sen="\' + i.id + \'"' in JS and "_celda(td.dataset.cc, td.dataset.fig, td.dataset.sen)" in JS
      and "function _selloCorregido(sen, b) {" in JS and "return v > 0 && v >= esp - 0.01;" in JS)
check("...y solo lo dice cuando puede: sin lados y minimo en la señal, no inventa nada",
      "if (!(esp > 0) || !malos.length || !b.dims) return '';" in JS
      and "if (!i || _noAplica(i)) return '';" in JS)
check("la barra que ya no esta en aSa tambien se dice corregida, que es lo que mira el cierre",
      '<div class="revcorr" title="La barra ya no está en este código en aSa' in JS
      and ".revcorr{display:inline-block" in HTM and ">ya no está</span>" not in JS
      # El sello va en azul, separado del dibujo; la figura, a la izquierda y con su nombre primero.
      and "background:#e3f2fd; color:#0d47a1;" in HTM)

print("\nEL AVISO DE CIERRE ES DE UN INTENTO, NO DE LA HOJA (3-nov)")
# Quedaba arriba despues de que el usuario pasara la barra a «no aplica»: ofrecia «cerrar
# igual» algo que ya no estaba por cerrar. «Hay que arreglar lo que ocurre aqui en la pantalla.»
check("cualquier repintado de la hoja borra el aviso de cierre",
      "var avisoViejo = $('revCierreAviso');" in JS and "if (avisoViejo) avisoViejo.remove();" in JS
      and JS.index("avisoViejo.remove()") < JS.index("$('revItemsTit').textContent = (r.todas"))
check("...y el aviso va dentro del bloque del codigo que se intento cerrar, encima de su boton",
      "bloque.insertBefore(div, bloque.querySelector('.revccpie'));" in JS
      and "var unico = Object.keys(ccs).length === 1 ? Object.keys(ccs)[0] : null;" in JS)


print("\nREVISION DE ELEMENTOS: EL CODIGO CONTRA EL PISO ANTERIOR (4-nov)")
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "x" * 40); os.environ.setdefault("DATABASE_URL", "postgresql://x/x")
from armahub.chequeos_elementos import (parsear_descr, nombre_elemento, pares_de_obra,   # noqa: E402
                                        resumir, correr_elemento, REGLAS_ELEMENTO, gemelos_de, huella)
MIG162 = open(os.path.join(ROOT, "armahub", "migrations", "162_senales_por_nivel.sql"), encoding="utf-8").read()
ELEM = open(os.path.join(ROOT, "armahub", "chequeos_elementos.py"), encoding="utf-8").read()
check("las señales tienen nivel, y lo que ya existia es barra",
      "ADD COLUMN IF NOT EXISTS nivel TEXT NOT NULL DEFAULT 'barra'" in MIG162)
# El nombre del codigo, en sus dos formas, y lo que no se compara.
check("el nombre del codigo se entiende en sus dos formas: «ELEV P3 C7» y «ELEV. 3°P (CICLO 7)»",
      parsear_descr("ELEV P3 C7") == {"sector": "ELEV", "piso": 3, "ciclo": 7, "frente": 0, "rango": False}
      and parsear_descr("ELEV. 3°P (CICLO 7) FRENTE 1")["frente"] == 1
      and parsear_descr("LOSAS C 10°P (CICLO 2)") == {"sector": "LC", "piso": 10, "ciclo": 2, "frente": 0, "rango": False}
      and parsear_descr("Losa Cielo P9 C1")["sector"] == "LC" and parsear_descr("VC- P2 C3")["sector"] == "VC")
check("...los subterraneos quedan bajo cero, y lo que no es edificacion no entra",
      parsear_descr("LOSAS C-2S (CICLO 6)")["piso"] == -2
      and parsear_descr("BARRAS STOCK") is None and parsear_descr("PR - PILOTE - P3") is None)
check("...y los rangos y las partes se reconocen: existen, pero no se comparan piso a piso",
      parsear_descr("Vigas Cielo P6@P9 C1")["rango"] and parsear_descr("ELEV P2 CICLO 3_PARTE 2")["rango"]
      and not parsear_descr("ELEV P2 C3")["rango"])
check("el mismo muro un piso mas arriba se reconoce por el nombre sin el numero de piso ni el plano",
      nombre_elemento("EJE L4/16 PL-338 Rev-C") == "EJE L4/#" == nombre_elemento("EJE L4/17 PL-338 Rev-C"))
# El emparejador.
ped = [("A1", "ELEV P1 C1", 1000), ("A2", "ELEV P2 C1", 1000), ("A3", "ELEV P3 C1", 1000),
       ("A4", "ELEV P4 C1", 1000), ("A4b", "ELEV P4 C1", 1000), ("R", "ELEV P5@P8 C1", 4000), ("X", "BARRAS STOCK", 50)]
P = pares_de_obra(ped)
check("el par es piso N-1 → N, mismo sector y ciclo, desde el piso tipo; el ultimo conocido se marca",
      P["A4"]["anterior"][0] == "A3" and P["A3"]["anterior"][0] == "A2" and P["A2"]["anterior"] is None
      and P["A4"]["ultimo"] and not P["A3"]["ultimo"] and "X" not in P)
check("...dos codigos del mismo piso y ciclo son candidatos a duplicado; el rango no se compara",
      [d[0] for d in P["A4"]["duplicados"]] == ["A4b"] and P["R"]["anterior"] is None and P["R"]["duplicados"] == [])
# Las reglas, sobre resumenes armados a mano.
def _it(eid, desc, n=4, qty=10):
    return [{"ElementID": eid, "ElementDesc": desc, "TotalQty": qty}] * n
ant = resumir("A3", _it("01", "EJE A/3") + _it("02", "EJE B/3") + _it("03", "EJE C/3"), 1000, "ELEV P3 C1")
act = resumir("A4", _it("01", "EJE A/4") + _it("03", "EJE C/4"), 700, "ELEV P4 C1")
s = correr_elemento(act, parsear_descr("ELEV P4 C1"), ant, [])
check("ELEVACIONES: menos elementos que el piso anterior salta, y dice cual falta",
      [x["regla"] for x in s] == ["faltan_elementos"] and s[0]["detalle"]["diferencia"] == {"que": "Faltan", "valor": 1}
      and s[0]["detalle"]["lista"] == [{"texto": "EJE B/#", "tipo": "falta"}] and s[0]["detalle"]["grupo"] == "edificacion")
igual = resumir("A4", _it("01", "EJE A/4") + _it("02", "EJE B/4") + _it("03", "EJE C/4"), 650, "ELEV P4 C1")
check("...pero en elevaciones los kilos no mandan: mismos elementos con menos kilos no salta",
      correr_elemento(igual, parsear_descr("ELEV P4 C1"), ant, []) == [])
losa_ant = resumir("L3", _it("01", "LOSA/3"), 3000, "LC P3 C1"); losa_act = resumir("L4", _it("01", "LOSA/4"), 1200, "LC P4 C1")
s = correr_elemento(losa_act, parsear_descr("LC P4 C1"), losa_ant, [])
check("LOSAS: los kilos si mandan (lo normal es repetirse): bajo 0,5× salta aunque los elementos esten",
      [x["regla"] for x in s] == ["faltan_elementos"] and s[0]["detalle"]["diferencia"]["que"] == "Queda en")
disp = resumir("L4", _it("01", "LOSA/4", qty=100), 9900, "LC P4 C1")
s = correr_elemento(disp, parsear_descr("LC P4 C1"), losa_ant, [])
check("CODIGO DISPARADO: ×3 en kilos con los mismos elementos, y dice que elemento subio de unidades",
      [x["regla"] for x in s] == ["codigo_disparado"] and s[0]["detalle"]["grupo"] == "todas"
      and s[0]["detalle"]["lista"] == [{"texto": "LOSA/#: 400 unidades (antes 40)", "tipo": "sube"}])
dup = resumir("A4b", _it("01", "EJE A/4") + _it("03", "EJE C/4"), 700, "ELEV P4 C1")
s = correr_elemento(act, parsear_descr("ELEV P4 C1"), None, [dup])
check("CODIGO DUPLICADO: mismos elementos barra por barra y mismos kilos; con otros kilos no",
      [x["regla"] for x in s] == ["codigo_duplicado"]
      and correr_elemento(act, parsear_descr("ELEV P4 C1"), None, [resumir("A4b", dup and _it("01", "EJE A/4") + _it("03", "EJE C/4"), 900, "ELEV P4 C1")]) == [])
# EL MISMO PEDIDO CON OTRO NOMBRE (4-nov): el duplicado de arriba exige el mismo nombre; esto
# compara el contenido exacto entre codigos con los mismos kilos, se llamen como se llamen.
def _b(eid, desc, marca, diam, largo, qty):
    return {"ElementID": eid, "ElementDesc": desc, "BarMark": marca, "BarSizeDescr": diam,
            "ShpNameID": "L", "ShapeDims": "100x200", "LengthCut": largo, "TotalQty": qty}
b1 = [_b("01", "EJE A/4", "1", "10", 350, 12), _b("01", "EJE A/4", "2", "12", 480, 6), _b("02", "EJE B/4", "3", "8", 120, 40)]
g_act = resumir("SVZZ", b1, 812, "ELEV P4 C1 FRENTE 2")
g_otro = resumir("SVAA", list(reversed(b1)), 812, "ELEVACIONES PISO 4 (REPOSICION)")
g_casi = resumir("SVAB", b1[:2] + [_b("02", "EJE B/4", "3", "8", 120, 41)], 812, "OTRA COSA")
check("la huella es el contenido exacto sin importar el orden; una cantidad distinta la cambia",
      huella(b1) == huella(list(reversed(b1))) and huella(b1) != g_casi["huella"] and huella([]) == ())
s = correr_elemento(g_act, None, None, [], gemelos=[g_otro, g_casi])
check("MISMO PEDIDO: las mismas barras con otro nombre salta una vez, en grupo «todas», aunque el nombre no sea de edificacion",
      [(x["regla"], x["contra"]) for x in s] == [("mismo_pedido", "SVAA")] and s[0]["detalle"]["grupo"] == "todas"
      and s[0]["detalle"]["diferencia"] == {"que": "Idénticos", "valor": "="} and "piso" not in s[0]["detalle"])
check("...y un codigo con una sola barra distinta no es el mismo pedido",
      correr_elemento(g_act, None, None, [], gemelos=[g_casi]) == [])
ped_g = [("SVAA", "ELEVACIONES PISO 4 (REPOSICION)", 812, "2026-10-01"), ("SVZZ", "ELEV P4 C1 FRENTE 2", 812, "2026-10-20"),
         ("SVAB", "OTRA COSA", 812.004, "2026-10-05"), ("SVAC", "ELEV P4 C1 FRENTE 2", 812, "2026-11-01"),
         ("SVAD", "LC P4 C1", 2000, "2026-10-02"), ("SVAE", "VACIO", 0, "2026-10-02"),
         ("SVAF", "Elev P5 C1 Frente 2", 812, "2026-10-02"), ("SVAG", "ELEV P4 C1 FRENTE 2", 812.9, "2026-10-02")]
check("los gemelos salen por kilos iguales AL CENTAVO y OTRO nombre; el del mismo nombre es del duplicado, no de aca",
      sorted(g[0] for g in gemelos_de(ped_g, "SVZZ")) == ["SVAA", "SVAB"])
check("...la misma cosa en otro piso no es gemelo (piso tipo: las losas del 11 y del 12 son identicas), ni por nombre sin numeros ni por ciclo",
      gemelos_de([("P25", "PR - PILOTE - P25", 4545, "2026-10-02"), ("P20", "PR - PILOTE - P20", 4545, "2026-10-01")], "P25") == []
      and gemelos_de([("V7", "VIGAS C 7°P (CICLO 3)", 670, "2026-10-02"), ("V6", "Vigas Cielo P6 C3", 670, "2026-10-01")], "V7") == []
      and [g[0] for g in gemelos_de([("V7", "VIGAS C 7°P (CICLO 3)", 670, "2026-10-02"), ("V6", "Vigas Cielo P7 C4", 670, "2026-10-01")], "V7")] == ["V6"])
check("...y la señal va en el codigo mas nuevo: el viejo no ve al nuevo como gemelo",
      gemelos_de(ped_g, "SVAA") == [] and gemelos_de(ped_g, "SVAE") == [])
check("la API arma los gemelos desde la tabla de pedidos (con fecha) y corre aunque el nombre no sea de edificacion",
      "MIN(order_date)" in API and "for g_cc, g_descr, g_kg in gemelos_de(pedidos, cc)[:3]]" in API
      and 'senales = correr_elemento(act, r["p"] if r else None, anterior, duplicados, gemelos=gemelos)' in API
      and '"motivo": "no es edificación"}' not in API)
check("la pantalla dibuja el mismo pedido como el duplicado: con «=» y diciendo que el otro tiene otro nombre",
      "var igual = i.regla === 'codigo_duplicado' || i.regla === 'mismo_pedido';" in JS
      and "'el otro código, con otro nombre'" in JS)
# El enganche en la API.
check("el paso de elementos corre al final de revisar_cc con los mismos items, y si falla no tumba las barras",
      "elementos = revisar_elementos_cc(body.job, body.cc, body.revision, items, email, cubico, obra)" in API
      and 'elementos = {"senales": 0, "error": str(e)[:160]}' in API and "def _items_cacheados(cc: str, revision_id=None)" in API)
check("...guarda con nivel elemento y cierra solo lo de elemento que ya no salta",
      "VALUES (%s,'asa',%s,%s,%s,NULL,%s,%s,%s,%s,%s,'abierta',%s,'elemento')" in API
      and "WHERE id_proyecto = %s AND cc = %s AND nivel = 'elemento'" in API)
check("el tab de barras solo ve, y solo cierra, señales de barra",
      "AND nivel = 'barra' AND NOT (firma = ANY(%s))" in API
      and "LEFT JOIN chequeo_senales s ON s.revision_id = r.id AND s.nivel = %s" in API
      and API.count("AND s.nivel = %s") >= 4 and "def _nivel(n) -> str:" in API)
check("las dos pantallas piden lo suyo con ?nivel=, y las reglas de elemento tienen su endpoint con grupo y umbral",
      'def revisiones(job: str = "", nivel: str = "barra"' in API
      and 'def detalle_revision(revision_id: int, nivel: str = "barra"' in API
      and '@router.get("/chequeos/reglas-elemento")' in API
      and all(r["grupo"] in ("todas", "edificacion") and r["umbral"] for r in REGLAS_ELEMENTO))


print("\nEL TAB «REVISION DE ELEMENTOS»: LA MISMA PANTALLA, OTRA FILA (4-nov)")
check("hay un tercer sub-tab, y barras y elementos comparten el panel con un nivel en el estado",
      'id="audSubBtnEl" class="audsub" onclick="switchAudSub(\'elementos\')"' in HTM
      and "var REVS = { nivel: 'barra'," in JS and "elementos: 'audSubRevision'" in JS
      and "REVS.nivel = nivel; REVS.sel = null; REVS.detalle = null;" in JS)
check("...y todo lo que se pide al servidor lleva el nivel",
      "'/chequeos/revisiones?nivel=' + REVS.nivel" in JS
      and JS.count("'?nivel=' + REVS.nivel") == 3
      and "REVS.nivel === 'elemento' ? '/chequeos/reglas-elemento' : '/chequeos/reglas'" in JS)
check("la fila de la hoja es la tarjeta estandar: regla y grupo, los dos codigos, encontrado ← esperado, diferencia, lista, estado",
      "function _filaElemento(i) {" in JS and "if (REVS.nivel === 'elemento') return _tablaElementos(g);" in JS
      and '<span class="elregla ' in JS and "'<span class=\"flecha\">' + (igual ? '=' : '←') + '</span>'" in JS
      and "posible último piso: suele ser distinto" in JS and ".elh{display:grid; grid-template-columns:150px 1fr 330px" in HTM)
check("...y es una fila de la misma tabla, con los mismos data-*: el lote, el espejo, el pie y Cerrar codigo sirven igual",
      "'<tr class=\"elfila' + (hecho ? ' hecho' : nap ? ' nap' : '') + '\" data-fila=\"' + i.id + '\">'" in JS
      and "_accionesDe(i, TXT_ELEMENTO)" in JS.split("function _filaElemento(i) {")[1][:4000]
      and "data-resuelto=\"' + i.id + '\"" in JS.split("function _accionesDe(i, t) {")[1][:1200]
      and "data-nota=\"' + i.id + '\"" in JS.split("function _campoNota(i) {")[1][:400]
      and "_accionesDe(i, TXT_ELEMENTO) + _campoNota(i)" in JS)
check("«Que se revisa» va en dos grupos cuando se miran elementos, y las figuras no se ofrecen",
      "el.className = 'elcrit';" in JS and "'Todas las obras' : 'Sólo edificación'" in JS
      and "if (REVS.nivel === 'elemento') return [];" in JS and "&& REVS.nivel === 'barra' ? '<button class=\"audmini\" data-figs=" in JS
      and "var cosa = REVS.nivel === 'elemento' ? 'hallazgo(s)' : 'barra(s)';" in JS
      and 'def _items_cacheados(cc: str, revision_id=None) -> list:' in API)

print("\nEL CIERRE LEE TODO O DICE QUE NO PUDO (4-nov)")
check("un codigo que aSa no deja leer se cuenta como error y no tumba la revision ni el cierre (_items_de ya lanza 502)",
      "except (AsaError, HTTPException) as e:" in API and 'porque = str(getattr(e, "detail", None) or e)' in API)
check("el cierre comprueba SIN tope, y lo que no se pudo leer no se confirma como cerrado",
      "comprobar_lote(ComprobarLoteBody(ids=ids, tope_ccs=0), user)" in API
      and 'tope = len(ccs) if body.tope_ccs == 0 else max(1, min(int(body.tope_ccs), 30))' in API
      and 'and s[2] not in no_leidos]' in API)

print("\n«NO APLICA» CIERRA PERO NO ES RESUELTO, TAMBIEN EN EL DETALLE (4-nov)")
check("el detalle no suma la aceptada a resueltas (la tarjeta «cerrado» la contaba dos veces), y el pct por cubicador va sobre los que aplican",
      'c["no_aplica"] += 1; c["resueltas"] += 1' not in API
      and 'aplican = c["n"] - c["no_aplica"]' in API)

print("\nLAS RUTAS ESTAN EN LAS FUNCIONES QUE CORRESPONDEN (4-nov)")
# El 4-nov la pantalla decia «n: Field required»: el decorador de /chequeos/revisiones habia
# quedado pegado a la auxiliar _nivel(n), asi que FastAPI servia la auxiliar y exigia su
# parametro. Ninguna ruta puede caer sobre una funcion privada.
from armahub.chequeos_api import router as _ROUTER  # noqa: E402
_rutas = {r.path: r.endpoint.__name__ for r in _ROUTER.routes}
check("ninguna ruta de chequeos apunta a una funcion privada",
      not [p for p, f in _rutas.items() if f.startswith("_")])
check("/chequeos/revisiones la sirve revisiones(), que no exige n",
      [f for p, f in _rutas.items() if p.endswith("/chequeos/revisiones")] == ["revisiones"])

print("\nLAS CONSULTAS SE EJECUTAN: MARCADORES = PARAMETROS (4-nov)")
# El 4-nov la pantalla decia «Error interno del servidor»: la consulta de /chequeos/revisiones
# tenia tres %s y recibia dos parametros. Los tests de arriba miran el TEXTO del archivo y eso
# no lo atrapa. Esto EJECUTA cada endpoint de lectura contra un cursor falso que cuenta los
# marcadores de cada consulta contra los parametros que le pasan, y devuelve filas vacias.
import contextlib  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from armahub import chequeos_api as _A  # noqa: E402


class _MarcadorError(AssertionError):
    pass


def _columnas(sql):
    """Cuantas columnas pide el ultimo SELECT de arriba (comas de primer nivel entre SELECT
    y FROM), para que fetchone devuelva una fila del largo que el codigo va a desempacar."""
    u = sql.upper()
    i = u.find("SELECT")
    if i < 0:
        return 1
    j = u.find(" FROM", i)
    cuerpo = u[i + 6:j if j > 0 else None]
    prof, n = 0, 1
    for ch in cuerpo:
        if ch == "(":
            prof += 1
        elif ch == ")":
            prof -= 1
        elif prof == 0 and ch == ",":
            n += 1
    return n


class _CursorContable:
    def __init__(self, bitacora):
        self.b = bitacora
        self.ultima = ""

    def execute(self, sql, params=None):
        esperados = sql.count("%s") - 2 * sql.count("%%s")
        dados = 0 if params is None else len(params)
        self.b.append((sql.strip().split("\n")[0][:60], esperados, dados))
        if esperados != dados:
            raise _MarcadorError("%d marcadores, %d parametros: %s" % (esperados, dados, sql.strip()[:90]))
        self.ultima = sql

    def fetchone(self):
        return tuple([None] * _columnas(self.ultima))

    def fetchall(self):
        return []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _ConnContable:
    def __init__(self, bitacora):
        self.b = bitacora

    def cursor(self):
        return _CursorContable(self.b)

    def commit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


_bit = []
_u = {"role": "admin", "rol": "admin", "email": "test@x", "sub": "test@x"}
_llamadas = [
    ("revisiones barra", lambda: _A.revisiones(job="", nivel="barra", user=_u)),
    ("revisiones elemento, por obra", lambda: _A.revisiones(job="2010136", nivel="elemento", user=_u)),
    ("detalle_revision", lambda: _A.detalle_revision(revision_id=5, nivel="barra", user=_u)),
    ("detalle_revision todas", lambda: _A.detalle_revision(revision_id=0, nivel="elemento", user=_u)),
    ("senales", lambda: _A.senales(job="x", estado="abierta", regla="r", cubico="c", user=_u)),
    ("codigos", lambda: _A.codigos(job="x", user=_u)),
    ("reporte", lambda: _A.reporte(user=_u)),
]
_malas = []
_real = _A.get_conn
_A.get_conn = lambda *a, **k: _ConnContable(_bit)
try:
    for nombre, fn in _llamadas:
        try:
            fn()
        except _MarcadorError as e:
            _malas.append("%s: %s" % (nombre, e))
        except HTTPException:
            pass            # 404 por fila vacia: la consulta ya corrio
        except Exception:   # noqa: BLE001 — una fila de None rompe mas adelante; lo que importa es lo ejecutado
            pass
finally:
    _A.get_conn = _real
check("cada consulta de los endpoints de lectura recibe tantos parametros como marcadores tiene (%d consultas ejecutadas)" % len(_bit),
      not _malas and len(_bit) >= 8)
for m in _malas:
    print("      " + m)

# ── 7. Las patas del suple (10-nov) ─────────────────────────────────────────────────
# EL CASO: SVN7 (EMM La Quebrada, «31.5 Corona suples»): 8mmA34, 8mmA36 y 12mmA8 son
# suples 105A con D = 130 contra B de 200, 230 y 170. La revisión de la noche anterior
# los miró (87 barras, 0 señales) y no dijo nada, porque NO había regla: la de los lados
# opuestos deja fuera la 105A a propósito —sus pies A y E son desiguales— y con los pies
# se iban las patas. El usuario: «esa figura 105A debiera tener una regla que identifique
# si es que B es distinto de D, ya que lo usual es que el espesor de la losa en que va
# esa figura sea el mismo». Tolerancia: «1 cm, que es como se cubica (no al milímetro)».
print("\n7. Las patas del suple 105A tienen que medir lo mismo (10-nov)")


def suple(a, b, c, d, e, figura="105A", diam=12.0):
    return barra([("A", a, "STD", None), ("B", b, "STD", -90), ("C", c, "STD", -90),
                  ("D", d, "STD", -90), ("E", e, "STD", -90)], diam=diam, figura=figura, ref="s1")


check("un suple con las patas iguales no dice nada", C.r_patas_suple(suple(130, 170, 2280, 170, 640), []) == [])
m = C.r_patas_suple(suple(130, 170, 2280, 130, 640), [])
check("12mmA8 de SVN7: B = 170 contra D = 130 SÍ se marca, y el texto dice cuánto",
      len(m) == 1 and m[0]["lados"] == ["B", "D"] and "170" in m[0]["texto"] and "130" in m[0]["texto"]
      and "40 de diferencia" in m[0]["texto"] and "un solo espesor" in m[0]["texto"])
check("...con valor y esperado, para poder comprobarlo después", m[0]["valor"] == 170 and m[0]["esperado"] == 130)
check("los pies A y E pueden ser distintos: no se comparan (8mmA37-like: 740 y 740 vs 730 y 600 da igual)",
      C.r_patas_suple(suple(730, 200, 4050, 200, 600), []) == [])
check("la tolerancia es UN CENTÍMETRO, que es como se cubica: 17 contra 16 pasa",
      C.TOLERANCIA_PATAS_SUPLE == 10.0 and C.r_patas_suple(suple(130, 170, 2280, 160, 640), []) == []
      and "que es como se cubica" in SRC)
check("...y 17 contra 15 no", len(C.r_patas_suple(suple(130, 170, 2280, 150, 640), [])) == 1)
check("es una regla POR FIGURA: la misma barra con otro código no entra",
      C.r_patas_suple(suple(130, 170, 2280, 130, 640, figura="103A"), []) == [] and C.FIGURAS_SUPLE == ("105A",))
check("...y queda escrito que es a propósito, con las palabras del usuario",
      "ir definiendo reglas para figuras específicas" in SRC)
check("sin pata B o D no hay nada que comparar",
      C.r_patas_suple(barra([("A", 100, "STD", None), ("B", 900, "STD", 90)], figura="105A"), []) == [])
# LA BARRA REAL, con el LegAngle tal cual lo manda aSa (sin ShapeDims: los lados salen del XML).
LA_12MMA8 = ("<la><st>B</st><bc>3</bc><mbr><X>2280</X><Y>170</Y><Z>0</Z></mbr><lt>3350</lt><v>4.0</v>"
             "<cp><t>STD</t><l>130</l><n>1</n><ln>A</ln></cp><cp><t>STD</t><a>-90</a><l>170</l><n>2</n><ln>B</ln></cp>"
             "<cp><t>STD</t><a>-90</a><l>2280</l><n>3</n><ln>C</ln></cp><cp><t>STD</t><a>-90</a><l>130</l><n>4</n><ln>D</ln></cp>"
             "<cp><t>STD</t><a>-90</a><l>640</l><n>5</n><ln>E</ln></cp></la>")
breal = C.normalizar_asa({"LegAngle": LA_12MMA8, "BarSizeDescr": "12mm", "ShpNameID": "105A", "PinDiam": 72,
                          "CtrlCode": "SVN7", "ElementID": "SUPLES", "BarMark": "12mmA8", "TotalQty": 30}, "12mmA8")
sreal = C.correr([breal])
check("la barra real de SVN7 pasa por el motor entero y sale con la señal",
      [x["regla"] for x in sreal] == ["patas_suple"] and sreal[0]["marca"] == "12mmA8"
      and sreal[0]["detalle"]["lados"] == ["B", "D"])
check("...y los lados opuestos siguen sin meterse con la 105A", C.r_lados_opuestos(breal, []) == [])
check("está en REGLAS con su nombre corto",
      any(r["codigo"] == "patas_suple" and r["corto"] == "105A: B ≠ D" for r in C.REGLAS))

# ── 8. Cada regla dice dónde aplica y, si mira la figura, se dibuja (10-nov) ─────────
# El usuario: «me gustaría que en el menú de reglas podamos agregar dibujos renderizados
# para que quede claro al usuario las cosas con las que saltan las reglas … el render con
# algún apoyo gráfico y al lado la explicación de la regla, en una tercera columna … las
# barras excluidas». Y: «el renderizado, pero solo si aplica».
print("\n8. El menú de reglas: dibujo, explicación y alcance")
check("cada regla declara su alcance", all((r.get("alcance") or "").strip() for r in C.REGLAS))
check("...y dice si tiene ejemplo para dibujar", all("ejemplo" in r for r in C.REGLAS))
por = {r["codigo"]: r for r in C.REGLAS}
# El cabezal también se dibuja (el usuario, 10-nov): «igual puedes renderizar una 101A y le
# pones un texto abajo». Y la leyenda de TODAS va bajo el dibujo, no al final del texto.
e0 = C.ejemplo_dibujado(por["cabezal_delgado"])
check("el cabezal se dibuja como una 101A recta, con lo que salta en su leyenda; el alcance sigue diciendo que mira el diámetro",
      bool(e0) and e0["eje"]["ok"] and [t["lado"] for t in e0["eje"]["tramos"]] == ["A"] and e0["eje"]["alto"] == 0
      and "φ8 o φ10" in e0["leyenda"] and "No mira la figura" in por["cabezal_delgado"]["alcance"])
# 11-nov, el usuario: «pones medidas arbitrarias mayores a 250, eso confunde, mejor poner el
# nombre de la dimensión». Ninguna leyenda lleva una cifra del ejemplo: nombra la dimensión
# y el límite de la regla (250 cm, 10 φ, 1 cm).
import re as _re
_ley = {r["codigo"]: (r.get("ejemplo") or {}).get("leyenda", "") for r in C.REGLAS}
check("las leyendas nombran la dimensión y el límite, sin cifras del ejemplo",
      _ley["no_cabe_camion"] == "h > 250 cm" and _ley["no_cabe_camion_radio"] == "h > 250 cm"
      and _ley["no_cabe_camion_3"] == "A > 250 cm" and _ley["lado_corto"] == "C < 10 φ"
      and _ley["patas_suple"] == "B ≠ D por más de 1 cm"
      and all(set(_re.findall(r"\d+", t)) <= {"250", "10", "1", "8"} for t in _ley.values()))
check("la leyenda va BAJO el dibujo, dentro de la celda del dibujo",
      "_svgRegla(ej) +\n          (ej && ej.leyenda ? '<span class=\"umb\">'" in JS and ".regfig .umb{" in HTM
      and ".regtxt .umb{" not in HTM)
e = C.ejemplo_dibujado(por["patas_suple"])
check("el ejemplo del suple se traza con el motor de las barras reales: cinco rectos, B y D marcados",
      bool(e) and e["eje"]["ok"] and [t["lado"] for t in e["eje"]["tramos"]] == ["A", "B", "C", "D", "E"]
      and e["marcar"] == ["B", "D"] and e["eje"]["ancho"] == 600 and e["eje"]["alto"] == 170)
e2 = C.ejemplo_dibujado(por["lados_opuestos"])
check("el del estribo va bien tipeado y CIERRA, con sus dos ganchos en arco y el par C-E marcado",
      bool(e2) and [t["tipo"] for t in e2["eje"]["tramos"]].count("arco") == 2 and e2["marcar"] == ["C", "E"]
      and e2["eje"]["cerrada"] is True)
e3 = C.ejemplo_dibujado(por["lado_corto"])
check("el del lado corto marca el lado que no llega a 10 φ", bool(e3) and e3["marcar"] == ["C"] and e3["eje"]["ok"])
check("el endpoint los manda con el alcance",
      '"alcance": r.get("alcance") or "", "ejemplo": ejemplo_dibujado(r)' in API)
check("la pantalla los pone en tres columnas: dibujo, regla, dónde aplica",
      "function _svgRegla(" in JS and '<div class="regfig">' in JS
      and '<div class="regalc"><i>Dónde aplica</i>' in JS and ".revreglasc li.regl{display:grid" in HTM)
check("...y el motor sabe marcar los lados que la regla compara", "opts.resaltar_seg" in DIS and "resaltar_seg:" in JS)
check("la regla que no mira la figura lo dice en vez de dejar el hueco", "no mira la figura" in JS)

# ── 9. No cabe en el camión (10-nov) ────────────────────────────────────────────────
# El usuario: «hay figuras que por tamaño se salen del camión, el máximo permitido es de
# 250 cm … si lo vemos como un triángulo, la altura no sobrepase esa medida». Sólo dos lados
# («las reglas para figuras de más lados las iremos implementando de a poco»), por geometría:
# la 102A/B/C y las de aSa que quedan así con sus lados opcionales vacíos (el corchete «2»).
print("\n9. Una barra de dos lados que no cabe en el camión")


def ele(a, b, giro=90.0, figura="102A", tipo_a="STD"):
    return barra([("A", a, tipo_a, None), ("B", b, "STD", giro)], diam=12.0, figura=figura, ref="L1")


m = C.r_no_cabe_camion(ele(3500, 4000), [])
check("una L de 350 × 400 ocupa 263 cm acostada en diagonal: salta, y el texto lo dice en cm",
      len(m) == 1 and m[0]["valor"] == 2634 and m[0]["esperado"] == 2500
      and "263 cm de ancho" in m[0]["texto"] and "lleva 250" in m[0]["texto"] and m[0]["lados"] == ["A", "B"])
check("una L de 300 × 300 ocupa 212: cabe", C.r_no_cabe_camion(ele(3000, 3000), []) == [])
check("la altura es menor que el lado corto: 250 × 1200 no salta (245), 260 × 1200 sí (254)",
      C.r_no_cabe_camion(ele(2500, 12000), []) == [] and len(C.r_no_cabe_camion(ele(2600, 12000), [])) == 1)
check("la barra real más ancha que se midió (SVOA 8mmA159, L 160 × 402) ocupa 149 cm y no salta",
      round(C.altura_en_camion(ele(1600, 4020)["lados"])) == 1487 and C.r_no_cabe_camion(ele(1600, 4020), []) == [])
check("el ángulo es el GIRO de aSa: la 102C (135, punta aguda) y la 102B (45, abierta) usan la misma fórmula",
      abs(C.altura_en_camion(ele(4000, 4000, 135.0, "102C")["lados"]) - 3696) < 2
      and abs(C.altura_en_camion(ele(4000, 4000, 45.0, "102B")["lados"]) - 1531) < 2)
check("va por GEOMETRÍA: el corchete «2» con el gancho G vacío es una L y entra igual",
      len(C.r_no_cabe_camion(ele(3500, 4000, figura="2", tipo_a="H9"), [])) == 1)
check("una figura de tres lados no entra en ésta (tendrá su propia regla)",
      C.r_no_cabe_camion(barra([("A", 3000, "STD", None), ("B", 4000, "STD", 90), ("C", 3000, "STD", 90)],
                               figura="103A"), []) == [])
# SIN ÁNGULO EN EL XML (SU25 12mmA129, SU4K 8mmA56, SVKZ 16mmA11): el giro sale de los
# vectores de ShapeDims, como al dibujarla. Si no, una L grande sin ángulo pasaría callada.
sin_ang = [{"nombre": "A", "largo": 3500.0, "tipo": "H9", "arco": False, "angulo": None, "vx": 0.0, "vy": 120.0},
           {"nombre": "B", "largo": 4000.0, "tipo": "B", "arco": False, "angulo": None, "vx": 377.0, "vy": 0.0}]
check("sin ángulo en el XML el giro sale de los vectores: la misma L de 350 × 400 da 263",
      round(C.altura_en_camion(sin_ang)) == 2634
      and C.altura_en_camion([dict(l, vx=0.0, vy=0.0) for l in sin_ang]) is None)
check("un lado curvo tampoco", C.altura_en_camion([{"nombre": "A", "largo": 3000.0, "arco": False, "angulo": None},
                                                   {"nombre": "B", "largo": 4000.0, "arco": True, "angulo": 0.0}]) is None)
r_cam = {r["codigo"]: r for r in C.REGLAS}["no_cabe_camion"]
check("está en REGLAS con su nombre corto, su alcance y la tolerancia de 250 cm",
      r_cam["corto"] == "Camión: 2 lados" and "102C" in r_cam["alcance"] and "corchete 2 sin G" in r_cam["alcance"]
      and C.ANCHO_CAMION == 2500.0)
e = C.ejemplo_dibujado(r_cam)
check("su dibujo es la L con la diagonal (cota), la altura (flecha) hasta ella y su «h» (11-nov)",
      bool(e) and [g["tipo"] for g in e["guias"]] == ["cota", "diametro", "letra", "letra"]
      and [g.get("texto") for g in e["guias"][2:]] == ["h", "d"]
      and e["leyenda"] == "h > 250 cm" and "g.texto != null ? { tipo: g.tipo, texto: g.texto" in JS
      and abs(math.hypot(e["guias"][1]["x2"] - e["guias"][1]["x1"], e["guias"][1]["y2"] - e["guias"][1]["y1"]) - 2634) < 2
      and "etiquetas: (ej.guias || [])" in JS)

# ── 10. No cabe en el camión: tres lados a 90° (11-nov) ─────────────────────────────
# El usuario: «para todas las figuras de 3 lados con ángulos de 90, la pata no puede ser
# mayor a 250». La pata es la que queda ATRAVESADA con el lado más largo a lo largo: tomada
# por posición (A y C) saltaba en 227 horquillas que caben con las patas a lo largo.
print("\n10. Una figura de tres lados a 90° que no cabe en el camión")


def tres(a, b, c, g1=-90.0, g2=-90.0, figura="103A"):
    return barra([("A", a, "STD", None), ("B", b, "STD", g1), ("C", c, "STD", g2)], diam=12.0,
                 figura=figura, ref="U1")


m = C.r_no_cabe_camion_3(tres(3000, 6000, 1200), [])
check("una U de cuerpo 600 con una pata de 300 no cabe: marca esa pata y dice el ancho",
      len(m) == 1 and m[0]["lados"] == ["A"] and m[0]["valor"] == 3000
      and "con B (600 cm) a lo largo del camión, A ocupa 300 cm de ancho" in m[0]["texto"])
check("con las dos patas de 250 justas cabe (la regla es «mayor a 250»)", C.r_no_cabe_camion_3(tres(2500, 6000, 2500), []) == [])
check("la horquilla real SVNT 8mmA1 (103A, 84 × 14 × 922) va con las patas a lo largo y ocupa 14: cabe",
      C.r_no_cabe_camion_3(tres(840, 140, 9220), []) == []
      and round(C.ancho_tres_lados(tres(840, 140, 9220)["lados"])["ancho"]) == 140
      and C.ancho_tres_lados(tres(840, 140, 9220)["lados"])["atraviesan"] == ["B"])
mz = C.r_no_cabe_camion_3(tres(2000, 6000, 2000, -90.0, 90.0, "103G"), [])
check("en una Z las patas salen a lados opuestos y se suman: dos de 200 ocupan 400",
      len(mz) == 1 and mz[0]["valor"] == 4000 and mz[0]["lados"] == ["A", "C"])
check("aSa manda 89,998: entra igual; con dobleces de 135° no es de esta familia",
      len(C.r_no_cabe_camion_3(tres(3000, 6000, 1200, -89.998, -89.998), [])) == 1
      and C.ancho_tres_lados(tres(3000, 6000, 1200, -135.0, -135.0)["lados"]) is None)
check("dos lados o cuatro no son de esta regla",
      C.ancho_tres_lados(ele(3500, 4000)["lados"]) is None
      and C.ancho_tres_lados(barra([("A", 3000, "STD", None), ("B", 6000, "STD", 90), ("C", 3000, "STD", 90),
                                    ("D", 500, "STD", 90)])["lados"]) is None)
r3 = {r["codigo"]: r for r in C.REGLAS}["no_cabe_camion_3"]
e3 = C.ejemplo_dibujado(r3)
check("es una regla aparte, con su nombre corto, su alcance y su dibujo (la U con la pata marcada)",
      r3["corto"] == "Camión: 3 lados" and "si es A o C, se mide B" in r3["alcance"] and "Z" in r3["alcance"]
      and bool(e3) and e3["marcar"] == ["A"] and [t["lado"] for t in e3["eje"]["tramos"]] == ["A", "B", "C"])

# ── 11. No cabe en el camión: los radios (11-nov) ───────────────────────────────────
# El usuario: «cuando los radios tienen una altura o cuerda de más de 250 ocurre lo mismo.
# Debieran ser reglas diferentes». Se mide la ALTURA del arco: la cuerda va a lo largo.
print("\n11. Un radio que no cabe en el camión")


def curva(largo, R, barrido=None, figura="9"):
    b = barra([("B", largo, "RB", None)], diam=16.0, figura=figura, ref="R1")
    b["lados"][0]["radio"], b["lados"][0]["barrido"] = R, barrido
    return b


m = C.r_no_cabe_camion_radio(curva(8796, 2800), [])
check("medio círculo de radio 280: la altura es 280 y no cabe",
      len(m) == 1 and m[0]["valor"] == 2800 and m[0]["lados"] == ["B"] and "280 cm de altura" in m[0]["texto"])
check("el ARC real de SLPB 16mmA41 (medio círculo de 474 de cuerda) tiene 237 de altura: cabe",
      C.r_no_cabe_camion_radio(curva(7450, 2371, 180.0, "ARC"), []) == [])
check("un radio 9 de 12 m (SVAZ 16mmA2, R 26.150, 26°) tiene 69 de altura: cabe, aunque su cuerda sea de 11,9 m",
      round(C.altura_arco(curva(12000, 26150, 26.3)["lados"][0])) in (685, 686) and C.r_no_cabe_camion_radio(curva(12000, 26150, 26.3), []) == [])
check("pasado el medio círculo la altura supera al radio: 300° de radio 200 da 373 y no cabe",
      round(C.altura_arco(curva(10472, 2000, 300.0)["lados"][0])) == 3732
      and len(C.r_no_cabe_camion_radio(curva(10472, 2000, 300.0), [])) == 1)
check("un lado recto no es un radio", C.altura_arco({"nombre": "A", "largo": 3000.0, "arco": False}) is None)
rr = {r["codigo"]: r for r in C.REGLAS}["no_cabe_camion_radio"]
er = C.ejemplo_dibujado(rr)
check("es otra regla, con su alcance (la cuerda no se compara) y su dibujo: el arco, la cuerda y la h",
      rr["corto"] == "Camión: radio" and "c no se compara" in rr["alcance"] and "h es la cota H y c la cota O" in rr["alcance"]
      and bool(er) and [t["tipo"] for t in er["eje"]["tramos"]].count("arco") >= 1
      and [g.get("texto") for g in er["guias"] if g["tipo"] == "letra"] == ["h", "c"]
      and abs(math.hypot(er["guias"][1]["x2"] - er["guias"][1]["x1"], er["guias"][1]["y2"] - er["guias"][1]["y1"]) - 2800) < 30)
check("las tres reglas del camión son reglas distintas y se distinguen en el reporte",
      [r["corto"] for r in C.REGLAS if r["codigo"].startswith("no_cabe_camion")]
      == ["Camión: 2 lados", "Camión: 3 lados", "Camión: radio"])

# ── 12. Sin términos coloquiales (11-nov) ────────────────────────────────────────────
# El usuario: «no uses términos coloquiales como pata... con la letra basta si es que está
# renderizada». Ningún texto que se ve en el menú dice pata, pie, horquilla ni cuerpo.
print("\n12. Los textos de las reglas nombran los lados por su letra")
_vis = " ".join(" ".join([r["nombre"], r["corto"], r["porque"], r.get("alcance") or "",
                          (r.get("ejemplo") or {}).get("leyenda", "")]) for r in C.REGLAS).lower()
check("ningún texto visible usa pata, pie, horquilla ni cuerpo",
      not _re.search(r"\b(pata|patas|pie|pies|horquilla|horquillas|cuerpo)\b", _vis))
s105 = C.r_patas_suple(suple(130, 170, 2280, 130, 640), [])
check("...tampoco el texto de la señal del suple", "pata" not in s105[0]["texto"] and s105[0]["texto"].startswith("B y D"))

# ── 13. Las alturas de los soportes de losa: su propia regla (11-nov) ─────────────────
# Producción (25-ago-2025): las patas de losa se doblan con bulón en un segundo proceso; φ8
# desde 6 cm, φ10 desde 8 cm, φ12 desde 10 cm. Sólo las alturas (C y E en la 26, B y D en la
# 305A), sólo esos φ. Nació como excepción dentro del lado corto; el usuario: «una excepción
# indicada? o una regla de que aplica respecto de esa figura? me suena lo segundo».
print("\n13. Las alturas de los soportes de losa tienen su propia regla")


def silla26(c, e, diam=8.0, b=300, d=300, f=300):
    return barra([("B", b, "STD", None), ("C", c, "STD", 90), ("D", d, "STD", -90), ("E", e, "STD", -90),
                  ("F", f, "STD", 90)], diam=diam, figura="26", ref="S26")


def silla305(b, d, diam=10.0):
    return barra([("E", 500, "STD", None), ("D", d, "STD", 90), ("C", 500, "STD", -90), ("B", b, "STD", -90),
                  ("A", 500, "STD", 90)], diam=diam, figura="305A", ref="S305")


R = C.r_altura_soporte_losa
check("una 26 en φ8 con alturas de 7 cm no salta en ninguna de las dos reglas",
      R(silla26(70, 70), []) == [] and C.r_lado_corto(silla26(70, 70), []) == [])
check("...ni con 6 cm justos, que es el mínimo de Producción", R(silla26(60, 60), []) == [])
m = R(silla26(50, 70), [])
check("con 5 cm salta la regla del soporte, no la del lado corto, y dice el mínimo (60)",
      len(m) == 1 and m[0]["lados"] == ["C"] and m[0]["esperado"] == 60 and m[0]["valor"] == 50
      and m[0]["texto"] == "la altura C (50) mide menos que el mínimo de un soporte de losa en φ8, 60 mm"
      and C.r_lado_corto(silla26(50, 70), []) == [])
m = R(silla26(50, 40), [])
check("las dos alturas cortas son un solo hallazgo",
      len(m) == 1 and m[0]["lados"] == ["C", "E"] and m[0]["valor"] == 40
      and m[0]["texto"].startswith("las alturas C (50) y E (40) miden menos"))
check("una 305A en φ10 con alturas de 9 cm no salta; en φ12 rige 10 cm",
      R(silla305(90, 90), []) == [] and len(R(silla305(90, 90, 12.0), [])) == 1)
check("los OTROS lados de la silla siguen en el lado corto: un apoyo B de 7 cm en φ8 salta como siempre",
      len(C.r_lado_corto(silla26(70, 70, b=70), [])) == 1 and R(silla26(70, 70, b=70), []) == []
      and "mínimo de fabricación es 80" in C.r_lado_corto(silla26(70, 70, b=70), [])[0]["texto"])
check("y los otros diámetros también: una altura de 15 cm en φ16 es del lado corto (mínimo 16)",
      len(C.r_lado_corto(silla305(150, 150, 16.0), [])) == 1 and R(silla305(150, 150, 16.0), []) == [])
check("es por figura: el mismo lado de 7 cm en una 103A φ8 es del lado corto",
      len(C.r_lado_corto(barra([("A", 70, "STD", None), ("B", 900, "STD", 90), ("C", 70, "STD", 90)], diam=8.0,
                               figura="103A"), [])) == 1)
check("la tabla es la del correo de Producción",
      C.ALTURA_MINIMA_SOPORTE_LOSA == {8.0: 60.0, 10.0: 80.0, 12.0: 100.0}
      and C.ALTURAS_SOPORTE_LOSA == {"26": ("C", "E"), "305A": ("B", "D")})
rs = {r["codigo"]: r for r in C.REGLAS}["altura_soporte_losa"]
check("es una regla del menú, con su nombre corto, su alcance y la fuente",
      rs["corto"] == "Soporte losa: altura" and "26 (alturas C y E)" in rs["alcance"]
      and "305A (alturas B y D)" in rs["alcance"] and "25-ago-2025" in rs["alcance"]
      and "propia regla" in {r["codigo"]: r for r in C.REGLAS}["lado_corto"]["alcance"])
check("ya no hay «excepciones» dentro de una regla: ni en la regla, ni en el menú",
      all("excepciones" not in r for r in C.REGLAS) and "excepciones" not in API
      and "regexc" not in JS and "regexc" not in HTM)
es = C.ejemplo_dibujado(rs)
P = es["eje"]["puntos"]
check("se dibuja en isométrica como el catálogo: B y D verticales, A y C inclinados en sentidos opuestos",
      es["eje"]["tridimensional"] and len(P) == 6 and P[1][0] == P[2][0] and P[3][0] == P[4][0]
      and P[2][1] > P[1][1] and P[4][1] < P[3][1]
      and (P[1][1] - P[0][1]) < 0 < (P[3][1] - P[2][1]))
let = [g for g in es["guias"] if g["tipo"] == "letra"]
check("las cinco letras van a mano y por fuera; la pantalla apaga las automáticas",
      es["letras_a_mano"] and [g["texto"] for g in let] == ["A", "B", "C", "D", "E"]
      and "var auto = completo && !ej.letras_a_mano;" in JS and es["marcar"] == ["B", "D"])
check("...cada una del lado de afuera de su lado (B a la izquierda, C arriba, D a la derecha)",
      let[1]["x"] < P[1][0] and let[2]["y"] > (P[2][1] + P[3][1]) / 2 and let[3]["x"] > P[3][0])
check("el texto de la regla tampoco usa términos coloquiales",
      not _re.search(r"\b(pata|patas|pie|pies|horquilla|cuerpo)\b",
                     " ".join([rs["nombre"], rs["corto"], rs["porque"], rs["alcance"],
                               rs["ejemplo"]["leyenda"]]).lower()))

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
