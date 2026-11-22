# Obraz aplikacji KOWR dla Google Cloud Run (i dowolnego hosta z Dockerem).
# Etap 1 buduje frontend (static/ui.js, static/ui.css) ze źródeł w frontend/,
# etap 2 to serwer FastAPI, który serwuje API i gotowy frontend.

# ---------- etap 1: frontend ----------
FROM node:22-slim AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY frontend ./frontend
COPY static ./static
RUN npm run build

# ---------- etap 2: serwer ----------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # GDAL z koła rasterio czyta rastry przez HTTPS; wskazujemy systemowe certyfikaty
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    KOWR_CACHE_DIR=/app/cache \
    KOWR_DATA_DIR=/app/data \
    PORT=8080

WORKDIR /app

# libexpat1: GDAL z koła rasterio linkuje ją dynamicznie, a obraz slim jej nie ma
RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install -r requirements.txt

# Kod aplikacji i modele ML (bez danych treningowych, zob. .dockerignore)
COPY app ./app
COPY kowr_ml ./kowr_ml
COPY static ./static
COPY --from=frontend /src/static/ui.js /src/static/ui.css ./static/

# Użytkownik bez uprawnień roota; cache/ i data/ muszą być zapisywalne
RUN useradd --create-home --uid 10001 kowr \
    && mkdir -p /app/cache /app/data \
    && chown -R kowr:kowr /app/cache /app/data
USER kowr

EXPOSE 8080

# Jeden proces: worker raportów pól (app/fields.py) i SQLite działają w obrębie jednego procesu.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
