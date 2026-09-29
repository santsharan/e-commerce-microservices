import { AppError, ErrorCode } from "@commerce-flow/errors";
import { assertCacheable } from "./policy.js";

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * Cache-aside read. A corrupt cached value is treated as a miss and replaced.
 * The caller owns serialization so this module does not cast JSON to a domain type.
 */
export async function cacheAside<T>(input: {
  store: CacheStore;
  domain: string;
  key: string;
  ttlSeconds: number;
  load: () => Promise<T>;
  serialize: (value: T) => string;
  deserialize: (raw: string) => T;
  onHit?: () => void;
  onMiss?: () => void;
}): Promise<T> {
  assertCacheable(input.domain);
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Cache TTL must be a positive integer", 400, {});
  }

  const cached = await input.store.get(input.key);
  if (cached !== null) {
    try {
      const value = input.deserialize(cached);
      input.onHit?.();
      return value;
    } catch {
      // Replace the entry below.
    }
  }
  input.onMiss?.();

  const value = await input.load();
  await input.store.set(input.key, input.serialize(value), input.ttlSeconds);
  return value;
}
