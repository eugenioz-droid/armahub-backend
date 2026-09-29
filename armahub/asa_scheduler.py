"""
RELOJ DE SINCRONIZACIÓN CON aSa (29-sep).

QUÉ HACE. Refresca el espejo de aSa varias veces al día, sin que nadie apriete nada. Por
defecto a las **06:00, 11:00 y 14:00 hora de Chile**: el usuario parte el día con la data
puesta (incluidos los turnos de noche), y la reunión de la tarde ve lo de la mañana.

POR QUÉ UN HILO Y NO UN CRON DE RENDER. Render cobra el cron como un servicio aparte, y
este trabajo dura segundos. Un hilo dentro del proceso web no cuesta nada más... siempre
que el proceso esté despierto, que es exactamente lo que se compra con el plan de pago.
En el plan gratuito el servicio se suspende por inactividad y el hilo muere con él: por
eso esto NO se enciende solo. Hay que poner `ASA_SYNC_ACTIVO=1`.

QUÉ TRAE. Lo INCREMENTAL, no todo: sólo los pedidos cuyo `LastModified` cambió desde la
última corrida buena. En un día normal son decenas de filas y tarda segundos. La carga
completa por año se sigue haciendo a mano, una vez, desde el botón.

TRES CUIDADOS, y cada uno tapa una forma distinta de romper esto:
  1. NUNCA tumba la app. Cualquier excepción se loguea y el reloj sigue.
  2. NO se pisa con otra corrida. Si ya hubo una sincronización buena hace poco —otra
     instancia de Render, o alguien que apretó el botón— se salta el turno.
  3. NO dispara al arrancar. Render reinicia el proceso en cada despliegue; sin esta
     guarda, cinco despliegues en una tarde serían cinco sincronizaciones.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

log = logging.getLogger("armahub.asa_scheduler")

HORAS_POR_DEFECTO = "06:00,11:00,14:00"
ZONA_POR_DEFECTO = "America/Santiago"
# Si ya hubo una sincronización buena hace menos de esto, el turno se salta. Cubre el caso
# de dos instancias y el de alguien que acaba de apretar el botón a mano.
MINUTOS_ANTI_REPETIDO = 20
# Cada cuánto despierta el hilo a mirar la hora. Un minuto es suficiente: los turnos se
# definen en horas y minutos, no en segundos.
LATIDO_SEGUNDOS = 60

_hilo = None


def activo() -> bool:
    return (os.getenv("ASA_SYNC_ACTIVO", "") or "").strip().lower() in ("1", "true", "si", "sí", "on")


def _zona():
    """La zona horaria configurada. Si el sistema no tiene la base de zonas (pasa en
    algunos Windows sin `tzdata`), se cae a UTC avisando: un horario corrido tres horas es
    un problema, pero un hilo que revienta al arrancar es peor."""
    nombre = (os.getenv("ASA_SYNC_TZ", "") or ZONA_POR_DEFECTO).strip()
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(nombre)
    except Exception as e:
        log.warning("Zona horaria '%s' no disponible (%s); se usa UTC.", nombre, e)
        return timezone.utc


def horarios() -> list:
    """Los turnos del día, como (hora, minuto). De `ASA_SYNC_HORAS`, formato 'HH:MM,HH:MM'."""
    crudo = (os.getenv("ASA_SYNC_HORAS", "") or HORAS_POR_DEFECTO).strip()
    salida = []
    for parte in crudo.split(","):
        parte = parte.strip()
        if not parte:
            continue
        try:
            h, _, m = parte.partition(":")
            h, m = int(h), int(m or 0)
            if 0 <= h <= 23 and 0 <= m <= 59:
                salida.append((h, m))
        except ValueError:
            log.warning("Horario inválido en ASA_SYNC_HORAS: %r (se ignora)", parte)
    return sorted(set(salida))


def _corrio_hace_poco() -> bool:
    """¿Ya hubo una sincronización buena en los últimos minutos? Evita que dos instancias
    hagan el mismo trabajo, y que el reloj repita lo que alguien acaba de hacer a mano."""
    from .db import get_conn
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT 1 FROM asa_sync
                        WHERE ok AND fin IS NOT NULL
                          AND fin > now() - make_interval(mins => %s)
                        LIMIT 1""",
                    (MINUTOS_ANTI_REPETIDO,))
                return cur.fetchone() is not None
    except Exception as e:
        # Si no se puede consultar, se prefiere NO sincronizar: repetir es peor que saltar.
        log.error("No se pudo comprobar la última sincronización: %s", e)
        return True


