import re

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Fix exports in PlaybackContext
    old_value = """  const value = useMemo<PlaybackContextValue>(
    () => ({
      currentTrack: currentSong ? trackFromSong(currentSong) : null,
      queue: currentPlaylist?.songs?.map(trackFromSong) || [],
      isPlaying,
      volume,
      progress,
      duration,
      repeatMode,
      shuffle,
      favorites,
      playbackError,
      isResolvingAudio,
      resolvingTrackKey,
      playSong,
      playTrack,
      pause,
      resume,
      next,
      previous,
      seek,
      toggleFavorite,
      toggleFavoriteSong,
      addToQueue,
      removeFromQueue,
      clearQueue,
      setSleepTimer,
      setVolume,
      togglePlay,
      toggleShuffle,
      cycleRepeat,
      reorderQueue,
      playNextFromQueueIndex,
      reset,
      sleepTimerRemainingSec,
      currentSong,
      currentPlaylist,
    }),
    [
      currentSong,
      currentPlaylist,
      isPlaying,
      volume,
      progress,
      duration,
      repeatMode,
      shuffle,
      favorites,
      playbackError,
      preparingTrackKey, playingTrackKey, playbackErrorTrackKey, playSong, playTrack, pause,
      resume,
      next,
      previous,
      seek,
      toggleFavorite,
      toggleFavoriteSong,
      addToQueue,
      removeFromQueue,
      clearQueue,
      setSleepTimer,
      setVolume,
      togglePlay,
      toggleShuffle,
      cycleRepeat,
      reorderQueue,
      playNextFromQueueIndex,
      reset,
      sleepTimerRemainingSec,
    ]
  );"""

    new_value = """  const value = useMemo<PlaybackContextValue>(
    () => ({
      currentTrack: currentSong ? trackFromSong(currentSong) : null,
      queue: currentPlaylist?.songs?.map(trackFromSong) || [],
      isPlaying,
      volume,
      progress,
      duration,
      repeatMode,
      shuffle,
      favorites,
      playbackError,
      preparingTrackKey,
      playingTrackKey,
      playbackErrorTrackKey,
      playSong,
      playTrack,
      pause,
      resume,
      next,
      previous,
      seek,
      toggleFavorite,
      toggleFavoriteSong,
      addToQueue,
      removeFromQueue,
      clearQueue,
      setSleepTimer,
      setVolume,
      togglePlay,
      toggleShuffle,
      cycleRepeat,
      reorderQueue,
      playNextFromQueueIndex,
      reset,
      sleepTimerRemainingSec,
      currentSong,
      currentPlaylist,
    }),
    [
      currentSong,
      currentPlaylist,
      isPlaying,
      volume,
      progress,
      duration,
      repeatMode,
      shuffle,
      favorites,
      playbackError,
      preparingTrackKey,
      playingTrackKey,
      playbackErrorTrackKey,
      playSong,
      playTrack,
      pause,
      resume,
      next,
      previous,
      seek,
      toggleFavorite,
      toggleFavoriteSong,
      addToQueue,
      removeFromQueue,
      clearQueue,
      setSleepTimer,
      setVolume,
      togglePlay,
      toggleShuffle,
      cycleRepeat,
      reorderQueue,
      playNextFromQueueIndex,
      reset,
      sleepTimerRemainingSec,
    ]
  );"""
    
    if "isResolvingAudio," in content:
        content = content.replace("isResolvingAudio,", "preparingTrackKey,\n      playingTrackKey,\n      playbackErrorTrackKey,")
        content = content.replace("resolvingTrackKey,", "")

    # Also there was "setQueue" missing, replaced with "setCurrentPlaylist"
    if "setQueue([]);" in content:
        content = content.replace("setQueue([]);", "setCurrentPlaylist(null);")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
