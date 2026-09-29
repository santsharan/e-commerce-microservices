import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Logger } from "@commerce-flow/logger";
import { LOGGER } from "../../../bootstrap/tokens.js";
import { ApiExceptionFilter } from "../../../middleware/api-exception.filter.js";
import { InventoryApplication } from "../application/inventory-application.js";
import { InventoryController } from "./inventory.controller.js";

const secret = "stock-note-do-not-echo";

describe("inventory http", () => {
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
      controllers: [InventoryController],
      providers: [
        {
          provide: InventoryApplication,
          useValue: {
            async reserve(): Promise<never> {
              throw new Error("reserve should not run");
            },
          },
        },
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

  it("rejects a reserve body without echoing an extra field", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/inventory/reservations")
      .send({
        orderId: "order-1",
        sku: "HAT-1",
        quantity: -1,
        note: secret,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details.fields).toContain("quantity");
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });
});
