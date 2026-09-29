import { indexPlan, indexRequests, type IndexRequest } from "@commerce-flow/mongodb";

const extraIndexes: readonly IndexRequest[] = [
  { collection: "orders", name: "orders_id_unique", keys: { id: 1 }, unique: true },
  {
    collection: "orders",
    name: "orders_saga_state",
    keys: { "saga.state": 1 },
    unique: false,
  },
  {
    collection: "idempotency_keys",
    name: "idempotency_customer_key_unique",
    keys: { customerId: 1, key: 1 },
    unique: true,
  },
  {
    collection: "idempotency_keys",
    name: "idempotency_expires_at_ttl",
    keys: { expiresAt: 1 },
    unique: false,
    expireAfterSeconds: 0,
  },
];

export function orderIndexSpecs(): readonly IndexRequest[] {
  return [
    ...indexRequests(indexPlan.filter((spec) => spec.collection === "orders")),
    ...extraIndexes,
    ...indexRequests(
      indexPlan.filter(
        (spec) => spec.collection === "inbox_events" || spec.collection === "outbox_events",
      ),
    ),
  ];
}

export async function ensureOrderIndexes(database: {
  collection(name: string): {
    createIndex(
      keys: Record<string, 1 | -1>,
      options: { name: string; unique: boolean; expireAfterSeconds?: number },
    ): Promise<unknown>;
  };
}): Promise<void> {
  for (const spec of orderIndexSpecs()) {
    await database.collection(spec.collection).createIndex(spec.keys, {
      name: spec.name,
      unique: spec.unique,
      ...(spec.expireAfterSeconds === undefined
        ? {}
        : { expireAfterSeconds: spec.expireAfterSeconds }),
    });
  }
}
