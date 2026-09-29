import { AppError, ErrorCode } from "@commerce-flow/errors";
import { EventType, type DomainEvent } from "@commerce-flow/events";
import { handleConsumerMessage } from "@commerce-flow/kafka";
import type { InboxClaim, InboxStore, OutboxWriter } from "@commerce-flow/outbox";
import { describe, expect, it } from "vitest";
import {
  DuplicateIdempotencyError,
  DuplicateOrderNumberError,
  type Order,
} from "../domain/order.js";
import { OrderFacts } from "../infrastructure/kafka-orders.js";
import { OrderApplication, type CreateOrderInput } from "./order-application.js";
import type {
  Clock,
  IdempotencyRecord,
  IdempotencyRepository,
  OrderPage,
  OrderRepository,
  RetryScheduler,
  TransactionRunner,
} from "./ports.js";
import { isRetryDue, isRetryWaiting } from "../domain/saga-retry.js";

class MemoryOrders implements OrderRepository {
  private readonly rows = new Map<string, Order>();

  public snapshot(): Order[] {
    return [...this.rows.values()].map((order) => structuredClone(order));
  }

  public restoreSnapshot(orders: readonly Order[]): void {
    this.rows.clear();
    for (const order of orders) {
      this.rows.set(order.id, structuredClone(order));
    }
  }

  public async insert(order: Order): Promise<void> {
    const taken = [...this.rows.values()].some(
      (row) => row.orderNumber === order.orderNumber || row.id === order.id,
    );
    if (taken) {
      throw new DuplicateOrderNumberError();
    }
    this.rows.set(order.id, structuredClone(order));
  }

  public async findById(id: string): Promise<Order | null> {
    const order = this.rows.get(id);
    return order === undefined ? null : structuredClone(order);
  }

  public async listByCustomer(customerId: string, page: number, limit: number): Promise<OrderPage> {
    const items = [...this.rows.values()]
      .filter((order) => order.customerId === customerId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const start = (page - 1) * limit;
    return {
      items: items.slice(start, start + limit).map((order) => structuredClone(order)),
      page,
      limit,
      total: items.length,
    };
  }

  public async listRecoverable(limit: number, now: Date): Promise<Order[]> {
    return this.select(limit, (order) => this.recoverable(order) && isRetryDue(order.saga, now));
  }

  public async listWaiting(limit: number, now: Date): Promise<Order[]> {
    return this.select(
      limit,
      (order) => this.recoverable(order) && isRetryWaiting(order.saga, now),
    );
  }

  private recoverable(order: Order): boolean {
    return (
      order.saga.state === "INVENTORY_RESERVATION_PENDING" ||
      order.saga.state === "COMPENSATING_INVENTORY" ||
      order.saga.state === "INVENTORY_RESERVED" ||
      order.saga.state === "PAYMENT_PENDING" ||
      order.saga.state === "PAYMENT_AUTHORIZED" ||
      (order.status === "cancelled" && !order.saga.cancelledPublished) ||
      (order.status === "confirmed" && !order.saga.confirmedPublished) ||
      (order.status === "confirmed" && !order.saga.inventoryCommitted)
    );
  }

  private select(limit: number, include: (order: Order) => boolean): Order[] {
    return [...this.rows.values()]
      .filter(include)
      .slice(0, limit)
      .map((order) => structuredClone(order));
  }

  public async update(
    order: Order,
    expectedVersion: number,
  ): Promise<Order | "missing" | "conflict"> {
    const current = this.rows.get(order.id);
    if (current === undefined) {
      return "missing";
    }
    if (current.version !== expectedVersion) {
      return "conflict";
    }
    const next = structuredClone({ ...order, version: expectedVersion + 1 });
    this.rows.set(order.id, next);
    return structuredClone(next);
  }
}

class MemoryKeys implements IdempotencyRepository {
  private readonly rows = new Map<string, IdempotencyRecord>();

  public snapshot(): IdempotencyRecord[] {
    return [...this.rows.values()].map((row) => structuredClone(row));
  }

  public restoreSnapshot(rows: readonly IdempotencyRecord[]): void {
    this.rows.clear();
    for (const row of rows) {
      this.rows.set(keyOf(row.customerId, row.key), structuredClone(row));
    }
  }

  public async insert(record: IdempotencyRecord): Promise<void> {
    const id = keyOf(record.customerId, record.key);
    if (this.rows.has(id)) {
      throw new DuplicateIdempotencyError();
    }
    this.rows.set(id, structuredClone(record));
  }

