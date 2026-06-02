import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ListMusic, Plus, Check, Loader2, Music } from 'lucide-react';
import { collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';
import { useMusic } from '../context/MusicContext';
import { Song } from '../types';
import { TrackCover } from './TrackCover';

interface AddToPlaylistModalProps {
  song: Song | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AddToPlaylistModal({ song, isOpen, onClose }: AddToPlaylistModalProps) {
  const { playlists, createPlaylist } = useMusic();
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const userPlaylists = playlists.filter(p => p.source === 'firestore');

  useEffect(() => {
    if (!isOpen) {
      setAdded(null);
      setError(null);
      setShowCreate(false);
      setNewName('');
    }
  }, [isOpen, song?.id]);

  const handleAddToPlaylist = async (playlistId: string) => {
    if (!song || !auth.currentUser) return;
    setAdding(playlistId);
    setError(null);
    try {
      const tracksRef = collection(db, 'users', auth.currentUser.uid, 'playlists', playlistId, 'tracks');
      
      // Check for duplicates
      const existing = await getDocs(query(tracksRef, orderBy('added_at', 'desc'), limit(200)));
      const isDupe = existing.docs.some(d => {
        const data = d.data();
        return data.id === song.id || data.title?.toLowerCase() === song.title?.toLowerCase();
      });

      if (isDupe) {
        setError('Esta canción ya está en la playlist');
        setAdding(null);
        return;
      }

      await addDoc(tracksRef, {
        id: song.id,
        title: song.title,
        artist: song.artist || song.artist_name || '',
        artist_name: song.artist_name || song.artist || '',
        duration_seconds: song.duration_seconds ?? song.duration ?? 0,
        duration: song.duration ?? song.duration_seconds ?? 0,
        file_url: song.file_url,
        image_url: song.image_url || song.imageUrl || '',
        youtube_id: song.youtube_id ?? null,
        added_at: serverTimestamp(),
      });

      setAdded(playlistId);
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err) {
      console.error('Error adding to playlist:', err);
      setError('Error al agregar la canción');
    } finally {
      setAdding(null);
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newName.trim() || !song) return;
    setCreating(true);
    try {
      const newPlaylist = await createPlaylist({ name: newName.trim(), description: '' });
      if (newPlaylist?.id) {
        setShowCreate(false);
        setNewName('');
        await handleAddToPlaylist(String(newPlaylist.id));
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && song && (
        <>
          {/* Backdrop */}
          <motion.div
            key="atp-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            key="atp-modal"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 bottom-0 z-[201] md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-sm"
          >
            <div className="rounded-3xl md:rounded-2xl overflow-hidden"
              style={{ background: 'rgba(18,18,28,0.97)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(20px)' }}>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <div className="min-w-0 flex-1 mr-3">
                  <p className="text-[11px] uppercase tracking-widest text-violet-400/70 font-semibold mb-1">Agregar a playlist</p>
                  <p className="text-white font-semibold truncate text-sm">{song.title}</p>
                  <p className="text-white/40 text-xs truncate">{song.artist || song.artist_name}</p>
                </div>
                <button onClick={onClose} className="p-2 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {error && (
                <div className="mx-4 mb-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
                  {error}
                </div>
              )}

              {/* Playlist list */}
              <div className="max-h-64 overflow-y-auto px-3 pb-3 space-y-1 no-scrollbar">
                {userPlaylists.length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-3 text-center">
                    <ListMusic className="w-8 h-8 text-white/20" />
                    <p className="text-white/40 text-sm">No tienes playlists aún</p>
                  </div>
                ) : (
                  userPlaylists.map((pl) => {
                    const isAdded = added === String(pl.id);
                    const isAdding = adding === String(pl.id);
                    return (
                      <button
                        key={pl.id}
                        onClick={() => handleAddToPlaylist(String(pl.id))}
                        disabled={isAdding || isAdded}
                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors text-left group"
                      >
                        {/* Playlist cover */}
                        <div className="w-11 h-11 rounded-lg bg-zinc-800 flex-shrink-0 overflow-hidden flex items-center justify-center">
                          {pl.image_url ? (
                            <TrackCover src={pl.image_url} videoId={null} title={pl.name} className="w-full h-full object-cover" />
                          ) : (
                            <Music className="w-5 h-5 text-white/30" />
                          )}
                        </div>
                        <span className="flex-1 text-white text-sm font-medium truncate">{pl.name}</span>
                        <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                          {isAdding ? (
                            <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                          ) : isAdded ? (
                            <Check className="w-4 h-4 text-green-400" />
                          ) : (
                            <Plus className="w-4 h-4 text-white/30 group-hover:text-violet-400 transition-colors" />
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Create new playlist inline */}
              <div className="border-t border-white/5 px-3 pb-5 pt-2">
                {showCreate ? (
                  <div className="flex gap-2 mt-1">
                    <input
                      autoFocus
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleCreateAndAdd(); if (e.key === 'Escape') setShowCreate(false); }}
                      placeholder="Nombre de la playlist..."
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-violet-500/50"
                    />
                    <button
                      onClick={handleCreateAndAdd}
                      disabled={!newName.trim() || creating}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors"
                    >
                      {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Crear'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-violet-400 hover:bg-violet-500/10 transition-colors text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Nueva playlist
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
