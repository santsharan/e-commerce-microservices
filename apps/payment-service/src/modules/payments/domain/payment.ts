import { AppError, ErrorCode } from "@commerce-flow/errors";

export const PaymentFailureMode = {
  authorize: "authorize",
  decline: "decline",
} as const;

export type PaymentFailureMode = (typeof PaymentFailureMode)[keyof typeof PaymentFailureMode];

export const PaymentStatus = {
  authorized: "authorized",
  failed: "failed",
  refunded: "refunded",
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const amountMax = 200_000_000_000;

export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  failureReason?: "declined";
  correlationId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The process default. A command may override it for one attempt. */
export function readFailureMode(env: NodeJS.ProcessEnv): PaymentFailureMode {
  const raw = env["PAYMENT_FAILURE_MODE"];
  if (raw === undefined || raw.trim() === "" || raw === PaymentFailureMode.authorize) {
    return PaymentFailureMode.authorize;
  }
  if (raw === PaymentFailureMode.decline) {
    return PaymentFailureMode.decline;
  }
  throw new AppError(ErrorCode.CONFIG_INVALID, "Invalid configuration", 500, {
    field: "PAYMENT_FAILURE_MODE",
  });
}

export function authorizationDecision(
  configured: PaymentFailureMode,
  simulate: PaymentFailureMode | undefined,
): "authorized" | "declined" {
  const mode = simulate ?? configured;
  return mode === PaymentFailureMode.decline ? "declined" : "authorized";
}

export class DuplicatePaymentError extends Error {
  public constructor() {
    super("duplicate payment");
    this.name = "DuplicatePaymentError";
  }
}
