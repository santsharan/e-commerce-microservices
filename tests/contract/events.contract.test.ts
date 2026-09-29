import { EventType, Topics, parseDomainEvent, topicForEvent } from "@commerce-flow/events";
import { producerRecord } from "@commerce-flow/kafka";
import { describe, expect, it } from "vitest";
import {
  readReleaseCommand,
  readReserveCommand,
} from "../../apps/inventory-service/src/modules/inventory/domain/commands.js";
import {
  readFailedFact,
  readReleasedFact,
  readReservedFact,
} from "../../apps/order-service/src/modules/orders/domain/facts.js";
import {
  readPaymentAuthorized,
  readPaymentFailed,
  readPaymentRefunded,
} from "../../apps/order-service/src/modules/orders/domain/payment-facts.js";
import {
  readAuthorizationCommand,
  readRefundCommand,
} from "../../apps/payment-service/src/modules/payments/domain/commands.js";

const orderId = "order-1";

function envelope(eventType: string, payload: unknown, aggregateId = orderId) {
  return {
    eventId: "event-1",
    eventType,
    eventVersion: 1,
    occurredAt: "2026-09-25T10:00:00.000Z",
    producer: "contract-test",
    aggregateType: "order",
    aggregateId,
    correlationId: "corr-1",
    payload,
  };
}

