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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const firebase_1 = require("../firebase");
const mediaWorkerClient_1 = require("../services/mediaWorkerClient");
const deepseekRecommendations_1 = require("../services/deepseekRecommendations");
const searchAiAssist_1 = require("../services/searchAiAssist");
const searchRanking_1 = require("../services/searchRanking");
const searchDeepseekRerank_1 = require("../services/searchDeepseekRerank");
const utils_1 = require("../utils");
const trackQuality_1 = require("../utils/trackQuality");
const recommendationRanking_1 = require("../services/recommendationRanking");
const recommendationStore_1 = require("../services/recommendationStore");
const router = (0, express_1.Router)();
const normalizeBaseUrl = (raw) => raw.replace(/\/+$/, '');
const getConvertTimeoutMs = () => {
    const raw = Number.parseInt(process.env.CONVERT_TIMEOUT_MS || '20000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 20000;
};
const convertTimeoutMs = getConvertTimeoutMs();
const getSeenTtlHours = () => {
    const raw = Number.parseInt(process.env.RECOMMENDATION_SEEN_TTL_HOURS || '24', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 24;
};
const isDockerLike = () => {
    const base = String(process.env.CONVERT_URL || process.env.DOWNLOADER_URL || '').toLowerCase();
    if (process.env.DB_HOST === 'db')
        return true;
    if (base.includes('://convert:'))
        return true;
    return false;
};
const downloaderUrls = (() => {
    const envUrls = [process.env.CONVERT_URL, process.env.DOWNLOADER_URL]
        .filter((u) => Boolean(u))
        .map((u) => normalizeBaseUrl(u));
    const candidates = isDockerLike()
        ? [...envUrls, 'http://convert:8000']
        : ['http://localhost:8000', 'http://127.0.0.1:8000', ...envUrls, 'http://convert:8000'];
    return candidates.filter((url, index, arr) => Boolean(url) && arr.indexOf(url) === index);
})();
const normalizeText = (value) => String(value !== null && value !== void 0 ? value : '').trim().toLowerCase();
const makeReqId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const truncate = (value, max = 120) => {
    const s = String(value !== null && value !== void 0 ? value : '');
    if (s.length <= max)
        return s;
    return `${s.slice(0, max)}...`;
};
const serializeError = (error) => {
    var _a;
    return ({
        name: error === null || error === void 0 ? void 0 : error.name,
        message: error === null || error === void 0 ? void 0 : error.message,
        code: error === null || error === void 0 ? void 0 : error.code,
        status: (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status,
    });
};
const isDev = () => String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
const mediaBaseDir = process.env.MEDIA_BASE_DIR || '/app/downloads';
const resolveAudioPending = new Map();
const searchCacheTtlMs = (() => {
    const raw = Number.parseInt(process.env.SEARCH_CACHE_TTL_MS || '600000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 600000;
})();
const searchCache = new Map();
const getSearchCache = (key) => {
    const v = searchCache.get(key);
    if (!v)
        return null;
    if (Date.now() - v.ts > searchCacheTtlMs) {
        searchCache.delete(key);
        return null;
    }
    return v.payload;
};
const setSearchCache = (key, payload) => {
    searchCache.set(key, { ts: Date.now(), payload });
    const maxSize = 250;
    if (searchCache.size <= maxSize)
        return;
    const first = searchCache.keys().next().value;
    if (first)
        searchCache.delete(first);
};
const normalizeKey = (value) => normalizeText(value).replace(/\s+/g, ' ').trim();
const getItemYoutubeId = (it) => String((it === null || it === void 0 ? void 0 : it.youtube_id) || (it === null || it === void 0 ? void 0 : it.id) || '').trim();
const getItemArtist = (it) => String((it === null || it === void 0 ? void 0 : it.artist) || (it === null || it === void 0 ? void 0 : it.uploader) || '').trim();
const getItemTitle = (it) => String((it === null || it === void 0 ? void 0 : it.title) || '').trim();
const buildDedupKeys = (it) => {
    const yt = getItemYoutubeId(it);
    const titleNorm = normalizeKey(getItemTitle(it));
    const artistNorm = normalizeKey(getItemArtist(it));
    const titleArtistKey = artistNorm && titleNorm ? `${artistNorm}::${titleNorm}` : '';
    const audioUrl = String((it === null || it === void 0 ? void 0 : it.audioUrl) || (it === null || it === void 0 ? void 0 : it.audio_url) || (it === null || it === void 0 ? void 0 : it.file_url) || '').trim();
    const audioKey = audioUrl ? normalizeKey(audioUrl) : '';
    const primary = yt ? `yt:${yt}` : titleArtistKey ? `ta:${titleArtistKey}` : titleNorm ? `t:${titleNorm}` : '';
    return { primary, yt, titleNorm, artistNorm, titleArtistKey, audioKey };
};
const dedupeAndFilterItems = (items, exclude) => {
    const out = [];
    const seenPrimary = new Set();
    const seenYt = new Set();
    const seenTitle = new Set();
    const seenTitleArtist = new Set();
    const seenAudio = new Set();
    let skippedDuplicates = 0;
    for (const it of items) {
        const k = buildDedupKeys(it);
        const ytId = k.yt;
        const itemTrackKey = ytId ? `yt:${ytId}` : k.primary;
        if (exclude.blockedTrackKeys && itemTrackKey && exclude.blockedTrackKeys.has(itemTrackKey)) {
            skippedDuplicates++;
            continue;
        }
        if (exclude.blockedTrackKeys && ytId && exclude.blockedTrackKeys.has(ytId)) {
            skippedDuplicates++;
            continue;
        }
        if (exclude.blockedArtists) {
            const artistKey = k.artistNorm || normalizeKey(getItemArtist(it));
            if (artistKey && exclude.blockedArtists.has(artistKey)) {
                skippedDuplicates++;
                continue;
            }
        }
        if (ytId && exclude.ytIds.has(ytId)) {
            skippedDuplicates++;
            continue;
        }
        if (k.titleNorm && exclude.titleKeys.has(k.titleNorm)) {
            skippedDuplicates++;
            continue;
        }
        if (k.titleArtistKey && exclude.titleArtistKeys.has(k.titleArtistKey)) {
            skippedDuplicates++;
            continue;
        }
        if (k.audioKey && exclude.audioKeys.has(k.audioKey)) {
            skippedDuplicates++;
            continue;
        }
        if (k.primary && seenPrimary.has(k.primary)) {
            skippedDuplicates++;
            continue;
        }
        if (ytId && (seenYt.has(ytId) || seenPrimary.has(`yt:${ytId}`))) {
            skippedDuplicates++;
            continue;
        }
        if (k.titleNorm && seenTitle.has(k.titleNorm)) {
            skippedDuplicates++;
            continue;
        }
        if (k.titleArtistKey && seenTitleArtist.has(k.titleArtistKey)) {
            skippedDuplicates++;
            continue;
        }
        if (k.audioKey && seenAudio.has(k.audioKey)) {
            skippedDuplicates++;
            continue;
        }
        if (k.primary)
            seenPrimary.add(k.primary);
        if (ytId)
            seenYt.add(ytId);
        if (k.titleNorm)
            seenTitle.add(k.titleNorm);
        if (k.titleArtistKey)
            seenTitleArtist.add(k.titleArtistKey);
        if (k.audioKey)
            seenAudio.add(k.audioKey);
        out.push(it);
    }
    return { items: out, dedupedCount: items.length - out.length, skippedDuplicates };
};
const isNonMusicTitle = (title, uploader) => {
    if (!(0, trackQuality_1.isLikelyMusicTrack)(title, uploader))
        return true;
    const t = normalizeText(title);
    const u = normalizeText(uploader);
    if (!t)
        return true;
    if (/(^|\s)#?shorts(\s|$)/.test(t) || /(^|\s)#?shorts(\s|$)/.test(u))
        return true;
    // Términos estrictamente prohibidos (películas, tutoriales, contenido hablado, anime episodes, etc.)
    const filterRegex = /(^|\s)(tutorial|tutoriales|how to|curso|clase|lesson|gu[ií]a|review|an[áa]lisis|reaction|reacci[oó]n|gameplay|trailer|entrevista|interview|podcast|episode|episodio|ep\.|ep\s*#|cap[ií]tulo|capitulo|live|en vivo|directo|conferencia|stream|walkthrough|speedrun|vlog|pelicula|película|completa|full movie|movie|instagram reels|reels|tiktok|sonidos de reels|troll|trolleo|broma|prank|chiste|humor|risa|meme|parodia|shitpost|whatsapp|chat|reto|challenge|short|shorts|edit|edits|flp|fl studio|type beat|remake|historia|historias|history|responde|respond|explicaci[oó]n|analiza|tiradera|noticia|news|chisme|documentary|documental|biograf[ií]a|mensaje|mensajes|escena|scene|doblaje|temporada|season|clip|doblado|subtitulado|latino|español latino|castellano|te lo resumo|resumen|netflix|hbo|disney|prime video|cine|movies|peliculas|películas|dragon ball|naruto|one piece|surgimento|parte|part|pt\.)(\s|$)/;
    if (filterRegex.test(t) || filterRegex.test(u))
        return true;
    if (t.includes('in spotify') || t.includes('tiktok version') || t.includes('tiktok remix'))
        return true;
    // Canales que usualmente suben películas o cosas no musicales
    const badChannels = ['netflix', 'hbo', 'disney', 'prime video', 'cine', 'movies', 'clips', 'televisa', 'tv azteca', 'caracol', 'rcn', 'noticias', 'news', 'crunchyroll'];
    if (u && badChannels.some(bc => u.includes(bc)))
        return true;
    return t.includes('karaoke') ||
        t.includes('8d') ||
        /(^|\s)mix(\s|$)/.test(t) ||
        t.includes('megamix') ||
        t.includes('playlist') ||
        t.includes('top') ||
        t.includes('mejores') ||
        t.includes('éxitos') ||
        t.includes('exitos') ||
        t.includes('recopilación') ||
        t.includes('recopilacion') ||
        t.includes('colección') ||
        t.includes('coleccion') ||
        t.includes('canciones de') ||
        t.includes('enganchados') ||
        t.includes('youtube');
};
const parseDurationSeconds = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.floor(n));
};
const extractYoutubeId = (value) => {
    var _a, _b, _c;
    const raw = String(value !== null && value !== void 0 ? value : '').trim();
    if (!raw)
        return '';
    try {
        const parsed = new URL(raw);
        const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
        if (host === 'youtu.be') {
            return (_a = parsed.pathname.split('/').filter(Boolean)[0]) !== null && _a !== void 0 ? _a : '';
        }
        if (host.endsWith('youtube.com')) {
            return (_c = (_b = parsed.searchParams.get('v')) !== null && _b !== void 0 ? _b : parsed.pathname.split('/')[2]) !== null && _c !== void 0 ? _c : '';
        }
    }
    catch (_d) {
        return raw.includes('/') ? '' : raw;
    }
    return '';
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
const downloadRemoteToLocal = (remoteUrl, destPath) => __awaiter(void 0, void 0, void 0, function* () {
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
        const size = fs_1.default.statSync(destPath).size;
        if (!size || size <= 0) {
            try {
                fs_1.default.unlinkSync(destPath);
            }
            catch (_c) { }
            return null;
        }
        return destPath;
    }
    catch (_d) {
        try {
            writer.close();
        }
        catch (_e) { }
        try {
            fs_1.default.unlinkSync(tmpPath);
        }
        catch (_f) { }
        return null;
    }
});
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
const cleanSongTitle = (title) => {
    return title
        .replace(/\s*[-|]*\s*youtube\s*music\s*/i, '')
        .replace(/\s*[-|]*\s*youtube\s*/i, '')
        .replace(/\s*[-|]*\s*official\s*music\s*video\s*/i, '')
        .replace(/\s*[-|]*\s*official\s*video\s*/i, '')
        .replace(/\s*[-|]*\s*official\s*audio\s*/i, '')
        .replace(/\s*[-|]*\s*oficial\s*/i, '')
        .replace(/\s*[-|]*\s*official\s*/i, '')
        .replace(/\s*[-|]*\s*lyric\s*video\s*/i, '')
        .replace(/\s*[-|]*\s*lyrics\s*/i, '')
        .replace(/\s*[-|]*\s*music\s*video\s*/i, '')
        .replace(/\s*\(official\s*video\)/i, '')
        .replace(/\s*\[official\s*video\]/i, '')
        .replace(/\s*\(official\s*audio\)/i, '')
        .replace(/\s*\[official\s*audio\]/i, '')
        .replace(/\s*\(lyric\s*video\)/i, '')
        .replace(/\s*\[lyric\s*video\]/i, '')
        .replace(/\s*\(lyrics\)/i, '')
        .replace(/\s*\[lyrics\]/i, '')
        .trim();
};
const adaptYouTubeRows = (rows, localKeys, localYoutubeIds, localMap) => {
    const seenYoutube = new Set();
    const debug = process.env.MUSIC_FILTER_DEBUG === 'true';
    const rejected = [];
    const filtered = rows.filter((yt) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const ytTitle = normalizeText(yt.title);
        if (!ytTitle) {
            if (debug)
                rejected.push({ reason: 'empty_title', title: yt.title, uploader: (_a = yt.uploader) !== null && _a !== void 0 ? _a : yt.artist });
            return false;
        }
        const ytArtist = normalizeText((_b = yt.uploader) !== null && _b !== void 0 ? _b : yt.artist);
        if (isNonMusicTitle(ytTitle, ytArtist)) {
            if (debug)
                rejected.push({ reason: 'non_music', title: yt.title, uploader: (_c = yt.uploader) !== null && _c !== void 0 ? _c : yt.artist });
            return false;
        }
        const dur = parseDurationSeconds((_e = (_d = yt.duration_seconds) !== null && _d !== void 0 ? _d : yt.lengthSeconds) !== null && _e !== void 0 ? _e : yt.duration);
        // Relaxed duration filter: from 1 min to 10 mins to include more songs
        if (dur > 0 && (dur < 60 || dur > 600)) {
            if (debug)
                rejected.push({ reason: 'duration', duration: dur, title: yt.title, uploader: (_f = yt.uploader) !== null && _f !== void 0 ? _f : yt.artist });
            return false;
        }
        const ytKey = `${ytTitle}::${ytArtist}`;
        const ytId = extractYoutubeId((_h = (_g = yt.youtube_id) !== null && _g !== void 0 ? _g : yt.id) !== null && _h !== void 0 ? _h : yt.url);
        // Si pasamos localMap, NO filtramos las que están en backend porque las vamos a "transformar" en canciones locales.
        if (!localMap && ((ytId && localYoutubeIds.has(ytId)) || localKeys.has(ytKey) || (ytId && seenYoutube.has(ytId)))) {
            return false;
        }
        if (localMap && ytId && seenYoutube.has(ytId))
            return false;
        if (ytId) {
            seenYoutube.add(ytId);
        }
        return true;
    });
    if (debug && rejected.length > 0) {
        console.log('[music/filter] rejected_sample', rejected.slice(0, 6).map((r) => ({
            reason: r.reason,
            duration: r.duration,
            title: truncate(r.title, 90),
            uploader: truncate(r.uploader, 60),
        })));
    }
    return filtered.map((yt) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        const ytId = extractYoutubeId((_b = (_a = yt.youtube_id) !== null && _a !== void 0 ? _a : yt.id) !== null && _b !== void 0 ? _b : yt.url);
        if (localMap && ytId && localMap.has(ytId)) {
            const dbRow = localMap.get(ytId);
            return {
                id: dbRow.id,
                youtube_id: dbRow.youtube_id,
                title: dbRow.title,
                artist: dbRow.uploader,
                uploader: dbRow.uploader,
                duration: dbRow.duration,
                duration_seconds: dbRow.duration,
                thumbnail: dbRow.thumbnail,
                thumbnail_url: dbRow.thumbnail,
                url: dbRow.url || `/api/downloads/stream/${dbRow.id}`,
                source: 'local'
            };
        }
        return {
            id: ytId,
            youtube_id: ytId,
            title: cleanSongTitle(yt.title),
            artist: cleanSongTitle((_d = (_c = yt.uploader) !== null && _c !== void 0 ? _c : yt.artist) !== null && _d !== void 0 ? _d : 'Internet'),
            uploader: cleanSongTitle((_f = (_e = yt.uploader) !== null && _e !== void 0 ? _e : yt.artist) !== null && _f !== void 0 ? _f : 'Internet'),
            duration: parseDurationSeconds((_h = (_g = yt.duration_seconds) !== null && _g !== void 0 ? _g : yt.lengthSeconds) !== null && _h !== void 0 ? _h : yt.duration),
            duration_seconds: parseDurationSeconds((_k = (_j = yt.duration_seconds) !== null && _j !== void 0 ? _j : yt.lengthSeconds) !== null && _k !== void 0 ? _k : yt.duration),
            thumbnail: (_m = (_l = yt.thumbnail_url) !== null && _l !== void 0 ? _l : yt.thumbnail) !== null && _m !== void 0 ? _m : `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
            thumbnail_url: (_p = (_o = yt.thumbnail_url) !== null && _o !== void 0 ? _o : yt.thumbnail) !== null && _p !== void 0 ? _p : `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
            url: (_q = yt.url) !== null && _q !== void 0 ? _q : `https://www.youtube.com/watch?v=${ytId}`,
            source: 'youtube',
        };
    });
};
const isPlaceholderThumbnail = (value) => {
    const v = normalizeText(value);
    if (!v)
        return true;
    if (v.includes('ui-avatars'))
        return true;
    if (v.endsWith('/vn') || v.includes('vn.png') || v.includes('vns'))
        return false;
    return false;
};
const needsHealDownload = (row) => {
    var _a, _b, _c;
    const ytId = String((_a = row === null || row === void 0 ? void 0 : row.youtube_id) !== null && _a !== void 0 ? _a : '').trim();
    if (ytId === 'legado_vns')
        return true;
    const thumb = (_c = (_b = row === null || row === void 0 ? void 0 : row.thumbnail) !== null && _b !== void 0 ? _b : row === null || row === void 0 ? void 0 : row.thumbnail_url) !== null && _c !== void 0 ? _c : row === null || row === void 0 ? void 0 : row.image_url;
    if (typeof thumb === 'string' && thumb.includes('ui-avatars'))
        return true;
    if (!thumb)
        return true;
    return false;
};
const withTimeout = (p, ms) => __awaiter(void 0, void 0, void 0, function* () {
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('timeout')), ms);
    });
    try {
        return yield Promise.race([p, timeout]);
    }
    finally {
        if (timeoutId)
            clearTimeout(timeoutId);
    }
});
const findBestYoutubeMatch = (query) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
    const q = String(query || '').trim();
    if (!q)
        return null;
    for (const pyUrl of downloaderUrls) {
        try {
            const response = yield axios_1.default.get(`${pyUrl}/search`, {
                timeout: convertTimeoutMs,
                params: { q, limit: 5 },
            });
            const data = response.data;
            if (Array.isArray(data) && data.length > 0) {
                const first = data[0];
                const ytId = extractYoutubeId((_b = (_a = first.youtube_id) !== null && _a !== void 0 ? _a : first.id) !== null && _b !== void 0 ? _b : first.url);
                if (!ytId)
                    continue;
                return {
                    youtube_id: ytId,
                    uploader: cleanSongTitle((_f = (_e = (_d = (_c = first.uploader) !== null && _c !== void 0 ? _c : first.artist) !== null && _d !== void 0 ? _d : first.author) !== null && _e !== void 0 ? _e : first.channel) !== null && _f !== void 0 ? _f : 'Internet'),
                    duration: parseDurationSeconds((_h = (_g = first.duration_seconds) !== null && _g !== void 0 ? _g : first.lengthSeconds) !== null && _h !== void 0 ? _h : first.duration),
                    thumbnail: (_k = (_j = first.thumbnail_url) !== null && _j !== void 0 ? _j : first.thumbnail) !== null && _k !== void 0 ? _k : `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
                    url: `https://www.youtube.com/watch?v=${ytId}`,
                };
            }
        }
        catch (_v) { }
    }
    try {
        const rows = yield searchInvidious(q, 5);
        if (Array.isArray(rows) && rows.length > 0) {
            const first = rows[0];
            const ytId = extractYoutubeId((_m = (_l = first.youtube_id) !== null && _l !== void 0 ? _l : first.id) !== null && _m !== void 0 ? _m : first.url);
            if (!ytId)
                return null;
            return {
                youtube_id: ytId,
                uploader: cleanSongTitle((_o = first.uploader) !== null && _o !== void 0 ? _o : 'Internet'),
                duration: parseDurationSeconds(first.duration_seconds),
                thumbnail: (_p = first.thumbnail_url) !== null && _p !== void 0 ? _p : `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
                url: `https://www.youtube.com/watch?v=${ytId}`,
            };
        }
    }
    catch (_w) { }
    try {
        const rows = yield searchDuckDuckGoForYoutube(q, 5);
        if (Array.isArray(rows) && rows.length > 0) {
            const first = rows[0];
            const ytId = extractYoutubeId((_r = (_q = first.youtube_id) !== null && _q !== void 0 ? _q : first.id) !== null && _r !== void 0 ? _r : first.url);
            if (!ytId)
                return null;
            return {
                youtube_id: ytId,
                uploader: cleanSongTitle((_t = (_s = first.uploader) !== null && _s !== void 0 ? _s : first.artist) !== null && _t !== void 0 ? _t : 'Internet'),
                duration: parseDurationSeconds(first.duration_seconds),
                thumbnail: (_u = first.thumbnail_url) !== null && _u !== void 0 ? _u : `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
                url: `https://www.youtube.com/watch?v=${ytId}`,
            };
        }
    }
    catch (_x) { }
    return null;
});
const healDownloadRow = (row) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    if (!(row === null || row === void 0 ? void 0 : row.id) || !needsHealDownload(row))
        return row;
    const title = String((_a = row.title) !== null && _a !== void 0 ? _a : '').trim();
    const uploader = String((_c = (_b = row.uploader) !== null && _b !== void 0 ? _b : row.artist) !== null && _c !== void 0 ? _c : '').trim();
    const q = uploader ? `${title} ${uploader}` : title;
    const match = yield findBestYoutubeMatch(q);
    if (!match)
        return row;
    try {
        yield db_1.default.query(`UPDATE Downloads
       SET youtube_id = $1,
           uploader = COALESCE(NULLIF($2, ''), uploader),
           duration = COALESCE(NULLIF($3, 0), duration),
           thumbnail = COALESCE(NULLIF($4, ''), thumbnail)
       WHERE id = $5`, [match.youtube_id, match.uploader, match.duration, match.thumbnail, row.id]);
    }
    catch (e) {
        console.error('[auto-healer] update failed', e);
    }
    return Object.assign(Object.assign({}, row), { youtube_id: match.youtube_id, uploader: match.uploader || row.uploader, artist: match.uploader || row.uploader, duration: match.duration || row.duration, duration_seconds: match.duration || row.duration, thumbnail: match.thumbnail, thumbnail_url: match.thumbnail });
});
const searchInvidious = (query, limit) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instancesRes = yield axios_1.default.get('https://api.invidious.io/instances.json?sort_by=health', {
            timeout: 5000,
            headers: { 'user-agent': 'Mozilla/5.0' },
        });
        const instances = instancesRes.data;
        if (!Array.isArray(instances))
            return [];
        for (const item of instances) {
            const host = item === null || item === void 0 ? void 0 : item[0];
            const meta = item === null || item === void 0 ? void 0 : item[1];
            if (!host || (meta === null || meta === void 0 ? void 0 : meta.api) === false || (meta === null || meta === void 0 ? void 0 : meta.type) !== 'https')
                continue;
            try {
                const searchUrl = `https://${host}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
                const res = yield axios_1.default.get(searchUrl, {
                    timeout: 5000,
                    headers: { 'user-agent': 'Mozilla/5.0' },
                });
                const rows = res.data;
                if (!Array.isArray(rows) || rows.length === 0)
                    continue;
                return rows.slice(0, limit).map((row) => {
                    var _a, _b, _c, _d, _e;
                    return ({
                        id: (_a = row.videoId) !== null && _a !== void 0 ? _a : row.id,
                        title: row.title,
                        uploader: row.author,
                        duration_seconds: row.lengthSeconds,
                        thumbnail_url: (_d = (_c = (_b = row.videoThumbnails) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.url) !== null && _d !== void 0 ? _d : null,
                        url: row.videoId ? `https://www.youtube.com/watch?v=${row.videoId}` : undefined,
                        youtube_id: (_e = row.videoId) !== null && _e !== void 0 ? _e : row.id,
                        source: 'youtube',
                    });
                });
            }
            catch (_a) {
                continue;
            }
        }
    }
    catch (_b) {
        return [];
    }
    return [];
});
const decodeHtml = (text) => text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const searchDuckDuckGoForYoutube = (query, limit) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const response = yield axios_1.default.get(`https://duckduckgo.com/html/?q=${encodeURIComponent(`${query} site:youtube.com`)}`, {
            timeout: 6000,
            headers: { 'user-agent': 'Mozilla/5.0' },
            responseType: 'text',
        });
        const html = String((_a = response.data) !== null && _a !== void 0 ? _a : '');
        const anchorRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gm;
        const rows = [];
        const seen = new Set();
        let match;
        while ((match = anchorRegex.exec(html)) !== null && rows.length < limit) {
            const href = match[1];
            const rawTitle = (_b = match[2]) === null || _b === void 0 ? void 0 : _b.replace(/<[^>]+>/g, '').trim();
            const title = decodeHtml(rawTitle || '');
            if (!title)
                continue;
            let candidateUrl = decodeHtml(href);
            if (candidateUrl.startsWith('//')) {
                candidateUrl = `https:${candidateUrl}`;
            }
            try {
                const parsed = new URL(candidateUrl);
                const redirected = parsed.searchParams.get('uddg');
                if (redirected) {
                    candidateUrl = decodeURIComponent(redirected);
                }
            }
            catch (_c) {
                continue;
            }
            const ytId = extractYoutubeId(candidateUrl);
            if (!ytId || seen.has(ytId))
                continue;
            seen.add(ytId);
            rows.push({
                id: ytId,
                youtube_id: ytId,
                title,
                uploader: 'YouTube',
                duration_seconds: null,
                thumbnail_url: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
                url: `https://www.youtube.com/watch?v=${ytId}`,
                source: 'youtube',
            });
        }
        return rows;
    }
    catch (_d) {
        return [];
    }
});
const readBodyAsJson = (req) => {
    let finalBody = req.body || {};
    if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
        try {
            finalBody = JSON.parse(req.body);
        }
        catch (_a) { }
    }
    else if (Buffer.isBuffer(req.body)) {
        try {
            finalBody = JSON.parse(req.body.toString('utf8'));
        }
        catch (_b) { }
    }
    return finalBody;
};
const buildTrackKeyFromInput = (track) => {
    const yt = String((track === null || track === void 0 ? void 0 : track.youtube_id) || (track === null || track === void 0 ? void 0 : track.youtubeId) || (track === null || track === void 0 ? void 0 : track.sourceId) || (track === null || track === void 0 ? void 0 : track.id) || '').trim();
    const src = String((track === null || track === void 0 ? void 0 : track.source) || '').trim();
    if (yt)
        return src === 'local' ? `local:${yt}` : `yt:${yt}`;
    const title = normalizeKey(track === null || track === void 0 ? void 0 : track.title);
    const artist = normalizeKey((track === null || track === void 0 ? void 0 : track.artist) || (track === null || track === void 0 ? void 0 : track.uploader));
    if (artist && title)
        return `k:${title}::${artist}`;
    if (title)
        return `k:${title}`;
    return '';
};
router.post('/recommendation-feedback', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const uid = String(((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.uid) || '').trim();
    if (!uid)
        return res.status(401).json({ error: 'Unauthorized' });
    const body = readBodyAsJson(req);
    const track = (body === null || body === void 0 ? void 0 : body.track) || null;
    const feedbackType = String((body === null || body === void 0 ? void 0 : body.feedbackType) || '').trim();
    if (!track || !feedbackType)
        return res.status(400).json({ error: 'Invalid body' });
    const trackKey = buildTrackKeyFromInput(track);
    const youtubeId = String((track === null || track === void 0 ? void 0 : track.youtube_id) || (track === null || track === void 0 ? void 0 : track.youtubeId) || (track === null || track === void 0 ? void 0 : track.id) || '').trim() || null;
    const title = String((track === null || track === void 0 ? void 0 : track.title) || '').trim();
    const artist = String((track === null || track === void 0 ? void 0 : track.artist) || (track === null || track === void 0 ? void 0 : track.uploader) || '').trim() || null;
    const metadata = (body === null || body === void 0 ? void 0 : body.metadata) || {};
    if (!trackKey || !title)
        return res.status(400).json({ error: 'Missing track data' });
    if (!['more_like_this', 'not_this_track', 'not_this_artist', 'not_this_genre'].includes(feedbackType)) {
        return res.status(400).json({ error: 'Invalid feedbackType' });
    }
    yield (0, recommendationStore_1.saveRecommendationFeedback)({
        uid,
        trackKey,
        youtubeId,
        title,
        artist,
        feedbackType: feedbackType,
        metadata,
    });
    console.log('[recommendation-feedback]', { uid: 'yes', type: feedbackType, track: youtubeId ? youtubeId : trackKey });
    return res.json({ ok: true });
})));
router.post('/seen-tracks', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const uid = String(((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.uid) || '').trim();
    if (!uid)
        return res.status(401).json({ error: 'Unauthorized' });
    const body = readBodyAsJson(req);
    const items = Array.isArray(body === null || body === void 0 ? void 0 : body.items) ? body.items : [];
    const reason = String((body === null || body === void 0 ? void 0 : body.reason) || 'home').trim() || 'home';
    if (!Array.isArray(items) || items.length === 0)
        return res.json({ ok: true, marked: 0 });
    yield (0, recommendationStore_1.markUserSeenTracks)({ uid, items, reason });
    return res.json({ ok: true, marked: Math.min(items.length, 120) });
})));
router.delete('/seen-tracks', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const uid = String(((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.uid) || '').trim();
    if (!uid)
        return res.status(401).json({ error: 'Unauthorized' });
    const body = readBodyAsJson(req);
    const confirm = String((body === null || body === void 0 ? void 0 : body.confirm) || '').trim();
    if (confirm !== 'CLEAR_SEEN_TRACKS')
        return res.status(400).json({ error: 'Missing or invalid confirm', required: 'CLEAR_SEEN_TRACKS' });
    const result = yield (0, recommendationStore_1.clearUserSeenTracks)(uid);
    console.log('[seen-tracks] cleared', { uid: 'yes', deleted: result.deleted });
    return res.json({ ok: true, deleted: result.deleted });
})));
router.delete('/recommendation-cache', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const uid = String(((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.uid) || '').trim();
    if (!uid)
        return res.status(401).json({ error: 'Unauthorized' });
    const body = readBodyAsJson(req);
    const confirm = String((body === null || body === void 0 ? void 0 : body.confirm) || '').trim();
    if (confirm !== 'CLEAR_RECOMMENDATION_CACHE') {
        return res.status(400).json({ error: 'Missing or invalid confirm', required: 'CLEAR_RECOMMENDATION_CACHE' });
    }
    const result = yield (0, recommendationStore_1.clearUserRecommendationCache)(uid);
    console.log('[recommendation-cache] cleared', { uid: 'yes', deleted: result.deleted });
    return res.json({ ok: true, deleted: result.deleted });
})));
// ── GET /api/music/for-you — Combinar DB local y recomendaciones ──
router.get('/for-you', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const reqId = makeReqId();
    const startedAt = Date.now();
    const rawSeed = typeof req.query.seed === 'string' ? req.query.seed.trim() : '';
    const uid = String(((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.uid) || '').trim();
    const refresh = String(((_b = req.query) === null || _b === void 0 ? void 0 : _b.refresh) || '').trim() === '1' || String(((_c = req.query) === null || _c === void 0 ? void 0 : _c.refresh) || '').trim().toLowerCase() === 'true';
    const defaultForYouTerms = [
        'latin pop official audio',
        'reggaeton hits official audio',
        'pop music official audio',
        'anime music official audio',
        'lofi beats official audio',
    ];
    try {
        const localResult = yield db_1.default.query('SELECT id, title, uploader, duration, thumbnail, url, youtube_id, created_at FROM Downloads ORDER BY created_at DESC LIMIT 500');
        const filteredLocal = localResult.rows.filter((r) => !isNonMusicTitle(r.title, r.uploader));
        const shuffledLocal = filteredLocal.sort(() => Math.random() - 0.5).slice(0, 12);
        const localYoutubeIds = new Set(filteredLocal.map((r) => r.youtube_id).filter(Boolean));
        const localKeys = new Set(filteredLocal.map((r) => `${normalizeText(r.title)}::${normalizeText(r.uploader)}`));
        const runExternalSearch = (q) => __awaiter(void 0, void 0, void 0, function* () {
            let ytResults = [];
            const failures = [];
            for (const pyUrl of downloaderUrls) {
                try {
                    console.log('[convert/search]', { reqId, url: pyUrl, timeoutMs: convertTimeoutMs, q: truncate(q, 90) });
                    const response = yield axios_1.default.get(`${pyUrl}/search`, {
                        timeout: convertTimeoutMs,
                        params: { q, limit: 35 },
                    });
                    if (Array.isArray(response.data)) {
                        ytResults = adaptYouTubeRows(response.data, localKeys, localYoutubeIds);
                        if (ytResults.length > 0) {
                            console.log('[convert/search] ok', { reqId, url: pyUrl, items: ytResults.length });
                            return { items: ytResults, provider: 'convert' };
                        }
                    }
                }
                catch (error) {
                    console.warn('[convert/search] failed', Object.assign({ reqId, url: pyUrl }, serializeError(error)));
                    failures.push(Object.assign({ url: pyUrl }, serializeError(error)));
                    continue;
                }
            }
            const health = yield (0, mediaWorkerClient_1.workerHealth)();
            if (health.ok) {
                console.log('[worker/search] fallback', { reqId, q: truncate(q, 90) });
                const workerRes = yield (0, mediaWorkerClient_1.searchWithWorker)(q, 35);
                const workerItems = (workerRes === null || workerRes === void 0 ? void 0 : workerRes.items) || [];
                if (workerItems.length > 0) {
                    const workerRows = workerItems.map((w) => {
                        const sourceId = String(w.sourceId || '').trim() || String(w.id || '').split(':').pop() || '';
                        return {
                            id: sourceId,
                            youtube_id: sourceId,
                            title: w.title,
                            uploader: w.artist || w.uploader || 'Internet',
                            artist: w.artist || w.uploader || 'Internet',
                            duration_seconds: w.duration || 0,
                            thumbnail_url: w.coverUrl || w.thumbnail_url,
                            url: w.url || `https://www.youtube.com/watch?v=${sourceId}`,
                        };
                    });
                    ytResults = adaptYouTubeRows(workerRows, localKeys, localYoutubeIds);
                    console.log('[worker/search] items', { reqId, items: ytResults.length });
                    if (ytResults.length > 0)
                        return { items: ytResults, provider: 'worker' };
                }
            }
            else if ((0, mediaWorkerClient_1.isWorkerEnabled)()) {
                console.warn('[worker/search] skipped (unhealthy)', { reqId, status: health.status });
            }
            try {
                const duckRows = yield searchDuckDuckGoForYoutube(q, 25);
                ytResults = adaptYouTubeRows(duckRows, localKeys, localYoutubeIds);
            }
            catch (error) {
                failures.push(Object.assign({ url: 'duckduckgo' }, serializeError(error)));
            }
            if (ytResults.length === 0 && failures.length > 0) {
                console.warn('[music/for-you] external search failed', {
                    reqId,
                    q: truncate(q),
                    failures,
                });
            }
            return { items: ytResults, provider: ytResults.length > 0 ? 'duck' : 'none' };
        });
        let candidates = [];
        if (rawSeed)
            candidates.push({ q: rawSeed, source: 'personalized' });
        const recentTracks = [];
        const likedTracks = [];
        const recentSearches = [];
        const artistPool = [];
        let currentTrack = null;
        if (!rawSeed && uid) {
            try {
                const recentsSnap = yield firebase_1.admin
                    .firestore()
                    .collection('users')
                    .doc(uid)
                    .collection('recents')
                    .orderBy('played_at', 'desc')
                    .limit(12)
                    .get();
                const recents = recentsSnap.docs.map((d) => d.data());
                for (const r of recents) {
                    const t = String((r === null || r === void 0 ? void 0 : r.title) || '').trim();
                    const a = String((r === null || r === void 0 ? void 0 : r.artist) || '').trim();
                    if (t)
                        recentTracks.push(t);
                    if (a && a !== 'Internet' && a !== 'Desconocido' && a !== 'YouTube')
                        artistPool.push(a);
                }
                const recentDoc = recents[0];
                const recentTitle = String((recentDoc === null || recentDoc === void 0 ? void 0 : recentDoc.title) || '').trim();
                const recentArtist = String((recentDoc === null || recentDoc === void 0 ? void 0 : recentDoc.artist) || '').trim();
                currentTrack = recentTitle || recentArtist ? { title: recentTitle, artist: recentArtist } : null;
                if (recentArtist && recentArtist !== 'Internet' && recentArtist !== 'Desconocido' && recentArtist !== 'YouTube') {
                    candidates.push({ q: `${recentArtist} official audio`, source: 'recent' });
                }
                else if (recentTitle) {
                    candidates.push({ q: `${recentTitle} official audio`, source: 'recent' });
                }
            }
            catch (error) {
                console.warn('[music/for-you] failed to read recents', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
            }
            try {
                const likesSnap = yield firebase_1.admin
                    .firestore()
                    .collection('users')
                    .doc(uid)
                    .collection('likes')
                    .limit(12)
                    .get();
                const likes = likesSnap.docs.map((d) => d.data());
                for (const r of likes) {
                    const t = String((r === null || r === void 0 ? void 0 : r.title) || '').trim();
                    const a = String((r === null || r === void 0 ? void 0 : r.artist) || '').trim();
                    if (t)
                        likedTracks.push(t);
                    if (a && a !== 'Internet' && a !== 'Desconocido' && a !== 'YouTube')
                        artistPool.push(a);
                }
                const likeDoc = likes[0];
                const likeTitle = String((likeDoc === null || likeDoc === void 0 ? void 0 : likeDoc.title) || '').trim();
                const likeArtist = String((likeDoc === null || likeDoc === void 0 ? void 0 : likeDoc.artist) || '').trim();
                if (likeArtist && likeArtist !== 'Internet' && likeArtist !== 'Desconocido' && likeArtist !== 'YouTube') {
                    candidates.push({ q: `${likeArtist} official audio`, source: 'favorites' });
                }
                else if (likeTitle) {
                    candidates.push({ q: `${likeTitle} official audio`, source: 'favorites' });
                }
            }
            catch (error) {
                console.warn('[music/for-you] failed to read likes', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
            }
            try {
                const searchesSnap = yield firebase_1.admin
                    .firestore()
                    .collection('users')
                    .doc(uid)
                    .collection('searches')
                    .orderBy('last_used_at', 'desc')
                    .limit(10)
                    .get();
                for (const d of searchesSnap.docs) {
                    const q = String(((_d = d.data()) === null || _d === void 0 ? void 0 : _d.query) || '').trim();
                    if (q)
                        recentSearches.push(q);
                }
            }
            catch (error) {
                console.warn('[music/for-you] failed to read searches', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
            }
        }
        if (filteredLocal.length > 0) {
            const pick = filteredLocal[0];
            const uploader = String((pick === null || pick === void 0 ? void 0 : pick.uploader) || '').trim();
            const title = String((pick === null || pick === void 0 ? void 0 : pick.title) || '').trim();
            if (uploader && uploader !== 'Internet' && uploader !== 'Desconocido' && uploader !== 'YouTube') {
                candidates.push({ q: `${uploader} official audio`, source: 'downloads' });
            }
            else if (title) {
                candidates.push({ q: `${title} official audio`, source: 'downloads' });
            }
        }
        let profile = null;
        let profileHash = '';
        let positiveSeeds = [];
        const blockedTrackKeys = new Set();
        const blockedArtists = new Set();
        if (uid) {
            try {
                const blocked = yield (0, recommendationStore_1.getBlockedTrackKeys)(uid);
                for (const k of blocked.keys)
                    blockedTrackKeys.add(String(k));
                for (const yt of blocked.ytIds)
                    blockedTrackKeys.add(`yt:${String(yt)}`);
            }
            catch (_f) { }
            try {
                const artists = yield (0, recommendationStore_1.getBlockedArtists)(uid);
                for (const a of artists)
                    blockedArtists.add(String(a));
            }
            catch (_g) { }
            try {
                positiveSeeds = yield (0, recommendationStore_1.getPositiveSeeds)(uid, 12);
            }
            catch (_h) { }
            const counts = new Map();
            for (const a of artistPool)
                counts.set(a, (counts.get(a) || 0) + 1);
            const topArtists = Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([name]) => name)
                .slice(0, 6);
            let builtProfile = null;
            try {
                builtProfile = yield (0, recommendationStore_1.buildUserMusicProfile)(uid);
            }
            catch (err) {
                console.error('[music/for-you] buildUserMusicProfile failed', err);
            }
            profile = {
                userId: uid,
                topArtists: (builtProfile === null || builtProfile === void 0 ? void 0 : builtProfile.topArtists) || topArtists,
                topGenres: [],
                recentTracks: recentTracks.slice(0, 10),
                likedTracks: ((_e = builtProfile === null || builtProfile === void 0 ? void 0 : builtProfile.likedTracks) === null || _e === void 0 ? void 0 : _e.length) ? builtProfile.likedTracks : likedTracks.slice(0, 10),
                recentSearches: recentSearches.slice(0, 10),
                currentTrack,
                preferredLanguage: 'es',
                skippedPatterns: (builtProfile === null || builtProfile === void 0 ? void 0 : builtProfile.skippedPatterns) || []
            };
            if (positiveSeeds.length > 0) {
                const positiveOnly = positiveSeeds.slice(0, 3);
                candidates.splice(0, 0, ...positiveOnly.map((q) => ({ q, source: 'personalized' })));
            }
            const pSeeds = (0, deepseekRecommendations_1.buildPersonalizedSeeds)(profile);
            for (const s of pSeeds) {
                candidates.push({ q: s, source: 'personalized' });
            }
            if (positiveSeeds.length === 0 && recentTracks.length === 0) {
                for (const t of defaultForYouTerms)
                    candidates.push({ q: t, source: 'default-search' });
            }
            const localQs = candidates.map((c) => c.q);
            const aiQueries = yield (0, deepseekRecommendations_1.generateMusicSeedsWithDeepSeek)(profile).catch(() => null);
            const merged = (0, deepseekRecommendations_1.mixQueries)(localQs, aiQueries, 20);
            if (aiQueries && aiQueries.length > 0) {
                const localLower = new Set(localQs.map((q) => q.toLowerCase()));
                const aiOnly = aiQueries.filter((q) => !localLower.has(q.toLowerCase())).slice(0, 3);
                if (aiOnly.length > 0) {
                    const insertAt = rawSeed ? 1 : 0;
                    candidates.splice(insertAt, 0, ...aiOnly.map((q) => ({ q, source: 'personalized' })));
                }
            }
            const seenQ = new Set();
            candidates = candidates.filter((c) => {
                const key = c.q.toLowerCase();
                if (seenQ.has(key))
                    return false;
                seenQ.add(key);
                return merged.includes(c.q);
            });
            const profileForHash = Object.assign(Object.assign({}, profile), { recentSearches: [
                    ...(rawSeed ? [rawSeed] : []),
                    ...(positiveSeeds || []),
                    ...Array.from(blockedArtists).map((a) => `!a:${a}`),
                    ...Array.from(blockedTrackKeys).map((t) => `!t:${t}`),
                    ...((profile === null || profile === void 0 ? void 0 : profile.recentSearches) || []),
                ].slice(0, 30) });
            profileHash = (0, deepseekRecommendations_1.computeMusicProfileHash)(profileForHash);
        }
        let cacheHit = false;
        const excludeYtIds = new Set();
        const excludeTitleKeys = new Set();
        const excludeTitleArtistKeys = new Set();
        const excludeAudioKeys = new Set();
        for (const t of recentTracks)
            excludeTitleKeys.add(normalizeKey(t));
        for (const t of likedTracks)
            excludeTitleKeys.add(normalizeKey(t));
        if (uid && !refresh) {
            try {
                const seen = yield (0, recommendationStore_1.getUserRecentlySeenTrackKeys)({ uid, withinHours: getSeenTtlHours() });
                for (const k of seen.keys)
                    excludeYtIds.add(String(k).replace(/^yt:/, '').replace(/^local:/, ''));
                for (const k of seen.titleKeys)
                    excludeTitleKeys.add(String(k));
                for (const k of seen.titleArtistKeys)
                    excludeTitleArtistKeys.add(String(k));
            }
            catch (error) {
                console.warn('[music/for-you] failed to read seen tracks', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
            }
        }
        if (uid && profileHash && !refresh) {
            try {
                const cached = yield (0, recommendationStore_1.getUserRecommendationCache)({ uid, endpoint: 'for-you', profileHash });
                if (cached) {
                    const cachedItems = Array.isArray(cached.items) ? cached.items : cached.items;
                    const list = Array.isArray(cachedItems) ? cachedItems : [];
                    const filtered = dedupeAndFilterItems(list, {
                        ytIds: excludeYtIds,
                        titleKeys: excludeTitleKeys,
                        titleArtistKeys: excludeTitleArtistKeys,
                        audioKeys: excludeAudioKeys,
                        blockedTrackKeys,
                        blockedArtists,
                    });
                    if (filtered.items.length >= 10) {
                        cacheHit = true;
                        const response = {
                            items: filtered.items.slice(0, 30),
                            source: 'cache',
                        };
                        if (isDev()) {
                            response.debug = {
                                source: response.source,
                                profileHash,
                                queries: cached.queries || [],
                                blockedArtistsCount: blockedArtists.size,
                                blockedTracksCount: blockedTrackKeys.size,
                                positiveSeeds: positiveSeeds.slice(0, 8),
                                dedupedCount: filtered.dedupedCount,
                                skippedDuplicates: filtered.skippedDuplicates,
                                cacheHit: true,
                            };
                        }
                        console.log(`[music/for-you] reqId=${reqId} uid=${uid ? 'yes' : 'no'} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} cacheHit=true ms=${Date.now() - startedAt}`);
                        return res.json(response);
                    }
                }
            }
            catch (error) {
                console.warn('[music/for-you] cache read failed', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
            }
        }
        if (!uid) {
            for (const t of defaultForYouTerms)
                candidates.push({ q: t, source: 'default-search' });
        }
        let ytResults = [];
        let usedSource = 'empty';
        let usedQuery = '';
        const attemptedQueries = [];
        let attempts = 0;
        for (const c of candidates) {
            if (attempts >= 3)
                break;
            attempts++;
            attemptedQueries.push(c.q);
            usedQuery = c.q;
            const external = yield runExternalSearch(c.q);
            ytResults = external.items;
            if (ytResults.length > 0) {
                usedSource = external.provider === 'worker' ? 'worker' : c.source;
                break;
            }
        }
        if (ytResults.length > 0) {
            void (0, recommendationStore_1.upsertGlobalCatalogTracks)(ytResults.slice(0, 30), 1).catch(() => { });
        }
        const combinedMap = new Map();
        for (const r of shuffledLocal) {
            const key = `${normalizeText(r.title)}::${normalizeText(r.uploader)}`;
            combinedMap.set(key, Object.assign(Object.assign({}, r), { artist: r.uploader, duration_seconds: r.duration, thumbnail_url: r.thumbnail, source: 'local' }));
        }
        for (const r of ytResults.slice(0, 30)) {
            const key = `${normalizeText(r.title)}::${normalizeText(r.artist)}`;
            if (!combinedMap.has(key))
                combinedMap.set(key, r);
        }
        let items = Array.from(combinedMap.values()).sort(() => Math.random() - 0.5).slice(0, 30);
        const filtered = dedupeAndFilterItems(items, {
            ytIds: excludeYtIds,
            titleKeys: excludeTitleKeys,
            titleArtistKeys: excludeTitleArtistKeys,
            audioKeys: excludeAudioKeys,
            blockedTrackKeys,
            blockedArtists,
        });
        items = filtered.items;
        if (items.length === 0 && shuffledLocal.length > 0) {
            usedSource = 'downloads';
            items = shuffledLocal.map((r) => (Object.assign(Object.assign({}, r), { artist: r.uploader, duration_seconds: r.duration, thumbnail_url: r.thumbnail, source: 'local' })));
        }
        const healed = yield Promise.all(items.map((r) => __awaiter(void 0, void 0, void 0, function* () {
            if ((r === null || r === void 0 ? void 0 : r.source) !== 'local')
                return r;
            try {
                return yield withTimeout(healDownloadRow(r), 3500);
            }
            catch (_a) {
                void healDownloadRow(r).catch(() => { });
                return r;
            }
        })));
        let finalHealed = healed;
        let finalSource = healed.length > 0 ? usedSource : 'empty';
        if (finalHealed.length < 12) {
            try {
                const extra = yield (0, recommendationStore_1.getGlobalCatalogRecommendations)({
                    limit: 30,
                    excludeYoutubeIds: new Set([...excludeYtIds, ...finalHealed.map((i) => getItemYoutubeId(i)).filter(Boolean)]),
                });
                const merged = dedupeAndFilterItems([...finalHealed, ...extra], {
                    ytIds: excludeYtIds,
                    titleKeys: excludeTitleKeys,
                    titleArtistKeys: excludeTitleArtistKeys,
                    audioKeys: excludeAudioKeys,
                    blockedTrackKeys,
                    blockedArtists,
                });
                finalHealed = merged.items.slice(0, 30);
                if (finalHealed.length > 0 && finalSource === 'empty')
                    finalSource = 'default-search';
            }
            catch (_j) { }
        }
        if (finalHealed.length === 0) {
            console.log('[home] empty-profile using fallback fetch');
            const fallbackQueries = [
                "latin pop official audio",
                "new music official audio",
                "reggaeton hits official audio",
                "anime music official audio",
                "pop music official audio"
            ];
            const randomQuery = fallbackQueries[Math.floor(Math.random() * fallbackQueries.length)];
            try {
                const fallbackRes = yield searchDuckDuckGoForYoutube(randomQuery, 25);
                finalHealed = adaptYouTubeRows(fallbackRes, new Set(), new Set());
                if (finalHealed.length > 0)
                    finalSource = 'fallback';
            }
            catch (err) {
                console.warn('[home] fallback search failed', err);
            }
        }
        if (finalHealed.length === 0) {
            console.log('[home/for-you] empty-profile using fallback fetch');
            const fallbackQueries = [
                "latin pop official audio",
                "new music official audio",
                "reggaeton hits official audio",
                "anime music official audio",
                "pop music official audio"
            ];
            const randomQuery = fallbackQueries[Math.floor(Math.random() * fallbackQueries.length)];
            try {
                const fallbackRes = yield searchDuckDuckGoForYoutube(randomQuery, 25);
                finalHealed = adaptYouTubeRows(fallbackRes, new Set(), new Set());
                if (finalHealed.length > 0)
                    finalSource = 'fallback';
            }
            catch (err) {
                console.warn('[home/for-you] fallback search failed', err);
            }
        }
        finalHealed = finalHealed
            .map(r => (Object.assign(Object.assign({}, r), { forYouScore: (0, trackQuality_1.rankForYouCandidate)(profile, r) })))
            .filter(r => r.forYouScore > -300)
            .sort((a, b) => b.forYouScore - a.forYouScore)
            .map(r => {
            const { forYouScore } = r, rest = __rest(r, ["forYouScore"]);
            return rest;
        });
        const response = {
            items: finalHealed,
            source: finalHealed.length > 0 ? finalSource : 'empty',
        };
        if (isDev()) {
            response.debug = {
                source: response.source,
                profileHash: profileHash || null,
                queries: attemptedQueries,
                blockedArtistsCount: blockedArtists.size,
                blockedTracksCount: blockedTrackKeys.size,
                positiveSeeds: positiveSeeds.slice(0, 8),
                dedupedCount: filtered.dedupedCount,
                skippedDuplicates: filtered.skippedDuplicates,
                cacheHit,
            };
        }
        console.log('[recommendations] blocked', {
            reqId,
            uid: uid ? 'yes' : 'no',
            blockedArtistsCount: blockedArtists.size,
            blockedTracksCount: blockedTrackKeys.size,
            blockedArtists: Array.from(blockedArtists).slice(0, 6),
        });
        console.log('[recommendations] positiveSeeds', {
            reqId,
            uid: uid ? 'yes' : 'no',
            positiveSeeds: (positiveSeeds || []).slice(0, 8),
        });
        console.log('[recommendations] finalItems', {
            reqId,
            uid: uid ? 'yes' : 'no',
            source: response.source,
            items: response.items.length,
            cacheHit,
        });
        console.log(`[music/for-you] reqId=${reqId} uid=${uid ? 'yes' : 'no'} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} beforeDedupe=${healed.length} afterDedupe=${response.items.length} cacheHit=${cacheHit} q="${truncate(usedQuery)}" ms=${Date.now() - startedAt}`);
        if (uid && profileHash) {
            void (0, recommendationStore_1.saveUserRecommendationCache)({
                uid,
                endpoint: 'for-you',
                profileHash,
                queries: attemptedQueries,
                items: response.items,
                source: String(response.source),
                ttlMs: 15 * 60 * 1000,
            }).catch(() => { });
        }
        res.json(response);
    }
    catch (error) {
        console.error('[music/for-you] error', { reqId, error: serializeError(error) });
        try {
            const fallback = yield searchDuckDuckGoForYoutube('bad bunny official audio', 25);
            const rows = adaptYouTubeRows(fallback, new Set(), new Set());
            const response = { items: rows.slice(0, 30), source: rows.length > 0 ? 'default-search' : 'empty' };
            console.log(`[music/for-you] reqId=${reqId} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
            return res.json(response);
        }
        catch (_k) {
            const response = { items: [], source: 'empty' };
            console.log(`[music/for-you] reqId=${reqId} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
            res.json(response);
        }
    }
})));
const recommendationsHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const reqId = makeReqId();
    const { seed, exclude } = req.query;
    const uid = String(((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.uid) || '').trim();
    const refresh = String(((_b = req.query) === null || _b === void 0 ? void 0 : _b.refresh) || '').trim() === '1' || String(((_c = req.query) === null || _c === void 0 ? void 0 : _c.refresh) || '').trim().toLowerCase() === 'true';
    const excludedIds = new Set(typeof exclude === 'string' && exclude.trim()
        ? exclude.split(',').map(s => s.trim()).filter(Boolean)
        : []);
    const startedAt = Date.now();
    const defaultDiscoverTerms = [
        'new music',
        'latin hits',
        'anime music',
        'trending music',
        'pop latino',
        'openings anime',
    ];
    try {
        const rawSeed = typeof seed === 'string' ? seed.replace(/similar music recommended/gi, '').trim() : '';
        const baseQuery = rawSeed ? `${rawSeed} audio` : '';
        // Obtener ids que ya están en local y sus datos
        const localResult = yield db_1.default.query('SELECT id, youtube_id, title, uploader, duration, thumbnail, url, created_at FROM Downloads WHERE youtube_id IS NOT NULL ORDER BY created_at DESC LIMIT 2000');
        const localIds = new Set(localResult.rows.map((r) => r.youtube_id));
        const localMap = new Map();
        localResult.rows.forEach((r) => {
            if (r.youtube_id)
                localMap.set(r.youtube_id, r);
        });
        const localKeys = new Set();
        const localQueries = [];
        if (baseQuery)
            localQueries.push(baseQuery);
        for (const t of defaultDiscoverTerms)
            localQueries.push(t);
        const recentTracks = [];
        const likedTracks = [];
        const recentSearches = [];
        const artistPool = [];
        let currentTrack = null;
        let profile = null;
        let profileHash = '';
        let cacheHit = false;
        const attemptedQueries = [];
        let positiveSeeds = [];
        const blockedTrackKeys = new Set();
        const blockedArtists = new Set();
        const excludeYtIds = new Set();
        const excludeTitleKeys = new Set();
        const excludeTitleArtistKeys = new Set();
        const excludeAudioKeys = new Set();
        for (const ex of excludedIds) {
            if (!ex)
                continue;
            excludeYtIds.add(ex);
            excludeTitleKeys.add(normalizeKey(ex));
        }
        let queries = localQueries;
        if (uid) {
            try {
                const blocked = yield (0, recommendationStore_1.getBlockedTrackKeys)(uid);
                for (const k of blocked.keys)
                    blockedTrackKeys.add(String(k));
                for (const yt of blocked.ytIds)
                    blockedTrackKeys.add(`yt:${String(yt)}`);
            }
            catch (_e) { }
            try {
                const artists = yield (0, recommendationStore_1.getBlockedArtists)(uid);
                for (const a of artists)
                    blockedArtists.add(String(a));
            }
            catch (_f) { }
            try {
                positiveSeeds = yield (0, recommendationStore_1.getPositiveSeeds)(uid, 12);
            }
            catch (_g) { }
            try {
                const recentsSnap = yield firebase_1.admin
                    .firestore()
                    .collection('users')
                    .doc(uid)
                    .collection('recents')
                    .orderBy('played_at', 'desc')
                    .limit(12)
                    .get();
                const recents = recentsSnap.docs.map((d) => d.data());
                for (const r of recents) {
                    const t = String((r === null || r === void 0 ? void 0 : r.title) || '').trim();
                    const a = String((r === null || r === void 0 ? void 0 : r.artist) || '').trim();
                    const yt = String((r === null || r === void 0 ? void 0 : r.youtube_id) || (r === null || r === void 0 ? void 0 : r.song_id) || '').trim();
                    if (t)
                        recentTracks.push(t);
                    if (yt)
                        excludeYtIds.add(yt);
                    if (t)
                        excludeTitleKeys.add(normalizeKey(t));
                    if (a && t)
                        excludeTitleArtistKeys.add(`${normalizeKey(a)}::${normalizeKey(t)}`);
                    if (a && a !== 'Internet' && a !== 'Desconocido' && a !== 'YouTube')
                        artistPool.push(a);
                }
                const top = recents[0];
                const t0 = String((top === null || top === void 0 ? void 0 : top.title) || '').trim();
                const a0 = String((top === null || top === void 0 ? void 0 : top.artist) || '').trim();
                currentTrack = t0 || a0 ? { title: t0, artist: a0 } : null;
            }
            catch (error) {
                console.warn('[music/recommendations] failed to read recents', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
            }
            try {
                const likesSnap = yield firebase_1.admin
                    .firestore()
                    .collection('users')
                    .doc(uid)
                    .collection('likes')
                    .limit(12)
                    .get();
                const likes = likesSnap.docs.map((d) => d.data());
                for (const r of likes) {
                    const t = String((r === null || r === void 0 ? void 0 : r.title) || '').trim();
                    const a = String((r === null || r === void 0 ? void 0 : r.artist) || '').trim();
                    const yt = String((r === null || r === void 0 ? void 0 : r.youtube_id) || (r === null || r === void 0 ? void 0 : r.song_id) || '').trim();
                    if (t)
                        likedTracks.push(t);
                    if (yt)
                        excludeYtIds.add(yt);
                    if (t)
                        excludeTitleKeys.add(normalizeKey(t));
                    if (a && t)
                        excludeTitleArtistKeys.add(`${normalizeKey(a)}::${normalizeKey(t)}`);
                    if (a && a !== 'Internet' && a !== 'Desconocido' && a !== 'YouTube')
                        artistPool.push(a);
                }
            }
            catch (error) {
                console.warn('[music/recommendations] failed to read likes', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
            }
            try {
                const searchesSnap = yield firebase_1.admin
                    .firestore()
                    .collection('users')
                    .doc(uid)
                    .collection('searches')
                    .orderBy('last_used_at', 'desc')
                    .limit(10)
                    .get();
                for (const d of searchesSnap.docs) {
                    const q = String(((_d = d.data()) === null || _d === void 0 ? void 0 : _d.query) || '').trim();
                    if (q)
                        recentSearches.push(q);
                }
            }
            catch (error) {
                console.warn('[music/recommendations] failed to read searches', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
            }
            if (!refresh) {
                try {
                    const seen = yield (0, recommendationStore_1.getUserRecentlySeenTrackKeys)({ uid, withinHours: getSeenTtlHours() });
                    for (const k of seen.keys)
                        excludeYtIds.add(String(k).replace(/^yt:/, '').replace(/^local:/, ''));
                    for (const k of seen.titleKeys)
                        excludeTitleKeys.add(String(k));
                    for (const k of seen.titleArtistKeys)
                        excludeTitleArtistKeys.add(String(k));
                }
                catch (error) {
                    console.warn('[music/recommendations] failed to read seen tracks', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
                }
            }
            const counts = new Map();
            for (const a of artistPool)
                counts.set(a, (counts.get(a) || 0) + 1);
            const topArtists = Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([name]) => name)
                .slice(0, 6);
            const profileObj = {
                userId: uid,
                topArtists,
                topGenres: [],
                recentTracks: recentTracks.slice(0, 10),
                likedTracks: likedTracks.slice(0, 10),
                recentSearches: recentSearches.slice(0, 10),
                currentTrack,
                preferredLanguage: 'es',
            };
            profile = profileObj;
            const profileForHash = Object.assign(Object.assign({}, profileObj), { recentSearches: [
                    ...(rawSeed ? [rawSeed] : []),
                    ...(positiveSeeds || []),
                    ...Array.from(blockedArtists).map((a) => `!a:${a}`),
                    ...Array.from(blockedTrackKeys).map((t) => `!t:${t}`),
                    ...(profileObj.recentSearches || []),
                ].slice(0, 30) });
            profileHash = (0, deepseekRecommendations_1.computeMusicProfileHash)(profileForHash);
            if (!refresh) {
                try {
                    const cached = yield (0, recommendationStore_1.getUserRecommendationCache)({ uid, endpoint: 'recommendations', profileHash });
                    if (cached) {
                        const cachedItems = Array.isArray(cached.items) ? cached.items : cached.items;
                        const list = Array.isArray(cachedItems) ? cachedItems : [];
                        const filtered = dedupeAndFilterItems(list, {
                            ytIds: excludeYtIds,
                            titleKeys: excludeTitleKeys,
                            titleArtistKeys: excludeTitleArtistKeys,
                            audioKeys: excludeAudioKeys,
                            blockedTrackKeys,
                            blockedArtists,
                        });
                        if (filtered.items.length >= 10) {
                            cacheHit = true;
                            const response = {
                                items: filtered.items.slice(0, 30),
                                source: 'cache',
                            };
                            if (isDev()) {
                                response.debug = {
                                    source: response.source,
                                    profileHash,
                                    queries: cached.queries || [],
                                    blockedArtistsCount: blockedArtists.size,
                                    blockedTracksCount: blockedTrackKeys.size,
                                    positiveSeeds: positiveSeeds.slice(0, 8),
                                    dedupedCount: filtered.dedupedCount,
                                    skippedDuplicates: filtered.skippedDuplicates,
                                    cacheHit: true,
                                };
                            }
                            console.log(`[music/recommendations] reqId=${reqId} uid=${uid ? 'yes' : 'no'} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} cacheHit=true ms=${Date.now() - startedAt}`);
                            return res.json(response);
                        }
                    }
                }
                catch (error) {
                    console.warn('[music/recommendations] cache read failed', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
                }
            }
            const aiQueries = yield (0, deepseekRecommendations_1.generateMusicSeedsWithDeepSeek)(profile).catch(() => null);
            const localPlus = positiveSeeds.length > 0 ? [...positiveSeeds.slice(0, 3), ...localQueries] : localQueries;
            queries = (0, deepseekRecommendations_1.mixQueries)(localPlus, aiQueries, 3);
        }
        else {
            queries = localQueries.slice(0, 3);
        }
        const collected = [];
        const seen = new Set();
        let hadConvertResults = false;
        let hadWorkerResults = false;
        for (const q of queries) {
            if (collected.length >= 15)
                break;
            attemptedQueries.push(q);
            let batch = [];
            const failures = [];
            try {
                for (const pyUrl of downloaderUrls) {
                    try {
                        console.log('[convert/search]', { reqId, url: pyUrl, timeoutMs: convertTimeoutMs, q: truncate(q, 90) });
                        const response = yield axios_1.default.get(`${pyUrl}/search`, {
                            timeout: convertTimeoutMs,
                            params: { q, limit: 30 },
                        });
                        const data = response.data;
                        if (Array.isArray(data)) {
                            batch = adaptYouTubeRows(data, localKeys, localIds, localMap);
                            if (batch.length > 0) {
                                hadConvertResults = true;
                                console.log('[convert/search] ok', { reqId, url: pyUrl, items: batch.length });
                                break;
                            }
                        }
                    }
                    catch (error) {
                        console.warn('[convert/search] failed', Object.assign({ reqId, url: pyUrl }, serializeError(error)));
                        failures.push(Object.assign({ url: pyUrl }, serializeError(error)));
                        continue;
                    }
                }
            }
            catch (_h) { }
            if (batch.length === 0) {
                const health = yield (0, mediaWorkerClient_1.workerHealth)();
                if (health.ok) {
                    console.log('[worker/search] fallback', { reqId, q: truncate(q, 90) });
                    const workerRes = yield (0, mediaWorkerClient_1.searchWithWorker)(q, 35);
                    const workerItems = (workerRes === null || workerRes === void 0 ? void 0 : workerRes.items) || [];
                    if (workerItems.length > 0) {
                        const mapped = workerItems.map((w) => {
                            const sourceId = String(w.sourceId || '').trim() || String(w.id || '').split(':').pop() || '';
                            return {
                                id: sourceId,
                                youtube_id: sourceId,
                                title: w.title,
                                uploader: w.artist || w.uploader || 'Internet',
                                duration_seconds: w.duration || 0,
                                thumbnail_url: w.coverUrl || w.thumbnail_url,
                                url: w.url || `https://www.youtube.com/watch?v=${sourceId}`,
                            };
                        });
                        batch = adaptYouTubeRows(mapped, localKeys, localIds, localMap);
                        if (batch.length > 0) {
                            hadWorkerResults = true;
                            console.log('[worker/search] items', { reqId, items: batch.length });
                        }
                    }
                }
                else if ((0, mediaWorkerClient_1.isWorkerEnabled)()) {
                    console.warn('[worker/search] skipped (unhealthy)', { reqId, status: health.status });
                }
                if (batch.length === 0) {
                    try {
                        const duckRows = yield searchDuckDuckGoForYoutube(q, 25);
                        batch = adaptYouTubeRows(duckRows, localKeys, localIds, localMap);
                    }
                    catch (error) {
                        failures.push(Object.assign({ url: 'duckduckgo' }, serializeError(error)));
                    }
                }
            }
            if (batch.length === 0 && failures.length > 0) {
                console.warn('[music/recommendations] external search failed', {
                    reqId,
                    q: truncate(q),
                    failures,
                });
            }
            for (const r of batch) {
                const ytId = String(r.youtube_id || r.id || '').trim();
                if (!ytId || seen.has(ytId))
                    continue;
                seen.add(ytId);
                collected.push(r);
                if (collected.length >= 20)
                    break;
            }
        }
        let ytResults = collected;
        if (excludedIds.size > 0) {
            ytResults = ytResults.filter((r) => {
                const ytId = r.youtube_id || r.id;
                return !excludedIds.has(String(ytId)) && !excludedIds.has(normalizeText(r.title));
            });
        }
        const filtered = dedupeAndFilterItems(ytResults, {
            ytIds: excludeYtIds,
            titleKeys: excludeTitleKeys,
            titleArtistKeys: excludeTitleArtistKeys,
            audioKeys: excludeAudioKeys,
            blockedTrackKeys,
            blockedArtists,
        });
        ytResults = filtered.items;
        if (ytResults.length > 0) {
            void (0, recommendationStore_1.upsertGlobalCatalogTracks)(ytResults.slice(0, 30), 1).catch(() => { });
        }
        let finalList = ytResults.slice(0, 30);
        let usedSource = !hadConvertResults && hadWorkerResults ? 'worker' : rawSeed ? 'personalized' : 'default-search';
        if (finalList.length < 12) {
            try {
                const extra = yield (0, recommendationStore_1.getGlobalCatalogRecommendations)({
                    limit: 30,
                    excludeYoutubeIds: new Set([...excludeYtIds, ...finalList.map((i) => getItemYoutubeId(i)).filter(Boolean)]),
                });
                const merged = dedupeAndFilterItems([...finalList, ...extra], {
                    ytIds: excludeYtIds,
                    titleKeys: excludeTitleKeys,
                    titleArtistKeys: excludeTitleArtistKeys,
                    audioKeys: excludeAudioKeys,
                    blockedTrackKeys,
                    blockedArtists,
                });
                finalList = merged.items.slice(0, 30);
                if (ytResults.length === 0 && extra.length > 0)
                    usedSource = 'global';
            }
            catch (_j) { }
        }
        if (finalList.length === 0) {
            try {
                const extra = yield (0, recommendationStore_1.getGlobalCatalogRecommendations)({ limit: 30, excludeYoutubeIds: excludeYtIds });
                if (extra.length > 0) {
                    const response = { items: extra.slice(0, 30), source: 'global' };
                    if (isDev()) {
                        response.debug = {
                            source: response.source,
                            profileHash: profileHash || null,
                            queries: attemptedQueries,
                            blockedArtistsCount: blockedArtists.size,
                            blockedTracksCount: blockedTrackKeys.size,
                            positiveSeeds: positiveSeeds.slice(0, 8),
                            dedupedCount: filtered.dedupedCount,
                            skippedDuplicates: filtered.skippedDuplicates,
                            cacheHit,
                        };
                    }
                    console.log('[recommendations] blocked', {
                        reqId,
                        uid: uid ? 'yes' : 'no',
                        blockedArtistsCount: blockedArtists.size,
                        blockedTracksCount: blockedTrackKeys.size,
                        blockedArtists: Array.from(blockedArtists).slice(0, 6),
                    });
                    console.log('[recommendations] positiveSeeds', {
                        reqId,
                        uid: uid ? 'yes' : 'no',
                        positiveSeeds: (positiveSeeds || []).slice(0, 8),
                    });
                    console.log('[recommendations] finalItems', {
                        reqId,
                        uid: uid ? 'yes' : 'no',
                        source: response.source,
                        items: response.items.length,
                        cacheHit,
                    });
                    console.log(`[music/recommendations] reqId=${reqId} uid=${uid ? 'yes' : 'no'} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} beforeDedupe=${ytResults.length} afterDedupe=${response.items.length} cacheHit=${cacheHit} ms=${Date.now() - startedAt}`);
                    if (uid && profileHash) {
                        void (0, recommendationStore_1.saveUserRecommendationCache)({
                            uid,
                            endpoint: 'recommendations',
                            profileHash,
                            queries: attemptedQueries,
                            items: response.items,
                            source: String(response.source),
                            ttlMs: 15 * 60 * 1000,
                        }).catch(() => { });
                    }
                    return res.json(response);
                }
            }
            catch (_k) { }
            const local = yield db_1.default.query('SELECT id, title, uploader, duration, thumbnail, url, youtube_id, created_at FROM Downloads ORDER BY created_at DESC LIMIT 20');
            const localItems = local.rows
                .filter((r) => !isNonMusicTitle(r.title, r.uploader))
                .slice(0, 15)
                .map((r) => (Object.assign(Object.assign({}, r), { artist: r.uploader, duration_seconds: r.duration, thumbnail_url: r.thumbnail, source: 'local' })));
            const localFiltered = dedupeAndFilterItems(localItems, {
                ytIds: excludeYtIds,
                titleKeys: excludeTitleKeys,
                titleArtistKeys: excludeTitleArtistKeys,
                audioKeys: excludeAudioKeys,
                blockedTrackKeys,
                blockedArtists,
            });
            if (localFiltered.items.length > 0) {
                const response = {
                    items: localFiltered.items.slice(0, 30),
                    source: 'downloads',
                };
                if (isDev()) {
                    response.debug = {
                        source: response.source,
                        profileHash: profileHash || null,
                        queries: attemptedQueries,
                        blockedArtistsCount: blockedArtists.size,
                        blockedTracksCount: blockedTrackKeys.size,
                        positiveSeeds: positiveSeeds.slice(0, 8),
                        dedupedCount: localFiltered.dedupedCount,
                        skippedDuplicates: localFiltered.skippedDuplicates,
                        cacheHit,
                    };
                }
                console.log(`[music/recommendations] reqId=${reqId} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
                if (uid && profileHash) {
                    void (0, recommendationStore_1.saveUserRecommendationCache)({
                        uid,
                        endpoint: 'recommendations',
                        profileHash,
                        queries: attemptedQueries,
                        items: response.items,
                        source: String(response.source),
                        ttlMs: 15 * 60 * 1000,
                    }).catch(() => { });
                }
                return res.json(response);
            }
            const health = yield (0, mediaWorkerClient_1.workerHealth)();
            if (health.ok) {
                const workerRes = yield (0, mediaWorkerClient_1.searchWithWorker)(rawSeed || defaultDiscoverTerms[0], 35);
                const workerItems = (workerRes === null || workerRes === void 0 ? void 0 : workerRes.items) || [];
                if (workerItems.length > 0) {
                    const mapped = workerItems.map((w) => {
                        const sourceId = String(w.sourceId || '').trim() || String(w.id || '').split(':').pop() || '';
                        return {
                            id: sourceId,
                            youtube_id: sourceId,
                            title: w.title,
                            artist: w.artist || w.uploader || 'Internet',
                            uploader: w.artist || w.uploader || 'Internet',
                            duration_seconds: w.duration || 0,
                            thumbnail_url: w.coverUrl || w.thumbnail_url,
                            url: w.url || `https://www.youtube.com/watch?v=${sourceId}`,
                            source: 'youtube',
                        };
                    });
                    const workerFiltered = dedupeAndFilterItems(mapped, {
                        ytIds: excludeYtIds,
                        titleKeys: excludeTitleKeys,
                        titleArtistKeys: excludeTitleArtistKeys,
                        audioKeys: excludeAudioKeys,
                        blockedTrackKeys,
                        blockedArtists,
                    });
                    const response = { items: workerFiltered.items.slice(0, 30), source: 'worker' };
                    if (isDev()) {
                        response.debug = {
                            source: response.source,
                            profileHash: profileHash || null,
                            queries: attemptedQueries,
                            blockedArtistsCount: blockedArtists.size,
                            blockedTracksCount: blockedTrackKeys.size,
                            positiveSeeds: positiveSeeds.slice(0, 8),
                            dedupedCount: workerFiltered.dedupedCount,
                            skippedDuplicates: workerFiltered.skippedDuplicates,
                            cacheHit,
                        };
                    }
                    console.log(`[music/recommendations] reqId=${reqId} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
                    if (uid && profileHash) {
                        void (0, recommendationStore_1.saveUserRecommendationCache)({
                            uid,
                            endpoint: 'recommendations',
                            profileHash,
                            queries: attemptedQueries,
                            items: response.items,
                            source: String(response.source),
                            ttlMs: 15 * 60 * 1000,
                        }).catch(() => { });
                    }
                    void (0, recommendationStore_1.upsertGlobalCatalogTracks)(response.items.slice(0, 30), 1).catch(() => { });
                    return res.json(response);
                }
            }
            else if ((0, mediaWorkerClient_1.isWorkerEnabled)()) {
                console.warn('[worker/search] skipped (unhealthy)', { reqId, status: health.status });
            }
            const response = { items: [], source: 'empty' };
            if (isDev()) {
                response.debug = {
                    source: response.source,
                    profileHash: profileHash || null,
                    queries: attemptedQueries,
                    blockedArtistsCount: blockedArtists.size,
                    blockedTracksCount: blockedTrackKeys.size,
                    positiveSeeds: positiveSeeds.slice(0, 8),
                    dedupedCount: 0,
                    skippedDuplicates: 0,
                    cacheHit,
                };
            }
            console.log('[recommendations] blocked', {
                reqId,
                uid: uid ? 'yes' : 'no',
                blockedArtistsCount: blockedArtists.size,
                blockedTracksCount: blockedTrackKeys.size,
                blockedArtists: Array.from(blockedArtists).slice(0, 6),
            });
            console.log('[recommendations] positiveSeeds', {
                reqId,
                uid: uid ? 'yes' : 'no',
                positiveSeeds: (positiveSeeds || []).slice(0, 8),
            });
            console.log('[recommendations] finalItems', {
                reqId,
                uid: uid ? 'yes' : 'no',
                source: response.source,
                items: response.items.length,
                cacheHit,
            });
            console.log(`[music/recommendations] reqId=${reqId} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
            return res.json(response);
        }
        const response = {
            items: (0, recommendationRanking_1.rankRecommendationResults)({ seed: rawSeed, items: finalList, profile }),
            source: usedSource,
        };
        if (isDev()) {
            response.debug = {
                source: response.source,
                profileHash: profileHash || null,
                queries: attemptedQueries,
                blockedArtistsCount: blockedArtists.size,
                blockedTracksCount: blockedTrackKeys.size,
                positiveSeeds: positiveSeeds.slice(0, 8),
                dedupedCount: filtered.dedupedCount,
                skippedDuplicates: filtered.skippedDuplicates,
                cacheHit,
            };
        }
        console.log('[recommendations] blocked', {
            reqId,
            uid: uid ? 'yes' : 'no',
            blockedArtistsCount: blockedArtists.size,
            blockedTracksCount: blockedTrackKeys.size,
            blockedArtists: Array.from(blockedArtists).slice(0, 6),
        });
        console.log('[recommendations] positiveSeeds', {
            reqId,
            uid: uid ? 'yes' : 'no',
            positiveSeeds: (positiveSeeds || []).slice(0, 8),
        });
        console.log('[recommendations] finalItems', {
            reqId,
            uid: uid ? 'yes' : 'no',
            source: response.source,
            items: response.items.length,
            cacheHit,
        });
        console.log(`[music/recommendations] reqId=${reqId} uid=${uid ? 'yes' : 'no'} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} beforeDedupe=${collected.length} afterDedupe=${response.items.length} cacheHit=${cacheHit} ms=${Date.now() - startedAt}`);
        if (uid && profileHash) {
            void (0, recommendationStore_1.saveUserRecommendationCache)({
                uid,
                endpoint: 'recommendations',
                profileHash,
                queries: attemptedQueries,
                items: response.items,
                source: String(response.source),
                ttlMs: 15 * 60 * 1000,
            }).catch(() => { });
        }
        res.json(response);
    }
    catch (error) {
        console.error('[music/recommendations] error', { reqId, error: serializeError(error) });
        try {
            const duckRows = yield searchDuckDuckGoForYoutube('latin hits', 25);
            const fallback = adaptYouTubeRows(duckRows, new Set(), new Set());
            if (fallback.length > 0) {
                const response = { items: fallback.slice(0, 30), source: 'default-search' };
                console.log(`[music/recommendations] reqId=${reqId} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
                return res.json(response);
            }
            const local = yield db_1.default.query('SELECT id, title, uploader, duration, thumbnail, url, youtube_id, created_at FROM Downloads ORDER BY RANDOM() LIMIT 15');
            const localItems = local.rows.map((r) => (Object.assign(Object.assign({}, r), { artist: r.uploader, duration_seconds: r.duration, thumbnail_url: r.thumbnail, source: 'local' })));
            const response = { items: localItems, source: localItems.length > 0 ? 'downloads' : 'empty' };
            console.log(`[music/recommendations] reqId=${reqId} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
            res.json(response);
        }
        catch (_l) {
            const response = { items: [], source: 'empty' };
            console.log(`[music/recommendations] reqId=${reqId} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
            res.json(response);
        }
    }
});
router.get('/recommendations', (0, utils_1.asyncHandler)(recommendationsHandler));
router.post('/radio', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = readBodyAsJson(req);
    const currentTrack = (body === null || body === void 0 ? void 0 : body.currentTrack) || null;
    const queue = Array.isArray(body === null || body === void 0 ? void 0 : body.queue) ? body === null || body === void 0 ? void 0 : body.queue : [];
    const exclude = Array.isArray(body === null || body === void 0 ? void 0 : body.exclude) ? body === null || body === void 0 ? void 0 : body.exclude : [];
    const title = String((currentTrack === null || currentTrack === void 0 ? void 0 : currentTrack.title) || '').trim();
    const artist = String((currentTrack === null || currentTrack === void 0 ? void 0 : currentTrack.artist) || (currentTrack === null || currentTrack === void 0 ? void 0 : currentTrack.uploader) || '').trim();
    const seed = artist && title ? `${artist} ${title}` : title || artist;
    const excludedIds = new Set();
    for (const it of [...queue, ...exclude]) {
        const id = String((it === null || it === void 0 ? void 0 : it.youtube_id) || (it === null || it === void 0 ? void 0 : it.sourceId) || (it === null || it === void 0 ? void 0 : it.id) || '').trim();
        if (id)
            excludedIds.add(id);
    }
    req.query = Object.assign(Object.assign({}, req.query), { seed, exclude: Array.from(excludedIds).slice(0, 200).join(','), mode: 'radio' });
    return recommendationsHandler(req, res);
})));
router.get('/lyrics', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const title = req.query.title;
    const artist = req.query.artist;
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    try {
        // Usamos la API pública de lrclib.net (no requiere token)
        const apiUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}${artist && artist !== 'Desconocido' && artist !== 'YouTube' ? `&artist_name=${encodeURIComponent(artist)}` : ''}`;
        const response = yield axios_1.default.get(apiUrl, { timeout: 5000 });
        if (response.data && (response.data.syncedLyrics || response.data.plainLyrics)) {
            res.json({
                synced: response.data.syncedLyrics,
                plain: response.data.plainLyrics
            });
        }
        else {
            res.status(404).json({ error: 'Lyrics not found' });
        }
    }
    catch (error) {
        // Fallback: Si lrclib falla, intenta buscar sin el artista
        try {
            if (artist && artist !== 'Desconocido' && artist !== 'YouTube') {
                const fallbackUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}`;
                const fallbackRes = yield axios_1.default.get(fallbackUrl, { timeout: 3000 });
                if (fallbackRes.data && (fallbackRes.data.syncedLyrics || fallbackRes.data.plainLyrics)) {
                    return res.json({
                        synced: fallbackRes.data.syncedLyrics,
                        plain: fallbackRes.data.plainLyrics
                    });
                }
            }
            res.status(404).json({ error: 'Lyrics not found' });
        }
        catch (_a) {
            res.status(500).json({ error: 'Error fetching lyrics' });
        }
    }
})));
router.get('/worker-health', (0, utils_1.asyncHandler)((_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const health = yield (0, mediaWorkerClient_1.workerHealth)();
        res.json(Object.assign({ enabled: (0, mediaWorkerClient_1.isWorkerEnabled)() }, health));
    }
    catch (error) {
        console.error('[music/worker-health] error', (error === null || error === void 0 ? void 0 : error.message) || error);
        res.json({ enabled: (0, mediaWorkerClient_1.isWorkerEnabled)(), ok: false, status: 0 });
    }
})));
// ── Search: busca en Downloads (datos reales de la DB) y en YouTube ──
router.get('/search', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const reqId = makeReqId();
    const startedAt = Date.now();
    const rawQuery = String(req.query.q || '').trim();
    if (!rawQuery)
        return res.status(400).json({ error: 'Query parameter "q" is required.' });
    const nq = (0, searchRanking_1.normalizeSearchQuery)(rawQuery);
    if (!nq.normalized)
        return res.json({ items: [], source: 'search' });
    // ── Cache ──────────────────────────────────────────────────────────────────
    const cacheKey = `search:${nq.normalized}:${String(nq.wantsRemix)}:${String(nq.wantsSlowed)}`;
    const cached = getSearchCache(cacheKey);
    if (cached) {
        console.log('[search] cache-hit', { reqId, q: truncate(rawQuery, 90), ms: Date.now() - startedAt });
        return res.json(Object.assign(Object.assign({}, cached), { _cacheHit: true }));
    }
    const resultLimit = 20;
    const words = nq.tokens.length > 0 ? nq.tokens : rawQuery.split(/\s+/).filter(Boolean);
    const buildOrConditions = (fields, offset) => words
        .map((_, i) => `(${fields.map((f) => `${f} ILIKE $${offset + i}`).join(' OR ')})`)
        .join(' OR ');
    const localConditions = buildOrConditions(['title', "COALESCE(uploader, '')"], 1);
    const localParams = words.map((w) => `%${w}%`);
    // ── 1. Resultados locales (Downloads DB) ──────────────────────────────────
    let localRows = [];
    try {
        const localRes = yield db_1.default.query(`
        SELECT id, title, uploader, duration, thumbnail, url, youtube_id, mode, created_at
        FROM Downloads
        WHERE ${localConditions || '1=1'}
        ORDER BY created_at DESC
        LIMIT 80
      `, localParams);
        localRows = localRes.rows || [];
    }
    catch (_c) {
        localRows = [];
    }
    const inferYoutubeIdFromLocal = (row) => {
        const raw = String((row === null || row === void 0 ? void 0 : row.youtube_id) || '').trim();
        if (raw)
            return raw;
        const url = String((row === null || row === void 0 ? void 0 : row.url) || '').trim();
        if (!url)
            return '';
        if (/^https?:\/\//i.test(url))
            return extractYoutubeId(url) || '';
        try {
            const base = url.split(/[\/\\]/).pop() || '';
            const stem = base.replace(/\.[^.]+$/, '');
            if (/^[a-zA-Z0-9_-]{10,24}$/.test(stem))
                return stem;
        }
        catch (_a) { }
        return '';
    };
    const localResults = localRows.reduce((acc, row) => {
        const youtube_id = inferYoutubeIdFromLocal(row) || row.youtube_id;
        if (!youtube_id && row.url && typeof row.url === 'string' && row.url.includes('youtube_'))
            return acc; // Exclude broken local refs
        if (row.url && !/^https?:\/\//i.test(row.url)) {
            try {
                const fp = path_1.default.resolve(row.url);
                if (!fs_1.default.existsSync(fp) || fs_1.default.statSync(fp).size <= 0)
                    return acc; // Exclude missing files
            }
            catch (_a) {
                return acc;
            }
        }
        acc.push(Object.assign(Object.assign({}, row), { youtube_id, artist: row.uploader, duration_seconds: row.duration, thumbnail_url: row.thumbnail, source: 'local' }));
        return acc;
    }, []);
    const localKeys = new Set(localResults.map((loc) => `${(0, searchRanking_1.normalizeText)(loc.title)}::${(0, searchRanking_1.normalizeText)(loc.artist)}`));
    const localYoutubeIds = new Set(localResults.map((loc) => loc.youtube_id).filter(Boolean));
    // ── 2. Catálogo global (GlobalCatalogTracks) ─────────────────────────────
    let catalogResults = [];
    try {
        const catConditions = buildOrConditions(['title', "COALESCE(uploader, '')"], 1);
        const catParams = words.map((w) => `%${w}%`);
        const catRes = yield db_1.default.query(`
        SELECT youtube_id, title, uploader, duration, thumbnail, url, score
        FROM GlobalCatalogTracks
        WHERE ${catConditions || '1=1'}
        ORDER BY score DESC, updated_at DESC
        LIMIT 60
      `, catParams);
        catalogResults = (catRes.rows || []).map((r) => ({
            id: r.youtube_id,
            youtube_id: r.youtube_id,
            title: r.title,
            uploader: r.uploader || 'Internet',
            artist: r.uploader || 'Internet',
            duration_seconds: r.duration || 0,
            thumbnail_url: r.thumbnail || (r.youtube_id ? `https://i.ytimg.com/vi/${r.youtube_id}/hqdefault.jpg` : null),
            url: r.url || (r.youtube_id ? `https://www.youtube.com/watch?v=${r.youtube_id}` : null),
            source: 'youtube',
        }));
    }
    catch (_d) {
        catalogResults = [];
    }
    // Añadir catalog a los sets de IDs locales para evitar duplicados en adaptYouTubeRows
    for (const it of catalogResults) {
        localKeys.add(`${(0, searchRanking_1.normalizeText)(it.title)}::${(0, searchRanking_1.normalizeText)(it.artist)}`);
        if (it.youtube_id)
            localYoutubeIds.add(String(it.youtube_id));
    }
    // ── Helper: deduplicar pool de items por youtubeId antes de rankear ───────
    const dedupeByYoutubeId = (items) => {
        const seen = new Set();
        const seenTa = new Set();
        const out = [];
        for (const it of items) {
            const ytId = String((it === null || it === void 0 ? void 0 : it.youtube_id) || (it === null || it === void 0 ? void 0 : it.id) || '').trim();
            const titleN = (0, searchRanking_1.normalizeText)((it === null || it === void 0 ? void 0 : it.title) || '');
            const artistN = (0, searchRanking_1.normalizeText)((it === null || it === void 0 ? void 0 : it.artist) || (it === null || it === void 0 ? void 0 : it.uploader) || '');
            const taKey = titleN && artistN ? `${titleN}::${artistN}` : '';
            if (ytId && seen.has(ytId))
                continue;
            if (taKey && seenTa.has(taKey)) {
                // Si ya hay uno de la misma ta, solo permitir si es local (priorizar local)
                if ((it === null || it === void 0 ? void 0 : it.source) !== 'local')
                    continue;
            }
            if (ytId)
                seen.add(ytId);
            if (taKey)
                seenTa.add(taKey);
            out.push(it);
        }
        return out;
    };
    // ── 3. Búsqueda externa (Convert / Worker) ────────────────────────────────
    const searchViaConvertOrWorker = (q) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        for (const pyUrl of downloaderUrls) {
            try {
                console.log('[convert/search]', { reqId, url: pyUrl, timeoutMs: convertTimeoutMs, q: truncate(q, 90), limit: resultLimit });
                const response = yield axios_1.default.get(`${pyUrl}/search`, {
                    timeout: convertTimeoutMs,
                    params: { q, limit: resultLimit },
                });
                const data = response.data;
                if (Array.isArray(data) && data.length > 0) {
                    const items = adaptYouTubeRows(data, localKeys, localYoutubeIds);
                    if (items.length > 0)
                        return { items, provider: 'convert' };
                }
            }
            catch (_b) { }
        }
        if ((0, mediaWorkerClient_1.isWorkerSearchEnabled)()) {
            const health = yield (0, mediaWorkerClient_1.workerHealth)().catch(() => ({ ok: false, status: 0 }));
            if (health.ok) {
                const workerRes = yield (0, mediaWorkerClient_1.searchWithWorker)(q, resultLimit).catch(() => null);
                if ((_a = workerRes === null || workerRes === void 0 ? void 0 : workerRes.items) === null || _a === void 0 ? void 0 : _a.length) {
                    const workerRows = workerRes.items.map((t) => {
                        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                        const sid = String((_a = t === null || t === void 0 ? void 0 : t.sourceId) !== null && _a !== void 0 ? _a : '').trim() || String((_b = t === null || t === void 0 ? void 0 : t.id) !== null && _b !== void 0 ? _b : '').replace(/^youtube:/, '').trim();
                        const safeId = sid || extractYoutubeId(t === null || t === void 0 ? void 0 : t.url);
                        const ytUrl = (t === null || t === void 0 ? void 0 : t.url) || (safeId ? `https://www.youtube.com/watch?v=${safeId}` : '');
                        return {
                            id: safeId,
                            youtube_id: safeId,
                            title: (_c = t === null || t === void 0 ? void 0 : t.title) !== null && _c !== void 0 ? _c : '',
                            uploader: (_f = (_e = (_d = t === null || t === void 0 ? void 0 : t.artist) !== null && _d !== void 0 ? _d : t === null || t === void 0 ? void 0 : t.uploader) !== null && _e !== void 0 ? _e : t === null || t === void 0 ? void 0 : t.author) !== null && _f !== void 0 ? _f : 'Internet',
                            duration_seconds: (_h = (_g = t === null || t === void 0 ? void 0 : t.duration) !== null && _g !== void 0 ? _g : t === null || t === void 0 ? void 0 : t.duration_seconds) !== null && _h !== void 0 ? _h : null,
                            thumbnail_url: (_k = (_j = t === null || t === void 0 ? void 0 : t.coverUrl) !== null && _j !== void 0 ? _j : t === null || t === void 0 ? void 0 : t.thumbnail_url) !== null && _k !== void 0 ? _k : null,
                            url: ytUrl,
                            source: 'youtube',
                        };
                    });
                    const items = adaptYouTubeRows(workerRows, localKeys, localYoutubeIds);
                    if (items.length > 0)
                        return { items, provider: 'worker' };
                }
            }
            else if ((0, mediaWorkerClient_1.isWorkerEnabled)()) {
                console.warn('[worker/search] skipped (unhealthy)', { reqId, status: health.status });
            }
        }
        else if ((0, mediaWorkerClient_1.isWorkerEnabled)()) {
            console.log('[worker/search] disabled', { reqId });
        }
        return { items: [], provider: 'none' };
    });
    const queryVariants = [rawQuery];
    const seenQ = new Set([(0, searchRanking_1.normalizeText)(rawQuery)]);
    const pushQuery = (q) => {
        const k = (0, searchRanking_1.normalizeText)(q);
        if (!k || seenQ.has(k))
            return;
        seenQ.add(k);
        queryVariants.push(q);
    };
    let ytResults = [];
    let sources = { convert: 0, worker: 0, duck: 0, catalog: catalogResults.length, local: localResults.length };
    try {
        // ── 4. Primera búsqueda externa ─────────────────────────────────────────
        const primary = yield searchViaConvertOrWorker(rawQuery);
        ytResults.push(...primary.items);
        if (primary.provider === 'convert')
            sources.convert += primary.items.length;
        if (primary.provider === 'worker')
            sources.worker += primary.items.length;
        // ── 5. Rank preliminar para detectar si necesitamos más resultados ───────
        // Priorizar local sobre catalog/yt en el combinado inicial
        const combined0 = dedupeByYoutubeId([...localResults, ...catalogResults, ...ytResults]);
        let ranked0 = (0, searchRanking_1.rankSearchResults)(rawQuery, combined0);
        if (ranked0.afterRank < 8) {
            // Expandir query con tokens parciales detectados
            const tokenMap = new Map();
            const topTitles = ranked0.topScores.map((t) => String(t.title || '')).slice(0, 6);
            for (const token of nq.tokens) {
                if (token.length < 3)
                    continue;
                if (tokenMap.has(token))
                    continue;
                for (const tt of topTitles) {
                    const tnorm = (0, searchRanking_1.normalizeText)(tt);
                    for (const w of tnorm.split(' ').filter(Boolean)) {
                        if (w.length >= token.length + 2 && w.startsWith(token)) {
                            tokenMap.set(token, w);
                            break;
                        }
                    }
                    if (tokenMap.has(token))
                        break;
                }
            }
            let replaced = nq.normalized;
            for (const [k, v] of tokenMap.entries()) {
                replaced = replaced.replace(new RegExp(`\\b${k}\\b`, 'g'), v);
            }
            if (replaced && replaced !== nq.normalized)
                pushQuery(replaced);
            const topArtist = (0, searchRanking_1.normalizeText)(((_b = (_a = ranked0.topScores) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.artist) || '');
            if (topArtist && !nq.normalized.includes(topArtist) && topArtist.length <= 40)
                pushQuery(`${topArtist} ${nq.normalized}`);
            for (const q2 of queryVariants.slice(1, 3)) {
                const res2 = yield searchViaConvertOrWorker(q2);
                ytResults.push(...res2.items);
                if (res2.provider === 'convert')
                    sources.convert += res2.items.length;
                if (res2.provider === 'worker')
                    sources.worker += res2.items.length;
            }
            ranked0 = (0, searchRanking_1.rankSearchResults)(rawQuery, dedupeByYoutubeId([...localResults, ...catalogResults, ...ytResults]));
        }
        // ── 6. AI query alternatives (DeepSeek como corrector de query, opcional) ─
        if (ranked0.afterRank < 8) {
            const aiQueries = yield (0, searchAiAssist_1.getSearchQueryAlternatives)(rawQuery);
            if (aiQueries && aiQueries.length > 0) {
                for (const q3 of aiQueries)
                    pushQuery(q3);
                for (const q3 of aiQueries) {
                    const res3 = yield searchViaConvertOrWorker(q3);
                    ytResults.push(...res3.items);
                    if (res3.provider === 'convert')
                        sources.convert += res3.items.length;
                    if (res3.provider === 'worker')
                        sources.worker += res3.items.length;
                }
                ranked0 = (0, searchRanking_1.rankSearchResults)(rawQuery, dedupeByYoutubeId([...localResults, ...catalogResults, ...ytResults]));
            }
        }
        // ── 7. DuckDuckGo fallback si no hay resultados externos ─────────────────
        if (ytResults.length === 0) {
            const duckRows = yield searchDuckDuckGoForYoutube(rawQuery, resultLimit);
            const duck = adaptYouTubeRows(duckRows, localKeys, localYoutubeIds);
            ytResults.push(...duck);
            sources.duck += duck.length;
        }
        // ── 8. Combinado final con dedup fuerte antes de rankear ─────────────────
        // Priorizar: local > catalog > ytResults (local tiene source='local')
        const combinedAll = dedupeByYoutubeId([...localResults, ...catalogResults, ...ytResults]);
        const beforeDedupe = combinedAll.length;
        const ranked = (0, searchRanking_1.rankSearchResults)(rawQuery, combinedAll);
        const afterDedupe = ranked.afterRank;
        // ── 9. DeepSeek rerank opcional ──────────────────────────────────────────
        let finalItems = ranked.items;
        let reranked = false;
        if ((0, searchDeepseekRerank_1.isSearchRerankEnabled)() && finalItems.length > 1) {
            try {
                finalItems = yield (0, searchDeepseekRerank_1.rerankWithDeepSeek)(rawQuery, finalItems);
                reranked = true;
            }
            catch (_e) {
                // Silencioso — usar ranking local
            }
        }
        // ── 10. Upsert al catálogo global ────────────────────────────────────────
        const ytOnlyItems = finalItems.filter((it) => (it === null || it === void 0 ? void 0 : it.source) === 'youtube' && (it === null || it === void 0 ? void 0 : it.youtube_id));
        if (ytOnlyItems.length > 0) {
            void (0, recommendationStore_1.upsertGlobalCatalogTracks)(ytOnlyItems.slice(0, 20), 1).catch(() => { });
        }
        console.log('[search]', { reqId, q: truncate(rawQuery, 90), normalized: truncate(ranked.query.normalized, 90) });
        console.log('[search] sources', Object.assign(Object.assign({ reqId }, sources), { variants: queryVariants.length }));
        console.log('[search] ranked', { reqId, beforeDedupe, afterDedupe, finalItems: finalItems.length, reranked });
        console.log('[search] topResults', ranked.topScores.slice(0, 6));
        const response = { items: finalItems, source: 'search' };
        if (isDev()) {
            response.debug = {
                query: rawQuery,
                normalized: ranked.query.normalized,
                sources,
                beforeDedupe,
                afterDedupe,
                cacheHit: false,
                reranked,
                queriesUsed: queryVariants.slice(0, 6),
                topScores: ranked.topScores.slice(0, 10),
                ms: Date.now() - startedAt,
            };
        }
        setSearchCache(cacheKey, response);
        return res.json(response);
    }
    catch (error) {
        console.error('[search] error', { reqId, error: serializeError(error) });
        const response = { items: [], source: 'search' };
        if (isDev())
            response.debug = { query: rawQuery, normalized: nq.normalized, error: serializeError(error), ms: Date.now() - startedAt };
        return res.json(response);
    }
})));
// ── GET playlists reales ──
router.get('/playlists', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const playlists = yield db_1.default.query("SELECT * FROM Playlists WHERE name NOT IN ('Workout Hits', 'Chill Vibes') ORDER BY created_at DESC");
        res.json(playlists.rows);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
// ── GET single playlist con canciones ──
router.get('/playlists/:id', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const playlistResult = yield db_1.default.query('SELECT * FROM Playlists WHERE id = $1', [id]);
        if (playlistResult.rows.length === 0) {
            return res.status(404).json({ error: 'Playlist not found' });
        }
        const songsResult = yield db_1.default.query(`
      SELECT m.*, a.name as artist_name FROM Music m
      JOIN PlaylistSongs ps ON m.id = ps.song_id
      JOIN Artists a ON m.artist_id = a.id
      WHERE ps.playlist_id = $1
      ORDER BY ps.added_at
    `, [id]);
        const playlist = playlistResult.rows[0];
        playlist.songs = songsResult.rows;
        res.json(playlist);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
// ── POST /api/music/like — guardar like ──
router.post('/like', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { download_id } = req.body;
    if (!download_id)
        return res.status(400).json({ error: 'download_id requerido' });
    try {
        yield db_1.default.query(`INSERT INTO Likes (download_id) VALUES ($1) ON CONFLICT (download_id) DO NOTHING`, [download_id]);
        res.json({ liked: true });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
// ── DELETE /api/music/like — quitar like ──
router.delete('/like/:download_id', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield db_1.default.query('DELETE FROM Likes WHERE download_id = $1', [req.params.download_id]);
        res.json({ liked: false });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
// ── GET /api/music/likes — listar likes ──
router.get('/likes', (0, utils_1.asyncHandler)((_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield db_1.default.query(`SELECT d.* FROM Likes l JOIN Downloads d ON l.download_id = d.id ORDER BY l.created_at DESC`);
        res.json(result.rows);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
// ── POST /api/music/history — registrar escucha ──
router.post('/history', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { download_id } = req.body;
    if (!download_id)
        return res.status(400).json({ error: 'download_id requerido' });
    try {
        yield db_1.default.query(`INSERT INTO History (download_id) VALUES ($1)`, [download_id]);
        res.json({ ok: true });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
// ── GET /api/music/history — escuchado recientemente ──
router.get('/history', (0, utils_1.asyncHandler)((_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield db_1.default.query(`SELECT DISTINCT ON (d.id) d.*, h.played_at 
       FROM History h JOIN Downloads d ON h.download_id = d.id 
       ORDER BY d.id, h.played_at DESC`);
        // Re-sort by played_at DESC
        const sorted = result.rows.sort((a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime());
        res.json(sorted.slice(0, 20));
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
router.post('/resolve-audio', (0, utils_1.asyncHandler)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const reqId = makeReqId();
    const body = (req === null || req === void 0 ? void 0 : req.body) || {};
    const track = (body === null || body === void 0 ? void 0 : body.track) || {};
    const forceRepair = Boolean(body === null || body === void 0 ? void 0 : body.forceRepair);
    const rawTitle = String((track === null || track === void 0 ? void 0 : track.title) || '').trim();
    const rawArtist = String((track === null || track === void 0 ? void 0 : track.artist) || (track === null || track === void 0 ? void 0 : track.artist_name) || '').trim();
    const rawId = String((track === null || track === void 0 ? void 0 : track.youtubeId) || (track === null || track === void 0 ? void 0 : track.youtube_id) || (track === null || track === void 0 ? void 0 : track.sourceId) || (track === null || track === void 0 ? void 0 : track.source_id) || (track === null || track === void 0 ? void 0 : track.id) || '').trim();
    let youtubeId = '';
    if (rawId) {
        const stripped = rawId.startsWith('youtube:') ? rawId.slice('youtube:'.length) : rawId;
        if (!stripped.startsWith('dl-'))
            youtubeId = extractYoutubeId(stripped) || (stripped.includes('/') ? '' : stripped);
    }
    if (!youtubeId) {
        youtubeId = extractYoutubeId(track === null || track === void 0 ? void 0 : track.url) || '';
    }
    console.log('[resolve-audio] start', { reqId, title: truncate(rawTitle, 60), artist: truncate(rawArtist, 60), youtubeId: youtubeId || null, forceRepair });
    const lookupKey = youtubeId ? `yt:${youtubeId}` : `t:${(0, searchRanking_1.normalizeText)(`${rawTitle} ${rawArtist}`)}`;
    const pending = resolveAudioPending.get(lookupKey);
    if (pending) {
        const joined = yield pending;
        return res.status(joined.status).json(joined.payload);
    }
    const p = (() => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const mode = 'audio';
            const checkCached = (yt) => __awaiter(void 0, void 0, void 0, function* () {
                const existing = yield db_1.default.query(`SELECT * FROM Downloads WHERE youtube_id = $1 AND mode = $2 ORDER BY created_at DESC LIMIT 1`, [yt, mode]);
                if (!existing.rows.length)
                    return null;
                const row = existing.rows[0];
                const filePath = String(row.url || '').trim();
                if (!filePath || isHttpUrl(filePath))
                    return null;
                if (!fs_1.default.existsSync(filePath))
                    return { row, missing: true };
                const size = fs_1.default.statSync(filePath).size;
                if (!size || size <= 0)
                    return { row, missing: true };
                return { row, missing: false };
            });
            const resolveYoutubeIdBySearch = () => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b;
                const q = `${rawTitle} ${rawArtist}`.trim();
                if (!q)
                    return { id: '', safe: false };
                const isSafeMatch = (candidate) => {
                    if (!candidate)
                        return false;
                    const cTitle = (candidate.title || '').toLowerCase();
                    const qTitle = rawTitle.toLowerCase();
                    const badModifiers = ['remix', 'slowed', 'sped up', 'cover', 'karaoke', 'instrumental'];
                    for (const mod of badModifiers) {
                        if (cTitle.includes(mod) && !qTitle.includes(mod))
                            return false;
                    }
                    const qTokens = qTitle.replace(/[^\w\s]/gi, '').split(/\s+/).filter((t) => t.length > 2);
                    if (qTokens.length > 0) {
                        let matchedTokens = 0;
                        for (const t of qTokens) {
                            if (cTitle.includes(t))
                                matchedTokens++;
                        }
                        if (matchedTokens / qTokens.length < 0.5)
                            return false;
                    }
                    return true;
                };
                for (const pyUrl of downloaderUrls) {
                    try {
                        const response = yield axios_1.default.get(`${pyUrl}/search`, {
                            timeout: convertTimeoutMs,
                            params: { q, limit: 10 },
                        });
                        const data = response.data;
                        const rows = Array.isArray(data) ? data : Array.isArray(data === null || data === void 0 ? void 0 : data.items) ? data.items : [];
                        const ranked = (0, searchRanking_1.rankSearchResults)(q, rows);
                        const best = (_a = ranked.items) === null || _a === void 0 ? void 0 : _a[0];
                        const bestId = String((best === null || best === void 0 ? void 0 : best.youtube_id) || (best === null || best === void 0 ? void 0 : best.id) || '').trim();
                        if (bestId)
                            return { id: bestId, safe: isSafeMatch(best) };
                    }
                    catch (_c) { }
                }
                if ((0, mediaWorkerClient_1.isWorkerSearchEnabled)()) {
                    const health = yield (0, mediaWorkerClient_1.workerHealth)().catch(() => ({ ok: false }));
                    if (health.ok) {
                        const workerRes = yield (0, mediaWorkerClient_1.searchWithWorker)(q, 10).catch(() => null);
                        const ranked = (0, searchRanking_1.rankSearchResults)(q, (workerRes === null || workerRes === void 0 ? void 0 : workerRes.items) || []);
                        const it = (_b = ranked.items) === null || _b === void 0 ? void 0 : _b[0];
                        const wid = String((it === null || it === void 0 ? void 0 : it.sourceId) || (it === null || it === void 0 ? void 0 : it.id) || '').trim().replace(/^youtube:/, '');
                        if (wid)
                            return { id: wid, safe: isSafeMatch(it) };
                    }
                }
                return { id: '', safe: false };
            });
            let isUnsafeFallback = false;
            if (!youtubeId) {
                const searchRes = yield resolveYoutubeIdBySearch();
                youtubeId = searchRes.id;
                if (!searchRes.safe && youtubeId) {
                    isUnsafeFallback = true;
                }
            }
            if (isUnsafeFallback) {
                return { status: 409, payload: { ok: false, code: 'UNSAFE_MATCH', message: 'No se encontró una coincidencia segura para reparar esta canción' } };
            }
            if (!youtubeId) {
                return { status: 400, payload: { ok: false, message: 'No se pudo resolver youtubeId para esta canción' } };
            }
            const cached = yield checkCached(youtubeId);
            if (cached && !cached.missing) {
                console.log('[resolve-audio] cache-hit', { reqId, id: cached.row.id, youtubeId });
                return {
                    status: 200,
                    payload: { ok: true, audioUrl: `/api/downloads/stream/${cached.row.id}`, cached: true, source: 'local-cache' },
                };
            }
            if (cached && cached.missing) {
                console.warn('[resolve-audio] stale-cache missing-file', { reqId, id: cached.row.id, youtubeId });
            }
            const watchUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
            let savedRow = null;
            let resolvedSource = 'convert';
            try {
                for (const pyUrl of downloaderUrls) {
                    console.log('[resolve-audio] convert start', { reqId, url: pyUrl, youtubeId });
                    const pyRes = yield axios_1.default.post(`${pyUrl}/download`, { url: watchUrl, mode: 'audio', quality: 'medium', youtube_id: youtubeId }, { timeout: 300000 });
                    const dlData = pyRes.data || {};
                    const filePath = String(dlData.file_path || dlData.filePath || dlData.url || '').trim();
                    if (!filePath)
                        continue;
                    if (!isHttpUrl(filePath) && fs_1.default.existsSync(filePath) && fs_1.default.statSync(filePath).size > 0) {
                        const title = String(dlData.title || rawTitle || '').trim() || rawTitle || 'Audio';
                        const uploader = String(dlData.uploader || rawArtist || '').trim() || rawArtist || 'Internet';
                        const duration = Number(dlData.duration_seconds || dlData.duration || 0) || 0;
                        const thumb = String(dlData.thumbnail_url || dlData.thumbnail || '') || null;
                        const filename = String(dlData.filename || path_1.default.basename(filePath) || `${youtubeId}.mp3`);
                        const insert = yield db_1.default.query(`INSERT INTO Downloads (url, title, uploader, duration_seconds, thumbnail_url, filename, mode, youtube_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               RETURNING *`, [filePath, title, uploader, duration, thumb, filename, 'audio', youtubeId]);
                        savedRow = insert.rows[0];
                        resolvedSource = 'convert';
                        break;
                    }
                }
            }
            catch (error) {
                const failure = convertFailureReason(error);
                console.warn('[resolve-audio] convert failed', { reqId, reason: failure.reason, status: (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status });
                if (!failure.shouldFallback)
                    throw error;
            }
            if (!savedRow) {
                const shouldTryWorker = (0, mediaWorkerClient_1.isWorkerEnabled)();
                if (!shouldTryWorker) {
                    return { status: 502, payload: { ok: false, message: 'No se pudo descargar (worker deshabilitado)' } };
                }
                console.log('[resolve-audio] worker fallback start', { reqId, youtubeId });
                const workerResult = yield (0, mediaWorkerClient_1.downloadWithWorkerOptions)(watchUrl, { kind: 'audio', format: 'mp3', quality: 'medium' });
                const remoteUrl = (workerResult === null || workerResult === void 0 ? void 0 : workerResult.fileUrl) || '';
                const remoteName = (workerResult === null || workerResult === void 0 ? void 0 : workerResult.filename) || '';
                if (!(workerResult === null || workerResult === void 0 ? void 0 : workerResult.ok) || !remoteUrl || !isHttpUrl(remoteUrl)) {
                    return { status: 502, payload: { ok: false, message: 'Worker no devolvió un archivo válido' } };
                }
                const ext = inferExt(remoteName, '.mp3');
                const dest = path_1.default.join(mediaBaseDir, 'audio', `${youtubeId}${ext}`);
                const stored = yield downloadRemoteToLocal(remoteUrl, dest);
                if (!stored) {
                    return { status: 502, payload: { ok: false, message: 'No se pudo guardar audio del worker' } };
                }
                const title = rawTitle || 'Audio';
                const uploader = rawArtist || 'Internet';
                const duration = 0;
                const filename = path_1.default.basename(stored);
                const insert = yield db_1.default.query(`INSERT INTO Downloads (url, title, uploader, duration_seconds, thumbnail_url, filename, mode, youtube_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`, [stored, title, uploader, duration, null, filename, 'audio', youtubeId]);
                savedRow = insert.rows[0];
                resolvedSource = 'worker';
            }
            console.log('[resolve-audio] repaired ok', { reqId, id: savedRow.id, youtubeId, source: resolvedSource });
            return { status: 200, payload: { ok: true, audioUrl: `/api/downloads/stream/${savedRow.id}`, cached: false, source: resolvedSource } };
        }
        catch (error) {
            console.warn('[resolve-audio] failed', { reqId, error: serializeError(error) });
            return { status: 500, payload: { ok: false, message: 'No se pudo reparar el audio' } };
        }
    }))();
    resolveAudioPending.set(lookupKey, p);
    try {
        const out = yield p;
        return res.status(out.status).json(out.payload);
    }
    finally {
        resolveAudioPending.delete(lookupKey);
    }
})));
exports.default = router;
