import { AppError, ErrorCode } from "@commerce-flow/errors";
import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { StockRepository } from "../application/ports.js";
import { onHandMax, type StockRecord } from "../domain/stock.js";
import { isDuplicateKey, requireMongo, sessionOptions } from "./mongo-support.js";

interface StockDocument {
  id: string;
  sku: string;
  available: number;
  reserved: number;
  status: StockRecord["status"];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class MongoStockRepository implements StockRepository {
  public constructor(private readonly registry: ResourceRegistry) {}

  public async insert(record: StockRecord): Promise<void> {
    try {
      await requireMongo(this.registry)
        .database.collection<StockDocument>("inventory")
        .insertOne({
          ...record,
        });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new AppError(
          ErrorCode.CONFLICT,
          "An inventory record for this SKU already exists",
          409,
          {},
        );
      }
      throw error;
    }
  }

  public async findBySku(sku: string, session?: object): Promise<StockRecord | null> {
    const document = await requireMongo(this.registry)
      .database.collection<StockDocument>("inventory")
      .findOne({ sku }, sessionOptions(session));
    return document === null ? null : toStock(document);
  }

  public async reserve(
    sku: string,
    quantity: number,
    now: Date,
    session: object,
  ): Promise<StockRecord | "unavailable"> {
    const document = await requireMongo(this.registry)
      .database.collection<StockDocument>("inventory")
      .findOneAndUpdate(
        { sku, status: "active", available: { $gte: quantity } },
        {
          $inc: { available: -quantity, reserved: quantity, version: 1 },
          $set: { updatedAt: now },
        },
        { returnDocument: "after", ...sessionOptions(session) },
      );
    return document === null ? "unavailable" : toStock(document);
  }

  public async restore(
    sku: string,
    quantity: number,
    now: Date,
    session: object,
  ): Promise<StockRecord | "inconsistent"> {
    const document = await requireMongo(this.registry)
      .database.collection<StockDocument>("inventory")
      .findOneAndUpdate(
        { sku, reserved: { $gte: quantity } },
        {
          $inc: { available: quantity, reserved: -quantity, version: 1 },
          $set: { updatedAt: now },
        },
        { returnDocument: "after", ...sessionOptions(session) },
      );
    return document === null ? "inconsistent" : toStock(document);
  }

  public async commit(
    sku: string,
    quantity: number,
    now: Date,
    session: object,
  ): Promise<StockRecord | "inconsistent"> {
    const document = await requireMongo(this.registry)
      .database.collection<StockDocument>("inventory")
      .findOneAndUpdate(
        { sku, reserved: { $gte: quantity } },
        {
          $inc: { reserved: -quantity, version: 1 },
          $set: { updatedAt: now },
        },
        { returnDocument: "after", ...sessionOptions(session) },
      );
    return document === null ? "inconsistent" : toStock(document);
  }

  public async adjust(
    sku: string,
    delta: number,
    now: Date,
  ): Promise<StockRecord | "missing" | "insufficient" | "overflow"> {
    const filter =
      delta > 0
        ? { sku, available: { $lte: onHandMax - delta } }
        : { sku, available: { $gte: -delta } };
    const document = await requireMongo(this.registry)
      .database.collection<StockDocument>("inventory")
      .findOneAndUpdate(
        filter,
        { $inc: { available: delta, version: 1 }, $set: { updatedAt: now } },
        { returnDocument: "after" },
      );
    if (document !== null) {
      return toStock(document);
    }
    const existing = await this.findBySku(sku);
    if (existing === null) {
      return "missing";
    }
    return delta > 0 ? "overflow" : "insufficient";
  }
}

function toStock(document: StockDocument): StockRecord {
  return {
    id: document.id,
    sku: document.sku,
    available: document.available,
    reserved: document.reserved,
    status: document.status,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
