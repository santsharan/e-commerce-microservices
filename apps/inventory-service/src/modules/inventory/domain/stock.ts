export const StockStatus = {
  active: "active",
  inactive: "inactive",
} as const;

export type StockStatus = (typeof StockStatus)[keyof typeof StockStatus];

export const ReservationStatus = {
  active: "active",
  committed: "committed",
  released: "released",
  expired: "expired",
} as const;

export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

export const ReservationFailure = {
  insufficient: "insufficient_stock",
  unknownSku: "unknown_sku",
  inactive: "inactive",
  conflict: "conflict",
} as const;

export type ReservationFailure = (typeof ReservationFailure)[keyof typeof ReservationFailure];

export const ReleaseReason = {
  released: "released",
  expired: "expired",
} as const;

export type ReleaseReason = (typeof ReleaseReason)[keyof typeof ReleaseReason];

/** Checkout holds last 15 minutes. A sweep returns the quantity when they lapse. */
export const reservationTtlSeconds = 900;

export const expireBatchSize = 50;
export const expirationIntervalMs = 30_000;

export const reserveQuantityMax = 100_000;
export const onHandMax = 1_000_000_000;

const skuPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

export interface StockRecord {
  id: string;
  sku: string;
  available: number;
  reserved: number;
  status: StockStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Reservation {
  id: string;
  orderId: string;
  sku: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function isSku(value: string): boolean {
  return skuPattern.test(value);
}

export class DuplicateReservationError extends Error {
  public constructor() {
    super("duplicate reservation");
    this.name = "DuplicateReservationError";
  }
}
