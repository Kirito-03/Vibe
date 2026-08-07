"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankRecommendationResults = void 0;
const searchRanking_1 = require("./searchRanking");
const trackQuality_1 = require("../utils/trackQuality");
const stop = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'o', 'a', 'the', 'and', 'of', 'to', 'for']);
const tokenize = (raw) => {
    const n = (0, searchRanking_1.normalizeText)(raw);
    if (!n)
        return [];
    return n
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !stop.has(t))
        .slice(0, 10);
};
const getTitle = (it) => String((it === null || it === void 0 ? void 0 : it.title) || '').trim();
const getArtist = (it) => String((it === null || it === void 0 ? void 0 : it.artist) || (it === null || it === void 0 ? void 0 : it.uploader) || '').trim();
const rankRecommendationResults = (opts) => {
    var _a;
    const seedTokens = tokenize(opts.seed || '');
    const topArtistTokens = (((_a = opts.profile) === null || _a === void 0 ? void 0 : _a.topArtists) || []).slice(0, 6).map((a) => (0, searchRanking_1.normalizeText)(a)).filter(Boolean);
    const scored = opts.items.map((it) => {
        const titleNorm = (0, searchRanking_1.normalizeText)(getTitle(it));
        const artistNorm = (0, searchRanking_1.normalizeText)(getArtist(it));
        const fullNorm = `${artistNorm} ${titleNorm}`.trim();
        let score = 0;
        for (const t of seedTokens) {
            if (titleNorm.includes(t))
                score += 8;
            else if (fullNorm.includes(t))
                score += 5;
        }
        for (const a of topArtistTokens) {
            if (a && artistNorm && (artistNorm === a || artistNorm.includes(a)))
                score += 12;
        }
        if (/\bofficial\s+(audio|music\s+video)\b/i.test(titleNorm))
            score += 3;
        if (String((it === null || it === void 0 ? void 0 : it.thumbnail_url) || (it === null || it === void 0 ? void 0 : it.thumbnail) || '').trim())
            score += 2;
        if (!(0, trackQuality_1.isLikelyMusicTrack)(it.title, it.artist))
            score -= 1000;
        return { it, score, titleNorm, artistNorm };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter(s => s.score > -500).map((s) => s.it);
};
exports.rankRecommendationResults = rankRecommendationResults;
