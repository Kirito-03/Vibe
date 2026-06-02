FROM python:3.11-slim

# Instalamos las herramientas de guerra necesarias
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    bash \
    gnupg \
    dirmngr \
    && update-ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Suministros de dependencias
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir -U yt-dlp yt-dlp-ejs

# El corazón de la operación
COPY app.py .

# Sincronización de rutas: Todo bajo /app/downloads
RUN mkdir -p /app/downloads/audio /app/downloads/video

EXPOSE 8000

# Vigilancia del estado del servicio
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Orden de inicio
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
