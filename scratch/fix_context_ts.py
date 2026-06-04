import re

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # (212) data.currentTrack.youtube_id -> (data.currentTrack as any).youtube_id
    content = content.replace("!data.currentTrack.youtube_id && !data.currentTrack.sourceId && !data.currentTrack.url", "!(data.currentTrack as any).youtube_id && !data.currentTrack.sourceId && !(data.currentTrack as any).url")
    
    # youtubeId -> youtube_id on Song
    content = content.replace("song.youtubeId", "(song as any).youtube_id")
    
    # sourceId on Song
    content = content.replace("song.sourceId", "(song as any).sourceId")
    content = content.replace("song.videoId", "(song as any).videoId")
    content = content.replace("song.url", "(song as any).url")
    content = content.replace("song.webpage_url", "(song as any).webpage_url")
    
    # repeatMode === 'none' -> repeatMode === 'off'
    content = content.replace("repeatMode === 'none'", "repeatMode === 'off'")
    
    # audioRef.current is possibly null -> audioRef.current?.
    content = content.replace("audioRef.current.pause();", "audioRef.current?.pause();")
    content = content.replace("audioRef.current.currentTime", "audioRef.current?.currentTime")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
