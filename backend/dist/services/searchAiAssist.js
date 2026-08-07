"use strict";
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
exports.getSearchQueryAlternatives = exports.isAiSearchAssistEnabled = void 0;
const axios_1 = __importDefault(require("axios"));
const deepseekRecommendations_1 = require("./deepseekRecommendations");
const getEnvBool = (raw) => {
    if (!raw)
        return false;
    return raw === 'true' || raw === '1' || raw === 'yes';
};
const sanitizeQuery = (raw) => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s)
        return '';
    if (s.length > 120)
        return s.slice(0, 120).trim();
    if (/https?:\/\//i.test(s) || /\bwww\./i.test(s) || /\byoutube\.com\b/i.test(s))
        return '';
    return s.replace(/\s+/g, ' ').trim();
};
const dedupe = (queries, limit) => {
    const out = [];
    const seen = new Set();
    for (const q of queries) {
        const cleaned = sanitizeQuery(q);
        if (!cleaned)
            continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(cleaned);
        if (out.length >= limit)
            break;
    }
    return out;
};
const isAiSearchAssistEnabled = () => {
    const enabled = getEnvBool(process.env.AI_SEARCH_ASSIST_ENABLED);
    const cfg = (0, deepseekRecommendations_1.getDeepSeekConfig)();
    return enabled && !!cfg.apiKey;
};
exports.isAiSearchAssistEnabled = isAiSearchAssistEnabled;
const getSearchQueryAlternatives = (inputQuery) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    if (!(0, exports.isAiSearchAssistEnabled)())
        return null;
    const cfg = (0, deepseekRecommendations_1.getDeepSeekConfig)();
    const q = sanitizeQuery(inputQuery);
    if (!q)
        return null;
    const timeoutMsRaw = Number.parseInt(process.env.AI_SEARCH_ASSIST_TIMEOUT_MS || '3000', 10);
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 3000;
    const model = String(process.env.AI_SEARCH_ASSIST_MODEL || cfg.model || 'deepseek-chat').trim() || 'deepseek-chat';
    const payload = {
        model,
        temperature: 0.2,
        max_tokens: 120,
        messages: [
            {
                role: 'system',
                content: 'Eres un asistente de búsqueda musical. Devuelve SOLO JSON válido con la forma {"queries":[...]} y máximo 3 queries. No incluyas URLs.',
            },
            {
                role: 'user',
                content: `Input: ${JSON.stringify(q)}\nDevuelve queries alternativas para corregir o completar la búsqueda, manteniendo la intención.`,
            },
        ],
    };
    try {
        const res = yield axios_1.default.post(`${cfg.baseUrl}/chat/completions`, payload, {
            timeout: timeoutMs,
            headers: {
                Authorization: `Bearer ${cfg.apiKey}`,
                'Content-Type': 'application/json',
            },
        });
        const content = String(((_d = (_c = (_b = (_a = res === null || res === void 0 ? void 0 : res.data) === null || _a === void 0 ? void 0 : _a.choices) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.message) === null || _d === void 0 ? void 0 : _d.content) || '').trim();
        if (!content)
            return null;
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
                catch (_f) {
                    parsed = null;
                }
            }
        }
        const arr = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.queries) ? parsed.queries : null;
        if (!arr)
            return null;
        const queries = dedupe(arr, 3);
        return queries.length > 0 ? queries : null;
    }
    catch (_g) {
        return null;
    }
});
exports.getSearchQueryAlternatives = getSearchQueryAlternatives;
