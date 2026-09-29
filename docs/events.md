# Event catalog

Every message uses the version 1 envelope: `eventId`, `eventType`, `eventVersion`, `occurredAt`, `producer`, `aggregateType`, `aggregateId`, `correlationId`, and `payload`. `causationId` and `traceId` are optional. `eventVersion` is `1` for every type below. The partition key is `aggregateId`, and for these events that value is the order id.

Inventory, order, and payment consumers claim `(eventId, consumer)` in the inbox before the business write. A duplicate delivery is skipped. The order retry topics are wake-ups and are not stored in the inbox. The outbox publisher retries a failed Kafka write after 1 second, 5 seconds, and then every 30 seconds. That publish retry is not dead-lettered. A consumer commits a validation failure and skips it. Any other handler failure leaves the offset uncommitted so the broker redelivers.

`commerce.notification.commands.v1` is created with the other topics. No event is published to it yet.

## Orders

### order.created

- Topic: `commerce.orders.v1`
- Producer: order-service
- Consumer: none yet
- Payload: `orderId`, `orderNumber`, `customerId`, `currency`, `grandTotal`, `items`

### order.confirmed

- Topic: `commerce.orders.v1`
- Producer: order-service
- Consumer: none yet
- Payload: `orderId`, `orderNumber`, `customerId`, `currency`, `grandTotal`, `paymentId`
- Written when payment authorization completes the saga

### order.cancelled

- Topic: `commerce.orders.v1`
- Producer: order-service
- Consumer: none yet
- Payload: `orderId`, `orderNumber`, `customerId`, `reason`
- Written when a caller cancel finishes. An inventory failure or a payment decline does not publish this event.

## Inventory commands

### inventory.reserve.requested

- Topic: `commerce.inventory.commands.v1`
- Producer: order-service
- Consumer: inventory-service
- Payload: `orderId`, `sku`, `quantity`
- The same `eventId` reserves once. A new `eventId` for the same order, SKU, and quantity replays the reservation and does not decrement stock again.

### inventory.release.requested

- Topic: `commerce.inventory.commands.v1`
- Producer: order-service
- Consumer: inventory-service
- Payload: `reservationId`, `orderId`, `sku`

### inventory.commit.requested

- Topic: `commerce.inventory.commands.v1`
- Producer: order-service
- Consumer: inventory-service
- Payload: `reservationId`, `orderId`, `sku`
- Decreases `reserved` and leaves `available` unchanged. There is no `inventory.committed` fact.

## Inventory facts

### inventory.reserved

- Topic: `commerce.inventory.v1`
- Producer: inventory-service
- Consumer: order-service
- Payload: `reservationId`, `orderId`, `sku`, `quantity`, `expiresAt`

### inventory.reservation.failed

- Topic: `commerce.inventory.v1`
- Producer: inventory-service
- Consumer: order-service
- Payload: `orderId`, `sku`, `quantity`, `reason`
- `reason` is `insufficient_stock`, `unknown_sku`, `inactive`, or `conflict`

### inventory.released

- Topic: `commerce.inventory.v1`
- Producer: inventory-service
- Consumer: order-service
- Payload: `reservationId`, `orderId`, `sku`, `quantity`, `reason`
- `reason` is `released` or `expired`

## Payment commands

### payment.authorization.requested

- Topic: `commerce.payment.commands.v1`
- Producer: order-service
- Consumer: payment-service
- Payload: `orderId`, `amount`, `currency`
- The order service does not send `simulate`

### payment.refund.requested

- Topic: `commerce.payment.commands.v1`
- Producer: order-service
- Consumer: payment-service
- Payload: `paymentId`, `orderId`, `amount`, `currency`

## Payment facts

### payment.authorized

- Topic: `commerce.payments.v1`
- Producer: payment-service
- Consumer: order-service
- Payload: `paymentId`, `orderId`, `amount`, `currency`
- The order accepts it when `aggregateId` is the order id and the amount and currency match the order

### payment.authorization.failed

- Topic: `commerce.payments.v1`
- Producer: payment-service
- Consumer: order-service
- Payload: `paymentId`, `orderId`, `amount`, `currency`, `reason`
- A decline uses `reason` `declined`

### payment.refunded

- Topic: `commerce.payments.v1`
- Producer: payment-service
- Consumer: order-service
- Payload: `paymentId`, `orderId`, `amount`, `currency`

## Saga wake-ups

### saga.retry.1m

- Topic: `commerce.orders.retry.1m`
- Producer: order-service
- Consumer: order-service
- Payload: `orderId`, `sagaId`, `localAttempts`, `topicAttempts`
- A message that arrives before `saga.nextAttemptAt` is ignored

### saga.retry.5m

- Topic: `commerce.orders.retry.5m`
- Producer: order-service
- Consumer: order-service
- Payload: `orderId`, `sagaId`, `localAttempts`, `topicAttempts`

### saga.retry.30m

- Topic: `commerce.orders.retry.30m`
- Producer: order-service
- Consumer: order-service
- Payload: `orderId`, `sagaId`, `localAttempts`, `topicAttempts`

### saga.dead-lettered

- Topic: `commerce.orders.dlq`
- Producer: order-service
- Consumer: none
- Payload: `originalEvent`, `errorCode`, `errorMessage`, `stack`, `consumer`, `attempts`, `failedAt`, `correlationId`, `orderId`, `sagaId`
- Publishing this event leaves the saga state unchanged and sets `dlqPublished`
