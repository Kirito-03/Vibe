
const badModifiers = ['live', 'en vivo', 'cover', 'remix', 'slowed', 'sped up', 'reverb', 'karaoke', 'instrumental', 'letra', 'lyrics', 'visualizer', 'nightcore', 'edit', 'extended'];

const isSafeRepairMatch = (originalTrack: any, candidate: any): { score: number, rejectReason: string | null } => {
  let score = 0;
  
  const normTitle = (originalTrack.title || '').toLowerCase();
  const cTitle = (candidate.title || '').toLowerCase();
  
  const origArtist = (originalTrack.artist || originalTrack.artist_name || '').toLowerCase();
  const cArtist = (candidate.uploader || candidate.artist || '').toLowerCase();

  let artistMatch = false;
  if (origArtist) {
    if (cTitle.includes(origArtist) || cArtist.includes(origArtist) || origArtist.includes(cArtist)) {
      artistMatch = true;
      score += 40;
    }
  } else {
    artistMatch = true;
    score += 20; // smaller bonus
  }

  if (!artistMatch) {
    return { score: 0, rejectReason: 'artist_mismatch' };
  }

  const qTokens = normTitle.replace(/[^\w\s]/gi, '').split(/\s+/).filter((t: string) => t.length > 2);
  let matchedTokens = 0;
  for (const t of qTokens) {
    if (cTitle.includes(t)) matchedTokens++;
  }
  if (qTokens.length > 0) {
    const ratio = matchedTokens / qTokens.length;
    if (ratio < 0.5) return { score: 0, rejectReason: 'title_mismatch' };
    score += ratio * 40;
  } else {
    // If title has no long tokens, just check if candidate title includes the whole original title
    if (normTitle && cTitle.includes(normTitle)) {
      score += 40;
    } else {
      return { score: 0, rejectReason: 'title_mismatch' };
    }
  }

  const origDur = originalTrack.duration_seconds || originalTrack.durationSecs;
  const cDur = candidate.duration_seconds;
  if (origDur && cDur) {
    const diff = Math.abs(origDur - cDur);
    if (diff > 20) {
      return { score: 0, rejectReason: 'duration_mismatch' };
    }
    if (diff <= 10) score += 20;
    else score += 10;
  } else {
    score += 20; // Assume okay if missing
  }

  for (const mod of badModifiers) {
    if (cTitle.includes(mod) && !normTitle.includes(mod)) {
      return { score: 0, rejectReason: 'version_mismatch' };
    }
  }

  return { score, rejectReason: null };
};

export const getTrackKey = (track: any): string => {
  if (!track) return '';
  if (track.youtube_id) return `yt:${track.youtube_id}`;
  if (track.sourceId) return `src:${track.sourceId}`;
  if (track.url && !track.url.includes('stream-direct')) return `url:${track.url}`;
  if (track.audioUrl && !track.audioUrl.includes('stream-direct')) return `audio:${track.audioUrl}`;
  const cleanTitle = (track.title || '').toLowerCase().replace(/official|audio|video|lyric|lyrics|\(.*?\)|\[.*?\]/g, '').trim();
  const cleanArtist = (track.artist || track.artist_name || '').toLowerCase().trim();
  return `txt:${cleanTitle}|${cleanArtist}|${track.duration_seconds || 0}`;
};
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getUserStorageKey, cleanupLegacyPlaybackStorage } from '../userStorage';
import { cleanSourceValue } from '../utils';
import type { User } from 'firebase/auth';
import { CapacitorMusicControls } from 'capacitor-music-controls-plugin';
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Playlist } from './MusicContext';
import { useAppSettings } from './AppSettingsContext';
import { apiFetch, API_BASE } from '../api';
import { downloadToSong } from '../components/Downloads';
import { trackFromSong, makeSafeYoutubeWatchUrl } from '../track';
import { isNativePlatform } from '../utils/platform';
import { isLikelyMusicTrack, rankRecommendationCandidate } from '../utils/trackQuality';
import type { Song, Track } from '../types';
import { auth, db } from '../../firebaseConfig';

type RepeatMode = 'off' | 'all' | 'one';

