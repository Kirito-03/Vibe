import { Router, Request, Response } from 'express';
import pool from '../db';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { downloadWithWorker, extractWithWorker, isWorkerEnabled } from '../services/mediaWorkerClient';
import { upsertGlobalCatalogTracks } from '../services/recommendationStore';

const router = Router();

const DOWNLOADER_URL = process.env.DOWNLOADER_URL || 'http://convert:8000';
const MEDIA_BASE_DIR = process.env.MEDIA_BASE_DIR || '/app/downloads';
let schemaReadyPromise: Promise<void> | null = null;

const ensureDownloadsSchema = async () => {
  await pool.query(`ALTER TABLE Downloads ADD COLUMN IF NOT EXISTS youtube_id VARCHAR(32)`);
  await pool.query(`ALTER TABLE Downloads ADD COLUMN IF NOT EXISTS uploader TEXT`);
  await pool.query(`ALTER TABLE Downloads ADD COLUMN IF NOT EXISTS duration INTEGER`);
  await pool.query(`ALTER TABLE Downloads ADD COLUMN IF NOT EXISTS thumbnail TEXT`);
  await pool.query(`ALTER TABLE Downloads ADD COLUMN IF NOT EXISTS url TEXT`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS downloads_youtube_id_mode_uidx
     ON Downloads (youtube_id, mode)
     WHERE youtube_id IS NOT NULL`
  );
};

const ensureDownloadsSchemaReady = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureDownloadsSchema().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  await schemaReadyPromise;
};

const extractYoutubeId = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }
    if (host.endsWith('youtube.com')) {
      const fromQuery = parsed.searchParams.get('v');
      if (fromQuery) return fromQuery;
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.split('/')[2];
        return id || null;
      }
      if (parsed.pathname.startsWith('/embed/')) {
        const id = parsed.pathname.split('/')[2];
        return id || null;
      }
    }
  } catch {
    return null;
  }
  return null;
};

const isHttpUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\//i.test(v);

const inferExt = (filename: unknown, fallback = '.mp3') => {
  if (typeof filename !== 'string') return fallback;
  const ext = path.extname(filename).toLowerCase();
  if (!ext) return fallback;
  if (ext.length > 10) return fallback;
  return ext;
};

const safeBaseName = (name: unknown, fallback: string) => {
  const base = typeof name === 'string' ? path.basename(name) : '';
  const cleaned = base.replace(/[^\w.\-()+\[\] ]+/g, '').trim();
  return cleaned || fallback;
};

const convertFailureReason = (error: any): { shouldFallback: boolean; reason: string } => {
  const status = Number(error?.response?.status || 0);
  const msg = String(error?.message || '');
  const detail = String(error?.response?.data?.detail || error?.response?.data?.error || '');
  const text = `${msg}\n${detail}`.toLowerCase();

  const isTimeout =
    String(error?.code || '').toLowerCase() === 'econnaborted' ||
    /timeout/i.test(msg) ||
    /timeout/i.test(detail);

  const blocked =
    status === 401 ||
    status === 403 ||
    text.includes("sign in to confirm you're not a bot") ||
    text.includes('requiere autenticación') ||
    text.includes('cookies') ||
    text.includes('not a bot');

  if (isTimeout) return { shouldFallback: true, reason: 'timeout' };
  if (blocked) return { shouldFallback: true, reason: `blocked:${status || 'unknown'}` };
  return { shouldFallback: false, reason: status ? `http:${status}` : 'error' };
};

const normalizeWorkerDownload = (data: any) => {
  const ok = data?.ok === true || data?.success === true || !!(data?.url || data?.audioUrl || data?.file_url);
  const fileUrl = data?.url || data?.audioUrl || data?.file_url || null;
  const filename = data?.filename || data?.name || null;
  return { ok, fileUrl, filename, raw: data };
};

const allowedRemoteHosts = () => {
  let workerHost = '';
  try {
    workerHost = process.env.MEDIA_WORKER_URL ? new URL(process.env.MEDIA_WORKER_URL).hostname : '';
  } catch {}
  return [
    'googlevideo.com',
    'youtube.com',
    'youtu.be',
    'soundcloud.com',
    'sndcdn.com',
    workerHost,
  ].filter(Boolean);
};

const isAllowedRemoteUrl = (rawUrl: string) => {
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const allow = allowedRemoteHosts();
    return allow.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
};

const pipeRemoteToResponse = async (remoteUrl: string, req: Request, res: Response) => {
  if (!isAllowedRemoteUrl(remoteUrl)) {
    return res.status(403).json({ error: 'Forbidden: redirect host no autorizado' });
  }

  const headers: Record<string, string> = {};
  const range = req.headers.range;
  if (typeof range === 'string' && range.trim()) headers.Range = range;

  const upstream = await axios.get(remoteUrl, {
    responseType: 'stream',
    timeout: 60_000,
    headers,
    validateStatus: () => true,
  });

  const status = upstream.status || 502;
  const passHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
  for (const h of passHeaders) {
    const v = upstream.headers?.[h];
    if (typeof v === 'string' && v) res.setHeader(h, v);
  }
  res.status(status);
  upstream.data.pipe(res);
};

const downloadRemoteToLocal = async (remoteUrl: string, destPath: string) => {
  if (!isAllowedRemoteUrl(remoteUrl)) return null;
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${destPath}.tmp-${Date.now()}`;
  const writer = fs.createWriteStream(tmpPath);
  try {
    const upstream = await axios.get(remoteUrl, {
      responseType: 'stream',
      timeout: 120_000,
      validateStatus: () => true,
    });
    if (upstream.status < 200 || upstream.status >= 300) {
      try { writer.close(); } catch {}
      try { fs.unlinkSync(tmpPath); } catch {}
      return null;
    }
    await new Promise<void>((resolve, reject) => {
      upstream.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    fs.renameSync(tmpPath, destPath);
    return destPath;
  } catch {
    try { writer.close(); } catch {}
    try { fs.unlinkSync(tmpPath); } catch {}
    return null;
  }
};

const toApiDownload = (row: any) => {
  if (!row) return row;
  return {
    ...row,
    artist: row.uploader ?? row.artist ?? null,
    duration_seconds: row.duration ?? row.duration_seconds ?? null,
    thumbnail_url: row.thumbnail ?? row.thumbnail_url ?? null,
    file_path: row.url ?? row.file_path ?? null,
  };
};

// ──────────────────────────────────────────────
// POST /api/downloads  →  solicita descarga
// ──────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  // Removed debug header log
  let finalBody = req.body || {};
  if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
    try { finalBody = JSON.parse(req.body); } catch(e) {}
  } else if (Buffer.isBuffer(req.body)) {
    try { finalBody = JSON.parse(req.body.toString('utf8')); } catch(e) {}
  }
  const { url, mode = 'audio', quality = 'high', youtube_id, title: bodyTitle, uploader: bodyUploader } = finalBody;

  if (!url) {
    return res.status(400).json({ error: 'URL requerida' });
  }

  const ALLOWED_HOSTS = ['youtube.com', 'youtu.be', 'soundcloud.com'];
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !ALLOWED_HOSTS.some(h => parsed.hostname.endsWith(h))) {
      return res.status(400).json({ error: 'URL no permitida o dominio no autoizado' });
    }
  } catch {
    return res.status(400).json({ error: 'URL inválida' });
  }

  try {
    await ensureDownloadsSchemaReady();
    const extractedYoutubeId = typeof youtube_id === 'string' && youtube_id.trim()
      ? youtube_id.trim()
      : extractYoutubeId(url);

    if (extractedYoutubeId) {
      const existingByYoutubeId = await pool.query(
        `SELECT * FROM Downloads WHERE youtube_id = $1 AND mode = $2 ORDER BY created_at DESC LIMIT 1`,
        [extractedYoutubeId, mode]
      );
      if (existingByYoutubeId.rows.length > 0) {
        const existing = existingByYoutubeId.rows[0];
        const existingPath = existing.url as string;
        if (existingPath && /^https?:\/\//i.test(existingPath)) {
          return res.status(200).json(toApiDownload(existing));
        }
        if (existingPath && fs.existsSync(existingPath)) {
          return res.status(200).json(toApiDownload(existing));
        }
      }
    }

    let dlData: any | null = null;
    try {
      const pyRes = await axios.post(
        `${DOWNLOADER_URL}/download`,
        { url, mode, quality },
        { timeout: 300_000 }
      );
      dlData = pyRes.data;
    } catch (error: any) {
      const failure = convertFailureReason(error);
      console.warn('[downloads] convert failed', { reason: failure.reason, status: error?.response?.status });

      if (failure.shouldFallback && isWorkerEnabled()) {
        console.log('[worker/download] fallback=true', { url });
        const workerData = await downloadWithWorker(url);
        const norm = normalizeWorkerDownload(workerData);
        if (norm.ok && isHttpUrl(norm.fileUrl)) {
          const ext = inferExt(norm.filename, mode === 'video' ? '.mp4' : '.mp3');
          const baseName = extractedYoutubeId ? `${extractedYoutubeId}${ext}` : safeBaseName(norm.filename, `worker-${Date.now()}${ext}`);
          const localPath = path.join(MEDIA_BASE_DIR, mode === 'video' ? 'video' : 'audio', baseName);
          const stored = await downloadRemoteToLocal(String(norm.fileUrl), localPath);
          if (stored) {
            dlData = {
              ...workerData,
              filename: path.basename(stored),
              file_path: stored,
            };
            console.log('[worker/download] ok', { stored: path.basename(stored) });
          } else {
            console.warn('[worker/download] failed', { reason: 'download_remote_failed' });
          }
        } else {
          console.warn('[worker/download] failed', { reason: 'empty_response' });
        }
      }
      if (!dlData) throw error;
    }

    const {
      title,
      filename,
      file_path,
      duration_seconds,
      thumbnail_url,
      uploader,
    } = dlData || {};

    // Fallback if yt-dlp fails to get title and just returns the youtube id
    const finalTitle = (title && title !== extractedYoutubeId && title !== filename) ? title : (bodyTitle || title);
    const finalUploader = (uploader && uploader !== 'Unknown') ? uploader : (bodyUploader || uploader || 'Desconocido');

    const normalizedTitle = String(finalTitle || '').trim();
    const normalizedArtist = String(finalUploader || '').trim();

    const existingByMetadata = await pool.query(
      `SELECT * FROM Downloads
       WHERE LOWER(title) = LOWER($1)
         AND LOWER(COALESCE(uploader, '')) = LOWER($2)
         AND mode = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalizedTitle, normalizedArtist, mode]
    );
    if (existingByMetadata.rows.length > 0) {
      const existing = existingByMetadata.rows[0];
      const existingPath = existing.url as string;
      if (existingPath && /^https?:\/\//i.test(existingPath)) {
        return res.status(200).json(toApiDownload(existing));
      }
      if (existingPath && fs.existsSync(existingPath)) {
        return res.status(200).json(toApiDownload(existing));
      }
    }

    const result = await pool.query(
      `INSERT INTO Downloads (title, uploader, duration, thumbnail, url, mode, youtube_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (youtube_id, mode) WHERE youtube_id IS NOT NULL
       DO UPDATE SET
         title = EXCLUDED.title,
         uploader = EXCLUDED.uploader,
         duration = EXCLUDED.duration,
         thumbnail = EXCLUDED.thumbnail,
         url = EXCLUDED.url
       RETURNING *`,
      [
        normalizedTitle,
        normalizedArtist || null,
        duration_seconds || null,
        thumbnail_url || `https://i.ytimg.com/vi/${extractedYoutubeId}/hqdefault.jpg`,
        file_path,
        mode,
        extractedYoutubeId,
      ]
    );

    const saved = result.rows[0];
    const uid = String((req as any)?.user?.uid || '').trim();
    if (uid && saved?.youtube_id) {
      void upsertGlobalCatalogTracks(
        [
          {
            id: saved.youtube_id,
            youtube_id: saved.youtube_id,
            title: saved.title,
            uploader: saved.uploader,
            artist: saved.uploader,
            duration_seconds: saved.duration,
            thumbnail_url: saved.thumbnail,
            url: typeof saved.url === 'string' && saved.url.startsWith('http') ? saved.url : `https://www.youtube.com/watch?v=${saved.youtube_id}`,
          },
        ],
        3
      ).catch(() => {});
    }

    return res.status(201).json(toApiDownload(saved));
  } catch (error: any) {
    console.error('[downloads] Error:', error?.response?.data || error.message);
    const detail = error?.response?.data?.detail || error.message;
    return res.status(500).json({ error: detail });
  }
});

