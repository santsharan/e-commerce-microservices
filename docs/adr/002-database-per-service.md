# ADR-002 Why a database per service

## Context

A shared database lets one service change a table another service depends on, and it hides the real boundary.

## Decision

Each service that owns data has its own MongoDB database: `identity-db`, `catalog-db`, `inventory-db`, `order-db`, `payment-db`, and `notification-db`. Startup rejects a database name that belongs to another service. The gateway does not open MongoDB.

## Alternatives

- One database with a schema per service.
- Shared tables for orders and stock.

## Trade-offs

Each service can migrate its own data. A query that needs two domains goes through an API or an event. Cross-service transactions are not available.

## Consequences

The order stores item name and price snapshots. It does not read the catalog, inventory, or payment databases. Idempotency keys live in `order-db`.
