import re

def main():
    path = "src/app/components/Home.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    replacement = """
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <div>
              <h3 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
                Música para ti
                {import.meta.env.DEV && forYouSource && (
                  <span className="ml-2 text-[10px] font-medium text-white/40">
                    source: {forYouSource}
                  </span>
                )}
              </h3>
              {history.length > 0 && (
                <p className="text-xs text-white/50 mt-1">
                  Basado en lo que escuchas recientemente
                </p>
              )}
            </div>
            <div className="hidden md:flex gap-2">
"""
    
    pattern = r"<div className=\"flex items-center justify-between mb-4 md:mb-6\">\s*<h3 className=\"text-xl md:text-2xl font-bold text-white\">\s*Música para ti\s*\{import\.meta\.env\.DEV && forYouSource && \(\s*<span className=\"ml-2 text-\[10px\] font-medium text-white/40\">\s*source: \{forYouSource\}\s*</span>\s*\)\}\s*</h3>\s*<div className=\"hidden md:flex gap-2\">"

    content = re.sub(pattern, replacement, content)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
