import { EventType, type DomainEvent } from "@commerce-flow/events";
import { describe, expect, it } from "vitest";
import { decodeMessage, producerRecord } from "./records.js";

const event: DomainEvent<{ orderId: string }> = {
  eventId: "evt-1",
  eventType: EventType.orderCreated,
  eventVersion: 1,
  occurredAt: "2026-09-25T08:00:00.000Z",
  producer: "order-service",
  aggregateType: "order",
  aggregateId: "ord-1",
  correlationId: "corr-1",
  payload: { orderId: "ord-1" },
};

describe("kafka records", () => {
  it("routes a known event by aggregate id", () => {
    expect(producerRecord(event)).toEqual({
      topic: "commerce.orders.v1",
      key: "ord-1",
      value: JSON.stringify(event),
    });
  });

  it("rejects an unknown event type without echoing the payload", () => {
    const secret = "card-number-do-not-leak";
    try {
      producerRecord({ ...event, eventType: "order.exploded", payload: { secret } });
      expect.fail("expected the event type to be rejected");
    } catch (error) {
      expect(error).toMatchObject({
        code: "VALIDATION_ERROR",
        details: { eventType: "order.exploded" },
      });
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it("decodes a record value and rejects a body that is not an envelope", () => {
    expect(decodeMessage(Buffer.from(JSON.stringify(event)))).toMatchObject({
      eventId: "evt-1",
      aggregateId: "ord-1",
    });
    expect(() => decodeMessage("{")).toThrow(/not valid JSON/);
    expect(() => decodeMessage("{}")).toThrow(/not a domain event/);
    expect(() => decodeMessage(null)).toThrow(/no value/);
  });
});
