import { AppError, ErrorCode } from "@commerce-flow/errors";
import type { DomainEvent } from "@commerce-flow/events";
import { z } from "zod";
import { PaymentFailureMode, amountMax } from "./payment.js";

const orderId = z.string().trim().min(1).max(80);
const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());
const amount = z.number().int().nonnegative().max(amountMax);
const simulate = z.enum([PaymentFailureMode.authorize, PaymentFailureMode.decline]).optional();

const authorizationPayload = z.strictObject({
  orderId,
  amount,
  currency,
  simulate,
});

const refundPayload = z.strictObject({
  paymentId: z.string().trim().min(1).max(80),
  orderId,
  amount,
  currency,
});

export interface AuthorizationCommand {
  orderId: string;
  amount: number;
  currency: string;
  simulate?: PaymentFailureMode;
  correlationId: string;
  causationId: string;
}

export interface RefundCommand {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  correlationId: string;
  causationId: string;
}

export function readAuthorizationCommand(event: DomainEvent<unknown>): AuthorizationCommand {
  const payload = parse(authorizationPayload, event.payload);
  if (payload.orderId !== event.aggregateId) {
    throw invalid();
  }
  return {
    orderId: payload.orderId,
    amount: payload.amount,
    currency: payload.currency,
    correlationId: event.correlationId,
    causationId: event.eventId,
    ...(payload.simulate === undefined ? {} : { simulate: payload.simulate }),
  };
}

export function readRefundCommand(event: DomainEvent<unknown>): RefundCommand {
  const payload = parse(refundPayload, event.payload);
  if (payload.orderId !== event.aggregateId) {
    throw invalid();
  }
  return {
    paymentId: payload.paymentId,
    orderId: payload.orderId,
    amount: payload.amount,
    currency: payload.currency,
    correlationId: event.correlationId,
    causationId: event.eventId,
  };
}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw invalid();
  }
  return parsed.data;
}

function invalid(): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, "Invalid payment command", 400, {});
}
