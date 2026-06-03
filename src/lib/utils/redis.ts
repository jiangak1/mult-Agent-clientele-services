import Redis from "ioredis";
import { config } from "./config";

const globalForRedis = globalThis as unknown as { redis: Redis };

export const redis = globalForRedis.redis ?? new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
});

if (config.isDev) globalForRedis.redis = redis;

export async function getRedis(): Promise<Redis> {
  if (!["connect", "ready"].includes(redis.status)) {
    await redis.connect();
  }
  return redis;
}

export function cacheKey(tenantId: string, ...parts: string[]): string {
  return `csp:${tenantId}:${parts.join(":")}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (ttlSeconds) {
    await redis.setex(key, ttlSeconds, serialized);
  } else {
    await redis.set(key, serialized);
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
