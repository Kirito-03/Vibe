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
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = void 0;
const firebase_1 = require("../firebase");
const requireAuth = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    // Allow browser's native <audio src="..."> to fetch the stream without headers
    if (req.originalUrl &&
        (req.originalUrl.includes('/stream/') || req.originalUrl.includes('/stream-direct'))) {
        return next();
    }
    if (!firebase_1.admin.apps || firebase_1.admin.apps.length === 0) {
        console.error('[auth] firebase admin not initialized', {
            method: req.method,
            path: req.originalUrl,
        });
        return res.status(503).json({ error: 'Auth service unavailable' });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('[auth] missing bearer token', { method: req.method, path: req.originalUrl });
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = yield firebase_1.admin.auth().verifyIdToken(token);
        // Attach the user to the request so downstream handlers can use it
        req.user = decodedToken;
        next();
    }
    catch (error) {
        console.error('[auth] token verification failed', {
            method: req.method,
            path: req.originalUrl,
            error,
        });
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
});
exports.requireAuth = requireAuth;
