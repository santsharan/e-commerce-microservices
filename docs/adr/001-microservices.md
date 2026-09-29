# ADR-001 Why microservices

## Context

An order touches identity, catalog, stock, and payment. Those change on different schedules and fail independently.

## Decision

Commerce Flow is a set of services with a public gateway. Each service owns its HTTP API and its data. The order service coordinates the fulfillment workflow.

## Alternatives

- One deployable application with modules in one process.
- A shared library that also owns the database writes.

## Trade-offs

Service boundaries make a failure local and make the workflow visible on Kafka. They add network calls, more processes, and a gateway.

## Consequences

A service does not read another service's database. The gateway is the public edge. Notification is a separate service and does not run inside the order transaction.
