import re

def main():
    # 1. Update PlaybackContext.tsx
    path_playback = "src/app/context/PlaybackContext.tsx"
    with open(path_playback, "r", encoding="utf-8") as f:
        content_playback = f.read()

    # 1.1 Insert buildPlayableTrackFromRepair
    helper_code = """
function buildPlayableTrackFromRepair(original: any, candidate: any) {
  const extractYoutubeId = (url: string) => {
    if (!url) return null;
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
  };

  const youtubeId =
    cleanSourceValue(candidate.youtubeId) ||
    cleanSourceValue(candidate.youtube_id) ||
    cleanSourceValue(candidate.sourceId) ||
    cleanSourceValue(candidate.videoId) ||
    extractYoutubeId(candidate.url);

  if (!youtubeId) {
    throw new Error("REPAIR_CANDIDATE_MISSING_YOUTUBE_ID");
  }

  return {
    ...original,

    // reemplazar identidad, no conservar la vieja
    id: candidate.id || `yt:${youtubeId}`,
    youtubeId,
    youtube_id: youtubeId,
    sourceId: youtubeId,
    videoId: youtubeId,
    url: candidate.url || `https://www.youtube.com/watch?v=${youtubeId}`,

    // limpiar datos corruptos
    audioUrl: null,
    file_url: null,
    downloadId: null,

    // metadata visible real
    title: candidate.title || original.title,
    artist: candidate.artist || candidate.uploader || original.artist,
    artist_name: candidate.artist || candidate.uploader || original.artist,
    coverUrl: candidate.coverUrl || candidate.thumbnail || original.coverUrl,
    thumbnail: candidate.thumbnail || candidate.coverUrl || original.thumbnail,
    duration: candidate.duration || original.duration,

    source: "youtube",
    repaired: true,
  };
}
"""
    if "function buildPlayableTrackFromRepair" not in content_playback:
        content_playback = content_playback.replace("const resolveMediaUrl = ", helper_code + "\n  const resolveMediaUrl = ")

    # 1.2 Update repairTrack return logic
    old_repair_logic = """         const safeYoutubeId = safeCandidate.youtube_id || safeCandidate.id;
         console.log(`[playback/repair] accepted youtubeId=${safeYoutubeId}`);
         console.log('[playback/repair] update-current-track metadata');
         
         const newTrack = {
           ...track,
           title: safeCandidate.title,
           artist: safeCandidate.artist || safeCandidate.uploader,
           duration_seconds: safeCandidate.duration_seconds,
           durationSecs: safeCandidate.duration_seconds,
           youtube_id: safeYoutubeId,
           url: safeCandidate.url,
           sourceId: safeYoutubeId,
           file_url: safeCandidate.file_url || safeCandidate.url,
           image_url: safeCandidate.coverUrl || safeCandidate.image_url || track.image_url,
           coverUrl: safeCandidate.coverUrl || safeCandidate.image_url || track.image_url
         };
         
         setCurrentSong((prev) => {
            if (prev && prev.id === track.id) return newTrack;
            return prev;
         });
         
         const currentUser = auth.currentUser;
         if (currentUser && track.id) {
             const key = songKeyFromId(track.id);
             setDoc(doc(db, 'users', currentUser.uid, 'recents', key), {
                title: newTrack.title,
                artist: newTrack.artist,
                duration_seconds: newTrack.duration_seconds,
                youtube_id: safeYoutubeId,
                youtubeId: safeYoutubeId,
                url: safeCandidate.url,
                sourceId: safeYoutubeId,
                audioUrl: toStorableFileUrl(newTrack.file_url),
                file_url: toStorableFileUrl(newTrack.file_url),
                image_url: newTrack.image_url,
                coverUrl: newTrack.image_url
             }, { merge: true }).catch(e => console.warn('[playback/repair] firestore error', e));
             
             try {
               const saved = localStorage.getItem('vns_recents');
               if (saved) {
                 const parsed = JSON.parse(saved);
                 const idx = parsed.findIndex((r: any) => r.id === track.id);
                 if (idx >= 0) {
                   parsed[idx] = { ...parsed[idx], ...newTrack };
                   localStorage.setItem('vns_recents', JSON.stringify(parsed));
                 }
               }
             } catch {}
         }
         
         return newTrack;"""
         
    new_repair_logic = """         console.log(`[playback/repair] accepted youtubeId=${safeCandidate.youtube_id || safeCandidate.id}`);
         
         const repairedTrack = buildPlayableTrackFromRepair(track, safeCandidate);

         console.debug("[playback/repair] repaired track", {
           oldId: track.id,
           oldYoutubeId: track.youtubeId,
           newYoutubeId: repairedTrack.youtubeId,
           title: repairedTrack.title,
           artist: repairedTrack.artist,
         });
         
         console.log(`[playback/repair] build playable track oldYoutubeId=${track.youtubeId || 'null'} newYoutubeId=${repairedTrack.youtubeId}`);
         
         setCurrentSong(repairedTrack);
         
         const currentUser = auth.currentUser;
         if (currentUser && track.id) {
             // We can delete the old one or just let it be. But we must return the new one.
             const key = songKeyFromId(track.id);
             deleteDoc(doc(db, 'users', currentUser.uid, 'recents', key)).catch(() => {});
             
             try {
               const saved = localStorage.getItem('vns_recents');
               if (saved) {
                 const parsed = JSON.parse(saved);
                 const filtered = parsed.filter((r: any) => r.id !== track.id);
                 localStorage.setItem('vns_recents', JSON.stringify(filtered));
               }
             } catch {}
         }
         
         return repairedTrack;"""
    if "const safeYoutubeId = safeCandidate.youtube_id || safeCandidate.id;" in content_playback:
        content_playback = content_playback.replace(old_repair_logic, new_repair_logic)

    # 1.3 Fix prepareAudioAsync missing source logic
    old_prepare_reject = """        if (!ytId && !url) {
           console.log('[playback/prepare] invalid source cleaned');"""
    new_prepare_reject = """        if (!ytId && !url) {
           console.log('[playback/prepare] blocked invalid source youtubeId=null');
           throw { status: 400, code: 'MISSING_TRACK_SOURCE_CLIENT' };
        }
        if (ytId === 'null' || (url && url.includes('watch?v=null'))) {
           console.log('[playback/prepare] blocked invalid source youtubeId=null');
           throw { status: 400, code: 'MISSING_TRACK_SOURCE_CLIENT' };
        }
        if (!ytId && !url) {
           console.log('[playback/prepare] invalid source cleaned');"""
           
    # Actually wait, the above new_prepare_reject duplicates "if (!ytId && !url)".
    # Let's replace the whole block more carefully.
    
    old_prepare_ytId_block = """        const ytId = cleanSourceValue(song.youtube_id || song.sourceId || song.videoId);
        const url = cleanSourceValue(song.url || song.webpage_url);
        const audioUrl = cleanSourceValue(song.file_url);
        
        if (!ytId && !url) {
           console.log('[playback/prepare] invalid source cleaned');
           if (song.title && (song.artist || song.artist_name)) {
              console.debug(`[playback/repair] start reason=MISSING_TRACK_SOURCE_CLIENT`);
              const repairedSong = await repairTrack(song);
              if (repairedSong && isMyGen()) {
                playSongInternal(repairedSong, playlist, isCrossfade, opts);
                return;
              }
           }
           console.log('[playback/prepare] clearing corrupt item');
           if (isMyGen()) {
             setPlaybackError('Esta canciA3n estA! corrupta. BAs\xcala nuevamente.');
             setIsResolvingAudio(false);
           }
           return;
        }"""
        
    new_prepare_ytId_block = """        const ytId = cleanSourceValue(song.youtube_id || song.sourceId || song.videoId);
        const url = cleanSourceValue(song.url || song.webpage_url);
        const audioUrl = cleanSourceValue(song.file_url);
        
        if (!ytId && !url || ytId === 'null' || (url && url.includes('watch?v=null'))) {
           console.log('[playback/prepare] blocked invalid source youtubeId=null');
           if (song.title && (song.artist || song.artist_name)) {
              console.debug(`[playback/repair] start reason=MISSING_TRACK_SOURCE_CLIENT`);
              const repairedSong = await repairTrack(song);
              if (repairedSong && isMyGen()) {
                console.log(`[playback/repair] retry prepare with repairedTrack youtubeId=${repairedSong.youtube_id || repairedSong.youtubeId}`);
                playSongInternal(repairedSong, playlist, isCrossfade, opts);
                return;
              }
           }
           console.log('[playback/prepare] clearing corrupt item');
           if (isMyGen()) {
             setPlaybackError('Esta canción está corrupta. Búscala nuevamente.');
             setIsResolvingAudio(false);
           }
           return;
        }"""
    content_playback = content_playback.replace(old_prepare_ytId_block, new_prepare_ytId_block)

    # Also handle missing source in catch block
    old_catch_repair = """        if (
          err?.code === "MISSING_TRACK_SOURCE" ||
          (err?.status === 400 && song?.title && (song?.artist || song?.artist_name))
        ) {"""
        
    new_catch_repair = """        if (
          err?.code === "MISSING_TRACK_SOURCE_CLIENT" ||
          err?.code === "MISSING_TRACK_SOURCE" ||
          (err?.status === 400 && song?.title && (song?.artist || song?.artist_name))
        ) {"""
    content_playback = content_playback.replace(old_catch_repair, new_catch_repair)

    # Cancel polling if audio:null
    old_polling = """              const statRes = await apiFetch(`/api/downloads/status/${dlData.jobId}`);"""
    new_polling = """              if (dlData.jobId === 'audio:null' || String(dlData.jobId).includes('null')) {
                 console.log('[downloads/status] rejected invalid jobId=audio:null');
                 throw { status: 400, code: 'MISSING_TRACK_SOURCE_CLIENT' };
              }
              const statRes = await apiFetch(`/api/downloads/status/${dlData.jobId}`);"""
    content_playback = content_playback.replace(old_polling, new_polling)

    # 1.4 Rehydrate extra validation
    old_rehydrate_validate = """      if (ptrack.id === 'dl-null' || ptrack.audioUrl === '/api/downloads/stream/null' || ptrack.youtubeId === 'null') {
         console.log('[playback/rehydrate] invalid saved track clearing');"""
         
    new_rehydrate_validate = """      if (
         ptrack.id === 'dl-null' || 
         ptrack.audioUrl === '/api/downloads/stream/null' || 
         ptrack.youtubeId === 'null' || 
         ptrack.youtubeId === null || 
         ptrack.downloadId === null ||
         (ptrack.url && ptrack.url.includes('watch?v=null'))
      ) {
         console.log('[playback/rehydrate] clearing invalid saved track');"""
    content_playback = content_playback.replace(old_rehydrate_validate, new_rehydrate_validate)

    with open(path_playback, "w", encoding="utf-8") as f:
        f.write(content_playback)

    # 2. Update backend downloads.ts
    path_downloads = "backend/src/routes/downloads.ts"
    with open(path_downloads, "r", encoding="utf-8") as f:
        content_downloads = f.read()

    old_backend_check = """    if (!youtube_id && !url) {
       console.log('[downloads] rejected invalid source youtubeId=null');"""
    new_backend_check = """    if (!youtube_id && !url) {
       console.log('[downloads] rejected invalid youtubeId=null');"""
    content_downloads = content_downloads.replace(old_backend_check, new_backend_check)
    
    old_backend_url_check = """    if (url && String(url).includes('watch?v=null')) {
       console.log('[downloads] rejected invalid url watch?v=null');"""
    new_backend_url_check = """    if (url && String(url).includes('watch?v=null')) {
       console.log('[downloads] rejected invalid youtubeId=null');"""
    content_downloads = content_downloads.replace(old_backend_url_check, new_backend_url_check)

    old_backend_status = """  if (!jobId || jobId === 'audio:null' || String(jobId).includes('null')) {
    return res.status(400).json({ status: 'failed', message: 'INVALID_JOB_ID' });
  }"""
    new_backend_status = """  if (!jobId || jobId === 'audio:null' || String(jobId).includes('null')) {
    console.log('[downloads/status] rejected invalid jobId=audio:null');
    return res.status(400).json({ status: 'failed', message: 'INVALID_JOB_ID' });
  }"""
    content_downloads = content_downloads.replace(old_backend_status, new_backend_status)

    with open(path_downloads, "w", encoding="utf-8") as f:
        f.write(content_downloads)

if __name__ == "__main__":
    main()
