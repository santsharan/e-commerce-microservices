import { randomUUID } from "node:crypto";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { EventType, type DomainEvent } from "@commerce-flow/events";
import { activeTraceId, recordInventoryReservation } from "@commerce-flow/observability";
import {
  ConsumerName,
  isInboxDuplicate,
  payloadHash,
  type InboxStore,
  type OutboxWriter,
} from "@commerce-flow/outbox";
import {
  onHandQuantity,
  type ReleaseCommand,
  type ReleasedPayload,
  type ReservationFailedPayload,
  type ReserveCommand,
  type ReservedPayload,
} from "../domain/commands.js";
import {
  DuplicateReservationError,
  ReleaseReason,
  ReservationFailure,
  ReservationStatus,
  StockStatus,
  expireBatchSize,
  isSku,
  onHandMax,
  reservationTtlSeconds,
  reserveQuantityMax,
  type Reservation,
  type StockRecord,
} from "../domain/stock.js";
import type { Clock, ReservationRepository, StockRepository, TransactionRunner } from "./ports.js";

export interface InventoryDependencies {
  stock: StockRepository;
  reservations: ReservationRepository;
  transactions: TransactionRunner;
  outbox: OutboxWriter;
  inbox: InboxStore;
  clock: Clock;
}

export interface StockInput {
  sku: string;
  quantity: number;
}

export interface AdjustInput {
  sku: string;
  quantity: number;
}

export interface HttpReserveInput {
  orderId: string;
  sku: string;
  quantity: number;
  correlationId: string;
}

export interface HttpReleaseInput {
  reservationId: string;
  correlationId: string;
}

export interface ReserveSuccess {
  reservation: Reservation;
  replayed: boolean;
}

export class InventoryApplication {
  public constructor(private readonly deps: InventoryDependencies) {}

