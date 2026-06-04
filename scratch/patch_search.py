import re

def main():
    path = "src/app/components/Search.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Add preparingTrackKey to Search
    if "usePlayback" not in content:
        content = content.replace("import { useAppSettings } from '../context/AppSettingsContext';", 
                                  "import { useAppSettings } from '../context/AppSettingsContext';\nimport { usePlayback } from '../context/PlaybackContext';")
        content = content.replace("  const { settings } = useAppSettings();", "  const { settings } = useAppSettings();\n  const { preparingTrackKey } = usePlayback();")

    # Replace loading manually
    content = content.replace("  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());\n", "")
    content = content.replace("  const [loadingId, setLoadingId] = useState<string | null>(null);\n", "")
    content = content.replace("const isDownloading = downloadingIds.has(String(d.id));", "const songKey = String(song.youtube_id || song.id);\n                  const isDownloading = preparingTrackKey === songKey;")

    # Remove manual state changes
    content = re.sub(r"\s*setDownloadingIds\(prev => [^)]+\)\);\s*", "", content)
    content = re.sub(r"\s*setDownloadingIds\(prev => \{[^}]+\}\);\s*", "", content)
    content = re.sub(r"\s*setLoadingId\([^)]+\);\s*", "", content)
    content = content.replace("if (downloadingIds.has(idStr) || loadingId === idStr) return;", "")
    content = content.replace("const idStr = String(d.id);", "")
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
