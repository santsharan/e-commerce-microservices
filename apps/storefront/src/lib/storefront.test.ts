import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";
import { accessExpiresAtMs, accessTokenIsExpired } from "./session";
import { logEvent, redact } from "./logger";
import { orderStatusLabel, readFailure } from "./types";

describe("storefront helpers", () => {
  it("reads the access-token expiry", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_700_000_000 })).toString("base64url");
    expect(accessExpiresAtMs(`header.${payload}.sig`)).toBe(1_700_000_000_000);
    expect(accessTokenIsExpired(`header.${payload}.sig`, 1_700_000_000_000)).toBe(true);
    expect(accessTokenIsExpired(`header.${payload}.sig`, 1_699_999_000_000)).toBe(false);
    expect(accessExpiresAtMs("not-a-token")).toBeUndefined();
  });

  it("formats minor units as dollars", () => {
    expect(formatMoney(2500, "USD")).toBe("$25.00");
  });

  it("reads the public error envelope", () => {
    expect(readFailure(409, { error: { code: "CONFLICT", message: "Different body" } })).toEqual({
      status: 409,
      code: "CONFLICT",
      message: "Different body",
    });
  });

  it("labels an authorized order as paid", () => {
    expect(orderStatusLabel("confirmed", "authorized")).toBe("Paid");
    expect(orderStatusLabel("failed", "failed")).toBe("Payment failed");
  });

  it("redacts tokens before writing a log line", () => {
    let written = "";
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      written += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      expect(redact({ password: "secret-value", email: "ada@example.com" }).password).toBe(
        "[redacted]",
      );
      logEvent("info", "auth.register", { password: "secret-value", email: "ada@example.com" });
    } finally {
      process.stdout.write = original;
    }
    expect(written).toContain("ada@example.com");
    expect(written).not.toContain("secret-value");
  });
});
