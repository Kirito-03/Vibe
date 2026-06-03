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
from urllib.parse import urlparse

from flask import jsonify, request

import worker as muxivo

app = muxivo.app

_SEARCH_CACHE: Dict[str, Tuple[float, Any]] = {}
_SEARCH_CACHE_TTL_SEC = 600

_DOWNLOAD_INDEX_PATH = (muxivo.WORKER_DOWNLOADS_DIR / "index.json").resolve()
_PENDING_LOCK = threading.Lock()
_PENDING: Dict[str, Dict[str, Any]] = {}

_LAST_CLEANUP_TS = 0.0
_CLEANUP_INTERVAL_SEC = 180


def _now() -> float:
    return time.time()


def _normalize_query(q: str) -> str:
    return " ".join(str(q or "").strip().lower().split())


def _cache_get(key: str):
    v = _SEARCH_CACHE.get(key)
    if not v:
        return None
    ts, payload = v
    if (_now() - ts) > _SEARCH_CACHE_TTL_SEC:
        try:
            del _SEARCH_CACHE[key]
        except Exception:
            pass
        return None
    return payload


def _cache_set(key: str, payload: Any):
    _SEARCH_CACHE[key] = (_now(), payload)
    if len(_SEARCH_CACHE) > 250:
        try:
            oldest = sorted(_SEARCH_CACHE.items(), key=lambda kv: kv[1][0])[0][0]
            del _SEARCH_CACHE[oldest]
        except Exception:
            pass


def _load_download_index() -> Dict[str, Any]:
    try:
        if not _DOWNLOAD_INDEX_PATH.exists():
            return {}
        raw = _DOWNLOAD_INDEX_PATH.read_text("utf-8")
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_download_index(index: Dict[str, Any]) -> None:
    try:
        tmp = _DOWNLOAD_INDEX_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(index, ensure_ascii=False), "utf-8")
        tmp.replace(_DOWNLOAD_INDEX_PATH)
    except Exception:
        return


def _extract_youtube_id(url: str) -> Optional[str]:
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower().replace("www.", "").replace("m.", "")
        if host == "youtu.be":
            vid = parsed.path.strip("/").split("/")[0]
            return vid or None
        if host.endswith("youtube.com"):
            if parsed.path.startswith("/watch"):
                from urllib.parse import parse_qs

                qs = parse_qs(parsed.query)
                vid = (qs.get("v") or [None])[0]
                return vid or None
            if parsed.path.startswith("/shorts/"):
                parts = parsed.path.strip("/").split("/")
                return parts[1] if len(parts) > 1 else None
            if parsed.path.startswith("/embed/"):
                parts = parsed.path.strip("/").split("/")
                return parts[1] if len(parts) > 1 else None
    except Exception:
        return None
    return None


