# ADR-005 Why a transactional outbox

## Context

A service must not commit an order and then fail before Kafka accepts the event. It also must not publish an event for a write that rolls back.

## Decision

Inventory, orders, and payments insert `outbox_events` in the same MongoDB transaction as their own write. A dispatcher publishes pending rows about once a second and marks them published after the broker accepts them.

## Alternatives

- Publish to Kafka inside the request, before the database commit.
- Publish after the commit, with no record of the intent.

## Trade-offs

The business write and the intent to publish commit together. A crash after the broker accepts the record and before the row is marked published sends the same `eventId` again. The dispatcher retries forever at 1 second, 5 seconds, and then 30 seconds, because dropping the business event is worse than a duplicate.

## Consequences

Consumers must tolerate duplicates. The saga ladder still runs when inserting the outbox row fails. Kafka downtime is the dispatcher's problem.
