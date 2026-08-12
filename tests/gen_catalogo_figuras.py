#!/usr/bin/env python
"""
gen_catalogo_figuras.py
-----------------------
Genera `armahub/static/js/features/modelador/catalogo_figuras.js`: el ESPEJO
ESTATICO del catalogo de figuras, que es lo que consumen el motor del modelador
(generar.js / figura_puntos.js / reglas.js) y los tests headless.

FUENTE UNICA: `armahub/catalogo.py` (_FIGURAS_SEED, _TIPOLOGIAS_SEED,
_FIGURAS_POR_TIPO_SEED). Se leen del CODIGO FUENTE con `ast` (no se importa el
modulo: catalogo.py arrastra fastapi/psycopg y para esto no hacen falta).

Por que un espejo y no solo el GET /figuras-catalogo: el endpoint necesita
sesion y red. El espejo es el fallback SIEMPRE disponible (y lo unico que ven
los tests). En el navegador, la UI llama ademas a
`ModeladorCatalogoFiguras.actualizar(data)` tras el fetch y la data fresca pisa
al espejo en memoria.

Uso:
    python tests/gen_catalogo_figuras.py           # regenera el .js
    python tests/gen_catalogo_figuras.py --check   # exit 1 si el .js quedo desfasado

`--check` regenera en memoria REUSANDO la fecha que ya trae el archivo, asi que
solo falla cuando cambio la DATA (no por volver a correrlo otro dia).
"""

import argparse
import ast
import datetime
import hashlib
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
CATALOGO_PY = RAIZ / "armahub" / "catalogo.py"
DESTINO = RAIZ / "armahub" / "static" / "js" / "features" / "modelador" / "catalogo_figuras.js"

_RE_VERSION = re.compile(r"var VERSION = '([^']*)'")


# ---------------------------------------------------------------------------
# LECTURA DEL SEED
# ---------------------------------------------------------------------------
def _literal(arbol, nombre):
    """Valor de una asignacion de nivel superior `nombre = <literal>`."""
    for nodo in arbol.body:
        if isinstance(nodo, ast.Assign):
            for destino in nodo.targets:
                if isinstance(destino, ast.Name) and destino.id == nombre:
                    return ast.literal_eval(nodo.value)
    raise SystemExit(f"[gen_catalogo_figuras] no se encontro {nombre} en {CATALOGO_PY}")


def leer_seed():
    fuente = CATALOGO_PY.read_text(encoding="utf-8")
    arbol = ast.parse(fuente, filename=str(CATALOGO_PY))
    figuras = _literal(arbol, "_FIGURAS_SEED")
    tipologias = _literal(arbol, "_TIPOLOGIAS_SEED")
    por_tipo = _literal(arbol, "_FIGURAS_POR_TIPO_SEED")
    return figuras, tipologias, por_tipo


# ---------------------------------------------------------------------------
# EMISION DE JS
# ---------------------------------------------------------------------------
def js_str(valor):
    if valor is None:
        return "null"
    return "'" + str(valor).replace("\\", "\\\\").replace("'", "\\'") + "'"


def js_num(valor):
    n = float(valor)
    return str(int(n)) if n.is_integer() else repr(n)


def js_lista_str(valores):
    return "[" + ", ".join(js_str(v) for v in valores) + "]"


def js_lista_num(valores):
    return "[" + ", ".join(js_num(v) for v in valores) + "]"


def bloque_figuras(figuras):
    lineas = []
    for codigo, parciales, angulos, radio in figuras:
        lineas.append(
            "    {cod}: {{ codigo: {cod}, parciales: {par}, angulos: {ang},"
            " radio: {rad}, descripcion: null }},".format(
                cod=js_str(codigo),
                par=js_lista_str(parciales),
                ang=js_lista_num(angulos),
                rad="true" if radio else "false",
            )
        )
    return "\n".join(lineas)


def bloque_tipologias(tipologias):
    lineas = []
    for estructura, tipos in tipologias.items():
        pares = ", ".join(
            "{{ codigo: {c}, nombre: {n} }}".format(c=js_str(c), n=js_str(n))
            for c, n in tipos
        )
        lineas.append("    {e}: [{p}],".format(e=js_str(estructura), p=pares))
    return "\n".join(lineas)


