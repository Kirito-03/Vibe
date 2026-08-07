"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.dedupeByKey = exports.asyncHandler = void 0;
/**
 * Wrap an async route handler and forward errors to Express error middleware.
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
exports.asyncHandler = asyncHandler;
/**
 * Remove duplicate items from an array based on a key extractor function.
 * Preserves the first occurrence of each unique key.
 */
const dedupeByKey = (items, keyFn) => {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const k = keyFn(item);
        if (!seen.has(k)) {
            seen.add(k);
            result.push(item);
        }
    }
    return result;
};
exports.dedupeByKey = dedupeByKey;
/**
 * Express error handling middleware to format JSON error responses.
 */
const errorHandler = (err, _req, res, _next) => {
    var _a, _b, _c;
    console.error('[error] Unhandled error:', err);
    const status = (err === null || err === void 0 ? void 0 : err.status) || ((_a = err === null || err === void 0 ? void 0 : err.response) === null || _a === void 0 ? void 0 : _a.status) || 500;
    const message = (err === null || err === void 0 ? void 0 : err.message) || ((_c = (_b = err === null || err === void 0 ? void 0 : err.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.detail) || 'Internal server error';
    res.status(status).json({ ok: false, error: message });
};
exports.errorHandler = errorHandler;
