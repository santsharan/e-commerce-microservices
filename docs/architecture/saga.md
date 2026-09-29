# Order saga

The order service is the orchestrator. Saga state is stored on the order document, and every change goes through one transition table. A disallowed signal is `409`.

## States

`CREATED`, `INVENTORY_RESERVATION_PENDING`, `INVENTORY_RESERVED`, `PAYMENT_PENDING`, `PAYMENT_AUTHORIZED`, `COMPLETED`, `COMPENSATING_INVENTORY`, `COMPENSATION_COMPLETED`, `FAILED`.

The HTTP status follows that state. `COMPLETED` is `confirmed`. `COMPENSATING_INVENTORY` is `cancelling`. `COMPENSATION_COMPLETED` is `cancelled` when the closure is a caller cancel, and `failed` otherwise. `FAILED` is `failed`.

## Happy path

1. `POST /api/v1/orders` inserts the order, the idempotency key, `order.created`, and one `inventory.reserve.requested` per line in one transaction.
2. The saga stays `INVENTORY_RESERVATION_PENDING` until every line is reserved.
3. It then publishes `payment.authorization.requested` and moves to `PAYMENT_PENDING`.
4. `payment.authorized` confirms the order, publishes `order.confirmed`, and publishes `inventory.commit.requested`.
5. The commit decreases `reserved` and leaves `available` down, so the 15-minute hold sweep does not return that stock.

## Failure scenarios

**Not enough stock, or every line fails.** The saga moves to `FAILED`. Reserved lines are released. The order status is `failed`. `order.cancelled` is not published.

**One line fails after another line was reserved.** The saga compensates, releases the reserved lines, and finishes `failed`.

**Payment declines.** Inventory is released and the saga finishes `COMPENSATION_COMPLETED` with closure `failure`. The order status is `failed`. Stock returns to available. `order.cancelled` is not published.

**The caller cancels.** The saga compensates. When the release finishes, the status is `cancelled` and `order.cancelled` is published. A payment that is authorized during that compensation is refunded.

**Kafka is down after the order is stored.** The saga records `nextAttemptAt`. Transient failures wait 100 ms, 500 ms, and 2 seconds, then use the 1, 5, and 30 minute topics, then publish `saga.dead-lettered`. The saga state stays where it was, so a reserved order is not released by the dead letter itself. `POST /api/v1/orders/:id/retries` with `If-Match` clears the ladder. The gateway allows that route for the admin role.

**The hold expires before the commit is applied.** The sweep returns the quantity. The later commit finds nothing to commit and is skipped.

## Restart

`saga.nextAttemptAt`, the attempt counters, and the publish flags are on the order. A process restart resumes from that record. Short delays also arm an in-process timer. The delayed topics are consumed so their offsets commit.
