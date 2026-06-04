import os

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Update the fetch block
    old_fetch_block = """        let dlData = await dlRes.json().catch(() => ({}));
        
        if (!isMyGen()) return;

        if (dlData.status === 'ready' && dlData.audioUrl) {"""

    new_fetch_block = """        let dlData = await dlRes.json().catch(() => null);
        
        if (!isMyGen()) return;

        if (!dlRes.ok) {
          const error: any = new Error(dlData?.message || "No pudimos preparar esta canción");
          error.code = dlData?.code;
          error.status = dlRes.status;
          error.payload = dlData;
          throw error;
        }

        if (dlData?.status === 'ready' && dlData?.audioUrl) {"""

    content = content.replace(old_fetch_block, new_fetch_block)

    # 2. Update the catch block and add repair function
    # Find the catch block:
    old_catch = """      } catch (err) {
        console.log('[playback/prepare] failed', err);
        if (isMyGen()) {
          setPlaybackError('No pudimos preparar esta canción. Intenta con otra.');
          setIsResolvingAudio(false);
        }
        return;
      }"""

    new_catch = """      } catch (err: any) {
        console.debug("[playback/prepare] error payload", {
          status: err?.status,
          code: err?.code,
          message: err?.message,
          payload: err?.payload,
          track: song
        });
        
        if (
          err?.code === "MISSING_TRACK_SOURCE" ||
          (err?.status === 400 && song?.title && (song?.artist || song?.artist_name))
        ) {
          console.debug(`[playback/repair] start reason=${err?.code || '400_MISSING_SOURCE'}`);
          const repairedSong = await repairTrack(song);
          if (repairedSong && isMyGen()) {
            console.log('[playback/repair] retry prepare');
            playSongInternal(repairedSong, playlist, isCrossfade, opts);
            return;
          }
        }
        
        console.log('[playback/prepare] failed', err);
        if (isMyGen()) {
          setPlaybackError('No pudimos preparar esta canción. Intenta con otra.');
          setIsResolvingAudio(false);
        }
        return;
      }"""

    content = content.replace(old_catch, new_catch)

    # 3. Add repairTrack function before playSongInternal
    repair_func = """
  const repairTrack = async (track: Song): Promise<Song | null> => {
    try {
      const q = `${track.title} ${track.artist || track.artist_name || ''}`.trim();
      console.log(`[playback/repair] search q=${q}`);
      
      const searchRes = await apiFetch(`/api/music/search?q=${encodeURIComponent(q)}&limit=5`);
      const searchData = await searchRes.json().catch(() => null);
      
      let safeCandidate = null;
      if (searchData && Array.isArray(searchData.items)) {
         console.log(`[playback/repair] candidates count=${searchData.items.length}`);
         for (const candidate of searchData.items) {
             const score = isSafeRepairMatch(track, candidate);
             console.log(`[playback/repair] candidate title="${candidate.title}" artist="${candidate.artist || candidate.uploader}" score=${score}`);
             if (score >= 70) {
                 safeCandidate = candidate;
                 break;
             }
         }
      }
      
      if (safeCandidate) {
         const safeYoutubeId = safeCandidate.youtube_id || safeCandidate.id;
         console.log(`[playback/repair] safe-match youtubeId=${safeYoutubeId}`);
         
         const newTrack = {
           ...track,
           youtube_id: safeYoutubeId,
           url: safeCandidate.url,
           sourceId: safeYoutubeId,
           file_url: safeCandidate.file_url || safeCandidate.url
         };
         
         // Update UI immediately so next plays don't need repair
         setCurrentSong((prev) => {
            if (prev && prev.id === track.id) return newTrack;
            return prev;
         });
         
         const currentUser = auth.currentUser;
         if (currentUser && track.id) {
             const key = songKeyFromId(track.id);
             setDoc(doc(db, 'users', currentUser.uid, 'recents', key), {
                youtube_id: safeYoutubeId,
                youtubeId: safeYoutubeId,
                url: safeCandidate.url,
                sourceId: safeYoutubeId,
                audioUrl: toStorableFileUrl(safeCandidate.file_url),
                file_url: toStorableFileUrl(safeCandidate.file_url)
             }, { merge: true }).catch(e => console.warn('[playback/repair] firestore error', e));
             
             // Also update localStorage
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
         
         return newTrack;
      } else {
         console.log('[playback/repair] failed unsafe_match');
         console.log('[playback/repair] remove broken recent');
         
         const currentUser = auth.currentUser;
         if (currentUser && track.id) {
             const key = songKeyFromId(track.id);
             deleteDoc(doc(db, 'users', currentUser.uid, 'recents', key)).catch(e => console.warn('[playback/repair] firestore error', e));
             
             try {
               const saved = localStorage.getItem('vns_recents');
               if (saved) {
                 const parsed = JSON.parse(saved);
                 const filtered = parsed.filter((r: any) => r.id !== track.id);
                 localStorage.setItem('vns_recents', JSON.stringify(filtered));
               }
             } catch {}
         }
         return null;
      }
    } catch (e) {
      console.error('[playback/repair] error during repair', e);
      return null;
    }
  };

  const playSongInternal = useCallback(async (song: Song, playlist?: Playlist, isCrossfade = false, opts?: { userInitiated?: boolean }) => {"""

    # Find the start of playSongInternal to inject repairTrack before it
    content = content.replace("  const playSongInternal = useCallback(async (song: Song, playlist?: Playlist, isCrossfade = false, opts?: { userInitiated?: boolean }) => {", repair_func)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
        
    print("Fixed auto-repair logic successfully.")

if __name__ == "__main__":
    main()
