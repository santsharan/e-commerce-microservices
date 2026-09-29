import { exportSPKI, generateKeyPair, SignJWT, type KeyInput } from "jose";
import { describe, expect, it } from "vitest";
import { verifyAccessToken } from "./verify-access-token.js";

const issuer = "commerce-identity";
const audience = "commerce-api";

async function token(input: {
  privateKey: KeyInput;
  expiresIn?: string | number;
  claims?: Record<string, unknown>;
  omitJti?: boolean;
  algorithm?: "RS256" | "HS256";
}): Promise<string> {
  const builder = new SignJWT({
    roles: ["customer"],
    permissions: ["orders:read"],
    ...input.claims,
  })
    .setProtectedHeader({ alg: input.algorithm ?? "RS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("user-1")
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1000) - 10)
    .setExpirationTime(input.expiresIn ?? "15m");
  if (input.omitJti !== true) {
    builder.setJti("jti-1");
  }
  return builder.sign(input.privateKey);
}

describe("access token verification", () => {
  it("accepts an RS256 token and rejects bad signatures, expiry, and claims", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const publicKeyPem = await exportSPKI(publicKey);
    const options = { publicKeyPem, issuer, audience };
    const accessToken = await token({ privateKey });

    await expect(verifyAccessToken(accessToken, options)).resolves.toMatchObject({
      iss: issuer,
      aud: audience,
      sub: "user-1",
      jti: "jti-1",
      roles: ["customer"],
      permissions: ["orders:read"],
    });

    const expired = await token({ privateKey, expiresIn: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifyAccessToken(expired, options)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Authentication is required",
      details: {},
    });

    await expect(
      verifyAccessToken(accessToken, { ...options, audience: "other" }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    const missingJti = await token({ privateKey, omitJti: true });
    await expect(verifyAccessToken(missingJti, options)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    await expect(
      verifyAccessToken(await token({ privateKey, claims: { roles: ["owner"] } }), options),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await expect(
      verifyAccessToken(
        await token({ privateKey, claims: { permissions: ["orders:steal"] } }),
        options,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url");
    await expect(verifyAccessToken(`${header}.${payload}.`, options)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    await expect(
      verifyAccessToken(accessToken, { ...options, publicKeyPem: "not-a-key" }),
    ).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      details: { fields: ["JWT_PUBLIC_KEY"] },
    });
  });
});
