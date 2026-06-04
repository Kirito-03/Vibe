import re

def main():
    path_playback = "src/app/context/PlaybackContext.tsx"
    with open(path_playback, "r", encoding="utf-8") as f:
        content_playback = f.read()

    # Fix the react import
    old_react_import = """import {
  cleanSourceValue,
  getUserStorageKey,
  cleanupLegacyPlaybackStorage, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';"""

    new_react_import = """import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getUserStorageKey, cleanupLegacyPlaybackStorage } from '../userStorage';
import { cleanSourceValue } from '../utils';"""

    if "getUserStorageKey" in old_react_import and old_react_import in content_playback:
        content_playback = content_playback.replace(old_react_import, new_react_import)
    elif "getUserStorageKey" not in content_playback:
        # Just in case it's already fixed?
        pass

    with open(path_playback, "w", encoding="utf-8") as f:
        f.write(content_playback)

    path_appshell = "src/app/AppShell.tsx"
    with open(path_appshell, "r", encoding="utf-8") as f:
        content_appshell = f.read()

    old_appshell_import = "import { getUserStorageKey } from './utils';"
    new_appshell_import = "import { getUserStorageKey } from './userStorage';"
    if old_appshell_import in content_appshell:
        content_appshell = content_appshell.replace(old_appshell_import, new_appshell_import)
    
    with open(path_appshell, "w", encoding="utf-8") as f:
        f.write(content_appshell)

    path_utils = "src/app/utils.ts"
    with open(path_utils, "r", encoding="utf-8") as f:
        content_utils = f.read()

    # Remove the old definitions from utils.ts if they exist
    old_utils_storage = """export const getUserStorageKey = (baseKey: string, uid?: string | null): string | null => {
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
};"""

    if old_utils_storage in content_utils:
        content_utils = content_utils.replace(old_utils_storage, "")

    with open(path_utils, "w", encoding="utf-8") as f:
        f.write(content_utils)

if __name__ == "__main__":
    main()
