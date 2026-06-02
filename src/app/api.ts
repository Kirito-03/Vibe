import { auth } from '../firebaseConfig';

const normalizeApiBase = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
};

const rawApiBase = String(import.meta.env.VITE_API_BASE ?? '');
export const API_BASE =
  import.meta.env.PROD ? '' : normalizeApiBase(rawApiBase);

if (import.meta.env.DEV) {
  console.debug('[api-base]', API_BASE || 'relative');
}

export const apiFetch = async (path: string, init: RequestInit = {}) => {
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
};

export type ItemsResponse<T> = {
  items: T[];
  source:
    | 'personalized'
    | 'recent'
    | 'favorites'
    | 'downloads'
    | 'search'
    | 'default-search'
    | 'worker'
    | 'global'
    | 'cache'
    | 'empty'
    | 'legacy-array';
  debug?: any;
};

export const normalizeItemsResponse = <T>(input: unknown): ItemsResponse<T> => {
  if (Array.isArray(input)) return { items: input as T[], source: 'legacy-array' };
  if (input && typeof input === 'object') {
    const anyInput = input as any;
    if (Array.isArray(anyInput.items)) {
      return { items: anyInput.items as T[], source: anyInput.source || 'legacy-array' };
    }
  }
  return { items: [], source: 'empty' };
};

export const apiFetchItems = async <T>(path: string, init: RequestInit = {}) => {
  const res = await apiFetch(path, init);
  const json = await res.json().catch(() => null);
  return { res, ...normalizeItemsResponse<T>(json) };
};

export const apiSendRecommendationFeedback = async (input: {
  track: any;
  feedbackType: 'more_like_this' | 'not_this_track' | 'not_this_artist' | 'not_this_genre';
  metadata?: any;
}) => {
  const res = await apiFetch('/api/music/recommendation-feedback', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res;
};

export const apiMarkSeenTracks = async (input: { items: any[]; reason: string }) => {
  const res = await apiFetch('/api/music/seen-tracks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res;
};

export const apiClearSeenTracks = async () => {
  const res = await apiFetch('/api/music/seen-tracks', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'CLEAR_SEEN_TRACKS' }),
  });
  return res;
};

export const apiClearRecommendationCache = async () => {
  const res = await apiFetch('/api/music/recommendation-cache', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'CLEAR_RECOMMENDATION_CACHE' }),
  });
  return res;
};
