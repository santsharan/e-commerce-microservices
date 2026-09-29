import type { Reservation, StockRecord } from "../domain/stock.js";

export interface StockRepository {
  insert(record: StockRecord): Promise<void>;
  findBySku(sku: string, session?: object): Promise<StockRecord | null>;
  reserve(
    sku: string,
    quantity: number,
    now: Date,
    session: object,
  ): Promise<StockRecord | "unavailable">;
  restore(
    sku: string,
    quantity: number,
    now: Date,
    session: object,
  ): Promise<StockRecord | "inconsistent">;
  commit(
    sku: string,
    quantity: number,
    now: Date,
    session: object,
  ): Promise<StockRecord | "inconsistent">;
  adjust(
    sku: string,
    delta: number,
    now: Date,
  ): Promise<StockRecord | "missing" | "insufficient" | "overflow">;
}

export interface ReservationRepository {
  insert(reservation: Reservation, session: object): Promise<void>;
  findById(id: string, session?: object): Promise<Reservation | null>;
  findByOrderSku(orderId: string, sku: string, session?: object): Promise<Reservation | null>;
  close(
    id: string,
    status: "released" | "expired" | "committed",
    now: Date,
    session: object,
  ): Promise<Reservation | "missing" | "closed">;
  listDue(now: Date, limit: number): Promise<Reservation[]>;
}

export interface TransactionRunner {
  run<T>(work: (session: object) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}