// ──────────────────────────────────────────────
// GET /api/downloads  →  listar todos
// ──────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const { youtube_id } = req.query;
    if (youtube_id && typeof youtube_id === 'string') {
      const result = await pool.query(
        `SELECT * FROM Downloads WHERE youtube_id = $1 ORDER BY created_at DESC`,
        [youtube_id.trim()]
      );
      return res.json(result.rows.map(toApiDownload));
    }
    const result = await pool.query(
      'SELECT * FROM Downloads ORDER BY created_at DESC'
    );
    return res.json(result.rows.map(toApiDownload));
  } catch (error) {
    console.error('[downloads] List error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────
// GET /api/downloads/stream-direct  →  Resolves YouTube URL → 302 to seekable CDN URL
// MUST be defined BEFORE /:id to avoid Express wildcard conflict
// ──────────────────────────────────────────────
router.get('/stream-direct', async (req: Request, res: Response) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL requerida' });
  }
  const ALLOWED_HOSTS = ['youtube.com', 'youtu.be', 'soundcloud.com'];
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !ALLOWED_HOSTS.some((h) => parsed.hostname.endsWith(h))) {
      return res.status(400).json({ error: 'URL no permitida o dominio no autorizado' });
    }
  } catch {
    return res.status(400).json({ error: 'URL inválida' });
  }
  try {
    // Ask Python to extract the direct audio CDN URL via yt-dlp --get-url
    // Python /stream-url already does this and returns { url: "https://rr*.googlevideo.com/..." }
    const pyRes = await axios.get(`${DOWNLOADER_URL}/stream-url?url=${encodeURIComponent(url)}`, {
      timeout: 130000,
      validateStatus: () => true,
    });
    const directUrl = pyRes.status >= 200 && pyRes.status < 300 ? pyRes.data?.url : null;
    if (!directUrl) {
      if (isWorkerEnabled()) {
        console.warn('[downloads] stream-direct convert failed', { status: pyRes.status });
        const extracted = await extractWithWorker(url);
        const workerUrl = extracted?.audioUrl;
        if (workerUrl && isHttpUrl(workerUrl)) {
          console.log('[worker/extract] ok', { fallback: true });
          return await pipeRemoteToResponse(String(workerUrl), req, res);
        }
        console.warn('[worker/extract] failed', { fallback: true });
      }
      return res.status(502).json({ error: 'No se pudo obtener URL directa' });
    }
    // 302 redirect: browser connects directly to Google CDN (seekable, Range-capable)
    return res.redirect(302, directUrl);
  } catch (error: any) {
    console.error('[downloads] stream-direct error:', error?.response?.data || error.message);
    if (isWorkerEnabled()) {
      const extracted = await extractWithWorker(url);
      const workerUrl = extracted?.audioUrl;
      if (workerUrl && isHttpUrl(workerUrl)) {
        console.log('[worker/extract] ok', { fallback: true });
        return await pipeRemoteToResponse(String(workerUrl), req, res);
      }
      console.warn('[worker/extract] failed', { fallback: true });
    }
    return res.status(500).json({ error: 'Error al obtener stream' });
  }
});

