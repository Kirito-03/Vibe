import { User } from 'firebase/auth';
import { PlaylistCard } from './PlaylistCard';
import { useMusic, Playlist } from '../context/MusicContext';
import type { Song } from '../types';
import { HomeHeader } from './Header';
import { useState, useEffect, useRef } from 'react';
import { downloadToSong } from './Downloads';
import { Music2, Play, Pause, Clock, Library, Sparkles, TrendingUp, Disc3, ChevronLeft, ChevronRight, Loader2, RotateCw } from 'lucide-react';
import { collection, getDocs, limit, orderBy, query, doc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../../firebaseConfig';
import { apiClearRecommendationCache, apiFetch, apiFetchItems, apiMarkSeenTracks, API_BASE } from '../api';
import { LoadErrorState } from './LoadErrorState';
import { makeSafeYoutubeWatchUrl } from '../track';
import { TrackCover } from './TrackCover';
import { TrackFeedbackMenu } from './TrackFeedbackMenu';
import { useHomeData } from '../context/HomeDataContext';
import { usePlayback } from '../context/PlaybackContext';

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
  const { preparingTrackKey, playSong } = usePlayback();
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
  const [activePill, setActivePill] = useState('Todo');

  const recentRef = useRef<HTMLDivElement>(null);
  const paraTiRef = useRef<HTMLDivElement>(null);
  const descubreRef = useRef<HTMLDivElement>(null);

  const scroll = (ref: React.RefObject<HTMLDivElement>, direction: 'left' | 'right') => {
    if (ref.current) {
      const { scrollLeft, clientWidth } = ref.current;
      const scrollAmount = clientWidth * 0.8;
      ref.current.scrollTo({
        left: direction === 'left' ? scrollLeft - scrollAmount : scrollLeft + scrollAmount,
        behavior: 'smooth'
      });
    }
  };

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
                  file_url: resolveMediaUrl(String(data.file_url || '')),
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
                  file_url: resolveMediaUrl(String(best.data.file_url || '')),
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
               deleteDoc(doc(db, 'users', user.uid, 'recents', String(id))).catch(() => {});
           });
        }
        
        const uniqueSongs = new Map<string, Song>();
        finalSongs.forEach(s => {
           const idStr = String(s.id);
           if (!uniqueSongs.has(idStr)) uniqueSongs.set(idStr, s);
        });
        
        const songs = Array.from(uniqueSongs.values()).filter((s) => Boolean(s.title) && Boolean(s.file_url));
        home.setRecentTracks(songs.slice(0, 12)); // Limit to 12 for UI display

        // -- Personalizar sugerencias basadas en el historial
        let seedForYou = activePill !== 'Todo' ? `${activePill} music official` : 'top hits 2026';
        let seedRecs = activePill !== 'Todo' ? `${activePill} trending` : 'tendencias musicales 2026';
        
        if (activePill === 'Todo' && songs.length > 0) {
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
  }, [user, retryTick, refreshNonce, activePill]);

  const lastPlayed = history.length > 0 ? history[0] : null;
  const shouldShowContinueListening = lastPlayed && !currentSong;

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
    } else {try {
        const youtubeId = d.youtube_id || String(d.id);
        const safeUrl = makeSafeYoutubeWatchUrl(youtubeId);
        try {
          const cacheRes = await apiFetch(`/api/downloads/resolve?youtube_id=${encodeURIComponent(youtubeId)}&mode=audio`);
          const cacheJson = cacheRes.ok ? await cacheRes.json().catch(() => null) : null;
          if (cacheJson?.cached && cacheJson?.audioUrl) {
            onSongPlay({ ...song, file_url: String(cacheJson.audioUrl) });return;
          }
        } catch {}

        const tempSong = {
          ...song,
          file_url: safeUrl,
          isPlaying: true
        };
        onSongPlay(tempSong);} catch (err) {
        console.error(err);}
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
    <div className="flex-1 overflow-auto bg-[#080010] hide-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      <div className="p-6 md:p-8 pb-28 md:pb-12 pt-14 md:pt-[72px]">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-extrabold text-white">Buenas tardes <span className="text-sm font-normal text-zinc-400 ml-2"></span></h2>
          <div className="flex gap-2 overflow-x-auto hide-scrollbar">
            {['Todo', 'Chill', 'Workout', 'Fiesta', 'Romántico', 'Focus', 'Rap', 'Pop'].map((pill) => (
              <button 
                key={pill} 
                onClick={() => setActivePill(pill)}
                className={`px-4 py-1.5 rounded-sm text-sm font-medium whitespace-nowrap transition-colors ${activePill === pill ? 'bg-white text-black' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}
              >
                {pill}
              </button>
            ))}
          </div>
        </div>

        {/* SEGUIR ESCUCHANDO */}
        {shouldShowContinueListening && lastPlayed && (
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[13px] font-bold tracking-[2px] text-zinc-300 uppercase border-l-2 border-[#a855f7] pl-3">Seguir escuchando</h3>
              <div className="flex items-center gap-2">
              </div>
            </div>
            <div 
              onClick={() => onSongPlay(lastPlayed as any)}
              className="flex items-center justify-between bg-white/5 hover:bg-white/10 transition-colors rounded-md p-3 cursor-pointer group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 flex-shrink-0 relative">
                  <img src={lastPlayed.image_url || lastPlayed.imageUrl} alt={lastPlayed.title} className="w-full h-full object-cover rounded" />
                </div>
                <div className="min-w-0">
                  <p className="text-white font-bold text-sm truncate">{lastPlayed.title}</p>
                  <p className="text-xs text-zinc-400 truncate">{lastPlayed.artist}</p>
                </div>
              </div>
              <div className="text-xs text-[#a855f7] font-medium pr-4">
                {lastPlayed.duration_seconds ? `${Math.floor(lastPlayed.duration_seconds/60)}:${String(lastPlayed.duration_seconds%60).padStart(2,'0')}` : ''}
              </div>
            </div>
          </section>
        )}

        {/* Estilo CSS inyectado para ocultar scrollbars */}
        <style>{`
          .no-scrollbar::-webkit-scrollbar {
            display: none;
          }
        `}</style>

        {/* Escuchado Recientemente */}
        {history.length > 1 && (
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[13px] font-bold tracking-[2px] text-zinc-300 uppercase border-l-2 border-[#a855f7] pl-3">Escuchado recientemente</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => scroll(recentRef, 'left')} className="p-1 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"><ChevronLeft className="w-5 h-5" /></button>
                <button onClick={() => scroll(recentRef, 'right')} className="p-1 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"><ChevronRight className="w-5 h-5" /></button>
              </div>
            </div>
            <div 
              ref={recentRef}
              className="flex gap-4 overflow-x-auto scroll-smooth no-scrollbar pb-2"
              style={{ scrollbarWidth: 'none' }}
            >
              {history.slice(1, 20).map((song) => (
                <div key={song.id} onClick={() => onSongPlay(song as any)} className="w-32 sm:w-40 md:w-44 flex-shrink-0 cursor-pointer group">
                  <div className="relative aspect-square mb-3 overflow-hidden shadow-lg">
                    <img src={song.image_url || song.imageUrl} alt={song.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                       <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center"><Play className="w-5 h-5 text-white ml-1" fill="currentColor"/></div>
                    </div>
                  </div>
                  <h4 className="text-white font-bold text-sm truncate">{song.title}</h4>
                  <p className="text-zinc-400 text-xs truncate">{song.artist}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* PARA TI */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-bold tracking-[2px] text-zinc-300 uppercase border-l-2 border-[#a855f7] pl-3">Para ti</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => scroll(paraTiRef, 'left')} className="p-1 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"><ChevronLeft className="w-5 h-5" /></button>
              <button onClick={() => scroll(paraTiRef, 'right')} className="p-1 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"><ChevronRight className="w-5 h-5" /></button>
            </div>
          </div>
          <div 
            ref={paraTiRef}
            className="flex gap-4 overflow-x-auto scroll-smooth no-scrollbar pb-2"
            style={{ scrollbarWidth: 'none' }}
          >
            {randomPicks.slice(0, 15).map((d: any) => {
              const ytId = d.youtube_id || String(d.id || '');
              const imgSrc = d.thumbnail_url || d.image_url || d.imageUrl || '';
              const artistName = d.artist && d.artist !== 'YouTube' && d.artist !== 'YouTube Music' && d.artist !== 'Internet'
                ? d.artist
                : (d.uploader && d.uploader !== 'YouTube' && d.uploader !== 'YouTube Music' ? d.uploader : null);
              const song = {
                id: ytId, title: d.title, artist: artistName || 'Internet',
                imageUrl: imgSrc, image_url: imgSrc, source: 'youtube', youtube_id: ytId
              } as Song;
              return (
                <div key={d.id || ytId} onClick={() => handleResultClick(d, song, false)} className="w-36 sm:w-44 md:w-48 flex-shrink-0 cursor-pointer group">
                  <div className="aspect-square relative overflow-hidden shadow-lg mb-3">
                    <TrackCover src={imgSrc} videoId={ytId} title={song.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center"><Play className="w-5 h-5 text-white ml-1" fill="currentColor"/></div>
                    </div>
                  </div>
                  <h4 className="text-white font-bold text-sm truncate">{song.title}</h4>
                  <p className="text-zinc-400 text-xs truncate mt-0.5">{song.artist}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* DESCUBRE NUEVA MÚSICA */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-bold tracking-[2px] text-zinc-300 uppercase border-l-2 border-[#a855f7] pl-3">Descubre nueva música</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => scroll(descubreRef, 'left')} className="p-1 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"><ChevronLeft className="w-5 h-5" /></button>
              <button onClick={() => scroll(descubreRef, 'right')} className="p-1 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"><ChevronRight className="w-5 h-5" /></button>
            </div>
          </div>
          <div 
            ref={descubreRef}
            className="flex gap-4 overflow-x-auto scroll-smooth no-scrollbar pb-2"
            style={{ scrollbarWidth: 'none' }}
          >
            {recommendations.slice(0, 15).map((d: any) => {
              const ytId = d.youtube_id || String(d.id || '');
              const imgSrc = d.thumbnail_url || d.image_url || d.imageUrl || '';
              const artistName = d.artist && d.artist !== 'YouTube' && d.artist !== 'YouTube Music' && d.artist !== 'Internet'
                ? d.artist
                : (d.uploader && d.uploader !== 'YouTube' && d.uploader !== 'YouTube Music' ? d.uploader : null);
              const song = {
                id: ytId, title: d.title, artist: artistName || 'Internet',
                imageUrl: imgSrc, image_url: imgSrc, source: 'youtube', youtube_id: ytId
              } as Song;
              return (
                <div key={d.id || ytId} onClick={() => handleResultClick(d, song, false)} className="w-36 sm:w-44 md:w-48 flex-shrink-0 cursor-pointer group">
                  <div className="relative aspect-square mb-3 overflow-hidden shadow-lg">
                    <TrackCover src={imgSrc} videoId={ytId} title={song.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center"><Play className="w-5 h-5 text-white ml-1" fill="currentColor"/></div>
                    </div>
                  </div>
                  <h4 className="text-white font-bold text-sm truncate">{song.title}</h4>
                  <p className="text-zinc-400 text-xs truncate mt-0.5">{song.artist}</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
