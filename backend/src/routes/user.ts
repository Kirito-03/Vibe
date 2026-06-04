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

const deleteCollectionDocs = async (firestore: FirebaseFirestore.Firestore, pathParts: string[], dryRun: boolean) => {
  const col = firestore.collection(pathParts.join('/'));
  let total = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(500) as FirebaseFirestore.Query;
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    total += snap.size;
    last = snap.docs[snap.docs.length - 1];
    if (!dryRun) {
      const batch = firestore.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  return total;
};

const deletePlaylistsWithTracks = async (firestore: FirebaseFirestore.Firestore, uid: string, dryRun: boolean) => {
  let playlists = 0;
  let playlistItems = 0;

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
      const tracksCol = firestore.collection(`users/${uid}/playlists/${p.id}/tracks`);
      let lastTrack: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      while (true) {
        let tq = tracksCol.orderBy(admin.firestore.FieldPath.documentId()).limit(500) as FirebaseFirestore.Query;
        if (lastTrack) tq = tq.startAfter(lastTrack);
        const tracksSnap = await tq.get();
        if (tracksSnap.empty) break;
        playlistItems += tracksSnap.size;
        lastTrack = tracksSnap.docs[tracksSnap.docs.length - 1];
        if (!dryRun) {
          const batch = firestore.batch();
          tracksSnap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }

      if (!dryRun) {
        await p.ref.delete();
      }
    }
  }

  return { playlists, playlistItems };
};

const previewOrReset = async (req: Request, res: Response) => {
  const uid = getUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun =
    getEnvBoolLoose(String(req.query.dryRun || '').trim()) ||
    getEnvBoolLoose((req.body as any)?.dryRun);

  if (!dryRun) {
    const confirm = String((req.body as any)?.confirm || '').trim();
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

  console.log('[user/reset-data] start', {
    uid,
    dryRun,
    postgresTables,
    firestoreCollections,
  });

  const firestore = admin.firestore();

  try {
    deleted.likes = await deleteCollectionDocs(firestore, ['users', uid, 'likes'], dryRun);
    deleted.recent = await deleteCollectionDocs(firestore, ['users', uid, 'recents'], dryRun);
    deleted.searchHistory = await deleteCollectionDocs(firestore, ['users', uid, 'searches'], dryRun);

    const playlistCounts = await deletePlaylistsWithTracks(firestore, uid, dryRun);
    deleted.playlists = playlistCounts.playlists;
    deleted.playlistItems = playlistCounts.playlistItems;

    const settingsDocRef = firestore.doc(`users/${uid}/settings/app`);
    const settingsSnap = await settingsDocRef.get();
    deleted.settings = settingsSnap.exists ? 1 : 0;
    if (!dryRun && settingsSnap.exists) {
      await settingsDocRef.delete();
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
    }

    res.json({
      ok: true,
      dryRun,
      targets: { postgresTables, firestoreCollections },
      deleted,
    });
  } catch (error: any) {
    console.error('[user/reset-data] error', { uid, dryRun, message: error?.message });
    res.status(500).json({ error: 'Failed to reset user data' });
  }
};

router.post('/reset-data/preview', asyncHandler((req: Request, res: Response) => {
  (req as any).query = { ...(req as any).query, dryRun: 'true' };
  return previewOrReset(req, res);
}));
router.delete('/reset-data', asyncHandler(previewOrReset));

export default router;
