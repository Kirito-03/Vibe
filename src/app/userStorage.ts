export function getUserStorageKey(baseKey: string, uid?: string | null): string | null {
  if (!uid || typeof uid !== "string" || !uid.trim()) return null;
  return `${baseKey}:${uid}`;
}

export function getRequiredUserStorageKey(baseKey: string, uid?: string | null): string {
  return `${baseKey}:${uid || "anonymous"}`;
}

export function cleanupLegacyPlaybackStorage() {
  const legacyKeys = [
    "vns_lastPlayed",
    "vns_playback_state",
    "vns_queue",
    "vns_resumeCandidate",
  ];

  for (const key of legacyKeys) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {}
  }
}
