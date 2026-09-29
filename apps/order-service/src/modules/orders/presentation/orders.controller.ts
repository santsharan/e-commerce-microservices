import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import { API_PREFIX, Headers as ContractHeaders } from "@commerce-flow/contracts";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { z } from "zod";
import { OrderApplication, type OrderActor } from "../application/order-application.js";
import { versionFromIfMatch } from "../domain/concurrency.js";
import { etagFor, isSku, pageLimitDefault, pageLimitMax } from "../domain/order.js";
import { itemCountMax, lineQuantityMax, unitPriceMax } from "../domain/pricing.js";

const itemSchema = z.object({
  productId: z.string().trim().min(1).max(80),
  sku: z.string().trim().refine(isSku),
  name: z.string().trim().min(1).max(200),
  unitPrice: z.number().int().nonnegative().max(unitPriceMax),
  quantity: z.number().int().min(1).max(lineQuantityMax),
});

const createOrderSchema = z.object({
  customerId: z.string().trim().min(1).max(80),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/),
  items: z.array(itemSchema).min(1).max(itemCountMax),
});

interface OrderReply {
  header(name: string, value: string): void;
  status(code: number): void;
}

@Controller(`${API_PREFIX.slice(1)}/orders`)
export class OrdersController {
  public constructor(private readonly orders: OrderApplication) {}

  @Post()
  @HttpCode(201)
  public async create(
    @Body() body: unknown,
    @Headers(ContractHeaders.idempotencyKey) idempotencyKey: string | undefined,
    @Headers("x-correlation-id") correlationHeader: string | undefined,
    @Res({ passthrough: true }) reply: OrderReply,
  ): Promise<unknown> {
    const parsed = parse(createOrderSchema, body);
    const result = await this.orders.create({
      customerId: parsed.customerId,
      currency: parsed.currency,
      items: parsed.items.map((item) => ({
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      })),
      idempotencyKey: idempotencyKey ?? "",
      correlationId: correlationId(correlationHeader),
    });
    reply.header("etag", etagFor(result.order.version));
    reply.status(result.replayed ? 200 : 201);
    return result.order;
  }

  @Get()
  public list(@Query() query: Record<string, unknown>): Promise<unknown> {
    const customerId = typeof query["customerId"] === "string" ? query["customerId"] : "";
    return this.orders.list(
      customerId,
      readInt(query["page"], 1, "page"),
      Math.min(readInt(query["limit"], pageLimitDefault, "limit"), pageLimitMax),
    );
  }

  @Get(":id")
  public async get(
    @Param("id") id: string,
    @Headers("x-user-id") userId: string | undefined,
    @Headers("x-user-roles") roles: string | undefined,
    @Res({ passthrough: true }) reply: OrderReply,
  ): Promise<unknown> {
    const order = await this.orders.get(id, actorFrom(userId, roles));
    reply.header("etag", etagFor(order.version));
    return order;
  }

  @Post(":id/cancel")
  public async cancel(
    @Param("id") id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("x-user-id") userId: string | undefined,
    @Headers("x-user-roles") roles: string | undefined,
    @Res({ passthrough: true }) reply: OrderReply,
  ): Promise<unknown> {
    const order = await this.orders.cancel(
      id,
      versionFromIfMatch(ifMatch),
      actorFrom(userId, roles),
    );
    reply.header("etag", etagFor(order.version));
    return order;
  }

  @Post(":id/retries")
  @HttpCode(200)
  public async retry(
    @Param("id") id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("x-user-id") userId: string | undefined,
    @Headers("x-user-roles") roles: string | undefined,
    @Res({ passthrough: true }) reply: OrderReply,
  ): Promise<unknown> {
    const order = await this.orders.retry(
      id,
      versionFromIfMatch(ifMatch),
      actorFrom(userId, roles),
    );
    reply.header("etag", etagFor(order.version));
    return order;
  }
}

function actorFrom(userId: string | undefined, roles: string | undefined): OrderActor | undefined {
  if (userId === undefined || userId.trim().length === 0) {
    return undefined;
  }
  return {
    userId: userId.trim(),
    roles: (roles ?? "")
      .split(",")
      .map((role) => role.trim())
      .filter((role) => role.length > 0),
  };
}

function correlationId(header: string | undefined): string {
  if (header === undefined) {
    return randomUUID();
  }
  const trimmed = header.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    return randomUUID();
  }
  return trimmed;
}

function readInt(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const text = typeof value === "string" ? value : undefined;
  if (text === undefined || !/^[1-9][0-9]*$/.test(text)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: [field] });
  }
  return Number.parseInt(text, 10);
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
