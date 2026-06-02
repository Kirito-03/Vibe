import logging
import json
import os
import time
from pathlib import Path
import subprocess
from typing import Optional
import shutil
import tempfile
import requests

from fastapi import FastAPI, HTTPException, Request as FastAPIRequest, Body
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from yt_dlp import YoutubeDL
from dotenv import load_dotenv

load_dotenv()

# -------------------- LOGGING --------------------
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('youtube_downloader')

app = FastAPI(title="YouTube Downloader Service", version="1.0.0")

_SEARCH_CACHE: dict = {}
_SEARCH_CACHE_ORDER: list[str] = []

def _search_timeout_seconds() -> int:
    try:
        ms = int(os.getenv("CONVERT_SEARCH_TIMEOUT_MS") or os.getenv("CONVERT_TIMEOUT_MS") or "15000")
        if ms <= 0:
            return 15
        return max(1, int(ms / 1000))
    except Exception:
        return 15

def _search_cache_ttl_seconds() -> int:
    try:
        ms = int(os.getenv("CONVERT_SEARCH_CACHE_TTL_MS", "900000"))
        if ms <= 0:
            return 0
        return max(1, int(ms / 1000))
    except Exception:
        return 900

def _normalize_search_query(q: str) -> str:
    return " ".join(str(q or "").strip().lower().split())

def _cache_get(key: str):
    ttl = _search_cache_ttl_seconds()
    if ttl <= 0:
        return None
    v = _SEARCH_CACHE.get(key)
    if not v:
        return None
    ts, data = v
    if (time.time() - ts) > ttl:
        try:
            del _SEARCH_CACHE[key]
        except Exception:
            pass
        return None
    return data

def _cache_set(key: str, data):
    ttl = _search_cache_ttl_seconds()
    if ttl <= 0:
        return
    _SEARCH_CACHE[key] = (time.time(), data)
    _SEARCH_CACHE_ORDER.append(key)
    max_size = 250
    while len(_SEARCH_CACHE_ORDER) > max_size:
        old = _SEARCH_CACHE_ORDER.pop(0)
        if old != key:
            try:
                del _SEARCH_CACHE[old]
            except Exception:
                pass

@app.on_event("startup")
def _startup_diagnostics():
    cookies_src = _detect_cookie_source_path()
    logger.info(
        "startup diagnostics",
        extra={
            "cookiesPath": str(cookies_src) if cookies_src else None,
            "cookiesExists": bool(cookies_src),
            "cookiesSize": (cookies_src.stat().st_size if cookies_src else 0),
            "proxySet": bool(os.getenv("YTDLP_PROXY")),
            "cookiesEnv": bool(os.getenv("YTDLP_COOKIES_PATH")),
        },
    )


# -------------------- MODELS --------------------
class DownloadRequest(BaseModel):
    url: str
    mode: str = "audio"   # "audio" | "video"
    quality: str = "high"


class DownloadResponse(BaseModel):
    title: str
    filename: str
    file_path: str
    mode: str
    duration_seconds: Optional[int] = None
    thumbnail_url: Optional[str] = None
    uploader: Optional[str] = None


# -------------------- HELPERS --------------------
def clean_url(url: str) -> str:
    if "youtube.com/watch" in url and "v=" in url:
        video_id = url.split("v=")[1].split("&")[0]
        return f"https://www.youtube.com/watch?v={video_id}"
    return url


def _resolve_ffmpeg_location() -> Optional[str]:
    ffmpeg_path = os.getenv("FFMPEG_PATH")
    if ffmpeg_path and Path(ffmpeg_path).exists():
        return ffmpeg_path
    return None


def _get_storage_base_dir() -> Path:
    base = os.getenv("STORAGE_DIR", "/app/downloads")
    p = Path(base).resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def _move_to_storage(src: Path, mode: str) -> Path:
    base = _get_storage_base_dir()
    target_root = base / ("audio" if mode == "audio" else "video")
    target_root.mkdir(parents=True, exist_ok=True)
    dest = target_root / src.name
    if dest.exists():
        unique = Path(tempfile.mkstemp()[1]).name
        dest = target_root / f"{src.stem}-{unique}{src.suffix}"
    shutil.move(str(src), str(dest))
    return dest


