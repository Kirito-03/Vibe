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
exports.downloadWithWorker = exports.downloadWithWorkerOptions = exports.downloadAudioWithWorker = exports.extractWithWorker = exports.searchWithWorker = exports.normalizeWorkerResponse = exports.getWorkerCapabilities = exports.workerHealth = exports.isConvertFallbackError = exports.isBotDetectionError = exports.isWorkerSearchEnabled = exports.isWorkerEnabled = void 0;
const axios_1 = __importDefault(require("axios"));
// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------
const normalizeUrl = (raw) => raw.replace(/\/+$/, '');
const getEnvBool = (raw) => {
    if (!raw)
        return false;
    return raw === 'true' || raw === '1' || raw === 'yes';
};
const getWorkerConfig = () => {
    const url = process.env.MEDIA_WORKER_URL
        ? normalizeUrl(process.env.MEDIA_WORKER_URL)
        : '';
    // Timeout largo para descargas (download puede tardar 60-90s)
    const timeoutMs = Number.parseInt(process.env.MEDIA_WORKER_TIMEOUT_MS || '90000', 10);
    return { url, timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90000 };
};
const isWorkerEnabled = () => {
    const enabled = getEnvBool(process.env.MEDIA_WORKER_ENABLED);
    const { url } = getWorkerConfig();
    return enabled && Boolean(url);
};
exports.isWorkerEnabled = isWorkerEnabled;
/** Habilita búsqueda vía worker. Desactivar con MEDIA_WORKER_SEARCH_ENABLED=false */
const isWorkerSearchEnabled = () => {
    if (!(0, exports.isWorkerEnabled)())
        return false;
    const raw = process.env.MEDIA_WORKER_SEARCH_ENABLED;
    if (raw === undefined || raw === '')
        return true;
    return getEnvBool(raw);
};
exports.isWorkerSearchEnabled = isWorkerSearchEnabled;
// ---------------------------------------------------------------------------
// Bot-detection error patterns (para activar fallback al worker)
// ---------------------------------------------------------------------------
const BOT_DETECTION_PATTERNS = [
    'sign in to confirm',
    "sign in to confirm you're not a bot",
    'cookies',
    'requiere autenticación',
    'requiere autenticación de youtube',
    'bot detection',
    '401',
    '403',
    'age-restricted',
    'private video',
    'video unavailable',
];
const isBotDetectionError = (error) => {
    var _a, _b, _c;
    const msg = String((error === null || error === void 0 ? void 0 : error.message) ||
        ((_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.message) ||
        ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) ||
        '').toLowerCase();
    return BOT_DETECTION_PATTERNS.some((p) => msg.includes(p.toLowerCase()));
};
exports.isBotDetectionError = isBotDetectionError;
const isConvertFallbackError = (error) => {
    var _a;
    const status = Number(((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status) || 0);
    if (status === 401 || status === 403)
        return true;
    if ((error === null || error === void 0 ? void 0 : error.code) === 'ECONNABORTED')
        return true;
    return (0, exports.isBotDetectionError)(error);
};
exports.isConvertFallbackError = isConvertFallbackError;
// ---------------------------------------------------------------------------
// Health & capabilities cache
// ---------------------------------------------------------------------------
let _cachedCapabilities = null;
let _cachedCapabilitiesAt = 0;
let _workerUnhealthyUntil = 0;
const CAPABILITIES_TTL_MS = 60000;
const UNHEALTHY_COOLDOWN_MS = 10000;
// Health con timeout más permisivo porque el worker en Termux es mono-hilo y puede estar ocupado buscando
const HEALTH_TIMEOUT_MS = 8000;
const workerHealth = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    if (!(0, exports.isWorkerEnabled)())
        return { ok: false, status: 0 };
    if (Date.now() < _workerUnhealthyUntil) {
        return { ok: false, status: 0, error: 'worker-cooldown' };
    }
    const { url } = getWorkerConfig();
    try {
        const res = yield axios_1.default.get(`${url}/health`, { timeout: HEALTH_TIMEOUT_MS });
        const ok = res.status >= 200 && res.status < 300;
        if (ok) {
            const caps = (_a = res.data) === null || _a === void 0 ? void 0 : _a.capabilities;
            console.log('[worker/health] ok', Object.assign({ enabled: true, url }, (caps ? { capabilities: caps } : {})));
        }
        return { ok, status: res.status, data: res.data };
    }
    catch (error) {
        _workerUnhealthyUntil = Date.now() + UNHEALTHY_COOLDOWN_MS;
        _cachedCapabilities = null;
        _cachedCapabilitiesAt = 0;
        console.warn('[worker/health] failed', {
            url,
            error: error === null || error === void 0 ? void 0 : error.message,
            status: (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.status,
        });
        return { ok: false, status: ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.status) || 0, error: error === null || error === void 0 ? void 0 : error.message };
    }
});
exports.workerHealth = workerHealth;
const getWorkerCapabilities = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (!(0, exports.isWorkerEnabled)())
        return null;
    const now = Date.now();
    if (_cachedCapabilities && now - _cachedCapabilitiesAt < CAPABILITIES_TTL_MS) {
        return _cachedCapabilities;
    }
    const health = yield (0, exports.workerHealth)();
    const caps = (_a = health === null || health === void 0 ? void 0 : health.data) === null || _a === void 0 ? void 0 : _a.capabilities;
    if (caps && typeof caps === 'object') {
        _cachedCapabilities = caps;
        _cachedCapabilitiesAt = now;
        return _cachedCapabilities;
    }
    _cachedCapabilities = null;
    _cachedCapabilitiesAt = now;
    return null;
});
exports.getWorkerCapabilities = getWorkerCapabilities;
// ---------------------------------------------------------------------------
// Download concurrency queue
// ---------------------------------------------------------------------------
const workerConcurrencyLimit = () => {
    const raw = Number.parseInt(process.env.WORKER_DOWNLOAD_CONCURRENCY || '1', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
};
const workerQueueMax = () => {
    const raw = Number.parseInt(process.env.WORKER_DOWNLOAD_QUEUE_MAX || '5', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 5;
};
let _activeWorkerDownloads = 0;
const _workerDownloadQueue = [];
// Log effective concurrency at module load time so it's visible in backend logs
console.log('[worker/queue] concurrency=' + workerConcurrencyLimit() + ' queueMax=' + workerQueueMax());
const acquireWorkerSlot = () => {
    const limit = workerConcurrencyLimit();
    const maxQ = workerQueueMax();
    if (_activeWorkerDownloads < limit) {
        _activeWorkerDownloads++;
        console.log('[worker/queue] start', { active: _activeWorkerDownloads, limit });
        return Promise.resolve();
    }
    if (_workerDownloadQueue.length >= maxQ) {
        console.warn('[worker/queue] rejected: queue full', { active: _activeWorkerDownloads, limit, queued: _workerDownloadQueue.length, maxQ });
        return Promise.reject(new Error('Demasiadas descargas en cola. Intenta más tarde.'));
    }
    return new Promise((resolve) => {
        console.log('[worker/queue] waiting', { active: _activeWorkerDownloads, limit, queued: _workerDownloadQueue.length + 1 });
        _workerDownloadQueue.push(() => {
            _activeWorkerDownloads++;
            console.log('[worker/queue] start (dequeued)', { active: _activeWorkerDownloads, limit });
            resolve();
        });
    });
};
const releaseWorkerSlot = () => {
    _activeWorkerDownloads = Math.max(0, _activeWorkerDownloads - 1);
    const next = _workerDownloadQueue.shift();
    if (next) {
        next();
    }
    else {
        console.log('[worker/queue] done', { active: _activeWorkerDownloads });
    }
};
// ---------------------------------------------------------------------------
// Normalize worker download response — supports files[] AND legacy flat format
// ---------------------------------------------------------------------------
/**
 * El worker universal devuelve:
 *   { ok: true, files: [{ name, url, kind, size }], cached: boolean, source: string }
 *
 * Versiones viejas devolvían:
 *   { ok: true, url: "...", audioUrl: "...", file_url: "..." }
 *
 * Esta función normaliza ambos formatos.
 */
const normalizeWorkerResponse = (data) => {
    const ok = (data === null || data === void 0 ? void 0 : data.ok) === true || (data === null || data === void 0 ? void 0 : data.success) === true;
    const cached = (data === null || data === void 0 ? void 0 : data.cached) === true;
    const source = String((data === null || data === void 0 ? void 0 : data.source) || 'worker');
    // Extraer files[] (formato nuevo)
    const rawFiles = Array.isArray(data === null || data === void 0 ? void 0 : data.files) ? data.files : [];
    const files = rawFiles
        .filter((f) => f && typeof f.url === 'string' && f.url.startsWith('http'))
        .map((f) => ({
        name: String(f.name || ''),
        url: String(f.url),
        kind: String(f.kind || 'audio'),
        size: Number(f.size || 0),
    }));
    // Encontrar primer archivo de audio
    const audioFile = files.find((f) => f.kind === 'audio') || files[0] || null;
    // Fallback: formato plano antiguo
    const legacyUrl = typeof (data === null || data === void 0 ? void 0 : data.url) === 'string' && data.url.startsWith('http') ? data.url :
        typeof (data === null || data === void 0 ? void 0 : data.audioUrl) === 'string' && data.audioUrl.startsWith('http') ? data.audioUrl :
            typeof (data === null || data === void 0 ? void 0 : data.file_url) === 'string' && data.file_url.startsWith('http') ? data.file_url :
                null;
    const fileUrl = (audioFile === null || audioFile === void 0 ? void 0 : audioFile.url) || legacyUrl || null;
    const filename = (audioFile === null || audioFile === void 0 ? void 0 : audioFile.name) || (data === null || data === void 0 ? void 0 : data.filename) || (data === null || data === void 0 ? void 0 : data.name) || null;
    console.log('[worker/download] response shape', {
        ok,
        filesCount: files.length,
        cached,
        source,
        fileUrl: fileUrl ? fileUrl.slice(0, 80) : null,
        size: (audioFile === null || audioFile === void 0 ? void 0 : audioFile.size) || null,
    });
    return { ok, cached, source, files, fileUrl, filename, raw: data };
};
exports.normalizeWorkerResponse = normalizeWorkerResponse;
// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
let _workerSearchDisabledUntil = 0;
const searchWithWorker = (query_1, ...args_1) => __awaiter(void 0, [query_1, ...args_1], void 0, function* (query, limit = 10) {
    var _a;
    if (!(0, exports.isWorkerEnabled)())
        return null;
    if (Date.now() < _workerSearchDisabledUntil) {
        console.log('[worker/search] skipped no-capability (cooldown)');
        return null;
    }
    const q = String(query || '').trim();
    if (!q)
        return null;
    const caps = yield (0, exports.getWorkerCapabilities)().catch(() => null);
    if ((caps === null || caps === void 0 ? void 0 : caps.search) === false) {
        console.log('[worker/search] skipped no-capability');
        return null;
    }
    const { url, timeoutMs } = getWorkerConfig();
    try {
        console.log('[worker/search] start', { q, limit });
        const res = yield axios_1.default.post(`${url}/search`, { q, query: q, limit: Math.min(limit, 10) }, { timeout: timeoutMs });
        const data = res.data;
        const items = Array.isArray(data === null || data === void 0 ? void 0 : data.items)
            ? data.items
            : Array.isArray(data)
                ? data
                : [];
        console.log('[worker/search] done', { items: items.length });
        return { items, source: (data === null || data === void 0 ? void 0 : data.source) || 'worker' };
    }
    catch (error) {
        const status = Number(((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status) || 0);
        if (status === 404) {
            _workerSearchDisabledUntil = Date.now() + 10 * 60000;
            console.warn('[worker/search] disabled (404) until cooldown');
            return null;
        }
        console.warn('[worker/search] failed', { q, error: error === null || error === void 0 ? void 0 : error.message, status });
        return null;
    }
});
exports.searchWithWorker = searchWithWorker;
// ---------------------------------------------------------------------------
// Extract (stream URL directo para Vibe)
// ---------------------------------------------------------------------------
const extractWithWorker = (urlInput) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (!(0, exports.isWorkerEnabled)())
        return null;
    const url = String(urlInput || '').trim();
    if (!url)
        return null;
    const { url: baseUrl, timeoutMs } = getWorkerConfig();
    try {
        console.log('[worker/extract] start', { url });
        const res = yield axios_1.default.post(`${baseUrl}/extract`, { url }, { timeout: timeoutMs });
        console.log('[worker/extract] ok', { status: res.status });
        return res.data || null;
    }
    catch (error) {
        console.warn('[worker/extract] failed', {
            url,
            error: error === null || error === void 0 ? void 0 : error.message,
            status: (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status,
        });
        return null;
    }
});
exports.extractWithWorker = extractWithWorker;
// ---------------------------------------------------------------------------
// Download — Vibe fallback (siempre pide audio, con concurrencia limitada)
// ---------------------------------------------------------------------------
/**
 * Descarga audio para Vibe como fallback cuando Convert falla.
 * Siempre envía kind="audio" explícitamente.
 * Usa cola de concurrencia para no saturar el worker.
 */
const downloadAudioWithWorker = (urlInput, opts) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    if (!(0, exports.isWorkerEnabled)())
        return null;
    const url = String(urlInput || '').trim();
    if (!url)
        return null;
    const caps = yield (0, exports.getWorkerCapabilities)().catch(() => null);
    if ((caps === null || caps === void 0 ? void 0 : caps.download) === false) {
        console.log('[worker/download] skipped no-capability');
        return null;
    }
    const { url: baseUrl, timeoutMs } = getWorkerConfig();
    yield acquireWorkerSlot();
    try {
        console.log('[worker/download] fallback start', { url, kind: 'audio', format: (opts === null || opts === void 0 ? void 0 : opts.format) || 'mp3' });
        const res = yield axios_1.default.post(`${baseUrl}/download`, {
            url,
            kind: 'audio',
            format: (opts === null || opts === void 0 ? void 0 : opts.format) || 'mp3',
            quality: (opts === null || opts === void 0 ? void 0 : opts.quality) || 'medium',
        }, { timeout: timeoutMs });
        const norm = (0, exports.normalizeWorkerResponse)(res.data);
        if (norm.ok && norm.fileUrl) {
            console.log('[worker/download] ok', {
                cached: norm.cached,
                fileUrl: norm.fileUrl.slice(0, 80),
                size: ((_a = norm.files[0]) === null || _a === void 0 ? void 0 : _a.size) || null,
            });
            return norm;
        }
        if (norm.ok && norm.files.length === 0) {
            console.warn('[worker/download] empty_response', { ok: norm.ok, cached: norm.cached });
            return null;
        }
        console.warn('[worker/download] empty_response', { ok: norm.ok, filesCount: norm.files.length });
        return null;
    }
    catch (error) {
        console.warn('[worker/download] failed', {
            url,
            error: error === null || error === void 0 ? void 0 : error.message,
            status: (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.status,
        });
        return null;
    }
    finally {
        releaseWorkerSlot();
    }
});
exports.downloadAudioWithWorker = downloadAudioWithWorker;
// ---------------------------------------------------------------------------
// Download genérico (sistema descargador)
// ---------------------------------------------------------------------------
const downloadWithWorkerOptions = (urlInput, opts) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (!(0, exports.isWorkerEnabled)())
        return null;
    const url = String(urlInput || '').trim();
    if (!url)
        return null;
    const { url: baseUrl, timeoutMs } = getWorkerConfig();
    yield acquireWorkerSlot();
    try {
        console.log('[worker/download] start', Object.assign({ url }, opts));
        const res = yield axios_1.default.post(`${baseUrl}/download`, { url, kind: opts === null || opts === void 0 ? void 0 : opts.kind, format: opts === null || opts === void 0 ? void 0 : opts.format, quality: opts === null || opts === void 0 ? void 0 : opts.quality }, { timeout: timeoutMs });
        const norm = (0, exports.normalizeWorkerResponse)(res.data);
        if (norm.ok && norm.fileUrl) {
            console.log('[worker/download] ok', { cached: norm.cached, fileUrl: norm.fileUrl.slice(0, 80) });
            return norm;
        }
        console.warn('[worker/download] empty_response', { ok: norm.ok, filesCount: norm.files.length });
        return null;
    }
    catch (error) {
        console.warn('[worker/download] failed', {
            url,
            error: error === null || error === void 0 ? void 0 : error.message,
            status: (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status,
        });
        return null;
    }
    finally {
        releaseWorkerSlot();
    }
});
exports.downloadWithWorkerOptions = downloadWithWorkerOptions;
// Alias para compatibilidad con código existente
const downloadWithWorker = (urlInput) => __awaiter(void 0, void 0, void 0, function* () {
    return (0, exports.downloadWithWorkerOptions)(urlInput, { kind: 'audio', format: 'mp3' });
});
exports.downloadWithWorker = downloadWithWorker;
