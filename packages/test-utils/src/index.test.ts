import { describe, expect, it } from "vitest";
import { createTestEnv } from "./index.js";

describe("createTestEnv", () => {
  it("points a data service at the database it owns", () => {
    const env = createTestEnv({ SERVICE_NAME: "inventory-service" });
    expect(env["MONGO_DATABASE"]).toBe("inventory-db");
    expect(env["MONGO_URI"]).toContain("replicaSet=rs0");
  });

  it("does not assign the gateway another service database", () => {
    const env = createTestEnv();
    expect(env["SERVICE_NAME"]).toBe("api-gateway");
    expect(env["MONGO_DATABASE"]).toBe("unused");
  });
});
