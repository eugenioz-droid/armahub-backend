"""Tests de API del CICLO DE VIDA DEL TEMPLATE (armahub/modelador.py).

POR QUÉ ESTE ARNÉS Y NO pytest + TestClient
-------------------------------------------
En este equipo NO hay pytest ni fastapi ni psycopg instalados (`python -m pytest`
responde "No module named pytest"; `import fastapi` falla). El repo ya vive con eso:
tests/test_modelador_backend.py valida por análisis de fuente por la misma razón.

Aquí se va un paso más allá: se ejercitan las FUNCIONES REALES del router
(crear_template, listar_templates, ver_template, actualizar_template,
eliminar_template) llamándolas directamente, con:
  · stubs mínimos de `fastapi` y `pydantic` (APIRouter/Depends/HTTPException/BaseModel
    con __fields_set__) inyectados en sys.modules ANTES de importar el router;
  · un `armahub.db` falso: get_conn devuelve un cursor en memoria que entiende el SQL
    que usa este router (templates_catalogo, elementos_template, proyectos) y un
    audit() que solo registra;
  · el `armahub.catalogo` REAL (get_figura consulta el catálogo falso de figuras), y
    un `armahub.barras` falso con _puede_editar_barras (el real arrastra pandas).

Lo que NO cubre: el enrutado HTTP de FastAPI (paths, códigos por defecto) y el SQL
real de Postgres. Lo que SÍ cubre: permisos, validación de receta, no-destructividad
del PUT, 409 por instancias, deducción de schema_version y la forma de las respuestas.

Correr con:  python tests/test_modelador_templates.py     (exit 0 = verde)
"""
import json
import os
import re
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


# ===========================================================================
# 1. STUBS de las librerías externas (fastapi / pydantic)
# ===========================================================================
class HTTPException(Exception):
    def __init__(self, status_code=500, detail=None):
        super().__init__(f"{status_code}: {detail}")
        self.status_code = status_code
        self.detail = detail


def _instalar_stubs_libs():
    fastapi = types.ModuleType("fastapi")

    class APIRouter(object):
        def __init__(self, *a, **kw):
            self.rutas = []

        def _reg(self, metodo, path):
            def deco(fn):
                self.rutas.append((metodo, path, fn))
                return fn
            return deco

        def get(self, path, **kw): return self._reg("GET", path)
        def post(self, path, **kw): return self._reg("POST", path)
        def put(self, path, **kw): return self._reg("PUT", path)
        def patch(self, path, **kw): return self._reg("PATCH", path)
        def delete(self, path, **kw): return self._reg("DELETE", path)

    def Depends(dep=None):
        return dep

    fastapi.APIRouter = APIRouter
    fastapi.Depends = Depends
    fastapi.HTTPException = HTTPException
    fastapi.Request = object
    sys.modules["fastapi"] = fastapi

    seguridad = types.ModuleType("fastapi.security")
    seguridad.HTTPBearer = object
    seguridad.HTTPAuthorizationCredentials = object
    sys.modules["fastapi.security"] = seguridad

    pydantic = types.ModuleType("pydantic")

    class BaseModel(object):
        """Stub suficiente: guarda los campos anotados con su default y recuerda
        CUÁLES vinieron en la llamada (__fields_set__), que es de lo que depende el
        PUT no destructivo."""
        def __init__(self, **kw):
            anotados = {}
            for klass in reversed(type(self).__mro__):
                anotados.update(getattr(klass, "__annotations__", {}) or {})
            for campo in anotados:
                setattr(self, campo, kw.get(campo, getattr(type(self), campo, None)))
            self.__fields_set__ = set(kw.keys())

    pydantic.BaseModel = BaseModel
    sys.modules["pydantic"] = pydantic


# ===========================================================================
# 2. BASE DE DATOS FALSA (en memoria) — entiende el SQL de este router
# ===========================================================================
STORE = {
    "templates": [],       # filas de templates_catalogo
    "instancias": [],      # filas de elementos_template
    "lotes": {},           # lote_id -> id_proyecto (la obra la sabe el LOTE)
    "proyectos": {},       # id_proyecto -> nombre_proyecto
    "figuras": {},         # codigo -> (parciales, angulos, radio)
    "seq": {"templates": 0, "instancias": 0},
}
AUDITORIA = []
# Todo SQL que pasó por el cursor. Sirve para CONTAR consultas: es la única forma
# de que un N+1 (una consulta por template) falle un test en vez de descubrirse en
# producción con la biblioteca llena.
CONSULTAS = []


def _norm(sql):
    return " ".join(str(sql).split())


def _idx_top(texto, aguja):
    """Posición de `aguja` a NIVEL 0 de paréntesis, o -1.

    Hace falta desde que el listado trae el LEFT JOIN agregado del uso: ese
    subselect tiene su PROPIO ` WHERE ` y su propio ` GROUP BY `, y un split crudo
    agarraba los del subquery creyendo que eran los de la consulta de afuera."""
    prof = 0
    for i, ch in enumerate(texto):
        if ch == "(":
            prof += 1
        elif ch == ")":
            prof -= 1
        elif prof == 0 and texto.startswith(aguja, i):
            return i
    return -1


def _uso_de(template_id):
    """Lo mismo que calcula el LEFT JOIN agregado del router: cuántas instancias
    apuntan a este template y en cuántas OBRAS distintas. La obra sale de la propia
    instancia y, si no la trae (filas pre-107), del lote — el COALESCE del SQL."""
    usos, obras = 0, set()
    for i in STORE["instancias"]:
        if i.get("template_id") != template_id:
            continue
        usos += 1
        obra = i.get("id_proyecto") or STORE["lotes"].get(i.get("lote_id"))
        if obra:                      # COUNT(DISTINCT ...) ignora los NULL
            obras.add(obra)
    return usos, len(obras)


