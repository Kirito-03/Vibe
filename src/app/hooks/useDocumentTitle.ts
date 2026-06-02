import { useEffect } from 'react';
import type { Song } from '../types';

const APP_TITLE = 'Vibe no Sekai';

const cleanText = (input: unknown) => String(input ?? '').replace(/\s+/g, ' ').trim();

const truncate = (input: string, max = 60) => {
  const s = cleanText(input);
  if (!s) return '';
  if (s.length <= max) return s;
  const keep = Math.max(0, max - 3);
  return `${s.slice(0, keep).trimEnd()}...`;
};

export const buildDocumentTitle = (song: Song | null, isPlaying: boolean) => {
  const title = cleanText(song?.title);
  if (!title) return APP_TITLE;
  const artist = cleanText(song?.artist_name || song?.artist || 'Vibe');
  const base = `${title} - ${artist || 'Vibe'}`;
  const withPrefix = `${isPlaying ? '▶ ' : ''}${base}`;
  return truncate(withPrefix, 60) || APP_TITLE;
};

export const useDocumentTitle = (song: Song | null, isPlaying: boolean) => {
  useEffect(() => {
    const nextTitle = buildDocumentTitle(song, isPlaying);
    document.title = nextTitle;
    if (import.meta.env.DEV) console.debug('[document-title]', nextTitle);
  }, [isPlaying, song]);
};

