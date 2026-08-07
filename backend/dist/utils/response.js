"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asItemsResponse = void 0;
const asItemsResponse = (input, source = 'personalized') => {
    if (Array.isArray(input))
        return { items: input, source };
    if (input && typeof input === 'object' && Array.isArray(input.items)) {
        return { items: input.items, source: input.source || source };
    }
    return { items: [], source: 'empty' };
};
exports.asItemsResponse = asItemsResponse;