def _split_top(texto, sep=","):
    """Parte por `sep` respetando paréntesis (para listas de columnas con CASE ...)."""
    partes, buf, prof = [], [], 0
    for ch in texto:
        if ch == "(":
            prof += 1
        elif ch == ")":
            prof -= 1
        if ch == sep and prof == 0:
            partes.append("".join(buf)); buf = []
        else:
            buf.append(ch)
    partes.append("".join(buf))
    return [p.strip() for p in partes if p.strip()]


def _params_obj(fila):
    p = fila.get("params")
    if isinstance(p, str):
        try:
            return json.loads(p)
        except Exception:
            return {}
    return p or {}


def _eval_col(expr, fila):
    """Evalúa una expresión de la lista SELECT contra una fila en memoria."""
    e = _norm(expr)
    # `t.params` cae solo en el fallback de abajo (fila["params"], el JSON tal cual),
    # que es justo lo que el router le pasa a _params_dict.
    if e.startswith("COALESCE(u.n_usos"):               # del LEFT JOIN agregado
        return _uso_de(fila.get("id"))[0]
    if e.startswith("COALESCE(u.n_obras"):
        return _uso_de(fila.get("id"))[1]
    if e.endswith("nombre_proyecto"):                   # del LEFT JOIN proyectos
        return STORE["proyectos"].get(fila.get("obra"))
    return fila.get(e.split(".")[-1])


class FakeCursor(object):
    def __init__(self):
        self._filas = []

    # -- API de psycopg que usa el router --------------------------------
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def fetchone(self): return self._filas[0] if self._filas else None
    def fetchall(self): return list(self._filas)

    def execute(self, sql, params=()):
        s = _norm(sql)
        p = list(params or ())
        CONSULTAS.append(s)
        self._filas = []
        if s.startswith("SELECT nombre_proyecto FROM proyectos"):
            nom = STORE["proyectos"].get(p[0])
            self._filas = [(nom,)] if nom is not None else []
        elif s.startswith("SELECT codigo, parciales, angulos, radio FROM figuras_catalogo"):
            # catalogo.cargar_figuras: el catálogo se lee de UNA para toda la receta
            # (antes era una consulta por componente). Devuelve las figuras pedidas
            # con su código adelante; las que no están simplemente no vienen.
            pedidos = list(p[0] or []) if p else []
            self._filas = [(c,) + tuple(STORE["figuras"][c]) for c in pedidos
                           if c in STORE["figuras"]]
        elif s.startswith("SELECT parciales, angulos, radio FROM figuras_catalogo"):
            fig = STORE["figuras"].get(p[0])
            self._filas = [fig] if fig else []
        elif s.startswith("INSERT INTO templates_catalogo"):
            self._insert(s, p, "templates")
        elif s.startswith("INSERT INTO elementos_template"):
            self._insert(s, p, "instancias")
        elif s.startswith("SELECT COUNT(*) FROM elementos_template"):
            n = len([i for i in STORE["instancias"] if i.get("template_id") == p[0]])
            self._filas = [(n,)]
        elif s.startswith("UPDATE templates_catalogo SET"):
            self._update(s, p)
        elif s.startswith("DELETE FROM templates_catalogo"):
            STORE["templates"] = [t for t in STORE["templates"] if t["id"] != p[0]]
        elif "FROM templates_catalogo" in s:
            self._select_templates(s, p)
        else:
            raise AssertionError("SQL no soportado por el arnés: " + s)

    # -- implementación -------------------------------------------------
    def _insert(self, s, p, tabla):
        cols = _split_top(s[s.index("(") + 1:s.index(")")])
        fila = dict(zip(cols, p))
        STORE["seq"][tabla] += 1
        fila["id"] = STORE["seq"][tabla]
        STORE[tabla].append(fila)
        self._filas = [(fila["id"],)]

    def _update(self, s, p):
        cuerpo = s[len("UPDATE templates_catalogo SET "):]
        sets, _, where = cuerpo.partition(" WHERE ")
        cols = [c.split("=")[0].strip() for c in _split_top(sets)]
        assert where.strip() == "id = %s", where
        fila_id = p[len(cols)]
        for fila in STORE["templates"]:
            if fila["id"] == fila_id:
                for col, val in zip(cols, p):
                    fila[col] = val

    def _select_templates(self, s, p):
        # Todos los cortes son a NIVEL 0 de paréntesis: el LEFT JOIN agregado del
        # uso mete un subselect con su propio WHERE/GROUP BY que no es de aquí.
        i_from = _idx_top(s, " FROM ")
        cols = _split_top(s[len("SELECT "):i_from])
        resto = s[i_from:]
        i_where = _idx_top(resto, " WHERE ")
        i_order = _idx_top(resto, " ORDER BY ")
        where, order = "", ""
        if i_where >= 0:
            fin = i_order if i_order > i_where else len(resto)
            where = resto[i_where + len(" WHERE "):fin]
        if i_order >= 0:
            order = resto[i_order + len(" ORDER BY "):]

        filas = list(STORE["templates"])
        i = 0
        for cond in ([c for c in where.split(" AND ") if c.strip()] if where else []):
            c = cond.strip()
            val = p[i]; i += 1
            campo = c.split()[0].split(".")[-1]
            if "ILIKE" in c:
                pat = str(val).strip("%").lower()
                filas = [f for f in filas if pat in str(f.get(campo) or "").lower()]
            else:
                filas = [f for f in filas if f.get(campo) == val]
        obra_prio = None
        if "(t.obra IS NOT DISTINCT FROM %s)" in order:
            obra_prio = p[i]; i += 1
        filas.sort(key=lambda f: (0 if (obra_prio and f.get("obra") == obra_prio) else 1, -f["id"]))
        self._filas = [tuple(_eval_col(c, f) for c in cols) for f in filas]


