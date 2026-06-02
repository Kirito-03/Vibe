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
