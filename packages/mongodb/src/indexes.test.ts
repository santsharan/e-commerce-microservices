import { describe, expect, it } from "vitest";
import { indexPlan, indexRequests } from "./index.js";

describe("index requests", () => {
  it("marks unique indexes and expires reservation documents at the stored date", () => {
    const requests = indexRequests(indexPlan);
    const slug = requests.find((request) => request.name === "products_slug_unique");
    const ttl = requests.find((request) => request.name === "reservations_expires_at_ttl");

    expect(slug).toMatchObject({ unique: true, keys: { slug: 1 } });
    expect(slug?.expireAfterSeconds).toBeUndefined();
    expect(ttl).toMatchObject({
      unique: false,
      keys: { expiresAt: 1 },
      expireAfterSeconds: 0,
    });
  });
});