class FakeConn(object):
    def cursor(self): return FakeCursor()
    def __enter__(self): return self
    def __exit__(self, *a): return False


def _instalar_stubs_armahub():
    """Reemplaza armahub.db / armahub.auth / armahub.barras por versiones falsas."""
    import contextlib

    paquete = types.ModuleType("armahub")
    paquete.__path__ = [os.path.join(ROOT, "armahub")]
    sys.modules.setdefault("armahub", paquete)

    db = types.ModuleType("armahub.db")

    @contextlib.contextmanager
    def get_conn():
        yield FakeConn()

    db.get_conn = get_conn
    db.audit = lambda *a, **kw: AUDITORIA.append(a)
    sys.modules["armahub.db"] = db

    auth = types.ModuleType("armahub.auth")
    auth.get_current_user = lambda: None
    sys.modules["armahub.auth"] = auth

    # El barras real arrastra pandas: se reimplanta SOLO el predicado que usa el
    # router. Miembros del área 'cubicaciones' (los que hoy ya podían guardar).
    barras = types.ModuleType("armahub.barras")
    MIEMBROS_CUBICACIONES = {"cubi@armacero.cl"}
    barras.MIEMBROS_CUBICACIONES = MIEMBROS_CUBICACIONES

    def _puede_editar_barras(cur, user):
        if (user.get("role") or "").lower() in ("admin", "admin_calidad"):
            return True
        return (user.get("email") or "").strip().lower() in MIEMBROS_CUBICACIONES

    barras._puede_editar_barras = _puede_editar_barras
    sys.modules["armahub.barras"] = barras


_instalar_stubs_libs()
_instalar_stubs_armahub()

from armahub import modelador as M           # noqa: E402  (después de los stubs)
from armahub.modelador import (              # noqa: E402
    TemplateCrear, TemplateActualizar, crear_template, listar_templates,
    ver_template, actualizar_template, eliminar_template,
)


# ===========================================================================
# 3. DATOS DE PRUEBA
# ===========================================================================
ADMIN = {"email": "admin@armacero.cl", "role": "admin"}
MIEMBRO = {"email": "ana@armacero.cl", "role": "miembro"}          # Catálogo, NO cubicaciones
OTRO_MIEMBRO = {"email": "beto@armacero.cl", "role": "miembro"}
CUBICADOR = {"email": "cubi@armacero.cl", "role": "cubicador"}     # Enfierrador (área cubicaciones)
CLIENTE = {"email": "cli@constructora.cl", "role": "cliente"}


def _reset():
    STORE["templates"] = []
    STORE["instancias"] = []
    STORE["lotes"] = {}
    STORE["seq"] = {"templates": 0, "instancias": 0}
    del CONSULTAS[:]
    STORE["proyectos"] = {"OB-1": "Edificio Explora", "OB-2": "Torre Norte"}
    STORE["figuras"] = {
        "101A": (["A"], [], False),
        "103B": (["A", "B", "C"], [45, 45], False),
        "104D": (["A", "B", "C", "D"], [135, 135], False),
    }
    del AUDITORIA[:]


def receta_editor():
    """Shape TEMPLATE EDITOR: dims {modo, valor}."""
    return {
        "tipo": "viga",
        "geometria": {"largo": 600, "ancho": 30, "alto": 60, "recub_sup": 4, "recub_inf": 4, "recub_lat": 3},
        "componentes": [
            {"comp_id": "CBS", "tipologia": "CBS", "figura": "103B", "diam": 16,
             "dims": {"A": {"modo": "fija", "valor": 30}, "B": {"modo": "auto"},
                      "C": {"modo": "fija", "valor": 30}},
             "distribucion": {"modo": "layered", "n_capas": 2, "barras_capa": 3}},
            {"comp_id": "CBI", "tipologia": "CBI", "figura": "101A", "diam": 18,
             "dims": {"A": {"modo": "auto"}},
             "distribucion": {"modo": "layered", "n_capas": 1, "barras_capa": 4}},
        ],
    }


def receta_enfierrador():
    """Shape ENFIERRADOR MVP: dims numéricas PLANAS (el que convive en la misma tabla)."""
    return {
        "tipo": "viga",
        "geometria": {"largo": 500, "ancho": 25, "alto": 50, "recub_sup": 4, "recub_lat": 3},
        "componentes": [
            {"tipologia": "ES", "figura": "104D", "diam": 8,
             "dims": {"A": 22, "B": 42, "C": 22, "D": 42},
             "distribucion": {"modo": "linear", "zonas": [{"long": 500, "sep": 20}]}},
        ],
    }


# ===========================================================================
# 4. TESTS
# ===========================================================================
FALLOS = []


def check(nombre, cond, extra=""):
    # La consola de Windows es cp1252: nada de flechas ni comillas tipográficas aquí.
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -> " + str(extra)) if (extra and not cond) else ""))
    if not cond:
        FALLOS.append(nombre)
    return bool(cond)


def http(fn, *a, **kw):
    """Ejecuta y devuelve la HTTPException (o None si no hubo)."""
    try:
        fn(*a, **kw)
    except HTTPException as e:
        return e
    return None