describe("event contracts", () => {
  it("routes every event type onto its topic and keeps the envelope", () => {
    const samples: Record<string, unknown> = {
      [EventType.orderCreated]: {
        orderId,
        orderNumber: "CF1",
        customerId: "customer-1",
        currency: "USD",
        grandTotal: 2500,
        items: [],
      },
      [EventType.orderConfirmed]: {
        orderId,
        orderNumber: "CF1",
        customerId: "customer-1",
        currency: "USD",
        grandTotal: 2500,
        paymentId: "pay-1",
      },
      [EventType.orderCancelled]: {
        orderId,
        orderNumber: "CF1",
        customerId: "customer-1",
        reason: "cancelled",
      },
      [EventType.inventoryReserveRequested]: { orderId, sku: "HAT-1", quantity: 2 },
      [EventType.inventoryReserved]: {
        reservationId: "res-1",
        orderId,
        sku: "HAT-1",
        quantity: 2,
        expiresAt: "2026-09-25T10:15:00.000Z",
      },
      [EventType.inventoryReservationFailed]: {
        orderId,
        sku: "HAT-1",
        quantity: 2,
        reason: "insufficient_stock",
      },
      [EventType.inventoryReleaseRequested]: { reservationId: "res-1", orderId, sku: "HAT-1" },
      [EventType.inventoryCommitRequested]: { reservationId: "res-1", orderId, sku: "HAT-1" },
      [EventType.inventoryReleased]: {
        reservationId: "res-1",
        orderId,
        sku: "HAT-1",
        quantity: 2,
        reason: "released",
      },
      [EventType.paymentAuthorizationRequested]: { orderId, amount: 2500, currency: "USD" },
      [EventType.paymentAuthorized]: { paymentId: "pay-1", orderId, amount: 2500, currency: "USD" },
      [EventType.paymentAuthorizationFailed]: {
        paymentId: "pay-1",
        orderId,
        amount: 2500,
        currency: "USD",
        reason: "declined",
      },
      [EventType.paymentRefundRequested]: {
        paymentId: "pay-1",
        orderId,
        amount: 2500,
        currency: "USD",
      },
      [EventType.paymentRefunded]: { paymentId: "pay-1", orderId, amount: 2500, currency: "USD" },
      [EventType.sagaRetry1m]: { orderId, sagaId: "saga-1", localAttempts: 3, topicAttempts: 1 },
      [EventType.sagaRetry5m]: { orderId, sagaId: "saga-1", localAttempts: 3, topicAttempts: 2 },
      [EventType.sagaRetry30m]: { orderId, sagaId: "saga-1", localAttempts: 3, topicAttempts: 3 },
      [EventType.sagaDeadLettered]: {
        originalEvent: { aggregateId: orderId, state: "PAYMENT_PENDING", currentStep: "payment" },
        errorCode: "DEPENDENCY_UNAVAILABLE",
        errorMessage: "Kafka is unavailable",
        stack: "",
        consumer: "order-service",
        attempts: 7,
        failedAt: "2026-09-25T10:00:00.000Z",
        correlationId: "corr-1",
        orderId,
        sagaId: "saga-1",
      },
    };

    expect(Object.keys(samples).sort()).toEqual(Object.values(EventType).sort());
    for (const [eventType, payload] of Object.entries(samples)) {
      const event = parseDomainEvent(envelope(eventType, payload));
      expect(producerRecord(event).topic).toBe(topicForEvent(eventType as EventType));
    }
  });

  it("lets each consumer read the payload its producer sends", () => {
    const reserved = parseDomainEvent(
      envelope(EventType.inventoryReserved, {
        reservationId: "res-1",
        orderId,
        sku: "HAT-1",
        quantity: 2,
        expiresAt: "2026-09-25T10:15:00.000Z",
      }),
    );
    expect(readReservedFact(reserved).sku).toBe("HAT-1");
    expect(
      readFailedFact(
        parseDomainEvent(
          envelope(EventType.inventoryReservationFailed, {
            orderId,
            sku: "HAT-1",
            quantity: 2,
            reason: "insufficient_stock",
          }),
        ),
      ).reason,
    ).toBe("insufficient_stock");
    expect(
      readReleasedFact(
        parseDomainEvent(
          envelope(EventType.inventoryReleased, {
            reservationId: "res-1",
            orderId,
            sku: "HAT-1",
            quantity: 2,
            reason: "released",
          }),
        ),
      ).reason,
    ).toBe("released");
    expect(
      readReserveCommand(
        parseDomainEvent(
          envelope(EventType.inventoryReserveRequested, {
            orderId,
            sku: "HAT-1",
            quantity: 2,
          }),
        ),
      ).quantity,
    ).toBe(2);
    expect(
      readReleaseCommand(
        parseDomainEvent(
          envelope(EventType.inventoryReleaseRequested, {
            reservationId: "res-1",
            orderId,
            sku: "HAT-1",
          }),
        ),
      ).reservationId,
    ).toBe("res-1");
    expect(
      readReleaseCommand(
        parseDomainEvent(
          envelope(EventType.inventoryCommitRequested, {
            reservationId: "res-1",
            orderId,
            sku: "HAT-1",
          }),
        ),
      ).sku,
    ).toBe("HAT-1");

    const authorized = parseDomainEvent(
      envelope(EventType.paymentAuthorized, {
        paymentId: "pay-1",
        orderId,
        amount: 2500,
        currency: "USD",
      }),
    );
    expect(readPaymentAuthorized(authorized).amount).toBe(2500);
    expect(
      readPaymentFailed(
        parseDomainEvent(
          envelope(EventType.paymentAuthorizationFailed, {
            paymentId: "pay-1",
            orderId,
            amount: 2500,
            currency: "USD",
            reason: "declined",
          }),
        ),
      ).reason,
    ).toBe("declined");
    expect(
      readPaymentRefunded(
        parseDomainEvent(
          envelope(EventType.paymentRefunded, {
            paymentId: "pay-1",
            orderId,
            amount: 2500,
            currency: "USD",
          }),
        ),
      ).paymentId,
    ).toBe("pay-1");
    expect(
      readAuthorizationCommand(
        parseDomainEvent(
          envelope(EventType.paymentAuthorizationRequested, {
            orderId,
            amount: 2500,
            currency: "USD",
          }),
        ),
      ).currency,
    ).toBe("USD");
    expect(
      readRefundCommand(
        parseDomainEvent(
          envelope(EventType.paymentRefundRequested, {
            paymentId: "pay-1",
            orderId,
            amount: 2500,
            currency: "USD",
          }),
        ),
      ).paymentId,
    ).toBe("pay-1");
  });

  it("rejects a payment command that carries a card number", () => {
    expect(() =>
      readAuthorizationCommand(
        parseDomainEvent(
          envelope(EventType.paymentAuthorizationRequested, {
            orderId,
            amount: 2500,
            currency: "USD",
            pan: "4242424242424242",
          }),
        ),
      ),
    ).toThrow();
  });

  it("rejects an unknown event type before it can create a topic", () => {
    expect(() =>
      producerRecord(parseDomainEvent(envelope("order.exploded", { orderId }))),
    ).toThrow();
    expect(Topics.orders).toBe("commerce.orders.v1");
  });
});
