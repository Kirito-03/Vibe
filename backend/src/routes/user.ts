import { Router, Request, Response } from 'express';
import pool from '../db';
import { admin } from '../firebase';
import { asyncHandler } from '../utils';

const router = Router();

const CONFIRM_TEXT = 'RESET_MY_VIBE_DATA';

const getEnvBool = (raw: string | undefined) => {
  if (!raw) return false;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

const getUid = (req: Request) => String((req as any)?.user?.uid || '').trim();

const getEnvBoolLoose = (raw: unknown) => {
  if (typeof raw === 'boolean') return raw;
  return getEnvBool(typeof raw === 'string' ? raw : String(raw ?? ''));
};

const deleteDocsInChunks = async (firestore: FirebaseFirestore.Firestore, refs: FirebaseFirestore.DocumentReference[], chunkSize = 400) => {
  if (refs.length === 0) return;
  console.log(`[reset-data] delete refs total=${refs.length}`);
  let chunkIndex = 1;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const chunk = refs.slice(i, i + chunkSize);
    console.log(`[reset-data] chunk ${chunkIndex} size=${chunk.length}`);
    const batch = firestore.batch();
    chunk.forEach(ref => batch.delete(ref));
    try {
      await batch.commit();
    } catch (err: any) {
      throw {
        code: 'RESET_FIRESTORE_DELETE_FAILED',
        message: 'Failed to delete chunk of firestore documents',
        details: `chunk ${chunkIndex} failed: ${err.message}`
      };
    }
    chunkIndex++;
  }
};

const getCollectionRefs = async (firestore: FirebaseFirestore.Firestore, pathParts: string[]) => {
  const col = firestore.collection(pathParts.join('/'));
  let total = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const refs: FirebaseFirestore.DocumentReference[] = [];
  while (true) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(500) as FirebaseFirestore.Query;
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    total += snap.size;
    snap.docs.forEach(d => refs.push(d.ref));
    last = snap.docs[snap.docs.length - 1];
  }
  return { total, refs };
};

const getPlaylistsWithTracksRefs = async (firestore: FirebaseFirestore.Firestore, uid: string) => {
  let playlists = 0;
  let playlistItems = 0;
  const refs: FirebaseFirestore.DocumentReference[] = [];

  const playlistsCol = firestore.collection(`users/${uid}/playlists`);
  let lastPlaylist: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let q = playlistsCol.orderBy(admin.firestore.FieldPath.documentId()).limit(200) as FirebaseFirestore.Query;
    if (lastPlaylist) q = q.startAfter(lastPlaylist);
    const playlistsSnap = await q.get();
    if (playlistsSnap.empty) break;
    lastPlaylist = playlistsSnap.docs[playlistsSnap.docs.length - 1];

    for (const p of playlistsSnap.docs) {
      playlists += 1;
      refs.push(p.ref);
      const tracksCol = firestore.collection(`users/${uid}/playlists/${p.id}/tracks`);
      let lastTrack: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      while (true) {
        let tq = tracksCol.orderBy(admin.firestore.FieldPath.documentId()).limit(500) as FirebaseFirestore.Query;
        if (lastTrack) tq = tq.startAfter(lastTrack);
        const tracksSnap = await tq.get();
        if (tracksSnap.empty) break;
        playlistItems += tracksSnap.size;
        tracksSnap.docs.forEach(d => refs.push(d.ref));
        lastTrack = tracksSnap.docs[tracksSnap.docs.length - 1];
      }
    }
  }

  return { playlists, playlistItems, refs };
};

