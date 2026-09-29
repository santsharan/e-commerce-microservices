import { AppError, ErrorCode } from "@commerce-flow/errors";
import type { DomainEvent } from "@commerce-flow/events";
import { z } from "zod";
import {
  isSku,
  onHandMax,
  reserveQuantityMax,
  type ReleaseReason,
  type ReservationFailure,
} from "./stock.js";

const orderId = z.string().trim().min(1).max(80);
const sku = z.string().trim().refine(isSku);
const reserveQuantity = z.number().int().min(1).max(reserveQuantityMax);

const reservePayload = z.object({
  orderId,
  sku,
  quantity: reserveQuantity,
});

const releasePayload = z.object({
  reservationId: z.string().trim().min(1).max(80),
  orderId,
  sku,
});

export interface ReserveCommand {
  orderId: string;
  sku: string;
  quantity: number;
  correlationId: string;
  causationId: string;
}

export interface ReleaseCommand {
  reservationId: string;
  orderId: string;
  sku: string;
  correlationId: string;
  causationId: string;
}

export interface ReservedPayload {
  reservationId: string;
  orderId: string;
  sku: string;
  quantity: number;
  expiresAt: string;
}

export interface ReservationFailedPayload {
  orderId: string;
  sku: string;
  quantity: number;
  reason: ReservationFailure;
}

export interface ReleasedPayload {
  reservationId: string;
  orderId: string;
  sku: string;
  quantity: number;
  reason: ReleaseReason;
}

export function readReserveCommand(event: DomainEvent<unknown>): ReserveCommand {
  const payload = parsePayload(reservePayload, event.payload);
  if (payload.orderId !== event.aggregateId) {
    throw invalid(["aggregateId"]);
  }
  return {
    orderId: payload.orderId,
    sku: payload.sku,
    quantity: payload.quantity,
    correlationId: event.correlationId,
    causationId: event.eventId,
  };
}

export function readReleaseCommand(event: DomainEvent<unknown>): ReleaseCommand {
  const payload = parsePayload(releasePayload, event.payload);
  if (payload.orderId !== event.aggregateId) {
    throw invalid(["aggregateId"]);
  }
  return {
    reservationId: payload.reservationId,
    orderId: payload.orderId,
    sku: payload.sku,
    correlationId: event.correlationId,
    causationId: event.eventId,
  };
}

function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw invalid(fieldNames(parsed.error));
  }
  return parsed.data;
}

function fieldNames(error: z.ZodError): string[] {
  return [
    ...new Set(
      error.issues.map((issue) => {
        const field = issue.path[0];
        return typeof field === "string" ? field : "payload";
      }),
    ),
  ];
}

function invalid(fields: string[]): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, "Invalid inventory command", 400, { fields });
}

export function onHandQuantity(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > onHandMax) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["quantity"],
    });
  }
  return value;
}
