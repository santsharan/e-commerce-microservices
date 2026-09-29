import { describe, expect, it } from "vitest";
import { orderIndexSpecs } from "./indexes.js";

describe("order indexes", () => {
  it("applies the order plan and stores idempotency with a TTL", () => {
    const specs = orderIndexSpecs();
    const names = specs.map((spec) => spec.name);
    expect(names).toEqual([
      "orders_order_number_unique",
      "orders_customer_created",
      "orders_status_created",
      "orders_saga_id_unique",
      "orders_id_unique",
      "orders_saga_state",
      "idempotency_customer_key_unique",
      "idempotency_expires_at_ttl",
      "inbox_event_consumer_unique",
      "outbox_status_created",
      "outbox_aggregate_created",
      "outbox_event_id_unique",
    ]);
    expect(specs.find((spec) => spec.name === "orders_saga_id_unique")?.keys).toEqual({
      sagaId: 1,
    });
    expect(
      specs.find((spec) => spec.name === "idempotency_expires_at_ttl")?.expireAfterSeconds,
    ).toBe(0);
  });
});
