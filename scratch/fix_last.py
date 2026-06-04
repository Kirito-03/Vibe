import re

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # optional property access
    content = re.sub(r"audioRef\.current\?\.src\s*=", "if (audioRef.current) audioRef.current.src =", content)
    content = re.sub(r"audioRef\.current\?\.currentTime\s*=", "if (audioRef.current) audioRef.current.currentTime =", content)

    # youtubeId on Song
    content = content.replace("song.youtubeId", "(song as any).youtube_id")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    path = "src/app/components/Home.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    content = content.replace("resolveMediaUrl(String(data.file_url || ''))", "resolveMediaUrl(String(data.file_url || ''))")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
