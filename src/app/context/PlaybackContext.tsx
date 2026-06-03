import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { CapacitorMusicControls } from 'capacitor-music-controls-plugin';
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Playlist } from './MusicContext';
import { useAppSettings } from './AppSettingsContext';
import { apiFetch, API_BASE } from '../api';
import { downloadToSong } from '../components/Downloads';
import { trackFromSong, makeSafeYoutubeWatchUrl } from '../track';
import { isNativePlatform } from '../utils/platform';
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
  const { settings } = useAppSettings();
  const persisted = useMemo(() => safeJsonParse<PersistedPlaybackState>(localStorage.getItem(STORAGE_KEY)), []);

  const [shuffle, setShuffle] = useState<boolean>(persisted?.shuffle ?? false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(persisted?.repeatMode ?? 'off');
  const [volume, setVolumeState] = useState<number>(persisted?.volume ?? 70);
  const [currentSong, setCurrentSong] = useState<Song | null>(() => (persisted?.currentTrack ? songFromTrack(persisted.currentTrack) : null));
  const [currentPlaylist, setCurrentPlaylist] = useState<Playlist | null>(() => {
    const tracks = persisted?.queue ?? [];
    if (!tracks.length) return persisted?.currentTrack ? { id: `queue-${Date.now()}`, name: 'Cola', songs: [songFromTrack(persisted.currentTrack)] } : null;
    return { id: `queue-${Date.now()}`, name: 'Cola', songs: tracks.map(songFromTrack) };
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sleepTimerRemainingSec, setSleepTimerRemainingSec] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

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
  const playedIdsRef = useRef<Set<string>>(new Set());
  const repairAttemptsRef = useRef<Map<string, number>>(new Map());
  const lastUserInitiatedRef = useRef(false);
  const repairingRef = useRef(false);
  const expandingQueueRef = useRef(false);
  const bufferDoneRef = useRef(false);

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
      audioRef.current.currentTime = (newProgress / 100) * audioRef.current.duration;
    }
  }, []);

  const toggleShuffle = useCallback(() => setShuffle((p) => !p), []);
  const cycleRepeat = useCallback(() => setRepeatMode((p) => (p === 'off' ? 'all' : p === 'all' ? 'one' : 'off')), []);

  const persistState = useCallback((state: PersistedPlaybackState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    void handleLike(song.id);
  }, [handleLike]);

  const toggleFavorite = useCallback((track: Track) => {
    setPlaybackError(null);
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

  const playSongInternal = useCallback((song: Song, playlist?: Playlist, isCrossfade = false, opts?: { userInitiated?: boolean }) => {
    setPlaybackError(null);
    lastUserInitiatedRef.current = Boolean(opts?.userInitiated);
    if (!song?.file_url) {
      setPlaybackError('No hay audio disponible para reproducir esta canción.');
      return;
    }

    if (import.meta.env.DEV) console.debug('[playback/playSong] song', song);

    if (currentSong?.id === song.id && !isCrossfade) {
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
              setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');
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

    const songKey = String(song.youtube_id || song.id);
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

          for (const rec of strictRecs.slice(0, 15)) {
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
              apiFetch(`/api/downloads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: rec.url, title: rec.title, uploader: rec.uploader, mode: 'audio', quality: settings.audioQuality, youtube_id: rec.youtube_id || rec.id }),
              }).then((dlRes) => dlRes.json()).then((dlData) => {
                if (dlData && dlData.id) {
                  const downloadedSong = downloadToSong(dlData);
                  setCurrentPlaylist((prev) => {
                    if (!prev || prev.id !== targetPlaylistId) return prev;
                    if (prev.songs?.some((s) => s.id === downloadedSong.id || String(s.youtube_id) === String(rec.youtube_id || rec.id))) return prev;
                    return { ...prev, songs: [...(prev.songs || []), downloadedSong] };
                  });
                }
              }).catch(() => {});
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
        audioRef.current.pause();
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
      if (!ytId && (song.url || song.file_url)) {
         try {
           const urlStr = song.url || song.file_url;
           if (urlStr) {
             const u = new URL(urlStr);
             ytId = u.searchParams.get('v') || null;
           }
         } catch {}
      }

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
        url: ytUrl || song.url || null,
        youtube_id: ytId,
        youtubeId: ytId,
        sourceId: ytId ?? song.id ?? null,
        videoId: ytId,
        source: song.source ?? 'youtube',
        played_at: serverTimestamp(),
      }, { merge: true }).catch(() => {});
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
    let audio: HTMLAudioElement;
    if (preloadedAudioRef.current && preloadedAudioRef.current.src.includes(finalAudioUrl)) {
      audio = preloadedAudioRef.current;
      preloadedAudioRef.current = null;
    } else {
      audio = new Audio(finalAudioUrl);
    }
    audioRef.current = audio;

    const isMyGen = () => playGenRef.current === myGen;
    let playStarted = false;

    const onDownloadReady = (e: Event) => {
      const ev = e as CustomEvent;
      if (!isMyGen()) return;
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
      if (playStarted || !isMyGen()) return;
      if (import.meta.env.DEV) console.debug('[playback/audio.play] start');
      audio
        .play()
        .then(() => {
          if (import.meta.env.DEV) console.debug('[playback/audio.play] ok');
          if (isMyGen()) {
            playStarted = true;
            setIsPlaying(true);
          }
        })
        .catch((error) => {
          if (import.meta.env.DEV) console.debug('[playback/audio.play] error', error);
          if (isMyGen()) {
            setIsPlaying(false);
            setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');
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
      setPlaybackError('No pudimos reproducir esta canción. Intentando repararla...');

      try {
        const maxRepairAttemptsPerTrack = 1;
        const repairKey = String(song.youtube_id || song.id || '');
        const prevAttempts = repairAttemptsRef.current.get(repairKey) || 0;
        if (prevAttempts >= maxRepairAttemptsPerTrack) {
          setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');
          if (!lastUserInitiatedRef.current && settings.autoplay) next();
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
              url: song.url ?? song.file_url ?? null,
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
        setCurrentSong((prev) => {
          if (prev && prev.id === song.id) {
            return {
              ...prev,
              file_url: toStorableFileUrl(repairedAudioUrl),
              youtube_id: repairJson?.track?.youtubeId || prev.youtube_id,
            };
          }
          return prev;
        });
        setPlaybackError(null);
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
          if (nextSongToPreload?.file_url) {
            const preloader = new Audio();
            preloader.preload = 'auto';
            preloader.src = resolveMediaUrl(nextSongToPreload.file_url);
            preloadedAudioRef.current = preloader;
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
                .then((json: any) => {
                  const data: any[] = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
                  if (!Array.isArray(data) || data.length === 0) return;
                  let validRecs = data.filter((rec) => !playedIdsRef.current.has(String(rec.youtube_id || rec.id)));
                  let strictRecs = validRecs.filter((rec) => !isTooSimilar(rec.title, seedSong.title));
                  if (strictRecs.length === 0) strictRecs = validRecs;

                  for (const rec of strictRecs.slice(0, 15)) {
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
                      apiFetch(`/api/downloads`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: makeSafeYoutubeWatchUrl(rec.youtube_id || rec.id), title: rec.title, uploader: rec.uploader, mode: 'audio', quality: settings.audioQuality, youtube_id: rec.youtube_id || rec.id }),
                      }).then((res) => res.json()).then((dlData) => {
                        if (dlData && dlData.id) {
                          const downloadedSong = downloadToSong(dlData);
                          setCurrentPlaylist((prev) => {
                            if (!prev || prev.id !== targetId) return prev;
                            if (prev.songs?.some((s) => s.id === downloadedSong.id || String(s.youtube_id) === String(rec.youtube_id || rec.id))) return prev;
                            return { ...prev, songs: [...(prev.songs || []), downloadedSong] };
                          });
                        }
                      }).catch(() => {});
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
        audioRef.current.currentTime = 0;
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
                const seedQuery = artist && artist !== 'Internet' && artist !== 'Desconocido' ? `${artist} mix canciones` : `${state.currentSong.title} mix`;
                const res = await apiFetch(`/api/music/recommendations?seed=${encodeURIComponent(seedQuery)}`);
                if (res.ok) {
                  const json = await res.json().catch(() => null);
                  const data: any[] = Array.isArray(json) ? json : Array.isArray((json as any)?.items) ? (json as any).items : [];
                  const currentPlaylistIds = new Set(state.currentPlaylist?.songs?.map((s) => String(s.id)) || []);
                  const artistLower = artist.toLowerCase();
                  let newSongs = Array.isArray(data) ? data.filter((d) => !currentPlaylistIds.has(String(d.id))) : [];
                  let strictSongs = newSongs.filter((d) => !isTooSimilar(d.title, state.currentSong!.title));
                  if (strictSongs.length === 0) strictSongs = newSongs;
                  newSongs = strictSongs;

                  if (newSongs.length > 0) {
                    const filteredByArtist = newSongs.filter((d) => {
                      if (!artistLower || artistLower === 'internet' || artistLower === 'desconocido') return true;
                      const dArtist = (d.artist || d.uploader || '').toLowerCase();
                      return dArtist.includes(artistLower) || artistLower.includes(dArtist) || !dArtist.includes('podcast');
                    });
                    if (filteredByArtist.length > 0) newSongs = filteredByArtist;
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
                          const dlData = await dlRes.json();
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
      }));
    } catch {}
  }, [currentSong, isPlaying, isTooSimilar, resolveMediaUrl, settings.audioQuality, settings.autoplay, toStorableFileUrl, volume]);

  const playSong = useCallback((song: Song, playlist?: Playlist, isCrossfade = false) => {
    playSongInternal(song, playlist, isCrossfade, { userInitiated: true });
  }, [playSongInternal]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
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
    let nextSong: Song;
    if (shuffle && !isRadio) {
      const remaining = list.filter((s) => s.id !== currentSong.id);
      nextSong = remaining.length > 0 ? remaining[Math.floor(Math.random() * remaining.length)] : currentSong;
    } else {
      const idx = list.findIndex((s) => s.id === currentSong.id);
      nextSong = list[(idx + 1) % list.length];
    }
    playSong(nextSong, currentPlaylist);
  }, [currentPlaylist, currentSong, playSong, shuffle]);

  const previous = useCallback(() => {
    const list = currentPlaylist?.songs;
    if (!list || !currentSong) return;

    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }

    let prevSong: Song;
    if (shuffle) {
      const remaining = list.filter((s) => s.id !== currentSong.id);
      prevSong = remaining.length > 0 ? remaining[Math.floor(Math.random() * remaining.length)] : currentSong;
    } else {
      const idx = list.findIndex((s) => s.id === currentSong.id);
      const prevIdx = (idx - 1 + list.length) % list.length;
      prevSong = list[prevIdx];
    }
    playSong(prevSong, currentPlaylist);
  }, [currentPlaylist, currentSong, playSong, shuffle]);

  const reorderQueue = useCallback((tracks: Track[]) => {
    setPlaybackError(null);
    setCurrentPlaylist((prev) => {
      const base: Playlist = prev || { id: `queue-${Date.now()}`, name: 'Cola', songs: [] };
      const songs = tracks.map(songFromTrack);
      return { ...base, songs };
    });
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setPlaybackError(null);
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
    setCurrentPlaylist((prev) => {
      const base: Playlist = prev || { id: `queue-${Date.now()}`, name: 'Cola', songs: currentSong ? [currentSong] : [] };
      return { ...base, songs: [...(base.songs || []), songFromTrack(track)] };
    });
  }, [currentSong]);

  const clearQueue = useCallback(() => {
    setPlaybackError(null);
    setCurrentPlaylist((prev) => {
      const base: Playlist = prev || { id: `queue-${Date.now()}`, name: 'Cola', songs: [] };
      return { ...base, songs: currentSong ? [currentSong] : [] };
    });
  }, [currentSong]);

  const playTrack = useCallback((track: Track, opts?: { queue?: Track[] }) => {
    setPlaybackError(null);
    if (!track.audioUrl) {
      setPlaybackError('No hay audio disponible para reproducir esta canción.');
      return;
    }
    const song = songFromTrack(track);
    const playlist = opts?.queue ? { id: `queue-${Date.now()}`, name: 'Cola', songs: opts.queue.map(songFromTrack) } : undefined;
    playSong(song, playlist);
  }, [playSong]);

  const pause = useCallback(() => { if (isPlaying) togglePlay(); }, [isPlaying, togglePlay]);
  const resume = useCallback(() => { if (!isPlaying) togglePlay(); }, [isPlaying, togglePlay]);

  const reset = useCallback(() => {
    setPlaybackError(null);
    clearSleepTimer();
    autoplayBusyRef.current = false;
    expandingQueueRef.current = false;
    bufferDoneRef.current = false;
    playedIdsRef.current = new Set();

    if (audioRef.current) {
      audioRef.current.pause();
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
      localStorage.removeItem(STORAGE_KEY);
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

  const value: PlaybackContextValue = {
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
  };

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
};
