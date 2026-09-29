import { generateKeyPairSync } from "node:crypto";
import { Permission, Role } from "@commerce-flow/auth";
import { SignJWT, importPKCS8 } from "jose";
import { describe, expect, it } from "vitest";
import { GatewayProxy, type UpstreamResponse } from "./gateway-proxy.js";
import { upstreams } from "../domain/upstreams.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

async function token(
  permissions: readonly string[],
  roles: readonly string[] = [Role.customer],
): Promise<string> {
  const key = await importPKCS8(privateKeyPem, "RS256");
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ roles: [...roles], permissions: [...permissions] })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("commerce-identity")
    .setAudience("commerce-api")
    .setSubject("user-1")
    .setJti("jti-1")
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(issuedAt + 60)
    .sign(key);
}

function proxy(
  fetchImpl: (url: string, init: RequestInit) => Promise<UpstreamResponse>,
): GatewayProxy {
  return new GatewayProxy({
    upstreams: upstreams("http://127.0.0.1"),
    publicKeyPem: () => publicKeyPem,
    issuer: "commerce-identity",
    audience: "commerce-api",
    rateLimit: {
      async increment() {
        return 1;
      },
    },
    fetch: fetchImpl,
  });
}

describe("gateway proxy", () => {
  it("forwards login without a token and rewrites a customer order", async () => {
    const calls: { url: string; body?: string; headers: Headers }[] = [];
    const app = proxy(async (url, init) => {
      calls.push({
        url,
        body: typeof init.body === "string" ? init.body : undefined,
        headers: new Headers(init.headers),
      });
      return {
        status: 201,
        headers: { get: (name) => (name === "etag" ? '"1"' : "application/json") },
        text: async () => '{"id":"order-1"}',
      };
    });

    const login = await app.handle({
      method: "POST",
      path: "/api/v1/users/login",
      query: {},
      body: { email: "ada@example.com", password: "correct-horse" },
      headers: {},
      ip: "127.0.0.1",
    });
    expect(login.status).toBe(201);
    expect(calls[0]?.url).toBe("http://127.0.0.1:3001/api/v1/users/login");
    expect(calls[0]?.headers.get("authorization")).toBeNull();

    const access = await token([Permission.ordersWrite, Permission.ordersRead]);
    const created = await app.handle({
      method: "POST",
      path: "/api/v1/orders",
      query: {},
      body: { customerId: "someone-else", currency: "USD", items: [] },
      headers: { authorization: `Bearer ${access}`, "idempotency-key": "key-1" },
      ip: "127.0.0.1",
    });
    expect(created.status).toBe(201);
    expect(created.headers["etag"]).toBe('"1"');
    expect(calls[1]?.url).toBe("http://127.0.0.1:3004/api/v1/orders");
    expect(JSON.parse(calls[1]?.body ?? "{}")).toMatchObject({ customerId: "user-1" });
    expect(calls[1]?.headers.get("idempotency-key")).toBe("key-1");
    expect(calls[1]?.headers.get("x-user-id")).toBe("user-1");
    expect(calls[1]?.headers.get("authorization")).toBeNull();

    const profile = await app.handle({
      method: "GET",
      path: "/api/v1/users/me",
      query: {},
      body: undefined,
      headers: { authorization: `Bearer ${access}` },
      ip: "127.0.0.1",
    });
    expect(profile.status).toBe(201);
    expect(calls[2]?.url).toBe("http://127.0.0.1:3001/api/v1/users/me");
    expect(calls[2]?.headers.get("authorization")).toBe(`Bearer ${access}`);
    expect(calls[2]?.headers.get("x-user-id")).toBe("user-1");
  });

  it("rejects a missing token and a customer who retries a dead letter", async () => {
    const app = proxy(async () => {
      throw new Error("upstream should not be called");
    });
    await expect(
      app.handle({
        method: "POST",
        path: "/api/v1/orders",
        query: {},
        body: {},
        headers: {},
        ip: "127.0.0.1",
      }),
    ).rejects.toMatchObject({ statusCode: 401 });

    const access = await token([Permission.ordersWrite]);
    await expect(
      app.handle({
        method: "POST",
        path: "/api/v1/orders/order-1/retries",
        query: {},
        body: {},
        headers: { authorization: `Bearer ${access}` },
        ip: "127.0.0.1",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("stops login after the budget is spent", async () => {
    let count = 0;
    const app = new GatewayProxy({
      upstreams: upstreams("http://127.0.0.1"),
      publicKeyPem: () => publicKeyPem,
      issuer: "commerce-identity",
      audience: "commerce-api",
      rateLimit: {
        async increment() {
          count += 1;
          return count;
        },
      },
      fetch: async () => ({ status: 200, headers: { get: () => null }, text: async () => "{}" }),
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await app.handle({
        method: "POST",
        path: "/api/v1/users/login",
        query: {},
        body: {},
        headers: {},
        ip: "10.0.0.8",
      });
    }
    await expect(
      app.handle({
        method: "POST",
        path: "/api/v1/users/login",
        query: {},
        body: {},
        headers: {},
        ip: "10.0.0.8",
      }),
    ).rejects.toMatchObject({ statusCode: 429, code: "RATE_LIMITED" });
  });
});
