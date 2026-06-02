import express from 'express';
import cors from 'cors';
import axios from 'axios';
import pool from './db';
import authRoutes from './routes/auth';
import musicRoutes from './routes/music';
import downloadsRoutes from './routes/downloads';
import userRoutes from './routes/user';
import devRoutes from './routes/dev';
import { requireAuth } from './middleware/auth';
import { ensureRecommendationSchema } from './services/recommendationStore';

const app = express();
const port = process.env.PORT || 3000;
const normalizeBaseUrl = (raw: string) => raw.replace(/\/+$/, '');
const getEnvBool = (raw: string | undefined) => {
  if (!raw) return false;
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

// Middleware: Escudo Modificado para permitir a Capacitor (Android)
const baseOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5173'];
const allowedOrigins = [...baseOrigins, 'http://localhost', 'capacitor://localhost'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '50mb', strict: false }));
app.use(express.text({ limit: '50mb', type: '*/*' }));

app.get('/health', (_req, res) => res.status(200).send('ok'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/music', requireAuth, musicRoutes);
app.use('/api/downloads', requireAuth, downloadsRoutes);
app.use('/api/user', requireAuth, userRoutes);
app.use('/api/dev', requireAuth, devRoutes);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[express] unhandled error', {
    method: req.method,
    path: req.originalUrl,
    error: err,
  });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

const startServer = async () => {
  console.log('[convert]', { url: convertUrl, timeoutMs: convertTimeoutMs });
  console.log('[worker]', { enabled: workerEnabled, url: process.env.MEDIA_WORKER_URL || null, timeoutMs: workerTimeoutMs });
  if (deepseekEnabledFlag && !deepseekHasKey) {
    console.warn('[deepseek] enabled=true but api key is missing (will fallback to local recommendations)');
  }
  console.log('[deepseek]', { enabled: deepseekEnabledFlag && deepseekHasKey, model: deepseekModel, timeoutMs: deepseekTimeoutMs });

  try {
    await pool.query('SELECT 1');
    console.log('[db] initial connection ok');
    try {
      await ensureRecommendationSchema();
      console.log('[recommendations] schema ok');
    } catch (error) {
      console.warn('[recommendations] schema ensure failed', { message: (error as any)?.message });
    }
  } catch (error) {
    console.error('[db] initial connection failed (server will still start, but some routes may degrade)', error);
  }

  app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
    (async () => {
      try {
        const res = await axios.get(`${convertUrl}/health`, { timeout: 3000 });
        console.log('[convert] health', { ok: res.status >= 200 && res.status < 300, status: res.status });
      } catch (error: any) {
        console.warn('[convert] health failed', { status: error?.response?.status, message: error?.message });
      }

      if (workerEnabled) {
        try {
          const res = await axios.get(`${workerUrl}/health`, { timeout: 3000 });
          console.log('[worker] health', { ok: res.status >= 200 && res.status < 300, status: res.status });
        } catch (error: any) {
          console.warn('[worker] health failed', { status: error?.response?.status, message: error?.message });
        }
      }
    })();
  });
};

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[process] uncaughtException', error);
});

startServer();
