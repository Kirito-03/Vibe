# 🎵 Vibe no Sekai — Resumen Técnico de Arquitectura

> Generado el: 2026-06-10 | Corpus: `Kirito-03/Vibe`

---

## 1. Árbol de Directorios

```
app/                              ← Raíz del monorepo
├── src/                          ← Frontend (React + Vite)
│   ├── app/
│   │   ├── App.tsx               ← Router principal (rutas de la SPA)
│   │   ├── AppShell.tsx          ← Shell con Player global persistente
│   │   ├── api.ts                ← Cliente HTTP centralizado (apiFetch + Firebase token)
│   │   ├── track.ts              ← Utilidades de normalización Track↔Song
│   │   ├── types.ts              ← Tipos globales: Song, Track
│   │   ├── userStorage.ts        ← Keys de localStorage por UID
│   │   ├── utils.ts              ← Helpers generales
│   │   ├── components/           ← Componentes de página y UI
│   │   │   ├── Home.tsx          ← Vista principal (For You, Recomendaciones)
│   │   │   ├── NowPlaying.tsx    ← Pantalla full-screen del reproductor
│   │   │   ├── Search.tsx        ← Búsqueda con AI Assist
│   │   │   ├── Library.tsx       ← Biblioteca del usuario
│   │   │   ├── Downloads.tsx     ← Gestión de descargas locales
│   │   │   ├── Player.tsx        ← Mini-player persistente (footer)
│   │   │   ├── Profile.tsx       ← Perfil de usuario
│   │   │   ├── PlaylistDetail.tsx
│   │   │   ├── Login.tsx
│   │   │   └── ...               ← Otros componentes UI
│   │   ├── context/              ← Estado global (React Context API)
│   │   │   ├── PlaybackContext.tsx   ← ⭐ Núcleo del reproductor (2000+ líneas)
│   │   │   ├── MusicContext.tsx      ← Playlists (backend + Firestore)
│   │   │   ├── HomeDataContext.tsx   ← Cache TTL para For You / Recommendations
│   │   │   └── AppSettingsContext.tsx← Configuración de usuario (tema, calidad)
│   │   ├── hooks/                ← Custom React hooks
│   │   ├── utils/                ← Utilidades especializadas
│   │   │   ├── trackQuality.ts   ← Ranking / filtrado de tracks
│   │   │   └── platform.ts       ← Detección web vs. Capacitor (Android)
│   │   └── data/                 ← Datos estáticos (géneros, seeds)
│   ├── firebaseConfig.ts         ← Init de Firebase Auth + Firestore
│   ├── main.tsx                  ← Entry point (monta providers)
│   └── styles/                   ← CSS global
│
├── backend/                      ← API Server (Express + TypeScript)
│   ├── src/
│   │   ├── index.ts              ← Entry point: CORS, rutas, startup health checks
│   │   ├── db.ts                 ← Pool de conexiones PostgreSQL (pg)
│   │   ├── firebase.ts           ← Firebase Admin SDK (verificación de tokens)
│   │   ├── routes/
│   │   │   ├── music.ts          ← ⭐ Ruta principal (~2750 líneas): For You, Search,
│   │   │   │                         Recommendations, Download, Listening Events
│   │   │   ├── downloads.ts      ← CRUD de descargas + streaming de audio
│   │   │   ├── auth.ts           ← Registro/login de usuarios en PostgreSQL
│   │   │   ├── user.ts           ← Perfil, preferencias de usuario
│   │   │   └── dev.ts            ← Endpoints de diagnóstico (worker-health, etc.)
│   │   ├── middleware/
│   │   │   └── auth.ts           ← requireAuth: verifica Firebase JWT en cada request
│   │   ├── services/
│   │   │   ├── deepseekRecommendations.ts  ← Generación de seeds con DeepSeek AI
│   │   │   ├── recommendationStore.ts      ← PostgreSQL: cache, seen tracks, feedback
│   │   │   ├── recommendationRanking.ts    ← Scoring de candidatos
│   │   │   ├── mediaWorkerClient.ts        ← Cliente para worker externo (Tailscale)
│   │   │   ├── searchRanking.ts            ← Ranking de resultados de búsqueda
│   │   │   ├── searchAiAssist.ts           ← Corrección/expansión de queries con AI
│   │   │   └── searchDeepseekRerank.ts     ← Re-ranking de búsqueda con DeepSeek
│   │   ├── utils/
│   │   │   ├── trackQuality.ts   ← Filtros de calidad musical
│   │   │   └── response.ts       ← Tipos ItemsResponse, ItemsSource
│   │   └── types/
│   └── scripts/
│       ├── init.sql              ← Schema completo (DROP + CREATE)
│       ├── migrate.sql           ← Migraciones incrementales
│       └── seed.sql              ← Datos de prueba
│
├── Convert/                      ← Servicio de descarga/búsqueda (FastAPI + Python)
│   ├── app.py                    ← ⭐ ~950 líneas: /search, /download, /pipe-audio, /stream-url
│   ├── requirements.txt          ← yt-dlp, fastapi, ffmpeg-python
│   └── Dockerfile
│
├── android/                      ← Proyecto Android (Capacitor)
├── dist/                         ← Build de producción del frontend (Vite)
├── public/                       ← Assets estáticos
├── docker-compose.yml            ← Orquestación completa de servicios
├── nginx.conf                    ← Reverse proxy (frontend + /api/ → backend)
├── vite.config.ts                ← Config Vite + proxy dev
├── capacitor.config.ts           ← Config Capacitor (Android)
├── worker_universal.py           ← Worker alternativo (Tailscale, autónomo)
├── worker_vibe.py                ← Worker especializado para VNS
├── DEPLOY_NOTES.md               ← Notas operacionales del VPS
└── .env.example                  ← Referencia de todas las variables de entorno
```

