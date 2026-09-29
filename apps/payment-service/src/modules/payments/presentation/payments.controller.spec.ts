import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Logger } from "@commerce-flow/logger";
import { LOGGER } from "../../../bootstrap/tokens.js";
import { ApiExceptionFilter } from "../../../middleware/api-exception.filter.js";
import { PaymentApplication } from "../application/payment-application.js";
import { PaymentsController } from "./payments.controller.js";

const pan = "4242424242424242";

class FakePayments {
  public async authorize(input: { simulate?: string }): Promise<unknown> {
    return {
      replayed: false,
      payment: {
        id: "payment-1",
        orderId: "order-1",
        amount: 5000,
        currency: "USD",
        status: input.simulate === "decline" ? "failed" : "authorized",
        version: 1,
      },
    };
  }

  public async get(): Promise<unknown> {
    return { id: "payment-1", status: "authorized" };
  }

  public async refund(): Promise<unknown> {
    return { id: "payment-1", status: "refunded" };
  }
}

describe("payments http", () => {
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
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentApplication, useValue: new FakePayments() },
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

  it("rejects a card number without echoing it", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/payments/authorizations")
      .send({
        orderId: "order-1",
        amount: 5000,
        currency: "USD",
        cardNumber: pan,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(response.body)).not.toContain(pan);
  });

  it("authorizes through the mock provider", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/payments/authorizations")
      .send({ orderId: "order-1", amount: 5000, currency: "USD" });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("authorized");
    expect(response.body.cardNumber).toBeUndefined();
  });
});
