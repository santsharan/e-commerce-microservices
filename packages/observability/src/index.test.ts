import { describe, expect, it } from "vitest";
import { metricNames } from "./index.js";
import {
  recordOrderCreated,
  renderMetrics,
  shutdownTelemetry,
  startTelemetry,
} from "./telemetry.js";

describe("metric names", () => {
  it("uses unique prometheus names", () => {
    const names = metricNames();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("orders_created_total");
    expect(names).toContain("orders_cancelled_total");
    expect(names).toContain("saga_duration_seconds");
    expect(names).toContain("cache_hits_total");
  });

  it("exposes a recorded counter on the prometheus scrape", async () => {
    startTelemetry({ serviceName: "order-service", instrument: false });
    recordOrderCreated();
    const body = await renderMetrics();
    expect(body).toContain("orders_created_total");
    await shutdownTelemetry();
  });
});
