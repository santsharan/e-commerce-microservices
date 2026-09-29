import type { InboxStore, OutboxWriter } from "@commerce-flow/outbox";
import type { Payment, PaymentFailureMode } from "../domain/payment.js";

export interface PaymentRepository {
  insert(payment: Payment, session?: object): Promise<void>;
  findById(id: string): Promise<Payment | null>;
  findByOrderId(orderId: string): Promise<Payment | null>;
  update(
    payment: Payment,
    expectedVersion: number,
    session?: object,
  ): Promise<Payment | "missing" | "conflict">;
}

export interface TransactionRunner {
  run<T>(work: (session: object) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export interface PaymentDependencies {
  payments: PaymentRepository;
  outbox: OutboxWriter;
  inbox: InboxStore;
  transactions: TransactionRunner;
  clock: Clock;
  failureMode: PaymentFailureMode;
}
