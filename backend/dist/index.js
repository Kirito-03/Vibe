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
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const axios_1 = __importDefault(require("axios"));
const db_1 = __importDefault(require("./db"));
const auth_1 = __importDefault(require("./routes/auth"));
const music_1 = __importDefault(require("./routes/music"));
const downloads_1 = __importDefault(require("./routes/downloads"));
const user_1 = __importDefault(require("./routes/user"));
const dev_1 = __importDefault(require("./routes/dev"));
const auth_2 = require("./middleware/auth");
const recommendationStore_1 = require("./services/recommendationStore");
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
const normalizeBaseUrl = (raw) => raw.replace(/\/+$/, '');
const getEnvBool = (raw) => {
    if (!raw)
        return false;
    return raw === 'true' || raw === '1' || raw === 'yes';
};
const convertUrl = normalizeBaseUrl(process.env.CONVERT_URL || process.env.DOWNLOADER_URL || 'http://convert:8000');
const convertTimeoutMs = (() => {
    const raw = Number.parseInt(process.env.CONVERT_TIMEOUT_MS || '20000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 20000;
})();
const workerEnabled = getEnvBool(process.env.MEDIA_WORKER_ENABLED) && !!process.env.MEDIA_WORKER_URL;
const workerUrl = process.env.MEDIA_WORKER_URL ? normalizeBaseUrl(process.env.MEDIA_WORKER_URL) : '';
const workerTimeoutMs = (() => {
    const raw = Number.parseInt(process.env.MEDIA_WORKER_TIMEOUT_MS || '30000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 30000;
})();
const deepseekEnabledFlag = getEnvBool(process.env.DEEPSEEK_RECOMMENDATIONS_ENABLED);
const deepseekHasKey = !!String(process.env.DEEPSEEK_API_KEY || '').trim();
const deepseekModel = String(process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim() || 'deepseek-chat';
const deepseekTimeoutMs = (() => {
    const raw = Number.parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '5000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 5000;
})();
app.set('trust proxy', 1);
// Middleware: Escudo Modificado para permitir a Capacitor (Android)
const baseOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5173'];
const allowedOrigins = [...baseOrigins, 'http://localhost', 'capacitor://localhost'];
// ─── Security: Helmet (HTTP headers) ────────────────────────────────────────
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false, // Desactivado: el CSP lo gestiona Cloudflare/Nginx
    crossOriginEmbedderPolicy: false, // Necesario para que el audio funcione
}));
// ─── Security: Rate Limiting ──────────────────────────────────────────────────
// Límite general: 200 peticiones cada 15 minutos por IP
const generalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, code: 'RATE_LIMIT', message: 'Demasiadas peticiones. Inténtalo más tarde.' },
});
// Límite de auth: 20 intentos de login cada 15 minutos (anti brute-force)
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, code: 'RATE_LIMIT_AUTH', message: 'Demasiados intentos de autenticación.' },
});
// Límite de música: 60 búsquedas por minuto por IP (anti-scraping)
const musicLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, code: 'RATE_LIMIT_MUSIC', message: 'Límite de búsquedas alcanzado. Espera un momento.' },
});
app.use(express_1.default.json({ limit: '2mb', strict: false }));
app.use(express_1.default.text({ limit: '2mb', type: '*/*' }));
app.use((0, cors_1.default)({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.get('/health', (_req, res) => res.status(200).send('ok'));
// Routes con rate limiting diferenciado
app.use('/api/auth', authLimiter, auth_1.default);
app.use('/api/music', generalLimiter, musicLimiter, auth_2.requireAuth, music_1.default);
app.use('/api/downloads', generalLimiter, auth_2.requireAuth, downloads_1.default);
app.use('/api/user', generalLimiter, auth_2.requireAuth, user_1.default);
app.use('/api/dev', generalLimiter, auth_2.requireAuth, dev_1.default);
app.use((err, req, res, next) => {
    console.error('[express] unhandled error', {
        method: req.method,
        path: req.originalUrl,
        error: (err === null || err === void 0 ? void 0 : err.message) || err,
        stack: err === null || err === void 0 ? void 0 : err.stack,
    });
    if (res.headersSent)
        return next(err);
    res.status(500).json({
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'Ocurrió un error interno controlado'
    });
});
const startServer = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('[convert]', { url: convertUrl, timeoutMs: convertTimeoutMs });
    console.log('[worker]', { enabled: workerEnabled, url: process.env.MEDIA_WORKER_URL || null, timeoutMs: workerTimeoutMs });
    if (deepseekEnabledFlag && !deepseekHasKey) {
        console.warn('[deepseek] enabled=true but api key is missing (will fallback to local recommendations)');
    }
    console.log('[deepseek]', { enabled: deepseekEnabledFlag && deepseekHasKey, model: deepseekModel, timeoutMs: deepseekTimeoutMs });
    try {
        yield db_1.default.query('SELECT 1');
        console.log('[db] initial connection ok');
        try {
            yield (0, recommendationStore_1.ensureRecommendationSchema)();
            console.log('[recommendations] schema ok');
        }
        catch (error) {
            console.warn('[recommendations] schema ensure failed', { message: error === null || error === void 0 ? void 0 : error.message });
        }
    }
    catch (error) {
        console.error('[db] initial connection failed (server will still start, but some routes may degrade)', error);
    }
    app.listen(port, () => {
        console.log(`Server is listening on port ${port}`);
        (() => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            try {
                const res = yield axios_1.default.get(`${convertUrl}/health`, { timeout: 3000 });
                console.log('[convert] health', { ok: res.status >= 200 && res.status < 300, status: res.status });
            }
            catch (error) {
                console.warn('[convert] health failed', { status: (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status, message: error === null || error === void 0 ? void 0 : error.message });
            }
            if (workerEnabled) {
                try {
                    const res = yield axios_1.default.get(`${workerUrl}/health`, { timeout: 3000 });
                    console.log('[worker] health', { ok: res.status >= 200 && res.status < 300, status: res.status });
                }
                catch (error) {
                    console.warn('[worker] health failed', { status: (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.status, message: error === null || error === void 0 ? void 0 : error.message });
                }
            }
        }))();
    });
});
process.on('unhandledRejection', (reason) => {
    console.error('[process] unhandledRejection', reason);
});
process.on('uncaughtException', (error) => {
    console.error('[process] uncaughtException', error);
});
startServer();
