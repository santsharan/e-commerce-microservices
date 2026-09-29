import { createHash, randomBytes } from "node:crypto";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import type { PricedItem, Pricing } from "./pricing.js";
import { SagaState, type SagaState as SagaStateName } from "./saga.js";

export const OrderStatus = {
  pending: "pending",
  cancelling: "cancelling",
  confirmed: "confirmed",
  cancelled: "cancelled",
  failed: "failed",
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const LineReservation = {
  pending: "pending",
  reserved: "reserved",
  released: "released",
  failed: "failed",
} as const;

export type LineReservation = (typeof LineReservation)[keyof typeof LineReservation];

export const InventoryHold = {
  pending: "pending",
  reserved: "reserved",
  releasing: "releasing",
  released: "released",
  failed: "failed",
} as const;

export type InventoryHold = (typeof InventoryHold)[keyof typeof InventoryHold];

export const idempotencyTtlSeconds = 86_400;
export const orderRecoveryIntervalMs = 30_000;
export const pageLimitDefault = 20;
export const pageLimitMax = 100;

const skuPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

export interface OrderItem extends PricedItem {
  reservationId?: string;
  reservationStatus: LineReservation;
  releaseQueued?: boolean;
}

export interface SagaRecord {
  sagaId: string;
  state: SagaStateName;
  currentStep: string;
  retryCount: number;
  localAttempts: number;
  topicAttempts: number;
  dlqPublished: boolean;
  retryHalted: boolean;
  nextAttemptAt?: Date;
  lastError?: string;
  closure?: "cancel" | "failure";
  createdPublished: boolean;
  cancelledPublished: boolean;
  paymentRequested: boolean;
  confirmedPublished: boolean;
  refundRequested: boolean;
  inventoryCommitted: boolean;
}

export const OrderPaymentStatus = {
  pending: "pending",
  authorized: "authorized",
  failed: "failed",
  refunded: "refunded",
} as const;

export type OrderPaymentStatus = (typeof OrderPaymentStatus)[keyof typeof OrderPaymentStatus];

export interface OrderPayment {
  status: OrderPaymentStatus;
  paymentId?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  currency: string;
  correlationId: string;
  items: OrderItem[];
  pricing: Pricing;
  payment: OrderPayment;
  inventory: { status: InventoryHold; reservationIds: string[] };
  saga: SagaRecord;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function isSku(value: string): boolean {
  return skuPattern.test(value);
}

export function etagFor(version: number): string {
  return `"${version}"`;
}

export function orderNumber(): string {
  return `CF${randomBytes(8).toString("hex").toUpperCase()}`;
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function inventoryStatus(items: readonly OrderItem[], saga: SagaStateName): InventoryHold {
  if (saga === SagaState.compensatingInventory) {
    return InventoryHold.releasing;
  }
  if (items.every((item) => item.reservationStatus === LineReservation.reserved)) {
    return InventoryHold.reserved;
  }
  if (
    items.every(
      (item) =>
        item.reservationStatus === LineReservation.released ||
        item.reservationStatus === LineReservation.failed,
    ) &&
    items.some((item) => item.reservationStatus === LineReservation.released)
  ) {
    return InventoryHold.released;
  }
  if (items.every((item) => item.reservationStatus === LineReservation.failed)) {
    return InventoryHold.failed;
  }
  return InventoryHold.pending;
}

export function reservationIds(items: readonly OrderItem[]): string[] {
  return items.flatMap((item) => (item.reservationId === undefined ? [] : [item.reservationId]));
}

export function statusForSaga(saga: SagaStateName, closure: SagaRecord["closure"]): OrderStatus {
  if (saga === SagaState.completed) {
    return OrderStatus.confirmed;
  }
  if (saga === SagaState.failed) {
    return OrderStatus.failed;
  }
  if (saga === SagaState.compensationCompleted) {
    return closure === "cancel" ? OrderStatus.cancelled : OrderStatus.failed;
  }
  if (saga === SagaState.compensatingInventory) {
    return OrderStatus.cancelling;
  }
  return OrderStatus.pending;
}

export function requireCustomerId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["customerId"],
    });
  }
  return trimmed;
}

export function requireCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["currency"],
    });
  }
  return currency;
}

export class DuplicateIdempotencyError extends Error {
  public constructor() {
    super("duplicate idempotency key");
    this.name = "DuplicateIdempotencyError";
  }
}

export class DuplicateOrderNumberError extends Error {
  public constructor() {
    super("duplicate order number");
    this.name = "DuplicateOrderNumberError";
  }
}
