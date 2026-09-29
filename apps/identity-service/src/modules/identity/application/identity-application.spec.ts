import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { verifyAccessToken } from "@commerce-flow/auth";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { describe, expect, it } from "vitest";
import { IdentityApplication } from "./identity-application.js";
import type {
  AuditEntry,
  AuditLog,
  RefreshTokenRepository,
  UserRecord,
  UserRepository,
} from "./ports.js";
import type { RefreshTokenRecord } from "../domain/refresh-token.js";
import { accessTokenTtlSeconds } from "../domain/policy.js";
import { Argon2PasswordHasher } from "../infrastructure/argon2-password-hasher.js";
import { JwtAccessTokens } from "../infrastructure/jwt-access-tokens.js";
import { IdentityKeys } from "../infrastructure/jwt-keys.js";

const password = "correct-horse";
const issuer = "commerce-identity";
const audience = "commerce-api";

class MemoryUsers implements UserRepository {
  private readonly byEmail = new Map<string, UserRecord>();
  private readonly byId = new Map<string, UserRecord>();

  public async insert(user: UserRecord): Promise<void> {
    if (this.byEmail.has(user.email)) {
      throw new AppError(ErrorCode.CONFLICT, "An account with this email already exists", 409, {});
    }
    this.byEmail.set(user.email, user);
    this.byId.set(user.id, user);
  }

  public async findByEmail(email: string): Promise<UserRecord | null> {
    return this.byEmail.get(email) ?? null;
  }

  public async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  public passwordHashes(): string[] {
    return [...this.byId.values()].map((user) => user.passwordHash);
  }
}

class MemoryRefreshTokens implements RefreshTokenRepository {
  private readonly records = new Map<string, RefreshTokenRecord>();

  public async insert(record: RefreshTokenRecord): Promise<void> {
    this.records.set(record.tokenId, { ...record });
  }

  public async findByTokenId(tokenId: string): Promise<RefreshTokenRecord | null> {
    const found = this.records.get(tokenId);
    return found === undefined ? null : { ...found };
  }

  public async rotate(
    currentTokenId: string,
    replacement: RefreshTokenRecord,
    now: Date,
  ): Promise<"rotated" | "rejected"> {
    const current = this.records.get(currentTokenId);
    if (
      current === undefined ||
      current.revokedAt !== null ||
      current.expiresAt.getTime() <= now.getTime()
    ) {
      return "rejected";
    }
    current.revokedAt = now;
    current.replacedByTokenId = replacement.tokenId;
    this.records.set(replacement.tokenId, { ...replacement });
    return "rotated";
  }

  public async revoke(tokenId: string, now: Date): Promise<"revoked" | "already" | "missing"> {
    const current = this.records.get(tokenId);
    if (current === undefined) {
      return "missing";
    }
    if (current.revokedAt !== null) {
      return "already";
    }
    current.revokedAt = now;
    return "revoked";
  }

  public async revokeFamily(familyId: string, now: Date): Promise<void> {
    for (const record of this.records.values()) {
      if (record.familyId === familyId && record.revokedAt === null) {
        record.revokedAt = now;
      }
    }
  }

  public hashes(): string[] {
    return [...this.records.values()].map((record) => record.secretHash);
  }
}

class MemoryAudit implements AuditLog {
  public readonly entries: AuditEntry[] = [];