// ──────────────────────────────────────────────
// GET /api/downloads/:id  →  metadatos de uno
// MUST be after all named sub-routes
// ──────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const result = await pool.query('SELECT * FROM Downloads WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Download no encontrado' });
    }
    return res.json(toApiDownload(result.rows[0]));
  } catch (error) {
    console.error('[downloads] Get error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────
// GET /api/downloads/stream/:id  →  HTTP Range streaming
// Compatible con: <audio>, <video>, expo-av, react-native-video, ExoPlayer
// ──────────────────────────────────────────────
router.get('/stream/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id || !/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const result = await pool.query('SELECT * FROM Downloads WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Download no encontrado' });
    }

    const download = result.rows[0];
    const filePath = download.url as string;
    if (filePath && /^https?:\/\//i.test(filePath)) {
      try {
        const parsed = new URL(filePath);
        const workerHost = process.env.MEDIA_WORKER_URL ? new URL(process.env.MEDIA_WORKER_URL).hostname : '';
        const allowedHosts = [
          'googlevideo.com',
          'youtube.com',
          'youtu.be',
          'soundcloud.com',
          'sndcdn.com',
          workerHost,
        ].filter(Boolean);
        if (!allowedHosts.some((h) => parsed.hostname.endsWith(h))) {
          return res.status(403).json({ error: 'Forbidden: redirect host no autorizado' });
        }
        if (workerHost && parsed.hostname.endsWith(workerHost)) {
          return await pipeRemoteToResponse(filePath, req, res);
        }
        return res.redirect(302, filePath);
      } catch {
        return res.status(400).json({ error: 'URL inválida' });
      }
    }

    const resolvedPath = path.resolve(filePath);
    const allowedDir = path.resolve(MEDIA_BASE_DIR);
    const rel = path.relative(allowedDir, resolvedPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(403).json({ error: 'Forbidden: Path traversal detectado' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado en disco' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();

    // Content-Type según extensión
    const mimeTypes: Record<string, string> = {
      '.mp3':  'audio/mpeg',
      '.m4a':  'audio/mp4',
      '.ogg':  'audio/ogg',
      '.opus': 'audio/ogg; codecs=opus',
      '.wav':  'audio/wav',
      '.flac': 'audio/flac',
      '.mp4':  'video/mp4',
      '.webm': 'video/webm',
      '.mkv':  'video/x-matroska',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      // ── Partial Content (206) ──
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': chunkSize,
        'Content-Type':   contentType,
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
    } else {
      // ── Full file (200) ──
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges':  'bytes',
        'Content-Type':   contentType,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    console.error('[downloads] Stream error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;
