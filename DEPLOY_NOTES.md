# Deploy notes (VPS)

## Worker privado (Tailscale)

Si YouTube bloquea el VPS (401/403/bot/cookies/timeout), el backend puede usar un **worker externo** como fallback.

Variables sugeridas en `.env` (raíz, para docker compose):

```bash
MEDIA_WORKER_ENABLED=true
MEDIA_WORKER_URL=http://100.x.y.z:5001
MEDIA_WORKER_TIMEOUT_MS=30000
```

Verificación rápida (solo desarrollo):

```bash
curl -H "Authorization: Bearer <token>" https://vibenosekai.art/api/dev/worker-health
```

## Convert: cookies (yt-dlp)

En producción, el servicio **Convert** intenta leer cookies desde `Convert/cookies.txt` (montado como `/app/cookies.txt`).

- Si el archivo no existe, está vacío o es un directorio, Convert desactiva cookies automáticamente y continúa sin romper descargas.
- Si el archivo existe y es válido, Convert lo adjunta a yt-dlp como `--cookies /app/cookies.txt`.

### Crear/actualizar cookies.txt en el VPS

```bash
cd /home/kirito/Vibe

rm -rf Convert/cookies.txt
nano Convert/cookies.txt
chmod 600 Convert/cookies.txt

docker compose up -d --build
```

Plantilla de referencia: `Convert/cookies.example.txt`.

### Verificar dentro del contenedor

```bash
docker compose exec convert sh -lc 'ls -la /app/cookies.txt; test -f /app/cookies.txt && wc -c /app/cookies.txt || true'
docker compose logs -n 200 convert | grep -E "\\[cookies\\]"
```
