import re

def main():
    path_appshell = "src/app/AppShell.tsx"
    with open(path_appshell, "r", encoding="utf-8") as f:
        content_appshell = f.read()

    if "getUserStorageKey" not in content_appshell:
        content_appshell = content_appshell.replace("import { useDocumentTitle } from './hooks/useDocumentTitle';", "import { useDocumentTitle } from './hooks/useDocumentTitle';\nimport { getUserStorageKey } from './utils';")

    old_effect = """  useEffect(() => {
    const saved = localStorage.getItem('vns_lastPlayed');
    if (!saved) return;
    try {
      setResumeCandidate(JSON.parse(saved));
      setShowContinueListening(true);
    } catch {}
  }, []);"""

    new_effect = """  useEffect(() => {
    if (!user?.uid) {
      setResumeCandidate(null);
      setShowContinueListening(false);
      return;
    }
    const lpKey = getUserStorageKey('vns_lastPlayed', user.uid);
    if (!lpKey) return;
    const saved = localStorage.getItem(lpKey);
    if (!saved) {
      setResumeCandidate(null);
      setShowContinueListening(false);
      return;
    }
    try {
      setResumeCandidate(JSON.parse(saved));
      setShowContinueListening(true);
    } catch {
      setResumeCandidate(null);
      setShowContinueListening(false);
    }
  }, [user?.uid]);"""

    content_appshell = content_appshell.replace(old_effect, new_effect)

    with open(path_appshell, "w", encoding="utf-8") as f:
        f.write(content_appshell)

if __name__ == "__main__":
    main()
