import re

def main():
    path = "backend/src/routes/music.ts"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    replacement = """
      let builtProfile: any = null;
      try {
        builtProfile = await buildUserMusicProfile(uid);
      } catch (err) {
        console.error('[music/for-you] buildUserMusicProfile failed', err);
      }

      profile = {
        userId: uid,
        topArtists: builtProfile?.topArtists || topArtists,
        topGenres: [],
        recentTracks: recentTracks.slice(0, 10),
        likedTracks: builtProfile?.likedTracks?.length ? builtProfile.likedTracks : likedTracks.slice(0, 10),
        recentSearches: recentSearches.slice(0, 10),
        currentTrack,
        preferredLanguage: 'es',
        skippedPatterns: builtProfile?.skippedPatterns || []
      } as any;
"""
    if "builtProfile = await buildUserMusicProfile(uid);" not in content:
        # Replace the manual profile building
        pattern = r"profile\s*=\s*\{\s*userId:\s*uid,\s*topArtists,\s*topGenres:\s*\[\],\s*recentTracks:\s*recentTracks\.slice\(0,\s*10\),\s*likedTracks:\s*likedTracks\.slice\(0,\s*10\),\s*recentSearches:\s*recentSearches\.slice\(0,\s*10\),\s*currentTrack,\s*preferredLanguage:\s*'es',\s*\};"
        content = re.sub(pattern, replacement, content)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    path2 = "backend/src/services/deepseekRecommendations.ts"
    with open(path2, "r", encoding="utf-8") as f:
        content2 = f.read()

    if "skippedPatterns:" not in content2:
        content2 = content2.replace("likedTracks?: string[];", "likedTracks?: string[];\n  skippedPatterns?: string[];")
        content2 = content2.replace("likedTracks: Array.isArray(profile.likedTracks) ? profile.likedTracks.slice(0, 15) : [],", "likedTracks: Array.isArray(profile.likedTracks) ? profile.likedTracks.slice(0, 15) : [],\n    skippedPatterns: Array.isArray(profile.skippedPatterns) ? profile.skippedPatterns.slice(0, 15) : [],")
        
        user_replacement = """
  const user = stableStringify({
    preferredLanguage,
    topArtists,
    topGenres,
    recentTracks,
    likedTracks,
    skippedPatterns: Array.isArray(profile.skippedPatterns) ? profile.skippedPatterns : [],
    recentSearches,
    currentTrack: profile.currentTrack || null,
  });
"""
        content2 = re.sub(r"const user = stableStringify\(\{[\s\S]*?\}\);", user_replacement.strip(), content2)

    with open(path2, "w", encoding="utf-8") as f:
        f.write(content2)

if __name__ == "__main__":
    main()
