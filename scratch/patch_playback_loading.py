import re

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Update Context interface
    content = content.replace("  isResolvingAudio: boolean;\n  resolvingTrackKey: string | null;", 
                              "  preparingTrackKey: string | null;\n  playingTrackKey: string | null;\n  playbackErrorTrackKey: string | null;")
    
    # 2. Update states
    old_states = """  const [isResolvingAudio, setIsResolvingAudio] = useState(false);
  const [resolvingTrackKey, setResolvingTrackKey] = useState<string | null>(null);"""
    new_states = """  const [preparingTrackKey, setPreparingTrackKey] = useState<string | null>(null);
  const [playingTrackKey, setPlayingTrackKey] = useState<string | null>(null);
  const [playbackErrorTrackKey, setPlaybackErrorTrackKey] = useState<string | null>(null);
  
  const currentPrepareRequestRef = useRef<string | null>(null);"""
    
    if old_states in content:
        content = content.replace(old_states, new_states)
    
    # 3. Update playSongInternal early checks
    old_early_checks = """  const playSongInternal = useCallback(async (song: Song, playlist?: Playlist, isCrossfade = false, opts?: { userInitiated?: boolean, forcePlay?: boolean, fromQueueNavigation?: boolean }) => {
    setPlaybackError(null);
    lastUserInitiatedRef.current = Boolean(opts?.userInitiated);
    if (!song?.file_url) {
      setPlaybackError('No hay audio disponible para reproducir esta canción.');
      return;
    }

    const songKey = String(song.youtube_id || song.id);

    // Prevent double-clicks triggering multiple requests for the same track
    if (opts?.userInitiated && isResolvingAudio && resolvingTrackKey === songKey) {
      return;
    }

    if (opts?.userInitiated) {
      setIsResolvingAudio(true);
      setResolvingTrackKey(songKey);
      // Timeout fallback to clear the resolving state
      setTimeout(() => {
        setIsResolvingAudio(false);
        setResolvingTrackKey(null);
      }, 10000);
    }"""

    new_early_checks = """  const playSongInternal = useCallback(async (song: Song, playlist?: Playlist, isCrossfade = false, opts?: { userInitiated?: boolean, forcePlay?: boolean, fromQueueNavigation?: boolean }) => {
    setPlaybackError(null);
    setPlaybackErrorTrackKey(null);
    lastUserInitiatedRef.current = Boolean(opts?.userInitiated);
    
    const songKey = String(song.youtube_id || song.id);

    if (!song?.file_url) {
      setPlaybackError('No hay audio disponible para reproducir esta canción.');
      setPlaybackErrorTrackKey(songKey);
      return;
    }

    // Generate Request ID for cancellation
    const requestId = crypto.randomUUID();
    currentPrepareRequestRef.current = requestId;

    if (opts?.userInitiated) {
      setPreparingTrackKey(songKey);
    }"""
    
    if old_early_checks in content:
        content = content.replace(old_early_checks, new_early_checks)
    else:
        print("old_early_checks not found")

    # 4. In playSongInternal, clear preparing/error properly on playback errors inside prepare
    # Search for setIsResolvingAudio calls and replace them or ignore them since the signature changes
    # Wait, the easiest way is to use regex or replace specific blocks.
    
    # For prepare errors:
    content = content.replace("setIsResolvingAudio(true);", "")
    content = content.replace("setPlaybackError(null);", "setPlaybackError(null);\n      setPlaybackErrorTrackKey(null);")
    content = content.replace("setIsResolvingAudio(false);", "")
    content = content.replace("setResolvingTrackKey(null);", "")
    
    # "setPlaybackError('No pudimos preparar esta canción. Intenta con otra.');" -> add track key
    content = content.replace(
        "setPlaybackError('No pudimos preparar esta canción. Intenta con otra.');",
        "setPlaybackError('No pudimos preparar esta canción. Intenta con otra.');\n          setPlaybackErrorTrackKey(songKey);"
    )
    content = content.replace(
        "setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');",
        "setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');\n            setPlaybackErrorTrackKey(songKey);"
    )
    content = content.replace(
        "setPlaybackError('Esta canción está corrupta. Búscala nuevamente.');",
        "setPlaybackError('Esta canción está corrupta. Búscala nuevamente.');\n            setPlaybackErrorTrackKey(songKey);"
    )

    # 5. Fix doPlay and onDownloadReady
    old_onDownloadReady = """    const onDownloadReady = (e: Event) => {
      const ev = e as CustomEvent;
      if (!isMyGen()) return;
      const eventYtId = String((ev as any).detail?.youtubeId || '');
      const songYtId = String(song.youtube_id || song.id || '');
      if (!eventYtId || !songYtId || eventYtId !== songYtId) return;
      const localUrl: string = (ev as any).detail?.streamUrl;
      
      setIsResolvingAudio(false);
      setResolvingTrackKey(null);

      if (!localUrl || audio.src?.includes('/stream/')) return;
      const wasPlaying = !audio.paused;
      const currentTime = audio.currentTime;
      audio.src = localUrl;
      audio.load();
      if (currentTime > 0) audio.currentTime = currentTime;
      if (wasPlaying || !playStarted) {
        audio.play().then(() => { if (isMyGen()) { playStarted = true; setIsPlaying(true); } }).catch(() => {});
      }
    };"""

    new_onDownloadReady = """    const onDownloadReady = (e: Event) => {
      const ev = e as CustomEvent;
      if (!isMyGen() || currentPrepareRequestRef.current !== requestId) return;
      const eventYtId = String((ev as any).detail?.youtubeId || '');
      const songYtId = String(song.youtube_id || song.id || '');
      if (!eventYtId || !songYtId || eventYtId !== songYtId) return;
      const localUrl: string = (ev as any).detail?.streamUrl;

      if (!localUrl || audio.src?.includes('/stream/')) return;
      const wasPlaying = !audio.paused;
      const currentTime = audio.currentTime;
      audio.src = localUrl;
      audio.load();
      if (currentTime > 0) audio.currentTime = currentTime;
      if (wasPlaying || !playStarted) {
        audio.play().then(() => { 
          if (isMyGen() && currentPrepareRequestRef.current === requestId) { 
            playStarted = true; 
            setIsPlaying(true); 
            setPlayingTrackKey(songKey);
            setPreparingTrackKey(null);
          } 
        }).catch(() => {});
      }
    };"""
    if old_onDownloadReady in content:
        content = content.replace(old_onDownloadReady, new_onDownloadReady)

    old_doPlay = """    const doPlay = () => {
      if (playStarted || !isMyGen()) return;
      if (import.meta.env.DEV) console.debug('[playback/audio.play] start');
      audio
        .play()
        .then(() => {
          if (import.meta.env.DEV) console.debug('[playback/audio.play] ok');
          if (isMyGen()) {
            playStarted = true;
            setIsPlaying(true);
          }
        })
        .catch((error) => {
          if (import.meta.env.DEV) console.debug('[playback/audio.play] error', error);
          if (isMyGen()) {
            setIsPlaying(false);
            setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');
            setPlaybackErrorTrackKey(songKey);
          }
        });
    };

    audio.addEventListener('canplay', () => {
      
      
      if (!playStarted && isMyGen()) doPlay();
    }, { once: true });"""

    new_doPlay = """    const doPlay = () => {
      if (playStarted || !isMyGen() || currentPrepareRequestRef.current !== requestId) return;
      if (import.meta.env.DEV) console.debug('[playback/audio.play] start');
      audio
        .play()
        .then(() => {
          if (import.meta.env.DEV) console.debug('[playback/audio.play] ok');
          if (isMyGen() && currentPrepareRequestRef.current === requestId) {
            playStarted = true;
            setIsPlaying(true);
            setPlayingTrackKey(songKey);
            setPreparingTrackKey(null);
          }
        })
        .catch((error) => {
          if (import.meta.env.DEV) console.debug('[playback/audio.play] error', error);
          if (isMyGen() && currentPrepareRequestRef.current === requestId) {
            setIsPlaying(false);
            setPreparingTrackKey(null);
            setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');
            setPlaybackErrorTrackKey(songKey);
          }
        });
    };

    audio.addEventListener('canplay', () => {
      if (!playStarted && isMyGen()) doPlay();
    }, { once: true });"""
    
    if old_doPlay in content:
        content = content.replace(old_doPlay, new_doPlay)

    # Make sure we replace exports
    old_exports = """    shuffle, favorites, playbackError, isResolvingAudio, resolvingTrackKey, playSong, playTrack, pause,"""
    new_exports = """    shuffle, favorites, playbackError, preparingTrackKey, playingTrackKey, playbackErrorTrackKey, playSong, playTrack, pause,"""
    if old_exports in content:
        content = content.replace(old_exports, new_exports)
    else:
        content = content.replace("isResolvingAudio, resolvingTrackKey", "preparingTrackKey, playingTrackKey, playbackErrorTrackKey")

    # Inside prepare block, make sure we check requestId
    content = content.replace("if (!isMyGen()) return;", "if (!isMyGen() || currentPrepareRequestRef.current !== requestId) return;")

    # Finally, remove preparingTrackKey on errors thrown in prepare
    # Because we removed setIsResolvingAudio(false), we need to add setPreparingTrackKey(null) around the error handling.
    content = re.sub(
        r"(setPlaybackErrorTrackKey\(songKey\);\s*\n\s*)return;",
        r"\1setPreparingTrackKey(null);\n            return;",
        content
    )
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