  public async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function keys(): IdentityKeys {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const holder = new IdentityKeys();
  holder.attach({
    privatePem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  return holder;
}

function application(clock: { now(): Date }): {
  identity: IdentityApplication;
  users: MemoryUsers;
  tokens: MemoryRefreshTokens;
  audit: MemoryAudit;
  publicPem: string;
} {
  const holder = keys();
  const users = new MemoryUsers();
  const tokens = new MemoryRefreshTokens();
  const audit = new MemoryAudit();
  return {
    users,
    tokens,
    audit,
    publicPem: holder.publicPem(),
    identity: new IdentityApplication({
      users,
      refreshTokens: tokens,
      audit,
      passwords: new Argon2PasswordHasher(),
      accessTokens: new JwtAccessTokens(holder, issuer, audience),
      clock,
    }),
  };
}

describe("identity application", () => {
  it("registers a customer, verifies the access token, and hides the password", async () => {
    const now = new Date();
    const { identity, users, tokens, audit, publicPem } = application({ now: () => now });
    const session = await identity.register({ email: "Ada@Example.com", password }, "req-1");
    expect(users.passwordHashes()[0]?.startsWith("$argon2id$")).toBe(true);

    expect(session.user).toMatchObject({ email: "ada@example.com", roles: ["customer"] });
    expect(session.expiresIn).toBe(accessTokenTtlSeconds);
    expect(session.refreshToken).not.toContain(password);
    expect(tokens.hashes().some((hash) => session.refreshToken.includes(hash))).toBe(false);
    expect(JSON.stringify(audit.entries)).not.toContain(password);

    const claims = await verifyAccessToken(session.accessToken, {
      publicKeyPem: publicPem,
      issuer,
      audience,
    });
    expect(claims.sub).toBe(session.user.id);
    expect(claims.permissions).toContain("orders:write");
    expect(claims.permissions).not.toContain("products:write");
    expect(claims.exp - claims.nbf).toBe(accessTokenTtlSeconds);

    await expect(
      identity.register({ email: "ada@example.com", password }, "req-2"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("uses the same error for a bad password and an unknown email", async () => {
    const { identity, audit } = application({ now: () => new Date() });
    await identity.register({ email: "ada@example.com", password }, "req-1");

    await expect(
      identity.login({ email: "ada@example.com", password: "wrong-password" }, "req-2"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    await expect(
      identity.login({ email: "missing@example.com", password }, "req-3"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    expect(JSON.stringify(audit.entries)).not.toContain("wrong-password");
    expect(JSON.stringify(audit.entries)).not.toContain(password);
  });

  it("rotates refresh tokens and revokes the family when an old token is reused", async () => {
    const { identity, audit } = application({ now: () => new Date() });
    const session = await identity.register({ email: "ada@example.com", password }, "req-1");
    const rotated = await identity.refresh(session.refreshToken, "req-2");

    await expect(identity.refresh(session.refreshToken, "req-3")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(identity.refresh(rotated.refreshToken, "req-4")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(audit.entries.map((entry) => entry.action)).toContain("token.reuse_detected");
    expect(JSON.stringify(audit.entries)).not.toContain(session.refreshToken);
  });

  it("logout revokes the presented refresh token", async () => {
    const { identity } = application({ now: () => new Date() });
    const session = await identity.register({ email: "ada@example.com", password }, "req-1");
    await identity.logout(session.refreshToken, "req-2");
    await expect(identity.refresh(session.refreshToken, "req-3")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("returns the current grants for a valid access token", async () => {
    const { identity } = application({ now: () => new Date() });
    const session = await identity.register({ email: "ada@example.com", password }, "req-1");
    await expect(identity.currentUser(session.accessToken)).resolves.toMatchObject({
      email: "ada@example.com",
      roles: ["customer"],
      permissions: expect.arrayContaining(["orders:read"]),
    });
    await expect(identity.currentUser("not-a-token")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("key files", () => {
  it("rejects a directory that is not a PEM without echoing file contents", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "identity-keys-"));
    const privatePath = path.join(directory, "private.pem");
    const publicPath = path.join(directory, "public.pem");
    const secret = "not-a-pem-secret";
    writeFileSync(privatePath, secret);
    writeFileSync(publicPath, secret);
    const { loadIdentityKeys } = await import("../infrastructure/jwt-keys.js");
    await expect(
      loadIdentityKeys({ privateKeyPath: privatePath, publicKeyPath: publicPath }),
    ).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: "JWT signing keys are invalid",
    });
    try {
      await loadIdentityKeys({ privateKeyPath: privatePath, publicKeyPath: publicPath });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});
