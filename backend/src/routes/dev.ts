import { Router, Request, Response } from 'express';
import axios from 'axios';
import pool from '../db';
import { generateLocalMusicQueries, generateMusicSeedsWithDeepSeek, mixQueries, type MusicTasteProfile } from '../services/deepseekRecommendations';

const router = Router();

const CONVERT_URL = (process.env.CONVERT_URL || 'http://convert:8000').replace(/\/$/, '');
const CONFIRM_TEXT = 'CLEAR_MEDIA_CACHE';

const isProd = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';

router.delete('/media-cache', async (req: Request, res: Response) => {
  const confirm = String((req.body as any)?.confirm || '').trim();
  const clearDownloadRows = (req.body as any)?.clearDownloadRows === true;

  if (isProd()) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (confirm !== CONFIRM_TEXT) {
    return res.status(400).json({ error: 'Missing or invalid confirm', required: CONFIRM_TEXT });
  }

  console.log('[media-cache] clear requested', { clearDownloadRows, convertUrl: CONVERT_URL });

  let convertResult: any = null;
  try {
    const r = await axios.delete(`${CONVERT_URL}/cache/media`, {
      timeout: 60_000,
      data: { confirm: CONFIRM_TEXT },
    });
    convertResult = r.data;
    console.log('[media-cache] convert cleared', {
      deletedFiles: convertResult?.deletedFiles,
      freedBytes: convertResult?.freedBytes,
    });
  } catch (error: any) {
    console.error('[media-cache] convert clear failed', { message: error?.message, status: error?.response?.status });
  }

  let dbDeleted: any = null;
  if (clearDownloadRows) {
    try {
      const downloadsCount = await pool.query('SELECT COUNT(*)::int AS c FROM Downloads');
      const likesCount = await pool.query('SELECT COUNT(*)::int AS c FROM Likes');
      const historyCount = await pool.query('SELECT COUNT(*)::int AS c FROM History');

      const before = {
        downloads: downloadsCount.rows[0]?.c ?? 0,
        likes: likesCount.rows[0]?.c ?? 0,
        history: historyCount.rows[0]?.c ?? 0,
      };

      await pool.query('DELETE FROM Likes');
      await pool.query('DELETE FROM History');
      await pool.query('DELETE FROM Downloads');

      dbDeleted = before;
      console.log('[media-cache] cleared download rows', before);
    } catch (error: any) {
      console.error('[media-cache] clear download rows failed', { message: error?.message });
    }
  }

  return res.json({
    ok: true,
    convert: convertResult,
    deletedDownloadRows: dbDeleted,
  });
});

router.post('/recommendation-seeds', async (req: Request, res: Response) => {
  if (isProd()) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let finalBody = req.body || {};
  if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
    try {
      finalBody = JSON.parse(req.body);
    } catch {}
  } else if (Buffer.isBuffer(req.body)) {
    try {
      finalBody = JSON.parse(req.body.toString('utf8'));
    } catch {}
  }

  const toStringArray = (v: any) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : []);

  const uid = String((req as any)?.user?.uid || '').trim();
  const profile: MusicTasteProfile = {
    userId: uid || 'dev',
    topArtists: toStringArray((finalBody as any)?.topArtists),
    topGenres: toStringArray((finalBody as any)?.topGenres),
    recentTracks: toStringArray((finalBody as any)?.recentTracks),
    likedTracks: toStringArray((finalBody as any)?.likedTracks),
    recentSearches: toStringArray((finalBody as any)?.recentSearches),
    currentTrack: (finalBody as any)?.currentTrack || null,
    preferredLanguage: 'es',
  };

  const localQueries = generateLocalMusicQueries(profile, 12);
  const aiQueries = (await generateMusicSeedsWithDeepSeek(profile).catch(() => null)) || [];
  const finalQueries = mixQueries(localQueries, aiQueries, 12);

  return res.json({ localQueries, aiQueries, finalQueries });
});

export default router;