---

## 2. Stack y Dependencias

### Frontend (`src/`)

| Categoría | Tecnología | Versión |
|-----------|-----------|---------|
| Framework | **React** | 18.3.1 |
| Build tool | **Vite** | 6.3.5 |
| Lenguaje | **TypeScript** | 5.9.x |
| Styling | **TailwindCSS** | 4.1.12 (via `@tailwindcss/vite`) |
| UI Primitives | **Radix UI** | múltiples componentes |
| UI Framework | **MUI** (Material UI) | 7.3.5 |
| Iconos | **Lucide React** | 0.487.0 |
| Animaciones | **Motion** (Framer) | 12.23.24 |
| DnD | **@hello-pangea/dnd**, **react-dnd** | 18.x / 16.x |
| Notificaciones | **Sonner** | 2.0.3 |
| Carousels | **embla-carousel-react** | 8.6.0 |
| Gráficos | **Recharts** | 2.15.2 |
| Auth | **Firebase** (Auth + Firestore) | 12.9.0 |
| Mobile | **Capacitor** (Android) | 8.3.0 |
| Media Controls | **capacitor-music-controls-plugin** | 6.1.0 |
| Color Extract | **color-thief-react** | 2.1.0 |
| Forms | **react-hook-form** | 7.55.0 |

### Backend (`backend/`)

| Categoría | Tecnología |
|-----------|-----------|
| Runtime | **Node.js** (v20 en Docker) |
| Framework | **Express** 4.x |
| Lenguaje | **TypeScript** 5.4.x, compilado con `ts-node-dev` |
| Base de datos | **PostgreSQL** 16 via driver `pg` (pool de conexiones) |
| Auth | **Firebase Admin SDK** 13.6.1 (verificación de JWT) |
| HTTP client | **Axios** 1.x (llamadas a Convert service) |
| Passwords | **bcrypt** 6.x |
| JWT | **jsonwebtoken** 9.x |
| AI (opcional) | **DeepSeek API** (recomendaciones y re-ranking) |

### Convert Service (`Convert/`)

| Tecnología | Uso |
|-----------|-----|
| **FastAPI** | Framework HTTP asíncrono |
| **yt-dlp** | Búsqueda y descarga desde YouTube (sin API oficial) |
| **ffmpeg** | Conversión de audio/video |
| **uvicorn** | ASGI server |

### Infraestructura Docker

| Servicio | Imagen | Puerto interno |
|---------|--------|---------------|
| `vns_db` | `postgres:16-alpine` | 5432 |
| `vns_frontend` | `nginx:alpine` | 80 |
| `vns_backend` | Build local (`node:20`) | 3000 |
| `vns_convert` | Build local (Python) | 8000 |
| `vns_dns` | `m13253/dns-over-https-client` | 53 |
| `vns_tunnel` | `cloudflare/cloudflared` | — |

Todos los servicios están en una red interna `bridge` (`172.28.0.0/16`). El acceso público pasa por **Cloudflare Tunnel** → **Nginx** → servicios internos.

