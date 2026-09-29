import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Logger } from "@commerce-flow/logger";
import { LOGGER } from "../../../bootstrap/tokens.js";
import { ApiExceptionFilter } from "../../../middleware/api-exception.filter.js";
import type { SessionResponse, UserProfile } from "../application/identity-application.js";
import { IdentityApplication } from "../application/identity-application.js";
import { UsersController } from "./users.controller.js";

const password = "too-short";

class FakeIdentity {
  public async register(): Promise<SessionResponse> {
    return {
      tokenType: "Bearer",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 900,
      user: { id: "user-1", email: "ada@example.com", roles: ["customer"] },
    };
  }

  public async login(): Promise<SessionResponse> {
    return this.register();
  }

  public async refresh(): Promise<SessionResponse> {
    return this.register();
  }

  public async logout(): Promise<void> {
    return undefined;
  }

  public async currentUser(): Promise<UserProfile> {
    return {
      id: "user-1",
      email: "ada@example.com",
      roles: ["customer"],
      permissions: ["orders:read"],
    };
  }
}

describe("users http", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const logger: Logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: IdentityApplication, useValue: new FakeIdentity() },
        { provide: LOGGER, useValue: logger },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects a short password without echoing it", async () => {
    const response = await request(app.getHttpServer()).post("/api/v1/users/register").send({
      email: "ada@example.com",
      password,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details.fields).toContain("password");
    expect(JSON.stringify(response.body)).not.toContain(password);
  });

  it("requires a bearer token for the current user", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/users/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the session from registration", async () => {
    const response = await request(app.getHttpServer()).post("/api/v1/users/register").send({
      email: "ada@example.com",
      password: "correct-horse",
    });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe("ada@example.com");
    expect(JSON.stringify(response.body)).not.toContain("correct-horse");
  });
});
