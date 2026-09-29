# ADR-004 Why an orchestration saga

## Context

An order reserves stock, takes payment, and must undo those steps when a later step fails. The current step has to be visible after a restart.

## Decision

The order service orchestrates the saga. State is a field on the order document. Transitions are a table: a signal either moves to one next state or is rejected with `409`.

## Alternatives

- Choreography, where each service decides the next command.
- A distributed transaction across stock and payment.
- One synchronous chain of HTTP calls inside the create-order request.

## Trade-offs

One service owns the workflow, so the state is easy to read and to resume. That service is on the path of every step. Choreography would spread the rules. A distributed transaction would couple the databases.

## Consequences

Payment authorization confirms the order. A decline or an inventory failure finishes as `failed` and releases stock. `order.cancelled` is published when a caller cancel finishes. The attempt counters and `nextAttemptAt` survive a process restart. Dead-lettering does not change the saga state.
