import React, { createContext, useState, useEffect, ReactNode, useContext } from 'react';
import { Song } from '../types';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';
import { apiFetch } from '../api';

// Define la forma de los datos de una playlist que viene de la API
export interface Playlist {
  id: number | string;
  name: string;
  description: string;
  image_url: string;
  songs?: Song[]; 
  source?: 'backend' | 'firestore';
}

export type { Song };

interface MusicContextType {
  playlists: Playlist[];
  currentSong: Song | null;
  isPlaying: boolean;
  playSong: (song: Song) => void;
  togglePlayPause: () => void;
  fetchPlaylistWithSongs: (id: number | string) => Promise<Playlist | undefined>;
  createPlaylist: (data: { name: string; description: string; image_url?: string }) => Promise<Playlist | undefined>;
  deletePlaylist: (id: number | string) => Promise<boolean>;
}

export const MusicContext = createContext<MusicContextType | undefined>(undefined);

export const useMusic = () => {
  const context = useContext(MusicContext);
  if (!context) {
    throw new Error('useMusic must be used within a MusicProvider');
  }
  return context;
};

interface MusicProviderProps {
  children: ReactNode;
}

export const MusicProvider: React.FC<MusicProviderProps> = ({ children }) => {
  const [backendPlaylists, setBackendPlaylists] = useState<Playlist[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const playlists = [...userPlaylists, ...backendPlaylists];

  useEffect(() => {
    const fetchPlaylists = async () => {
      try {
        const response = await apiFetch(`/api/music/playlists`);
        if (!response.ok) {
          throw new Error('Failed to fetch playlists');
        }
        const data: Playlist[] = await response.json();
        setBackendPlaylists(data.map((p) => ({ ...p, source: 'backend' })));
      } catch (error) {
        console.error("Error fetching playlists:", error);
      }
    };

    fetchPlaylists();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserPlaylists([]);
        return;
      }

      try {
        const snap = await getDocs(
          query(
            collection(db, 'users', user.uid, 'playlists'),
            orderBy('created_at', 'desc'),
            limit(50)
          )
        );
        const list = snap.docs.map((d) => {
          const data: any = d.data();
          return {
            id: d.id,
            name: data.name ?? '',
            description: data.description ?? '',
            image_url: data.image_url ?? '',
            songs: Array.isArray(data.songs) ? data.songs : undefined,
            source: 'firestore',
          } as Playlist;
        }).filter((p) => Boolean(p.name));
        setUserPlaylists(list);
      } catch {
        setUserPlaylists([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchPlaylistWithSongs = async (id: number | string): Promise<Playlist | undefined> => {
    try {
      if (typeof id === 'number') {
        const response = await apiFetch(`/api/music/playlists/${id}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch playlist ${id}`);
        }
        const playlistData: Playlist = await response.json();

        setBackendPlaylists((prevPlaylists) =>
          prevPlaylists.map((p) => (p.id === id ? { ...playlistData, source: 'backend' } : p))
        );

        return { ...playlistData, source: 'backend' };
      }

      const currentUser = auth.currentUser;
      if (!currentUser) return undefined;

      const playlistRef = doc(db, 'users', currentUser.uid, 'playlists', id);
      const playlistSnap = await getDoc(playlistRef);
      if (!playlistSnap.exists()) return undefined;
      const pData: any = playlistSnap.data();

      const tracksSnap = await getDocs(
        query(
          collection(db, 'users', currentUser.uid, 'playlists', id, 'tracks'),
          orderBy('added_at', 'asc'),
          limit(500)
        )
      );

      const songs = tracksSnap.docs.map((d) => {
        const s: any = d.data();
        return {
          id: s.id,
          title: s.title,
          artist_name: s.artist_name,
          artist: s.artist,
          album: s.album,
          duration_seconds: s.duration_seconds ?? 0,
          durationSecs: s.duration_seconds ?? 0,
          duration: s.duration ?? undefined,
          file_url: s.file_url,
          image_url: s.image_url ?? undefined,
          imageUrl: s.image_url ?? undefined,
        } as Song;
      }).filter((s) => Boolean(s.title) && Boolean(s.file_url));

      const playlistData: Playlist = {
        id,
        name: pData.name ?? '',
        description: pData.description ?? '',
        image_url: pData.image_url ?? '',
        songs,
        source: 'firestore',
      };

      setUserPlaylists((prev) => prev.map((p) => (p.id === id ? playlistData : p)));
      return playlistData;
    } catch (error) {
      console.error(`Error fetching playlist ${id}:`, error);
      return undefined;
    }
  };

  const createPlaylist = async (data: { name: string; description: string; image_url?: string }): Promise<Playlist | undefined> => {
    const currentUser = auth.currentUser;
    if (!currentUser) return undefined;

    const name = data.name.trim();
    if (!name) return undefined;

    const description = data.description.trim();
    const image_url = data.image_url ?? '';

    try {
      const ref = await addDoc(collection(db, 'users', currentUser.uid, 'playlists'), {
        name,
        description,
        image_url,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      const playlist: Playlist = { id: ref.id, name, description, image_url, songs: [], source: 'firestore' };
      setUserPlaylists((prev) => [playlist, ...prev]);
      return playlist;
    } catch {
      return undefined;
    }
  };

  const deletePlaylist = async (id: number | string): Promise<boolean> => {
    const currentUser = auth.currentUser;
    if (!currentUser) return false;

    // Only allow deleting user's own playlists
    if (typeof id === 'number' || (typeof id === 'string' && id.startsWith('backend'))) {
      console.warn("Cannot delete backend playlists");
      return false;
    }

    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'playlists', id as string));
      setUserPlaylists((prev) => prev.filter(p => p.id !== id));
      return true;
    } catch (err) {
      console.error("Error deleting playlist:", err);
      return false;
    }
  };

  const playSong = (song: Song) => {
    setCurrentSong(song);
    setIsPlaying(true);
  };

  const togglePlayPause = () => {
    if (currentSong) {
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <MusicContext.Provider value={{ playlists, currentSong, isPlaying, playSong, togglePlayPause, fetchPlaylistWithSongs, createPlaylist, deletePlaylist }}>
      {children}
    </MusicContext.Provider>
  );
};
