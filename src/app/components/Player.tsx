import {
  Heart, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Volume2, VolumeX,
} from 'lucide-react';
import { Slider } from './ui/slider';
import { useState } from 'react';
import { motion } from 'motion/react';
import { usePlayback, getTrackKey } from '../context/PlaybackContext';
import { TrackCover } from './TrackCover';
import { TrackFeedbackMenu } from './TrackFeedbackMenu';

interface PlayerProps {
  onOpenNowPlaying: () => void;
}

const DEFAULT_IMG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%231a1a2e" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23555" font-size="30">♪</text></svg>';

function formatTime(totalSecs: number, pct: number) {
  const s = Math.floor((pct / 100) * totalSecs);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number) {
  if (!seconds || isNaN(seconds)) return '0:00';
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function Player({
  onOpenNowPlaying,
}: PlayerProps) {
  const {
    currentSong: song,
    currentTrack,
    isPlaying,
    progress,
    volume,
    shuffle: isShuffle,
    repeatMode,
    favorites,
    playbackError,
    playbackErrorTrackKey,
    preparingTrackKey,
    togglePlay: onTogglePlay,
    next: onNext,
    previous: onPrev,
    seek: onProgressChange,
    setVolume: onVolumeChange,
    toggleShuffle: onToggleShuffle,
    cycleRepeat: onCycleRepeat,
    toggleLike,
    duration: realDuration,
  } = usePlayback();

  const isLiked = !!currentTrack && favorites.has(getTrackKey(currentTrack));
  const [prevVolume, setPrevVolume] = useState(volume);
  const img = song?.imageUrl ?? song?.image_url ?? '';
  const title  = song?.title ?? 'Elige una canción';
  const artist = song?.artist ?? song?.artist_name ?? '';
  const videoId = song?.youtube_id || (currentTrack?.source === 'youtube' ? currentTrack?.sourceId : null);
  let durS = realDuration > 0 ? realDuration : (song?.durationSecs ?? song?.duration_seconds ?? 0);
  if (!durS && typeof song?.duration === 'number') durS = song.duration;
  let dur = '0:00';
  if (typeof song?.duration === 'string' && song.duration.includes(':')) {
    dur = song.duration;
  } else {
    dur = formatDuration(durS);
  }

  const handleLike = () => {
    if (currentTrack) toggleLike(currentTrack);
  };

  const toggleMute = () => {
    if (volume > 0) {
      setPrevVolume(volume);
      onVolumeChange(0);
    } else {
      onVolumeChange(prevVolume || 70);
    }
  };

  return (
    <>
      {/* ─────────────── MOBILE mini-player ─────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 w-full z-50 bg-zinc-950/95 backdrop-blur-md border-t border-white/5"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {/* Progress strip */}
        <div className="h-[2px] bg-white/5">
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${progress}%`,
              ...(isPlaying ? {
                background: 'linear-gradient(90deg, #7c3aed, #a855f7, #ec4899, #7c3aed)',
                backgroundSize: '200% 100%',
                animation: 'progress-shimmer 3s linear infinite',
                boxShadow: '0 0 6px rgba(139, 92, 246, 0.7)',
              } : {
                background: 'linear-gradient(90deg, #8b5cf6, #d946ef)',
              })
            }}
          />
        </div>

        <div className="flex items-center gap-3 px-4 py-2">
          <button
            onClick={onOpenNowPlaying}
            className="relative w-11 h-11 flex-shrink-0 rounded-lg overflow-hidden shadow-lg shadow-violet-500/10"
          >
            <TrackCover src={img} videoId={videoId} title={title} className="w-full h-full object-cover" />
            {isPlaying && (
              <div className="absolute inset-0 flex items-end justify-center pb-1 bg-black/20">
                <div className="flex gap-[2px] items-end h-3">
                  {[1,2,3].map((i) => (
                    <motion.div
                      key={i}
                      className="w-[3px] bg-violet-400 rounded-full"
                      style={{ height: 12, transformOrigin: 'bottom' }}
                      animate={{ scaleY: [0.35, 1, 0.35], opacity: [0.6, 1, 0.6] }}
                      transition={{ duration: 0.7, repeat: Infinity, repeatType: 'mirror', delay: i * 0.12, ease: 'easeInOut' }}
                    />
                  ))}
                </div>
              </div>
            )}
          </button>

          <button onClick={onOpenNowPlaying} className="flex-1 min-w-0 text-left">
            <p className={`text-sm font-semibold truncate ${song ? 'text-white' : 'text-zinc-500'}`}>
              {title}
            </p>
            {artist && <p className="text-xs text-zinc-500 truncate">{artist}</p>}
          </button>

          <button
            onClick={handleLike}
            className={`hidden sm:block p-2 transition-colors ${isLiked ? 'text-fuchsia-500' : 'text-zinc-500'}`}
          >
            <Heart className="w-5 h-5" fill={isLiked ? 'currentColor' : 'none'} />
          </button>

          {song && (
            <div className="hidden sm:block">
              <TrackFeedbackMenu
                track={song}
                className="rounded-full bg-white/5 hover:bg-white/10 text-white p-2"
              />
            </div>
          )}

          <button onClick={onTogglePlay} className="p-2 text-white">
            {isPlaying
              ? <Pause className="w-6 h-6" fill="currentColor" />
              : <Play className="w-6 h-6" fill="currentColor" />
            }
          </button>

          <button onClick={onNext} className="p-1.5 text-zinc-400">
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ─────────────── DESKTOP slim player ─────────────── */}
      <div className="hidden md:flex relative h-16 bg-[#080010] px-6 items-center justify-between">
        {/* Progress strip at top edge */}
        <div className="absolute top-0 left-0 w-full h-[2px] bg-white/10">
          <div
            className="h-full bg-[#d946ef] transition-all duration-300 shadow-[0_0_10px_#d946ef]"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Left – song info */}
        <div className="flex items-center gap-4 w-1/3">
          <button
            onClick={onOpenNowPlaying}
            className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-zinc-800"
          >
            <TrackCover src={img} videoId={videoId} title={title} className="w-full h-full object-cover" />
          </button>
          <div className="min-w-0 flex-shrink-0 max-w-[150px]">
            <p className={`text-[13px] font-bold truncate ${song ? 'text-white' : 'text-zinc-500'}`}>
              {title}
            </p>
            {artist && <p className="text-[11px] font-medium text-[#d946ef] truncate">{artist}</p>}
          </div>
          
          {/* Inline Eq & Time */}
          {song && (
            <div className="flex items-center gap-3 ml-2 flex-shrink-0">
              <div className="flex items-end justify-center gap-[2px] h-3 w-3">
                <div className="w-[2px] bg-white rounded-t-sm" style={isPlaying ? { animation: 'eq 0.8s ease-in-out infinite alternate', animationDelay: '0s' } : { height: '3px' }} />
                <div className="w-[2px] bg-white rounded-t-sm" style={isPlaying ? { animation: 'eq 0.8s ease-in-out infinite alternate', animationDelay: '0.2s', animationDuration: '0.9s' } : { height: '8px' }} />
                <div className="w-[2px] bg-white rounded-t-sm" style={isPlaying ? { animation: 'eq 0.8s ease-in-out infinite alternate', animationDelay: '0.4s', animationDuration: '0.7s' } : { height: '5px' }} />
              </div>
              <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(durS, progress)}</span>
            </div>
          )}
        </div>

        {/* Center – controls */}
        <div className="flex items-center justify-center gap-5 w-1/3">
          <button onClick={onCycleRepeat} className={`transition-colors ${repeatMode !== 'off' ? 'text-[#a855f7]' : 'text-zinc-500 hover:text-zinc-400'}`}>
            {repeatMode === 'one' ? <Repeat1 className="w-[14px] h-[14px]" /> : <Repeat className="w-[14px] h-[14px]" />}
          </button>
          <button onClick={onPrev} className="text-zinc-400 hover:text-white transition-colors">
            <SkipBack className="w-[14px] h-[14px]" fill="currentColor" />
          </button>
          <button
            onClick={onTogglePlay}
            className="w-8 h-8 bg-[#e8d5f8] rounded-none flex items-center justify-center hover:scale-105 transition-transform"
          >
            {isPlaying
              ? <Pause className="w-[14px] h-[14px] text-[#3b1e54]" fill="currentColor" />
              : <Play className="w-[14px] h-[14px] text-[#3b1e54]" fill="currentColor" />
            }
          </button>
          <button onClick={onNext} className="text-zinc-400 hover:text-white transition-colors">
            <SkipForward className="w-[14px] h-[14px]" fill="currentColor" />
          </button>
          <button onClick={onToggleShuffle} className={`transition-colors ${isShuffle ? 'text-[#a855f7]' : 'text-zinc-500 hover:text-zinc-400'}`}>
            <Shuffle className="w-[14px] h-[14px]" />
          </button>
        </div>

        {/* Right – volume */}
        <div className="flex items-center justify-end gap-3 w-1/3">
            <button onClick={toggleMute} className="text-zinc-400 hover:text-white transition-colors">
              {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <Slider
              value={[volume]}
              onValueChange={([v]) => onVolumeChange(v)}
              max={100}
              step={1}
              className="w-20"
              isPlaying={isPlaying}
            />
          </div>
        </div>
    </>
  );
}
