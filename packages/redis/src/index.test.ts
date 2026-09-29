import { AppError } from "@commerce-flow/errors";
import { describe, expect, it } from "vitest";
import { CacheKey, assertCacheable } from "./index.js";

describe("redis boundaries", () => {
  it("builds cache, idempotency, and rate-limit keys", () => {
    expect(CacheKey.product("sku-1")).toBe("catalog:product:sku-1");
    expect(CacheKey.productList("abc")).toBe("catalog:list:abc");
    expect(CacheKey.productListIndex()).toBe("catalog:list:index");
    expect(CacheKey.idempotency("user-1", "key-1")).toBe("idempotency:user-1:key-1");
    expect(CacheKey.rateLimit("user-1")).toBe("ratelimit:user-1");
  });

  it("refuses to treat orders, payments, inventory, or users as cached truth", () => {
    expect(() => assertCacheable("orders")).toThrow(AppError);
    expect(() => assertCacheable("payments")).toThrow(AppError);
    expect(() => assertCacheable("inventory")).toThrow(AppError);
    expect(() => assertCacheable("users")).toThrow(AppError);
    expect(() => assertCacheable("catalog")).not.toThrow();
  });
});
