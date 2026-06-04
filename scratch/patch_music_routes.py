import re

def main():
    path = "backend/src/services/deepseekRecommendations.ts"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Enhance system prompt
    system_prompt = """const system = [
    'Eres un asistente experto musical. Tu único trabajo es generar queries cortas para buscar canciones oficiales en YouTube.',
    'Debes responder SOLO con JSON válido y NADA MÁS. Formato: {"queries":["..."]}',
    'REGLA ESTRICTA 1: NO generes búsquedas de tutoriales, podcasts, cursos, software, "how to", "setup", "guide" o similares.',
    'REGLA ESTRICTA 2: Busca "official audio" o "official video" siempre que sea posible.',
    'REGLA ESTRICTA 3: Usa los artistas y gustos del perfil del usuario.',
    'No incluyas explicaciones, no uses markdown, no uses code fences.',
    'Máximo 8 queries, sin duplicados.',
  ].join('\\n');"""
    
    content = re.sub(r"const system = \[\s*'(.*?)',\s*'(.*?)',\s*'(.*?)',\s*'(.*?)',\s*'(.*?)',\s*'(.*?)',\s*'(.*?)',\s*\].join\('\\\\n'\);", system_prompt, content, flags=re.DOTALL)
    if "Eres un asistente experto musical" not in content:
         # fallback if regex failed
         content = re.sub(r"const system = \[\n.*?\]\.join\('\\\\n'\);", system_prompt, content, flags=re.DOTALL)

    # Validate output
    validation = """
    try {
      const parsed = JSON.parse(text);
      if (parsed.queries && Array.isArray(parsed.queries)) {
        let validQueries = parsed.queries.filter((q: any) => typeof q === 'string' && q.trim().length > 0);
        // Filter out toxic stuff
        validQueries = validQueries.filter((q: string) => {
           const lower = q.toLowerCase();
           return !lower.includes('tutorial') && !lower.includes('setup') && !lower.includes('guide') && !lower.includes('mixer') && !lower.includes('audio university') && !lower.includes('software');
        });
        const final = dedupeAndLimit(validQueries, 15);
"""
    content = re.sub(r"try \{\s*const parsed = JSON\.parse\(text\);\s*if \(parsed\.queries && Array\.isArray\(parsed\.queries\)\) \{\s*const valid = parsed\.queries\s*\.filter\(\(q: any\) => typeof q === 'string' && q\.trim\(\)\.length > 0\);\s*const final = dedupeAndLimit\(valid, 15\);", validation, content)
    
    if "let validQueries =" not in content:
         content = content.replace("const valid = parsed.queries", "let validQueries = parsed.queries").replace("const final = dedupeAndLimit(valid, 15);", """
        validQueries = validQueries.filter((q: string) => {
           const lower = q.toLowerCase();
           return !lower.includes('tutorial') && !lower.includes('setup') && !lower.includes('guide') && !lower.includes('mixer') && !lower.includes('audio university') && !lower.includes('software');
        });
        const final = dedupeAndLimit(validQueries, 15);
""")

    # buildPersonalizedSeeds
    build_seeds = """
export const buildPersonalizedSeeds = (profile: any, maxQueries = 12) => {
  const raw: string[] = [];
  const artists = Array.isArray(profile?.topArtists) ? profile.topArtists : [];
  const genres = Array.isArray(profile?.topGenres) ? profile.topGenres : [];
  const recentTracks = Array.isArray(profile?.recentTracks) ? profile.recentTracks : [];
  const likedTracks = Array.isArray(profile?.likedTracks) ? profile.likedTracks : [];
  
  if (artists.length > 0) {
    raw.push(`${artists[0]} hits official audio`);
    raw.push(`${artists[0]} official audio`);
    if (artists.length > 1) raw.push(`${artists[1]} official audio`);
    if (artists.length > 2) raw.push(`similar to ${artists[0]} ${artists[1]} official audio`);
  }
  
  for (const t of recentTracks.slice(0, 3)) raw.push(`${t} official audio`);
  for (const t of likedTracks.slice(0, 3)) raw.push(`${t} official audio`);
  for (const g of genres.slice(0, 2)) raw.push(`${g} official audio`);

  if (profile?.currentTrack?.artist) raw.push(`${profile.currentTrack.artist} official audio`);

  return dedupeAndLimit(raw, Math.max(1, maxQueries)) as string[];
};
"""
    if "export const buildPersonalizedSeeds" not in content:
        content = content + "\n" + build_seeds

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


    # In routes/music.ts, use rankForYouCandidate and buildPersonalizedSeeds
    path_routes = "backend/src/routes/music.ts"
    with open(path_routes, "r", encoding="utf-8") as f:
        content_r = f.read()
    
    if "import { rankForYouCandidate } from '../utils/trackQuality';" not in content_r:
        content_r = content_r.replace("import { isLikelyMusicTrack, rankRecommendationCandidate } from '../utils/trackQuality';", "import { isLikelyMusicTrack, rankRecommendationCandidate, rankForYouCandidate } from '../utils/trackQuality';")

    if "import { generateLocalMusicQueries, mixQueries, generateMusicSeedsWithDeepSeek } from '../services/deepseekRecommendations';" in content_r:
        content_r = content_r.replace("import { generateLocalMusicQueries, mixQueries, generateMusicSeedsWithDeepSeek } from '../services/deepseekRecommendations';", "import { generateLocalMusicQueries, mixQueries, generateMusicSeedsWithDeepSeek, buildPersonalizedSeeds } from '../services/deepseekRecommendations';")

    # In /for-you route, replace candidates generation
    replace_candidates = """
      if (positiveSeeds.length > 0) {
        const positiveOnly = positiveSeeds.slice(0, 3);
        candidates.splice(0, 0, ...positiveOnly.map((q) => ({ q, source: 'personalized' as ItemsSource })));
      }

      const pSeeds = buildPersonalizedSeeds(profile);
      for (const s of pSeeds) {
         candidates.push({ q: s, source: 'personalized' });
      }

      const localQs = candidates.map((c) => c.q);
"""
    content_r = re.sub(r"if \(positiveSeeds\.length > 0\) \{\s*const positiveOnly = positiveSeeds\.slice\(0, 3\);\s*candidates\.splice\(0, 0, \.\.\.positiveOnly\.map\(\(q\) => \(\{ q, source: 'personalized' as ItemsSource \}\)\)\);\s*\}\s*const localQs = candidates\.map\(\(c\) => c\.q\);", replace_candidates, content_r)

    # In /for-you dedupe and filter, replace ranking:
    content_r = content_r.replace("const scoreA = rankRecommendationCandidate(usedQuery, '', a);", "const scoreA = rankForYouCandidate(profile, a);")
    content_r = content_r.replace("const scoreB = rankRecommendationCandidate(usedQuery, '', b);", "const scoreB = rankForYouCandidate(profile, b);")
    content_r = content_r.replace("const scoreA = rankRecommendationCandidate(usedQuery, '', a, profile);", "const scoreA = rankForYouCandidate(profile, a);")
    content_r = content_r.replace("const scoreB = rankRecommendationCandidate(usedQuery, '', b, profile);", "const scoreB = rankForYouCandidate(profile, b);")

    # Filter out score < 0 or something
    # The deduper might just sort them, but we should remove bad scores
    # Actually dedupeAndFilterItems just takes the list. 
    # Let's filter out bad scores before sending to dedupeAndFilterItems if we want.
    filter_bad = """
      if (Array.isArray(ytResults)) {
         ytResults = ytResults.filter(item => rankForYouCandidate(profile, item) > 0);
      }
      for (const item of ytResults) {
"""
    content_r = content_r.replace("for (const item of ytResults) {", filter_bad)

    with open(path_routes, "w", encoding="utf-8") as f:
        f.write(content_r)

if __name__ == "__main__":
    main()