def _find_downloaded_file(temp_dir: Path) -> Optional[Path]:
    files = sorted(list(temp_dir.glob('*')), key=lambda f: f.stat().st_size, reverse=True)
    return files[0] if files else None


def _video_format_from_quality(q: str) -> str:
    mapping = {
        "best": "bestvideo+bestaudio/best",
        "2160p": "bestvideo[height<=2160]+bestaudio/best[height<=2160]",
        "1440p": "bestvideo[height<=1440]+bestaudio/best[height<=1440]",
        "1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
        "720p":  "bestvideo[height<=720]+bestaudio/best[height<=720]",
        "480p":  "best[height<=480]",
        "360p":  "best[height<=360]",
    }
    return mapping.get(q, "bestvideo+bestaudio/best")


def _audio_bitrate_from_quality(q: str) -> str:
    return {"high": "320", "medium": "192", "low": "128"}.get(q, "192")


def _detect_cookie_source_path() -> Optional[Path]:
    env_path = os.getenv("YTDLP_COOKIES_PATH")
    candidates: list[Path] = []
    if env_path:
        candidates.append(Path(env_path))
    candidates.append(Path("/app/cookies.txt"))
    for p in candidates:
        try:
            if p.exists() and p.stat().st_size > 0:
                return p
        except Exception:
            continue
    try:
        for p in sorted(Path("/app").glob("cookies*.txt")):
            if p.exists() and p.stat().st_size > 0:
                return p
    except Exception:
        pass
    return None


def _prepare_cookies_tmp() -> Optional[Path]:
    src = _detect_cookie_source_path()
    if not src:
        return None
    tmp_cookies = Path("/tmp/yt_cookies.txt")
    try:
        shutil.copy2(str(src), str(tmp_cookies))
        return tmp_cookies
    except Exception:
        return None


def _yt_dlp_base_args() -> list:
    """
    Common yt-dlp args used across all endpoints.
    - Copies cookies.txt to /tmp so yt-dlp can write without hitting read-only FS.
    - Uses 'web' player client only (android fails with cookies).
    - Includes JS runtime + EJS solver for YouTube n-challenge.
    """
    args = [
        "--no-check-certificate",
        "--no-playlist",
        "--no-warnings",
        "--force-ipv4",
        "--retries", "10",
        "--fragment-retries", "10",
        "--socket-timeout", "20",
        "--retry-sleep", "1:10",
        "--js-runtimes", "node:/usr/bin/node",
        "--remote-components", "ejs:github",
        "--extractor-args", "youtube:player_client=web",
    ]
    proxy = os.getenv("YTDLP_PROXY")
    if proxy:
        args += ["--proxy", proxy]
    tmp_cookies = _prepare_cookies_tmp()
    if tmp_cookies:
        args += ["--cookies", str(tmp_cookies)]
    return args


def _worker_enabled() -> bool:
    enabled = os.getenv("MEDIA_WORKER_ENABLED", "").lower() in ("true", "1", "yes")
    return enabled and bool(os.getenv("MEDIA_WORKER_URL"))


def _worker_base_url() -> str:
    return (os.getenv("MEDIA_WORKER_URL") or "").rstrip("/")


def _worker_timeout_seconds() -> int:
    try:
        ms = int(os.getenv("MEDIA_WORKER_TIMEOUT_MS", "30000"))
        if ms <= 0:
            return 30
        return max(1, int(ms / 1000))
    except Exception:
        return 30


def _worker_post(path: str, payload: dict) -> Optional[dict]:
    if not _worker_enabled():
        return None
    base = _worker_base_url()
    if not base:
        return None
    url = f"{base}{path}"
    timeout = _worker_timeout_seconds()
    try:
        logger.info("[worker] request", extra={"url": base, "endpoint": path, "timeoutSec": timeout})
        r = requests.post(url, json=payload, timeout=timeout)
        logger.info("[worker] response", extra={"endpoint": path, "status": r.status_code})
        if r.status_code < 200 or r.status_code >= 300:
            return None
        return r.json()
    except Exception:
        logger.exception("[worker] error", extra={"endpoint": path})
        return None


