import { AppError } from "@commerce-flow/errors";
import { describe, expect, it } from "vitest";
import { authorizationDecision, readFailureMode } from "./payment.js";

describe("payment decision", () => {
  it("authorizes unless the process or the request asks to decline", () => {
    expect(readFailureMode({})).toBe("authorize");
    expect(authorizationDecision("authorize", undefined)).toBe("authorized");
    expect(authorizationDecision("decline", undefined)).toBe("declined");
    expect(authorizationDecision("decline", "authorize")).toBe("authorized");
  });

  it("rejects an unknown failure mode without echoing the value", () => {
    const secret = "decline-card-4242";
    expect(() => readFailureMode({ PAYMENT_FAILURE_MODE: secret })).toThrow(AppError);
    try {
      readFailureMode({ PAYMENT_FAILURE_MODE: secret });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});
