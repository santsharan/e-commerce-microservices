import type { DomainEvent } from "@commerce-flow/events";
import type { Logger } from "@commerce-flow/logger";
import type { InboxClaim, InboxStore, OutboxWriter } from "@commerce-flow/outbox";
import { describe, expect, it } from "vitest";
import { InventoryApplication } from "./inventory-application.js";
import type { ReservationRepository, StockRepository, TransactionRunner } from "./ports.js";
import { InventoryCommands } from "../infrastructure/kafka-inventory.js";
import { EventType } from "@commerce-flow/events";
import {
  DuplicateReservationError,
  ReservationStatus,
  StockStatus,
  type Reservation,
  type StockRecord,
} from "../domain/stock.js";

class MemoryStock implements StockRepository {
  private readonly records = new Map<string, StockRecord>();

  public snapshot(): StockRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  public restoreSnapshot(records: readonly StockRecord[]): void {
    this.records.clear();
    for (const record of records) {
      this.records.set(record.sku, record);
    }
  }

  public async insert(record: StockRecord): Promise<void> {
    if ([...this.records.values()].some((item) => item.sku === record.sku)) {
      throw new Error("duplicate sku");
    }
    this.records.set(record.sku, record);
  }

  public async findBySku(sku: string): Promise<StockRecord | null> {
    return this.records.get(sku) ?? null;
  }

  public async reserve(
    sku: string,
    quantity: number,
    now: Date,
  ): Promise<StockRecord | "unavailable"> {
    const row = this.records.get(sku);
    if (row === undefined || row.status !== StockStatus.active || row.available < quantity) {
      return "unavailable";
    }
    const next = {
      ...row,
      available: row.available - quantity,
      reserved: row.reserved + quantity,
      version: row.version + 1,
      updatedAt: now,
    };
    this.records.set(sku, next);
    return next;
  }

  public async restore(
    sku: string,
    quantity: number,
    now: Date,
  ): Promise<StockRecord | "inconsistent"> {
    const row = this.records.get(sku);
    if (row === undefined || row.reserved < quantity) {
      return "inconsistent";
    }
    const next = {
      ...row,
      available: row.available + quantity,
      reserved: row.reserved - quantity,
      version: row.version + 1,
      updatedAt: now,
    };
    this.records.set(sku, next);
    return next;
  }

  public async commit(
    sku: string,
    quantity: number,
    now: Date,
  ): Promise<StockRecord | "inconsistent"> {
    const row = this.records.get(sku);
    if (row === undefined || row.reserved < quantity) {
      return "inconsistent";
    }
    const next = {
      ...row,
      reserved: row.reserved - quantity,
      version: row.version + 1,
      updatedAt: now,
    };
    this.records.set(sku, next);
    return next;
  }

  public async adjust(
    sku: string,
    delta: number,
    now: Date,
  ): Promise<StockRecord | "missing" | "insufficient" | "overflow"> {
    const row = this.records.get(sku);
    if (row === undefined) {
      return "missing";
    }
    const available = row.available + delta;
    if (available < 0) {
      return "insufficient";
    }
    if (available > 1_000_000_000) {
      return "overflow";
    }
    const next = { ...row, available, version: row.version + 1, updatedAt: now };
    this.records.set(sku, next);
    return next;
  }
}

class MemoryReservations implements ReservationRepository {
  public failInsert = false;
  public visibleWinner: Reservation | null = null;
  private winnerVisible = false;
  private readonly records = new Map<string, Reservation>();

