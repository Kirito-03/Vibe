import re

def main():
    path = "backend/src/routes/music.ts"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. FIX FOR-YOU FALLBACK
    old_for_you_exec = """      if (candidates.length === 0) {
        return res.json({ items: [], source: 'empty' });
      }"""

    new_for_you_exec = """      if (candidates.length === 0) {
        console.log('[home/for-you] empty-profile using fallback');
        const fallbackQueries = [
          "latin pop official audio",
          "new music official audio",
          "reggaeton hits official audio",
          "anime music official audio",
          "pop music official audio"
        ];
        const randomQuery = fallbackQueries[Math.floor(Math.random() * fallbackQueries.length)];
        candidates.push({ q: randomQuery, source: 'fallback' as any });
      }"""
    
    if old_for_you_exec in content:
        content = content.replace(old_for_you_exec, new_for_you_exec)
    else:
        print("COULD NOT FIND old_for_you_exec")

    # 2. FIX RECOMMENDATIONS FALLBACK
    old_rec_empty = """    if (candidates.length === 0) {
      if (isDev()) console.log(`[music/recommendations] reqId=${reqId} using base fallback`);
      for (const t of localQueries.slice(0, 3)) candidates.push({ q: t, source: 'fallback' });
    }"""
    
    new_rec_empty = """    if (candidates.length === 0) {
      console.log('[home/recommendations] empty-profile using fallback');
      const fallbackQueries = [
        "latin pop official audio",
        "new music official audio",
        "reggaeton hits official audio",
        "anime music official audio",
        "pop music official audio"
      ];
      const randomQuery = fallbackQueries[Math.floor(Math.random() * fallbackQueries.length)];
      candidates.push({ q: randomQuery, source: 'fallback' as any });
    }"""
    
    if old_rec_empty in content:
        content = content.replace(old_rec_empty, new_rec_empty)
    else:
        print("COULD NOT FIND old_rec_empty")
        
    # Let's also check if there's another place where recommendations returns empty
    old_rec_empty_return = """    if (candidates.length === 0) {
      return res.json({ items: [], source: 'empty' });
    }"""
    
    if old_rec_empty_return in content:
        content = content.replace(old_rec_empty_return, new_rec_empty)
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
        
if __name__ == "__main__":
    main()
