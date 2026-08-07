"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cleanSourceValue = (value) => {
    if (value === null || value === undefined)
        return null;
    const s = String(value).trim();
    if (s === '' || s === 'null' || s === 'undefined' || s === 'NaN' || s === 'dl-null' || s === '/api/downloads/stream/null' || s.endsWith('/stream/null') || s.includes('watch?v=null')) {
        return null;
    }
    return s;
};
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const mediaWorkerClient_1 = require("../services/mediaWorkerClient");
const utils_1 = require("../utils");
const recommendationStore_1 = require("../services/recommendationStore");
const router = (0, express_1.Router)();
const DOWNLOADER_URL = process.env.DOWNLOADER_URL || 'http://convert:8000';
const MEDIA_BASE_DIR = process.env.MEDIA_BASE_DIR || '/app/downloads';
let schemaReadyPromise = null;
const pendingDownloads = new Map();
const ensureDownloadsSchema = () => __awaiter(void 0, void 0, void 0, function* () {
    yield db_1.default.query(`ALTER TABLE Downloads ADD COLUMN IF NOT EXISTS youtube_id VARCHAR(32)`);
    yield db_1.default.query(`ALTER TABLE Downloads ADD COLUMN IF NOT EXISTS uploader TEXT`);
    yield db_1.default.query(`ALTER TABLE Downloads ADD COLUMN IF NOT EXISTS duration INTEGER`);
    yield db_1.default.query(`ALTER TABLE Downloads ADD COLUMN IF NOT EXISTS thumbnail TEXT`);
    yield db_1.default.query(`ALTER TABLE Downloads ADD COLUMN IF NOT EXISTS url TEXT`);
    yield db_1.default.query(`CREATE UNIQUE INDEX IF NOT EXISTS downloads_youtube_id_mode_uidx
     ON Downloads (youtube_id, mode)
     WHERE youtube_id IS NOT NULL`);
});
const ensureDownloadsSchemaReady = () => __awaiter(void 0, void 0, void 0, function* () {
    if (!schemaReadyPromise) {
        schemaReadyPromise = ensureDownloadsSchema().catch((err) => {
            schemaReadyPromise = null;
            throw err;
        });
    }
    yield schemaReadyPromise;
});
const extractYoutubeId = (url) => {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
        if (host === 'youtu.be') {
            const id = parsed.pathname.split('/').filter(Boolean)[0];
            return id || null;
        }
        if (host.endsWith('youtube.com')) {
            const fromQuery = parsed.searchParams.get('v');
            if (fromQuery)
                return fromQuery;
            if (parsed.pathname.startsWith('/shorts/')) {
                const id = parsed.pathname.split('/')[2];
                return id || null;
            }
            if (parsed.pathname.startsWith('/embed/')) {
                const id = parsed.pathname.split('/')[2];
                return id || null;
            }
        }
    }
    catch (_a) {
        return null;
    }
    return null;
};
const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
const inferExt = (filename, fallback = '.mp3') => {
    if (typeof filename !== 'string')
        return fallback;
    const ext = path_1.default.extname(filename).toLowerCase();
    if (!ext)
        return fallback;
    if (ext.length > 10)
        return fallback;
    return ext;
};
const safeBaseName = (name, fallback) => {
    const base = typeof name === 'string' ? path_1.default.basename(name) : '';
    const cleaned = base.replace(/[^\w.\-()+\[\] ]+/g, '').trim();
    return cleaned || fallback;
};
const normalizeKey = (value) => String(value !== null && value !== void 0 ? value : '').trim().toLowerCase().replace(/\s+/g, ' ');
const convertFailureReason = (error) => {
    var _a, _b, _c, _d, _e;
    const status = Number(((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status) || 0);
    const msg = String((error === null || error === void 0 ? void 0 : error.message) || '');
    const detail = String(((_c = (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.detail) || ((_e = (_d = error === null || error === void 0 ? void 0 : error.response) === null || _d === void 0 ? void 0 : _d.data) === null || _e === void 0 ? void 0 : _e.error) || '');
    const text = `${msg}\n${detail}`.toLowerCase();
    const isTimeout = String((error === null || error === void 0 ? void 0 : error.code) || '').toLowerCase() === 'econnaborted' ||
        /timeout/i.test(msg) ||
        /timeout/i.test(detail);
    const blocked = status === 401 ||
        status === 403 ||
        text.includes("sign in to confirm you're not a bot") ||
        text.includes('requiere autenticación') ||
        text.includes('cookies') ||
        text.includes('not a bot');
    if (isTimeout)
        return { shouldFallback: true, reason: 'timeout' };
    if (blocked)
        return { shouldFallback: true, reason: `blocked:${status || 'unknown'}` };
    return { shouldFallback: false, reason: status ? `http:${status}` : 'error' };
};
// normalizeWorkerDownload removed — now using normalizeWorkerResponse from mediaWorkerClient
// which correctly reads files[0].url from the worker universal response format
const allowedRemoteHosts = () => {
    let workerHost = '';
    try {
        workerHost = process.env.MEDIA_WORKER_URL ? new URL(process.env.MEDIA_WORKER_URL).hostname : '';
    }
    catch (_a) { }
    return [
        'googlevideo.com',
        'youtube.com',
        'youtu.be',
        'soundcloud.com',
        'sndcdn.com',
        workerHost,
    ].filter(Boolean);
};
const isAllowedRemoteUrl = (rawUrl) => {
    try {
        const u = new URL(rawUrl);
        if (!['http:', 'https:'].includes(u.protocol))
            return false;
        const allow = allowedRemoteHosts();
        return allow.some((h) => u.hostname.endsWith(h));
    }
    catch (_a) {
        return false;
    }
};
const pipeRemoteToResponse = (remoteUrl, req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (!isAllowedRemoteUrl(remoteUrl)) {
        return res.status(403).json({ error: 'Forbidden: redirect host no autorizado' });
    }
    const headers = {};
    const range = req.headers.range;
    if (typeof range === 'string' && range.trim())
        headers.Range = range;
    const upstream = yield axios_1.default.get(remoteUrl, {
        responseType: 'stream',
        timeout: 60000,
        headers,
        validateStatus: () => true,
    });
    const status = upstream.status || 502;
    const passHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of passHeaders) {
        const v = (_a = upstream.headers) === null || _a === void 0 ? void 0 : _a[h];
        if (typeof v === 'string' && v)
            res.setHeader(h, v);
    }
    res.status(status);
    upstream.data.pipe(res);
});
const downloadRemoteToLocal = (remoteUrl, destPath) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAllowedRemoteUrl(remoteUrl))
        return null;
    const dir = path_1.default.dirname(destPath);
    fs_1.default.mkdirSync(dir, { recursive: true });
    const tmpPath = `${destPath}.tmp-${Date.now()}`;
    const writer = fs_1.default.createWriteStream(tmpPath);
    try {
        const upstream = yield axios_1.default.get(remoteUrl, {
            responseType: 'stream',
            timeout: 120000,
            validateStatus: () => true,
        });
        if (upstream.status < 200 || upstream.status >= 300) {
            try {
                writer.close();
            }
            catch (_a) { }
            try {
                fs_1.default.unlinkSync(tmpPath);
            }
            catch (_b) { }
            return null;
        }
        yield new Promise((resolve, reject) => {
            upstream.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        fs_1.default.renameSync(tmpPath, destPath);
        return destPath;
    }
    catch (_c) {
        try {
            writer.close();
        }
        catch (_d) { }
        try {
            fs_1.default.unlinkSync(tmpPath);
        }
        catch (_e) { }
        return null;
    }
});
const toApiDownload = (row) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!row)
        return row;
    return Object.assign(Object.assign({}, row), { artist: (_b = (_a = row.uploader) !== null && _a !== void 0 ? _a : row.artist) !== null && _b !== void 0 ? _b : null, duration_seconds: (_d = (_c = row.duration) !== null && _c !== void 0 ? _c : row.duration_seconds) !== null && _d !== void 0 ? _d : null, thumbnail_url: (_f = (_e = row.thumbnail) !== null && _e !== void 0 ? _e : row.thumbnail_url) !== null && _f !== void 0 ? _f : null, file_path: (_h = (_g = row.url) !== null && _g !== void 0 ? _g : row.file_path) !== null && _h !== void 0 ? _h : null });
};
// ──────────────────────────────────────────────
// GET /api/downloads/resolve → cache-hit rápido (sin descargar)
// ──────────────────────────────────────────────
router.get('/resolve', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const youtubeId = String(req.query.youtube_id || '').trim();
    const mode = String(req.query.mode || 'audio').trim() === 'video' ? 'video' : 'audio';
    if (!youtubeId)
        return res.status(400).json({ ok: false, error: 'youtube_id requerido' });
    try {
        yield ensureDownloadsSchemaReady();
        const existingByYoutubeId = yield db_1.default.query(`SELECT * FROM Downloads WHERE youtube_id = $1 AND mode = $2 ORDER BY created_at DESC LIMIT 1`, [youtubeId, mode]);
        if (existingByYoutubeId.rows.length === 0) {
            return res.json({ ok: true, cached: false, source: 'miss' });
        }
        const existing = existingByYoutubeId.rows[0];
        const existingPath = existing.url;
        if (!existingPath || /^https?:\/\//i.test(existingPath)) {
            return res.json({ ok: true, cached: false, source: 'miss' });
        }
        if (!fs_1.default.existsSync(existingPath)) {
            return res.json({ ok: true, cached: false, source: 'missing-file' });
        }
        const size = fs_1.default.statSync(existingPath).size;
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
    }
    catch (error) {
        console.error('[downloads] resolve error', { message: error === null || error === void 0 ? void 0 : error.message });
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
})));
const downloadsStatusMap = new Map();
router.get('/status/:jobId', (req, res) => {
    const job = downloadsStatusMap.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ ok: false, status: 'failed', message: 'Job no encontrado' });
    }
    return res.json(Object.assign({ ok: true }, job));
});
// ──────────────────────────────────────────────
// POST /api/downloads  →  solicita descarga
// ──────────────────────────────────────────────
const makeReqId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
router.post('/', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const reqId = makeReqId();
    let finalBody = req.body || {};
    if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
        try {
            finalBody = JSON.parse(req.body);
        }
        catch (e) { }
    }
    else if (Buffer.isBuffer(req.body)) {
        try {
            finalBody = JSON.parse(req.body.toString('utf8'));
        }
        catch (e) { }
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
    }
    catch (_d) {
        return res.status(400).json({ ok: false, code: 'MISSING_TRACK_SOURCE', message: 'Missing youtubeId/sourceId/url' });
    }
    try {
        yield ensureDownloadsSchemaReady();
        const extractedYoutubeId = typeof youtube_id === 'string' && youtube_id.trim()
            ? youtube_id.trim()
            : extractYoutubeId(url);
        const pendingKey = `${mode}:${extractedYoutubeId || normalizeKey(url)}`;
        console.log(`[downloads] request reqId=${reqId} youtubeId=${extractedYoutubeId || 'unknown'}`);
        if (extractedYoutubeId) {
            const existingByYoutubeId = yield db_1.default.query(`SELECT * FROM Downloads WHERE youtube_id = $1 AND mode = $2 ORDER BY created_at DESC LIMIT 1`, [extractedYoutubeId, mode]);
            if (existingByYoutubeId.rows.length > 0) {
                const existing = existingByYoutubeId.rows[0];
                const existingPath = existing.url;
                if (existingPath && /^https?:\/\//i.test(existingPath)) {
                    console.log(`[downloads] local-cache hit reqId=${reqId}`);
                    return res.status(200).json(toApiDownload(existing));
                }
                if (existingPath && fs_1.default.existsSync(existingPath)) {
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
        const p = (() => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
            let dlData = null;
            try {
                console.log(`[downloads] convert start reqId=${reqId} url=${url}`);
                console.log(`[downloads/job] worker start reqId=${reqId} url=${url}`);
                const pyRes = yield axios_1.default.post(`${DOWNLOADER_URL}/download`, { url, mode, quality }, { timeout: 300000 });
                dlData = pyRes.data;
            }
            catch (error) {
                const failure = convertFailureReason(error);
                console.warn(`[downloads] convert failed reqId=${reqId} reason=${failure.reason} status=${(_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status}`);
                if (failure.shouldFallback && (0, mediaWorkerClient_1.isWorkerEnabled)()) {
                    console.log(`[downloads] worker fallback start reqId=${reqId} url=${url}`);
                    const workerResult = yield (0, mediaWorkerClient_1.downloadWithWorker)(url);
                    if (workerResult && workerResult.ok && workerResult.fileUrl) {
                        const ext = inferExt(workerResult.filename, mode === 'video' ? '.mp4' : '.mp3');
                        const baseName = extractedYoutubeId
                            ? `${extractedYoutubeId}${ext}`
                            : safeBaseName(workerResult.filename, `worker-${Date.now()}${ext}`);
                        const localPath = path_1.default.join(MEDIA_BASE_DIR, mode === 'video' ? 'video' : 'audio', baseName);
                        console.log(`[worker/file-copy] start reqId=${reqId} url=${workerResult.fileUrl.slice(0, 80)} dest=${baseName}`);
                        const stored = yield downloadRemoteToLocal(String(workerResult.fileUrl), localPath);
                        if (stored) {
                            const storedSize = fs_1.default.statSync(stored).size;
                            console.log(`[worker/file-copy] ok reqId=${reqId} bytes=${storedSize} dest=${path_1.default.basename(stored)}`);
                            dlData = {
                                ok: true,
                                title: ((_b = workerResult.raw) === null || _b === void 0 ? void 0 : _b.title) || ((_e = (_d = (_c = workerResult.raw) === null || _c === void 0 ? void 0 : _c.files) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.name) || null,
                                uploader: ((_f = workerResult.raw) === null || _f === void 0 ? void 0 : _f.uploader) || null,
                                duration_seconds: ((_g = workerResult.raw) === null || _g === void 0 ? void 0 : _g.duration) || ((_h = workerResult.raw) === null || _h === void 0 ? void 0 : _h.duration_seconds) || null,
                                thumbnail_url: ((_j = workerResult.raw) === null || _j === void 0 ? void 0 : _j.thumbnail) || ((_k = workerResult.raw) === null || _k === void 0 ? void 0 : _k.thumbnail_url) || null,
                                filename: path_1.default.basename(stored),
                                file_path: stored,
                                source: 'worker',
                            };
                        }
                        else {
                            console.warn(`[worker/file-copy] failed reqId=${reqId} reason=WORKER_FILE_COPY_FAILED url=${workerResult.fileUrl.slice(0, 80)}`);
                        }
                    }
                    else if (workerResult !== null) {
                        console.warn(`[worker/download] empty_response reqId=${reqId} ok=${workerResult === null || workerResult === void 0 ? void 0 : workerResult.ok} filesCount=${(_m = (_l = workerResult === null || workerResult === void 0 ? void 0 : workerResult.files) === null || _l === void 0 ? void 0 : _l.length) !== null && _m !== void 0 ? _m : 0}`);
                    }
                }
                if (!dlData) {
                    // Construct a clear error
                    throw new Error('No pudimos preparar esta canción. Intenta otra vez.');
                }
            }
            const { title, filename, file_path, duration_seconds, thumbnail_url, uploader, } = dlData || {};
            // Fallback if yt-dlp fails to get title and just returns the youtube id
            const finalTitle = (title && title !== extractedYoutubeId && title !== filename) ? title : (bodyTitle || title);
            const finalUploader = (uploader && uploader !== 'Unknown') ? uploader : (bodyUploader || uploader || 'Desconocido');
            const normalizedTitle = String(finalTitle || '').trim();
            const normalizedArtist = String(finalUploader || '').trim();
            const existingByMetadata = yield db_1.default.query(`SELECT * FROM Downloads
       WHERE LOWER(title) = LOWER($1)
         AND LOWER(COALESCE(uploader, '')) = LOWER($2)
         AND mode = $3
       ORDER BY created_at DESC
       LIMIT 1`, [normalizedTitle, normalizedArtist, mode]);
            if (existingByMetadata.rows.length > 0) {
                const existing = existingByMetadata.rows[0];
                const existingPath = existing.url;
                if (existingPath && /^https?:\/\//i.test(existingPath)) {
                    return { status: 200, row: existing };
                }
                if (existingPath && fs_1.default.existsSync(existingPath)) {
                    return { status: 200, row: existing };
                }
            }
            // Guard against "ON CONFLICT DO UPDATE command cannot affect row a second time"
            // which happens when two concurrent requests with the same youtube_id both reach
            // this INSERT before the pendingDownloads Map can deduplicate them.
            let result;
            try {
                result = yield db_1.default.query(`INSERT INTO Downloads (title, uploader, duration, thumbnail, url, mode, youtube_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (youtube_id, mode) WHERE youtube_id IS NOT NULL
         DO UPDATE SET
           title = EXCLUDED.title,
           uploader = EXCLUDED.uploader,
           duration = EXCLUDED.duration,
           thumbnail = EXCLUDED.thumbnail,
           url = EXCLUDED.url
         RETURNING *`, [
                    normalizedTitle,
                    normalizedArtist || null,
                    duration_seconds || null,
                    thumbnail_url || `https://i.ytimg.com/vi/${extractedYoutubeId}/hqdefault.jpg`,
                    file_path,
                    mode,
                    extractedYoutubeId,
                ]);
            }
            catch (insertErr) {
                // Race condition: two concurrent inserts with same youtube_id hit ON CONFLICT simultaneously.
                // PostgreSQL throws: "ON CONFLICT DO UPDATE command cannot affect row a second time"
                const msg = String((insertErr === null || insertErr === void 0 ? void 0 : insertErr.message) || '');
                const isRaceConflict = msg.includes('ON CONFLICT DO UPDATE command cannot affect row a second time') ||
                    msg.includes('duplicate key') ||
                    String((insertErr === null || insertErr === void 0 ? void 0 : insertErr.code) || '') === '21000';
                if (isRaceConflict && extractedYoutubeId) {
                    console.warn(`[downloads] ON CONFLICT race detected reqId=${reqId} youtubeId=${extractedYoutubeId} - falling back to SELECT`);
                    const fallback = yield db_1.default.query(`SELECT * FROM Downloads WHERE youtube_id = $1 AND mode = $2 ORDER BY created_at DESC LIMIT 1`, [extractedYoutubeId, mode]);
                    if (fallback.rows.length > 0) {
                        return { status: 200, row: fallback.rows[0] };
                    }
                }
                // Re-throw if not a race conflict
                throw insertErr;
            }
            const saved = result.rows[0];
            console.log(`[downloads] saved reqId=${reqId} id=${saved.id}`);
            const uid = String(((_o = req === null || req === void 0 ? void 0 : req.user) === null || _o === void 0 ? void 0 : _o.uid) || '').trim();
            if (uid && (saved === null || saved === void 0 ? void 0 : saved.youtube_id)) {
                void (0, recommendationStore_1.upsertGlobalCatalogTracks)([
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
                ], 3).catch(() => { });
            }
            return { status: 201, row: saved };
        }))();
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
    }
    catch (error) {
        const detail = String(((_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.detail) || (error === null || error === void 0 ? void 0 : error.message) || 'Unknown error');
        console.error('[downloads] Error:', { reqId: makeReqId(), detail, status: (_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.status });
        return res.status(500).json({
            ok: false,
            code: 'DOWNLOAD_FAILED',
            message: 'No pudimos preparar esta canción. Intenta otra vez.',
        });
    }
})));
// ──────────────────────────────────────────────
// GET /api/downloads  →  listar todos
// ──────────────────────────────────────────────
router.get('/', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { youtube_id } = req.query;
        if (youtube_id && typeof youtube_id === 'string') {
            const result = yield db_1.default.query(`SELECT * FROM Downloads WHERE youtube_id = $1 ORDER BY created_at DESC`, [youtube_id.trim()]);
            return res.json(result.rows.map(toApiDownload));
        }
        const result = yield db_1.default.query('SELECT * FROM Downloads ORDER BY created_at DESC');
        return res.json(result.rows.map(toApiDownload));
    }
    catch (error) {
        console.error('[downloads] List error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}));
// ──────────────────────────────────────────────
// GET /api/downloads/stream-direct  →  Resolves YouTube URL → 302 to seekable CDN URL
// MUST be defined BEFORE /:id to avoid Express wildcard conflict
// ──────────────────────────────────────────────
router.get('/stream-direct', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
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
    }
    catch (_c) {
        return res.status(400).json({ error: 'URL inválida' });
    }
    try {
        // Ask Python to extract the direct audio CDN URL via yt-dlp --get-url
        // Python /stream-url already does this and returns { url: "https://rr*.googlevideo.com/..." }
        const pyRes = yield axios_1.default.get(`${DOWNLOADER_URL}/stream-url?url=${encodeURIComponent(url)}`, {
            timeout: 130000,
            validateStatus: () => true,
        });
        const directUrl = pyRes.status >= 200 && pyRes.status < 300 ? (_a = pyRes.data) === null || _a === void 0 ? void 0 : _a.url : null;
        if (!directUrl) {
            if ((0, mediaWorkerClient_1.isWorkerEnabled)()) {
                console.warn('[downloads] stream-direct convert failed', { status: pyRes.status });
                const extracted = yield (0, mediaWorkerClient_1.extractWithWorker)(url);
                const workerUrl = extracted === null || extracted === void 0 ? void 0 : extracted.audioUrl;
                if (workerUrl && isHttpUrl(workerUrl)) {
                    console.log('[worker/extract] ok', { fallback: true });
                    return yield pipeRemoteToResponse(String(workerUrl), req, res);
                }
                console.warn('[worker/extract] failed', { fallback: true });
            }
            return res.status(502).json({ error: 'No se pudo obtener URL directa' });
        }
        // 302 redirect: browser connects directly to Google CDN (seekable, Range-capable)
        return res.redirect(302, directUrl);
    }
    catch (error) {
        console.error('[downloads] stream-direct error:', ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data) || error.message);
        if ((0, mediaWorkerClient_1.isWorkerEnabled)()) {
            const extracted = yield (0, mediaWorkerClient_1.extractWithWorker)(url);
            const workerUrl = extracted === null || extracted === void 0 ? void 0 : extracted.audioUrl;
            if (workerUrl && isHttpUrl(workerUrl)) {
                console.log('[worker/extract] ok', { fallback: true });
                return yield pipeRemoteToResponse(String(workerUrl), req, res);
            }
            console.warn('[worker/extract] failed', { fallback: true });
        }
        return res.status(500).json({ error: 'Error al obtener stream' });
    }
}));
// ──────────────────────────────────────────────
// GET /api/downloads/:id  →  metadatos de uno
// MUST be after all named sub-routes
// ──────────────────────────────────────────────
router.get('/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: 'ID inválido' });
    }
    try {
        const result = yield db_1.default.query('SELECT * FROM Downloads WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Download no encontrado' });
        }
        return res.json(toApiDownload(result.rows[0]));
    }
    catch (error) {
        console.error('[downloads] Get error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}));
// ──────────────────────────────────────────────
// GET /api/downloads/stream/:id  →  HTTP Range streaming
// Compatible con: <audio>, <video>, expo-av, react-native-video, ExoPlayer
// ──────────────────────────────────────────────
router.get('/stream/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    if (!id || !/^\d+$/.test(id)) {
        return res.status(400).json({ error: 'ID inválido' });
    }
    try {
        const result = yield db_1.default.query('SELECT * FROM Downloads WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Download no encontrado' });
        }
        const download = result.rows[0];
        const expectedYoutubeId = typeof req.query.expected_youtube_id === 'string' ? req.query.expected_youtube_id.trim() : '';
        if (expectedYoutubeId && download.youtube_id && download.youtube_id !== expectedYoutubeId) {
            return res.status(409).json({ ok: false, code: 'SOURCE_MISMATCH', message: 'Cached audio belongs to another track' });
        }
        const filePath = download.url;
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
                    return yield pipeRemoteToResponse(filePath, req, res);
                }
                return res.redirect(302, filePath);
            }
            catch (_a) {
                return res.status(400).json({ error: 'URL inválida' });
            }
        }
        const resolvedPath = path_1.default.resolve(filePath);
        const allowedDir = path_1.default.resolve(MEDIA_BASE_DIR);
        const rel = path_1.default.relative(allowedDir, resolvedPath);
        if (rel.startsWith('..') || path_1.default.isAbsolute(rel)) {
            return res.status(403).json({ error: 'Forbidden: Path traversal detectado' });
        }
        if (!fs_1.default.existsSync(filePath)) {
            console.warn(`[downloads] Auto-cleaning broken DB entry ${id} (file not found: ${filePath})`);
            yield db_1.default.query('DELETE FROM Downloads WHERE id = $1', [id]).catch(() => { });
            return res.status(404).json({ ok: false, code: 'FILE_MISSING', message: 'Audio file missing' });
        }
        const stat = fs_1.default.statSync(filePath);
        const fileSize = stat.size;
        if (!fileSize || fileSize <= 0) {
            console.warn(`[downloads] Auto-cleaning broken DB entry ${id} (file size 0: ${filePath})`);
            yield db_1.default.query('DELETE FROM Downloads WHERE id = $1', [id]).catch(() => { });
            return res.status(404).json({ ok: false, code: 'FILE_MISSING', message: 'Audio file missing' });
        }
        const ext = path_1.default.extname(filePath).toLowerCase();
        // Content-Type según extensión
        const mimeTypes = {
            '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4',
            '.ogg': 'audio/ogg',
            '.opus': 'audio/ogg; codecs=opus',
            '.wav': 'audio/wav',
            '.flac': 'audio/flac',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mkv': 'video/x-matroska',
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
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType,
            });
            const stream = fs_1.default.createReadStream(filePath, { start, end });
            stream.pipe(res);
        }
        else {
            // ── Full file (200) ──
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Accept-Ranges': 'bytes',
                'Content-Type': contentType,
            });
            fs_1.default.createReadStream(filePath).pipe(res);
        }
    }
    catch (error) {
        console.error('[downloads] Stream error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}));
exports.default = router;
