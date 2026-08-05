import { useState, useEffect } from 'react';
import { ListMusic, Clock, Heart, Play, Pause, Music2 } from 'lucide-react';
import { useMusic, Playlist } from '../context/MusicContext';
import { Song } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, limit, orderBy, query, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';
import { API_BASE } from '../api';
import { TrackCover } from './TrackCover';

interface LibraryProps {
  currentSong: Song | null;
  isPlaying: boolean;
  onPlaylistClick: (playlist: Playlist) => void;
  onSongPlay: (song: Song, playlist?: Playlist) => void;
  tabOverride?: Tab;
  onCreatePlaylist?: () => void;
}

type Tab = 'playlists' | 'recientes' | 'favoritos';

function SongListItem({
  song,
  index,
  isActive,
  isPlaying,
  onPlay,
}: {
  song: Song;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const dur = song.duration_seconds
    ? `${Math.floor(song.duration_seconds / 60)}:${(song.duration_seconds % 60).toString().padStart(2, '0')}`
    : song.duration ?? '--:--';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-pointer transition-all group ${
        isActive ? 'bg-violet-500/10 border border-violet-500/10' : 'hover:bg-white/[0.04]'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onPlay}
    >
      <div className="w-8 flex-shrink-0 flex items-center justify-center">
        {hovered ? (
          <button className="text-white">
            {isActive && isPlaying
              ? <Pause className="w-4 h-4" fill="currentColor" />
              : <Play  className="w-4 h-4" fill="currentColor" />
            }
          </button>
        ) : isActive ? (
          <span className="text-violet-400 text-sm">♫</span>
        ) : (
          <span className="text-zinc-500 text-sm tabular-nums">{index}</span>
        )}
      </div>
      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-800">
        <TrackCover
          src={song.image_url || song.imageUrl}
          videoId={song.youtube_id || null}
          title={song.title}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isActive ? 'text-violet-400' : 'text-white'}`}>
          {song.title}
        </p>
        <p className="text-xs text-zinc-500 truncate">{song.artist_name || song.artist || 'YouTube'}</p>
      </div>
      <span className="text-zinc-600 text-xs flex-shrink-0 tabular-nums">{dur}</span>
    </div>
  );
}

export function Library({ currentSong, isPlaying, onPlaylistClick, onSongPlay, tabOverride, onCreatePlaylist }: LibraryProps) {
  const { playlists } = useMusic();
  const [activeTab, setActiveTab] = useState<Tab>('playlists');
  const [likedSongs, setLikedSongs] = useState<Song[]>([]);
  const [history, setHistory] = useState<Song[]>([]);

  useEffect(() => {
    if (tabOverride) setActiveTab(tabOverride);
  }, [tabOverride]);

  useEffect(() => {
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

    const songFromDoc = (docId: string, data: any): Song | null => {
      const rawFileUrl = data?.file_url
        ?? (docId.startsWith('dl-') ? `/api/downloads/stream/${docId.replace('dl-', '')}` : null);
      const fileUrl = rawFileUrl ? resolveMediaUrl(String(rawFileUrl)) : null;
      if (!data?.title || !fileUrl) return null;
      return {
        id: data.song_id ?? data.id ?? docId,
        title: data.title,
        artist_name: data.artist ?? undefined,
        artist: data.artist ?? undefined,
        duration_seconds: data.duration_seconds ?? 0,
        file_url: fileUrl,
        image_url: data.image_url ?? undefined,
        imageUrl: data.image_url ?? undefined,
        youtube_id: data.youtube_id ?? undefined,
        source: data.source ?? undefined,
      };
    };

    let unsubLikes: (() => void) | undefined;
    let unsubRecents: (() => void) | undefined;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setLikedSongs([]);
        setHistory([]);
        if (unsubLikes) unsubLikes();
        if (unsubRecents) unsubRecents();
        return;
      }

      unsubLikes = onSnapshot(collection(db, 'users', user.uid, 'likes'), (likesSnap) => {
        const likes = likesSnap.docs
          .map((d) => songFromDoc(d.id, d.data()))
          .filter((s): s is Song => Boolean(s));
        setLikedSongs(likes);
      }, () => setLikedSongs([]));

      unsubRecents = onSnapshot(
        query(
          collection(db, 'users', user.uid, 'recents'),
          orderBy('played_at', 'desc'),
          limit(50)
        ),
        (recentsSnap) => {
          const recents = recentsSnap.docs
            .map((d) => songFromDoc(d.id, d.data()))
            .filter((s): s is Song => Boolean(s));
          setHistory(recents);
        },
        () => setHistory([])
      );
    });

    return () => {
      unsubscribe();
      if (unsubLikes) unsubLikes();
      if (unsubRecents) unsubRecents();
    };
  }, []);

  const tabs: { id: Tab; icon: typeof ListMusic; label: string }[] = [
    { id: 'playlists',  icon: ListMusic, label: 'Playlists'  },
    { id: 'recientes',  icon: Clock,     label: 'Recientes'  },
    { id: 'favoritos',  icon: Heart,     label: 'Favoritos'  },
  ];

  const favoritesPlaylist: Playlist = {
    id: 'favorites',
    name: 'Tus favoritos',
    description: '',
    image_url: '',
    songs: likedSongs,
  };

  const recentsPlaylist: Playlist = {
    id: 'recents',
    name: 'Escuchado recientemente',
    description: '',
    image_url: '',
    songs: history,
  };

  return (
    <div className="flex-1 overflow-auto bg-[#0a0014] text-white">
      <div className="p-6 md:p-8 pb-28 md:pb-8 pt-14 md:pt-[72px]">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold tracking-wide">Tu Biblioteca</h2>
          <button 
            onClick={onCreatePlaylist}
            className="bg-white text-black text-[11px] font-bold tracking-widest uppercase px-4 py-2 rounded-sm hover:bg-gray-200 transition-colors"
          >
            + NUEVA PLAYLIST
          </button>
        </div>

        <div className="flex gap-6 border-b border-white/10 mb-6">
          {tabs.map((tab) => {
            if (tab.id === 'recientes') return null;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'favoritos') {
                    onPlaylistClick(favoritesPlaylist);
                  } else {
                    setActiveTab(tab.id);
                  }
                }}
                className={`pb-3 text-xs font-bold tracking-widest uppercase transition-all relative ${
                  activeTab === tab.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#a855f7]" />
                )}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'playlists' && (
            <motion.div
              key="playlists"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="space-y-1">
                {/* Custom Favorites Playlist row */}
                <div
                  onClick={() => onPlaylistClick(favoritesPlaylist)}
                  className="group flex items-center justify-between p-3 rounded-md hover:bg-white/[0.04] cursor-pointer transition-colors border-b border-white/[0.02]"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-[#3b0764] rounded-md flex items-center justify-center flex-shrink-0">
                      <Heart className="w-5 h-5 text-white" fill="currentColor" />
                    </div>
                    <div>
                      <p className="text-[15px] font-bold text-white mb-0.5">Favoritos</p>
                      <p className="text-[11px] text-zinc-500">Tus canciones con ♥ - {likedSongs.length} canciones</p>
                    </div>
                  </div>
                  <button className="text-zinc-600 hover:text-white px-2">
                    <span className="tracking-widest">...</span>
                  </button>
                </div>

                {/* User Playlists */}
                {playlists.map((playlist) => (
                  <div
                    key={playlist.id}
                    onClick={() => onPlaylistClick(playlist)}
                    className="group flex items-center justify-between p-3 rounded-md hover:bg-white/[0.04] cursor-pointer transition-colors border-b border-white/[0.02]"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-[#312e81] rounded-md overflow-hidden flex items-center justify-center flex-shrink-0">
                        {playlist.image_url ? (
                          <img src={playlist.image_url} alt={playlist.name} className="w-full h-full object-cover" />
                        ) : (
                          <Music2 className="w-5 h-5 text-white" />
                        )}
                      </div>
                      <div>
                        <p className="text-[15px] font-bold text-white mb-0.5">{playlist.name}</p>
                        <p className="text-[11px] text-zinc-500">{playlist.description || 'Lista de reproducción'} - {playlist.songs?.length || 0} canciones</p>
                      </div>
                    </div>
                    <button className="text-zinc-600 hover:text-white px-2">
                      <span className="tracking-widest">...</span>
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
