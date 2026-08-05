import { User } from 'firebase/auth';
import { ChevronLeft, ChevronRight, Bell, Search as SearchIcon, X } from 'lucide-react';
import { useState, useRef } from 'react';
import { SearchAutocomplete, addRecentSearchToLocalStorage } from './SearchAutocomplete';
import { apiFetchItems } from '../api';
import { makeSafeYoutubeWatchUrl } from '../track';

interface HeaderProps {
  user: User | null;
  onNavigate: (view: 'home' | 'search' | 'library' | 'profile') => void;
  onGoBack?: () => void;
  onGoForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  currentView?: string;
  isPlaying?: boolean;
  onSongPlay?: (song: any) => void;
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
}

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
};

export const Header: React.FC<HeaderProps> = ({ user, onNavigate, onGoBack, onGoForward, canGoBack, canGoForward, currentView, isPlaying, onSongPlay, searchQuery: propSearchQuery, onSearchQueryChange }) => {
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const searchQuery = propSearchQuery !== undefined ? propSearchQuery : localSearchQuery;
  const setSearchQuery = onSearchQueryChange || setLocalSearchQuery;

  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearchSubmit = (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const finalQuery = customQuery ?? searchQuery;
    if (finalQuery.trim()) {
      addRecentSearchToLocalStorage({ id: Date.now().toString(), type: 'text', query: finalQuery.trim() });
      if (customQuery) setSearchQuery(customQuery);
      onNavigate('search');
      setIsFocused(false);
      inputRef.current?.blur();
    }
  };

  const handlePlayTrack = async (trackName: string) => {
    setSearchQuery(trackName);
    setIsFocused(false);
    inputRef.current?.blur();
    try {
      const { res, items } = await apiFetchItems<any>(`/api/music/search?q=${encodeURIComponent(trackName)}&mode=search`);
      if (res.ok && items && items.length > 0) {
        const d = items[0];
        const youtubeId = d.youtube_id || String(d.id);
        const who = d.uploader && d.uploader !== 'YouTube' && d.uploader !== 'YouTube Music' ? d.uploader : 'Internet';
        const dur = d.duration_seconds ?? 0;
        const safeUrl = makeSafeYoutubeWatchUrl({ youtube_id: youtubeId } as any);
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
        onSongPlay?.(tempSong);
      } else {
        onNavigate('search');
      }
    } catch (e) {
      onNavigate('search');
    }
  };

  return (
    <header
      className={`flex items-center justify-between px-6 py-4 transition-colors ${currentView === 'playlist' ? 'bg-transparent' : 'bg-[#080010]'}`}
      style={{ paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))' }}
    >
      {/* Left controls & Search */}
      <div className="flex items-center gap-6 flex-1">
        <div className="flex items-center gap-2">
          <button
            onClick={onGoBack}
            disabled={!canGoBack}
            className={`p-1.5 rounded-full bg-white/5 transition-all ${
              canGoBack ? 'text-zinc-400 hover:text-white hover:bg-white/10' : 'text-zinc-700 cursor-not-allowed'
            }`}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={onGoForward}
            disabled={!canGoForward}
            className={`p-1.5 rounded-full bg-white/5 transition-all ${
              canGoForward ? 'text-zinc-400 hover:text-white hover:bg-white/10' : 'text-zinc-700 cursor-not-allowed'
            }`}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        {currentView !== 'search' && (
          <div className="relative w-full max-w-[350px]">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              ref={inputRef}
              type="search"
              placeholder="Buscar..."
              className="w-full bg-[#1c0226] border-0 rounded-none pl-12 pr-10 py-3 text-[14px] text-white placeholder-zinc-500 focus:outline-none focus:ring-0 transition-all"
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            
            <SearchAutocomplete 
              query={searchQuery}
              isVisible={isFocused}
              onSelectText={(text) => handleSearchSubmit(undefined, text)}
              onSelectTrack={handlePlayTrack}
              onClose={() => setIsFocused(false)}
              className="w-[110%] -left-[5%] lg:w-[120%] lg:-left-[10%]"
            />
          </div>
        )}
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-6">
        <style>{`
          @keyframes eq {
            0% { height: 4px; }
            50% { height: 16px; }
            100% { height: 8px; }
          }
        `}</style>
        
        {/* Equalizer animation */}
        {isPlaying && (
          <div className="flex items-end justify-center gap-[3px] h-4 w-4">
            <div className="w-[3px] bg-[#d28bea] rounded-t-sm" style={{ animation: 'eq 0.8s ease-in-out infinite alternate', animationDelay: '0s' }} />
            <div className="w-[3px] bg-[#d28bea] rounded-t-sm" style={{ animation: 'eq 0.8s ease-in-out infinite alternate', animationDelay: '0.2s', animationDuration: '0.9s' }} />
            <div className="w-[3px] bg-[#d28bea] rounded-t-sm" style={{ animation: 'eq 0.8s ease-in-out infinite alternate', animationDelay: '0.4s', animationDuration: '0.7s' }} />
          </div>
        )}

        <button
          onClick={() => onNavigate('profile')}
          className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-[#a855f7] hover:ring-fuchsia-500 transition-all"
        >
          {user?.photoURL ? (
            <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-600 to-fuchsia-600">
              <span className="text-xs font-bold text-white">
                {user?.displayName?.charAt(0) || user?.email?.charAt(0) || 'K'}
              </span>
            </div>
          )}
        </button>
      </div>
    </header>
  );
};

export const HomeHeader: React.FC = () => {
  return (
    <div className="mb-6 md:mb-8">
      <h2 className="text-2xl md:text-3xl font-bold text-white mb-1">{getGreeting()}</h2>
      <p className="text-sm text-zinc-500">Disfruta tu música</p>
    </div>
  );
};
