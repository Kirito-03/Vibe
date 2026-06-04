import re

def main():
    # 1. Update src/app/utils.ts
    path_utils = "src/app/utils.ts"
    with open(path_utils, "r", encoding="utf-8") as f:
        content_utils = f.read()

    helper_utils = """
export const getUserStorageKey = (baseKey: string, uid?: string | null): string | null => {
  if (!uid) return null;
  return `${baseKey}:${uid}`;
};

export const cleanupLegacyPlaybackStorage = () => {
  try {
    console.log('[storage] cleanup legacy global keys');
    localStorage.removeItem('vns_lastPlayed');
    localStorage.removeItem('vns_playback_state_v1');
    localStorage.removeItem('vns_playback_state');
    localStorage.removeItem('vns_queue');
    localStorage.removeItem('vns_resumeCandidate');
  } catch (e) {}
};
"""
    if "getUserStorageKey" not in content_utils:
        content_utils = content_utils + helper_utils
        with open(path_utils, "w", encoding="utf-8") as f:
            f.write(content_utils)

    # 2. Update PlaybackContext.tsx
    path_playback = "src/app/context/PlaybackContext.tsx"
    with open(path_playback, "r", encoding="utf-8") as f:
        content_playback = f.read()

    if "getUserStorageKey" not in content_playback:
        content_playback = content_playback.replace(
            "import {\n  cleanSourceValue,",
            "import {\n  cleanSourceValue,\n  getUserStorageKey,\n  cleanupLegacyPlaybackStorage,"
        )

    cleanup_effect = """
  useEffect(() => {
    cleanupLegacyPlaybackStorage();
  }, []);
"""
    if "cleanupLegacyPlaybackStorage()" not in content_playback:
        content_playback = content_playback.replace("export const PlaybackProvider = ({ user, children }: PlaybackProviderProps) => {", 
                                                    "export const PlaybackProvider = ({ user, children }: PlaybackProviderProps) => {" + cleanup_effect)

    user_change_effect = """
  const prevUserRef = useRef<string | null>(null);
  useEffect(() => {
    const currentUid = user?.uid || null;
    if (prevUserRef.current !== null && prevUserRef.current !== currentUid) {
      console.log(`[playback/user-change] from=${prevUserRef.current} to=${currentUid}`);
      pause();
      setCurrentSong(null);
      setQueue([]);
    }
    prevUserRef.current = currentUid;
  }, [user?.uid]);
"""
    if "[playback/user-change]" not in content_playback:
        content_playback = content_playback.replace("cleanupLegacyPlaybackStorage();\n  }, []);", 
                                                    "cleanupLegacyPlaybackStorage();\n  }, []);" + user_change_effect)

    old_persisted = """  const persisted = useMemo(() => safeJsonParse<PersistedPlaybackState>(localStorage.getItem(STORAGE_KEY)), []);"""
    new_persisted = """  const persisted = useMemo(() => {
    const k = getUserStorageKey(STORAGE_KEY, user?.uid);
    if (k) console.log(`[storage] key=${getUserStorageKey('vns_lastPlayed', user?.uid)}`);
    return k ? safeJsonParse<PersistedPlaybackState>(localStorage.getItem(k)) : null;
  }, [user?.uid]);"""
    content_playback = content_playback.replace(old_persisted, new_persisted)
    
    # saving state
    old_save_state = """      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));"""
    new_save_state = """      const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) localStorage.setItem(k, JSON.stringify(state));"""
    content_playback = content_playback.replace(old_save_state, new_save_state)

    old_remove_state = """      localStorage.removeItem(STORAGE_KEY);"""
    new_remove_state = """      const k = getUserStorageKey(STORAGE_KEY, user?.uid);
      if (k) localStorage.removeItem(k);"""
    content_playback = content_playback.replace(old_remove_state, new_remove_state)

    # Rehydrate
    old_rehydrate_start = """  useEffect(() => {
    let active = true;

    const rehydrate = async () => {
      const savedPlayback = localStorage.getItem(STORAGE_KEY);
      if (!savedPlayback) return;"""
    new_rehydrate_start = """  useEffect(() => {
    let active = true;

    const rehydrate = async () => {
      if (!user?.uid) return;
      const lpKey = getUserStorageKey('vns_lastPlayed', user.uid);
      const stateKey = getUserStorageKey(STORAGE_KEY, user.uid);
      console.log(`[playback/rehydrate] uid=${user.uid}`);
      const savedPlayback = localStorage.getItem(stateKey!);
      if (!savedPlayback) return;"""
    content_playback = content_playback.replace(old_rehydrate_start, new_rehydrate_start)
    
    old_rehydrate_clear = """         localStorage.removeItem('vns_lastPlayed');
         const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
         state.currentTrack = null;
         localStorage.setItem(STORAGE_KEY, JSON.stringify(state));"""
    new_rehydrate_clear = """         localStorage.removeItem(lpKey!);
         const state = JSON.parse(localStorage.getItem(stateKey!) || '{}');
         state.currentTrack = null;
         localStorage.setItem(stateKey!, JSON.stringify(state));"""
    content_playback = content_playback.replace(old_rehydrate_clear, new_rehydrate_clear)
    
    # other removes
    old_remove_lp = """             localStorage.removeItem('vns_lastPlayed');
             const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
             state.currentTrack = null;
             localStorage.setItem(STORAGE_KEY, JSON.stringify(state));"""
    new_remove_lp = """             localStorage.removeItem(lpKey!);
             const state = JSON.parse(localStorage.getItem(stateKey!) || '{}');
             state.currentTrack = null;
             localStorage.setItem(stateKey!, JSON.stringify(state));"""
    content_playback = content_playback.replace(old_remove_lp, new_remove_lp)

    # Setting lastPlayed during normal play
    old_set_lp = """      localStorage.setItem('vns_lastPlayed', JSON.stringify({
        id: song.id,"""
    new_set_lp = """      const lpKey = getUserStorageKey('vns_lastPlayed', user?.uid);
      if (lpKey) localStorage.setItem(lpKey, JSON.stringify({
        id: song.id,"""
    content_playback = content_playback.replace(old_set_lp, new_set_lp)
    
    content_playback = content_playback.replace("localStorage.removeItem('vns_lastPlayed')", "if (user?.uid) localStorage.removeItem(getUserStorageKey('vns_lastPlayed', user.uid)!)")

    with open(path_playback, "w", encoding="utf-8") as f:
        f.write(content_playback)

if __name__ == "__main__":
    main()