def _is_private_host(host: str) -> bool:
    h = (host or "").strip().lower()
    if not h:
        return True
    if h in ("localhost", "0.0.0.0"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return bool(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast)
    except Exception:
        return False


def _is_allowed_media_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = parsed.hostname or ""
    if _is_private_host(host):
        return False
    allow = (
        "youtube.com",
        "youtu.be",
        "soundcloud.com",
        "sndcdn.com",
        "tiktok.com",
        "instagram.com",
    )
    h = host.lower().replace("www.", "").replace("m.", "")
    return any(h == a or h.endswith(f".{a}") for a in allow)


def _maybe_cleanup_after_download():
    global _LAST_CLEANUP_TS
    now = _now()
    if (now - _LAST_CLEANUP_TS) < _CLEANUP_INTERVAL_SEC:
        return
    _LAST_CLEANUP_TS = now
    try:
        muxivo.cleanup_old_files()
    except Exception:
        pass


def _install_throttled_cleanup():
    def _throttled_cleanup_old_downloads(keep: int = muxivo.MAX_DOWNLOAD_FILES) -> None:
        try:
            _maybe_cleanup_after_download()
        except Exception:
            return

    muxivo._cleanup_old_downloads = _throttled_cleanup_old_downloads


def _unregister_route(path: str, methods: Tuple[str, ...]) -> None:
    rules = list(app.url_map.iter_rules())
    for rule in rules:
        if rule.rule == path and tuple(sorted(rule.methods)) == tuple(sorted(set(rule.methods))) and any(m in rule.methods for m in methods):
            try:
                app.url_map._rules.remove(rule)
            except Exception:
                pass
            try:
                app.url_map._rules_by_endpoint[rule.endpoint].remove(rule)
            except Exception:
                pass
            try:
                if not app.url_map._rules_by_endpoint.get(rule.endpoint):
                    app.url_map._rules_by_endpoint.pop(rule.endpoint, None)
            except Exception:
                pass
            try:
                app.view_functions.pop(rule.endpoint, None)
            except Exception:
                pass


_install_throttled_cleanup()
_unregister_route("/health", ("GET",))
_unregister_route("/download", ("POST",))


@app.route("/health", methods=["GET"])
def health_vibe():
    ytdlp_ok = False
    ytdlp_version = None
    try:
        result = subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        ytdlp_ok = result.returncode == 0
        ytdlp_version = (result.stdout or "").strip() if ytdlp_ok else None
    except Exception:
        ytdlp_ok = False
        ytdlp_version = None

    return jsonify(
        {
            "ok": True,
            "service": "vibe-media-worker",
            "yt_dlp": ytdlp_ok,
            "yt_dlp_version": ytdlp_version,
            "capabilities": {
                "search": True,
                "download": True,
                "files": True,
                "extract": True,
                "cleanup": True,
            },
        }
    )


@app.route("/search", methods=["POST"])
def search_vibe():
    try:
        data = request.get_json(force=True, silent=True) or {}
    except Exception:
        data = {}

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
    cache_key = f"{q}:{limit}"
    cached = _cache_get(cache_key)
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
            return jsonify({"ok": True, "items": []})

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
        _cache_set(cache_key, out)
        print(f"[WORKER/search] done items={len(out)}", flush=True)
        return jsonify({"ok": True, "items": out})
    except subprocess.TimeoutExpired:
        print("[WORKER/search] failed reason=timeout", flush=True)
        return jsonify({"ok": True, "items": []})
    except Exception as exc:
        print(f"[WORKER/search] failed reason={type(exc).__name__}", flush=True)
        return jsonify({"ok": True, "items": []})


@app.route("/download", methods=["POST"])
def download_vibe():
    try:
        data = request.get_json(force=True, silent=True) or {}
    except Exception:
        data = {}

    url = str(data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "files": [], "message": "Missing 'url' parameter"}), 400

    if not _is_allowed_media_url(url):
        return jsonify({"ok": False, "files": [], "message": "URL not allowed"}), 400

    kind = str(data.get("kind") or "audio").strip().lower()
    if kind not in ("video", "audio"):
        kind = "audio"

    fmt = str(data.get("format") or ("mp4" if kind == "video" else "mp3")).strip().lower()
    quality = str(data.get("quality") or "720").strip()

    youtube_id = _extract_youtube_id(url)
    cache_key = f"youtube:{youtube_id}" if youtube_id else ""

    if cache_key:
        index = _load_download_index()
        entry = index.get(cache_key)
        if isinstance(entry, dict):
            name = str(entry.get("filename") or "").strip()
            if name:
                fp = (muxivo.WORKER_DOWNLOADS_DIR / name).resolve()
                if fp.exists() and fp.is_file() and fp.stat().st_size > 0:
                    file_url = muxivo._get_worker_file_url(name)
                    print(f"[WORKER/download] cache-hit videoId={youtube_id}", flush=True)
                    return jsonify(
                        {
                            "ok": True,
                            "files": [{"name": name, "url": file_url, "kind": kind, "size": fp.stat().st_size}],
                            "cached": True,
                            "source": "worker-cache",
                            "url": url,
                        }
                    )
                index.pop(cache_key, None)
                _save_download_index(index)

    if youtube_id:
        with _PENDING_LOCK:
            existing = _PENDING.get(cache_key)
            if existing:
                ev = existing["event"]
                print(f"[WORKER/download] join pending videoId={youtube_id}", flush=True)
            else:
                ev = threading.Event()
                _PENDING[cache_key] = {"event": ev, "result": None}
        if existing:
            ev.wait(timeout=240)
            with _PENDING_LOCK:
                res_payload = _PENDING.get(cache_key, {}).get("result")
            if res_payload:
                return jsonify(res_payload)

    print(f"[WORKER/download] start url={url}", flush=True)
    try:
        result = muxivo._download_with_ytdlp(url, kind=kind, fmt=fmt, quality=quality)
    except Exception as exc:
        payload = {"ok": False, "files": [], "message": f"Download failed: {type(exc).__name__}: {exc}", "url": url}
        if youtube_id:
            with _PENDING_LOCK:
                if cache_key in _PENDING:
                    _PENDING[cache_key]["result"] = payload
                    _PENDING[cache_key]["event"].set()
                    _PENDING.pop(cache_key, None)
        return jsonify(payload)

    files = result.get("files") or []
    if not files:
        payload = {
            "ok": False,
            "files": [],
            "message": result.get("error") or "yt-dlp produced no output files.",
            "url": url,
        }
        if youtube_id:
            with _PENDING_LOCK:
                if cache_key in _PENDING:
                    _PENDING[cache_key]["result"] = payload
                    _PENDING[cache_key]["event"].set()
                    _PENDING.pop(cache_key, None)
        return jsonify(payload)

    if youtube_id and files:
        try:
            best = files[0]
            name = str(best.get("name") or "").strip()
            size = int(best.get("size") or 0)
            if name and size > 0:
                index = _load_download_index()
                index[cache_key] = {"filename": name, "kind": kind, "createdAt": int(_now()), "size": size}
                _save_download_index(index)
        except Exception:
            pass

    _maybe_cleanup_after_download()

    payload = {"ok": True, "files": files, "cached": False, "source": "worker", "url": url}
    if youtube_id:
        with _PENDING_LOCK:
            if cache_key in _PENDING:
                _PENDING[cache_key]["result"] = payload
                _PENDING[cache_key]["event"].set()
                _PENDING.pop(cache_key, None)
    return jsonify(payload)


if __name__ == "__main__":
    muxivo.WORKER_DOWNLOADS_DIR.mkdir(exist_ok=True)
    print(f"[WORKER] Starting Vibe Media Worker on {muxivo.LISTEN_HOST}:{muxivo.LISTEN_PORT}", flush=True)
    print(f"[WORKER] Downloads dir: {muxivo.WORKER_DOWNLOADS_DIR.resolve()}", flush=True)
    try:
        _maybe_cleanup_after_download()
    except Exception:
        pass
    app.run(host=muxivo.LISTEN_HOST, port=muxivo.LISTEN_PORT, debug=False)

