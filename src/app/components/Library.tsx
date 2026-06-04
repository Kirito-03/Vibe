import { useState, useEffect } from 'react';
import { ListMusic, Clock, Heart, Play, Pause, Music2 } from 'lucide-react';
import { useMusic, Playlist } from '../context/MusicContext';
import { Song } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';
import { API_BASE } from '../api';
import { TrackCover } from './TrackCover';

interface LibraryProps {
  currentSong: Song | null;
  isPlaying: boolean;
  onPlaylistClick: (playlist: Playlist) => void;
  onSongPlay: (song: Song, playlist?: Playlist) => void;
  tabOverride?: Tab;
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

export function Library({ currentSong, isPlaying, onPlaylistClick, onSongPlay, tabOverride }: LibraryProps) {
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

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLikedSongs([]);
        setHistory([]);
        return;
      }

      try {
        const likesSnap = await getDocs(collection(db, 'users', user.uid, 'likes'));
        const likes = likesSnap.docs
          .map((d) => songFromDoc(d.id, d.data()))
          .filter((s): s is Song => Boolean(s));
        setLikedSongs(likes);
      } catch {
        setLikedSongs([]);
      }

      try {
        const recentsSnap = await getDocs(
          query(
            collection(db, 'users', user.uid, 'recents'),
            orderBy('played_at', 'desc'),
            limit(50)
          )
        );
        const recents = recentsSnap.docs
          .map((d) => songFromDoc(d.id, d.data()))
          .filter((s): s is Song => Boolean(s));
        setHistory(recents);
      } catch {
        setHistory([]);
      }
    });

    return () => unsubscribe();
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
    <div className="flex-1 overflow-auto bg-gradient-to-b from-zinc-900/50 to-black">
      <div className="p-4 md:p-8 pb-28 md:pb-8">
        <div className="mb-5 md:mb-7">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">Tu biblioteca</h2>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-violet-500 text-white font-semibold shadow-md shadow-violet-500/20'
                    : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="text-sm">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'playlists' && (
            <motion.div
              key="playlists"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              <section className="mb-7">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    onClick={() => setActiveTab('favoritos')}
                    className="bg-white/[0.03] border border-white/5 rounded-xl p-4 flex items-center gap-4 hover:bg-white/[0.06] transition-all text-left w-full"
                  >
                    <div className="w-14 h-14 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
                      <Heart className="w-7 h-7 text-white" fill="currentColor" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">Tus favoritos</h3>
                      <p className="text-sm text-zinc-500">{likedSongs.length} canciones</p>
                    </div>
                  </button>

                  <button
                    onClick={() => setActiveTab('recientes')}
                    className="bg-white/[0.03] border border-white/5 rounded-xl p-4 flex items-center gap-4 hover:bg-white/[0.06] transition-all text-left w-full"
                  >
                    <div className="w-14 h-14 bg-gradient-to-br from-violet-600 to-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
                      <Clock className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">Escuchado recientemente</h3>
                      <p className="text-sm text-zinc-500">{history.length} canciones</p>
                    </div>
                  </button>
                </div>
              </section>

              {playlists.length > 0 && (
                <section className="mb-24 md:mb-0">
                  <h3 className="text-xl font-bold text-white mb-4">Tus playlists</h3>
                  <div className="space-y-2">
                    {playlists.map((playlist) => (
                      <button
                        key={playlist.id}
                        onClick={() => onPlaylistClick(playlist)}
                        className="w-full flex items-center gap-4 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-all text-left"
                      >
                        <div className="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0">
                          {playlist.image_url ? (
                            <img src={playlist.image_url} alt={playlist.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20">
                              <ListMusic className="w-5 h-5 text-violet-400" />
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-white font-medium text-sm">{playlist.name}</p>
                          <p className="text-xs text-zinc-500">{playlist.songs?.length || 0} canciones</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </motion.div>
          )}

          {activeTab === 'recientes' && (
            <motion.div
              key="recientes"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="mb-24 md:mb-0"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Escuchado recientemente</h3>
                <span className="text-sm text-zinc-500">{history.length} canciones</span>
              </div>
              {history.length > 0 ? (
                <div className="space-y-1">
                  {history.map((song, i) => (
                    <SongListItem
                      key={`h-${song.id}-${i}`}
                      song={song}
                      index={i + 1}
                      isActive={currentSong?.id === song.id}
                      isPlaying={currentSong?.id === song.id && isPlaying}
                      onPlay={() => onSongPlay(song, recentsPlaylist)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 text-zinc-500">
                  <Clock className="w-10 h-10 mx-auto mb-3 text-zinc-600" />
                  <p>Aún no has escuchado ninguna canción</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'favoritos' && (
            <motion.div
              key="favoritos"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="mb-24 md:mb-0"
            >
              <div
                className="rounded-2xl p-5 mb-5 flex flex-col sm:flex-row items-center gap-4"
                style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(217,70,239,0.15))' }}
              >
                <div className="w-24 h-24 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/20 flex-shrink-0">
                  <Heart className="w-12 h-12 text-white" fill="currentColor" />
                </div>
                <div className="text-center sm:text-left">
                  <p className="text-[10px] uppercase tracking-widest text-violet-400/70 font-semibold mb-1">Colección</p>
                  <h3 className="text-2xl font-black text-white">Tus favoritos</h3>
                  <p className="text-zinc-500 text-sm mt-1">{likedSongs.length} canciones guardadas</p>
                </div>
              </div>

              {likedSongs.length > 0 ? (
                <div className="space-y-1">
                  {likedSongs.map((song, i) => (
                    <SongListItem
                      key={`f-${song.id}-${i}`}
                      song={song}
                      index={i + 1}
                      isActive={currentSong?.id === song.id}
                      isPlaying={currentSong?.id === song.id && isPlaying}
                      onPlay={() => onSongPlay(song, favoritesPlaylist)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 text-zinc-500">
                  <Heart className="w-10 h-10 mx-auto mb-3 text-zinc-600" />
                  <p>Dale ❤️ a una canción para verla aquí</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
