# -*- coding: utf-8 -*-
"""PROTOCOLO DE CUBICACIÓN (21-nov, programa §8.13 filas 8.1 y 8.2).

Sin base de datos: (1) las reglas puras de armahub/protocolo.py; (2) la carga inicial, que es
el Excel «Protocolo 2025» pasado a datos; (3) las rutas enteras contra una base simulada que
lee cada sentencia (columnas, marcadores y parámetros en su orden) y guarda en memoria;
(4) el cableado de la caluga Obras.

Correr con: python tests/test_protocolo.py
"""
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/x")
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")
if hasattr(sys.stdout, "reconfigure"):   # la consola de Windows no sabe escribir «→»
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from fastapi import HTTPException  # noqa: E402

from armahub import protocolo as P  # noqa: E402

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:200]) if not cond else ""))
    if not cond:
        fallos += 1


def codigo(f, *a, **k):
    """El código HTTP con que una ruta rechaza (0 si no rechaza)."""
    try:
        f(*a, **k)
    except HTTPException as e:
        return e.status_code
    return 0


# ───────────────────────── 1. Reglas ─────────────────────────
print("TEST: plantilla (lo que manda la pestaña Plantilla)")
check("identificador estable: sin tildes, con guion bajo", P.slug("Mallas horizontales: muro simple") == "mallas_horizontales_muro_simple")
usados = set()
check("no repite identificadores", [P.slug("Tipo", usados), P.slug("Tipo", usados), P.slug("tipo", usados)] == ["tipo", "tipo_2", "tipo_3"])
check("un texto sin letras igual recibe identificador", P.slug("φ") == "item")

CRUDA = {"nombre": "  Protocolo   2025 ", "campo_raro": 1, "secciones": [
    {"titulo": "Muros", "criterios": [
        {"clave": "mh", "texto": "MH muro simple", "tipo": "opcion", "unidad": "cm", "croquis_url": "http://x",
         "opciones": [{"id": "tipo_1", "texto": "Tipo 1", "croquis": "protocolo/croquis/a.png", "croquis_url": "http://x"},
                      {"id": "", "texto": "Tipo 2", "croquis": "reclamos/registro/1/foto.png"}]},
        {"clave": "", "texto": "Empalme de  mallas", "tipo": "numero", "unidad": "cm"},
        {"clave": "", "texto": "Empalme de mallas", "tipo": "si_no"},
        {"clave": "trabas", "texto": "Trabas", "tipo": "tabla",
         "columnas": [{"id": "", "titulo": "Espesor", "unidad": "cm"}, {"id": "", "titulo": "φ"}, {"id": "", "titulo": "α"}],
         "filas": ["Losas", "Losas", " ", "Vigas"]},
        {"clave": "elementos", "texto": "Elementos", "tipo": "opciones",
         "opciones": [{"texto": "Piscina"}, {"texto": "PEAS"}, {"texto": "Otros"}]},
        {"clave": "notas", "texto": "Notas", "tipo": "texto"},
    ]}]}
L, errores = P.normalizar_plantilla(CRUDA)
C = P.criterios_de(L)
check("plantilla válida: sin errores", errores == [], errores)
check("sólo quedan los campos conocidos", "campo_raro" not in L and "croquis_url" not in C["mh"] and "croquis_url" not in C["mh"]["opciones"][0])
check("el nombre queda limpio", L["nombre"] == "Protocolo 2025")
check("la clave existente no cambia; la nueva sale del texto y no se repite",
      list(C) == ["mh", "empalme_de_mallas", "empalme_de_mallas_2", "trabas", "elementos", "notas"], list(C))
check("la opción nueva recibe id; la existente lo conserva", [o["id"] for o in C["mh"]["opciones"]] == ["tipo_1", "tipo_2"])
check("un croquis sólo puede vivir en la carpeta de croquis",
      C["mh"]["opciones"][0]["croquis"] == "protocolo/croquis/a.png" and C["mh"]["opciones"][1]["croquis"] == "")
check("clave de croquis: ni rutas raras ni salir de la carpeta",
      P.clave_croquis("protocolo/croquis/../x.png") == "" and P.clave_croquis("protocolo/croquis/inicial/mh__tipo_1.png") != ""
      and P.clave_croquis(None) == "")
check("la unidad es sólo del número", C["mh"]["unidad"] == "" and C["empalme_de_mallas"]["unidad"] == "cm")
check("columnas con id propio aunque el título no tenga letras latinas",
      [k["id"] for k in C["trabas"]["columnas"]] == ["espesor", "item", "item_2"], C["trabas"]["columnas"])
check("filas fijas: sin vacías ni repetidas", C["trabas"]["filas"] == ["Losas", "Vigas"])
check("normalizar dos veces da lo mismo (guardar no altera lo guardado)", P.normalizar_plantilla(L) == (L, []))

_, e = P.normalizar_plantilla({"secciones": [{"titulo": "", "criterios": [
    {"texto": "", "tipo": "opcion", "opciones": [{"texto": "Única"}, {"texto": ""}]},
    {"texto": "Tabla", "tipo": "tabla"}, {"texto": "Raro", "tipo": "fecha"}]}]})
check("dice qué falta: título, texto, opciones, columnas, tipo",
      len(e) == 6 and "falta el título" in e[0] and any("al menos dos opciones" in x for x in e)
      and any("al menos una columna" in x for x in e) and any("tipo de respuesta desconocido" in x for x in e), e)
check("plantilla sin criterios: no se guarda", P.normalizar_plantilla({"secciones": [{"titulo": "A", "criterios": []}]})[1] != [])
check("lo que no es una plantilla: error, no excepción", P.normalizar_plantilla(None)[1] != [] and P.normalizar_plantilla({"secciones": "x"})[1] != [])

print("\nTEST: respuestas")
n = P.leer_numero
check("número a la chilena", (n("1.250,5"), n("15.000"), n("12,5"), n("12.5"), n("0.125"), n("1.250.000"), n(" 7 "), n(8), n(2.50))
      == (1250.5, 15000, 12.5, 12.5, 0.125, 1250000, 7, 8, 2.5))
