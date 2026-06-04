
const cleanSourceValue = (value: any): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '' || s === 'null' || s === 'undefined' || s === 'NaN' || s === 'dl-null' || s === '/api/downloads/stream/null' || s.endsWith('/stream/null') || s.includes('watch?v=null')) {
    return null;
  }
  return s;
};

import { Router, Request, Response } from 'express';
import pool from '../db';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { downloadWithWorker, extractWithWorker, isWorkerEnabled } from '../services/mediaWorkerClient';
import { asyncHandler } from '../utils';
import { upsertGlobalCatalogTracks } from '../services/recommendationStore';

const router = Router();

const DOWNLOADER_URL = process.env.DOWNLOADER_URL || 'http://convert:8000';
const MEDIA_BASE_DIR = process.env.MEDIA_BASE_DIR || '/app/downloads';
let schemaReadyPromise: Promise<void> | null = null;
const pendingDownloads = new Map<string, Promise<{ status: number; row: any }>>();

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

const normalizeKey = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

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

// normalizeWorkerDownload removed — now using normalizeWorkerResponse from mediaWorkerClient
// which correctly reads files[0].url from the worker universal response format

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
// GET /api/downloads/resolve → cache-hit rápido (sin descargar)
// ──────────────────────────────────────────────
router.get('/resolve', asyncHandler(async (req: Request, res: Response) => {
  const youtubeId = String(req.query.youtube_id || '').trim();
  const mode = String(req.query.mode || 'audio').trim() === 'video' ? 'video' : 'audio';
  if (!youtubeId) return res.status(400).json({ ok: false, error: 'youtube_id requerido' });

  try {
    await ensureDownloadsSchemaReady();
    const existingByYoutubeId = await pool.query(
      `SELECT * FROM Downloads WHERE youtube_id = $1 AND mode = $2 ORDER BY created_at DESC LIMIT 1`,
      [youtubeId, mode]
    );
    if (existingByYoutubeId.rows.length === 0) {
      return res.json({ ok: true, cached: false, source: 'miss' });
    }

    const existing = existingByYoutubeId.rows[0];
    const existingPath = existing.url as string;
    if (!existingPath || /^https?:\/\//i.test(existingPath)) {
      return res.json({ ok: true, cached: false, source: 'miss' });
    }
    if (!fs.existsSync(existingPath)) {
      return res.json({ ok: true, cached: false, source: 'missing-file' });
    }
    const size = fs.statSync(existingPath).size;
    if (!size || size <= 0) {
      return res.json({ ok: true, cached: false, source: 'missing-file' });
    }

    return res.json({
      ok: true,
      cached: true,
      source: 'local-cache',
      downloadId: existing.id,
      audioUrl: `/api/downloads/stream/${existing.id}`,
    });
  } catch (error: any) {
    console.error('[downloads] resolve error', { message: error?.message });
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}));

// ──────────────────────────────────────────────
// Polling State
// ──────────────────────────────────────────────
type JobStatus = {
  status: 'preparing' | 'ready' | 'failed';
  audioUrl?: string;
  message?: string;
};
const downloadsStatusMap = new Map<string, JobStatus>();

router.get('/status/:jobId', (req, res) => {
  const job = downloadsStatusMap.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ ok: false, status: 'failed', message: 'Job no encontrado' });
  }
  return res.json({ ok: true, ...job });
});

