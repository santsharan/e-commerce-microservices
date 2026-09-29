# ADR-008 Why Redis

## Context

Catalog reads are frequent. Login attempts need a short counter. Neither of those is the business record.

## Decision

Redis caches catalog reads for 60 seconds and counts gateway login attempts. The catalog writer deletes its keys in the same process. A Redis failure on a catalog read or invalidation is logged and does not fail a committed MongoDB write. The login limiter returns `503` when Redis is down.

## Alternatives

- Cache catalog documents in the service process.
- Store idempotency keys and stock in Redis.

## Trade-offs

Redis is fast and shared across catalog replicas. It can be empty or wrong. Putting orders or stock there would create a second source of truth.

## Consequences

Redis is not the record for users, orders, payments, or inventory. The order service does not open Redis. The gateway rate-limit key is `ratelimit:login:<ip>`.
