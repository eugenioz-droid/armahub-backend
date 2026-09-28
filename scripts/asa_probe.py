"""
DESCUBRE COMO VIAJA LA CLAVE DE aSa  --  se corre a mano, una vez.

    python scripts/asa_probe.py

POR QUE EXISTE. La clave la administra Power BI y no sabemos en que forma la manda. Las
opciones razonables son una docena. En vez de que alguien edite el .env doce veces, esto
las prueba todas y dice cual funciono y que hay que escribir en el .env.

CUIDADO CON aSa: una consulta por intento, pidiendo UNA fila, con pausa entre medio, y se
DETIENE apenas una funciona. Son ~12 peticiones minusculas en total, una sola vez en la
vida del proyecto.

No imprime la clave nunca.
"""
import os
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

from asa_ping import cargar_env  # noqa: E402

# (etiqueta, variables de entorno que lo configuran)
# El orden va de lo mas probable a lo menos. "Authorize" esta porque el usuario menciona
# que en Power BI aparecen dos parametros: Accept y Authorize -- puede que el nombre de la
# cabecera sea literalmente ese, y no el "Authorization" estandar.
COMBINACIONES = [
    ("Authorization: Bearer <clave>",
     {"ASA_AUTH_MODE": "header", "ASA_AUTH_HEADER": "Authorization", "ASA_AUTH_PREFIX": "Bearer"}),
    ("Authorization: <clave>  (sin prefijo)",
     {"ASA_AUTH_MODE": "header", "ASA_AUTH_HEADER": "Authorization", "ASA_AUTH_PREFIX": ""}),
    ("Authorize: <clave>",
     {"ASA_AUTH_MODE": "header", "ASA_AUTH_HEADER": "Authorize", "ASA_AUTH_PREFIX": ""}),
    ("Authorize: Bearer <clave>",
     {"ASA_AUTH_MODE": "header", "ASA_AUTH_HEADER": "Authorize", "ASA_AUTH_PREFIX": "Bearer"}),
    ("x-api-key: <clave>",
     {"ASA_AUTH_MODE": "header", "ASA_AUTH_HEADER": "x-api-key", "ASA_AUTH_PREFIX": ""}),
    ("ApiKey: <clave>",
     {"ASA_AUTH_MODE": "header", "ASA_AUTH_HEADER": "ApiKey", "ASA_AUTH_PREFIX": ""}),
    ("Api-Key: <clave>",
     {"ASA_AUTH_MODE": "header", "ASA_AUTH_HEADER": "Api-Key", "ASA_AUTH_PREFIX": ""}),
    ("Authorization: ApiKey <clave>",
     {"ASA_AUTH_MODE": "header", "ASA_AUTH_HEADER": "Authorization", "ASA_AUTH_PREFIX": "ApiKey"}),
    ("Authorization: Token <clave>",
     {"ASA_AUTH_MODE": "header", "ASA_AUTH_HEADER": "Authorization", "ASA_AUTH_PREFIX": "Token"}),
    ("?apikey=<clave>  (en la URL)",
     {"ASA_AUTH_MODE": "query", "ASA_AUTH_PARAM": "apikey"}),
    ("?api_key=<clave>  (en la URL)",
     {"ASA_AUTH_MODE": "query", "ASA_AUTH_PARAM": "api_key"}),
    ("?key=<clave>  (en la URL)",
     {"ASA_AUTH_MODE": "query", "ASA_AUTH_PARAM": "key"}),
    ("?$apikey=<clave>  (en la URL)",
     {"ASA_AUTH_MODE": "query", "ASA_AUTH_PARAM": "code"}),
]

LIMPIAR = ("ASA_AUTH_MODE", "ASA_AUTH_HEADER", "ASA_AUTH_PREFIX", "ASA_AUTH_PARAM")


def main():
    if not cargar_env():
        return 1
    if not os.getenv("ASA_API_KEY"):
        print("  XX  Falta pegar la clave en ASA_API_KEY dentro del .env.")
        return 1

    from armahub import asa

    endpoint = os.getenv("ASA_PING_ENDPOINT", "getScheduling")
    print("=" * 72)
    print("BUSCANDO COMO VIAJA LA CLAVE")
    print("=" * 72)
    print("  Servidor : " + os.getenv("ASA_API_URL", ""))
    print("  Endpoint : %s  (pidiendo 1 fila por intento)" % endpoint)
    print("  Intentos : %d, con pausa entre medio" % len(COMBINACIONES))
    print()

    ganadora = None
    for i, (etiqueta, variables) in enumerate(COMBINACIONES, 1):
        for v in LIMPIAR:
            os.environ.pop(v, None)
        os.environ.update(variables)
        print("  %2d. %-42s " % (i, etiqueta), end="", flush=True)
        try:
            asa.consultar(endpoint, select=["CtrlCode"], top=1)
            print("FUNCIONA")
            ganadora = (etiqueta, variables)
            break
        except asa.AsaError as e:
            msg = str(e)
            if "401" in msg or "403" in msg:
                print("rechazada")
            elif "alcanzar" in msg:
                print("sin red -- se corta")
                print()
                print("  XX  No es la clave: no hay conexion con el servidor.")
                return 1
            else:
                print(msg[:44])
        time.sleep(1.2)   # cortesia con aSa

    print()
    if not ganadora:
        print("  XX  Ninguna de las %d formas funciono." % len(COMBINACIONES))
        print()
        print("Eso ya no se adivina: hay que mirar como lo manda Power BI.")
        print("En Power BI:  Inicio > Transformar datos > (la consulta de aSa) >")
        print("              Editor avanzado.  Copia el texto y reemplaza la clave por XXXX.")
        print("Ahi aparece el nombre exacto de la cabecera y el formato del valor.")
        return 1

    etiqueta, variables = ganadora
    print("  OK  Es:  " + etiqueta)
    print()
    print("ESCRIBE ESTO EN EL .env (reemplazando las lineas ASA_AUTH_*):")
    print()
    for clave in LIMPIAR:
        if clave in variables:
            print("    %s=%s" % (clave, variables[clave]))
    print()
    print("Las mismas van en Render > Environment para que ande en produccion.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
