import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';

export type AudioQuality = 'medium' | 'high';

export type AppSettings = {
  autoplay: boolean;
  audioQuality: AudioQuality;
};

const defaultSettings: AppSettings = {
  autoplay: true,
  audioQuality: 'high',
};

type AppSettingsContextValue = {
  settings: AppSettings;
  isReady: boolean;
  updateSettings: (next: AppSettings) => Promise<void>;
};

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setIsReady(false);
      if (!user) {
        setSettings(defaultSettings);
        setIsReady(true);
        return;
      }

      const ref = doc(db, 'users', user.uid, 'settings', 'app');
      const unsubDoc = onSnapshot(
        ref,
        (snap) => {
          const data: any = snap.exists() ? snap.data() : {};
          setSettings({
            autoplay: typeof data.autoplay === 'boolean' ? data.autoplay : defaultSettings.autoplay,
            audioQuality: (data.audioQuality === 'medium' || data.audioQuality === 'high') ? data.audioQuality : defaultSettings.audioQuality,
          });
          setIsReady(true);
        },
        () => {
          setSettings(defaultSettings);
          setIsReady(true);
        }
      );

      return () => unsubDoc();
    });

    return () => unsubAuth();
  }, []);

  const updateSettings = async (next: AppSettings) => {
    const user = auth.currentUser;
    if (!user) return;
    await setDoc(
      doc(db, 'users', user.uid, 'settings', 'app'),
      { autoplay: next.autoplay, audioQuality: next.audioQuality },
      { merge: true }
    );
  };

  const value = useMemo(() => ({ settings, isReady, updateSettings }), [settings, isReady]);
  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error('useAppSettings must be used within AppSettingsProvider');
  return ctx;
}
