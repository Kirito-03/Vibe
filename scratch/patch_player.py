import re

def main():
    path = "src/app/components/Player.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Add variables to usePlayback
    old_usePlayback = """    favorites,
    playbackError,"""
    new_usePlayback = """    favorites,
    playbackError,
    playbackErrorTrackKey,
    preparingTrackKey,"""
    if "preparingTrackKey" not in content:
        content = content.replace(old_usePlayback, new_usePlayback)

    # We need to replace `{playbackError && <p className="text-[11px] text-zinc-400 truncate">{playbackError}</p>}` 
    # with the logic for preparing audio
    old_error_logic = """{playbackError && <p className="text-[11px] text-zinc-400 truncate">{playbackError}</p>}"""
    new_error_logic = """{playbackErrorTrackKey === (song?.youtube_id || song?.id) && playbackError ? (
              <p className="text-[11px] text-zinc-400 truncate">{playbackError}</p>
            ) : preparingTrackKey === String(song?.youtube_id || song?.id) ? (
              <p className="text-[11px] text-violet-400 truncate">Preparando audio...</p>
            ) : null}"""
            
    content = content.replace(old_error_logic, new_error_logic)
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
