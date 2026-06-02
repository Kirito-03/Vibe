import { User } from 'firebase/auth';
import { ChevronLeft, ChevronRight, Bell } from 'lucide-react';

interface HeaderProps {
  user: User | null;
  onNavigate: (view: 'home' | 'search' | 'library' | 'profile') => void;
  onGoBack?: () => void;
  onGoForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 18) return 'Buenas tardes';
  return 'Buenas noches';
};

export const Header: React.FC<HeaderProps> = ({ user, onNavigate, onGoBack, onGoForward, canGoBack, canGoForward }) => {
  return (
    <header
      className="flex items-center justify-between px-4 pb-4 md:px-6 md:py-4"
      style={{ paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))' }}
    >
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
      <div className="flex items-center gap-3">
        <button className="p-2 rounded-full bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 transition-all">
          <Bell className="w-4 h-4" />
        </button>
        <button
          onClick={() => onNavigate('profile')}
          className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-violet-500/30 hover:ring-violet-500/60 transition-all"
        >
          {user?.photoURL ? (
            <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <span className="text-xs font-bold text-white">
                {user?.displayName?.charAt(0) || user?.email?.charAt(0)}
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
