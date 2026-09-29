import { describe, expect, it } from "vitest";
import { loadIdentityKeys } from "./jwt-keys.js";

describe("jwt key loading", () => {
  it("fails closed when the key paths are missing", async () => {
    const secret = "pem-do-not-leak";
    await expect(loadIdentityKeys({})).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: "JWT signing keys are required",
      details: { fields: ["JWT_PRIVATE_KEY_PATH", "JWT_PUBLIC_KEY_PATH"] },
    });
    await expect(loadIdentityKeys({})).rejects.toThrow(expect.not.stringContaining(secret));
  });
});
