import type { Song, Track, TrackSource } from './types';

const normalizeStr = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export const getTrackId = (input: {
  source: TrackSource;
  localId?: string | number;
  youtubeId?: string | null;
  downloadedId?: string | number;
  externalId?: string;
}) => {
  if (input.source === 'youtube') return `youtube:${normalizeStr(input.youtubeId)}`;
  if (input.source === 'local') return `local:${String(input.localId ?? '')}`;
  if (input.source === 'downloaded') return `downloaded:${String(input.downloadedId ?? '')}`;
  return `external:${normalizeStr(input.externalId) || String(input.localId ?? '')}`;
};

export const trackFromSong = (song: Song): Track => {
  const legacyId = song.id;
  const legacyIdStr = String(legacyId);

  const youtubeId = normalizeStr(song.youtube_id);
  const isDownloaded = legacyIdStr.startsWith('dl-');
  const isLocal = typeof legacyId === 'number';

  const source: TrackSource = isDownloaded ? 'downloaded' : youtubeId ? 'youtube' : isLocal ? 'local' : 'external';

  const downloadedId = isDownloaded ? legacyIdStr.slice(3) : undefined;

  const id = getTrackId({
    source,
    localId: isLocal ? legacyId : legacyIdStr,
    youtubeId: youtubeId || undefined,
    downloadedId,
    externalId: !isLocal && !isDownloaded && !youtubeId ? legacyIdStr : undefined,
  });

  const artist = normalizeStr(song.artist_name) || normalizeStr(song.artist) || undefined;
  const coverUrl = song.image_url ?? song.imageUrl;
  const duration = song.durationSecs ?? song.duration_seconds ?? (typeof song.duration === 'number' ? song.duration : undefined);

  return {
    id,
    sourceId: source === 'youtube' ? youtubeId : source === 'downloaded' ? downloadedId : undefined,
    source,
    title: song.title,
    artist,
    album: song.album,
    coverUrl,
    audioUrl: song.file_url,
    duration: typeof duration === 'number' ? duration : undefined,
  };
};

export const isHttpUrl = (input: string) => /^https?:\/\//i.test(input);

export const makeSafeYoutubeWatchUrl = (youtubeId: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;

