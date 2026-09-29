import { describe, expect, it } from "vitest";
import { EventType, Topics, parseDomainEvent, topicForEvent } from "./index.js";

const envelope = {
  eventId: "evt_01J",
  eventType: EventType.inventoryReserved,
  eventVersion: 1,
  occurredAt: "2026-09-25T06:20:00.000Z",
  producer: "inventory-service",
  aggregateType: "inventory",
  aggregateId: "sku-123",
  correlationId: "ord-456",
  causationId: "evt_previous",
  payload: {
    sku: "sku-123",
    quantity: 2,
    reservationId: "res-789",
  },
};

describe("domain events", () => {
  it("accepts a versioned envelope", () => {
    const event = parseDomainEvent(envelope);
    expect(event.eventVersion).toBe(1);
    expect(event.aggregateId).toBe("sku-123");
    expect(event.causationId).toBe("evt_previous");
  });

  it("rejects an envelope that omits the event id", () => {
    const { eventId: _eventId, ...rest } = envelope;
    expect(() => parseDomainEvent(rest)).toThrow();
  });

  it("routes commands and facts onto different topics", () => {
    expect(topicForEvent(EventType.inventoryReserveRequested)).toBe(Topics.inventoryCommands);
    expect(topicForEvent(EventType.inventoryReserved)).toBe(Topics.inventory);
    expect(topicForEvent(EventType.paymentAuthorizationRequested)).toBe(Topics.paymentCommands);
    expect(topicForEvent(EventType.paymentAuthorized)).toBe(Topics.payments);
    expect(topicForEvent(EventType.orderCreated)).toBe(Topics.orders);
  });
});
