import { randomUUID } from "node:crypto";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import type { Role } from "@commerce-flow/auth";
import { permissionsForRoles } from "../domain/grants.js";
import { passwordMaxLength, passwordMinLength } from "../domain/policy.js";
import {
  createRefreshToken,
  hashRefreshSecret,
  parseRefreshToken,
  refreshSecretsMatch,
} from "../domain/refresh-token.js";
import type {
  AccessTokenIssuer,
  AuditLog,
  Clock,
  PasswordHasher,
  RefreshTokenRepository,
  UserRecord,
  UserRepository,
} from "./ports.js";

const forbiddenMetadata = new Set([
  "password",
  "passwordHash",
  "accessToken",
  "refreshToken",
  "secret",
  "secretHash",
  "authorization",
]);

export interface PublicUser {
  id: string;
  email: string;
  roles: readonly Role[];
}

export interface SessionResponse {
  tokenType: "Bearer";
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

export interface UserProfile extends PublicUser {
  permissions: readonly string[];
}

export interface IdentityDependencies {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  audit: AuditLog;
  passwords: PasswordHasher;
  accessTokens: AccessTokenIssuer;
  clock: Clock;
}

function unauthorized(message: string): AppError {
  return new AppError(ErrorCode.UNAUTHORIZED, message, 401, {});
}

function safeMetadata(metadata: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!forbiddenMetadata.has(key)) {
      safe[key] = value;
    }
  }
  return safe;
}

export class IdentityApplication {
  public constructor(private readonly deps: IdentityDependencies) {}

  public async register(
    input: { email: string; password: string },
    requestId: string,
  ): Promise<SessionResponse> {
    const email = normalizeEmail(input.email);
    assertPassword(input.password);
    const now = this.deps.clock.now();
    const user: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash: await this.deps.passwords.hash(input.password),
      roles: ["customer"],
      createdAt: now,
    };
    await this.deps.users.insert(user);
    return this.openSession(user, randomUUID(), requestId, "user.registered", now);
  }

  public async login(
    input: { email: string; password: string },
    requestId: string,
  ): Promise<SessionResponse> {
    const email = normalizeEmail(input.email);
    const now = this.deps.clock.now();
    const user = await this.deps.users.findByEmail(email);
    const passwordHash = user?.passwordHash ?? (await this.deps.passwords.placeholderHash());
    const passwordMatches = await this.deps.passwords.verify(input.password, passwordHash);
    if (user === null || !passwordMatches) {
      await this.deps.audit.record({
        action: "user.login.failed",
        requestId,
        createdAt: now,
        metadata: safeMetadata({ email }),
      });
      throw unauthorized("Invalid email or password");
    }
    return this.openSession(user, randomUUID(), requestId, "user.login.succeeded", now);
  }

  public async refresh(refreshToken: string, requestId: string): Promise<SessionResponse> {
    const now = this.deps.clock.now();
    const current = await this.requireActiveToken(refreshToken, now, requestId);
    const user = await this.deps.users.findById(current.userId);
    if (user === null) {
      throw unauthorized("Authentication is required");
    }
    const next = createRefreshToken({ userId: user.id, familyId: current.familyId, now });
    const outcome = await this.deps.refreshTokens.rotate(current.tokenId, next.record, now);
    if (outcome === "rejected") {
      await this.revokeReusedFamily(current.familyId, requestId, now);
      throw unauthorized("Authentication is required");
    }
    const issued = await this.issueAccessToken(user, now);
    await this.deps.audit.record({
      action: "token.refreshed",
      actorId: user.id,
      requestId,
      createdAt: now,
      metadata: safeMetadata({ familyId: current.familyId }),
    });
    return this.session(user, issued.token, next.presented, issued.expiresIn);
  }

  public async logout(refreshToken: string, requestId: string): Promise<void> {
    const now = this.deps.clock.now();
    const parsed = parseRefreshToken(refreshToken);
    if (parsed === undefined) {
      throw unauthorized("Authentication is required");
    }
    const record = await this.deps.refreshTokens.findByTokenId(parsed.tokenId);
    if (
      record === null ||
      !refreshSecretsMatch(hashRefreshSecret(parsed.secret), record.secretHash)
    ) {
      throw unauthorized("Authentication is required");
    }
    const outcome = await this.deps.refreshTokens.revoke(record.tokenId, now);
    if (outcome === "missing") {
      throw unauthorized("Authentication is required");
    }
    await this.deps.audit.record({
      action: "user.logout",
      actorId: record.userId,
      requestId,
      createdAt: now,
      metadata: safeMetadata({ familyId: record.familyId }),
    });
  }

  public async currentUser(accessToken: string): Promise<UserProfile> {
    let subject: string;
    try {
      subject = (await this.deps.accessTokens.verify(accessToken)).sub;
    } catch {
      throw unauthorized("Authentication is required");
    }
    const user = await this.deps.users.findById(subject);
    if (user === null) {
      throw unauthorized("Authentication is required");
    }
    return {
      id: user.id,
      email: user.email,
      roles: user.roles,
      permissions: permissionsForRoles(user.roles),
    };
  }

  private async openSession(
    user: UserRecord,
    familyId: string,
    requestId: string,
    action: string,
    now: Date,
  ): Promise<SessionResponse> {
    const refresh = createRefreshToken({ userId: user.id, familyId, now });
    await this.deps.refreshTokens.insert(refresh.record);
    const issued = await this.issueAccessToken(user, now);
    await this.deps.audit.record({
      action,
      actorId: user.id,
      requestId,
      createdAt: now,
      metadata: {},
    });
    return this.session(user, issued.token, refresh.presented, issued.expiresIn);
  }

  private async issueAccessToken(
    user: UserRecord,
    now: Date,
  ): Promise<{ token: string; expiresIn: number }> {
    return this.deps.accessTokens.issue({
      subject: user.id,
      roles: user.roles,
      permissions: permissionsForRoles(user.roles),
      jti: randomUUID(),
      issuedAt: now,
    });
  }

  private session(
    user: UserRecord,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ): SessionResponse {
    return {
      tokenType: "Bearer",
      accessToken,
      refreshToken,
      expiresIn,
      user: { id: user.id, email: user.email, roles: user.roles },
    };
  }

  private async requireActiveToken(
    refreshToken: string,
    now: Date,
    requestId: string,
  ): Promise<{ tokenId: string; userId: string; familyId: string }> {
    const parsed = parseRefreshToken(refreshToken);
    if (parsed === undefined) {
      throw unauthorized("Authentication is required");
    }
    const record = await this.deps.refreshTokens.findByTokenId(parsed.tokenId);
    if (
      record === null ||
      !refreshSecretsMatch(hashRefreshSecret(parsed.secret), record.secretHash)
    ) {
      throw unauthorized("Authentication is required");
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
      throw unauthorized("Authentication is required");
    }
    if (record.revokedAt !== null) {
      await this.revokeReusedFamily(record.familyId, requestId, now);
      throw unauthorized("Authentication is required");
    }
    return record;
  }

  private async revokeReusedFamily(familyId: string, requestId: string, now: Date): Promise<void> {
    await this.deps.refreshTokens.revokeFamily(familyId, now);
    await this.deps.audit.record({
      action: "token.reuse_detected",
      requestId,
      createdAt: now,
      metadata: safeMetadata({ familyId }),
    });
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0 || !normalized.includes("@")) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["email"] });
  }
  return normalized;
}

function assertPassword(password: string): void {
  if (password.length < passwordMinLength || password.length > passwordMaxLength) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["password"],
    });
  }
}
