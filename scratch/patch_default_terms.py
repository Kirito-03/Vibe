import re

def main():
    path = "backend/src/routes/music.ts"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    new_terms = """const defaultForYouTerms = [
    'latin pop official audio',
    'reggaeton hits official audio',
    'pop music official audio',
    'anime music official audio',
    'lofi beats official audio',
  ];"""

    content = re.sub(r"const defaultForYouTerms = \[\s*'.*?',\s*'.*?',\s*'.*?',\s*'.*?',\s*'.*?',\s*'.*?',\s*\];", new_terms, content)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
