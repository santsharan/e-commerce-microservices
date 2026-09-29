import { describe, expect, it } from "vitest";
import { assertDependenciesReady, dependencyProfile, readinessFromChecks } from "./dependencies.js";

describe("dependency startup", () => {
  it("assigns each service the clients it is allowed to open", () => {
    expect(dependencyProfile("api-gateway")).toEqual({ mongo: false, redis: true, kafka: false });
    expect(dependencyProfile("identity-service")).toEqual({
      mongo: true,
      redis: false,
      kafka: false,
    });
    expect(dependencyProfile("catalog-service")).toEqual({
      mongo: true,
      redis: true,
      kafka: false,
    });
    for (const serviceName of [
      "inventory-service",
      "order-service",
      "payment-service",
      "notification-service",
    ] as const) {
      expect(dependencyProfile(serviceName)).toEqual({ mongo: true, redis: false, kafka: true });
    }
  });

  it("marks readiness unavailable when any check is down", () => {
    expect(readinessFromChecks({ process: "ok", redis: "unavailable" })).toEqual({
      status: "unavailable",
      checks: { process: "ok", redis: "unavailable" },
    });
  });

  it("names the down dependency and does not include a driver message", async () => {
    await expect(
      assertDependenciesReady({
        async ping() {
          return { process: "ok", redis: "unavailable" };
        },
      }),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "A required dependency is unavailable",
      details: { dependencies: ["redis"] },
    });
  });
});
