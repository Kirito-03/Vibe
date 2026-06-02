const fs = require('fs');
const path = require('path');

const appPath = path.join('c:', 'Users', 'ASUS', 'Desktop', 'app', 'src', 'app', 'App.tsx');
let content = fs.readFileSync(appPath, 'utf8');

// Chunk 1
content = content.replace(
  `const audioRef = useRef<HTMLAudioElement | null>(null);\n  const isDownloadSong = (id: number | string) => String(id).startsWith('dl-');`,
  `const audioRef = useRef<HTMLAudioElement | null>(null);
  const oldAudioRef = useRef<HTMLAudioElement | null>(null);
  const preloadedAudioRef = useRef<HTMLAudioElement | null>(null);
  const crossfadeTriggered = useRef(false);
  const bufferDoneRef = useRef(false);
  const isDownloadSong = (id: number | string) => String(id).startsWith('dl-');`
);

// Chunk 2
content = content.replace(
  `useEffect(() => { setProgress(0); }, [currentSong?.id]);`,
  `useEffect(() => { 
    setProgress(0); 
    crossfadeTriggered.current = false;
    bufferDoneRef.current = false;
  }, [currentSong?.id]);`
);

// Chunk 3
content = content.replace(
  `const handleSongPlay = useCallback((song: Song, playlist?: Playlist) => {\n    if (currentSong?.id === song.id) {\n      // Toggle play/pause\n      if (audioRef.current) {\n        if (audioRef.current.paused) {\n          audioRef.current.play().catch(() => {});\n        } else {\n          audioRef.current.pause();\n        }\n      }\n    } else {\n      setCurrentSong(song);`,
  `const handleSongPlay = useCallback((song: Song, playlist?: Playlist, isCrossfade = false) => {
    if (currentSong?.id === song.id && !isCrossfade) {
      // Toggle play/pause
      if (audioRef.current) {
        if (audioRef.current.paused) {
          audioRef.current.play().catch(() => {});
        } else {
          audioRef.current.pause();
        }
      }
    } else {
      setCurrentSong(song);`
);

// Chunk 4
content = content.replace(
  `      // Parar audio anterior\n      if (audioRef.current) {\n        audioRef.current.pause();\n        audioRef.current.src = '';\n        audioRef.current = null;\n      }`,
  `      // Parar audio anterior
      if (audioRef.current) {
        if (isCrossfade && isPlaying) {
          const fadingOut = audioRef.current;
          oldAudioRef.current = fadingOut;
          let vol = fadingOut.volume;
          const fadeOutInt = setInterval(() => {
            vol -= 0.05;
            if (vol <= 0 || !fadingOut) {
               clearInterval(fadeOutInt);
               fadingOut.pause();
               fadingOut.src = '';
               if (oldAudioRef.current === fadingOut) oldAudioRef.current = null;
            } else {
               fadingOut.volume = Math.max(0, vol);
            }
          }, 250);
        } else {
          audioRef.current.pause();
          audioRef.current.src = '';
          audioRef.current = null;
          if (oldAudioRef.current) {
            oldAudioRef.current.pause();
            oldAudioRef.current.src = '';
            oldAudioRef.current = null;
          }
        }
      }`
);

// Chunk 5
content = content.replace(
  `      if (song.file_url) {\n        const audio = new Audio(song.file_url);\n        audioRef.current = audio;\n        audio.volume = volume / 100;\n        \n        // Forzar un intento inicial de isPlaying a true para que la UI reaccione instantáneamente\n        setIsPlaying(true);`,
  `      if (song.file_url) {
        let audio: HTMLAudioElement;
        if (preloadedAudioRef.current && preloadedAudioRef.current.src.includes(song.file_url)) {
           audio = preloadedAudioRef.current;
           preloadedAudioRef.current = null;
        } else {
           audio = new Audio(song.file_url);
        }
        audioRef.current = audio;

        if (isCrossfade) {
           audio.volume = 0;
           const targetVol = Math.max(0, Math.min(1, volume / 100)); // Ensure valid volume
           let currentVol = 0;
           const fadeInInt = setInterval(() => {
               currentVol += 0.05;
               if (currentVol >= targetVol) {
                   clearInterval(fadeInInt);
                   audio.volume = targetVol;
               } else {
                   audio.volume = currentVol;
               }
           }, 250);
        } else {
           audio.volume = Math.max(0, Math.min(1, volume / 100));
        }
        
        // Forzar un intento inicial de isPlaying a true para que la UI reaccione instantáneamente
        setIsPlaying(true);`
);

