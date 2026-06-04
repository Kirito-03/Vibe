path_playback = "src/app/context/PlaybackContext.tsx"
with open(path_playback, "r", encoding="utf-8") as f:
    content_playback = f.read()

old_resolve = """        repairAttemptsRef.current.set(repairKey, prevAttempts + 1);
        const repairRes = await apiFetch(`/api/music/resolve-audio`, {"""

new_resolve = """        if (!song.title && !song.artist && !song.artist_name) {
           console.log('[resolve-audio] blocked empty title/artist');
           setPlaybackError('Esta canción está corrupta. Búscala nuevamente.');
           if (!lastUserInitiatedRef.current && settings.autoplay) next();
           try {
             const lp = JSON.parse(localStorage.getItem('vns_lastPlayed') || '{}');
             if (lp.id === song.id || String(lp.id) === String(song.id)) localStorage.removeItem('vns_lastPlayed');
           } catch {}
           return;
        }
        repairAttemptsRef.current.set(repairKey, prevAttempts + 1);
        const repairRes = await apiFetch(`/api/music/resolve-audio`, {"""

content_playback = content_playback.replace(old_resolve, new_resolve)

with open(path_playback, "w", encoding="utf-8") as f:
    f.write(content_playback)
