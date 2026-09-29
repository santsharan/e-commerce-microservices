import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { OrderPage, OrderRepository } from "../application/ports.js";
import {
  DuplicateOrderNumberError,
  OrderPaymentStatus,
  OrderStatus,
  type InventoryHold,
  type LineReservation,
  type Order,
  type OrderItem,
  type OrderPayment,
  type SagaRecord,
} from "../domain/order.js";
import type { Pricing } from "../domain/pricing.js";
import { SagaState } from "../domain/saga.js";
import { isDuplicateKey, requireMongo, sessionOptions } from "./mongo-support.js";

interface ItemDocument {
  productId: string;
  sku: string;
  nameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
  subtotal: number;
  reservationId?: string;
  reservationStatus: LineReservation;
  releaseQueued?: boolean;
}

interface SagaDocument {
  sagaId: string;
  state: SagaState;
  currentStep: string;
  retryCount: number;
  localAttempts?: number;
  topicAttempts?: number;
  dlqPublished?: boolean;
  retryHalted?: boolean;
  nextAttemptAt?: Date;
  lastError?: string;
  closure?: "cancel" | "failure";
  createdPublished: boolean;
  cancelledPublished: boolean;
  paymentRequested?: boolean;
  confirmedPublished?: boolean;
  refundRequested?: boolean;
  inventoryCommitted?: boolean;
}

interface OrderDocument {
  id: string;
  sagaId: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  currency: string;
  correlationId: string;
  items: ItemDocument[];
  pricing: Pricing;
  payment: OrderPayment;
  inventory: { status: InventoryHold; reservationIds: string[] };
  saga: SagaDocument;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const recoverableFilter = {
  $or: [
    {
      "saga.state": {
        $in: [
          SagaState.inventoryReservationPending,
          SagaState.compensatingInventory,
          SagaState.inventoryReserved,
          SagaState.paymentPending,
          SagaState.paymentAuthorized,
        ],
      },
    },
    { status: OrderStatus.cancelled, "saga.cancelledPublished": false },
    { status: OrderStatus.confirmed, "saga.confirmedPublished": false },
    { status: OrderStatus.confirmed, "saga.inventoryCommitted": false },
    { "payment.status": OrderPaymentStatus.authorized, "saga.refundRequested": false },
  ],
};

function dueFilter(now: Date): object {
  return {
    $and: [
      recoverableFilter,
      { "saga.dlqPublished": { $ne: true } },
      { "saga.retryHalted": { $ne: true } },
      {
        $or: [
          { "saga.nextAttemptAt": { $exists: false } },
          { "saga.nextAttemptAt": null },
          { "saga.nextAttemptAt": { $lte: now } },
        ],
      },
    ],
  };
}

function waitingFilter(now: Date): object {
  return {
    $and: [
      recoverableFilter,
      { "saga.dlqPublished": { $ne: true } },
      { "saga.retryHalted": { $ne: true } },
      { "saga.nextAttemptAt": { $gt: now } },
    ],
  };
}

export class MongoOrderRepository implements OrderRepository {
  public constructor(private readonly registry: ResourceRegistry) {}

  public async insert(order: Order, session: object): Promise<void> {
    try {
      await requireMongo(this.registry)
        .database.collection<OrderDocument>("orders")
        .insertOne(toDocument(order), sessionOptions(session));
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new DuplicateOrderNumberError();
      }
      throw error;
    }
  }

  public async findById(id: string, session?: object): Promise<Order | null> {
    const document = await requireMongo(this.registry)
      .database.collection<OrderDocument>("orders")
      .findOne({ id }, session === undefined ? {} : { session: session as never });
    return document === null ? null : toOrder(document);
  }

