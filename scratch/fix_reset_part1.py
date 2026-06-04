import re

def main():
    path_profile = "src/app/components/Profile.tsx"
    with open(path_profile, "r", encoding="utf-8") as f:
        content_profile = f.read()

    # Add console.log for error payload
    old_fetch_error = """      const json = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(String(json?.error || 'reset'));
      }"""

    new_fetch_error = """      const json = await r.json().catch(() => null);
      if (!r.ok) {
        console.error('[reset-data] failed payload=', json);
        throw new Error(String(json?.error || json?.code || 'reset'));
      }"""

    if "[reset-data] failed payload" not in content_profile:
        content_profile = content_profile.replace(old_fetch_error, new_fetch_error)
    
    # Add Content-Type to fetch
    old_fetch = """      const r = await apiFetch('/api/user/reset-data', {
        method: 'DELETE',
        body: JSON.stringify({ confirm: confirmText }),
      });"""
      
    new_fetch = """      const r = await apiFetch('/api/user/reset-data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirmText }),
      });"""
      
    if "headers: { 'Content-Type': 'application/json' }" not in content_profile:
        content_profile = content_profile.replace(old_fetch, new_fetch)

    with open(path_profile, "w", encoding="utf-8") as f:
        f.write(content_profile)

if __name__ == "__main__":
    main()
