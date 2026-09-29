import { AppError, ErrorCode, redactCredentials } from "@commerce-flow/errors";
import type { DomainEvent } from "@commerce-flow/events";
import { Kafka, logLevel } from "kafkajs";
import { decodeMessage } from "./records.js";

export interface KafkaObservation {
  topic: string;
  partition: string;
  outcome?: "consumed" | "failed";
  lag?: number;
}

let observe: ((event: KafkaObservation) => void) | undefined;

export function observeKafka(next: ((event: KafkaObservation) => void) | undefined): void {
  observe = next;
}

const connectionTimeoutMs = 5_000;

export interface ConsumerLogger {
  error(fields: { event: string; dependency?: string; message: string }): void;
}

export interface KafkaConsumer {
  close(): Promise<void>;
}

/**
 * Invalid commands are committed so one bad record does not block the partition.
 * Any other handler failure is retried by leaving the offset uncommitted.
 */
export async function handleConsumerMessage(input: {
  value: Buffer | string | null;
  handle: (event: DomainEvent<unknown>) => Promise<void>;
}): Promise<"commit" | "retry"> {
  let event: DomainEvent<unknown>;
  try {
    event = decodeMessage(input.value);
  } catch {
    return "commit";
  }
  try {
    await input.handle(event);
    return "commit";
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.VALIDATION_ERROR) {
      return "commit";
    }
    return "retry";
  }
}

/**
 * Subscribes one process to one topic.
 * `run` stays open until `close`, so callers must not await it before serving traffic.
 */
export async function consumeTopic(options: {
  brokers: string[];
  clientId: string;
  groupId: string;
  topic: string;
  handle: (event: DomainEvent<unknown>) => Promise<void>;
  logger?: ConsumerLogger;
}): Promise<KafkaConsumer> {
  const kafka = new Kafka({
    clientId: options.clientId,
    brokers: options.brokers,
    logLevel: logLevel.NOTHING,
    connectionTimeout: connectionTimeoutMs,
    retry: { retries: 2 },
  });
  const consumer = kafka.consumer({ groupId: options.groupId });
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: options.topic, fromBeginning: true });
  } catch (error) {
    options.logger?.error({
      event: "dependency.unavailable",
      dependency: "kafka",
      message: error instanceof Error ? redactCredentials(error.message) : "driver error",
    });
    await consumer.disconnect().catch(() => undefined);
    throw new AppError(
      ErrorCode.DEPENDENCY_UNAVAILABLE,
      "A required dependency is unavailable",
      503,
      { dependency: "kafka" },
    );
  }

  const running = consumer.run({
    eachMessage: async ({ message, partition }) => {
      const decision = await handleConsumerMessage({
        value: message.value,
        handle: options.handle,
      });
      observe?.({
        topic: options.topic,
        partition: String(partition),
        outcome: decision === "retry" ? "failed" : "consumed",
      });
      if (decision === "retry") {
        throw new Error("Kafka message will be retried");
      }
    },
  });
  consumer.on(consumer.events.END_BATCH_PROCESS, (event) => {
    const lag = Number(event.payload.offsetLag);
    if (!Number.isFinite(lag)) {
      return;
    }
    observe?.({
      topic: event.payload.topic,
      partition: String(event.payload.partition),
      lag,
    });
  });
  void running.catch((error: unknown) => {
    options.logger?.error({
      event: "kafka.consumer.crashed",
      dependency: "kafka",
      message: error instanceof Error ? redactCredentials(error.message) : "consumer crashed",
    });
  });

  return {
    async close(): Promise<void> {
      await consumer.disconnect();
      await running.catch(() => undefined);
    },
  };
}
