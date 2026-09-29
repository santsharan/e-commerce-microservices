import { describe, expect, it } from "vitest";
import { API_PREFIX, Headers, HealthPath } from "./index.js";

describe("HTTP contracts", () => {
  it("versions public APIs under /api/v1", () => {
    expect(API_PREFIX).toBe("/api/v1");
  });

  it("names the idempotency and correlation headers", () => {
    expect(Headers.idempotencyKey).toBe("idempotency-key");
    expect(Headers.requestId).toBe("x-request-id");
    expect(Headers.correlationId).toBe("x-correlation-id");
  });

  it("keeps health endpoints off the versioned API", () => {
    expect(HealthPath.liveness).toBe("/health/liveness");
    expect(HealthPath.readiness).toBe("/health/readiness");
    expect(HealthPath.metrics).toBe("/metrics");
  });
});
