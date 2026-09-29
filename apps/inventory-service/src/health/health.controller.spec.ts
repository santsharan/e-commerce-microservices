import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createTestEnv } from "@commerce-flow/test-utils";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../bootstrap/server.js";

describe("inventory-service health", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    Object.assign(process.env, createTestEnv({ SERVICE_NAME: "inventory-service" }));
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
  });

  it("reports process readiness without dependency checks", async () => {
    const response = await request(app.getHttpServer()).get("/health/readiness");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", checks: { process: "ok" } });
  });

  it("returns the public error envelope for unknown routes", async () => {
    const response = await request(app.getHttpServer()).get("/missing");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toMatch(/stack|mongo/i);
  });
});
