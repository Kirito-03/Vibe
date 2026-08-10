import { Search as SearchIcon, Music2, Play, Pause, Loader2, Download as DownloadIcon, X, History, Trash2 } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
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
import { SearchAutocomplete, addRecentSearchToLocalStorage } from './SearchAutocomplete';

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
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
}

export function Search({ onSongPlay, currentSong, isPlaying, searchQuery: propSearchQuery, onSearchQueryChange }: SearchProps) {
  const { settings } = useAppSettings();
  const { preparingTrackKey } = usePlayback();
  
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const searchQuery = propSearchQuery !== undefined ? propSearchQuery : localSearchQuery;
  const setSearchQuery = onSearchQueryChange || setLocalSearchQuery;
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const handleSearchSubmit = (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    if (customQuery) setSearchQuery(customQuery);
    setIsFocused(false);
    inputRef.current?.blur();
    
    const currentTyped = (customQuery ?? searchQuery).trim();
    if (currentTyped.length > 0) {
      addRecentSearchToLocalStorage({ id: Date.now().toString(), type: 'text', query: currentTyped });
      upsertRecent(currentTyped).catch(() => {});
    }
  };

  const handlePlayTrack = async (trackName: string) => {
    setSearchQuery(trackName);
    setIsFocused(false);
    inputRef.current?.blur();
    try {
      const { res, items } = await apiFetchItems<any>(`/api/music/search?q=${encodeURIComponent(trackName)}&mode=search`);
      if (res.ok && items && items.length > 0) {
        handleResultClick(items[0]);
        upsertRecent(trackName).catch(() => {});
      } else {
        // Fallback
        handleSearchSubmit(undefined, trackName);
      }
    } catch (e) {
      handleSearchSubmit(undefined, trackName);
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
    <div className="flex-1 overflow-auto bg-[#080010] p-4 md:p-8 pt-14 md:pt-[72px] hide-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      <div className="sticky top-0 z-20 bg-[#080010]/90 backdrop-blur-xl -mx-4 -mt-4 px-4 pt-4 md:-mx-8 md:-mt-8 md:px-8 md:pt-2 pb-3 border-b border-white/5">
        <div className="relative max-w-[450px]">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#a855f7]" />
          <Input
            ref={inputRef}
            type="search"
            placeholder="Busca canciones, artistas, álbumes..."
            className="w-full bg-[#1c0226] border-0 border-b-2 border-b-[#a855f7] rounded-none pl-12 pr-10 py-4 text-[15px] text-white placeholder-zinc-500 focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-b-[#a855f7] transition-all"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearchSubmit(e);
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-8 w-full">
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
                <p className="text-zinc-500 text-lg font-medium animate-pulse">Explorando el catálogo...</p>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
                {searchResults.map((d) => {
                  const song = downloadToSong(d as any);
                  const isActive = currentSong?.id === song.id || (currentSong as any)?.youtube_id === d.youtube_id;
                  const songKey = String((song as any).youtube_id || song.id);
                  const isDownloading = preparingTrackKey === songKey;
                  return (
                    <div
                      key={`${d.source ?? 'local'}-${d.id}`}
                      onClick={() => handleResultClick(d)}
                      className="cursor-pointer group flex flex-col"
                    >
                      <div className={`relative aspect-square mb-3 overflow-hidden shadow-lg ${isActive ? 'ring-2 ring-violet-500 ring-offset-2 ring-offset-black rounded-none' : ''}`}>
                        <TrackCover
                          src={song.imageUrl || song.image_url}
                          videoId={d.youtube_id || (d.source === 'youtube' ? String(d.id) : null)}
                          title={d.title}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                        <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-300
                          ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          {isDownloading ? (
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                          ) : isActive && isPlaying ? (
                            <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center"><Pause className="w-5 h-5 text-white" fill="currentColor" /></div>
                          ) : (
                            <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center"><Play className="w-5 h-5 text-white ml-1" fill="currentColor" /></div>
                          )}
                        </div>
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <TrackFeedbackMenu track={d} />
                        </div>
                        {d.source === 'youtube' && !isActive && !isDownloading && (
                          <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="bg-black/60 backdrop-blur-sm rounded-full p-1.5 border border-white/10 text-violet-400">
                              <DownloadIcon className="w-4 h-4" />
                            </div>
                          </div>
                        )}
                      </div>
                      <h4 className={`font-bold text-sm truncate ${isActive ? 'text-violet-400' : 'text-white group-hover:text-violet-200 transition-colors'}`}>
                        {d.title}
                      </h4>
                      <p className="text-zinc-400 text-xs truncate mt-1">
                        {d.source === 'youtube' ? (d.uploader !== 'YouTube' && d.uploader !== 'YouTube Music' ? d.uploader : 'Internet') : (d.artist || 'Internet')}
                      </p>
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
          <div className="py-2">
            <div className="w-full">
              {/* Explorar Géneros */}
              <div className="mb-10">
                <div className="flex items-center justify-between mb-6 border-l-2 border-white pl-3">
                  <h3 className="text-[13px] font-bold tracking-[2px] text-white uppercase">Explorar Géneros</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {[
                    { name: 'Reggaeton', color: 'from-[#831843]/80 to-[#4c1d95]/80', img: '/genres/reggaeton.jpg?v=2' },
                    { name: 'Pop', color: 'from-[#9d174d]/80 to-[#5b21b6]/80', img: '/genres/pop.jpg?v=2' },
                    { name: 'Trap', color: 'from-[#312e81]/80 to-[#4c1d95]/80', img: '/genres/trap.jpg?v=2' },
                    { name: 'Electrónica', color: 'from-[#4c1d95]/80 to-[#1e3a8a]/80', img: '/genres/electronica.jpg?v=2' },
                    { name: 'Latin', color: 'from-[#be123c]/80 to-[#831843]/80', img: '/genres/latin.jpg?v=2' },
                    { name: 'Flamenco', color: 'from-[#701a75]/80 to-[#4a044e]/80', img: '/genres/flamenco.jpg?v=2' },
                    { name: 'R&B', color: 'from-[#86198f]/80 to-[#4c1d95]/80', img: '/genres/rb.jpg?v=2' },
                    { name: 'Hip Hop', color: 'from-[#1e3a8a]/80 to-[#312e81]/80', img: '/genres/hiphop.jpg?v=2' },
                    { name: 'Rock', color: 'from-[#581c87]/80 to-[#3b0764]/80', img: '/genres/rock.jpg?v=2' },
                    { name: 'Indie', color: 'from-[#d946ef]/60 to-[#c084fc]/60', img: '/genres/indie.jpg?v=2' },
                    { name: 'Jazz', color: 'from-[#3b0764]/80 to-[#172554]/80', img: '/genres/jazz.jpg?v=2' },
                    { name: 'Podcast', color: 'from-[#86198f]/80 to-[#701a75]/80', img: '/genres/podcast.jpg?v=2' }
                  ].map((genre) => (
                      <button
                        key={genre.name}
                        onClick={() => {
                          setSearchQuery(genre.name + ' cancion');
                          upsertRecent(genre.name).catch(() => {});
                        }}
                        className={`relative h-28 rounded-none overflow-hidden group bg-gradient-to-br ${genre.color}`}
                      >
                        <img 
                          src={genre.img} 
                          alt={genre.name} 
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:scale-110 transition-transform duration-500" 
                        />
                        <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
                        <span className="absolute bottom-3 left-4 text-sm font-bold text-white shadow-sm z-10">{genre.name}</span>
                      </button>
                    ))}
                </div>
              </div>

              {/* Búsquedas recientes */}
              {recentSearches.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-6 border-l-2 border-white pl-3">
                    <h3 className="text-[13px] font-bold tracking-[2px] text-white uppercase">Búsquedas Recientes</h3>
                  </div>
                  <motion.div 
                    className="flex flex-wrap gap-2"
                    initial="hidden"
                    animate="visible"
                    variants={{
                      hidden: { opacity: 0 },
                      visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
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
                          className="group relative flex items-center bg-[#1c0226] rounded-none hover:bg-[#2a0638] transition-colors shadow-sm"
                        >
                          <button
                            onClick={() => {
                              setSearchQuery(q);
                              upsertRecent(q).catch(() => {});
                            }}
                            className="px-4 py-2 text-[13px] font-bold text-white transition-colors whitespace-nowrap"
                          >
                            {q}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRecent(q);
                            }}
                            className="pr-2 py-2 text-zinc-500 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </motion.div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
