import re

def main():
    # 1. Update recommendationRanking.ts to use isLikelyMusicTrack
    path_rank = "backend/src/services/recommendationRanking.ts"
    with open(path_rank, "r", encoding="utf-8") as f:
        content_rank = f.read()
        
    old_rank_import = "import { normalizeText } from './searchRanking';"
    new_rank_import = "import { normalizeText } from './searchRanking';\nimport { isLikelyMusicTrack } from '../utils/trackQuality';"
    if "isLikelyMusicTrack" not in content_rank:
        content_rank = content_rank.replace(old_rank_import, new_rank_import)
        
    old_rank_score = """    for (const a of topArtistTokens) {
      if (a && artistNorm && (artistNorm === a || artistNorm.includes(a))) score += 12;
    }

    if (/\\bofficial\\s+(audio|music\\s+video)\\b/i.test(titleNorm)) score += 3;
    if (String(it?.thumbnail_url || it?.thumbnail || '').trim()) score += 2;"""

    new_rank_score = """    for (const a of topArtistTokens) {
      if (a && artistNorm && (artistNorm === a || artistNorm.includes(a))) score += 12;
    }

    if (/\\bofficial\\s+(audio|music\\s+video)\\b/i.test(titleNorm)) score += 3;
    if (String(it?.thumbnail_url || it?.thumbnail || '').trim()) score += 2;
    
    if (!isLikelyMusicTrack(it.title, it.artist)) score -= 1000;"""
    
    if "isLikelyMusicTrack(it.title" not in content_rank:
        content_rank = content_rank.replace(old_rank_score, new_rank_score)

    old_rank_sort = """  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.it);"""
    
    new_rank_sort = """  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > -500).map((s) => s.it);"""
  
    if "s.score > -500" not in content_rank:
        content_rank = content_rank.replace(old_rank_sort, new_rank_sort)

    with open(path_rank, "w", encoding="utf-8") as f:
        f.write(content_rank)

    # 2. Update music.ts fallback queries
    path_music = "backend/src/routes/music.ts"
    with open(path_music, "r", encoding="utf-8") as f:
        content_music = f.read()

    old_fallback = """      const fallbackQueries = [
        "latin pop official audio",
        "new music official audio",
        "reggaeton hits official audio",
        "anime music official audio",
        "pop music official audio"
      ];"""
    
    new_fallback = """      const fallbackQueries = [
        "latin pop official audio",
        "reggaeton hits official audio",
        "pop music official audio",
        "new music official audio",
        "anime music official audio",
        "bad bunny official audio",
        "karol g official audio",
        "tainy official audio"
      ];"""
      
    if "bad bunny official audio" not in content_music:
        content_music = content_music.replace(old_fallback, new_fallback)

    with open(path_music, "w", encoding="utf-8") as f:
        f.write(content_music)

    print("Patched backend music routing and ranking.")

if __name__ == "__main__":
    main()
