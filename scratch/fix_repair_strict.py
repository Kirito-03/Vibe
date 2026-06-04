import os

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # We need to replace the `isSafeRepairMatch` function and `repairTrack` function.

    old_isSafe = content.split("const isSafeRepairMatch")[0]
    old_isSafe_end = content.find("import { createContext")
    
    # Isolate repairTrack
    repairTrack_start = content.find("  const repairTrack = async")
    repairTrack_end = content.find("  const playSongInternal = useCallback")

    new_isSafe = """const badModifiers = ['live', 'en vivo', 'cover', 'remix', 'slowed', 'sped up', 'reverb', 'karaoke', 'instrumental', 'letra', 'lyrics', 'visualizer', 'nightcore', 'edit', 'extended'];

const isSafeRepairMatch = (originalTrack: any, candidate: any): { score: number, rejectReason: string | null } => {
  let score = 0;
  
  const normTitle = (originalTrack.title || '').toLowerCase();
  const cTitle = (candidate.title || '').toLowerCase();
  
  const origArtist = (originalTrack.artist || originalTrack.artist_name || '').toLowerCase();
  const cArtist = (candidate.uploader || candidate.artist || '').toLowerCase();

  let artistMatch = false;
  if (origArtist) {
    if (cTitle.includes(origArtist) || cArtist.includes(origArtist) || origArtist.includes(cArtist)) {
      artistMatch = true;
      score += 40;
    }
  } else {
    artistMatch = true;
    score += 20; // smaller bonus
  }

  if (!artistMatch) {
    return { score: 0, rejectReason: 'artist_mismatch' };
  }

  const qTokens = normTitle.replace(/[^\\w\\s]/gi, '').split(/\\s+/).filter((t: string) => t.length > 2);
  let matchedTokens = 0;
  for (const t of qTokens) {
    if (cTitle.includes(t)) matchedTokens++;
  }
  if (qTokens.length > 0) {
    const ratio = matchedTokens / qTokens.length;
    if (ratio < 0.5) return { score: 0, rejectReason: 'title_mismatch' };
    score += ratio * 40;
  } else {
    // If title has no long tokens, just check if candidate title includes the whole original title
    if (normTitle && cTitle.includes(normTitle)) {
      score += 40;
    } else {
      return { score: 0, rejectReason: 'title_mismatch' };
    }
  }

  const origDur = originalTrack.duration_seconds || originalTrack.durationSecs;
  const cDur = candidate.duration_seconds;
  if (origDur && cDur) {
    const diff = Math.abs(origDur - cDur);
    if (diff > 20) {
      return { score: 0, rejectReason: 'duration_mismatch' };
    }
    if (diff <= 10) score += 20;
    else score += 10;
  } else {
    score += 20; // Assume okay if missing
  }

  for (const mod of badModifiers) {
    if (cTitle.includes(mod) && !normTitle.includes(mod)) {
      return { score: 0, rejectReason: 'version_mismatch' };
    }
  }

  return { score, rejectReason: null };
};
"""

    new_repairTrack = """  const repairTrack = async (track: Song): Promise<Song | null> => {
    try {
      const q = `${track.title} ${track.artist || track.artist_name || ''}`.trim();
      console.log(`[playback/repair] search q=${q}`);
      
      const searchRes = await apiFetch(`/api/music/search?q=${encodeURIComponent(q)}&limit=5`);
      const searchData = await searchRes.json().catch(() => null);
      
      let candidates = [];
      if (searchData && Array.isArray(searchData.items)) {
         for (const candidate of searchData.items) {
             const { score, rejectReason } = isSafeRepairMatch(track, candidate);
             console.log(`[playback/repair] candidate title="${candidate.title}" artist="${candidate.artist || candidate.uploader}" score=${score} reasons=${rejectReason || 'none'}`);
             if (rejectReason) {
                 console.log(`[playback/repair] reject reason=${rejectReason}`);
             } else if (score >= 90) {
                 candidates.push({ candidate, score });
             }
         }
      }
      
      let safeCandidate = null;
      if (candidates.length === 1) {
          safeCandidate = candidates[0].candidate;
      } else if (candidates.length > 1) {
          candidates.sort((a, b) => b.score - a.score);
          if (candidates[0].score - candidates[1].score < 10) {
              console.log('[playback/repair] reject reason=ambiguous_candidates');
          } else {
              safeCandidate = candidates[0].candidate;
          }
      }
      
      if (safeCandidate) {
         const safeYoutubeId = safeCandidate.youtube_id || safeCandidate.id;
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
         
         return newTrack;
      } else {
         console.log('[playback/repair] failed unsafe_match');
         console.log('[playback/repair] remove broken recent');
         
         setPlaybackError('No pude reparar esta canción con seguridad. Búscala nuevamente.');
         
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
"""

    content = content[:old_isSafe_end] + new_isSafe + content[old_isSafe_end:repairTrack_start] + new_repairTrack + content[repairTrack_end:]

    # Remove old isSafeRepairMatch definition at the top
    first_def_start = content.find("const isSafeRepairMatch =")
    first_def_end = content.find("};", first_def_start) + 3
    content = content[:first_def_start] + content[first_def_end:]

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    print("Strict autorepair logic injected successfully")

if __name__ == "__main__":
    main()
