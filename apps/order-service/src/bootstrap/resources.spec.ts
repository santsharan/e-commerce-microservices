import { describe, expect, it } from "vitest";
import { ResourceRegistry } from "./resources.js";

describe("resource registry", () => {
  it("stays process-only until bootstrap attaches clients", async () => {
    const registry = new ResourceRegistry();
    await expect(registry.readiness()).resolves.toEqual({
      status: "ok",
      checks: { process: "ok" },
    });
  });

  it("reports a down dependency as unavailable", async () => {
    const registry = new ResourceRegistry();
    registry.attach({
      profile: { mongo: false, redis: true, kafka: false },
      async ping() {
        return { process: "ok", redis: "unavailable" };
      },
      async close() {
        return undefined;
      },
    });

    await expect(registry.readiness()).resolves.toEqual({
      status: "unavailable",
      checks: { process: "ok", redis: "unavailable" },
    });
  });
});
