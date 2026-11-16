import vm from 'node:vm';

export interface MusicTrackResult {
  id: string;
  youtube_id: string;
  title: string;
  artist: string;
  uploader: string;
  duration: number;
  duration_seconds: number;
  thumbnail: string;
  thumbnail_url: string;
  url: string;
  source: 'youtube_music';
}

// Keep native dynamic import() intact when TypeScript compiles to CommonJS.
const nativeImport = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string
) => Promise<T>;

let ytPromise: Promise<any> | null = null;
let evalRegistered = false;

const audioUrlCache = new Map<string, { url: string; expiresAt: number }>();
const AUDIO_URL_TTL_MS = 15 * 60 * 1000;

const upgradeThumbnailUrl = (rawUrl: string | undefined, youtubeId: string): string => {
  const clean = String(rawUrl || '').trim();
  if (!clean) {
    return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
  }
  if (clean.includes('googleusercontent.com') || clean.includes('ggpht.com')) {
    return clean.replace(/=w\d+-h\d+([^&\s]*)/, '=w544-h544$1');
  }
  return clean;
};

const pickBestThumbnail = (thumbnails: any[] | undefined, youtubeId: string): string => {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) {
    return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
  }
  const sorted = [...thumbnails].sort((a, b) => (Number(b?.width) || 0) - (Number(a?.width) || 0));
  return upgradeThumbnailUrl(sorted[0]?.url, youtubeId);
};

const extractArtistName = (item: any): string => {
  if (Array.isArray(item?.artists) && item.artists.length > 0) {
    const names = item.artists.map((a: any) => String(a?.name || '').trim()).filter(Boolean);
    if (names.length > 0) return names.join(', ');
  }
  if (Array.isArray(item?.authors) && item.authors.length > 0) {
    const names = item.authors.map((a: any) => String(a?.name || '').trim()).filter(Boolean);
    if (names.length > 0) return names.join(', ');
  }
  const flex = item?.flex_columns?.[1]?.title?.text;
  if (typeof flex === 'string' && flex.trim()) {
    return flex.split('•')[0].trim();
  }
  return 'Internet';
};

export const getInnertube = async (): Promise<any> => {
  if (!ytPromise) {
    ytPromise = (async () => {
      const { Innertube, Platform } = await nativeImport<typeof import('youtubei.js')>('youtubei.js');
      if (!evalRegistered) {
        Platform.shim.eval = async (data: any, env: any) => {
          const properties: string[] = [];
          if (env?.n) properties.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
          if (env?.sig) properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
          const code = `${data.output}\nreturn { ${properties.join(', ')} };`;
          return vm.runInNewContext(`(function(){\n${code}\n})()`, {});
        };
        evalRegistered = true;
      }
      return await Innertube.create();
    })().catch((err) => {
      ytPromise = null;
      throw err;
    });
  }
  return ytPromise;
};

const mapMusicItem = (item: any): MusicTrackResult | null => {
  const ytId = String(item?.id || item?.video_id || '').trim();
  if (!ytId) return null;

  const title = String(item?.title?.text ?? item?.title ?? '').trim();
  if (!title) return null;

  const artist = extractArtistName(item);
  const duration = Number(item?.duration?.seconds ?? 0) || 0;
  const thumb = pickBestThumbnail(item?.thumbnails ?? item?.thumbnail?.contents, ytId);

  return {
    id: ytId,
    youtube_id: ytId,
    title,
    artist,
    uploader: artist,
    duration,
    duration_seconds: duration,
    thumbnail: thumb,
    thumbnail_url: thumb,
    url: `https://www.youtube.com/watch?v=${ytId}`,
    source: 'youtube_music',
  };
};

export const searchMusic = async (query: string, limit = 20): Promise<MusicTrackResult[]> => {
  const q = String(query || '').trim();
  if (!q) return [];

  const yt = await getInnertube();
  let res = await yt.music.search(q, { type: 'song' });
  let contents: any[] = res?.songs?.contents ?? res?.results ?? [];

  if (!contents.length) {
    res = await yt.music.search(q, { type: 'video' });
    contents = res?.videos?.contents ?? res?.results ?? [];
  }

  const out: MusicTrackResult[] = [];
  const seen = new Set<string>();
  for (const item of contents) {
    const mapped = mapMusicItem(item);
    if (!mapped || seen.has(mapped.youtube_id)) continue;
    seen.add(mapped.youtube_id);
    out.push(mapped);
    if (out.length >= limit) break;
  }
  return out;
};

export const getDirectAudioUrl = async (youtubeId: string): Promise<string | null> => {
  const ytId = String(youtubeId || '').trim();
  if (!ytId) return null;

  const cached = audioUrlCache.get(ytId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const yt = await getInnertube();
  const info = await yt.music.getInfo(ytId);

  // Prefer progressive formats (e.g. itag 18 mp4a+avc1): they stream cleanly with 200/206 Range
  // without YouTube SABR / PO-token 403 blocks on subsequent chunks.
  const progressiveFormats: any[] = Array.isArray(info?.streaming_data?.formats)
    ? info.streaming_data.formats
    : [];
  let fmt: any =
    progressiveFormats.find((f) => Number(f?.itag) === 18) ||
    progressiveFormats.find((f) => String(f?.mime_type || '').includes('mp4')) ||
    progressiveFormats[0] ||
    null;

  if (!fmt) {
    try {
      fmt = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
    } catch {
      fmt = info.chooseFormat({ type: 'audio', quality: 'best' });
    }
  }
  if (!fmt) return null;

  const resolvedUrl = fmt.url ? String(fmt.url) : String(await fmt.decipher(yt.session.player));
  if (!resolvedUrl || !resolvedUrl.startsWith('http')) return null;

  audioUrlCache.set(ytId, { url: resolvedUrl, expiresAt: Date.now() + AUDIO_URL_TTL_MS });
  return resolvedUrl;
};

export const getUpNext = async (youtubeId: string, limit = 15): Promise<MusicTrackResult[]> => {
  const ytId = String(youtubeId || '').trim();
  if (!ytId) return [];

  const yt = await getInnertube();
  const upNext = await yt.music.getUpNext(ytId);
  const contents: any[] = upNext?.contents ?? [];

  const out: MusicTrackResult[] = [];
  const seen = new Set<string>([ytId]);
  for (const item of contents) {
    const mapped = mapMusicItem(item);
    if (!mapped || seen.has(mapped.youtube_id)) continue;
    seen.add(mapped.youtube_id);
    out.push(mapped);
    if (out.length >= limit) break;
  }
  return out;
};

export const getMusicLyrics = async (youtubeId: string): Promise<{ lyrics: string; source: string } | null> => {
  const ytId = String(youtubeId || '').trim();
  if (!ytId) return null;

  const yt = await getInnertube();
  const res = await yt.music.getLyrics(ytId);
  const text = String(res?.description?.text ?? '').trim();
  if (!text) return null;

  return {
    lyrics: text,
    source: String(res?.footer?.text ?? 'YouTube Music').trim() || 'YouTube Music',
  };
};