type PlaybackContextValue = {
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  volume: number;
  progress: number;
  duration: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  favorites: Set<string>;
  playbackError: string | null;
  preparingTrackKey: string | null;
  playingTrackKey: string | null;
  playbackErrorTrackKey: string | null;

  playSong: (song: Song, playlist?: Playlist, isCrossfade?: boolean) => void;
  playTrack: (track: Track, opts?: { queue?: Track[] }) => void;
  pause: () => void;
  resume: () => void;
  next: (e?: any) => void;
  previous: () => void;
  seek: (progressPct: number) => void;
  toggleFavorite: (track: Track) => void;
  toggleFavoriteSong: (song: Song) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  setSleepTimer: (minutes: number | null) => void;

  setVolume: (volumePct: number) => void;
  togglePlay: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  reorderQueue: (tracks: Track[]) => void;
  playNextFromQueueIndex: (index: number) => void;
  reset: () => void;

  sleepTimerRemainingSec: number | null;

  currentSong: Song | null;
  currentPlaylist: Playlist | null;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export const usePlayback = () => {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error('PlaybackContext missing');
  return ctx;
};

const STORAGE_KEY = 'vns_playback_state_v1';

const safeJsonParse = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

type PersistedPlaybackState = {
  currentTrack: Track | null;
  queue: Track[];
  volume: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
};

const songFromTrack = (track: Track): Song => {
  return {
    id: track.source === 'downloaded' ? `dl-${track.sourceId ?? track.id}` : track.sourceId ?? track.id,
    title: track.title,
    artist: track.artist,
    artist_name: track.artist,
    album: track.album,
    duration_seconds: track.duration ?? 0,
    durationSecs: track.duration,
    file_url: track.audioUrl || '',
    image_url: track.coverUrl,
    imageUrl: track.coverUrl,
    youtube_id: track.source === 'youtube' ? track.sourceId : undefined,
    source: track.source,
  };
};

type PlaybackProviderProps = {
  user: User | null;
  children: ReactNode;
};

export const PlaybackProvider = ({ user, children }: PlaybackProviderProps) => {
  useEffect(() => {
    cleanupLegacyPlaybackStorage();
  }, []);
  const prevUserRef = useRef<string | null>(null);
  useEffect(() => {
    const currentUid = user?.uid || null;
    if (prevUserRef.current !== null && prevUserRef.current !== currentUid) {
      console.log(`[playback/user-change] from=${prevUserRef.current} to=${currentUid}`);
      pause();
      setCurrentSong(null);
      setCurrentPlaylist(null);
    }
    prevUserRef.current = currentUid;
  }, [user?.uid]);


  const { settings } = useAppSettings();
  const persisted = useMemo(() => {
    try {
      const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) console.log(`[storage] key=${getUserStorageKey('vns_lastPlayed', user?.uid)}`);
      if (k) {
        const data = safeJsonParse<PersistedPlaybackState>(localStorage.getItem(k));
        if (data?.currentTrack && (!(data.currentTrack as any).youtube_id && !data.currentTrack.sourceId && !(data.currentTrack as any).url)) {
           // Si no tiene fuente válida, mejor limpiar este state corrupto en vez de arrastrarlo.
           console.log('[playback/rehydrate] clearing stale local track', data.currentTrack);
           localStorage.removeItem(k);
           return null;
        }
        return data;
      }
      return null;
    } catch (err) {
      console.warn("[storage] failed", err);
      return null;
    }
  }, [user?.uid]);

  const [shuffle, setShuffle] = useState<boolean>(persisted?.shuffle ?? false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(persisted?.repeatMode ?? 'off');
  const [volume, setVolumeState] = useState<number>(persisted?.volume ?? 70);
  const [currentSong, setCurrentSong] = useState<Song | null>(() => {
    if (persisted?.currentTrack) {
       const s = songFromTrack(persisted.currentTrack);
       if (s.file_url && !s.file_url.includes('stream-direct')) {
           s.file_url = '';
       }
       return s;
    }
    return null;
  });
  const [currentPlaylist, setCurrentPlaylist] = useState<Playlist | null>(() => {
    const tracks = persisted?.queue ?? [];
    if (!tracks.length) return persisted?.currentTrack ? { id: `queue-${Date.now()}`, name: 'Cola', description: '', image_url: '', songs: [songFromTrack(persisted.currentTrack)] } : null;
    return { id: `queue-${Date.now()}`, name: 'Cola', description: '', image_url: '', songs: tracks.map(songFromTrack) };
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sleepTimerRemainingSec, setSleepTimerRemainingSec] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [preparingTrackKey, setPreparingTrackKey] = useState<string | null>(null);
  const [playingTrackKey, setPlayingTrackKey] = useState<string | null>(null);
  const [playbackErrorTrackKey, setPlaybackErrorTrackKey] = useState<string | null>(null);
  
  const currentPrepareRequestRef = useRef<string | null>(null);

  const duration = currentSong?.durationSecs ?? currentSong?.duration_seconds ?? 0;

  const playerStateRef = useRef({ shuffle, repeatMode, currentPlaylist, currentSong });
  useEffect(() => {
    playerStateRef.current = { shuffle, repeatMode, currentPlaylist, currentSong };
  }, [shuffle, repeatMode, currentPlaylist, currentSong]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const oldAudioRef = useRef<HTMLAudioElement | null>(null);
  const preloadedAudioRef = useRef<HTMLAudioElement | null>(null);
  const playGenRef = useRef(0);
  const autoplayBusyRef = useRef(false);
  const sentEventsRef = useRef<Record<string, Set<string>>>({});
  const playedIdsRef = useRef<Set<string>>(new Set());
  const repairAttemptsRef = useRef<Map<string, number>>(new Map());
  const lastUserInitiatedRef = useRef(false);
  const repairingRef = useRef(false);
  const expandingQueueRef = useRef(false);
  const bufferDoneRef = useRef(false);
  // Tracks youtubeIds currently being fetched for the radio queue to prevent
  // duplicate concurrent POST /api/downloads for the same track.
  const pendingRadioDownloadsRef = useRef<Set<string>>(new Set());

  const sleepTimerTimeoutRef = useRef<number | null>(null);
  const sleepTimerTickRef = useRef<number | null>(null);

  const [likedKeys, setLikedKeys] = useState<Set<string>>(new Set());
  const songKeyFromId = (songId: number | string) => {
    if (typeof songId === 'string') return songId;
    return `song-${songId}`;
  };

  useEffect(() => {
    if (!user) {
      setLikedKeys(new Set());
      return;
    }
    getDocs(collection(db, 'users', user.uid, 'likes'))
      .then((snap) => setLikedKeys(new Set(snap.docs.map((d) => d.id))))
      .catch(() => setLikedKeys(new Set()));
  }, [user]);

  const favorites = useMemo(() => {
    const toTrackId = (key: string) => {
      if (key.startsWith('song-')) return `local:${key.slice(5)}`;
      if (key.startsWith('dl-')) return `downloaded:${key.slice(3)}`;
      if (key.startsWith('youtube:') || key.startsWith('local:') || key.startsWith('downloaded:') || key.startsWith('external:')) return key;
      return `external:${key}`;
    };
    return new Set(Array.from(likedKeys).map(toTrackId));
  }, [likedKeys]);

  const isTooSimilar = (newTitle: string, currentTitle: string) => {
    const normalize = (str: string) => (str || '').toLowerCase().replace(/official|audio|video|lyric|lyrics|\(.*?\)|\[.*?\]/g, '').trim();
    const cleanCurrent = normalize(currentTitle);
    const cleanNew = normalize(newTitle);
    if (cleanNew === cleanCurrent) return true;

    const words = cleanCurrent.split(' ').filter((w) => w.length > 3);
    let matches = 0;
    for (const w of words) {
      if (cleanNew.includes(w)) matches++;
    }
    return words.length > 0 && matches >= Math.min(2, words.length);
  };

  const clearSleepTimer = useCallback(() => {
    if (sleepTimerTimeoutRef.current) {
      window.clearTimeout(sleepTimerTimeoutRef.current);
      sleepTimerTimeoutRef.current = null;
    }
    if (sleepTimerTickRef.current) {
      window.clearInterval(sleepTimerTickRef.current);
      sleepTimerTickRef.current = null;
    }
    setSleepTimerRemainingSec(null);
  }, []);

  const setSleepTimer = useCallback((minutes: number | null) => {
    clearSleepTimer();
    if (!minutes || minutes <= 0) return;

    const until = Date.now() + minutes * 60_000;
    const update = () => {
      const sec = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setSleepTimerRemainingSec(sec);
      if (sec <= 0 && sleepTimerTickRef.current) {
        window.clearInterval(sleepTimerTickRef.current);
        sleepTimerTickRef.current = null;
      }
    };

    update();
    sleepTimerTickRef.current = window.setInterval(update, 1000);
    sleepTimerTimeoutRef.current = window.setTimeout(() => {
      audioRef.current?.pause();
      setIsPlaying(false);
      clearSleepTimer();
    }, Math.max(0, until - Date.now()));
  }, [clearSleepTimer]);

  useEffect(() => () => clearSleepTimer(), [clearSleepTimer]);

  const setVolume = useCallback((newVolume: number) => {
    setVolumeState(newVolume);
    if (audioRef.current) audioRef.current.volume = newVolume / 100;
  }, []);

  const seek = useCallback((newProgress: number) => {
    setProgress(newProgress);
    if (audioRef.current && audioRef.current.duration) {
      if (audioRef.current) if (audioRef.current) audioRef.current.currentTime = (newProgress / 100) * audioRef.current.duration;
    }
  }, []);

  const toggleShuffle = useCallback(() => setShuffle((p) => !p), []);
  const cycleRepeat = useCallback(() => setRepeatMode((p) => (p === 'off' ? 'all' : p === 'all' ? 'one' : 'off')), []);

  const persistState = useCallback((state: PersistedPlaybackState) => {
    try {
      const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) localStorage.setItem(k, JSON.stringify(state));
    } catch {}
  }, []);

  const currentTrack = useMemo(() => (currentSong ? trackFromSong(currentSong) : null), [currentSong]);
  const queue = useMemo(() => (currentPlaylist?.songs ? currentPlaylist.songs.map(trackFromSong) : []), [currentPlaylist]);

  useEffect(() => {
    persistState({
      currentTrack,
      queue,
      volume,
      repeatMode,
      shuffle,
    });
  }, [currentTrack, queue, volume, repeatMode, shuffle, persistState]);

  const handleLike = useCallback(async (songId: string | number) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const key = songKeyFromId(songId);
    const isCurrentlyLiked = likedKeys.has(key);
    const ref = doc(db, 'users', currentUser.uid, 'likes', key);

    if (isCurrentlyLiked) {
      await deleteDoc(ref);
      setLikedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } else {
      const payloadSong = currentSong && songKeyFromId(currentSong.id) === key ? currentSong : null;
      await setDoc(ref, {
        id: key,
        song_id: payloadSong?.id ?? songId,
        title: payloadSong?.title ?? null,
        artist: payloadSong?.artist_name ?? payloadSong?.artist ?? null,
        duration_seconds: payloadSong?.duration_seconds ?? null,
        image_url: payloadSong?.image_url ?? payloadSong?.imageUrl ?? null,
        file_url: payloadSong?.file_url ?? null,
        updated_at: serverTimestamp(),
      }, { merge: true });

      setLikedKeys((prev) => new Set(prev).add(key));
    }
  }, [likedKeys, currentSong]);

  const toggleFavoriteSong = useCallback((song: Song) => {
    setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
    void handleLike(song.id);
  }, [handleLike]);

  const toggleFavorite = useCallback((track: Track) => {
    setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
    const legacyId = currentTrack?.id === track.id && currentSong ? currentSong.id : track.sourceId ?? track.id;
    void handleLike(legacyId);
  }, [currentSong, currentTrack, handleLike]);

  const toStorableFileUrl = (input: string) => {
    if (!input) return '';
    try {
      const u = new URL(input, window.location.origin);
      if (u.pathname.startsWith('/api/')) return `${u.pathname}${u.search}`;
      return input;
    } catch {
      return input;
    }
  };

  
function buildPlayableTrackFromRepair(original: any, candidate: any) {
  const extractYoutubeId = (url: string) => {
    if (!url) return null;
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
  };

  const youtubeId =
    cleanSourceValue(candidate.youtubeId) ||
    cleanSourceValue(candidate.youtube_id) ||
    cleanSourceValue(candidate.sourceId) ||
    cleanSourceValue(candidate.videoId) ||
    extractYoutubeId(candidate.url);

  if (!youtubeId) {
    throw new Error("REPAIR_CANDIDATE_MISSING_YOUTUBE_ID");
  }

  return {
    ...original,

    // reemplazar identidad, no conservar la vieja
    id: candidate.id || `yt:${youtubeId}`,
    youtubeId,
    youtube_id: youtubeId,
    sourceId: youtubeId,
    videoId: youtubeId,
    url: candidate.url || `https://www.youtube.com/watch?v=${youtubeId}`,

    // limpiar datos corruptos
    audioUrl: null,
    file_url: null,
    downloadId: null,

    // metadata visible real
    title: candidate.title || original.title,
    artist: candidate.artist || candidate.uploader || original.artist,
    artist_name: candidate.artist || candidate.uploader || original.artist,
    coverUrl: candidate.coverUrl || candidate.thumbnail || original.coverUrl,
    thumbnail: candidate.thumbnail || candidate.coverUrl || original.thumbnail,
    duration: candidate.duration || original.duration,

    source: "youtube",
    repaired: true,
  };
}

  const resolveMediaUrl = (input: string) => {
    if (!input) return '';
    try {
      const u = new URL(input, window.location.origin);
      if (u.pathname.startsWith('/api/')) return `${API_BASE}${u.pathname}${u.search}`;
      return u.href;
    } catch {
      return input;
    }
  };


  const repairTrack = async (track: Song): Promise<Song | null> => {
    try {
      const q = `${track.title} ${track.artist || track.artist_name || ''}`.trim();
      console.log(`[playback/repair] search q=${q}`);
      
      const searchRes = await apiFetch(`/api/music/search?q=${encodeURIComponent(q)}&limit=5`);
      const searchData = await searchRes.json().catch(() => null);
      
      let candidates = [];
      if (searchData && Array.isArray(searchData.items)) {
         for (const candidate of searchData.items) {
             const { score, rejectReason } = isSafeRepairMatch(track, candidate);
             console.log(`[playback/repair] candidate title="${candidate.title}" artist="${candidate.artist || candidate.uploader}" score=${score} reasons=${rejectReason || 'none'}`);
             if (rejectReason) {
                 console.log(`[playback/repair] reject reason=${rejectReason}`);
             } else if (score >= 90) {
                 candidates.push({ candidate, score });
             }
         }
      }
      
      let safeCandidate = null;
      if (candidates.length === 1) {
          safeCandidate = candidates[0].candidate;
      } else if (candidates.length > 1) {
          candidates.sort((a, b) => b.score - a.score);
          if (candidates[0].score - candidates[1].score < 10) {
              console.log('[playback/repair] reject reason=ambiguous_candidates');
          } else {
              safeCandidate = candidates[0].candidate;
          }
      }
      
      if (safeCandidate) {
         console.log(`[playback/repair] accepted youtubeId=${safeCandidate.youtube_id || safeCandidate.id}`);
         
         const repairedTrack = buildPlayableTrackFromRepair(track, safeCandidate);

         console.debug("[playback/repair] repaired track", {
           oldId: track.id,
           oldYoutubeId: track.youtubeId,
           newYoutubeId: repairedTrack.youtubeId,
           title: repairedTrack.title,
           artist: repairedTrack.artist,
         });
         
         console.log(`[playback/repair] build playable track oldYoutubeId=${track.youtubeId || 'null'} newYoutubeId=${repairedTrack.youtubeId}`);
         
         setCurrentSong(repairedTrack);
         
         const currentUser = auth.currentUser;
         if (currentUser && track.id) {
             // We can delete the old one or just let it be. But we must return the new one.
             const key = songKeyFromId(track.id);
             try {
               deleteDoc(doc(db, 'users', currentUser.uid, 'recents', key)).catch(() => {});
             } catch (e) {
               console.warn('[playback/repair] firestore error ignored', e);
             }
             
             try {
               const saved = localStorage.getItem('vns_recents');
               if (saved) {
                 const parsed = JSON.parse(saved);
                 const filtered = parsed.filter((r: any) => r.id !== track.id);
                 localStorage.setItem('vns_recents', JSON.stringify(filtered));
               }
             } catch {}
         }
         
         return repairedTrack;
      } else {
         console.log('[playback/repair] failed unsafe_match');
         console.log('[playback/repair] remove broken recent');
         
         setPlaybackError('No pude reparar esta canción con seguridad. Búscala nuevamente.');
         
         const currentUser = auth.currentUser;
         if (currentUser && track.id) {
             const key = songKeyFromId(track.id);
             deleteDoc(doc(db, 'users', currentUser.uid, 'recents', key)).catch(e => console.warn('[playback/repair] firestore error', e));
             
             try {
               const saved = localStorage.getItem('vns_recents');
               if (saved) {
                 const parsed = JSON.parse(saved);
                 const filtered = parsed.filter((r: any) => r.id !== track.id);
                 localStorage.setItem('vns_recents', JSON.stringify(filtered));
               }
             } catch {}
         }
         return null;
      }
    } catch (e) {
      console.error('[playback/repair] error during repair', e);
      return null;
    }
  };
  
  const emitListeningEvent = useCallback((song: Song | Track | null, eventType: string) => {
    if (!song || !user) return;
    const key = (song as any).youtube_id || song.id;
    if (!key) return;

    if (!sentEventsRef.current[key]) sentEventsRef.current[key] = new Set();
    if (sentEventsRef.current[key].has(eventType)) return;
    sentEventsRef.current[key].add(eventType);

    const progress = audioRef.current?.currentTime || 0;
    const duration = audioRef.current?.duration || song.duration_seconds || song.duration || 0;
    const progressPercent = duration > 0 ? Math.round((progress / duration) * 100) : 0;

    apiFetch('/api/music/listening-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        youtubeId: (song as any).youtube_id || (song.source === 'youtube' ? song.id : null),
        title: song.title,
        artist: song.artist || song.artist_name || null,
        duration: duration || null,
        listenedSeconds: Math.round(progress) || null,
        progressPercent: progressPercent || null,
        eventType,
        source: 'home'
      })
    }).catch(() => {});
  }, [user]);

  const playSongInternal = useCallback(async (song: Song, playlist?: Playlist, isCrossfade = false, opts?: { userInitiated?: boolean, forcePlay?: boolean, fromQueueNavigation?: boolean }) => {
    setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
    setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
    lastUserInitiatedRef.current = Boolean(opts?.userInitiated);
    
    const songKey = String(song.youtube_id || song.id);

    if (!song?.file_url) {
      setPlaybackError('No hay audio disponible para reproducir esta canción.');
      setPlaybackErrorTrackKey(songKey);
      setPreparingTrackKey(null);
            return;
    }

    // Generate Request ID for cancellation
    const requestId = crypto.randomUUID();
    currentPrepareRequestRef.current = requestId;

    if (opts?.userInitiated) {
      setPreparingTrackKey(songKey);
    }

    if (import.meta.env.DEV) console.debug('[playback/playSong] song', song);

    if (import.meta.env.DEV && opts?.forcePlay) console.log('[playback/playSong] forcePlay=true fromQueueNavigation=' + Boolean(opts?.fromQueueNavigation));
    if (currentSong && getTrackKey(currentSong) === getTrackKey(song) && !isCrossfade && !opts?.forcePlay) {
      const a = audioRef.current;
      if (a) {
        if (a.paused) {
          if (import.meta.env.DEV) console.debug('[playback/audio.play] start (toggle)');
          a.play()
            .then(() => {
              if (import.meta.env.DEV) console.debug('[playback/audio.play] ok (toggle)');
            })
            .catch((error) => {
              if (import.meta.env.DEV) console.debug('[playback/audio.play] error (toggle)', error);
              setIsPlaying(false);
              // don't set error yet, let onerror listener handle repair
            });
        } else {
          a.pause();
        }
        return;
      }
    }

    setCurrentSong(song);
    setIsPlaying(false);
    bufferDoneRef.current = false;
    setProgress(0);
    const myGen = ++playGenRef.current;

    playedIdsRef.current.add(songKey);

    if (playlist) {
      setCurrentPlaylist(playlist);
    } else {
      const radioId = `radio-${Date.now()}`;
      setCurrentPlaylist({
        id: radioId,
        name: 'Radio automática',
        description: '',
        image_url: '',
        songs: [song],
      });

      const buildSeedQuery = (s: Song) => {
        const cleanTitle = s.title.split('-')[0].split('(')[0].trim();
        const artist = s.artist || s.artist_name || '';
        return artist && artist !== 'Internet' && artist !== 'Desconocido' ? `${artist} mix canciones` : `${cleanTitle} mix`;
      };

      const fetchAndAppendRelated = async (seedSong: Song, targetPlaylistId: string) => {
        if (expandingQueueRef.current) return;
        expandingQueueRef.current = true;
        try {
          const excludeParam = Array.from(playedIdsRef.current).slice(0, 80).join(',');
          const seedQuery = buildSeedQuery(seedSong);
          const res = await apiFetch(`/api/music/recommendations?seed=${encodeURIComponent(seedQuery)}&exclude=${encodeURIComponent(excludeParam)}`);
          if (!res.ok) return;
          const json = await res.json().catch(() => null);
          const data = Array.isArray(json) ? json : Array.isArray((json as any)?.items) ? (json as any).items : [];
          if (!Array.isArray(data) || data.length === 0) return;

          let validRecs = data.filter((rec) => !playedIdsRef.current.has(String(rec.youtube_id || rec.id)));
          let strictRecs = validRecs.filter((rec) => !isTooSimilar(rec.title, seedSong.title));
          if (strictRecs.length === 0) strictRecs = validRecs;

          // Process recommendations sequentially, max 3 per expansion, to prevent
          // parallel POST /api/downloads that cause ON CONFLICT race in PostgreSQL.
          let downloadedCount = 0;
          const MAX_RADIO_DOWNLOADS = 3;

          if (import.meta.env.DEV) console.debug('[radio/expand] start', { candidates: strictRecs.length, limited: MAX_RADIO_DOWNLOADS });

          for (const rec of strictRecs.slice(0, 15)) {
            if (downloadedCount >= MAX_RADIO_DOWNLOADS) break;
            const recKey = String(rec.youtube_id || rec.id || '');

            if (rec.source === 'local') {
              const newSong = {
                id: rec.id,
                title: rec.title,
                artist: rec.artist || rec.uploader || 'Desconocido',
                artist_name: rec.artist || rec.uploader || 'Desconocido',
                file_url: `${API_BASE}/api/downloads/stream/${rec.id}`,
                imageUrl: rec.thumbnail_url || rec.image_url || '',
                image_url: rec.thumbnail_url || rec.image_url || '',
                duration: rec.duration_seconds || 0,
                duration_seconds: rec.duration_seconds || 0,
                source: 'local',
                youtube_id: rec.youtube_id || rec.id,
              } as Song;

              setCurrentPlaylist((prev) => {
                if (!prev || prev.id !== targetPlaylistId) return prev;
                if (prev.songs?.some((s) => String(s.youtube_id) === String(rec.youtube_id || rec.id))) return prev;
                return { ...prev, songs: [...(prev.songs || []), newSong] };
              });
            } else {
              // Skip if already downloading this youtubeId for radio
              if (!recKey || pendingRadioDownloadsRef.current.has(recKey)) {
                if (import.meta.env.DEV) console.debug(`[playback/radio-expand] skip already pending key=${recKey}`);
                continue;
              }
              // Skip if already in playlist
              const alreadyInPlaylist = playerStateRef.current.currentPlaylist?.songs?.some(
                (s) => String(s.youtube_id) === recKey
              );
              if (alreadyInPlaylist) continue;

              pendingRadioDownloadsRef.current.add(recKey);
              downloadedCount++;
              if (import.meta.env.DEV) console.debug(`[playback/radio-expand] downloading key=${recKey}`);
              try {
                // Sequential await — one download at a time to prevent DB race
                const dlRes = await apiFetch(`/api/downloads`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: rec.url, title: rec.title, uploader: rec.uploader, mode: 'audio', quality: settings.audioQuality, youtube_id: rec.youtube_id || rec.id }),
                });
                const dlData = dlRes.ok ? await dlRes.json().catch(() => null) : null;
                if (dlData && dlData.id) {
                  const downloadedSong = downloadToSong(dlData);
                  setCurrentPlaylist((prev) => {
                    if (!prev || prev.id !== targetPlaylistId) return prev;
                    if (prev.songs?.some((s) => s.id === downloadedSong.id || String(s.youtube_id) === String(rec.youtube_id || rec.id))) return prev;
                    return { ...prev, songs: [...(prev.songs || []), downloadedSong] };
                  });
                }
              } catch {
                // Ignore individual download errors — radio continues
              } finally {
                pendingRadioDownloadsRef.current.delete(recKey);
              }
            }
          }
        } finally {
          expandingQueueRef.current = false;
        }
      };

      fetchAndAppendRelated(song, radioId).catch(() => {});
    }

    if (audioRef.current) {
      if (isCrossfade && isPlaying) {
        const fadingOut = audioRef.current;
        oldAudioRef.current = fadingOut;
        let vol = fadingOut.volume;
        const fadeOutInt = window.setInterval(() => {
          vol -= 0.05;
          if (vol <= 0) {
            window.clearInterval(fadeOutInt);
            fadingOut.pause();
            fadingOut.src = '';
            if (oldAudioRef.current === fadingOut) oldAudioRef.current = null;
          } else {
            fadingOut.volume = Math.max(0, vol);
          }
        }, 250);
      } else {
        audioRef.current?.pause();
        audioRef.current.src = '';
        audioRef.current = null;
        if (oldAudioRef.current) {
          oldAudioRef.current.pause();
          oldAudioRef.current.src = '';
          oldAudioRef.current = null;
        }
      }
    }

    const currentUser = auth.currentUser;
    if (currentUser) {
      const key = songKeyFromId(song.id);
      const ytUrl = song.youtube_id ? makeSafeYoutubeWatchUrl(song.youtube_id) : null;
      let ytId = song.youtube_id || null;
      if (!ytId && song.file_url) {
         try {
           const urlStr = song.file_url;
           if (urlStr) {
             const u = new URL(urlStr);
             ytId = u.searchParams.get('v') || null;
           }
         } catch {}
      }

      try {
        setDoc(doc(db, 'users', currentUser.uid, 'recents', key), {
          id: key,
          song_id: song.id,
          title: song.title,
          artist: song.artist_name ?? song.artist ?? null,
          duration_seconds: song.duration_seconds ?? null,
          image_url: song.image_url ?? song.imageUrl ?? null,
          coverUrl: song.image_url ?? song.imageUrl ?? null,
          file_url: toStorableFileUrl(song.file_url),
          audioUrl: toStorableFileUrl(song.file_url),
          url: ytUrl || song.file_url || null,
          youtube_id: ytId,
          youtubeId: ytId,
          sourceId: ytId ?? song.id ?? null,
          videoId: ytId,
          source: song.source ?? 'youtube',
          played_at: serverTimestamp(),
        }, { merge: true }).catch(() => {});
      } catch (e) {
        console.warn('[playback/recents] firestore error ignored', e);
      }
    }

    const resolvedUrl = resolveMediaUrl(song.file_url);
    
    let finalAudioUrl = resolvedUrl;
    try {
      const u = new URL(resolvedUrl);
      if (u.pathname.includes('/stream/') && song.youtube_id) {
        u.searchParams.set('expected_youtube_id', song.youtube_id);
      }
      finalAudioUrl = u.href;
    } catch {}

    if (import.meta.env.DEV) console.debug('[playback/audioUrl]', finalAudioUrl);
    let isInternalConvert = false;
    try {
      const u = new URL(finalAudioUrl);
      if (u.hostname === 'convert') isInternalConvert = true;
    } catch {}
    if (isInternalConvert) {
      setPlaybackError('El audio no es accesible desde el navegador. Intenta nuevamente.');
      return;
    }

    const isMyGen = () => playGenRef.current === myGen;
    if (!finalAudioUrl || finalAudioUrl.includes('youtube.com') || finalAudioUrl.includes('youtu.be') || finalAudioUrl.includes('stream-direct')) {
      
      setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
      console.log('[playback/prepare] start');
      try {
        const ytId = cleanSourceValue(song.youtube_id || (song as any).sourceId || (song as any).videoId);
        const url = cleanSourceValue((song as any).url || (song as any).webpage_url);
        const audioUrl = cleanSourceValue(song.file_url);
        
        if (!ytId && !url || ytId === 'null' || (url && url.includes('watch?v=null'))) {
           console.log('[playback/prepare] blocked invalid source youtubeId=null');
           if (song.title && (song.artist || song.artist_name)) {
              console.debug(`[playback/repair] start reason=MISSING_TRACK_SOURCE_CLIENT`);
              const repairedSong = await repairTrack(song);
              if (repairedSong && isMyGen()) {
                console.log(`[playback/repair] retry prepare with repairedTrack youtubeId=${repairedSong.youtube_id || repairedSong.youtubeId}`);
                playSongInternal(repairedSong, playlist, isCrossfade, opts);
                return;
              }
           }
           console.log('[playback/prepare] clearing corrupt item');
           if (isMyGen()) {
             setPlaybackError('Esta canción está corrupta. Búscala nuevamente.');
            setPlaybackErrorTrackKey(songKey);
             
           }
           return;
        }
        
        let dlRes = await apiFetch('/api/downloads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: ytId ? `https://www.youtube.com/watch?v=${ytId}` : (url || audioUrl || ''),
            title: song.title,
            uploader: song.artist,
            mode: 'audio',
            youtube_id: ytId
          })
        });
        let dlData = await dlRes.json().catch(() => null);
        
        if (!isMyGen() || currentPrepareRequestRef.current !== requestId) return;

        if (!dlRes.ok) {
          const error: any = new Error(dlData?.message || "No pudimos preparar esta canción");
          error.code = dlData?.code;
          error.status = dlRes.status;
          error.payload = dlData;
          throw error;
        }

        
        if (song.youtube_id && dlData?.youtubeId && dlData.youtubeId !== song.youtube_id) {
           console.warn(`[playback/validate] source-mismatch old=${song.youtube_id} actual=${dlData.youtubeId}`);
           throw { status: 400, code: 'MISSING_TRACK_SOURCE', message: 'Source mismatch' };
        }
        if (dlData?.status === 'ready' && dlData?.audioUrl) {
          console.log('[playback/prepare] ready audioUrl=' + dlData.audioUrl);
          finalAudioUrl = dlData.audioUrl;
        } else if ((dlData.status === 'preparing' || dlRes?.status === 202) && dlData.jobId) {
          console.log(`[playback/prepare] pending jobId=${dlData.jobId}`);
          console.log('[playback/prepare] polling');
          let attempts = 60;
          let resolved = null;
          while (attempts > 0 && isMyGen()) {
            await new Promise(r => setTimeout(r, 2000));
            const statRes = await apiFetch(`/api/downloads/status/${dlData.jobId}`);
            const statData = await statRes.json().catch(() => null);
            if (statData?.status === 'ready' && statData?.audioUrl) {
              resolved = statData.audioUrl;
              break;
            } else if (statData?.status === 'failed') {
              throw new Error(statData.message || 'Worker failed');
            }
            attempts--;
          }
          if (!isMyGen() || currentPrepareRequestRef.current !== requestId) return;
          if (!resolved) throw new Error('Timeout resolving audio');
          console.log('[playback/prepare] ready audioUrl=' + resolved);
          finalAudioUrl = resolved;
        } else {
          throw new Error('No pudimos preparar esta canción');
        }
        
      } catch (err: any) {
        console.debug("[playback/prepare] error payload", {
          status: err?.status,
          code: err?.code,
          message: err?.message,
          payload: err?.payload,
          track: song
        });
        
        if (
          err?.code === "MISSING_TRACK_SOURCE_CLIENT" ||
          err?.code === "MISSING_TRACK_SOURCE" ||
          (err?.status === 400 && song?.title && (song?.artist || song?.artist_name))
        ) {
          console.debug(`[playback/repair] start reason=${err?.code || '400_MISSING_SOURCE'}`);
          const repairedSong = await repairTrack(song);
          if (repairedSong && isMyGen()) {
            console.log('[playback/repair] retry prepare');
            playSongInternal(repairedSong, playlist, isCrossfade, opts);
            return;
          }
        }
        
        console.log('[playback/prepare] failed', err);
        if (isMyGen()) {
          setPlaybackError('No pudimos preparar esta canción. Intenta con otra.');
          setPlaybackErrorTrackKey(songKey);
          
        }
        return;
      }
    }

    let audio: HTMLAudioElement;
    if (preloadedAudioRef.current && preloadedAudioRef.current.src.includes(finalAudioUrl)) {
      audio = preloadedAudioRef.current;
      preloadedAudioRef.current = null;
    } else {
      audio = new Audio(finalAudioUrl);
    }
    audioRef.current = audio;

    
    let playStarted = false;

    const onDownloadReady = (e: Event) => {
      const ev = e as CustomEvent;
      if (!isMyGen() || currentPrepareRequestRef.current !== requestId) return;
      const eventYtId = String((ev as any).detail?.youtubeId || '');
      const songYtId = String(song.youtube_id || song.id || '');
      if (!eventYtId || !songYtId || eventYtId !== songYtId) return;
      const localUrl: string = (ev as any).detail?.streamUrl;
      
      
      

      if (!localUrl || audio.src?.includes('/stream/')) return;
      const wasPlaying = !audio.paused;
      const currentTime = audio.currentTime;
      audio.src = localUrl;
      audio.load();
      if (currentTime > 0) audio.currentTime = currentTime;
      if (wasPlaying || !playStarted) {
        audio.play().then(() => { if (isMyGen()) { playStarted = true; setIsPlaying(true); } }).catch(() => {});
      }
    };

    window.addEventListener('vns:download-ready', onDownloadReady);
    audio.addEventListener('emptied', () => window.removeEventListener('vns:download-ready', onDownloadReady), { once: true });

    if (isCrossfade) {
      audio.volume = 0;
      const targetVol = Math.max(0, Math.min(1, volume / 100));
      let currentVol = 0;
      const fadeInInt = window.setInterval(() => {
        currentVol += 0.05;
        if (currentVol >= targetVol) {
          window.clearInterval(fadeInInt);
          audio.volume = targetVol;
        } else {
          audio.volume = currentVol;
        }
      }, 250);
    } else {
      audio.volume = Math.max(0, Math.min(1, volume / 100));
    }

    audio.addEventListener('play', () => { if (isMyGen()) setIsPlaying(true); });
    audio.addEventListener('pause', () => { if (isMyGen()) setIsPlaying(false); });

    const doPlay = () => {
      if (playStarted || !isMyGen() || currentPrepareRequestRef.current !== requestId) return;
      if (import.meta.env.DEV) console.debug('[playback/audio.play] start');
      audio
        .play()
        .then(() => {
          if (import.meta.env.DEV) console.debug('[playback/audio.play] ok');
          if (isMyGen() && currentPrepareRequestRef.current === requestId) {
            playStarted = true;
            setIsPlaying(true);
            setPlayingTrackKey(songKey);
            setPreparingTrackKey(null);
          }
        })
        .catch((error) => {
          if (import.meta.env.DEV) console.debug('[playback/audio.play] error', error);
          if (isMyGen() && currentPrepareRequestRef.current === requestId) {
            setIsPlaying(false);
            setPreparingTrackKey(null);
            setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');
            setPlaybackErrorTrackKey(songKey);
          }
        });
    };

    audio.addEventListener('canplay', () => {
      if (!playStarted && isMyGen()) doPlay();
    }, { once: true });

    doPlay();
    [1500, 4000, 10000].forEach((delay) => {
      window.setTimeout(() => { if (!playStarted && isMyGen()) doPlay(); }, delay);
    });

    let isRecovering = false;
    audio.addEventListener('error', async () => {
      if (isRecovering || !isMyGen()) return;
      isRecovering = true;
      repairingRef.current = true;
      setIsPlaying(false);
      
      // setPlaybackError('No pudimos reproducir esta canción. Intentando repararla...');

      try {
        const maxRepairAttemptsPerTrack = 1;
        const repairKey = String(song.youtube_id || song.id || '');
        const prevAttempts = repairAttemptsRef.current.get(repairKey) || 0;
        if (prevAttempts >= maxRepairAttemptsPerTrack) {
          setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');
            setPlaybackErrorTrackKey(songKey);
          if (!lastUserInitiatedRef.current && settings.autoplay) next();
          try {
            const lp = JSON.parse(localStorage.getItem('vns_lastPlayed') || '{}');
            if (lp.id === song.id || String(lp.id) === String(song.id)) if (user?.uid) localStorage.removeItem(getUserStorageKey('vns_lastPlayed', user.uid)!);
          } catch {}
          return;
        }
        if (!song.title && !song.artist && !song.artist_name) {
           console.log('[resolve-audio] blocked empty title/artist');
           setPlaybackError('Esta canción está corrupta. Búscala nuevamente.');
            setPlaybackErrorTrackKey(songKey);
           if (!lastUserInitiatedRef.current && settings.autoplay) next();
           try {
             const lp = JSON.parse(localStorage.getItem('vns_lastPlayed') || '{}');
             if (lp.id === song.id || String(lp.id) === String(song.id)) if (user?.uid) localStorage.removeItem(getUserStorageKey('vns_lastPlayed', user.uid)!);
           } catch {}
           return;
        }
        repairAttemptsRef.current.set(repairKey, prevAttempts + 1);
        const repairRes = await apiFetch(`/api/music/resolve-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            track: {
              id: song.id,
              sourceId: song.youtube_id ?? null,
              youtubeId: song.youtube_id ?? null,
              url: song.file_url ?? null,
              title: song.title,
              artist: song.artist_name ?? song.artist ?? null,
              coverUrl: song.image_url ?? song.imageUrl ?? null,
            },
            forceRepair: true,
            userInitiated: lastUserInitiatedRef.current,
          }),
        });
        const repairJson = repairRes.ok ? await repairRes.json().catch(() => null) : null;
        const repairedAudioUrl = String(repairJson?.audioUrl || '').trim();
        if (!isMyGen() || !repairRes.ok || !repairJson?.ok || !repairedAudioUrl) {
          setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');
            setPlaybackErrorTrackKey(songKey);
          if (!lastUserInitiatedRef.current && settings.autoplay) next();
          return;
        }

        const resolved = resolveMediaUrl(repairedAudioUrl);
        let finalRepairedAudioUrl = resolved;
        try {
          const u = new URL(resolved);
          const newYtId = repairJson?.track?.youtubeId || song.youtube_id;
          if (u.pathname.includes('/stream/') && newYtId) {
            u.searchParams.set('expected_youtube_id', newYtId);
          }
          finalRepairedAudioUrl = u.href;
        } catch {}

        audio.src = finalRepairedAudioUrl;
        audio.load();
        console.log(`[playback/repair] replacing old stream old=${song.file_url} new=${repairedAudioUrl}`);
        setCurrentSong((prev) => {
          if (prev && prev.id === song.id) {
            return {
              ...prev,
              id: repairJson?.track?.id || prev.id,
              file_url: toStorableFileUrl(repairedAudioUrl),
              youtube_id: repairJson?.track?.youtubeId || prev.youtube_id,
            };
          }
          return prev;
        });
        setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
        doPlay();
      } finally {
        isRecovering = false;
        repairingRef.current = false;
        
        
      }
    });

    audio.ontimeupdate = () => {
      if (audioRef.current !== audio) return;
      if (!audio.duration) return;
      const prog = (audio.currentTime / audio.duration) * 100;
      setProgress(prog);

      if (prog >= 80 && !bufferDoneRef.current) {
        bufferDoneRef.current = true;
        const state = playerStateRef.current;
        if (state.currentPlaylist?.songs && state.currentSong) {
          const isRadio = String(state.currentPlaylist.id).startsWith('radio-');
          let nextSongToPreload: Song | null = null;
          if (state.shuffle && !isRadio) {
            const rem = state.currentPlaylist.songs.filter((s) => s.id !== state.currentSong?.id);
            nextSongToPreload = rem.length > 0 ? rem[0] : null;
          } else {
            const idx = state.currentPlaylist.songs.findIndex((s) => s.id === state.currentSong?.id);
            if (idx !== -1 && idx < state.currentPlaylist.songs.length - 1) nextSongToPreload = state.currentPlaylist.songs[idx + 1];
            else if (state.repeatMode === 'all') nextSongToPreload = state.currentPlaylist.songs[0];
          }

          // Preload ONLY for songs that are already local/downloaded — never trigger
          // Convert or Worker downloads just because we hit 80% progress.
          // A valid local URL is either /api/downloads/stream/... or source='local'.
          if (nextSongToPreload?.file_url) {
            const nextUrl = nextSongToPreload.file_url;
            const isLocalStream = nextUrl.includes('/api/downloads/stream/');
            const isLocalSource = nextSongToPreload.source === 'local' || nextSongToPreload.source === 'downloaded';
            const isAlreadyPreloading = preloadedAudioRef.current !== null;

            if ((isLocalStream || isLocalSource) && !isAlreadyPreloading) {
              if (import.meta.env.DEV) console.debug('[radio/preload] start local', { id: nextSongToPreload.id, url: nextUrl.slice(0, 60) });
              const preloader = new Audio();
              preloader.preload = 'auto';
              preloader.src = resolveMediaUrl(nextUrl);
              preloadedAudioRef.current = preloader;
              if (import.meta.env.DEV) console.debug('[radio/preload] done');
            } else if (!isLocalStream && !isLocalSource) {
              if (import.meta.env.DEV) console.debug('[radio/preload] skip non-local', { source: nextSongToPreload.source, id: nextSongToPreload.id });
            } else if (isAlreadyPreloading) {
              if (import.meta.env.DEV) console.debug('[radio/preload] skip already preloading');
            }
          }

          if (isRadio) {
            const songs = state.currentPlaylist.songs || [];
            const currentIdx = songs.findIndex((s) => s.id === state.currentSong?.id);
            const songsLeft = songs.length - 1 - currentIdx;

            if (songsLeft <= 2 && !expandingQueueRef.current) {
              expandingQueueRef.current = true;
              const seedSong = state.currentSong;
              const targetId = state.currentPlaylist.id;
              const cleanTitle = seedSong.title.split('-')[0].split('(')[0].trim();
              const artist = seedSong.artist || seedSong.artist_name || '';
              const seedQuery = artist && artist !== 'Internet' && artist !== 'Desconocido' ? `${artist} mix canciones` : `${cleanTitle} mix canciones`;
              const excludeParam = Array.from(playedIdsRef.current).slice(0, 80).join(',');

              apiFetch(`/api/music/recommendations?seed=${encodeURIComponent(seedQuery)}&exclude=${encodeURIComponent(excludeParam)}`)
                .then((r) => (r.ok ? r.json().catch(() => null) : null))
                .then(async (json: any) => {
                  const data: any[] = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
                  if (!Array.isArray(data) || data.length === 0) return;
                  let validRecs = data.filter((rec) => !playedIdsRef.current.has(String(rec.youtube_id || rec.id)));
                  let strictRecs = validRecs.filter((rec) => !isTooSimilar(rec.title, seedSong.title));
                  if (strictRecs.length === 0) strictRecs = validRecs;

                  // Process sequentially, max 3, with dedup to prevent DB race
                  let downloadedCount = 0;
                  const MAX_RADIO_DOWNLOADS = 3;

                  if (import.meta.env.DEV) console.debug('[radio/expand] start', { candidates: strictRecs.length, limited: MAX_RADIO_DOWNLOADS });

                  for (const rec of strictRecs.slice(0, 15)) {
                    if (downloadedCount >= MAX_RADIO_DOWNLOADS) break;
                    const recKey = String(rec.youtube_id || rec.id || '');

                    if (rec.source === 'local') {
                      const newSong: Song = {
                        id: rec.id,
                        title: rec.title,
                        artist: rec.artist || rec.uploader || 'Desconocido',
                        artist_name: rec.artist || rec.uploader || 'Desconocido',
                        file_url: `${API_BASE}/api/downloads/stream/${rec.id}`,
                        imageUrl: rec.thumbnail_url || '',
                        image_url: rec.thumbnail_url || '',
                        duration: rec.duration_seconds || 0,
                        duration_seconds: rec.duration_seconds || 0,
                        source: 'local',
                        youtube_id: rec.youtube_id || rec.id,
                      } as Song;

                      setCurrentPlaylist((prev) => {
                        if (!prev || prev.id !== targetId) return prev;
                        if (prev.songs?.some((s) => String(s.youtube_id) === String(rec.youtube_id || rec.id))) return prev;
                        return { ...prev, songs: [...(prev.songs || []), newSong] };
                      });
                    } else {
                      if (!recKey || pendingRadioDownloadsRef.current.has(recKey)) {
                        if (import.meta.env.DEV) console.debug(`[playback/radio-expand] skip already pending key=${recKey}`);
                        continue;
                      }
                      const alreadyInPlaylist = playerStateRef.current.currentPlaylist?.songs?.some(
                        (s) => String(s.youtube_id) === recKey
                      );
                      if (alreadyInPlaylist) continue;

                      pendingRadioDownloadsRef.current.add(recKey);
                      downloadedCount++;
                      if (import.meta.env.DEV) console.debug(`[playback/radio-expand] downloading key=${recKey}`);
                      try {
                        const dlRes = await apiFetch(`/api/downloads`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ url: makeSafeYoutubeWatchUrl(rec.youtube_id || rec.id), title: rec.title, uploader: rec.uploader, mode: 'audio', quality: settings.audioQuality, youtube_id: rec.youtube_id || rec.id }),
                        });
                        const dlData = dlRes.ok ? await dlRes.json().catch(() => null) : null;
                        if (dlData && dlData.id) {
                          const downloadedSong = downloadToSong(dlData);
                          setCurrentPlaylist((prev) => {
                            if (!prev || prev.id !== targetId) return prev;
                            if (prev.songs?.some((s) => s.id === downloadedSong.id || String(s.youtube_id) === String(rec.youtube_id || rec.id))) return prev;
                            return { ...prev, songs: [...(prev.songs || []), downloadedSong] };
                          });
                        }
                      } catch {
                        // Ignore individual download errors
                      } finally {
                        pendingRadioDownloadsRef.current.delete(recKey);
                      }
                    }
                  }
                })
                .catch(() => {})
                .finally(() => { expandingQueueRef.current = false; });
            }
          }
        }
      }
    };

    audio.onended = async (e?: Event) => {
      if (audioRef.current !== audio) return;
      if (repairingRef.current && isMyGen()) return;
      const isManualSkip = e && (e as any).detail?.isManualSkip;
      const isCrossfade = e && (e as any).detail?.isCrossfade;

      const expectedDuration = audio.duration !== Infinity && !Number.isNaN(audio.duration) ? audio.duration : (song.duration_seconds || song.durationSecs || 0);
      const audioActuallyEnded = audio.ended || (e?.type === 'ended');
      if (!isManualSkip && !isCrossfade && !audioActuallyEnded && expectedDuration > 0 && expectedDuration - audio.currentTime > 3) {
        setIsPlaying(false);
        return;
      }

      const state = playerStateRef.current;

      if (state.repeatMode === 'one' && audioRef.current) {
        if (audioRef.current) if (audioRef.current) audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => setIsPlaying(false));
        return;
      }

      const songs = state.currentPlaylist?.songs;
      if (state.currentPlaylist && songs && songs.length > 0) {
        const isRadio = String(state.currentPlaylist.id).startsWith('radio-');
        if (state.shuffle && !isRadio) {
          const remaining = songs.filter((s) => s.id !== state.currentSong?.id);
          if (remaining.length > 0) playSongInternal(remaining[Math.floor(Math.random() * remaining.length)], state.currentPlaylist, isCrossfade, { userInitiated: false });
          else if (state.repeatMode === 'all') playSongInternal(songs[0], state.currentPlaylist, isCrossfade, { userInitiated: false });
          else { setIsPlaying(false); setProgress(0); }
        } else {
          const idx = songs.findIndex((s) => s.id === state.currentSong?.id);
          if (idx !== -1 && idx < songs.length - 1) playSongInternal(songs[idx + 1], state.currentPlaylist, isCrossfade, { userInitiated: false });
          else if (idx !== -1 && state.repeatMode === 'all') playSongInternal(songs[0], state.currentPlaylist, isCrossfade, { userInitiated: false });
          else {
            if (settings.autoplay && !autoplayBusyRef.current && state.currentSong) {
              autoplayBusyRef.current = true;
              try {
                const artist = state.currentSong.artist || state.currentSong.artist_name || '';
                const title = state.currentSong.title || '';
                const seedQuery = artist && artist !== 'Internet' && artist !== 'Desconocido' 
                  ? `${artist} ${title} similar songs` 
                  : `${title} similar music`;
                  
                const res = await apiFetch(`/api/music/recommendations?seed=${encodeURIComponent(seedQuery)}`);
                if (res.ok) {
                  const json = await res.json().catch(() => null);
                  const data: any[] = Array.isArray(json) ? json : Array.isArray((json as any)?.items) ? (json as any).items : [];
                  const currentPlaylistIds = new Set(state.currentPlaylist?.songs?.map((s) => String(s.id)) || []);
                  let newSongs = Array.isArray(data) ? data.filter((d) => !currentPlaylistIds.has(String(d.id))) : [];
                  
                  if (newSongs.length > 0) {
                    const scored = newSongs.map((it: any) => ({
                       ...it,
                       _score: rankRecommendationCandidate(title, artist, it)
                    }))
                    .filter((it: any) => it._score > -50 && !isTooSimilar(it.title, title))
                    .sort((a: any, b: any) => b._score - a._score);
                    
                    if (scored.length > 0) newSongs = scored;
                  }

                  if (newSongs.length > 0) {
                    const rec = newSongs[0];
                    let nextSong: Song | null = null;

                    if (rec.source === 'local') {
                      nextSong = {
                        id: rec.id,
                        title: rec.title,
                        artist: rec.artist || rec.uploader || 'Desconocido',
                        artist_name: rec.artist || rec.uploader || 'Desconocido',
                        file_url: `${API_BASE}/api/downloads/stream/${rec.id}`,
                        imageUrl: rec.thumbnail_url || rec.image_url || '',
                        image_url: rec.thumbnail_url || rec.image_url || '',
                        duration: rec.duration_seconds || 0,
                        duration_seconds: rec.duration_seconds || 0,
                        source: 'local',
                        youtube_id: rec.youtube_id || rec.id,
                      } as Song;
                    } else {
                      try {
                        const dlRes = await apiFetch(`/api/downloads`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ url: makeSafeYoutubeWatchUrl(rec.youtube_id || rec.id), title: rec.title, uploader: rec.uploader, mode: 'audio', quality: settings.audioQuality, youtube_id: rec.youtube_id || rec.id }),
                        });
                        if (dlRes.ok) {
                          let dlData = await dlRes.json();
                          if (dlData && dlData.id) nextSong = downloadToSong(dlData);
                        }
                      } catch {}
                    }

                    if (nextSong) {
                      const newPlaylist = state.currentPlaylist ? { ...state.currentPlaylist, songs: [...(state.currentPlaylist.songs || []), nextSong] } : undefined;
                      playSongInternal(nextSong, newPlaylist, isCrossfade, { userInitiated: false });
                      setIsPlaying(true);
                      autoplayBusyRef.current = false;
                      return;
                    }
                  }
                }
              } finally {
                autoplayBusyRef.current = false;
              }
            }
            setIsPlaying(false); setProgress(0);
          }
        }
      } else {
        setIsPlaying(false); setProgress(0);
      }
    };

    const numId = Number.parseInt(String(song.id).replace('dl-', ''), 10);
    try {
      localStorage.setItem('vns_lastPlayed', JSON.stringify({
        id: numId,
        title: song.title,
        artist: song.artist ?? song.artist_name ?? null,
        duration_seconds: song.duration_seconds ?? song.durationSecs ?? null,
        thumbnail_url: song.imageUrl ?? song.image_url ?? null,
        filename: song.file_url?.split('/').pop() ?? '',
        mode: 'audio',
        youtube_id: song.youtube_id || (song as any).sourceId || null,
      }));
    } catch {}
  }, [currentSong, isPlaying, isTooSimilar, resolveMediaUrl, settings.audioQuality, settings.autoplay, toStorableFileUrl, volume]);

  const playSong = useCallback((song: Song, playlist?: Playlist, isCrossfade = false, opts?: any) => {
    playSongInternal(song, playlist, isCrossfade, { userInitiated: true, ...opts });
  }, [playSongInternal]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      if (currentSong) {
        console.log('[playback] togglePlay missing audio, prepare via internal');
        playSongInternal(currentSong, currentPlaylist ?? undefined, false, { forcePlay: true });
      }
      return;
    }
    if (!audio.paused) {
      audio.pause();
      return;
    }
    const retryPlay = (tries = 5, delay = 400) => {
      if (audioRef.current !== audio) return;
      audio.play().catch((err) => {
        if (audioRef.current !== audio) return;
        if (tries > 0 && err?.name !== 'NotAllowedError') {
          window.setTimeout(() => retryPlay(tries - 1, delay + 300), delay);
        }
      });
    };
    retryPlay();
  }, []);

  const next = useCallback((e?: any) => {
    const isManualSkip = !(e?.detail?.isCrossfade);
    const isCrossfade = e?.detail?.isCrossfade === true;

    if (audioRef.current && audioRef.current.onended) {
      const originalRepeat = playerStateRef.current.repeatMode;
      if (originalRepeat === 'one' && isManualSkip) playerStateRef.current.repeatMode = 'all';
      const evt = new CustomEvent('ended', { detail: { isManualSkip, isCrossfade } });
      const onEndedFn = audioRef.current.onended;
      Promise.resolve(onEndedFn.call(audioRef.current, evt)).finally(() => {
        playerStateRef.current.repeatMode = originalRepeat;
      });
      return;
    }

    const list = currentPlaylist?.songs;
    if (!list || !currentSong) return;
    const isRadio = String(currentPlaylist?.id || '').startsWith('radio-');
    let nextSong: Song | null = null;
    let nextIdx = -1;
    const currentKey = getTrackKey(currentSong);
    
    if (shuffle && !isRadio) {
      const remaining = list.filter((s) => getTrackKey(s) !== currentKey);
      if (remaining.length > 0) nextSong = remaining[Math.floor(Math.random() * remaining.length)];
    } else {
      const isAutoEnded = e?.detail?.auto === true || e?.detail?.isManualSkip === false;
      const repeatMode = playerStateRef.current.repeatMode;
      
      let idx = list.findIndex((s) => s.id === currentSong.id);
      if (idx === -1) idx = 0;
      
      if (isAutoEnded && repeatMode === 'one') {
         nextSong = currentSong;
      } else {
         for (let i = 1; i <= list.length; i++) {
            const candidateIdx = (idx + i) % list.length;
            const candidate = list[candidateIdx];
            if (getTrackKey(candidate) !== currentKey) {
               if (isAutoEnded && repeatMode === 'off' && candidateIdx <= idx) {
                  // We wrapped around and repeat is none. Stop playback.
                  break;
               }
               nextSong = candidate;
               nextIdx = candidateIdx;
               break;
            }
         }
      }
      if (nextSong) {
         console.log(`[playback/next] currentIndex=${idx} nextIndex=${nextIdx} currentKey=${currentKey} nextKey=${getTrackKey(nextSong)}`);
      }
    }
    
    if (nextSong) {
       playSong(nextSong, currentPlaylist, isCrossfade, { forcePlay: true, fromQueueNavigation: true });
    } else {
       console.log(`[playback/ended] repeatMode=${playerStateRef.current.repeatMode} hasNext=false`);
       setIsPlaying(false);
    }
  }, [currentPlaylist, currentSong, playSong, shuffle]);

  const previous = useCallback(() => {
    const list = currentPlaylist?.songs;
    if (!list || !currentSong) return;

    if (audioRef.current && audioRef.current?.currentTime > 3) {
      if (audioRef.current) if (audioRef.current) audioRef.current.currentTime = 0;
      return;
    }

    let prevSong: Song | null = null;
    let prevIdx = -1;
    const currentKey = getTrackKey(currentSong);
    
    if (shuffle) {
      const remaining = list.filter((s) => getTrackKey(s) !== currentKey);
      if (remaining.length > 0) prevSong = remaining[Math.floor(Math.random() * remaining.length)];
    } else {
      let idx = list.findIndex((s) => s.id === currentSong.id);
      if (idx === -1) idx = 0;
      for (let i = 1; i <= list.length; i++) {
         const candidateIdx = (idx - i + list.length) % list.length;
         const candidate = list[candidateIdx];
         if (getTrackKey(candidate) !== currentKey) {
            prevSong = candidate;
            prevIdx = candidateIdx;
            break;
         }
      }
      if (prevSong) {
         console.log(`[playback/previous] currentIndex=${idx} prevIndex=${prevIdx}`);
      }
    }
    
    if (prevSong) {
       playSong(prevSong, currentPlaylist, false, { forcePlay: true, fromQueueNavigation: true });
    } else {
       if (audioRef.current) if (audioRef.current) audioRef.current.currentTime = 0;
       audioRef.current.play().catch(() => {});
    }
  }, [currentPlaylist, currentSong, playSong, shuffle]);

  const reorderQueue = useCallback((tracks: Track[]) => {
    setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
    setCurrentPlaylist((prev) => {
      const base: Playlist = prev || { id: `queue-${Date.now()}`, name: 'Cola', description: '', image_url: '', songs: [] };
      let songs = tracks.map(songFromTrack);
      console.log(`[queue/dedupe] before=${songs.length}`);
      const uniqueKeys = new Set<string>();
      songs = songs.filter(s => {
         const k = getTrackKey(s);
         if (uniqueKeys.has(k)) return false;
         uniqueKeys.add(k);
         return true;
      });
      console.log(`[queue/dedupe] after=${songs.length}`);
      return { ...base, songs };
    });
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
    setCurrentPlaylist((prev) => {
      if (!prev?.songs) return prev;
      const songs = [...prev.songs];
      songs.splice(index, 1);
      return { ...prev, songs };
    });
  }, []);

  const playNextFromQueueIndex = useCallback((fromIndex: number) => {
    setCurrentPlaylist((prev) => {
      if (!prev?.songs || !currentSong) return prev;
      const songs = [...prev.songs];
      const currentIdx = songs.findIndex((s) => s.id === currentSong.id);
      if (currentIdx === -1 || fromIndex <= currentIdx) return prev;
      const [song] = songs.splice(fromIndex, 1);
      songs.splice(currentIdx + 1, 0, song);
      return { ...prev, songs };
    });
  }, [currentSong]);

  const addToQueue = useCallback((track: Track) => {
    setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
    setCurrentPlaylist((prev) => {
      const base: Playlist = prev || { id: `queue-${Date.now()}`, name: 'Cola', description: '', image_url: '', songs: currentSong ? [currentSong] : [] };
      return { ...base, songs: [...(base.songs || []), songFromTrack(track)] };
    });
  }, [currentSong]);

  const clearQueue = useCallback(() => {
    setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
    setCurrentPlaylist((prev) => {
      const base: Playlist = prev || { id: `queue-${Date.now()}`, name: 'Cola', description: '', image_url: '', songs: [] };
      return { ...base, songs: currentSong ? [currentSong] : [] };
    });
  }, [currentSong]);

  const playTrack = useCallback((track: Track, opts?: { queue?: Track[] }) => {
    setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
    if (!track.audioUrl) {
      setPlaybackError('No hay audio disponible para reproducir esta canción.');
      return;
    }
    const song = songFromTrack(track);
    const playlist = opts?.queue ? { id: `queue-${Date.now()}`, name: 'Cola', description: '', image_url: '', songs: opts.queue.map(songFromTrack) } : undefined;
    playSong(song, playlist);
  }, [playSong]);

  const pause = useCallback(() => { if (isPlaying) togglePlay(); }, [isPlaying, togglePlay]);
  const resume = useCallback(() => { if (!isPlaying) togglePlay(); }, [isPlaying, togglePlay]);

  const reset = useCallback(() => {
    setPlaybackError(null);
      setPlaybackErrorTrackKey(null);
    emitListeningEvent(song, 'play_start');
    clearSleepTimer();
    autoplayBusyRef.current = false;
    expandingQueueRef.current = false;
    bufferDoneRef.current = false;
    playedIdsRef.current = new Set();

    if (audioRef.current) {
      audioRef.current?.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (oldAudioRef.current) {
      oldAudioRef.current.pause();
      oldAudioRef.current.src = '';
      oldAudioRef.current = null;
    }
    if (preloadedAudioRef.current) {
      preloadedAudioRef.current.pause();
      preloadedAudioRef.current.src = '';
      preloadedAudioRef.current = null;
    }

    setIsPlaying(false);
    setProgress(0);
    setCurrentSong(null);
    setCurrentPlaylist(null);
    try {
      const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) localStorage.removeItem(k);
    } catch {}
  }, [clearSleepTimer]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (currentSong) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title,
        artist: currentSong.artist || currentSong.artist_name || 'Desconocido',
        artwork: [
          { src: currentSong.imageUrl || currentSong.image_url || '/ico.png', sizes: '512x512', type: 'image/jpeg' },
        ],
      });
    }
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    navigator.mediaSession.setActionHandler('play', togglePlay);
    navigator.mediaSession.setActionHandler('pause', togglePlay);
    navigator.mediaSession.setActionHandler('previoustrack', previous);
    navigator.mediaSession.setActionHandler('nexttrack', next);
  }, [currentSong, isPlaying, next, previous, togglePlay]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    const handler = (event: any) => {
      const message = event?.detail?.message ?? event?.message;
      if (message === 'music-controls-next') next();
      else if (message === 'music-controls-previous') previous();
      else if (message === 'music-controls-pause') togglePlay();
      else if (message === 'music-controls-play') togglePlay();
      else if (message === 'music-controls-destroy') {
        audioRef.current?.pause();
        void CapacitorMusicControls.destroy().catch(() => {});
      }
    };
    document.addEventListener('controlsNotification', handler as any);
    return () => document.removeEventListener('controlsNotification', handler as any);
  }, [next, previous, togglePlay]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    if (!currentSong) {
      CapacitorMusicControls.destroy().catch(() => {});
      return;
    }
    const cover = currentSong.imageUrl || currentSong.image_url || `${location.origin}/ico.png`;
    CapacitorMusicControls.create({
      track: currentSong.title,
      artist: currentSong.artist || currentSong.artist_name || 'Desconocido',
      album: 'Vibe no Sekai',
      cover,
      hasPrev: true,
      hasNext: true,
      hasClose: true,
      isPlaying,
      dismissable: true,
    }).catch(() => {});
  }, [currentSong, isPlaying]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    try {
      CapacitorMusicControls.updateIsPlaying({ isPlaying });
    } catch {}
  }, [isPlaying]);

  
  useEffect(() => {
    let active = true;
    const rehydrate = async () => {
      const savedPlayback = localStorage.getItem(STORAGE_KEY);
      if (!savedPlayback) return;
      let parsed = null;
      try { parsed = JSON.parse(savedPlayback); } catch {}
      if (!parsed?.currentTrack) return;
      
      const ptrack = parsed.currentTrack;
      if (
         ptrack.id === 'dl-null' || 
         ptrack.audioUrl === '/api/downloads/stream/null' || 
         ptrack.youtubeId === 'null' || 
         ptrack.youtubeId === null || 
         ptrack.downloadId === null ||
         (ptrack.url && ptrack.url.includes('watch?v=null'))
      ) {
         console.log('[playback/rehydrate] clearing invalid saved track');
         if (user?.uid) localStorage.removeItem(getUserStorageKey('vns_lastPlayed', user.uid)!);
         const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
         state.currentTrack = null;
         const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) localStorage.setItem(k, JSON.stringify(state));
         return;
      }
      
      if (audioRef.current) return;
      
      console.log('[playback/rehydrate] start');
      const track = parsed.currentTrack;
      const ytId = cleanSourceValue(track.youtube_id || track.sourceId);
      const url = cleanSourceValue(track.url || track.file_url);
      
      if (ytId || url) {
        console.log(`[playback/rehydrate] has source youtubeId=${ytId || url}`);
        console.log('[playback/rehydrate] prepare start');
        try {
          const reqUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : (url || '');
          let dlRes = await apiFetch('/api/downloads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: ytId ? `https://www.youtube.com/watch?v=${ytId}` : (url || ''),
              title: track.title,
              uploader: track.artist || track.artist_name,
              mode: 'audio',
              youtube_id: ytId
            })
          });
          let dlData = await dlRes.json().catch(() => null);
          
          if (!active) return;
          if (!dlRes.ok) throw dlData;
          if (ytId && dlData?.youtubeId && dlData.youtubeId !== ytId) {
             throw { status: 400, code: 'MISSING_TRACK_SOURCE' };
          }
          
          let finalUrl = null;
          if (dlData?.status === 'ready' && dlData?.audioUrl) {
            try {
              const check = await fetch(dlData.audioUrl, { method: 'HEAD' });
              if (check.status === 404) {
                 console.log('[playback/rehydrate] old stream failed, repairing');
                 throw new Error('stream_404');
              }
              finalUrl = dlData.audioUrl;
            } catch (e: any) {
              if (e.message === 'stream_404') throw e;
              finalUrl = dlData.audioUrl;
            }
          } else if ((dlData?.status === 'preparing' || dlRes?.status === 202) && dlData?.jobId) {
            let attempts = 60;
            while (attempts > 0 && active) {
              await new Promise(r => setTimeout(r, 2000));
              if (dlData.jobId === 'audio:null' || String(dlData.jobId).includes('null')) {
                 console.log('[downloads/status] rejected invalid jobId=audio:null');
                 throw { status: 400, code: 'MISSING_TRACK_SOURCE_CLIENT' };
              }
              const statRes = await apiFetch(`/api/downloads/status/${dlData.jobId}`);
              const statData = await statRes.json().catch(() => null);
              if (statData?.status === 'ready' && statData?.audioUrl) {
                finalUrl = statData.audioUrl;
                break;
              } else if (statData?.status === 'failed') {
                throw new Error('failed');
              }
              attempts--;
            }
          }
          
          if (!active) return;
          if (finalUrl) {
            console.log('[playback/rehydrate] ready audioUrl=' + finalUrl);
            if (!audioRef.current) {
                const s = songFromTrack(track);
                s.file_url = finalUrl;
                setCurrentSong(s);
                audioRef.current = new Audio(finalUrl);
            }
          } else {
            throw new Error('timeout');
          }
        } catch (err) {
          console.log('[playback/rehydrate] missing-source repair');
          const s = songFromTrack(track);
          const repaired = await repairTrack(s);
          if (!repaired) {
             console.log('[playback/rehydrate] failed clearing lastPlayed');
             if (user?.uid) localStorage.removeItem(getUserStorageKey('vns_lastPlayed', user.uid)!);
             const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
             state.currentTrack = null;
             const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) localStorage.setItem(k, JSON.stringify(state));
             setCurrentSong(null);
             console.log('[playback/rehydrate] clearing broken lastPlayed');
             if (user?.uid) localStorage.removeItem(getUserStorageKey('vns_lastPlayed', user.uid)!);
             setPlaybackError('Busca la canción nuevamente');
          } else if (active && !audioRef.current) {
             setCurrentSong(repaired);
          }
        }
      } else {
        console.log('[playback/rehydrate] missing-source repair');
        const s = songFromTrack(track);
        const repaired = await repairTrack(s);
        if (!repaired) {
             console.log('[playback/rehydrate] failed clearing lastPlayed');
             if (user?.uid) localStorage.removeItem(getUserStorageKey('vns_lastPlayed', user.uid)!);
             const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
             state.currentTrack = null;
             const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) localStorage.setItem(k, JSON.stringify(state));
             setCurrentSong(null);
             console.log('[playback/rehydrate] clearing broken lastPlayed');
             if (user?.uid) localStorage.removeItem(getUserStorageKey('vns_lastPlayed', user.uid)!);
             setPlaybackError('Busca la canción nuevamente');
        } else if (active && !audioRef.current) {
             setCurrentSong(repaired);
        }
      }
    };
    
    const t = setTimeout(rehydrate, 1500);
    return () => { active = false; clearTimeout(t); };
  }, []);

  const value: PlaybackContextValue = useMemo(() => ({
    currentTrack,
    queue,
    isPlaying,
    volume,
    progress,
    duration,
    repeatMode,
    shuffle,
    favorites,
    playbackError,
    preparingTrackKey,
      playingTrackKey,
      playbackErrorTrackKey,
    
    playSong,
    playTrack,
    pause,
    resume,
    next,
    previous,
    seek,
    toggleFavorite,
    toggleFavoriteSong,
    addToQueue,
    removeFromQueue,
    clearQueue,
    setSleepTimer,
    setVolume,
    togglePlay,
    toggleShuffle,
    cycleRepeat,
    reorderQueue,
    playNextFromQueueIndex,
    reset,
    sleepTimerRemainingSec,
    currentSong,
    currentPlaylist,
  }), [
    currentTrack, queue, isPlaying, volume, progress, duration, repeatMode,
    shuffle, favorites, playbackError, preparingTrackKey, playingTrackKey, playbackErrorTrackKey, playSong, playTrack, pause,
    resume, next, previous, seek, toggleFavorite, toggleFavoriteSong, addToQueue,
    removeFromQueue, clearQueue, setSleepTimer, setVolume, togglePlay,
    toggleShuffle, cycleRepeat, reorderQueue, playNextFromQueueIndex, reset,
    sleepTimerRemainingSec, currentSong, currentPlaylist
  ]);

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
};