def t_post_crea():
    _reset()
    r = crear_template(TemplateCrear(nombre="  Viga tipo A  ", tipo="VIGA",
                                     params=receta_editor(), obra="OB-1"), user=MIEMBRO)
    check("POST crea y devuelve id", r.get("ok") and r.get("id") == 1, r)
    fila = STORE["templates"][0]
    check("POST guarda nombre normalizado (trim)", fila["nombre"] == "Viga tipo A", fila["nombre"])
    check("POST guarda tipo en minúsculas", fila["tipo"] == "viga", fila["tipo"])
    check("POST estampa schema_version=2 (shape del editor)", fila["schema_version"] == 2, fila["schema_version"])
    check("POST estampa creado_por / editado_por", fila["creado_por"] == MIEMBRO["email"] and fila["editado_por"] == MIEMBRO["email"])
    check("POST estampa fecha y updated_at", bool(fila["fecha"]) and bool(fila["updated_at"]))
    check("POST guarda la obra REAL (no null)", fila["obra"] == "OB-1", fila["obra"])
    check("POST audita", any(a[1] == "crear_template" for a in AUDITORIA))


def t_permiso_escritura_unificado():
    _reset()
    # El caso que bloqueaba la apertura: miembro del Catálogo que NO está en el área
    # de cubicaciones. Antes: 403 al guardar después de diseñar el template entero.
    e = http(crear_template, TemplateCrear(nombre="T", tipo="viga", params=receta_editor()), user=MIEMBRO)
    check("un 'miembro' del Catálogo YA puede guardar (era el 403 que bloqueaba)", e is None, e and e.detail)
    # El que podía antes (área cubicaciones) sigue pudiendo: nadie pierde permiso.
    e = http(crear_template, TemplateCrear(nombre="T2", tipo="viga", params=receta_enfierrador(), obra="OB-1"), user=CUBICADOR)
    check("el Enfierrador (área cubicaciones) sigue guardando", e is None, e and e.detail)
    # Cliente: fuera.
    e = http(crear_template, TemplateCrear(nombre="T3", tipo="viga", params=receta_editor()), user=CLIENTE)
    check("un 'cliente' NO puede crear templates (403)", e is not None and e.status_code == 403, e)


def t_lectura_cerrada():
    _reset()
    crear_template(TemplateCrear(nombre="T", tipo="viga", params=receta_editor()), user=MIEMBRO)
    e = http(listar_templates, user=CLIENTE)
    check("GET lista: un 'cliente' recibe 403 (antes leía todo)", e is not None and e.status_code == 403, e)
    e = http(ver_template, 1, user=CLIENTE)
    check("GET detalle: un 'cliente' recibe 403", e is not None and e.status_code == 403, e)
    e = http(listar_templates, user=CUBICADOR)
    check("GET lista: personal interno sigue leyendo", e is None, e and e.detail)


def t_get_lista_con_receta():
    """EL LISTADO TRAE LA RECETA (26-ago) — el cambio que hace posible el corte real.

    Hasta acá `params` NO viajaba, y el motivo escrito era «la receta completa puede
    pesar cientos de KB». Estaba medido a ojo: una receta real pesa ~2 KB y NO crece
    con las barras (se guarda la RECETA, no el resultado). Por no mandarla, el gestor
    dibujaba la sección desde un resumen que el backend derivaba a mano, y de ahí sólo
    salía un ESQUEMA — el motor que sitúa las barras es JS y vive en el navegador.
    Ahora viaja la receta y el navegador dibuja el corte de verdad.

    Lo que este test cuida es que el cambio no se pague en otro sitio: que el listado
    siga costando UNA sola consulta y que la fila no se vuelva un objeto pesado."""
    _reset()
    crear_template(TemplateCrear(nombre="Viga tipo A", tipo="viga", params=receta_editor(), obra="OB-1"), user=MIEMBRO)
    crear_template(TemplateCrear(nombre="Muro perimetral", tipo="muro", params=receta_editor()), user=MIEMBRO)
    r = listar_templates(user=MIEMBRO)
    tpls = r["templates"]
    check("GET lista devuelve los 2", len(tpls) == 2, len(tpls))
    check("GET lista SÍ trae params (la receta, para dibujar el corte con el motor)",
          all(isinstance(t.get("params"), dict) and t["params"].get("componentes") for t in tpls),
          list(tpls[0].keys()))
    check("y trae la geometría, que es de donde sale el hormigón del corte",
          all(t["params"].get("geometria") for t in tpls))
    # EL PESO, MEDIDO. No es un adorno: es el número que decidió este cambio.
    n = max(len(json.dumps(t["params"])) for t in tpls)
    check("la receta que viaja pesa %d bytes, no cientos de KB" % n, n < 20000, n)
    # --- y sigue costando UNA consulta -------------------------------------------
    for i in range(10):
        crear_template(TemplateCrear(nombre="Extra %d" % i, tipo="muro", params=receta_editor()), user=MIEMBRO)
    m = len(CONSULTAS)
    filas = listar_templates(user=MIEMBRO)["templates"]
    check("el listado CON receta sigue costando UNA sola consulta (12 templates)",
          len(CONSULTAS) - m == 1, len(CONSULTAS) - m)
    check("los 12 traen su receta", all(t.get("params") for t in filas), len(filas))
    _reset()
    crear_template(TemplateCrear(nombre="Viga tipo A", tipo="viga", params=receta_editor(), obra="OB-1"), user=MIEMBRO)
    crear_template(TemplateCrear(nombre="Muro perimetral", tipo="muro", params=receta_editor()), user=MIEMBRO)
    tpls = listar_templates(user=MIEMBRO)["templates"]
    campos = {"id", "nombre", "tipo", "obra", "fecha", "n_componentes"}
    check("GET lista trae id/nombre/tipo/obra/fecha/n_componentes", campos.issubset(set(tpls[0].keys())), tpls[0].keys())
    por_nombre = {t["nombre"]: t for t in tpls}
    check("GET lista cuenta componentes", por_nombre["Viga tipo A"]["n_componentes"] == 2,
          por_nombre["Viga tipo A"]["n_componentes"])
    check("GET lista resuelve el nombre de la obra", por_nombre["Viga tipo A"]["obra_nombre"] == "Edificio Explora")
    check("GET lista dice si el usuario puede modificar cada uno",
          all(t["puede_modificar"] for t in tpls) and
          not any(t["puede_modificar"] for t in listar_templates(user=OTRO_MIEMBRO)["templates"]))
    check("GET lista filtra por tipo", len(listar_templates(tipo="muro", user=MIEMBRO)["templates"]) == 1)
    check("GET lista filtra por nombre (contiene, sin mayúsculas)",
          [t["nombre"] for t in listar_templates(nombre="viga", user=MIEMBRO)["templates"]] == ["Viga tipo A"])
    check("GET lista con nombre que no existe devuelve vacío",
          listar_templates(nombre="zzz", user=MIEMBRO)["templates"] == [])
    # Prioridad de obra en el orden.
    orden = [t["nombre"] for t in listar_templates(obra="OB-1", user=MIEMBRO)["templates"]]
    check("GET lista prioriza la obra pedida", orden[0] == "Viga tipo A", orden)


