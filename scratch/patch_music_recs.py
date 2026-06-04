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
        console.error('[music/recommendations] buildUserMusicProfile failed', err);
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
    # Just in case they share similar profile building. I'll replace it in recommendationsHandler.
    pattern = r"profile\s*=\s*\{\s*userId:\s*uid,\s*topArtists,\s*topGenres:\s*\[\],\s*recentTracks:\s*recentTracks\.slice\(0,\s*10\),\s*likedTracks:\s*likedTracks\.slice\(0,\s*10\),\s*recentSearches:\s*recentSearches\.slice\(0,\s*10\),\s*currentTrack,\s*preferredLanguage:\s*'es',\s*\};"
    content = re.sub(pattern, replacement, content)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