  public async listByCustomer(customerId: string, page: number, limit: number): Promise<OrderPage> {
    const collection = requireMongo(this.registry).database.collection<OrderDocument>("orders");
    const filter = { customerId };
    const [documents, total] = await Promise.all([
      collection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);
    return { items: documents.map(toOrder), page, limit, total };
  }

  public async listRecoverable(limit: number, now: Date): Promise<Order[]> {
    return this.listByFilter(dueFilter(now), limit);
  }

  public async listWaiting(limit: number, now: Date): Promise<Order[]> {
    return this.listByFilter(waitingFilter(now), limit);
  }

  private async listByFilter(filter: object, limit: number): Promise<Order[]> {
    const documents = await requireMongo(this.registry)
      .database.collection<OrderDocument>("orders")
      .find(filter)
      .limit(limit)
      .toArray();
    return documents.map(toOrder);
  }

  public async update(
    order: Order,
    expectedVersion: number,
    session?: object,
  ): Promise<Order | "missing" | "conflict"> {
    const next = toDocument({ ...order, version: expectedVersion + 1 });
    const document = await requireMongo(this.registry)
      .database.collection<OrderDocument>("orders")
      .findOneAndUpdate(
        { id: order.id, version: expectedVersion },
        { $set: next },
        {
          returnDocument: "after",
          ...(session === undefined ? {} : { session: session as never }),
        },
      );
    if (document !== null) {
      return toOrder(document);
    }
    const existing = await this.findById(order.id);
    return existing === null ? "missing" : "conflict";
  }
}

function toDocument(order: Order): OrderDocument {
  return {
    id: order.id,
    sagaId: order.saga.sagaId,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    status: order.status,
    currency: order.currency,
    correlationId: order.correlationId,
    items: order.items.map(toItemDocument),
    pricing: order.pricing,
    payment: order.payment,
    inventory: order.inventory,
    saga: toSagaDocument(order.saga),
    version: order.version,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function toItemDocument(item: OrderItem): ItemDocument {
  const document: ItemDocument = {
    productId: item.productId,
    sku: item.sku,
    nameSnapshot: item.nameSnapshot,
    unitPriceSnapshot: item.unitPriceSnapshot,
    quantity: item.quantity,
    subtotal: item.subtotal,
    reservationStatus: item.reservationStatus,
  };
  if (item.reservationId !== undefined) {
    document.reservationId = item.reservationId;
  }
  if (item.releaseQueued === true) {
    document.releaseQueued = true;
  }
  return document;
}

function toSagaDocument(saga: SagaRecord): SagaDocument {
  const document: SagaDocument = {
    sagaId: saga.sagaId,
    state: saga.state,
    currentStep: saga.currentStep,
    retryCount: saga.retryCount,
    localAttempts: saga.localAttempts,
    topicAttempts: saga.topicAttempts,
    dlqPublished: saga.dlqPublished,
    retryHalted: saga.retryHalted,
    createdPublished: saga.createdPublished,
    cancelledPublished: saga.cancelledPublished,
    paymentRequested: saga.paymentRequested,
    confirmedPublished: saga.confirmedPublished,
    refundRequested: saga.refundRequested,
    inventoryCommitted: saga.inventoryCommitted,
  };
  if (saga.lastError !== undefined) {
    document.lastError = saga.lastError;
  }
  if (saga.nextAttemptAt !== undefined) {
    document.nextAttemptAt = saga.nextAttemptAt;
  }
  if (saga.closure !== undefined) {
    document.closure = saga.closure;
  }
  return document;
}

function toOrder(document: OrderDocument): Order {
  return {
    id: document.id,
    orderNumber: document.orderNumber,
    customerId: document.customerId,
    status: document.status,
    currency: document.currency,
    correlationId: document.correlationId,
    items: document.items.map(toItem),
    pricing: document.pricing,
    payment: document.payment,
    inventory: document.inventory,
    saga: toSaga(document.saga),
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toItem(item: ItemDocument): OrderItem {
  const mapped: OrderItem = {
    productId: item.productId,
    sku: item.sku,
    nameSnapshot: item.nameSnapshot,
    unitPriceSnapshot: item.unitPriceSnapshot,
    quantity: item.quantity,
    subtotal: item.subtotal,
    reservationStatus: item.reservationStatus,
  };
  if (item.reservationId !== undefined) {
    mapped.reservationId = item.reservationId;
  }
  if (item.releaseQueued === true) {
    mapped.releaseQueued = true;
  }
  return mapped;
}

function toSaga(saga: SagaDocument): SagaRecord {
  const mapped: SagaRecord = {
    sagaId: saga.sagaId,
    state: saga.state,
    currentStep: saga.currentStep,
    retryCount: saga.retryCount,
    localAttempts: typeof saga.localAttempts === "number" ? saga.localAttempts : 0,
    topicAttempts: typeof saga.topicAttempts === "number" ? saga.topicAttempts : 0,
    dlqPublished: saga.dlqPublished === true,
    retryHalted: saga.retryHalted === true,
    createdPublished: saga.createdPublished === true,
    cancelledPublished: saga.cancelledPublished === true,
    paymentRequested: saga.paymentRequested === true,
    confirmedPublished: saga.confirmedPublished === true,
    refundRequested: saga.refundRequested === true,
    inventoryCommitted: saga.inventoryCommitted === true,
  };
  if (saga.lastError !== undefined) {
    mapped.lastError = saga.lastError;
  }
  if (saga.nextAttemptAt !== undefined) {
    mapped.nextAttemptAt = saga.nextAttemptAt;
  }
  if (saga.closure !== undefined) {
    mapped.closure = saga.closure;
  }
  return mapped;
}
