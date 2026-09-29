import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { PaymentRepository } from "../application/ports.js";
import { DuplicatePaymentError, type Payment, type PaymentStatus } from "../domain/payment.js";
import { isDuplicateKey, requireMongo } from "./mongo-support.js";

interface PaymentDocument {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  failureReason?: "declined";
  correlationId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class MongoPaymentRepository implements PaymentRepository {
  public constructor(private readonly registry: ResourceRegistry) {}

  public async insert(payment: Payment, session?: object): Promise<void> {
    try {
      await requireMongo(this.registry)
        .database.collection<PaymentDocument>("payments")
        .insertOne(toDocument(payment), session === undefined ? {} : { session: session as never });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new DuplicatePaymentError();
      }
      throw error;
    }
  }

  public async findById(id: string): Promise<Payment | null> {
    const document = await requireMongo(this.registry)
      .database.collection<PaymentDocument>("payments")
      .findOne({ id });
    return document === null ? null : toPayment(document);
  }

  public async findByOrderId(orderId: string): Promise<Payment | null> {
    const document = await requireMongo(this.registry)
      .database.collection<PaymentDocument>("payments")
      .findOne({ orderId });
    return document === null ? null : toPayment(document);
  }

  public async update(
    payment: Payment,
    expectedVersion: number,
    session?: object,
  ): Promise<Payment | "missing" | "conflict"> {
    const next = toDocument({ ...payment, version: expectedVersion + 1 });
    const document = await requireMongo(this.registry)
      .database.collection<PaymentDocument>("payments")
      .findOneAndUpdate(
        { id: payment.id, version: expectedVersion },
        { $set: next },
        {
          returnDocument: "after",
          ...(session === undefined ? {} : { session: session as never }),
        },
      );
    if (document !== null) {
      return toPayment(document);
    }
    const existing = await this.findById(payment.id);
    return existing === null ? "missing" : "conflict";
  }
}

function toDocument(payment: Payment): PaymentDocument {
  const document: PaymentDocument = {
    id: payment.id,
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    correlationId: payment.correlationId,
    version: payment.version,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
  if (payment.failureReason !== undefined) {
    document.failureReason = payment.failureReason;
  }
  return document;
}

function toPayment(document: PaymentDocument): Payment {
  const payment: Payment = {
    id: document.id,
    orderId: document.orderId,
    amount: document.amount,
    currency: document.currency,
    status: document.status,
    correlationId: document.correlationId,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
  if (document.failureReason !== undefined) {
    payment.failureReason = document.failureReason;
  }
  return payment;
}
