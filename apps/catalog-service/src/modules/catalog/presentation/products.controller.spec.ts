import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Logger } from "@commerce-flow/logger";
import { LOGGER } from "../../../bootstrap/tokens.js";
import { ApiExceptionFilter } from "../../../middleware/api-exception.filter.js";
import { CatalogApplication } from "../application/catalog-application.js";
import type { Product } from "../domain/product.js";
import { ProductsController } from "./products.controller.js";

const secret = "price-note-do-not-echo";

function product(): Product {
  return {
    id: "product-1",
    name: "Blue Wool Hat",
    slug: "blue-wool-hat",
    description: "",
    status: "draft",
    categoryId: "category-1",
    variants: [{ sku: "HAT-1", name: "Medium", price: { amount: 2500, currency: "USD" } }],
    version: 1,
    createdAt: new Date("2026-09-25T09:00:00.000Z"),
    updatedAt: new Date("2026-09-25T09:00:00.000Z"),
  };
}

class FakeCatalog {
  public async createProduct(): Promise<Product> {
    return product();
  }

  public async getProduct(): Promise<Product> {
    return product();
  }

  public async listProducts(): Promise<unknown> {
    return { items: [], page: 1, limit: 20, total: 0 };
  }

  public async updateProduct(): Promise<Product> {
    return { ...product(), version: 2 };
  }

  public async deleteProduct(): Promise<void> {
    return undefined;
  }
}

describe("catalog http", () => {
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
      controllers: [ProductsController],
      providers: [
        { provide: CatalogApplication, useValue: new FakeCatalog() },
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

  it("rejects an empty variant list without echoing the description", async () => {
    const response = await request(app.getHttpServer()).post("/api/v1/products").send({
      name: "Blue Wool Hat",
      categoryId: "category-1",
      description: secret,
      variants: [],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });

  it("requires If-Match before changing a product", async () => {
    const response = await request(app.getHttpServer())
      .patch("/api/v1/products/product-1")
      .send({ name: "Navy Hat" });

    expect(response.status).toBe(428);
    expect(response.body.error.code).toBe("PRECONDITION_REQUIRED");
  });

  it("returns an ETag for a product", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/products/product-1");
    expect(response.status).toBe(200);
    expect(response.headers["etag"]).toBe('"1"');
    expect(response.body.version).toBe(1);
  });
});
