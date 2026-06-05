import {
  Heart, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Volume2, VolumeX,
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
  } = usePlayback();

  const isLiked = !!currentTrack && favorites.has(getTrackKey(currentTrack));
  const [prevVolume, setPrevVolume] = useState(volume);
  const img = song?.imageUrl ?? song?.image_url ?? DEFAULT_IMG;
  const title  = song?.title ?? 'Elige una canción';
  const artist = song?.artist ?? song?.artist_name ?? '';
  const videoId = song?.youtube_id || (currentTrack?.source === 'youtube' ? currentTrack?.sourceId : null);
  let durS = song?.durationSecs ?? song?.duration_seconds ?? 0;
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
            {playbackErrorTrackKey === (song?.youtube_id || song?.id) && playbackError ? (
              <p className="text-[11px] text-zinc-400 truncate">{playbackError}</p>
            ) : preparingTrackKey === String(song?.youtube_id || song?.id) ? (
              <p className="text-[11px] text-violet-400 truncate">Preparando audio...</p>
            ) : null}
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

      {/* ─────────────── DESKTOP full player ─────────────── */}
      <div className="hidden md:flex h-[80px] bg-zinc-950/95 backdrop-blur-md border-t border-white/5 px-5 items-center justify-between">
        {/* Left – song info */}
        <div className="flex items-center gap-4 w-72">
          <button
            onClick={onOpenNowPlaying}
            className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 shadow-md shadow-violet-500/10 hover:shadow-violet-500/20 transition-shadow group"
          >
            <img src={img} alt={title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          </button>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold truncate ${song ? 'text-white' : 'text-zinc-500'}`}>
              {title}
            </p>
            {artist && <p className="text-xs text-zinc-500 truncate">{artist}</p>}
            {playbackErrorTrackKey === (song?.youtube_id || song?.id) && playbackError ? (
              <p className="text-[11px] text-zinc-400 truncate">{playbackError}</p>
            ) : preparingTrackKey === String(song?.youtube_id || song?.id) ? (
              <p className="text-[11px] text-violet-400 truncate">Preparando audio...</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleLike}
              className={`transition-all hover:scale-110 ${isLiked ? 'text-fuchsia-500' : 'text-zinc-500 hover:text-white'}`}
            >
              <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />
            </button>
            {song && (
              <TrackFeedbackMenu
                track={song}
                className="rounded-full bg-white/5 hover:bg-white/10 text-white p-1.5"
              />
            )}
          </div>
        </div>

        {/* Center – controls + progress */}
        <div className="flex-1 max-w-xl flex flex-col items-center gap-1">
          <div className="flex items-center gap-5">
            <motion.button onClick={onToggleShuffle} whileTap={{ scale: 0.85 }} className={`transition-colors ${isShuffle ? 'text-violet-400' : 'text-zinc-500 hover:text-white'}`}>
              <Shuffle className="w-4 h-4" />
            </motion.button>
            <motion.button onClick={onPrev} whileTap={{ scale: 0.85 }} className="text-zinc-400 hover:text-white transition-colors">
              <SkipBack className="w-5 h-5" fill="currentColor" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={onTogglePlay}
              className="w-9 h-9 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow relative"
            >
              {isPlaying
                ? <Pause className="w-4 h-4 text-black" fill="currentColor" />
                : <Play className="w-4 h-4 text-black ml-0.5" fill="currentColor" />
              }
              {/* Animación de ondas detrás del botón de play en escritorio */}
              {isPlaying && (
                <span className="absolute -inset-1 rounded-full animate-ping border border-violet-500/50 opacity-0 pointer-events-none" style={{ animationDuration: '2s' }} />
              )}
            </motion.button>
            <motion.button onClick={onNext} whileTap={{ scale: 0.85 }} className="text-zinc-400 hover:text-white transition-colors">
              <SkipForward className="w-5 h-5" fill="currentColor" />
            </motion.button>
            <motion.button onClick={onCycleRepeat} whileTap={{ scale: 0.85 }} className={`relative transition-colors ${repeatMode !== 'off' ? 'text-violet-400' : 'text-zinc-500 hover:text-white'}`}>
              <Repeat className="w-4 h-4" />
              {repeatMode === 'one' && (
                <span className="absolute -top-1 -right-1 text-[8px] bg-violet-500 text-black rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
                  1
                </span>
              )}
            </motion.button>
          </div>
          <div className="w-full flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="w-10 text-right tabular-nums">{formatTime(durS, progress)}</span>
            <Slider
              value={[progress]}
              onValueChange={([v]) => onProgressChange(v)}
              max={100}
              step={0.1}
              className="flex-1"
              isPlaying={isPlaying}
            />
            <span className="w-10 tabular-nums">{dur}</span>
          </div>
        </div>

        {/* Right – volume */}
        <div className="w-48 flex items-center justify-end gap-2">
          <button onClick={toggleMute} className="text-zinc-500 hover:text-white transition-colors">
            {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <Slider
            value={[volume]}
            onValueChange={([v]) => onVolumeChange(v)}
            max={100}
            step={1}
            className="w-24"
            isPlaying={isPlaying}
          />
        </div>
      </div>
    </>
  );
}
