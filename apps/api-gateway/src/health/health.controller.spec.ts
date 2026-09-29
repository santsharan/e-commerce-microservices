import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createTestEnv } from "@commerce-flow/test-utils";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../bootstrap/server.js";

describe("api-gateway health", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    Object.assign(process.env, createTestEnv({ SERVICE_NAME: "api-gateway" }));
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports the process as live", async () => {
    const response = await request(app.getHttpServer()).get("/health/liveness");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });

  it("reports process readiness without dependency checks", async () => {
    const response = await request(app.getHttpServer()).get("/health/readiness");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", checks: { process: "ok" } });
  });

  it("returns 503 when an attached dependency is down", async () => {
    const { ResourceRegistry } = await import("../bootstrap/resources.js");
    app.get(ResourceRegistry).attach({
      profile: { mongo: false, redis: true, kafka: false },
      async ping() {
        return { process: "ok", redis: "unavailable" };
      },
      async close() {
        return undefined;
      },
    });

    const response = await request(app.getHttpServer()).get("/health/readiness");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "unavailable",
      checks: { process: "ok", redis: "unavailable" },
    });
  });

  it("returns prometheus text from /metrics", async () => {
    const response = await request(app.getHttpServer()).get("/metrics");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("telemetry is not started");
  });

  it("returns the public error envelope for unknown routes", async () => {
    const response = await request(app.getHttpServer()).get("/missing");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toMatch(/stack|mongo/i);
  });

  it("routes versioned API paths through the gateway allowlist", async () => {
    const register = await request(app.getHttpServer())
      .post("/api/v1/users/register")
      .send({ email: "ada@example.com", password: "correct-horse-battery" });
    expect(register.status).toBe(503);
    expect(register.body.error.code).toBe("DEPENDENCY_UNAVAILABLE");

    const order = await request(app.getHttpServer()).post("/api/v1/orders").send({});
    expect(order.status).toBe(401);
    expect(order.body.error.code).toBe("UNAUTHORIZED");

    const payment = await request(app.getHttpServer())
      .post("/api/v1/payments/authorizations")
      .send({});
    expect(payment.status).toBe(404);
    expect(payment.body.error.code).toBe("NOT_FOUND");
  });
});
