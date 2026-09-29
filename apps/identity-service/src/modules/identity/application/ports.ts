import type { Permission, Role } from "@commerce-flow/auth";
import type { RefreshTokenRecord } from "../domain/refresh-token.js";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  roles: readonly Role[];
  createdAt: Date;
}

export interface UserRepository {
  insert(user: UserRecord): Promise<void>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

export interface RefreshTokenRepository {
  insert(record: RefreshTokenRecord): Promise<void>;
  findByTokenId(tokenId: string): Promise<RefreshTokenRecord | null>;
  rotate(
    currentTokenId: string,
    replacement: RefreshTokenRecord,
    now: Date,
  ): Promise<"rotated" | "rejected">;
  revoke(tokenId: string, now: Date): Promise<"revoked" | "already" | "missing">;
  revokeFamily(familyId: string, now: Date): Promise<void>;
}

export interface AuditEntry {
  action: string;
  actorId?: string;
  requestId: string;
  createdAt: Date;
  metadata: Record<string, string>;
}

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
  /** Stable hash used when the email is unknown, so login cost does not reveal that. */
  placeholderHash(): Promise<string>;
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<{ sub: string }>;
}

export interface AccessTokenIssuer extends AccessTokenVerifier {
  issue(input: {
    subject: string;
    roles: readonly Role[];
    permissions: readonly Permission[];
    jti: string;
    issuedAt: Date;
  }): Promise<IssuedAccessToken>;
}

export interface Clock {
  now(): Date;
}
