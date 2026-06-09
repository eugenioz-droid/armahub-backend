# Dockerfile — empaqueta ArmaHub (FastAPI) para correr en Cloudflare Containers.
#
# Imagen liviana de Python 3.11 (la versión usada en desarrollo).
# El container es efímero: NO guarda archivos en disco (las imágenes/planos van a R2).

FROM python:3.11-slim

# Evita prompts y mejora logs en container
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencias del sistema mínimas para psycopg/pandas (libpq, build básico).
# Se instalan y limpian en una sola capa para mantener la imagen pequeña.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

# 1) Instalar dependencias primero (capa cacheable: solo se reconstruye si cambia requirements.txt)
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# 2) Copiar el código de la app
COPY armahub/ ./armahub/

# Cloudflare Containers enruta al puerto que exponga la app.
# Usamos 8080 por convención; el Worker proxy apuntará a este puerto.
ENV PORT=8080
EXPOSE 8080

# Arranque: uvicorn sirviendo armahub.main:app.
# --host 0.0.0.0 para aceptar conexiones del proxy; puerto desde env PORT.
CMD ["sh", "-c", "uvicorn armahub.main:app --host 0.0.0.0 --port ${PORT}"]
