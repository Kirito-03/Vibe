import axios from 'axios';

type WorkerItemsResponse<T> = {
  items: T[];
  source?: string;
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

const normalizeUrl = (raw: string) => raw.replace(/\/+$/, '');

const getEnvBool = (raw: string | undefined) => {
  if (!raw) return false;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

export const isWorkerEnabled = () => {
  const enabled = getEnvBool(process.env.MEDIA_WORKER_ENABLED);
  const url = process.env.MEDIA_WORKER_URL;
  return enabled && !!url;
};

export const isWorkerSearchEnabled = () => {
  if (!isWorkerEnabled()) return false;
  return getEnvBool(process.env.MEDIA_WORKER_SEARCH_ENABLED);
};

const getWorkerConfig = () => {
  const url = process.env.MEDIA_WORKER_URL ? normalizeUrl(process.env.MEDIA_WORKER_URL) : '';
  const timeoutMs = Number.parseInt(process.env.MEDIA_WORKER_TIMEOUT_MS || '30000', 10);
  return { url, timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 30000 };
};

const logBase = (extra: Record<string, unknown>) => {
  const { timeoutMs } = getWorkerConfig();
  console.log('[worker]', {
    enabled: isWorkerEnabled(),
    url: process.env.MEDIA_WORKER_URL || null,
    timeoutMs,
    ...extra,
  });
};

export const workerHealth = async () => {
  if (!isWorkerEnabled()) return { ok: false, status: 0 };
  const { url, timeoutMs } = getWorkerConfig();
  const healthTimeoutMs = Math.min(timeoutMs, 3000);
  try {
    const res = await axios.get(`${url}/health`, { timeout: healthTimeoutMs });
    logBase({ endpoint: '/health', status: res.status, timeoutMs: healthTimeoutMs });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, data: res.data };
  } catch (error: any) {
    logBase({ endpoint: '/health', error: error?.message, status: error?.response?.status, timeoutMs: healthTimeoutMs });
    return { ok: false, status: error?.response?.status || 0, error: error?.message };
  }
};

export const searchWithWorker = async (query: string, limit = 30): Promise<WorkerItemsResponse<WorkerTrack> | null> => {
  if (!isWorkerSearchEnabled()) {
    if (isWorkerEnabled()) logBase({ endpoint: '/search', disabled: true });
    return null;
  }
  const q = String(query || '').trim();
  if (!q) return null;
  const { url, timeoutMs } = getWorkerConfig();
  try {
    logBase({ endpoint: '/search', query: q, timeoutMs });
    const res = await axios.post(`${url}/search`, { q, query: q, limit }, { timeout: timeoutMs });
    const data = res.data;
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    logBase({ endpoint: '/search', status: res.status, items: items.length });
    return { items, source: data?.source || 'worker' };
  } catch (error: any) {
    logBase({
      endpoint: '/search',
      query: q,
      error: error?.message,
      status: error?.response?.status,
    });
    return null;
  }
};

export const extractWithWorker = async (urlInput: string): Promise<{ audioUrl?: string; title?: string } | null> => {
  if (!isWorkerEnabled()) return null;
  const url = String(urlInput || '').trim();
  if (!url) return null;
  const { url: baseUrl, timeoutMs } = getWorkerConfig();
  try {
    logBase({ endpoint: '/extract', timeoutMs });
    const res = await axios.post(`${baseUrl}/extract`, { url }, { timeout: timeoutMs });
    logBase({ endpoint: '/extract', status: res.status });
    return res.data || null;
  } catch (error: any) {
    logBase({ endpoint: '/extract', error: error?.message, status: error?.response?.status });
    return null;
  }
};

export const downloadWithWorker = async (urlInput: string): Promise<any | null> => {
  if (!isWorkerEnabled()) return null;
  const url = String(urlInput || '').trim();
  if (!url) return null;
  const { url: baseUrl, timeoutMs } = getWorkerConfig();
  try {
    logBase({ endpoint: '/download', timeoutMs });
    const res = await axios.post(`${baseUrl}/download`, { url }, { timeout: timeoutMs });
    logBase({ endpoint: '/download', status: res.status });
    return res.data || null;
  } catch (error: any) {
    logBase({ endpoint: '/download', error: error?.message, status: error?.response?.status });
    return null;
  }
};
