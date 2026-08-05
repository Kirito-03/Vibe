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
        <div className="flex items-center gap-3">
          <img src="/ico.png" alt="Logo" className="w-6 h-6 object-contain" />
          <h1 className="text-xl font-bold text-white tracking-[4px]">
            VIBE
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
                className={`flex items-center gap-4 px-4 py-2 w-full transition-all duration-200 border-l-2 ${
                  currentView === item.view
                    ? 'border-[#a855f7] bg-[#2a0040]/30 text-white font-semibold'
                    : 'border-transparent text-zinc-400 hover:text-white'
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-8 space-y-1">
          <button 
            onClick={() => {
              onCreatePlaylist();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center gap-4 px-4 py-2 w-full transition-all text-zinc-400 hover:text-white"
          >
            <div className="w-5 h-5 flex items-center justify-center rounded-sm text-zinc-400">
              <Plus className="w-4 h-4" />
            </div>
            <span className="text-sm font-medium">Crear playlist</span>
          </button>
        </div>

        <div className="mt-8 px-4 hidden md:block">
          <p className="text-[11px] font-bold tracking-[2px] text-zinc-500 mb-4">PLAYLISTS</p>
          <ul className="space-y-3">
            <li
              onClick={() => { onOpenFavorites(); setIsMobileMenuOpen(false); }}
              className="text-sm text-zinc-400 hover:text-white cursor-pointer transition-colors truncate"
            >
              Favoritos
            </li>
            {playlists.map((playlist) => (
              <li
                key={playlist.id}
                onClick={() => { onPlaylistClick(playlist); setIsMobileMenuOpen(false); }}
                className="text-sm text-zinc-400 hover:text-white cursor-pointer transition-colors truncate"
              >
                {playlist.name}
              </li>
            ))}
          </ul>
        </div>
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
      <div className="hidden md:flex w-60 bg-[#170020] text-white flex-col h-full border-r border-[#2a0040]">
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
