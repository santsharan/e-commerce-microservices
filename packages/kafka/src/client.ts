import { AppError, ErrorCode, redactCredentials } from "@commerce-flow/errors";
import type { DomainEvent } from "@commerce-flow/events";
import { Kafka, logLevel } from "kafkajs";
import { producerRecord } from "./records.js";

/** Local Docker can be slow to accept the first connection. */
const connectionTimeoutMs = 5_000;

export interface DriverLogger {
  error(fields: { event: string; dependency: string; message: string }): void;
}

export interface KafkaConnectOptions {
  brokers: string[];
  clientId: string;
  logger?: DriverLogger;
  connectionTimeoutMs?: number;
  retries?: number;
}

export interface KafkaHandle {
  publish(event: DomainEvent<unknown>): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

function driverMessage(error: unknown): string {
  return error instanceof Error ? redactCredentials(error.message) : "driver error";
}

function unavailable(): AppError {
  return new AppError(
    ErrorCode.DEPENDENCY_UNAVAILABLE,
    "A required dependency is unavailable",
    503,
    { dependency: "kafka" },
  );
}

/**
 * Producer plus an admin client used only to ping the cluster.
 * Consumers start with the first service that handles a topic. An idle consumer
 * group would commit nothing and hide that no handler exists yet.
 */
export async function connectKafka(options: KafkaConnectOptions): Promise<KafkaHandle> {
  const kafka = new Kafka({
    clientId: options.clientId,
    brokers: options.brokers,
    logLevel: logLevel.NOTHING,
    connectionTimeout: options.connectionTimeoutMs ?? connectionTimeoutMs,
    retry: { retries: options.retries ?? 2 },
  });
  const producer = kafka.producer();
  const admin = kafka.admin();

  const disconnect = async (): Promise<void> => {
    await producer.disconnect().catch(() => undefined);
    await admin.disconnect().catch(() => undefined);
  };

  try {
    await producer.connect();
    await admin.connect();
  } catch (error) {
    options.logger?.error({
      event: "dependency.unavailable",
      dependency: "kafka",
      message: driverMessage(error),
    });
    await disconnect();
    throw unavailable();
  }

  let closed = false;
  return {
    async publish(event: DomainEvent<unknown>): Promise<void> {
      const record = producerRecord(event);
      try {
        await producer.send({
          topic: record.topic,
          messages: [{ key: record.key, value: record.value }],
        });
      } catch (error) {
        options.logger?.error({
          event: "dependency.unavailable",
          dependency: "kafka",
          message: driverMessage(error),
        });
        throw unavailable();
      }
    },
    async ping(): Promise<void> {
      await admin.listTopics();
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await disconnect();
    },
  };
}
