import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import type { Logger } from "@commerce-flow/logger";
import { LOGGER } from "../../../bootstrap/tokens.js";
import { ApiExceptionFilter } from "../../../middleware/api-exception.filter.js";
import { OrderApplication } from "../application/order-application.js";
import { OrdersController } from "./orders.controller.js";

const secret = "card-note-do-not-echo";

class FakeOrders {
  public async create(input: { idempotencyKey: string }): Promise<unknown> {
    if (input.idempotencyKey.trim().length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
        fields: ["Idempotency-Key"],
      });
    }
    return {
      replayed: false,
      order: {
        id: "order-1",
        version: 2,
        status: "pending",
        customerId: "customer-1",
      },
    };
  }

  public async get(): Promise<unknown> {
    return { id: "order-1", version: 2, status: "pending" };
  }

  public async list(): Promise<unknown> {
    return { items: [], page: 1, limit: 20, total: 0 };
  }

  public async cancel(): Promise<unknown> {
    return { id: "order-1", version: 3, status: "cancelling" };
  }
}

describe("orders http", () => {
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
      controllers: [OrdersController],
      providers: [
        { provide: OrderApplication, useValue: new FakeOrders() },
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

  it("rejects an empty item list without echoing an extra field", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("idempotency-key", "key-1")
      .send({
        customerId: "customer-1",
        currency: "USD",
        items: [],
        note: secret,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });

  it("requires an idempotency key", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .send({
        customerId: "customer-1",
        currency: "USD",
        items: [
          {
            productId: "product-1",
            sku: "HAT-1",
            name: "Hat",
            unitPrice: 100,
            quantity: 1,
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.details.fields).toEqual(["Idempotency-Key"]);
  });

  it("returns an ETag for a new order", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("idempotency-key", "key-1")
      .send({
        customerId: "customer-1",
        currency: "USD",
        items: [
          {
            productId: "product-1",
            sku: "HAT-1",
            name: "Hat",
            unitPrice: 100,
            quantity: 1,
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.headers["etag"]).toBe('"2"');
  });

  it("requires If-Match before cancelling", async () => {
    const response = await request(app.getHttpServer()).post("/api/v1/orders/order-1/cancel");
    expect(response.status).toBe(428);
    expect(response.body.error.code).toBe("PRECONDITION_REQUIRED");
  });

  it("requires If-Match before replaying a dead-lettered order", async () => {
    const response = await request(app.getHttpServer()).post("/api/v1/orders/order-1/retries");
    expect(response.status).toBe(428);
    expect(response.body.error.code).toBe("PRECONDITION_REQUIRED");
  });
});