  public async find(customerId: string, key: string): Promise<IdempotencyRecord | null> {
    const row = this.rows.get(keyOf(customerId, key));
    return row === undefined ? null : structuredClone(row);
  }
}

class MemoryEvents implements OutboxWriter {
  public readonly events: DomainEvent<unknown>[] = [];
  public failCreated = false;
  public reject: AppError | undefined;

  public snapshot(): DomainEvent<unknown>[] {
    return [...this.events];
  }

  public restore(events: readonly DomainEvent<unknown>[]): void {
    this.events.length = 0;
    this.events.push(...events);
  }

  public async append(event: DomainEvent<unknown>): Promise<void> {
    if (this.failCreated && event.eventType === EventType.orderCreated) {
      throw (
        this.reject ??
        new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, "Kafka is unavailable", 503, {
          dependency: "kafka",
        })
      );
    }
    this.events.push(event);
  }
}

class MemoryInbox implements InboxStore {
  private readonly keys = new Set<string>();

  public snapshot(): string[] {
    return [...this.keys];
  }

  public restore(keys: readonly string[]): void {
    this.keys.clear();
    for (const key of keys) {
      this.keys.add(key);
    }
  }

  public async claim(claim: InboxClaim): Promise<"claimed" | "duplicate"> {
    const id = `${claim.consumer}:${claim.eventId}`;
    if (this.keys.has(id)) {
      return "duplicate";
    }
    this.keys.add(id);
    return "claimed";
  }
}

class FixedClock implements Clock {
  public constructor(private current: Date) {}

  public now(): Date {
    return this.current;
  }

  public advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class MemoryScheduler implements RetryScheduler {
  public readonly calls: { orderId: string; at: Date }[] = [];

  public schedule(orderId: string, at: Date): void {
    this.calls.push({ orderId, at });
  }
}

function keyOf(customerId: string, key: string): string {
  return `${customerId}:${key}`;
}

function harness(): {
  orders: MemoryOrders;
  keys: MemoryKeys;
  events: MemoryEvents;
  clock: FixedClock;
  scheduler: MemoryScheduler;
  app: OrderApplication;
} {
  const orders = new MemoryOrders();
  const keys = new MemoryKeys();
  const events = new MemoryEvents();
  const inbox = new MemoryInbox();
  const clock = new FixedClock(new Date("2026-09-25T10:00:00.000Z"));
  const scheduler = new MemoryScheduler();
  const transactions: TransactionRunner = {
    async run(work) {
      const orderSnap = orders.snapshot();
      const keySnap = keys.snapshot();
      const eventSnap = events.snapshot();
      const inboxSnap = inbox.snapshot();
      try {
        return await work({});
      } catch (error) {
        orders.restoreSnapshot(orderSnap);
        keys.restoreSnapshot(keySnap);
        events.restore(eventSnap);
        inbox.restore(inboxSnap);
        throw error;
      }
    },
  };
  return {
    orders,
    keys,
    events,
    clock,
    scheduler,
    app: new OrderApplication({
      orders,
      idempotency: keys,
      transactions,
      outbox: events,
      inbox,
      clock,
      scheduler,
      random: () => 0,
    }),
  };
}

function input(over: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    customerId: "customer-1",
    currency: "usd",
    idempotencyKey: "key-1",
    correlationId: "corr-1",
    items: [
      {
        productId: "product-1",
        sku: "HAT-1",
        name: "Blue Wool Hat",
        unitPrice: 2500,
        quantity: 2,
      },
    ],
    ...over,
  };
}

function fact(orderId: string, eventType: string, payload: unknown): DomainEvent<unknown> {
  return {
    eventId: "event-1",
    eventType,
    eventVersion: 1,
    occurredAt: "2026-09-25T10:00:00.000Z",
    producer: "inventory-service",
    aggregateType: "reservation",
    aggregateId: orderId,
    correlationId: "corr-1",
    payload,
  };
}