def _extract_youtube_id(url: str) -> Optional[str]:
    try:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower().replace("www.", "").replace("m.", "")
        if host == "youtu.be":
            vid = parsed.path.strip("/").split("/")[0]
            return vid or None
        if host.endswith("youtube.com"):
            if parsed.path.startswith("/watch"):
                qs = parse_qs(parsed.query)
                vid = (qs.get("v") or [None])[0]
                return vid
            if parsed.path.startswith("/shorts/"):
                parts = parsed.path.strip("/").split("/")
                return parts[1] if len(parts) > 1 else None
            if parsed.path.startswith("/embed/"):
                parts = parsed.path.strip("/").split("/")
                return parts[1] if len(parts) > 1 else None
    except Exception:
        return None
    return None


# -------------------- CORE DOWNLOAD --------------------
def _do_download(url: str, mode: str, quality: str) -> DownloadResponse:
    url = clean_url(url)
    logger.info(f"Downloading {url} mode={mode} quality={quality}")

    storage_base = _get_storage_base_dir()
    youtube_id = _extract_youtube_id(url)
    if youtube_id:
        existing = storage_base / ("audio" if mode == "audio" else "video") / f"{youtube_id}.{'mp3' if mode == 'audio' else 'mp4'}"
        if existing.exists():
            return DownloadResponse(
                title=existing.stem,
                filename=existing.name,
                file_path=str(existing),
                mode=mode,
            )

    temp_dir = Path(tempfile.mkdtemp())
    try:
        cookie_path = _detect_cookie_source_path()
        cookie_available = bool(cookie_path)
        ffmpeg_loc = _resolve_ffmpeg_location()
        logger.info(
            "yt-dlp cookies diagnostic",
            extra={
                "cookiesPath": str(cookie_path) if cookie_path else None,
                "cookiesExists": bool(cookie_path),
                "cookiesSize": (cookie_path.stat().st_size if cookie_path else 0),
                "proxySet": bool(os.getenv("YTDLP_PROXY")),
                "mode": mode,
            },
        )

        last_err: Optional[str] = None
        info: dict = {}

        attempt_sets = [False, True] if cookie_available else [False]
        for use_cookies in attempt_sets:
            cookie_tmp: Optional[Path] = None
            if use_cookies:
                cookie_tmp = temp_dir / "cookies.txt"
                shutil.copyfile(cookie_path, cookie_tmp)  # type: ignore[arg-type]

            client_attempts = ["android,web,ios", "android", "web", "ios"] if not use_cookies else ["web"]
            for client_arg in client_attempts:
                # LA HOJA DEL VERDUGO: IGNORANDO ESCUDOS SSL
                base_cmd = [
                    "yt-dlp",
                    "--no-check-certificate",  # <--- INYECTADO: Obliga a ignorar SSL
                    "--no-playlist",
                    "--no-warnings",
                    "--quiet",
                    "--force-ipv4",
                    "--retries", "10",
                    "--fragment-retries", "10",
                    "--socket-timeout", "20",
                    "--retry-sleep", "1:10",
                    "--js-runtimes",
                    "node:/usr/bin/node",
                    "--extractor-args",
                    f"youtube:player_client={client_arg}",
                    "-o",
                    str(temp_dir / "%(id)s.%(ext)s"),
                ]
                proxy = os.getenv("YTDLP_PROXY")
                if proxy:
                    base_cmd.extend(["--proxy", proxy])

                if use_cookies:
                    base_cmd.extend(["--remote-components", "ejs:github"])

                if ffmpeg_loc:
                    base_cmd.extend(["--ffmpeg-location", ffmpeg_loc])
                if cookie_tmp:
                    base_cmd.extend(["--cookies", str(cookie_tmp)])

                info_cmd = [*base_cmd, "--skip-download", "--dump-json", url]
                info_result = subprocess.run(info_cmd, capture_output=True, text=True)
                if info_result.returncode != 0:
                    last_err = (info_result.stderr or info_result.stdout).strip() or "yt-dlp failed"
                    continue

                for line in reversed(info_result.stdout.splitlines()):
                    try:
                        info = json.loads(line)
                        break
                    except Exception:
                        continue

                if mode == "audio":
                    dl_cmd = [*base_cmd, *[
                        "-f", "bestaudio/best",
                        "--extract-audio",
                        "--audio-format", "mp3",
                        "--audio-quality", f"{_audio_bitrate_from_quality(quality)}K",
                        "--no-keep-video",
                    ], url]
                else:
                    dl_cmd = [*base_cmd, *[
                        "-f", _video_format_from_quality(quality),
                        "--merge-output-format", "mp4",
                    ], url]

                dl_result = subprocess.run(dl_cmd, capture_output=True, text=True)
                if dl_result.returncode == 0:
                    last_err = None
                    break

                last_err = (dl_result.stderr or dl_result.stdout).strip() or "yt-dlp failed"

            if not last_err:
                break

        if last_err and not info:
            raise RuntimeError(last_err)

        downloaded = _find_downloaded_file(temp_dir)
        if not downloaded:
            raise RuntimeError("No se encontró el archivo descargado")

        final_path = _move_to_storage(downloaded, mode)
        logger.info(f"Saved to {final_path}")

        return DownloadResponse(
            title=(info.get("title") if isinstance(info, dict) else None) or final_path.stem,
            filename=final_path.name,
            file_path=str(final_path),
            mode=mode,
            duration_seconds=(info.get("duration") if isinstance(info, dict) else None),
            thumbnail_url=(info.get("thumbnail") if isinstance(info, dict) else None),
            uploader=((info.get("uploader") or info.get("channel")) if isinstance(info, dict) else None),
        )

    except Exception as e:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise e


