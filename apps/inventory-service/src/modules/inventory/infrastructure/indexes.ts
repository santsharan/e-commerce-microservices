import { indexPlan, indexRequests, type IndexRequest } from "@commerce-flow/mongodb";

const extraIndexes: readonly IndexRequest[] = [
  { collection: "inventory", name: "inventory_id_unique", keys: { id: 1 }, unique: true },
  { collection: "reservations", name: "reservations_id_unique", keys: { id: 1 }, unique: true },
  {
    collection: "reservations",
    name: "reservations_status_expires",
    keys: { status: 1, expiresAt: 1 },
    unique: false,
  },
];

/**
 * The architecture TTL index would delete an expired reservation without returning
 * its quantity to available stock. Expiration is an application sweep instead.
 */
export function inventoryIndexSpecs(): readonly IndexRequest[] {
  return [
    ...indexRequests(
      indexPlan.filter(
        (spec) =>
          spec.collection === "inventory" ||
          (spec.collection === "reservations" && spec.ttlField === undefined),
      ),
    ),
    ...extraIndexes,
    ...indexRequests(
      indexPlan.filter(
        (spec) => spec.collection === "inbox_events" || spec.collection === "outbox_events",
      ),
    ),
  ];
}

export async function ensureInventoryIndexes(database: {
  collection(name: string): {
    createIndex(
      keys: Record<string, 1 | -1>,
      options: { name: string; unique: boolean },
    ): Promise<unknown>;
  };
}): Promise<void> {
  for (const spec of inventoryIndexSpecs()) {
    await database.collection(spec.collection).createIndex(spec.keys, {
      name: spec.name,
      unique: spec.unique,
    });
  }
}