const previewOrReset = async (req: Request, res: Response) => {
  const uid = getUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun =
    getEnvBoolLoose(String(req.query.dryRun || '').trim()) ||
    getEnvBoolLoose((req.body as any)?.dryRun);

  if (!dryRun) {
    const confirm = String(
      (req.body as any)?.confirm || 
      (req.query as any)?.confirm || 
      req.headers['x-reset-confirm'] || 
      ''
    ).trim();
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

  const deleted: Record<string, number> = {
    recent: 0,
    likes: 0,
    playlists: 0,
    playlistItems: 0,
    searchHistory: 0,
    settings: 0,
    downloads: 0,
  };

  console.log('[reset-data] uid=' + uid);

  const firestore = admin.firestore();

  try {
    const allRefs: FirebaseFirestore.DocumentReference[] = [];

    const likesData = await getCollectionRefs(firestore, ['users', uid, 'likes']);
    deleted.likes = likesData.total;
    allRefs.push(...likesData.refs);

    const recentsData = await getCollectionRefs(firestore, ['users', uid, 'recents']);
    deleted.recent = recentsData.total;
    allRefs.push(...recentsData.refs);

    const searchesData = await getCollectionRefs(firestore, ['users', uid, 'searches']);
    deleted.searchHistory = searchesData.total;
    allRefs.push(...searchesData.refs);

    const playlistData = await getPlaylistsWithTracksRefs(firestore, uid);
    deleted.playlists = playlistData.playlists;
    deleted.playlistItems = playlistData.playlistItems;
    allRefs.push(...playlistData.refs);

    const settingsDocRef = firestore.doc(`users/${uid}/settings/app`);
    const settingsSnap = await settingsDocRef.get();
    deleted.settings = settingsSnap.exists ? 1 : 0;
    if (settingsSnap.exists) {
      allRefs.push(settingsDocRef);
    }

    if (!dryRun) {
      await deleteDocsInChunks(firestore, allRefs);
      console.log('[reset-data] firestore delete ok');
    }

    const userRes = await pool.query('SELECT id FROM Users WHERE firebase_uid = $1 LIMIT 1', [uid]);
    const userId = userRes.rows[0]?.id as number | undefined;
    if (userId) {
      const playlistsCountRes = await pool.query('SELECT COUNT(*)::int AS c FROM Playlists WHERE user_id = $1', [userId]);
      const playlistSongsCountRes = await pool.query(
        `SELECT COUNT(*)::int AS c
         FROM PlaylistSongs ps
         JOIN Playlists p ON p.id = ps.playlist_id
         WHERE p.user_id = $1`,
        [userId]
      );
      const pgPlaylists = playlistsCountRes.rows[0]?.c ?? 0;
      const pgPlaylistItems = playlistSongsCountRes.rows[0]?.c ?? 0;

      deleted.playlists += pgPlaylists;
      deleted.playlistItems += pgPlaylistItems;

      if (!dryRun) {
        await pool.query('DELETE FROM Playlists WHERE user_id = $1', [userId]);
      }
    }

    if (!dryRun) {
      await pool.query('DELETE FROM UserSeenTracks WHERE firebase_uid = $1', [uid]);
      await pool.query('DELETE FROM UserRecommendationFeedback WHERE firebase_uid = $1', [uid]);
      await pool.query('DELETE FROM "UserRecommendationCache" WHERE firebase_uid = $1', [uid]);
      console.log('[reset-data] postgres delete ok');
      console.log('[reset-data] done');
    }

    res.json({
      ok: true,
      dryRun,
      targets: { postgresTables, firestoreCollections },
      deleted,
    });
  } catch (error: any) {
    console.error('[user/reset-data] error', { uid, dryRun, message: error?.message });
    if (error?.code === 'RESET_FIRESTORE_DELETE_FAILED') {
      res.status(500).json({ ok: false, code: error.code, message: error.message, details: error.details });
    } else {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Failed to reset user data' });
    }
  }
};

router.post('/reset-data/preview', asyncHandler((req: Request, res: Response) => {
  (req as any).query = { ...(req as any).query, dryRun: 'true' };
  return previewOrReset(req, res);
}));
router.delete('/reset-data', asyncHandler(previewOrReset));
router.post('/reset-data/execute', asyncHandler(previewOrReset));

export default router;
