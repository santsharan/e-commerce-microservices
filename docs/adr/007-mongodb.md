# ADR-007 Why MongoDB

## Context

Orders, reservations, and payments are documents that change a few fields at a time. The outbox row has to commit with that document.

## Decision

MongoDB 8 is the system of record. The deployment is a replica set so multi-document transactions work. Money is an integer in minor units. Updates check a version, and `If-Match` carries that version on HTTP writes that need it.

## Alternatives

- A relational database with one transaction per service.
- A document store that cannot run a multi-document transaction.

## Trade-offs

The document shape matches the order and the product. Transactions need a replica set, including the single-node local set `rs0`. Cross-service joins are not a feature.

## Consequences

Local host clients use `127.0.0.1:27017` because that is the advertised member. Containers use `directConnection` so they stay on the Docker DNS name. Duplicate key `11000` is mapped to a domain error and is not returned to the client.
