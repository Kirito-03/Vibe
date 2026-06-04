import re

def main():
    paths = [
        "backend/src/utils/trackQuality.ts",
        "src/app/utils/trackQuality.ts"
    ]

    addition = """
  // Demote bad terms based on user input
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('exporting files') || lowerTitle.includes('luna -') || lowerTitle.includes('tutorial') || lowerTitle.includes('how to')) {
    score -= 100;
  }
  if (lowerTitle.includes('karaoke') || lowerTitle.includes('instrumental') || lowerTitle.includes('cover')) {
    score -= 50;
  }
  if (lowerTitle.includes('live')) {
    score -= 20;
  }
  if (lowerTitle.includes('podcast') || lowerTitle.includes('episode')) {
    score -= 80;
  }
"""

    for path in paths:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        
        if "exporting files" not in content:
            content = content.replace("export function rankRecommendationCandidate(seedTitle: string, seedArtist: string, candidate: any): number {", "export function rankRecommendationCandidate(seedTitle: string, seedArtist: string, candidate: any, profile?: any): number {\n  let score = 0;\n  const title = String(candidate?.title || '');\n  const artist = String(candidate?.artist || candidate?.uploader || '');\n" + addition)
            
            # remove duplicate let score = 0; if it exists
            content = re.sub(r"let score = 0;\s*const title = String\(candidate\?\.title \|\| ''\);\s*const artist = String\(candidate\?\.artist \|\| candidate\?\.uploader \|\| ''\);\s*let score = 0;", "let score = 0;\n  const title = String(candidate?.title || '');\n  const artist = String(candidate?.artist || candidate?.uploader || '');\n", content)

            if "profile?.topArtists" not in content:
               profile_add = """
  if (profile?.topArtists?.some((a: string) => a.toLowerCase() === artist.toLowerCase())) {
     score += 30;
  }
  if (profile?.skippedPatterns?.some((p: string) => lowerTitle.includes(p.toLowerCase()))) {
     score -= 50;
  }
"""
               content = content.replace("if (lowerTitle.includes('live')) {", profile_add + "  if (lowerTitle.includes('live')) {")

        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

if __name__ == "__main__":
    main()
