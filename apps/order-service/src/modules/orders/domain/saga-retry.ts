import { AppError, ErrorCode, redactCredentials } from "@commerce-flow/errors";
import { EventType, Topics } from "@commerce-flow/events";
import { decideOrderRetry, type ErrorClass, type RetryDecision } from "@commerce-flow/kafka";
import type { SagaRecord } from "./order.js";

const jitterRatio = 0.2;

const topicDelayMs: Record<
  typeof Topics.ordersRetry1m | typeof Topics.ordersRetry5m | typeof Topics.ordersRetry30m,
  number
> = {
  [Topics.ordersRetry1m]: 60_000,
  [Topics.ordersRetry5m]: 5 * 60_000,
  [Topics.ordersRetry30m]: 30 * 60_000,
};

const topicEvent: Record<keyof typeof topicDelayMs, EventType> = {
  [Topics.ordersRetry1m]: EventType.sagaRetry1m,
  [Topics.ordersRetry5m]: EventType.sagaRetry5m,
  [Topics.ordersRetry30m]: EventType.sagaRetry30m,
};

export interface SagaRetryPlan {
  decision: RetryDecision;
  localAttempts: number;
  topicAttempts: number;
  retryCount: number;
  lastError: string;
  errorCode: string;
  stack: string;
  dlqPublished: boolean;
  retryHalted: boolean;
  nextAttemptAt?: Date;
}

export function classifySagaError(error: unknown): ErrorClass {
  if (error instanceof AppError) {
    if (
      error.code === ErrorCode.VALIDATION_ERROR ||
      error.code === ErrorCode.PRECONDITION_REQUIRED
    ) {
      return "validation";
    }
    if (error.code === ErrorCode.UNAUTHORIZED || error.code === ErrorCode.FORBIDDEN) {
      return "authentication";
    }
    if (error.code === ErrorCode.CONFLICT) {
      return "conflict";
    }
    if (error.code === ErrorCode.DEPENDENCY_UNAVAILABLE || error.statusCode >= 500) {
      return "transient";
    }
    return "permanent";
  }
  return "transient";
}

export function scheduleSagaRetry(input: {
  saga: Pick<SagaRecord, "localAttempts" | "topicAttempts" | "retryCount">;
  error: unknown;
  now: Date;
  random: () => number;
}): SagaRetryPlan {
  const errorClass = classifySagaError(input.error);
  const described = describeError(input.error);
  const decision = decideOrderRetry({
    errorClass,
    localAttempts: input.saga.localAttempts,
    topicAttempts: input.saga.topicAttempts,
  });
  const plan: SagaRetryPlan = {
    decision,
    localAttempts: input.saga.localAttempts,
    topicAttempts: input.saga.topicAttempts,
    retryCount: decision.action === "conflict" ? input.saga.retryCount : input.saga.retryCount + 1,
    lastError: described.message,
    errorCode: described.code,
    stack: described.stack,
    dlqPublished: false,
    retryHalted: false,
  };
  if (decision.action === "retry-local") {
    plan.localAttempts += 1;
    plan.nextAttemptAt = new Date(input.now.getTime() + withJitter(decision.delayMs, input.random));
  }
  if (decision.action === "retry-topic") {
    plan.topicAttempts += 1;
    plan.nextAttemptAt = new Date(
      input.now.getTime() + withJitter(topicDelayMs[decision.topic], input.random),
    );
  }
  if (decision.action === "dlq") {
    plan.dlqPublished = true;
  }
  if (decision.action === "drop") {
    plan.retryHalted = true;
  }
  return plan;
}

export function retryEventType(topic: keyof typeof topicDelayMs): EventType {
  return topicEvent[topic];
}

export function isRetryDue(
  saga: Pick<SagaRecord, "dlqPublished" | "retryHalted" | "nextAttemptAt">,
  now: Date,
): boolean {
  if (saga.dlqPublished || saga.retryHalted) {
    return false;
  }
  return saga.nextAttemptAt === undefined || saga.nextAttemptAt <= now;
}

export function isRetryWaiting(
  saga: Pick<SagaRecord, "dlqPublished" | "retryHalted" | "nextAttemptAt">,
  now: Date,
): boolean {
  if (saga.dlqPublished || saga.retryHalted || saga.nextAttemptAt === undefined) {
    return false;
  }
  return saga.nextAttemptAt > now;
}

function withJitter(delayMs: number, random: () => number): number {
  const sample = random();
  const unit = sample < 0 || sample >= 1 ? 0 : sample;
  return delayMs + Math.floor(unit * delayMs * jitterRatio);
}

function describeError(error: unknown): { code: string; message: string; stack: string } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, stack: safeStack(error) };
  }
  if (error instanceof Error) {
    return {
      code: "TRANSIENT",
      message: redactCredentials(error.message).slice(0, 200),
      stack: safeStack(error),
    };
  }
  return { code: "TRANSIENT", message: "recovery failed", stack: "" };
}

function safeStack(error: Error): string {
  if (error.stack === undefined) {
    return "";
  }
  return redactCredentials(error.stack).slice(0, 500);
}