  public async createStock(input: StockInput): Promise<StockRecord> {
    const now = this.deps.clock.now();
    const record: StockRecord = {
      id: randomUUID(),
      sku: requireSku(input.sku),
      available: onHandQuantity(input.quantity),
      reserved: 0,
      status: StockStatus.active,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.stock.insert(record);
    return record;
  }

  public async getStock(sku: string): Promise<StockRecord> {
    const record = await this.deps.stock.findBySku(requireSku(sku));
    if (record === null) {
      throw notFound("Inventory was not found");
    }
    return record;
  }

  public async adjust(input: AdjustInput): Promise<StockRecord> {
    requireSku(input.sku);
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity === 0 ||
      Math.abs(input.quantity) > onHandMax
    ) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
        fields: ["quantity"],
      });
    }
    const updated = await this.deps.stock.adjust(input.sku, input.quantity, this.deps.clock.now());
    if (updated === "missing") {
      throw notFound("Inventory was not found");
    }
    if (updated === "insufficient" || updated === "overflow") {
      throw new AppError(
        ErrorCode.CONFLICT,
        updated === "overflow" ? "Stock would exceed the maximum" : "Not enough stock is available",
        409,
        { reason: ReservationFailure.insufficient },
      );
    }
    return updated;
  }

  public async consume(
    event: DomainEvent<unknown>,
    work: (session: object) => Promise<void>,
  ): Promise<void> {
    try {
      await this.deps.transactions.run(async (session) => {
        const claim = await this.deps.inbox.claim(
          {
            eventId: event.eventId,
            consumer: ConsumerName.inventory,
            payloadHash: payloadHash(event.payload),
            now: this.deps.clock.now(),
          },
          session,
        );
        if (claim === "duplicate") {
          return;
        }
        await work(session);
      });
    } catch (error) {
      if (isInboxDuplicate(error)) {
        return;
      }
      throw error;
    }
  }

  public async reserve(input: ReserveCommand | HttpReserveInput): Promise<ReserveSuccess> {
    try {
      const result = await this.deps.transactions.run((session) =>
        this.reserveRecorded(input, session),
      );
      if ("error" in result) {
        throw result.error;
      }
      return result.ok;
    } catch (error) {
      if (!(error instanceof DuplicateReservationError)) {
        throw error;
      }
      return this.replayAfterRace(input);
    }
  }

  public async reserveRecorded(
    input: ReserveCommand | HttpReserveInput,
    session: object,
  ): Promise<{ ok: ReserveSuccess } | { error: AppError }> {
    const command = normalizeReserve(input);
    const outcome = await this.reserveAndRecord(command, session);
    if (outcome.kind === "failed") {
      return { error: failure(outcome.reason) };
    }
    return { ok: { reservation: outcome.reservation, replayed: outcome.replayed } };
  }

  private async replayAfterRace(input: ReserveCommand | HttpReserveInput): Promise<ReserveSuccess> {
    const command = normalizeReserve(input);
    const existing = await this.deps.reservations.findByOrderSku(command.orderId, command.sku);
    if (
      existing !== null &&
      existing.status === ReservationStatus.active &&
      existing.quantity === command.quantity
    ) {
      await this.deps.transactions.run((session) => this.reserveAndRecord(command, session));
      return { reservation: existing, replayed: true };
    }
    const recorded = await this.deps.transactions.run((session) =>
      this.reserveAndRecord(command, session),
    );
    if (recorded.kind === "reserved") {
      return { reservation: recorded.reservation, replayed: recorded.replayed };
    }
    throw failure(recorded.reason);
  }

  public async release(
    input: ReleaseCommand | HttpReleaseInput,
    session?: object,
  ): Promise<Reservation> {
    const run = (current: object): Promise<Reservation> => this.releaseIn(input, current);
    if (session !== undefined) {
      return run(session);
    }
    return this.deps.transactions.run(run);
  }

  public async commit(input: ReleaseCommand, session?: object): Promise<Reservation> {
    const run = (current: object): Promise<Reservation> => this.commitIn(input, current);
    if (session !== undefined) {
      return run(session);
    }
    return this.deps.transactions.run(run);
  }

  public getReservation(id: string): Promise<Reservation> {
    return this.requireReservation(id);
  }

  public async expireDue(): Promise<number> {
    const now = this.deps.clock.now();
    const due = await this.deps.reservations.listDue(now, expireBatchSize);
    let expired = 0;
    for (const reservation of due) {
      const closed = await this.deps.transactions.run((session) =>
        this.closeAndRecord(
          reservation.id,
          ReleaseReason.expired,
          {},
          reservation.id,
          undefined,
          session,
        ),
      );
      if (closed.changed) {
        expired += 1;
      }
    }
    return expired;
  }

  private async reserveAndRecord(
    command: ReserveCommand,
    session: object,
  ): Promise<
    | { kind: "reserved"; reservation: Reservation; replayed: boolean }
    | { kind: "failed"; reason: ReservationFailure }
  > {
    const outcome = await this.reserveInTransaction(command, session);
    if (outcome.kind === "failed") {
      await this.deps.outbox.append(
        inventoryEvent({
          eventType: EventType.inventoryReservationFailed,
          aggregateId: command.orderId,
          occurredAt: this.deps.clock.now(),
          correlationId: command.correlationId,
          ...(command.causationId === undefined || command.causationId.length === 0
            ? {}
            : { causationId: command.causationId }),
          payload: {
            orderId: command.orderId,
            sku: command.sku,
            quantity: command.quantity,
            reason: outcome.reason,
          } satisfies ReservationFailedPayload,
        }),
        session,
      );
      recordInventoryReservation("failure");
      return outcome;
    }
    if (!outcome.replayed) {
      recordInventoryReservation("success");
    }
    await this.deps.outbox.append(
      inventoryEvent({
        eventType: EventType.inventoryReserved,
        aggregateId: command.orderId,
        occurredAt: this.deps.clock.now(),
        correlationId: command.correlationId,
        ...(command.causationId === undefined || command.causationId.length === 0
          ? {}
          : { causationId: command.causationId }),
        payload: {
          reservationId: outcome.reservation.id,
          orderId: outcome.reservation.orderId,
          sku: outcome.reservation.sku,
          quantity: outcome.reservation.quantity,
          expiresAt: outcome.reservation.expiresAt.toISOString(),
        } satisfies ReservedPayload,
      }),
      session,
    );
    return outcome;
  }

  private async releaseIn(
    input: ReleaseCommand | HttpReleaseInput,
    session: object,
  ): Promise<Reservation> {
    const reservationId = input.reservationId.trim();
    if (reservationId.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
        fields: ["reservationId"],
      });
    }
    const expected: { orderId?: string; sku?: string } = {};
    if ("orderId" in input) {
      expected.orderId = input.orderId;
      expected.sku = input.sku;
    }
    const closed = await this.closeAndRecord(
      reservationId,
      ReleaseReason.released,
      expected,
      input.correlationId,
      causationOf(input),
      session,
    );
    return closed.reservation;
  }

  private async commitIn(input: ReleaseCommand, session: object): Promise<Reservation> {
    const current = await this.deps.reservations.findById(input.reservationId, session);
    if (current === null) {
      throw notFound("Reservation was not found");
    }
    if (current.orderId !== input.orderId || current.sku !== input.sku) {
      throw new AppError(ErrorCode.CONFLICT, "The reservation does not match the command", 409, {});
    }
    if (current.status === ReservationStatus.committed) {
      return current;
    }
    if (current.status !== ReservationStatus.active) {
      throw new AppError(ErrorCode.CONFLICT, "The reservation cannot be committed", 409, {});
    }
    const now = this.deps.clock.now();
    const updated = await this.deps.reservations.close(
      current.id,
      ReservationStatus.committed,
      now,
      session,
    );
    if (updated === "missing" || updated === "closed") {
      const latest = await this.deps.reservations.findById(current.id, session);
      if (latest === null) {
        throw notFound("Reservation was not found");
      }
      return latest;
    }
    const stock = await this.deps.stock.commit(updated.sku, updated.quantity, now, session);
    if (stock === "inconsistent") {
      throw new Error("reserved quantity is missing");
    }
    return updated;
  }

  private async reserveInTransaction(
    command: ReserveCommand,
    session: object,
  ): Promise<
    | { kind: "reserved"; reservation: Reservation; replayed: boolean }
    | { kind: "failed"; reason: ReservationFailure }
  > {
    const existing = await this.deps.reservations.findByOrderSku(
      command.orderId,
      command.sku,
      session,
    );
    if (existing !== null) {
      if (existing.status === ReservationStatus.active && existing.quantity === command.quantity) {
        return { kind: "reserved", reservation: existing, replayed: true };
      }
      return { kind: "failed", reason: ReservationFailure.conflict };
    }
    const now = this.deps.clock.now();
    const stock = await this.deps.stock.reserve(command.sku, command.quantity, now, session);
    if (stock === "unavailable") {
      const row = await this.deps.stock.findBySku(command.sku, session);
      if (row === null) {
        return { kind: "failed", reason: ReservationFailure.unknownSku };
      }
      if (row.status !== StockStatus.active) {
        return { kind: "failed", reason: ReservationFailure.inactive };
      }
      return { kind: "failed", reason: ReservationFailure.insufficient };
    }
    const reservation: Reservation = {
      id: randomUUID(),
      orderId: command.orderId,
      sku: command.sku,
      quantity: command.quantity,
      status: ReservationStatus.active,
      expiresAt: new Date(now.getTime() + reservationTtlSeconds * 1000),
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.reservations.insert(reservation, session);
    return { kind: "reserved", reservation, replayed: false };
  }

  private async closeAndRecord(
    id: string,
    status: "released" | "expired",
    expected: { orderId?: string; sku?: string },
    correlationId: string,
    causationId: string | undefined,
    session: object,
  ): Promise<{ reservation: Reservation; changed: boolean }> {
    const current = await this.deps.reservations.findById(id, session);
    if (current === null) {
      throw notFound("Reservation was not found");
    }
    if (expected.orderId !== undefined && current.orderId !== expected.orderId) {
      throw new AppError(ErrorCode.CONFLICT, "The reservation does not match the command", 409, {});
    }
    if (expected.sku !== undefined && current.sku !== expected.sku) {
      throw new AppError(ErrorCode.CONFLICT, "The reservation does not match the command", 409, {});
    }
    if (current.status !== ReservationStatus.active) {
      return { reservation: current, changed: false };
    }
    const closed = await this.deps.reservations.close(id, status, this.deps.clock.now(), session);
    if (closed === "missing") {
      throw notFound("Reservation was not found");
    }
    if (closed === "closed") {
      const latest = await this.deps.reservations.findById(id, session);
      if (latest === null) {
        throw notFound("Reservation was not found");
      }
      return { reservation: latest, changed: false };
    }
    const restored = await this.deps.stock.restore(
      closed.sku,
      closed.quantity,
      closed.updatedAt,
      session,
    );
    if (restored === "inconsistent") {
      throw new Error("reserved quantity is missing");
    }
    await this.deps.outbox.append(
      inventoryEvent({
        eventType: EventType.inventoryReleased,
        aggregateId: closed.orderId,
        occurredAt: this.deps.clock.now(),
        correlationId,
        ...(causationId === undefined || causationId.length === 0 ? {} : { causationId }),
        payload: {
          reservationId: closed.id,
          orderId: closed.orderId,
          sku: closed.sku,
          quantity: closed.quantity,
          reason: status,
        } satisfies ReleasedPayload,
      }),
      session,
    );
    return { reservation: closed, changed: true };
  }

  private async requireReservation(id: string): Promise<Reservation> {
    const reservation = await this.deps.reservations.findById(id.trim());
    if (reservation === null) {
      throw notFound("Reservation was not found");
    }
    return reservation;
  }
}

