import re

def main():
    # Fix Home.tsx
    path = "src/app/components/Home.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    if "import { usePlayback } from" not in content:
        content = content.replace("import { useHomeData } from '../context/HomeDataContext';", "import { useHomeData } from '../context/HomeDataContext';\nimport { usePlayback } from '../context/PlaybackContext';")

    content = re.sub(r"\s*setDownloadingIds\(prev => [^)]+\)\);\s*", "", content)
    content = re.sub(r"\s*setDownloadingIds\(prev => \{[^}]+\}\);\s*", "", content)
    content = content.replace("const isDownloading = downloadingIds.has(String(d.id));", "")
    content = content.replace("const idStr = String(d.id);", "")

    # Fix type number
    content = content.replace("deleteDoc(doc(db, 'users', user.uid, 'recents', id))", "deleteDoc(doc(db, 'users', user.uid, 'recents', String(id)))")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    # Fix Search.tsx
    path = "src/app/components/Search.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    content = re.sub(r"\s*setDownloadingIds\(prev => [^)]+\)\);\s*", "", content)
    content = re.sub(r"\s*setDownloadingIds\(prev => \{[^}]+\}\);\s*", "", content)
    content = re.sub(r"\s*setLoadingId\([^)]+\);\s*", "", content)
    content = content.replace("const idStr = String(d.id);", "")
    content = content.replace("if (downloadingIds.has(idStr) || loadingId === idStr) return;", "")

    # Fix TS error on song.youtube_id
    content = content.replace("const songKey = String(song.youtube_id || song.id);", "const songKey = String((song as any).youtube_id || song.id);")
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
