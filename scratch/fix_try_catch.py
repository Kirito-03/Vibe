import re

def main():
    path_appshell = "src/app/AppShell.tsx"
    with open(path_appshell, "r", encoding="utf-8") as f:
        content_appshell = f.read()

    # Wrap the AppShell storage access
    old_appshell_storage = """    const lpKey = getUserStorageKey('vns_lastPlayed', user.uid);
    if (!lpKey) return;
    const saved = localStorage.getItem(lpKey);
    if (!saved) {"""
    
    new_appshell_storage = """    let saved = null;
    try {
      const lpKey = getUserStorageKey('vns_lastPlayed', user.uid);
      if (!lpKey) return;
      saved = localStorage.getItem(lpKey);
    } catch (err) {
      console.warn("[storage] failed", err);
    }
    if (!saved) {"""

    if old_appshell_storage in content_appshell:
        content_appshell = content_appshell.replace(old_appshell_storage, new_appshell_storage)

    with open(path_appshell, "w", encoding="utf-8") as f:
        f.write(content_appshell)

    path_playback = "src/app/context/PlaybackContext.tsx"
    with open(path_playback, "r", encoding="utf-8") as f:
        content_playback = f.read()

    # Wrap persisted useMemo
    old_playback_persisted = """  const persisted = useMemo(() => {
    const k = getUserStorageKey(STORAGE_KEY, user?.uid);
    if (k) console.log(`[storage] key=${getUserStorageKey('vns_lastPlayed', user?.uid)}`);
    return k ? safeJsonParse<PersistedPlaybackState>(localStorage.getItem(k)) : null;
  }, [user?.uid]);"""

    new_playback_persisted = """  const persisted = useMemo(() => {
    try {
      const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) console.log(`[storage] key=${getUserStorageKey('vns_lastPlayed', user?.uid)}`);
      return k ? safeJsonParse<PersistedPlaybackState>(localStorage.getItem(k)) : null;
    } catch (err) {
      console.warn("[storage] failed", err);
      return null;
    }
  }, [user?.uid]);"""

    if old_playback_persisted in content_playback:
        content_playback = content_playback.replace(old_playback_persisted, new_playback_persisted)

    with open(path_playback, "w", encoding="utf-8") as f:
        f.write(content_playback)

if __name__ == "__main__":
    main()
