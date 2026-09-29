# ADR-006 Why an inbox

## Context

Kafka delivery is at least once. The outbox can publish the same `eventId` twice. A second reserve must not take stock twice, and a second payment command must not create a second charge record.

## Decision

Consumers insert `inbox_events` in the same transaction as the business write. The unique key is `(eventId, consumer)`. A duplicate key is detected outside the aborted transaction and treated as already processed.

## Alternatives

- Rely on the business unique key alone and treat every duplicate as a conflict.
- Store processed ids in Redis.

## Trade-offs

The inbox makes "already handled" explicit per consumer. Redis would lose that record independently of the business write. A business unique key still matters for a new `eventId` that repeats the same order and SKU.

## Consequences

The same reserve command does not decrement stock again. Payment replay returns the stored authorization. Order retry-topic messages are not claimed by the inbox, because an early wake-up would suppress the later one. Order creation also stores `Idempotency-Key` in `order-db` for 24 hours. The gateway forwards that header and does not keep a second copy.