check("número vacío = sin responder", n("") is None and n("   ") is None)
for malo in ("doce", "1,2,3", True, float("inf")):
    try:
        n(malo)
        check("no es número: %r" % (malo,), False)
    except (ValueError, TypeError):
        pass
lv = P.limpiar_valor
check("una opción: sólo las de la plantilla", lv(C["mh"], "tipo_2") == ("tipo_2", None) and lv(C["mh"], "tipo_9")[1] and lv(C["mh"], ["tipo_1"])[1])
check("varias opciones: en el orden de la plantilla, sin repetir",
      lv(C["elementos"], ["otros", "piscina", "piscina"]) == (["piscina", "otros"], None) and lv(C["elementos"], ["x"])[1]
      and lv(C["elementos"], []) == (None, None))
check("sí / no", lv(C["empalme_de_mallas_2"], "si") == ("si", None) and lv(C["empalme_de_mallas_2"], "quizás")[1])
check("número", lv(C["empalme_de_mallas"], "60,5") == (60.5, None) and lv(C["empalme_de_mallas"], "sesenta")[1])
check("texto: sin espacios de sobra; vacío = sin responder", lv(C["notas"], "  hola\nchao ") == ("hola\nchao", None) and lv(C["notas"], "  ") == (None, None))
LIBRE = dict(C["trabas"], filas=[])
check("tabla libre: celdas conocidas, sin filas vacías",
      lv(LIBRE, [{"espesor": " 15 ", "item": "8", "otra": "x"}, {}, {"espesor": ""}, "basura"]) == ([{"espesor": "15", "item": "8"}], None))
check("tabla con filas fijas: una por nombre, en el orden de la plantilla, sin filas ajenas",
      lv(C["trabas"], [{"_fila": "Vigas", "espesor": "3"}, {"_fila": "Losas", "espesor": "2"}, {"_fila": "Otra", "espesor": "9"},
                       {"_fila": "Losas", "espesor": "7"}, {"_fila": "Vigas"}])
      == ([{"espesor": "2", "_fila": "Losas"}, {"espesor": "3", "_fila": "Vigas"}], None))
check("tabla: sin nada escrito = sin responder", lv(C["trabas"], [{"_fila": "Losas"}]) == (None, None) and lv(C["trabas"], "x")[1])

R0 = {"mh": {"valor": "tipo_1", "obs": ""}, "notas": {"valor": "a", "obs": "b"}, "borrado_de_la_plantilla": {"valor": 1, "obs": ""}}
R1, e = P.aplicar_respuestas(L, R0, {"empalme_de_mallas": {"valor": "60"}, "notas": {"obs": ""}, "mh": {"obs": "Lo pide la ITO"}})
check("guardar sólo toca lo enviado: el valor sin la observación y la observación sin el valor",
      e == [] and R1["mh"] == {"valor": "tipo_1", "obs": "Lo pide la ITO"} and R1["notas"] == {"valor": "a", "obs": ""}
      and R1["empalme_de_mallas"] == {"valor": 60, "obs": ""}, R1)
check("lo que no se envió se conserva y lo que no es de la plantilla se va", set(R1) == {"mh", "notas", "empalme_de_mallas"})
R2, e = P.aplicar_respuestas(L, R1, {"notas": {"valor": ""}, "mh": {"valor": None, "obs": ""}})
check("sin valor ni observación, el criterio deja de estar respondido", e == [] and set(R2) == {"empalme_de_mallas"}, R2)
R3, e = P.aplicar_respuestas(L, R1, {"mh": {"valor": "tipo_9"}, "inventado": {"valor": 1}, "empalme_de_mallas": {"valor": "x"}})
check("un valor imposible se rechaza y dice en qué criterio",
      len(e) == 3 and "MH muro simple" in e[0] and "Criterio desconocido" in e[1] and R3["mh"]["valor"] == "tipo_1", e)

a = P.avance(L, R1)
check("avance: respondidos, pendientes y con observación", a == {"total": 6, "respondidos": 3, "pendientes": 3, "observaciones": 1}, a)
check("avance sin respuestas ni plantilla", P.avance(L, None)["respondidos"] == 0 and P.avance(None, {})["total"] == 0)

NUEVA, _ = P.normalizar_plantilla({"secciones": [{"titulo": "Muros", "criterios": [
    {"clave": "mh", "texto": "MH", "tipo": "opcion", "opciones": [{"id": "tipo_2", "texto": "Tipo 2"}, {"id": "tipo_3", "texto": "Tipo 3"}]},
    {"clave": "notas", "texto": "Notas", "tipo": "texto"},
    {"clave": "empalme_de_mallas", "texto": "Empalme", "tipo": "si_no"}]}]})
H, perdidas = P.heredar_respuestas(NUEVA, {"mh": {"valor": "tipo_1", "obs": "Lo pide la ITO"}, "notas": {"valor": "a", "obs": ""},
                                           "empalme_de_mallas": {"valor": 60, "obs": ""}, "trabas": {"valor": [{"espesor": "1"}], "obs": ""}})
check("versión nueva: hereda lo que sigue valiendo; la observación sobrevive a su opción",
      H == {"mh": {"valor": None, "obs": "Lo pide la ITO"}, "notas": {"valor": "a", "obs": ""}} and perdidas == 3, (H, perdidas))

print("\nTEST: estados y permisos")
check("camino: borrador → revisado → cerrado, y de revisado se vuelve a borrador",
      P.TRANSICIONES == {("borrador", "revisado"), ("revisado", "borrador"), ("revisado", "cerrado")})
check("cerrado no vuelve atrás y de borrador no se salta a cerrado",
      not any(de == "cerrado" for de, _ in P.TRANSICIONES) and ("borrador", "cerrado") not in P.TRANSICIONES)
check("edita: el administrador y el cubicador de la obra", P.puede_editar("admin", []) and P.puede_editar("admin_calidad", [])
      and P.puede_editar("miembro", ["cubicador"]) and P.puede_editar("externo", ["cubicador"]))
