import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { RefreshTokenRepository } from "../application/ports.js";
import type { RefreshTokenRecord } from "../domain/refresh-token.js";
import { requireMongo } from "./mongo-support.js";

interface RefreshTokenDocument {
  tokenId: string;
  secretHash: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
  createdAt: Date;
}

export class MongoRefreshTokenRepository implements RefreshTokenRepository {
  public constructor(private readonly registry: ResourceRegistry) {}

  public async insert(record: RefreshTokenRecord): Promise<void> {
    await requireMongo(this.registry)
      .database.collection<RefreshTokenDocument>("refresh_tokens")
      .insertOne(toDocument(record));
  }

  public async findByTokenId(tokenId: string): Promise<RefreshTokenRecord | null> {
    const document = await requireMongo(this.registry)
      .database.collection<RefreshTokenDocument>("refresh_tokens")
      .findOne({ tokenId });
    return document === null ? null : toRecord(document);
  }

  public async rotate(
    currentTokenId: string,
    replacement: RefreshTokenRecord,
    now: Date,
  ): Promise<"rotated" | "rejected"> {
    const mongo = requireMongo(this.registry);
    const collection = mongo.database.collection<RefreshTokenDocument>("refresh_tokens");
    return mongo.withTransaction(async (session) => {
      const updated = await collection.updateOne(
        { tokenId: currentTokenId, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now, replacedByTokenId: replacement.tokenId } },
        { session },
      );
      if (updated.modifiedCount !== 1) {
        return "rejected";
      }
      await collection.insertOne(toDocument(replacement), { session });
      return "rotated";
    });
  }

  public async revoke(tokenId: string, now: Date): Promise<"revoked" | "already" | "missing"> {
    const collection = requireMongo(this.registry).database.collection<RefreshTokenDocument>(
      "refresh_tokens",
    );
    const updated = await collection.updateOne(
      { tokenId, revokedAt: null },
      { $set: { revokedAt: now } },
    );
    if (updated.modifiedCount === 1) {
      return "revoked";
    }
    const existing = await collection.findOne({ tokenId });
    return existing === null ? "missing" : "already";
  }

  public async revokeFamily(familyId: string, now: Date): Promise<void> {
    await requireMongo(this.registry)
      .database.collection<RefreshTokenDocument>("refresh_tokens")
      .updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: now } });
  }
}

function toDocument(record: RefreshTokenRecord): RefreshTokenDocument {
  return {
    tokenId: record.tokenId,
    secretHash: record.secretHash,
    userId: record.userId,
    familyId: record.familyId,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    replacedByTokenId: record.replacedByTokenId,
    createdAt: record.createdAt,
  };
}

function toRecord(document: RefreshTokenDocument): RefreshTokenRecord {
  return {
    tokenId: document.tokenId,
    secretHash: document.secretHash,
    userId: document.userId,
    familyId: document.familyId,
    expiresAt: document.expiresAt,
    revokedAt: document.revokedAt,
    replacedByTokenId: document.replacedByTokenId,
    createdAt: document.createdAt,
  };
}
