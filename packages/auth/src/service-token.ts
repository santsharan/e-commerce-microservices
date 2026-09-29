import { AppError, ErrorCode } from "@commerce-flow/errors";
import { importPKCS8, importSPKI, jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { ServiceScope } from "./index.js";

const clockToleranceSeconds = 5;
const serviceTokenTtlSeconds = 5 * 60;

export interface ServiceTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  jti: string;
  scope: ServiceScope;
}

export async function signServiceToken(input: {
  privateKeyPem: string;
  issuer: string;
  audience: string;
  subject: string;
  scope: ServiceScope;
  jti: string;
  issuedAt: Date;
}): Promise<string> {
  const issuedAtSeconds = Math.floor(input.issuedAt.getTime() / 1000);
  return new SignJWT({ scope: input.scope })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setSubject(input.subject)
    .setJti(input.jti)
    .setIssuedAt(issuedAtSeconds)
    .setNotBefore(issuedAtSeconds)
    .setExpirationTime(issuedAtSeconds + serviceTokenTtlSeconds)
    .sign(await importPKCS8(input.privateKeyPem, "RS256"));
}

/**
 * Verifies a short-lived service token.
 * User access tokens fail here because they do not carry `scope`.
 * The token text is not copied into the client error.
 */
export async function verifyServiceToken(
  token: string,
  options: { publicKeyPem: string; issuer: string; audience: string; scope: ServiceScope },
): Promise<ServiceTokenClaims> {
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
    return readServiceClaims(verified.payload, options.scope);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw unauthorized();
  }
}

function readServiceClaims(payload: JWTPayload, requiredScope: ServiceScope): ServiceTokenClaims {
  if (
    typeof payload.iss !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.nbf !== "number" ||
    typeof payload.aud !== "string"
  ) {
    throw unauthorized();
  }
  if (payload["scope"] !== requiredScope) {
    throw new AppError(ErrorCode.FORBIDDEN, "Forbidden", 403, {});
  }
  return {
    iss: payload.iss,
    aud: payload.aud,
    sub: payload.sub,
    exp: payload.exp,
    nbf: payload.nbf,
    jti: payload.jti,
    scope: requiredScope,
  };
}

function unauthorized(): AppError {
  return new AppError(ErrorCode.UNAUTHORIZED, "Authentication is required", 401, {});
}
