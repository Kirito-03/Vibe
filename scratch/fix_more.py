import re

def main():
    # Home.tsx
    path = "src/app/components/Home.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    content = re.sub(r"\s*setDownloadingIds\(prev => new Set\(prev\)\.add\(idStr\)\);\s*", "", content)
    content = content.replace("const idStr = String(d.id);", "")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    # Search.tsx
    path = "src/app/components/Search.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    content = re.sub(r"\s*setDownloadingIds\(prev => new Set\(prev\)\.add\(idStr\)\);\s*", "", content)
    content = re.sub(r"\}\);\s*setDownloadingIds\(\(prev\) => \{\s*const next = new Set\(prev\);\s*next\.delete\(idStr\);\s*return next;\s*\}\);\s*", "});\n", content)
    content = content.replace("const idStr = String(d.id);", "")
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    # PlaybackContext.tsx
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    content = content.replace("song.youtubeId", "(song as any).youtube_id")
    content = content.replace("audioRef.current.currentTime", "audioRef.current?.currentTime")
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