check("no edita: quien no está en la obra, ni el USC de la obra", not P.puede_editar("miembro", []) and not P.puede_editar("usc", ["usc"])
      and not P.puede_editar("jefe_servicio", None))
check("ven: los internos, todas; el externo, las suyas; el cliente, ninguna",
      P.puede_ver("usc", []) and P.puede_ver("externo", ["externo"]) and not P.puede_ver("externo", []) and not P.puede_ver("cliente", ["cliente"]))

print("\nTEST: lo que lee ArmaScanner")
V = P.criterios_vigentes(L, {"mh": {"valor": "tipo_2", "obs": "x"}, "empalme_de_mallas": {"valor": 60.5, "obs": ""},
                             "empalme_de_mallas_2": {"valor": "no", "obs": ""}, "elementos": {"valor": ["piscina", "otros"], "obs": ""},
                             "trabas": {"valor": [{"_fila": "Losas", "espesor": "2"}], "obs": ""}})
porc = {c["clave"]: c for c in V}
check("lista plana, todos los criterios, en el orden de la plantilla", [c["clave"] for c in V] == list(C) and V[0]["seccion"] == "Muros")
check("cada valor también en texto", (porc["mh"]["valor"], porc["mh"]["valor_texto"], porc["mh"]["observacion"]) == ("tipo_2", "Tipo 2", "x")
      and porc["empalme_de_mallas"]["valor_texto"] == "60,5 cm" and porc["empalme_de_mallas_2"]["valor_texto"] == "No"
      and porc["elementos"]["valor_texto"] == "Piscina, Otros" and porc["trabas"]["valor_texto"] == "Losas: Espesor 2"
      and porc["notas"]["valor"] is None and porc["notas"]["valor_texto"] == "", porc)