def bloque_por_tipologia(por_tipo):
    lineas = []
    for clave, figs in por_tipo.items():
        lineas.append("    {k}: {v},".format(k=js_str(clave), v=js_lista_str(figs)))
    return "\n".join(lineas)


def sha_seed(figuras, tipologias, por_tipo):
    crudo = repr([figuras, sorted(tipologias.items()), sorted(por_tipo.items())])
    return hashlib.sha1(crudo.encode("utf-8")).hexdigest()[:12]


PLANTILLA = r"""// =============================================================================
// GENERADO — no editar a mano; regenerar con python tests/gen_catalogo_figuras.py
// =============================================================================
// Modelador 3D — ESPEJO ESTÁTICO DEL CATÁLOGO DE FIGURAS (TANDA 2 · T7.1)
//
// FUENTE ÚNICA de parciales/ángulos/radio para el motor (generar.js,
// figura_puntos.js, reglas.js) y para los tests headless. Espejo 1:1 de
// armahub/catalogo.py (_FIGURAS_SEED + tipologías), o sea de lo mismo que el
// backend siembra en figuras_catalogo y sirve por GET /figuras-catalogo.
//
// POR QUÉ EXISTE: antes cada consumidor llevaba su propia tablita a mano
// (generar.js conocía 5 figuras, el editor 8, el catálogo real tiene __N__) y
// además con datos EQUIVOCADOS (106A: 4 parciales con ángulos 135/135 cuando el
// catálogo dice 6 parciales A–F con 45/45). Consecuencia: dibujar una figura
// fuera de la lista salía en el 3D pero el payload iba con dims null → 0 kg y
// el backend la rechazaba. Una sola tabla, generada, no se puede desincronizar.
//
// EN EL NAVEGADOR: la UI hace GET /figuras-catalogo al abrir el editor y llama
// `ModeladorCatalogoFiguras.actualizar(data)`. La data fresca PISA el espejo en
// memoria (mismo objeto FIGURAS, mutado in place). El espejo estático es el
// fallback siempre disponible: sin red / sin sesión el motor sigue calculando
// bien. `esFresco()` dice cuál de las dos está activa.
//
// LA CLASIFICACIÓN DE DIBUJO NO VIVE ACÁ: qué figura sabe dibujar el editor y
// con qué constructor (recta / cabezal con patas / estribo / traba) lo decide
// figura_puntos.js (`dibujabilidad`, `familiaDeDibujo`), que es el módulo que
// dibuja. Acá sólo se re-expone `noDibujables()` por comodidad del llamador.
// =============================================================================
(function (global) {
  'use strict';

  var VERSION = '__VERSION__';   // fecha en que se generó el espejo
  var SHA = '__SHA__';           // huella de la data del seed (detecta desfases)
  var FUENTE = 'armahub/catalogo.py::_FIGURAS_SEED';

  // ---------------------------------------------------------------------------
  // DATA GENERADA — INICIO (no editar)
  // ---------------------------------------------------------------------------
  // codigo → { codigo, parciales:[letras A..I], angulos:[grados], radio, descripcion }
  // `parciales` = los lados/slots dim_x que la figura USA (el backend valida que
  // estén EXACTAMENTE esos y el largo es su suma). `angulos` = los N ángulos que
  // la figura declara (van a ang1..angN; el resto queda vacío).
  var FIGURAS = {
__FIGURAS__
  };

  // estructura → [{ codigo, nombre }]
  var TIPOLOGIAS = {
__TIPOLOGIAS__
  };

  // 'ESTRUCTURA-CODIGO' → [figuras aplicables]
  var FIGURAS_POR_TIPOLOGIA = {
__POR_TIPOLOGIA__
  };
  // ---------------------------------------------------------------------------
  // DATA GENERADA — FIN
  // ---------------------------------------------------------------------------

  var _fresco = false;   // ¿la data en memoria vino del backend?

  function _norm(codigo) {
    return String(codigo == null ? '' : codigo).trim().toUpperCase();
  }

  // Spec de una figura, o null si NO está en el catálogo. Null es un dato: el
  // motor NO inventa un spec vacío (eso era lo que producía payloads con dims
  // null y 0 kg en silencio).
  function get(codigo) {
    var k = _norm(codigo);
    return (k && Object.prototype.hasOwnProperty.call(FIGURAS, k)) ? FIGURAS[k] : null;
  }

  function existe(codigo) { return get(codigo) !== null; }

  // Códigos en el orden del catálogo (orden de inserción del seed).
  function codigos() { return Object.keys(FIGURAS); }

  // Tipologías donde aplica una figura ('VIGA-ES', 'MURO-MH', …).
  function tipologiasDeFigura(codigo) {
    var k = _norm(codigo), out = [];
    for (var t in FIGURAS_POR_TIPOLOGIA) {
      if (!Object.prototype.hasOwnProperty.call(FIGURAS_POR_TIPOLOGIA, t)) continue;
      if (FIGURAS_POR_TIPOLOGIA[t].indexOf(k) >= 0) out.push(t);
    }
    return out;
  }

  // Figuras que el catálogo asocia a una tipología. `estructura` opcional:
  // figurasDeTipologia('VIGA','ES') o figurasDeTipologia('VIGA-ES').
  function figurasDeTipologia(estructura, codigo) {
    var clave = (codigo != null) ? (String(estructura) + '-' + String(codigo)) : String(estructura || '');
    var lista = FIGURAS_POR_TIPOLOGIA[clave.toUpperCase()] || FIGURAS_POR_TIPOLOGIA[clave] || [];
    return lista.slice();
  }

  // ---------------------------------------------------------------------------
  // DATA FRESCA DEL BACKEND
  // ---------------------------------------------------------------------------
  // `data` = la respuesta de GET /figuras-catalogo ({figuras:[…]}) o el array.
  // Reemplaza el contenido de FIGURAS IN PLACE (mismo objeto) para que cualquiera
  // que lo haya capturado siga viendo la verdad. Una respuesta VACÍA o inválida
  // NO pisa nada: mejor el espejo estático que un catálogo en blanco (que dejaría
  // toda figura como "desconocida").
  function _specDesde(f) {
    var cod = _norm(f && (f.codigo || f.code));
    if (!cod) return null;
    var par = [], ang = [], i;
    var pIn = (f && f.parciales) || [];
    for (i = 0; i < pIn.length; i++) { var L = _norm(pIn[i]); if (L) par.push(L); }
    var aIn = (f && f.angulos) || [];
    for (i = 0; i < aIn.length; i++) { var n = Number(aIn[i]); if (isFinite(n)) ang.push(n); }
    return {
      codigo: cod, parciales: par, angulos: ang, radio: !!(f && f.radio),
      descripcion: (f && f.descripcion != null) ? f.descripcion : null,
      geometria: (f && f.geometria != null) ? f.geometria : null
    };
  }

  function actualizar(data) {
    var lista = Array.isArray(data) ? data : ((data && data.figuras) || null);
    if (!lista || !lista.length) {
      return { ok: false, n: codigos().length, motivo: 'respuesta vacía: se conserva el espejo estático' };
    }
    var nuevo = {}, n = 0, k;
    for (var i = 0; i < lista.length; i++) {
      var s = _specDesde(lista[i]);
      if (s) { nuevo[s.codigo] = s; n++; }
    }
    if (!n) return { ok: false, n: codigos().length, motivo: 'ninguna figura utilizable en la respuesta' };
    var antes = codigos();
    for (k in FIGURAS) if (Object.prototype.hasOwnProperty.call(FIGURAS, k)) delete FIGURAS[k];
    for (k in nuevo) if (Object.prototype.hasOwnProperty.call(nuevo, k)) FIGURAS[k] = nuevo[k];
    _fresco = true;
    var perdidas = antes.filter(function (c) { return !Object.prototype.hasOwnProperty.call(FIGURAS, c); });
    return { ok: true, n: n, fuente: 'GET /figuras-catalogo', ya_no_estan: perdidas };
  }

  function esFresco() { return _fresco; }

  // ---------------------------------------------------------------------------
  // DIBUJABILIDAD — la decide figura_puntos.js (el módulo que dibuja). Acá sólo
  // se re-expone la lista negra ya resuelta contra el catálogo VIGENTE (o sea
  // que se recalcula sola cuando entra data fresca).
  // ---------------------------------------------------------------------------
  function _fp() {
    return global.ModeladorFiguraPuntos ||
      (typeof require !== 'undefined' ? require('./figura_puntos.js') : null);
  }

  // noDibujables()       → { codigo: motivo } de todo el catálogo vigente.
  // noDibujables(codigo) → motivo (string) o null si esa figura SÍ se dibuja.
  function noDibujables(codigo) {
    var fp = _fp();
    if (!fp || !fp.noDibujables) return (codigo != null) ? null : {};
    return fp.noDibujables(codigo);
  }

  function dibujables() {
    var fp = _fp();
    if (!fp || !fp.dibujabilidad) return codigos();
    return codigos().filter(function (c) { return fp.dibujabilidad(c).dibujable; });
  }

  var API = {
    version: VERSION,
    sha: SHA,
    fuente: FUENTE,
    FIGURAS: FIGURAS,
    TIPOLOGIAS: TIPOLOGIAS,
    FIGURAS_POR_TIPOLOGIA: FIGURAS_POR_TIPOLOGIA,
    get: get,
    existe: existe,
    codigos: codigos,
    tipologiasDeFigura: tipologiasDeFigura,
    figurasDeTipologia: figurasDeTipologia,
    actualizar: actualizar,
    esFresco: esFresco,
    noDibujables: noDibujables,
    dibujables: dibujables
  };

  global.ModeladorCatalogoFiguras = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
"""


