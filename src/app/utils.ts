import { Song } from './types';

export const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const formatTotalDuration = (songs: Song[]): string => {
  const totalSeconds = songs.reduce((acc, song) => acc + song.duration_seconds, 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  
  let result = '';
  if (hours > 0) {
    result += `${hours} h `;
  }
  result += `${minutes} min`;
  
  return result;
};

export const cleanSourceValue = (value: any): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '' || s === 'null' || s === 'undefined' || s === 'NaN' || s === 'dl-null' || s === '/api/downloads/stream/null' || s.endsWith('/stream/null') || s.includes('watch?v=null')) {
    return null;
  }
  return s;
};

export const getUserStorageKey = (baseKey: string, uid?: string | null): string | null => {
  if (!uid) return null;
  return `${baseKey}:${uid}`;
};

export const cleanupLegacyPlaybackStorage = () => {
  try {
    console.log('[storage] cleanup legacy global keys');
    localStorage.removeItem('vns_lastPlayed');
    localStorage.removeItem('vns_playback_state_v1');
    localStorage.removeItem('vns_playback_state');
    localStorage.removeItem('vns_queue');
    localStorage.removeItem('vns_resumeCandidate');
  } catch (e) {}
};
