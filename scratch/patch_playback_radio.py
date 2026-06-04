import re

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Old auto-radio fetch
    old_fetch = """                const artist = state.currentSong.artist || state.currentSong.artist_name || '';
                const seedQuery = artist && artist !== 'Internet' && artist !== 'Desconocido' ? `${artist} mix canciones` : `${state.currentSong.title} mix`;
                const res = await apiFetch(`/api/music/recommendations?seed=${encodeURIComponent(seedQuery)}`);
                if (res.ok) {
                  const json = await res.json().catch(() => null);
                  const data: any[] = Array.isArray(json) ? json : Array.isArray((json as any)?.items) ? (json as any).items : [];
                  const currentPlaylistIds = new Set(state.currentPlaylist?.songs?.map((s) => String(s.id)) || []);
                  const artistLower = artist.toLowerCase();
                  let newSongs = Array.isArray(data) ? data.filter((d) => !currentPlaylistIds.has(String(d.id))) : [];
                  let strictSongs = newSongs.filter((d) => !isTooSimilar(d.title, state.currentSong!.title));
                  if (strictSongs.length === 0) strictSongs = newSongs;
                  newSongs = strictSongs;

                  if (newSongs.length > 0) {
                    const filteredByArtist = newSongs.filter((d) => {
                      if (!artistLower || artistLower === 'internet' || artistLower === 'desconocido') return true;
                      const dArtist = (d.artist || d.uploader || '').toLowerCase();
                      return dArtist.includes(artistLower) || artistLower.includes(dArtist) || !dArtist.includes('podcast');
                    });
                    if (filteredByArtist.length > 0) newSongs = filteredByArtist;
                  }

                  if (newSongs.length > 0) {
                    const rec = newSongs[0];"""

    new_fetch = """                const artist = state.currentSong.artist || state.currentSong.artist_name || '';
                const title = state.currentSong.title || '';
                const seedQuery = artist && artist !== 'Internet' && artist !== 'Desconocido' 
                  ? `${artist} ${title} similar songs` 
                  : `${title} similar music`;
                  
                const res = await apiFetch(`/api/music/recommendations?seed=${encodeURIComponent(seedQuery)}`);
                if (res.ok) {
                  const json = await res.json().catch(() => null);
                  const data: any[] = Array.isArray(json) ? json : Array.isArray((json as any)?.items) ? (json as any).items : [];
                  const currentPlaylistIds = new Set(state.currentPlaylist?.songs?.map((s) => String(s.id)) || []);
                  let newSongs = Array.isArray(data) ? data.filter((d) => !currentPlaylistIds.has(String(d.id))) : [];
                  
                  if (newSongs.length > 0) {
                    const scored = newSongs.map((it: any) => ({
                       ...it,
                       _score: rankRecommendationCandidate(title, artist, it)
                    }))
                    .filter((it: any) => it._score > -50 && !isTooSimilar(it.title, title))
                    .sort((a: any, b: any) => b._score - a._score);
                    
                    if (scored.length > 0) newSongs = scored;
                  }

                  if (newSongs.length > 0) {
                    const rec = newSongs[0];"""

    if old_fetch in content:
        content = content.replace(old_fetch, new_fetch)
    else:
        print("Old fetch not found for auto-radio.")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
