#!/usr/bin/env python3
from __future__ import annotations

import ipaddress
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import quote
from urllib.parse import parse_qs
from urllib.parse import urlparse

from flask import Flask, jsonify, request, send_from_directory

VERSION = "1.0.0"
LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 5001

DOWNLOADS_DIR = Path(os.getenv("WORKER_DOWNLOADS_DIR", "worker_downloads")).resolve()
INDEX_PATH = (DOWNLOADS_DIR / "index.json").resolve()

SEARCH_CACHE_TTL_SEC = 600
SEARCH_CACHE: Dict[str, Tuple[float, Any]] = {}

PENDING_LOCK = threading.Lock()
PENDING: Dict[str, Dict[str, Any]] = {}

LAST_CLEANUP_TS = 0.0
CLEANUP_INTERVAL_SEC = 180

app = Flask(__name__)


def _now() -> float:
    return time.time()


def _normalize_query(q: str) -> str:
    return " ".join(str(q or "").strip().lower().split())


def _safe_json() -> Dict[str, Any]:
    try:
        data = request.get_json(force=True, silent=True) or {}
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _cache_get(key: str):
    v = SEARCH_CACHE.get(key)
    if not v:
        return None
    ts, payload = v
    if (_now() - ts) > SEARCH_CACHE_TTL_SEC:
        SEARCH_CACHE.pop(key, None)
        return None
    return payload


def _cache_set(key: str, payload: Any):
    SEARCH_CACHE[key] = (_now(), payload)
    if len(SEARCH_CACHE) > 250:
        try:
            oldest = sorted(SEARCH_CACHE.items(), key=lambda kv: kv[1][0])[0][0]
            SEARCH_CACHE.pop(oldest, None)
        except Exception:
            pass


def _load_index() -> Dict[str, Any]:
    try:
        if not INDEX_PATH.exists():
            return {}
        data = json.loads(INDEX_PATH.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_index(index: Dict[str, Any]) -> None:
    try:
        tmp = INDEX_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(index, ensure_ascii=False), "utf-8")
        tmp.replace(INDEX_PATH)
    except Exception:
        return


def _is_private_host(host: str) -> bool:
    h = (host or "").strip().lower()
    if not h:
        return True
    if h in ("localhost", "0.0.0.0", "127.0.0.1"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return bool(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast)
    except Exception:
        return False


def _is_allowed_media_url(raw: str) -> bool:
    try:
        u = urlparse(raw)
    except Exception:
        return False
    if u.scheme not in ("http", "https"):
        return False
    host = (u.hostname or "").lower().replace("www.", "").replace("m.", "")
    if _is_private_host(host):
        return False
    allow = ("youtube.com", "youtu.be", "tiktok.com", "instagram.com", "soundcloud.com", "sndcdn.com")
    return any(host == a or host.endswith(f".{a}") for a in allow)


def _extract_youtube_id(raw: str) -> Optional[str]:
    try:
        u = urlparse(raw)
        host = (u.hostname or "").lower().replace("www.", "").replace("m.", "")
        if host == "youtu.be":
            vid = u.path.strip("/").split("/")[0]
            return vid or None
        if host.endswith("youtube.com"):
            if u.path.startswith("/watch"):
                vid = (parse_qs(u.query).get("v") or [None])[0]
                return vid or None
            if u.path.startswith("/shorts/"):
                parts = u.path.strip("/").split("/")
                return parts[1] if len(parts) > 1 else None
            if u.path.startswith("/embed/"):
                parts = u.path.strip("/").split("/")
                return parts[1] if len(parts) > 1 else None
    except Exception:
        return None
    return None


def _normalize_youtube_url(raw: str) -> Optional[str]:
    vid = _extract_youtube_id(raw)
    if not vid:
        return None
    return f"https://www.youtube.com/watch?v={vid}"


def _file_url(name: str) -> str:
    base = (request.host_url or "").rstrip("/")
    return f"{base}/files/{quote(name, safe='')}"


def _detect_tools() -> Tuple[bool, Optional[str], bool]:
    ytdlp_ok = False
    ytdlp_version = None
    ffmpeg_ok = False
    try:
        r = subprocess.run([sys.executable, "-m", "yt_dlp", "--version"], capture_output=True, text=True, timeout=3)
        ytdlp_ok = r.returncode == 0
        ytdlp_version = (r.stdout or "").strip() if ytdlp_ok else None
    except Exception:
        ytdlp_ok = False
        ytdlp_version = None
    try:
        r2 = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=3)
        ffmpeg_ok = r2.returncode == 0
    except Exception:
        ffmpeg_ok = False
    return ytdlp_ok, ytdlp_version, ffmpeg_ok


