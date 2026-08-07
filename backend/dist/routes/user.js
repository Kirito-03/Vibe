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
const db_1 = __importDefault(require("../db"));
const firebase_1 = require("../firebase");
const utils_1 = require("../utils");
const router = (0, express_1.Router)();
const CONFIRM_TEXT = 'RESET_MY_VIBE_DATA';
const getEnvBool = (raw) => {
    if (!raw)
        return false;
    return raw === 'true' || raw === '1' || raw === 'yes';
};
const getUid = (req) => { var _a; return String(((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.uid) || '').trim(); };
const getEnvBoolLoose = (raw) => {
    if (typeof raw === 'boolean')
        return raw;
    return getEnvBool(typeof raw === 'string' ? raw : String(raw !== null && raw !== void 0 ? raw : ''));
};
const deleteDocsInChunks = (firestore_1, refs_1, ...args_1) => __awaiter(void 0, [firestore_1, refs_1, ...args_1], void 0, function* (firestore, refs, chunkSize = 400) {
    if (refs.length === 0)
        return;
    console.log(`[reset-data] delete refs total=${refs.length}`);
    let chunkIndex = 1;
    for (let i = 0; i < refs.length; i += chunkSize) {
        const chunk = refs.slice(i, i + chunkSize);
        console.log(`[reset-data] chunk ${chunkIndex} size=${chunk.length}`);
        const batch = firestore.batch();
        chunk.forEach(ref => batch.delete(ref));
        try {
            yield batch.commit();
        }
        catch (err) {
            throw {
                code: 'RESET_FIRESTORE_DELETE_FAILED',
                message: 'Failed to delete chunk of firestore documents',
                details: `chunk ${chunkIndex} failed: ${err.message}`
            };
        }
        chunkIndex++;
    }
});
const getCollectionRefs = (firestore, pathParts) => __awaiter(void 0, void 0, void 0, function* () {
    const col = firestore.collection(pathParts.join('/'));
    let total = 0;
    let last = null;
    const refs = [];
    while (true) {
        let q = col.orderBy(firebase_1.admin.firestore.FieldPath.documentId()).limit(500);
        if (last)
            q = q.startAfter(last);
        const snap = yield q.get();
        if (snap.empty)
            break;
        total += snap.size;
        snap.docs.forEach(d => refs.push(d.ref));
        last = snap.docs[snap.docs.length - 1];
    }
    return { total, refs };
});
const getPlaylistsWithTracksRefs = (firestore, uid) => __awaiter(void 0, void 0, void 0, function* () {
    let playlists = 0;
    let playlistItems = 0;
    const refs = [];
    const playlistsCol = firestore.collection(`users/${uid}/playlists`);
    let lastPlaylist = null;
    while (true) {
        let q = playlistsCol.orderBy(firebase_1.admin.firestore.FieldPath.documentId()).limit(200);
        if (lastPlaylist)
            q = q.startAfter(lastPlaylist);
        const playlistsSnap = yield q.get();
        if (playlistsSnap.empty)
            break;
        lastPlaylist = playlistsSnap.docs[playlistsSnap.docs.length - 1];
        for (const p of playlistsSnap.docs) {
            playlists += 1;
            refs.push(p.ref);
            const tracksCol = firestore.collection(`users/${uid}/playlists/${p.id}/tracks`);
            let lastTrack = null;
            while (true) {
                let tq = tracksCol.orderBy(firebase_1.admin.firestore.FieldPath.documentId()).limit(500);
                if (lastTrack)
                    tq = tq.startAfter(lastTrack);
                const tracksSnap = yield tq.get();
                if (tracksSnap.empty)
                    break;
                playlistItems += tracksSnap.size;
                tracksSnap.docs.forEach(d => refs.push(d.ref));
                lastTrack = tracksSnap.docs[tracksSnap.docs.length - 1];
            }
        }
    }
    return { playlists, playlistItems, refs };
});
const previewOrReset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const uid = getUid(req);
    if (!uid)
        return res.status(401).json({ error: 'Unauthorized' });
    const dryRun = getEnvBoolLoose(String(req.query.dryRun || '').trim()) ||
        getEnvBoolLoose((_a = req.body) === null || _a === void 0 ? void 0 : _a.dryRun);
    if (!dryRun) {
        const confirm = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.confirm) ||
            ((_c = req.query) === null || _c === void 0 ? void 0 : _c.confirm) ||
            req.headers['x-reset-confirm'] ||
            '').trim();
        if (confirm !== CONFIRM_TEXT) {
            return res.status(400).json({ error: 'Missing or invalid confirm', required: CONFIRM_TEXT });
        }
    }
    const firestoreCollections = [
        `users/${uid}/likes`,
        `users/${uid}/recents`,
        `users/${uid}/searches`,
        `users/${uid}/playlists`,
        `users/${uid}/playlists/{playlistId}/tracks`,
        `users/${uid}/settings/app`,
    ];
    const postgresTables = ['Playlists', 'PlaylistSongs'];
    const deleted = {
        recent: 0,
        likes: 0,
        playlists: 0,
        playlistItems: 0,
        searchHistory: 0,
        settings: 0,
        downloads: 0,
    };
    console.log('[reset-data] uid=' + uid);
    const firestore = firebase_1.admin.firestore();
    try {
        const allRefs = [];
        const likesData = yield getCollectionRefs(firestore, ['users', uid, 'likes']);
        deleted.likes = likesData.total;
        allRefs.push(...likesData.refs);
        const recentsData = yield getCollectionRefs(firestore, ['users', uid, 'recents']);
        deleted.recent = recentsData.total;
        allRefs.push(...recentsData.refs);
        const searchesData = yield getCollectionRefs(firestore, ['users', uid, 'searches']);
        deleted.searchHistory = searchesData.total;
        allRefs.push(...searchesData.refs);
        const playlistData = yield getPlaylistsWithTracksRefs(firestore, uid);
        deleted.playlists = playlistData.playlists;
        deleted.playlistItems = playlistData.playlistItems;
        allRefs.push(...playlistData.refs);
        const settingsDocRef = firestore.doc(`users/${uid}/settings/app`);
        const settingsSnap = yield settingsDocRef.get();
        deleted.settings = settingsSnap.exists ? 1 : 0;
        if (settingsSnap.exists) {
            allRefs.push(settingsDocRef);
        }
        if (!dryRun) {
            yield deleteDocsInChunks(firestore, allRefs);
            console.log('[reset-data] firestore delete ok');
        }
        const userRes = yield db_1.default.query('SELECT id FROM Users WHERE firebase_uid = $1 LIMIT 1', [uid]);
        const userId = (_d = userRes.rows[0]) === null || _d === void 0 ? void 0 : _d.id;
        if (userId) {
            const playlistsCountRes = yield db_1.default.query('SELECT COUNT(*)::int AS c FROM Playlists WHERE user_id = $1', [userId]);
            const playlistSongsCountRes = yield db_1.default.query(`SELECT COUNT(*)::int AS c
         FROM PlaylistSongs ps
         JOIN Playlists p ON p.id = ps.playlist_id
         WHERE p.user_id = $1`, [userId]);
            const pgPlaylists = (_f = (_e = playlistsCountRes.rows[0]) === null || _e === void 0 ? void 0 : _e.c) !== null && _f !== void 0 ? _f : 0;
            const pgPlaylistItems = (_h = (_g = playlistSongsCountRes.rows[0]) === null || _g === void 0 ? void 0 : _g.c) !== null && _h !== void 0 ? _h : 0;
            deleted.playlists += pgPlaylists;
            deleted.playlistItems += pgPlaylistItems;
            if (!dryRun) {
                yield db_1.default.query('DELETE FROM Playlists WHERE user_id = $1', [userId]);
            }
        }
        if (!dryRun) {
            yield db_1.default.query('DELETE FROM UserSeenTracks WHERE firebase_uid = $1', [uid]);
            yield db_1.default.query('DELETE FROM UserRecommendationFeedback WHERE firebase_uid = $1', [uid]);
            yield db_1.default.query('DELETE FROM "UserRecommendationCache" WHERE firebase_uid = $1', [uid]);
            console.log('[reset-data] postgres delete ok');
            console.log('[reset-data] done');
        }
        res.json({
            ok: true,
            dryRun,
            targets: { postgresTables, firestoreCollections },
            deleted,
        });
    }
    catch (error) {
        console.error('[user/reset-data] error', { uid, dryRun, message: error === null || error === void 0 ? void 0 : error.message });
        if ((error === null || error === void 0 ? void 0 : error.code) === 'RESET_FIRESTORE_DELETE_FAILED') {
            res.status(500).json({ ok: false, code: error.code, message: error.message, details: error.details });
        }
        else {
            res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Failed to reset user data' });
        }
    }
});
router.post('/reset-data/preview', (0, utils_1.asyncHandler)((req, res) => {
    req.query = Object.assign(Object.assign({}, req.query), { dryRun: 'true' });
    return previewOrReset(req, res);
}));
router.delete('/reset-data', (0, utils_1.asyncHandler)(previewOrReset));
router.post('/reset-data/execute', (0, utils_1.asyncHandler)(previewOrReset));
exports.default = router;
