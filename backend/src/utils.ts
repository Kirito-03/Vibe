export type AsyncHandler = (fn: (req: any, res: any, next: any) => Promise<any>) => (req: any, res: any, next: any) => void;

/**
 * Wrap an async route handler and forward errors to Express error middleware.
 */
export const asyncHandler: AsyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Remove duplicate items from an array based on a key extractor function.
 * Preserves the first occurrence of each unique key.
 */
export const dedupeByKey = <T>(items: T[], keyFn: (item: T) => string | number): T[] => {
  const seen = new Set<string | number>();
  const result: T[] = [];
  for (const item of items) {
    const k = keyFn(item);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(item);
    }
  }
  return result;
};

/**
 * Express error handling middleware to format JSON error responses.
 */
export const errorHandler = (err: any, _req: any, res: any, _next: any) => {
  console.error('[error] Unhandled error:', err);
  const status = err?.status || err?.response?.status || 500;
  const message = err?.message || err?.response?.data?.detail || 'Internal server error';
  res.status(status).json({ ok: false, error: message });
};
