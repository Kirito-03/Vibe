import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Shuffle, Heart, MoreHorizontal, Clock, ArrowLeft, Check, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Playlist, useMusic } from '../context/MusicContext';
import { formatTotalDuration, formatDuration } from '../utils';
import { usePlayback } from '../context/PlaybackContext';
import { trackFromSong } from '../track';
import { TrackCover } from './TrackCover';
import { TrackFeedbackMenu } from './TrackFeedbackMenu';

interface PlaylistDetailProps {
  playlist: Playlist;
  onBack: () => void;
}

export function PlaylistDetail({
  playlist: initialPlaylist,
  onBack,
}: PlaylistDetailProps) {
  const { currentSong, isPlaying, togglePlay, playSong, favorites, toggleFavoriteSong } = usePlayback();
  const [playlist, setPlaylist] = useState<Playlist>(initialPlaylist);
  const { fetchPlaylistWithSongs, deletePlaylist } = useMusic();
  
  useEffect(() => {
    const loadSongs = async () => {
      // Only fetch if the playlist doesn't already have songs
      if (!playlist.songs || playlist.songs.length === 0) {
        const fullPlaylist = await fetchPlaylistWithSongs(playlist.id);
        if (fullPlaylist) {
          setPlaylist(fullPlaylist);
        }
      }
    };
    loadSongs();
  }, [playlist.id, fetchPlaylistWithSongs]);

  const [isLiked, setIsLiked] = useState(false);
  const [hoveredSong, setHoveredSong] = useState<number | string | null>(null);
  const [isHeaderVisible, setIsHeaderVisible] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const songs = playlist.songs || [];
  const totalDuration = formatTotalDuration(songs);
  const isCurrentPlaylist = currentSong && songs.some((s) => s.id === currentSong.id);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setIsHeaderVisible(el.scrollTop > 280);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const handlePlayAll = () => {
    if (isCurrentPlaylist) {
      togglePlay();
    } else if (songs.length > 0) {
      playSong(songs[0], playlist);
    }
  };

  const handleDelete = async () => {
    try {
      await deletePlaylist(playlist.id);
      onBack(); // Return to previous screen after deletion
    } catch (err) {
      console.error("Error deleting playlist:", err);
    }
  };

  const isPlayingCurrentPlaylist = isCurrentPlaylist && isPlaying;

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto relative bg-black">
      {/* Sticky Top Header (appears on scroll) */}
      <div
        className="sticky top-0 z-20 transition-all duration-300 bg-zinc-800"
        style={{
          opacity: isHeaderVisible ? 1 : 0,
          pointerEvents: isHeaderVisible ? 'auto' : 'none',
        }}
      >
        <div className="flex items-center gap-4 px-4 md:px-6 py-4">
          <button
            onClick={onBack}
            className="text-white hover:scale-110 transition-transform"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h2 className="text-white font-bold text-lg truncate">{playlist.name}</h2>
        </div>
      </div>

      {/* Banner */}
      <div
        className="relative pt-16 md:pt-0 bg-gradient-to-b from-zinc-700 to-zinc-900"
      >
        {/* Back button (always visible, outside sticky) */}
        <button
          onClick={onBack}
          className="absolute top-4 left-4 text-white hover:scale-110 transition-transform z-10 bg-black/30 rounded-full p-1.5"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex flex-col md:flex-row items-center md:items-end gap-4 md:gap-6 px-4 md:px-8 pt-10 md:pt-16 pb-6">
          {/* Cover image */}
          <div className="w-40 h-40 md:w-52 md:h-52 flex-shrink-0 shadow-2xl rounded-md overflow-hidden bg-zinc-800">
            {playlist.image_url ? (
              <TrackCover src={playlist.image_url} videoId={null} title={playlist.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500">
                <Heart className="w-20 h-20 text-white" fill="currentColor" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="text-center md:text-left">
            <span className="text-xs font-semibold uppercase tracking-widest text-white/80">Playlist</span>
            <h1 className="text-3xl md:text-5xl font-black text-white mt-1 mb-3 leading-tight">
              {playlist.name}
            </h1>
            {playlist.description && (
              <p className="text-white/70 text-sm mb-2">{playlist.description}</p>
            )}
            <div className="flex items-center justify-center md:justify-start gap-1 text-sm text-white/80">
              <span>{songs.length} canciones</span>
              <span>•</span>
              <span>{totalDuration}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Controls bar */}
      <div className="px-4 md:px-8 py-4 flex items-center gap-4 bg-gradient-to-b from-black/30 to-transparent">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handlePlayAll}
          className="w-14 h-14 bg-violet-500 rounded-full flex items-center justify-center shadow-xl hover:bg-violet-400 transition-colors"
        >
          {isPlayingCurrentPlaylist ? (
            <Pause className="w-6 h-6 text-black" fill="currentColor" />
          ) : (
            <Play className="w-6 h-6 text-black ml-1" fill="currentColor" />
          )}
        </motion.button>

        <button className="text-zinc-400 hover:text-violet-500 transition-colors hover:scale-110">
          <Shuffle className="w-6 h-6" />
        </button>

        <button
          onClick={() => setIsLiked(!isLiked)}
          className={`transition-colors hover:scale-110 ${isLiked ? 'text-violet-500' : 'text-zinc-400 hover:text-white'}`}
        >
          <Heart className="w-6 h-6" fill={isLiked ? 'currentColor' : 'none'} />
        </button>

        <button 
          onClick={() => setShowDeleteConfirm(true)}
          className="text-zinc-400 hover:text-red-500 transition-colors hover:scale-110 ml-auto p-2"
          title="Eliminar playlist"
        >
          <Trash2 className="w-6 h-6" />
        </button>
      </div>

      {/* Song list */}
      <div className="px-4 md:px-8 pb-36 md:pb-8">
        {/* Table header */}
        <div className="grid grid-cols-[16px_1fr_auto] md:grid-cols-[16px_4fr_3fr_1fr] gap-4 px-4 py-2 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
          <span className="text-center">#</span>
          <span>Título</span>
          <span className="hidden md:block">Álbum</span>
          <div className="flex items-center justify-end">
            <Clock className="w-4 h-4" />
          </div>
        </div>

        {/* Songs */}
        {songs.map((song, index) => {
          const isThisSongPlaying = currentSong?.id === song.id;
          const isHovered = hoveredSong === song.id;
          const isSongLiked = favorites.has(trackFromSong(song).id);

          return (
            <div
              key={song.id}
              className={`grid grid-cols-[16px_1fr_auto] md:grid-cols-[16px_4fr_3fr_1fr] gap-4 px-4 py-2 rounded-md group items-center cursor-pointer transition-colors ${
                isThisSongPlaying ? 'bg-white/10' : 'hover:bg-white/5'
              }`}
              onMouseEnter={() => setHoveredSong(song.id)}
              onMouseLeave={() => setHoveredSong(null)}
              onDoubleClick={() => playSong(song, playlist)}
            >
              {/* Index / Play icon */}
              <div className="flex items-center justify-center w-4 h-4">
                {isHovered ? (
                  <button
                    onClick={() => playSong(song, playlist)}
                    className="text-white"
                  >
                    {isThisSongPlaying && isPlaying ? (
                      <Pause className="w-4 h-4" fill="currentColor" />
                    ) : (
                      <Play className="w-4 h-4" fill="currentColor" />
                    )}
                  </button>
                ) : isThisSongPlaying ? (
                  <span className="text-violet-500 text-xs">♫</span>
                ) : (
                  <span className={`text-sm ${isThisSongPlaying ? 'text-violet-500' : 'text-zinc-400'}`}>
                    {index + 1}
                  </span>
                )}
              </div>

              {/* Title + Artist + Image */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 flex-shrink-0 rounded overflow-hidden bg-zinc-800">
                  <TrackCover src={song.imageUrl} videoId={song.youtube_id || null} title={song.title} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0">
                  <div
                    className={`truncate text-sm font-medium ${
                      isThisSongPlaying ? 'text-violet-400' : 'text-white'
                    }`}
                  >
                    {song.title}
                  </div>
                  <div className="text-zinc-400 text-xs truncate">{song.artist}</div>
                </div>
              </div>

              {/* Album (desktop only) */}
              <div className="hidden md:block text-zinc-400 text-sm truncate">
                {song.album}
              </div>

              {/* Duration + Like */}
              <div className="flex items-center justify-end gap-3">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <TrackFeedbackMenu
                    track={song}
                    className="rounded-full bg-white/5 hover:bg-white/10 text-white p-1.5"
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavoriteSong(song);
                  }}
                  className={`transition-all ${
                    isSongLiked
                      ? 'text-violet-500 opacity-100'
                      : 'text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-white'
                  }`}
                >
                  {isSongLiked ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Heart className="w-4 h-4" />
                  )}
                </button>
                <span className="text-zinc-400 text-sm">{song.duration}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteConfirm(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-zinc-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl z-10"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Eliminar Playlist</h3>
                <button onClick={() => setShowDeleteConfirm(false)} className="text-zinc-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-zinc-400 mb-6">
                ¿Estás seguro de que deseas eliminar la playlist <span className="text-white font-semibold">"{playlist.name}"</span>? Esta acción no se puede deshacer.
              </p>
              <div className="flex gap-3 justify-end">
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 rounded-full text-sm font-medium text-white hover:bg-white/10 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleDelete}
                  className="px-4 py-2 rounded-full text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  Eliminar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