describe("order application", () => {
  it("creates one order and asks inventory to reserve the snapshot quantity", async () => {
    const { app, events } = harness();
    const created = await app.create(input());
    expect(created.replayed).toBe(false);
    expect(created.order.status).toBe("pending");
    expect(created.order.saga.state).toBe("INVENTORY_RESERVATION_PENDING");
    expect(created.order.pricing.grandTotal).toBe(5000);
    expect(created.order.version).toBe(1);
    expect(events.events.map((event) => event.eventType)).toEqual([
      EventType.orderCreated,
      EventType.inventoryReserveRequested,
    ]);
    expect(events.events[1]?.aggregateId).toBe(created.order.id);
    expect(events.events[1]?.payload).toEqual({
      orderId: created.order.id,
      sku: "HAT-1",
      quantity: 2,
    });
  });

  it("replays the same key and rejects a different body", async () => {
    const { app } = harness();
    const first = await app.create(input());
    const replay = await app.create(input());
    expect(replay.replayed).toBe(true);
    expect(replay.order.id).toBe(first.order.id);
    await expect(
      app.get(first.order.id, { userId: "other-customer", roles: ["customer"] }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(app.create(input({ currency: "EUR" }))).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rolls back the order when the outbox write fails, then accepts a retry", async () => {
    const { app, events } = harness();
    events.failCreated = true;
    await expect(app.create(input())).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });
    events.failCreated = false;
    const created = await app.create(input());
    expect(created.replayed).toBe(false);
    expect(events.events.map((event) => event.eventType)).toEqual([
      EventType.orderCreated,
      EventType.inventoryReserveRequested,
    ]);
  });

  it("reserves every line before leaving the pending state", async () => {
    const { app } = harness();
    const created = await app.create(
      input({
        items: [
          { productId: "product-1", sku: "HAT-1", name: "Hat", unitPrice: 100, quantity: 1 },
          { productId: "product-2", sku: "SCARF-1", name: "Scarf", unitPrice: 200, quantity: 1 },
        ],
      }),
    );
    await app.applyReserved(
      fact(created.order.id, EventType.inventoryReserved, {
        reservationId: "res-1",
        orderId: created.order.id,
        sku: "HAT-1",
        quantity: 1,
        expiresAt: "2026-09-25T10:15:00.000Z",
      }),
    );
    const partial = await app.get(created.order.id);
    expect(partial.saga.state).toBe("INVENTORY_RESERVATION_PENDING");
    await app.applyReserved(
      fact(created.order.id, EventType.inventoryReserved, {
        reservationId: "res-2",
        orderId: created.order.id,
        sku: "SCARF-1",
        quantity: 1,
        expiresAt: "2026-09-25T10:15:00.000Z",
      }),
    );
    const reserved = await app.get(created.order.id);
    expect(reserved.saga.state).toBe("PAYMENT_PENDING");
    expect(reserved.payment.status).toBe("pending");
    expect(reserved.inventory.reservationIds).toEqual(["res-1", "res-2"]);
  });

  it("fails the order when inventory cannot hold any line", async () => {
    const { app, events } = harness();
    const created = await app.create(input());
    await app.applyFailed(
      fact(created.order.id, EventType.inventoryReservationFailed, {
        orderId: created.order.id,
        sku: "HAT-1",
        quantity: 2,
        reason: "insufficient_stock",
      }),
    );
    const failed = await app.get(created.order.id);
    expect(failed.status).toBe("failed");
    expect(failed.saga.state).toBe("FAILED");
    expect(events.events.map((event) => event.eventType)).not.toContain(EventType.orderCancelled);
  });

  it("releases a hold when another line fails", async () => {
    const { app, events } = harness();
    const created = await app.create(
      input({
        items: [
          { productId: "product-1", sku: "HAT-1", name: "Hat", unitPrice: 100, quantity: 1 },
          { productId: "product-2", sku: "SCARF-1", name: "Scarf", unitPrice: 200, quantity: 1 },
        ],
      }),
    );
    await app.applyReserved(
      fact(created.order.id, EventType.inventoryReserved, {
        reservationId: "res-1",
        orderId: created.order.id,
        sku: "HAT-1",
        quantity: 1,
        expiresAt: "2026-09-25T10:15:00.000Z",
      }),
    );
    await app.applyFailed(
      fact(created.order.id, EventType.inventoryReservationFailed, {
        orderId: created.order.id,
        sku: "SCARF-1",
        quantity: 1,
        reason: "unknown_sku",
      }),
    );
    const compensating = await app.get(created.order.id);
    expect(compensating.saga.state).toBe("COMPENSATING_INVENTORY");
    expect(events.events.at(-1)?.eventType).toBe(EventType.inventoryReleaseRequested);
    expect(events.events.at(-1)?.payload).toMatchObject({ reservationId: "res-1" });
  });

  it("cancels a reserved order and publishes order.cancelled once stock is released", async () => {
    const { app, events } = harness();
    const created = await app.create(input());
    await app.applyReserved(
      fact(created.order.id, EventType.inventoryReserved, {
        reservationId: "res-1",
        orderId: created.order.id,
        sku: "HAT-1",
        quantity: 2,
        expiresAt: "2026-09-25T10:15:00.000Z",
      }),
    );
    const reserved = await app.get(created.order.id);
    const cancelling = await app.cancel(created.order.id, reserved.version);
    expect(cancelling.status).toBe("cancelling");
    expect(events.events.at(-1)?.eventType).toBe(EventType.inventoryReleaseRequested);
    await app.applyReleased(
      fact(created.order.id, EventType.inventoryReleased, {
        reservationId: "res-1",
        orderId: created.order.id,
        sku: "HAT-1",
        quantity: 2,
        reason: "released",
      }),
    );
    const cancelled = await app.get(created.order.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.saga.cancelledPublished).toBe(true);
    const cancelledEvents = events.events.filter(
      (event) => event.eventType === EventType.orderCancelled,
    );
    expect(cancelledEvents).toHaveLength(1);
    await app.applyReleased(
      fact(created.order.id, EventType.inventoryReleased, {
        reservationId: "res-1",
        orderId: created.order.id,
        sku: "HAT-1",
        quantity: 2,
        reason: "released",
      }),
    );
    expect(
      events.events.filter((event) => event.eventType === EventType.orderCancelled),
    ).toHaveLength(1);
  });

  it("skips an unknown order and retries a reservation that does not match", async () => {
    const { app } = harness();
    const facts = new OrderFacts(app);
    const missing = await handleConsumerMessage({
      value: Buffer.from(
        JSON.stringify(
          fact("missing-order", EventType.inventoryReserved, {
            reservationId: "res-1",
            orderId: "missing-order",
            sku: "HAT-1",
            quantity: 1,
            expiresAt: "2026-09-25T10:15:00.000Z",
          }),
        ),
      ),
      handle: (event) => facts.handle(event),
    });
    expect(missing).toBe("commit");

    const created = await app.create(input());
    const mismatched = await handleConsumerMessage({
      value: Buffer.from(
        JSON.stringify(
          fact(created.order.id, EventType.inventoryReserved, {
            reservationId: "res-1",
            orderId: created.order.id,
            sku: "HAT-1",
            quantity: 9,
            expiresAt: "2026-09-25T10:15:00.000Z",
          }),
        ),
      ),
      handle: (event) => facts.handle(event),
    });
    expect(mismatched).toBe("retry");
  });

  it("confirms the order after payment authorization", async () => {
    const { app, events } = harness();
    const created = await app.create(input());
    await app.applyReserved(
      fact(created.order.id, EventType.inventoryReserved, {
        reservationId: "res-1",
        orderId: created.order.id,
        sku: "HAT-1",
        quantity: 2,
        expiresAt: "2026-09-25T10:15:00.000Z",
      }),
    );
    await app.applyPaymentAuthorized(
      fact(created.order.id, EventType.paymentAuthorized, {
        paymentId: "pay-1",
        orderId: created.order.id,
        amount: 5000,
        currency: "USD",
      }),
    );
    const confirmed = await app.get(created.order.id);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.saga.state).toBe("COMPLETED");
    expect(confirmed.payment).toEqual({ status: "authorized", paymentId: "pay-1" });
    expect(
      events.events.filter((event) => event.eventType === EventType.orderConfirmed),
    ).toHaveLength(1);
    expect(
      events.events.filter((event) => event.eventType === EventType.inventoryCommitRequested),
    ).toHaveLength(1);
  });

  it("releases the hold when payment is declined", async () => {
    const { app, events } = harness();
    const created = await app.create(input());
    await app.applyReserved(
      fact(created.order.id, EventType.inventoryReserved, {
        reservationId: "res-1",
        orderId: created.order.id,
        sku: "HAT-1",
        quantity: 2,
        expiresAt: "2026-09-25T10:15:00.000Z",
      }),
    );
    await app.applyPaymentFailed(
      fact(created.order.id, EventType.paymentAuthorizationFailed, {
        paymentId: "pay-1",
        orderId: created.order.id,
        amount: 5000,
        currency: "USD",
        reason: "declined",
      }),
    );
    const failed = await app.get(created.order.id);
    expect(failed.saga.state).toBe("COMPENSATING_INVENTORY");
    expect(failed.payment.status).toBe("failed");
    expect(events.events.at(-1)?.eventType).toBe(EventType.inventoryReleaseRequested);
    expect(events.events.map((event) => event.eventType)).not.toContain(EventType.orderCancelled);
    expect(events.events.map((event) => event.eventType)).not.toContain(EventType.orderConfirmed);
  });

  it("asks for a refund when payment is authorized after the caller cancels", async () => {
    const { app, events } = harness();
    const created = await app.create(input());
    await app.applyReserved(
      fact(created.order.id, EventType.inventoryReserved, {
        reservationId: "res-1",
        orderId: created.order.id,
        sku: "HAT-1",
        quantity: 2,
        expiresAt: "2026-09-25T10:15:00.000Z",
      }),
    );
    const pending = await app.get(created.order.id);
    await app.cancel(created.order.id, pending.version);
    await app.applyPaymentAuthorized(
      fact(created.order.id, EventType.paymentAuthorized, {
        paymentId: "pay-1",
        orderId: created.order.id,
        amount: 5000,
        currency: "USD",
      }),
    );
    const compensating = await app.get(created.order.id);
    expect(compensating.saga.state).toBe("COMPENSATING_INVENTORY");
    expect(compensating.payment.status).toBe("authorized");
    expect(events.events.at(-1)?.eventType).toBe(EventType.paymentRefundRequested);
  });

  it("backs off locally, then publishes delayed retries, then dead-letters", async () => {
    const { app, events, clock, scheduler, orders } = harness();
    await app.create(input());
    events.events.length = 0;
    const stored = orders.snapshot()[0];
    stored!.saga.createdPublished = false;
    orders.restoreSnapshot([stored!]);
    events.failCreated = true;
    await app.recover();
    const created = orders.snapshot()[0];
    expect(created?.saga.localAttempts).toBe(1);
    expect(created?.saga.nextAttemptAt?.toISOString()).toBe("2026-09-25T10:00:00.100Z");
    expect(scheduler.calls).toEqual([
      { orderId: created?.id, at: new Date("2026-09-25T10:00:00.100Z") },
    ]);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const current = orders.snapshot()[0];
      const due = current?.saga.nextAttemptAt;
      expect(due).toBeInstanceOf(Date);
      clock.advance(due!.getTime() - clock.now().getTime());
      await app.recover();
    }

    const dead = orders.snapshot()[0];
    expect(dead?.saga.dlqPublished).toBe(true);
    expect(dead?.saga.localAttempts).toBe(3);
    expect(dead?.saga.topicAttempts).toBe(3);
    expect(dead?.saga.retryCount).toBe(7);
    expect(dead?.saga.state).toBe("INVENTORY_RESERVATION_PENDING");
    expect(events.events.map((event) => event.eventType)).toEqual([
      EventType.sagaRetry1m,
      EventType.sagaRetry5m,
      EventType.sagaRetry30m,
      EventType.sagaDeadLettered,
    ]);
    const deadLetter = events.events.at(-1);
    expect(deadLetter?.aggregateId).toBe(dead?.id);
    expect(deadLetter?.payload).toMatchObject({
      errorCode: ErrorCode.DEPENDENCY_UNAVAILABLE,
      consumer: "order-service",
      attempts: 7,
      orderId: dead?.id,
    });

    await app.recover();
    expect(events.events).toHaveLength(4);

    events.failCreated = false;
    const resumed = await app.retry(dead!.id, dead!.version);
    expect(resumed.saga.dlqPublished).toBe(false);
    expect(resumed.saga.localAttempts).toBe(0);
    expect(resumed.saga.retryCount).toBe(7);
    expect(events.events.map((event) => event.eventType)).toContain(EventType.orderCreated);
  });

  it("halts a validation failure without a dead letter", async () => {
    const { app, events, orders } = harness();
    await app.create(input());
    events.events.length = 0;
    const stored = orders.snapshot()[0];
    stored!.saga.createdPublished = false;
    orders.restoreSnapshot([stored!]);
    events.failCreated = true;
    events.reject = new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {});
    await app.recover();
    const halted = orders.snapshot()[0];
    expect(halted?.saga.retryHalted).toBe(true);
    expect(halted?.saga.nextAttemptAt).toBeUndefined();
    expect(events.events).toEqual([]);
    await app.recover();
    expect(halted?.saga.retryCount).toBe(1);
  });

  it("wakes a due order from a retry topic and ignores an early one", async () => {
    const { app, events, clock, orders } = harness();
    await app.create(input());
    const stored = orders.snapshot()[0];
    stored!.saga.createdPublished = false;
    orders.restoreSnapshot([stored!]);
    events.failCreated = true;
    await app.recover();
    const created = orders.snapshot()[0];
    const facts = new OrderFacts(app);
    await facts.handle(
      fact(created!.id, EventType.sagaRetry1m, {
        orderId: created!.id,
        sagaId: created!.saga.sagaId,
      }),
    );
    expect((await app.get(created!.id)).saga.localAttempts).toBe(1);
    clock.advance(100);
    await facts.handle(
      fact(created!.id, EventType.sagaRetry1m, {
        orderId: created!.id,
        sagaId: created!.saga.sagaId,
      }),
    );
    expect((await app.get(created!.id)).saga.localAttempts).toBe(2);
    await expect(
      facts.handle(fact(created!.id, EventType.sagaRetry1m, { orderId: "other-order" })),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });
});
