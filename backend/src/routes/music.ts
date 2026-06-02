import { Router } from 'express';
import pool from '../db';
import axios from 'axios';
import { admin } from '../firebase';
import type { ItemsResponse, ItemsSource } from '../utils/response';
import { isWorkerEnabled, searchWithWorker, workerHealth } from '../services/mediaWorkerClient';
import { computeMusicProfileHash, generateMusicSeedsWithDeepSeek, mixQueries, type MusicTasteProfile } from '../services/deepseekRecommendations';
import { getSearchQueryAlternatives } from '../services/searchAiAssist';
import { normalizeSearchQuery, normalizeText as normalizeSearchText, rankSearchResults } from '../services/searchRanking';
import { rankRecommendationResults } from '../services/recommendationRanking';
import {
  clearUserRecommendationCache,
  clearUserSeenTracks,
  getBlockedArtists,
  getBlockedTrackKeys,
  getGlobalCatalogRecommendations,
  getPositiveSeeds,
  getUserRecommendationCache,
  getUserRecentlySeenTrackKeys,
  markUserSeenTracks,
  saveRecommendationFeedback,
  saveUserRecommendationCache,
  upsertGlobalCatalogTracks,
} from '../services/recommendationStore';

const router = Router();
const normalizeBaseUrl = (raw: string) => raw.replace(/\/+$/, '');
const getConvertTimeoutMs = () => {
  const raw = Number.parseInt(process.env.CONVERT_TIMEOUT_MS || '20000', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 20000;
};
const convertTimeoutMs = getConvertTimeoutMs();
const getSeenTtlHours = () => {
  const raw = Number.parseInt(process.env.RECOMMENDATION_SEEN_TTL_HOURS || '24', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
};
const isDockerLike = () => {
  const base = String(process.env.CONVERT_URL || process.env.DOWNLOADER_URL || '').toLowerCase();
  if (process.env.DB_HOST === 'db') return true;
  if (base.includes('://convert:')) return true;
  return false;
};
const downloaderUrls = (() => {
  const envUrls = [process.env.CONVERT_URL, process.env.DOWNLOADER_URL]
    .filter((u): u is string => Boolean(u))
    .map((u) => normalizeBaseUrl(u));
  const candidates = isDockerLike()
    ? [...envUrls, 'http://convert:8000']
    : ['http://localhost:8000', 'http://127.0.0.1:8000', ...envUrls, 'http://convert:8000'];
  return candidates.filter((url, index, arr): url is string => Boolean(url) && arr.indexOf(url) === index);
})();
const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase();
const makeReqId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const truncate = (value: unknown, max = 120) => {
  const s = String(value ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
};
const serializeError = (error: any) => ({
  name: error?.name,
  message: error?.message,
  code: error?.code,
  status: error?.response?.status,
});
const isDev = () => String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
const normalizeKey = (value: unknown) => normalizeText(value).replace(/\s+/g, ' ').trim();
const getItemYoutubeId = (it: any) => String(it?.youtube_id || it?.id || '').trim();
const getItemArtist = (it: any) => String(it?.artist || it?.uploader || '').trim();
const getItemTitle = (it: any) => String(it?.title || '').trim();
const buildDedupKeys = (it: any) => {
  const yt = getItemYoutubeId(it);
  const titleNorm = normalizeKey(getItemTitle(it));
  const artistNorm = normalizeKey(getItemArtist(it));
  const titleArtistKey = artistNorm && titleNorm ? `${artistNorm}::${titleNorm}` : '';
  const audioUrl = String(it?.audioUrl || it?.audio_url || it?.file_url || '').trim();
  const audioKey = audioUrl ? normalizeKey(audioUrl) : '';
  const primary = yt ? `yt:${yt}` : titleArtistKey ? `ta:${titleArtistKey}` : titleNorm ? `t:${titleNorm}` : '';
  return { primary, yt, titleNorm, artistNorm, titleArtistKey, audioKey };
};
const dedupeAndFilterItems = (
  items: any[],
  exclude: {
    ytIds: Set<string>;
    titleKeys: Set<string>;
    titleArtistKeys: Set<string>;
    audioKeys: Set<string>;
    blockedTrackKeys?: Set<string>;
    blockedArtists?: Set<string>;
  }
) => {
  const out: any[] = [];
  const seenPrimary = new Set<string>();
  const seenYt = new Set<string>();
  const seenTitle = new Set<string>();
  const seenTitleArtist = new Set<string>();
  const seenAudio = new Set<string>();
  let skippedDuplicates = 0;

  for (const it of items) {
    const k = buildDedupKeys(it);
    const ytId = k.yt;
    const itemTrackKey = ytId ? `yt:${ytId}` : k.primary;
    if (exclude.blockedTrackKeys && itemTrackKey && exclude.blockedTrackKeys.has(itemTrackKey)) {
      skippedDuplicates++;
      continue;
    }
    if (exclude.blockedTrackKeys && ytId && exclude.blockedTrackKeys.has(ytId)) {
      skippedDuplicates++;
      continue;
    }
    if (exclude.blockedArtists) {
      const artistKey = k.artistNorm || normalizeKey(getItemArtist(it));
      if (artistKey && exclude.blockedArtists.has(artistKey)) {
        skippedDuplicates++;
        continue;
      }
    }
    if (ytId && exclude.ytIds.has(ytId)) {
      skippedDuplicates++;
      continue;
    }
    if (k.titleNorm && exclude.titleKeys.has(k.titleNorm)) {
      skippedDuplicates++;
      continue;
    }
    if (k.titleArtistKey && exclude.titleArtistKeys.has(k.titleArtistKey)) {
      skippedDuplicates++;
      continue;
    }
    if (k.audioKey && exclude.audioKeys.has(k.audioKey)) {
      skippedDuplicates++;
      continue;
    }

    if (k.primary && seenPrimary.has(k.primary)) {
      skippedDuplicates++;
      continue;
    }
    if (ytId && (seenYt.has(ytId) || seenPrimary.has(`yt:${ytId}`))) {
      skippedDuplicates++;
      continue;
    }
    if (k.titleNorm && seenTitle.has(k.titleNorm)) {
      skippedDuplicates++;
      continue;
    }
    if (k.titleArtistKey && seenTitleArtist.has(k.titleArtistKey)) {
      skippedDuplicates++;
      continue;
    }
    if (k.audioKey && seenAudio.has(k.audioKey)) {
      skippedDuplicates++;
      continue;
    }

    if (k.primary) seenPrimary.add(k.primary);
    if (ytId) seenYt.add(ytId);
    if (k.titleNorm) seenTitle.add(k.titleNorm);
    if (k.titleArtistKey) seenTitleArtist.add(k.titleArtistKey);
    if (k.audioKey) seenAudio.add(k.audioKey);
    out.push(it);
  }

  return { items: out, dedupedCount: items.length - out.length, skippedDuplicates };
};
const isNonMusicTitle = (title: string, uploader?: string) => {
  const t = normalizeText(title);
  const u = normalizeText(uploader);
  if (!t) return true;
  if (/(^|\s)#?shorts(\s|$)/.test(t) || /(^|\s)#?shorts(\s|$)/.test(u)) return true;
  
  // Términos estrictamente prohibidos (películas, tutoriales, contenido hablado, anime episodes, etc.)
  const filterRegex = /(^|\s)(tutorial|tutoriales|how to|curso|clase|lesson|gu[ií]a|review|an[áa]lisis|reaction|reacci[oó]n|gameplay|trailer|entrevista|interview|podcast|episode|episodio|ep\.|ep\s*#|cap[ií]tulo|capitulo|live|en vivo|directo|conferencia|stream|walkthrough|speedrun|vlog|pelicula|película|completa|full movie|movie|instagram reels|reels|tiktok|sonidos de reels|troll|trolleo|broma|prank|chiste|humor|risa|meme|parodia|shitpost|whatsapp|chat|reto|challenge|short|shorts|edit|edits|flp|fl studio|type beat|remake|historia|historias|history|responde|respond|explicaci[oó]n|analiza|tiradera|noticia|news|chisme|documentary|documental|biograf[ií]a|mensaje|mensajes|escena|scene|doblaje|temporada|season|clip|doblado|subtitulado|latino|español latino|castellano|te lo resumo|resumen|netflix|hbo|disney|prime video|cine|movies|peliculas|películas|dragon ball|naruto|one piece|surgimento|parte|part|pt\.)(\s|$)/;
  
  if (filterRegex.test(t) || filterRegex.test(u)) return true;
  if (t.includes('in spotify') || t.includes('tiktok version') || t.includes('tiktok remix')) return true;
  
  // Canales que usualmente suben películas o cosas no musicales
  const badChannels = ['netflix', 'hbo', 'disney', 'prime video', 'cine', 'movies', 'clips', 'televisa', 'tv azteca', 'caracol', 'rcn', 'noticias', 'news', 'crunchyroll'];
  if (u && badChannels.some(bc => u.includes(bc))) return true;

  return t.includes('karaoke') || 
         t.includes('8d') || 
         /(^|\s)mix(\s|$)/.test(t) || 
         t.includes('megamix') || 
         t.includes('playlist') || 
         t.includes('top') || 
         t.includes('mejores') || 
         t.includes('éxitos') || 
         t.includes('exitos') || 
         t.includes('recopilación') ||
         t.includes('recopilacion') ||
         t.includes('colección') ||
         t.includes('coleccion') ||
         t.includes('canciones de') ||
         t.includes('enganchados') ||
         t.includes('youtube');
};
const parseDurationSeconds = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
};
const extractYoutubeId = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    }
    if (host.endsWith('youtube.com')) {
      return parsed.searchParams.get('v')
        ?? parsed.pathname.split('/')[2]
        ?? '';
    }
  } catch {
    return raw.includes('/') ? '' : raw;
  }
  return '';
};
const cleanSongTitle = (title: string): string => {
  return title
    .replace(/\s*[-|]*\s*youtube\s*music\s*/i, '')
    .replace(/\s*[-|]*\s*youtube\s*/i, '')
    .replace(/\s*[-|]*\s*official\s*music\s*video\s*/i, '')
    .replace(/\s*[-|]*\s*official\s*video\s*/i, '')
    .replace(/\s*[-|]*\s*official\s*audio\s*/i, '')
    .replace(/\s*[-|]*\s*oficial\s*/i, '')
    .replace(/\s*[-|]*\s*official\s*/i, '')
    .replace(/\s*[-|]*\s*lyric\s*video\s*/i, '')
    .replace(/\s*[-|]*\s*lyrics\s*/i, '')
    .replace(/\s*[-|]*\s*music\s*video\s*/i, '')
    .replace(/\s*\(official\s*video\)/i, '')
    .replace(/\s*\[official\s*video\]/i, '')
    .replace(/\s*\(official\s*audio\)/i, '')
    .replace(/\s*\[official\s*audio\]/i, '')
    .replace(/\s*\(lyric\s*video\)/i, '')
    .replace(/\s*\[lyric\s*video\]/i, '')
    .replace(/\s*\(lyrics\)/i, '')
    .replace(/\s*\[lyrics\]/i, '')
    .trim();
};

const adaptYouTubeRows = (rows: any[], localKeys: Set<string>, localYoutubeIds: Set<string>, localMap?: Map<string, any>) => {
  const seenYoutube = new Set<string>();
  const debug = process.env.MUSIC_FILTER_DEBUG === 'true';
  const rejected: any[] = [];
  const filtered = rows.filter((yt: any) => {
    const ytTitle = normalizeText(yt.title);
    if (!ytTitle) {
      if (debug) rejected.push({ reason: 'empty_title', title: yt.title, uploader: yt.uploader ?? yt.artist });
      return false;
    }
    const ytArtist = normalizeText(yt.uploader ?? yt.artist);
    if (isNonMusicTitle(ytTitle, ytArtist)) {
      if (debug) rejected.push({ reason: 'non_music', title: yt.title, uploader: yt.uploader ?? yt.artist });
      return false;
    }
    const dur = parseDurationSeconds(yt.duration_seconds ?? yt.lengthSeconds ?? yt.duration);
    // Relaxed duration filter: from 1 min to 10 mins to include more songs
    if (dur > 0 && (dur < 60 || dur > 600)) {
      if (debug) rejected.push({ reason: 'duration', duration: dur, title: yt.title, uploader: yt.uploader ?? yt.artist });
      return false;
    }
    const ytKey = `${ytTitle}::${ytArtist}`;
    const ytId = extractYoutubeId(yt.youtube_id ?? yt.id ?? yt.url);
    
    // Si pasamos localMap, NO filtramos las que están en backend porque las vamos a "transformar" en canciones locales.
    if (!localMap && ((ytId && localYoutubeIds.has(ytId)) || localKeys.has(ytKey) || (ytId && seenYoutube.has(ytId)))) {
      return false;
    }
    
    if (localMap && ytId && seenYoutube.has(ytId)) return false;
    
    if (ytId) {
      seenYoutube.add(ytId);
    }
    return true;
  });
  if (debug && rejected.length > 0) {
    console.log('[music/filter] rejected_sample', rejected.slice(0, 6).map((r) => ({
      reason: r.reason,
      duration: r.duration,
      title: truncate(r.title, 90),
      uploader: truncate(r.uploader, 60),
    })));
  }
  return filtered.map((yt: any) => {
    const ytId = extractYoutubeId(yt.youtube_id ?? yt.id ?? yt.url);
    
    if (localMap && ytId && localMap.has(ytId)) {
       const dbRow = localMap.get(ytId);
       return {
         id: dbRow.id,
         youtube_id: dbRow.youtube_id,
         title: dbRow.title,
         artist: dbRow.uploader,
         uploader: dbRow.uploader,
         duration: dbRow.duration,
         duration_seconds: dbRow.duration,
         thumbnail: dbRow.thumbnail,
         thumbnail_url: dbRow.thumbnail,
         url: dbRow.url || `/api/downloads/stream/${dbRow.id}`,
         source: 'local'
       };
    }

    return {
      id: ytId,
      youtube_id: ytId,
      title: cleanSongTitle(yt.title),
      artist: cleanSongTitle(yt.uploader ?? yt.artist ?? 'Internet'),
      uploader: cleanSongTitle(yt.uploader ?? yt.artist ?? 'Internet'),
      duration: parseDurationSeconds(yt.duration_seconds ?? yt.lengthSeconds ?? yt.duration),
      duration_seconds: parseDurationSeconds(yt.duration_seconds ?? yt.lengthSeconds ?? yt.duration),
      thumbnail: yt.thumbnail_url ?? yt.thumbnail ?? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      thumbnail_url: yt.thumbnail_url ?? yt.thumbnail ?? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      url: yt.url ?? `https://www.youtube.com/watch?v=${ytId}`,
      source: 'youtube',
    };
  });
};

const isPlaceholderThumbnail = (value: unknown) => {
  const v = normalizeText(value);
  if (!v) return true;
  if (v.includes('ui-avatars')) return true;
  if (v.endsWith('/vn') || v.includes('vn.png') || v.includes('vns')) return false;
  return false;
};

const needsHealDownload = (row: any) => {
  const ytId = String(row?.youtube_id ?? '').trim();
  if (ytId === 'legado_vns') return true;
  const thumb = row?.thumbnail ?? row?.thumbnail_url ?? row?.image_url;
  if (typeof thumb === 'string' && thumb.includes('ui-avatars')) return true;
  if (!thumb) return true;
  return false;
};

const withTimeout = async <T>(p: Promise<T>, ms: number) => {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const findBestYoutubeMatch = async (query: string) => {
  const q = String(query || '').trim();
  if (!q) return null;

  for (const pyUrl of downloaderUrls) {
    try {
      const response = await axios.get(`${pyUrl}/search`, {
        timeout: convertTimeoutMs,
        params: { q, limit: 5 },
      });
      const data = response.data;
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        const ytId = extractYoutubeId(first.youtube_id ?? first.id ?? first.url);
        if (!ytId) continue;
        return {
          youtube_id: ytId,
          uploader: cleanSongTitle(first.uploader ?? first.artist ?? first.author ?? first.channel ?? 'Internet'),
          duration: parseDurationSeconds(first.duration_seconds ?? first.lengthSeconds ?? first.duration),
          thumbnail: first.thumbnail_url ?? first.thumbnail ?? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${ytId}`,
        };
      }
    } catch {}
  }

  try {
    const rows = await searchInvidious(q, 5);
    if (Array.isArray(rows) && rows.length > 0) {
      const first = rows[0];
      const ytId = extractYoutubeId(first.youtube_id ?? first.id ?? first.url);
      if (!ytId) return null;
      return {
        youtube_id: ytId,
        uploader: cleanSongTitle(first.uploader ?? 'Internet'),
        duration: parseDurationSeconds(first.duration_seconds),
        thumbnail: first.thumbnail_url ?? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${ytId}`,
      };
    }
  } catch {}

  try {
    const rows = await searchDuckDuckGoForYoutube(q, 5);
    if (Array.isArray(rows) && rows.length > 0) {
      const first = rows[0];
      const ytId = extractYoutubeId(first.youtube_id ?? first.id ?? first.url);
      if (!ytId) return null;
      return {
        youtube_id: ytId,
        uploader: cleanSongTitle(first.uploader ?? first.artist ?? 'Internet'),
        duration: parseDurationSeconds(first.duration_seconds),
        thumbnail: first.thumbnail_url ?? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${ytId}`,
      };
    }
  } catch {}

  return null;
};

const healDownloadRow = async (row: any) => {
  if (!row?.id || !needsHealDownload(row)) return row;
  const title = String(row.title ?? '').trim();
  const uploader = String(row.uploader ?? row.artist ?? '').trim();
  const q = uploader ? `${title} ${uploader}` : title;
  const match = await findBestYoutubeMatch(q);
  if (!match) return row;

  try {
    await pool.query(
      `UPDATE Downloads
       SET youtube_id = $1,
           uploader = COALESCE(NULLIF($2, ''), uploader),
           duration = COALESCE(NULLIF($3, 0), duration),
           thumbnail = COALESCE(NULLIF($4, ''), thumbnail)
       WHERE id = $5`,
      [match.youtube_id, match.uploader, match.duration, match.thumbnail, row.id]
    );
  } catch (e) {
    console.error('[auto-healer] update failed', e);
  }

  return {
    ...row,
    youtube_id: match.youtube_id,
    uploader: match.uploader || row.uploader,
    artist: match.uploader || row.uploader,
    duration: match.duration || row.duration,
    duration_seconds: match.duration || row.duration,
    thumbnail: match.thumbnail,
    thumbnail_url: match.thumbnail,
  };
};

const searchInvidious = async (query: string, limit: number) => {
  try {
    const instancesRes = await axios.get('https://api.invidious.io/instances.json?sort_by=health', {
      timeout: 5000,
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    const instances = instancesRes.data;
    if (!Array.isArray(instances)) return [];

    for (const item of instances) {
      const host = item?.[0];
      const meta = item?.[1];
      if (!host || meta?.api === false || meta?.type !== 'https') continue;
      try {
        const searchUrl = `https://${host}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
        const res = await axios.get(searchUrl, {
          timeout: 5000,
          headers: { 'user-agent': 'Mozilla/5.0' },
        });
        const rows = res.data;
        if (!Array.isArray(rows) || rows.length === 0) continue;
        return rows.slice(0, limit).map((row: any) => ({
          id: row.videoId ?? row.id,
          title: row.title,
          uploader: row.author,
          duration_seconds: row.lengthSeconds,
          thumbnail_url: row.videoThumbnails?.[0]?.url ?? null,
          url: row.videoId ? `https://www.youtube.com/watch?v=${row.videoId}` : undefined,
          youtube_id: row.videoId ?? row.id,
          source: 'youtube',
        }));
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return [];
};
const decodeHtml = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const searchDuckDuckGoForYoutube = async (query: string, limit: number) => {
  try {
    const response = await axios.get(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(`${query} site:youtube.com`)}`,
      {
        timeout: 6000,
        headers: { 'user-agent': 'Mozilla/5.0' },
        responseType: 'text',
      }
    );
    const html = String(response.data ?? '');
    const anchorRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gm;
    const rows: any[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = anchorRegex.exec(html)) !== null && rows.length < limit) {
      const href = match[1];
      const rawTitle = match[2]?.replace(/<[^>]+>/g, '').trim();
      const title = decodeHtml(rawTitle || '');
      if (!title) continue;

      let candidateUrl = decodeHtml(href);
      if (candidateUrl.startsWith('//')) {
        candidateUrl = `https:${candidateUrl}`;
      }
      try {
        const parsed = new URL(candidateUrl);
        const redirected = parsed.searchParams.get('uddg');
        if (redirected) {
          candidateUrl = decodeURIComponent(redirected);
        }
      } catch {
        continue;
      }

      const ytId = extractYoutubeId(candidateUrl);
      if (!ytId || seen.has(ytId)) continue;
      seen.add(ytId);

      rows.push({
        id: ytId,
        youtube_id: ytId,
        title,
        uploader: 'YouTube',
        duration_seconds: null,
        thumbnail_url: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${ytId}`,
        source: 'youtube',
      });
    }

    return rows;
  } catch {
    return [];
  }
};

const readBodyAsJson = (req: any) => {
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
  return finalBody as any;
};

const buildTrackKeyFromInput = (track: any) => {
  const yt = String(track?.youtube_id || track?.youtubeId || track?.sourceId || track?.id || '').trim();
  const src = String(track?.source || '').trim();
  if (yt) return src === 'local' ? `local:${yt}` : `yt:${yt}`;
  const title = normalizeKey(track?.title);
  const artist = normalizeKey(track?.artist || track?.uploader);
  if (artist && title) return `k:${title}::${artist}`;
  if (title) return `k:${title}`;
  return '';
};

router.post('/recommendation-feedback', async (req, res) => {
  const uid = String((req as any)?.user?.uid || '').trim();
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const body = readBodyAsJson(req);
  const track = (body as any)?.track || null;
  const feedbackType = String((body as any)?.feedbackType || '').trim();
  if (!track || !feedbackType) return res.status(400).json({ error: 'Invalid body' });

  const trackKey = buildTrackKeyFromInput(track);
  const youtubeId = String(track?.youtube_id || track?.youtubeId || track?.id || '').trim() || null;
  const title = String(track?.title || '').trim();
  const artist = String(track?.artist || track?.uploader || '').trim() || null;
  const metadata = (body as any)?.metadata || {};

  if (!trackKey || !title) return res.status(400).json({ error: 'Missing track data' });
  if (!['more_like_this', 'not_this_track', 'not_this_artist', 'not_this_genre'].includes(feedbackType)) {
    return res.status(400).json({ error: 'Invalid feedbackType' });
  }

  await saveRecommendationFeedback({
    uid,
    trackKey,
    youtubeId,
    title,
    artist,
    feedbackType: feedbackType as any,
    metadata,
  });

  console.log('[recommendation-feedback]', { uid: 'yes', type: feedbackType, track: youtubeId ? youtubeId : trackKey });
  return res.json({ ok: true });
});

router.post('/seen-tracks', async (req, res) => {
  const uid = String((req as any)?.user?.uid || '').trim();
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const body = readBodyAsJson(req);
  const items = Array.isArray((body as any)?.items) ? (body as any).items : [];
  const reason = String((body as any)?.reason || 'home').trim() || 'home';
  if (!Array.isArray(items) || items.length === 0) return res.json({ ok: true, marked: 0 });
  await markUserSeenTracks({ uid, items, reason });
  return res.json({ ok: true, marked: Math.min(items.length, 120) });
});

router.delete('/seen-tracks', async (req, res) => {
  const uid = String((req as any)?.user?.uid || '').trim();
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const body = readBodyAsJson(req);
  const confirm = String((body as any)?.confirm || '').trim();
  if (confirm !== 'CLEAR_SEEN_TRACKS') return res.status(400).json({ error: 'Missing or invalid confirm', required: 'CLEAR_SEEN_TRACKS' });
  const result = await clearUserSeenTracks(uid);
  console.log('[seen-tracks] cleared', { uid: 'yes', deleted: result.deleted });
  return res.json({ ok: true, deleted: result.deleted });
});

router.delete('/recommendation-cache', async (req, res) => {
  const uid = String((req as any)?.user?.uid || '').trim();
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const body = readBodyAsJson(req);
  const confirm = String((body as any)?.confirm || '').trim();
  if (confirm !== 'CLEAR_RECOMMENDATION_CACHE') {
    return res.status(400).json({ error: 'Missing or invalid confirm', required: 'CLEAR_RECOMMENDATION_CACHE' });
  }
  const result = await clearUserRecommendationCache(uid);
  console.log('[recommendation-cache] cleared', { uid: 'yes', deleted: result.deleted });
  return res.json({ ok: true, deleted: result.deleted });
});

// ── GET /api/music/for-you — Combinar DB local y recomendaciones ──
router.get('/for-you', async (req, res) => {
  const reqId = makeReqId();
  const startedAt = Date.now();
  const rawSeed = typeof req.query.seed === 'string' ? req.query.seed.trim() : '';
  const uid = String((req as any)?.user?.uid || '').trim();
  const refresh = String((req.query as any)?.refresh || '').trim() === '1' || String((req.query as any)?.refresh || '').trim().toLowerCase() === 'true';

  const defaultForYouTerms = [
    'karol g official audio',
    'anuel aa official audio',
    'bad bunny official audio',
    'anime opening song',
    'lofi beats',
    'reggaeton',
  ];

  try {
    const localResult = await pool.query(
      'SELECT id, title, uploader, duration, thumbnail, url, youtube_id, created_at FROM Downloads ORDER BY created_at DESC LIMIT 500'
    );
    const filteredLocal = localResult.rows.filter((r: any) => !isNonMusicTitle(r.title, r.uploader));
    const shuffledLocal = filteredLocal.sort(() => Math.random() - 0.5).slice(0, 12);
    const localYoutubeIds = new Set(filteredLocal.map((r: any) => r.youtube_id).filter(Boolean));
    const localKeys = new Set(filteredLocal.map((r: any) => `${normalizeText(r.title)}::${normalizeText(r.uploader)}`));

    const runExternalSearch = async (q: string) => {
      let ytResults: any[] = [];
      const failures: any[] = [];
      for (const pyUrl of downloaderUrls) {
        try {
          console.log('[convert/search]', { reqId, url: pyUrl, timeoutMs: convertTimeoutMs, q: truncate(q, 90) });
          const response = await axios.get(`${pyUrl}/search`, {
            timeout: convertTimeoutMs,
            params: { q, limit: 35 },
          });
          if (Array.isArray(response.data)) {
            ytResults = adaptYouTubeRows(response.data, localKeys, localYoutubeIds);
            if (ytResults.length > 0) {
              console.log('[convert/search] ok', { reqId, url: pyUrl, items: ytResults.length });
              return { items: ytResults, provider: 'convert' as const };
            }
          }
        } catch (error) {
          console.warn('[convert/search] failed', { reqId, url: pyUrl, ...serializeError(error) });
          failures.push({ url: pyUrl, ...serializeError(error) });
          continue;
        }
      }
      const health = await workerHealth();
      if (health.ok) {
        console.log('[worker/search] fallback', { reqId, q: truncate(q, 90) });
        const workerRes = await searchWithWorker(q, 35);
        const workerItems = workerRes?.items || [];
        if (workerItems.length > 0) {
          const workerRows = workerItems.map((w: any) => {
            const sourceId = String(w.sourceId || '').trim() || String(w.id || '').split(':').pop() || '';
            return {
              id: sourceId,
              youtube_id: sourceId,
              title: w.title,
              uploader: w.artist || w.uploader || 'Internet',
              artist: w.artist || w.uploader || 'Internet',
              duration_seconds: w.duration || 0,
              thumbnail_url: w.coverUrl || w.thumbnail_url,
              url: w.url || `https://www.youtube.com/watch?v=${sourceId}`,
            };
          });
          ytResults = adaptYouTubeRows(workerRows, localKeys, localYoutubeIds);
          console.log('[worker/search] items', { reqId, items: ytResults.length });
          if (ytResults.length > 0) return { items: ytResults, provider: 'worker' as const };
        }
      } else if (isWorkerEnabled()) {
        console.warn('[worker/search] skipped (unhealthy)', { reqId, status: health.status });
      }
      try {
        const duckRows = await searchDuckDuckGoForYoutube(q, 25);
        ytResults = adaptYouTubeRows(duckRows, localKeys, localYoutubeIds);
      } catch (error) {
        failures.push({ url: 'duckduckgo', ...serializeError(error) });
      }
      if (ytResults.length === 0 && failures.length > 0) {
        console.warn('[music/for-you] external search failed', {
          reqId,
          q: truncate(q),
          failures,
        });
      }
      return { items: ytResults, provider: ytResults.length > 0 ? ('duck' as const) : ('none' as const) };
    };

    let candidates: Array<{ q: string; source: ItemsSource }> = [];
    if (rawSeed) candidates.push({ q: rawSeed, source: 'personalized' });

    const recentTracks: string[] = [];
    const likedTracks: string[] = [];
    const recentSearches: string[] = [];
    const artistPool: string[] = [];
    let currentTrack: { title?: string; artist?: string } | null = null;

    if (!rawSeed && uid) {
      try {
        const recentsSnap = await admin
          .firestore()
          .collection('users')
          .doc(uid)
          .collection('recents')
          .orderBy('played_at', 'desc')
          .limit(12)
          .get();
        const recents = recentsSnap.docs.map((d) => d.data() as any);
        for (const r of recents) {
          const t = String(r?.title || '').trim();
          const a = String(r?.artist || '').trim();
          if (t) recentTracks.push(t);
          if (a && a !== 'Internet' && a !== 'Desconocido' && a !== 'YouTube') artistPool.push(a);
        }
        const recentDoc = recents[0];
        const recentTitle = String(recentDoc?.title || '').trim();
        const recentArtist = String(recentDoc?.artist || '').trim();
        currentTrack = recentTitle || recentArtist ? { title: recentTitle, artist: recentArtist } : null;
        if (recentArtist && recentArtist !== 'Internet' && recentArtist !== 'Desconocido' && recentArtist !== 'YouTube') {
          candidates.push({ q: `${recentArtist} official audio`, source: 'recent' });
        } else if (recentTitle) {
          candidates.push({ q: `${recentTitle} official audio`, source: 'recent' });
        }
      } catch (error) {
        console.warn('[music/for-you] failed to read recents', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
      }

      try {
        const likesSnap = await admin
          .firestore()
          .collection('users')
          .doc(uid)
          .collection('likes')
          .limit(12)
          .get();
        const likes = likesSnap.docs.map((d) => d.data() as any);
        for (const r of likes) {
          const t = String(r?.title || '').trim();
          const a = String(r?.artist || '').trim();
          if (t) likedTracks.push(t);
          if (a && a !== 'Internet' && a !== 'Desconocido' && a !== 'YouTube') artistPool.push(a);
        }
        const likeDoc = likes[0];
        const likeTitle = String(likeDoc?.title || '').trim();
        const likeArtist = String(likeDoc?.artist || '').trim();
        if (likeArtist && likeArtist !== 'Internet' && likeArtist !== 'Desconocido' && likeArtist !== 'YouTube') {
          candidates.push({ q: `${likeArtist} official audio`, source: 'favorites' });
        } else if (likeTitle) {
          candidates.push({ q: `${likeTitle} official audio`, source: 'favorites' });
        }
      } catch (error) {
        console.warn('[music/for-you] failed to read likes', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
      }

      try {
        const searchesSnap = await admin
          .firestore()
          .collection('users')
          .doc(uid)
          .collection('searches')
          .orderBy('last_used_at', 'desc')
          .limit(10)
          .get();
        for (const d of searchesSnap.docs) {
          const q = String((d.data() as any)?.query || '').trim();
          if (q) recentSearches.push(q);
        }
      } catch (error) {
        console.warn('[music/for-you] failed to read searches', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
      }
    }

    if (filteredLocal.length > 0) {
      const pick = filteredLocal[0];
      const uploader = String(pick?.uploader || '').trim();
      const title = String(pick?.title || '').trim();
      if (uploader && uploader !== 'Internet' && uploader !== 'Desconocido' && uploader !== 'YouTube') {
        candidates.push({ q: `${uploader} official audio`, source: 'downloads' });
      } else if (title) {
        candidates.push({ q: `${title} official audio`, source: 'downloads' });
      }
    }

    for (const t of defaultForYouTerms) candidates.push({ q: t, source: 'default-search' });

    let profile: MusicTasteProfile | null = null;
    let profileHash = '';
    let positiveSeeds: string[] = [];
    const blockedTrackKeys = new Set<string>();
    const blockedArtists = new Set<string>();

    if (uid) {
      try {
        const blocked = await getBlockedTrackKeys(uid);
        for (const k of blocked.keys) blockedTrackKeys.add(String(k));
        for (const yt of blocked.ytIds) blockedTrackKeys.add(`yt:${String(yt)}`);
      } catch {}

      try {
        const artists = await getBlockedArtists(uid);
        for (const a of artists) blockedArtists.add(String(a));
      } catch {}

      try {
        positiveSeeds = await getPositiveSeeds(uid, 12);
      } catch {}

      const counts = new Map<string, number>();
      for (const a of artistPool) counts.set(a, (counts.get(a) || 0) + 1);
      const topArtists = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name)
        .slice(0, 6);

      profile = {
        userId: uid,
        topArtists,
        topGenres: [],
        recentTracks: recentTracks.slice(0, 10),
        likedTracks: likedTracks.slice(0, 10),
        recentSearches: recentSearches.slice(0, 10),
        currentTrack,
        preferredLanguage: 'es',
      };

      if (positiveSeeds.length > 0) {
        const positiveOnly = positiveSeeds.slice(0, 3);
        candidates.splice(0, 0, ...positiveOnly.map((q) => ({ q, source: 'personalized' as ItemsSource })));
      }

      const localQs = candidates.map((c) => c.q);
      const aiQueries = await generateMusicSeedsWithDeepSeek(profile).catch(() => null);
      const merged = mixQueries(localQs, aiQueries, 20);
      if (aiQueries && aiQueries.length > 0) {
        const localLower = new Set(localQs.map((q) => q.toLowerCase()));
        const aiOnly = aiQueries.filter((q) => !localLower.has(q.toLowerCase())).slice(0, 3);
        if (aiOnly.length > 0) {
          const insertAt = rawSeed ? 1 : 0;
          candidates.splice(
            insertAt,
            0,
            ...aiOnly.map((q) => ({ q, source: 'personalized' as ItemsSource }))
          );
        }
      }

      const seenQ = new Set<string>();
      candidates = candidates.filter((c) => {
        const key = c.q.toLowerCase();
        if (seenQ.has(key)) return false;
        seenQ.add(key);
        return merged.includes(c.q);
      });

      const profileForHash: MusicTasteProfile = {
        ...profile,
        recentSearches: [
          ...(rawSeed ? [rawSeed] : []),
          ...(positiveSeeds || []),
          ...Array.from(blockedArtists).map((a) => `!a:${a}`),
          ...Array.from(blockedTrackKeys).map((t) => `!t:${t}`),
          ...(profile.recentSearches || []),
        ].slice(0, 30),
      };
      profileHash = computeMusicProfileHash(profileForHash);
    }

    let cacheHit = false;
    const excludeYtIds = new Set<string>();
    const excludeTitleKeys = new Set<string>();
    const excludeTitleArtistKeys = new Set<string>();
    const excludeAudioKeys = new Set<string>();

    for (const t of recentTracks) excludeTitleKeys.add(normalizeKey(t));
    for (const t of likedTracks) excludeTitleKeys.add(normalizeKey(t));

    if (uid && !refresh) {
      try {
        const seen = await getUserRecentlySeenTrackKeys({ uid, withinHours: getSeenTtlHours() });
        for (const k of seen.keys) excludeYtIds.add(String(k).replace(/^yt:/, '').replace(/^local:/, ''));
        for (const k of seen.titleKeys) excludeTitleKeys.add(String(k));
        for (const k of seen.titleArtistKeys) excludeTitleArtistKeys.add(String(k));
      } catch (error) {
        console.warn('[music/for-you] failed to read seen tracks', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
      }
    }

    if (uid && profileHash && !refresh) {
      try {
        const cached = await getUserRecommendationCache({ uid, endpoint: 'for-you', profileHash });
        if (cached) {
          const cachedItems = Array.isArray((cached as any).items) ? (cached as any).items : cached.items;
          const list = Array.isArray(cachedItems) ? cachedItems : [];
          const filtered = dedupeAndFilterItems(list, {
            ytIds: excludeYtIds,
            titleKeys: excludeTitleKeys,
            titleArtistKeys: excludeTitleArtistKeys,
            audioKeys: excludeAudioKeys,
            blockedTrackKeys,
            blockedArtists,
          });
          if (filtered.items.length >= 10) {
            cacheHit = true;
            const response: any = {
              items: filtered.items.slice(0, 30),
              source: 'cache',
            };
            if (isDev()) {
              response.debug = {
                source: response.source,
                profileHash,
                queries: cached.queries || [],
                blockedArtistsCount: blockedArtists.size,
                blockedTracksCount: blockedTrackKeys.size,
                positiveSeeds: positiveSeeds.slice(0, 8),
                dedupedCount: filtered.dedupedCount,
                skippedDuplicates: filtered.skippedDuplicates,
                cacheHit: true,
              };
            }
            console.log(`[music/for-you] reqId=${reqId} uid=${uid ? 'yes' : 'no'} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} cacheHit=true ms=${Date.now() - startedAt}`);
            return res.json(response);
          }
        }
      } catch (error) {
        console.warn('[music/for-you] cache read failed', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
      }
    }

    let ytResults: any[] = [];
    let usedSource: ItemsSource = 'empty';
    let usedQuery = '';
    const attemptedQueries: string[] = [];

    let attempts = 0;
    for (const c of candidates) {
      if (attempts >= 3) break;
      attempts++;
      attemptedQueries.push(c.q);
      usedQuery = c.q;
      const external = await runExternalSearch(c.q);
      ytResults = external.items;
      if (ytResults.length > 0) {
        usedSource = external.provider === 'worker' ? 'worker' : c.source;
        break;
      }
    }

    if (ytResults.length > 0) {
      void upsertGlobalCatalogTracks(ytResults.slice(0, 30), 1).catch(() => {});
    }

    const combinedMap = new Map<string, any>();

    for (const r of shuffledLocal) {
      const key = `${normalizeText(r.title)}::${normalizeText(r.uploader)}`;
      combinedMap.set(key, {
        ...r,
        artist: r.uploader,
        duration_seconds: r.duration,
        thumbnail_url: r.thumbnail,
        source: 'local',
      });
    }

    for (const r of ytResults.slice(0, 30)) {
      const key = `${normalizeText(r.title)}::${normalizeText(r.artist)}`;
      if (!combinedMap.has(key)) combinedMap.set(key, r);
    }

    let items = Array.from(combinedMap.values()).sort(() => Math.random() - 0.5).slice(0, 30);

    const filtered = dedupeAndFilterItems(items, {
      ytIds: excludeYtIds,
      titleKeys: excludeTitleKeys,
      titleArtistKeys: excludeTitleArtistKeys,
      audioKeys: excludeAudioKeys,
      blockedTrackKeys,
      blockedArtists,
    });
    items = filtered.items;

    if (items.length === 0 && shuffledLocal.length > 0) {
      usedSource = 'downloads';
      items = shuffledLocal.map((r: any) => ({
        ...r,
        artist: r.uploader,
        duration_seconds: r.duration,
        thumbnail_url: r.thumbnail,
        source: 'local',
      }));
    }

    const healed = await Promise.all(
      items.map(async (r: any) => {
        if (r?.source !== 'local') return r;
        try {
          return await withTimeout(healDownloadRow(r), 3500);
        } catch {
          void healDownloadRow(r).catch(() => {});
          return r;
        }
      })
    );

    let finalHealed = healed;
    let finalSource: ItemsSource = healed.length > 0 ? usedSource : 'empty';

    if (finalHealed.length < 12) {
      try {
        const extra = await getGlobalCatalogRecommendations({
          limit: 30,
          excludeYoutubeIds: new Set([...excludeYtIds, ...finalHealed.map((i) => getItemYoutubeId(i)).filter(Boolean)]),
        });
        const merged = dedupeAndFilterItems([...finalHealed, ...extra], {
          ytIds: excludeYtIds,
          titleKeys: excludeTitleKeys,
          titleArtistKeys: excludeTitleArtistKeys,
          audioKeys: excludeAudioKeys,
          blockedTrackKeys,
          blockedArtists,
        });
        finalHealed = merged.items.slice(0, 30);
        if (finalHealed.length > 0 && finalSource === 'empty') finalSource = 'default-search';
      } catch {}
    }

    finalHealed = rankRecommendationResults({ seed: rawSeed || usedQuery, items: finalHealed, profile });

    const response: any = {
      items: finalHealed,
      source: finalHealed.length > 0 ? finalSource : 'empty',
    };
    if (isDev()) {
      response.debug = {
        source: response.source,
        profileHash: profileHash || null,
        queries: attemptedQueries,
        blockedArtistsCount: blockedArtists.size,
        blockedTracksCount: blockedTrackKeys.size,
        positiveSeeds: positiveSeeds.slice(0, 8),
        dedupedCount: filtered.dedupedCount,
        skippedDuplicates: filtered.skippedDuplicates,
        cacheHit,
      };
    }

    console.log('[recommendations] blocked', {
      reqId,
      uid: uid ? 'yes' : 'no',
      blockedArtistsCount: blockedArtists.size,
      blockedTracksCount: blockedTrackKeys.size,
      blockedArtists: Array.from(blockedArtists).slice(0, 6),
    });
    console.log('[recommendations] positiveSeeds', {
      reqId,
      uid: uid ? 'yes' : 'no',
      positiveSeeds: (positiveSeeds || []).slice(0, 8),
    });
    console.log('[recommendations] finalItems', {
      reqId,
      uid: uid ? 'yes' : 'no',
      source: response.source,
      items: response.items.length,
      cacheHit,
    });

    console.log(`[music/for-you] reqId=${reqId} uid=${uid ? 'yes' : 'no'} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} beforeDedupe=${healed.length} afterDedupe=${response.items.length} cacheHit=${cacheHit} q="${truncate(usedQuery)}" ms=${Date.now() - startedAt}`);

    if (uid && profileHash) {
      void saveUserRecommendationCache({
        uid,
        endpoint: 'for-you',
        profileHash,
        queries: attemptedQueries,
        items: response.items,
        source: String(response.source),
        ttlMs: 15 * 60 * 1000,
      }).catch(() => {});
    }

    res.json(response);
  } catch (error) {
    console.error('[music/for-you] error', { reqId, error: serializeError(error) });
    try {
      const fallback = await searchDuckDuckGoForYoutube('bad bunny official audio', 25);
      const rows = adaptYouTubeRows(fallback, new Set(), new Set());
      const response: ItemsResponse<any> = { items: rows.slice(0, 30), source: rows.length > 0 ? 'default-search' : 'empty' };
      console.log(`[music/for-you] reqId=${reqId} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
      return res.json(response);
    } catch {
      const response: ItemsResponse<any> = { items: [], source: 'empty' };
      console.log(`[music/for-you] reqId=${reqId} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
      res.json(response);
    }
  }
});
const recommendationsHandler = async (req: any, res: any) => {
  const reqId = makeReqId();
  const { seed, exclude } = req.query;
  const uid = String((req as any)?.user?.uid || '').trim();
  const refresh = String((req.query as any)?.refresh || '').trim() === '1' || String((req.query as any)?.refresh || '').trim().toLowerCase() === 'true';
    
  const excludedIds = new Set<string>(
    typeof exclude === 'string' && exclude.trim()
      ? exclude.split(',').map(s => s.trim()).filter(Boolean)
      : []
  );

  const startedAt = Date.now();
  const defaultDiscoverTerms = [
    'new music',
    'latin hits',
    'anime music',
    'trending music',
    'pop latino',
    'openings anime',
  ];

  try {
    const rawSeed = typeof seed === 'string' ? seed.replace(/similar music recommended/gi, '').trim() : '';
    const baseQuery = rawSeed ? `${rawSeed} audio` : '';
    
    // Obtener ids que ya están en local y sus datos
    const localResult = await pool.query(
      'SELECT id, youtube_id, title, uploader, duration, thumbnail, url, created_at FROM Downloads WHERE youtube_id IS NOT NULL ORDER BY created_at DESC LIMIT 2000'
    );
    const localIds = new Set(localResult.rows.map((r: any) => r.youtube_id));
    const localMap = new Map();
    localResult.rows.forEach((r: any) => {
       if (r.youtube_id) localMap.set(r.youtube_id, r);
    });
    const localKeys = new Set<string>();

    const localQueries: string[] = [];
    if (baseQuery) localQueries.push(baseQuery);
    for (const t of defaultDiscoverTerms) localQueries.push(t);

    const recentTracks: string[] = [];
    const likedTracks: string[] = [];
    const recentSearches: string[] = [];
    const artistPool: string[] = [];
    let currentTrack: { title?: string; artist?: string } | null = null;
    let profile: MusicTasteProfile | null = null;

    let profileHash = '';
    let cacheHit = false;
    const attemptedQueries: string[] = [];
    let positiveSeeds: string[] = [];
    const blockedTrackKeys = new Set<string>();
    const blockedArtists = new Set<string>();

    const excludeYtIds = new Set<string>();
    const excludeTitleKeys = new Set<string>();
    const excludeTitleArtistKeys = new Set<string>();
    const excludeAudioKeys = new Set<string>();

    for (const ex of excludedIds) {
      if (!ex) continue;
      excludeYtIds.add(ex);
      excludeTitleKeys.add(normalizeKey(ex));
    }

    let queries = localQueries;
    if (uid) {
      try {
        const blocked = await getBlockedTrackKeys(uid);
        for (const k of blocked.keys) blockedTrackKeys.add(String(k));
        for (const yt of blocked.ytIds) blockedTrackKeys.add(`yt:${String(yt)}`);
      } catch {}

      try {
        const artists = await getBlockedArtists(uid);
        for (const a of artists) blockedArtists.add(String(a));
      } catch {}

      try {
        positiveSeeds = await getPositiveSeeds(uid, 12);
      } catch {}

      try {
        const recentsSnap = await admin
          .firestore()
          .collection('users')
          .doc(uid)
          .collection('recents')
          .orderBy('played_at', 'desc')
          .limit(12)
          .get();
        const recents = recentsSnap.docs.map((d) => d.data() as any);
        for (const r of recents) {
          const t = String(r?.title || '').trim();
          const a = String(r?.artist || '').trim();
          const yt = String(r?.youtube_id || r?.song_id || '').trim();
          if (t) recentTracks.push(t);
          if (yt) excludeYtIds.add(yt);
          if (t) excludeTitleKeys.add(normalizeKey(t));
          if (a && t) excludeTitleArtistKeys.add(`${normalizeKey(a)}::${normalizeKey(t)}`);
          if (a && a !== 'Internet' && a !== 'Desconocido' && a !== 'YouTube') artistPool.push(a);
        }
        const top = recents[0];
        const t0 = String(top?.title || '').trim();
        const a0 = String(top?.artist || '').trim();
        currentTrack = t0 || a0 ? { title: t0, artist: a0 } : null;
      } catch (error) {
        console.warn('[music/recommendations] failed to read recents', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
      }

      try {
        const likesSnap = await admin
          .firestore()
          .collection('users')
          .doc(uid)
          .collection('likes')
          .limit(12)
          .get();
        const likes = likesSnap.docs.map((d) => d.data() as any);
        for (const r of likes) {
          const t = String(r?.title || '').trim();
          const a = String(r?.artist || '').trim();
          const yt = String(r?.youtube_id || r?.song_id || '').trim();
          if (t) likedTracks.push(t);
          if (yt) excludeYtIds.add(yt);
          if (t) excludeTitleKeys.add(normalizeKey(t));
          if (a && t) excludeTitleArtistKeys.add(`${normalizeKey(a)}::${normalizeKey(t)}`);
          if (a && a !== 'Internet' && a !== 'Desconocido' && a !== 'YouTube') artistPool.push(a);
        }
      } catch (error) {
        console.warn('[music/recommendations] failed to read likes', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
      }

      try {
        const searchesSnap = await admin
          .firestore()
          .collection('users')
          .doc(uid)
          .collection('searches')
          .orderBy('last_used_at', 'desc')
          .limit(10)
          .get();
        for (const d of searchesSnap.docs) {
          const q = String((d.data() as any)?.query || '').trim();
          if (q) recentSearches.push(q);
        }
      } catch (error) {
        console.warn('[music/recommendations] failed to read searches', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
      }

      if (!refresh) {
        try {
          const seen = await getUserRecentlySeenTrackKeys({ uid, withinHours: getSeenTtlHours() });
          for (const k of seen.keys) excludeYtIds.add(String(k).replace(/^yt:/, '').replace(/^local:/, ''));
          for (const k of seen.titleKeys) excludeTitleKeys.add(String(k));
          for (const k of seen.titleArtistKeys) excludeTitleArtistKeys.add(String(k));
        } catch (error) {
          console.warn('[music/recommendations] failed to read seen tracks', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
        }
      }

      const counts = new Map<string, number>();
      for (const a of artistPool) counts.set(a, (counts.get(a) || 0) + 1);
      const topArtists = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name)
        .slice(0, 6);

      const profileObj: MusicTasteProfile = {
        userId: uid,
        topArtists,
        topGenres: [],
        recentTracks: recentTracks.slice(0, 10),
        likedTracks: likedTracks.slice(0, 10),
        recentSearches: recentSearches.slice(0, 10),
        currentTrack,
        preferredLanguage: 'es',
      };
      profile = profileObj;

      const profileForHash: MusicTasteProfile = {
        ...profileObj,
        recentSearches: [
          ...(rawSeed ? [rawSeed] : []),
          ...(positiveSeeds || []),
          ...Array.from(blockedArtists).map((a) => `!a:${a}`),
          ...Array.from(blockedTrackKeys).map((t) => `!t:${t}`),
          ...(profileObj.recentSearches || []),
        ].slice(0, 30),
      };
      profileHash = computeMusicProfileHash(profileForHash);

      if (!refresh) {
        try {
          const cached = await getUserRecommendationCache({ uid, endpoint: 'recommendations', profileHash });
          if (cached) {
            const cachedItems = Array.isArray((cached as any).items) ? (cached as any).items : cached.items;
            const list = Array.isArray(cachedItems) ? cachedItems : [];
            const filtered = dedupeAndFilterItems(list, {
              ytIds: excludeYtIds,
              titleKeys: excludeTitleKeys,
              titleArtistKeys: excludeTitleArtistKeys,
              audioKeys: excludeAudioKeys,
              blockedTrackKeys,
              blockedArtists,
            });
            if (filtered.items.length >= 10) {
              cacheHit = true;
              const response: any = {
                items: filtered.items.slice(0, 30),
                source: 'cache',
              };
              if (isDev()) {
                response.debug = {
                  source: response.source,
                  profileHash,
                  queries: cached.queries || [],
                  blockedArtistsCount: blockedArtists.size,
                  blockedTracksCount: blockedTrackKeys.size,
                  positiveSeeds: positiveSeeds.slice(0, 8),
                  dedupedCount: filtered.dedupedCount,
                  skippedDuplicates: filtered.skippedDuplicates,
                  cacheHit: true,
                };
              }
              console.log(`[music/recommendations] reqId=${reqId} uid=${uid ? 'yes' : 'no'} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} cacheHit=true ms=${Date.now() - startedAt}`);
              return res.json(response);
            }
          }
        } catch (error) {
          console.warn('[music/recommendations] cache read failed', { reqId, uid: uid ? 'yes' : 'no', error: serializeError(error) });
        }
      }

      const aiQueries = await generateMusicSeedsWithDeepSeek(profile as MusicTasteProfile).catch(() => null);
      const localPlus = positiveSeeds.length > 0 ? [...positiveSeeds.slice(0, 3), ...localQueries] : localQueries;
      queries = mixQueries(localPlus, aiQueries, 3);
    } else {
      queries = localQueries.slice(0, 3);
    }

    const collected: any[] = [];
    const seen = new Set<string>();
    let hadConvertResults = false;
    let hadWorkerResults = false;

    for (const q of queries) {
      if (collected.length >= 15) break;
      attemptedQueries.push(q);
      let batch: any[] = [];
      const failures: any[] = [];

      try {
        for (const pyUrl of downloaderUrls) {
          try {
            console.log('[convert/search]', { reqId, url: pyUrl, timeoutMs: convertTimeoutMs, q: truncate(q, 90) });
            const response = await axios.get(`${pyUrl}/search`, {
              timeout: convertTimeoutMs,
              params: { q, limit: 30 },
            });
            const data = response.data;
            if (Array.isArray(data)) {
              batch = adaptYouTubeRows(data, localKeys, localIds, localMap);
              if (batch.length > 0) {
                hadConvertResults = true;
                console.log('[convert/search] ok', { reqId, url: pyUrl, items: batch.length });
                break;
              }
            }
          } catch (error) {
            console.warn('[convert/search] failed', { reqId, url: pyUrl, ...serializeError(error) });
            failures.push({ url: pyUrl, ...serializeError(error) });
            continue;
          }
        }
      } catch {}

      if (batch.length === 0) {
        const health = await workerHealth();
        if (health.ok) {
          console.log('[worker/search] fallback', { reqId, q: truncate(q, 90) });
          const workerRes = await searchWithWorker(q, 35);
          const workerItems = workerRes?.items || [];
          if (workerItems.length > 0) {
            const mapped = workerItems.map((w: any) => {
              const sourceId = String(w.sourceId || '').trim() || String(w.id || '').split(':').pop() || '';
              return {
                id: sourceId,
                youtube_id: sourceId,
                title: w.title,
                uploader: w.artist || w.uploader || 'Internet',
                duration_seconds: w.duration || 0,
                thumbnail_url: w.coverUrl || w.thumbnail_url,
                url: w.url || `https://www.youtube.com/watch?v=${sourceId}`,
              };
            });
            batch = adaptYouTubeRows(mapped, localKeys, localIds, localMap);
            if (batch.length > 0) {
              hadWorkerResults = true;
              console.log('[worker/search] items', { reqId, items: batch.length });
            }
          }
        } else if (isWorkerEnabled()) {
          console.warn('[worker/search] skipped (unhealthy)', { reqId, status: health.status });
        }
        if (batch.length === 0) {
          try {
            const duckRows = await searchDuckDuckGoForYoutube(q, 25);
            batch = adaptYouTubeRows(duckRows, localKeys, localIds, localMap);
          } catch (error) {
            failures.push({ url: 'duckduckgo', ...serializeError(error) });
          }
        }
      }

      if (batch.length === 0 && failures.length > 0) {
        console.warn('[music/recommendations] external search failed', {
          reqId,
          q: truncate(q),
          failures,
        });
      }

      for (const r of batch) {
        const ytId = String(r.youtube_id || r.id || '').trim();
        if (!ytId || seen.has(ytId)) continue;
        seen.add(ytId);
        collected.push(r);
        if (collected.length >= 20) break;
      }
    }

    let ytResults = collected;

    if (excludedIds.size > 0) {
      ytResults = ytResults.filter((r) => {
        const ytId = r.youtube_id || r.id;
        return !excludedIds.has(String(ytId)) && !excludedIds.has(normalizeText(r.title));
      });
    }

    const filtered = dedupeAndFilterItems(ytResults, {
      ytIds: excludeYtIds,
      titleKeys: excludeTitleKeys,
      titleArtistKeys: excludeTitleArtistKeys,
      audioKeys: excludeAudioKeys,
      blockedTrackKeys,
      blockedArtists,
    });

    ytResults = filtered.items;
    if (ytResults.length > 0) {
      void upsertGlobalCatalogTracks(ytResults.slice(0, 30), 1).catch(() => {});
    }

    let finalList = ytResults.slice(0, 30);
    let usedSource: any = !hadConvertResults && hadWorkerResults ? 'worker' : rawSeed ? 'personalized' : 'default-search';

    if (finalList.length < 12) {
      try {
        const extra = await getGlobalCatalogRecommendations({
          limit: 30,
          excludeYoutubeIds: new Set([...excludeYtIds, ...finalList.map((i) => getItemYoutubeId(i)).filter(Boolean)]),
        });
        const merged = dedupeAndFilterItems([...finalList, ...extra], {
          ytIds: excludeYtIds,
          titleKeys: excludeTitleKeys,
          titleArtistKeys: excludeTitleArtistKeys,
          audioKeys: excludeAudioKeys,
          blockedTrackKeys,
          blockedArtists,
        });
        finalList = merged.items.slice(0, 30);
        if (ytResults.length === 0 && extra.length > 0) usedSource = 'global';
      } catch {}
    }

    if (finalList.length === 0) {
      try {
        const extra = await getGlobalCatalogRecommendations({ limit: 30, excludeYoutubeIds: excludeYtIds });
        if (extra.length > 0) {
          const response: any = { items: extra.slice(0, 30), source: 'global' };
          if (isDev()) {
            response.debug = {
              source: response.source,
              profileHash: profileHash || null,
              queries: attemptedQueries,
              blockedArtistsCount: blockedArtists.size,
              blockedTracksCount: blockedTrackKeys.size,
              positiveSeeds: positiveSeeds.slice(0, 8),
              dedupedCount: filtered.dedupedCount,
              skippedDuplicates: filtered.skippedDuplicates,
              cacheHit,
            };
          }
          console.log('[recommendations] blocked', {
            reqId,
            uid: uid ? 'yes' : 'no',
            blockedArtistsCount: blockedArtists.size,
            blockedTracksCount: blockedTrackKeys.size,
            blockedArtists: Array.from(blockedArtists).slice(0, 6),
          });
          console.log('[recommendations] positiveSeeds', {
            reqId,
            uid: uid ? 'yes' : 'no',
            positiveSeeds: (positiveSeeds || []).slice(0, 8),
          });
          console.log('[recommendations] finalItems', {
            reqId,
            uid: uid ? 'yes' : 'no',
            source: response.source,
            items: response.items.length,
            cacheHit,
          });
          console.log(`[music/recommendations] reqId=${reqId} uid=${uid ? 'yes' : 'no'} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} beforeDedupe=${ytResults.length} afterDedupe=${response.items.length} cacheHit=${cacheHit} ms=${Date.now() - startedAt}`);
          if (uid && profileHash) {
            void saveUserRecommendationCache({
              uid,
              endpoint: 'recommendations',
              profileHash,
              queries: attemptedQueries,
              items: response.items,
              source: String(response.source),
              ttlMs: 15 * 60 * 1000,
            }).catch(() => {});
          }
          return res.json(response);
        }
      } catch {}

      const local = await pool.query(
        'SELECT id, title, uploader, duration, thumbnail, url, youtube_id, created_at FROM Downloads ORDER BY created_at DESC LIMIT 20'
      );
      const localItems = local.rows
        .filter((r: any) => !isNonMusicTitle(r.title, r.uploader))
        .slice(0, 15)
        .map((r: any) => ({
          ...r,
          artist: r.uploader,
          duration_seconds: r.duration,
          thumbnail_url: r.thumbnail,
          source: 'local',
        }));

      const localFiltered = dedupeAndFilterItems(localItems, {
        ytIds: excludeYtIds,
        titleKeys: excludeTitleKeys,
        titleArtistKeys: excludeTitleArtistKeys,
        audioKeys: excludeAudioKeys,
        blockedTrackKeys,
        blockedArtists,
      });

      if (localFiltered.items.length > 0) {
        const response: any = {
          items: localFiltered.items.slice(0, 30),
          source: 'downloads',
        };
        if (isDev()) {
          response.debug = {
            source: response.source,
            profileHash: profileHash || null,
            queries: attemptedQueries,
            blockedArtistsCount: blockedArtists.size,
            blockedTracksCount: blockedTrackKeys.size,
            positiveSeeds: positiveSeeds.slice(0, 8),
            dedupedCount: localFiltered.dedupedCount,
            skippedDuplicates: localFiltered.skippedDuplicates,
            cacheHit,
          };
        }
        console.log(`[music/recommendations] reqId=${reqId} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
        if (uid && profileHash) {
          void saveUserRecommendationCache({
            uid,
            endpoint: 'recommendations',
            profileHash,
            queries: attemptedQueries,
            items: response.items,
            source: String(response.source),
            ttlMs: 15 * 60 * 1000,
          }).catch(() => {});
        }
        return res.json(response);
      }

      const health = await workerHealth();
      if (health.ok) {
        const workerRes = await searchWithWorker(rawSeed || defaultDiscoverTerms[0], 35);
        const workerItems = workerRes?.items || [];
        if (workerItems.length > 0) {
          const mapped = workerItems.map((w: any) => {
            const sourceId = String(w.sourceId || '').trim() || String(w.id || '').split(':').pop() || '';
            return {
              id: sourceId,
              youtube_id: sourceId,
              title: w.title,
              artist: w.artist || w.uploader || 'Internet',
              uploader: w.artist || w.uploader || 'Internet',
              duration_seconds: w.duration || 0,
              thumbnail_url: w.coverUrl || w.thumbnail_url,
              url: w.url || `https://www.youtube.com/watch?v=${sourceId}`,
              source: 'youtube',
            };
          });

          const workerFiltered = dedupeAndFilterItems(mapped, {
            ytIds: excludeYtIds,
            titleKeys: excludeTitleKeys,
            titleArtistKeys: excludeTitleArtistKeys,
            audioKeys: excludeAudioKeys,
            blockedTrackKeys,
            blockedArtists,
          });

          const response: any = { items: workerFiltered.items.slice(0, 30), source: 'worker' };
          if (isDev()) {
            response.debug = {
              source: response.source,
              profileHash: profileHash || null,
              queries: attemptedQueries,
              blockedArtistsCount: blockedArtists.size,
              blockedTracksCount: blockedTrackKeys.size,
              positiveSeeds: positiveSeeds.slice(0, 8),
              dedupedCount: workerFiltered.dedupedCount,
              skippedDuplicates: workerFiltered.skippedDuplicates,
              cacheHit,
            };
          }
          console.log(`[music/recommendations] reqId=${reqId} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
          if (uid && profileHash) {
            void saveUserRecommendationCache({
              uid,
              endpoint: 'recommendations',
              profileHash,
              queries: attemptedQueries,
              items: response.items,
              source: String(response.source),
              ttlMs: 15 * 60 * 1000,
            }).catch(() => {});
          }
          void upsertGlobalCatalogTracks(response.items.slice(0, 30), 1).catch(() => {});
          return res.json(response);
        }
      } else if (isWorkerEnabled()) {
        console.warn('[worker/search] skipped (unhealthy)', { reqId, status: health.status });
      }

      const response: any = { items: [], source: 'empty' };
      if (isDev()) {
        response.debug = {
          source: response.source,
          profileHash: profileHash || null,
          queries: attemptedQueries,
          blockedArtistsCount: blockedArtists.size,
          blockedTracksCount: blockedTrackKeys.size,
          positiveSeeds: positiveSeeds.slice(0, 8),
          dedupedCount: 0,
          skippedDuplicates: 0,
          cacheHit,
        };
      }
      console.log('[recommendations] blocked', {
        reqId,
        uid: uid ? 'yes' : 'no',
        blockedArtistsCount: blockedArtists.size,
        blockedTracksCount: blockedTrackKeys.size,
        blockedArtists: Array.from(blockedArtists).slice(0, 6),
      });
      console.log('[recommendations] positiveSeeds', {
        reqId,
        uid: uid ? 'yes' : 'no',
        positiveSeeds: (positiveSeeds || []).slice(0, 8),
      });
      console.log('[recommendations] finalItems', {
        reqId,
        uid: uid ? 'yes' : 'no',
        source: response.source,
        items: response.items.length,
        cacheHit,
      });
      console.log(`[music/recommendations] reqId=${reqId} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
      return res.json(response);
    }

    const response: any = {
      items: rankRecommendationResults({ seed: rawSeed, items: finalList, profile }),
      source: usedSource,
    };
    if (isDev()) {
      response.debug = {
        source: response.source,
        profileHash: profileHash || null,
        queries: attemptedQueries,
        blockedArtistsCount: blockedArtists.size,
        blockedTracksCount: blockedTrackKeys.size,
        positiveSeeds: positiveSeeds.slice(0, 8),
        dedupedCount: filtered.dedupedCount,
        skippedDuplicates: filtered.skippedDuplicates,
        cacheHit,
      };
    }

    console.log('[recommendations] blocked', {
      reqId,
      uid: uid ? 'yes' : 'no',
      blockedArtistsCount: blockedArtists.size,
      blockedTracksCount: blockedTrackKeys.size,
      blockedArtists: Array.from(blockedArtists).slice(0, 6),
    });
    console.log('[recommendations] positiveSeeds', {
      reqId,
      uid: uid ? 'yes' : 'no',
      positiveSeeds: (positiveSeeds || []).slice(0, 8),
    });
    console.log('[recommendations] finalItems', {
      reqId,
      uid: uid ? 'yes' : 'no',
      source: response.source,
      items: response.items.length,
      cacheHit,
    });

    console.log(`[music/recommendations] reqId=${reqId} uid=${uid ? 'yes' : 'no'} seed=${rawSeed ? 'yes' : 'no'} source=${response.source} items=${response.items.length} beforeDedupe=${collected.length} afterDedupe=${response.items.length} cacheHit=${cacheHit} ms=${Date.now() - startedAt}`);

    if (uid && profileHash) {
      void saveUserRecommendationCache({
        uid,
        endpoint: 'recommendations',
        profileHash,
        queries: attemptedQueries,
        items: response.items,
        source: String(response.source),
        ttlMs: 15 * 60 * 1000,
      }).catch(() => {});
    }

    res.json(response);
  } catch (error) {
    console.error('[music/recommendations] error', { reqId, error: serializeError(error) });
    try {
      const duckRows = await searchDuckDuckGoForYoutube('latin hits', 25);
      const fallback = adaptYouTubeRows(duckRows, new Set(), new Set());
      if (fallback.length > 0) {
        const response: ItemsResponse<any> = { items: fallback.slice(0, 30), source: 'default-search' };
        console.log(`[music/recommendations] reqId=${reqId} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
        return res.json(response);
      }
      const local = await pool.query(
        'SELECT id, title, uploader, duration, thumbnail, url, youtube_id, created_at FROM Downloads ORDER BY RANDOM() LIMIT 15'
      );
      const localItems = local.rows.map((r: any) => ({
        ...r,
        artist: r.uploader,
        duration_seconds: r.duration,
        thumbnail_url: r.thumbnail,
        source: 'local',
      }));
      const response: ItemsResponse<any> = { items: localItems, source: localItems.length > 0 ? 'downloads' : 'empty' };
      console.log(`[music/recommendations] reqId=${reqId} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
      res.json(response);
    } catch {
      const response: ItemsResponse<any> = { items: [], source: 'empty' };
      console.log(`[music/recommendations] reqId=${reqId} source=${response.source} items=${response.items.length} ms=${Date.now() - startedAt}`);
      res.json(response);
    }
  }
};
router.get('/recommendations', recommendationsHandler);
router.post('/radio', async (req, res) => {
  const body = readBodyAsJson(req);
  const currentTrack = (body as any)?.currentTrack || null;
  const queue = Array.isArray((body as any)?.queue) ? (body as any)?.queue : [];
  const exclude = Array.isArray((body as any)?.exclude) ? (body as any)?.exclude : [];

  const title = String(currentTrack?.title || '').trim();
  const artist = String(currentTrack?.artist || currentTrack?.uploader || '').trim();
  const seed = artist && title ? `${artist} ${title}` : title || artist;

  const excludedIds = new Set<string>();
  for (const it of [...queue, ...exclude]) {
    const id = String(it?.youtube_id || it?.sourceId || it?.id || '').trim();
    if (id) excludedIds.add(id);
  }

  (req as any).query = {
    ...(req as any).query,
    seed,
    exclude: Array.from(excludedIds).slice(0, 200).join(','),
    mode: 'radio',
  };
  return recommendationsHandler(req as any, res as any);
});
router.get('/lyrics', async (req, res) => {
  const title = req.query.title as string;
  const artist = req.query.artist as string;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    // Usamos la API pública de lrclib.net (no requiere token)
    const apiUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}${artist && artist !== 'Desconocido' && artist !== 'YouTube' ? `&artist_name=${encodeURIComponent(artist)}` : ''}`;
    
    const response = await axios.get(apiUrl, { timeout: 5000 });
    
    if (response.data && (response.data.syncedLyrics || response.data.plainLyrics)) {
      res.json({
        synced: response.data.syncedLyrics,
        plain: response.data.plainLyrics
      });
    } else {
      res.status(404).json({ error: 'Lyrics not found' });
    }
  } catch (error) {
    // Fallback: Si lrclib falla, intenta buscar sin el artista
    try {
      if (artist && artist !== 'Desconocido' && artist !== 'YouTube') {
        const fallbackUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}`;
        const fallbackRes = await axios.get(fallbackUrl, { timeout: 3000 });
        if (fallbackRes.data && (fallbackRes.data.syncedLyrics || fallbackRes.data.plainLyrics)) {
          return res.json({
            synced: fallbackRes.data.syncedLyrics,
            plain: fallbackRes.data.plainLyrics
          });
        }
      }
      res.status(404).json({ error: 'Lyrics not found' });
    } catch {
      res.status(500).json({ error: 'Error fetching lyrics' });
    }
  }
});

router.get('/worker-health', async (_req, res) => {
  try {
    const health = await workerHealth();
    res.json({ enabled: isWorkerEnabled(), ...health });
  } catch (error: any) {
    console.error('[music/worker-health] error', error?.message || error);
    res.json({ enabled: isWorkerEnabled(), ok: false, status: 0 });
  }
});

// ── Search: busca en Downloads (datos reales de la DB) y en YouTube ──
router.get('/search', async (req, res) => {
  const reqId = makeReqId();
  const startedAt = Date.now();
  const rawQuery = String((req.query.q as string) || '').trim();
  if (!rawQuery) return res.status(400).json({ error: 'Query parameter "q" is required.' });

  const nq = normalizeSearchQuery(rawQuery);
  if (!nq.normalized) return res.json({ items: [], source: 'search' });

  const resultLimit = 15;
  const words = nq.tokens.length > 0 ? nq.tokens : rawQuery.split(/\s+/).filter(Boolean);

  const buildOrConditions = (fields: string[], offset: number) =>
    words
      .map((_, i) => `(${fields.map((f) => `${f} ILIKE $${offset + i}`).join(' OR ')})`)
      .join(' OR ');

  const localConditions = buildOrConditions(['title', "COALESCE(uploader, '')"], 1);
  const localParams = words.map((w) => `%${w}%`);

  let localRows: any[] = [];
  try {
    const localRes = await pool.query(
      `
        SELECT id, title, uploader, duration, thumbnail, url, youtube_id, mode, created_at
        FROM Downloads
        WHERE ${localConditions || '1=1'}
        ORDER BY created_at DESC
        LIMIT 80
      `,
      localParams
    );
    localRows = localRes.rows || [];
  } catch {
    localRows = [];
  }

  const localResults = localRows.map((row) => ({
    ...row,
    artist: row.uploader,
    duration_seconds: row.duration,
    thumbnail_url: row.thumbnail,
    source: 'local',
  }));

  const localKeys = new Set(localResults.map((loc: any) => `${normalizeSearchText(loc.title)}::${normalizeSearchText(loc.artist)}`));
  const localYoutubeIds = new Set(localResults.map((loc: any) => loc.youtube_id).filter(Boolean));

  let catalogResults: any[] = [];
  try {
    const catConditions = buildOrConditions(['title', "COALESCE(uploader, '')"], 1);
    const catParams = words.map((w) => `%${w}%`);
    const catRes = await pool.query(
      `
        SELECT youtube_id, title, uploader, duration, thumbnail, url, score
        FROM GlobalCatalogTracks
        WHERE ${catConditions || '1=1'}
        ORDER BY score DESC, updated_at DESC
        LIMIT 60
      `,
      catParams
    );
    catalogResults = (catRes.rows || []).map((r: any) => ({
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
  } catch {
    catalogResults = [];
  }

  for (const it of catalogResults) {
    localKeys.add(`${normalizeSearchText(it.title)}::${normalizeSearchText(it.artist)}`);
    if (it.youtube_id) localYoutubeIds.add(String(it.youtube_id));
  }

  const searchViaConvertOrWorker = async (q: string) => {
    for (const pyUrl of downloaderUrls) {
      try {
        console.log('[convert/search]', { reqId, url: pyUrl, timeoutMs: convertTimeoutMs, q: truncate(q, 90), limit: resultLimit });
        const response = await axios.get(`${pyUrl}/search`, {
          timeout: convertTimeoutMs,
          params: { q, limit: resultLimit },
        });
        const data = response.data;
        if (Array.isArray(data) && data.length > 0) {
          const items = adaptYouTubeRows(data, localKeys, localYoutubeIds);
          if (items.length > 0) return { items, provider: 'convert' as const };
        }
      } catch {}
    }

    const health = await workerHealth().catch(() => ({ ok: false, status: 0 } as any));
    if (health.ok) {
      const workerRes = await searchWithWorker(q, resultLimit).catch(() => null);
      if (workerRes?.items?.length) {
        const workerRows = workerRes.items.map((t: any) => {
          const sid = String(t?.sourceId ?? '').trim() || String(t?.id ?? '').replace(/^youtube:/, '').trim();
          const safeId = sid || extractYoutubeId(t?.url);
          const ytUrl = t?.url || (safeId ? `https://www.youtube.com/watch?v=${safeId}` : '');
          return {
            id: safeId,
            youtube_id: safeId,
            title: t?.title ?? '',
            uploader: t?.artist ?? t?.uploader ?? t?.author ?? 'Internet',
            duration_seconds: t?.duration ?? t?.duration_seconds ?? null,
            thumbnail_url: t?.coverUrl ?? t?.thumbnail_url ?? null,
            url: ytUrl,
          };
        });
        const items = adaptYouTubeRows(workerRows, localKeys, localYoutubeIds);
        if (items.length > 0) return { items, provider: 'worker' as const };
      }
    } else if (isWorkerEnabled()) {
      console.warn('[worker/search] skipped (unhealthy)', { reqId, status: health.status });
    }

    return { items: [] as any[], provider: 'none' as const };
  };

  const queryVariants: string[] = [rawQuery];
  const seenQ = new Set<string>([normalizeSearchText(rawQuery)]);
  const pushQuery = (q: string) => {
    const k = normalizeSearchText(q);
    if (!k || seenQ.has(k)) return;
    seenQ.add(k);
    queryVariants.push(q);
  };

  let ytResults: any[] = [];
  let sources = { convert: 0, worker: 0, duck: 0, catalog: catalogResults.length, local: localResults.length };

  try {
    const primary = await searchViaConvertOrWorker(rawQuery);
    ytResults.push(...primary.items);
    if (primary.provider === 'convert') sources.convert += primary.items.length;
    if (primary.provider === 'worker') sources.worker += primary.items.length;

    const combined0 = [...localResults, ...catalogResults, ...ytResults];
    let ranked0 = rankSearchResults(rawQuery, combined0);

    if (ranked0.afterRank < 8) {
      const tokenMap = new Map<string, string>();
      const topTitles = ranked0.topScores.map((t) => String(t.title || '')).slice(0, 6);
      for (const token of nq.tokens) {
        if (token.length < 3) continue;
        if (tokenMap.has(token)) continue;
        for (const tt of topTitles) {
          const tnorm = normalizeSearchText(tt);
          for (const w of tnorm.split(' ').filter(Boolean)) {
            if (w.length >= token.length + 2 && w.startsWith(token)) {
              tokenMap.set(token, w);
              break;
            }
          }
          if (tokenMap.has(token)) break;
        }
      }

      let replaced = nq.normalized;
      for (const [k, v] of tokenMap.entries()) {
        replaced = replaced.replace(new RegExp(`\\b${k}\\b`, 'g'), v);
      }
      if (replaced && replaced !== nq.normalized) pushQuery(replaced);

      const topArtist = normalizeSearchText(ranked0.topScores?.[0]?.artist || '');
      if (topArtist && !nq.normalized.includes(topArtist) && topArtist.length <= 40) pushQuery(`${topArtist} ${nq.normalized}`);

      for (const q2 of queryVariants.slice(1, 3)) {
        const res2 = await searchViaConvertOrWorker(q2);
        ytResults.push(...res2.items);
        if (res2.provider === 'convert') sources.convert += res2.items.length;
        if (res2.provider === 'worker') sources.worker += res2.items.length;
      }

      ranked0 = rankSearchResults(rawQuery, [...localResults, ...catalogResults, ...ytResults]);
    }

    if (ranked0.afterRank < 8) {
      const aiQueries = await getSearchQueryAlternatives(rawQuery);
      if (aiQueries && aiQueries.length > 0) {
        for (const q3 of aiQueries) pushQuery(q3);
        for (const q3 of aiQueries) {
          const res3 = await searchViaConvertOrWorker(q3);
          ytResults.push(...res3.items);
          if (res3.provider === 'convert') sources.convert += res3.items.length;
          if (res3.provider === 'worker') sources.worker += res3.items.length;
        }
        ranked0 = rankSearchResults(rawQuery, [...localResults, ...catalogResults, ...ytResults]);
      }
    }

    if (ytResults.length === 0) {
      const duckRows = await searchDuckDuckGoForYoutube(rawQuery, resultLimit);
      const duck = adaptYouTubeRows(duckRows, localKeys, localYoutubeIds);
      ytResults.push(...duck);
      sources.duck += duck.length;
    }

    const combined = [...localResults, ...catalogResults, ...ytResults];
    const ranked = rankSearchResults(rawQuery, combined);

    console.log('[search]', { reqId, q: truncate(rawQuery, 90), normalized: truncate(ranked.query.normalized, 90) });
    console.log('[search] sources', { reqId, ...sources, variants: queryVariants.length });
    console.log('[search] ranked', { reqId, before: ranked.beforeRank, after: ranked.afterRank });
    console.log('[search] topResults', ranked.topScores.slice(0, 6));

    const response: any = { items: ranked.items, source: 'search' };
    if (isDev()) {
      response.debug = {
        query: rawQuery,
        normalizedQuery: ranked.query.normalized,
        beforeRank: ranked.beforeRank,
        afterRank: ranked.afterRank,
        sources,
        queriesUsed: queryVariants.slice(0, 6),
        topScores: ranked.topScores.slice(0, 10),
        ms: Date.now() - startedAt,
      };
    }
    return res.json(response);
  } catch (error) {
    console.error('[search] error', { reqId, error: serializeError(error) });
    const response: any = { items: [], source: 'search' };
    if (isDev()) response.debug = { query: rawQuery, normalizedQuery: nq.normalized, error: serializeError(error), ms: Date.now() - startedAt };
    return res.json(response);
  }
});

// ── GET playlists reales ──
router.get('/playlists', async (req, res) => {
  try {
    const playlists = await pool.query(
      "SELECT * FROM Playlists WHERE name NOT IN ('Workout Hits', 'Chill Vibes') ORDER BY created_at DESC"
    );
    res.json(playlists.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET single playlist con canciones ──
router.get('/playlists/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const playlistResult = await pool.query('SELECT * FROM Playlists WHERE id = $1', [id]);
    if (playlistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const songsResult = await pool.query(`
      SELECT m.*, a.name as artist_name FROM Music m
      JOIN PlaylistSongs ps ON m.id = ps.song_id
      JOIN Artists a ON m.artist_id = a.id
      WHERE ps.playlist_id = $1
      ORDER BY ps.added_at
    `, [id]);

    const playlist = playlistResult.rows[0];
    playlist.songs = songsResult.rows;

    res.json(playlist);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/music/like — guardar like ──
router.post('/like', async (req, res) => {
  const { download_id } = req.body;
  if (!download_id) return res.status(400).json({ error: 'download_id requerido' });

  try {
    await pool.query(
      `INSERT INTO Likes (download_id) VALUES ($1) ON CONFLICT (download_id) DO NOTHING`,
      [download_id]
    );
    res.json({ liked: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/music/like — quitar like ──
router.delete('/like/:download_id', async (req, res) => {
  try {
    await pool.query('DELETE FROM Likes WHERE download_id = $1', [req.params.download_id]);
    res.json({ liked: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/music/likes — listar likes ──
router.get('/likes', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.* FROM Likes l JOIN Downloads d ON l.download_id = d.id ORDER BY l.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/music/history — registrar escucha ──
router.post('/history', async (req, res) => {
  const { download_id } = req.body;
  if (!download_id) return res.status(400).json({ error: 'download_id requerido' });

  try {
    await pool.query(
      `INSERT INTO History (download_id) VALUES ($1)`,
      [download_id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/music/history — escuchado recientemente ──
router.get('/history', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (d.id) d.*, h.played_at 
       FROM History h JOIN Downloads d ON h.download_id = d.id 
       ORDER BY d.id, h.played_at DESC`
    );
    // Re-sort by played_at DESC
    const sorted = result.rows.sort((a: any, b: any) => 
      new Date(b.played_at).getTime() - new Date(a.played_at).getTime()
    );
    res.json(sorted.slice(0, 20));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
