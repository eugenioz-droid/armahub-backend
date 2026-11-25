"""
Las reglas del plano, su entrega y su pedido: funciones puras (sin la base y sin HTTP).
"""


REVISIONES = ("aprobada", "duda", "pendiente")


def pendientes_por_combinacion(barras: list) -> dict:
    """{"SECTOR|PISO|CICLO": n} de las barras no aprobadas. `barras`: [{sector, piso, ciclo,
    revision}]; las que no subieron vienen con revision 'duda'."""
    out = {}
    for b in barras:
        if b.get("revision") != "aprobada":
            k = "|".join(str(b.get(c) or "").strip().upper() for c in ("sector", "piso", "ciclo"))
            out[k] = out.get(k, 0) + 1
    return out


def clave_paquete(obra: str, plano: str, ext: str = "zip") -> str:
    """La key de un archivo del plano en R2: una carpeta por plano (va la huella del nombre: el
    nombre trae cualquier letra) y un nombre único por subida. Dos subidas nunca comparten key:
    ninguna pisa a otra, y borrar la que no entró no toca la de nadie más. (Antes la key dependía
    sólo del número de versión: al cruzarse dos guardados, el que perdía borraba el archivo del
    que ganó.)"""
    import hashlib
    import uuid
    return f"obras/{obra}/planos/{hashlib.md5(plano.encode('utf-8')).hexdigest()[:16]}/{uuid.uuid4().hex}.{ext}"


# ── Las reglas (funciones puras) ──
def accion_al_terminar(autor_actual, email: str, mi_reemplazo) -> str:
    """Qué pasa cuando `email` termina un plano cuya entrega es de `autor_actual` (None: sin entrega):
    'nueva' (no tenía), 'mia' (reemplaza la suya: versión siguiente), 'reemplaza' (la de otro, que
    aceptó el reemplazo) u 'ocupado' (la de otro sin reemplazo aceptado: no se guarda nada).
    `mi_reemplazo`: el estado de mi pedido de reemplazo sobre esa entrega, o None."""
    if not autor_actual:
        return "nueva"
    if autor_actual == email:
        return "mia"
    return "reemplaza" if mi_reemplazo == "aceptado" else "ocupado"


def accion_al_cargar(fila, hay_entrega: bool, tamano: int) -> str:
    """Qué hace «cargar» (el plano del calculista, como antecedente) según lo que ArmaHub ya tiene
    del plano: 'crear' si no existe; 'ya_estaba' (no se toca nada) si tiene entrega o trabajo, o si
    es el mismo paquete; 'version_nueva' si sólo estaba cargado y el paquete es otro.
    `fila`: {etapa, tamano} de planos_obra, o None."""
    if not fila:
        return "crear"
    if hay_entrega or fila["etapa"] != "cargado" or fila["tamano"] == tamano:
        return "ya_estaba"
    return "version_nueva"


def relacion_enviada(d: dict):
    """(relacion, relacion_de) que manda ArmaScanner, o None si no manda la clave (la relación del
    plano no se toca). Con la clave, aunque venga vacía, manda lo que diga: así se corrige o se
    quita una relación mal puesta."""
    if "relacion" not in d:
        return None
    relacion = str(d.get("relacion") or "").strip()
    if relacion not in ("reemplaza", "complementa"):
        return (None, None)
    return (relacion, str(d.get("relacion_de") or "").strip()[:300] or None)


# (piso y sector, los de la etiqueta de cada barra, desde el 22-nov: el kg por piso de Mis obras)
CAMPOS_BARRA = ("id", "marca", "figura", "diam", "cant", "largo", "kg", "ciclo", "eje", "rev", "motivo", "piso", "sector")


def barras_a_la_vista(lista) -> list:
    """Lo que ArmaScanner manda de cada barra, acotado: sólo los campos conocidos, texto corto."""
    out = []
    for b in (lista or [])[:5000]:
        if isinstance(b, dict):
            fila = {k: (v[:200] if isinstance(v, str) else v) for k, v in b.items()
                    if k in CAMPOS_BARRA and isinstance(v, (str, int, float)) and not isinstance(v, bool)}
            fila["rev"] = fila.get("rev") if fila.get("rev") in REVISIONES else "pendiente"
            out.append(fila)
    return out


def reemplazados(filas) -> set:
    """{(obra, plano)} de los planos que otro de la misma obra reemplaza (relacion «reemplaza»,
    relacion_de = ese plano): quedan como antecedente y no suman a la obra. `filas`: [(obra, plano,
    relacion, relacion_de)]. Función pura."""
    return {(o, de) for o, _p, rel, de in filas if rel == "reemplaza" and de}


def puede_enviar(autor, email: str, admin: bool) -> bool:
    """Envía el pedido de un plano quien lo terminó (el autor de su entrega) o un administrador. Función
    pura."""
    return bool(admin or (email and email == autor))


def estado_pedido(version, pedido_version) -> str:
    if not pedido_version:
        return "sin_enviar"
    return "enviado" if pedido_version >= (version or 0) else "cambios"


def dwg_del_paquete(nombres):
    """El DWG que se descarga del paquete del plano: la copia de trabajo (trabajo/<plano>_IA.dwg, con
    la cubicación dibujada) o, si no la trae (un antecedente), el plano del calculista (planos/…).
    None si el paquete no trae un DWG. Función pura."""
    dwg = [n for n in nombres if n.lower().endswith(".dwg")]
    return (next((n for n in dwg if n.startswith("trabajo/")), None)
            or next((n for n in dwg if n.startswith("planos/")), None) or (dwg[0] if dwg else None))


