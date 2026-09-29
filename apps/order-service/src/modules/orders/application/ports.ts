import type { Order } from "../domain/order.js";
import type { SagaState } from "../domain/saga.js";

export interface OrderPage {
  items: Order[];
  page: number;
  limit: number;
  total: number;
}

export interface IdempotencyRecord {
  id: string;
  customerId: string;
  key: string;
  requestHash: string;
  orderId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface OrderRepository {
  insert(order: Order, session: object): Promise<void>;
  findById(id: string, session?: object): Promise<Order | null>;
  listByCustomer(customerId: string, page: number, limit: number): Promise<OrderPage>;
  listRecoverable(limit: number, now: Date): Promise<Order[]>;
  listWaiting(limit: number, now: Date): Promise<Order[]>;
  update(
    order: Order,
    expectedVersion: number,
    session?: object,
  ): Promise<Order | "missing" | "conflict">;
}

export interface IdempotencyRepository {
  insert(record: IdempotencyRecord, session: object): Promise<void>;
  find(customerId: string, key: string): Promise<IdempotencyRecord | null>;
}

export interface TransactionRunner {
  run<T>(work: (session: object) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export interface RetryScheduler {
  schedule(orderId: string, at: Date): void;
}

export const recoverableStates: readonly SagaState[] = [
  "INVENTORY_RESERVATION_PENDING",
  "COMPENSATING_INVENTORY",
];