# -------------------- ROUTES --------------------
@app.get("/search")
def search_youtube(q: str, limit: int = 5):
    q_norm = _normalize_search_query(q)
    if not q_norm:
        return []
    try:
        limit = int(limit or 5)
    except Exception:
        limit = 5
    if limit < 1:
        limit = 1
    if limit > 10:
        limit = 10

    cache_key = f"{q_norm}:{limit}"
    cached = _cache_get(cache_key)
    if isinstance(cached, list) and len(cached) > 0:
        logger.info("[convert/search] cache-hit", extra={"query": q_norm, "limit": limit, "items": len(cached)})
        return cached

    cookies_src = _detect_cookie_source_path()
    cookies_tmp = _prepare_cookies_tmp()
    timeout_sec = _search_timeout_seconds()
    start = time.perf_counter()

    logger.info(
        "[convert/search] start",
        extra={
            "query": q_norm,
            "limit": limit,
            "timeoutSec": timeout_sec,
            "cookiesPath": str(cookies_src) if cookies_src else None,
            "cookiesExists": bool(cookies_src),
            "cookiesAttached": bool(cookies_tmp),
            "proxySet": bool(os.getenv("YTDLP_PROXY")),
        },
    )

    try:
        base_args = _yt_dlp_base_args()
        cmd = [
            "yt-dlp",
            *base_args,
            "--flat-playlist",
            "--dump-json",
            "--skip-download",
            f"ytsearch{limit}:{q_norm}",
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec)
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or proc.stdout).strip() or "yt-dlp failed")

        raw_entries = []
        for line in (proc.stdout or "").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                raw_entries.append(json.loads(line))
            except Exception:
                continue

        results = []

        NON_MUSIC_TITLE = [
            'podcast', ' show ', 'talk show', 'interview', 'comedian',
            'standup', 'stand-up', 'comedy show', 'news', 'noticias',
            'reportaje', 'documental', 'documentary', 'telenovela',
            'novela', 'serie ', 'episodio ', 'temporada ', 'season ',
            'episode ', ' ep. ', 'programa ', 'programa de', 'late show',
            'morning show', 'night show', 'entertainment group',
            'trailer oficial', 'official trailer', 'película completa',
            'full movie', 'peli completa', 'reaction video', 'reaccion a',
            'responding to', 'compilation of', 'best moments',
            'type beat', 'flp', 'drum kit', 'sample pack',
        ]
        NON_MUSIC_CHANNEL = [
            'elite entertainment', 'telemundo', 'univision', 'cnn', 'bbc',
            'fox news', 'msnbc', 'netflix', 'hbo', 'disney', 'amazon prime',
            'canal rcn', 'caracol', 'canal uno', 'tvn', 'las estrellas',
            'televisa', 'tv azteca', 'entertainment group', 'films official',
            'productions', 'studios official',
        ]

        for entry in raw_entries:
            if not isinstance(entry, dict):
                continue
            title_raw = (entry.get("title") or "").lower()
            channel_raw = (entry.get("uploader") or entry.get("channel") or "").lower()
            duration = entry.get("duration") or 0

            if duration and (duration > 1200 or duration < 40):
                continue
            if any(kw in title_raw for kw in NON_MUSIC_TITLE):
                continue
            if any(kw in channel_raw for kw in NON_MUSIC_CHANNEL):
                continue

            vid = entry.get("id") or _extract_youtube_id(str(entry.get("url") or entry.get("webpage_url") or ""))
            if not vid:
                continue

            thumb = entry.get("thumbnail")
            if not thumb:
                thumbs = entry.get("thumbnails") or []
                if isinstance(thumbs, list) and len(thumbs) > 0 and isinstance(thumbs[-1], dict):
                    thumb = thumbs[-1].get("url")
            if not thumb:
                thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"

            results.append({
                "id": vid,
                "title": entry.get("title"),
                "uploader": entry.get("uploader") or entry.get("channel") or "Internet",
                "duration_seconds": duration or None,
                "thumbnail_url": thumb,
                "url": f"https://www.youtube.com/watch?v={vid}",
                "source": "youtube"
            })

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.info(
            "[convert/search] done",
            extra={
                "query": q_norm,
                "rawItems": len(raw_entries),
                "items": len(results),
                "elapsedMs": elapsed_ms,
                "cookiesAttached": bool(cookies_tmp),
            },
        )
        if len(results) > 0:
            _cache_set(cache_key, results)
            return results

        if _worker_enabled():
            worker_json = _worker_post("/search", {"query": q_norm, "limit": limit})
            worker_items = worker_json.get("items") if isinstance(worker_json, dict) else None
            if isinstance(worker_items, list) and len(worker_items) > 0:
                mapped = []
                for w in worker_items:
                    if not isinstance(w, dict):
                        continue
                    sid = str(w.get("sourceId") or "").strip() or str(w.get("id") or "").split(":")[-1]
                    mapped.append(
                        {
                            "id": sid,
                            "title": w.get("title"),
                            "uploader": w.get("artist") or w.get("uploader") or "Internet",
                            "duration_seconds": w.get("duration") or 0,
                            "thumbnail_url": w.get("coverUrl"),
                            "url": w.get("url") or f"https://www.youtube.com/watch?v={sid}",
                            "source": "youtube",
                        }
                    )
                logger.info("[worker] search fallback", extra={"query": q_norm, "items": len(mapped)})
                return mapped

        return results
    except subprocess.TimeoutExpired as e:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.warning("[convert/search] timeout", extra={"query": q_norm, "timeoutSec": timeout_sec, "elapsedMs": elapsed_ms})
        if _worker_enabled():
            worker_json = _worker_post("/search", {"query": q_norm, "limit": limit})
            worker_items = worker_json.get("items") if isinstance(worker_json, dict) else None
            if isinstance(worker_items, list) and len(worker_items) > 0:
                mapped = []
                for w in worker_items:
                    if not isinstance(w, dict):
                        continue
                    sid = str(w.get("sourceId") or "").strip() or str(w.get("id") or "").split(":")[-1]
                    mapped.append(
                        {
                            "id": sid,
                            "title": w.get("title"),
                            "uploader": w.get("artist") or w.get("uploader") or "Internet",
                            "duration_seconds": w.get("duration") or 0,
                            "thumbnail_url": w.get("coverUrl"),
                            "url": w.get("url") or f"https://www.youtube.com/watch?v={sid}",
                            "source": "youtube",
                        }
                    )
                logger.info("[worker] search fallback", extra={"query": q_norm, "items": len(mapped)})
                return mapped
        return []
    except Exception as e:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.exception("[convert/search] error", extra={"query": q_norm, "elapsedMs": elapsed_ms, "cookiesAttached": bool(cookies_tmp)})
        if _worker_enabled():
            worker_json = _worker_post("/search", {"query": q_norm, "limit": limit})
            worker_items = worker_json.get("items") if isinstance(worker_json, dict) else None
            if isinstance(worker_items, list) and len(worker_items) > 0:
                mapped = []
                for w in worker_items:
                    if not isinstance(w, dict):
                        continue
                    sid = str(w.get("sourceId") or "").strip() or str(w.get("id") or "").split(":")[-1]
                    mapped.append(
                        {
                            "id": sid,
                            "title": w.get("title"),
                            "uploader": w.get("artist") or w.get("uploader") or "Internet",
                            "duration_seconds": w.get("duration") or 0,
                            "thumbnail_url": w.get("coverUrl"),
                            "url": w.get("url") or f"https://www.youtube.com/watch?v={sid}",
                            "source": "youtube",
                        }
                    )
                logger.info("[worker] search fallback", extra={"query": q_norm, "items": len(mapped)})
                return mapped
        return []

