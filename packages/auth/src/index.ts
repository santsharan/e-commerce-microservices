/**
 * Authentication contracts and RS256 access-token verification.
 * Signing, Argon2id hashing, and refresh-token storage stay in the identity service.
 * This package does not decide which role receives which permission.
 */

export const Role = {
  customer: "customer",
  admin: "admin",
  support: "support",
  service: "service",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const Permission = {
  productsRead: "products:read",
  productsWrite: "products:write",
  ordersRead: "orders:read",
  ordersWrite: "orders:write",
  ordersCancel: "orders:cancel",
  inventoryRead: "inventory:read",
  inventoryWrite: "inventory:write",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/**
 * The only service scope named by the architecture so far.
 * Additional scopes are added with the command they authorize.
 */
export const ServiceScope = {
  inventoryReserve: "inventory.reserve",
} as const;

export type ServiceScope = (typeof ServiceScope)[keyof typeof ServiceScope];

/**
 * Claims every access token must carry.
 * The identity service validates iss, aud, exp, nbf, sub, and jti.
 * Role-to-permission grants are owned by identity, not hardcoded here.
 */
export interface AccessTokenClaims {
  iss: string;
  aud: string | readonly string[];
  exp: number;
  nbf: number;
  sub: string;
  jti: string;
  roles: readonly Role[];
  permissions: readonly Permission[];
}

export function hasPermission(granted: readonly string[], required: string): boolean {
  return granted.includes(required);
}

export function hasRole(roles: readonly string[], role: Role): boolean {
  return roles.includes(role);
}

export {
  verifyAccessToken,
  assertSpki,
  type VerifyAccessTokenOptions,
} from "./verify-access-token.js";
export { signServiceToken, verifyServiceToken, type ServiceTokenClaims } from "./service-token.js";
