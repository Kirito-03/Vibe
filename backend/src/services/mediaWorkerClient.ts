import axios, { AxiosError } from 'axios';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WorkerItemsResponse<T> = {
  items: T[];
  source?: string;
};

export type WorkerCapabilities = {
  search?: boolean;
  download?: boolean;
  files?: boolean;
  extract?: boolean;
  cleanup?: boolean;
  youtube?: boolean;
  tiktok?: boolean;
  instagram?: boolean;
  facebook?: boolean;
};

export type WorkerTrack = {
  id: string;
  sourceId?: string;
  source: 'youtube' | 'local' | 'downloaded' | 'external';
  title: string;
  artist?: string;
  coverUrl?: string;
  audioUrl?: string | null;
  duration?: number;
  url?: string;
};

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

const normalizeUrl = (raw: string) => raw.replace(/\/+$/, '');

const getEnvBool = (raw: string | undefined): boolean => {
  if (!raw) return false;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

const getWorkerConfig = () => {
  const url = process.env.MEDIA_WORKER_URL
    ? normalizeUrl(process.env.MEDIA_WORKER_URL)
    : '';
  const timeoutMs = Number.parseInt(process.env.MEDIA_WORKER_TIMEOUT_MS || '30000', 10);
  return { url, timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 30000 };
};

export const isWorkerEnabled = (): boolean => {
  const enabled = getEnvBool(process.env.MEDIA_WORKER_ENABLED);
  const { url } = getWorkerConfig();
  if (enabled && url) {
    // Log solo en startup (evitar spam en cada request)
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Bot-detection error patterns (para activar fallback al worker)
// ---------------------------------------------------------------------------

const BOT_DETECTION_PATTERNS = [
  'sign in to confirm',
  "sign in to confirm you're not a bot",
  'cookies',
  'requiere autenticación',
  'requiere autenticación de youtube',
  'bot detection',
  '401',
  '403',
  'age-restricted',
  'private video',
  'video unavailable',
];

export const isBotDetectionError = (error: unknown): boolean => {
  const msg = String(
    (error as any)?.message ||
      (error as any)?.response?.data?.message ||
      (error as any)?.response?.data ||
      ''
  ).toLowerCase();
  return BOT_DETECTION_PATTERNS.some((p) => msg.includes(p.toLowerCase()));
};

export const isConvertFallbackError = (error: unknown): boolean => {
  const status = Number((error as AxiosError)?.response?.status || 0);
  if (status === 401 || status === 403) return true;
  if ((error as AxiosError)?.code === 'ECONNABORTED') return true;
  return isBotDetectionError(error);
};

// ---------------------------------------------------------------------------
// Health & capabilities cache
// ---------------------------------------------------------------------------

let _cachedCapabilities: WorkerCapabilities | null = null;
let _cachedCapabilitiesAt = 0;
let _workerUnhealthyUntil = 0;
const CAPABILITIES_TTL_MS = 60_000; // 1 min
const UNHEALTHY_COOLDOWN_MS = 30_000; // 30s de cooldown si /health falla

export const workerHealth = async (): Promise<{
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
}> => {
  if (!isWorkerEnabled()) return { ok: false, status: 0 };

  // Cooldown: no saturar el celular si ya sabemos que está caído
  if (Date.now() < _workerUnhealthyUntil) {
    return { ok: false, status: 0, error: 'worker-cooldown' };
  }

  const { url, timeoutMs } = getWorkerConfig();
  const healthTimeout = Math.min(timeoutMs, 5000);
  try {
    const res = await axios.get(`${url}/health`, { timeout: healthTimeout });
    const ok = res.status >= 200 && res.status < 300;
    if (ok) {
      const caps = res.data?.capabilities;
      console.log('[worker/health] ok', {
        enabled: true,
        url,
        ...(caps ? { capabilities: caps } : {}),
      });
    }
    return { ok, status: res.status, data: res.data };
  } catch (error: any) {
    // Marcar como unhealthy temporalmente
    _workerUnhealthyUntil = Date.now() + UNHEALTHY_COOLDOWN_MS;
    _cachedCapabilities = null;
    _cachedCapabilitiesAt = 0;
    console.warn('[worker/health] failed', {
      url,
      error: error?.message,
      status: error?.response?.status,
    });
    return { ok: false, status: error?.response?.status || 0, error: error?.message };
  }
};

export const getWorkerCapabilities = async (): Promise<WorkerCapabilities | null> => {
  if (!isWorkerEnabled()) return null;
  const now = Date.now();
  if (_cachedCapabilities && now - _cachedCapabilitiesAt < CAPABILITIES_TTL_MS) {
    return _cachedCapabilities;
  }
  const health = await workerHealth();
  const caps = (health as any)?.data?.capabilities;
  if (caps && typeof caps === 'object') {
    _cachedCapabilities = caps as WorkerCapabilities;
    _cachedCapabilitiesAt = now;
    return _cachedCapabilities;
  }
  _cachedCapabilities = null;
  _cachedCapabilitiesAt = now;
  return null;
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

let _workerSearchDisabledUntil = 0;

export const searchWithWorker = async (
  query: string,
  limit = 10
): Promise<WorkerItemsResponse<WorkerTrack> | null> => {
  if (!isWorkerEnabled()) return null;

  if (Date.now() < _workerSearchDisabledUntil) {
    console.log('[worker/search] skipped no-capability (cooldown)');
    return null;
  }

  const q = String(query || '').trim();
  if (!q) return null;

  // Verificar capability
  const caps = await getWorkerCapabilities().catch(() => null);
  if (caps?.search === false) {
    console.log('[worker/search] skipped no-capability');
    return null;
  }

  const { url, timeoutMs } = getWorkerConfig();
  try {
    console.log('[worker/search] start', { q, limit });
    const res = await axios.post(
      `${url}/search`,
      { q, query: q, limit: Math.min(limit, 10) },
      { timeout: timeoutMs }
    );
    const data = res.data;
    const items: WorkerTrack[] = Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data)
      ? data
      : [];
    console.log('[worker/search] done', { items: items.length });
    return { items, source: data?.source || 'worker' };
  } catch (error: any) {
    const status = Number(error?.response?.status || 0);
    if (status === 404) {
      _workerSearchDisabledUntil = Date.now() + 10 * 60_000;
      console.warn('[worker/search] disabled (404) until cooldown');
      return null;
    }
    console.warn('[worker/search] failed', { q, error: error?.message, status });
    return null;
  }
};

// ---------------------------------------------------------------------------
// Extract (stream URL directo para Vibe)
// ---------------------------------------------------------------------------

export const extractWithWorker = async (
  urlInput: string
): Promise<{ audioUrl?: string; items?: any[]; title?: string } | null> => {
  if (!isWorkerEnabled()) return null;
  const url = String(urlInput || '').trim();
  if (!url) return null;
  const { url: baseUrl, timeoutMs } = getWorkerConfig();
  try {
    console.log('[worker/extract] start', { url });
    const res = await axios.post(`${baseUrl}/extract`, { url }, { timeout: timeoutMs });
    console.log('[worker/extract] ok', { status: res.status });
    return res.data || null;
  } catch (error: any) {
    console.warn('[worker/extract] failed', {
      url,
      error: error?.message,
      status: error?.response?.status,
    });
    return null;
  }
};

// ---------------------------------------------------------------------------
// Download — Vibe fallback (siempre pide audio)
// ---------------------------------------------------------------------------

/**
 * Descarga audio para Vibe como fallback cuando Convert falla.
 * Siempre envía kind="audio" explícitamente.
 */
export const downloadAudioWithWorker = async (
  urlInput: string,
  opts?: { format?: string; quality?: string }
): Promise<any | null> => {
  if (!isWorkerEnabled()) return null;
  const url = String(urlInput || '').trim();
  if (!url) return null;

  const caps = await getWorkerCapabilities().catch(() => null);
  if (caps?.download === false) {
    console.log('[worker/download] skipped no-capability');
    return null;
  }

  const { url: baseUrl, timeoutMs } = getWorkerConfig();
  try {
    console.log('[worker/download] fallback start', { url, kind: 'audio' });
    const res = await axios.post(
      `${baseUrl}/download`,
      {
        url,
        kind: 'audio',     // ← siempre explícito
        format: opts?.format || 'mp3',
        quality: opts?.quality || 'medium',
      },
      { timeout: timeoutMs }
    );
    const cached = res.data?.cached === true;
    console.log('[worker/download] ok', { cached });
    return res.data || null;
  } catch (error: any) {
    console.warn('[worker/download] failed', {
      url,
      error: error?.message,
      status: error?.response?.status,
    });
    return null;
  }
};

// ---------------------------------------------------------------------------
// Download genérico (sistema descargador)
// ---------------------------------------------------------------------------

export const downloadWithWorkerOptions = async (
  urlInput: string,
  opts?: {
    kind?: 'audio' | 'video' | 'image';
    format?: string;
    quality?: string;
  }
): Promise<any | null> => {
  if (!isWorkerEnabled()) return null;
  const url = String(urlInput || '').trim();
  if (!url) return null;
  const { url: baseUrl, timeoutMs } = getWorkerConfig();
  try {
    console.log('[worker/download] start', { url, ...opts });
    const res = await axios.post(
      `${baseUrl}/download`,
      { url, kind: opts?.kind, format: opts?.format, quality: opts?.quality },
      { timeout: timeoutMs }
    );
    const cached = res.data?.cached === true;
    console.log('[worker/download] ok', { cached });
    return res.data || null;
  } catch (error: any) {
    console.warn('[worker/download] failed', {
      url,
      error: error?.message,
      status: error?.response?.status,
    });
    return null;
  }
};

// Alias para compatibilidad con código existente
export const downloadWithWorker = async (urlInput: string): Promise<any | null> => {
  return downloadWithWorkerOptions(urlInput, { kind: 'audio', format: 'mp3' });
};
