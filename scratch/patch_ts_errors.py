import re

def main():
    paths = [
        "backend/src/utils/trackQuality.ts",
        "src/app/utils/trackQuality.ts"
    ]

    for path in paths:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        
        # fix let score = 0; -> let scorePenalty = 0;
        content = content.replace("let score = 0;", "let scorePenalty = 0;")
        content = content.replace("score -=", "scorePenalty -=")
        content = content.replace("score +=", "scorePenalty +=")
        
        # apply penalty at the end
        if "return score + scorePenalty;" not in content:
           content = content.replace("return score;", "return score + scorePenalty;")

        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    path = "backend/src/routes/music.ts"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # generateMusicSeedsWithDeepSeek(profile)
    content = content.replace("generateMusicSeedsWithDeepSeek(profile)", "generateMusicSeedsWithDeepSeek(profile as any)")
    
    # ...profile.recentSearches
    content = content.replace("...(profile.recentSearches || [])", "...(profile?.recentSearches || [])")
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
