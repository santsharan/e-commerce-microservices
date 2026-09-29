import { generateKeyPairSync } from "node:crypto";
import { ServiceScope } from "@commerce-flow/auth";
import { describe, expect, it } from "vitest";
import { signServiceToken, verifyServiceToken } from "./service-token.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

describe("service tokens", () => {
  it("signs a short-lived inventory scope and rejects a user-shaped token", async () => {
    const token = await signServiceToken({
      privateKeyPem,
      issuer: "commerce-identity",
      audience: "inventory-service",
      subject: "order-service",
      scope: ServiceScope.inventoryReserve,
      jti: "jti-1",
      issuedAt: new Date(),
    });
    const claims = await verifyServiceToken(token, {
      publicKeyPem,
      issuer: "commerce-identity",
      audience: "inventory-service",
      scope: ServiceScope.inventoryReserve,
    });
    expect(claims).toMatchObject({
      sub: "order-service",
      aud: "inventory-service",
      scope: "inventory.reserve",
    });

    await expect(
      verifyServiceToken(token, {
        publicKeyPem,
        issuer: "commerce-identity",
        audience: "payment-service",
        scope: ServiceScope.inventoryReserve,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
