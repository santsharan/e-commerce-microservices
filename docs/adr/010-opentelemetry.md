# ADR-010 Why OpenTelemetry

## Context

A confirmed order crosses the gateway, the order service, Kafka, inventory, and payment. Logs in one process do not show that path.

## Decision

Traces use the HTTP, MongoDB, KafkaJS, and Redis instrumentations. Metrics use the names in the architecture notes, including orders, saga duration, inventory reservations, payment authorizations, cache hits, and MongoDB command latency. `GET /metrics` serves Prometheus text. `OTEL_EXPORTER_OTLP_ENDPOINT` also exports OTLP. Logs stay on Pino and include `traceId` and `x-correlation-id` when they are present.

## Alternatives

- A vendor agent that patches the process outside the repository.
- Logs only, with a shared correlation id and no spans.

## Trade-offs

One SDK works locally and in CI. The exporter and the collector are extra processes. Instrumenting every database command has a cost.

## Consequences

Shutdown flushes telemetry before the clients close. Health and metrics requests are not recorded as application traffic. The in-cluster manifests do not set the OTLP endpoint; those pods still serve `/metrics`. The Compose collector remains the local trace pipeline.
