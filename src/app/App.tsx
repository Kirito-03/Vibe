import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { MusicProvider } from './context/MusicContext';
import { PlaybackProvider } from './context/PlaybackContext';
import { Login } from './components/Login';
import { LoadingScreen } from './components/LoadingScreen';
import { API_BASE } from './api';
import { auth } from '../firebaseConfig';
import { AppShell } from './AppShell';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const minLoadTime = new Promise((r) => setTimeout(r, 2500));

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        setIsLoggedIn(true);

        try {
          const token = await u.getIdToken();
          const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });
          if (!response.ok) throw new Error('Failed to sync user with backend');
        } catch (error) {
          console.error('Error syncing user with backend:', error);
        }
      } else {
        setIsLoggedIn(false);
        setUser(null);
      }

      await minLoadTime;
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (isLoading) return <LoadingScreen />;
  if (!isLoggedIn) return <Login onLogin={() => setIsLoggedIn(true)} />;

  return (
    <MusicProvider>
      <PlaybackProvider user={user}>
        <AppShell user={user} onLogout={() => signOut(auth)} onProfileUpdate={setUser} />
      </PlaybackProvider>
    </MusicProvider>
  );
}

