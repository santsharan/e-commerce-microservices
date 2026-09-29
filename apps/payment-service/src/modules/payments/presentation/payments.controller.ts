import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res } from "@nestjs/common";
import { API_PREFIX } from "@commerce-flow/contracts";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { z } from "zod";
import { PaymentApplication } from "../application/payment-application.js";
import { PaymentFailureMode, amountMax } from "../domain/payment.js";

const authorizeBody = z.strictObject({
  orderId: z.string().trim().min(1).max(80),
  amount: z.number().int().nonnegative().max(amountMax),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/),
  simulate: z.enum([PaymentFailureMode.authorize, PaymentFailureMode.decline]).optional(),
});

interface StatusReply {
  status(code: number): void;
}

@Controller(`${API_PREFIX.slice(1)}/payments`)
export class PaymentsController {
  public constructor(private readonly payments: PaymentApplication) {}

  @Post("authorizations")
  public async authorize(
    @Body() body: unknown,
    @Headers("x-correlation-id") correlationHeader: string | undefined,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<unknown> {
    const parsed = parse(authorizeBody, body);
    const result = await this.payments.authorize({
      orderId: parsed.orderId,
      amount: parsed.amount,
      currency: parsed.currency,
      correlationId: correlationId(correlationHeader),
      ...(parsed.simulate === undefined ? {} : { simulate: parsed.simulate }),
    });
    reply.status(result.replayed ? 200 : 201);
    return result.payment;
  }

  @Get(":id")
  public get(@Param("id") id: string): Promise<unknown> {
    return this.payments.get(id);
  }

  @Post(":id/refunds")
  @HttpCode(200)
  public refund(@Param("id") id: string): Promise<unknown> {
    return this.payments.refund({ paymentId: id });
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
        if (issue.code === "unrecognized_keys") {
          return "body";
        }
        const field = issue.path[0];
        return typeof field === "string" ? field : "body";
      }),
    ),
  ];
  throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields });
}
