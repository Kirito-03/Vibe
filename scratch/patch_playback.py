import re

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Import trackQuality
    import_stmt = "import { isLikelyMusicTrack, rankRecommendationCandidate } from '../utils/trackQuality';\n"
    if "isLikelyMusicTrack" not in content:
        content = content.replace("import type { Song, Track } from '../types';", import_stmt + "import type { Song, Track } from '../types';")

    # The user asked: "4. Si Firestore no tiene datos pero localStorage sí: validar, si está corrupto, eliminar..."
    # And "Limpiar lastPlayed corrupto si ya no existe fuente válida."
    
    # Let's patch the local storage logic in PlaybackContext's persisted useMemo
    old_persisted = """    try {
      const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) console.log(`[storage] key=${getUserStorageKey('vns_lastPlayed', user?.uid)}`);
      return k ? safeJsonParse<PersistedPlaybackState>(localStorage.getItem(k)) : null;
    } catch (err) {"""

    new_persisted = """    try {
      const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) console.log(`[storage] key=${getUserStorageKey('vns_lastPlayed', user?.uid)}`);
      if (k) {
        const data = safeJsonParse<PersistedPlaybackState>(localStorage.getItem(k));
        if (data?.currentTrack && (!data.currentTrack.youtube_id && !data.currentTrack.sourceId && !data.currentTrack.url)) {
           // Si no tiene fuente válida, mejor limpiar este state corrupto en vez de arrastrarlo.
           console.log('[playback/rehydrate] clearing stale local track', data.currentTrack);
           localStorage.removeItem(k);
           return null;
        }
        return data;
      }
      return null;
    } catch (err) {"""
    
    if old_persisted in content:
        content = content.replace(old_persisted, new_persisted)
        
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
