# ADR-003 Why Kafka

## Context

The fulfillment steps outlive one HTTP request. A service must keep working when a neighbor restarts.

## Decision

Kafka carries commands and facts. The partition key is the aggregate id, which for this workflow is the order id. Topics are versioned names such as `commerce.orders.v1`, plus command topics, retry topics, and `commerce.orders.dlq`.

## Alternatives

- HTTP calls for every step, with the caller waiting.
- A database table polled by every service.

## Trade-offs

Consumers can replay and scale by partition. The broker is another system to run, and delivery is at least once.

## Consequences

Producers write the outbox in the same transaction as the business change. Consumers are idempotent. Invalid messages are skipped. Other handler failures are redelivered.
