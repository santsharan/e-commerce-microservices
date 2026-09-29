import { AppError, ErrorCode } from "@commerce-flow/errors";
import type { DomainEvent } from "@commerce-flow/events";
import { z } from "zod";

const money = z.object({
  paymentId: z.string().trim().min(1).max(80),
  orderId: z.string().trim().min(1).max(80),
  amount: z.number().int().nonnegative(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
});

const failed = money.extend({
  reason: z.string().trim().min(1).max(80),
});

export interface PaymentFact {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  reason?: string;
}

export function readPaymentAuthorized(event: DomainEvent<unknown>): PaymentFact {
  return read(money, event);
}

export function readPaymentFailed(event: DomainEvent<unknown>): PaymentFact {
  return read(failed, event);
}

export function readPaymentRefunded(event: DomainEvent<unknown>): PaymentFact {
  return read(money, event);
}

function read(
  schema: z.ZodType<{
    paymentId: string;
    orderId: string;
    amount: number;
    currency: string;
    reason?: string;
  }>,
  event: DomainEvent<unknown>,
): PaymentFact {
  const parsed = schema.safeParse(event.payload);
  if (!parsed.success || parsed.data.orderId !== event.aggregateId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid payment fact", 400, {});
  }
  return parsed.data;
}