def _downloads_stats() -> Tuple[int, int]:
    try:
        if not DOWNLOADS_DIR.exists():
            return 0, 0
        count = 0
        size = 0
        for p in DOWNLOADS_DIR.iterdir():
            if p.is_file() and p.name != "index.json":
                count += 1
                try:
                    size += int(p.stat().st_size)
                except Exception:
                    pass
        return count, size
    except Exception:
        return 0, 0


def _maybe_cleanup_throttled():
    global LAST_CLEANUP_TS
    now = _now()
    if (now - LAST_CLEANUP_TS) < CLEANUP_INTERVAL_SEC:
        return
    LAST_CLEANUP_TS = now
    _cleanup_impl()


def _cleanup_impl() -> Dict[str, Any]:
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    index = _load_index()
    now = _now()
    protected_sec = 5 * 60
    old_sec = 30 * 60
    max_bytes = 2 * 1024 * 1024 * 1024

    files = []
    total = 0
    for p in DOWNLOADS_DIR.iterdir():
        if not p.is_file() or p.name == "index.json":
            continue
        try:
            st = p.stat()
            total += int(st.st_size)
            files.append((p, st.st_mtime, int(st.st_size)))
        except Exception:
            continue

    deleted = []

    for p, mtime, size in sorted(files, key=lambda x: x[1]):
        age = now - mtime
        if age < protected_sec:
            continue
        if age >= old_sec:
            try:
                p.unlink()
                total -= size
                deleted.append(p.name)
            except Exception:
                pass

    if total > max_bytes:
        for p, mtime, size in sorted(files, key=lambda x: x[1]):
            if total <= max_bytes:
                break
            age = now - mtime
            if age < protected_sec:
                continue
            if p.exists():
                try:
                    p.unlink()
                    total -= size
                    deleted.append(p.name)
                except Exception:
                    pass

    if deleted:
        for k, v in list(index.items()):
            if isinstance(v, dict) and str(v.get("filename") or "") in deleted:
                index.pop(k, None)
        _save_index(index)

    return {"deletedCount": len(deleted), "deleted": deleted, "totalBytes": total}


@app.get("/")
def index():
    return jsonify({"ok": True, "service": "vibe-media-worker", "version": VERSION})


@app.get("/health")
def health_check():
    try:
        ytdlp_ok, ytdlp_version, ffmpeg_ok = _detect_tools()
        count, size = _downloads_stats()
        size_mb = int(size / (1024 * 1024))
        return jsonify(
            {
                "ok": True,
                "service": "vibe-media-worker",
                "version": VERSION,
                "yt_dlp": ytdlp_ok,
                "yt_dlp_version": ytdlp_version,
                "ffmpeg": ffmpeg_ok,
                "downloads_count": count,
                "downloads_size_mb": size_mb,
                "capabilities": {"search": True, "download": True, "files": True, "extract": True, "cleanup": True},
            }
        )
    except Exception:
        return jsonify(
            {
                "ok": True,
                "service": "vibe-media-worker",
                "version": VERSION,
                "yt_dlp": False,
                "yt_dlp_version": None,
                "ffmpeg": False,
                "downloads_count": 0,
                "downloads_size_mb": 0,
                "capabilities": {"search": True, "download": True, "files": True, "extract": True, "cleanup": True},
            }
        )


@app.post("/search")
def search_music():
    data = _safe_json()
    q_raw = str(data.get("q") or "").strip()
    if not q_raw:
        return jsonify({"ok": True, "items": []})

    try:
        limit = int(data.get("limit") or 10)
    except Exception:
        limit = 10
    if limit < 1:
        limit = 1
    if limit > 10:
        limit = 10

    q = _normalize_query(q_raw)
    key = f"{q}:{limit}"
    cached = _cache_get(key)
    if cached is not None:
        print(f"[WORKER/search] cache-hit q={q}", flush=True)
        return jsonify({"ok": True, "items": cached})

    print(f"[WORKER/search] start q={q}", flush=True)
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--no-playlist",
        "--no-warnings",
        "--skip-download",
        "--dump-json",
        "--quiet",
        f"ytsearch{limit}:{q}",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if proc.returncode != 0:
            print(f"[WORKER/search] failed reason=yt-dlp rc={proc.returncode}", flush=True)
            return jsonify({"ok": False, "items": [], "message": "yt-dlp failed"})

        out = []
        seen = set()
        for line in (proc.stdout or "").splitlines():
            line = (line or "").strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue

            vid = str(row.get("id") or "").strip()
            if not vid or vid in seen:
                continue
            seen.add(vid)

            title = str(row.get("title") or "").strip()
            uploader = str(row.get("uploader") or row.get("channel") or "").strip()
            dur = row.get("duration")
            try:
                dur = int(dur) if dur is not None else None
            except Exception:
                dur = None

            cover = row.get("thumbnail") or None
            if not cover:
                cover = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"

            out.append(
                {
                    "id": vid,
                    "source": "youtube",
                    "sourceId": vid,
                    "title": title,
                    "artist": uploader or "Internet",
                    "duration": dur,
                    "coverUrl": cover,
                    "url": f"https://www.youtube.com/watch?v={vid}",
                }
            )

        _cache_set(key, out)
        print(f"[WORKER/search] done items={len(out)}", flush=True)
        return jsonify({"ok": True, "items": out})
    except subprocess.TimeoutExpired:
        print("[WORKER/search] failed reason=timeout", flush=True)
        return jsonify({"ok": False, "items": [], "message": "timeout"})
    except Exception as exc:
        print(f"[WORKER/search] failed reason={type(exc).__name__}", flush=True)
        return jsonify({"ok": False, "items": [], "message": "error"})


