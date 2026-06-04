import re

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Apply radio fetch logic with rankRecommendationCandidate
    old_fetch = """                  if (state.queue && state.queue.length === 0) {
                    let nextSong: Song | null = null;
                    if (state.currentTrack?.youtube_id) {
                      const related = await apiFetch(`/api/music/related?videoId=${state.currentTrack.youtube_id}`);
                      if (related?.items?.length > 0) {
                        const candidate = related.items[Math.floor(Math.random() * Math.min(3, related.items.length))];
                        const dlRes = await fetch(`${API_BASE}/api/downloads`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title: candidate.title,
                            artist: candidate.artist || candidate.author,
                            youtubeId: candidate.youtubeId,
                            sourceId: candidate.sourceId
                          })
                        });
                        if (dlRes.ok) {
                          let dlData = await dlRes.json();
                          if (dlData && dlData.id) nextSong = downloadToSong(dlData);
                        }
                      } catch {}
                    }"""

    new_fetch = """                  if (state.queue && state.queue.length === 0) {
                    let nextSong: Song | null = null;
                    if (state.currentTrack?.youtube_id || state.currentTrack?.title) {
                      const queryParam = state.currentTrack?.youtube_id 
                         ? `videoId=${state.currentTrack.youtube_id}` 
                         : `q=${encodeURIComponent(state.currentTrack?.title + ' ' + (state.currentTrack?.artist || ''))}`;
                      const related = await apiFetch(`/api/music/related?${queryParam}`);
                      if (related?.items?.length > 0) {
                        const scored = related.items.map((it: any) => ({
                           ...it,
                           _score: rankRecommendationCandidate(state.currentTrack!.title, state.currentTrack!.artist || '', it)
                        })).filter((it: any) => it._score > -50).sort((a: any, b: any) => b._score - a._score);
                        
                        const candidate = scored.length > 0 ? scored[0] : null;
                        if (candidate) {
                          const dlRes = await fetch(`${API_BASE}/api/downloads`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              title: candidate.title,
                              artist: candidate.artist || candidate.author,
                              youtubeId: candidate.youtubeId,
                              sourceId: candidate.sourceId
                            })
                          });
                          if (dlRes.ok) {
                            let dlData = await dlRes.json();
                            if (dlData && dlData.id) nextSong = downloadToSong(dlData);
                          }
                        }
                      } catch {}
                    }"""

    if old_fetch in content:
        content = content.replace(old_fetch, new_fetch)
    else:
        print("old_fetch not found")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
