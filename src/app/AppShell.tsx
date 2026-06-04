import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { useColor } from 'color-thief-react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Home } from './components/Home';
import { Search } from './components/Search';
import { Library } from './components/Library';
import { Profile } from './components/Profile';
import { Player } from './components/Player';
import { CreatePlaylist } from './components/CreatePlaylist';
import { PlaylistDetail } from './components/PlaylistDetail';
import { NowPlaying } from './components/NowPlaying';
import { AddToPlaylistModal } from './components/AddToPlaylistModal';
import { Playlist } from './context/MusicContext';
import { usePlayback } from './context/PlaybackContext';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { getUserStorageKey } from './utils';

type ViewType = 'home' | 'search' | 'library' | 'profile' | 'playlist';
type LibraryTab = 'playlists' | 'recientes' | 'favoritos';

type AppShellProps = {
  user: User | null;
  onLogout: () => void;
  onProfileUpdate: (updatedUser: User) => void;
};

export const AppShell = ({ user, onLogout, onProfileUpdate }: AppShellProps) => {
  const {
    currentSong,
    isPlaying,
    playSong,
    reset,
  } = usePlayback();

  useDocumentTitle(currentSong, isPlaying);

  const [resumeCandidate, setResumeCandidate] = useState<any | null>(null);
  const [showContinueListening, setShowContinueListening] = useState(false);

  useEffect(() => {
    if (!user?.uid) {
      setResumeCandidate(null);
      setShowContinueListening(false);
      return;
    }
    const lpKey = getUserStorageKey('vns_lastPlayed', user.uid);
    if (!lpKey) return;
    const saved = localStorage.getItem(lpKey);
    if (!saved) {
      setResumeCandidate(null);
      setShowContinueListening(false);
      return;
    }
    try {
      setResumeCandidate(JSON.parse(saved));
      setShowContinueListening(true);
    } catch {
      setResumeCandidate(null);
      setShowContinueListening(false);
    }
  }, [user?.uid]);

  const dismissContinueListening = useCallback(() => {
    setShowContinueListening(false);
    setResumeCandidate(null);
  }, []);

  const onSongPlay = useCallback((song: any, playlist?: Playlist, isCrossfade?: boolean) => {
    dismissContinueListening();
    playSong(song, playlist, Boolean(isCrossfade));
  }, [dismissContinueListening, playSong]);

  useEffect(() => {
    if (showContinueListening && isPlaying) {
      dismissContinueListening();
    }
  }, [dismissContinueListening, isPlaying, showContinueListening]);

  const { data: dominantColor } = useColor(currentSong?.imageUrl ?? currentSong?.image_url ?? '/ico.png', 'hex', {
    crossOrigin: 'anonymous',
    quality: 10,
  });

  const dynamicColor = dominantColor || '#A855F7';
  useEffect(() => {
    document.documentElement.style.setProperty('--dynamic-bg', dynamicColor);
  }, [dynamicColor]);

  const [currentView, setCurrentView] = useState<ViewType>(() => {
    const saved = localStorage.getItem('vns_currentView');
    return (saved as ViewType) || 'home';
  });
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('playlists');
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [isNowPlayingTransitioning, setIsNowPlayingTransitioning] = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);

  const [viewHistory, setViewHistory] = useState<ViewType[]>(['home']);
  const [historyIndex, setHistoryIndex] = useState(0);

  useEffect(() => {
    localStorage.setItem('vns_currentView', currentView);
  }, [currentView]);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const handlePlaylistClick = (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    setCurrentView('playlist');
  };

  const handleNavigate = (view: ViewType) => {
    setCurrentView(view);
    if (view !== 'playlist') setSelectedPlaylist(null);
    if (view === 'library') setLibraryTab('playlists');
    setViewHistory((prev) => {
      const newHist = prev.slice(0, historyIndex + 1);
      newHist.push(view);
      return newHist;
    });
    setHistoryIndex((prev) => prev + 1);
  };

  const handleOpenFavorites = () => {
    setCurrentView('library');
    setSelectedPlaylist(null);
    setLibraryTab('favoritos');
    setViewHistory((prev) => {
      const newHist = prev.slice(0, historyIndex + 1);
      newHist.push('library');
      return newHist;
    });
    setHistoryIndex((prev) => prev + 1);
  };

  const handleGoBack = () => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      setCurrentView(viewHistory[newIdx]);
    }
  };

  const handleGoForward = () => {
    if (historyIndex < viewHistory.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      setCurrentView(viewHistory[newIdx]);
    }
  };

  const handleLogout = () => {
    reset();
    onLogout();
    setCurrentView('home');
    setSelectedPlaylist(null);
    setIsNowPlayingOpen(false);
    setShowAddToPlaylist(false);
  };

  const renderContent = () => {
    switch (currentView) {
      case 'search':
        return (
          <Search
            currentSong={currentSong}
            isPlaying={isPlaying}
            onSongPlay={(song) => onSongPlay(song)}
          />
        );
      case 'library':
        return (
          <Library
            currentSong={currentSong}
            isPlaying={isPlaying}
            onPlaylistClick={handlePlaylistClick}
            onSongPlay={(song, playlist) => onSongPlay(song, playlist)}
            tabOverride={libraryTab}
          />
        );
      case 'profile':
        return <Profile user={user} onLogout={handleLogout} onProfileUpdate={onProfileUpdate} />;
      case 'playlist':
        return selectedPlaylist ? (
          <PlaylistDetail
            playlist={selectedPlaylist}
            onBack={handleGoBack}
          />
        ) : null;
      default:
        return (
          <Home
            user={user}
            currentSong={currentSong}
            isPlaying={isPlaying}
            onPlaylistClick={handlePlaylistClick}
            onSongPlay={(song, playlist) => onSongPlay(song, playlist)}
            resumeCandidate={resumeCandidate}
            showContinueListening={showContinueListening}
            onDismissContinueListening={dismissContinueListening}
            onExplore={() => handleNavigate('search')}
          />
        );
    }
  };

  return (
    <div className="h-screen flex flex-col bg-black text-white overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          user={user}
          currentView={currentView}
          onNavigate={handleNavigate}
          onCreatePlaylist={() => setShowCreatePlaylist(true)}
          onPlaylistClick={handlePlaylistClick}
          onOpenFavorites={handleOpenFavorites}
        />
        <main className="flex-1 flex flex-col overflow-auto chameleon-bg hide-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <div className="hidden md:block">
            <Header
              user={user}
              onNavigate={handleNavigate}
              onGoBack={handleGoBack}
              onGoForward={handleGoForward}
              canGoBack={historyIndex > 0}
              canGoForward={historyIndex < viewHistory.length - 1}
            />
          </div>
          <div
            className={`flex-1 overflow-auto pt-14 md:pt-0 animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out ${(isNowPlayingOpen || isNowPlayingTransitioning) ? '' : 'pb-[calc(7rem+env(safe-area-inset-bottom,0px))] md:pb-0'}`}
            key={currentView + (selectedPlaylist?.id || '')}
          >
            {renderContent()}
          </div>
        </main>
      </div>

      <div className={isNowPlayingOpen || isNowPlayingTransitioning ? 'hidden md:block' : ''}>
        <Player
          onOpenNowPlaying={() => { setIsNowPlayingTransitioning(true); setIsNowPlayingOpen(true); }}
        />
      </div>

      <CreatePlaylist
        isOpen={showCreatePlaylist}
        onClose={() => setShowCreatePlaylist(false)}
      />

      <NowPlaying
        isOpen={isNowPlayingOpen}
        onClose={() => setIsNowPlayingOpen(false)}
        onExited={() => setIsNowPlayingTransitioning(false)}
        onCreateRadio={() => { if (currentSong) playSong(currentSong, undefined, true); }}
        onAddToPlaylist={() => setShowAddToPlaylist(true)}
      />

      <AddToPlaylistModal
        song={currentSong}
        isOpen={showAddToPlaylist}
        onClose={() => setShowAddToPlaylist(false)}
      />
    </div>
  );
};
