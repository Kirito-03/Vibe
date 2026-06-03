/**
 * searchRanking.ts — Motor de ranking y deduplicación para búsqueda manual
 *
 * SEPARADO de recommendations/radio: aquí se usa precisión alta.
 * Recomendaciones usan rankRecommendationResults (otro archivo).
 *
 * Reglas:
 *  - El mismo videoId solo aparece una vez (aunque venga de convert + catalog + local)
 *  - artist::titleNorm deduplication con elección del mejor duplicado
 *  - Penalizaciones fuertes por slowed/sped up/karaoke/etc. (salvo que el user lo pida)
 *  - Score 0 queda filtrado; score negativo también.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  audioUrl?: string | null;
  file_url?: string | null;
};

export type NormalizedQuery = {
  raw: string;
  normalized: string;
  tokens: string[];
  wantsKaraoke: boolean;
  wantsLyrics: boolean;
  wantsRemix: boolean;
  wantsCover: boolean;
  wantsSlowed: boolean;
  wantsSpedUp: boolean;
  wantsReverb: boolean;
  wantsLive: boolean;
  wantsInstrumental: boolean;
};

// ---------------------------------------------------------------------------
// Palabras stop (artículos/preposiciones)
// ---------------------------------------------------------------------------

const stopWords = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'o', 'a', 'un', 'una',
  'unos', 'unas', 'por', 'para', 'con', 'en', 'al', 'the', 'and', 'of', 'to',
]);

// Palabras que siempre se preservan aunque sean "ruido"
const keepWords = new Set([
  'remix', 'live', 'official', 'anime', 'opening', 'op', 'ost', 'lofi',
  'karaoke', 'lyrics', 'letra', 'cover', 'mix', 'slowed', 'reverb', 'spedup',
  'sped', 'instrumental', 'acoustic', 'unplugged',
]);

// Palabras genéricas que solos no indican coincidencia
const genericTokens = new Set([
  'music', 'musica', 'audio', 'official', 'video', 'song', 'new',
  'trending', 'hits', 'moments', 'momentos', 'mv', 'hd', '4k',
]);

// ---------------------------------------------------------------------------
// Normalización de texto
// ---------------------------------------------------------------------------

export const normalizeText = (text: unknown): string => {
  const raw = String(text ?? '');
  if (!raw) return '';
  return raw
    .trim()
    .toLowerCase()
    // Quitar tildes
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Quitar emojis
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, ' ')
    .replace(/[\u2600-\u27BF]/g, ' ')
    // Quitar contenido entre paréntesis/corchetes solo para comparación
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    // Quitar comillas y símbolos raros
    .replace(/[''"""]/g, '')
    .replace(/[^a-z0-9\s:/.\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/** Normaliza conservando paréntesis (para display/scoring parcial) */