@app.post("/download")
def download_media():
    data = _safe_json()
    raw_url = str(data.get("url") or "").strip()
    if not raw_url or "VIDEO_ID" in raw_url:
        return jsonify({"ok": False, "files": [], "message": "Invalid YouTube URL"}), 400
    if not _is_allowed_media_url(raw_url):
        return jsonify({"ok": False, "files": [], "message": "URL not allowed"}), 400

    kind = str(data.get("kind") or "audio").strip().lower()
    if kind not in ("audio", "video"):
        kind = "audio"
    fmt = str(data.get("format") or ("mp4" if kind == "video" else "mp3")).strip().lower()
    quality = str(data.get("quality") or "medium").strip().lower()

    yt_url = _normalize_youtube_url(raw_url) or raw_url
    youtube_id = _extract_youtube_id(yt_url)
    if not youtube_id:
        return jsonify({"ok": False, "files": [], "message": "Invalid YouTube URL"}), 400

    key = f"youtube:{youtube_id}"
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    index = _load_index()

    entry = index.get(key)
    if isinstance(entry, dict):
        name = str(entry.get("filename") or "").strip()
        if name:
            fp = (DOWNLOADS_DIR / name).resolve()
            if fp.exists() and fp.is_file() and fp.stat().st_size > 0:
                print(f"[WORKER/download] cache-hit videoId={youtube_id}", flush=True)
                return jsonify(
                    {
                        "ok": True,
                        "files": [{"name": name, "url": _file_url(name), "kind": kind, "size": fp.stat().st_size}],
                        "cached": True,
                        "source": "worker-cache",
                    }
                )
            index.pop(key, None)
            _save_index(index)

    join_event = None
    with PENDING_LOCK:
        if key in PENDING:
            join_event = PENDING[key]["event"]
        else:
            ev = threading.Event()
            PENDING[key] = {"event": ev, "result": None}
            join_event = None

    if join_event is not None:
        print(f"[WORKER/download] join-pending videoId={youtube_id}", flush=True)
        join_event.wait(timeout=240)
        with PENDING_LOCK:
            result = (PENDING.get(key) or {}).get("result")
        if result:
            return jsonify(result)

    print(f"[WORKER/download] start videoId={youtube_id}", flush=True)

    ytdlp_ok, _ytdlp_version, ffmpeg_ok = _detect_tools()
    if not ytdlp_ok:
        payload = {"ok": False, "files": [], "message": "yt-dlp not available"}
        with PENDING_LOCK:
            if key in PENDING:
                PENDING[key]["result"] = payload
                PENDING[key]["event"].set()
                PENDING.pop(key, None)
        return jsonify(payload), 500

    out_tmpl = str((DOWNLOADS_DIR / f"{youtube_id}.%(ext)s").resolve())
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "--retries",
        "2",
        "--fragment-retries",
        "2",
        "-o",
        out_tmpl,
    ]

    if kind == "video":
        cmd += ["-f", "best[ext=mp4]/best"]
    else:
        cmd += ["-f", "bestaudio[ext=m4a]/bestaudio/best"]
        if fmt == "mp3" and ffmpeg_ok:
            cmd += ["--extract-audio", "--audio-format", "mp3"]
            aq = {"low": "7", "medium": "5", "high": "2"}.get(quality)
            if aq:
                cmd += ["--audio-quality", aq]

    cmd.append(yt_url)

    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=180, check=False)
    except subprocess.TimeoutExpired:
        payload = {"ok": False, "files": [], "message": "Download timeout"}
        with PENDING_LOCK:
            if key in PENDING:
                PENDING[key]["result"] = payload
                PENDING[key]["event"].set()
                PENDING.pop(key, None)
        print(f"[WORKER/download] failed videoId={youtube_id} reason=timeout", flush=True)
        return jsonify(payload), 504
    except Exception as exc:
        payload = {"ok": False, "files": [], "message": "Download failed"}
        with PENDING_LOCK:
            if key in PENDING:
                PENDING[key]["result"] = payload
                PENDING[key]["event"].set()
                PENDING.pop(key, None)
        print(f"[WORKER/download] failed videoId={youtube_id} reason={type(exc).__name__}", flush=True)
        return jsonify(payload), 500

    candidates = sorted(DOWNLOADS_DIR.glob(f"{youtube_id}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    chosen = None
    for p in candidates:
        if p.is_file() and p.stat().st_size > 0 and p.name != "index.json":
            chosen = p
            break

    if not chosen:
        payload = {"ok": False, "files": [], "message": "No output file"}
        with PENDING_LOCK:
            if key in PENDING:
                PENDING[key]["result"] = payload
                PENDING[key]["event"].set()
                PENDING.pop(key, None)
        print(f"[WORKER/download] failed videoId={youtube_id} reason=no-file", flush=True)
        return jsonify(payload), 500

    name = chosen.name
    size = int(chosen.stat().st_size)

    index = _load_index()
    index[key] = {"filename": name, "kind": kind, "createdAt": int(_now()), "size": size}
    _save_index(index)

    payload = {
        "ok": True,
        "files": [{"name": name, "url": _file_url(name), "kind": kind, "size": size}],
        "cached": False,
        "source": "worker",
    }
    with PENDING_LOCK:
        if key in PENDING:
            PENDING[key]["result"] = payload
            PENDING[key]["event"].set()
            PENDING.pop(key, None)

    print(f"[WORKER/download] ok videoId={youtube_id}", flush=True)
    try:
        _maybe_cleanup_throttled()
    except Exception:
        pass

    return jsonify(payload)


@app.post("/extract")
def extract_media():
    data = _safe_json()
    raw_url = str(data.get("url") or "").strip()
    if not raw_url or "VIDEO_ID" in raw_url:
        return jsonify({"ok": False, "audioUrl": None, "message": "Invalid YouTube URL"}), 400
    if not _is_allowed_media_url(raw_url):
        return jsonify({"ok": False, "audioUrl": None, "message": "URL not allowed"}), 400

    ytdlp_ok, _ytdlp_version, _ffmpeg_ok = _detect_tools()
    if not ytdlp_ok:
        return jsonify({"ok": False, "audioUrl": None, "message": "yt-dlp not available"}), 500

    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "-g",
        raw_url,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if proc.returncode != 0:
            return jsonify({"ok": False, "audioUrl": None, "message": "extract failed"}), 502
        url = (proc.stdout or "").strip().splitlines()
        direct = url[-1].strip() if url else ""
        if not direct.startswith("http"):
            return jsonify({"ok": False, "audioUrl": None, "message": "extract failed"}), 502
        return jsonify({"ok": True, "audioUrl": direct})
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "audioUrl": None, "message": "timeout"}), 504
    except Exception:
        return jsonify({"ok": False, "audioUrl": None, "message": "error"}), 500


@app.get("/files/<path:filename>")
def serve_downloaded_file(filename: str):
    name = str(filename or "")
    if not name:
        return jsonify({"ok": False, "message": "Not found"}), 404
    if name != os.path.basename(name):
        return jsonify({"ok": False, "message": "Not found"}), 404
    if ".." in name or "/" in name or "\\" in name:
        return jsonify({"ok": False, "message": "Not found"}), 404
    if not DOWNLOADS_DIR.exists():
        return jsonify({"ok": False, "message": "Not found"}), 404
    return send_from_directory(str(DOWNLOADS_DIR), name, as_attachment=False)


@app.post("/cleanup")
def cleanup_route():
    try:
        result = _cleanup_impl()
        return jsonify({"ok": True, **result})
    except Exception:
        return jsonify({"ok": True, "deletedCount": 0, "deleted": [], "totalBytes": 0})


if __name__ == "__main__":
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[WORKER] Starting Vibe Media Worker on {LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    print(f"[WORKER] Downloads dir: {DOWNLOADS_DIR}", flush=True)
    app.run(host=LISTEN_HOST, port=LISTEN_PORT, debug=False)
