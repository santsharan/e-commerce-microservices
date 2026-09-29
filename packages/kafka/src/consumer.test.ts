import { AppError, ErrorCode } from "@commerce-flow/errors";
import { EventType, type DomainEvent } from "@commerce-flow/events";
import { describe, expect, it } from "vitest";
import { handleConsumerMessage } from "./consumer.js";

const event: DomainEvent<{ sku: string }> = {
  eventId: "event-1",
  eventType: EventType.inventoryReserveRequested,
  eventVersion: 1,
  occurredAt: "2026-09-25T09:00:00.000Z",
  producer: "order-service",
  aggregateType: "order",
  aggregateId: "order-1",
  correlationId: "corr-1",
  payload: { sku: "HAT-1" },
};

describe("kafka consumer dispatch", () => {
  it("commits a handled message and a message that is not an event", async () => {
    const seen: string[] = [];
    await expect(
      handleConsumerMessage({
        value: JSON.stringify(event),
        handle: (message) => {
          seen.push(message.eventId);
          return Promise.resolve();
        },
      }),
    ).resolves.toBe("commit");
    expect(seen).toEqual(["event-1"]);

    await expect(
      handleConsumerMessage({
        value: "{",
        handle: () => Promise.resolve(),
      }),
    ).resolves.toBe("commit");
  });

  it("commits validation failures and retries dependency failures", async () => {
    await expect(
      handleConsumerMessage({
        value: JSON.stringify(event),
        handle: () => {
          throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid inventory command", 400, {});
        },
      }),
    ).resolves.toBe("commit");

    await expect(
      handleConsumerMessage({
        value: JSON.stringify(event),
        handle: () => {
          throw new AppError(
            ErrorCode.DEPENDENCY_UNAVAILABLE,
            "A required dependency is unavailable",
            503,
            { dependency: "mongodb" },
          );
        },
      }),
    ).resolves.toBe("retry");
  });
});