def _una_corrida():
    from . import asa, asa_sync
    if not asa.configurado():
        log.info("aSa no está configurado; el reloj no hace nada.")
        return
    if _corrio_hace_poco():
        log.info("Ya hubo una sincronización reciente; se salta el turno.")
        return
    try:
        r = asa_sync.sincronizar_incremental(lanzado_por="reloj")
        log.info("aSa reloj: %d pedidos (%d nuevos) desde %s", r["filas"], r["nuevas"], r["desde"])
    except Exception as e:
        log.error("aSa reloj: falló la sincronización de pedidos: %s", e)
    try:
        # SIEMPRE después de los pedidos: sólo actualiza filas que ya existen, así que si
        # corriera antes no encontraría las que acaban de entrar. Y es la que decide en
        # qué caja cae cada código de control, así que no puede quedarse atrás.
        r = asa_sync.sincronizar_planta(lanzado_por="reloj")
        log.info("aSa reloj: planta %d filas, %d pedidos agendados", r["filas"], r["con_planta"])
    except Exception as e:
        log.error("aSa reloj: falló la sincronización de planta: %s", e)
    try:
        r = asa_sync.sincronizar_obras(lanzado_por="reloj")
        log.info("aSa reloj: %d obras (%d nuevas)", r["filas"], r["nuevas"])
    except Exception as e:
        log.error("aSa reloj: falló la sincronización de obras: %s", e)


def proxima(desde: datetime, turnos: list) -> datetime:
    """El siguiente turno posterior a `desde`. Función pura, para poder probarla."""
    if not turnos:
        return desde + timedelta(days=1)
    for dia in (0, 1):
        base = (desde + timedelta(days=dia)).replace(second=0, microsecond=0)
        for h, m in turnos:
            cand = base.replace(hour=h, minute=m)
            if cand > desde:
                return cand
    return desde + timedelta(days=1)


def _bucle():
    zona = _zona()
    turnos = horarios()
    # NO se dispara al arrancar: Render reinicia el proceso en cada despliegue, y sin esta
    # guarda cinco despliegues en una tarde serían cinco sincronizaciones.
    siguiente = proxima(datetime.now(zona), turnos)
    log.info("Reloj de aSa encendido. Turnos %s (%s). Próximo: %s",
             turnos, zona, siguiente.strftime("%Y-%m-%d %H:%M"))
    while True:
        try:
            time.sleep(LATIDO_SEGUNDOS)
            ahora = datetime.now(zona)
            if ahora >= siguiente:
                siguiente = proxima(ahora, turnos)
                log.info("Reloj de aSa: turno alcanzado. Próximo: %s",
                         siguiente.strftime("%Y-%m-%d %H:%M"))
                _una_corrida()
        except Exception as e:
            # El reloj NUNCA muere: si algo revienta, se loguea y sigue al minuto siguiente.
            log.error("Reloj de aSa: error en el bucle (sigue corriendo): %s", e)


def iniciar():
    """Enciende el reloj si está habilitado. Idempotente: llamarla dos veces no crea dos
    hilos (Render puede importar el módulo más de una vez)."""
    global _hilo
    if not activo():
        log.info("Reloj de aSa apagado (ASA_SYNC_ACTIVO no está en 1).")
        return None
    if _hilo and _hilo.is_alive():
        return _hilo
    _hilo = threading.Thread(target=_bucle, name="asa-scheduler", daemon=True)
    _hilo.start()
    return _hilo


def estado() -> dict:
    """Para mostrarlo en la interfaz: si está encendido y cuándo toca."""
    turnos = horarios()
    zona = _zona()
    return {
        "activo": activo(),
        "corriendo": bool(_hilo and _hilo.is_alive()),
        "zona": str(zona),
        "horarios": ["%02d:%02d" % t for t in turnos],
        "proxima": proxima(datetime.now(zona), turnos).isoformat() if activo() else None,
    }