export const normalizeTextFull = (text: unknown): string => {
  const raw = String(text ?? '');
  if (!raw) return '';
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, ' ')
    .replace(/[''"""]/g, '')
    .replace(/[^a-z0-9\s:/.\-()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const tokenizeQuery = (query: string): string[] => {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .filter(Boolean)
    .filter((p) => (stopWords.has(p) ? keepWords.has(p) : p.length >= 2))
    .slice(0, 12);
};

export const normalizeSearchQuery = (query: string): NormalizedQuery => {
  const raw = String(query || '').trim();
  const normalized = normalizeText(raw);
  const tokens = tokenizeQuery(raw);
  const rawLower = raw.toLowerCase();

  return {
    raw,
    normalized,
    tokens,
    wantsKaraoke: /\bkaraoke\b/i.test(rawLower),
    wantsLyrics: /\b(lyrics|letra)\b/i.test(rawLower),
    wantsRemix: /\bremix\b/i.test(rawLower),
    wantsCover: /\bcover\b/i.test(rawLower),
    wantsSlowed: /\bslowed\b/i.test(rawLower),
    wantsSpedUp: /\b(sped\s*up|speed\s*up|speedup)\b/i.test(rawLower),
    wantsReverb: /\breverb\b/i.test(rawLower),
    wantsLive: /\b(live|en\s*vivo|en\s*directo)\b/i.test(rawLower),
    wantsInstrumental: /\binstrumental\b/i.test(rawLower),
  };
};

// ---------------------------------------------------------------------------
// Getters de campos con fallbacks
// ---------------------------------------------------------------------------

const getItemTitle = (item: SearchItemLike) => String(item?.title || '').trim();
const getItemArtist = (item: SearchItemLike) => String(item?.artist || item?.uploader || '').trim();
const getItemDuration = (item: SearchItemLike): number | null => {
  const d = Number((item as any)?.duration_seconds ?? (item as any)?.duration ?? 0);
  return Number.isFinite(d) && d > 0 ? d : null;
};
const hasCover = (item: SearchItemLike): boolean => {
  const url = String(
    item?.thumbnail_url || item?.thumbnail || item?.imageUrl || item?.image_url || ''
  ).trim();
  return !!url && !url.includes('ui-avatars');
};
const hasLocalAudio = (item: SearchItemLike): boolean => {
  const audio = String(item?.audioUrl || (item as any)?.file_url || '').trim();
  return !!audio && /^https?:\/\//i.test(audio) && item?.source === 'local';
};
const getYoutubeId = (item: SearchItemLike): string => {
  const raw =
    String((item as any)?.youtube_id || '').trim() ||
    String((item as any)?.sourceId || '').trim() ||
    String((item as any)?.id || '').trim();
  if (!raw) return '';
  // Extraer de URL si es URL
  try {
    const u = new URL(raw);
    return u.searchParams.get('v') || u.pathname.split('/').pop() || '';
  } catch {
    // Es un ID directo
    return /^[a-zA-Z0-9_-]{8,24}$/.test(raw) ? raw : '';
  }
};

const isLikelyNonMusic = (titleNorm: string): boolean => {
  if (!titleNorm) return true;
  if (
    /(podcast|episodio|episode|entrevista|interview|trailer|capitulo|capítulo|review|reaction|reaccion|documental|pelicula|película|full\s*movie|serie|gameplay|tutorial|walkthrough|vlog|cine|tiktok\s*version)/i.test(
      titleNorm
    )
  )
    return true;
  if (
    /(playlist|compilation|compilacion|top\s*\d+|mix\s*completo|full\s*album|album\s*completo|megamix|enganchados)/i.test(
      titleNorm
    )
  )
    return true;
  if (/\b\d+\s*(hour|hours|hora|horas)\b/i.test(titleNorm)) return true;
  return false;
};

const isOfficialChannel = (artistNorm: string): boolean =>
  /\b(official|music|vevo|records?|entertainment|warner|sony|universal|island|atlantic|republic)\b/i.test(
    artistNorm
  );

// ---------------------------------------------------------------------------
// Matching de tokens
// ---------------------------------------------------------------------------

const tokenMatchesText = (token: string, textNorm: string): boolean => {
  if (!token || !textNorm) return false;
  if (textNorm.includes(token)) return true;
  if (token.length >= 4) {
    const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    return re.test(textNorm);
  }
  return textNorm === token;
};

// ---------------------------------------------------------------------------
// Score principal para búsqueda manual
// ---------------------------------------------------------------------------

export type ScoreResult = {
  score: number;
  matchedTokens: string[];
  titleNorm: string;
  artistNorm: string;
  fullNorm: string;
  youtubeId: string;
  duration: number | null;
  hasCover: boolean;
  hasLocalAudio: boolean;
};

export const scoreSearchResult = (q: NormalizedQuery, item: SearchItemLike): ScoreResult => {
  const title = getItemTitle(item);
  const artist = getItemArtist(item);
  const dur = getItemDuration(item);
  const titleNorm = normalizeText(title);
  const artistNorm = normalizeText(artist);
  const fullNorm = `${artistNorm} ${titleNorm}`.trim();
  const titleFull = normalizeTextFull(title);
  const tokens = q.tokens;
  const phrase = q.normalized;

  const matchedTokens: string[] = [];
  let titleMatchCount = 0;
  let fullMatchCount = 0;
  let artistMatchCount = 0;

  for (const t of tokens) {
    const inTitle = tokenMatchesText(t, titleNorm);
    const inArtist = tokenMatchesText(t, artistNorm);
    const inFull = inTitle || inArtist || tokenMatchesText(t, fullNorm);
    if (inFull) matchedTokens.push(t);
    if (inTitle) titleMatchCount++;
    if (inFull) fullMatchCount++;
    if (inArtist) artistMatchCount++;
  }

  let score = 0;

  // ── Coincidencias positivas ──────────────────────────────────────────────

  // Frase exacta en título (máximo bonus)
  if (phrase && titleNorm.includes(phrase)) score = Math.max(score, 120);
  if (phrase && titleNorm.startsWith(phrase)) score = Math.max(score, 110);

  // Todos los tokens en título
  const allTokensInTitle = tokens.length > 0 && titleMatchCount >= tokens.length;
  const allTokensInFull = tokens.length > 0 && fullMatchCount >= tokens.length;
  if (allTokensInTitle) score = Math.max(score, 90);
  else if (allTokensInFull) score = Math.max(score, 65);

  // Ratio de tokens encontrados
  if (tokens.length > 0) {
    const ratio = matchedTokens.length / tokens.length;
    if (ratio >= 0.75) score = Math.max(score, 45);
    else if (ratio >= 0.5) score = Math.max(score, 28);
  }

  // Artista coincide con tokens importantes
  const importantArtistTokens = tokens.filter((t) => t.length >= 4 && !stopWords.has(t));
  const artistImportantMatched = importantArtistTokens.filter((t) => tokenMatchesText(t, artistNorm));
  if (artistImportantMatched.length > 0) score += 35;
  else if (artistMatchCount > 0) score += 15;

  // Canal oficial
  if (isOfficialChannel(artistNorm) && allTokensInFull) score += 20;

  // Official audio/video bonus (solo si todos los tokens importantes coinciden)
  if (allTokensInFull && /\bofficial\s+(audio|music\s*video|video)\b/i.test(titleFull)) score += 15;

  // Tiene cover e info de duración
  if (hasCover(item)) score += 10;
  if (dur && dur > 0 && dur < 60 * 20) score += 8;

  // Tiene audio local descargado (priorizar)
  if (hasLocalAudio(item)) score += 25;
  else if (item?.source === 'local') score += 12;

  // ── Penalizaciones ───────────────────────────────────────────────────────

  // Contenido que no es música (fuerte)
  if (isLikelyNonMusic(titleNorm)) score -= 100;

  // Solo coincide 1 token genérico
  const nonGenericMatched = matchedTokens.filter((t) => !genericTokens.has(t));
  if (nonGenericMatched.length === 0 && matchedTokens.length <= 1) score -= 55;

  // Tokens importantes sin coincidencia (búsqueda muy irrelevante)
  const importantTokens = tokens.filter((t) => t.length >= 4 || keepWords.has(t));
  const importantMatched = importantTokens.filter((t) => matchedTokens.includes(t));
  if (importantTokens.length > 0 && importantMatched.length === 0) score -= 85;
  else if (importantTokens.length > 1 && importantMatched.length < importantTokens.length / 2) score -= 40;

  // Variantes no deseadas (solo penalizar si el usuario NO las pidió)
  if (!q.wantsKaraoke && /\bkaraoke\b/i.test(titleFull)) score -= 50;
  if (!q.wantsInstrumental && /\binstrumental\b/i.test(titleFull)) score -= 45;
  if (!q.wantsCover && /\bcover\b/i.test(titleFull)) score -= 40;
  if (!q.wantsSlowed && /\bslowed\b/i.test(titleFull)) score -= 40;
  if (!q.wantsSpedUp && /\bsped\s*up\b/i.test(titleFull)) score -= 40;
  if (!q.wantsReverb && /\breverb\b/i.test(titleFull)) score -= 35;
  if (!q.wantsRemix && /\bremix\b/i.test(titleFull)) score -= 30;
  if (!q.wantsLyrics && /\b(lyrics|letra)\b/i.test(titleFull)) score -= 25;
  if (!q.wantsLive && /\b(live|en\s*vivo|en\s*directo|concierto|concert)\b/i.test(titleFull)) score -= 20;

  // Duración extrema (probablemente playlist o clip)
  if (dur && dur > 60 * 15) score -= 30;
  if (dur && dur < 30) score -= 25;

  return {
    score,
    matchedTokens,
    titleNorm,
    artistNorm,
    fullNorm,
    youtubeId: getYoutubeId(item),
    duration: dur,
    hasCover: hasCover(item),
    hasLocalAudio: hasLocalAudio(item),
  };
};

// ---------------------------------------------------------------------------
// Deduplicación fuerte — elige el mejor candidato por cada clave
// ---------------------------------------------------------------------------

type Candidate<T> = {
  item: T;
  score: number;
  hasCover: boolean;
  hasLocalAudio: boolean;
  dur: number | null;
  youtubeId: string;
};

const isBetterCandidate = <T>(next: Candidate<T>, prev: Candidate<T>): boolean => {
  // 1. Score mayor
  if (next.score > prev.score) return true;
  if (next.score < prev.score) return false;
  // 2. Tiene audio local
  if (next.hasLocalAudio && !prev.hasLocalAudio) return true;
  if (!next.hasLocalAudio && prev.hasLocalAudio) return false;
  // 3. Tiene cover
  if (next.hasCover && !prev.hasCover) return true;
  if (!next.hasCover && prev.hasCover) return false;
  // 4. Tiene duración
  if (next.dur && !prev.dur) return true;
  // 5. Tiene youtubeId válido
  if (next.youtubeId && !prev.youtubeId) return true;
  return false;
};

export const getTrackDedupeKeys = (item: SearchItemLike, meta: ScoreResult): string[] => {
  const keys: string[] = [];

  // 1. YouTube ID (más fuerte)
  const ytId = meta.youtubeId || getYoutubeId(item);
  if (ytId) {
    keys.push(`yt:${ytId}`);
  }

  // 2. Artist + title normalizado
  if (meta.artistNorm && meta.titleNorm) {
    keys.push(`at:${meta.artistNorm}::${meta.titleNorm}`);
  }

  // 3. Title + duración en bucket de 5s (detecta misma canción de diferentes artistas/canales)
  if (meta.titleNorm) {
    const durBucket = meta.duration ? Math.round(meta.duration / 5) * 5 : -1;
    if (durBucket >= 0) {
      keys.push(`td:${meta.titleNorm}::${durBucket}`);
    }
    // 4. Solo título (último recurso, sin duración)
    keys.push(`t:${meta.titleNorm}`);
  }

  return keys;
};

export const dedupeSearchResults = <T extends SearchItemLike>(
  q: NormalizedQuery,
  items: T[]
): T[] => {
  // Mapa de clave → mejor candidato
  const bestByKey = new Map<string, Candidate<T>>();
  // Registro de qué items ya fueron "ganados" en alguna clave
  const wonItems = new WeakSet<object>();

  // Primer pasada: construir el mejor candidato por cada clave
  for (const item of items) {
    const meta = scoreSearchResult(q, item);
    const keys = getTrackDedupeKeys(item, meta);
    const candidate: Candidate<T> = {
      item,
      score: meta.score,
      hasCover: meta.hasCover,
      hasLocalAudio: meta.hasLocalAudio,
      dur: meta.duration,
      youtubeId: meta.youtubeId,
    };

    for (const key of keys) {
      const prev = bestByKey.get(key);
      if (!prev || isBetterCandidate(candidate, prev)) {
        bestByKey.set(key, candidate);
      }
    }
  }

  // Segunda pasada: emitir solo un item por grupo de claves compartidas
  const out: T[] = [];
  const emittedItems = new WeakSet<object>();
  // Ordenar por score desc antes de emitir
  const allCandidates = Array.from(bestByKey.values());
  allCandidates.sort((a, b) => b.score - a.score || (b.hasCover ? 1 : 0) - (a.hasCover ? 1 : 0));

  // Límite por título: máximo 1 resultado por título normalizado (salvo que sean artistas distintos)
  const titleArtistCount = new Map<string, number>();

  for (const candidate of allCandidates) {
    const item = candidate.item as object;
    if (emittedItems.has(item)) continue;

    // Verificar límite de duplicados por título (permite máximo 1 si artist es diferente)
    const meta = scoreSearchResult(q, candidate.item);
    const titleKey = meta.titleNorm;
    const artistKey = meta.artistNorm;
    const taKey = `${titleKey}::${artistKey}`;

    const prevCount = titleArtistCount.get(titleKey) || 0;
    if (prevCount >= 1) {
      // Permitir si el artista es diferente al ya emitido, pero limitar a 2 total
      const taCount = titleArtistCount.get(taKey) || 0;
      if (taCount >= 1 || prevCount >= 2) continue;
    }

    emittedItems.add(item);
    wonItems.add(item);
    titleArtistCount.set(titleKey, (titleArtistCount.get(titleKey) || 0) + 1);
    titleArtistCount.set(taKey, (titleArtistCount.get(taKey) || 0) + 1);
    out.push(Object.assign(candidate.item, { _score: candidate.score }));
  }

  return out;
};

// ---------------------------------------------------------------------------
// Ranking completo para búsqueda manual
// ---------------------------------------------------------------------------

export const rankSearchResults = <T extends SearchItemLike>(
  rawQuery: string,
  items: T[]
): {
  query: NormalizedQuery;
  beforeRank: number;
  afterRank: number;
  topScores: Array<{ title: string; artist: string; score: number; matchedTokens: string[] }>;
  items: Array<T & { _score?: number }>;
} => {
  const q = normalizeSearchQuery(rawQuery);

  // 1. Score todos los items
  const scored = items
    .map((it) => ({ it, meta: scoreSearchResult(q, it) }))
    .sort(
      (a, b) =>
        b.meta.score - a.meta.score ||
        (b.meta.hasCover ? 1 : 0) - (a.meta.hasCover ? 1 : 0) ||
        (b.meta.hasLocalAudio ? 1 : 0) - (a.meta.hasLocalAudio ? 1 : 0)
    );

  // 2. Filtrar por score mínimo (flexible según longitud de query)
  const minTokens = q.tokens.length;
  const baseMin = minTokens >= 2 ? 20 : 0;
  const relaxedMin = minTokens >= 2 ? 10 : 0;

  let filtered = scored.filter((s) => s.meta.score >= baseMin);
  if (filtered.length < 6) filtered = scored.filter((s) => s.meta.score >= relaxedMin);
  if (filtered.length < 4) filtered = scored.filter((s) => s.meta.score >= 0);

  // 3. Tomar top 120 para deduplicar
  const top = filtered.slice(0, 120).map((s) =>
    Object.assign(s.it, { _score: s.meta.score })
  );

  console.log('[search/dedupe] before=' + top.length);

  // 4. Deduplicación fuerte
  const deduped = dedupeSearchResults(q, top);

  console.log('[search/dedupe] after=' + deduped.length + ' removed=' + (top.length - deduped.length));

  // 5. Filtro final de score mínimo
  const final = deduped.filter(
    (it) => typeof (it as any)._score !== 'number' || (it as any)._score >= Math.min(relaxedMin, 5)
  );

  const topScores = filtered.slice(0, 10).map((s) => ({
    title: getItemTitle(s.it),
    artist: getItemArtist(s.it),
    score: s.meta.score,
    matchedTokens: s.meta.matchedTokens.slice(0, 8),
  }));

  return {
    query: q,
    beforeRank: items.length,
    afterRank: final.length,
    topScores,
    items: final.slice(0, 30),
  };
};
