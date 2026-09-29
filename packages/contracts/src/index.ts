/**
 * Cross-service HTTP contracts.
 * Business route payloads are added with the service that owns them.
 */

export const API_PREFIX = "/api/v1";

export const Headers = {
  requestId: "x-request-id",
  correlationId: "x-correlation-id",
  idempotencyKey: "idempotency-key",
  authorization: "authorization",
} as const;

export const HealthPath = {
  liveness: "/health/liveness",
  readiness: "/health/readiness",
  metrics: "/metrics",
} as const;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details: Record<string, unknown>;
  };
}
