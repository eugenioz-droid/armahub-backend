"""Un paquete de armahub visto como un solo módulo, para las pruebas escritas antes de dividirlo en varios."""
import importlib
import pkgutil
import types

_NADA = object()


class Entero:
    """El paquete como un solo módulo: leer un nombre lo busca en el paquete y en sus módulos; reemplazarlo lo
    cambia en todos los módulos que lo tienen (el que lo define y los que lo importan), así el reemplazo que pone
    una prueba (la base simulada, un error a propósito) alcanza a cada módulo que lo usa."""

    def __init__(self, paquete):
        modulos = [importlib.import_module(f"{paquete.__name__}.{m.name}") for m in pkgutil.iter_modules(paquete.__path__)]
        object.__setattr__(self, "_modulos", [paquete] + modulos)

    def __getattr__(self, nombre):
        for m in self._modulos:
            v = getattr(m, nombre, _NADA)
            if v is not _NADA and not isinstance(v, types.ModuleType):
                return v
        raise AttributeError(nombre)

    def __setattr__(self, nombre, valor):
        con = [m for m in self._modulos[1:] if hasattr(m, nombre)]
        if not con:
            raise AttributeError(nombre)
        for m in con:
            setattr(m, nombre, valor)
