import re

def main():
    paths = [
        "backend/src/utils/trackQuality.ts",
        "src/app/utils/trackQuality.ts"
    ]

    new_content = """export function isLikelyMusicTrack(title: string | undefined | null, artist: string | undefined | null = ''): boolean {
  if (!title) return false;
  const t = (title + ' ' + (artist || '')).toLowerCase();
  
  // Toxic keywords that definitely mean this is not a normal music track
  const toxicKeywords = [
    'tutorial', 'how to', 'setup', 'guide', 'lesson', 'course', 'review', 'podcast', 
    'interview', 'reaction', 'documentary', 'news', 'mixer', 'connect a mixer', 
    'audio interface', 'audio university', 'studio setup', 'recording system', 
    'exporting files', 'luna recording system', 'daw', 'fl studio tutorial', 
    'ableton tutorial', 'logic pro tutorial', 'pro tools tutorial', 'cubase tutorial', 
    'mixing tutorial', 'mastering tutorial', 'microphone setup', 'sound test', 
    'demo', 'sample pack', 'type beat', 'free beat', 'unboxing', 'gameplay', 
    'walkthrough', 'chapter', 'full episode', 'vlog', 'luna -', 'studio mix setup guide'
  ];

  for (const k of toxicKeywords) {
    if (t.includes(k)) {
       console.log(`[quality/filter] reject non-music title="${title}" artist="${artist}" reason="${k}"`);
       return false;
    }
  }

  return true;
}

export function rankForYouCandidate(profile: any, candidate: any): number {
  if (!candidate || !candidate.title) return -1000;
  if (!isLikelyMusicTrack(candidate.title, candidate.artist || candidate.uploader)) return -1000;

  let score = 100;
  const title = String(candidate.title).toLowerCase();
  const artist = String(candidate.artist || candidate.uploader || '').toLowerCase();
  const duration = candidate.durationSecs || candidate.duration_seconds || candidate.duration || 0;

  // Boost for official indicators
  if (title.includes('official audio') || title.includes('official video') || title.includes('topic')) {
    score += 50;
  }

  // Exact artist match in profile
  let matchedProfile = false;
  if (profile?.topArtists?.some((a: string) => a.toLowerCase() === artist || artist.includes(a.toLowerCase()))) {
    score += 50;
    matchedProfile = true;
  }
  if (profile?.likedTracks?.some((t: string) => title.includes(t.toLowerCase()))) {
    score += 30;
    matchedProfile = true;
  }
  
  if (!matchedProfile && profile?.topArtists?.length > 0) {
    score -= 30; // Not matching any of their top artists or likes when personalized
  }

  // Penalties for weird versions if not explicitly requested
  const weirdFlags = ['karaoke', 'instrumental', 'slowed', 'reverb', 'sped up', 'cover', 'live'];
  for (const flag of weirdFlags) {
    if (title.includes(flag)) {
      score -= 50;
    }
  }

  // Profile-specific skipped patterns
  if (profile?.skippedPatterns?.some((p: string) => title.includes(p.toLowerCase()))) {
    score -= 100;
  }

  // Penalize lyrics if "official audio" is available in another result (we just penalize lyrics slightly)
  if (title.includes('lyrics') || title.includes('letra')) {
    score -= 15;
  }

  // Duration checks
  if (duration > 0) {
    if (duration > 480) score -= 80; // > 8 mins is bad
    if (duration < 90) score -= 80; // < 1:30 min is bad
    if (duration >= 90 && duration <= 480) score += 20; // 1:30 to 8:00 is ideal
  }

  // Penalize bad uploaders strongly just in case
  if (artist.includes('university') || artist.includes('tutorial') || artist.includes('software')) {
    score -= 500;
  }

  return score;
}

export function rankRecommendationCandidate(seedTitle: string, seedArtist: string, candidate: any, profile?: any): number {
  if (!candidate || !candidate.title) return -1000;
  if (!isLikelyMusicTrack(candidate.title, candidate.artist || candidate.uploader)) return -1000;

  let score = 100;
  const title = String(candidate.title).toLowerCase();
  const artist = String(candidate.artist || candidate.uploader || '').toLowerCase();
  const duration = candidate.durationSecs || candidate.duration_seconds || candidate.duration || 0;
  const sTitle = String(seedTitle).toLowerCase();
  const sArtist = String(seedArtist).toLowerCase();

  // Boost for official indicators
  if (title.includes('official audio') || title.includes('official video') || title.includes('topic')) {
    score += 50;
  }

  // Exact artist match
  if (sArtist && artist && (artist.includes(sArtist) || sArtist.includes(artist))) {
    score += 40;
  }

  // Penalties for weird versions if not explicitly requested
  const weirdFlags = ['karaoke', 'instrumental', 'slowed', 'reverb', 'sped up', 'cover', 'live'];
  for (const flag of weirdFlags) {
    if (title.includes(flag) && !sTitle.includes(flag)) {
      score -= 30;
    }
  }

  // Profile-specific skipped patterns
  if (profile?.skippedPatterns?.some((p: string) => title.includes(p.toLowerCase()))) {
    score -= 50;
  }

  // Penalize lyrics if "official audio" is available in another result (we just penalize lyrics slightly)
  if (title.includes('lyrics') || title.includes('letra')) {
    score -= 10;
  }

  // Duration checks
  if (duration > 0) {
    if (duration > 480) score -= 80; // > 8 mins is bad
    if (duration < 90) score -= 80; // < 1:30 min is bad
    if (duration >= 90 && duration <= 480) score += 20; // 1:30 to 8:00 is ideal
  }

  return score;
}
"""

    for path in paths:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)

if __name__ == "__main__":
    main()
