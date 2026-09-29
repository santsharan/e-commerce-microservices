import { AppError, ErrorCode } from "@commerce-flow/errors";
import { importSPKI, jwtVerify, type JWTPayload } from "jose";
import { Permission, Role, type AccessTokenClaims } from "./index.js";

/** Small clock skew allowance. It is not a token lifetime. */
const clockToleranceSeconds = 5;

// Built on first use. This module is re-exported by the file that defines Role,
// so reading those objects at import time runs before they are initialized.
let roles: Set<string> | undefined;
let permissions: Set<string> | undefined;

function knownRoles(): Set<string> {
  roles ??= new Set(Object.values(Role));
  return roles;
}

function knownPermissions(): Set<string> {
  permissions ??= new Set(Object.values(Permission));
  return permissions;
}

export interface VerifyAccessTokenOptions {
  publicKeyPem: string;
  issuer: string;
  audience: string;
}

export async function assertSpki(publicKeyPem: string): Promise<void> {
  try {
    await importSPKI(publicKeyPem, "RS256");
  } catch {
    throw new AppError(ErrorCode.CONFIG_INVALID, "JWT public key is invalid", 500, {
      fields: ["JWT_PUBLIC_KEY_PATH"],
    });
  }
}

function unauthorized(): AppError {
  return new AppError(ErrorCode.UNAUTHORIZED, "Authentication is required", 401, {});
}

function isRole(value: string): value is Role {
  return knownRoles().has(value);
}

function isPermission(value: string): value is Permission {
  return knownPermissions().has(value);
}

function claimList(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    return undefined;
  }
  return value;
}

function readClaims(payload: JWTPayload): AccessTokenClaims {
  if (typeof payload.iss !== "string" || payload.iss.length === 0) {
    throw unauthorized();
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw unauthorized();
  }
  if (typeof payload.jti !== "string" || payload.jti.length === 0) {
    throw unauthorized();
  }
  if (typeof payload.exp !== "number" || typeof payload.nbf !== "number") {
    throw unauthorized();
  }
  if (payload.aud === undefined) {
    throw unauthorized();
  }

  const roleClaim = claimList(payload["roles"]);
  const permissionClaim = claimList(payload["permissions"]);
  if (roleClaim === undefined || roleClaim.length === 0 || !roleClaim.every(isRole)) {
    throw unauthorized();
  }
  if (permissionClaim === undefined || !permissionClaim.every(isPermission)) {
    throw unauthorized();
  }

  return {
    iss: payload.iss,
    aud: payload.aud,
    exp: payload.exp,
    nbf: payload.nbf,
    sub: payload.sub,
    jti: payload.jti,
    roles: roleClaim,
    permissions: permissionClaim,
  };
}

/**
 * Verifies an RS256 access token.
 * The token and the verification failure reason stay off the client error.
 * Role-to-permission grants are not decided here.
 */
export async function verifyAccessToken(
  token: string,
  options: VerifyAccessTokenOptions,
): Promise<AccessTokenClaims> {
  if (token.trim().length === 0) {
    throw unauthorized();
  }

  let key: Awaited<ReturnType<typeof importSPKI>>;
  try {
    key = await importSPKI(options.publicKeyPem, "RS256");
  } catch {
    throw new AppError(ErrorCode.CONFIG_INVALID, "JWT public key is invalid", 500, {
      fields: ["JWT_PUBLIC_KEY"],
    });
  }

  try {
    const verified = await jwtVerify(token, key, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ["RS256"],
      clockTolerance: clockToleranceSeconds,
      requiredClaims: ["iss", "aud", "exp", "nbf", "sub", "jti"],
    });
    return readClaims(verified.payload);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw unauthorized();
  }
}