def generar(version=None):
    figuras, tipologias, por_tipo = leer_seed()
    version = version or datetime.date.today().isoformat()
    salida = (
        PLANTILLA
        .replace("__FIGURAS__", bloque_figuras(figuras))
        .replace("__TIPOLOGIAS__", bloque_tipologias(tipologias))
        .replace("__POR_TIPOLOGIA__", bloque_por_tipologia(por_tipo))
        .replace("__VERSION__", version)
        .replace("__SHA__", sha_seed(figuras, tipologias, por_tipo))
        .replace("__N__", str(len(figuras)))
    )
    return salida, len(figuras)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="no escribe: verifica que el .js coincida con catalogo.py")
    args = ap.parse_args()

    if args.check:
        if not DESTINO.exists():
            print(f"DESFASADO: falta {DESTINO}")
            return 1
        actual = DESTINO.read_text(encoding="utf-8")
        m = _RE_VERSION.search(actual)
        # Se reusa la fecha del archivo: el --check compara DATA, no el día en
        # que se corrió el generador.
        esperado, n = generar(version=m.group(1) if m else None)
        if actual == esperado:
            print(f"OK: catalogo_figuras.js al dia ({n} figuras, sha {sha_seed(*leer_seed())})")
            return 0
        print("DESFASADO: catalogo_figuras.js no coincide con armahub/catalogo.py")
        print("           regenerar con: python tests/gen_catalogo_figuras.py")
        # Pista concreta de qué cambió (primera línea distinta).
        act, esp = actual.splitlines(), esperado.splitlines()
        for i in range(max(len(act), len(esp))):
            a = act[i] if i < len(act) else "<falta>"
            e = esp[i] if i < len(esp) else "<sobra>"
            if a != e:
                print(f"           primera diferencia (línea {i + 1}):")
                print(f"             archivo:  {a.strip()[:120]}")
                print(f"             catálogo: {e.strip()[:120]}")
                break
        return 1

    salida, n = generar()
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(salida, encoding="utf-8")
    print(f"OK: {DESTINO.relative_to(RAIZ)} regenerado con {n} figuras")
    return 0


if __name__ == "__main__":
    sys.exit(main())
