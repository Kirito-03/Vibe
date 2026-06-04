import re

def main():
    path_music = "backend/src/routes/music.ts"
    with open(path_music, "r", encoding="utf-8") as f:
        content_music = f.read()

    # We want to inject fallback fetch if finalHealed is empty right before rankRecommendationResults or just before building response
    injection = """
    if (finalHealed.length === 0) {
      console.log('[home] empty-profile using fallback fetch');
      const fallbackQueries = [
        "latin pop official audio",
        "new music official audio",
        "reggaeton hits official audio",
        "anime music official audio",
        "pop music official audio"
      ];
      const randomQuery = fallbackQueries[Math.floor(Math.random() * fallbackQueries.length)];
      try {
        const fallbackRes = await searchDuckDuckGoForYoutube(randomQuery, 25);
        finalHealed = adaptYouTubeRows(fallbackRes, new Set(), new Set());
        if (finalHealed.length > 0) finalSource = 'fallback' as any;
      } catch (err) {
        console.warn('[home] fallback search failed', err);
      }
    }
"""
    
    # In for-you route:
    target_foryou = "finalHealed = rankRecommendationResults({ seed: rawSeed || usedQuery, items: finalHealed, profile });"
    if target_foryou in content_music:
        content_music = content_music.replace(target_foryou, injection + "\n    " + target_foryou)
    else:
        print("COULD NOT FIND target_foryou")

    # In recommendationsHandler:
    target_rec = "finalHealed = rankRecommendationResults({ seed: rawSeed, items: finalHealed, profile });"
    if target_rec in content_music:
        content_music = content_music.replace(target_rec, injection + "\n    " + target_rec)
    else:
        print("COULD NOT FIND target_rec")

    with open(path_music, "w", encoding="utf-8") as f:
        f.write(content_music)

    # Now for PlaybackContext.tsx
    path_playback = "src/app/context/PlaybackContext.tsx"
    with open(path_playback, "r", encoding="utf-8") as f:
        content_playback = f.read()

    # 1. togglePlay enhancement to force playSongInternal if no audio yet
    old_togglePlay = """  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;"""
    
    new_togglePlay = """  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      if (currentSong) {
        console.log('[playback] togglePlay missing audio, prepare via internal');
        playSongInternal(currentSong, currentPlaylist ?? undefined, false, { forcePlay: true });
      }
      return;
    }"""
    
    content_playback = content_playback.replace(old_togglePlay, new_togglePlay)

    # 2. Rehydration erase file_url if not stream-direct
    old_init = """const [currentSong, setCurrentSong] = useState<Song | null>(() => (persisted?.currentTrack ? songFromTrack(persisted.currentTrack) : null));"""
    
    new_init = """const [currentSong, setCurrentSong] = useState<Song | null>(() => {
    if (persisted?.currentTrack) {
       const s = songFromTrack(persisted.currentTrack);
       if (s.file_url && !s.file_url.includes('stream-direct')) {
           s.file_url = '';
       }
       return s;
    }
    return null;
  });"""
    
    content_playback = content_playback.replace(old_init, new_init)
    
    # 3. Add prepareAudioAsync and useEffect for background rehydration
    # Let's add it right before useMediaSession(currentSong, togglePlay...)
    hook_inject = """
  // Auto-rehydrate audioURL in background
  useEffect(() => {
    let active = true;
    const rehydrate = async () => {
      const savedPlayback = localStorage.getItem(STORAGE_KEY);
      if (!savedPlayback) return;
      let parsed = null;
      try { parsed = JSON.parse(savedPlayback); } catch {}
      if (!parsed?.currentTrack) return;
      
      // If we already have audio or user started playing, skip
      if (audioRef.current) return;
      
      console.log('[playback/rehydrate] start');
      const track = parsed.currentTrack;
      const ytId = track.youtube_id || track.sourceId;
      const url = track.url || track.file_url;
      
      if (ytId || url) {
        console.log(`[playback/rehydrate] has source youtubeId=${ytId || url}`);
        console.log('[playback/rehydrate] prepare start');
        try {
          const reqUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : (url || '');
          let dlRes = await apiFetch('/api/downloads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: reqUrl,
              title: track.title,
              uploader: track.artist || track.artist_name,
              mode: 'audio',
              youtube_id: ytId
            })
          });
          let dlData = await dlRes.json().catch(() => null);
          
          if (!active) return;
          if (!dlRes.ok) throw dlData;
          if (ytId && dlData?.youtubeId && dlData.youtubeId !== ytId) {
             throw { status: 400, code: 'MISSING_TRACK_SOURCE' };
          }
          
          let finalUrl = null;
          if (dlData?.status === 'ready' && dlData?.audioUrl) {
            finalUrl = dlData.audioUrl;
          } else if ((dlData?.status === 'preparing' || dlRes?.status === 202) && dlData?.jobId) {
            let attempts = 60;
            while (attempts > 0 && active) {
              await new Promise(r => setTimeout(r, 2000));
              const statRes = await apiFetch(`/api/downloads/status/${dlData.jobId}`);
              const statData = await statRes.json().catch(() => null);
              if (statData?.status === 'ready' && statData?.audioUrl) {
                finalUrl = statData.audioUrl;
                break;
              } else if (statData?.status === 'failed') {
                throw new Error('failed');
              }
              attempts--;
            }
          }
          
          if (!active) return;
          if (finalUrl) {
            console.log('[playback/rehydrate] ready audioUrl=' + finalUrl);
            if (!audioRef.current) {
                const s = songFromTrack(track);
                s.file_url = finalUrl;
                setCurrentSong(s);
                audioRef.current = new Audio(finalUrl);
            }
          } else {
            throw new Error('timeout');
          }
        } catch (err) {
          console.log('[playback/rehydrate] missing-source repair');
          const s = songFromTrack(track);
          const repaired = await repairTrack(s);
          if (!repaired) {
             console.log('[playback/rehydrate] failed clearing lastPlayed');
             localStorage.removeItem('vns_lastPlayed');
             const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
             state.currentTrack = null;
             localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
             setCurrentSong(null);
             setPlaybackError('Busca la canción nuevamente');
          } else if (active && !audioRef.current) {
             setCurrentSong(repaired);
             // Let it be lazy-prepared on play
          }
        }
      } else {
        console.log('[playback/rehydrate] missing-source repair');
        const s = songFromTrack(track);
        const repaired = await repairTrack(s);
        if (!repaired) {
             console.log('[playback/rehydrate] failed clearing lastPlayed');
             localStorage.removeItem('vns_lastPlayed');
             const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
             state.currentTrack = null;
             localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
             setCurrentSong(null);
             setPlaybackError('Busca la canción nuevamente');
        } else if (active && !audioRef.current) {
             setCurrentSong(repaired);
        }
      }
    };
    
    // Slight delay to allow UI to mount
    const t = setTimeout(rehydrate, 1500);
    return () => { active = false; clearTimeout(t); };
  }, []);
"""
    
    target_hook = "useMediaSession(currentSong, togglePlay, next, previous, seek);"
    if target_hook in content_playback:
        content_playback = content_playback.replace(target_hook, hook_inject + "\n  " + target_hook)
    else:
        print("COULD NOT FIND target_hook")

    with open(path_playback, "w", encoding="utf-8") as f:
        f.write(content_playback)

if __name__ == "__main__":
    main()
