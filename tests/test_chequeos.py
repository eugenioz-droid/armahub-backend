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
      and "UNA SOLA FUNCIÓN PARA LOS DOS BOTONES" in JS)
check("...y se puede detener sin perder lo ya revisado",
      "REV.parar" in JS and 'id="revParar"' in HTM)
check("aceptar una señal EXIGE el motivo: sin él, nadie puede revisarlo después",
      "una señal aceptada sin motivo" in API and "Hace falta el motivo." in JS)
check("se puede aceptar el PATRÓN completo, no de a una",
      "firma_patron = %s" in API and "data-pat=" in JS)
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
      and "async function correrPendientes(" in JS and "function recorrer(" in JS)
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
check("la pantalla muestra, por código, cuándo se revisó y si cambió desde entonces",
      "function pintarCodigos(" in JS and "cambió en aSa" in JS and "sin revisar" in JS)
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
check("la pantalla lo muestra como chips, no escondido",
      "var MESES = [[3," in JS and 'id="revMeses"' in HTM and "function pintarMeses(" in JS)

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
check("...o sea que no hay una lista de roles propia que se desincronice",
      "ROLES_" not in API)

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
check("la bandeja existe en la pantalla, con lote y filtros",
      'id="revBandeja"' in HTM and 'id="revLote"' in HTM and 'id="revBanUltima"' in HTM
      and "function cargarBandeja(" in JS and "function resolverLote(" in JS)
check("al terminar una corrida, la bandeja se abre en lo de ESA revisión y dice qué hacer",
      "resuélvelas en la bandeja de abajo" in JS and "BAN.ultima = true" in JS)
check("una señal resuelta desde cualquier lado refresca la bandeja", JS.count("await cargarBandeja()") >= 3)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
