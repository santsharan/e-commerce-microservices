import { AppError, ErrorCode } from "@commerce-flow/errors";
import type { DomainEvent } from "@commerce-flow/events";
import { z } from "zod";
import { isSku } from "./order.js";

const reservedPayload = z.object({
  reservationId: z.string().trim().min(1).max(80),
  orderId: z.string().trim().min(1).max(80),
  sku: z.string().trim().refine(isSku),
  quantity: z.number().int().positive(),
  expiresAt: z.string().trim().min(1),
});

const failedPayload = z.object({
  orderId: z.string().trim().min(1).max(80),
  sku: z.string().trim().refine(isSku),
  quantity: z.number().int().positive(),
  reason: z.string().trim().min(1).max(80),
});

const releasedPayload = z.object({
  reservationId: z.string().trim().min(1).max(80),
  orderId: z.string().trim().min(1).max(80),
  sku: z.string().trim().refine(isSku),
  quantity: z.number().int().positive(),
  reason: z.enum(["released", "expired"]),
});

export interface ReservedFact {
  reservationId: string;
  orderId: string;
  sku: string;
  quantity: number;
  expiresAt: string;
  correlationId: string;
  causationId: string;
}

export interface FailedFact {
  orderId: string;
  sku: string;
  quantity: number;
  reason: string;
  correlationId: string;
  causationId: string;
}

export interface ReleasedFact {
  reservationId: string;
  orderId: string;
  sku: string;
  quantity: number;
  reason: "released" | "expired";
  correlationId: string;
  causationId: string;
}

export function readReservedFact(event: DomainEvent<unknown>): ReservedFact {
  return {
    ...read(reservedPayload, event),
    correlationId: event.correlationId,
    causationId: event.eventId,
  };
}

export function readFailedFact(event: DomainEvent<unknown>): FailedFact {
  return {
    ...read(failedPayload, event),
    correlationId: event.correlationId,
    causationId: event.eventId,
  };
}

export function readReleasedFact(event: DomainEvent<unknown>): ReleasedFact {
  return {
    ...read(releasedPayload, event),
    correlationId: event.correlationId,
    causationId: event.eventId,
  };
}

function read<T extends { orderId: string }>(schema: z.ZodType<T>, event: DomainEvent<unknown>): T {
  const parsed = schema.safeParse(event.payload);
  if (!parsed.success || parsed.data.orderId !== event.aggregateId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid inventory fact", 400, {});
  }
  return parsed.data;
}
