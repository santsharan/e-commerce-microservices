import { describe, expect, it } from "vitest";
import { isInboxDuplicate, outboxRetryDelayMs, payloadHash } from "./index.js";

describe("outbox", () => {
  it("hashes a payload independently of key order", () => {
    expect(payloadHash({ sku: "HAT-1", quantity: 2 })).toBe(
      payloadHash({ quantity: 2, sku: "HAT-1" }),
    );
    expect(payloadHash({ sku: "HAT-1" })).not.toBe(payloadHash({ sku: "HAT-2" }));
  });

  it("backs off and then holds the delay at 30 seconds", () => {
    expect(outboxRetryDelayMs(1)).toBe(1_000);
    expect(outboxRetryDelayMs(2)).toBe(5_000);
    expect(outboxRetryDelayMs(3)).toBe(30_000);
    expect(outboxRetryDelayMs(9)).toBe(30_000);
  });

  it("recognizes a duplicate inbox insert", () => {
    expect(isInboxDuplicate({ code: 11000, keyPattern: { eventId: 1, consumer: 1 } })).toBe(true);
    expect(isInboxDuplicate({ code: 11000, keyPattern: { orderId: 1 } })).toBe(false);
    expect(isInboxDuplicate(new Error("unavailable"))).toBe(false);
  });
});
