import { AppError, ErrorCode, redactCredentials } from "@commerce-flow/errors";
import type { Logger } from "@commerce-flow/logger";
import { CacheKey } from "@commerce-flow/redis";
import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { CatalogCache } from "../application/ports.js";

export class RedisCatalogCache implements CatalogCache {
  public constructor(
    private readonly registry: ResourceRegistry,
    private readonly logger: Logger,
  ) {}

  public async get(key: string): Promise<string | null> {
    const redis = this.registry.opened()?.redis;
    if (redis === undefined) {
      return null;
    }
    try {
      return await redis.get(key);
    } catch (error) {
      this.logFailure(error);
      return null;
    }
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const redis = this.registry.opened()?.redis;
    if (redis === undefined) {
      return;
    }
    try {
      await redis.set(key, value, ttlSeconds);
      if (key.startsWith("catalog:list:")) {
        await redis.addMember(CacheKey.productListIndex(), key);
      }
    } catch (error) {
      this.logFailure(error);
    }
  }

  public async invalidateProduct(id: string): Promise<void> {
    const redis = this.registry.opened()?.redis;
    if (redis === undefined) {
      return;
    }
    try {
      const listKeys = await redis.members(CacheKey.productListIndex());
      await redis.del([CacheKey.product(id), CacheKey.productListIndex(), ...listKeys]);
    } catch (error) {
      this.logFailure(error);
    }
  }

  private logFailure(error: unknown): void {
    const message = error instanceof Error ? redactCredentials(error.message) : "cache error";
    this.logger.error({
      event: "catalog.cache.failed",
      dependency: "redis",
      message,
    });
  }
}

export function duplicateProduct(): AppError {
  return new AppError(
    ErrorCode.CONFLICT,
    "The product conflicts with an existing slug or SKU",
    409,
    {},
  );
}

export function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
