import re

def main():
    path = "backend/src/routes/music.ts"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Add import
    content = content.replace("import { computeMusicProfileHash, generateMusicSeedsWithDeepSeek, mixQueries, type MusicTasteProfile } from '../services/deepseekRecommendations';", "import { computeMusicProfileHash, generateMusicSeedsWithDeepSeek, mixQueries, buildPersonalizedSeeds, type MusicTasteProfile } from '../services/deepseekRecommendations';")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
