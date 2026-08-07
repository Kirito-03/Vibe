"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLikelyMusicTrack = isLikelyMusicTrack;
exports.rankForYouCandidate = rankForYouCandidate;
exports.rankRecommendationCandidate = rankRecommendationCandidate;
function isLikelyMusicTrack(title, artist = '') {
    if (!title)
        return false;
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
        'walkthrough', 'chapter', 'full episode', 'vlog', 'studio mix setup guide',
        'universal audio luna'
    ];
    for (const k of toxicKeywords) {
        if (t.includes(k)) {
            console.log(`[quality/filter] reject non-music title="${title}" artist="${artist}" reason="${k}"`);
            return false;
        }
    }
    return true;
}
function rankForYouCandidate(profile, candidate) {
    var _a, _b, _c, _d, _e;
    if (!candidate || !candidate.title)
        return -1000;
    if (!isLikelyMusicTrack(candidate.title, candidate.artist || candidate.uploader))
        return -1000;
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
    if ((_a = profile === null || profile === void 0 ? void 0 : profile.topArtists) === null || _a === void 0 ? void 0 : _a.some((a) => a.toLowerCase() === artist || artist.includes(a.toLowerCase()))) {
        score += 50;
        matchedProfile = true;
    }
    if ((_b = profile === null || profile === void 0 ? void 0 : profile.likedTracks) === null || _b === void 0 ? void 0 : _b.some((t) => title.includes(t.toLowerCase()) || artist.includes(t.toLowerCase()))) {
        score += 30;
        matchedProfile = true;
    }
    if ((_c = profile === null || profile === void 0 ? void 0 : profile.recentSearches) === null || _c === void 0 ? void 0 : _c.some((s) => title.includes(s.toLowerCase()) || artist.includes(s.toLowerCase()))) {
        score += 20;
        matchedProfile = true;
    }
    if (!matchedProfile && ((_d = profile === null || profile === void 0 ? void 0 : profile.topArtists) === null || _d === void 0 ? void 0 : _d.length) > 0) {
        score -= 50; // Not matching any of their top artists or likes when personalized
    }
    // Penalties for weird versions if not explicitly requested
    const weirdFlags = ['karaoke', 'instrumental', 'slowed', 'reverb', 'sped up', 'cover', 'live'];
    for (const flag of weirdFlags) {
        if (title.includes(flag)) {
            score -= 50;
        }
    }
    // Profile-specific skipped patterns
    if ((_e = profile === null || profile === void 0 ? void 0 : profile.skippedPatterns) === null || _e === void 0 ? void 0 : _e.some((p) => title.includes(p.toLowerCase()))) {
        score -= 100;
    }
    // Penalize lyrics if "official audio" is available in another result (we just penalize lyrics slightly)
    if (title.includes('lyrics') || title.includes('letra') || title.includes('lyric')) {
        score -= 15;
    }
    // Duration checks
    if (duration > 0) {
        if (duration > 480)
            score -= 80; // > 8 mins is bad
        if (duration < 90)
            score -= 80; // < 1:30 min is bad
        if (duration >= 90 && duration <= 480)
            score += 20; // 1:30 to 8:00 is ideal
    }
    // Penalize bad uploaders strongly just in case
    if (artist.includes('university') || artist.includes('tutorial') || artist.includes('software') || artist.includes('audio university')) {
        score -= 1000;
    }
    const severeToxic = ['guide', 'tutorial', 'setup', 'mixer', 'software'];
    for (const t of severeToxic) {
        if (title.includes(t))
            score -= 1000;
    }
    if (candidate.globalCatalogScore) {
        score += (candidate.globalCatalogScore / 10);
    }
    // Penalize recently seen
    if (candidate.seenRecently) {
        score -= 30;
    }
    return score;
}
function rankRecommendationCandidate(seedTitle, seedArtist, candidate, profile) {
    var _a;
    if (!candidate || !candidate.title)
        return -1000;
    if (!isLikelyMusicTrack(candidate.title, candidate.artist || candidate.uploader))
        return -1000;
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
    if ((_a = profile === null || profile === void 0 ? void 0 : profile.skippedPatterns) === null || _a === void 0 ? void 0 : _a.some((p) => title.includes(p.toLowerCase()))) {
        score -= 50;
    }
    // Penalize lyrics if "official audio" is available in another result (we just penalize lyrics slightly)
    if (title.includes('lyrics') || title.includes('letra')) {
        score -= 10;
    }
    // Duration checks
    if (duration > 0) {
        if (duration > 480)
            score -= 80; // > 8 mins is bad
        if (duration < 90)
            score -= 80; // < 1:30 min is bad
        if (duration >= 90 && duration <= 480)
            score += 20; // 1:30 to 8:00 is ideal
    }
    return score;
}
