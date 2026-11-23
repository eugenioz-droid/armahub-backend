# -*- coding: utf-8 -*-
"""
calidad — el medidor de calidad del código de ArmaHub (PROTOCOLO_GENERAL_REP §10, acordado con el usuario el
23-nov-2026). Es el de ArmaScanner (ArmaScanner/empaquetar/calidad.py) llevado a ArmaHub: Python y JavaScript.

    py -3.12 scripts/calidad/calidad.py              mide lo que hay en disco y lo compara con la base
    py -3.12 scripts/calidad/calidad.py --detalle    además, todo lo que está fuera del estándar
    py -3.12 scripts/calidad/calidad.py --ref <sha>  mide ese commit contra la base de ese commit (gancho pre-push)
    py -3.12 scripts/calidad/calidad.py --base       deja el último commit (HEAD) como la base nueva

Qué mide, en armahub/:
  complejidad  McCabe por función (NIST SP 500-235): límite 10; hasta 15 con «# mccabe: <motivo>» (en JS,
               «// mccabe: <motivo>») en la línea de la función o en la de arriba. Python con el conteo del
               medidor de ArmaScanner; JavaScript con la regla `complexity` de ESLint (complejidad_js.js).
  muerto       lo que pyflakes encuentra sin uso (importaciones, variables) o roto (nombres sin definir).
  duplicado    funciones Python con el mismo cuerpo (5 instrucciones o más) en dos lugares.
  capas        un módulo que importa de un módulo de rutas (el que crea un APIRouter), salvo main.py que las
               monta: lo que se comparte va en un módulo sin rutas. Y un módulo sin rutas que importa fastapi:
               la lógica no sabe de HTTP. Es el patrón de chequeos.py (lógica pura) + chequeos_api.py (rutas).
  (muerto, duplicado y capas son debilidades de mantenibilidad de ISO/IEC 5055.)

Lo existente no se arregla de golpe: calidad_base.json guarda cómo estaba y cada push se compara con ella. Una
función sobre el límite no puede volverse más compleja y una nueva tiene que cumplir; muerto, duplicado y capas no
pueden aumentar. UNA FUNCIÓN QUE SÓLO SE MUDÓ de archivo (ordenar un módulo grande es eso) no cuenta como nueva:
si desapareció de su archivo y apareció con el mismo nombre en otro, se la compara con lo que tenía.

El gancho scripts/hooks/pre-push lo corre en cada push (el push a main publica en Render): si empeoró, no sube.
Se activa una vez por clon con «git config core.hooksPath scripts/hooks».
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
BASE = os.path.join(AQUI, "calidad_base.json")
BASE_EN_GIT = "scripts/calidad/calidad_base.json"
CARPETA_PY, CARPETA_JS = "armahub/", "armahub/static/js/"
LIMITE, LIMITE_CON_MOTIVO = 10, 15
MIN_DUPLICADO = 5  # instrucciones: menos que eso es un ayudante corto, no un duplicado que importe
DECISION = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler, ast.IfExp, ast.Assert)
FUNCION = (ast.FunctionDef, ast.AsyncFunctionDef)
NODE_PORTABLE = r"C:\Users\ezalazar\Tools\node\node-v24.16.0-win-x64\node.exe"


def mccabe(fn) -> int:
    """1 + los puntos de decisión de la función, sin contar los de sus funciones anidadas."""
    n, pila = 1, list(ast.iter_child_nodes(fn))
    while pila:
        x = pila.pop()
        if isinstance(x, FUNCION + (ast.Lambda, ast.ClassDef)):
            continue
        if isinstance(x, DECISION):
            n += 1
        elif isinstance(x, ast.BoolOp):
            n += len(x.values) - 1
        elif isinstance(x, ast.comprehension):
            n += len(x.ifs)
        elif isinstance(x, ast.match_case):
            n += 1
        pila.extend(ast.iter_child_nodes(x))
    return n


# ── De dónde se leen los archivos: el disco o un commit ─────────────────────────────────────────────

def _git(*args, entrada=None) -> bytes:
    return subprocess.run(["git", *args], cwd=RAIZ, input=entrada, capture_output=True, check=True).stdout


def _de_commit(ref: str) -> dict:
    """{ruta: texto} de armahub/ en ese commit, leído de una sola vez (git cat-file --batch)."""
    rutas = [r for r in _git("ls-tree", "-r", "--name-only", ref, "--", "armahub").decode("utf-8").splitlines()
             if r.endswith((".py", ".js"))]
    salida = _git("cat-file", "--batch", entrada="".join(f"{ref}:{r}\n" for r in rutas).encode("utf-8"))
    textos, i = {}, 0
    for r in rutas:
        cab_fin = salida.index(b"\n", i)
        tam = int(salida[i:cab_fin].split()[2])
        textos[r] = salida[cab_fin + 1:cab_fin + 1 + tam].decode("utf-8")
        i = cab_fin + 1 + tam + 1
    return textos


def _de_disco() -> dict:
    textos = {}
    for carpeta, dirs, archivos in os.walk(os.path.join(RAIZ, "armahub")):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for a in sorted(archivos):
            if a.endswith((".py", ".js")):
                ruta = os.path.join(carpeta, a)
                with open(ruta, encoding="utf-8") as fh:
                    textos[os.path.relpath(ruta, RAIZ).replace("\\", "/")] = fh.read()
    return textos


# ── Python ─────────────────────────────────────────────────────────────────────────────────────────

def _cuerpo(fn):
    """El cuerpo sin el docstring, para comparar funciones."""
    b = fn.body
    if b and isinstance(b[0], ast.Expr) and isinstance(getattr(b[0], "value", None), ast.Constant) \
            and isinstance(b[0].value.value, str):
        b = b[1:]
    return b


def _con_nombre(arbol):
    """Cada función con su nombre completo: «Clase.metodo», «externa.interna»."""
    pila = [(arbol, "")]
    while pila:
        nodo, prefijo = pila.pop()
        for hijo in ast.iter_child_nodes(nodo):
            if isinstance(hijo, FUNCION + (ast.ClassDef,)):
                nombre = prefijo + hijo.name
                if isinstance(hijo, FUNCION):
                    yield nombre, hijo
                pila.append((hijo, nombre + "."))
            else:
                pila.append((hijo, prefijo))


def _muerto(texto, archivo):
    from pyflakes import api
    from pyflakes import reporter as rep

    class Junta(rep.Reporter):
        def __init__(self):
            super().__init__(None, None)
            self.mensajes = []

        def unexpectedError(self, filename, msg):
            self.mensajes.append(f"{archivo}: {msg}")

        def syntaxError(self, filename, msg, lineno, offset, text):
            self.mensajes.append(f"{archivo}:{lineno}: {msg}")

        def flake(self, message):
            self.mensajes.append(f"{archivo}:{message.lineno}: {message.message % message.message_args}")

    j = Junta()
    api.check(texto, archivo, j)
    return j.mensajes


def _modulo(archivo: str) -> str:
    """armahub/chequeos_api.py → chequeos_api; armahub/x/__init__.py → x."""
    m = archivo[len(CARPETA_PY):-3].replace("/", ".")
    return m[:-len(".__init__")] if m.endswith(".__init__") else m


def _destino(n: ast.ImportFrom, paquete: str):
    """El módulo de armahub de un «from … import», o None si es de afuera."""
    if n.level:
        partes = paquete.split(".") if paquete else []
        base = partes[:len(partes) - (n.level - 1)]
        return ".".join([*base, *(n.module.split(".") if n.module else [])])
    if n.module and n.module.startswith("armahub."):
        return n.module[len("armahub."):]
    return None


def _dependencias(arbol) -> set:
    """Los nombres que el módulo usa en Depends(…) o Security(…): eso es cablear HTTP, no compartir lógica."""
    nombres = set()
    for n in ast.walk(arbol):
        if isinstance(n, ast.Call) and getattr(n.func, "id", None) in ("Depends", "Security") and n.args:
            a = n.args[0]
            a = a.func if isinstance(a, ast.Call) else a
            if isinstance(a, ast.Name):
                nombres.add(a.id)
    return nombres


def _de_rutas(arbol, modulo: str, rutas: set) -> dict:
    """{módulo de rutas: [nombres]} que este módulo trae de otro módulo de rutas, sin las dependencias de
    FastAPI (get_current_user en Depends es lo normal entre módulos de rutas)."""
    paquete = modulo.rsplit(".", 1)[0] if "." in modulo else ""
    deps, salida = _dependencias(arbol), defaultdict(list)
    for n in ast.walk(arbol):
        if isinstance(n, ast.ImportFrom):
            destino = _destino(n, paquete)
            if destino is None:
                continue
            for a in n.names:
                if f"{destino}.{a.name}".strip(".") in rutas:          # from . import armascanner
                    salida[f"{destino}.{a.name}".strip(".")].append("(el módulo)")
                elif destino in rutas and (a.asname or a.name) not in deps:
                    salida[destino].append(a.name)
        elif isinstance(n, ast.Import):
            for a in n.names:
                if a.name.startswith("armahub.") and a.name[len("armahub."):] in rutas:
                    salida[a.name[len("armahub."):]].append("(el módulo)")
    salida.pop(modulo, None)
    return salida


def _crea_router(arbol) -> bool:
    return any(isinstance(n, ast.Call) and getattr(n.func, "id", getattr(n.func, "attr", None)) == "APIRouter"
               for n in ast.walk(arbol))


def _usa_fastapi(arbol) -> bool:
    return any((isinstance(n, ast.ImportFrom) and (n.module or "").split(".")[0] == "fastapi" and not n.level)
               or (isinstance(n, ast.Import) and any(a.name.split(".")[0] == "fastapi" for a in n.names))
               for n in ast.walk(arbol))


def _medir_py(textos: dict, complejas: dict, lugares: dict) -> dict:
    cuerpos = defaultdict(list)      # huella del cuerpo → ["archivo:función"]
    muerto, funciones, arboles = [], 0, {}
    for archivo, texto in sorted(textos.items()):
        lineas = texto.splitlines()
        arbol = ast.parse(texto)
        arboles[archivo] = arbol
        for nombre, fn in _con_nombre(arbol):
            funciones += 1
            c = mccabe(fn)
            motivo = any("# mccabe:" in lineas[i] for i in (fn.lineno - 2, fn.lineno - 1) if 0 <= i < len(lineas))
            if c > LIMITE and not (motivo and c <= LIMITE_CON_MOTIVO):
                clave = f"{archivo}::{nombre}"
                complejas[clave] = c
                lugares[clave] = f"{archivo}:{fn.lineno}"
            cuerpo = _cuerpo(fn)
            if len(cuerpo) >= MIN_DUPLICADO:
                huella = hashlib.sha1("".join(ast.dump(s) for s in cuerpo).encode()).hexdigest()[:12]
                cuerpos[huella].append(f"{archivo}:{nombre}")
        muerto += _muerto(texto, archivo)
    rutas = {_modulo(a) for a, t in arboles.items() if _crea_router(t)}
    capas = []
    for archivo, arbol in sorted(arboles.items()):
        modulo = _modulo(archivo)
        if modulo == "main":
            continue
        # Uno por nombre: traer una cosa más de un módulo de rutas empeora, aunque ya se trajera otra.
        for r, nombres in sorted(_de_rutas(arbol, modulo, rutas).items()):
            capas += [f"{archivo}: trae {x} del módulo de rutas {r}" for x in sorted(set(nombres))]
        if modulo not in rutas and _usa_fastapi(arbol):
            capas.append(f"{archivo}: usa fastapi sin ser un módulo de rutas")
    duplicados = sorted(" = ".join(sorted(v)) for v in cuerpos.values() if len(v) > 1)
    return {"funciones": funciones, "muerto": sorted(muerto), "duplicados": duplicados, "capas": capas}


# ── JavaScript ─────────────────────────────────────────────────────────────────────────────────────

def _node() -> str:
    node = shutil.which("node") or (NODE_PORTABLE if os.path.isfile(NODE_PORTABLE) else None)
    if not node:
        raise SystemExit("calidad: no encuentro node (ni en el PATH ni el portable en " + NODE_PORTABLE + ")")
    if not os.path.isdir(os.path.join(AQUI, "node_modules", "eslint")):
        raise SystemExit("calidad: falta ESLint. Una vez: cd scripts/calidad && npm install")
    return node


def _medir_js(textos: dict, complejas: dict, lugares: dict) -> dict:
    entrada = json.dumps([{"archivo": a, "texto": t} for a, t in sorted(textos.items())])
    r = subprocess.run([_node(), os.path.join(AQUI, "complejidad_js.js")], input=entrada.encode("utf-8"),
                       capture_output=True, check=True)
    salida = json.loads(r.stdout.decode("utf-8"))
    vistas = defaultdict(int)
    for f in salida["filas"]:
        if f["c"] > LIMITE and not (f["motivo"] and f["c"] <= LIMITE_CON_MOTIVO):
            clave = f"{f['archivo']}::{f['nombre']}"
            # Dos funciones sin nombre propio pueden quedar con el mismo nombre completo (dos callbacks en
            # funciones homónimas del mismo archivo): se numeran para no pisarse.
            vistas[clave] += 1
            if vistas[clave] > 1:
                clave += f" #{vistas[clave]}"
            complejas[clave] = f["c"]
            lugares[clave] = f"{f['archivo']}:{f['linea']}"
    return {"funciones": len(salida["filas"]), "errores": salida["errores"]}


# ── Medir y comparar ───────────────────────────────────────────────────────────────────────────────

def medir(ref: str | None = None) -> dict:
    textos = _de_commit(ref) if ref else _de_disco()
    py = {a: t for a, t in textos.items() if a.startswith(CARPETA_PY) and a.endswith(".py")}
    js = {a: t for a, t in textos.items() if a.startswith(CARPETA_JS) and a.endswith(".js")}
    complejas, lugares = {}, {}
    mpy = _medir_py(py, complejas, lugares)
    mjs = _medir_js(js, complejas, lugares)
    return {"funciones_py": mpy["funciones"], "funciones_js": mjs["funciones"], "complejas": complejas,
            "lugares": lugares, "muerto": mpy["muerto"] + [f"no se pudo leer: {e}" for e in mjs["errores"]],
            "duplicados": mpy["duplicados"], "capas": mpy["capas"]}


def _nombre(clave: str) -> str:
    return clave.split("::", 1)[1].split(" #")[0]


def _sin_linea(x: str) -> str:
    """«archivo:123: mensaje» → «archivo: mensaje»: la línea cambia con cualquier cambio de más arriba."""
    return re.sub(r"^([^:]+):\d+:", r"\1:", x)


def comparar(hoy: dict, base: dict) -> list[str]:
    """Lo que empeoró respecto de la base (vacío: igual o mejor)."""
    peor = []
    # Las que se mudaron: desaparecieron de su archivo; se buscan por nombre entre las nuevas.
    mudadas = defaultdict(list)
    for clave, c in base["complejas"].items():
        if clave not in hoy["complejas"]:
            mudadas[_nombre(clave)].append(c)
    for clave, c in sorted(hoy["complejas"].items()):
        donde = hoy["lugares"][clave]
        antes = base["complejas"].get(clave)
        if antes is None and mudadas.get(_nombre(clave)):
            antes = max(mudadas[_nombre(clave)])
            mudadas[_nombre(clave)].remove(antes)
        if antes is None:
            peor.append(f"complejidad: {_nombre(clave)} = {c} (límite {LIMITE}) en {donde}")
        elif c > antes:
            peor.append(f"complejidad: {_nombre(clave)} subió de {antes} a {c} en {donde}")
    for clave, nombre in (("muerto", "código muerto o roto"), ("duplicados", "duplicados"), ("capas", "capas mezcladas")):
        if len(hoy[clave]) > len(base[clave]):
            antes = defaultdict(int)
            for x in base[clave]:
                antes[_sin_linea(x)] += 1
            nuevos = []
            for x in hoy[clave]:
                if antes[_sin_linea(x)]:
                    antes[_sin_linea(x)] -= 1
                else:
                    nuevos.append(x)
            peor.append(f"{nombre}: {len(base[clave])} → {len(hoy[clave])}" + (f" ({'; '.join(nuevos[:5])})" if nuevos else ""))
    return peor


def resumen(hoy: dict, base: dict | None) -> str:
    def cifra(clave, n):
        return f"{n}" + (f" (base {len(base[clave])})" if base else "")
    py = sum(1 for k in hoy["complejas"] if ".py::" in k)
    js = len(hoy["complejas"]) - py
    return (f"Calidad de armahub/: {hoy['funciones_py']} funciones Python y {hoy['funciones_js']} JavaScript · "
            f"sobre el límite de complejidad: {cifra('complejas', len(hoy['complejas']))} ({py} Python, {js} JS) · "
            f"muerto: {cifra('muerto', len(hoy['muerto']))} · duplicados: {cifra('duplicados', len(hoy['duplicados']))} · "
            f"capas mezcladas: {cifra('capas', len(hoy['capas']))}")


def _base(ref: str | None):
    if ref:
        try:
            return json.loads(_git("show", f"{ref}:{BASE_EN_GIT}").decode("utf-8"))
        except subprocess.CalledProcessError:
            return None
    if os.path.isfile(BASE):
        with open(BASE, encoding="utf-8") as fh:
            return json.load(fh)
    return None


def revisar(ref: str | None = None, detalle: bool = False) -> list[str]:
    """Mide, imprime el resumen y devuelve lo que empeoró."""
    hoy = medir(ref)
    base = _base(ref)
    print(resumen(hoy, base), flush=True)
    if detalle:
        for clave, c in sorted(hoy["complejas"].items(), key=lambda x: -x[1]):
            print(f"  complejidad {c:4d}  {_nombre(clave)}: {hoy['lugares'][clave]}")
        for clave in ("muerto", "duplicados", "capas"):
            for x in hoy[clave]:
                print(f"  {clave}: {x}")
    if base is None and ref:
        # Un commit de antes del medidor no trae base: no hay con qué compararlo, y no se frena.
        print("Ese commit no trae base de calidad: no se compara.", flush=True)
        return []
    if base is None:
        return ["no hay base: correr «py -3.12 scripts/calidad/calidad.py --base» una vez"]
    return comparar(hoy, base)


def _argumento(nombre: str):
    return sys.argv[sys.argv.index(nombre) + 1] if nombre in sys.argv else None


if __name__ == "__main__":
    if sys.stdout:
        sys.stdout.reconfigure(encoding="utf-8")
    if "--base" in sys.argv:
        hoy = medir("HEAD")
        with open(BASE, "w", encoding="utf-8", newline="\n") as fh:
            json.dump({k: hoy[k] for k in ("funciones_py", "funciones_js", "complejas", "muerto", "duplicados", "capas")},
                      fh, ensure_ascii=False, indent=1, sort_keys=True)
        print(resumen(hoy, None) + f"\nBase guardada en {os.path.relpath(BASE, RAIZ)} (medida sobre HEAD).")
        sys.exit(0)
    peor = revisar(_argumento("--ref"), "--detalle" in sys.argv)
    for p in peor:
        print("  EMPEORÓ · " + p)
    print("Calidad: empeoró." if peor else "Calidad: igual o mejor que la base.")
    sys.exit(1 if peor else 0)
