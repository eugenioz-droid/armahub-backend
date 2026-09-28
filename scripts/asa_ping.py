"""
PRUEBA DE CONEXION CON aSa  --  se corre a mano, una vez.

    python scripts/asa_ping.py                 -> prueba la conexion
    python scripts/asa_ping.py getJobData      -> ademas lista los campos de ese endpoint

QUE HACE. Lee el .env (no lo modifica), arma UNA consulta minima a aSa pidiendo UNA fila,
y dice si funciono. Si no funciono, dice exactamente que probar despues -- que es lo unico
util cuando todavia no sabemos como viaja la clave.

QUE NO HACE. No imprime la clave, ni siquiera parcialmente. No escribe en la base. No llama
a ningun endpoint de escritura de aSa.
"""
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)


def cargar_env():
    """Lee el .env sin dependencias. Solo variables que no esten ya en el entorno."""
    ruta = os.path.join(RAIZ, ".env")
    if not os.path.exists(ruta):
        print("  XX  No existe el archivo .env en " + RAIZ)
        return False
    with open(ruta, encoding="utf-8-sig") as fh:
        for linea in fh:
            linea = linea.strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            clave, _, valor = linea.partition("=")
            clave = clave.strip()
            if clave and clave not in os.environ:
                os.environ[clave] = valor.strip().strip('"').strip("'")
    return True


def main():
    if not cargar_env():
        return 1

    from armahub import asa

    print("=" * 72)
    print("PRUEBA DE CONEXION CON aSa")
    print("=" * 72)

    url = os.getenv("ASA_API_URL", "")
    key = os.getenv("ASA_API_KEY", "")
    print("  URL          : " + (url or "(vacia)"))
    print("  Clave        : " + ("cargada, %d caracteres" % len(key) if key else "VACIA"))
    print("  Modo de auth : " + os.getenv("ASA_AUTH_MODE", "header"))
    if os.getenv("ASA_AUTH_MODE", "header") == "header":
        print("  Cabecera     : %s: %s<clave>"
              % (os.getenv("ASA_AUTH_HEADER", "Authorization"),
                 os.getenv("ASA_AUTH_PREFIX", "Bearer ")))
    print("  Timeout      : %s s" % os.getenv("ASA_TIMEOUT", "20"))
    print()

    if not key:
        print("  XX  Falta pegar la clave en ASA_API_KEY dentro del .env.")
        return 1

    print("Consultando (pide UNA sola fila)...")
    estado = asa.estado()
    print()
    if estado.get("ok"):
        print("  OK  " + estado.get("detalle", ""))
    else:
        print("  XX  " + estado.get("detalle", "sin detalle"))
        print()
        print("QUE PROBAR AHORA, en este orden (se cambia el .env y se vuelve a correr):")
        print("  1. ASA_AUTH_HEADER=x-api-key  y  ASA_AUTH_PREFIX=   (vacio)")
        print("  2. ASA_AUTH_HEADER=ApiKey     y  ASA_AUTH_PREFIX=   (vacio)")
        print("  3. ASA_AUTH_MODE=query        (usa ASA_AUTH_PARAM=apikey)")
        print("  4. ASA_AUTH_MODE=basic        (necesita ASA_API_USER)")
        print()
        print("Si el error dice 'no se pudo alcanzar', no es la clave: es la red.")
        return 1

    # Segundo argumento opcional: descubrir los campos de un endpoint.
    endpoint = sys.argv[1] if len(sys.argv) > 1 else None
    if endpoint:
        print()
        print("=" * 72)
        print("CAMPOS DE " + endpoint)
        print("=" * 72)
        try:
            info = asa.explorar(endpoint, top=2)
        except asa.AsaError as e:
            print("  XX  " + str(e))
            return 1
        campos = info["campos"]
        print("  %d campos en %d fila(s) de muestra." % (len(campos), info["filas"]))
        print()
        for nombre in sorted(campos):
            d = campos[nombre]
            marca = "[personal]" if d["personal"] else ""
            print("  %-34s %-10s %s %s" % (nombre, d["tipo"], repr(d["muestra"])[:44], marca))
        print()
        print("Los marcados [personal] van con el valor oculto y NO se piden nunca.")
    else:
        print()
        print("Para ver los campos de un endpoint:")
        print("    python scripts/asa_ping.py getJobData")

    return 0


if __name__ == "__main__":
    sys.exit(main())
