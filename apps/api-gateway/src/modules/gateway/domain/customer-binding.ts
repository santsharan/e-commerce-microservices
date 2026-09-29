import { Role, hasRole, type AccessTokenClaims } from "@commerce-flow/auth";

/**
 * Customers can only act as themselves.
 * Admin and support may name another customer where the route already allows it.
 */
export function bindCustomer(input: {
  method: string;
  path: string;
  claims: AccessTokenClaims;
  body: unknown;
  query: Record<string, string>;
}): { body: unknown; query: Record<string, string> } {
  const privileged =
    hasRole(input.claims.roles, Role.admin) || hasRole(input.claims.roles, Role.support);
  const path = input.path.split("?")[0] ?? input.path;
  if (privileged) {
    return { body: input.body, query: input.query };
  }
  if (input.method === "POST" && path === "/api/v1/orders" && isRecord(input.body)) {
    return { body: { ...input.body, customerId: input.claims.sub }, query: input.query };
  }
  if (input.method === "GET" && path === "/api/v1/orders") {
    return { body: input.body, query: { ...input.query, customerId: input.claims.sub } };
  }
  return { body: input.body, query: input.query };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
