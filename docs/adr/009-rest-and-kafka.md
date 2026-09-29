# ADR-009 Why REST and Kafka

## Context

Clients need a request they can retry and an error they can read. The services need a workflow that continues after the HTTP response.

## Decision

Clients call REST under `/api/v1`. The gateway is the public edge. After an order is accepted, inventory and payment move through Kafka commands and facts. Payment HTTP stays on the payment service. The provider is an in-process mock: it does not call Stripe and it does not store card data.

## Alternatives

- GraphQL for every read and write.
- gRPC between the browser and the services.
- A synchronous HTTP call from the order service to payment inside the create request.

## Trade-offs

REST is easy to document and to replay with an idempotency key. The client does not see the intermediate saga steps unless it reads the order. Kafka adds latency of about a dispatcher interval.

## Consequences

The public OpenAPI document describes the gateway. Service ports remain available on the private network. A card field on a payment request is rejected. `PAYMENT_FAILURE_MODE` and `simulate` choose authorize or decline for the mock.
