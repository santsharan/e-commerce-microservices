import { describe, expect, it } from "vitest";
import { cacheAside, type CacheStore } from "./cache-aside.js";

function memoryStore(): CacheStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async get(key: string): Promise<string | null> {
      return values.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      values.set(key, value);
    },
  };
}

describe("cache aside", () => {
  it("loads once and then serves the cached value", async () => {
    const store = memoryStore();
    let loads = 0;
    const input = {
      store,
      domain: "catalog",
      key: "catalog:product:1",
      ttlSeconds: 30,
      load: async (): Promise<{ id: string }> => {
        loads += 1;
        return { id: "1" };
      },
      serialize: JSON.stringify,
      deserialize: (raw: string): { id: string } => {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) {
          throw new Error("corrupt");
        }
        if (typeof parsed.id !== "string") {
          throw new Error("corrupt");
        }
        return { id: parsed.id };
      },
    };

    expect(await cacheAside(input)).toEqual({ id: "1" });
    expect(await cacheAside(input)).toEqual({ id: "1" });
    expect(loads).toBe(1);
  });

  it("replaces a corrupt cache entry", async () => {
    const store = memoryStore();
    store.values.set("catalog:product:1", "{");
    let loads = 0;
    const value = await cacheAside({
      store,
      domain: "catalog",
      key: "catalog:product:1",
      ttlSeconds: 30,
      load: async () => {
        loads += 1;
        return { id: "1" };
      },
      serialize: JSON.stringify,
      deserialize: () => {
        throw new Error("corrupt");
      },
    });

    expect(value).toEqual({ id: "1" });
    expect(loads).toBe(1);
    expect(store.values.get("catalog:product:1")).toBe(JSON.stringify({ id: "1" }));
  });

  it("rejects an authoritative domain and a non-positive ttl", async () => {
    const store = memoryStore();
    await expect(
      cacheAside({
        store,
        domain: "orders",
        key: "orders:1",
        ttlSeconds: 30,
        load: async () => "nope",
        serialize: (value) => value,
        deserialize: (raw) => raw,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });

    await expect(
      cacheAside({
        store,
        domain: "catalog",
        key: "catalog:product:1",
        ttlSeconds: 0,
        load: async () => "nope",
        serialize: (value) => value,
        deserialize: (raw) => raw,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
