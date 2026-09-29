import { AppError, ErrorCode } from "@commerce-flow/errors";
import { EventType, Topics } from "@commerce-flow/events";
import { describe, expect, it } from "vitest";
import type { SagaRecord } from "./order.js";
import { SagaState } from "./saga.js";
import { classifySagaError, isRetryDue, scheduleSagaRetry } from "./saga-retry.js";

const now = new Date("2026-09-25T10:00:00.000Z");

function saga(over: Partial<SagaRecord> = {}): SagaRecord {
  return {
    sagaId: "saga-1",
    state: SagaState.inventoryReservationPending,
    currentStep: "inventory.reserve",
    retryCount: 0,
    localAttempts: 0,
    topicAttempts: 0,
    dlqPublished: false,
    retryHalted: false,
    createdPublished: false,
    cancelledPublished: false,
    paymentRequested: false,
    confirmedPublished: false,
    refundRequested: false,
    inventoryCommitted: false,
    ...over,
  };
}

describe("saga retry schedule", () => {
  it("waits 100ms on the first transient failure when jitter is zero", () => {
    const plan = scheduleSagaRetry({
      saga: saga(),
      error: new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, "Kafka is unavailable", 503, {
        dependency: "kafka",
      }),
      now,
      random: () => 0,
    });
    expect(plan.decision).toEqual({ action: "retry-local", delayMs: 100 });
    expect(plan.localAttempts).toBe(1);
    expect(plan.nextAttemptAt?.toISOString()).toBe("2026-09-25T10:00:00.100Z");
    expect(plan.retryCount).toBe(1);
  });

  it("moves to the one minute topic after the local delays are used", () => {
    const plan = scheduleSagaRetry({
      saga: saga({ localAttempts: 3, retryCount: 3 }),
      error: new Error("broker down"),
      now,
      random: () => 0,
    });
    expect(plan.decision).toEqual({ action: "retry-topic", topic: Topics.ordersRetry1m });
    expect(plan.topicAttempts).toBe(1);
    expect(plan.nextAttemptAt?.toISOString()).toBe("2026-09-25T10:01:00.000Z");
  });

  it("dead-letters after the delayed topics are used", () => {
    const plan = scheduleSagaRetry({
      saga: saga({ localAttempts: 3, topicAttempts: 3, retryCount: 6 }),
      error: new Error("broker down"),
      now,
      random: () => 0,
    });
    expect(plan.decision).toEqual({ action: "dlq", topic: Topics.ordersDlq });
    expect(plan.dlqPublished).toBe(true);
    expect(plan.nextAttemptAt).toBeUndefined();
    expect(plan.retryCount).toBe(7);
  });

  it("halts validation without scheduling another attempt", () => {
    const plan = scheduleSagaRetry({
      saga: saga(),
      error: new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {}),
      now,
      random: () => 0,
    });
    expect(plan.decision).toEqual({ action: "drop" });
    expect(plan.retryHalted).toBe(true);
    expect(plan.nextAttemptAt).toBeUndefined();
    expect(isRetryDue({ ...saga(), ...plan }, now)).toBe(false);
  });

  it("does not count an optimistic concurrency conflict", () => {
    const error = new AppError(
      ErrorCode.CONFLICT,
      "The order was updated by someone else",
      409,
      {},
    );
    const plan = scheduleSagaRetry({
      saga: saga({ retryCount: 2 }),
      error,
      now,
      random: () => 0,
    });
    expect(classifySagaError(error)).toBe("conflict");
    expect(plan.decision).toEqual({ action: "conflict" });
    expect(plan.retryCount).toBe(2);
    expect(plan.localAttempts).toBe(0);
  });

  it("redacts credentials from the stored error", () => {
    const error = new Error("failed mongodb://admin:s3cret@127.0.0.1:27017/order-db");
    error.stack = "Error: mongodb://admin:s3cret@127.0.0.1:27017/order-db\n    at test";
    const plan = scheduleSagaRetry({ saga: saga(), error, now, random: () => 0 });
    expect(plan.lastError).not.toContain("s3cret");
    expect(plan.stack).not.toContain("s3cret");
    expect(plan.lastError).toContain("mongodb://127.0.0.1:27017/order-db");
  });

  it("adds up to twenty percent jitter", () => {
    const plan = scheduleSagaRetry({
      saga: saga(),
      error: new Error("broker down"),
      now,
      random: () => 0.999,
    });
    expect(plan.nextAttemptAt?.getTime()).toBe(now.getTime() + 100 + 19);
  });

  it("names the delayed topic event", () => {
    const plan = scheduleSagaRetry({
      saga: saga({ localAttempts: 3 }),
      error: new Error("broker down"),
      now,
      random: () => 0,
    });
    expect(plan.decision.action).toBe("retry-topic");
    if (plan.decision.action === "retry-topic") {
      expect(EventType.sagaRetry1m).toBe("saga.retry.1m");
      expect(plan.decision.topic).toBe(Topics.ordersRetry1m);
    }
  });
});
