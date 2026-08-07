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
const express_1 = require("express");
const axios_1 = __importDefault(require("axios"));
const db_1 = __importDefault(require("../db"));
const deepseekRecommendations_1 = require("../services/deepseekRecommendations");
const mediaWorkerClient_1 = require("../services/mediaWorkerClient");
const router = (0, express_1.Router)();
const CONVERT_URL = (process.env.CONVERT_URL || 'http://convert:8000').replace(/\/$/, '');
const CONFIRM_TEXT = 'CLEAR_MEDIA_CACHE';
const isProd = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';
router.delete('/media-cache', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const confirm = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.confirm) || '').trim();
    const clearDownloadRows = ((_b = req.body) === null || _b === void 0 ? void 0 : _b.clearDownloadRows) === true;
    if (isProd()) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (confirm !== CONFIRM_TEXT) {
        return res.status(400).json({ error: 'Missing or invalid confirm', required: CONFIRM_TEXT });
    }
    console.log('[media-cache] clear requested', { clearDownloadRows, convertUrl: CONVERT_URL });
    let convertResult = null;
    try {
        const r = yield axios_1.default.delete(`${CONVERT_URL}/cache/media`, {
            timeout: 60000,
            data: { confirm: CONFIRM_TEXT },
        });
        convertResult = r.data;
        console.log('[media-cache] convert cleared', {
            deletedFiles: convertResult === null || convertResult === void 0 ? void 0 : convertResult.deletedFiles,
            freedBytes: convertResult === null || convertResult === void 0 ? void 0 : convertResult.freedBytes,
        });
    }
    catch (error) {
        console.error('[media-cache] convert clear failed', { message: error === null || error === void 0 ? void 0 : error.message, status: (_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.status });
    }
    let dbDeleted = null;
    if (clearDownloadRows) {
        try {
            const downloadsCount = yield db_1.default.query('SELECT COUNT(*)::int AS c FROM Downloads');
            const likesCount = yield db_1.default.query('SELECT COUNT(*)::int AS c FROM Likes');
            const historyCount = yield db_1.default.query('SELECT COUNT(*)::int AS c FROM History');
            const before = {
                downloads: (_e = (_d = downloadsCount.rows[0]) === null || _d === void 0 ? void 0 : _d.c) !== null && _e !== void 0 ? _e : 0,
                likes: (_g = (_f = likesCount.rows[0]) === null || _f === void 0 ? void 0 : _f.c) !== null && _g !== void 0 ? _g : 0,
                history: (_j = (_h = historyCount.rows[0]) === null || _h === void 0 ? void 0 : _h.c) !== null && _j !== void 0 ? _j : 0,
            };
            yield db_1.default.query('DELETE FROM Likes');
            yield db_1.default.query('DELETE FROM History');
            yield db_1.default.query('DELETE FROM Downloads');
            dbDeleted = before;
            console.log('[media-cache] cleared download rows', before);
        }
        catch (error) {
            console.error('[media-cache] clear download rows failed', { message: error === null || error === void 0 ? void 0 : error.message });
        }
    }
    return res.json({
        ok: true,
        convert: convertResult,
        deletedDownloadRows: dbDeleted,
    });
}));
router.post('/recommendation-seeds', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (isProd()) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    let finalBody = req.body || {};
    if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
        try {
            finalBody = JSON.parse(req.body);
        }
        catch (_b) { }
    }
    else if (Buffer.isBuffer(req.body)) {
        try {
            finalBody = JSON.parse(req.body.toString('utf8'));
        }
        catch (_c) { }
    }
    const toStringArray = (v) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : []);
    const uid = String(((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.uid) || '').trim();
    const profile = {
        userId: uid || 'dev',
        topArtists: toStringArray(finalBody === null || finalBody === void 0 ? void 0 : finalBody.topArtists),
        topGenres: toStringArray(finalBody === null || finalBody === void 0 ? void 0 : finalBody.topGenres),
        recentTracks: toStringArray(finalBody === null || finalBody === void 0 ? void 0 : finalBody.recentTracks),
        likedTracks: toStringArray(finalBody === null || finalBody === void 0 ? void 0 : finalBody.likedTracks),
        recentSearches: toStringArray(finalBody === null || finalBody === void 0 ? void 0 : finalBody.recentSearches),
        currentTrack: (finalBody === null || finalBody === void 0 ? void 0 : finalBody.currentTrack) || null,
        preferredLanguage: 'es',
    };
    const localQueries = (0, deepseekRecommendations_1.generateLocalMusicQueries)(profile, 12);
    const aiQueries = (yield (0, deepseekRecommendations_1.generateMusicSeedsWithDeepSeek)(profile).catch(() => null)) || [];
    const finalQueries = (0, deepseekRecommendations_1.mixQueries)(localQueries, aiQueries, 12);
    return res.json({ localQueries, aiQueries, finalQueries });
}));
router.get('/worker-health', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (isProd()) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const enabled = (0, mediaWorkerClient_1.isWorkerEnabled)();
    const url = process.env.MEDIA_WORKER_URL || null;
    const health = yield (0, mediaWorkerClient_1.workerHealth)();
    return res.json({ enabled, url, ok: health.ok });
}));
exports.default = router;
