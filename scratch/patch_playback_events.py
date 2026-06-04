import re

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Add sentEventsRef
    if "const sentEventsRef = useRef<Record<string, Set<string>>>({});" not in content:
        content = content.replace("const autoplayBusyRef = useRef(false);", "const autoplayBusyRef = useRef(false);\n  const sentEventsRef = useRef<Record<string, Set<string>>>({});")

    # Function to emit event
    emit_func = """
  const emitListeningEvent = useCallback((song: Song | Track | null, eventType: string) => {
    if (!song || !user) return;
    const key = (song as any).youtube_id || song.id;
    if (!key) return;

    if (!sentEventsRef.current[key]) sentEventsRef.current[key] = new Set();
    if (sentEventsRef.current[key].has(eventType)) return;
    sentEventsRef.current[key].add(eventType);

    const progress = audioRef.current?.currentTime || 0;
    const duration = audioRef.current?.duration || song.duration_seconds || song.duration || 0;
    const progressPercent = duration > 0 ? Math.round((progress / duration) * 100) : 0;

    apiFetch('/api/music/listening-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        youtubeId: (song as any).youtube_id || (song.source === 'youtube' ? song.id : null),
        title: song.title,
        artist: song.artist || song.artist_name || null,
        duration: duration || null,
        listenedSeconds: Math.round(progress) || null,
        progressPercent: progressPercent || null,
        eventType,
        source: 'home'
      })
    }).catch(() => {});
  }, [user]);
"""
    if "const emitListeningEvent = useCallback" not in content:
        content = content.replace("const playSongInternal = useCallback", emit_func + "\n  const playSongInternal = useCallback")

    # Add play_start inside playSongInternal
    if "emitListeningEvent(song, 'play_start');" not in content:
        # Before setPlaybackErrorTrackKey(null); inside playSongInternal
        content = content.replace("setPlaybackErrorTrackKey(null);", "setPlaybackErrorTrackKey(null);\n    emitListeningEvent(song, 'play_start');")

    # Add progress events inside handleTimeUpdate
    progress_events = """
      if (progress >= 30) emitListeningEvent(currentSong, 'play_30s');
      if (duration > 0 && progress >= duration * 0.6) emitListeningEvent(currentSong, 'play_60_percent');
      if (duration > 0 && progress >= duration - 1) emitListeningEvent(currentSong, 'completed');
"""
    if "emitListeningEvent(currentSong, 'play_30s')" not in content:
        content = content.replace("setProgress(progress);", "setProgress(progress);\n" + progress_events)

    # Add completed inside handleEnded
    if "emitListeningEvent(currentSong, 'completed');" not in content:
        content = content.replace("const handleEnded = () => {", "const handleEnded = () => {\n    if (currentSong) emitListeningEvent(currentSong, 'completed');")

    # Add skipped logic inside playSongInternal (if skipping currentSong)
    # This is tricky, we'll just put it at the beginning of playSongInternal
    skipped_logic = """
    if (state.currentSong && state.currentSong.id !== song.id) {
       const progress = audioRef.current?.currentTime || 0;
       if (progress < 20) emitListeningEvent(state.currentSong, 'skipped');
    }
    if (state.currentSong && state.currentSong.id === song.id) {
       emitListeningEvent(song, 'repeated');
    }
"""
    if "emitListeningEvent(state.currentSong, 'skipped');" not in content:
        content = content.replace("const reqId = crypto.randomUUID();", skipped_logic + "\n    const reqId = crypto.randomUUID();")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
