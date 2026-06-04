import re

def main():
    path_playback = "src/app/context/PlaybackContext.tsx"
    with open(path_playback, "r", encoding="utf-8") as f:
        content_playback = f.read()

    # Rehydrate 404 check
    old_rehydrate_check = """          if (dlData?.status === 'ready' && dlData?.audioUrl) {
            finalUrl = dlData.audioUrl;
          } else if ((dlData?.status === 'preparing' || dlRes?.status === 202) && dlData?.jobId) {"""
          
    new_rehydrate_check = """          if (dlData?.status === 'ready' && dlData?.audioUrl) {
            try {
              const check = await fetch(dlData.audioUrl, { method: 'HEAD' });
              if (check.status === 404) {
                 console.log('[playback/rehydrate] old stream failed, repairing');
                 throw new Error('stream_404');
              }
              finalUrl = dlData.audioUrl;
            } catch (e: any) {
              if (e.message === 'stream_404') throw e;
              finalUrl = dlData.audioUrl;
            }
          } else if ((dlData?.status === 'preparing' || dlRes?.status === 202) && dlData?.jobId) {"""
          
    if "[playback/rehydrate] old stream failed, repairing" not in content_playback:
        content_playback = content_playback.replace(old_rehydrate_check, new_rehydrate_check)
    
    # Check if we also need to avoid error on manual play with a missing stream.
    # playSongInternal creates `finalAudioUrl`. Then does `new Audio(finalAudioUrl)`.
    # And then `.play().catch(...)`.
    # But doing `HEAD` check on every single playSongInternal adds 1 network hop (50-200ms) to play.
    # Wait, the problem ONLY happens with old streams from `rehydrate`. Because `playSongInternal` triggers `/api/downloads` which converts the song. If it was converted NOW, it is available. If it was converted long ago, it might be 404.
    # BUT `rehydrate` does exactly this background repair! So by the time the user clicks "Continuar", it has ALREADY repaired it and replaced `currentSong`!
    # So `playSongInternal` will receive the NEW `audioUrl`, and there will be no 404!
    # What if they click a song from Library > Recents?
    # When clicking a song from Recents, it runs `playSong(song)`.
    # It runs `playSongInternal`.
    # It runs `dlRes = await apiFetch('/api/downloads')`.
    # It gets `dlData.status === 'ready' && dlData.audioUrl`.
    # It sets `audio = new Audio(finalAudioUrl)`.
    # It catches 404 when `a.play()` fails.
    # AND it shows the error!
    # Wait, if they click a song from Recents, they DO get the error if it's an old stream!
    # "Al tocar una canción reciente, intenta reproducir un stream viejo: GET /api/downloads/stream/647 404"
    # Ah! This IS `playSongInternal`!
    # Wait, "Al tocar una canción reciente" -> "when playing a recent song". This goes to `playSongInternal`.
    # The user is complaining about the error showing up before it finishes repairing.
    # "Luego resolve-audio falla 400, pero después sí logra: [playback/rehydrate] ready audioUrl=/api/downloads/stream/118"
    # Wait, the user logs say `[playback/rehydrate] ready`. So it's from `rehydrate`?
    # No, they might be quoting two different logs from two different bugs!
    # "BUG 2: Al tocar una canción reciente, intenta reproducir un stream viejo: GET /api/downloads/stream/647 404. Luego resolve-audio falla 400, pero después sí logra: [playback/rehydrate] ready audioUrl=/api/downloads/stream/118"
    # If they click a recent song, `playSongInternal` runs.
    # Wait! If they click "Continuar escuchando", it calls `playSongInternal(resumeCandidate)`! BUT since it's the SAME track as `currentSong`, it runs:
    # `if (currentSong && getTrackKey(currentSong) === getTrackKey(song)) { a.play().catch(...) }`
    # And if it fails, it does `onerror`.
    # But wait, why does it say `[playback/rehydrate] ready audioUrl=/api/downloads/stream/118` AFTER resolve-audio?
    # Because `rehydrate` was running IN THE BACKGROUND while they clicked it!
    # `rehydrate` is `async`. It does `await apiFetch`. Meanwhile, the user clicks "Continuar escuchando".
    # `togglePlay` runs. It sees `currentSong` (which was loaded from `STORAGE_KEY`).
    # It runs `a.play()` (the OLD audio element).
    # It fails, fires `onerror`, fires `repairTrack` and sets the error!
    # Meanwhile, `rehydrate` finishes! It gets a 404 in the background? No, `rehydrate`'s `apiFetch` finishes, creates `new Audio`, but then `rehydrate`'s `new Audio` fails, catches `stream_404`, runs `repairTrack`, gets the new stream and logs `[playback/rehydrate] ready audioUrl...`.
    
    # We should add the HEAD check to BOTH `rehydrate` AND `playSongInternal` (where it prepares audio).
    # Wait, doing a HEAD check in `playSongInternal` for EVERY playback adds a network hop!
    # Can we just check if it's a recent song?
    # Or maybe we can just suppress `setPlaybackError` when `onerror` is doing a repair?
    
    # If `onerror` fires:
    old_error_listener = """    let isRecovering = false;
    audio.addEventListener('error', async () => {
      if (isRecovering || !isMyGen()) return;
      isRecovering = true;
      repairingRef.current = true;
      setIsPlaying(false);
      setIsResolvingAudio(true);
      setPlaybackError('No pudimos reproducir esta canción. Intentando repararla...');"""

    new_error_listener = """    let isRecovering = false;
    audio.addEventListener('error', async () => {
      if (isRecovering || !isMyGen()) return;
      isRecovering = true;
      repairingRef.current = true;
      setIsPlaying(false);
      setIsResolvingAudio(true);
      // setPlaybackError('No pudimos reproducir esta canción. Intentando repararla...');"""

    content_playback = content_playback.replace(old_error_listener, new_error_listener)
    
    # Also in `playSongInternal` `a.play().catch(...)`
    old_play_catch = """            .catch((error) => {
              if (import.meta.env.DEV) console.debug('[playback/audio.play] error (toggle)', error);
              setIsPlaying(false);
              setPlaybackError('No pudimos reproducir esta canción. Intenta con otra.');
            });"""
            
    new_play_catch = """            .catch((error) => {
              if (import.meta.env.DEV) console.debug('[playback/audio.play] error (toggle)', error);
              setIsPlaying(false);
              // don't set error yet, let onerror listener handle repair
            });"""
            
    content_playback = content_playback.replace(old_play_catch, new_play_catch)

    # In `rehydrate` error catch:
    old_rehydrate_error = """             setPlaybackError('Busca la canción nuevamente');"""
    new_rehydrate_error = """             console.log('[playback/rehydrate] clearing broken lastPlayed');
             if (user?.uid) localStorage.removeItem(getUserStorageKey('vns_lastPlayed', user.uid)!);
             setPlaybackError('Busca la canción nuevamente');"""
    content_playback = content_playback.replace(old_rehydrate_error, new_rehydrate_error)
    
    with open(path_playback, "w", encoding="utf-8") as f:
        f.write(content_playback)

if __name__ == "__main__":
    main()
