import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventType } from "@commerce-flow/events";
import { describe, expect, it } from "vitest";

const events = readFileSync(new URL("../docs/events.md", import.meta.url), "utf8");
const openapi = readFileSync(new URL("../docs/openapi.yaml", import.meta.url), "utf8");
const adrDirectory = fileURLToPath(new URL("../docs/adr", import.meta.url));

const publicPaths = [
  "/api/v1/users/register",
  "/api/v1/users/login",
  "/api/v1/users/refresh",
  "/api/v1/users/logout",
  "/api/v1/users/me",
  "/api/v1/products:",
  "/api/v1/categories:",
  "/api/v1/orders:",
  "/api/v1/orders/{id}:",
  "/api/v1/orders/{id}/cancel:",
  "/api/v1/orders/{id}/retries:",
  "/api/v1/inventory:",
  "/api/v1/inventory/{sku}:",
];

describe("documentation contract", () => {
  it("names every event type in the catalog", () => {
    for (const eventType of Object.values(EventType)) {
      expect(events).toContain(`### ${eventType}`);
    }
  });

  it("keeps the ten decision records and the public API paths", () => {
    const files = readdirSync(adrDirectory).filter((file) => /^\d{3}-/.test(file));
    expect(files).toHaveLength(10);
    for (const file of files) {
      const body = readFileSync(path.join(adrDirectory, file), "utf8");
      expect(body).toContain("## Context");
      expect(body).toContain("## Decision");
      expect(body).toContain("## Alternatives");
      expect(body).toContain("## Trade-offs");
      expect(body).toContain("## Consequences");
    }
    for (const path of publicPaths) {
      expect(openapi).toContain(path);
    }
    expect(openapi).not.toContain("/api/v1/payments:");
  });
});