@app.get("/stream-url")
def get_stream_url(url: str):
    logger.info(f"Getting stream URL for: {url}")
    base_args = _yt_dlp_base_args()
    logger.info(
        "stream-url diagnostics",
        extra={
            "cookiesPath": str(_detect_cookie_source_path()) if _detect_cookie_source_path() else None,
            "cookiesAttached": ("--cookies" in base_args),
            "proxySet": bool(os.getenv("YTDLP_PROXY")),
        },
    )
    cmd = [
        "yt-dlp",
        "-f", "bestaudio/best",
        "-g",
        "--quiet",
        *base_args,
        url
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if out.returncode == 0 and out.stdout.strip():
            return {"url": out.stdout.strip().split("\n")[0]}
        err_msg = out.stderr.strip() or out.stdout.strip() or "Unknown yt-dlp error"
        logger.error(f"stream-url yt-dlp failed: {err_msg}")
        if _worker_enabled():
            worker_json = _worker_post("/extract", {"url": url})
            audio_url = worker_json.get("audioUrl") if isinstance(worker_json, dict) else None
            if audio_url:
                logger.info("[worker] extract fallback", extra={"endpoint": "/extract"})
                return {"url": audio_url}
        raise HTTPException(status_code=500, detail=f"Failed to extract: {err_msg}")
    except subprocess.TimeoutExpired:
        if _worker_enabled():
            worker_json = _worker_post("/extract", {"url": url})
            audio_url = worker_json.get("audioUrl") if isinstance(worker_json, dict) else None
            if audio_url:
                logger.info("[worker] extract fallback", extra={"endpoint": "/extract"})
                return {"url": audio_url}
        raise HTTPException(status_code=504, detail="Timeout requesting stream url")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stream URL error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/pipe-audio")
def pipe_audio(url: str, request: FastAPIRequest = None):
    """
    Fast audio streaming:
    1. Check local cache first (instant)
    2. yt-dlp --get-url to get direct Google CDN URL (~2-3s) → 302 redirect
    3. Fallback to yt-dlp pipe if get-url fails
    """
    from fastapi.responses import RedirectResponse
    logger.info(f"Piping audio for: {url}")
    storage_base = _get_storage_base_dir()
    youtube_id = _extract_youtube_id(url)

    # ── 1. Local cache hit ────────────────────────────────────────
    if youtube_id:
        for ext in ("mp3", "webm", "m4a", "opus"):
            existing = storage_base / "audio" / f"{youtube_id}.{ext}"
            if existing.exists():
                logger.info(f"Serving cached: {existing}")
                mime = "audio/mpeg" if ext == "mp3" else f"audio/{ext}"
                def serve_cached(path=existing, m=mime):
                    with open(path, "rb") as f:
                        while True:
                            chunk = f.read(65536)
                            if not chunk:
                                break
                            yield chunk
                return StreamingResponse(
                    serve_cached(),
                    media_type=mime,
                    headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"},
                )

    # ── 2. yt-dlp --get-url → 302 redirect to Google CDN ────────
    base_args = _yt_dlp_base_args()
    logger.info(
        "pipe-audio diagnostics",
        extra={
            "cookiesPath": str(_detect_cookie_source_path()) if _detect_cookie_source_path() else None,
            "cookiesAttached": ("--cookies" in base_args),
            "proxySet": bool(os.getenv("YTDLP_PROXY")),
        },
    )

    try:
        get_url_cmd = [
            "yt-dlp",
            "-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
            "--get-url",
            "--quiet",
            *base_args,
            url,
        ]
        result = subprocess.run(get_url_cmd, capture_output=True, text=True, timeout=15)
        if result.returncode == 0 and result.stdout.strip():
            direct_url = result.stdout.strip().split("\n")[0]
            logger.info(f"yt-dlp get-url succeeded, redirecting to CDN")
            # 302 redirect: browser streams directly from Google CDN (CORS-open)
            return RedirectResponse(url=direct_url, status_code=302)
    except Exception as e:
        logger.warning(f"yt-dlp get-url failed: {e}, falling back to pipe")

    # ── 3. Fallback: full yt-dlp pipe ─────────────────────────────
    logger.info("Falling back to yt-dlp pipe")
    cmd = [
        "yt-dlp",
        "-f", "bestaudio[ext=webm]/bestaudio/best",
        "-o", "-",
        "--quiet",
        *base_args,
        url
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def stream_yt(p=proc):
        try:
            while True:
                chunk = p.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            try: p.stdout.close()
            except: pass
            try: p.kill()
            except: pass

    return StreamingResponse(
        stream_yt(),
        media_type="audio/webm",
        headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"},
    )


@app.get("/health")

def health():
    return {"status": "ok", "service": "youtube-downloader"}


class ClearMediaCacheRequest(BaseModel):
    confirm: str


@app.delete("/cache/media")
def clear_media_cache(req: ClearMediaCacheRequest = Body(...)):
    if (req.confirm or "").strip() != "CLEAR_MEDIA_CACHE":
        raise HTTPException(status_code=400, detail="Invalid confirm")

    base = _get_storage_base_dir()
    targets = [
        base / "audio",
        base / "video",
        base / "images",
        base / "covers",
        base / "tmp",
    ]

    deleted_files = 0
    freed_bytes = 0
    deleted_by_dir: dict[str, int] = {}

    for d in targets:
        try:
            if not d.exists() or not d.is_dir():
                continue
            count = 0
            for p in d.rglob("*"):
                try:
                    if not p.is_file():
                        continue
                    size = p.stat().st_size
                    p.unlink(missing_ok=True)
                    deleted_files += 1
                    freed_bytes += int(size)
                    count += 1
                except Exception:
                    continue
            deleted_by_dir[str(d)] = count
        except Exception:
            continue

    logger.info("[media-cache] cleared", extra={"deletedFiles": deleted_files, "freedBytes": freed_bytes})
    return {"ok": True, "deletedFiles": deleted_files, "freedBytes": freed_bytes, "deletedByDir": deleted_by_dir}


@app.post("/download", response_model=DownloadResponse)
def download(req: DownloadRequest):
    if not req.url:
        raise HTTPException(status_code=400, detail="URL requerida")

    mode = req.mode if req.mode in ("audio", "video") else "audio"

    try:
        result = _do_download(req.url, mode, req.quality)
        return result
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Download error: {error_msg}")
        if "not available" in error_msg:
            raise HTTPException(status_code=422, detail="Video no disponible (privado o bloqueado)")
        elif "Sign in" in error_msg:
            raise HTTPException(status_code=401, detail="Requiere autenticación de YouTube")
        else:
            raise HTTPException(status_code=500, detail=f"Error en la descarga: {error_msg}")


# -------------------- MUSIC-ONLY ENDPOINT --------------------
class MusicDownloadRequest(BaseModel):
    url: str
    quality: str = "high"


@app.post("/download-music")
def download_music(req: MusicDownloadRequest):
    """Descarga SOLO audio y lo registra automáticamente en la base de datos del backend."""
    import requests as http_req

    if not req.url:
        raise HTTPException(status_code=400, detail="URL requerida")

    try:
        # 1. Descargar solo audio
        result = _do_download(req.url, "audio", req.quality)

        # 2. Registrar en el backend Node.js → PostgreSQL
        backend_url = os.getenv("BACKEND_URL", "http://backend:3000")
        try:
            db_res = http_req.post(
                f"{backend_url}/api/downloads/register",
                json={
                    "title": result.title,
                    "filename": result.filename,
                    "file_path": result.file_path,
                    "mode": "audio",
                    "duration_seconds": result.duration_seconds,
                    "thumbnail_url": result.thumbnail_url,
                    "artist": result.uploader,
                },
                timeout=10,
            )
            db_data = db_res.json() if db_res.status_code < 400 else None
        except Exception as db_err:
            logger.warning(f"DB register failed (non-critical): {db_err}")
            db_data = None

        return JSONResponse(content={
            "title": result.title,
            "filename": result.filename,
            "mode": "audio",
            "duration_seconds": result.duration_seconds,
            "thumbnail_url": result.thumbnail_url,
            "artist": result.uploader,
            "saved_to_db": db_data is not None,
            "db_record": db_data,
        })

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Music download error: {error_msg}")
        raise HTTPException(status_code=500, detail=f"Error: {error_msg}")


# -------------------- RUN --------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
