import { User } from 'firebase/auth';
import { PlaylistCard } from './PlaylistCard';
import { useMusic, Playlist } from '../context/MusicContext';
import type { Song } from '../types';
import { HomeHeader } from './Header';
import { useState, useEffect, useRef } from 'react';
import { downloadToSong } from './Downloads';
import { Music2, Play, Pause, Clock, Library, Sparkles, TrendingUp, Disc3, ChevronLeft, ChevronRight, Loader2, RotateCw } from 'lucide-react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db, auth } from '../../firebaseConfig';
import { apiClearRecommendationCache, apiFetch, apiFetchItems, apiMarkSeenTracks, API_BASE } from '../api';
import { LoadErrorState } from './LoadErrorState';
import { makeSafeYoutubeWatchUrl } from '../track';
import { TrackCover } from './TrackCover';
import { TrackFeedbackMenu } from './TrackFeedbackMenu';
import { useHomeData } from '../context/HomeDataContext';

// Trigger auto-refresh for Vite HMR
interface Download {
  id: number;
  title: string;
  artist: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  filename: string;
  mode: 'audio' | 'video';
  created_at: string;
}

interface HomeProps {
  user: User | null;
  currentSong: Song | null;
  isPlaying: boolean;
  onPlaylistClick: (playlist: Playlist) => void;
  onSongPlay: (song: Song, playlist?: Playlist) => void;
  resumeCandidate?: Download | null;
  showContinueListening?: boolean;
  onDismissContinueListening?: () => void;
  onExplore?: () => void;
}

