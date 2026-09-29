import { AppError } from "@commerce-flow/errors";
import { describe, expect, it } from "vitest";
import { assertReplicaSetUri, indexPlan, validatePersistenceConfig } from "./index.js";

describe("mongodb boundaries", () => {
  it("accepts an explicit replica set and Atlas SRV URIs", () => {
    expect(() => assertReplicaSetUri("mongodb://localhost:27017/?replicaSet=rs0")).not.toThrow();
    expect(() => assertReplicaSetUri("mongodb+srv://cluster.example.net/order-db")).not.toThrow();
  });

  it("rejects a standalone URI without echoing credentials", () => {
    const secret = "mongo-password-do-not-leak";
    try {
      assertReplicaSetUri(`mongodb://user:${secret}@localhost:27017/admin`);
      expect.fail("expected the uri to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it("rejects a service pointed at another service database", () => {
    expect(() =>
      validatePersistenceConfig({
        serviceName: "order-service",
        mongodb: {
          uri: "mongodb://localhost:27017/?replicaSet=rs0",
          database: "inventory-db",
        },
      }),
    ).toThrow(/does not match/);
  });

  it("allows the gateway to validate a replica set without owning a database", () => {
    expect(() =>
      validatePersistenceConfig({
        serviceName: "api-gateway",
        mongodb: {
          uri: "mongodb://localhost:27017/?replicaSet=rs0",
          database: "unused",
        },
      }),
    ).not.toThrow();
  });

  it("marks inbox identity and order numbers unique", () => {
    const unique = indexPlan.filter((index) => index.unique).map((index) => index.name);
    expect(unique).toEqual(
      expect.arrayContaining([
        "products_slug_unique",
        "inventory_sku_unique",
        "reservations_order_sku_unique",
        "orders_order_number_unique",
        "orders_saga_id_unique",
        "inbox_event_consumer_unique",
      ]),
    );
  });
});
