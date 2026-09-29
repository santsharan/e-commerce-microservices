import { AppError, ErrorCode } from "@commerce-flow/errors";
import { assertReplicaSetUri } from "./replica-set.js";

export { assertReplicaSetUri };

/**
 * Logical databases. Local Docker may host them on one replica set.
 * A service never opens another service's database.
 */
export const ServiceDatabase = {
  "identity-service": "identity-db",
  "catalog-service": "catalog-db",
  "inventory-service": "inventory-db",
  "order-service": "order-db",
  "payment-service": "payment-db",
  "notification-service": "notification-db",
} as const;

export type DataServiceName = keyof typeof ServiceDatabase;

const databases: Record<string, string> = ServiceDatabase;

export function databaseForService(serviceName: string): string | null {
  return databases[serviceName] ?? null;
}

export function ownsDatabase(serviceName: string): boolean {
  return databaseForService(serviceName) !== null;
}

export interface PersistenceConfig {
  serviceName: string;
  mongodb: {
    uri: string;
    database: string;
  };
}

function configError(message: string, details: Record<string, unknown>): AppError {
  return new AppError(ErrorCode.CONFIG_INVALID, message, 500, details);
}

export function assertServiceDatabase(serviceName: string, database: string): void {
  const expected = databaseForService(serviceName);
  if (expected === null) {
    throw configError("This service does not own a database", { serviceName });
  }
  if (database !== expected) {
    throw configError("MONGO_DATABASE does not match the database owned by this service", {
      serviceName,
      expected,
    });
  }
}

export function validatePersistenceConfig(config: PersistenceConfig): void {
  assertReplicaSetUri(config.mongodb.uri);
  if (ownsDatabase(config.serviceName)) {
    assertServiceDatabase(config.serviceName, config.mongodb.database);
  }
}

export interface IndexSpec {
  collection: string;
  name: string;
  keys: Readonly<Record<string, 1 | -1>>;
  unique?: boolean;
  ttlField?: string;
}

/**
 * Index plan from the architecture notes.
 * This module does not create indexes. The owning service applies them when that process starts.
 */
export const indexPlan: readonly IndexSpec[] = [
  { collection: "products", name: "products_slug_unique", keys: { slug: 1 }, unique: true },
  { collection: "products", name: "products_category_id", keys: { categoryId: 1 } },
  { collection: "products", name: "products_status", keys: { status: 1 } },
  { collection: "products", name: "products_created_at", keys: { createdAt: 1 } },
  { collection: "inventory", name: "inventory_sku_unique", keys: { sku: 1 }, unique: true },
  { collection: "inventory", name: "inventory_status", keys: { status: 1 } },
  {
    collection: "reservations",
    name: "reservations_order_sku_unique",
    keys: { orderId: 1, sku: 1 },
    unique: true,
  },
  {
    collection: "reservations",
    name: "reservations_expires_at_ttl",
    keys: { expiresAt: 1 },
    ttlField: "expiresAt",
  },
  {
    collection: "orders",
    name: "orders_order_number_unique",
    keys: { orderNumber: 1 },
    unique: true,
  },
  { collection: "orders", name: "orders_customer_created", keys: { customerId: 1, createdAt: -1 } },
  { collection: "orders", name: "orders_status_created", keys: { status: 1, createdAt: -1 } },
  { collection: "orders", name: "orders_saga_id_unique", keys: { sagaId: 1 }, unique: true },
  {
    collection: "inbox_events",
    name: "inbox_event_consumer_unique",
    keys: { eventId: 1, consumer: 1 },
    unique: true,
  },
  { collection: "outbox_events", name: "outbox_status_created", keys: { status: 1, createdAt: 1 } },
  {
    collection: "outbox_events",
    name: "outbox_aggregate_created",
    keys: { aggregateId: 1, createdAt: 1 },
  },
  {
    collection: "outbox_events",
    name: "outbox_event_id_unique",
    keys: { eventId: 1 },
    unique: true,
  },
];

export { connectMongo, type MongoConnectOptions, type MongoHandle } from "./client.js";
export { indexRequests, type IndexRequest } from "./indexes.js";
