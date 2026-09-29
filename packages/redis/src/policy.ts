import { AppError, ErrorCode } from "@commerce-flow/errors";

/**
 * Redis is a cache and coordination store.
 * Orders, payments, inventory, and users stay in MongoDB.
 */
export const AuthoritativeDomains = ["orders", "payments", "inventory", "users"] as const;

export type AuthoritativeDomain = (typeof AuthoritativeDomains)[number];

const authoritative = new Set<string>(AuthoritativeDomains);

export function assertCacheable(domain: string): void {
  if (authoritative.has(domain)) {
    throw new AppError(
      ErrorCode.CONFIG_INVALID,
      "Redis is not the source of truth for this domain",
      500,
      { domain },
    );
  }
}
