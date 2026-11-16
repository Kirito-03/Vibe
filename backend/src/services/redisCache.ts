import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const memoryFallback = new Map<string, { value: string; expiresAt: number }>();

let redisClient: Redis | null = null;
let redisReady = false;
let redisErrorLogged = false;

const getClient = (): Redis | null => {
  if (redisClient) return redisClient;
  try {
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 2000, 30000),
    });

    redisClient.on('ready', () => {
      redisReady = true;
      redisErrorLogged = false;
      console.log('[redis] connected');
    });

    redisClient.on('close', () => {
      redisReady = false;
    });

    redisClient.on('error', (err) => {
      redisReady = false;
      if (!redisErrorLogged) {
        redisErrorLogged = true;
        console.warn('[redis] unavailable, using memory fallback:', err?.message || err);
      }
    });

    void redisClient.connect().catch(() => {});
  } catch {
    redisClient = null;
  }
  return redisClient;
};

// Initialize connection eagerly in background
getClient();

export const cacheGetJson = async <T>(key: string): Promise<T | null> => {
  const client = getClient();
  if (client && redisReady) {
    try {
      const raw = await client.get(key);
      if (raw) return JSON.parse(raw) as T;
      return null;
    } catch {
      // fall through to memory fallback
    }
  }

  const mem = memoryFallback.get(key);
  if (mem) {
    if (mem.expiresAt > Date.now()) {
      try {
        return JSON.parse(mem.value) as T;
      } catch {
        memoryFallback.delete(key);
      }
    } else {
      memoryFallback.delete(key);
    }
  }
  return null;
};

export const cacheSetJson = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return;
  }

  const client = getClient();
  if (client && redisReady) {
    try {
      await client.set(key, serialized, 'EX', Math.max(1, Math.floor(ttlSeconds)));
      return;
    } catch {
      // fall through to memory fallback
    }
  }

  if (memoryFallback.size > 500) {
    const firstKey = memoryFallback.keys().next().value;
    if (firstKey) memoryFallback.delete(firstKey);
  }
  memoryFallback.set(key, {
    value: serialized,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
};
