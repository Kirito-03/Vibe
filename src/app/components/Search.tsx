import { Search as SearchIcon, Music2, Play, Pause, Loader2, Download as DownloadIcon, X, History, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Input } from './ui/input';
import { downloadToSong } from './Downloads';
import { auth, db } from '../../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, deleteDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { apiFetch, apiFetchItems, API_BASE } from '../api';
import { useAppSettings } from '../context/AppSettingsContext';
import { usePlayback } from '../context/PlaybackContext';
import { LoadErrorState } from './LoadErrorState';
import { makeSafeYoutubeWatchUrl } from '../track';
import { TrackCover } from './TrackCover';
import { TrackFeedbackMenu } from './TrackFeedbackMenu';

interface Download {
  id: number | string;
  title: string;
  artist: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  filename?: string;
  mode?: 'audio' | 'video';
  created_at?: string;
  source?: 'local' | 'youtube';
  url?: string;
  uploader?: string;
  youtube_id?: string;
}

interface SearchProps {
  onSongPlay: (song: any) => void;
  currentSong: { id: number | string } | null;
  isPlaying: boolean;
}

export function Search({ onSongPlay, currentSong, isPlaying }: SearchProps) {
  const { settings } = useAppSettings();
  const { preparingTrackKey } = usePlayback();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Download[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [lastDebug, setLastDebug] = useState<any | null>(null);

  const normalizeQuery = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

  const storeRecentLocal = (value: string) => {
    try {
      const raw = localStorage.getItem('vns_search_history');
      const arr = raw ? JSON.parse(raw) : [];
      const next = [value, ...(Array.isArray(arr) ? arr : [])].filter(Boolean);
      const uniq: string[] = [];
      for (const q of next) {
        if (!uniq.includes(q)) uniq.push(q);
      }
      localStorage.setItem('vns_search_history', JSON.stringify(uniq.slice(0, 10)));
    } catch {}
  };

  const upsertRecent = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setRecentSearches((prev) => {
      const next = [trimmed, ...prev.filter((q) => q !== trimmed)];
      return next.slice(0, 10);
    });

    const currentUser = auth.currentUser;
    if (!currentUser) {
      storeRecentLocal(trimmed);
      return;
    }

    const key = normalizeQuery(trimmed);
    if (!key) return;

    await setDoc(
      doc(db, 'users', currentUser.uid, 'searches', key),
      { query: trimmed, last_used_at: serverTimestamp() },
      { merge: true }
    );
  };

  const removeRecent = async (queryToRemove: string) => {
    setRecentSearches((prev) => prev.filter((q) => q !== queryToRemove));
    
    const currentUser = auth.currentUser;
    if (!currentUser) {
      try {
        const raw = localStorage.getItem('vns_search_history');
        if (raw) {
          const arr = JSON.parse(raw);
          const next = arr.filter((q: string) => q !== queryToRemove);
          localStorage.setItem('vns_search_history', JSON.stringify(next));
        }
      } catch {}
      return;
    }
    
    const key = normalizeQuery(queryToRemove);
    if (!key) return;
    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'searches', key));
    } catch {}
  };

  const clearRecent = async () => {
    const list = [...recentSearches];
    setRecentSearches([]);
    
    const currentUser = auth.currentUser;
    if (!currentUser) {
      localStorage.removeItem('vns_search_history');
      return;
    }
    
    for (const q of list) {
       const key = normalizeQuery(q);
       if (key) {
         deleteDoc(doc(db, 'users', currentUser.uid, 'searches', key)).catch(()=>{});
       }
    }
  };

  useEffect(() => {
    const loadLocal = () => {
      try {
        const raw = localStorage.getItem('vns_search_history');
        const arr = raw ? JSON.parse(raw) : [];
        setRecentSearches(Array.isArray(arr) ? arr.slice(0, 10) : []);
      } catch {
        setRecentSearches([]);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        loadLocal();
        return;
      }
      try {
        const snap = await getDocs(
          query(
            collection(db, 'users', user.uid, 'searches'),
            orderBy('last_used_at', 'desc'),
            limit(10)
          )
        );
        const list = snap.docs
          .map((d) => (d.data() as any)?.query)
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
        setRecentSearches(list);
      } catch {
        setRecentSearches([]);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleResultClick = async (d: Download) => {
    if (import.meta.env.DEV) console.debug('[track-click] search', d);
    const currentTyped = searchQuery.trim();
    if (currentTyped.length > 0) {
      upsertRecent(currentTyped).catch(() => {});
    }
    if (d.source === 'youtube') {try {
        const youtubeId = d.youtube_id || String(d.id);
        const safeUrl = makeSafeYoutubeWatchUrl(youtubeId);
        try {
          const cacheRes = await apiFetch(`/api/downloads/resolve?youtube_id=${encodeURIComponent(youtubeId)}&mode=audio`);
          const cacheJson = cacheRes.ok ? await cacheRes.json().catch(() => null) : null;
          if (cacheJson?.cached && cacheJson?.audioUrl) {
            const who = d.uploader && d.uploader !== 'YouTube' && d.uploader !== 'YouTube Music' ? d.uploader : 'Internet';
            const dur = d.duration_seconds ?? 0;
            onSongPlay({
              id: youtubeId,
              youtube_id: youtubeId,
              title: d.title,
              artist: who,
              artist_name: who,
              duration_seconds: dur,
              durationSecs: dur,
              duration: dur ? `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')}` : '0:00',
              imageUrl: d.thumbnail_url || '',
              image_url: d.thumbnail_url || '',
              file_url: String(cacheJson.audioUrl),
              source: 'local',
              isPlaying: true,
            });
return;
          }
        } catch {}

        const who = d.uploader && d.uploader !== 'YouTube' && d.uploader !== 'YouTube Music' ? d.uploader : 'Internet';
        const dur = d.duration_seconds ?? 0;
        const tempSong = {
          id: youtubeId,
          youtube_id: youtubeId,
          title: d.title,
          artist: who,
          artist_name: who,
          duration_seconds: dur,
          durationSecs: dur,
          duration: dur ? `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')}` : '0:00',
          imageUrl: d.thumbnail_url || '',
          image_url: d.thumbnail_url || '',
          file_url: safeUrl,
          source: 'youtube',
          isPlaying: true,
        };
        onSongPlay(tempSong);} catch (err) {
        console.error(err);}
    } else {
      onSongPlay(downloadToSong(d as any));
    }
  };

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchResults([]);
      setLastDebug(null);
      setSearchError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setSearchError(null);
    const controller = new AbortController();
    const debounce = setTimeout(async () => {
      try {
        const { res, items, debug } = await apiFetchItems<any>(
          `/api/music/search?q=${encodeURIComponent(searchQuery)}&mode=search`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
        }
        const nextItems = Array.isArray(items) ? items : [];
        if (nextItems.length === 0) {
          setSearchResults([]);
          setSearchError(null);
          setLastDebug(debug ?? null);
          if (import.meta.env.DEV && debug) console.log('[search][debug]', debug);
          return;
        }
        setSearchResults(nextItems);
        setLastDebug(debug ?? null);
        if (import.meta.env.DEV && debug) console.log('[search][debug]', debug);
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        let msg = 'Error desconocido';
        if (error instanceof Error) msg = error.message;
        else if (typeof error === 'string') msg = error;
        else {
          try {
            msg = JSON.stringify(error);
          } catch {
            msg = String(error);
          }
        }
        setSearchError(msg);
        setSearchResults([]);
        setLastDebug(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 450);

    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [searchQuery, retryTick]);

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-zinc-900/50 to-black p-4 md:p-8 hide-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      <div className="sticky top-0 z-20 bg-zinc-900/80 backdrop-blur-xl -mx-4 -mt-4 px-4 pt-4 md:-mx-8 md:-mt-8 md:px-8 md:pt-8 pb-6 border-b border-white/5">
        <div className="relative max-w-3xl mx-auto">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-zinc-400" />
          <Input
            type="search"
            placeholder="¿Qué quieres escuchar hoy?"
            className="w-full bg-white/10 border-transparent hover:bg-white/[0.15] hover:border-white/20 rounded-full pl-12 pr-6 py-4 text-lg text-white placeholder-zinc-400 focus:bg-white/20 focus:ring-4 focus:ring-violet-500/30 focus:border-violet-500/50 transition-all shadow-lg"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const currentTyped = searchQuery.trim();
                if (currentTyped.length > 0) {
                  upsertRecent(currentTyped).catch(() => {});
                }
              }
            }}
          />
        </div>
      </div>

      <div className="mt-8 max-w-[1400px] mx-auto">
        {searchQuery ? (
          <section className="mb-24">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-white tracking-tight">
                Mejores resultados
              </h3>
            </div>
            {!loading && searchError && (
              <div className="mb-6">
                <LoadErrorState
                  message={searchError.startsWith('HTTP 503') ? 'Intenta nuevamente en unos segundos' : 'Intenta nuevamente en unos segundos'}
                  onRetry={() => {
                    setSearchError(null);
                    setRetryTick((t) => t + 1);
                  }}
                />
              </div>
            )}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-10 h-10 text-violet-500 animate-spin mb-4" />
                <p className="text-zinc-400 text-lg font-medium animate-pulse">Explorando el catálogo...</p>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {searchResults.map((d) => {
                  const song = downloadToSong(d as any);
                  const isActive = currentSong?.id === song.id || (currentSong as any)?.youtube_id === d.youtube_id;
                  const songKey = String((song as any).youtube_id || song.id);
                  const isDownloading = preparingTrackKey === songKey;
                  return (
                    <div
                      key={`${d.source ?? 'local'}-${d.id}`}
                      onClick={() => handleResultClick(d)}
                      className={`group relative flex items-center gap-4 p-3 rounded-2xl cursor-pointer transition-all duration-300
                        ${isActive ? 'bg-violet-500/20 shadow-[0_8px_30px_rgba(139,92,246,0.15)] border border-violet-500/30' : 'bg-white/[0.03] hover:bg-white/[0.08] border border-transparent hover:border-white/10'}`}
                    >
                      <div className={`relative w-16 h-16 rounded-xl overflow-hidden bg-zinc-800 flex-shrink-0 shadow-lg ${isActive ? 'ring-2 ring-violet-500 ring-offset-2 ring-offset-black' : ''}`}>
                        <TrackCover
                          src={song.imageUrl || song.image_url}
                          videoId={d.youtube_id || (d.source === 'youtube' ? String(d.id) : null)}
                          title={d.title}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                        <div className={`absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center transition-all duration-300
                          ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          {isDownloading ? (
                            <Loader2 className="w-7 h-7 text-white animate-spin" />
                          ) : isActive && isPlaying ? (
                            <Pause className="w-7 h-7 text-white" fill="currentColor" />
                          ) : (
                            <Play className="w-7 h-7 text-white ml-1" fill="currentColor" />
                          )}
                        </div>
                      </div>
                      
                      <div className="flex-1 min-w-0 pr-2">
                        <p className={`text-base font-bold truncate mb-1 ${isActive ? 'text-violet-400' : 'text-white group-hover:text-violet-200 transition-colors'}`}>
                          {d.title}
                        </p>
                        <div className="flex items-center text-sm gap-2">
                          <span className="text-zinc-400 truncate max-w-[120px]">
                            {d.source === 'youtube' ? (d.uploader !== 'YouTube' && d.uploader !== 'YouTube Music' ? d.uploader : 'Internet') : (d.artist || 'Internet')}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
                          <span className="text-zinc-500 tabular-nums font-medium">
                            {d.duration_seconds
                              ? `${Math.floor(d.duration_seconds / 60)}:${(d.duration_seconds % 60).toString().padStart(2, '0')}`
                              : '--:--'
                            }
                          </span>
                        </div>
                      </div>
                      
                      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                        <TrackFeedbackMenu track={d} />
                        {d.source === 'youtube' && !isActive && !isDownloading && (
                          <div className="bg-black/60 backdrop-blur-sm rounded-full p-1.5 border border-white/10 text-violet-400">
                            <DownloadIcon className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-24 bg-white/[0.02] rounded-3xl border border-white/[0.05]">
                <Music2 className="w-16 h-16 text-zinc-600 mx-auto mb-4 opacity-50" />
                <p className="text-zinc-300 text-xl font-medium">No se encontraron resultados</p>
                <p className="text-zinc-500 mt-2 text-base">Intenta buscar con palabras clave diferentes o nombres de artistas</p>
              </div>
            )}
          </section>
        ) : (
          <div className="py-8">
            {recentSearches.length > 0 ? (
              <div className="max-w-[1400px] mx-auto">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-violet-400" />
                    <h3 className="text-xl font-bold text-white tracking-tight">Búsquedas recientes</h3>
                  </div>
                  <button
                    onClick={clearRecent}
                    className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Borrar todo
                  </button>
                </div>
                <motion.div 
                  className="flex flex-wrap gap-3"
                  initial="hidden"
                  animate="visible"
                  variants={{
                    hidden: { opacity: 0 },
                    visible: {
                      opacity: 1,
                      transition: { staggerChildren: 0.05 }
                    }
                  }}
                >
                  <AnimatePresence>
                    {recentSearches.map((q) => (
                      <motion.div
                        key={q}
                        variants={{
                          hidden: { opacity: 0, scale: 0.8 },
                          visible: { opacity: 1, scale: 1 },
                        }}
                        exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
                        className="group relative flex items-center bg-white/[0.03] border border-white/5 rounded-full hover:bg-white/[0.08] hover:border-violet-500/30 transition-colors"
                      >
                        <button
                          onClick={() => {
                            setSearchQuery(q);
                            upsertRecent(q).catch(() => {});
                          }}
                          className="px-5 py-2.5 text-sm font-medium text-zinc-300 group-hover:text-white transition-colors whitespace-nowrap"
                        >
                          {q}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecent(q);
                          }}
                          className="pr-4 pl-2 py-2.5 text-zinc-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 -ml-2"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>
            ) : (
              <div className="text-center py-32">
                <SearchIcon className="w-16 h-16 text-zinc-600 mx-auto mb-6 opacity-20" />
                <h2 className="text-white text-3xl font-bold mb-3 tracking-tight">Busca lo que quieras</h2>
                <p className="text-zinc-500 text-lg max-w-md mx-auto">Encuentra tus canciones favoritas, artistas y descubre nueva música en todo el catálogo.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
