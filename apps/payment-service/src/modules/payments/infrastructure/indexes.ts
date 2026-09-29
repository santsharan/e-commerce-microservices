import { indexPlan, indexRequests, type IndexRequest } from "@commerce-flow/mongodb";

const paymentIndexes: readonly IndexRequest[] = [
  { collection: "payments", name: "payments_id_unique", keys: { id: 1 }, unique: true },
  {
    collection: "payments",
    name: "payments_order_id_unique",
    keys: { orderId: 1 },
    unique: true,
  },
  {
    collection: "payments",
    name: "payments_status_created",
    keys: { status: 1, createdAt: -1 },
    unique: false,
  },
];

export function paymentIndexSpecs(): readonly IndexRequest[] {
  return [
    ...paymentIndexes,
    ...indexRequests(
      indexPlan.filter(
        (spec) => spec.collection === "inbox_events" || spec.collection === "outbox_events",
      ),
    ),
  ];
}

export async function ensurePaymentIndexes(database: {
  collection(name: string): {
    createIndex(
      keys: Record<string, 1 | -1>,
      options: { name: string; unique: boolean },
    ): Promise<unknown>;
  };
}): Promise<void> {
  for (const spec of paymentIndexSpecs()) {
    await database.collection(spec.collection).createIndex(spec.keys, {
      name: spec.name,
      unique: spec.unique,
    });
  }
}
