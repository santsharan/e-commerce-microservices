import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { IdempotencyRecord, IdempotencyRepository } from "../application/ports.js";
import { DuplicateIdempotencyError } from "../domain/order.js";
import { isDuplicateKey, requireMongo, sessionOptions } from "./mongo-support.js";

interface IdempotencyDocument {
  id: string;
  customerId: string;
  key: string;
  requestHash: string;
  orderId: string;
  expiresAt: Date;
  createdAt: Date;
}

export class MongoIdempotencyRepository implements IdempotencyRepository {
  public constructor(private readonly registry: ResourceRegistry) {}

  public async insert(record: IdempotencyRecord, session: object): Promise<void> {
    try {
      await requireMongo(this.registry)
        .database.collection<IdempotencyDocument>("idempotency_keys")
        .insertOne({ ...record }, sessionOptions(session));
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new DuplicateIdempotencyError();
      }
      throw error;
    }
  }

  public async find(customerId: string, key: string): Promise<IdempotencyRecord | null> {
    const document = await requireMongo(this.registry)
      .database.collection<IdempotencyDocument>("idempotency_keys")
      .findOne({ customerId, key });
    if (document === null) {
      return null;
    }
    return {
      id: document.id,
      customerId: document.customerId,
      key: document.key,
      requestHash: document.requestHash,
      orderId: document.orderId,
      expiresAt: document.expiresAt,
      createdAt: document.createdAt,
    };
  }
}
