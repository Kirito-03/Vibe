"use strict";
/**
 * searchDeepseekRerank.ts — Reranker opcional con DeepSeek
 *
 * REGLAS:
 *  - Solo reordena candidatos ya encontrados por el pipeline local.
 *  - NO inventa canciones ni URLs.
 *  - Si falla, el pipeline usa el ranking local sin cambios.
 *  - Desactivado por defecto (DEEPSEEK_SEARCH_RERANK_ENABLED=false).
 *
 * Variables de entorno:
 *   DEEPSEEK_SEARCH_RERANK_ENABLED    = false (default)
 *   DEEPSEEK_SEARCH_RERANK_TIMEOUT_MS = 3000  (default)
 *   DEEPSEEK_SEARCH_RERANK_MAX_ITEMS  = 20    (default)
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rerankWithDeepSeek = exports.isSearchRerankEnabled = void 0;
const axios_1 = __importDefault(require("axios"));
const deepseekRecommendations_1 = require("./deepseekRecommendations");
const getEnvBool = (raw) => {
    if (!raw)
        return false;
    return raw === 'true' || raw === '1' || raw === 'yes';
};
const isSearchRerankEnabled = () => {
    if (!getEnvBool(process.env.DEEPSEEK_SEARCH_RERANK_ENABLED))
        return false;
    const cfg = (0, deepseekRecommendations_1.getDeepSeekConfig)();
    return !!cfg.apiKey;
};
exports.isSearchRerankEnabled = isSearchRerankEnabled;
/**
 * Dado un query del usuario y una lista de candidatos ya rankeados localmente,
 * pide a DeepSeek que reordene los candidatos según relevancia.
 *
 * Devuelve la lista reordenada. Si falla, devuelve los items originales.
 */
const rerankWithDeepSeek = (rawQuery, items) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    if (!(0, exports.isSearchRerankEnabled)() || items.length === 0)
        return items;
    const maxItems = Math.min(items.length, Number.parseInt(process.env.DEEPSEEK_SEARCH_RERANK_MAX_ITEMS || '20', 10) || 20);
    const timeoutMs = Math.min(Number.parseInt(process.env.DEEPSEEK_SEARCH_RERANK_TIMEOUT_MS || '3000', 10) || 3000, 8000);
    const toRank = items.slice(0, maxItems);
    const rest = items.slice(maxItems);
    // Asignar IDs temporales para que DeepSeek los devuelva en orden
    const mapped = toRank.map((item, i) => ({
        _rerankId: String(i),
        title: String(item.title || '').trim().slice(0, 80),
        artist: String(item.artist || item.uploader || '').trim().slice(0, 60),
        duration: Number(item.duration_seconds || item.duration || 0) || null,
        source: String(item.source || ''),
    }));
    const cfg = (0, deepseekRecommendations_1.getDeepSeekConfig)();
    const model = String(process.env.DEEPSEEK_SEARCH_RERANK_MODEL || cfg.model || 'deepseek-chat');
    const systemPrompt = [
        'Eres un asistente de búsqueda musical.',
        'Se te dará una lista de candidatos de canciones y una búsqueda del usuario.',
        'Tu tarea: reordenar los candidatos por relevancia con la búsqueda.',
        'REGLAS ESTRICTAS:',
        '- Devuelve SOLO JSON válido con la forma {"order": ["0","1","2",...]}',
        '- Usa solo los _rerankId que recibiste, sin inventar nuevos.',
        '- No inventes canciones ni cambies los datos.',
        '- Si no puedes decidir, devuelve el orden original.',
        '- Penaliza: karaoke, instrumental, slowed, sped up, reverb, cover — a menos que la búsqueda lo pida.',
        '- Prioriza: versión official audio/video, artista coincide con búsqueda, título coincide.',
    ].join('\n');
    const userPrompt = [
        `Búsqueda: ${JSON.stringify(rawQuery)}`,
        '',
        'Candidatos:',
        JSON.stringify(mapped, null, 2),
        '',
        'Devuelve el JSON con el orden óptimo de _rerankId.',
    ].join('\n');
    try {
        const res = yield axios_1.default.post(`${cfg.baseUrl}/chat/completions`, {
            model,
            temperature: 0.0,
            max_tokens: 200,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        }, {
            timeout: timeoutMs,
            headers: {
                Authorization: `Bearer ${cfg.apiKey}`,
                'Content-Type': 'application/json',
            },
        });
        const content = String(((_d = (_c = (_b = (_a = res === null || res === void 0 ? void 0 : res.data) === null || _a === void 0 ? void 0 : _a.choices) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.message) === null || _d === void 0 ? void 0 : _d.content) || '').trim();
        if (!content)
            return items;
        let parsed = null;
        try {
            parsed = JSON.parse(content);
        }
        catch (_e) {
            const start = content.indexOf('{');
            const end = content.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try {
                    parsed = JSON.parse(content.slice(start, end + 1));
                }
                catch (_f) { }
            }
        }
        const order = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.order) ? parsed.order : null;
        if (!order || order.length === 0)
            return items;
        // Reconstruir en el nuevo orden
        const idToItem = new Map(toRank.map((item, i) => [String(i), item]));
        const reranked = [];
        const usedIds = new Set();
        for (const id of order) {
            const item = idToItem.get(String(id));
            if (item && !usedIds.has(String(id))) {
                reranked.push(item);
                usedIds.add(String(id));
            }
        }
        // Añadir los que no vinieron en el orden (por si DeepSeek omitió alguno)
        for (const [id, item] of idToItem.entries()) {
            if (!usedIds.has(id))
                reranked.push(item);
        }
        console.log('[search/rerank] deepseek reranked', {
            query: rawQuery,
            before: toRank.length,
            after: reranked.length,
        });
        return [...reranked, ...rest];
    }
    catch (error) {
        console.warn('[search/rerank] deepseek failed, using local ranking', {
            error: error === null || error === void 0 ? void 0 : error.message,
            query: rawQuery,
        });
        return items;
    }
});
exports.rerankWithDeepSeek = rerankWithDeepSeek;
