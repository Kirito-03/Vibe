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

/** Representa un archivo devuelto por el worker en files[] */
export type WorkerFile = {
  name: string;
  url: string;
  kind?: string;
  size?: number;
};

/** Resultado normalizado de una descarga worker */
export type WorkerDownloadResult = {
  ok: boolean;
  cached: boolean;
  source: string;
  files: WorkerFile[];
  /** fileUrl apunta al primer archivo de audio encontrado */
  fileUrl: string | null;
  filename: string | null;
  raw: any;
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
  // Timeout largo para descargas (download puede tardar 60-90s)
  const timeoutMs = Number.parseInt(process.env.MEDIA_WORKER_TIMEOUT_MS || '90000', 10);
  return { url, timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90000 };
};

export const isWorkerEnabled = (): boolean => {
  const enabled = getEnvBool(process.env.MEDIA_WORKER_ENABLED);
  const { url } = getWorkerConfig();
  return enabled && Boolean(url);
};

/** Habilita búsqueda vía worker. Desactivar con MEDIA_WORKER_SEARCH_ENABLED=false */
export const isWorkerSearchEnabled = (): boolean => {
  if (!isWorkerEnabled()) return false;
  const raw = process.env.MEDIA_WORKER_SEARCH_ENABLED;
  if (raw === undefined || raw === '') return true;
  return getEnvBool(raw);
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
const CAPABILITIES_TTL_MS = 60_000;
const UNHEALTHY_COOLDOWN_MS = 30_000;

// Health siempre usa timeout corto (3s) para no bloquear requests
const HEALTH_TIMEOUT_MS = 3000;

export const workerHealth = async (): Promise<{
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
}> => {
  if (!isWorkerEnabled()) return { ok: false, status: 0 };

  if (Date.now() < _workerUnhealthyUntil) {
    return { ok: false, status: 0, error: 'worker-cooldown' };
  }

  const { url } = getWorkerConfig();
  try {
    const res = await axios.get(`${url}/health`, { timeout: HEALTH_TIMEOUT_MS });
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
// Download concurrency queue
// ---------------------------------------------------------------------------

const workerConcurrencyLimit = (): number => {
  const raw = Number.parseInt(process.env.WORKER_DOWNLOAD_CONCURRENCY || '1', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
};

const workerQueueMax = (): number => {
  const raw = Number.parseInt(process.env.WORKER_DOWNLOAD_QUEUE_MAX || '5', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
};

let _activeWorkerDownloads = 0;
const _workerDownloadQueue: Array<() => void> = [];

// Log effective concurrency at module load time so it's visible in backend logs
console.log('[worker/queue] concurrency=' + workerConcurrencyLimit() + ' queueMax=' + workerQueueMax());

const acquireWorkerSlot = (): Promise<void> => {
  const limit = workerConcurrencyLimit();
  const maxQ = workerQueueMax();

  if (_activeWorkerDownloads < limit) {
    _activeWorkerDownloads++;
    console.log('[worker/queue] start', { active: _activeWorkerDownloads, limit });
    return Promise.resolve();
  }

  if (_workerDownloadQueue.length >= maxQ) {
    console.warn('[worker/queue] rejected: queue full', { active: _activeWorkerDownloads, limit, queued: _workerDownloadQueue.length, maxQ });
    return Promise.reject(new Error('Demasiadas descargas en cola. Intenta más tarde.'));
  }

  return new Promise((resolve) => {
    console.log('[worker/queue] waiting', { active: _activeWorkerDownloads, limit, queued: _workerDownloadQueue.length + 1 });
    _workerDownloadQueue.push(() => {
      _activeWorkerDownloads++;
      console.log('[worker/queue] start (dequeued)', { active: _activeWorkerDownloads, limit });
      resolve();
    });
  });
};

const releaseWorkerSlot = () => {
  _activeWorkerDownloads = Math.max(0, _activeWorkerDownloads - 1);
  const next = _workerDownloadQueue.shift();
  if (next) {
    next();
  } else {
    console.log('[worker/queue] done', { active: _activeWorkerDownloads });
  }
};

// ---------------------------------------------------------------------------
// Normalize worker download response — supports files[] AND legacy flat format
// ---------------------------------------------------------------------------

/**
 * El worker universal devuelve:
 *   { ok: true, files: [{ name, url, kind, size }], cached: boolean, source: string }
 *
 * Versiones viejas devolvían:
 *   { ok: true, url: "...", audioUrl: "...", file_url: "..." }
 *
 * Esta función normaliza ambos formatos.
 */
export const normalizeWorkerResponse = (data: any): WorkerDownloadResult => {
  const ok = data?.ok === true || data?.success === true;
  const cached = data?.cached === true;
  const source = String(data?.source || 'worker');

  // Extraer files[] (formato nuevo)
  const rawFiles: any[] = Array.isArray(data?.files) ? data.files : [];
  const files: WorkerFile[] = rawFiles
    .filter((f) => f && typeof f.url === 'string' && f.url.startsWith('http'))
    .map((f) => ({
      name: String(f.name || ''),
      url: String(f.url),
      kind: String(f.kind || 'audio'),
      size: Number(f.size || 0),
    }));

  // Encontrar primer archivo de audio
  const audioFile = files.find((f) => f.kind === 'audio') || files[0] || null;

  // Fallback: formato plano antiguo
  const legacyUrl =
    typeof data?.url === 'string' && data.url.startsWith('http') ? data.url :
    typeof data?.audioUrl === 'string' && data.audioUrl.startsWith('http') ? data.audioUrl :
    typeof data?.file_url === 'string' && data.file_url.startsWith('http') ? data.file_url :
    null;

  const fileUrl = audioFile?.url || legacyUrl || null;
  const filename = audioFile?.name || data?.filename || data?.name || null;

  console.log('[worker/download] response shape', {
    ok,
    filesCount: files.length,
    cached,
    source,
    fileUrl: fileUrl ? fileUrl.slice(0, 80) : null,
    size: audioFile?.size || null,
  });

  return { ok, cached, source, files, fileUrl, filename, raw: data };
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
// Download — Vibe fallback (siempre pide audio, con concurrencia limitada)
// ---------------------------------------------------------------------------

/**
 * Descarga audio para Vibe como fallback cuando Convert falla.
 * Siempre envía kind="audio" explícitamente.
 * Usa cola de concurrencia para no saturar el worker.
 */
export const downloadAudioWithWorker = async (
  urlInput: string,
  opts?: { format?: string; quality?: string }
): Promise<WorkerDownloadResult | null> => {
  if (!isWorkerEnabled()) return null;
  const url = String(urlInput || '').trim();
  if (!url) return null;

  const caps = await getWorkerCapabilities().catch(() => null);
  if (caps?.download === false) {
    console.log('[worker/download] skipped no-capability');
    return null;
  }

  const { url: baseUrl, timeoutMs } = getWorkerConfig();

  await acquireWorkerSlot();
  try {
    console.log('[worker/download] fallback start', { url, kind: 'audio', format: opts?.format || 'mp3' });
    const res = await axios.post(
      `${baseUrl}/download`,
      {
        url,
        kind: 'audio',
        format: opts?.format || 'mp3',
        quality: opts?.quality || 'medium',
      },
      { timeout: timeoutMs }
    );

    const norm = normalizeWorkerResponse(res.data);

    if (norm.ok && norm.fileUrl) {
      console.log('[worker/download] ok', {
        cached: norm.cached,
        fileUrl: norm.fileUrl.slice(0, 80),
        size: norm.files[0]?.size || null,
      });
      return norm;
    }

    if (norm.ok && norm.files.length === 0) {
      console.warn('[worker/download] empty_response', { ok: norm.ok, cached: norm.cached });
      return null;
    }

    console.warn('[worker/download] empty_response', { ok: norm.ok, filesCount: norm.files.length });
    return null;
  } catch (error: any) {
    console.warn('[worker/download] failed', {
      url,
      error: error?.message,
      status: error?.response?.status,
    });
    return null;
  } finally {
    releaseWorkerSlot();
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
): Promise<WorkerDownloadResult | null> => {
  if (!isWorkerEnabled()) return null;
  const url = String(urlInput || '').trim();
  if (!url) return null;
  const { url: baseUrl, timeoutMs } = getWorkerConfig();

  await acquireWorkerSlot();
  try {
    console.log('[worker/download] start', { url, ...opts });
    const res = await axios.post(
      `${baseUrl}/download`,
      { url, kind: opts?.kind, format: opts?.format, quality: opts?.quality },
      { timeout: timeoutMs }
    );

    const norm = normalizeWorkerResponse(res.data);

    if (norm.ok && norm.fileUrl) {
      console.log('[worker/download] ok', { cached: norm.cached, fileUrl: norm.fileUrl.slice(0, 80) });
      return norm;
    }

    console.warn('[worker/download] empty_response', { ok: norm.ok, filesCount: norm.files.length });
    return null;
  } catch (error: any) {
    console.warn('[worker/download] failed', {
      url,
      error: error?.message,
      status: error?.response?.status,
    });
    return null;
  } finally {
    releaseWorkerSlot();
  }
};

// Alias para compatibilidad con código existente
export const downloadWithWorker = async (urlInput: string): Promise<WorkerDownloadResult | null> => {
  return downloadWithWorkerOptions(urlInput, { kind: 'audio', format: 'mp3' });
};
