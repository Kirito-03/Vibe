import { Request, Response, NextFunction } from 'express';
import { admin } from '../firebase';

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  // Allow browser's native <audio src="..."> to fetch the stream without headers
  if (
    req.originalUrl &&
    (req.originalUrl.includes('/stream/') || req.originalUrl.includes('/stream-direct'))
  ) {
    return next();
  }

  if (!admin.apps || admin.apps.length === 0) {
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
    const decodedToken = await admin.auth().verifyIdToken(token);
    // Attach the user to the request so downstream handlers can use it
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error('[auth] token verification failed', {
      method: req.method,
      path: req.originalUrl,
      error,
    });
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