def t_uso_por_template():
    """CUÁNTO SE HA USADO cada template (n_usos / n_obras) — el dato con el que se
    ordena la biblioteca desde el 25-ago.

    Por qué existe: el gestor ordenaba por última edición, que responde "quién
    estuvo trabajando", no "cuál ya funcionó". El dato ya estaba en
    elementos_template y nadie lo leía. Y por qué se cuentan las CONSULTAS: la
    forma natural de equivocarse aquí es un COUNT por template dentro del for."""
    _reset()
    crear_template(TemplateCrear(nombre="Viga que funciona", tipo="viga", params=receta_editor()), user=MIEMBRO)
    crear_template(TemplateCrear(nombre="Viga recién nacida", tipo="viga", params=receta_editor()), user=MIEMBRO)
    STORE["lotes"] = {10: "OB-1", 11: "OB-1", 12: "OB-2"}
    STORE["instancias"] = [
        # Tres estructuras del template 1: dos en OB-1 y una en OB-2 → 2 obras.
        {"id": 1, "template_id": 1, "lote_id": 10, "id_proyecto": None},
        {"id": 2, "template_id": 1, "lote_id": 11, "id_proyecto": None},
        {"id": 3, "template_id": 1, "lote_id": 12, "id_proyecto": None},
        # Sin lote ni traza de obra: cuenta como USO pero no puede sumar una obra.
        {"id": 4, "template_id": 1, "lote_id": None, "id_proyecto": None},
        # Del OTRO template: no debe filtrarse al primero.
        {"id": 5, "template_id": 2, "lote_id": 10, "id_proyecto": None},
    ]
    por = {t["nombre"]: t for t in listar_templates(user=MIEMBRO)["templates"]}
    usado, nuevo = por["Viga que funciona"], por["Viga recién nacida"]
    check("GET lista cuenta las veces usado", usado["n_usos"] == 4, usado["n_usos"])
    check("GET lista cuenta las OBRAS distintas (no las instancias)",
          usado["n_obras"] == 2, usado["n_obras"])
    check("una instancia sin obra rastreable suma uso y NO suma obra",
          usado["n_usos"] == 4 and usado["n_obras"] == 2)
    check("el conteo no se cruza entre templates", nuevo["n_usos"] == 1, nuevo["n_usos"])

    # Un template SIN NINGUNA instancia sale en 0, no en None: "sin usar" es un dato
    # que el front tiene que poder decir con palabra, no un hueco.
    STORE["instancias"] = []
    sin_uso = listar_templates(user=MIEMBRO)["templates"][0]
    check("un template nunca usado sale en 0 (no en null)",
          sin_uso["n_usos"] == 0 and sin_uso["n_obras"] == 0,
          (sin_uso["n_usos"], sin_uso["n_obras"]))

    # La obra estampada en la instancia (post-107) le gana a la del lote.
    STORE["instancias"] = [{"id": 1, "template_id": 1, "lote_id": 10, "id_proyecto": "OB-2"}]
    r = {t["nombre"]: t for t in listar_templates(user=MIEMBRO)["templates"]}
    check("la obra de la instancia manda sobre la del lote (COALESCE)",
          r["Viga que funciona"]["n_obras"] == 1, r["Viga que funciona"]["n_obras"])

    # --- N+1: el listado entero tiene que costar UNA consulta ---
    n = len(CONSULTAS)
    listar_templates(user=MIEMBRO)
    check("el listado entero cuesta UNA sola consulta", len(CONSULTAS) - n == 1, len(CONSULTAS) - n)
    for i in range(6):
        crear_template(TemplateCrear(nombre="Extra %d" % i, tipo="muro", params=receta_editor()), user=MIEMBRO)
    n = len(CONSULTAS)
    filas = listar_templates(user=MIEMBRO)["templates"]
    check("y sigue costando UNA con 8 templates (no crece con la lista)",
          len(CONSULTAS) - n == 1, len(CONSULTAS) - n)
    check("los 8 traen su conteo", all(("n_usos" in t and "n_obras" in t) for t in filas), len(filas))

    # El filtro por tipo sigue funcionando con el JOIN nuevo (el WHERE de afuera no
    # se puede confundir con el del subselect agregado).
    check("el filtro por tipo convive con el JOIN del uso",
          len(listar_templates(tipo="muro", user=MIEMBRO)["templates"]) == 6)


