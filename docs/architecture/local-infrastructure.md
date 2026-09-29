# Local infrastructure

Phase 2 runs the dependencies on one machine. `make dev` and the application containers open the clients in each service's dependency profile. The seed and reset scripts open them too.

## What starts

`make infra-up` starts:

| Service                 | Host address             | Role                                        |
| ----------------------- | ------------------------ | ------------------------------------------- |
| MongoDB 8               | `127.0.0.1:27017`        | Single-node replica set `rs0`               |
| Redis 8                 | `127.0.0.1:6379`         | Catalog cache and the gateway login limit   |
| Kafka 4.1               | `localhost:9092`         | Host listener. Containers use `kafka:19092` |
| Kafka UI                | `http://127.0.0.1:8080`  | Topics, groups, and messages                |
| OpenTelemetry Collector | `127.0.0.1:4318`         | OTLP HTTP. gRPC is `4317`                   |
| Prometheus              | `http://127.0.0.1:9090`  | Scrapes itself and the collector            |
| Grafana                 | `http://127.0.0.1:3007`  | Local login `admin` / `admin`               |
| Jaeger                  | `http://127.0.0.1:16686` | Traces exported by the collector            |
| Loki                    | `http://127.0.0.1:3100`  | Container logs via Promtail                 |

Grafana is on 3007 so it does not take the API gateway port.

## Replica set host

The replica set member is `127.0.0.1:27017`. Host drivers must use that host in `MONGO_URI`. `localhost` can fail server selection when it is not the advertised member.

Processes inside Compose use `mongodb://mongo:27017/?replicaSet=rs0&directConnection=true`. `directConnection` keeps them on the Docker DNS name instead of following the advertisement back to their own loopback.

A single node is enough for local multi-document transactions. It is not a production replica set.

## Kafka listeners

The broker advertises `localhost:9092` to host clients and `kafka:19092` to other containers. Topics are created with 3 partitions and replication factor 1. The names come from the event catalog. `scripts/infra-contract.test.ts` fails if the topic script drifts from that catalog.

## Seed and reset

`make seed` creates the six service databases and an `_platform` marker document in each. It also creates any missing Kafka topics. It does not insert users, products, stock, or orders.

`make reset` drops those databases, runs Redis `FLUSHALL`, deletes the catalog topics, and seeds them again. The Makefile passes `--yes`. A direct run without `--yes` refuses to wipe data.

`make infra-down` stops containers and keeps volumes. Changing the replica set host requires removing the `mongo-data` volume.

## Local-only exposure

MongoDB, Redis, and Kafka have no authentication in this Compose file. Redis is bound with protected mode off so containers can reach it. Do not publish this Compose file onto a shared network.

Container stdout is shipped to Loki. Processes started with `make dev` print logs in the terminal; Promtail does not see them.

## Service readiness

Container health checks prove the infrastructure process is up. `bootstrap()` then opens the clients that service is allowed to use and fails if one of them is down. `GET /health/readiness` pings those clients and returns 503 when a ping fails. `GET /health/liveness` stays process-only.

`createApp()` does not connect. The service unit tests use that path so they pass without Docker.

| Service              | Clients opened at startup |
| -------------------- | ------------------------- |
| api-gateway          | Redis                     |
| identity-service     | MongoDB                   |
| catalog-service      | MongoDB, Redis            |
| inventory-service    | MongoDB, Kafka            |
| order-service        | MongoDB, Kafka            |
| payment-service      | MongoDB, Kafka            |
| notification-service | MongoDB, Kafka            |

`make dev` therefore needs `make infra-up` first. A gateway process exits when Redis is down, even though the rate-limit and idempotency routes are still later work. `bootstrap()` starts OpenTelemetry before it opens clients. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to `http://localhost:4318` so traces and metrics reach the collector. Prometheus in Compose scrapes the collector. Each service also serves `GET /metrics`.

Identity also requires `secrets/jwt-private.pem` and `secrets/jwt-public.pem` (`make jwt-keys`). After MongoDB is primary, identity creates the user, refresh-token, and audit indexes and then listens.

Catalog opens MongoDB and Redis, creates the product and category indexes, and then listens. A Redis read or invalidation error is logged and ignored so MongoDB remains the source of truth. The cache TTL is 60 seconds.

Inventory opens MongoDB and Kafka, creates its indexes, starts the command consumer, sweeps expired reservations every 30 seconds, and dispatches its outbox about once a second. The sweep returns stock for active holds. It does not rely on a MongoDB TTL delete. A commit command marks the reservation `committed`, decreases `reserved`, and leaves `available` unchanged, so a confirmed order is not restocked when the hold would have expired. The released or reserved fact is stored in the outbox with the stock change.

Order opens MongoDB and Kafka, creates order, idempotency, inbox, and outbox indexes, and consumes `commerce.inventory.v1`, `commerce.payments.v1`, and the three order retry topics. The payment consumer uses its own group id, `${KAFKA_GROUP_ID}-payments`. Each retry topic uses `${KAFKA_GROUP_ID}-retry-1m`, `-retry-5m`, or `-retry-30m`. A sweep every 30 seconds resumes saga steps whose outbox row is missing. A future `nextAttemptAt` waits, and the short local delays also arm an in-process timer. `commerce.orders.dlq` is written to the outbox and not consumed. The outbox dispatcher publishes pending rows about once a second. Idempotency rows expire 24 hours after `expiresAt`. That TTL is safe because an expired key may be used for a new order. Reservation rows still do not use a TTL delete.

Payment opens MongoDB and Kafka, creates payment, inbox, and outbox indexes, consumes `commerce.payment.commands.v1`, and dispatches its outbox about once a second. `PAYMENT_FAILURE_MODE` is read at startup and defaults to `authorize`. An invalid value stops the process. The value itself is not written to the error.

## Application containers

`make apps-up` builds the seven service images and starts them with the infrastructure. `docker compose up -d` leaves the Node processes on the host so `make dev` can use the published ports.

Run `make jwt-keys` before the first container start. Identity mounts both PEM files at `/run/secrets`. The gateway mounts only the public key. The image does not contain those files.

The gateway reaches the other services by Compose DNS:

| Upstream  | URL                             |
| --------- | ------------------------------- |
| Identity  | `http://identity-service:3001`  |
| Catalog   | `http://catalog-service:3002`   |
| Inventory | `http://inventory-service:3003` |
| Order     | `http://order-service:3004`     |

Host development keeps `http://127.0.0.1` and the same ports. Payment HTTP stays on port 3005 in both layouts.

Each service image is `node:24`. The Dockerfile compiles the workspace once and the runtime command is `node apps/$SERVICE/dist/main.js`. `GET /health/readiness` is the container health check. Docker sends SIGTERM to the Node process, and the service stops consumers before it closes clients. Stop `make dev` before `make apps-up` so ports 3000–3006 are free.
