import { Permission, Role, hasPermission, hasRole } from "@commerce-flow/auth";

export type RouteRule =
  | { kind: "public" }
  | { kind: "user" }
  | { kind: "permission"; permission: Permission }
  | { kind: "admin" };

const catalogRead = { kind: "permission", permission: Permission.productsRead } as const;
const catalogWrite = { kind: "permission", permission: Permission.productsWrite } as const;
const inventoryRead = { kind: "permission", permission: Permission.inventoryRead } as const;
const inventoryWrite = { kind: "permission", permission: Permission.inventoryWrite } as const;

/**
 * Public route policy for the gateway.
 * Payment HTTP stays off this edge. The order saga talks to payment on Kafka.
 * Dead-letter replay has no permission of its own, so it requires the admin role.
 */
export function routeRule(method: string, path: string): RouteRule | undefined {
  const normalized = path.split("?")[0] ?? path;
  if (
    method === "POST" &&
    isOneOf(normalized, ["/api/v1/users/register", "/api/v1/users/login", "/api/v1/users/refresh"])
  ) {
    return { kind: "public" };
  }
  if (
    (method === "POST" && normalized === "/api/v1/users/logout") ||
    (method === "GET" && normalized === "/api/v1/users/me")
  ) {
    return { kind: "user" };
  }
  if (normalized === "/api/v1/products" || normalized.startsWith("/api/v1/products/")) {
    return method === "GET" ? catalogRead : catalogWrite;
  }
  if (normalized === "/api/v1/categories" || normalized.startsWith("/api/v1/categories/")) {
    return method === "GET" ? catalogRead : catalogWrite;
  }
  if (normalized === "/api/v1/orders" && method === "GET") {
    return { kind: "permission", permission: Permission.ordersRead };
  }
  if (normalized === "/api/v1/orders" && method === "POST") {
    return { kind: "permission", permission: Permission.ordersWrite };
  }
  if (/^\/api\/v1\/orders\/[^/]+$/.test(normalized) && method === "GET") {
    return { kind: "permission", permission: Permission.ordersRead };
  }
  if (/^\/api\/v1\/orders\/[^/]+\/cancel$/.test(normalized) && method === "POST") {
    return { kind: "permission", permission: Permission.ordersCancel };
  }
  if (/^\/api\/v1\/orders\/[^/]+\/retries$/.test(normalized) && method === "POST") {
    return { kind: "admin" };
  }
  if (normalized === "/api/v1/inventory" || normalized.startsWith("/api/v1/inventory/")) {
    return method === "GET" ? inventoryRead : inventoryWrite;
  }
  return undefined;
}

export function allows(
  rule: RouteRule,
  roles: readonly string[],
  permissions: readonly string[],
): boolean {
  if (rule.kind === "public" || rule.kind === "user") {
    return true;
  }
  if (rule.kind === "admin") {
    return hasRole(roles, Role.admin);
  }
  return hasPermission(permissions, rule.permission);
}

function isOneOf(path: string, expected: readonly string[]): boolean {
  return expected.includes(path);
}