// ──────────────────────────────────────────────
// POST /api/downloads  →  solicita descarga
// ──────────────────────────────────────────────
const makeReqId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const reqId = makeReqId();
  let finalBody = req.body || {};
  if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
    try { finalBody = JSON.parse(req.body); } catch(e) {}
  } else if (Buffer.isBuffer(req.body)) {
    try { finalBody = JSON.parse(req.body.toString('utf8')); } catch(e) {}
  }
  const { url, mode = 'audio', quality = 'high', youtube_id, title: bodyTitle, uploader: bodyUploader } = finalBody;

  if (!url) {
    return res.status(400).json({ ok: false, code: 'MISSING_TRACK_SOURCE', message: 'Missing youtubeId/sourceId/url' });
  }

  const ALLOWED_HOSTS = ['youtube.com', 'youtu.be', 'soundcloud.com'];
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !ALLOWED_HOSTS.some(h => parsed.hostname.endsWith(h))) {
      return res.status(400).json({ ok: false, code: 'MISSING_TRACK_SOURCE', message: 'Missing youtubeId/sourceId/url' });
    }
  } catch {
    return res.status(400).json({ ok: false, code: 'MISSING_TRACK_SOURCE', message: 'Missing youtubeId/sourceId/url' });
  }

  try {
    await ensureDownloadsSchemaReady();
    const extractedYoutubeId = typeof youtube_id === 'string' && youtube_id.trim()
      ? youtube_id.trim()
      : extractYoutubeId(url);
    const pendingKey = `${mode}:${extractedYoutubeId || normalizeKey(url)}`;

    console.log(`[downloads] request reqId=${reqId} youtubeId=${extractedYoutubeId || 'unknown'}`);

    if (extractedYoutubeId) {
      const existingByYoutubeId = await pool.query(
        `SELECT * FROM Downloads WHERE youtube_id = $1 AND mode = $2 ORDER BY created_at DESC LIMIT 1`,
        [extractedYoutubeId, mode]
      );
      if (existingByYoutubeId.rows.length > 0) {
        const existing = existingByYoutubeId.rows[0];
        const existingPath = existing.url as string;
        if (existingPath && /^https?:\/\//i.test(existingPath)) {
          console.log(`[downloads] local-cache hit reqId=${reqId}`);
          return res.status(200).json(toApiDownload(existing));
        }
        if (existingPath && fs.existsSync(existingPath)) {
          console.log(`[downloads] local-cache hit reqId=${reqId}`);
          return res.status(200).json({ ok: true, status: 'ready', audioUrl: `/api/downloads/stream/${existing.id}` });
        }
      }
    }

    const jobId = pendingKey;
    const existingJob = downloadsStatusMap.get(jobId);
    if (existingJob) {
      console.log(`[downloads] job joined jobId=${jobId}`);
      if (existingJob.status === 'ready') {
        return res.status(200).json({ ok: true, status: 'ready', audioUrl: existingJob.audioUrl });
      }
      return res.status(202).json({ ok: true, status: 'preparing', jobId, youtubeId: extractedYoutubeId });
    }

    console.log(`[downloads] job created jobId=${jobId}`);
    downloadsStatusMap.set(jobId, { status: 'preparing' });

    const p = (async () => {
    let dlData: any | null = null;
    try {
      console.log(`[downloads] convert start reqId=${reqId} url=${url}`);
      console.log(`[downloads/job] worker start reqId=${reqId} url=${url}`);
      const pyRes = await axios.post(
        `${DOWNLOADER_URL}/download`,
        { url, mode, quality },
        { timeout: 300_000 }
      );
      dlData = pyRes.data;
    } catch (error: any) {
      const failure = convertFailureReason(error);
      console.warn(`[downloads] convert failed reqId=${reqId} reason=${failure.reason} status=${error?.response?.status}`);

      if (failure.shouldFallback && isWorkerEnabled()) {
        console.log(`[downloads] worker fallback start reqId=${reqId} url=${url}`);
        const workerResult = await downloadWithWorker(url);
        if (workerResult && workerResult.ok && workerResult.fileUrl) {
          const ext = inferExt(workerResult.filename, mode === 'video' ? '.mp4' : '.mp3');
          const baseName = extractedYoutubeId
            ? `${extractedYoutubeId}${ext}`
            : safeBaseName(workerResult.filename, `worker-${Date.now()}${ext}`);
          const localPath = path.join(MEDIA_BASE_DIR, mode === 'video' ? 'video' : 'audio', baseName);
          console.log(`[worker/file-copy] start reqId=${reqId} url=${workerResult.fileUrl.slice(0, 80)} dest=${baseName}`);
          const stored = await downloadRemoteToLocal(String(workerResult.fileUrl), localPath);
          if (stored) {
            const storedSize = fs.statSync(stored).size;
            console.log(`[worker/file-copy] ok reqId=${reqId} bytes=${storedSize} dest=${path.basename(stored)}`);
            dlData = {
              ok: true,
              title: workerResult.raw?.title || workerResult.raw?.files?.[0]?.name || null,
              uploader: workerResult.raw?.uploader || null,
              duration_seconds: workerResult.raw?.duration || workerResult.raw?.duration_seconds || null,
              thumbnail_url: workerResult.raw?.thumbnail || workerResult.raw?.thumbnail_url || null,
              filename: path.basename(stored),
              file_path: stored,
              source: 'worker',
            };
          } else {
            console.warn(`[worker/file-copy] failed reqId=${reqId} reason=WORKER_FILE_COPY_FAILED url=${workerResult.fileUrl.slice(0, 80)}`);
          }
        } else if (workerResult !== null) {
          console.warn(`[worker/download] empty_response reqId=${reqId} ok=${workerResult?.ok} filesCount=${workerResult?.files?.length ?? 0}`);
        }
      }
      if (!dlData) {
        // Construct a clear error
        throw new Error('No pudimos preparar esta canción. Intenta otra vez.');
      }
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
        return { status: 200, row: existing };
      }
      if (existingPath && fs.existsSync(existingPath)) {
        return { status: 200, row: existing };
      }
    }

    // Guard against "ON CONFLICT DO UPDATE command cannot affect row a second time"
    // which happens when two concurrent requests with the same youtube_id both reach
    // this INSERT before the pendingDownloads Map can deduplicate them.
    let result: any;
    try {
      result = await pool.query(
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
    } catch (insertErr: any) {
      // Race condition: two concurrent inserts with same youtube_id hit ON CONFLICT simultaneously.
      // PostgreSQL throws: "ON CONFLICT DO UPDATE command cannot affect row a second time"
      const msg = String(insertErr?.message || '');
      const isRaceConflict =
        msg.includes('ON CONFLICT DO UPDATE command cannot affect row a second time') ||
        msg.includes('duplicate key') ||
        String(insertErr?.code || '') === '21000';

      if (isRaceConflict && extractedYoutubeId) {
        console.warn(`[downloads] ON CONFLICT race detected reqId=${reqId} youtubeId=${extractedYoutubeId} - falling back to SELECT`);
        const fallback = await pool.query(
          `SELECT * FROM Downloads WHERE youtube_id = $1 AND mode = $2 ORDER BY created_at DESC LIMIT 1`,
          [extractedYoutubeId, mode]
        );
        if (fallback.rows.length > 0) {
          return { status: 200, row: fallback.rows[0] };
        }
      }
      // Re-throw if not a race conflict
      throw insertErr;
    }

    const saved = result.rows[0];
    console.log(`[downloads] saved reqId=${reqId} id=${saved.id}`);
    
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

    return { status: 201, row: saved };
    })();

    // Ejecutar en background
    p.then((final) => {
      console.log(`[downloads/job] ready id=${final.row.id}`);
      downloadsStatusMap.set(jobId, { status: 'ready', audioUrl: `/api/downloads/stream/${final.row.id}` });
    }).catch((err) => {
      console.log(`[downloads/job] failed reason=${err.message}`);
      downloadsStatusMap.set(jobId, { status: 'failed', message: err.message });
    });

    return res.status(202).json({
      ok: true,
      status: 'preparing',
      jobId,
      youtubeId: extractedYoutubeId
    });
  } catch (error: any) {
    const detail = String(error?.response?.data?.detail || error?.message || 'Unknown error');
    console.error('[downloads] Error:', { reqId: makeReqId(), detail, status: error?.response?.status });
    return res.status(500).json({
      ok: false,
      code: 'DOWNLOAD_FAILED',
      message: 'No pudimos preparar esta canción. Intenta otra vez.',
    });
  }
}));

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

    const expectedYoutubeId = typeof req.query.expected_youtube_id === 'string' ? req.query.expected_youtube_id.trim() : '';
    if (expectedYoutubeId && download.youtube_id && download.youtube_id !== expectedYoutubeId) {
      return res.status(409).json({ ok: false, code: 'SOURCE_MISMATCH', message: 'Cached audio belongs to another track' });
    }

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
      console.warn(`[downloads] Auto-cleaning broken DB entry ${id} (file not found: ${filePath})`);
      await pool.query('DELETE FROM Downloads WHERE id = $1', [id]).catch(() => {});
      return res.status(404).json({ ok: false, code: 'FILE_MISSING', message: 'Audio file missing' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    if (!fileSize || fileSize <= 0) {
      console.warn(`[downloads] Auto-cleaning broken DB entry ${id} (file size 0: ${filePath})`);
      await pool.query('DELETE FROM Downloads WHERE id = $1', [id]).catch(() => {});
      return res.status(404).json({ ok: false, code: 'FILE_MISSING', message: 'Audio file missing' });
    }
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
