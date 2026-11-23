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
