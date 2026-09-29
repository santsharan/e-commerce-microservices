import { EventType, type DomainEvent } from "@commerce-flow/events";
import { describe, expect, it } from "vitest";
import { readReleaseCommand, readReserveCommand } from "./commands.js";

function event(eventType: string, payload: unknown, aggregateId = "order-1"): DomainEvent<unknown> {
  return {
    eventId: "event-1",
    eventType,
    eventVersion: 1,
    occurredAt: "2026-09-25T09:00:00.000Z",
    producer: "order-service",
    aggregateType: "order",
    aggregateId,
    correlationId: "corr-1",
    payload,
  };
}

describe("inventory commands", () => {
  it("reads a reserve command and rejects an aggregate mismatch", () => {
    expect(
      readReserveCommand(
        event(EventType.inventoryReserveRequested, {
          orderId: "order-1",
          sku: "HAT-1",
          quantity: 2,
          note: "do-not-keep",
        }),
      ),
    ).toEqual({
      orderId: "order-1",
      sku: "HAT-1",
      quantity: 2,
      correlationId: "corr-1",
      causationId: "event-1",
    });

    expect(() =>
      readReserveCommand(
        event(
          EventType.inventoryReserveRequested,
          {
            orderId: "order-1",
            sku: "HAT-1",
            quantity: 2,
          },
          "other-order",
        ),
      ),
    ).toThrow(/Invalid inventory command/);
  });

  it("rejects a release command that names a different order", () => {
    expect(() =>
      readReleaseCommand(
        event(EventType.inventoryReleaseRequested, {
          reservationId: "res-1",
          orderId: "order-2",
          sku: "HAT-1",
        }),
      ),
    ).toThrow(/Invalid inventory command/);
  });
});
