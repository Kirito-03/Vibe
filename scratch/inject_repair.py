import re
import os

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Inject `isSafeRepairMatch` helper outside the component
    helper = """
const isSafeRepairMatch = (originalTrack: any, candidate: any): number => {
  let score = 0;
  
  const normTitle = (originalTrack.title || '').toLowerCase();
  const cTitle = (candidate.title || '').toLowerCase();
  
  const origArtist = (originalTrack.artist || originalTrack.artist_name || '').toLowerCase();
  const cArtist = (candidate.uploader || candidate.artist || '').toLowerCase();

  if (origArtist && (cTitle.includes(origArtist) || cArtist.includes(origArtist) || origArtist.includes(cArtist))) {
    score += 40;
  }

  const qTokens = normTitle.replace(/[^\\w\\s]/gi, '').split(/\\s+/).filter((t: string) => t.length > 2);
  let matchedTokens = 0;
  for (const t of qTokens) {
    if (cTitle.includes(t)) matchedTokens++;
  }
  if (qTokens.length > 0) {
    score += (matchedTokens / qTokens.length) * 40;
  }

  const origDur = originalTrack.duration_seconds || originalTrack.durationSecs;
  const cDur = candidate.duration_seconds;
  if (origDur && cDur) {
    const diff = Math.abs(origDur - cDur);
    if (diff <= 10) score += 20;
    else if (diff <= 20) score += 10;
  }

  const badModifiers = ['live', 'cover', 'karaoke', 'slowed', 'sped up', 'remix', 'letra', 'lyric'];
  for (const mod of badModifiers) {
    if (cTitle.includes(mod) && !normTitle.includes(mod)) score -= 50;
  }

  return score;
};
"""
    if "const isSafeRepairMatch" not in content:
        # insert it after imports
        import_end = content.rfind('import')
        if import_end != -1:
            next_line = content.find('\\n', import_end) + 1
            content = content[:next_line] + helper + content[next_line:]

    # 2. Inject auto-repair inside prepareAudioAsync
    target_block = """        const dlData = await dlRes.json().catch(() => ({}));
        
        if (!isMyGen()) return;"""
        
    repair_logic = """
        if (dlRes.status === 400 && dlData.code === 'MISSING_TRACK_SOURCE') {
          console.log('[playback/repair] start reason=BAD_REQUEST_MISSING_SOURCE');
          const q = `${song.title} ${song.artist || ''}`.trim();
          console.log(`[playback/repair] search q=${q}`);
          
          const searchRes = await apiFetch(`/api/music/search?q=${encodeURIComponent(q)}&limit=5`);
          const searchData = await searchRes.json().catch(() => null);
          
          let safeCandidate = null;
          if (searchData && Array.isArray(searchData.items)) {
             for (const candidate of searchData.items) {
                 const score = isSafeRepairMatch(song, candidate);
                 console.log(`[playback/repair] candidate title="${candidate.title}" score=${score}`);
                 if (score >= 70) {
                     safeCandidate = candidate;
                     break;
                 }
             }
          }
          
          if (safeCandidate) {
             const safeYoutubeId = safeCandidate.youtube_id || safeCandidate.id;
             console.log(`[playback/repair] safe-match youtubeId=${safeYoutubeId}`);
             console.log('[playback/repair] retry prepare');
             
             const retryRes = await apiFetch('/api/downloads', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({
                 url: `https://www.youtube.com/watch?v=${safeYoutubeId}`,
                 title: safeCandidate.title,
                 uploader: safeCandidate.uploader || safeCandidate.artist,
                 mode: 'audio',
                 youtube_id: safeYoutubeId
               })
             });
             const retryData = await retryRes.json().catch(() => ({}));
             
             setCurrentSong((prev) => {
                if (prev && prev.id === song.id) {
                  return {
                    ...prev,
                    youtube_id: safeYoutubeId,
                    url: safeCandidate.url,
                    sourceId: safeYoutubeId
                  };
                }
                return prev;
             });
             
             const currentUser = auth.currentUser;
             if (currentUser && song.id) {
                 const key = songKeyFromId(song.id);
                 setDoc(doc(db, 'users', currentUser.uid, 'recents', key), {
                    youtube_id: safeYoutubeId,
                    youtubeId: safeYoutubeId,
                    url: safeCandidate.url,
                    sourceId: safeYoutubeId,
                    audioUrl: toStorableFileUrl(safeCandidate.file_url)
                 }, { merge: true }).catch(() => {});
             }
             
             dlRes = retryRes;
             dlData = retryData;
             if (!isMyGen()) return;
          } else {
             console.log('[playback/repair] failed unsafe_match');
             console.log('[playback/repair] remove broken recent');
             const currentUser = auth.currentUser;
             if (currentUser && song.id) {
                 const key = songKeyFromId(song.id);
                 deleteDoc(doc(db, 'users', currentUser.uid, 'recents', key)).catch(() => {});
             }
             throw new Error('No se pudo reparar esta canción');
          }
        }
"""
    # Notice we need to change const dlRes to let dlRes
    # And const dlData to let dlData
    content = content.replace("const dlRes = await apiFetch('/api/downloads'", "let dlRes = await apiFetch('/api/downloads'")
    content = content.replace("const dlData = await dlRes.json()", "let dlData = await dlRes.json()")
    
    if "BAD_REQUEST_MISSING_SOURCE" not in content:
        content = content.replace(target_block, target_block + repair_logic)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
        
    print("Injected auto-repair logic successfully.")

if __name__ == "__main__":
    main()
