"""
RELOJ DE SINCRONIZACIÓN CON aSa (29-sep).

QUÉ HACE. Refresca el espejo de aSa varias veces al día, sin que nadie apriete nada. Por
defecto a las **06:00, 11:00 y 14:00 hora de Chile**: el usuario parte el día con la data
puesta (incluidos los turnos de noche), y la reunión de la tarde ve lo de la mañana.

POR QUÉ UN HILO Y NO UN CRON DE RENDER. Render cobra el cron como un servicio aparte, y
este trabajo dura segundos. Un hilo dentro del proceso web no cuesta nada más... siempre
que el proceso esté despierto, que es exactamente lo que se compra con el plan de pago.

VIENE ENCENDIDO (7-oct). Nació apagado —había que poner `ASA_SYNC_ACTIVO=1`— por el plan
gratuito de Render, donde el proceso se suspende y el hilo muere con él. Con el plan de
pago esa razón no existe, y la variable nunca se puso: el reloj estuvo nueve días sin
correr ni una vez mientras el usuario esperaba que la data se refrescara sola en la
mañana. Un interruptor que hay que acordarse de encender para que algo funcione es un
interruptor mal puesto. Ahora corre solo, y `ASA_SYNC_ACTIVO=0` lo apaga.

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


# Lo que se lee como «apagado». Cualquier otra cosa —incluida la variable sin poner— deja
# el reloj encendido: ver «VIENE ENCENDIDO» arriba.
APAGADO = ("0", "false", "no", "off")


def activo() -> bool:
    return (os.getenv("ASA_SYNC_ACTIVO", "") or "").strip().lower() not in APAGADO


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
    _revisar_barras()
    # Después de los syncs: comprobar usa aSa en vivo, pero el aviso de fabricación lee
    # `asa_pedidos`, que el sync acaba de refrescar.
    _auditorias_al_dia()


# LA REVISIÓN DE BARRAS, UNA VEZ AL DÍA (8-oct). Va DESPUÉS de sincronizar, porque lo que
# decide qué revisar es el `LastModified` que acaba de traer el espejo.
#
# UNA VEZ AL DÍA Y NO EN LOS TRES TURNOS: sincronizar tarda segundos; revisar barras le
# pide a aSa los ítems de cada código y tarda minutos. En el turno que no toca, el reloj
# sigue haciendo lo de siempre y no revisa.
HORA_REVISION = int(os.getenv("CHEQUEO_HORA", "6") or 6)
# Cuántas correcciones se comprueban por corrida. Cada una es UNA llamada a aSa por código
# de control, así que el tope existe para no pasarse del presupuesto de llamadas si alguien
# declara doscientas correcciones el mismo día. Lo que sobra se comprueba en la corrida
# siguiente, y el auditado siempre puede pedirlo a mano desde la pantalla.
TOPE_COMPROBAR = int(os.getenv("AUDITORIA_TOPE_COMPROBAR", "120") or 120)


def _revisar_barras():
    from .db import get_conn
    try:
        ahora = datetime.now(_zona())
        if ahora.hour != HORA_REVISION:
            return
        # Una sola por día, aunque haya dos instancias de Render o el turno se repita.
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT 1 FROM chequeo_revisiones
                        WHERE lanzada_por = 'reloj' AND arrancada > now() - interval '20 hours'
                        LIMIT 1""")
                if cur.fetchone():
                    log.info("Revisión de barras: ya corrió hoy; se salta.")
                    return
        from .chequeos_api import barrido_automatico
        r = barrido_automatico()
        log.info("Revisión de barras: %d códigos, %d señales nuevas (%s)",
                 r["ccs"], r["senales"], r["motivo"])
    except Exception as e:
        # Igual que todo lo demás acá: que falle la revisión no puede tumbar el reloj.
        log.error("Revisión de barras: falló (%s)", e)


def _auditorias_al_dia():
    """Dos trabajos de auditoría que hay que hacer DESPUÉS del sync, no antes.

      1. COMPROBAR las correcciones declaradas. El auditado dice que corrigió; acá se va a
         mirar la barra a aSa. Se corre después del sync porque el aviso de fabricación de
         abajo lee `asa_pedidos`, que el sync acaba de actualizar.
      2. AVISAR de lo que entró a fabricación con una barra mal. Es lo único urgente del
         módulo y no espera a que la auditoría se envíe.

    Las dos cosas tienen que poder fallar sin tumbar el reloj, igual que todo lo de acá."""
    from .db import get_conn
    try:
        from .auditorias import avisar_fabricacion, comprobar_item, _accion_de_items, _recalcular
        with get_conn() as conn:
            with conn.cursor() as cur:
                # LO QUE SE DECLARÓ CORREGIDO Y NO SE HA PODIDO COMPROBAR. Se reintenta lo
                # que quedó en `no_aplica` o sin veredicto: casi siempre es que aSa no
                # respondió, y eso se arregla solo al día siguiente. Lo ya comprobado no se
                # vuelve a mirar: sería gastar una llamada por barra todos los días.
                cur.execute(
                    """SELECT i.id, e.auditoria_id, i.elemento_id
                         FROM auditoria_items i
                         JOIN auditoria_elementos e ON e.id = i.elemento_id
                        WHERE i.conforme IS FALSE AND i.corregido AND NOT i.desestimado
                          AND COALESCE(i.verificado, '') NOT IN ('ok', 'sigue_igual')
                        ORDER BY i.id LIMIT %s""", (TOPE_COMPROBAR,))
                pend = cur.fetchall()
                ok = 0
                for item_id, _aud_id, _eid in pend:
                    try:
                        if comprobar_item(cur, item_id).get("resultado") == "ok":
                            ok += 1
                    except Exception as e:
                        log.warning("Auditorías: no se pudo comprobar la barra %s (%s)", item_id, e)
                for eid in {p[2] for p in pend}:
                    cur.execute("UPDATE auditoria_elementos SET accion_estado = %s WHERE id = %s",
                                (_accion_de_items(cur, eid), eid))
                for aud_id in {p[1] for p in pend}:
                    _recalcular(cur, aud_id)
                avisados = avisar_fabricacion(cur)
        log.info("Auditorías: %d correccion(es) comprobadas (%d ok), %d aviso(s) de fabricación",
                 len(pend), ok, len(avisados))
    except Exception as e:
        log.error("Auditorías: falló el repaso diario (%s)", e)


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
        log.info("Reloj de aSa apagado a propósito (ASA_SYNC_ACTIVO=0).")
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
