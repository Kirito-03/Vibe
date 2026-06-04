import pool from '../db';
import { dedupeByKey } from '../utils';

type RecommendationCacheRow = {
  firebase_uid: string;
  endpoint: string;
  profile_hash: string;
  queries: string[] | null;
  items: any;
  source: string | null;
  expires_at: string;
};

export type RecommendationFeedbackType =
  | 'more_like_this'
  | 'not_this_track'
  | 'not_this_artist'
  | 'not_this_genre';

const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase();

const stableKey = (value: unknown) => normalizeText(value).replace(/\s+/g, ' ').trim();

export const ensureRecommendationSchema = async () => {
  await pool.query(`
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
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_recommendation_cache_uidx
      ON UserRecommendationCache (firebase_uid, endpoint, profile_hash);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_recommendation_cache_expires_idx
      ON UserRecommendationCache (expires_at);
  `);

  await pool.query(`
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
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_seen_tracks_uidx
      ON UserSeenTracks (firebase_uid, track_key);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_seen_tracks_seen_idx
      ON UserSeenTracks (firebase_uid, seen_at DESC);
  `);

  await pool.query(`
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
  await pool.query(`
    CREATE INDEX IF NOT EXISTS global_catalog_tracks_score_idx
      ON GlobalCatalogTracks (score DESC, updated_at DESC);
  `);

  await pool.query(`
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
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_recommendation_feedback_uidx
      ON UserRecommendationFeedback (firebase_uid, track_key, feedback_type);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_recommendation_feedback_uid_idx
      ON UserRecommendationFeedback (firebase_uid, created_at DESC);
  `);
};

export const getUserRecommendationCache = async (opts: {
  uid: string;
  endpoint: 'for-you' | 'recommendations';
  profileHash: string;
}) => {
  const { uid, endpoint, profileHash } = opts;
  const res = await pool.query<RecommendationCacheRow>(
    `
      SELECT firebase_uid, endpoint, profile_hash, queries, items, source, expires_at
      FROM UserRecommendationCache
      WHERE firebase_uid = $1 AND endpoint = $2 AND profile_hash = $3 AND expires_at > NOW()
      LIMIT 1
    `,
    [uid, endpoint, profileHash]
  );
  return res.rows[0] || null;
};

export const saveUserRecommendationCache = async (opts: {
  uid: string;
  endpoint: 'for-you' | 'recommendations';
  profileHash: string;
  queries: string[];
  items: any[];
  source: string;
  ttlMs: number;
}) => {
  const { uid, endpoint, profileHash, queries, items, source, ttlMs } = opts;
  const expiresAt = new Date(Date.now() + Math.max(1, ttlMs));
  await pool.query(
    `
      INSERT INTO UserRecommendationCache (firebase_uid, endpoint, profile_hash, queries, items, source, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (firebase_uid, endpoint, profile_hash)
      DO UPDATE SET
        queries = EXCLUDED.queries,
        items = EXCLUDED.items,
        source = EXCLUDED.source,
        created_at = NOW(),
        expires_at = EXCLUDED.expires_at
    `,
    [uid, endpoint, profileHash, queries, JSON.stringify(items), source, expiresAt.toISOString()]
  );
};

export const getUserRecentlySeenTrackKeys = async (opts: { uid: string; withinHours: number }) => {
  const withinHours = Number.isFinite(opts.withinHours) && opts.withinHours > 0 ? opts.withinHours : 24;
  const res = await pool.query<{ track_key: string; title_norm: string | null; artist_norm: string | null }>(
    `
      SELECT track_key, title_norm, artist_norm
      FROM UserSeenTracks
      WHERE firebase_uid = $1 AND seen_at > (NOW() - ($2 || ' hours')::interval)
      ORDER BY seen_at DESC
      LIMIT 400
    `,
    [opts.uid, String(withinHours)]
  );
  const keys = new Set<string>();
  const titleKeys = new Set<string>();
  const titleArtistKeys = new Set<string>();
  for (const r of res.rows) {
    if (r.track_key) keys.add(String(r.track_key));
    if (r.title_norm) titleKeys.add(String(r.title_norm));
    if (r.title_norm && r.artist_norm) titleArtistKeys.add(`${r.artist_norm}::${r.title_norm}`);
  }
  return { keys, titleKeys, titleArtistKeys };
};

export const markUserSeenTracks = async (opts: { uid: string; items: any[]; reason: string }) => {
  let values: Array<[string, string, string, string, string]> = [];
  for (const it of opts.items) {
    const youtubeId = String(it?.youtube_id || it?.id || '').trim();
    const source = String(it?.source || '').trim();
    const trackKey = youtubeId ? (source === 'local' ? `local:${youtubeId}` : `yt:${youtubeId}`) : `k:${stableKey(it?.title)}::${stableKey(it?.artist || it?.uploader)}`;
    const titleNorm = stableKey(it?.title);
    const artistNorm = stableKey(it?.artist || it?.uploader);
    values.push([opts.uid, trackKey, titleNorm, artistNorm, opts.reason]);
  }
  
  // Deduplicate before batch insert to avoid PostgreSQL ON CONFLICT error
  const beforeCount = values.length;
  values = dedupeByKey(values, (v) => `${v[0]}:${v[1]}`);
  if (beforeCount !== values.length) {
    console.log(`[db/batch-dedupe] table=UserSeenTracks before=${beforeCount} after=${values.length} removed=${beforeCount - values.length}`);
  }

  if (values.length === 0) return;

  const params: any[] = [];
  const chunks: string[] = [];
  let i = 1;
  for (const v of values.slice(0, 120)) {
    chunks.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(...v);
  }

  await pool.query(
    `
      INSERT INTO UserSeenTracks (firebase_uid, track_key, title_norm, artist_norm, reason)
      VALUES ${chunks.join(',')}
      ON CONFLICT (firebase_uid, track_key)
      DO UPDATE SET
        title_norm = EXCLUDED.title_norm,
        artist_norm = EXCLUDED.artist_norm,
        reason = EXCLUDED.reason,
        seen_at = NOW()
    `,
    params
  );
};

export const clearUserSeenTracks = async (uid: string) => {
  const res = await pool.query(`DELETE FROM UserSeenTracks WHERE firebase_uid = $1`, [uid]);
  return { deleted: res.rowCount || 0 };
};

export const clearUserRecommendationCache = async (uid: string) => {
  const res = await pool.query(`DELETE FROM UserRecommendationCache WHERE firebase_uid = $1`, [uid]);
  return { deleted: res.rowCount || 0 };
};

export const saveRecommendationFeedback = async (opts: {
  uid: string;
  trackKey: string;
  youtubeId?: string | null;
  title: string;
  artist?: string | null;
  feedbackType: RecommendationFeedbackType;
  metadata?: any;
}) => {
  const youtubeId = opts.youtubeId ? String(opts.youtubeId).trim() : null;
  const title = String(opts.title || '').trim();
  const artist = opts.artist ? String(opts.artist).trim() : null;
  const feedbackType = String(opts.feedbackType).trim();
  const trackKey = String(opts.trackKey || '').trim();
  if (!opts.uid || !trackKey || !title || !feedbackType) return { ok: false };

  await pool.query(
    `
      INSERT INTO UserRecommendationFeedback (firebase_uid, track_key, youtube_id, title, artist, feedback_type, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (firebase_uid, track_key, feedback_type)
      DO UPDATE SET
        youtube_id = EXCLUDED.youtube_id,
        title = EXCLUDED.title,
        artist = EXCLUDED.artist,
        metadata = EXCLUDED.metadata,
        created_at = NOW()
    `,
    [opts.uid, trackKey, youtubeId, title, artist, feedbackType, JSON.stringify(opts.metadata ?? {})]
  );

  return { ok: true };
};

export const getUserRecommendationFeedback = async (opts: { uid: string; limit: number }) => {
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(200, opts.limit) : 50;
  const res = await pool.query<{
    track_key: string;
    youtube_id: string | null;
    title: string;
    artist: string | null;
    feedback_type: string;
    metadata: any;
    created_at: string;
  }>(
    `
      SELECT track_key, youtube_id, title, artist, feedback_type, metadata, created_at
      FROM UserRecommendationFeedback
      WHERE firebase_uid = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [opts.uid, limit]
  );
  return res.rows;
};

export const getBlockedTrackKeys = async (uid: string) => {
  const res = await pool.query<{ track_key: string; youtube_id: string | null }>(
    `
      SELECT track_key, youtube_id
      FROM UserRecommendationFeedback
      WHERE firebase_uid = $1 AND feedback_type = 'not_this_track'
      ORDER BY created_at DESC
      LIMIT 500
    `,
    [uid]
  );
  const keys = new Set<string>();
  const ytIds = new Set<string>();
  for (const r of res.rows) {
    if (r.track_key) keys.add(String(r.track_key));
    if (r.youtube_id) ytIds.add(String(r.youtube_id));
  }
  return { keys, ytIds };
};

export const getBlockedArtists = async (uid: string) => {
  const res = await pool.query<{ artist: string | null }>(
    `
      SELECT artist
      FROM UserRecommendationFeedback
      WHERE firebase_uid = $1 AND feedback_type = 'not_this_artist' AND artist IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 300
    `,
    [uid]
  );
  const artists = new Set<string>();
  for (const r of res.rows) {
    const a = stableKey(r.artist);
    if (a) artists.add(a);
  }
  return artists;
};

export const getPositiveSeeds = async (uid: string, limit = 12) => {
  const lim = Number.isFinite(limit) && limit > 0 ? Math.min(40, limit) : 12;
  const res = await pool.query<{ title: string; artist: string | null }>(
    `
      SELECT title, artist
      FROM UserRecommendationFeedback
      WHERE firebase_uid = $1 AND feedback_type = 'more_like_this'
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [uid, lim]
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of res.rows) {
    const t = String(r.title || '').trim();
    const a = String(r.artist || '').trim();
    const seedA = a ? `${a} official audio` : '';
    const seedT = t ? `${t} official audio` : '';
    for (const s of [seedA, seedT]) {
      const k = stableKey(s);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (out.length >= lim) return out;
    }
  }
  return out;
};

export const upsertGlobalCatalogTracks = async (items: any[], scoreInc = 1) => {
  let rows = items
    .map((it) => {
      const yt = String(it?.youtube_id || it?.id || '').trim();
      const title = String(it?.title || '').trim();
      if (!yt || !title) return null;
      const uploader = String(it?.artist || it?.uploader || '').trim() || null;
      const duration = Number.isFinite(it?.duration_seconds) ? Number(it.duration_seconds) : Number.isFinite(it?.duration) ? Number(it.duration) : null;
      const thumbnail = String(it?.thumbnail_url || it?.thumbnail || '').trim() || null;
      const url = String(it?.url || '').trim() || null;
      return { yt, title, uploader, duration, thumbnail, url };
    })
    .filter(Boolean) as Array<{ yt: string; title: string; uploader: string | null; duration: number | null; thumbnail: string | null; url: string | null }>;

  const beforeCount = rows.length;
  rows = dedupeByKey(rows, (r) => r.yt);
  if (beforeCount !== rows.length) {
    console.log(`[db/batch-dedupe] table=GlobalCatalogTracks before=${beforeCount} after=${rows.length} removed=${beforeCount - rows.length}`);
  }


  if (rows.length === 0) return;

  const params: any[] = [];
  const chunks: string[] = [];
  let i = 1;
  for (const r of rows.slice(0, 80)) {
    chunks.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(r.yt, r.title, r.uploader, r.duration, r.thumbnail, r.url, scoreInc);
  }

  await pool.query(
    `
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
    `,
    params
  );
};

export const getGlobalCatalogRecommendations = async (opts: { limit: number; excludeYoutubeIds?: Set<string> }) => {
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(60, opts.limit) : 30;
  const exclude = opts.excludeYoutubeIds ? Array.from(opts.excludeYoutubeIds).slice(0, 500) : [];

  const res = await pool.query<{
    youtube_id: string | null;
    title: string;
    uploader: string | null;
    duration: number | null;
    thumbnail: string | null;
    url: string | null;
    score: number;
  }>(
    `
      SELECT youtube_id, title, uploader, duration, thumbnail, url, score
      FROM GlobalCatalogTracks
      WHERE youtube_id IS NOT NULL
        AND (CARDINALITY($1::text[]) = 0 OR youtube_id <> ALL($1::text[]))
      ORDER BY score DESC, updated_at DESC
      LIMIT $2
    `,
    [exclude, limit]
  );

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
};
