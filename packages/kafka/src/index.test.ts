import { Topics } from "@commerce-flow/events";
import { describe, expect, it } from "vitest";
import { decideOrderRetry, partitionKey } from "./index.js";

describe("kafka policy", () => {
  it("partitions by aggregate id", () => {
    expect(partitionKey(" ord-1 ")).toBe("ord-1");
    expect(() => partitionKey("  ")).toThrow(/aggregate id/);
  });

  it("backs off locally, then uses delayed topics, then the DLQ", () => {
    expect(
      decideOrderRetry({ errorClass: "transient", localAttempts: 0, topicAttempts: 0 }),
    ).toEqual({
      action: "retry-local",
      delayMs: 100,
    });
    expect(
      decideOrderRetry({ errorClass: "transient", localAttempts: 2, topicAttempts: 0 }),
    ).toEqual({
      action: "retry-local",
      delayMs: 2_000,
    });
    expect(
      decideOrderRetry({ errorClass: "transient", localAttempts: 3, topicAttempts: 0 }),
    ).toEqual({
      action: "retry-topic",
      topic: Topics.ordersRetry1m,
    });
    expect(
      decideOrderRetry({ errorClass: "transient", localAttempts: 3, topicAttempts: 2 }),
    ).toEqual({
      action: "retry-topic",
      topic: Topics.ordersRetry30m,
    });
    expect(
      decideOrderRetry({ errorClass: "transient", localAttempts: 3, topicAttempts: 3 }),
    ).toEqual({
      action: "dlq",
      topic: Topics.ordersDlq,
    });
  });

  it("does not retry validation, authentication, or permanent errors through the delay ladder", () => {
    expect(
      decideOrderRetry({ errorClass: "validation", localAttempts: 0, topicAttempts: 0 }),
    ).toEqual({
      action: "drop",
    });
    expect(
      decideOrderRetry({ errorClass: "authentication", localAttempts: 0, topicAttempts: 0 }),
    ).toEqual({ action: "drop" });
    expect(
      decideOrderRetry({ errorClass: "permanent", localAttempts: 0, topicAttempts: 0 }),
    ).toEqual({
      action: "dlq",
      topic: Topics.ordersDlq,
    });
    expect(
      decideOrderRetry({ errorClass: "conflict", localAttempts: 0, topicAttempts: 0 }),
    ).toEqual({
      action: "conflict",
    });
  });
});
