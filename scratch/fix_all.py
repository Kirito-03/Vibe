import re

def main():
    path = "src/app/components/Home.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 188
    content = content.replace("String(data.file_url ?? '')", "String(data.file_url || '')")
    content = content.replace("String(best.data.file_url ?? '')", "String(best.data.file_url || '')")

    # 428
    content = re.sub(r"\s*setDownloadingIds\(prev => [^)]+\)\);\s*", "", content)
    content = re.sub(r"\s*setDownloadingIds\(prev => \{[^}]+\}\);\s*", "", content)
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    path = "src/app/components/Search.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    content = re.sub(r"\s*setDownloadingIds\(prev => [^)]+\)\);\s*", "", content)
    content = re.sub(r"\s*setDownloadingIds\(prev => \{[^}]+\}\);\s*", "", content)
    content = re.sub(r"\s*setTimeout\(\(\) => setLoadingId\(null\), 3000\);\s*", "", content)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # The left-hand side of an assignment expression may not be an optional property access.
    # audioRef.current?.pause() was wrong? No, assignment `audioRef.current?.src = localUrl`
    content = content.replace("audioRef.current?.src = ", "if (audioRef.current) audioRef.current.src = ")
    content = content.replace("audioRef.current?.currentTime =", "if (audioRef.current) audioRef.current.currentTime =")
    
    # youtubeId -> youtube_id
    content = content.replace("song.youtubeId", "(song as any).youtube_id")
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
