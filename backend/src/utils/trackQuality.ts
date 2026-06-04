export function isLikelyMusicTrack(title: string | undefined | null, artist: string | undefined | null = ''): boolean {
  if (!title) return false;
  const t = (title + ' ' + (artist || '')).toLowerCase();
  
  // Toxic keywords that definitely mean this is not a normal music track
  const toxicKeywords = [
    'tutorial', 'podcast', 'exported files', 'luna recording system', 
    'universal audio', 'software', 'mixing files', 'mixes', 'how to',
    'review', 'unboxing', 'gameplay', 'walkthrough', 'chapter',
    'full episode', 'vlog'
  ];

  for (const k of toxicKeywords) {
    if (t.includes(k)) return false;
  }

  // Suspicious keywords that might be valid if they also have "official" or "audio" but generally we penalize
  // If it's literally just "karaoke" without the artist name, we might want to reject. 
  // We'll leave the scoring to rankRecommendationCandidate for gray areas.
  return true;
}

export function rankRecommendationCandidate(seedTitle: string, seedArtist: string, candidate: any, profile?: any): number {
  let scorePenalty = 0;
  const title = String(candidate?.title || '');
  const artist = String(candidate?.artist || candidate?.uploader || '');

  // Demote bad terms based on user input
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('exporting files') || lowerTitle.includes('luna -') || lowerTitle.includes('tutorial') || lowerTitle.includes('how to')) {
    scorePenalty -= 100;
  }
  if (lowerTitle.includes('karaoke') || lowerTitle.includes('instrumental') || lowerTitle.includes('cover')) {
    scorePenalty -= 50;
  }
  
  if (profile?.topArtists?.some((a: string) => a.toLowerCase() === artist.toLowerCase())) {
     scorePenalty += 30;
  }
  if (profile?.skippedPatterns?.some((p: string) => lowerTitle.includes(p.toLowerCase()))) {
     scorePenalty -= 50;
  }
  if (lowerTitle.includes('live')) {
    scorePenalty -= 20;
  }
  if (lowerTitle.includes('podcast') || lowerTitle.includes('episode')) {
    scorePenalty -= 80;
  }

  if (!candidate || !candidate.title) return -100;
  
  const cTitle = String(candidate.title).toLowerCase();
  const cArtist = String(candidate.artist || candidate.author || '').toLowerCase();
  const sTitle = String(seedTitle).toLowerCase();
  const sArtist = String(seedArtist).toLowerCase();

  let score = 100;

  // Penalize toxic words immediately
  if (!isLikelyMusicTrack(candidate.title, candidate.artist)) {
    return -1000;
  }

  // Boost for official indicators
  if (cTitle.includes('official audio') || cTitle.includes('official video') || cTitle.includes('topic')) {
    scorePenalty += 50;
  }

  // Exact artist match
  if (sArtist && cArtist && (cArtist.includes(sArtist) || sArtist.includes(cArtist))) {
    scorePenalty += 40;
  }

  // Penalties for weird versions if not explicitly requested
  const weirdFlags = ['karaoke', 'instrumental', 'slowed', 'reverb', 'sped up', 'cover', 'live'];
  for (const flag of weirdFlags) {
    if (cTitle.includes(flag) && !sTitle.includes(flag)) {
      scorePenalty -= 30;
    }
  }

  // Penalize lyrics if "official audio" is available in another result (we just penalize lyrics slightly)
  if (cTitle.includes('lyrics') || cTitle.includes('letra')) {
    scorePenalty -= 10;
  }

  // Duration checks
  const duration = candidate.durationSecs || candidate.duration_seconds || 0;
  if (duration > 0) {
    if (duration > 600) scorePenalty -= 50; // > 10 mins is bad
    if (duration < 60) scorePenalty -= 50; // < 1 min is bad
    if (duration >= 90 && duration <= 300) scorePenalty += 20; // 1:30 to 5:00 is ideal
  }

  return score + scorePenalty;
}
