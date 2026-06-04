import re

def main():
    # 1. Update src/app/utils.ts
    path_utils = "src/app/utils.ts"
    with open(path_utils, "r", encoding="utf-8") as f:
        content_utils = f.read()

    new_helper = """
export const cleanSourceValue = (value: any): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '' || s === 'null' || s === 'undefined' || s === 'NaN' || s === 'dl-null' || s === '/api/downloads/stream/null' || s.endsWith('/stream/null') || s.includes('watch?v=null')) {
    return null;
  }
  return s;
};
"""
    if "cleanSourceValue" not in content_utils:
        with open(path_utils, "w", encoding="utf-8") as f:
            f.write(content_utils + new_helper)

    # 2. Update PlaybackContext.tsx
    path_playback = "src/app/context/PlaybackContext.tsx"
    with open(path_playback, "r", encoding="utf-8") as f:
        content_playback = f.read()

    # Import cleanSourceValue
    if "cleanSourceValue" not in content_playback:
        content_playback = content_playback.replace("import { formatTotalDuration", "import { formatTotalDuration, cleanSourceValue")
        if "import { cleanSourceValue" not in content_playback and "formatTotalDuration, cleanSourceValue" not in content_playback:
             content_playback = content_playback.replace("import {", "import {\n  cleanSourceValue,", 1)

    # 2.1 Rehydrate logic
    old_rehydrate_url = """      const ytId = track.youtube_id || track.sourceId;
      const url = track.url || track.file_url;
      
      if (ytId || url) {"""

    new_rehydrate_url = """      const ytId = cleanSourceValue(track.youtube_id || track.sourceId);
      const url = cleanSourceValue(track.url || track.file_url);
      
      if (ytId || url) {"""
    content_playback = content_playback.replace(old_rehydrate_url, new_rehydrate_url)

    # 2.2 Rehydrate clean lastPlayed (from prompt item 7)
    old_parsed_check = """      if (!parsed?.currentTrack) return;
      
      if (audioRef.current) return;"""
      
    new_parsed_check = """      if (!parsed?.currentTrack) return;
      
      const ptrack = parsed.currentTrack;
      if (ptrack.id === 'dl-null' || ptrack.audioUrl === '/api/downloads/stream/null' || ptrack.youtubeId === 'null') {
         console.log('[playback/rehydrate] invalid saved track clearing');
         localStorage.removeItem('vns_lastPlayed');
         const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
         state.currentTrack = null;
         localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
         return;
      }
      
      if (audioRef.current) return;"""
    content_playback = content_playback.replace(old_parsed_check, new_parsed_check)
    
    # 2.3 prepareAudioAsync / playSongInternal logic
    old_prepare_ytId = """        const ytId = song.youtube_id || null;
        let dlRes = await apiFetch('/api/downloads', {"""
        
    new_prepare_ytId = """        const ytId = cleanSourceValue(song.youtube_id || song.sourceId || song.videoId);
        const url = cleanSourceValue(song.url || song.webpage_url);
        const audioUrl = cleanSourceValue(song.file_url);
        
        if (!ytId && !url) {
           console.log('[playback/prepare] invalid source cleaned');
           if (song.title && (song.artist || song.artist_name)) {
              console.debug(`[playback/repair] start reason=MISSING_TRACK_SOURCE_CLIENT`);
              const repairedSong = await repairTrack(song);
              if (repairedSong && isMyGen()) {
                playSongInternal(repairedSong, playlist, isCrossfade, opts);
                return;
              }
           }
           console.log('[playback/prepare] clearing corrupt item');
           if (isMyGen()) {
             setPlaybackError('Esta canciA3n estA! corrupta. BAs\xcala nuevamente.');
             setIsResolvingAudio(false);
           }
           return;
        }
        
        let dlRes = await apiFetch('/api/downloads', {"""
    
    old_payload_url = """url: ytId ? `https://www.youtube.com/watch?v=${ytId}` : (finalAudioUrl || ''),"""
    new_payload_url = """url: ytId ? `https://www.youtube.com/watch?v=${ytId}` : (url || audioUrl || ''),"""
    
    content_playback = content_playback.replace(old_prepare_ytId, new_prepare_ytId)
    content_playback = content_playback.replace(old_payload_url, new_payload_url)
    
    # In rehydrate, the payload also has url
    old_rehydrate_payload_url = """url: reqUrl,"""
    new_rehydrate_payload_url = """url: ytId ? `https://www.youtube.com/watch?v=${ytId}` : (url || ''),"""
    content_playback = content_playback.replace(old_rehydrate_payload_url, new_rehydrate_payload_url)

    with open(path_playback, "w", encoding="utf-8") as f:
        f.write(content_playback)

    # 3. Update Library.tsx
    path_lib = "src/app/components/Library.tsx"
    with open(path_lib, "r", encoding="utf-8") as f:
        content_lib = f.read()
        
    if "import { cleanSourceValue" not in content_lib:
        content_lib = content_lib.replace("import { formatDuration } from '../utils';", "import { formatDuration, cleanSourceValue } from '../utils';")
    
    old_recents_filter = """  const filteredRecents = query
    ? (recents || []).filter((r: any) => 
        r.title?.toLowerCase().includes(query.toLowerCase()) || 
        r.artist?.toLowerCase().includes(query.toLowerCase())
      )
    : recents || [];"""
    
    new_recents_filter = """  const filteredRecents = query
    ? (recents || []).filter((r: any) => 
        r.title?.toLowerCase().includes(query.toLowerCase()) || 
        r.artist?.toLowerCase().includes(query.toLowerCase())
      )
    : recents || [];

  const validRecents = filteredRecents.filter((r: any) => {
    const yId = cleanSourceValue(r.youtube_id || r.sourceId || r.videoId);
    const url = cleanSourceValue(r.url || r.file_url || r.audioUrl);
    if (!yId && !url) {
      if (!r.title || !r.artist) return false;
    }
    return true;
  });"""
    content_lib = content_lib.replace(old_recents_filter, new_recents_filter)
    
    content_lib = content_lib.replace("filteredRecents.map((item: any)", "validRecents.map((item: any)")
    
    with open(path_lib, "w", encoding="utf-8") as f:
        f.write(content_lib)
        
    # 4. Update backend downloads.ts
    path_downloads = "backend/src/routes/downloads.ts"
    with open(path_downloads, "r", encoding="utf-8") as f:
        content_downloads = f.read()
        
    helper_backend = """
const cleanSourceValue = (value: any): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '' || s === 'null' || s === 'undefined' || s === 'NaN' || s === 'dl-null' || s === '/api/downloads/stream/null' || s.endsWith('/stream/null') || s.includes('watch?v=null')) {
    return null;
  }
  return s;
};
"""
    if "cleanSourceValue" not in content_downloads:
        content_downloads = content_downloads.replace("import { createRouteHandler }", helper_backend + "\nimport { createRouteHandler }")
        if "import { createRouteHandler }" not in content_downloads:
             content_downloads = helper_backend + "\n" + content_downloads

    old_dl_post = """router.post('/', async (req, res) => {
  const reqId = makeReqId();
  try {
    const { url, title, uploader, mode, format, override_id, youtube_id } = req.body;"""
    
    new_dl_post = """router.post('/', async (req, res) => {
  const reqId = makeReqId();
  try {
    let { url, title, uploader, mode, format, override_id, youtube_id } = req.body;
    
    youtube_id = cleanSourceValue(youtube_id);
    url = cleanSourceValue(url);
    
    if (!youtube_id && !url) {
       console.log('[downloads] rejected invalid source youtubeId=null');
       return res.status(400).json({
         ok: false,
         code: "MISSING_TRACK_SOURCE",
         message: "Missing youtubeId/sourceId/url"
       });
    }
    
    if (url && String(url).includes('watch?v=null')) {
       console.log('[downloads] rejected invalid url watch?v=null');
       return res.status(400).json({
         ok: false,
         code: "MISSING_TRACK_SOURCE",
         message: "Missing youtubeId/sourceId/url"
       });
    }"""
    
    content_downloads = content_downloads.replace(old_dl_post, new_dl_post)
    
    old_dl_status = """router.get('/status/:jobId', async (req, res) => {
  const { jobId } = req.params;"""
    
    new_dl_status = """router.get('/status/:jobId', async (req, res) => {
  const { jobId } = req.params;
  if (!jobId || jobId === 'audio:null' || String(jobId).includes('null')) {
    return res.status(400).json({ status: 'failed', message: 'INVALID_JOB_ID' });
  }"""
    
    content_downloads = content_downloads.replace(old_dl_status, new_dl_status)
    
    # 5. Handle resolve-audio too? 
    # "No debe llegar a resolve-audio con title:'' artist:''"
    # It shouldn't if frontend stops it, but we can protect the backend route in music.ts just in case
    
    with open(path_downloads, "w", encoding="utf-8") as f:
        f.write(content_downloads)

if __name__ == "__main__":
    main()
