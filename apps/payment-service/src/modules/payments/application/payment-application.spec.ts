import { EventType, type DomainEvent } from "@commerce-flow/events";
import type { InboxClaim, InboxStore, OutboxWriter } from "@commerce-flow/outbox";
import { describe, expect, it } from "vitest";
import { PaymentApplication } from "./payment-application.js";
import type { Clock, PaymentRepository, TransactionRunner } from "./ports.js";
import { DuplicatePaymentError, PaymentFailureMode, type Payment } from "../domain/payment.js";

class MemoryPayments implements PaymentRepository {
  private readonly rows = new Map<string, Payment>();

  public async insert(payment: Payment): Promise<void> {
    if (
      [...this.rows.values()].some(
        (row) => row.orderId === payment.orderId || row.id === payment.id,
      )
    ) {
      throw new DuplicatePaymentError();
    }
    this.rows.set(payment.id, structuredClone(payment));
  }

  public async findById(id: string): Promise<Payment | null> {
    const row = this.rows.get(id);
    return row === undefined ? null : structuredClone(row);
  }

  public async findByOrderId(orderId: string): Promise<Payment | null> {
    const row = [...this.rows.values()].find((item) => item.orderId === orderId);
    return row === undefined ? null : structuredClone(row);
  }

  public async update(
    payment: Payment,
    expectedVersion: number,
  ): Promise<Payment | "missing" | "conflict"> {
    const current = this.rows.get(payment.id);
    if (current === undefined) {
      return "missing";
    }
    if (current.version !== expectedVersion) {
      return "conflict";
    }
    const next = structuredClone({ ...payment, version: expectedVersion + 1 });
    this.rows.set(payment.id, next);
    return structuredClone(next);
  }
}

class MemoryEvents implements OutboxWriter {
  public readonly events: DomainEvent<unknown>[] = [];

  public async append(event: DomainEvent<unknown>): Promise<void> {
    this.events.push(event);
  }
}

class MemoryInbox implements InboxStore {
  private readonly keys = new Set<string>();

  public async claim(claim: InboxClaim): Promise<"claimed" | "duplicate"> {
    const id = `${claim.consumer}:${claim.eventId}`;
    if (this.keys.has(id)) {
      return "duplicate";
    }
    this.keys.add(id);
    return "claimed";
  }
}

function app(mode: "authorize" | "decline" = "authorize"): {
  payments: PaymentApplication;
  events: MemoryEvents;
} {
  const events = new MemoryEvents();
  const clock: Clock = { now: () => new Date("2026-09-25T10:00:00.000Z") };
  const transactions: TransactionRunner = {
    async run(work) {
      return work({});
    },
  };
  return {
    events,
    payments: new PaymentApplication({
      payments: new MemoryPayments(),
      outbox: events,
      inbox: new MemoryInbox(),
      transactions,
      clock,
      failureMode: mode === "decline" ? PaymentFailureMode.decline : PaymentFailureMode.authorize,
    }),
  };
}

describe("payment application", () => {
  it("authorizes an order once and replays the same amount", async () => {
    const { payments, events } = app();
    const created = await payments.authorize({
      orderId: "order-1",
      amount: 5000,
      currency: "usd",
      correlationId: "corr-1",
    });
    expect(created.replayed).toBe(false);
    expect(created.payment.status).toBe("authorized");
    expect(created.payment.currency).toBe("USD");
    const replay = await payments.authorize({
      orderId: "order-1",
      amount: 5000,
      currency: "USD",
      correlationId: "corr-1",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.payment.id).toBe(created.payment.id);
    expect(events.events.map((event) => event.eventType)).toEqual([
      EventType.paymentAuthorized,
      EventType.paymentAuthorized,
    ]);
    expect(events.events[0]?.aggregateId).toBe("order-1");
    await expect(
      payments.authorize({
        orderId: "order-1",
        amount: 1,
        currency: "USD",
        correlationId: "corr-1",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("declines when the request asks for a failure and then refuses a refund", async () => {
    const { payments } = app("decline");
    const declined = await payments.authorize({
      orderId: "order-1",
      amount: 5000,
      currency: "USD",
      simulate: "authorize",
      correlationId: "corr-1",
    });
    expect(declined.payment.status).toBe("authorized");
    const { payments: forced, events: forcedEvents } = app();
    const failed = await forced.authorize({
      orderId: "order-2",
      amount: 5000,
      currency: "USD",
      simulate: "decline",
      correlationId: "corr-1",
    });
    expect(failed.payment.status).toBe("failed");
    expect(failed.payment.failureReason).toBe("declined");
    expect(forcedEvents.events[0]?.eventType).toBe(EventType.paymentAuthorizationFailed);
    await expect(payments.refund({ paymentId: failed.payment.id })).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(forced.refund({ paymentId: failed.payment.id })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("refunds an authorization once", async () => {
    const { payments, events } = app();
    const created = await payments.authorize({
      orderId: "order-1",
      amount: 5000,
      currency: "USD",
      correlationId: "corr-1",
    });
    const refunded = await payments.refund({ paymentId: created.payment.id });
    expect(refunded.status).toBe("refunded");
    expect(refunded.version).toBe(2);
    const again = await payments.refund({ paymentId: created.payment.id });
    expect(again.version).toBe(2);
    expect(events.events.map((event) => event.eventType)).toEqual([
      EventType.paymentAuthorized,
      EventType.paymentRefunded,
      EventType.paymentRefunded,
    ]);
  });
});
