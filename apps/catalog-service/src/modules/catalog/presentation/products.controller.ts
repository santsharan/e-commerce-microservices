import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { API_PREFIX } from "@commerce-flow/contracts";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { z } from "zod";
import { CatalogApplication } from "../application/catalog-application.js";
import { versionFromIfMatch } from "../domain/concurrency.js";
import { etagFor, pageLimitDefault, pageLimitMax, type ProductStatus } from "../domain/product.js";
import type { ProductListQuery } from "../domain/list-query.js";

const variantSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  price: z.object({
    amount: z.number().int().nonnegative().max(100_000_000),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/),
  }),
});

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(5_000).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  categoryId: z.string().trim().min(1),
  variants: z.array(variantSchema).min(1).max(50),
});

const patchProductSchema = createProductSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    path: ["body"],
  });

interface HeaderReply {
  header(name: string, value: string): void;
}

@Controller(`${API_PREFIX.slice(1)}/products`)
export class ProductsController {
  public constructor(private readonly catalog: CatalogApplication) {}

  @Post()
  @HttpCode(201)
  public async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: HeaderReply,
  ): Promise<unknown> {
    const parsed = parse(createProductSchema, body);
    const product = await this.catalog.createProduct({
      name: parsed.name,
      categoryId: parsed.categoryId,
      variants: parsed.variants,
      ...(parsed.slug === undefined ? {} : { slug: parsed.slug }),
      ...(parsed.description === undefined ? {} : { description: parsed.description }),
      ...(parsed.status === undefined ? {} : { status: parsed.status }),
    });
    reply.header("etag", etagFor(product.version));
    return product;
  }

  @Get()
  public list(@Query() query: Record<string, unknown>): Promise<unknown> {
    return this.catalog.listProducts(readListQuery(query));
  }

  @Get(":id")
  public async get(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: HeaderReply,
  ): Promise<unknown> {
    const product = await this.catalog.getProduct(id);
    reply.header("etag", etagFor(product.version));
    return product;
  }

  @Patch(":id")
  public async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: HeaderReply,
  ): Promise<unknown> {
    const parsed = parse(patchProductSchema, body);
    const product = await this.catalog.updateProduct(id, versionFromIfMatch(ifMatch), parsed);
    reply.header("etag", etagFor(product.version));
    return product;
  }

  @Delete(":id")
  @HttpCode(204)
  public async remove(
    @Param("id") id: string,
    @Headers("if-match") ifMatch: string | undefined,
  ): Promise<void> {
    await this.catalog.deleteProduct(id, versionFromIfMatch(ifMatch));
  }
}

function readListQuery(query: Record<string, unknown>): ProductListQuery {
  const page = readInt(query["page"], 1, "page");
  const limit = Math.min(readInt(query["limit"], pageLimitDefault, "limit"), pageLimitMax);
  const sort = readSort(query["sort"]);
  const order = readOrder(query["order"]);
  const status = readStatus(query["status"]);
  const categoryId = readText(query["categoryId"]);
  const q = readText(query["q"]);
  if (q !== undefined && q.length > 100) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["q"] });
  }
  return {
    page,
    limit,
    sort,
    order,
    ...(status === undefined ? {} : { status }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(q === undefined ? {} : { q }),
  };
}

function readInt(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const text = typeof value === "string" ? value : undefined;
  if (text === undefined || !/^[1-9][0-9]*$/.test(text)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: [field] });
  }
  const parsed = Number.parseInt(text, 10);
  if (field === "limit" && parsed > pageLimitMax) {
    return pageLimitMax;
  }
  return parsed;
}

function readSort(value: unknown): ProductListQuery["sort"] {
  const text = readText(value) ?? "createdAt";
  if (text !== "createdAt" && text !== "name") {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["sort"] });
  }
  return text;
}

function readOrder(value: unknown): ProductListQuery["order"] {
  const text = readText(value) ?? "desc";
  if (text !== "asc" && text !== "desc") {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["order"] });
  }
  return text;
}

function readStatus(value: unknown): ProductStatus | undefined {
  const text = readText(value);
  if (text === undefined) {
    return undefined;
  }
  if (text !== "draft" && text !== "active" && text !== "archived") {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["status"] });
  }
  return text;
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }
  const fields = [
    ...new Set(
      parsed.error.issues.map((issue) => {
        const field = issue.path[0];
        return typeof field === "string" ? field : "body";
      }),
    ),
  ];
  throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields });
}