  public snapshot(): Reservation[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  public restore(records: readonly Reservation[]): void {
    this.records.clear();
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  public async insert(reservation: Reservation): Promise<void> {
    if (this.failInsert) {
      this.failInsert = false;
      this.winnerVisible = true;
      throw new DuplicateReservationError();
    }
    if (
      [...this.records.values()].some(
        (item) => item.orderId === reservation.orderId && item.sku === reservation.sku,
      )
    ) {
      throw new DuplicateReservationError();
    }
    this.records.set(reservation.id, reservation);
  }

  public async findById(id: string): Promise<Reservation | null> {
    return this.records.get(id) ?? null;
  }

  public async findByOrderSku(orderId: string, sku: string): Promise<Reservation | null> {
    const local = [...this.records.values()].find(
      (item) => item.orderId === orderId && item.sku === sku,
    );
    if (local !== undefined) {
      return local;
    }
    if (
      this.winnerVisible &&
      this.visibleWinner !== null &&
      this.visibleWinner.orderId === orderId &&
      this.visibleWinner.sku === sku
    ) {
      return this.visibleWinner;
    }
    return null;
  }

  public async close(
    id: string,
    status: "released" | "expired" | "committed",
    now: Date,
  ): Promise<Reservation | "missing" | "closed"> {
    const current = this.records.get(id);
    if (current === undefined) {
      return "missing";
    }
    if (current.status !== ReservationStatus.active) {
      return "closed";
    }
    const next = { ...current, status, updatedAt: now };
    this.records.set(id, next);
    return next;
  }

  public async listDue(now: Date, limit: number): Promise<Reservation[]> {
    return [...this.records.values()]
      .filter((item) => item.status === ReservationStatus.active && item.expiresAt <= now)
      .slice(0, limit);
  }
}

class MemoryEvents implements OutboxWriter {
  public readonly published: DomainEvent<unknown>[] = [];

  public async append(event: DomainEvent<unknown>): Promise<void> {
    this.published.push(event);
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

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

function harness(): {
  app: InventoryApplication;
  stock: MemoryStock;
  reservations: MemoryReservations;
  events: MemoryEvents;
  now: { value: Date };
} {
  const stock = new MemoryStock();
  const reservations = new MemoryReservations();
  const events = new MemoryEvents();
  const inbox = new MemoryInbox();
  const now = { value: new Date("2026-09-25T09:00:00.000Z") };
  const transactions: TransactionRunner = {
    async run(work) {
      const stockSnap = stock.snapshot();
      const reservationSnap = reservations.snapshot();
      try {
        return await work({});
      } catch (error) {
        stock.restoreSnapshot(stockSnap);
        reservations.restore(reservationSnap);
        throw error;
      }
    },
  };
  return {
    stock,
    reservations,
    events,
    now,
    app: new InventoryApplication({
      stock,
      reservations,
      transactions,
      outbox: events,
      inbox,
      clock: { now: () => now.value },
    }),
  };
}

describe("inventory application", () => {
  it("reserves stock once and rejects a second order that would oversell", async () => {
    const { app, events } = harness();
    await app.createStock({ sku: "HAT-1", quantity: 5 });
    const first = await app.reserve({
      orderId: "order-1",
      sku: "HAT-1",
      quantity: 3,
      correlationId: "corr-1",
    });
    const replay = await app.reserve({
      orderId: "order-1",
      sku: "HAT-1",
      quantity: 3,
      correlationId: "corr-1",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.reservation.id).toBe(first.reservation.id);
    expect(await app.getStock("HAT-1")).toMatchObject({ available: 2, reserved: 3 });

    await expect(
      app.reserve({ orderId: "order-2", sku: "HAT-1", quantity: 3, correlationId: "corr-2" }),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "insufficient_stock" } });
    expect(await app.getStock("HAT-1")).toMatchObject({ available: 2, reserved: 3 });
    expect(events.published.map((event) => event.eventType)).toEqual([
      EventType.inventoryReserved,
      EventType.inventoryReserved,
      EventType.inventoryReservationFailed,
    ]);
  });

  it("returns stock on release and again when a hold expires", async () => {
    const { app, events, now } = harness();
    await app.createStock({ sku: "HAT-1", quantity: 4 });
    const reserved = await app.reserve({
      orderId: "order-1",
      sku: "HAT-1",
      quantity: 1,
      correlationId: "corr-1",
    });
    const held = await app.reserve({
      orderId: "order-2",
      sku: "HAT-1",
      quantity: 1,
      correlationId: "corr-2",
    });
    await app.release({ reservationId: reserved.reservation.id, correlationId: "corr-1" });
    await app.release({ reservationId: reserved.reservation.id, correlationId: "corr-1" });
    expect(await app.getStock("HAT-1")).toMatchObject({ available: 3, reserved: 1 });

    now.value = new Date("2026-09-25T09:16:00.000Z");
    expect(await app.expireDue()).toBe(1);
    expect(await app.expireDue()).toBe(0);
    expect(await app.getReservation(held.reservation.id)).toMatchObject({ status: "expired" });
    expect(await app.getStock("HAT-1")).toMatchObject({ available: 4, reserved: 0 });
    expect(
      events.published.filter((event) => event.eventType === EventType.inventoryReleased),
    ).toHaveLength(2);
  });

  it("drops the stock change when reservation insert loses a race", async () => {
    const { app, reservations } = harness();
    await app.createStock({ sku: "HAT-1", quantity: 5 });
    reservations.visibleWinner = {
      id: "winner",
      orderId: "order-1",
      sku: "HAT-1",
      quantity: 2,
      status: ReservationStatus.active,
      expiresAt: new Date("2026-09-25T09:15:00.000Z"),
      createdAt: new Date("2026-09-25T09:00:00.000Z"),
      updatedAt: new Date("2026-09-25T09:00:00.000Z"),
    };
    reservations.failInsert = true;
    const replay = await app.reserve({
      orderId: "order-1",
      sku: "HAT-1",
      quantity: 2,
      correlationId: "corr-1",
    });
    expect(replay).toMatchObject({ replayed: true, reservation: { id: "winner" } });
    expect(await app.getStock("HAT-1")).toMatchObject({ available: 5, reserved: 0 });
  });

  it("lets a command handler commit a business failure and retry a dependency failure", async () => {
    const { app, events } = harness();
    const commands = new InventoryCommands(app, logger);
    await commands.handle({
      eventId: "event-1",
      eventType: EventType.inventoryReserveRequested,
      eventVersion: 1,
      occurredAt: "2026-09-25T09:00:00.000Z",
      producer: "order-service",
      aggregateType: "order",
      aggregateId: "order-1",
      correlationId: "corr-1",
      payload: { orderId: "order-1", sku: "MISSING", quantity: 1 },
    });
    expect(events.published[0]?.eventType).toBe(EventType.inventoryReservationFailed);
    await expect(
      commands.handle({
        eventId: "event-2",
        eventType: "payment.authorized",
        eventVersion: 1,
        occurredAt: "2026-09-25T09:00:00.000Z",
        producer: "payment-service",
        aggregateType: "payment",
        aggregateId: "order-1",
        correlationId: "corr-1",
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });
});
