export { AuthoritativeDomains, assertCacheable, type AuthoritativeDomain } from "./policy.js";

export const CacheKey = {
  product(id: string): string {
    return `catalog:product:${id}`;
  },
  productList(queryHash: string): string {
    return `catalog:list:${queryHash}`;
  },
  productListIndex(): string {
    return "catalog:list:index";
  },
  idempotency(userId: string, key: string): string {
    return `idempotency:${userId}:${key}`;
  },
  rateLimit(subject: string): string {
    return `ratelimit:${subject}`;
  },
};

export { cacheAside, type CacheStore } from "./cache-aside.js";
export { connectRedis, type RedisConnectOptions, type RedisHandle } from "./client.js";
