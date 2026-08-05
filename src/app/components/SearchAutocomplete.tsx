import React, { useState, useEffect } from 'react';
import { Search as SearchIcon, Clock, Plus, X } from 'lucide-react';

export interface RecentSearch {
  id: string;
  type: 'text' | 'track';
  query?: string;
  track?: {
    title: string;
    artist: string;
    cover: string | null;
  };
}

interface SearchAutocompleteProps {
  query: string;
  isVisible: boolean;
  onSelectText: (text: string) => void;
  onSelectTrack: (trackName: string) => void;
  onClose: () => void;
  className?: string;
}

export const addRecentSearchToLocalStorage = (item: RecentSearch) => {
  try {
    const stored = localStorage.getItem('vibe_recent_searches');
    let recents: RecentSearch[] = stored ? JSON.parse(stored) : [];
    recents = recents.filter(r => 
      item.type === 'text' ? r.query !== item.query : r.track?.title !== item.track?.title
    );
    recents.unshift(item);
    if (recents.length > 8) recents = recents.slice(0, 8);
    localStorage.setItem('vibe_recent_searches', JSON.stringify(recents));
  } catch (err) {
    console.error('Error saving recent', err);
  }
};

export const SearchAutocomplete: React.FC<SearchAutocompleteProps> = ({
  query,
  isVisible,
  onSelectText,
  onSelectTrack,
  onClose,
  className = "left-0 right-0"
}) => {
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [tracks, setTracks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Load recent searches on mount
  useEffect(() => {
    if (!isVisible) return;
    try {
      const stored = localStorage.getItem('vibe_recent_searches');
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Error loading recent searches', err);
    }
  }, [isVisible]);

  // Fetch suggestions
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      setTracks([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=8`);
        const data = await res.json();
        
        if (data.results) {
          const uniqueNames = new Set<string>();
          const textSuggs: string[] = [];
          const trackSuggs: any[] = [];
          
          data.results.forEach((item: any) => {
            const name = item.trackName.toLowerCase();
            if (!uniqueNames.has(name) && textSuggs.length < 4) {
              uniqueNames.add(name);
              textSuggs.push(item.trackName.toLowerCase());
            }
            if (trackSuggs.length < 3) {
              trackSuggs.push({
                id: item.trackId.toString(),
                title: item.trackName,
                artist: item.artistName,
                cover: item.artworkUrl100?.replace('100x100', '200x200')
              });
            }
          });
          
          setSuggestions(textSuggs);
          setTracks(trackSuggs);
        }
      } catch (err) {
        console.error('Error fetching autocomplete', err);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const addRecent = (item: RecentSearch) => {
    addRecentSearchToLocalStorage(item);
    // update local state
    try {
      const stored = localStorage.getItem('vibe_recent_searches');
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch {}
  };

  const removeRecent = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newRecents = recentSearches.filter(r => r.id !== id);
    setRecentSearches(newRecents);
    localStorage.setItem('vibe_recent_searches', JSON.stringify(newRecents));
  };

  const handleSelectText = (text: string) => {
    addRecent({ id: Date.now().toString(), type: 'text', query: text });
    onSelectText(text);
  };

  const handleSelectTrack = (track: any) => {
    addRecent({ id: Date.now().toString(), type: 'track', track: { title: track.title, artist: track.artist, cover: track.cover } });
    onSelectTrack(track.title);
  };

  if (!isVisible) return null;

  const showRecent = !query.trim();

  return (
    <div className={`absolute top-[calc(100%+8px)] bg-[#242424] rounded-lg shadow-2xl overflow-hidden z-50 border border-white/5 max-h-[60vh] overflow-y-auto ${className}`}>
      <div className="p-2">
        {showRecent ? (
          <div>
            {recentSearches.length > 0 && (
              <h3 className="text-sm font-bold text-white px-4 py-3 pb-2">Búsquedas recientes</h3>
            )}
            {recentSearches.map((recent) => (
              <div 
                key={recent.id}
                onMouseDown={() => recent.type === 'text' ? handleSelectText(recent.query!) : handleSelectTrack(recent.track!)}
                className="flex items-center justify-between p-3 px-4 hover:bg-white/10 rounded-md cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-4 overflow-hidden">
                  {recent.type === 'text' ? (
                    <Clock className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                  ) : (
                    <img src={recent.track?.cover || ''} alt="" className="w-10 h-10 rounded-sm object-cover bg-zinc-800" />
                  )}
                  <div className="flex flex-col truncate">
                    <span className="text-white text-[15px] font-medium truncate">
                      {recent.type === 'text' ? recent.query : recent.track?.title}
                    </span>
                    {recent.type === 'track' && (
                      <span className="text-zinc-400 text-[13px] truncate">Canción • {recent.track?.artist}</span>
                    )}
                  </div>
                </div>
                <button 
                  onMouseDown={(e) => { 
                    e.preventDefault(); 
                    e.stopPropagation(); 
                    removeRecent(e, recent.id); 
                  }}
                  className="p-1 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {recentSearches.length === 0 && (
              <div className="p-4 text-zinc-400 text-sm text-center">No hay búsquedas recientes</div>
            )}
          </div>
        ) : (
          <div>
            {suggestions.map((text, idx) => {
              const q = query.toLowerCase();
              const matchIdx = text.indexOf(q);
              return (
                <div 
                  key={`sugg-${idx}`}
                  onMouseDown={() => handleSelectText(text)}
                  className="flex items-center gap-4 p-3 px-4 hover:bg-white/10 rounded-md cursor-pointer transition-colors"
                >
                  <SearchIcon className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                  <span className="text-white text-[15px] truncate">
                    {matchIdx >= 0 ? (
                      <>
                        <span className="font-bold">{text.substring(0, matchIdx + q.length)}</span>
                        <span className="text-zinc-300 font-normal">{text.substring(matchIdx + q.length)}</span>
                      </>
                    ) : (
                      <span>{text}</span>
                    )}
                  </span>
                </div>
              );
            })}
            
            {tracks.length > 0 && <div className="h-px bg-white/5 my-2 mx-4" />}
            
            {tracks.map((track) => (
              <div 
                key={track.id}
                onMouseDown={() => handleSelectTrack(track)}
                className="flex items-center justify-between p-3 px-4 hover:bg-white/10 rounded-md cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-4 overflow-hidden">
                  <img src={track.cover || ''} alt="" className="w-10 h-10 rounded-sm object-cover bg-zinc-800" />
                  <div className="flex flex-col truncate">
                    <span className="text-white text-[15px] font-medium truncate">{track.title}</span>
                    <span className="text-zinc-400 text-[13px] truncate">Canción • {track.artist}</span>
                  </div>
                </div>
                <div className="text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Plus className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
