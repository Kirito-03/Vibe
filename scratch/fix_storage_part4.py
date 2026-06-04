import re

def main():
    path_playback = "src/app/context/PlaybackContext.tsx"
    with open(path_playback, "r", encoding="utf-8") as f:
        content_playback = f.read()

    # Wrap setDoc in try/catch inside playSongInternal
    old_setdoc_play = """      setDoc(doc(db, 'users', currentUser.uid, 'recents', key), {
        id: key,
        song_id: song.id,
        title: song.title,
        artist: song.artist_name ?? song.artist ?? null,
        duration_seconds: song.duration_seconds ?? null,
        image_url: song.image_url ?? song.imageUrl ?? null,
        coverUrl: song.image_url ?? song.imageUrl ?? null,
        file_url: toStorableFileUrl(song.file_url),
        audioUrl: toStorableFileUrl(song.file_url),
        url: ytUrl || song.file_url || null,
        youtube_id: ytId,
        youtubeId: ytId,
        sourceId: ytId ?? song.id ?? null,
        videoId: ytId,
        source: song.source ?? 'youtube',
        played_at: serverTimestamp(),
      }, { merge: true }).catch(() => {});"""

    new_setdoc_play = """      try {
        setDoc(doc(db, 'users', currentUser.uid, 'recents', key), {
          id: key,
          song_id: song.id,
          title: song.title,
          artist: song.artist_name ?? song.artist ?? null,
          duration_seconds: song.duration_seconds ?? null,
          image_url: song.image_url ?? song.imageUrl ?? null,
          coverUrl: song.image_url ?? song.imageUrl ?? null,
          file_url: toStorableFileUrl(song.file_url),
          audioUrl: toStorableFileUrl(song.file_url),
          url: ytUrl || song.file_url || null,
          youtube_id: ytId,
          youtubeId: ytId,
          sourceId: ytId ?? song.id ?? null,
          videoId: ytId,
          source: song.source ?? 'youtube',
          played_at: serverTimestamp(),
        }, { merge: true }).catch(() => {});
      } catch (e) {
        console.warn('[playback/recents] firestore error ignored', e);
      }"""

    content_playback = content_playback.replace(old_setdoc_play, new_setdoc_play)

    # Wrap setDoc in try/catch inside repairTrack
    old_setdoc_repair = """             const key = songKeyFromId(track.id);
             deleteDoc(doc(db, 'users', currentUser.uid, 'recents', key)).catch(() => {});"""
             
    new_setdoc_repair = """             const key = songKeyFromId(track.id);
             try {
               deleteDoc(doc(db, 'users', currentUser.uid, 'recents', key)).catch(() => {});
             } catch (e) {
               console.warn('[playback/repair] firestore error ignored', e);
             }"""
             
    content_playback = content_playback.replace(old_setdoc_repair, new_setdoc_repair)

    with open(path_playback, "w", encoding="utf-8") as f:
        f.write(content_playback)

if __name__ == "__main__":
    main()
