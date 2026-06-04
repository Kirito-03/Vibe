import os

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Add getTrackKey at the top
    getTrackKey_func = """
export const getTrackKey = (track: any): string => {
  if (!track) return '';
  if (track.youtube_id) return `yt:${track.youtube_id}`;
  if (track.sourceId) return `src:${track.sourceId}`;
  if (track.url && !track.url.includes('stream-direct')) return `url:${track.url}`;
  if (track.audioUrl && !track.audioUrl.includes('stream-direct')) return `audio:${track.audioUrl}`;
  const cleanTitle = (track.title || '').toLowerCase().replace(/official|audio|video|lyric|lyrics|\\(.*?\\)|\\[.*?\\]/g, '').trim();
  const cleanArtist = (track.artist || track.artist_name || '').toLowerCase().trim();
  return `txt:${cleanTitle}|${cleanArtist}|${track.duration_seconds || 0}`;
};
"""
    if "export const getTrackKey" not in content:
        import_end = content.find("import { createContext")
        content = content[:import_end] + getTrackKey_func + content[import_end:]

    # 2. Update playSongInternal signature and toggle check
    old_playSongInternal_sig = "const playSongInternal = useCallback(async (song: Song, playlist?: Playlist, isCrossfade = false, opts?: { userInitiated?: boolean }) => {"
    new_playSongInternal_sig = "const playSongInternal = useCallback(async (song: Song, playlist?: Playlist, isCrossfade = false, opts?: { userInitiated?: boolean, forcePlay?: boolean, fromQueueNavigation?: boolean }) => {"
    content = content.replace(old_playSongInternal_sig, new_playSongInternal_sig)

    old_toggle_check = "if (currentSong?.id === song.id && !isCrossfade) {"
    new_toggle_check = """if (import.meta.env.DEV && opts?.forcePlay) console.log('[playback/playSong] forcePlay=true fromQueueNavigation=' + Boolean(opts?.fromQueueNavigation));
    if (currentSong && getTrackKey(currentSong) === getTrackKey(song) && !isCrossfade && !opts?.forcePlay) {"""
    content = content.replace(old_toggle_check, new_toggle_check)

    # 3. Source mismatch validation in prepareAudioAsync
    old_status_check = "if (dlData?.status === 'ready' && dlData?.audioUrl) {"
    new_status_check = """
        if (song.youtube_id && dlData?.youtubeId && dlData.youtubeId !== song.youtube_id) {
           console.warn(`[playback/validate] source-mismatch old=${song.youtube_id} actual=${dlData.youtubeId}`);
           throw { status: 400, code: 'MISSING_TRACK_SOURCE', message: 'Source mismatch' };
        }
        if (dlData?.status === 'ready' && dlData?.audioUrl) {"""
    content = content.replace(old_status_check, new_status_check)

    # 4. playSong export update
    old_playSong = """  const playSong = useCallback((song: Song, playlist?: Playlist, isCrossfade = false) => {
    playSongInternal(song, playlist, isCrossfade, { userInitiated: true });
  }, [playSongInternal]);"""
    new_playSong = """  const playSong = useCallback((song: Song, playlist?: Playlist, isCrossfade = false, opts?: any) => {
    playSongInternal(song, playlist, isCrossfade, { userInitiated: true, ...opts });
  }, [playSongInternal]);"""
    content = content.replace(old_playSong, new_playSong)

    # 5. skipToNext (next) update
    old_next_start = """  const next = useCallback((e?: any) => {
    const isManualSkip = !(e?.detail?.isCrossfade);
    const isCrossfade = e?.detail?.isCrossfade === true;"""
    
    old_next_logic = """    const list = currentPlaylist?.songs;
    if (!list || !currentSong) return;
    const isRadio = String(currentPlaylist?.id || '').startsWith('radio-');
    let nextSong: Song;
    if (shuffle && !isRadio) {
      const remaining = list.filter((s) => s.id !== currentSong.id);
      nextSong = remaining.length > 0 ? remaining[Math.floor(Math.random() * remaining.length)] : currentSong;
    } else {
      const idx = list.findIndex((s) => s.id === currentSong.id);
      nextSong = list[(idx + 1) % list.length];
    }
    playSong(nextSong, currentPlaylist);"""
    
    new_next_logic = """    const list = currentPlaylist?.songs;
    if (!list || !currentSong) return;
    const isRadio = String(currentPlaylist?.id || '').startsWith('radio-');
    let nextSong: Song | null = null;
    let nextIdx = -1;
    const currentKey = getTrackKey(currentSong);
    
    if (shuffle && !isRadio) {
      const remaining = list.filter((s) => getTrackKey(s) !== currentKey);
      if (remaining.length > 0) nextSong = remaining[Math.floor(Math.random() * remaining.length)];
    } else {
      const isAutoEnded = e?.detail?.auto === true || e?.detail?.isManualSkip === false;
      const repeatMode = playerStateRef.current.repeatMode;
      
      let idx = list.findIndex((s) => s.id === currentSong.id);
      if (idx === -1) idx = 0;
      
      if (isAutoEnded && repeatMode === 'one') {
         nextSong = currentSong;
      } else {
         for (let i = 1; i <= list.length; i++) {
            const candidateIdx = (idx + i) % list.length;
            const candidate = list[candidateIdx];
            if (getTrackKey(candidate) !== currentKey) {
               if (isAutoEnded && repeatMode === 'none' && candidateIdx <= idx) {
                  // We wrapped around and repeat is none. Stop playback.
                  break;
               }
               nextSong = candidate;
               nextIdx = candidateIdx;
               break;
            }
         }
      }
      if (nextSong) {
         console.log(`[playback/next] currentIndex=${idx} nextIndex=${nextIdx} currentKey=${currentKey} nextKey=${getTrackKey(nextSong)}`);
      }
    }
    
    if (nextSong) {
       playSong(nextSong, currentPlaylist, isCrossfade, { forcePlay: true, fromQueueNavigation: true });
    } else {
       console.log(`[playback/ended] repeatMode=${playerStateRef.current.repeatMode} hasNext=false`);
       setIsPlaying(false);
    }"""
    content = content.replace(old_next_logic, new_next_logic)

    # 6. skipToPrevious (previous) update
    old_previous_logic = """    let prevSong: Song;
    if (shuffle) {
      const remaining = list.filter((s) => s.id !== currentSong.id);
      prevSong = remaining.length > 0 ? remaining[Math.floor(Math.random() * remaining.length)] : currentSong;
    } else {
      const idx = list.findIndex((s) => s.id === currentSong.id);
      const prevIdx = (idx - 1 + list.length) % list.length;
      prevSong = list[prevIdx];
    }
    playSong(prevSong, currentPlaylist);"""
    
    new_previous_logic = """    let prevSong: Song | null = null;
    let prevIdx = -1;
    const currentKey = getTrackKey(currentSong);
    
    if (shuffle) {
      const remaining = list.filter((s) => getTrackKey(s) !== currentKey);
      if (remaining.length > 0) prevSong = remaining[Math.floor(Math.random() * remaining.length)];
    } else {
      let idx = list.findIndex((s) => s.id === currentSong.id);
      if (idx === -1) idx = 0;
      for (let i = 1; i <= list.length; i++) {
         const candidateIdx = (idx - i + list.length) % list.length;
         const candidate = list[candidateIdx];
         if (getTrackKey(candidate) !== currentKey) {
            prevSong = candidate;
            prevIdx = candidateIdx;
            break;
         }
      }
      if (prevSong) {
         console.log(`[playback/previous] currentIndex=${idx} prevIndex=${prevIdx}`);
      }
    }
    
    if (prevSong) {
       playSong(prevSong, currentPlaylist, false, { forcePlay: true, fromQueueNavigation: true });
    } else {
       audioRef.current.currentTime = 0;
       audioRef.current.play().catch(() => {});
    }"""
    content = content.replace(old_previous_logic, new_previous_logic)

    # 7. onended update
    old_onended = """      const state = playerStateRef.current;

      if (state.repeatMode === 'one' && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => setIsPlaying(false));
        return;
      }

      if (state.currentPlaylist?.songs) {
        const songs = state.currentPlaylist.songs;
        const isRadio = String(state.currentPlaylist.id || '').startsWith('radio-');
        const idx = songs.findIndex((s) => s.id === state.currentSong?.id);
        
        if (state.shuffle && !isRadio) {
          const remaining = songs.filter(s => s.id !== state.currentSong?.id);
          if (remaining.length > 0) playSongInternal(remaining[Math.floor(Math.random() * remaining.length)], state.currentPlaylist, isCrossfade, { userInitiated: false });
          else if (state.repeatMode === 'all') playSongInternal(songs[0], state.currentPlaylist, isCrossfade, { userInitiated: false });
          else setIsPlaying(false);
        } else {
          if (idx !== -1 && idx < songs.length - 1) playSongInternal(songs[idx + 1], state.currentPlaylist, isCrossfade, { userInitiated: false });
          else if (idx !== -1 && state.repeatMode === 'all') playSongInternal(songs[0], state.currentPlaylist, isCrossfade, { userInitiated: false });
          else setIsPlaying(false);
        }
      } else {
        if (state.repeatMode === 'all' && audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => setIsPlaying(false));
        } else {
          setIsPlaying(false);
        }
      }"""
      
    new_onended = """      const state = playerStateRef.current;
      
      console.log(`[playback/ended] repeatMode=${state.repeatMode} hasNext=${!!state.currentPlaylist?.songs?.length}`);
      
      if (state.currentPlaylist?.songs) {
         next({ detail: { auto: true, isManualSkip: false, isCrossfade } });
      } else {
        if (state.repeatMode === 'one' || state.repeatMode === 'all') {
          if (audioRef.current) {
             audioRef.current.currentTime = 0;
             audioRef.current.play().catch(() => setIsPlaying(false));
          }
        } else {
          setIsPlaying(false);
        }
      }"""
    content = content.replace(old_onended, new_onended)

    # 8. dedupe recommendations when adding
    old_reorderQueue = """  const reorderQueue = useCallback((tracks: Track[]) => {
    setPlaybackError(null);
    setCurrentPlaylist((prev) => {
      const base: Playlist = prev || { id: `queue-${Date.now()}`, name: 'Cola', description: '', image_url: '', songs: [] };
      const songs = tracks.map(songFromTrack);
      return { ...base, songs };
    });
  }, []);"""
  
    new_reorderQueue = """  const reorderQueue = useCallback((tracks: Track[]) => {
    setPlaybackError(null);
    setCurrentPlaylist((prev) => {
      const base: Playlist = prev || { id: `queue-${Date.now()}`, name: 'Cola', description: '', image_url: '', songs: [] };
      let songs = tracks.map(songFromTrack);
      console.log(`[queue/dedupe] before=${songs.length}`);
      const uniqueKeys = new Set<string>();
      songs = songs.filter(s => {
         const k = getTrackKey(s);
         if (uniqueKeys.has(k)) return false;
         uniqueKeys.add(k);
         return true;
      });
      console.log(`[queue/dedupe] after=${songs.length}`);
      return { ...base, songs };
    });
  }, []);"""
    content = content.replace(old_reorderQueue, new_reorderQueue)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("PlaybackContext fixed successfully")

if __name__ == "__main__":
    main()
