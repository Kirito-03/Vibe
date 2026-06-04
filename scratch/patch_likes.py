import re

def main():
    path = "src/app/context/PlaybackContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # In toggleFavorite
    content = content.replace("setFavorites((prev) => {", "emitListeningEvent(track, 'liked');\n    setFavorites((prev) => {")

    # In toggleFavoriteSong
    content = content.replace("setFavoritesSongs((prev) => {", "emitListeningEvent(song, 'liked');\n    setFavoritesSongs((prev) => {")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