# ── El pedido por grupo (mig 183, 25-nov): el ciclo en losas; en elevaciones será el eje ──
# ArmaScanner sube la versión del plano sin terminarla, con el estado de cada ciclo; un ciclo completo se pide
# solo, y lo enviado queda con su huella: si una versión posterior lo trae distinto, son cambios después del
# pedido y se reenvía el ciclo entero. [Usuario 25-nov: «lo importante es que haya trazabilidad»]
CAMPOS_COMPARADOS = ("MARCA", "FIGURA", "DIAM", "ESP", "CANT", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
                     "ANG1", "ANG2", "ANG3", "ANG4", "LARGO_TOTAL", "EJE", "PISO", "SECTOR")


def _entero(v):
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _numero(v):
    return round(float(v), 1) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def grupos_enviados(d: dict) -> dict:
    """El estado de cada grupo que manda ArmaScanner («ciclos_estado»: {"C1": {barras, kg, completo, huella}}),
    acotado: nombres cortos, números y la huella como texto. {} si no lo manda. Función pura."""
    crudo = d.get("ciclos_estado")
    if not isinstance(crudo, dict):
        return {}
    out = {}
    for g, x in list(crudo.items())[:200]:
        if isinstance(g, str) and g.strip() and isinstance(x, dict):
            out[g.strip()[:20]] = {"barras": _entero(x.get("barras")), "kg": _numero(x.get("kg")),
                                   "completo": x.get("completo") is True, "huella": str(x.get("huella") or "")[:64]}
    return out


def estado_grupo(actual, enviado) -> str:
    """El estado de un grupo: 'enviado' (lo último que se subió es lo que se envió), 'cambios' (completo y
    distinto de lo enviado: cambios después del pedido), 'completo' (completo y sin enviar) o 'en_revision'.
    actual: el grupo en la última versión ({completo, huella}) o None; enviado: su último envío ({huella})
    o None. Función pura."""
    if enviado and actual and actual.get("huella") and actual.get("huella") == enviado.get("huella"):
        return "enviado"
    if actual and actual.get("completo"):
        return "cambios" if enviado else "completo"
    return "en_revision"


def orden_grupo(g: str) -> tuple:
    """C2 antes que C10: por su número y, si no tiene, por su nombre. Función pura."""
    import re
    m = re.search(r"\d+", g or "")
    return (int(m.group()) if m else 10 ** 6, g or "")


def grupos_del_plano(actuales: dict, enviados: dict) -> list:
    """Cada grupo del plano con su estado, en orden: los de la última versión y los que se enviaron antes.
    actuales: {"C1": {barras, kg, completo, huella}}; enviados: {"C1": {version, huella, …}}. Función pura."""
    actuales, enviados = actuales or {}, enviados or {}
    return [{"grupo": g, "estado": estado_grupo(actuales.get(g), enviados.get(g)),
             "barras": (actuales.get(g) or {}).get("barras"), "kg": (actuales.get(g) or {}).get("kg"),
             "enviado": enviados.get(g)}
            for g in sorted(set(actuales) | set(enviados), key=orden_grupo)]


def csv_del_grupo(contenido: bytes, grupo: str) -> tuple:
    """(el CSV de A Detailer con sólo las filas de ese grupo —su encabezado igual—, esas filas como
    {columna: valor}). El grupo es la columna CICLO. Función pura."""
    lineas = contenido.decode("utf-8-sig", errors="replace").splitlines()
    k = next((i for i, linea in enumerate(lineas) if linea.startswith("=====")), -1)
    h = k + 1  # la fila de las columnas
    if h >= len(lineas):
        return b"", []
    cols = [c.strip() for c in lineas[h].split("|")]
    quiero = (grupo or "").strip().upper()
    elegidas = [linea for linea in lineas[h + 1:]
                if linea.strip() and dict(zip(cols, linea.split("|"))).get("CICLO", "").strip().upper() == quiero]
    filas = [{c: v.strip() for c, v in zip(cols, linea.split("|"))} for linea in elegidas]
    return ("\n".join(lineas[:h + 1] + elegidas) + "\n").encode("utf-8"), filas


def filas_para_traza(filas: list) -> list:
    """Lo que se guarda de lo enviado, barra por barra: su ID, su ID_UNICO y lo que se compara. Función pura."""
    return [{c: f.get(c, "") for c in ("ID", "ID_UNICO") + CAMPOS_COMPARADOS} for f in filas or []]


def diferencias(enviadas: list, actuales: list) -> dict:
    """Lo que cambió en un grupo entre lo enviado y la última versión, barra por barra (por su ID_UNICO, o su
    ID): {nuevas: [id…], corregidas: [{id, campos: [[campo, antes, ahora]…]}], eliminadas: [id…]}. Función pura."""
    def clave(f):
        return (f.get("ID_UNICO") or f.get("ID") or "").strip()

    def visible(f):
        return (f.get("ID") or clave(f)).strip()

    antes = {clave(f): f for f in enviadas or [] if clave(f)}
    ahora = {clave(f): f for f in actuales or [] if clave(f)}
    corregidas = []
    for k in sorted(set(antes) & set(ahora)):
        campos = [[c, antes[k].get(c, ""), ahora[k].get(c, "")] for c in CAMPOS_COMPARADOS
                  if (antes[k].get(c) or "").strip() != (ahora[k].get(c) or "").strip()]
        if campos:
            corregidas.append({"id": visible(ahora[k]), "campos": campos})
    return {"nuevas": sorted(visible(ahora[k]) for k in set(ahora) - set(antes)), "corregidas": corregidas,
            "eliminadas": sorted(visible(antes[k]) for k in set(antes) - set(ahora))}