def t_get_detalle_trae_receta():
    _reset()
    crear_template(TemplateCrear(nombre="Viga tipo A", tipo="viga", params=receta_editor(), obra="OB-1"), user=MIEMBRO)
    d = ver_template(1, user=MIEMBRO)
    check("GET detalle SÍ trae params", isinstance(d.get("params"), dict) and d["params"].get("componentes"))
    check("GET detalle trae schema_version", d["schema_version"] == 2, d["schema_version"])
    check("GET detalle: el autor puede modificar", d["puede_modificar"] is True)
    check("GET detalle: otro miembro NO puede modificar", ver_template(1, user=OTRO_MIEMBRO)["puede_modificar"] is False)
    check("GET detalle: un admin puede modificar", ver_template(1, user=ADMIN)["puede_modificar"] is True)
    e = http(ver_template, 999, user=MIEMBRO)
    check("GET detalle inexistente = 404", e is not None and e.status_code == 404, e)


def t_put_edita():
    _reset()
    crear_template(TemplateCrear(nombre="Viga tipo A", tipo="viga", params=receta_editor(), obra="OB-1"), user=MIEMBRO)
    r = actualizar_template(1, TemplateActualizar(nombre="Viga tipo A (v2)"), user=MIEMBRO)
    check("PUT responde ok", r.get("ok") is True, r)
    fila = STORE["templates"][0]
    check("PUT cambia el nombre", fila["nombre"] == "Viga tipo A (v2)", fila["nombre"])
    check("PUT NO destructivo: no toca la obra", fila["obra"] == "OB-1", fila["obra"])
    check("PUT NO destructivo: no toca la receta", _params_obj(fila).get("componentes"), "receta borrada")
    check("PUT estampa updated_at/editado_por", fila["editado_por"] == MIEMBRO["email"] and bool(fila["updated_at"]))
    check("PUT no crea una copia (la biblioteca no crece)", len(STORE["templates"]) == 1, len(STORE["templates"]))
    # Cambiar la receta re-estampa el shape.
    actualizar_template(1, TemplateActualizar(params=receta_enfierrador()), user=MIEMBRO)
    check("PUT re-estampa schema_version según la receta nueva", STORE["templates"][0]["schema_version"] == 1,
          STORE["templates"][0]["schema_version"])
    # Vaciar la obra es una acción EXPLÍCITA (obra=None enviado).
    actualizar_template(1, TemplateActualizar(obra=None), user=MIEMBRO)
    check("PUT con obra=null explícito la deja general", STORE["templates"][0]["obra"] is None)
    e = http(actualizar_template, 1, TemplateActualizar(), user=MIEMBRO)
    check("PUT sin ningún campo = 400", e is not None and e.status_code == 400, e)
    e = http(actualizar_template, 999, TemplateActualizar(nombre="x"), user=ADMIN)
    check("PUT de un id inexistente = 404", e is not None and e.status_code == 404, e)


def t_put_de_otro_rechazado():
    _reset()
    crear_template(TemplateCrear(nombre="Viga de Ana", tipo="viga", params=receta_editor()), user=MIEMBRO)
    e = http(actualizar_template, 1, TemplateActualizar(nombre="mío"), user=OTRO_MIEMBRO)
    check("PUT de otro usuario = 403", e is not None and e.status_code == 403, e)
    check("PUT rechazado no modificó nada", STORE["templates"][0]["nombre"] == "Viga de Ana")
    e = http(actualizar_template, 1, TemplateActualizar(nombre="mío"), user=CLIENTE)
    check("PUT de un rol sin permiso de gestión = 403", e is not None and e.status_code == 403, e)
    e = http(actualizar_template, 1, TemplateActualizar(nombre="corregido"), user=ADMIN)
    check("PUT de un admin sobre template ajeno = permitido", e is None, e and e.detail)
    e = http(eliminar_template, 1, user=OTRO_MIEMBRO)
    check("DELETE de otro usuario = 403", e is not None and e.status_code == 403, e)


def t_delete():
    _reset()
    crear_template(TemplateCrear(nombre="Viga tipo A", tipo="viga", params=receta_editor()), user=MIEMBRO)
    crear_template(TemplateCrear(nombre="Viga tipo B", tipo="viga", params=receta_editor()), user=MIEMBRO)
    # La 2 quedó usada por 2 instancias.
    STORE["instancias"] = [{"id": 1, "template_id": 2}, {"id": 2, "template_id": 2}]
    e = http(eliminar_template, 2, user=MIEMBRO)
    check("DELETE con instancias = 409", e is not None and e.status_code == 409, e)
    check("el 409 dice CUÁNTAS instancias lo usan", e is not None and "2 elemento" in str(e.detail), e and e.detail)
    check("DELETE con instancias NO borra", any(t["id"] == 2 for t in STORE["templates"]))
    r = eliminar_template(1, user=MIEMBRO)
    check("DELETE sin instancias borra", r.get("ok") and not any(t["id"] == 1 for t in STORE["templates"]))
    check("DELETE audita", any(a[1] == "eliminar_template" for a in AUDITORIA))
    e = http(eliminar_template, 1, user=MIEMBRO)
    check("DELETE de un id ya borrado = 404", e is not None and e.status_code == 404, e)