export function Home({
  user,
  currentSong,
  isPlaying,
  onPlaylistClick,
  onSongPlay,
  resumeCandidate,
  showContinueListening,
  onDismissContinueListening,
  onExplore,
}: HomeProps) {
  const { playlists } = useMusic();
  const home = useHomeData();
  const randomPicks = home.forYouItems as Download[];
  const history = home.recentTracks as Song[];
  const recommendations = home.recommendationsItems as Download[];
  const forYouError = home.forYouError;
  const recommendationsError = home.recommendationsError;
  const [retryTick, setRetryTick] = useState(0);
  const isLoadingForYou = home.isLoadingForYou;
  const isLoadingRecommendations = home.isLoadingRecommendations;
  const forYouSource = home.forYouSource;
  const discoverSource = home.recommendationsSource;
  const [refreshNonce, setRefreshNonce] = useState<number>(0);
  const lastSeenMarkRef = useRef<string>('');

  useEffect(() => {
    if (!user) {
      home.clearHomeDataCache();
      return;
    }
    home.setForYouError(null);
    home.setRecommendationsError(null);
  }, [user, retryTick, refreshNonce]);

  // Sincronizar el historial en tiempo real cuando cambia la canción
  useEffect(() => {
    if (!user) {
      return;
    }
    if (home.isFresh() && retryTick === 0 && refreshNonce === 0) {
      return;
    }

        getDocs(
      query(
        collection(db, 'users', user.uid, 'recents'),
        orderBy('played_at', 'desc'),
        limit(20)
      )
    )
      .then((snap) => {
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

        console.log(`[recents/dedupe] before=${snap.docs.length}`);
        const candidates: any[] = snap.docs.map(d => ({ docId: d.id, data: d.data() }));
        const uniqueGroups = new Map<string, any[]>();
        
        candidates.forEach(({ docId, data }) => {
           const yId = data.youtube_id || data.sourceId || null;
           const cleanTitle = (data.title || '').toLowerCase().replace(/official|audio|video|lyric|lyrics|\(.*?\)|\[.*?\]/g, '').trim();
           const cleanArtist = (data.artist || data.artist_name || '').toLowerCase().trim();
           const groupKey = yId ? `yt:${yId}` : `txt:${cleanTitle}|${cleanArtist}`;
           if (!uniqueGroups.has(groupKey)) uniqueGroups.set(groupKey, []);
           uniqueGroups.get(groupKey)!.push({ docId, data });
        });
        
        const finalSongs: Song[] = [];
        const toDelete: string[] = [];
        
        uniqueGroups.forEach((group, key) => {
           if (group.length === 1) {
               const { docId, data } = group[0];
               finalSongs.push({
                  id: data.song_id ?? data.id ?? docId,
                  title: data.title ?? '',
                  artist_name: data.artist,
                  artist: data.artist,
                  duration_seconds: data.duration_seconds ?? 0,
                  file_url: resolveMediaUrl(String(data.file_url ?? '')),
                  url: data.url,
                  image_url: data.image_url,
                  imageUrl: data.image_url,
                  youtube_id: data.youtube_id,
                  source: data.source,
               } as Song);
           } else {
               // Rank them to keep the best one
               // rules: a) youtubeId b) file_url valid c) duration d) more metadata
               group.sort((a, b) => {
                   const score = (item: any) => {
                       let s = 0;
                       if (item.data.youtube_id || item.data.sourceId) s += 100;
                       if (item.data.file_url && !String(item.data.file_url).includes('stream-direct')) s += 50;
                       if (item.data.duration_seconds) s += 20;
                       if (item.data.image_url) s += 10;
                       return s;
                   };
                   return score(b) - score(a);
               });
               
               const best = group[0];
               finalSongs.push({
                  id: best.data.song_id ?? best.data.id ?? best.docId,
                  title: best.data.title ?? '',
                  artist_name: best.data.artist,
                  artist: best.data.artist,
                  duration_seconds: best.data.duration_seconds ?? 0,
                  file_url: resolveMediaUrl(String(best.data.file_url ?? '')),
                  url: best.data.url,
                  image_url: best.data.image_url,
                  imageUrl: best.data.image_url,
                  youtube_id: best.data.youtube_id,
                  source: best.data.source,
               } as Song);
               
               // Mark others as corrupt to delete
               for (let i = 1; i < group.length; i++) {
                   console.log(`[recents/dedupe] removed corrupt duplicate title="${group[i].data.title}" docId=${group[i].docId}`);
                   toDelete.push(group[i].docId);
               }
           }
        });
        
        console.log(`[recents/dedupe] after=${finalSongs.length}`);
        
        // Background deletion of corrupt docs
        if (toDelete.length > 0) {
           toDelete.forEach(id => {
               deleteDoc(doc(db, 'users', user.uid, 'recents', id)).catch(() => {});
           });
        }
        
        const uniqueSongs = new Map<string, Song>();
        finalSongs.forEach(s => {
           if (!uniqueSongs.has(s.id)) uniqueSongs.set(s.id, s);
        });
        
        const songs = Array.from(uniqueSongs.values()).filter((s) => Boolean(s.title) && Boolean(s.file_url));
        home.setRecentTracks(songs.slice(0, 12)); // Limit to 12 for UI display

        // -- Personalizar sugerencias basadas en el historial
        let seedForYou = 'top hits 2026';
        let seedRecs = 'tendencias musicales 2026';
        
        if (songs.length > 0) {
          const artists = songs.map(s => s.artist).filter(a => a && a !== 'Internet' && a !== 'Desconocido' && a !== 'YouTube');
          const cleanTitles = songs.map(s => s.title.split('-')[0].split('(')[0].trim());
          
          if (artists.length > 0) {
            const uniqueArtists = Array.from(new Set(artists));
            seedForYou = `${uniqueArtists.slice(0, 2).join(' ')} mejores canciones official`;
            seedRecs = `canciones similares a ${uniqueArtists[0]} y ${cleanTitles[0]}`;
          } else if (cleanTitles.length > 0) {
            seedForYou = `${cleanTitles[0]} official audio`;
            seedRecs = `${cleanTitles[0]} musica parecida`;
          }
        }

        const fallbackForYouSeeds = [
          'karol g official audio',
          'anuel aa official audio',
          'bad bunny official audio',
          'anime opening song',
          'lofi beats',
          'reggaeton',
        ];

        const fallbackDiscoverSeeds = [
          'new music',
          'latin hits',
          'anime music',
          'trending music',
          'pop latino',
          'openings anime',
        ];

        const fetchItemsWithTimeout = async <T,>(path: string, timeoutMs = 15000) => {
          const controller = new AbortController();
          const t = window.setTimeout(() => controller.abort(), timeoutMs);
          try {
            const { res, items, source } = await apiFetchItems<T>(path, { signal: controller.signal });
            return { res, items, source };
          } finally {
            window.clearTimeout(t);
          }
        };

        const fetchForYou = async (seed: string) => {
          const refreshParam = refreshNonce ? `&refresh=1&r=${refreshNonce}` : '';
          const { res, items, source } = await fetchItemsWithTimeout<any>(
            `/api/music/for-you?seed=${encodeURIComponent(seed)}${refreshParam}`,
            15000
          );
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          return { items, source };
        };

        const fetchDiscover = async (seed: string) => {
          const refreshParam = refreshNonce ? `&refresh=1&r=${refreshNonce}` : '';
          const { res, items, source } = await fetchItemsWithTimeout<any>(
            `/api/music/recommendations?seed=${encodeURIComponent(seed)}${refreshParam}`,
            15000
          );
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          return { items, source };
        };

        const loadForYou = async (seed: string) => {
          home.setIsLoadingForYou(true);
          try {
            let items: any[] = [];
            let source = '';
            let lastError: any = null;

            try {
              const first = await fetchForYou(seed);
              items = first.items;
              source = first.source;
            } catch (e) {
              lastError = e;
            }

            if (items.length === 0) {
              for (const fb of fallbackForYouSeeds.slice(0, 2)) {
                try {
                  const next = await fetchForYou(fb);
                  items = next.items;
                  source = next.source;
                  if (items.length > 0) break;
                } catch (e) {
                  lastError = lastError || e;
                }
              }
            }

            if (import.meta.env.DEV)
              console.debug('[home/for-you]', { seed, source, items: items.length, error: lastError?.name || lastError?.message });

            home.setForYouItems(items.slice(0, 30));
            home.setForYouError(items.length === 0 && lastError ? 'No pudimos cargar esta sección' : null);
            home.setForYouSource(items.length === 0 ? 'empty' : source || '');
          } finally {
            home.setIsLoadingForYou(false);
            home.markLoaded();
          }
        };

        const loadDiscover = async (seed: string) => {
          home.setIsLoadingRecommendations(true);
          try {
            let items: any[] = [];
            let source = '';
            let lastError: any = null;

            try {
              const first = await fetchDiscover(seed);
              items = first.items;
              source = first.source;
            } catch (e) {
              lastError = e;
            }

            if (items.length === 0) {
              for (const fb of fallbackDiscoverSeeds.slice(0, 2)) {
                try {
                  const next = await fetchDiscover(fb);
                  items = next.items;
                  source = next.source;
                  if (items.length > 0) break;
                } catch (e) {
                  lastError = lastError || e;
                }
              }
            }

            if (import.meta.env.DEV)
              console.debug('[home/recommendations]', {
                seed,
                source,
                items: items.length,
                error: lastError?.name || lastError?.message,
              });

            home.setRecommendationsItems(items.slice(0, 30));
            home.setRecommendationsError(items.length === 0 && lastError ? 'No pudimos cargar esta sección' : null);
            home.setRecommendationsSource(items.length === 0 ? 'empty' : source || '');
          } finally {
            home.setIsLoadingRecommendations(false);
            home.markLoaded();
          }
        };

        loadForYou(seedForYou).catch((e: any) => {
          console.error(e);
          home.setForYouItems([]);
          home.setForYouError(e?.message ? String(e.message) : String(e));
          home.setIsLoadingForYou(false);
          home.setForYouSource('');
        });
          
        loadDiscover(seedRecs).catch((e: any) => {
          console.error(e);
          home.setRecommendationsItems([]);
          home.setRecommendationsError(e?.message ? String(e.message) : String(e));
          home.setIsLoadingRecommendations(false);
          home.setRecommendationsSource('');
        });
          
      })
      .catch(() => home.setRecentTracks([]));
  }, [user, retryTick, refreshNonce]);

  useEffect(() => {
    if (!user) return;
    const all = [...randomPicks, ...recommendations];
    const key = all
      .map((d: any) => String(d.youtube_id || d.id || ''))
      .filter(Boolean)
      .slice(0, 200)
      .join(',');
    if (!key) return;
    if (lastSeenMarkRef.current === key) return;
    lastSeenMarkRef.current = key;

    const payload = all.slice(0, 60).map((d: any) => ({
      youtube_id: d.youtube_id || d.id,
      title: d.title,
      artist: d.artist || d.uploader || null,
      uploader: d.uploader || d.artist || null,
      source: d.source || 'youtube',
    }));

    apiMarkSeenTracks({ items: payload, reason: 'home' }).catch(() => {});
  }, [user, randomPicks, recommendations]);

  const showEmptyState = true; 

  const [loadingMore, setLoadingMore] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  const forYouRef = useRef<HTMLDivElement | null>(null);
  const recommendationsRef = useRef<HTMLDivElement | null>(null);

  const refreshRecommendations = async () => {
    if (!user) return;
    await apiClearRecommendationCache().catch(() => {});
    setRefreshNonce(Date.now());
    setRetryTick((t) => t + 1);
  };

  const scrollCarousel = (ref: React.RefObject<HTMLDivElement | null>, direction: 'left' | 'right') => {
    if (ref.current) {
      const scrollAmount = direction === 'left' ? -600 : 600;
      ref.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleResultClick = async (d: any, song: Song, isLocal: boolean) => {
    if (import.meta.env.DEV) console.debug('[track-click] home', { d, song, isLocal });
    // Si la canción ya es la actual, simplemente la mandamos al onSongPlay para que haga toggle
    if (currentSong?.id === song.id) {
      onSongPlay(song);
      return;
    }

    if (isLocal) {
      onSongPlay(song);
    } else {
      const idStr = String(d.id);
      if (downloadingIds.has(idStr)) return;
      
      setDownloadingIds(prev => new Set(prev).add(idStr));
      try {
        const youtubeId = d.youtube_id || String(d.id);
        const safeUrl = makeSafeYoutubeWatchUrl(youtubeId);
        try {
          const cacheRes = await apiFetch(`/api/downloads/resolve?youtube_id=${encodeURIComponent(youtubeId)}&mode=audio`);
          const cacheJson = cacheRes.ok ? await cacheRes.json().catch(() => null) : null;
          if (cacheJson?.cached && cacheJson?.audioUrl) {
            onSongPlay({ ...song, file_url: String(cacheJson.audioUrl) });
            setDownloadingIds(prev => {
              const next = new Set(prev);
              next.delete(idStr);
              return next;
            });
            return;
          }
        } catch {}

        const tempSong = {
          ...song,
          file_url: safeUrl,
          isPlaying: true
        };
        onSongPlay(tempSong);
        setDownloadingIds(prev => {
          const next = new Set(prev);
          next.delete(idStr);
          return next;
        });

      } catch (err) {
        console.error(err);
        setDownloadingIds(prev => {
          const next = new Set(prev);
          next.delete(idStr);
          return next;
        });
      }
    }
  };
  const handleScroll = (e: React.UIEvent<HTMLDivElement>, type: 'foryou' | 'recommendations') => {
    const target = e.currentTarget;
    const isAtEnd = target.scrollLeft + target.clientWidth >= target.scrollWidth - 100;
    
    if (isAtEnd && !loadingMore) {
      setLoadingMore(true);
      if (type === 'foryou') {
        // Cargar más for you
        apiFetchItems<any>(`/api/music/for-you`)
          .then(({ items }) => {
            if (Array.isArray(items) && items.length > 0) {
              home.setForYouItems((prev) => {
                const newIds = new Set(prev.map((p) => p.id));
                const uniqueNew = items.filter((d: any) => !newIds.has(d.id));
                return [...prev, ...uniqueNew];
              });
            }
          })
          .catch(() => {})
          .finally(() => setTimeout(() => setLoadingMore(false), 1000));
      } else {
        // Cargar más recomendaciones
        apiFetchItems<any>(`/api/music/recommendations`)
          .then(({ items }) => {
            if (Array.isArray(items) && items.length > 0) {
              home.setRecommendationsItems((prev) => {
                const newIds = new Set(prev.map((p) => p.id));
                const uniqueNew = items.filter((d: any) => !newIds.has(d.id));
                return [...prev, ...uniqueNew];
              });
            }
          })
          .catch(() => {})
          .finally(() => setTimeout(() => setLoadingMore(false), 1000));
      }
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-zinc-900/50 to-black hide-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      <div className="p-4 md:p-8 pb-28 md:pb-8">
        <HomeHeader />

        {/* ── Última canción reproducida ── */}
        {Boolean(showContinueListening) && resumeCandidate && !isPlaying && (
          <section className="mb-8">
            {(() => {
              const lastSong = downloadToSong(resumeCandidate) as any;
              const isLastActive = currentSong?.id === lastSong.id;
              const showPause = isLastActive && isPlaying;
              return (
            <div
              onClick={() => {
                if (import.meta.env.DEV) console.debug('[track-click] resumeCandidate', lastSong);
                onSongPlay(lastSong);
                onDismissContinueListening?.();
              }}
              className="flex items-center gap-4 p-3.5 rounded-2xl bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border border-violet-500/10 cursor-pointer hover:border-violet-500/20 transition-all group"
            >
              <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 shadow-lg shadow-violet-500/10">
                <TrackCover
                  src={(resumeCandidate as any).thumbnail_url}
                  videoId={(resumeCandidate as any).youtube_id || (resumeCandidate as any).id || null}
                  title={(resumeCandidate as any).title || ''}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-widest text-violet-400/70 font-medium mb-1">Continuar escuchando</p>
                <p className="text-white font-semibold truncate">{(resumeCandidate as any).title}</p>
                <p className="text-zinc-400 text-sm truncate">{(resumeCandidate as any).artist ?? 'YouTube'}</p>
              </div>
              <div className="w-10 h-10 bg-violet-500 rounded-full flex items-center justify-center shadow-lg shadow-violet-500/30 group-hover:scale-105 transition-transform">
                {showPause
                  ? <Pause className="w-4 h-4 text-white" fill="currentColor" />
                  : <Play className="w-4 h-4 text-white ml-0.5" fill="currentColor" />
                }
              </div>
            </div>
              );
            })()}
          </section>
        )}

        {/* ── Tu música removida (ahora usamos recomendaciones personalizadas) ── */}

        {/* ── Escuchado recientemente ── */}
        {history.length > 0 && (
          <section className="mb-8 md:mb-12">
            <h3 className="text-xl md:text-2xl font-bold text-white mb-4 md:mb-6 flex items-center gap-2">
              <Clock className="w-5 h-5 text-violet-400/70" />
              Escuchado recientemente
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {history.map((song, index) => {
                const isActive = currentSong?.id === song.id;
                return (
                  <div
                    key={`h-${song.id}-${index}`}
                    onClick={() => {
                      if (import.meta.env.DEV) console.debug('[track-click] recent', song);
                      onSongPlay(song as any);
                      onDismissContinueListening?.();
                    }}
                    className={`flex items-center h-14 rounded-md overflow-hidden cursor-pointer transition-all group shadow-md
                      ${isActive ? 'bg-violet-500/20 text-violet-300' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                  >
                    <div className="relative w-14 h-14 flex-shrink-0 bg-zinc-800 shadow-lg">
                      <TrackCover
                        src={song.image_url || song.imageUrl}
                        videoId={song.youtube_id || null}
                        title={song.title}
                        className="w-full h-full object-cover"
                      />
                      <div className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity
                        ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        {isActive && isPlaying
                          ? <Pause className="w-5 h-5 text-white" fill="currentColor" />
                          : <Play className="w-5 h-5 text-white ml-0.5" fill="currentColor" />
                        }
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 px-3 py-1">
                      <p className="text-sm font-bold truncate">
                        {song.title}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Música Aleatoria de la Base de Datos ── */}
        <section className="mb-8 md:mb-12">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <h3 className="text-xl md:text-2xl font-bold text-white">
              Música para ti
              {import.meta.env.DEV && forYouSource && (
                <span className="ml-2 text-[10px] font-medium text-white/40">
                  source: {forYouSource}
                </span>
              )}
            </h3>
            <div className="hidden md:flex gap-2">
              <button
                onClick={() => refreshRecommendations()}
                className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white transition-colors"
                aria-label="Actualizar recomendaciones"
              >
                <RotateCw className="w-5 h-5" />
              </button>
              <button onClick={() => scrollCarousel(forYouRef, 'left')} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white transition-colors">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button onClick={() => scrollCarousel(forYouRef, 'right')} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white transition-colors">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {forYouError && (
            <div className="mb-5">
              <LoadErrorState
                message={forYouError.startsWith('HTTP 503') ? 'Intenta nuevamente en unos segundos' : 'Intenta nuevamente en unos segundos'}
                isLoading={isLoadingForYou}
                onRetry={() => {
                  home.setForYouError(null);
                  setRetryTick((t) => t + 1);
                }}
              />
            </div>
          )}

          {!forYouError && isLoadingForYou && randomPicks.length === 0 && (
            <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-violet-300 animate-spin" />
              Cargando...
            </div>
          )}

          {!forYouError && !isLoadingForYou && randomPicks.length === 0 && (
            <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <p className="text-sm font-semibold text-white">Aún no hay canciones para mostrar</p>
              <p className="mt-1 text-xs text-white/60">Busca o reproduce algunas canciones para personalizar esta sección.</p>
              <button
                onClick={() => onExplore?.()}
                className="mt-3 inline-flex items-center justify-center rounded-full bg-violet-500/20 px-4 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/30 transition-colors"
              >
                Explorar música
              </button>
            </div>
          )}
          
          {randomPicks.length > 0 && (
            <div 
              ref={forYouRef}
              className="flex overflow-x-auto gap-4 pb-6 pt-2 -mx-6 px-6 snap-x snap-mandatory hide-scrollbar scroll-smooth" 
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              onScroll={(e) => handleScroll(e, 'foryou')}
            >
              {randomPicks.map((d: any) => {
                const isLocal = d.source === 'local' || !d.source;
                const song = {
                  id: d.id,
                  title: d.title,
                  artist: d.artist || 'Desconocido',
                  artist_name: d.artist || 'Desconocido',
                  file_url: (isLocal && d.id)
                    ? `${API_BASE}/api/downloads/stream/${d.id}`
                    : (d.youtube_id
                        ? `https://www.youtube.com/watch?v=${d.youtube_id}`
                        : d.url || ''),
                  imageUrl: d.thumbnail_url || d.image_url || '',
                  image_url: d.thumbnail_url || d.image_url || '',
                  duration: d.duration_seconds || 0,
                  duration_seconds: d.duration_seconds || 0,
                  source: isLocal ? 'local' : 'youtube',
                  youtube_id: d.youtube_id || d.id
                } as Song;
                
                const isActive = currentSong?.id === song.id;
                const isDownloading = downloadingIds.has(String(d.id));

                return (
                  <div
                    key={`rand-${d.id}`}
                    className="min-w-[140px] max-w-[160px] md:min-w-[180px] md:max-w-[200px] flex-shrink-0 snap-start bg-white/[0.02] p-4 rounded-2xl hover:bg-white/[0.06] transition-all group cursor-pointer border border-transparent hover:border-white/10 relative"
                    onClick={() => handleResultClick(d, song, isLocal)}
                  >
                    <div className="absolute top-2 left-2 z-10">
                      <TrackFeedbackMenu
                        track={{
                          id: song.id,
                          youtube_id: song.youtube_id,
                          title: song.title,
                          artist: song.artist,
                          uploader: song.artist,
                          source: song.source,
                        }}
                        onApplied={(type) => {
                          if (type === 'not_this_track') {
                            const myId = String(d.youtube_id || d.id || '');
                            home.setForYouItems((prev) => prev.filter((x: any) => String(x.youtube_id || x.id || '') !== myId));
                          } else if (type === 'not_this_artist') {
                            const myArtist = String(song.artist || '').trim();
                            home.setForYouItems((prev) =>
                              prev.filter((x: any) => String(x.artist || x.uploader || '').trim() !== myArtist)
                            );
                          } else {
                            refreshRecommendations();
                          }
                        }}
                      />
                    </div>
                    {(!isLocal && isDownloading) && (
                      <div className="absolute top-2 right-2 z-10 bg-black/60 rounded-full p-1.5 backdrop-blur-sm shadow-md" title="Descargando...">
                        <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />
                      </div>
                    )}
                    <div className="relative aspect-square mb-4 rounded-xl overflow-hidden bg-zinc-800/50 shadow-lg">
                      <TrackCover
                        src={song.imageUrl}
                        videoId={!isLocal ? String(song.youtube_id || song.id || '') : null}
                        title={song.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      
                      <div className={`absolute bottom-3 right-3 w-12 h-12 bg-violet-500 rounded-full flex items-center justify-center shadow-xl transform transition-all duration-300 ${isActive ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0'}`}>
                        {isActive && isPlaying ? (
                          <Pause className="w-6 h-6 text-white" fill="currentColor" />
                        ) : (
                          <Play className="w-6 h-6 text-white ml-1" fill="currentColor" />
                        )}
                      </div>
                    </div>
                    <h4 className={`font-bold text-base truncate mb-1 ${isActive ? 'text-violet-400' : 'text-white'}`}>
                      {song.title}
                    </h4>
                    <p className="text-sm text-zinc-400 truncate">
                      {song.artist}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        {/* ── Descubre Nueva Música (YouTube) ── */}
        <section className="mb-8 md:mb-12">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <h3 className="text-xl md:text-2xl font-bold text-white">
              Descubre nueva música
              {import.meta.env.DEV && discoverSource && (
                <span className="ml-2 text-[10px] font-medium text-white/40">
                  source: {discoverSource}
                </span>
              )}
            </h3>
            <div className="hidden md:flex gap-2">
              <button
                onClick={() => refreshRecommendations()}
                className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white transition-colors"
                aria-label="Actualizar recomendaciones"
              >
                <RotateCw className="w-5 h-5" />
              </button>
              <button onClick={() => scrollCarousel(recommendationsRef, 'left')} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white transition-colors">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button onClick={() => scrollCarousel(recommendationsRef, 'right')} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white transition-colors">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {recommendationsError && (
            <div className="mb-5">
              <LoadErrorState
                message={recommendationsError.startsWith('HTTP 503') ? 'Intenta nuevamente en unos segundos' : 'Intenta nuevamente en unos segundos'}
                isLoading={isLoadingRecommendations}
                onRetry={() => {
                  home.setRecommendationsError(null);
                  setRetryTick((t) => t + 1);
                }}
              />
            </div>
          )}

          {!recommendationsError && isLoadingRecommendations && recommendations.length === 0 && (
            <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-violet-300 animate-spin" />
              Cargando...
            </div>
          )}

          {!recommendationsError && !isLoadingRecommendations && recommendations.length === 0 && (
            <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <p className="text-sm font-semibold text-white">Aún no hay canciones para mostrar</p>
              <p className="mt-1 text-xs text-white/60">Busca o reproduce algunas canciones para personalizar esta sección.</p>
              <button
                onClick={() => onExplore?.()}
                className="mt-3 inline-flex items-center justify-center rounded-full bg-violet-500/20 px-4 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/30 transition-colors"
              >
                Explorar música
              </button>
            </div>
          )}
          
          {recommendations.length > 0 && (
            <div 
              ref={recommendationsRef}
              className="flex overflow-x-auto gap-4 pb-6 pt-2 -mx-6 px-6 snap-x snap-mandatory hide-scrollbar scroll-smooth" 
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              onScroll={(e) => handleScroll(e, 'recommendations')}
            >
              {recommendations.slice(0, 30).map((d: any) => {
                const rawArtist = d.artist || d.uploader || '';
                let finalArtist = rawArtist === 'YouTube' ? 'Internet' : rawArtist;
                if (!finalArtist || finalArtist === 'Desconocido') finalArtist = 'Internet';
                
                const song = {
                  id: d.id,
                  title: d.title,
                  artist: finalArtist,
                  artist_name: finalArtist,
                  file_url: d.url || '',
                  imageUrl: d.thumbnail_url || d.image_url || '',
                  image_url: d.thumbnail_url || d.image_url || '',
                  duration: d.duration_seconds || 0,
                  duration_seconds: d.duration_seconds || 0,
                  source: 'youtube',
                  youtube_id: d.youtube_id || d.id
                } as Song;
                
                const isActive = currentSong?.id === song.id;
                const isDownloading = downloadingIds.has(String(d.id));

                return (
                  <div
                    key={`rec-${d.id}`}
                    className="min-w-[140px] max-w-[160px] md:min-w-[180px] md:max-w-[200px] flex-shrink-0 snap-start bg-white/[0.02] p-4 rounded-2xl hover:bg-white/[0.06] transition-all group cursor-pointer border border-transparent hover:border-white/10 relative"
                    onClick={() => handleResultClick(d, song, false)}
                  >
                    <div className="absolute top-2 left-2 z-10">
                      <TrackFeedbackMenu
                        track={{
                          id: song.id,
                          youtube_id: song.youtube_id,
                          title: song.title,
                          artist: song.artist,
                          uploader: song.artist,
                          source: song.source,
                        }}
                        onApplied={(type) => {
                          if (type === 'not_this_track') {
                            const myId = String(d.youtube_id || d.id || '');
                            home.setRecommendationsItems((prev) => prev.filter((x: any) => String(x.youtube_id || x.id || '') !== myId));
                          } else if (type === 'not_this_artist') {
                            const myArtist = String(song.artist || '').trim();
                            home.setRecommendationsItems((prev) =>
                              prev.filter((x: any) => String(x.artist || x.uploader || '').trim() !== myArtist)
                            );
                          } else {
                            refreshRecommendations();
                          }
                        }}
                      />
                    </div>
                    {isDownloading && (
                      <div className="absolute top-2 right-2 z-10 bg-black/60 rounded-full p-1.5 backdrop-blur-sm shadow-md" title="Descargando...">
                        <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />
                      </div>
                    )}
                    <div className="relative aspect-square mb-4 rounded-xl overflow-hidden bg-zinc-800/50 shadow-lg">
                      {song.imageUrl ? (
                        <img src={song.imageUrl} alt={song.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Music2 className="w-8 h-8 text-zinc-600" />
                        </div>
                      )}
                      
                      <div className={`absolute bottom-3 right-3 w-12 h-12 bg-violet-500 rounded-full flex items-center justify-center shadow-xl transform transition-all duration-300 ${isActive ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0'}`}>
                        {isActive && isPlaying ? (
                          <Pause className="w-6 h-6 text-white" fill="currentColor" />
                        ) : (
                          <Play className="w-6 h-6 text-white ml-1" fill="currentColor" />
                        )}
                      </div>
                    </div>
                    <h4 className={`font-bold text-base truncate mb-1 ${isActive ? 'text-violet-400' : 'text-white'}`}>
                      {song.title}
                    </h4>
                    <p className="text-sm text-zinc-400 truncate">
                      {song.artist}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {showEmptyState && !forYouError && !recommendationsError && playlists.length === 0 && recommendations.length === 0 && randomPicks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-500">
            <div className="w-20 h-20 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-5">
              <Music2 className="w-8 h-8 text-violet-400/50" />
            </div>
            <p className="text-lg font-medium text-zinc-400">Tu mundo musical espera</p>
            <p className="text-sm mt-1 text-zinc-600">Tu música aparecerá aquí cuando empieces a agregarla</p>
          </div>
        )}
      </div>
    </div>
  );
}
