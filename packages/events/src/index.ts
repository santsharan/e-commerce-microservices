import { z } from "zod";

/**
 * Version 1 envelope. A version 2 payload is introduced only when a real
 * field change needs a backward-compatible consumer.
 */
export interface DomainEvent<TPayload> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  traceId?: string;
  payload: TPayload;
}

const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export const domainEventSchema = z.object({
  eventId: z.string().trim().min(1),
  eventType: z.string().trim().min(1),
  eventVersion: z.number().int().positive(),
  occurredAt: z.string().regex(isoUtc),
  producer: z.string().trim().min(1),
  aggregateType: z.string().trim().min(1),
  aggregateId: z.string().trim().min(1),
  correlationId: z.string().trim().min(1),
  causationId: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
  payload: z.unknown(),
});

export function parseDomainEvent(input: unknown): DomainEvent<unknown> {
  const parsed = domainEventSchema.parse(input);
  const event: DomainEvent<unknown> = {
    eventId: parsed.eventId,
    eventType: parsed.eventType,
    eventVersion: parsed.eventVersion,
    occurredAt: parsed.occurredAt,
    producer: parsed.producer,
    aggregateType: parsed.aggregateType,
    aggregateId: parsed.aggregateId,
    correlationId: parsed.correlationId,
    payload: parsed.payload,
  };
  if (parsed.causationId !== undefined) {
    event.causationId = parsed.causationId;
  }
  if (parsed.traceId !== undefined) {
    event.traceId = parsed.traceId;
  }
  return event;
}

export const Topics = {
  orders: "commerce.orders.v1",
  inventory: "commerce.inventory.v1",
  payments: "commerce.payments.v1",
  inventoryCommands: "commerce.inventory.commands.v1",
  paymentCommands: "commerce.payment.commands.v1",
  notificationCommands: "commerce.notification.commands.v1",
  ordersRetry1m: "commerce.orders.retry.1m",
  ordersRetry5m: "commerce.orders.retry.5m",
  ordersRetry30m: "commerce.orders.retry.30m",
  ordersDlq: "commerce.orders.dlq",
} as const;

export type Topic = (typeof Topics)[keyof typeof Topics];

export const EventType = {
  orderCreated: "order.created",
  orderConfirmed: "order.confirmed",
  orderCancelled: "order.cancelled",
  inventoryReserveRequested: "inventory.reserve.requested",
  inventoryReserved: "inventory.reserved",
  inventoryReservationFailed: "inventory.reservation.failed",
  inventoryReleaseRequested: "inventory.release.requested",
  inventoryCommitRequested: "inventory.commit.requested",
  inventoryReleased: "inventory.released",
  paymentAuthorizationRequested: "payment.authorization.requested",
  paymentAuthorized: "payment.authorized",
  paymentAuthorizationFailed: "payment.authorization.failed",
  paymentRefundRequested: "payment.refund.requested",
  paymentRefunded: "payment.refunded",
  sagaRetry1m: "saga.retry.1m",
  sagaRetry5m: "saga.retry.5m",
  sagaRetry30m: "saga.retry.30m",
  sagaDeadLettered: "saga.dead-lettered",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

const eventTopics: Record<EventType, Topic> = {
  [EventType.orderCreated]: Topics.orders,
  [EventType.orderConfirmed]: Topics.orders,
  [EventType.orderCancelled]: Topics.orders,
  [EventType.inventoryReserveRequested]: Topics.inventoryCommands,
  [EventType.inventoryReserved]: Topics.inventory,
  [EventType.inventoryReservationFailed]: Topics.inventory,
  [EventType.inventoryReleaseRequested]: Topics.inventoryCommands,
  [EventType.inventoryCommitRequested]: Topics.inventoryCommands,
  [EventType.inventoryReleased]: Topics.inventory,
  [EventType.paymentAuthorizationRequested]: Topics.paymentCommands,
  [EventType.paymentAuthorized]: Topics.payments,
  [EventType.paymentAuthorizationFailed]: Topics.payments,
  [EventType.paymentRefundRequested]: Topics.paymentCommands,
  [EventType.paymentRefunded]: Topics.payments,
  [EventType.sagaRetry1m]: Topics.ordersRetry1m,
  [EventType.sagaRetry5m]: Topics.ordersRetry5m,
  [EventType.sagaRetry30m]: Topics.ordersRetry30m,
  [EventType.sagaDeadLettered]: Topics.ordersDlq,
};

export function topicForEvent(eventType: EventType): Topic {
  return eventTopics[eventType];
}
