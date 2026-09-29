# System context

Commerce Flow is a small set of services with separate data and asynchronous workflows. Identity accounts, catalog products, inventory stock, orders, and payments exist. Notification does not.

## People and systems

- **Customer and admin clients** call the API gateway on port 3000. The gateway proxies identity, catalog, inventory, and orders. Payment HTTP stays on port 3005.
- **API gateway** verifies access tokens, applies route permissions, rate-limits login, and replaces a customer's `customerId` with the token subject.
- **Identity** owns users, refresh tokens, roles, and audit records in `identity-db`. Clients register and log in through the gateway. The gateway forwards those calls to port 3001.
- **Catalog** owns products, variants, prices, and categories in `catalog-db`. Redis caches reads and is not the source of truth. Invalidation happens in the writer. Catalog does not publish `ProductUpdated` yet.
- **Order** owns orders, saga state, and idempotency keys in `order-db`. It publishes inventory and payment commands and consumes their facts. Failed steps wait until `saga.nextAttemptAt`, then resume. It does not read catalog, inventory, or payment databases.
- **Inventory** owns stock and reservations in `inventory-db`. It consumes reserve, release, and commit commands and publishes reserve and release results on Kafka. A commit keeps the quantity out of available stock and stops the expiration sweep from returning it. Redis is not the stock ledger.
- **Payment** is an in-process mock in `payment-db`. It authorizes or declines an amount and can refund an authorization. It never stores card data and it does not call Stripe.
- **Notification** owns notification records in `notification-db`. Delivery is asynchronous and outside the order transaction.
- **Kafka** carries events and commands. **MongoDB** is a replica set so a service can commit its write and its outbox event together. **Redis** covers the catalog cache and the gateway login limit. Order idempotency is stored in MongoDB.

## Rules that are already enforced in code

- Startup configuration is typed and fails closed.
- A service that owns data must be configured with its own database name.
- MongoDB URIs must target a replica set, or use `mongodb+srv`.
- HTTP failures use one error envelope and do not return stack traces.
- Logs redact passwords, tokens, authorization headers, and card numbers.
- Kafka partition keys are aggregate ids.
- The order retry decision is a pure function with tests. The order service executes it: local timers, the 1/5/30 minute topics, then `commerce.orders.dlq`. Progress is stored on the order. Validation and authentication stop the ladder. A conflict waits for the next sweep. Dead-lettering sets `dlqPublished` and leaves the saga state unchanged. `POST /api/v1/orders/:id/retries` clears the ladder when `If-Match` matches.
- `bootstrap()` opens only the clients in that service's dependency profile and refuses another service's database name.
- Readiness returns 503 when an attached client does not respond. Liveness does not check MongoDB, Kafka, or Redis.
- Access tokens are signed and verified as RS256 with issuer, audience, expiry, not-before, subject, and token id. The token itself is not copied into the client error.
- Passwords are Argon2id. Refresh tokens are stored as SHA-256. Reuse of a rotated refresh token revokes the family.
- Identity creates its own indexes when the process starts: unique user email, unique refresh token id, and audit time.
- Catalog creates product and category indexes when the process starts, including a unique index on `variants.sku` that is not in the shared index plan.
- Inventory creates stock and reservation indexes when the process starts. Reservation expiration is an application sweep. The declared TTL index is not created, because deleting the row would not return quantity to available stock.
- A reserve, release, or failure row is written with its outbox event in one MongoDB transaction. The dispatcher publishes that event. A repeated Kafka delivery finds the inbox row and does not change stock again. Repeating the same reserve command publishes `inventory.reserved` again only when the caller starts a new attempt; the same `eventId` is skipped.
- Product and category writes use a version checked with `If-Match`. A missing precondition is `428`. A stale version is `409`.
- The role grant table in the identity service is the one used when a token is issued. The gateway checks that permission on the public route. Catalog, inventory, and orders do not check it on their own ports.
- `pnpm test` includes a contract check for every event type, its topic, and the consumer readers. `pnpm test:e2e` registers through the gateway, confirms one order, declines a payment, and delivers the same reserve command twice. The end-to-end broker is Confluent Kafka 7.7. Compose uses Apache Kafka 4.1.2.
- Order creates its indexes when the process starts, including a unique `(customerId, key)` idempotency index and a TTL on `expiresAt`. Saga id is stored on the order so `orders_saga_id_unique` applies. Transitions are a table: a disallowed signal is `409`.
- Creating an order requires `Idempotency-Key`. The same key and body returns the original order. A different body is `409`. Cancel requires `If-Match`.
- Order publishes by inserting `outbox_events` in the same transaction as the order change. A 30 second sweep resumes saga steps whose outbox row was not recorded. `order.confirmed` is recorded when authorization succeeds. `order.cancelled` is recorded when a caller cancel finishes. An inventory or payment failure does not publish `order.cancelled`.
- Payment creates a unique index on `orderId` when the process starts. The same order and amount returns the stored result and appends the stored outcome to the outbox again. Card fields are rejected. `PAYMENT_FAILURE_MODE` defaults to `authorize`.
- Inventory, order, and payment each create the inbox and outbox indexes at startup, including a unique `eventId` on the outbox. A dispatcher publishes due outbox rows about once a second. Consumers claim `(eventId, consumer)` before the business write.

## Rules that are documented and not yet executed

- The inventory consumer, the order consumers, and the payment consumer are the Kafka handlers. Readiness still proves the producer can reach the cluster. Invalid commands and unknown orders are committed and skipped. A version conflict is redelivered.
- OpenTelemetry exports traces and metrics when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. `GET /metrics` serves the same metrics as Prometheus text. Liveness does not check dependencies.
- The gateway verifies RS256 access tokens, requires the route permission, and proxies `/api/v1` to identity, catalog, inventory, and orders. Inside Compose and the Kubernetes namespace those upstreams are the service DNS names. On the host they are `127.0.0.1` and the service ports. Login, registration, and refresh are limited to 10 attempts per IP each minute. Customers cannot set another `customerId`. Dead-letter replay requires the admin role. `docs/security/threat-model.md` records the residual risks.
- Service-to-service HTTP tokens can be signed and verified for `inventory.reserve`. They are not attached to Kafka commands. mTLS is the production control for the service bus.
- There is no public way to create an admin or support user. Self-registration stores `customer`.
- Direct service ports do not require a token. The gateway is the public boundary.
