import { randomUUID } from "node:crypto";
import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { AuditEntry, AuditLog } from "../application/ports.js";
import { requireMongo } from "./mongo-support.js";

interface AuditDocument {
  id: string;
  action: string;
  actorId?: string;
  requestId: string;
  createdAt: Date;
  metadata: Record<string, string>;
}

export class MongoAuditLog implements AuditLog {
  public constructor(private readonly registry: ResourceRegistry) {}

  public async record(entry: AuditEntry): Promise<void> {
    const document: AuditDocument = {
      id: randomUUID(),
      action: entry.action,
      requestId: entry.requestId,
      createdAt: entry.createdAt,
      metadata: entry.metadata,
    };
    if (entry.actorId !== undefined) {
      document.actorId = entry.actorId;
    }
    await requireMongo(this.registry)
      .database.collection<AuditDocument>("audit_logs")
      .insertOne(document);
  }
}
