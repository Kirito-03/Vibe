import os

def main():
    path = "src/app/components/Home.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    old_dedupe = """        // Deduplicate by song_id AND title to prevent dupes in history
        const uniqueSongs = new Map<string | number, Song>();
        
        snap.docs.forEach((d) => {
          const data: any = d.data();
          const id = data.song_id ?? data.id ?? d.id;
          const title = data.title ?? '';
          
          // Use a composite key for stricter deduplication in UI
          // Removemos espacios, caracteres especiales y "oficial" para que el filtrado sea más robusto
          const cleanTitle = title.toLowerCase().replace(/official|audio|video|lyric|lyrics|\\(.*?\\)|\\[.*?\\]/g, '').trim();
          const dedupKey = cleanTitle;
          
          if (!uniqueSongs.has(dedupKey)) {
            const fileUrl = resolveMediaUrl(String(data.file_url ?? ''));
            uniqueSongs.set(dedupKey, {
              id: id,
              title: title,
              artist_name: data.artist ?? undefined,
              artist: data.artist ?? undefined,
              duration_seconds: data.duration_seconds ?? 0,
              file_url: fileUrl,
              url: data.url ?? undefined,
              image_url: data.image_url ?? undefined,
              imageUrl: data.image_url ?? undefined,
              youtube_id: data.youtube_id ?? undefined,
              source: data.source ?? undefined,
            } as Song);
          }
        });"""

    new_dedupe = """        console.log(`[recents/dedupe] before=${snap.docs.length}`);
        const candidates: any[] = snap.docs.map(d => ({ docId: d.id, data: d.data() }));
        const uniqueGroups = new Map<string, any[]>();
        
        candidates.forEach(({ docId, data }) => {
           const yId = data.youtube_id || data.sourceId || null;
           const cleanTitle = (data.title || '').toLowerCase().replace(/official|audio|video|lyric|lyrics|\\(.*?\\)|\\[.*?\\]/g, '').trim();
           const cleanArtist = (data.artist || data.artist_name || '').toLowerCase().trim();
           const groupKey = yId ? `yt:${yId}` : `txt:${cleanTitle}|${cleanArtist}`;
           if (!uniqueGroups.has(groupKey)) uniqueGroups.set(groupKey, []);
           uniqueGroups.get(groupKey)!.push({ docId, data });
        });
        
        const finalSongs: Song[] = [];
        const toDelete: string[] = [];
        
        uniqueGroups.forEach((group, key) => {
           if (group.length === 1) {
               const { docId, data } = group[0];
               finalSongs.push({
                  id: data.song_id ?? data.id ?? docId,
                  title: data.title ?? '',
                  artist_name: data.artist,
                  artist: data.artist,
                  duration_seconds: data.duration_seconds ?? 0,
                  file_url: resolveMediaUrl(String(data.file_url ?? '')),
                  url: data.url,
                  image_url: data.image_url,
                  imageUrl: data.image_url,
                  youtube_id: data.youtube_id,
                  source: data.source,
               } as Song);
           } else {
               // Rank them to keep the best one
               // rules: a) youtubeId b) file_url valid c) duration d) more metadata
               group.sort((a, b) => {
                   const score = (item: any) => {
                       let s = 0;
                       if (item.data.youtube_id || item.data.sourceId) s += 100;
                       if (item.data.file_url && !String(item.data.file_url).includes('stream-direct')) s += 50;
                       if (item.data.duration_seconds) s += 20;
                       if (item.data.image_url) s += 10;
                       return s;
                   };
                   return score(b) - score(a);
               });
               
               const best = group[0];
               finalSongs.push({
                  id: best.data.song_id ?? best.data.id ?? best.docId,
                  title: best.data.title ?? '',
                  artist_name: best.data.artist,
                  artist: best.data.artist,
                  duration_seconds: best.data.duration_seconds ?? 0,
                  file_url: resolveMediaUrl(String(best.data.file_url ?? '')),
                  url: best.data.url,
                  image_url: best.data.image_url,
                  imageUrl: best.data.image_url,
                  youtube_id: best.data.youtube_id,
                  source: best.data.source,
               } as Song);
               
               // Mark others as corrupt to delete
               for (let i = 1; i < group.length; i++) {
                   console.log(`[recents/dedupe] removed corrupt duplicate title="${group[i].data.title}" docId=${group[i].docId}`);
                   toDelete.push(group[i].docId);
               }
           }
        });
        
        console.log(`[recents/dedupe] after=${finalSongs.length}`);
        
        // Background deletion of corrupt docs
        if (toDelete.length > 0) {
           toDelete.forEach(id => {
               deleteDoc(doc(db, 'users', user.uid, 'recents', id)).catch(() => {});
           });
        }
        
        const uniqueSongs = new Map<string, Song>();
        finalSongs.forEach(s => {
           if (!uniqueSongs.has(s.id)) uniqueSongs.set(s.id, s);
        });"""

    if "removed corrupt duplicate title=" not in content:
        content = content.replace(old_dedupe, new_dedupe)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Home.tsx deduplication injected successfully")
    else:
        print("Already injected Home.tsx")

if __name__ == "__main__":
    main()
