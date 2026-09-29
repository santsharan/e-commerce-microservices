import { describe, expect, it } from "vitest";
import { inventoryIndexSpecs } from "./indexes.js";

describe("inventory indexes", () => {
  it("keeps the architecture indexes and does not delete reservations by TTL", () => {
    const names = inventoryIndexSpecs().map((spec) => spec.name);
    expect(names).toEqual([
      "inventory_sku_unique",
      "inventory_status",
      "reservations_order_sku_unique",
      "inventory_id_unique",
      "reservations_id_unique",
      "reservations_status_expires",
      "inbox_event_consumer_unique",
      "outbox_status_created",
      "outbox_aggregate_created",
      "outbox_event_id_unique",
    ]);
    expect(names).not.toContain("reservations_expires_at_ttl");
    expect(
      inventoryIndexSpecs().find((spec) => spec.name === "reservations_order_sku_unique")?.unique,
    ).toBe(true);
  });
});
