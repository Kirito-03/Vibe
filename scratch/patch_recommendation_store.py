import re

def main():
    path = "backend/src/services/recommendationStore.ts"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Update schema
    schema_addition = """
  await pool.query(`
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
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_listening_events_uid_idx
      ON UserListeningEvents (firebase_uid, created_at DESC);
  `);
"""
    if "UserListeningEvents" not in content:
        content = content.replace("export const ensureRecommendationSchema = async () => {", "export const ensureRecommendationSchema = async () => {\n" + schema_addition)

    # 2. Add functions
    functions_addition = """
export const saveUserListeningEvent = async (opts: {
  uid: string;
  youtubeId: string | null;
  title: string;
  artist: string | null;
  duration: number | null;
  listenedSeconds: number | null;
  progressPercent: number | null;
  eventType: string;
  source: string | null;
}) => {
  const { uid, youtubeId, title, artist, duration, listenedSeconds, progressPercent, eventType, source } = opts;
  if (!uid || !title || !eventType) return { ok: false };
  
  await pool.query(
    `
      INSERT INTO UserListeningEvents (firebase_uid, youtube_id, title, artist, duration, listened_seconds, progress_percent, event_type, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [uid, youtubeId, title, artist, duration, listenedSeconds, progressPercent, eventType, source]
  );
  return { ok: true };
};

export const buildUserMusicProfile = async (uid: string) => {
  const eventsRes = await pool.query<{
    title: string;
    artist: string | null;
    event_type: string;
  }>(
    `
      SELECT title, artist, event_type
      FROM UserListeningEvents
      WHERE firebase_uid = $1 AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT 1000
    `,
    [uid]
  );

  const artistScores: Record<string, number> = {};
  const trackScores: Record<string, number> = {};
  const skippedPatterns: string[] = [];
  const likedTracks: string[] = [];

  for (const r of eventsRes.rows) {
    const artist = stableKey(r.artist);
    const title = stableKey(r.title);
    if (!title) continue;

    let score = 0;
    if (r.event_type === 'completed') score = 5;
    else if (r.event_type === 'liked') {
       score = 4;
       if (!likedTracks.includes(title)) likedTracks.push(title);
    }
    else if (r.event_type === 'repeated') score = 3;
    else if (r.event_type === 'play_60_percent') score = 2;
    else if (r.event_type === 'play_30s') score = 1;
    else if (r.event_type === 'skipped') {
       score = -3;
       if (r.title.toLowerCase().includes('live')) skippedPatterns.push('live');
       if (r.title.toLowerCase().includes('cover')) skippedPatterns.push('cover');
       if (r.title.toLowerCase().includes('remix')) skippedPatterns.push('remix');
    }

    if (artist) {
       artistScores[artist] = (artistScores[artist] || 0) + score;
    }
    trackScores[title] = (trackScores[title] || 0) + score;
  }

  // Get from Feedback as well
  const feedbackRes = await pool.query<{ title: string; artist: string | null; feedback_type: string }>(
    `
      SELECT title, artist, feedback_type
      FROM UserRecommendationFeedback
      WHERE firebase_uid = $1
    `,
    [uid]
  );

  for (const r of feedbackRes.rows) {
     const artist = stableKey(r.artist);
     const title = stableKey(r.title);
     if (r.feedback_type === 'more_like_this') {
        if (artist) artistScores[artist] = (artistScores[artist] || 0) + 10;
        trackScores[title] = (trackScores[title] || 0) + 10;
     } else if (r.feedback_type === 'not_this_artist') {
        if (artist) artistScores[artist] = (artistScores[artist] || 0) - 20;
     } else if (r.feedback_type === 'not_this_track') {
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
};
"""
    if "saveUserListeningEvent" not in content:
        content += "\n" + functions_addition

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
