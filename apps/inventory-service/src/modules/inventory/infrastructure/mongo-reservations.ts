import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { ReservationRepository } from "../application/ports.js";
import { DuplicateReservationError, type Reservation } from "../domain/stock.js";
import { isDuplicateKey, requireMongo, sessionOptions } from "./mongo-support.js";

interface ReservationDocument {
  id: string;
  orderId: string;
  sku: string;
  quantity: number;
  status: Reservation["status"];
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class MongoReservationRepository implements ReservationRepository {
  public constructor(private readonly registry: ResourceRegistry) {}

  public async insert(reservation: Reservation, session: object): Promise<void> {
    try {
      await requireMongo(this.registry)
        .database.collection<ReservationDocument>("reservations")
        .insertOne({ ...reservation }, sessionOptions(session));
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new DuplicateReservationError();
      }
      throw error;
    }
  }

  public async findById(id: string, session?: object): Promise<Reservation | null> {
    const document = await requireMongo(this.registry)
      .database.collection<ReservationDocument>("reservations")
      .findOne({ id }, sessionOptions(session));
    return document === null ? null : toReservation(document);
  }

  public async findByOrderSku(
    orderId: string,
    sku: string,
    session?: object,
  ): Promise<Reservation | null> {
    const document = await requireMongo(this.registry)
      .database.collection<ReservationDocument>("reservations")
      .findOne({ orderId, sku }, sessionOptions(session));
    return document === null ? null : toReservation(document);
  }

  public async close(
    id: string,
    status: "released" | "expired" | "committed",
    now: Date,
    session: object,
  ): Promise<Reservation | "missing" | "closed"> {
    const document = await requireMongo(this.registry)
      .database.collection<ReservationDocument>("reservations")
      .findOneAndUpdate(
        { id, status: "active" },
        { $set: { status, updatedAt: now } },
        { returnDocument: "after", ...sessionOptions(session) },
      );
    if (document !== null) {
      return toReservation(document);
    }
    const existing = await this.findById(id, session);
    return existing === null ? "missing" : "closed";
  }

  public async listDue(now: Date, limit: number): Promise<Reservation[]> {
    const documents = await requireMongo(this.registry)
      .database.collection<ReservationDocument>("reservations")
      .find({ status: "active", expiresAt: { $lte: now } })
      .sort({ expiresAt: 1 })
      .limit(limit)
      .toArray();
    return documents.map(toReservation);
  }
}

function toReservation(document: ReservationDocument): Reservation {
  return {
    id: document.id,
    orderId: document.orderId,
    sku: document.sku,
    quantity: document.quantity,
    status: document.status,
    expiresAt: document.expiresAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