---

## 3. Flujo de Datos y APIs

### Comunicación Cliente → Servidor

```
Browser / Android App
        │
        │  Firebase Auth (JWT Bearer token)
        ▼
[apiFetch] src/app/api.ts
  • Obtiene token con auth.currentUser.getIdToken()
  • Agrega header Authorization: Bearer <token>
  • En dev: proxy a http://localhost:3000 (Vite config)
  • En prod: rutas relativas /api/... (Nginx hace el proxy)
        │
        ▼
Express Backend :3000
  ├── /api/auth/*       (registro, perfil)
  ├── /api/music/*      (for-you, search, recommendations, playlists)
  ├── /api/downloads/*  (stream, CRUD)
  └── /api/user/*       (preferencias)
```

### Middleware de Autenticación

Cada request a rutas protegidas pasa por `requireAuth` ([auth.ts](file:///c:/Users/ASUS/Documents/Projects/app/backend/src/middleware/auth.ts)):

```
Request → requireAuth → Firebase Admin verifyIdToken → req.user.uid → Handler
```

### Integración con YouTube (sin YouTube Data API oficial)

> **⚠️ Importante:** El proyecto NO usa la YouTube Data API v3 (no hay `YOUTUBE_API_KEY`). Toda la interacción con YouTube se hace a través de **yt-dlp** y fallbacks scraping.

**Módulo principal:** [`Convert/app.py`](file:///c:/Users/ASUS/Documents/Projects/app/Convert/app.py)

El flujo de búsqueda y descarga es:

```
Backend (music.ts) → POST/GET http://convert:8000
        │
        ▼
Convert Service (FastAPI + yt-dlp)
  ├── GET  /search?q=...&limit=N
  │     └── yt-dlp ytsearch{N}:<query> --dump-json
  │         ├── Cache en memoria (TTL configurable, default 15min)
  │         └── Fallback: Media Worker (Tailscale) si yt-dlp falla
  │
  ├── POST /download  { url, mode, quality }
  │     └── yt-dlp <url> --extract-audio --audio-format mp3
  │         └── Guarda en volumen mp3_storage compartido
  │
  ├── GET  /pipe-audio?url=...
  │     ├── 1. Sirve desde caché local si existe
  │     ├── 2. yt-dlp --get-url → 302 redirect a Google CDN
  │     └── 3. Fallback: pipe streaming con yt-dlp -o -
  │
  └── GET  /stream-url?url=...
        └── yt-dlp -g → devuelve URL directa del CDN
```

**Fallback chain en caso de bloqueo de YouTube:**

```
yt-dlp (Convert) → Media Worker privado (Tailscale) → Invidious API → DuckDuckGo scraping
```

El backend en `music.ts` también implementa `searchInvidious()` y `searchDuckDuckGoForYoutube()` como fallbacks de búsqueda independientes del Convert service.

### Endpoints del Backend (`/api/music/`)

| Endpoint | Método | Descripción |
|---------|--------|-------------|
| `/for-you` | GET | Feed personalizado (Firestore recents/likes → Convert search) |
| `/recommendations` | GET | Recomendaciones de radio automática |
| `/search` | GET | Búsqueda con AI Assist + DeepSeek reranking |
| `/playlists` | GET/POST | Playlists del usuario en PostgreSQL |
| `/playlists/:id` | GET/PUT/DELETE | CRUD de playlist |
| `/recommendation-feedback` | POST | Feedback (more_like_this / not_this_track / etc.) |
| `/seen-tracks` | POST/DELETE | Marcar/limpiar tracks vistos (antirepetición) |
| `/recommendation-cache` | DELETE | Limpiar caché de recomendaciones |
| `/listening-event` | POST | Evento de escucha para personalización |

---

## 4. Últimos Cambios y Refactorizaciones

Basado en el análisis del código y `DEPLOY_NOTES.md`:

### 1. Sistema de Worker Externo (Tailscale) — Feature reciente
- Se añadió soporte para un **media worker privado** accesible vía Tailscale como fallback cuando YouTube bloquea el VPS (401/403/bot detection).
- Variables: `MEDIA_WORKER_ENABLED`, `MEDIA_WORKER_URL`, `MEDIA_WORKER_TIMEOUT_MS`.
- El worker se verifica en `backend/src/services/mediaWorkerClient.ts` y existe un endpoint de diagnóstico en `/api/dev/worker-health`.
- El Convert service también tiene lógica de fallback al worker (`_worker_post()`).

### 2. Sistema de Recomendaciones con DeepSeek — Feature reciente
- Integración con **DeepSeek API** para generar seeds de búsqueda personalizados basados en el perfil musical del usuario.
- Módulos: `deepseekRecommendations.ts`, `searchDeepseekRerank.ts`, `searchAiAssist.ts`.
- Feature-flagged via `DEEPSEEK_RECOMMENDATIONS_ENABLED=true/false`.
- Caching de recomendaciones en PostgreSQL (`UserRecommendationCache`) con TTL configurable.

### 3. Refactor del Sistema de Cookies para yt-dlp
- Convert service ahora gestiona cookies de YouTube mediante un archivo `cookies.txt` que se copia a `/tmp` antes de cada operación (para evitar problemas con FS read-only en Docker).
- `_prepare_cookies_tmp()` valida el archivo antes de usarlo y deshabilita cookies automáticamente si es inválido.
- Documentado en `DEPLOY_NOTES.md`.

### 4. Anti-repetición con `UserSeenTracks` (PostgreSQL)
- Tabla nueva `UserSeenTracks` que registra qué tracks ha visto cada usuario (por `firebase_uid` + `track_key`).
- TTL configurable via `RECOMMENDATION_SEEN_TTL_HOURS` (default 24h).
- Evita que el sistema de recomendaciones repita las mismas canciones en sesiones cortas.

### 5. Sistema de Feedback de Recomendaciones
- Tabla `UserRecommendationFeedback` con tipos: `more_like_this`, `not_this_track`, `not_this_artist`, `not_this_genre`.
- El frontend lo dispara desde `TrackFeedbackMenu.tsx` → `api.ts:apiSendRecommendationFeedback()`.

### 6. Auto-Repair de Tracks en PlaybackContext
- `repairTrack()` en `PlaybackContext.tsx`: si un track falla al reproducirse, hace una búsqueda en `/api/music/search` y usa `isSafeRepairMatch()` para validar el candidato (por artista, título y duración con tolerancia de ±20s).
- Limpia el track roto de Firestore `recents` y localStorage.

### 7. Soporte Capacitor (Android)
- CORS configurado para aceptar `capacitor://localhost`.
- `capacitor.config.ts` presente en raíz.
- `isNativePlatform()` en `utils/platform.ts` para bifurcar comportamiento web/native.

---

## 5. Modelos y Estado

### Estado Global Frontend (React Context API)

#### `PlaybackContext` — [`PlaybackContext.tsx`](file:///c:/Users/ASUS/Documents/Projects/app/src/app/context/PlaybackContext.tsx)
El contexto más complejo (~2000 líneas). Gestiona:

| Estado | Tipo | Descripción |
|--------|------|-------------|
| `currentSong` | `Song \| null` | Canción actualmente cargada |
| `currentPlaylist` | `Playlist \| null` | Cola/playlist activa |
| `isPlaying` | `boolean` | Estado reproducción |
| `progress` | `number` | Progreso en % |
| `volume` | `number` | Volumen 0-100 |
| `repeatMode` | `'off' \| 'all' \| 'one'` | Modo repetición |
| `shuffle` | `boolean` | Modo aleatorio |
| `favorites` | `Set<string>` | Track keys marcados como favoritos (Firestore snapshot) |
| `sleepTimerRemainingSec` | `number \| null` | Temporizador de sueño |
| `preparingTrackKey` | `string \| null` | Track en preparación (loading state) |
| `playbackError` | `string \| null` | Error de reproducción |

**Características clave:**
- Persiste estado en `localStorage` por UID (`vns_playback_state_v1`)
- **Radio automática**: al reproducir sin playlist, expande la cola con recomendaciones en background (`fetchAndAppendRelated`)
- **Likes en tiempo real** via Firestore `onSnapshot`
- **Sleep timer** con countdown
- **Crossfade** entre tracks
- **Repair de tracks** rotos con búsqueda automática

#### `MusicContext` — [`MusicContext.tsx`](file:///c:/Users/ASUS/Documents/Projects/app/src/app/context/MusicContext.tsx)

| Estado | Origen |
|--------|--------|
| `backendPlaylists` | `/api/music/playlists` (PostgreSQL) |
| `userPlaylists` | Firestore `users/{uid}/playlists` |

Expone: `createPlaylist()`, `deletePlaylist()`, `fetchPlaylistWithSongs()`.

#### `HomeDataContext` — [`HomeDataContext.tsx`](file:///c:/Users/ASUS/Documents/Projects/app/src/app/context/HomeDataContext.tsx)

Cache con TTL de 5 minutos para los datos del home:

| Estado | Descripción |
|--------|-------------|
| `forYouItems` | Items de `/api/music/for-you` |
| `recommendationsItems` | Items de `/api/music/recommendations` |
| `recentTracks` | Historial reciente del usuario |
| `isLoadingForYou / isLoadingRecommendations` | Loading states |
| `lastLoadedAt` | Timestamp para control de TTL |

Se limpia al cambiar de usuario (`clearHomeDataCache()` cuando `uid` cambia).

#### `AppSettingsContext`
Configuración persistente del usuario: tema, calidad de audio, preferencias de reproducción.

---

### Entidades en PostgreSQL

```sql
-- Entidades principales
Users          (id, firebase_uid UNIQUE, email, display_name, photo_url)
Artists        (id, name)
Albums         (id, title, artist_id, release_date, image_url)
Music          (id, title, artist_id, album_id, duration, url, thumbnail)
Playlists      (id, user_id, name, description, image_url, created_at)
PlaylistSongs  (playlist_id, song_id) ← Junction M:M

-- Core de streaming
Downloads      (id, title, youtube_id UNIQUE+mode, uploader, duration,
                thumbnail, url, mode CHECK('audio'|'video'), created_at)
Likes          (id, download_id → Downloads)
History        (id, download_id → Downloads, played_at)

-- Sistema de recomendaciones
UserRecommendationCache    (firebase_uid, endpoint, profile_hash, items JSONB,
                            expires_at) ← UNIQUE(uid, endpoint, hash)
UserSeenTracks             (firebase_uid, track_key, title_norm, artist_norm,
                            reason, seen_at) ← UNIQUE(uid, track_key)
GlobalCatalogTracks        (youtube_id UNIQUE, title, uploader, score, updated_at)
UserRecommendationFeedback (firebase_uid, track_key, feedback_type, metadata JSONB)
                            ← UNIQUE(uid, track_key, feedback_type)
```

### Datos en Firebase / Firestore

```
users/{uid}/
  ├── recents/{trackKey}  ← Historial de reproducción (played_at, title, artist)
  ├── likes/{trackKey}    ← Favoritos con metadata (youtube_id, title, artist, image_url)
  └── playlists/{id}/
        └── tracks/{trackId}  ← Canciones de playlists de usuario
```

> **Patrón dual**: Playlists del usuario viven en **Firestore** (creadas por el usuario), mientras que playlists curadas/backend viven en **PostgreSQL**. El `MusicContext` las fusiona transparentemente.

---

## 6. Arquitectura General (Diagrama)

```
┌─────────────────────────────────────────────┐
│              Cliente (Browser/Android)       │
│  React 18 + Vite │ Capacitor (Android)      │
│                                              │
│  PlaybackContext ─── Audio HTMLElement       │
│  MusicContext    ─── Firestore (realtime)    │
│  HomeDataContext ─── Cache 5min TTL          │
└──────────────────────────┬──────────────────┘
                           │ HTTPS (Cloudflare Tunnel)
                           │ Bearer: Firebase JWT
                           ▼
┌─────────────────────────────────────────────┐
│               Nginx (reverse proxy)          │
│  /api/* → backend:3000                       │
│  /*     → frontend static (dist/)            │
└──────────┬─────────────────────────────────┘
           │
    ┌──────┴───────┐
    │              │
    ▼              ▼
┌─────────┐   ┌──────────────────────────────┐
│ Express │   │  Firebase Admin SDK           │
│ :3000   │   │  (verifica JWT en middleware) │
│         │   └──────────────────────────────┘
│ routes/ │
│  music  │──────────────────────┐
│  downloads                     │ axios
│  auth                          ▼
│  user   │              ┌──────────────────┐
└────┬────┘              │ Convert (FastAPI) │
     │ pg Pool           │ yt-dlp + ffmpeg  │
     ▼                   │ :8000            │
┌──────────┐             └────────┬─────────┘
│PostgreSQL│                      │ fallback
│  :5432   │             ┌────────┴──────────┐
│          │             │ Media Worker      │
│ Downloads│             │ (Tailscale VPN)   │
│ Users    │             │ worker_universal  │
│ Recs...  │             └───────────────────┘
└──────────┘
```
