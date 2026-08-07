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
exports.buildPersonalizedSeeds = exports.generateMusicSeedsWithDeepSeek = exports.mixQueries = exports.generateLocalMusicQueries = exports.isDeepSeekEnabled = exports.getDeepSeekConfig = exports.computeMusicProfileHash = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const normalizeBaseUrl = (raw) => raw.replace(/\/+$/, '');
const getEnvBool = (raw) => {
    if (!raw)
        return false;
    return raw === 'true' || raw === '1' || raw === 'yes';
};
const stableStringify = (value) => {
    if (value === null || value === undefined)
        return String(value);
    if (typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
};
const computeMusicProfileHash = (profile) => {
    const trimmed = {
        topArtists: Array.isArray(profile.topArtists) ? profile.topArtists.slice(0, 10) : [],
        topGenres: Array.isArray(profile.topGenres) ? profile.topGenres.slice(0, 10) : [],
        recentTracks: Array.isArray(profile.recentTracks) ? profile.recentTracks.slice(0, 15) : [],
        likedTracks: Array.isArray(profile.likedTracks) ? profile.likedTracks.slice(0, 15) : [],
        skippedPatterns: Array.isArray(profile.skippedPatterns) ? profile.skippedPatterns.slice(0, 15) : [],
        recentSearches: Array.isArray(profile.recentSearches) ? profile.recentSearches.slice(0, 15) : [],
        currentTrack: profile.currentTrack ? { title: profile.currentTrack.title, artist: profile.currentTrack.artist } : null,
        preferredLanguage: profile.preferredLanguage || '',
    };
    const raw = stableStringify(trimmed);
    return crypto_1.default.createHash('sha256').update(raw).digest('hex').slice(0, 24);
};
exports.computeMusicProfileHash = computeMusicProfileHash;
const deepseekCache = new Map();
const getDeepSeekConfig = () => {
    const enabledFlag = getEnvBool(process.env.DEEPSEEK_RECOMMENDATIONS_ENABLED);
    const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
    const baseUrl = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
    const model = String(process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim() || 'deepseek-chat';
    const timeoutMsRaw = Number.parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '5000', 10);
    const maxQueriesRaw = Number.parseInt(process.env.DEEPSEEK_MAX_QUERIES || '8', 10);
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 5000;
    const maxQueries = Number.isFinite(maxQueriesRaw) && maxQueriesRaw > 0 ? maxQueriesRaw : 8;
    const cacheTtlMs = 15 * 60 * 1000;
    return { enabledFlag, apiKey, baseUrl, model, timeoutMs, maxQueries, cacheTtlMs };
};
exports.getDeepSeekConfig = getDeepSeekConfig;
const isDeepSeekEnabled = () => {
    const cfg = (0, exports.getDeepSeekConfig)();
    return cfg.enabledFlag && !!cfg.apiKey;
};
exports.isDeepSeekEnabled = isDeepSeekEnabled;
const sanitizeQuery = (raw) => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s)
        return '';
    if (s.length > 120)
        return s.slice(0, 120).trim();
    if (/https?:\/\//i.test(s) || /\bwww\./i.test(s) || /\byoutube\.com\b/i.test(s))
        return '';
    if (/(porn|xxx|sex|hentai)/i.test(s))
        return '';
    return s.replace(/\s+/g, ' ').trim();
};
const dedupeAndLimit = (queries, limit) => {
    const out = [];
    const seen = new Set();
    for (const q of queries) {
        const cleaned = sanitizeQuery(q);
        if (!cleaned)
            continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(cleaned);
        if (out.length >= limit)
            break;
    }
    return out;
};
const tryParseJsonQueries = (content) => {
    try {
        const parsed = JSON.parse(content);
        const arr = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.queries) ? parsed.queries : null;
        if (!arr)
            return null;
        return dedupeAndLimit(arr, (0, exports.getDeepSeekConfig)().maxQueries);
    }
    catch (_a) {
        return null;
    }
};
const tryExtractArrayQueries = (content) => {
    const max = (0, exports.getDeepSeekConfig)().maxQueries;
    const start = content.indexOf('[');
    const end = content.lastIndexOf(']');
    if (start < 0 || end <= start)
        return null;
    const slice = content.slice(start, end + 1);
    try {
        const parsed = JSON.parse(slice);
        if (!Array.isArray(parsed))
            return null;
        return dedupeAndLimit(parsed, max);
    }
    catch (_a) {
        return null;
    }
};
const parseDeepSeekQueries = (content) => {
    const s = String(content || '').trim();
    if (!s)
        return null;
    const byJson = tryParseJsonQueries(s);
    if (byJson && byJson.length > 0)
        return byJson;
    const byArray = tryExtractArrayQueries(s);
    if (byArray && byArray.length > 0)
        return byArray;
    return null;
};
const generateLocalMusicQueries = (profile, maxQueries = 12) => {
    var _a, _b;
    const raw = [];
    const artists = Array.isArray(profile.topArtists) ? profile.topArtists : [];
    const genres = Array.isArray(profile.topGenres) ? profile.topGenres : [];
    const recentTracks = Array.isArray(profile.recentTracks) ? profile.recentTracks : [];
    const likedTracks = Array.isArray(profile.likedTracks) ? profile.likedTracks : [];
    const searches = Array.isArray(profile.recentSearches) ? profile.recentSearches : [];
    for (const a of artists.slice(0, 5))
        raw.push(`${a} official audio`);
    for (const t of recentTracks.slice(0, 5))
        raw.push(`${t} official audio`);
    for (const t of likedTracks.slice(0, 5))
        raw.push(`${t} official audio`);
    for (const g of genres.slice(0, 4))
        raw.push(`${g} hits`);
    for (const q of searches.slice(0, 6))
        raw.push(q);
    if ((_a = profile.currentTrack) === null || _a === void 0 ? void 0 : _a.artist)
        raw.push(`${profile.currentTrack.artist} official audio`);
    if ((_b = profile.currentTrack) === null || _b === void 0 ? void 0 : _b.title)
        raw.push(`${profile.currentTrack.title} official audio`);
    return dedupeAndLimit(raw, Math.max(1, maxQueries));
};
exports.generateLocalMusicQueries = generateLocalMusicQueries;
const mixQueries = (localQueries, aiQueries, maxTotal) => {
    const merged = [];
    for (const q of localQueries)
        merged.push(q);
    for (const q of aiQueries || [])
        merged.push(q);
    return dedupeAndLimit(merged, Math.max(1, maxTotal));
};
exports.mixQueries = mixQueries;
const generateMusicSeedsWithDeepSeek = (profile) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const cfg = (0, exports.getDeepSeekConfig)();
    if (!cfg.enabledFlag)
        return null;
    if (!cfg.apiKey) {
        console.warn('[deepseek] invalid config (missing api key)');
        return null;
    }
    const userId = String(profile.userId || '').trim() || 'anon';
    const profileHash = (0, exports.computeMusicProfileHash)(profile);
    const cacheKey = `${userId}:${profileHash}`;
    const now = Date.now();
    const cached = deepseekCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        console.log('[deepseek/recommendations] queries', { queries: cached.queries.length, cached: true });
        return cached.queries;
    }
    const topArtists = Array.isArray(profile.topArtists) ? profile.topArtists.slice(0, 10) : [];
    const topGenres = Array.isArray(profile.topGenres) ? profile.topGenres.slice(0, 10) : [];
    const recentTracks = Array.isArray(profile.recentTracks) ? profile.recentTracks.slice(0, 15) : [];
    const likedTracks = Array.isArray(profile.likedTracks) ? profile.likedTracks.slice(0, 15) : [];
    const recentSearches = Array.isArray(profile.recentSearches) ? profile.recentSearches.slice(0, 15) : [];
    const preferredLanguage = profile.preferredLanguage || 'es';
    console.log('[deepseek/recommendations] profile', {
        artists: topArtists.length,
        genres: topGenres.length,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const url = `${cfg.baseUrl}/chat/completions`;
    const system = [
        'Eres un asistente que genera queries cortas para buscar música (YouTube/Audio).',
        'Debes responder SOLO con JSON válido y NADA MÁS.',
        'No incluyas explicaciones, no uses markdown, no uses code fences.',
        'No incluyas URLs.',
        'Máximo 8 queries, sin duplicados, prioriza relación con el historial.',
        'Evita contenido explícito innecesario.',
        'Genera consultas para encontrar canciones reales, official audio/video, no tutoriales, no podcasts, no software, no cursos.',
        'Formato de salida: {"queries":["..."]}',
    ].join('\n');
    const user = stableStringify({
        preferredLanguage,
        topArtists,
        topGenres,
        recentTracks,
        likedTracks,
        skippedPatterns: Array.isArray(profile.skippedPatterns) ? profile.skippedPatterns : [],
        recentSearches,
        currentTrack: profile.currentTrack || null,
    });
    try {
        const res = yield axios_1.default.post(url, {
            model: cfg.model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            temperature: 0.7,
            max_tokens: 500,
        }, {
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${cfg.apiKey}`,
                'Content-Type': 'application/json',
            },
        });
        const content = String(((_d = (_c = (_b = (_a = res.data) === null || _a === void 0 ? void 0 : _a.choices) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.message) === null || _d === void 0 ? void 0 : _d.content) || '').trim();
        const queries = parseDeepSeekQueries(content);
        if (!queries || queries.length === 0) {
            console.warn('[deepseek/recommendations] failed', { reason: 'invalid_json' });
            return null;
        }
        let finalQueries = dedupeAndLimit(queries, cfg.maxQueries);
        finalQueries = finalQueries.filter((q) => {
            const lower = q.toLowerCase();
            const banned = ['tutorial', 'setup', 'guide', 'mixer', 'audio university', 'software', 'course'];
            return !banned.some(b => lower.includes(b));
        });
        deepseekCache.set(cacheKey, { expiresAt: now + cfg.cacheTtlMs, queries: finalQueries });
        console.log('[deepseek/recommendations] queries', { queries: finalQueries.length, cached: false });
        return finalQueries;
    }
    catch (error) {
        const isTimeout = controller.signal.aborted || (error === null || error === void 0 ? void 0 : error.code) === 'ERR_CANCELED' || (error === null || error === void 0 ? void 0 : error.name) === 'CanceledError';
        if (isTimeout) {
            console.warn('[deepseek/recommendations] failed', { reason: 'timeout' });
        }
        else {
            console.warn('[deepseek/recommendations] failed', {
                reason: ((_e = error === null || error === void 0 ? void 0 : error.response) === null || _e === void 0 ? void 0 : _e.status) ? `http_${error.response.status}` : 'error',
                message: error === null || error === void 0 ? void 0 : error.message,
            });
        }
        return null;
    }
    finally {
        clearTimeout(timer);
    }
});
exports.generateMusicSeedsWithDeepSeek = generateMusicSeedsWithDeepSeek;
const buildPersonalizedSeeds = (profile, maxQueries = 12) => {
    var _a;
    const raw = [];
    const artists = Array.isArray(profile === null || profile === void 0 ? void 0 : profile.topArtists) ? profile.topArtists : [];
    const genres = Array.isArray(profile === null || profile === void 0 ? void 0 : profile.topGenres) ? profile.topGenres : [];
    const recentTracks = Array.isArray(profile === null || profile === void 0 ? void 0 : profile.recentTracks) ? profile.recentTracks : [];
    const likedTracks = Array.isArray(profile === null || profile === void 0 ? void 0 : profile.likedTracks) ? profile.likedTracks : [];
    if (artists.length > 0) {
        raw.push(`${artists[0]} official audio`);
        raw.push(`${artists[0]} hits official audio`);
        if (artists.length > 1) {
            raw.push(`${artists[0]} ${artists[1]} official audio`);
            raw.push(`similar to ${artists[0]} official audio`);
        }
    }
    for (const t of recentTracks.slice(0, 3))
        raw.push(`${t} official audio`);
    for (const t of likedTracks.slice(0, 3))
        raw.push(`${t} official audio`);
    for (const g of genres.slice(0, 2))
        raw.push(`${g} official audio`);
    if ((_a = profile === null || profile === void 0 ? void 0 : profile.currentTrack) === null || _a === void 0 ? void 0 : _a.artist)
        raw.push(`${profile.currentTrack.artist} official audio`);
    return dedupeAndLimit(raw, Math.max(1, maxQueries));
};
exports.buildPersonalizedSeeds = buildPersonalizedSeeds;
