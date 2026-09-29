import { describe, expect, it } from "vitest";
import {
  createRefreshToken,
  hashRefreshSecret,
  parseRefreshToken,
  refreshSecretsMatch,
} from "./refresh-token.js";

describe("refresh tokens", () => {
  it("stores a hash and can parse the presented value", () => {
    const created = createRefreshToken({
      userId: "user-1",
      familyId: "family-1",
      now: new Date("2026-09-25T08:00:00.000Z"),
    });
    const parsed = parseRefreshToken(created.presented);

    expect(parsed?.tokenId).toBe(created.record.tokenId);
    expect(created.record.secretHash).toBe(hashRefreshSecret(parsed?.secret ?? ""));
    expect(created.presented).not.toContain(created.record.secretHash);
    expect(refreshSecretsMatch(created.record.secretHash, created.record.secretHash)).toBe(true);
    expect(parseRefreshToken("not-a-token")).toBeUndefined();
  });
});
