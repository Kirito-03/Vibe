import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { Song } from '../types';

type DownloadLike = any;

type HomeDataState = {
  recentTracks: Song[];
  forYouItems: DownloadLike[];
  recommendationsItems: DownloadLike[];
  forYouSource: string;
  recommendationsSource: string;
  isLoadingForYou: boolean;
  isLoadingRecommendations: boolean;
  forYouError: string | null;
  recommendationsError: string | null;
  lastLoadedAt: number | null;
  hasLoadedOnce: boolean;
};

export const HOME_CACHE_TTL_MS = 5 * 60 * 1000;

type HomeDataApi = HomeDataState & {
  setRecentTracks: React.Dispatch<React.SetStateAction<Song[]>>;
  setForYouItems: React.Dispatch<React.SetStateAction<DownloadLike[]>>;
  setRecommendationsItems: React.Dispatch<React.SetStateAction<DownloadLike[]>>;
  setForYouSource: React.Dispatch<React.SetStateAction<string>>;
  setRecommendationsSource: React.Dispatch<React.SetStateAction<string>>;
  setIsLoadingForYou: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLoadingRecommendations: React.Dispatch<React.SetStateAction<boolean>>;
  setForYouError: React.Dispatch<React.SetStateAction<string | null>>;
  setRecommendationsError: React.Dispatch<React.SetStateAction<string | null>>;
  markLoaded: () => void;
  isFresh: () => boolean;
  clearHomeDataCache: () => void;
};

const HomeDataContext = createContext<HomeDataApi | null>(null);

export function HomeDataProvider({ user, children }: { user: User | null; children: React.ReactNode }) {
  const uid = user?.uid || null;
  const lastUidRef = useRef<string | null>(uid);
  const [recentTracks, setRecentTracks] = useState<Song[]>([]);
  const [forYouItems, setForYouItems] = useState<DownloadLike[]>([]);
  const [recommendationsItems, setRecommendationsItems] = useState<DownloadLike[]>([]);
  const [forYouSource, setForYouSource] = useState('');
  const [recommendationsSource, setRecommendationsSource] = useState('');
  const [isLoadingForYou, setIsLoadingForYou] = useState(false);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [forYouError, setForYouError] = useState<string | null>(null);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const clearHomeDataCache = useCallback(() => {
    setRecentTracks([]);
    setForYouItems([]);
    setRecommendationsItems([]);
    setForYouSource('');
    setRecommendationsSource('');
    setIsLoadingForYou(false);
    setIsLoadingRecommendations(false);
    setForYouError(null);
    setRecommendationsError(null);
    setLastLoadedAt(null);
    setHasLoadedOnce(false);
  }, []);

  useEffect(() => {
    if (lastUidRef.current === uid) return;
    lastUidRef.current = uid;
    clearHomeDataCache();
  }, [clearHomeDataCache, uid]);

  const markLoaded = useCallback(() => {
    setLastLoadedAt(Date.now());
    setHasLoadedOnce(true);
  }, []);

  const isFresh = useCallback(() => {
    if (!hasLoadedOnce || !lastLoadedAt) return false;
    return Date.now() - lastLoadedAt < HOME_CACHE_TTL_MS;
  }, [hasLoadedOnce, lastLoadedAt]);

  const state: HomeDataState = useMemo(
    () => ({
      recentTracks,
      forYouItems,
      recommendationsItems,
      forYouSource,
      recommendationsSource,
      isLoadingForYou,
      isLoadingRecommendations,
      forYouError,
      recommendationsError,
      lastLoadedAt,
      hasLoadedOnce,
    }),
    [
      recentTracks,
      forYouItems,
      recommendationsItems,
      forYouSource,
      recommendationsSource,
      isLoadingForYou,
      isLoadingRecommendations,
      forYouError,
      recommendationsError,
      lastLoadedAt,
      hasLoadedOnce,
    ]
  );

  const value = useMemo<HomeDataApi>(
    () => ({
      ...state,
      setRecentTracks,
      setForYouItems,
      setRecommendationsItems,
      setForYouSource,
      setRecommendationsSource,
      setIsLoadingForYou,
      setIsLoadingRecommendations,
      setForYouError,
      setRecommendationsError,
      markLoaded,
      isFresh,
      clearHomeDataCache,
    }),
    [state, markLoaded, isFresh, clearHomeDataCache]
  );

  return <HomeDataContext.Provider value={value}>{children}</HomeDataContext.Provider>;
}

export const useHomeData = () => {
  const ctx = useContext(HomeDataContext);
  if (!ctx) throw new Error('useHomeData must be used within HomeDataProvider');
  return ctx;
};
