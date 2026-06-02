import { Home, Search, Library, Plus, Heart, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useMusic, Playlist } from '../context/MusicContext';
import type { User } from 'firebase/auth';

type ViewType = 'home' | 'search' | 'library' | 'profile' | 'playlist';

interface SidebarProps {
  user: User | null;
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  onCreatePlaylist: () => void;
  onPlaylistClick: (playlist: Playlist) => void;
  onOpenFavorites: () => void;
}

export function Sidebar({ user, currentView, onNavigate, onCreatePlaylist, onPlaylistClick, onOpenFavorites }: SidebarProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { playlists } = useMusic();

  const menuContent = (
    <>
      <div className="p-6 pb-4">
        <div className="flex items-center gap-2">
          <img src="/ico.png" alt="Logo" className="w-8 h-8 object-contain" />
          <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            ibe no Sekai
          </h1>
        </div>
      </div>

      <nav className="flex-1 px-3">
        <ul className="space-y-1">
          {[
            { icon: Home, label: 'Inicio', view: 'home' as ViewType },
            { icon: Search, label: 'Buscar', view: 'search' as ViewType },
            { icon: Library, label: 'Tu biblioteca', view: 'library' as ViewType },
          ].map((item) => (
            <li key={item.view}>
              <button
                aria-label={item.label}
                onClick={() => {
                  onNavigate(item.view);
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-4 px-4 py-2.5 w-full rounded-xl transition-all duration-200 ${
                  currentView === item.view
                    ? 'bg-violet-500/15 text-violet-300 shadow-sm shadow-violet-500/10'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-6 space-y-1">
          <button 
            onClick={() => {
              onCreatePlaylist();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center gap-4 px-4 py-2.5 w-full rounded-xl transition-all text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            <Plus className="w-5 h-5" />
            <span className="text-sm font-medium">Crear playlist</span>
          </button>
          <button
            onClick={() => {
              onOpenFavorites();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center gap-4 px-4 py-2.5 w-full rounded-xl transition-all text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            <Heart className="w-5 h-5 fill-fuchsia-500 text-fuchsia-500" />
            <span className="text-sm font-medium">Tus favoritos</span>
          </button>
        </div>

        {playlists.length > 0 && (
          <div className="mt-6 px-2 hidden md:block">
            <div className="border-t border-white/5 pt-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3 px-2">Playlists</p>
              <ul className="space-y-1">
                {playlists.map((playlist) => (
                  <li
                    key={playlist.id}
                    onClick={() => { onPlaylistClick(playlist); setIsMobileMenuOpen(false); }}
                    className="text-sm text-zinc-400 hover:text-white cursor-pointer transition-colors truncate px-2 py-1.5 rounded-lg hover:bg-white/5"
                  >
                    {playlist.name}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </nav>
    </>
  );

  return (
    <>
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-zinc-950/95 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-2">
          <img src="/ico.png" alt="Logo" className="w-7 h-7 object-contain" />
          <h1 className="text-base font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            ibe no Sekai
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              onNavigate('profile');
              setIsMobileMenuOpen(false);
            }}
            className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-violet-500/30 hover:ring-violet-500/60 transition-all"
          >
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-fuchsia-500">
                <span className="text-xs font-bold text-white">
                  {user?.displayName?.charAt(0) || user?.email?.charAt(0) || 'V'}
                </span>
              </div>
            )}
          </button>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="text-white p-2"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden md:flex w-60 bg-zinc-950/80 backdrop-blur-md text-white flex-col h-full border-r border-white/5">
        {menuContent}
      </div>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="absolute top-0 left-0 bottom-0 w-64 bg-zinc-950 text-white flex flex-col border-r border-white/5">
            {menuContent}
          </div>
        </div>
      )}
    </>
  );
}
