# Threat model

This note describes the trust boundaries Commerce Flow enforces today. It uses OWASP ASVS 5.0 as a vocabulary for authentication, session management, access control, and validation. It is not an ASVS certification.

## Assets

- Passwords and refresh tokens
- Access tokens and service tokens
- Orders, payments, and inventory counts
- Catalog data and customer identity

## Actors

- A customer using the public gateway
- Support and admin users
- The order service, as a caller of inventory over Kafka
- Someone who can reach a service port directly

## Trust boundaries

- Browsers and public clients stop at the API gateway.
- The gateway verifies RS256 access tokens and applies the permission on the route.
- Identity is the only service that stores passwords and refresh tokens.
- Order idempotency lives in `order-db`. Redis counts login attempts and caches catalog reads. It is not the order, payment, inventory, or user record.
- Kafka is the service bus. Commands on that bus are not wrapped in a service token yet.

## Threats and mitigations

| Threat                                   | Mitigation                                                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password theft                           | Argon2id. The hash is not returned by the API.                                                                                                        |
| Access-token theft                       | Access tokens last 15 minutes. The token text is not copied into errors or logs.                                                                      |
| Refresh-token reuse                      | Rotation. Reuse revokes the token family.                                                                                                             |
| Login brute force                        | The gateway allows 10 login, register, or refresh attempts per IP each minute, counted in Redis.                                                      |
| Forged customer id                       | The gateway replaces `customerId` with the token subject for customers. The order service hides an order when `x-user-id` names a different customer. |
| Unauthorized catalog or inventory writes | The gateway requires `products:write` or `inventory:write`.                                                                                           |
| Dead-letter replay by a customer         | `POST /api/v1/orders/:id/retries` requires the admin role.                                                                                            |
| Duplicate order                          | `Idempotency-Key` is stored with the order in MongoDB. The gateway forwards the header and does not keep a second copy in Redis.                      |
| Duplicate Kafka delivery                 | The inbox unique key is `(eventId, consumer)`.                                                                                                        |
| Lost event                               | The outbox row commits with the business write.                                                                                                       |
| Sensitive logs                           | Pino redacts passwords, tokens, authorization headers, and card numbers.                                                                              |
| Clickjacking and content sniffing        | Gateway responses set `nosniff`, `DENY` framing, `no-referrer`, and `default-src 'none'`. Production also sets HSTS.                                  |
| Cross-origin reads                       | `CORS_ORIGINS` lists the allowed browser origins. An origin that is not listed receives no allow header.                                              |

## Service tokens

A service token is a 5-minute RS256 JWT. `iss` is the identity issuer, `aud` is the called service, `sub` is the caller, and `scope` is `inventory.reserve`. `verifyServiceToken` checks those claims. Identity does not offer a public route that issues one. Production service identity should be mTLS. The local signer exists so that check can be tested without treating the Docker network as trusted.

Kafka commands do not carry that token yet. A caller who can reach the inventory HTTP port without going through the gateway is still unauthenticated. Bind those ports to a private network.

## Residual risks

- Service ports for identity, catalog, inventory, orders, and payments do not require a token. The gateway is the public control.
- There is still no public way to create an admin or support user. Self-registration stores `customer`.
- Payment HTTP, including `simulate`, is not proxied. It remains on the payment port.
- A confirmed order can still lose stock if the reservation sweep runs before the inventory commit.
