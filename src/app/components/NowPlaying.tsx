import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown, Heart, Play, Pause,
  SkipBack, SkipForward, Shuffle, Repeat,
  Volume2, VolumeX, ListMusic, Mic2, Radio, X, GripVertical, Clock,
  ChevronRight, Sparkles, ListPlus, Maximize2, Minimize2
} from 'lucide-react';
import { Song } from '../types';
import { Slider } from './ui/slider';

import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { apiFetch } from '../api';
import { usePlayback, getTrackKey } from '../context/PlaybackContext';
import { trackFromSong } from '../track';
import { TrackCover } from './TrackCover';
import { TrackFeedbackMenu } from './TrackFeedbackMenu';

interface NowPlayingProps {
  isOpen: boolean;
  onClose: () => void;
  onExited?: () => void;
  onCreateRadio?: () => void;
  onAddToPlaylist?: () => void;
}

function formatSecs(totalSecs: number, pct: number) {
  const s = Math.floor((pct / 100) * totalSecs);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number) {
  if (!seconds || isNaN(seconds)) return '0:00';
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function NowPlaying({
  isOpen,
  onClose,
  onExited,
  onCreateRadio,
  onAddToPlaylist,
}: NowPlayingProps) {
  const {
    currentSong: song,
    currentPlaylist: playlist,
    currentTrack,
    isPlaying,
    progress,
    volume: volumeProp,
    shuffle: isShuffle,
    repeatMode,
    favorites,
    playbackError,
    togglePlay: onTogglePlay,
    next: onNext,
    previous: onPrev,
    seek: onProgressChange,
    setVolume: onVolumeChange,
    toggleShuffle: onToggleShuffle,
    cycleRepeat: onCycleRepeat,
    reorderQueue,
    removeFromQueue: onRemoveFromQueue,
    playNextFromQueueIndex: onPlayNext,
    sleepTimerRemainingSec,
    setSleepTimer: onSetSleepTimerMinutes,
    toggleLike,
  } = usePlayback();

  const isLiked = !!currentTrack && favorites.has(getTrackKey(currentTrack));
  const [prevVolume, setPrevVolume] = useState(volumeProp);
  const touchStartY = useRef<number | null>(null);
  
  const [showLyrics, setShowLyrics] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [ambientMode, setAmbientMode] = useState(false);
  const [ambientControlsVisible, setAmbientControlsVisible] = useState(false);
  const [sleepTimerSheetOpen, setSleepTimerSheetOpen] = useState(false);
  const [sleepTimerMinutesDraft, setSleepTimerMinutesDraft] = useState('30');
  const ambientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lyrics, setLyrics] = useState<{synced?: string, plain?: string} | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [hoveredQueueIdx, setHoveredQueueIdx] = useState<number | null>(null);
  const [removingIdx, setRemovingIdx] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fullscreen API — also activates ambient mode for best experience
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        setIsFullscreen(true);
        setAmbientMode(true);   // auto-activate ambient in fullscreen
        setShowLyrics(false);
        setShowQueue(false);
      }).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Sync fullscreen state with browser events (e.g. user presses Escape)
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Parse synced lyrics string to array of objects
  const parsedLyrics = lyrics?.synced ? 
    lyrics.synced.split('\n').filter(l => l.trim()).map(line => {
      const match = line.match(/\[(\d{2}):(\d{2}\.\d{2,3})\](.*)/);
      if (match) {
        const [, min, sec, text] = match;
        const time = parseInt(min) * 60 + parseFloat(sec);
        return { time, text: text.trim() };
      }
      return null;
    }).filter(Boolean) as {time: number, text: string}[] 
    : null;

  useEffect(() => { 
    setLyrics(null);
    if (showLyrics && song) {
      fetchLyrics(song);
    }
  }, [song?.id]);

  const fetchLyrics = async (current: Song) => {
    setIsLoadingLyrics(true);
    try {
      const title = current.title;
      const artist = current.artist || current.artist_name || '';
      const res = await apiFetch(`/api/music/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`);
      if (res.ok) {
        const data = await res.json();
        setLyrics(data);
      } else {
        setLyrics(null);
      }
    } catch (e) {
      setLyrics(null);
    } finally {
      setIsLoadingLyrics(false);
    }
  };

  const toggleLyrics = () => {
    setShowQueue(false);
    const newState = !showLyrics;
    setShowLyrics(newState);
    if (newState && song && !lyrics) {
      fetchLyrics(song);
    }
  };

  const toggleQueue = () => {
    setShowLyrics(false);
    setShowQueue(!showQueue);
  };

  const toggleMute = () => {
    if (volumeProp > 0) {
      setPrevVolume(volumeProp);
      onVolumeChange(0);
    } else {
      onVolumeChange(prevVolume || 70);
    }
  };

  // Swipe-down to close
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    if (delta > 80) onClose();
    touchStartY.current = null;
  };

  const handleDragEnd = (result: any) => {
    if (!result.destination || !playlist?.songs) return;
    
    const items = Array.from(playlist.songs);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    reorderQueue(items.map(trackFromSong));
  };

  const handleRemove = (index: number) => {
    setRemovingIdx(index);
    setTimeout(() => {
      onRemoveFromQueue(index);
      setRemovingIdx(null);
    }, 220);
  };

  // Ambient mode: show controls briefly on interaction, then hide again
  const showAmbientControls = () => {
    setAmbientControlsVisible(true);
    if (ambientTimerRef.current) clearTimeout(ambientTimerRef.current);
    ambientTimerRef.current = setTimeout(() => setAmbientControlsVisible(false), 3000);
  };

  const toggleAmbientMode = () => {
    setAmbientMode(prev => !prev);
    setShowLyrics(false);
    setShowQueue(false);
  };

  let durSecs = song?.duration_seconds ?? song?.durationSecs ?? 0;
  if (!durSecs && typeof song?.duration === 'number') durSecs = song.duration;
  const currentSecs = (progress / 100) * durSecs;
  const elapsed = song ? formatSecs(durSecs, progress) : '0:00';
  let total = '0:00';
  if (song) {
    total = (typeof song.duration === 'string' && song.duration.includes(':')) ? song.duration : formatDuration(durSecs);
  }
  const img     = song?.imageUrl ?? song?.image_url ?? '';
  const queueSongs = playlist?.songs ?? [];
  const currentIdx = queueSongs.findIndex(x => x.id === song?.id);
  const isRadio = String(playlist?.id || '').startsWith('radio-');

  // Next song for display
  const nextSong = currentIdx >= 0 && currentIdx < queueSongs.length - 1
    ? queueSongs[currentIdx + 1]
    : null;

    const timerLabel = (() => {
      if (!sleepTimerRemainingSec || sleepTimerRemainingSec <= 0) return null;
      const m = Math.floor(sleepTimerRemainingSec / 60);
      const s = Math.floor(sleepTimerRemainingSec % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
    })();

    const setTimer = (m: number | null) => {
      onSetSleepTimerMinutes(m);
    };

    const openSleepTimer = () => {
      const minutes = sleepTimerRemainingSec && sleepTimerRemainingSec > 0
        ? Math.max(1, Math.ceil(sleepTimerRemainingSec / 60))
        : 30;
      setSleepTimerMinutesDraft(String(minutes));
      setSleepTimerSheetOpen(true);
    };

    const closeSleepTimer = () => setSleepTimerSheetOpen(false);

    const applySleepTimer = (minutes: number) => {
      setTimer(minutes);
      closeSleepTimer();
    };

    return (
    <>
    <AnimatePresence onExitComplete={onExited}>
      {isOpen && song && (
        <motion.div
          key="now-playing"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          ref={containerRef}
          className="fixed inset-0 z-[100] flex flex-col select-none overflow-hidden"
          style={{ background: '#080810' }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onClick={ambientMode ? showAmbientControls : undefined}
        >
          {/* ── Premium Ambient Mode Overlay ── */}
          <AnimatePresence>
            {ambientMode && (
              <motion.div
                key="ambient-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1 }}
                className="absolute inset-0 z-[150] flex flex-col items-center justify-center overflow-hidden"
                style={{ background: '#000' }}
                onClick={showAmbientControls}
              >
                {/* Layer 1: Full-bleed album art background */}
                <motion.img
                  key={img + '-ambient-bg'}
                  src={img}
                  alt=""
                  initial={{ opacity: 0, scale: 1.15 }}
                  animate={{ opacity: 0.35, scale: 1.0 }}
                  transition={{ duration: 3, ease: 'easeOut' }}
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ filter: 'blur(80px) saturate(250%) brightness(0.45)' }}
                />

                {/* Layer 2: Dynamic color orbs */}
                <motion.div
                  animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0], scale: [1, 1.15, 0.95, 1] }}
                  transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute top-[10%] left-[15%] w-[40vw] h-[40vw] rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.5) 0%, transparent 70%)', filter: 'blur(40px)' }}
                />
                <motion.div
                  animate={{ x: [0, -50, 30, 0], y: [0, 40, -25, 0], scale: [1, 0.9, 1.2, 1] }}
                  transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
                  className="absolute bottom-[15%] right-[10%] w-[35vw] h-[35vw] rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.4) 0%, transparent 70%)', filter: 'blur(40px)' }}
                />
                <motion.div
                  animate={{ x: [0, 25, -40, 0], y: [0, 50, -10, 0], scale: [1, 1.1, 0.92, 1] }}
                  transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 5 }}
                  className="absolute top-[40%] right-[20%] w-[28vw] h-[28vw] rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.25) 0%, transparent 70%)', filter: 'blur(40px)' }}
                />

                {/* Layer 3: Vignette */}
                <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.75) 100%)' }} />

                {/* Pulsing rings around album art */}
                <div className="relative flex items-center justify-center">
                  {isPlaying && (
                    <>
                      {[1, 2, 3].map((i) => (
                        <motion.div
                          key={i}
                          className="absolute rounded-full border"
                          style={{
                            borderColor: `rgba(139,92,246,${0.25 / i})`,
                            width: `min(${70 + i * 12}vw, ${70 + i * 12}vh)`,
                            height: `min(${70 + i * 12}vw, ${70 + i * 12}vh)`,
                          }}
                          animate={{ scale: [1, 1.06, 1], opacity: [0.6, 0.2, 0.6] }}
                          transition={{ duration: 2.5 + i * 0.5, repeat: Infinity, delay: i * 0.4, ease: 'easeInOut' }}
                        />
                      ))}
                    </>
                  )}

                  {/* Main album art */}
                  <motion.div
                    animate={isPlaying ? { scale: [1, 1.025, 1] } : { scale: 1 }}
                    transition={isPlaying ? { duration: 3, repeat: Infinity, ease: 'easeInOut' } : {}}
                    className="relative z-10 rounded-[28px] overflow-hidden"
                    style={{
                      width: 'min(62vw, 62vh)',
                      height: 'min(62vw, 62vh)',
                      boxShadow: '0 40px 120px rgba(0,0,0,0.95), 0 0 60px rgba(139,92,246,0.2)'
                    }}
                  >
                    <TrackCover src={img} videoId={song.youtube_id || null} title={song.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 rounded-[28px]" style={{ boxShadow: 'inset 0 0 40px rgba(0,0,0,0.3)' }} />
                  </motion.div>
                </div>

                {/* Song info — glass morphism card */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, duration: 0.8 }}
                  className="relative z-10 text-center mt-8 px-8 py-4 rounded-2xl max-w-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <p className="text-white font-bold text-xl truncate leading-tight">{song.title}</p>
                  <p className="text-white/50 text-sm mt-1 truncate">{song.artist ?? song.artist_name}</p>
                </motion.div>

                {/* Visualizer bars */}
                {isPlaying && (
                  <div className="relative z-10 flex items-end justify-center gap-[3px] h-7 mt-5">
                    {[...Array(28)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-[3px] h-7 rounded-full"
                        style={{ background: `hsl(${260 + i * 3}, 70%, ${55 + i % 3 * 8}%)`, transformOrigin: 'bottom' }}
                        animate={{
                          scaleY: [
                            0.18 + (i % 5) * 0.06,
                            0.55 + Math.abs(Math.sin(i * 0.8)) * 0.45,
                            0.18 + (i % 5) * 0.06,
                          ],
                          opacity: [0.65, 1, 0.65],
                        }}
                        transition={{ duration: 0.35 + (i % 7) * 0.08, repeat: Infinity, repeatType: 'mirror', delay: i * 0.03, ease: 'easeInOut' }}
                      />
                    ))}
                  </div>
                )}

                {/* Controls appear on tap */}
                <AnimatePresence>
                  {ambientControlsVisible && (
                    <motion.div
                      initial={{ opacity: 0, y: 24 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 24 }}
                      className="absolute bottom-10 z-10 flex flex-col items-center gap-5 w-full px-8"
                      onClick={e => e.stopPropagation()}
                    >
                      {/* Progress */}
                      <div className="w-full max-w-xs">
                        <Slider
                          value={[progress]}
                          onValueChange={([v]) => onProgressChange(v)}
                          max={100} step={0.1}
                          className="w-full"
                          isPlaying={isPlaying}
                        />
                        <div className="flex justify-between text-xs text-white/40 mt-1 tabular-nums">
                          <span>{elapsed}</span>
                          <span>{total}</span>
                        </div>
                      </div>
                      {/* Controls */}
                      <div className="flex items-center gap-10">
                        <button onClick={onPrev} className="text-white/60 hover:text-white transition-colors">
                          <SkipBack className="w-7 h-7" fill="currentColor" />
                        </button>
                        <button
                          onClick={onTogglePlay}
                          className="w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
                          style={{ background: 'linear-gradient(135deg,#7c3aed,#ec4899)', boxShadow: '0 0 40px rgba(139,92,246,0.5)' }}
                        >
                          {isPlaying
                            ? <Pause className="w-7 h-7 text-white" fill="currentColor" />
                            : <Play className="w-7 h-7 text-white ml-1" fill="currentColor" />}
                        </button>
                        <button onClick={onNext} className="text-white/60 hover:text-white transition-colors">
                          <SkipForward className="w-7 h-7" fill="currentColor" />
                        </button>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleAmbientMode(); }}
                        className="text-white/30 hover:text-white/70 text-xs flex items-center gap-1.5 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" /> Salir del modo ambiente
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Ambient blurred background ── */}
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <motion.img
              key={img}
              src={img}
              alt=""
              initial={{ opacity: 0, scale: 1.2 }}
              animate={{ opacity: 0.45, scale: 1.08 }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              className="w-full h-full object-cover blur-[90px]"
              style={{ filter: 'blur(90px) saturate(160%) brightness(0.6)' }}
            />
            {/* Radial glow from center */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/50 to-black/90" />
            {/* Subtle vignette */}
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 100%)' }} />
          </div>

          {/* ── Top bar ── */}
          <div className="flex items-center justify-between px-4 flex-shrink-0"
            style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)', paddingBottom: '8px' }}>
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white active:scale-90 transition-all p-2 -ml-2 rounded-full hover:bg-white/10"
            >
              <ChevronDown className="w-7 h-7" />
            </button>
            <div className="text-center flex-1 mx-2">
              <p className="text-[10px] uppercase tracking-[0.25em] text-white/40 font-semibold">
                {isRadio ? '◈ Radio Automática' : 'Reproduciendo ahora'}
              </p>
              {playlist && (
                <p className="text-white/80 text-sm font-semibold mt-0.5 truncate max-w-[220px]">
                  {playlist.name}
                </p>
              )}
            </div>
            {/* Fullscreen button */}
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Salir pantalla completa' : 'Pantalla completa'}
              className="text-white/70 hover:text-white active:scale-90 transition-all p-2 rounded-full hover:bg-white/10"
            >
              {isFullscreen
                ? <Minimize2 className="w-5 h-5" />
                : <Maximize2 className="w-5 h-5" />}
            </button>
          </div>

          {/* ── Center Content ── */}
          <div className="flex-1 flex items-center justify-center px-6 py-4 min-h-0 relative">
            <AnimatePresence mode="wait">
              {showLyrics ? (
                <motion.div
                  key="lyrics"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="w-full h-full max-w-2xl mx-auto overflow-hidden relative flex flex-col"
                >
                  <div className="absolute top-0 inset-x-0 h-12 bg-gradient-to-b from-black/80 to-transparent z-10 pointer-events-none" />
                  <div className="flex-1 overflow-y-auto no-scrollbar pb-[40vh] pt-12 px-4 scroll-smooth" id="lyrics-container">
                    {isLoadingLyrics ? (
                      <div className="flex items-center justify-center h-full">
                        <div className="animate-spin w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full" />
                      </div>
                    ) : parsedLyrics ? (
                      <div className="space-y-6">
                        {parsedLyrics.map((line, i) => {
                          const isCurrent = currentSecs >= line.time && (i === parsedLyrics.length - 1 || currentSecs < parsedLyrics[i+1].time);
                          return (
                            <p 
                              key={i} 
                              className={`text-2xl md:text-4xl font-bold transition-all duration-300 ${isCurrent ? 'text-white scale-105 origin-left drop-shadow-md' : 'text-white/40 blur-[0.5px]'}`}
                              ref={isCurrent ? (el) => {
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              } : null}
                            >
                              {line.text}
                            </p>
                          );
                        })}
                      </div>
                    ) : lyrics?.plain ? (
                      <div className="space-y-4">
                        {lyrics.plain.split('\n').map((line, i) => (
                          <p key={i} className="text-xl md:text-2xl font-bold text-white/80">{line || '\u00A0'}</p>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full flex-col gap-4">
                        <Mic2 className="w-12 h-12 text-white/20" />
                        <p className="text-white/50 text-lg font-medium">No se encontraron letras para esta canción</p>
                      </div>
                    )}
                  </div>
                  <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-black to-transparent z-10 pointer-events-none" />
                </motion.div>
              ) : showQueue ? (
                <motion.div
                  key="queue"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  className="absolute inset-0 flex flex-col backdrop-blur-xl z-20"
                  style={{ background: 'rgba(8,8,18,0.85)' }}
                >
                  <div className="p-5 pb-3 border-b border-white/10 flex items-center justify-between flex-shrink-0">
                    <div>
                      <h3 className="text-lg font-bold text-white">Cola de reproducción</h3>
                      <p className="text-xs text-white/40 mt-0.5">
                        {playlist?.name || 'Cola actual'} · {queueSongs.length - Math.max(0, currentIdx + 1)} pendientes
                      </p>
                    </div>
                    <button onClick={toggleQueue} className="p-2 text-white/50 hover:text-white rounded-full hover:bg-white/10 transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto no-scrollbar p-3">
                    {/* Currently playing */}
                    {song && (
                      <div className="mb-3">
                        <p className="text-[10px] uppercase tracking-wider text-violet-400/70 font-semibold px-2 mb-2">Reproduciendo</p>
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-500/15 border border-violet-500/20">
                          <div className="relative w-11 h-11 rounded-lg overflow-hidden flex-shrink-0">
                            <TrackCover src={song.imageUrl || song.image_url || ''} videoId={song.youtube_id || null} title={song.title} className="w-full h-full object-cover" />
                            {isPlaying && (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                <div className="flex items-end justify-center gap-[2px] h-4">
                                  <div className="eq-bar h-2" />
                                  <div className="eq-bar h-4" />
                                  <div className="eq-bar h-3" />
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate text-violet-300">{song.title}</p>
                            <p className="text-xs text-white/50 truncate">{song.artist || song.artist_name}</p>
                          </div>
                          <TrackFeedbackMenu
                            track={song}
                            className="rounded-full bg-white/5 hover:bg-white/10 text-white p-1.5"
                          />
                        </div>
                      </div>
                    )}

                    {/* Up Next */}
                    {queueSongs.some((_, i) => i > currentIdx) && (
                      <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold px-2 mb-2">Siguiente en la cola</p>
                    )}
                    <DragDropContext onDragEnd={handleDragEnd}>
                      <Droppable droppableId="queue-list">
                        {(provided) => (
                          <div 
                            {...provided.droppableProps} 
                            ref={provided.innerRef}
                            className="space-y-1"
                          >
                            {queueSongs.map((s, i) => {
                              const isCurrent = s.id === song?.id;
                              const isPlayed = i < currentIdx;
                              const isFuture = i > currentIdx;
                              if (isCurrent || isPlayed) return null;

                              return (
                                <Draggable key={`${s.id}-${i}`} draggableId={`${s.id}-${i}`} index={i}>
                                  {(provided, snapshot) => (
                                    <motion.div 
                                      ref={provided.innerRef}
                                      {...provided.draggableProps}
                                      animate={removingIdx === i ? { opacity: 0, x: 40, height: 0 } : { opacity: 1, x: 0 }}
                                      transition={{ duration: 0.2 }}
                                      onMouseEnter={() => setHoveredQueueIdx(i)}
                                      onMouseLeave={() => setHoveredQueueIdx(null)}
                                      className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors group ${snapshot.isDragging ? 'bg-zinc-800 shadow-xl scale-[1.02]' : 'hover:bg-white/5'}`}
                                      style={{ ...provided.draggableProps.style }}
                                    >
                                      <div {...provided.dragHandleProps} className="text-white/20 hover:text-white/50 flex-shrink-0 cursor-grab active:cursor-grabbing">
                                        <GripVertical className="w-4 h-4" />
                                      </div>
                                      <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0">
                                        <TrackCover src={s.imageUrl || s.image_url || ''} videoId={s.youtube_id || null} title={s.title} className="w-full h-full object-cover" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate text-white">{s.title}</p>
                                        <p className="text-xs text-white/40 truncate">{s.artist || s.artist_name}</p>
                                      </div>
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                          <TrackFeedbackMenu
                                            track={s}
                                            className="rounded-full bg-white/5 hover:bg-white/10 text-white p-1.5"
                                          />
                                        </div>
                                        {/* Play next button */}
                                        {i !== currentIdx + 1 && (
                                          <button
                                            onClick={() => onPlayNext(i)}
                                            title="Reproducir a continuación"
                                            className="opacity-0 group-hover:opacity-100 p-1.5 text-white/40 hover:text-violet-400 rounded-lg hover:bg-violet-500/10 transition-all"
                                          >
                                            <ChevronRight className="w-4 h-4" />
                                          </button>
                                        )}
                                        {/* Remove button */}
                                        <button
                                          onClick={() => handleRemove(i)}
                                          title="Quitar de la cola"
                                          className="opacity-0 group-hover:opacity-100 p-1.5 text-white/40 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-all"
                                        >
                                          <X className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </motion.div>
                                  )}
                                </Draggable>
                              );
                            })}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </DragDropContext>

                    {queueSongs.filter((_, i) => i > currentIdx).length === 0 && (
                      <div className="flex flex-col items-center gap-3 py-12 text-center">
                        <ListMusic className="w-10 h-10 text-white/20" />
                        <p className="text-white/40 text-sm">No hay más canciones en la cola</p>
                        {isRadio && (
                          <p className="text-white/25 text-xs">La radio agregará canciones automáticamente</p>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="album-art"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: isPlaying ? 1 : 0.92, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  transition={{ type: 'spring', damping: 18, stiffness: 160 }}
                  className="flex flex-col items-center gap-6 w-full"
                >
                  {/* Album art with floating shadow */}
                  <motion.div
                    animate={isPlaying ? {
                      y: [0, -6, 0],
                    } : { y: 0 }}
                    transition={isPlaying ? {
                      repeat: Infinity,
                      duration: 3.5,
                      ease: 'easeInOut',
                    } : {}}
                    className="w-full max-w-[300px] md:max-w-[380px] aspect-square rounded-3xl overflow-hidden relative"
                    style={{
                      boxShadow: isPlaying
                        ? '0 40px 100px rgba(0,0,0,0.7), 0 0 60px rgba(139,92,246,0.15)'
                        : '0 20px 60px rgba(0,0,0,0.5)',
                    }}
                  >
                    <img src={img} alt={song.title} className="w-full h-full object-cover" />
                  </motion.div>

                  {/* Audio visualizer bars */}
                  {isPlaying && (
                    <div className="flex items-end justify-center gap-[3px] h-5">
                      {[...Array(18)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-[3px] h-5 rounded-full bg-gradient-to-t from-violet-500 to-fuchsia-400"
                          style={{ transformOrigin: 'bottom' }}
                          animate={{
                            scaleY: [0.25, 0.85 - (i % 6) * 0.06, 0.25],
                            opacity: [0.65, 1, 0.65],
                          }}
                          transition={{
                            duration: 0.55 + (i % 7) * 0.08,
                            repeat: Infinity,
                            repeatType: 'mirror',
                            delay: i * 0.05,
                            ease: 'easeInOut',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Bottom panel ── */}
          <div className="flex-shrink-0 px-8 md:px-12 pb-8 md:pb-10"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 32px)' }}>
            
            {/* Song info + Like */}
            <div className="flex items-center justify-between mb-5">
              <div className="min-w-0 flex-1 mr-4">
                <motion.p
                  key={song.id + 't'}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-white font-bold text-xl md:text-2xl truncate"
                >
                  {song.title}
                </motion.p>
                <div className="flex items-center gap-2 mt-1">
                  <motion.p
                    key={song.id + 'a'}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="text-white/50 text-sm md:text-base truncate"
                  >
                    {song.artist ?? song.artist_name ?? ''}
                  </motion.p>
                </div>
                {/* Next up indicator */}
                {nextSong && !showQueue && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[11px] text-white/25 mt-1 truncate"
                  >
                    Siguiente: {nextSong.title}
                  </motion.p>
                )}
                {playbackError && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[11px] text-white/30 mt-1 truncate"
                  >
                    {playbackError}
                  </motion.p>
                )}
              </div>
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={() => { if (currentTrack) toggleLike(currentTrack); }}
                className={`p-2 rounded-full transition-all ${
                  isLiked ? 'text-fuchsia-500' : 'text-white/40 hover:text-white'
                }`}
              >
                <Heart className="w-6 h-6" fill={isLiked ? 'currentColor' : 'none'} />
              </motion.button>
            </div>

            {/* Progress bar */}
            <div className="mb-1.5">
              <Slider
                value={[progress]}
                onValueChange={([v]) => onProgressChange(v)}
                max={100}
                step={0.1}
                className="w-full"
                isPlaying={isPlaying}
              />
            </div>
            <div className="flex justify-between text-[11px] text-white/30 mb-7 tabular-nums font-medium">
              <span>{elapsed}</span>
              <span>{total}</span>
            </div>

            {/* Main controls */}
            <div className="flex items-center justify-between mb-7 max-w-sm mx-auto">
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={onToggleShuffle}
                className={`p-2 transition-colors ${
                  isShuffle ? 'text-violet-400' : 'text-white/40 hover:text-white'
                }`}
              >
                <Shuffle className="w-5 h-5" />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={onPrev}
                className="p-2 text-white/80 hover:text-white transition-colors"
              >
                <SkipBack className="w-8 h-8" fill="currentColor" />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={onTogglePlay}
                className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-[0_8px_30px_rgba(139,92,246,0.25)] hover:scale-105 transition-transform"
              >
                {isPlaying
                  ? <Pause className="w-7 h-7 text-black" fill="currentColor" />
                  : <Play  className="w-7 h-7 text-black ml-1" fill="currentColor" />
                }
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={onNext}
                className="p-2 text-white/80 hover:text-white transition-colors"
              >
                <SkipForward className="w-8 h-8" fill="currentColor" />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={onCycleRepeat}
                className={`p-2 relative transition-colors ${
                  repeatMode !== 'off' ? 'text-violet-400' : 'text-white/40 hover:text-white'
                }`}
              >
                <Repeat className="w-5 h-5" />
                {repeatMode === 'one' && (
                  <span className="absolute -top-0.5 -right-0.5 text-[8px] bg-violet-500 text-black rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
                    1
                  </span>
                )}
              </motion.button>
            </div>

            {/* Volume – visible on desktop */}
            <div className="hidden md:flex items-center gap-3 max-w-xs mx-auto mb-4">
              <button onClick={toggleMute} className="text-white/40 hover:text-white transition-colors">
                {volumeProp === 0
                  ? <VolumeX className="w-4 h-4" />
                  : <Volume2 className="w-4 h-4" />
                }
              </button>
              <Slider
                value={[volumeProp]}
                onValueChange={([v]) => onVolumeChange(v)}
                max={100}
                step={1}
                className="flex-1"
                isPlaying={isPlaying}
              />
            </div>

            {/* Bottom actions */}
            <div className="flex items-center justify-center gap-8 mt-4">
              <button
                onClick={openSleepTimer}
                className={`relative p-2 transition-colors rounded-full ${
                  sleepTimerRemainingSec && sleepTimerRemainingSec > 0
                    ? 'bg-fuchsia-500/15 text-fuchsia-300'
                    : 'text-white/30 hover:text-white/60'
                }`}
                title={sleepTimerRemainingSec && sleepTimerRemainingSec > 0 ? 'Temporizador activo' : 'Temporizador'}
              >
                <Clock className="w-5 h-5" />
                {timerLabel && (
                  <span className="absolute -top-1 -right-1 text-[9px] px-1.5 py-0.5 rounded-full bg-fuchsia-500 text-black font-bold tabular-nums">
                    {timerLabel}
                  </span>
                )}
              </button>
              <button 
                onClick={toggleLyrics}
                className={`p-2 transition-colors rounded-full ${showLyrics ? 'bg-violet-500/20 text-violet-400' : 'text-white/30 hover:text-white/60'}`}
                title="Letras"
              >
                <Mic2 className="w-5 h-5" />
              </button>
              <button
                onClick={toggleAmbientMode}
                className="p-2 transition-colors rounded-full text-white/30 hover:text-fuchsia-400 hover:bg-fuchsia-500/10"
                title="Modo ambiente"
              >
                <Sparkles className="w-5 h-5" />
              </button>
              {onAddToPlaylist && (
                <button
                  onClick={onAddToPlaylist}
                  className="p-2 transition-colors rounded-full text-white/30 hover:text-violet-400 hover:bg-violet-500/10"
                  title="Agregar a playlist"
                >
                  <ListPlus className="w-5 h-5" />
                </button>
              )}
              {onCreateRadio && (
                <button 
                  onClick={onCreateRadio}
                  className="p-2 transition-colors rounded-full text-white/30 hover:text-white/60"
                  title="Crear radio de esta canción"
                >
                  <Radio className="w-5 h-5" />
                </button>
              )}
              <button 
                onClick={toggleQueue}
                className={`p-2 transition-colors rounded-full ${showQueue ? 'bg-violet-500/20 text-violet-400' : 'text-white/30 hover:text-white/60'}`}
                title="Cola de reproducción"
              >
                <ListMusic className="w-5 h-5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    <AnimatePresence>
      {sleepTimerSheetOpen && (
        <motion.div
          className="fixed inset-0 z-[200]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            className="absolute inset-0 bg-black/60"
            onClick={closeSleepTimer}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="absolute left-0 right-0 mx-auto w-[min(28rem,calc(100%-24px))] rounded-3xl border border-white/10 bg-zinc-950/95 backdrop-blur-xl px-4 sm:px-5 pt-4 pb-6 shadow-[0_-25px_80px_rgba(0,0,0,0.65)] overflow-y-auto"
            style={{ bottom: 'max(env(safe-area-inset-bottom, 0px), 12px)', maxHeight: 'min(78dvh, 560px)' }}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 260 }}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1.5 rounded-full bg-white/10" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-2xl bg-fuchsia-500/10 text-fuchsia-300 flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-white font-semibold leading-tight">Temporizador</p>
                  <p className="text-white/40 text-xs leading-tight">La música se pausará cuando termine</p>
                </div>
              </div>
              <button
                onClick={closeSleepTimer}
                className="p-2 rounded-full text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                title="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {sleepTimerRemainingSec && sleepTimerRemainingSec > 0 && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white/80 text-sm font-medium">Activo</p>
                  <p className="text-white/40 text-xs tabular-nums">{timerLabel}</p>
                </div>
                <button
                  onClick={() => { setTimer(null); closeSleepTimer(); }}
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-white/10 text-white/70 hover:bg-white/15 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
              </div>
            )}

            <div className="mt-4">
              <p className="text-[11px] uppercase tracking-widest text-white/30 font-semibold mb-2">Rápido</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[15, 30, 45, 60].map((m) => (
                  <button
                    key={m}
                    onClick={() => applySleepTimer(m)}
                    className="py-3 sm:py-2 rounded-2xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors text-sm font-semibold"
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[11px] uppercase tracking-widest text-white/30 font-semibold mb-2">Personalizado</p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={sleepTimerMinutesDraft}
                  onChange={(e) => setSleepTimerMinutesDraft(e.target.value)}
                  inputMode="numeric"
                  className="flex-1 h-12 sm:h-11 rounded-2xl bg-white/5 border border-white/10 px-4 text-white placeholder:text-white/20 outline-none focus:border-fuchsia-500/40 focus:ring-4 focus:ring-fuchsia-500/10"
                  placeholder="Minutos"
                />
                <button
                  onClick={() => {
                    const minutes = Number.parseInt(sleepTimerMinutesDraft || '', 10);
                    if (Number.isFinite(minutes) && minutes > 0) applySleepTimer(minutes);
                  }}
                  className="h-12 sm:h-11 w-full sm:w-auto px-4 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold shadow-[0_10px_30px_rgba(236,72,153,0.18)] hover:opacity-95 transition-opacity"
                >
                  Activar
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
