import { randomUUID } from "node:crypto";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { EventType, type DomainEvent } from "@commerce-flow/events";
import { activeTraceId, recordPaymentAuthorization } from "@commerce-flow/observability";
import { ConsumerName, isInboxDuplicate, payloadHash } from "@commerce-flow/outbox";
import type { PaymentDependencies } from "./ports.js";
import {
  DuplicatePaymentError,
  PaymentStatus,
  amountMax,
  authorizationDecision,
  type Payment,
  type PaymentFailureMode,
} from "../domain/payment.js";

export interface AuthorizeInput {
  orderId: string;
  amount: number;
  currency: string;
  simulate?: PaymentFailureMode;
  correlationId: string;
}

export interface AuthorizeResult {
  payment: Payment;
  replayed: boolean;
}

export interface RefundInput {
  paymentId: string;
  orderId?: string;
  amount?: number;
  currency?: string;
}

export class PaymentApplication {
  public constructor(private readonly deps: PaymentDependencies) {}

  public setFailureMode(mode: PaymentFailureMode): void {
    this.deps.failureMode = mode;
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
            consumer: ConsumerName.payment,
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

  public async authorize(input: AuthorizeInput, session?: object): Promise<AuthorizeResult> {
    if (session !== undefined) {
      return this.authorizeIn(input, session);
    }
    try {
      return await this.deps.transactions.run((current) => this.authorizeIn(input, current));
    } catch (error) {
      if (!(error instanceof DuplicatePaymentError)) {
        throw error;
      }
      return this.deps.transactions.run((current) => this.replayDuplicate(input, current));
    }
  }

  public async get(id: string): Promise<Payment> {
    const payment = await this.deps.payments.findById(id.trim());
    if (payment === null) {
      throw notFound();
    }
    return payment;
  }

  public async refund(input: RefundInput, session?: object): Promise<Payment> {
    const run = (current: object): Promise<Payment> => this.refundIn(input, current);
    if (session !== undefined) {
      return run(session);
    }
    return this.deps.transactions.run(run);
  }

  private async authorizeIn(input: AuthorizeInput, session: object): Promise<AuthorizeResult> {
    const orderId = requireOrderId(input.orderId);
    const currency = requireCurrency(input.currency);
    const amount = requireAmount(input.amount);
    const correlationId = requireCorrelation(input.correlationId);
    const existing = await this.deps.payments.findByOrderId(orderId);
    if (existing !== null) {
      if (existing.amount !== amount || existing.currency !== currency) {
        throw conflict("The payment does not match the order");
      }
      await this.publishResult(existing, session);
      return { payment: existing, replayed: true };
    }
    const decision = authorizationDecision(this.deps.failureMode, input.simulate);
    const now = this.deps.clock.now();
    const payment: Payment = {
      id: randomUUID(),
      orderId,
      amount,
      currency,
      status: decision === "declined" ? PaymentStatus.failed : PaymentStatus.authorized,
      correlationId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...(decision === "declined" ? { failureReason: "declined" as const } : {}),
    };
    await this.deps.payments.insert(payment, session);
    await this.publishResult(payment, session);
    recordPaymentAuthorization(payment.status === PaymentStatus.failed ? "failure" : "success");
    return { payment, replayed: false };
  }

  private async replayDuplicate(input: AuthorizeInput, session: object): Promise<AuthorizeResult> {
    const existing = await this.deps.payments.findByOrderId(requireOrderId(input.orderId));
    if (existing === null) {
      throw conflict("The payment could not be recorded");
    }
    if (
      existing.amount !== requireAmount(input.amount) ||
      existing.currency !== requireCurrency(input.currency)
    ) {
      throw conflict("The payment does not match the order");
    }
    await this.publishResult(existing, session);
    return { payment: existing, replayed: true };
  }

  private async refundIn(input: RefundInput, session: object): Promise<Payment> {
    const payment = await this.deps.payments.findById(input.paymentId.trim());
    if (payment === null) {
      throw notFound();
    }
    if (input.orderId !== undefined && input.orderId !== payment.orderId) {
      throw conflict("The refund does not match the payment");
    }
    if (input.amount !== undefined && input.amount !== payment.amount) {
      throw conflict("The refund does not match the payment");
    }
    if (input.currency !== undefined && input.currency.toUpperCase() !== payment.currency) {
      throw conflict("The refund does not match the payment");
    }
    if (payment.status === PaymentStatus.refunded) {
      await this.publishRefunded(payment, session);
      return payment;
    }
    if (payment.status !== PaymentStatus.authorized) {
      throw conflict("The payment cannot be refunded");
    }
    const saved = await this.write(
      { ...payment, status: PaymentStatus.refunded, updatedAt: this.deps.clock.now() },
      session,
    );
    await this.publishRefunded(saved, session);
    return saved;
  }

  private async publishResult(payment: Payment, session: object): Promise<void> {
    if (payment.status === PaymentStatus.refunded) {
      await this.publishRefunded(payment, session);
      return;
    }
    if (payment.status === PaymentStatus.authorized) {
      await this.deps.outbox.append(
        paymentEvent(payment, EventType.paymentAuthorized, resultPayload(payment)),
        session,
      );
      return;
    }
    if (payment.status === PaymentStatus.failed) {
      await this.deps.outbox.append(
        paymentEvent(payment, EventType.paymentAuthorizationFailed, {
          ...resultPayload(payment),
          reason: "declined",
        }),
        session,
      );
    }
  }

  private async publishRefunded(payment: Payment, session: object): Promise<void> {
    await this.deps.outbox.append(
      paymentEvent(payment, EventType.paymentRefunded, resultPayload(payment)),
      session,
    );
  }

  private async write(payment: Payment, session: object): Promise<Payment> {
    const saved = await this.deps.payments.update(payment, payment.version, session);
    if (saved === "missing") {
      throw notFound();
    }
    if (saved === "conflict") {
      throw conflict("The payment was updated by someone else");
    }
    return saved;
  }
}

function resultPayload(payment: Payment): {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
} {
  return {
    paymentId: payment.id,
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
  };
}

function paymentEvent(
  payment: Payment,
  eventType: EventType,
  payload: unknown,
): DomainEvent<unknown> {
  const event: DomainEvent<unknown> = {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    occurredAt: payment.updatedAt.toISOString(),
    producer: "payment-service",
    aggregateType: "payment",
    aggregateId: payment.orderId,
    correlationId: payment.correlationId,
    payload,
  };
  const traceId = activeTraceId();
  if (traceId !== undefined) {
    event.traceId = traceId;
  }
  return event;
}

function requireOrderId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["orderId"] });
  }
  return trimmed;
}

function requireCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["currency"],
    });
  }
  return currency;
}

function requireAmount(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > amountMax) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["amount"] });
  }
  return value;
}

function requireCorrelation(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["correlationId"],
    });
  }
  return trimmed;
}

function notFound(): AppError {
  return new AppError(ErrorCode.NOT_FOUND, "Payment was not found", 404, {});
}

function conflict(message: string): AppError {
  return new AppError(ErrorCode.CONFLICT, message, 409, {});
}