// Chunk 6
content = content.replace(
  `        audio.ontimeupdate = () => {\n          if (audioRef.current === audio) {\n            if (audio.duration) {\n              setProgress((audio.currentTime / audio.duration) * 100);\n            }\n            // Sincronización infalible: el DOM tiene la verdad absoluta del estado de reproducción\n            setIsPlaying(!audio.paused);\n          }\n        };`,
  `        audio.ontimeupdate = () => {
          if (audioRef.current === audio) {
            if (audio.duration) {
              const prog = (audio.currentTime / audio.duration) * 100;
              setProgress(prog);

              if (prog >= 80 && !bufferDoneRef.current) {
                 bufferDoneRef.current = true;
                 const state = playerStateRef.current;
                 if (state.currentPlaylist?.songs && state.currentSong) {
                    const isRadio = String(state.currentPlaylist.id).startsWith('radio-');
                    let nextSongToPreload = null;
                    if (state.isShuffle && !isRadio) {
                       const rem = state.currentPlaylist.songs.filter(s => s.id !== state.currentSong?.id);
                       nextSongToPreload = rem.length > 0 ? rem[0] : null;
                    } else {
                       const idx = state.currentPlaylist.songs.findIndex(s => s.id === state.currentSong?.id);
                       if (idx !== -1 && idx < state.currentPlaylist.songs.length - 1) {
                          nextSongToPreload = state.currentPlaylist.songs[idx + 1];
                       } else if (state.repeatMode === 'all') {
                          nextSongToPreload = state.currentPlaylist.songs[0];
                       }
                    }
                    if (nextSongToPreload && nextSongToPreload.file_url) {
                       const preloader = new Audio();
                       preloader.preload = 'auto';
                       preloader.src = nextSongToPreload.file_url;
                       preloadedAudioRef.current = preloader;
                    }
                 }
              }

              if (!crossfadeTriggered.current && audio.duration - audio.currentTime <= 5 && audio.currentTime > 5) {
                 crossfadeTriggered.current = true;
                 handleNext({ detail: { isCrossfade: true } });
              }
            }
            setIsPlaying(!audio.paused);
          }
        };`
);

// Chunk 7
content = content.replace(
  `        audio.onended = async (e?: Event) => {\n          const isManualSkip = e && (e as any).detail?.isManualSkip;\n          const expectedDuration = audio.duration !== Infinity && !isNaN(audio.duration) ? audio.duration : (song.duration_seconds || song.durationSecs || 0);\n          if (!isManualSkip && expectedDuration > 0 && expectedDuration - audio.currentTime > 3) {\n             console.warn("Terminación prematura del stream detectada. Pausando en lugar de saltar...");\n             setIsPlaying(false);\n             return;\n          }`,
  `        audio.onended = async (e?: Event) => {
          if (audioRef.current !== audio) return; // Ya es viejo
          
          const isManualSkip = e && (e as any).detail?.isManualSkip;
          const isCrossfade = e && (e as any).detail?.isCrossfade;
          const expectedDuration = audio.duration !== Infinity && !isNaN(audio.duration) ? audio.duration : (song.duration_seconds || song.durationSecs || 0);
          if (!isManualSkip && !isCrossfade && expectedDuration > 0 && expectedDuration - audio.currentTime > 3) {
             console.warn("Terminación prematura del stream detectada. Pausando en lugar de saltar...");
             setIsPlaying(false);
             return;
          }`
);

// Chunk 8 - Replace handleSongPlay in onended
content = content.replaceAll(
  `handleSongPlay(songs[idx + 1], state.currentPlaylist);`,
  `handleSongPlay(songs[idx + 1], state.currentPlaylist, isCrossfade);`
);
content = content.replaceAll(
  `handleSongPlay(songs[0], state.currentPlaylist);`,
  `handleSongPlay(songs[0], state.currentPlaylist, isCrossfade);`
);
content = content.replaceAll(
  `handleSongPlay(remaining[Math.floor(Math.random() * remaining.length)], state.currentPlaylist);`,
  `handleSongPlay(remaining[Math.floor(Math.random() * remaining.length)], state.currentPlaylist, isCrossfade);`
);
content = content.replaceAll(
  `handleSongPlay(nextSong, newPlaylist);`,
  `handleSongPlay(nextSong, newPlaylist, isCrossfade);`
);

// Chunk 9 - Handle handleNext logic (taking event object)
content = content.replace(
  `  const handleNext = useCallback(() => {\n    // Si hay un audio y tiene la lógica de onended adjunta, la usamos como atajo (simula terminar la canción)\n    // Pero si el usuario tiene repeatMode === 'one', onended lo repetiría, por lo que lo evadimos temporalmente\n    if (audioRef.current && audioRef.current.onended) {\n      const originalRepeat = playerStateRef.current.repeatMode;\n      if (originalRepeat === 'one') playerStateRef.current.repeatMode = 'all'; // Forzar salto\n      \n      const evt = new CustomEvent('ended', { detail: { isManualSkip: true } });\n      // Forzar llamada (puede ser async)\n      const onEndedFn = audioRef.current.onended;`,
  `  const handleNext = useCallback((e?: any) => {
    const isManualSkip = !(e?.detail?.isCrossfade);
    const isCrossfade = e?.detail?.isCrossfade === true;

    if (audioRef.current && audioRef.current.onended) {
      const originalRepeat = playerStateRef.current.repeatMode;
      if (originalRepeat === 'one' && isManualSkip) playerStateRef.current.repeatMode = 'all'; // Forzar salto
      
      const evt = new CustomEvent('ended', { detail: { isManualSkip, isCrossfade } });
      const onEndedFn = audioRef.current.onended;`
);

fs.writeFileSync(appPath, content);
console.log('App.tsx crossfade modificado correctamente.');
