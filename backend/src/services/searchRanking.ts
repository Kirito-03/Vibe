export type SearchItemLike = {
  id?: string | number | null;
  youtube_id?: string | number | null;
  sourceId?: string | number | null;
  title?: string | null;
  artist?: string | null;
  uploader?: string | null;
  album?: string | null;
  duration_seconds?: number | null;
  duration?: number | null;
  thumbnail_url?: string | null;
  thumbnail?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  url?: string | null;
  source?: string | null;
};

export type NormalizedQuery = {
  raw: string;
  normalized: string;
  tokens: string[];
};

const keepWords = new Set([
  'cumpleanos',
  'cumpleaños',
  'amor',
  'remix',
  'live',
  'audio',
  'official',
  'anime',
  'opening',
  'op',
  'ost',
  'lofi',
  'study',
  'karaoke',
  'lyrics',
  'letra',
  'cover',
  'mix',
]);

const stopWords = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'o',
  'a',
  'un',
  'una',
  'unos',
  'unas',
  'por',
  'para',
  'con',
  'en',
  'al',
  'the',
  'and',
  'of',
  'to',
]);

const stableKey = (value: unknown) => normalizeText(value).replace(/\s+/g, ' ').trim();

export const normalizeText = (text: unknown) => {
  const raw = String(text ?? '');
  if (!raw) return '';
  const trimmed = raw.trim().toLowerCase();
  const noMarks = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const noBrackets = noMarks.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const cleaned = noBrackets
    .replace(/[’'"]/g, '')
    .replace(/[^a-z0-9\s:/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
};

export const tokenizeQuery = (query: string) => {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const parts = normalized.split(' ').filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (stopWords.has(p) && !keepWords.has(p)) continue;
    if (p.length < 2 && !keepWords.has(p)) continue;
    out.push(p);
  }
  return out.slice(0, 10);
};

export const normalizeSearchQuery = (query: string): NormalizedQuery => {
  const raw = String(query || '').trim();
  const normalized = normalizeText(raw);
  const tokens = tokenizeQuery(raw);
  return { raw, normalized, tokens };
};

const getItemTitle = (item: SearchItemLike) => String(item?.title || '').trim();
const getItemArtist = (item: SearchItemLike) => String(item?.artist || item?.uploader || '').trim();
const getItemAlbum = (item: SearchItemLike) => String((item as any)?.album || '').trim();
const getItemDuration = (item: SearchItemLike) => {
  const d = Number((item as any)?.duration_seconds ?? (item as any)?.duration ?? 0);
  return Number.isFinite(d) && d > 0 ? d : null;
};
const hasCover = (item: SearchItemLike) => {
  const url = String(item?.thumbnail_url || item?.thumbnail || item?.imageUrl || item?.image_url || '').trim();
  return !!url;
};
const getSourceId = (item: SearchItemLike) => {
  const yt = String((item as any)?.youtube_id || '').trim();
  if (yt) return yt;
  const sid = String((item as any)?.sourceId || '').trim();
  if (sid) return sid;
  const id = String((item as any)?.id || '').trim();
  if (id) return id;
  return '';
};

const isLikelyNonMusic = (titleNorm: string) => {
  if (!titleNorm) return true;
  if (/(podcast|episodio|episode|entrevista|interview|trailer|capitulo|capítulo|review|reaccion|reaction|documental|pelicula|película|full movie|serie|cap\s*\d+)/i.test(titleNorm)) return true;
  if (/(playlist|compilation|compilacion|compilación|top\s*\d+|mix completo|full album|album completo)/i.test(titleNorm)) return true;
  if (/\b(1|2|3|4|5|6|7|8|9|10)\s*(hour|hours|hora|horas)\b/i.test(titleNorm)) return true;
  return false;
};

const tokenMatchesText = (token: string, textNorm: string) => {
  if (!token || !textNorm) return false;
  if (textNorm.includes(token)) return true;
  if (token.length >= 4) {
    const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    return re.test(textNorm);
  }
  return false;
};

export const scoreSearchResult = (q: NormalizedQuery, item: SearchItemLike) => {
  const title = getItemTitle(item);
  const artist = getItemArtist(item);
  const album = getItemAlbum(item);
  const dur = getItemDuration(item);
  const titleNorm = normalizeText(title);
  const artistNorm = normalizeText(artist);
  const albumNorm = normalizeText(album);
  const fullNorm = `${artistNorm} ${titleNorm}`.trim();
  const tokens = q.tokens;
  const phrase = q.normalized;

  const matchedTokens: string[] = [];
  let titleMatchCount = 0;
  let fullMatchCount = 0;
  let artistMatchCount = 0;

  for (const t of tokens) {
    const inTitle = tokenMatchesText(t, titleNorm);
    const inArtist = tokenMatchesText(t, artistNorm);
    const inAlbum = tokenMatchesText(t, albumNorm);
    const inFull = inTitle || inArtist || inAlbum || tokenMatchesText(t, fullNorm);
    if (inFull) matchedTokens.push(t);
    if (inTitle) titleMatchCount += 1;
    if (inFull) fullMatchCount += 1;
    if (inArtist) artistMatchCount += 1;
  }

  let score = 0;

  if (phrase && titleNorm.includes(phrase)) score = Math.max(score, 120);
  if (phrase && titleNorm.startsWith(phrase)) score = Math.max(score, 100);

  const allTokensInTitle = tokens.length > 0 && titleMatchCount >= tokens.length;
  const allTokensInFull = tokens.length > 0 && fullMatchCount >= tokens.length;
  if (allTokensInTitle) score = Math.max(score, 80);
  else if (allTokensInFull) score = Math.max(score, 60);

  if (tokens.length > 0) {
    const ratio = matchedTokens.length / tokens.length;
    if (ratio >= 0.66) score = Math.max(score, 40);
    else if (ratio >= 0.5) score = Math.max(score, 25);
  }

  if (artistMatchCount > 0 && tokens.some((t) => t.length >= 4 && !stopWords.has(t))) score += 30;

  const qLooksMusical = !tokens.some((t) => t === 'podcast' || t === 'episodio' || t === 'playlist');
  if (qLooksMusical && /\bofficial\s+(audio|music\s+video)\b/i.test(titleNorm)) score += 20;

  if (hasCover(item)) score += 10;
  if (dur && dur > 0 && dur < 60 * 20) score += 10;

  const wantsKaraoke = tokens.includes('karaoke');
  const wantsLyrics = tokens.includes('lyrics') || tokens.includes('letra');
  const wantsRemix = tokens.includes('remix');
  const wantsCover = tokens.includes('cover');
  const wantsMixOrLive = tokens.includes('mix') || tokens.includes('live');

  if (!wantsKaraoke && /\bkaraoke\b/i.test(titleNorm)) score -= 40;
  if (!wantsLyrics && /\b(lyrics|letra)\b/i.test(titleNorm)) score -= 30;
  if (!wantsRemix && /\bremix\b/i.test(titleNorm)) score -= 30;
  if (!wantsCover && /\bcover\b/i.test(titleNorm)) score -= 30;

  if (dur && dur > 60 * 15 && !wantsMixOrLive) score -= 30;
  if (isLikelyNonMusic(titleNorm) && qLooksMusical) score -= 100;

  const importantTokens = tokens.filter((t) => t.length >= 4 || keepWords.has(t));
  const importantMatched = importantTokens.filter((t) => matchedTokens.includes(t));
  if (importantTokens.length > 0 && importantMatched.length === 0) score -= 80;

  const genericTokens = new Set(['music', 'musica', 'audio', 'official', 'video', 'song', 'new', 'trending', 'hits', 'moments', 'momentos']);
  const nonGenericMatched = matchedTokens.filter((t) => !genericTokens.has(t));
  if (nonGenericMatched.length === 0 && matchedTokens.length === 1) score -= 50;

  return {
    score,
    matchedTokens,
    titleNorm,
    artistNorm,
    fullNorm,
    sourceId: getSourceId(item),
    duration: dur,
    hasCover: hasCover(item),
  };
};

export const dedupeSearchResults = <T extends SearchItemLike>(q: NormalizedQuery, items: T[]) => {
  const bestById = new Map<string, { item: T; score: number; hasCover: boolean; dur: number | null }>();
  const bestByTitle = new Map<string, { item: T; score: number; hasCover: boolean; dur: number | null }>();
  const bestByArtistTitle = new Map<string, { item: T; score: number; hasCover: boolean; dur: number | null }>();
  const pickedByTitleCount = new Map<string, number>();

  const consider = (key: string, candidate: { item: T; score: number; hasCover: boolean; dur: number | null }, map: Map<string, any>) => {
    if (!key) return;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, candidate);
      return;
    }
    if (candidate.score > prev.score) {
      map.set(key, candidate);
      return;
    }
    if (candidate.score === prev.score && candidate.hasCover && !prev.hasCover) {
      map.set(key, candidate);
      return;
    }
    if (candidate.score === prev.score && candidate.hasCover === prev.hasCover && candidate.dur && !prev.dur) {
      map.set(key, candidate);
    }
  };

  for (const it of items) {
    const meta = scoreSearchResult(q, it);
    const titleKey = meta.titleNorm;
    const artistTitleKey = meta.artistNorm && meta.titleNorm ? `${meta.artistNorm}::${meta.titleNorm}` : '';
    const idKey = meta.sourceId ? `id:${meta.sourceId}` : '';
    const durBucket = meta.duration ? Math.round(meta.duration / 5) * 5 : 0;
    const titleDurKey = titleKey ? `td:${titleKey}::${durBucket}` : '';

    const candidate = { item: it, score: meta.score, hasCover: meta.hasCover, dur: meta.duration };
    consider(idKey, candidate, bestById);
    consider(titleDurKey, candidate, bestByTitle);
    consider(artistTitleKey, candidate, bestByArtistTitle);
  }

  const merged = new Map<string, { item: T; score: number; hasCover: boolean; dur: number | null }>();
  for (const m of [bestById, bestByArtistTitle, bestByTitle]) {
    for (const [k, v] of m.entries()) {
      const prev = merged.get(k);
      if (!prev) merged.set(k, v);
      else if (v.score > prev.score) merged.set(k, v);
      else if (v.score === prev.score && v.hasCover && !prev.hasCover) merged.set(k, v);
    }
  }

  const out: Array<T & { _score?: number }> = [];
  const ranked = Array.from(merged.values()).sort((a, b) => b.score - a.score || (b.hasCover ? 1 : 0) - (a.hasCover ? 1 : 0));
  for (const r of ranked) {
    const titleKey = normalizeText(getItemTitle(r.item));
    const count = pickedByTitleCount.get(titleKey) || 0;
    if (titleKey && count >= 2) continue;
    pickedByTitleCount.set(titleKey, count + 1);
    out.push(Object.assign(r.item, { _score: r.score }));
  }
  return out;
};

export const rankSearchResults = <T extends SearchItemLike>(rawQuery: string, items: T[]) => {
  const q = normalizeSearchQuery(rawQuery);
  const scored = items
    .map((it) => ({ it, meta: scoreSearchResult(q, it) }))
    .sort((a, b) => b.meta.score - a.meta.score || (b.meta.hasCover ? 1 : 0) - (a.meta.hasCover ? 1 : 0));

  const minTokens = q.tokens.length;
  const baseMin = minTokens >= 2 ? 20 : 0;
  const relaxedMin = minTokens >= 2 ? 10 : 0;

  const filterBy = (minScore: number) => scored.filter((s) => s.meta.score >= minScore);
  let filtered = filterBy(baseMin);
  if (filtered.length < 8) filtered = filterBy(relaxedMin);
  if (filtered.length < 6) filtered = scored.filter((s) => s.meta.score >= 0);

  const top = filtered.slice(0, 120).map((s) => Object.assign(s.it, { _score: s.meta.score }));
  const deduped = dedupeSearchResults(q, top);
  const final = deduped.filter((it) => typeof (it as any)._score !== 'number' || (it as any)._score >= Math.min(relaxedMin, 10));

  const topScores = filtered.slice(0, 8).map((s) => ({
    title: getItemTitle(s.it),
    artist: getItemArtist(s.it),
    score: s.meta.score,
    matchedTokens: s.meta.matchedTokens.slice(0, 6),
  }));

  return {
    query: q,
    beforeRank: items.length,
    afterRank: final.length,
    topScores,
    items: final.slice(0, 30),
  };
};

