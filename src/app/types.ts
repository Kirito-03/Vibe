// Based on the data structure from our PostgreSQL database and API
export interface Song {
  id: number | string; // Can be number from DB or string from older mock data if needed
  title: string;
  artist_name?: string; // From backend JOIN
  artist?: string; // From older mock data
  album?: string;
  duration_seconds: number;
  durationSecs?: number; // Alias used by downloads
  duration?: string; // Formatted duration
  file_url: string;
  image_url?: string;
  imageUrl?: string; // Alias used by downloads
  youtube_id?: string;
  source?: string;
}

export type TrackSource = 'youtube' | 'local' | 'downloaded' | 'external';

export type Track = {
  id: string;
  sourceId?: string;
  source: TrackSource;
  title: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  audioUrl?: string;
  duration?: number;
};