def t_receta_invalida_422():
    _reset()
    def crear(params, nombre="X", user=MIEMBRO, obra=None):
        return http(crear_template, TemplateCrear(nombre=nombre, tipo="viga", params=params, obra=obra), user=user)

    r = receta_editor(); r["componentes"] = []
    e = crear(r)
    check("422 si no hay componentes", e is not None and e.status_code == 422, e)
    check("el 422 dice qué falta (barras)", e is not None and "barra" in str(e.detail).lower(), e and e.detail)

    r = receta_editor(); r["componentes"][0]["figura"] = "999Z"
    e = crear(r)
    check("422 si la figura no existe en el catálogo", e is not None and e.status_code == 422, e)
    check("el 422 nombra la figura inexistente", e is not None and "999Z" in str(e.detail), e and e.detail)

    r = receta_editor(); r["componentes"][0]["dims"]["A"] = {"modo": "fija", "valor": None}
    e = crear(r)
    check("422 si una dim 'fija' viene sin medida", e is not None and e.status_code == 422, e)
    check("el 422 dice cómo salir (medida o auto)", e is not None and "auto" in str(e.detail).lower(), e and e.detail)

    r = receta_editor(); r["componentes"][0]["dims"]["A"] = {"modo": "fija", "valor": -30}
    e = crear(r)
    check("422 si una medida es NEGATIVA", e is not None and e.status_code == 422, e)

    r = receta_editor(); r["componentes"][1]["diam"] = 0
    e = crear(r)
    check("422 si un componente no tiene diámetro", e is not None and e.status_code == 422, e)

    r = receta_editor(); del r["geometria"]
    e = crear(r)
    check("422 si no hay dimensiones de hormigón", e is not None and e.status_code == 422, e)

    check("ninguna receta inválida quedó guardada", STORE["templates"] == [], len(STORE["templates"]))

    # El PUT valida igual que el POST.
    _reset()
    crear_template(TemplateCrear(nombre="Viga", tipo="viga", params=receta_editor()), user=MIEMBRO)
    mala = receta_editor(); mala["componentes"][0]["figura"] = "NO-EXISTE"
    e = http(actualizar_template, 1, TemplateActualizar(params=mala), user=MIEMBRO)
    check("PUT con receta inválida = 422", e is not None and e.status_code == 422, e)
    check("PUT rechazado no pisó la receta buena",
          _params_obj(STORE["templates"][0])["componentes"][0]["figura"] == "103B")


def t_lo_que_hoy_SI_se_guarda():
    """NO-REGRESIÓN DE PRODUCCIÓN. Estados que el front genera POR DISEÑO y que la
    validación llegó a rechazar: cada uno de estos es un guardado que hoy funciona y
    que un 422 convertía en trabajo perdido. Si alguno vuelve a dar 422, se rompió el
    Enfierrador o el Template Editor, no "una receta mala"."""
    _reset()

    def guarda(msg, params, user=MIEMBRO):
        e = http(crear_template, TemplateCrear(nombre=msg[:40], tipo="viga", params=params), user=user)
        check(msg, e is None, e and e.detail)

    # 1) PARCIAL SIN DECLARAR = 'auto'. Es el default documentado del motor
    #    (reglas.js _dimsCanon rellena los parciales del spec que la receta no trae).
    r = receta_editor(); del r["componentes"][0]["dims"]["B"]
    guarda("un parcial sin declarar NO bloquea (es 'auto', el default del motor)", r)

    # 2) CAMBIAR LA FIGURA SIN RECONCILIAR LAS DIMS. El caso lo destapó el panel del
    #    Enfierrador MVP (panel_3d.js, retirado el 25-ago), donde la figura se escribía
    #    a mano y las dims no se tocaban: una 101A (sólo A) pasaba a 104D (A,B,C,D) con
    #    sólo el lado A declarado. La regla que se congela NO es de aquel panel sino
    #    del backend —un parcial sin declarar es 'auto', no un error—, y las recetas
    #    guardadas así siguen en la tabla y se reabren.
    r = receta_editor(); r["componentes"][1]["figura"] = "104D"   # nació 101A con dims {A: auto}
    guarda("cambiar la figura sin reconciliar dims sigue guardando", r)

    # 3-4) ASSERTS INVERTIDOS (15-ago): aquí se congelaba «un 0 es DATO, no un
    #    hueco» — pero el DESPIECE (catalogo._tiene_valor_real) trata el 0 como
    #    slot FALTANTE: el template guardaba con 200 y al cargarlo el lote ENTERO
    #    rebotaba con 400 (hallazgo confirmado de la revisión). Los dos backends
    #    dicen ahora lo mismo: 0 en un parcial USADO se rechaza AL GUARDAR, con
    #    mensaje que explica el porqué, en los dos shapes.
    def rechaza0(msg, params, user=MIEMBRO):
        e = http(crear_template, TemplateCrear(nombre=msg[:40], tipo="viga", params=params), user=user)
        check(msg, e is not None and e.status_code == 422 and "0" in str(e.detail), e and e.detail)

    r = receta_editor(); r["componentes"][0]["dims"]["A"] = {"modo": "fija", "valor": 0}
    rechaza0("un lado en «fija» con 0 se RECHAZA al guardar (el despiece lo trata como faltante)", r)

    r = receta_enfierrador(); r["componentes"][0]["dims"]["C"] = 0
    rechaza0("shape plano con un lado usado en 0 se RECHAZA igual", r, user=CUBICADOR)

    # 5) Un lado declarado en null = no declarado (el front lo resuelve como 'auto').
    r = receta_editor(); r["componentes"][0]["dims"]["B"] = None
    guarda("un lado en null se guarda (el normalizador lo resuelve como 'auto')", r)

    check("y los 3 válidos quedaron guardados de verdad", len(STORE["templates"]) == 3, len(STORE["templates"]))

    # El PUT valida IGUAL que el POST: un template ya guardado con cualquiera de estos
    # estados tiene que poder seguir editándose (era el otro lado del bloqueo).
    r = receta_editor(); del r["componentes"][0]["dims"]["B"]
    e = http(actualizar_template, 1, TemplateActualizar(params=r), user=MIEMBRO)
    check("el PUT tampoco bloquea un parcial sin declarar", e is None, e and e.detail)


