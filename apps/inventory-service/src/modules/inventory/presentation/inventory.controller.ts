import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { API_PREFIX } from "@commerce-flow/contracts";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { z } from "zod";
import { InventoryApplication } from "../application/inventory-application.js";
import { isSku, onHandMax, reserveQuantityMax } from "../domain/stock.js";

const stockBody = z.object({
  sku: z.string().trim().refine(isSku),
  quantity: z.number().int().nonnegative().max(onHandMax),
});

const adjustBody = z.object({
  quantity: z
    .number()
    .int()
    .min(-onHandMax)
    .max(onHandMax)
    .refine((value) => value !== 0),
});

const reserveBody = z.object({
  orderId: z.string().trim().min(1).max(80),
  sku: z.string().trim().refine(isSku),
  quantity: z.number().int().min(1).max(reserveQuantityMax),
});

interface StatusReply {
  status(code: number): void;
}

@Controller(`${API_PREFIX.slice(1)}/inventory`)
export class InventoryController {
  public constructor(private readonly inventory: InventoryApplication) {}

  @Post()
  @HttpCode(201)
  public create(@Body() body: unknown): Promise<unknown> {
    const parsed = parse(stockBody, body);
    return this.inventory.createStock(parsed);
  }

  @Post("reservations")
  public async reserve(
    @Body() body: unknown,
    @Headers("x-correlation-id") correlationHeader: string | undefined,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<unknown> {
    const parsed = parse(reserveBody, body);
    const result = await this.inventory.reserve({
      ...parsed,
      correlationId: correlationId(correlationHeader),
    });
    reply.status(result.replayed ? 200 : 201);
    return result.reservation;
  }

  @Get("reservations/:id")
  public getReservation(@Param("id") id: string): Promise<unknown> {
    return this.inventory.getReservation(id);
  }

  @Post("reservations/:id/release")
  public release(
    @Param("id") id: string,
    @Headers("x-correlation-id") correlationHeader: string | undefined,
  ): Promise<unknown> {
    return this.inventory.release({
      reservationId: id,
      correlationId: correlationId(correlationHeader),
    });
  }

  @Get(":sku")
  public get(@Param("sku") sku: string): Promise<unknown> {
    return this.inventory.getStock(sku);
  }

  @Post(":sku/adjustments")
  public adjust(@Param("sku") sku: string, @Body() body: unknown): Promise<unknown> {
    const parsed = parse(adjustBody, body);
    return this.inventory.adjust({ sku, quantity: parsed.quantity });
  }
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
