import { describe, expect, it } from "vitest";
import { identityIndexSpecs } from "./indexes.js";

describe("identity indexes", () => {
  it("keeps email and refresh token ids unique", () => {
    expect(identityIndexSpecs).toEqual([
      { collection: "users", name: "users_id_unique", keys: { id: 1 }, unique: true },
      { collection: "users", name: "users_email_unique", keys: { email: 1 }, unique: true },
      {
        collection: "refresh_tokens",
        name: "refresh_tokens_token_id_unique",
        keys: { tokenId: 1 },
        unique: true,
      },
      {
        collection: "refresh_tokens",
        name: "refresh_tokens_family",
        keys: { familyId: 1 },
        unique: false,
      },
      {
        collection: "refresh_tokens",
        name: "refresh_tokens_user",
        keys: { userId: 1 },
        unique: false,
      },
      {
        collection: "audit_logs",
        name: "audit_logs_created_at",
        keys: { createdAt: 1 },
        unique: false,
      },
    ]);
  });
});
