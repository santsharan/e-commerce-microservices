/**
 * Health reports, dependency startup, traces, and metrics.
 * Liveness stays free of dependency checks.
 * Logs stay on Pino. OpenTelemetry carries traces and metrics.
 */

export interface LivenessReport {
  status: "ok";
}

export interface ReadinessReport {
  status: "ok" | "unavailable";
  checks: Record<string, "ok" | "unavailable">;
}

export { MetricName, metricNames } from "./names.js";

export {
  assertDependenciesReady,
  dependencyProfile,
  openDependencies,
  readinessFromChecks,
  type DependencyProfile,
  type ServiceDependencies,
} from "./dependencies.js";
export {
  activeTraceId,
  recordCacheHit,
  recordCacheMiss,
  recordHttpRequest,
  recordInventoryReservation,
  recordMongoDuration,
  recordOrderCancelled,
  recordOrderCompleted,
  recordOrderCreated,
  recordOrderFailed,
  recordPaymentAuthorization,
  recordSagaDuration,
  recordSagaFailure,
  renderMetrics,
  shutdownTelemetry,
  startTelemetry,
} from "./telemetry.js";
