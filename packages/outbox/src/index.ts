import { createHash, randomUUID } from "node:crypto";
import type { DomainEvent } from "@commerce-flow/events";
import type { ClientSession, Db } from "mongodb";

export const outboxDispatchIntervalMs = 1_000;
export const outboxBatchSize = 20;
const outboxLockMs = 30_000;
const outboxRetryDelaysMs = [1_000, 5_000, 30_000] as const;

export const ConsumerName = {
  inventory: "inventory-service",
  order: "order-service",
  payment: "payment-service",
} as const;

export interface OutboxWriter {
  append(event: DomainEvent<unknown>, session: object): Promise<void>;
}

export interface InboxClaim {
  eventId: string;
  consumer: string;
  payloadHash: string;
  now: Date;
}

export interface InboxStore {
  claim(claim: InboxClaim, session: object): Promise<"claimed" | "duplicate">;
}

interface OutboxDocument {
  id: string;
  eventId: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  eventVersion: number;
  payload: unknown;
  occurredAt: string;
  producer: string;
  correlationId: string;
  causationId?: string;
  traceId?: string;
  status: "pending" | "published";
  attempts: number;
  nextAttemptAt: Date;
  createdAt: Date;
  publishedAt?: Date;
  lockUntil?: Date;
}

/**
 * Delay after `attempts` failed publishes. The row stays pending and is tried again.
 * A dead letter would drop the business event, so the delay caps at 30 seconds.
 */
export function outboxRetryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), outboxRetryDelaysMs.length) - 1;
  const delay = outboxRetryDelaysMs[index];
  return delay ?? 30_000;
}

export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonical(payload)).digest("hex");
}

export function isInboxDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 11000) {
    return false;
  }
  if ("keyPattern" in error && typeof error.keyPattern === "object" && error.keyPattern !== null) {
    return "eventId" in error.keyPattern && "consumer" in error.keyPattern;
  }
  return (
    "message" in error &&
    typeof error.message === "string" &&
    error.message.includes("inbox_event_consumer_unique")
  );
}

export function mongoOutbox(database: () => Db): OutboxWriter {
  return {
    async append(event, session) {
      await insertOutbox(database(), event, session);
    },
  };
}

export function mongoInbox(database: () => Db): InboxStore {
  return {
    async claim(claim, session) {
      return claimInbox(database(), claim, session);
    },
  };
}

export function startOutboxLoop(input: {
  current: () =>
    { database: Db; publish: (event: DomainEvent<unknown>) => Promise<void> } | undefined;
  logger: { error(fields: { event: string; message: string }): void };
}): NodeJS.Timeout {
  const timer = setInterval(() => {
    const ready = input.current();
    if (ready === undefined) {
      return;
    }
    void dispatchOutbox({
      database: ready.database,
      now: new Date(),
      publish: ready.publish,
    }).catch((error: unknown) => {
      input.logger.error({
        event: "outbox.dispatch.failed",
        message: error instanceof Error ? error.message : "outbox dispatch failed",
      });
    });
  }, outboxDispatchIntervalMs);
  timer.unref();
  return timer;
}

export async function dispatchOutbox(input: {
  database: Db;
  now: Date;
  publish: (event: DomainEvent<unknown>) => Promise<void>;
  limit?: number;
}): Promise<number> {
  const limit = input.limit ?? outboxBatchSize;
  let published = 0;
  for (let index = 0; index < limit; index += 1) {
    const claimed = await claimPending(input.database, input.now);
    if (claimed === null) {
      break;
    }
    try {
      await input.publish(toDomainEvent(claimed));
      await input.database.collection<OutboxDocument>("outbox_events").updateOne(
        { eventId: claimed.eventId, status: "pending" },
        {
          $set: { status: "published", publishedAt: input.now },
          $unset: { lockUntil: "" },
        },
      );
      published += 1;
    } catch {
      const attempts = claimed.attempts + 1;
      const nextAttemptAt = new Date(input.now.getTime() + outboxRetryDelayMs(attempts));
      await input.database
        .collection<OutboxDocument>("outbox_events")
        .updateOne(
          { eventId: claimed.eventId, status: "pending" },
          { $set: { attempts, nextAttemptAt, lockUntil: nextAttemptAt } },
        );
    }
  }
  return published;
}

async function insertOutbox(
  database: Db,
  event: DomainEvent<unknown>,
  session: object,
): Promise<void> {
  const now = new Date();
  const document: OutboxDocument = {
    id: event.eventId,
    eventId: event.eventId,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    payload: event.payload,
    occurredAt: event.occurredAt,
    producer: event.producer,
    correlationId: event.correlationId,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
  };
  if (event.causationId !== undefined) {
    document.causationId = event.causationId;
  }
  if (event.traceId !== undefined) {
    document.traceId = event.traceId;
  }
  await database
    .collection<OutboxDocument>("outbox_events")
    .insertOne(document, { session: session as ClientSession });
}

async function claimInbox(
  database: Db,
  claim: InboxClaim,
  session: object,
): Promise<"claimed" | "duplicate"> {
  const collection = database.collection("inbox_events");
  const options = { session: session as ClientSession };
  const existing = await collection.findOne(
    { eventId: claim.eventId, consumer: claim.consumer },
    options,
  );
  if (existing !== null) {
    return "duplicate";
  }
  await collection.insertOne(
    {
      id: randomUUID(),
      eventId: claim.eventId,
      consumer: claim.consumer,
      payloadHash: claim.payloadHash,
      processedAt: claim.now,
      createdAt: claim.now,
    },
    options,
  );
  return "claimed";
}

async function claimPending(database: Db, now: Date): Promise<OutboxDocument | null> {
  return database.collection<OutboxDocument>("outbox_events").findOneAndUpdate(
    {
      status: "pending",
      nextAttemptAt: { $lte: now },
      $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lte: now } }],
    },
    { $set: { lockUntil: new Date(now.getTime() + outboxLockMs) } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
}

function toDomainEvent(document: OutboxDocument): DomainEvent<unknown> {
  const event: DomainEvent<unknown> = {
    eventId: document.eventId,
    eventType: document.eventType,
    eventVersion: document.eventVersion,
    occurredAt: document.occurredAt,
    producer: document.producer,
    aggregateType: document.aggregateType,
    aggregateId: document.aggregateId,
    correlationId: document.correlationId,
    payload: document.payload,
  };
  if (document.causationId !== undefined) {
    event.causationId = document.causationId;
  }
  if (document.traceId !== undefined) {
    event.traceId = document.traceId;
  }
  return event;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonical(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
