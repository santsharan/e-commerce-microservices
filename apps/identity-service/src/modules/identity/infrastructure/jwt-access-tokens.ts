import { Permission, Role, verifyAccessToken } from "@commerce-flow/auth";
import { importPKCS8, SignJWT, type CryptoKey as JoseCryptoKey } from "jose";
import { accessTokenTtlSeconds } from "../domain/policy.js";
import type { AccessTokenIssuer, IssuedAccessToken } from "../application/ports.js";
import type { IdentityKeys } from "./jwt-keys.js";

export class JwtAccessTokens implements AccessTokenIssuer {
  private privateKey: Promise<JoseCryptoKey> | undefined;

  public constructor(
    private readonly keys: IdentityKeys,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  public async issue(input: {
    subject: string;
    roles: readonly Role[];
    permissions: readonly Permission[];
    jti: string;
    issuedAt: Date;
  }): Promise<IssuedAccessToken> {
    const issuedAtSeconds = Math.floor(input.issuedAt.getTime() / 1000);
    const token = await new SignJWT({
      roles: [...input.roles],
      permissions: [...input.permissions],
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setSubject(input.subject)
      .setJti(input.jti)
      .setIssuedAt(issuedAtSeconds)
      .setNotBefore(issuedAtSeconds)
      .setExpirationTime(issuedAtSeconds + accessTokenTtlSeconds)
      .sign(await this.signingKey());
    return { token, expiresIn: accessTokenTtlSeconds };
  }

  public async verify(token: string): Promise<{ sub: string }> {
    const claims = await verifyAccessToken(token, {
      publicKeyPem: this.keys.publicPem(),
      issuer: this.issuer,
      audience: this.audience,
    });
    return { sub: claims.sub };
  }

  private signingKey(): Promise<JoseCryptoKey> {
    this.privateKey ??= importPKCS8(this.keys.privatePem(), "RS256");
    return this.privateKey;
  }
}
