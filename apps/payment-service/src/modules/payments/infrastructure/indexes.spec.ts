import { describe, expect, it } from "vitest";
import { paymentIndexSpecs } from "./indexes.js";

describe("payment indexes", () => {
  it("keeps one payment row per order", () => {
    const names = paymentIndexSpecs().map((spec) => spec.name);
    expect(names).toEqual([
      "payments_id_unique",
      "payments_order_id_unique",
      "payments_status_created",
      "inbox_event_consumer_unique",
      "outbox_status_created",
      "outbox_aggregate_created",
      "outbox_event_id_unique",
    ]);
    expect(
      paymentIndexSpecs().find((spec) => spec.name === "payments_order_id_unique")?.unique,
    ).toBe(true);
  });
});
