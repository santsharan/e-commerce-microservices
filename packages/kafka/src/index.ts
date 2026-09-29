import { Topics } from "@commerce-flow/events";

export { Topics } from "@commerce-flow/events";
export { partitionKey } from "./partition.js";

/**
 * Partitioning, the order retry decision, and the producer client.
 * Consumers are started by the service that handles a topic, not at library load.
 */

export type ErrorClass = "transient" | "permanent" | "validation" | "authentication" | "conflict";

export const localRetryDelaysMs = [100, 500, 2_000] as const;

export const delayedRetryTopics = [
  Topics.ordersRetry1m,
  Topics.ordersRetry5m,
  Topics.ordersRetry30m,
] as const;

export type RetryDecision =
  | { action: "retry-local"; delayMs: number }
  | { action: "retry-topic"; topic: (typeof delayedRetryTopics)[number] }
  | { action: "dlq"; topic: typeof Topics.ordersDlq }
  | { action: "drop" }
  | { action: "conflict" };

/**
 * Local delays run first (100ms, 500ms, 2s). Further transient failures walk the
 * 1m, 5m, and 30m retry topics, then the order DLQ.
 * Validation and authentication failures are not retried.
 * Conflicts are returned to the caller; this policy does not choose compensation.
 *
 * `localAttempts` and `topicAttempts` count failures already observed.
 */
export function decideOrderRetry(input: {
  errorClass: ErrorClass;
  localAttempts: number;
  topicAttempts: number;
}): RetryDecision {
  if (input.errorClass === "validation" || input.errorClass === "authentication") {
    return { action: "drop" };
  }
  if (input.errorClass === "conflict") {
    return { action: "conflict" };
  }
  if (input.errorClass === "permanent") {
    return { action: "dlq", topic: Topics.ordersDlq };
  }

  const delay = localRetryDelaysMs[input.localAttempts];
  if (delay !== undefined) {
    return { action: "retry-local", delayMs: delay };
  }

  const topic = delayedRetryTopics[input.topicAttempts];
  if (topic !== undefined) {
    return { action: "retry-topic", topic };
  }

  return { action: "dlq", topic: Topics.ordersDlq };
}

export { connectKafka, type KafkaConnectOptions, type KafkaHandle } from "./client.js";
export {
  consumeTopic,
  handleConsumerMessage,
  observeKafka,
  type KafkaConsumer,
} from "./consumer.js";
export { decodeMessage, producerRecord, type ProducerRecord } from "./records.js";
