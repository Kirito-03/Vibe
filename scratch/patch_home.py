import re

def main():
    path = "src/app/components/Home.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Fix imports
    if "doc, deleteDoc" not in content:
        content = content.replace("import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';", 
                                  "import { collection, getDocs, limit, orderBy, query, doc, deleteDoc } from 'firebase/firestore';")

    # Fix the `downloadingIds` manual state:
    # 1. Add preparingTrackKey to usePlayback
    old_usePlayback = """  const { playlists } = useMusic();"""
    new_usePlayback = """  const { playlists } = useMusic();\n  const { preparingTrackKey, playSong } = usePlayback();"""
    if "preparingTrackKey" not in content:
        content = content.replace(old_usePlayback, new_usePlayback)
        
    # Replace onSongPlay directly with playSong to avoid the indirection of downloadingIds in Home.tsx
    # Actually wait, HomeProps has `onSongPlay: (song: Song, playlist?: Playlist) => void;`
    # Let's just use `preparingTrackKey` from `usePlayback()` and map `isDownloading` to it.
    
    # We will remove downloadingIds logic.
    content = content.replace("  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());\n", "")
    content = content.replace("const isDownloading = downloadingIds.has(String(d.id));", "const songKey = String(song.youtube_id || song.id);\n                const isDownloading = preparingTrackKey === songKey;")

    # Remove setDownloadingIds calls in handleResultClick
    content = re.sub(r"\s*setDownloadingIds\(prev => [^)]+\)\);\s*", "", content)
    content = re.sub(r"\s*setDownloadingIds\(prev => \{[^}]+\}\);\s*", "", content)
    content = content.replace("if (downloadingIds.has(idStr)) return;", "")
    content = content.replace("const idStr = String(d.id);", "")
    content = content.replace("const safeUrl = makeSafeYoutubeWatchUrl(youtubeId);", "const safeUrl = makeSafeYoutubeWatchUrl(youtubeId);")
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