function normalizeReserve(input: ReserveCommand | HttpReserveInput): ReserveCommand {
  const orderId = input.orderId.trim();
  if (orderId.length === 0 || orderId.length > 80) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["orderId"] });
  }
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > reserveQuantityMax
  ) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["quantity"],
    });
  }
  const command: ReserveCommand = {
    orderId,
    sku: requireSku(input.sku),
    quantity: input.quantity,
    correlationId: requireCorrelation(input.correlationId),
    causationId: "",
  };
  if ("causationId" in input) {
    command.causationId = input.causationId;
  }
  return command;
}

function causationOf(input: ReleaseCommand | HttpReleaseInput): string | undefined {
  return "causationId" in input ? input.causationId : undefined;
}

function requireSku(sku: string): string {
  const trimmed = sku.trim();
  if (!isSku(trimmed)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["sku"] });
  }
  return trimmed;
}

function requireCorrelation(correlationId: string): string {
  const trimmed = correlationId.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["correlationId"],
    });
  }
  return trimmed;
}

function inventoryEvent<TPayload>(input: {
  eventType: EventType;
  aggregateId: string;
  occurredAt: Date;
  correlationId: string;
  causationId?: string;
  payload: TPayload;
}): DomainEvent<TPayload> {
  const event: DomainEvent<TPayload> = {
    eventId: randomUUID(),
    eventType: input.eventType,
    eventVersion: 1,
    occurredAt: input.occurredAt.toISOString(),
    producer: "inventory-service",
    aggregateType: "inventory",
    aggregateId: input.aggregateId,
    correlationId: input.correlationId,
    payload: input.payload,
  };
  if (input.causationId !== undefined && input.causationId.length > 0) {
    event.causationId = input.causationId;
  }
  const traceId = activeTraceId();
  if (traceId !== undefined) {
    event.traceId = traceId;
  }
  return event;
}

function failure(reason: ReservationFailure): AppError {
  if (reason === ReservationFailure.unknownSku) {
    return notFound("Inventory was not found");
  }
  const message =
    reason === ReservationFailure.insufficient
      ? "Not enough stock is available"
      : "The reservation conflicts with the current stock";
  return new AppError(ErrorCode.CONFLICT, message, 409, { reason });
}

function notFound(message: string): AppError {
  return new AppError(ErrorCode.NOT_FOUND, message, 404, {});
}