print("\nTEST: croquis")
check("el tipo se lee del archivo, no del nombre",
      P.tipo_de_imagen(b"\x89PNG\r\n\x1a\n....") == "image/png" and P.tipo_de_imagen(b"\xff\xd8\xff\xe0..") == "image/jpeg"
      and P.tipo_de_imagen(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp" and P.tipo_de_imagen(b"<svg onload=alert(1)>") is None)
U = P.con_urls(L, lambda k: "https://r2/" + k)
check("las direcciones de lectura van en una copia, junto a cada croquis",
      P.criterios_de(U)["mh"]["opciones"][0]["croquis_url"] == "https://r2/protocolo/croquis/a.png"
      and P.criterios_de(U)["mh"]["opciones"][1]["croquis_url"] == "" and "croquis_url" not in C["mh"]["opciones"][0])

# ───────────────────────── 2. Carga inicial ─────────────────────────
print("\nTEST: carga inicial (el Excel «Protocolo 2025» como datos)")
subidos = {}
INI = P.plantilla_inicial(lambda clave, contenido, tipo: subidos.__setitem__(clave, (len(contenido), tipo)))
LI, errores = P.normalizar_plantilla(INI)
CI = P.criterios_de(LI)
check("es una plantilla válida tal como viene", errores == [], errores)
check("6 secciones y 48 criterios, con clave única",
      [s["titulo"] for s in LI["secciones"]] == ["Datos de la obra", "Losas", "Muros", "Lista de chequeo", "Notas", "Firmas"]
      and len(CI) == 48 and sum(len(s["criterios"]) for s in LI["secciones"]) == 48, len(CI))
check("las claves del archivo se conservan (son las que leerá ArmaScanner)",
      [c["clave"] for s in INI["secciones"] for c in s["criterios"]] == list(CI))
check("los 8 detalles de muro: 26 opciones, cada una con su croquis",
      sum(len(c["opciones"]) for c in CI.values() if c["opciones"] and c["opciones"][0]["croquis"]) == 26
      and [len(CI[k]["opciones"]) for k in ("mh_muro_simple", "mh_encuentro_l", "mh_encuentro_t", "mv_remate_superior",
                                              "mv_remate_inferior_perimetral", "mv_remate_inferior_interior",
                                              "muro_espesor_concentrico", "muro_espesor_excentrico")] == [2, 4, 4, 4, 3, 3, 3, 3])
check("28 croquis subidos (26 opciones + trabas + soportes), todos PNG y en su carpeta",
      len(subidos) == 28 and len(P.claves_de_croquis(LI)) == 28 and set(P.claves_de_croquis(LI)) == set(subidos)
      and all(k.startswith("protocolo/croquis/inicial/") and t == "image/png" and n > 500 for k, (n, t) in subidos.items()))
check("la lista de chequeo son las 15 líneas del Excel", len(LI["secciones"][3]["criterios"]) == 15)
check("tablas: trabas, soportes y recubrimientos (con sus 6 elementos fijos)",
      [c["clave"] for c in CI.values() if c["tipo"] == "tabla"] == ["trabas_muro", "soportes_losa", "recubrimientos"]
      and len(CI["recubrimientos"]["filas"]) == 6 and [k["id"] for k in CI["trabas_muro"]["columnas"]] == ["espesor", "diametro", "alfa", "beta", "b"])
check("ningún tipo fuera de los seis", {c["tipo"] for c in CI.values()} <= set(P.TIPOS))
FUENTE = open(os.path.join(ROOT, "armahub", "protocolo.py"), encoding="utf-8").read()
check("nada del contenido vive en el código: ni criterios ni opciones del Excel en protocolo.py",
      not any(t in FUENTE for t in ("Mallas horizontales", "Remates", "Trabas de muro", "In situ", "Tipo 1", "mh_muro_simple")))

# ───────────────────────── 3. Rutas contra una base simulada ─────────────────────────
AHORA = datetime.datetime(2026, 11, 21, 15, 30, tzinfo=datetime.timezone.utc)


class Base:
    """Tablas en memoria. Lee cada sentencia: columnas del INSERT y del UPDATE una a una con su
    marcador, y las condiciones del WHERE. Una sentencia que no entiende hace fallar la prueba."""

    def __init__(self):
        self.t = {"protocolo_plantillas": [], "protocolos": []}
        self.obras = [("O1", "Obra antigua", "2013160", "INGEVEC - EDIFICIO LOS LILENES", "INGEVEC S.A.", None, None),
                      ("O2", "Edificio Sin aSa", None, None, None, "Constructora Dos", "Empresa Dos")]
        self.asignados = [("O1", "cubi@x.cl", "cubicador"), ("O1", "usc@x.cl", "usc"), ("O2", "ext@x.cl", "externo")]
        self.usuarios = [("admin@x.cl", "Eugenio", "Zalazar"), ("cubi@x.cl", "Emilio", None)]
        self.filas, self.sentencias = [], []

    # psycopg
    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def fetchone(self):
        return self.filas[0] if self.filas else None

    def fetchall(self):
        return list(self.filas)

    def _valor(self, expr, params):
        expr = expr.strip()
        if expr.startswith("%s"):
            v = params.pop(0)
            return json.loads(v) if expr.endswith("::jsonb") else v
        if expr.upper() == "NOW()":
            return AHORA
        if expr.upper() == "NULL":
            return None
        if expr.startswith("'"):
            v = expr.split("'")[1]
            return json.loads(v) if expr.endswith("::jsonb") else v
        if expr.isdigit():
            return int(expr)
        raise AssertionError("expresión no simulada: " + expr)

    def _donde(self, tabla, donde, params):
        filas = list(self.t[tabla])
        for cond in [c for c in re.split(r"\s+AND\s+", donde or "") if c.strip()]:
            m = re.fullmatch(r"(\w+) = ANY\(%s\)", cond.strip())
            if m:
                lista = params.pop(0)
                filas = [f for f in filas if f[m.group(1)] in lista]
                continue
            col, expr = [x.strip() for x in cond.split("=", 1)]
            v = self._valor(expr, params)
            filas = [f for f in filas if f[col] == v]
        return filas

    def execute(self, sql, params=()):
        marcadores = len(re.findall(r"(?<!%)%s", sql))
        assert marcadores == len(params), "marcadores %d vs parámetros %d en: %s" % (marcadores, len(params), sql[:90])
        s, params = " ".join(sql.split()), list(params)
        self.sentencias.append(s)
        self.filas = []
        if "FROM users WHERE email = ANY(%s)" in s:
            lista = params.pop(0)
            self.filas = [u for u in self.usuarios if u[0] in lista]
        elif s.startswith("SELECT p.id_proyecto, p.nombre_proyecto, p.asa_job_id, ao.nombre, ao.cliente, co.nombre, p.empresa FROM proyectos p"):
            self.filas = [o for o in self.obras if not params or o[0] == params[0]]
            assert ("WHERE p.id_proyecto = %s" in s) == bool(params)
            params = []
        elif s.startswith("SELECT pu.rol FROM proyecto_usuarios pu JOIN users u ON u.id = pu.user_id WHERE pu.id_proyecto = %s AND u.email = %s"):
            self.filas = [(r,) for o, e, r in self.asignados if (o, e) == tuple(params)]
            params = []
        elif s.startswith("SELECT pu.id_proyecto FROM proyecto_usuarios pu JOIN users u ON u.id = pu.user_id WHERE u.email = %s"):
            email = params.pop(0)
            self.filas = [(o,) for o, e, r in self.asignados if e == email]
        elif s.startswith("SELECT COUNT(*) FROM protocolo_plantillas"):
            self.filas = [(len(self.t["protocolo_plantillas"]),)]
        elif s.startswith("SELECT COALESCE(MAX(version), 0) FROM protocolo_plantillas"):
            self.filas = [(max([f["version"] for f in self.t["protocolo_plantillas"]] or [0]),)]
        elif s.startswith("SELECT DISTINCT ON (id_proyecto) id_proyecto, version, estado, plantilla_id, respuestas FROM protocolos ORDER BY id_proyecto, version DESC"):
            ultimos = {}
            for f in sorted(self.t["protocolos"], key=lambda f: f["version"]):
                ultimos[f["id_proyecto"]] = f
            self.filas = [(f["id_proyecto"], f["version"], f["estado"], f["plantilla_id"], f["respuestas"]) for f in ultimos.values()]
        elif s.startswith("SELECT"):
            m = re.fullmatch(r"SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY (\w+)( DESC)?)?( LIMIT 1)?( FOR UPDATE)?", s)
            assert m, "consulta no simulada: " + s
            cols, tabla, donde, orden, desc, limite, _ = m.groups()
            filas = self._donde(tabla, donde, params)
            if orden:
                filas.sort(key=lambda f: f[orden], reverse=bool(desc))
            if limite:
                filas = filas[:1]
            self.filas = [tuple(json.loads(json.dumps(f[c.strip()])) if isinstance(f[c.strip()], (dict, list)) else f[c.strip()]
                                for c in cols.split(",")) for f in filas]
        elif s.startswith("INSERT INTO"):
            m = re.fullmatch(r"INSERT INTO (\w+) \((.+?)\) VALUES \((.+?)\)( ON CONFLICT \(id_proyecto, version\) DO NOTHING)?", s)
            assert m, "inserción no simulada: " + s
            tabla, cols, vals = m.group(1), [c.strip() for c in m.group(2).split(",")], m.group(3).split(",")
            assert len(cols) == len(vals), "columnas %d vs valores %d: %s" % (len(cols), len(vals), s[:90])
            base = ({"revision": 1, "guardada_por": None, "guardada_el": None, "publicada_por": None, "publicada_el": None}
                    if tabla == "protocolo_plantillas" else
                    {"guardado_por": None, "guardado_el": None, "revisado_por": None, "revisado_el": None, "cerrado_por": None,
                     "cerrado_el": None, "creado_el": AHORA})
            fila = dict(base, id=len(self.t[tabla]) + 1, **{c: self._valor(v, params) for c, v in zip(cols, vals)})
            if tabla == "protocolos" and any((f["id_proyecto"], f["version"]) == (fila["id_proyecto"], fila["version"]) for f in self.t[tabla]):
                assert m.group(4), "versión repetida sin ON CONFLICT"
                return
            if tabla == "protocolo_plantillas":
                assert not any(f["estado"] == fila["estado"] != "anterior" for f in self.t[tabla]), "dos plantillas " + fila["estado"]
            self.t[tabla].append(fila)
        elif s.startswith("UPDATE"):
            m = re.fullmatch(r"UPDATE (\w+) SET (.+?) WHERE (.+)", s)
            assert m, "actualización no simulada: " + s
            cambios = {}
            for par in m.group(2).split(","):
                col, expr = [x.strip() for x in par.split("=", 1)]
                cambios[col] = expr if expr == "revision + 1" else self._valor(expr, params)
            for f in self._donde(m.group(1), m.group(3), params):
                for col, v in cambios.items():
                    assert col in f, "columna desconocida: " + col
                    f[col] = f[col] + 1 if v == "revision + 1" else v
            if m.group(1) == "protocolo_plantillas":
                assert sum(1 for f in self.t["protocolo_plantillas"] if f["estado"] == "vigente") <= 1, "dos plantillas vigentes"
        elif s == "DELETE FROM protocolo_plantillas WHERE estado = 'borrador'":
            self.t["protocolo_plantillas"] = [f for f in self.t["protocolo_plantillas"] if f["estado"] != "borrador"]
        else:
            raise AssertionError("sentencia no simulada: " + s)
        assert not params, "sobran parámetros en: " + s[:90]


B = Base()
P.get_conn = lambda: B
bitacora = []
P.audit = lambda *a: bitacora.append(a)
P.storage.is_configured = lambda: True
P.storage.upload_file = lambda clave, contenido, tipo="": clave
P.storage.public_url = lambda clave: "https://r2.test/" + clave

ADMIN, CUBI, USC = {"email": "admin@x.cl", "role": "admin"}, {"email": "cubi@x.cl", "role": "miembro"}, {"email": "usc@x.cl", "role": "usc"}
EXT, OTRO, CLI = {"email": "ext@x.cl", "role": "externo"}, {"email": "otro@x.cl", "role": "miembro"}, {"email": "c@x.cl", "role": "cliente"}

print("\nTEST: plantilla en la base (administrador)")
r = P.leer_plantilla(admin=ADMIN)
check("sin plantilla: se ofrece la carga inicial", r == {"plantilla": None, "vigente": None, "hay_inicial": True}, r)
check("sin plantilla publicada no se abre un protocolo", codigo(P.crear_protocolo, "O1", user=ADMIN) == 409)
r = P.cargar_plantilla_inicial(admin=ADMIN)
check("carga inicial: versión 1, vigente, con sus 48 criterios y sus croquis con dirección",
      r["ok"] and r["vigente"] == 1 and r["plantilla"]["estado"] == "vigente" and r["plantilla"]["version"] == 1
      and len(P.criterios_de(r["plantilla"]["contenido"])) == 48
      and P.criterios_de(r["plantilla"]["contenido"])["mh_muro_simple"]["opciones"][0]["croquis_url"].startswith("https://r2.test/protocolo/croquis/inicial/"))
check("queda quién y cuándo la publicó", r["plantilla"]["publicada"] == "21-11-2026 12:30 · Eugenio Zalazar", r["plantilla"]["publicada"])
check("la carga inicial es una sola vez", codigo(P.cargar_plantilla_inicial, admin=ADMIN) == 409)
check("publicar sin borrador: nada que publicar", codigo(P.publicar_plantilla, admin=ADMIN) == 409)

editada = json.loads(json.dumps(r["plantilla"]["contenido"]))
editada["secciones"][2]["criterios"][0]["opciones"].append({"id": "", "texto": "Tipo 3", "croquis": ""})
editada["secciones"][3]["criterios"].append({"clave": "", "texto": "Criterio nuevo", "tipo": "si_no"})
del editada["secciones"][0]["criterios"][0]   # sale «Ubicación»
r = P.guardar_plantilla(P.GuardarPlantilla(contenido=editada, revision=None), admin=ADMIN)
check("guardar sobre la vigente abre el borrador v2; la vigente sigue siendo la 1",
      r["plantilla"]["estado"] == "borrador" and r["plantilla"]["version"] == 2 and r["vigente"] == 1
      and [f["estado"] for f in B.t["protocolo_plantillas"]] == ["vigente", "borrador"])
check("el guardado no manda las direcciones de lectura a la base",
      "croquis_url" not in json.dumps(B.t["protocolo_plantillas"][1]["contenido"]))
rev = r["plantilla"]["revision"]
r = P.guardar_plantilla(P.GuardarPlantilla(contenido=r["plantilla"]["contenido"], revision=rev), admin=ADMIN)
check("guardar de nuevo: mismo borrador, revisión siguiente", r["plantilla"]["version"] == 2 and r["plantilla"]["revision"] == rev + 1
      and len(B.t["protocolo_plantillas"]) == 2)
check("guardar con una revisión vieja: no pisa el cambio del otro",
      codigo(P.guardar_plantilla, P.GuardarPlantilla(contenido=editada, revision=rev), admin=ADMIN) == 409)
check("una plantilla incompleta no se guarda, y dice por qué",
      codigo(P.guardar_plantilla, P.GuardarPlantilla(contenido={"secciones": [{"titulo": "", "criterios": []}]}), admin=ADMIN) == 400)

print("\nTEST: protocolo de la obra")
r = P.obras(user=USC)
check("obras: todas, por nombre, con lo que el sistema ya sabe (aSa manda; si no, lo de ArmaHub)",
      [(o["id"], o["nombre"], o["codigo"], o["cliente"]) for o in r["obras"]]
      == [("O2", "Edificio Sin aSa", "O2", "Constructora Dos"), ("O1", "INGEVEC - EDIFICIO LOS LILENES", "2013160", "INGEVEC S.A.")]
      and r["hay_plantilla"] and not r["admin"], r["obras"])
check("el externo ve sólo sus obras; el cliente, ninguna",
      [o["id"] for o in P.obras(user=EXT)["obras"]] == ["O2"] and codigo(P.obras, user=CLI) == 403)
v = P.protocolo_de_obra("O1", user=OTRO)
check("obra sin protocolo: se ve, sin poder editar", v["protocolo"] is None and v["versiones"] == [] and not v["puede_editar"]
      and v["plantilla_vigente"] == 1 and v["obra"]["cliente"] == "INGEVEC S.A.")
check("obra que no existe", codigo(P.protocolo_de_obra, "NO", user=ADMIN) == 404)
check("el externo no entra a una obra ajena", codigo(P.protocolo_de_obra, "O1", user=EXT) == 403)
check("no lo abre quien no es cubicador de la obra, ni el USC de la obra",
      codigo(P.crear_protocolo, "O1", user=OTRO) == 403 and codigo(P.crear_protocolo, "O1", user=USC) == 403)
v = P.crear_protocolo("O1", user=CUBI)
p = v["protocolo"]
check("lo abre el cubicador de la obra: v1, borrador, con la plantilla vigente (no con el borrador del administrador)",
      v["ok"] and v["puede_editar"] and (p["version"], p["estado"], p["plantilla_version"], p["ultima"], p["plantilla_al_dia"])
      == (1, "borrador", 1, True, True) and p["avance"]["total"] == 48 and p["creado"] == "21-11-2026 12:30 · Emilio", p)
check("una obra, un protocolo: no se abre dos veces", codigo(P.crear_protocolo, "O1", user=ADMIN) == 409 and len(B.t["protocolos"]) == 1)

G = P.GuardarRespuestas
v = P.guardar_respuestas("O1", G(version=1, respuestas={
    "ubicacion": {"valor": "Av. Uno 123"}, "metros_construidos": {"valor": "15.000"}, "mh_muro_simple": {"valor": "tipo_2"},
    "elementos_adicionales": {"valor": ["peas", "piscina"]}, "empalme_cambio_diametro": {"valor": "si", "obs": "Según EETT 5.3"},
    "recubrimientos": {"valor": [{"_fila": "Losas", "recubrimiento": "2"}]}}), user=CUBI)
R = v["protocolo"]["respuestas"]
check("guardar: cada valor queda limpio y con su tipo",
      R["metros_construidos"]["valor"] == 15000 and R["elementos_adicionales"]["valor"] == ["piscina", "peas"]
      and R["recubrimientos"]["valor"] == [{"recubrimiento": "2", "_fila": "Losas"}] and R["empalme_cambio_diametro"]["obs"] == "Según EETT 5.3", R)
check("el avance sale de lo guardado", v["protocolo"]["avance"] == {"total": 48, "respondidos": 6, "pendientes": 42, "observaciones": 1})
v = P.guardar_respuestas("O1", G(version=1, respuestas={"ubicacion": {"valor": ""}, "pisos_torre": {"valor": 12}}), user=ADMIN)
check("otro usuario guarda otros criterios: lo anterior se conserva",
      set(v["protocolo"]["respuestas"]) == {"metros_construidos", "mh_muro_simple", "elementos_adicionales", "empalme_cambio_diametro",
                                            "recubrimientos", "pisos_torre"} and v["protocolo"]["guardado"].endswith("Eugenio Zalazar"))
check("un valor imposible no se guarda (400) y no cambia nada",
      codigo(P.guardar_respuestas, "O1", G(version=1, respuestas={"mh_muro_simple": {"valor": "tipo_9"}}), user=CUBI) == 400
      and B.t["protocolos"][0]["respuestas"]["mh_muro_simple"]["valor"] == "tipo_2")
check("no guarda quien no edita", codigo(P.guardar_respuestas, "O1", G(version=1, respuestas={}), user=OTRO) == 403)
check("la lista de obras trae estado y avance", [o["protocolo"] for o in P.obras(user=ADMIN)["obras"]]
      == [None, {"version": 1, "estado": "borrador", "respondidos": 6, "total": 48}])

E = P.CambioEstado
check("de borrador no se cierra directo", codigo(P.cambiar_estado, "O1", E(version=1, estado="cerrado"), user=CUBI) == 409)
check("un estado que no existe", codigo(P.cambiar_estado, "O1", E(version=1, estado="aprobado"), user=CUBI) == 409)
v = P.cambiar_estado("O1", E(version=1, estado="revisado"), user=CUBI)
check("revisado con el cliente: queda quién y cuándo", v["protocolo"]["estado"] == "revisado" and v["protocolo"]["revisado"] == "21-11-2026 12:30 · Emilio")
check("revisado no se edita", codigo(P.guardar_respuestas, "O1", G(version=1, respuestas={"pisos_torre": {"valor": 3}}), user=CUBI) == 409)
v = P.cambiar_estado("O1", E(version=1, estado="borrador"), user=CUBI)
check("de revisado se vuelve a borrador (y se borra la marca de revisión)", v["protocolo"]["estado"] == "borrador" and v["protocolo"]["revisado"] == "")
check("nueva versión sólo desde un cerrado", codigo(P.nueva_version, "O1", user=CUBI) == 409)
P.cambiar_estado("O1", E(version=1, estado="revisado"), user=CUBI)
v = P.cambiar_estado("O1", E(version=1, estado="cerrado"), user=ADMIN)
check("cerrado: queda quién y cuándo", v["protocolo"]["estado"] == "cerrado" and v["protocolo"]["cerrado"].endswith("Eugenio Zalazar"))
check("cerrado no se edita ni cambia de estado",
      codigo(P.guardar_respuestas, "O1", G(version=1, respuestas={"pisos_torre": {"valor": 3}}), user=ADMIN) == 409
      and codigo(P.cambiar_estado, "O1", E(version=1, estado="borrador"), user=ADMIN) == 409
      and codigo(P.cambiar_estado, "O1", E(version=1, estado="revisado"), user=ADMIN) == 409)

print("\nTEST: versiones de la plantilla y del protocolo")
r = P.publicar_plantilla(admin=ADMIN)
check("publicar: el borrador v2 queda vigente y la v1 pasa a anterior",
      r["vigente"] == 2 and r["plantilla"]["estado"] == "vigente" and [f["estado"] for f in B.t["protocolo_plantillas"]] == ["anterior", "vigente"])
v = P.protocolo_de_obra("O1", user=USC)
check("el protocolo cerrado conserva su plantilla: no cambió con la publicación",
      v["protocolo"]["plantilla_version"] == 1 and v["protocolo"]["avance"]["total"] == 48 and not v["protocolo"]["plantilla_al_dia"]
      and "ubicacion" in P.criterios_de(v["protocolo"]["contenido"]) and v["plantilla_vigente"] == 2)
v = P.nueva_version("O1", user=CUBI)
p2 = v["protocolo"]
check("nueva versión: v2 en borrador con la plantilla vigente y las respuestas que siguen valiendo",
      (p2["version"], p2["estado"], p2["plantilla_version"], p2["ultima"]) == (2, "borrador", 2, True) and v["perdidas"] == 0
      and p2["respuestas"]["mh_muro_simple"]["valor"] == "tipo_2" and p2["avance"]["total"] == 48
      and "criterio_nuevo" in P.criterios_de(p2["contenido"]) and "ubicacion" not in P.criterios_de(p2["contenido"])
      and [x["version"] for x in v["versiones"]] == [1, 2], p2["avance"])
v1 = P.protocolo_de_obra("O1", version=1, user=USC)["protocolo"]
check("la versión 1 se sigue leyendo, cerrada, tal como quedó", v1["estado"] == "cerrado" and not v1["ultima"] and v1["respuestas"]["pisos_torre"]["valor"] == 12)
check("una versión que no existe", codigo(P.protocolo_de_obra, "O1", version=9, user=USC) == 404)
check("no se guarda sobre la versión cerrada aunque exista una nueva",
      codigo(P.guardar_respuestas, "O1", G(version=1, respuestas={"pisos_torre": {"valor": 3}}), user=ADMIN) == 409)

otra = json.loads(json.dumps(r["plantilla"]["contenido"]))
otra["secciones"][2]["criterios"][0]["opciones"] = otra["secciones"][2]["criterios"][0]["opciones"][:1] + \
    [{"id": "", "texto": "Tipo nuevo", "croquis": ""}]   # sale «Tipo 2», que es lo respondido
P.guardar_plantilla(P.GuardarPlantilla(contenido=otra), admin=ADMIN)
check("descartar el borrador: vuelve la vigente", P.descartar_plantilla(admin=ADMIN)["plantilla"]["version"] == 2 and len(B.t["protocolo_plantillas"]) == 2)
P.guardar_plantilla(P.GuardarPlantilla(contenido=otra), admin=ADMIN)
P.publicar_plantilla(admin=ADMIN)
v = P.protocolo_de_obra("O1", user=CUBI)
check("se publicó la v3: el borrador de la obra lo sabe", not v["protocolo"]["plantilla_al_dia"] and v["plantilla_vigente"] == 3)
v = P.actualizar_plantilla("O1", user=CUBI)
check("actualizar plantilla: pasa a la v3 y dice cuántas respuestas se perdieron",
      v["protocolo"]["plantilla_version"] == 3 and v["protocolo"]["plantilla_al_dia"] and v["perdidas"] == 1
      and "mh_muro_simple" not in v["protocolo"]["respuestas"] and v["protocolo"]["respuestas"]["pisos_torre"]["valor"] == 12)

print("\nTEST: la lectura para ArmaScanner")
r = P.criterios_de_la_obra("O1", user=USC)
porc = {c["clave"]: c for c in r["criterios"]}
check("vigente = la última versión cerrada (la 1), aunque haya un borrador más nuevo",
      r["protocolo"]["version"] == 1 and r["protocolo"]["estado"] == "cerrado" and len(r["criterios"]) == 48
      and porc["mh_muro_simple"]["valor_texto"] == "Tipo 2" and porc["metros_construidos"]["valor_texto"] == "15000 m²"
      and porc["empalme_cambio_diametro"]["observacion"] == "Según EETT 5.3")
r = P.criterios_de_la_obra("O1", en_curso=1, user=USC)
check("con en_curso=1: la versión en trabajo", r["protocolo"]["version"] == 2 and r["protocolo"]["estado"] == "borrador")
r = P.criterios_de_la_obra("O2", user=ADMIN)
check("obra sin protocolo: lista vacía, sin error", r["protocolo"] is None and r["criterios"] == [] and r["en_curso"] is None)
check("queda en la bitácora: carga, publicaciones, creación, guardados, estados, versión",
      {"protocolo_plantilla_inicial", "protocolo_plantilla_publicar", "protocolo_crear", "protocolo_guardar", "protocolo_estado",
       "protocolo_nueva_version", "protocolo_actualizar_plantilla"} == {a[1] for a in bitacora}, {a[1] for a in bitacora})

# ───────────────────────── 4. Cableado ─────────────────────────
print("\nTEST: cableado de la caluga Obras")


def lee(*partes):
    return open(os.path.join(ROOT, "armahub", *partes), encoding="utf-8").read().replace("\r\n", "\n")


MAIN, REG, SH, APP = lee("main.py"), lee("static", "js", "app", "registry.js"), lee("static", "js", "app", "shell.js"), lee("templates", "app.html")
HTM, AUTH = lee("templates", "tabs", "obras_panel.html"), lee("auth.py")
JS = {n: lee("static", "js", "features", "obras", n) for n in ("index.js", "protocolo.js", "plantilla.js")}
rutas = {(sorted(r.methods)[0], r.path) for r in P.router.routes}
check("el router se monta sin prefijo y por /api/v1, que es por donde habla el front",
      "from .protocolo import router as protocolo_router" in MAIN and "    app.include_router(protocolo_router)\n" in MAIN
      and "        protocolo_router,\n    ]" in MAIN)
check("las rutas que usa la pantalla existen",
      {("GET", "/protocolo/plantilla"), ("POST", "/protocolo/plantilla"), ("POST", "/protocolo/plantilla/publicar"),
       ("POST", "/protocolo/plantilla/descartar"), ("POST", "/protocolo/plantilla/inicial"), ("POST", "/protocolo/plantilla/croquis"),
       ("GET", "/protocolo/obras"), ("GET", "/protocolo/obra/{id_proyecto}"), ("POST", "/protocolo/obra/{id_proyecto}/crear"),
       ("POST", "/protocolo/obra/{id_proyecto}/guardar"), ("POST", "/protocolo/obra/{id_proyecto}/estado"),
       ("POST", "/protocolo/obra/{id_proyecto}/nueva-version"), ("POST", "/protocolo/obra/{id_proyecto}/actualizar-plantilla"),
       ("GET", "/protocolo/obra/{id_proyecto}/vigente")} == rutas, rutas)
todo_js = "\n".join(JS.values())
directas = set(re.findall(r"'(/protocolo/[a-z/\-]+)'", todo_js)) - {"/protocolo/obra/"}
de_obra = {"/protocolo/obra/{id_proyecto}" + x for x in re.findall(r"ruta\('(/[a-z\-]+)'", todo_js)}
check("cada ruta que pide el front está en el router",
      directas | de_obra <= {q for _, q in rutas} and len(directas) == 6 and len(de_obra) == 5, (directas, de_obra))
check("la plantilla es sólo del administrador, en cada ruta",
      FUENTE.count("admin=Depends(require_admin_or_admin_calidad)") == 6 and FUENTE.count('@router.post("/protocolo/plantilla') == 5)
check("el cliente sigue sin entrar: ninguna ruta del protocolo está en su lista", "protocolo" not in AUTH.split("CLIENTE_PUEDE = (")[1].split(")\n_CLIENTE")[0])
check("la caluga está registrada, para los usuarios internos",
      "id: 'obras'" in REG and "defaultTab: 'ob_obras'" in REG and "'cliente'" not in REG.split("id: 'obras'")[1].split("});")[0])
check("pestañas: Obras y Plantilla, cada una con su cargador; Plantilla sólo administración",
      "ob_obras: 'obrCargarObras'" in SH and "ob_plantilla: 'obrCargarPlantilla'" in SH and "ob_obras: 'Obras'" in SH
      and "if (mod === 'obras') {" in SH and "switchTab('ob_plantilla')" in SH
      and """<button class="tab-btn mod-obras" onclick="switchTab('ob_obras')" style="display:none;">Obras</button>""" in APP
      and """<button class="tab-btn mod-obras" onclick="switchTab('ob_plantilla')" style="display:none;">Plantilla</button>""" in APP)
check("la plantilla HTML y los tres scripts están incluidos, antes del registro",
      "{% include 'tabs/obras_panel.html' %}" in APP and all("/static/js/features/obras/" + n in APP for n in JS)
      and APP.index("features/obras/index.js") < APP.index("features/obras/protocolo.js") < APP.index("features/obras/plantilla.js")
      < APP.index("/static/js/app/registry.js"))
check("los cargadores que nombra el shell existen", "global.obrCargarObras = cargar" in JS["index.js"]
      and "global.obrCargarPlantilla = cargar" in JS["plantilla.js"] and "global.loadObrasModule" in JS["index.js"])
check("los contenedores que usa el JS están en la plantilla HTML",
      all('id="%s"' % i in HTM for i in set(re.findall(r"el\('(obr[A-Za-z]+)'\)", todo_js)) - {"obrVerTodos", "obrVerPend", "obrSecciones",
                                                                                              "obrBotones", "obrPlBotones"})
      and 'id="tab-ob_obras"' in HTM and 'id="tab-ob_plantilla"' in HTM)
check("pantalla con el Sistema de Diseño, sin tocar estilos de otras pantallas",
      HTM.count('class="arm-ds obr"') == 2 and all(linea.strip().startswith((".obr", "@media", "-webkit", "background", "font", "border",
                                                                             "align", "padding", "color", "display", "/*", "}"))
                                                   for linea in HTM.split("<style>")[1].split("</style>")[0].splitlines() if linea.strip()))
check("nada del contenido del Excel en el front", not any(t in todo_js + HTM for t in ("Mallas horizontales", "Remates", "Trabas de muro", "In situ")))

MIG = lee("migrations", "176_protocolo.sql")
from armahub import db as DB  # noqa: E402
sentencias = [m for m in DB._load_file_migrations() if m[0] == 176][0][2]
check("migración 176: cuatro sentencias, todas repetibles", len(sentencias) == 4
      and all(s.startswith(("CREATE TABLE IF NOT EXISTS", "CREATE UNIQUE INDEX IF NOT EXISTS")) for s in sentencias), sentencias)
check("la migración no borra ni altera nada existente", not re.search(r"\b(DROP|DELETE|ALTER|UPDATE|TRUNCATE)\b", "\n".join(sentencias)))
for tabla, cols in (("protocolo_plantillas", P._COLS_PLANTILLA), ("protocolos", P._COLS_PROTOCOLO)):
    cuerpo = [s for s in sentencias if s.startswith("CREATE TABLE IF NOT EXISTS %s " % tabla)][0]
    usadas = {c.strip() for c in cols.split(",")} | set(re.findall(r"(\w+) = ", " ".join(
        x for x in re.findall(r"UPDATE %s\s+SET (.+?) WHERE" % tabla, " ".join(FUENTE.split())))))
    for bloque in re.findall(r"INSERT INTO %s\s*\((.+?)\)" % tabla, " ".join(FUENTE.split())):
        usadas |= {c.strip() for c in bloque.split(",")}
    check("%s: cada columna que usa el código existe en la migración" % tabla,
          all(re.search(r"\n\s+%s\s" % c, cuerpo) for c in usadas), sorted(c for c in usadas if not re.search(r"\n\s+%s\s" % c, cuerpo)))

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
