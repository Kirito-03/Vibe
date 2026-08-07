"use strict";
/**
 * searchRanking.ts — Motor de ranking y deduplicación para búsqueda manual
 *
 * SEPARADO de recommendations/radio: aquí se usa precisión alta.
 * Recomendaciones usan rankRecommendationResults (otro archivo).
 *
 * Reglas:
 *  - El mismo videoId solo aparece una vez (aunque venga de convert + catalog + local)
 *  - artist::titleNorm deduplication con elección del mejor duplicado
 *  - Penalizaciones fuertes por slowed/sped up/karaoke/etc. (salvo que el user lo pida)
 *  - Score 0 queda filtrado; score negativo también.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankSearchResults = exports.dedupeSearchResults = exports.getTrackDedupeKeys = exports.scoreSearchResult = exports.normalizeSearchQuery = exports.tokenizeQuery = exports.normalizeTextFull = exports.normalizeText = void 0;
// ---------------------------------------------------------------------------
// Palabras stop (artículos/preposiciones)
// ---------------------------------------------------------------------------
const stopWords = new Set([
    'de', 'del', 'la', 'las', 'el', 'los', 'y', 'o', 'a', 'un', 'una',
    'unos', 'unas', 'por', 'para', 'con', 'en', 'al', 'the', 'and', 'of', 'to',
]);
// Palabras que siempre se preservan aunque sean "ruido"
const keepWords = new Set([
    'remix', 'live', 'official', 'anime', 'opening', 'op', 'ost', 'lofi',
    'karaoke', 'lyrics', 'letra', 'cover', 'mix', 'slowed', 'reverb', 'spedup',
    'sped', 'instrumental', 'acoustic', 'unplugged',
]);
// Palabras genéricas que solos no indican coincidencia
const genericTokens = new Set([
    'music', 'musica', 'audio', 'official', 'video', 'song', 'new',
    'trending', 'hits', 'moments', 'momentos', 'mv', 'hd', '4k',
]);
// ---------------------------------------------------------------------------
// Normalización de texto
// ---------------------------------------------------------------------------
const normalizeText = (text) => {
    const raw = String(text !== null && text !== void 0 ? text : '');
    if (!raw)
        return '';
    return raw
        .trim()
        .toLowerCase()
        // Quitar tildes
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        // Quitar emojis
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, ' ')
        .replace(/[\u2600-\u27BF]/g, ' ')
        // Quitar contenido entre paréntesis/corchetes solo para comparación
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        // Quitar comillas y símbolos raros
        .replace(/[''"""]/g, '')
        .replace(/[^a-z0-9\s:/.\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};
exports.normalizeText = normalizeText;
/** Normaliza conservando paréntesis (para display/scoring parcial) */
const normalizeTextFull = (text) => {
    const raw = String(text !== null && text !== void 0 ? text : '');
    if (!raw)
        return '';
    return raw
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, ' ')
        .replace(/[''"""]/g, '')
        .replace(/[^a-z0-9\s:/.\-()[\]]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};
exports.normalizeTextFull = normalizeTextFull;
const tokenizeQuery = (query) => {
    const normalized = (0, exports.normalizeText)(query);
    if (!normalized)
        return [];
    return normalized
        .split(' ')
        .filter(Boolean)
        .filter((p) => (stopWords.has(p) ? keepWords.has(p) : p.length >= 2))
        .slice(0, 12);
};
exports.tokenizeQuery = tokenizeQuery;
const normalizeSearchQuery = (query) => {
    const raw = String(query || '').trim();
    const normalized = (0, exports.normalizeText)(raw);
    const tokens = (0, exports.tokenizeQuery)(raw);
    const rawLower = raw.toLowerCase();
    return {
        raw,
        normalized,
        tokens,
        wantsKaraoke: /\bkaraoke\b/i.test(rawLower),
        wantsLyrics: /\b(lyrics|letra)\b/i.test(rawLower),
        wantsRemix: /\bremix\b/i.test(rawLower),
        wantsCover: /\bcover\b/i.test(rawLower),
        wantsSlowed: /\bslowed\b/i.test(rawLower),
        wantsSpedUp: /\b(sped\s*up|speed\s*up|speedup)\b/i.test(rawLower),
        wantsReverb: /\breverb\b/i.test(rawLower),
        wantsLive: /\b(live|en\s*vivo|en\s*directo)\b/i.test(rawLower),
        wantsInstrumental: /\binstrumental\b/i.test(rawLower),
    };
};
exports.normalizeSearchQuery = normalizeSearchQuery;
// ---------------------------------------------------------------------------
// Getters de campos con fallbacks
// ---------------------------------------------------------------------------
const getItemTitle = (item) => String((item === null || item === void 0 ? void 0 : item.title) || '').trim();
const getItemArtist = (item) => String((item === null || item === void 0 ? void 0 : item.artist) || (item === null || item === void 0 ? void 0 : item.uploader) || '').trim();
const getItemDuration = (item) => {
    var _a, _b;
    const d = Number((_b = (_a = item === null || item === void 0 ? void 0 : item.duration_seconds) !== null && _a !== void 0 ? _a : item === null || item === void 0 ? void 0 : item.duration) !== null && _b !== void 0 ? _b : 0);
    return Number.isFinite(d) && d > 0 ? d : null;
};
const hasCover = (item) => {
    const url = String((item === null || item === void 0 ? void 0 : item.thumbnail_url) || (item === null || item === void 0 ? void 0 : item.thumbnail) || (item === null || item === void 0 ? void 0 : item.imageUrl) || (item === null || item === void 0 ? void 0 : item.image_url) || '').trim();
    return !!url && !url.includes('ui-avatars');
};
const hasLocalAudio = (item) => {
    const audio = String((item === null || item === void 0 ? void 0 : item.audioUrl) || (item === null || item === void 0 ? void 0 : item.file_url) || '').trim();
    return !!audio && /^https?:\/\//i.test(audio) && (item === null || item === void 0 ? void 0 : item.source) === 'local';
};
const getYoutubeId = (item) => {
    const raw = String((item === null || item === void 0 ? void 0 : item.youtube_id) || '').trim() ||
        String((item === null || item === void 0 ? void 0 : item.sourceId) || '').trim() ||
        String((item === null || item === void 0 ? void 0 : item.id) || '').trim();
    if (!raw)
        return '';
    // Extraer de URL si es URL
    try {
        const u = new URL(raw);
        return u.searchParams.get('v') || u.pathname.split('/').pop() || '';
    }
    catch (_a) {
        // Es un ID directo
        return /^[a-zA-Z0-9_-]{8,24}$/.test(raw) ? raw : '';
    }
};
const isLikelyNonMusic = (titleNorm) => {
    if (!titleNorm)
        return true;
    if (/(podcast|episodio|episode|entrevista|interview|trailer|capitulo|capítulo|review|reaction|reaccion|documental|pelicula|película|full\s*movie|serie|gameplay|tutorial|walkthrough|vlog|cine|tiktok\s*version)/i.test(titleNorm))
        return true;
    if (/(playlist|compilation|compilacion|top\s*\d+|mix\s*completo|full\s*album|album\s*completo|megamix|enganchados)/i.test(titleNorm))
        return true;
    if (/\b\d+\s*(hour|hours|hora|horas)\b/i.test(titleNorm))
        return true;
    return false;
};
const isOfficialChannel = (artistNorm) => /\b(official|music|vevo|records?|entertainment|warner|sony|universal|island|atlantic|republic)\b/i.test(artistNorm);
// ---------------------------------------------------------------------------
// Matching de tokens
// ---------------------------------------------------------------------------
const tokenMatchesText = (token, textNorm) => {
    if (!token || !textNorm)
        return false;
    if (textNorm.includes(token))
        return true;
    if (token.length >= 4) {
        const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        return re.test(textNorm);
    }
    return textNorm === token;
};
const scoreSearchResult = (q, item) => {
    const title = getItemTitle(item);
    const artist = getItemArtist(item);
    const dur = getItemDuration(item);
    const titleNorm = (0, exports.normalizeText)(title);
    const artistNorm = (0, exports.normalizeText)(artist);
    const fullNorm = `${artistNorm} ${titleNorm}`.trim();
    const titleFull = (0, exports.normalizeTextFull)(title);
    const tokens = q.tokens;
    const phrase = q.normalized;
    const matchedTokens = [];
    let titleMatchCount = 0;
    let fullMatchCount = 0;
    let artistMatchCount = 0;
    for (const t of tokens) {
        const inTitle = tokenMatchesText(t, titleNorm);
        const inArtist = tokenMatchesText(t, artistNorm);
        const inFull = inTitle || inArtist || tokenMatchesText(t, fullNorm);
        if (inFull)
            matchedTokens.push(t);
        if (inTitle)
            titleMatchCount++;
        if (inFull)
            fullMatchCount++;
        if (inArtist)
            artistMatchCount++;
    }
    let score = 0;
    // ── Coincidencias positivas ──────────────────────────────────────────────
    // Frase exacta en título (máximo bonus)
    if (phrase && titleNorm.includes(phrase))
        score = Math.max(score, 120);
    if (phrase && titleNorm.startsWith(phrase))
        score = Math.max(score, 110);
    // Todos los tokens en título
    const allTokensInTitle = tokens.length > 0 && titleMatchCount >= tokens.length;
    const allTokensInFull = tokens.length > 0 && fullMatchCount >= tokens.length;
    if (allTokensInTitle)
        score = Math.max(score, 90);
    else if (allTokensInFull)
        score = Math.max(score, 65);
    // Ratio de tokens encontrados
    if (tokens.length > 0) {
        const ratio = matchedTokens.length / tokens.length;
        if (ratio >= 0.75)
            score = Math.max(score, 45);
        else if (ratio >= 0.5)
            score = Math.max(score, 28);
    }
    // Artista coincide con tokens importantes
    const importantArtistTokens = tokens.filter((t) => t.length >= 4 && !stopWords.has(t));
    const artistImportantMatched = importantArtistTokens.filter((t) => tokenMatchesText(t, artistNorm));
    if (artistImportantMatched.length > 0)
        score += 35;
    else if (artistMatchCount > 0)
        score += 15;
    // Canal oficial
    if (isOfficialChannel(artistNorm) && allTokensInFull)
        score += 20;
    // Official audio/video bonus (solo si todos los tokens importantes coinciden)
    if (allTokensInFull && /\bofficial\s+(audio|music\s*video|video)\b/i.test(titleFull))
        score += 15;
    // Tiene cover e info de duración
    if (hasCover(item))
        score += 10;
    if (dur && dur > 0 && dur < 60 * 20)
        score += 8;
    // Tiene audio local descargado (priorizar)
    if (hasLocalAudio(item))
        score += 25;
    else if ((item === null || item === void 0 ? void 0 : item.source) === 'local')
        score += 12;
    // ── Penalizaciones ───────────────────────────────────────────────────────
    // Contenido que no es música (fuerte)
    if (isLikelyNonMusic(titleNorm))
        score -= 100;
    // Solo coincide 1 token genérico
    const nonGenericMatched = matchedTokens.filter((t) => !genericTokens.has(t));
    if (nonGenericMatched.length === 0 && matchedTokens.length <= 1)
        score -= 55;
    // Tokens importantes sin coincidencia (búsqueda muy irrelevante)
    const importantTokens = tokens.filter((t) => t.length >= 4 || keepWords.has(t));
    const importantMatched = importantTokens.filter((t) => matchedTokens.includes(t));
    if (importantTokens.length > 0 && importantMatched.length === 0)
        score -= 85;
    else if (importantTokens.length > 1 && importantMatched.length < importantTokens.length / 2)
        score -= 40;
    // Variantes no deseadas (solo penalizar si el usuario NO las pidió)
    if (!q.wantsKaraoke && /\bkaraoke\b/i.test(titleFull))
        score -= 50;
    if (!q.wantsInstrumental && /\binstrumental\b/i.test(titleFull))
        score -= 45;
    if (!q.wantsCover && /\bcover\b/i.test(titleFull))
        score -= 40;
    if (!q.wantsSlowed && /\bslowed\b/i.test(titleFull))
        score -= 40;
    if (!q.wantsSpedUp && /\bsped\s*up\b/i.test(titleFull))
        score -= 40;
    if (!q.wantsReverb && /\breverb\b/i.test(titleFull))
        score -= 35;
    if (!q.wantsRemix && /\bremix\b/i.test(titleFull))
        score -= 30;
    if (!q.wantsLyrics && /\b(lyrics|letra)\b/i.test(titleFull))
        score -= 25;
    if (!q.wantsLive && /\b(live|en\s*vivo|en\s*directo|concierto|concert)\b/i.test(titleFull))
        score -= 20;
    // Duración extrema (probablemente playlist o clip)
    if (dur && dur > 60 * 15)
        score -= 30;
    if (dur && dur < 30)
        score -= 25;
    return {
        score,
        matchedTokens,
        titleNorm,
        artistNorm,
        fullNorm,
        youtubeId: getYoutubeId(item),
        duration: dur,
        hasCover: hasCover(item),
        hasLocalAudio: hasLocalAudio(item),
    };
};
exports.scoreSearchResult = scoreSearchResult;
const isBetterCandidate = (next, prev) => {
    // 1. Score mayor
    if (next.score > prev.score)
        return true;
    if (next.score < prev.score)
        return false;
    // 2. Tiene audio local
    if (next.hasLocalAudio && !prev.hasLocalAudio)
        return true;
    if (!next.hasLocalAudio && prev.hasLocalAudio)
        return false;
    // 3. Tiene cover
    if (next.hasCover && !prev.hasCover)
        return true;
    if (!next.hasCover && prev.hasCover)
        return false;
    // 4. Tiene duración
    if (next.dur && !prev.dur)
        return true;
    // 5. Tiene youtubeId válido
    if (next.youtubeId && !prev.youtubeId)
        return true;
    return false;
};
const getTrackDedupeKeys = (item, meta) => {
    const keys = [];
    // 1. YouTube ID (más fuerte)
    const ytId = meta.youtubeId || getYoutubeId(item);
    if (ytId) {
        keys.push(`yt:${ytId}`);
    }
    // 2. Artist + title normalizado
    if (meta.artistNorm && meta.titleNorm) {
        keys.push(`at:${meta.artistNorm}::${meta.titleNorm}`);
    }
    // 3. Title + duración en bucket de 5s (detecta misma canción de diferentes artistas/canales)
    if (meta.titleNorm) {
        const durBucket = meta.duration ? Math.round(meta.duration / 5) * 5 : -1;
        if (durBucket >= 0) {
            keys.push(`td:${meta.titleNorm}::${durBucket}`);
        }
        // 4. Solo título (último recurso, sin duración)
        keys.push(`t:${meta.titleNorm}`);
    }
    return keys;
};
exports.getTrackDedupeKeys = getTrackDedupeKeys;
const dedupeSearchResults = (q, items) => {
    // Mapa de clave → mejor candidato
    const bestByKey = new Map();
    // Registro de qué items ya fueron "ganados" en alguna clave
    const wonItems = new WeakSet();
    // Primer pasada: construir el mejor candidato por cada clave
    for (const item of items) {
        const meta = (0, exports.scoreSearchResult)(q, item);
        const keys = (0, exports.getTrackDedupeKeys)(item, meta);
        const candidate = {
            item,
            score: meta.score,
            hasCover: meta.hasCover,
            hasLocalAudio: meta.hasLocalAudio,
            dur: meta.duration,
            youtubeId: meta.youtubeId,
        };
        for (const key of keys) {
            const prev = bestByKey.get(key);
            if (!prev || isBetterCandidate(candidate, prev)) {
                bestByKey.set(key, candidate);
            }
        }
    }
    // Segunda pasada: emitir solo un item por grupo de claves compartidas
    const out = [];
    const emittedItems = new WeakSet();
    // Ordenar por score desc antes de emitir
    const allCandidates = Array.from(bestByKey.values());
    allCandidates.sort((a, b) => b.score - a.score || (b.hasCover ? 1 : 0) - (a.hasCover ? 1 : 0));
    // Límite por título: máximo 1 resultado por título normalizado (salvo que sean artistas distintos)
    const titleArtistCount = new Map();
    for (const candidate of allCandidates) {
        const item = candidate.item;
        if (emittedItems.has(item))
            continue;
        // Verificar límite de duplicados por título (permite máximo 1 si artist es diferente)
        const meta = (0, exports.scoreSearchResult)(q, candidate.item);
        const titleKey = meta.titleNorm;
        const artistKey = meta.artistNorm;
        const taKey = `${titleKey}::${artistKey}`;
        const prevCount = titleArtistCount.get(titleKey) || 0;
        if (prevCount >= 1) {
            // Permitir si el artista es diferente al ya emitido, pero limitar a 2 total
            const taCount = titleArtistCount.get(taKey) || 0;
            if (taCount >= 1 || prevCount >= 2)
                continue;
        }
        emittedItems.add(item);
        wonItems.add(item);
        titleArtistCount.set(titleKey, (titleArtistCount.get(titleKey) || 0) + 1);
        titleArtistCount.set(taKey, (titleArtistCount.get(taKey) || 0) + 1);
        out.push(Object.assign(candidate.item, { _score: candidate.score }));
    }
    return out;
};
exports.dedupeSearchResults = dedupeSearchResults;
// ---------------------------------------------------------------------------
// Ranking completo para búsqueda manual
// ---------------------------------------------------------------------------
const rankSearchResults = (rawQuery, items) => {
    const q = (0, exports.normalizeSearchQuery)(rawQuery);
    // 1. Score todos los items
    const scored = items
        .map((it) => ({ it, meta: (0, exports.scoreSearchResult)(q, it) }))
        .sort((a, b) => b.meta.score - a.meta.score ||
        (b.meta.hasCover ? 1 : 0) - (a.meta.hasCover ? 1 : 0) ||
        (b.meta.hasLocalAudio ? 1 : 0) - (a.meta.hasLocalAudio ? 1 : 0));
    // 2. Filtrar por score mínimo (flexible según longitud de query)
    const minTokens = q.tokens.length;
    const baseMin = minTokens >= 2 ? 20 : 0;
    const relaxedMin = minTokens >= 2 ? 10 : 0;
    let filtered = scored.filter((s) => s.meta.score >= baseMin);
    if (filtered.length < 6)
        filtered = scored.filter((s) => s.meta.score >= relaxedMin);
    if (filtered.length < 4)
        filtered = scored.filter((s) => s.meta.score >= 0);
    // 3. Tomar top 120 para deduplicar
    const top = filtered.slice(0, 120).map((s) => Object.assign(s.it, { _score: s.meta.score }));
    console.log('[search/dedupe] before=' + top.length);
    // 4. Deduplicación fuerte
    const deduped = (0, exports.dedupeSearchResults)(q, top);
    console.log('[search/dedupe] after=' + deduped.length + ' removed=' + (top.length - deduped.length));
    // 5. Filtro final de score mínimo
    const final = deduped.filter((it) => typeof it._score !== 'number' || it._score >= Math.min(relaxedMin, 5));
    const topScores = filtered.slice(0, 10).map((s) => ({
        title: getItemTitle(s.it),
        artist: getItemArtist(s.it),
        score: s.meta.score,
        matchedTokens: s.meta.matchedTokens.slice(0, 8),
    }));
    return {
        query: q,
        beforeRank: items.length,
        afterRank: final.length,
        topScores,
        items: final.slice(0, 30),
    };
};
exports.rankSearchResults = rankSearchResults;
