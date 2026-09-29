import { AppError, ErrorCode } from "@commerce-flow/errors";
import { CacheKey } from "@commerce-flow/redis";

export const loginWindowSeconds = 60;
export const loginAttemptLimit = 10;

export interface RateCounter {
  increment(key: string, ttlSeconds: number): Promise<number>;
}

const limitedPaths = new Set([
  "POST /api/v1/users/login",
  "POST /api/v1/users/register",
  "POST /api/v1/users/refresh",
]);

export async function consumeLoginBudget(
  counter: RateCounter,
  method: string,
  path: string,
  ip: string,
): Promise<void> {
  const normalized = path.split("?")[0] ?? path;
  if (!limitedPaths.has(`${method} ${normalized}`)) {
    return;
  }
  const count = await counter.increment(CacheKey.rateLimit(`login:${ip}`), loginWindowSeconds);
  if (count > loginAttemptLimit) {
    throw new AppError(ErrorCode.RATE_LIMITED, "Too many requests", 429, {});
  }
}
