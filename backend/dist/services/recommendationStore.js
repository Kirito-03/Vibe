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
exports.buildUserMusicProfile = exports.saveUserListeningEvent = exports.getGlobalCatalogRecommendations = exports.upsertGlobalCatalogTracks = exports.getPositiveSeeds = exports.getBlockedArtists = exports.getBlockedTrackKeys = exports.getUserRecommendationFeedback = exports.saveRecommendationFeedback = exports.clearUserRecommendationCache = exports.clearUserSeenTracks = exports.markUserSeenTracks = exports.getUserRecentlySeenTrackKeys = exports.saveUserRecommendationCache = exports.getUserRecommendationCache = exports.ensureRecommendationSchema = void 0;
const db_1 = __importDefault(require("../db"));
const utils_1 = require("../utils");
const normalizeText = (value) => String(value !== null && value !== void 0 ? value : '').trim().toLowerCase();
const stableKey = (value) => normalizeText(value).replace(/\s+/g, ' ').trim();
const ensureRecommendationSchema = () => __awaiter(void 0, void 0, void 0, function* () {
    yield db_1.default.query(`
    CREATE TABLE IF NOT EXISTS UserListeningEvents (
      id SERIAL PRIMARY KEY,
      firebase_uid TEXT NOT NULL,
      youtube_id VARCHAR(32),
      title TEXT NOT NULL,
      artist TEXT,
      duration INTEGER,
      listened_seconds INTEGER,
      progress_percent INTEGER,
      event_type TEXT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    yield db_1.default.query(`
    CREATE INDEX IF NOT EXISTS user_listening_events_uid_idx
      ON UserListeningEvents (firebase_uid, created_at DESC);
  `);
    yield db_1.default.query(`
    CREATE TABLE IF NOT EXISTS UserRecommendationCache (
      id SERIAL PRIMARY KEY,
      firebase_uid TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      profile_hash VARCHAR(64) NOT NULL,
      queries TEXT[],
      items JSONB NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
    yield db_1.default.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_recommendation_cache_uidx
      ON UserRecommendationCache (firebase_uid, endpoint, profile_hash);
  `);
    yield db_1.default.query(`
    CREATE INDEX IF NOT EXISTS user_recommendation_cache_expires_idx
      ON UserRecommendationCache (expires_at);
  `);
    yield db_1.default.query(`
    CREATE TABLE IF NOT EXISTS UserSeenTracks (
      id SERIAL PRIMARY KEY,
      firebase_uid TEXT NOT NULL,
      track_key TEXT NOT NULL,
      title_norm TEXT,
      artist_norm TEXT,
      reason TEXT,
      seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    yield db_1.default.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_seen_tracks_uidx
      ON UserSeenTracks (firebase_uid, track_key);
  `);
    yield db_1.default.query(`
    CREATE INDEX IF NOT EXISTS user_seen_tracks_seen_idx
      ON UserSeenTracks (firebase_uid, seen_at DESC);
  `);
    yield db_1.default.query(`
    CREATE TABLE IF NOT EXISTS GlobalCatalogTracks (
      id SERIAL PRIMARY KEY,
      youtube_id VARCHAR(32) UNIQUE,
      title TEXT NOT NULL,
      uploader TEXT,
      duration INTEGER,
      thumbnail TEXT,
      url TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    yield db_1.default.query(`
    CREATE INDEX IF NOT EXISTS global_catalog_tracks_score_idx
      ON GlobalCatalogTracks (score DESC, updated_at DESC);
  `);
    yield db_1.default.query(`
    CREATE TABLE IF NOT EXISTS UserRecommendationFeedback (
      id SERIAL PRIMARY KEY,
      firebase_uid TEXT NOT NULL,
      track_key TEXT NOT NULL,
      youtube_id VARCHAR(32),
      title TEXT NOT NULL,
      artist TEXT,
      feedback_type TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    yield db_1.default.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_recommendation_feedback_uidx
      ON UserRecommendationFeedback (firebase_uid, track_key, feedback_type);
  `);
    yield db_1.default.query(`
    CREATE INDEX IF NOT EXISTS user_recommendation_feedback_uid_idx
      ON UserRecommendationFeedback (firebase_uid, created_at DESC);
  `);
});
exports.ensureRecommendationSchema = ensureRecommendationSchema;
const getUserRecommendationCache = (opts) => __awaiter(void 0, void 0, void 0, function* () {
    const { uid, endpoint, profileHash } = opts;
    const res = yield db_1.default.query(`
      SELECT firebase_uid, endpoint, profile_hash, queries, items, source, expires_at
      FROM UserRecommendationCache
      WHERE firebase_uid = $1 AND endpoint = $2 AND profile_hash = $3 AND expires_at > NOW()
      LIMIT 1
    `, [uid, endpoint, profileHash]);
    return res.rows[0] || null;
});
exports.getUserRecommendationCache = getUserRecommendationCache;
const saveUserRecommendationCache = (opts) => __awaiter(void 0, void 0, void 0, function* () {
    const { uid, endpoint, profileHash, queries, items, source, ttlMs } = opts;
    const expiresAt = new Date(Date.now() + Math.max(1, ttlMs));
    yield db_1.default.query(`
      INSERT INTO UserRecommendationCache (firebase_uid, endpoint, profile_hash, queries, items, source, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (firebase_uid, endpoint, profile_hash)
      DO UPDATE SET
        queries = EXCLUDED.queries,
        items = EXCLUDED.items,
        source = EXCLUDED.source,
        created_at = NOW(),
        expires_at = EXCLUDED.expires_at
    `, [uid, endpoint, profileHash, queries, JSON.stringify(items), source, expiresAt.toISOString()]);
});
exports.saveUserRecommendationCache = saveUserRecommendationCache;
const getUserRecentlySeenTrackKeys = (opts) => __awaiter(void 0, void 0, void 0, function* () {
    const withinHours = Number.isFinite(opts.withinHours) && opts.withinHours > 0 ? opts.withinHours : 24;
    const res = yield db_1.default.query(`
      SELECT track_key, title_norm, artist_norm
      FROM UserSeenTracks
      WHERE firebase_uid = $1 AND seen_at > (NOW() - ($2 || ' hours')::interval)
      ORDER BY seen_at DESC
      LIMIT 400
    `, [opts.uid, String(withinHours)]);
    const keys = new Set();
    const titleKeys = new Set();
    const titleArtistKeys = new Set();
    for (const r of res.rows) {
        if (r.track_key)
            keys.add(String(r.track_key));
        if (r.title_norm)
            titleKeys.add(String(r.title_norm));
        if (r.title_norm && r.artist_norm)
            titleArtistKeys.add(`${r.artist_norm}::${r.title_norm}`);
    }
    return { keys, titleKeys, titleArtistKeys };
});
exports.getUserRecentlySeenTrackKeys = getUserRecentlySeenTrackKeys;
const markUserSeenTracks = (opts) => __awaiter(void 0, void 0, void 0, function* () {
    let values = [];
    for (const it of opts.items) {
        const youtubeId = String((it === null || it === void 0 ? void 0 : it.youtube_id) || (it === null || it === void 0 ? void 0 : it.id) || '').trim();
        const source = String((it === null || it === void 0 ? void 0 : it.source) || '').trim();
        const trackKey = youtubeId ? (source === 'local' ? `local:${youtubeId}` : `yt:${youtubeId}`) : `k:${stableKey(it === null || it === void 0 ? void 0 : it.title)}::${stableKey((it === null || it === void 0 ? void 0 : it.artist) || (it === null || it === void 0 ? void 0 : it.uploader))}`;
        const titleNorm = stableKey(it === null || it === void 0 ? void 0 : it.title);
        const artistNorm = stableKey((it === null || it === void 0 ? void 0 : it.artist) || (it === null || it === void 0 ? void 0 : it.uploader));
        values.push([opts.uid, trackKey, titleNorm, artistNorm, opts.reason]);
    }
    // Deduplicate before batch insert to avoid PostgreSQL ON CONFLICT error
    const beforeCount = values.length;
    values = (0, utils_1.dedupeByKey)(values, (v) => `${v[0]}:${v[1]}`);
    if (beforeCount !== values.length) {
        console.log(`[db/batch-dedupe] table=UserSeenTracks before=${beforeCount} after=${values.length} removed=${beforeCount - values.length}`);
    }
    if (values.length === 0)
        return;
    const params = [];
    const chunks = [];
    let i = 1;
    for (const v of values.slice(0, 120)) {
        chunks.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
        params.push(...v);
    }
    yield db_1.default.query(`
      INSERT INTO UserSeenTracks (firebase_uid, track_key, title_norm, artist_norm, reason)
      VALUES ${chunks.join(',')}
      ON CONFLICT (firebase_uid, track_key)
      DO UPDATE SET
        title_norm = EXCLUDED.title_norm,
        artist_norm = EXCLUDED.artist_norm,
        reason = EXCLUDED.reason,
        seen_at = NOW()
    `, params);
});
exports.markUserSeenTracks = markUserSeenTracks;
const clearUserSeenTracks = (uid) => __awaiter(void 0, void 0, void 0, function* () {
    const res = yield db_1.default.query(`DELETE FROM UserSeenTracks WHERE firebase_uid = $1`, [uid]);
    return { deleted: res.rowCount || 0 };
});
exports.clearUserSeenTracks = clearUserSeenTracks;
const clearUserRecommendationCache = (uid) => __awaiter(void 0, void 0, void 0, function* () {
    const res = yield db_1.default.query(`DELETE FROM UserRecommendationCache WHERE firebase_uid = $1`, [uid]);
    return { deleted: res.rowCount || 0 };
});
exports.clearUserRecommendationCache = clearUserRecommendationCache;
const saveRecommendationFeedback = (opts) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const youtubeId = opts.youtubeId ? String(opts.youtubeId).trim() : null;
    const title = String(opts.title || '').trim();
    const artist = opts.artist ? String(opts.artist).trim() : null;
    const feedbackType = String(opts.feedbackType).trim();
    const trackKey = String(opts.trackKey || '').trim();
    if (!opts.uid || !trackKey || !title || !feedbackType)
        return { ok: false };
    yield db_1.default.query(`
      INSERT INTO UserRecommendationFeedback (firebase_uid, track_key, youtube_id, title, artist, feedback_type, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (firebase_uid, track_key, feedback_type)
      DO UPDATE SET
        youtube_id = EXCLUDED.youtube_id,
        title = EXCLUDED.title,
        artist = EXCLUDED.artist,
        metadata = EXCLUDED.metadata,
        created_at = NOW()
    `, [opts.uid, trackKey, youtubeId, title, artist, feedbackType, JSON.stringify((_a = opts.metadata) !== null && _a !== void 0 ? _a : {})]);
    return { ok: true };
});
exports.saveRecommendationFeedback = saveRecommendationFeedback;
const getUserRecommendationFeedback = (opts) => __awaiter(void 0, void 0, void 0, function* () {
    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(200, opts.limit) : 50;
    const res = yield db_1.default.query(`
      SELECT track_key, youtube_id, title, artist, feedback_type, metadata, created_at
      FROM UserRecommendationFeedback
      WHERE firebase_uid = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [opts.uid, limit]);
    return res.rows;
});
exports.getUserRecommendationFeedback = getUserRecommendationFeedback;
const getBlockedTrackKeys = (uid) => __awaiter(void 0, void 0, void 0, function* () {
    const res = yield db_1.default.query(`
      SELECT track_key, youtube_id
      FROM UserRecommendationFeedback
      WHERE firebase_uid = $1 AND feedback_type = 'not_this_track'
      ORDER BY created_at DESC
      LIMIT 500
    `, [uid]);
    const keys = new Set();
    const ytIds = new Set();
    for (const r of res.rows) {
        if (r.track_key)
            keys.add(String(r.track_key));
        if (r.youtube_id)
            ytIds.add(String(r.youtube_id));
    }
    return { keys, ytIds };
});
exports.getBlockedTrackKeys = getBlockedTrackKeys;
const getBlockedArtists = (uid) => __awaiter(void 0, void 0, void 0, function* () {
    const res = yield db_1.default.query(`
      SELECT artist
      FROM UserRecommendationFeedback
      WHERE firebase_uid = $1 AND feedback_type = 'not_this_artist' AND artist IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 300
    `, [uid]);
    const artists = new Set();
    for (const r of res.rows) {
        const a = stableKey(r.artist);
        if (a)
            artists.add(a);
    }
    return artists;
});
exports.getBlockedArtists = getBlockedArtists;
const getPositiveSeeds = (uid_1, ...args_1) => __awaiter(void 0, [uid_1, ...args_1], void 0, function* (uid, limit = 12) {
    const lim = Number.isFinite(limit) && limit > 0 ? Math.min(40, limit) : 12;
    const res = yield db_1.default.query(`
      SELECT title, artist
      FROM UserRecommendationFeedback
      WHERE firebase_uid = $1 AND feedback_type = 'more_like_this'
      ORDER BY created_at DESC
      LIMIT $2
    `, [uid, lim]);
    const out = [];
    const seen = new Set();
    for (const r of res.rows) {
        const t = String(r.title || '').trim();
        const a = String(r.artist || '').trim();
        const seedA = a ? `${a} official audio` : '';
        const seedT = t ? `${t} official audio` : '';
        for (const s of [seedA, seedT]) {
            const k = stableKey(s);
            if (!k || seen.has(k))
                continue;
            seen.add(k);
            out.push(s);
            if (out.length >= lim)
                return out;
        }
    }
    return out;
});
exports.getPositiveSeeds = getPositiveSeeds;
const upsertGlobalCatalogTracks = (items_1, ...args_1) => __awaiter(void 0, [items_1, ...args_1], void 0, function* (items, scoreInc = 1) {
    let rows = items
        .map((it) => {
        const yt = String((it === null || it === void 0 ? void 0 : it.youtube_id) || (it === null || it === void 0 ? void 0 : it.id) || '').trim();
        const title = String((it === null || it === void 0 ? void 0 : it.title) || '').trim();
        if (!yt || !title)
            return null;
        const uploader = String((it === null || it === void 0 ? void 0 : it.artist) || (it === null || it === void 0 ? void 0 : it.uploader) || '').trim() || null;
        const duration = Number.isFinite(it === null || it === void 0 ? void 0 : it.duration_seconds) ? Number(it.duration_seconds) : Number.isFinite(it === null || it === void 0 ? void 0 : it.duration) ? Number(it.duration) : null;
        const thumbnail = String((it === null || it === void 0 ? void 0 : it.thumbnail_url) || (it === null || it === void 0 ? void 0 : it.thumbnail) || '').trim() || null;
        const url = String((it === null || it === void 0 ? void 0 : it.url) || '').trim() || null;
        return { yt, title, uploader, duration, thumbnail, url };
    })
        .filter(Boolean);
    const beforeCount = rows.length;
    rows = (0, utils_1.dedupeByKey)(rows, (r) => r.yt);
    if (beforeCount !== rows.length) {
        console.log(`[db/batch-dedupe] table=GlobalCatalogTracks before=${beforeCount} after=${rows.length} removed=${beforeCount - rows.length}`);
    }
    if (rows.length === 0)
        return;
    const params = [];
    const chunks = [];
    let i = 1;
    for (const r of rows.slice(0, 80)) {
        chunks.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
        params.push(r.yt, r.title, r.uploader, r.duration, r.thumbnail, r.url, scoreInc);
    }
    yield db_1.default.query(`
      INSERT INTO GlobalCatalogTracks (youtube_id, title, uploader, duration, thumbnail, url, score, updated_at)
      VALUES ${chunks.join(',')}
      ON CONFLICT (youtube_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        uploader = COALESCE(EXCLUDED.uploader, GlobalCatalogTracks.uploader),
        duration = COALESCE(EXCLUDED.duration, GlobalCatalogTracks.duration),
        thumbnail = COALESCE(EXCLUDED.thumbnail, GlobalCatalogTracks.thumbnail),
        url = COALESCE(EXCLUDED.url, GlobalCatalogTracks.url),
        score = GlobalCatalogTracks.score + EXCLUDED.score,
        updated_at = NOW()
    `, params);
});
exports.upsertGlobalCatalogTracks = upsertGlobalCatalogTracks;
const getGlobalCatalogRecommendations = (opts) => __awaiter(void 0, void 0, void 0, function* () {
    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(60, opts.limit) : 30;
    const exclude = opts.excludeYoutubeIds ? Array.from(opts.excludeYoutubeIds).slice(0, 500) : [];
    const res = yield db_1.default.query(`
      SELECT youtube_id, title, uploader, duration, thumbnail, url, score
      FROM GlobalCatalogTracks
      WHERE youtube_id IS NOT NULL
        AND (CARDINALITY($1::text[]) = 0 OR youtube_id <> ALL($1::text[]))
      ORDER BY score DESC, updated_at DESC
      LIMIT $2
    `, [exclude, limit]);
    return res.rows.map((r) => ({
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
});
exports.getGlobalCatalogRecommendations = getGlobalCatalogRecommendations;
const saveUserListeningEvent = (opts) => __awaiter(void 0, void 0, void 0, function* () {
    const { uid, youtubeId, title, artist, duration, listenedSeconds, progressPercent, eventType, source } = opts;
    if (!uid || !title || !eventType)
        return { ok: false };
    yield db_1.default.query(`
      INSERT INTO UserListeningEvents (firebase_uid, youtube_id, title, artist, duration, listened_seconds, progress_percent, event_type, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [uid, youtubeId, title, artist, duration, listenedSeconds, progressPercent, eventType, source]);
    return { ok: true };
});
exports.saveUserListeningEvent = saveUserListeningEvent;
const buildUserMusicProfile = (uid) => __awaiter(void 0, void 0, void 0, function* () {
    const eventsRes = yield db_1.default.query(`
      SELECT title, artist, event_type
      FROM UserListeningEvents
      WHERE firebase_uid = $1 AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT 1000
    `, [uid]);
    const artistScores = {};
    const trackScores = {};
    const skippedPatterns = [];
    const likedTracks = [];
    for (const r of eventsRes.rows) {
        const artist = stableKey(r.artist);
        const title = stableKey(r.title);
        if (!title)
            continue;
        let score = 0;
        if (r.event_type === 'completed')
            score = 5;
        else if (r.event_type === 'liked') {
            score = 4;
            if (!likedTracks.includes(title))
                likedTracks.push(title);
        }
        else if (r.event_type === 'repeated')
            score = 3;
        else if (r.event_type === 'play_60_percent')
            score = 2;
        else if (r.event_type === 'play_30s')
            score = 1;
        else if (r.event_type === 'skipped') {
            score = -3;
            if (r.title.toLowerCase().includes('live'))
                skippedPatterns.push('live');
            if (r.title.toLowerCase().includes('cover'))
                skippedPatterns.push('cover');
            if (r.title.toLowerCase().includes('remix'))
                skippedPatterns.push('remix');
        }
        if (artist) {
            artistScores[artist] = (artistScores[artist] || 0) + score;
        }
        trackScores[title] = (trackScores[title] || 0) + score;
    }
    // Get from Feedback as well
    const feedbackRes = yield db_1.default.query(`
      SELECT title, artist, feedback_type
      FROM UserRecommendationFeedback
      WHERE firebase_uid = $1
    `, [uid]);
    for (const r of feedbackRes.rows) {
        const artist = stableKey(r.artist);
        const title = stableKey(r.title);
        if (r.feedback_type === 'more_like_this') {
            if (artist)
                artistScores[artist] = (artistScores[artist] || 0) + 10;
            trackScores[title] = (trackScores[title] || 0) + 10;
        }
        else if (r.feedback_type === 'not_this_artist') {
            if (artist)
                artistScores[artist] = (artistScores[artist] || 0) - 20;
        }
        else if (r.feedback_type === 'not_this_track') {
            trackScores[title] = (trackScores[title] || 0) - 20;
        }
    }
    const topArtists = Object.entries(artistScores)
        .sort((a, b) => b[1] - a[1])
        .filter((a) => a[1] > 0)
        .slice(0, 10)
        .map((a) => a[0]);
    const topTracks = Object.entries(trackScores)
        .sort((a, b) => b[1] - a[1])
        .filter((a) => a[1] > 0)
        .slice(0, 10)
        .map((a) => a[0]);
    return {
        topArtists,
        topTracks,
        likedTracks: likedTracks.slice(0, 10),
        skippedPatterns: [...new Set(skippedPatterns)],
        recentSearches: [] // Will be populated in route
    };
});
exports.buildUserMusicProfile = buildUserMusicProfile;
