import type { MusicTasteProfile } from './deepseekRecommendations';
import { normalizeText } from './searchRanking';
import { isLikelyMusicTrack } from '../utils/trackQuality';

export type RecommendationItemLike = {
  id?: string | number | null;
  youtube_id?: string | number | null;
  sourceId?: string | number | null;
  title?: string | null;
  artist?: string | null;
  uploader?: string | null;
  duration_seconds?: number | null;
  duration?: number | null;
  thumbnail_url?: string | null;
  thumbnail?: string | null;
  url?: string | null;
  source?: string | null;
};

const stop = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'o', 'a', 'the', 'and', 'of', 'to', 'for']);

const tokenize = (raw: string) => {
  const n = normalizeText(raw);
  if (!n) return [];
  return n
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stop.has(t))
    .slice(0, 10);
};

const getTitle = (it: RecommendationItemLike) => String(it?.title || '').trim();
const getArtist = (it: RecommendationItemLike) => String(it?.artist || it?.uploader || '').trim();

export const rankRecommendationResults = <T extends RecommendationItemLike>(opts: {
  seed?: string;
  items: T[];
  profile?: MusicTasteProfile | null;
}) => {
  const seedTokens = tokenize(opts.seed || '');
  const topArtistTokens = (opts.profile?.topArtists || []).slice(0, 6).map((a) => normalizeText(a)).filter(Boolean);

  const scored = opts.items.map((it) => {
    const titleNorm = normalizeText(getTitle(it));
    const artistNorm = normalizeText(getArtist(it));
    const fullNorm = `${artistNorm} ${titleNorm}`.trim();

    let score = 0;

    for (const t of seedTokens) {
      if (titleNorm.includes(t)) score += 8;
      else if (fullNorm.includes(t)) score += 5;
    }

    for (const a of topArtistTokens) {
      if (a && artistNorm && (artistNorm === a || artistNorm.includes(a))) score += 12;
    }

    if (/\bofficial\s+(audio|music\s+video)\b/i.test(titleNorm)) score += 3;
    if (String(it?.thumbnail_url || it?.thumbnail || '').trim()) score += 2;
    
    if (!isLikelyMusicTrack(it.title, it.artist)) score -= 1000;

    return { it, score, titleNorm, artistNorm };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > -500).map((s) => s.it);
};

