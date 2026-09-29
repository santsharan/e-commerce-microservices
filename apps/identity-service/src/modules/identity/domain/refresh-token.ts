import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { refreshTokenTtlSeconds } from "./policy.js";

export interface RefreshTokenRecord {
  tokenId: string;
  secretHash: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
  createdAt: Date;
}

export function hashRefreshSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function refreshSecretsMatch(actualHash: string, expectedHash: string): boolean {
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length === 0 || actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

export function parseRefreshToken(token: string): { tokenId: string; secret: string } | undefined {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return undefined;
  }
  const tokenId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokenId)) {
    return undefined;
  }
  if (secret.length === 0) {
    return undefined;
  }
  return { tokenId, secret };
}

export function createRefreshToken(input: { userId: string; familyId: string; now: Date }): {
  presented: string;
  record: RefreshTokenRecord;
} {
  const tokenId = randomUUID();
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  return {
    presented: `${tokenId}.${secret}`,
    record: {
      tokenId,
      secretHash: hashRefreshSecret(secret),
      userId: input.userId,
      familyId: input.familyId,
      expiresAt: new Date(input.now.getTime() + refreshTokenTtlSeconds * 1000),
      revokedAt: null,
      replacedByTokenId: null,
      createdAt: input.now,
    },
  };
}