def t_enfierrador_shape_viejo():
    _reset()
    r = crear_template(TemplateCrear(nombre="Viga enfierrador", tipo="viga",
                                     params=receta_enfierrador(), obra="OB-1"), user=CUBICADOR)
    check("el shape del ENFIERRADOR (dims planas) se sigue guardando", r.get("ok") is True, r)
    check("se estampa schema_version=1 para las dims planas",
          STORE["templates"][0]["schema_version"] == 1, STORE["templates"][0]["schema_version"])
    d = ver_template(1, user=CUBICADOR)
    check("el shape viejo se sigue leyendo entero", d["params"]["componentes"][0]["dims"]["A"] == 22, d["params"])
    check("la lista también lo muestra", listar_templates(user=CUBICADOR)["templates"][0]["n_componentes"] == 1)


def t_filas_legacy_sin_schema_version():
    """Filas escritas ANTES de la migración 105: schema_version NULL. Se deduce al
    LEER; la fila NO se reescribe."""
    _reset()
    STORE["templates"] = [
        {"id": 1, "nombre": "Legacy editor", "tipo": "viga", "obra": None,
         "creado_por": "ana@armacero.cl", "fecha": "2026-01-01", "schema_version": None,
         "updated_at": None, "editado_por": None, "params": json.dumps(receta_editor())},
        {"id": 2, "nombre": "Legacy enfierrador", "tipo": "viga", "obra": "OB-1",
         "creado_por": "cubi@armacero.cl", "fecha": "2026-01-02", "schema_version": None,
         "updated_at": None, "editado_por": None, "params": json.dumps(receta_enfierrador())},
    ]
    STORE["seq"]["templates"] = 2
    por_id = {t["id"]: t for t in listar_templates(user=MIEMBRO)["templates"]}
    check("lista: fila legacy del editor deduce schema_version=2", por_id[1]["schema_version"] == 2, por_id[1])
    check("lista: fila legacy del enfierrador deduce schema_version=1", por_id[2]["schema_version"] == 1, por_id[2])
    check("detalle: fila legacy deduce schema_version", ver_template(2, user=MIEMBRO)["schema_version"] == 1)
    check("leer NO reescribió la tabla", all(t["schema_version"] is None for t in STORE["templates"]))
    check("un template legacy sigue abriendo con su receta completa",
          ver_template(1, user=MIEMBRO)["params"]["componentes"][0]["figura"] == "103B")
    # Al EDITAR esa fila sí se aprovecha para estampar el shape (ya se está escribiendo).
    actualizar_template(1, TemplateActualizar(nombre="Legacy editado"), user=ADMIN)
    check("el PUT estampa el schema_version deducido de la fila legacy",
          STORE["templates"][0]["schema_version"] == 2, STORE["templates"][0]["schema_version"])
    check("la receta legacy quedó intacta tras el PUT de nombre",
          _params_obj(STORE["templates"][0])["componentes"][0]["figura"] == "103B")


def t_obra():
    _reset()
    e = http(crear_template, TemplateCrear(nombre="X", tipo="viga", params=receta_editor(), obra="OB-INVENTADA"), user=MIEMBRO)
    check("obra inexistente = 422", e is not None and e.status_code == 422, e)
    crear_template(TemplateCrear(nombre="General", tipo="viga", params=receta_editor(), obra="   "), user=MIEMBRO)
    check("obra vacía = general (None)", STORE["templates"][0]["obra"] is None, STORE["templates"][0]["obra"])
    e = http(actualizar_template, 1, TemplateActualizar(obra="OB-INVENTADA"), user=MIEMBRO)
    check("PUT con obra inexistente = 422", e is not None and e.status_code == 422, e)
    actualizar_template(1, TemplateActualizar(obra="OB-2"), user=MIEMBRO)
    check("PUT asigna una obra real", STORE["templates"][0]["obra"] == "OB-2")


def t_deduccion_shape_unitaria():
    check("deducción: dims {modo,valor} -> 2", M._deducir_schema_version({"A": {"modo": "auto"}}) == 2)
    check("deducción: dims planas -> 1", M._deducir_schema_version({"A": 30}) == 1)
    check("deducción: sin dims -> shape actual", M._deducir_schema_version({}) == M.SCHEMA_ACTUAL)
    check("deducción: acepta dims en texto JSON", M._deducir_schema_version('{"A": 30}') == 1)


def main():
    for t in (t_post_crea, t_permiso_escritura_unificado, t_lectura_cerrada,
              t_get_lista_con_receta, t_uso_por_template,
              t_get_detalle_trae_receta, t_put_edita,
              t_put_de_otro_rechazado, t_delete, t_receta_invalida_422,
              t_lo_que_hoy_SI_se_guarda,
              t_enfierrador_shape_viejo, t_filas_legacy_sin_schema_version,
              t_obra, t_deduccion_shape_unitaria):
        print("\n--- " + t.__name__ + " ---")
        t()
    if FALLOS:
        print("\nFALLARON %d chequeo(s): %s" % (len(FALLOS), FALLOS))
        return 1
    print("\nOK — ciclo de vida del template (permisos, validación, PUT/DELETE, schema_version).")
    return 0


def test_ciclo_vida_template():
    """Entrada para pytest, si algún día está instalado."""
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
