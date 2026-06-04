import re

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # We want to replace the block starting at `let audio: HTMLAudioElement;`
    # up to `audioRef.current = audio;` (lines 579-586)
    
    # And then we want to wrap the url resolution logic BEFORE that block.
    
    # Instead of rewriting the massive audio events block, we can just intercept
    # finalAudioUrl before the Audio element is created!
    
    target_start = """    let audio: HTMLAudioElement;
    if (preloadedAudioRef.current && preloadedAudioRef.current.src.includes(finalAudioUrl)) {"""
    
    if target_start not in content:
        print("target_start not found")
        return

    # We will inject the async resolution right before target_start.
    # To do this safely without breaking the synchronous flow of the component (since we are inside useEffect/useCallback),
    # wait, playSongInternal is a useCallback!
    # It takes (song, playlist, isCrossfade, options)
    # The entire body of playSongInternal is synchronous!
    
    # Let's replace the synchronous flow with an async-friendly flow.
    # We can just change `const playSongInternal = useCallback((song: Song, ...`
    # to `const playSongInternal = useCallback(async (song: Song, ...` !
    # Wait, useCallback(async ...) is perfectly valid in React!
    
    old_func = "const playSongInternal = useCallback((song: Song, playlist?: Playlist, isCrossfade = false, options?: { userInitiated?: boolean }) => {"
    new_func = "const playSongInternal = useCallback(async (song: Song, playlist?: Playlist, isCrossfade = false, options?: { userInitiated?: boolean }) => {"
    
    if old_func in content:
        content = content.replace(old_func, new_func)
    
    # Now we can just insert `await` inside playSongInternal!
    
    injection = """
    const isMyGen = () => playGenRef.current === myGen;
    if (!finalAudioUrl || finalAudioUrl.includes('youtube.com') || finalAudioUrl.includes('youtu.be') || finalAudioUrl.includes('stream-direct')) {
      setIsResolvingAudio(true);
      setPlaybackError(null);
      console.log('[playback/prepare] start');
      try {
        const ytId = song.youtube_id || null;
        const dlRes = await apiFetch('/api/downloads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: ytId ? `https://www.youtube.com/watch?v=${ytId}` : (finalAudioUrl || ''),
            title: song.title,
            uploader: song.artist,
            mode: 'audio',
            youtube_id: ytId
          })
        });
        const dlData = await dlRes.json().catch(() => ({}));
        
        if (!isMyGen()) return;

        if (dlData.status === 'ready' && dlData.audioUrl) {
          console.log('[playback/prepare] ready audioUrl=' + dlData.audioUrl);
          finalAudioUrl = dlData.audioUrl;
        } else if ((dlData.status === 'preparing' || dlRes?.status === 202) && dlData.jobId) {
          console.log(`[playback/prepare] pending jobId=${dlData.jobId}`);
          console.log('[playback/prepare] polling');
          let attempts = 60;
          let resolved = null;
          while (attempts > 0 && isMyGen()) {
            await new Promise(r => setTimeout(r, 2000));
            const statRes = await apiFetch(`/api/downloads/status/${dlData.jobId}`);
            const statData = await statRes.json().catch(() => null);
            if (statData?.status === 'ready' && statData?.audioUrl) {
              resolved = statData.audioUrl;
              break;
            } else if (statData?.status === 'failed') {
              throw new Error(statData.message || 'Worker failed');
            }
            attempts--;
          }
          if (!isMyGen()) return;
          if (!resolved) throw new Error('Timeout resolving audio');
          console.log('[playback/prepare] ready audioUrl=' + resolved);
          finalAudioUrl = resolved;
        } else {
          throw new Error('No pudimos preparar esta canción');
        }
        setIsResolvingAudio(false);
      } catch (err) {
        console.log('[playback/prepare] failed', err);
        if (isMyGen()) {
          setPlaybackError('No pudimos preparar esta canción. Intenta con otra.');
          setIsResolvingAudio(false);
        }
        return;
      }
    }
"""
    
    content = content.replace(target_start, injection + "\n" + target_start)

    # Now fix the repair logic!
    # Instead of POST /api/music/resolve-audio
    repair_target_start = "          const repairRes = await apiFetch(`/api/music/resolve-audio`, {"
    repair_target_end = "          const repairedAudioUrl = String(repairJson.audioUrl);"
    
    repair_replacement = """          console.log('[playback/repair] start polling /api/downloads');
          const dlRes = await apiFetch(`/api/downloads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: song.youtube_id ? `https://www.youtube.com/watch?v=${song.youtube_id}` : (song.file_url || ''),
              title: song.title,
              uploader: song.artist,
              mode: 'audio',
              youtube_id: song.youtube_id || null
            })
          });
          const dlData = await dlRes.json().catch(() => null);
          
          let repairedAudioUrl = null;
          let newYoutubeId = song.youtube_id;
          let newDbId = song.id;
          
          if (dlData?.status === 'ready' && dlData?.audioUrl) {
              repairedAudioUrl = dlData.audioUrl;
          } else if ((dlData?.status === 'preparing' || dlRes?.status === 202) && dlData?.jobId) {
              console.log('[playback/repair] pending jobId=' + dlData.jobId);
              let attempts = 60;
              while (attempts > 0 && isMyGen()) {
                  await new Promise(r => setTimeout(r, 2000));
                  const statRes = await apiFetch(`/api/downloads/status/${dlData.jobId}`);
                  const statData = await statRes.json().catch(() => null);
                  if (statData?.status === 'ready' && statData?.audioUrl) {
                      repairedAudioUrl = statData.audioUrl;
                      break;
                  } else if (statData?.status === 'failed') {
                      throw new Error(statData.message || 'Worker failed');
                  }
                  attempts--;
              }
          }
          if (!repairedAudioUrl || !isMyGen()) throw new Error('Repair failed or timed out');
          
          const repairJson = { track: { id: newDbId, youtubeId: newYoutubeId } };
"""
    
    start_idx = content.find(repair_target_start)
    end_idx = content.find(repair_target_end)
    if start_idx != -1 and end_idx != -1:
        content = content[:start_idx] + repair_replacement + content[end_idx:]

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
        
    print("Done")

if __name__ == "__main__":
    main()
